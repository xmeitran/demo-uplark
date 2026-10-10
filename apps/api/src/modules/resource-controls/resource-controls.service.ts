import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  CapacitySummaryItem,
  CapacitySummaryResponse,
  CostRateInput,
  CostRatesResponse,
  CreateResourceAllocationInput,
  PrincipalContext,
  ProjectCostItem,
  ProjectCostItemInput,
  ProjectCostItemsResponse,
  ProjectPlSnapshotSummary,
  ProjectPlSummaryResponse,
  ResourceAllocationSummary
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { normalizeProjectStatus } from "../delivery-handoff/project-status";
import { assertCostEdit, assertCostView, canEditCost } from "./cost-permissions";
import { COST_CATEGORIES, SYSTEM_VARIABLES, allocatePool, computeMargin, effectiveCostRate, evaluateFormula, parseParameterValue, isApprovedEntry, monthKeysBetween, nextMonthKey, normalizeCostCategory, reportDayStart, reportMonthKey, reportMonthStart, resolveRevenue, roundMoney, summarizeLabor, type CostCategory, type CostRateRow } from "./pnl-calc";

const DEFAULT_WEEKLY_CAPACITY_MINUTES = 2400;
const PROJECT_COST_ITEM_TYPES = new Set(["EXTERNAL", "SOFTWARE", "TRAVEL", "WRITE_OFF", "OTHER"]);
const MAX_MONEY_AMOUNT = 1_000_000_000_000;
// Allocation criteria saved by the P&L setup screen.
const POOL_BY_HOURS = "Theo giờ tính P&L";
const POOL_BY_REVENUE = "Theo doanh thu";
const POOL_BY_HEADCOUNT = "Theo số nhân sự";
const POOL_EVEN = "Chia đều";
const POOL_MANUAL = "Nhập tay từng dự án";

/**
 * fullMonths: the months wholly inside [start, end). Revenue, the shared pool and formula
 * costs are monthly figures, so they are only taken for these months; labor and entered
 * cost lines are dated and follow the exact range. partial: the range has a broken month.
 */
type ReportBounds = { key: string; start: Date; end: Date; monthKey?: string; fullMonths: string[]; partial: boolean };
type PeriodSnapshotPlan = { period: ReportBounds; rows: Awaited<ReturnType<ResourceControlsService["computeProjectPl"]>> };
type MonthSetup = { parameters: Map<string, number>; items: Array<{ code: string; label: string; category: CostCategory; formula: string }> };

@Injectable()
export class ResourceControlsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async capacitySummary(query: any, principal: PrincipalContext): Promise<CapacitySummaryResponse> {
    const periodStart = startOfDay(parseDate(query.periodStart) ?? startOfWeek(new Date()));
    const periodEnd = startOfDay(parseDate(query.periodEnd) ?? addDays(periodStart, 7));

    if (periodEnd <= periodStart) {
      throw new BadRequestException("periodEnd must be after periodStart");
    }

    const users = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        subjectType: "INTERNAL_USER",
        roleBindings: {
          some: {
            workspaceId: principal.workspaceId,
            tenantKey: principal.tenantKey,
            endsAt: null
          }
        }
      },
      include: {
        resourceProfile: true,
        capacityPeriods: {
          where: {
            periodStart: { lte: periodStart },
            periodEnd: { gte: periodEnd }
          }
        },
        resourceAllocations: {
          where: {
            workspaceId: principal.workspaceId,
            startAt: { lt: periodEnd },
            endAt: { gt: periodStart },
            status: { notIn: ["RELEASED", "CANCELLED"] }
          },
          include: {
            account: true,
            project: true,
            opportunity: true,
            user: true
          },
          orderBy: { startAt: "asc" }
        }
      },
      orderBy: [{ displayName: "asc" }, { email: "asc" }]
    });

    const data: CapacitySummaryItem[] = users.map((user) => {
      const profile = user.resourceProfile;
      const matchingPeriod = user.capacityPeriods[0];
      const availableMinutes =
        matchingPeriod?.availableMinutes ?? profile?.defaultWeeklyCapacityMinutes ?? DEFAULT_WEEKLY_CAPACITY_MINUTES;
      const allocations = user.resourceAllocations.map(mapAllocation);
      // EV-035: allocations on On Hold projects are freed capacity; report them apart from the load.
      const onHoldAllocatedMinutes = user.resourceAllocations
        .filter((allocation) => normalizeProjectStatus(allocation.project?.status) === "on_hold")
        .reduce((total, allocation) => total + allocation.plannedMinutes, 0);
      const allocatedMinutes = allocations.reduce((total, allocation) => total + allocation.plannedMinutes, 0) - onHoldAllocatedMinutes;

      return {
        userId: user.id,
        userDisplayName: user.displayName,
        userEmail: user.email,
        userAvatarUrl: user.avatarUrl ?? undefined,
        departmentCode: user.departmentCode ?? undefined,
        displayRole: profile?.displayRole ?? undefined,
        skills: profile?.skills ?? [],
        availableMinutes,
        allocatedMinutes,
        onHoldAllocatedMinutes,
        capacityKnown: Boolean(matchingPeriod ?? profile),
        remainingMinutes: Math.max(availableMinutes - allocatedMinutes, 0),
        utilizationPercent: availableMinutes > 0 ? round((allocatedMinutes / availableMinutes) * 100, 2) : 0,
        overbooked: allocatedMinutes > availableMinutes,
        billableTargetPercent: profile?.billableTargetPercent ?? 70,
        allocations
      };
    });

    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        periodEnd: periodEnd.toISOString(),
        periodStart: periodStart.toISOString(),
        principal: principal.displayName,
        rowScope: "workspace",
        source: "postgresql"
      }
    };
  }

  async createAllocation(body: CreateResourceAllocationInput, principal: PrincipalContext) {
    const accountId = nonEmptyString(body.accountId, "accountId");
    const userId = nonEmptyString(body.userId, "userId");
    const role = nonEmptyString(body.role, "role");
    const startAt = parseRequiredDate(body.startAt, "startAt");
    const endAt = parseRequiredDate(body.endAt, "endAt");

    if (endAt <= startAt) {
      throw new BadRequestException("endAt must be after startAt");
    }

    const projectId = optionalString(body.projectId);
    const opportunityId = optionalString(body.opportunityId);
    await this.ensureAllocationTargets({
      accountId,
      projectId,
      opportunityId,
      userId,
      workspaceId: principal.workspaceId,
      tenantKey: principal.tenantKey
    });

    const allocation = await this.prisma.resourceAllocation.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId,
        projectId,
        opportunityId,
        userId,
        role,
        skill: optionalString(body.skill),
        status: toAllocationStatus(body.status ?? "requested"),
        allocationPercent: optionalInteger(body.allocationPercent) ?? 100,
        plannedMinutes: optionalInteger(body.plannedMinutes) ?? 0,
        startAt,
        endAt,
        overbookApproved: Boolean(body.overbookApproved),
        note: optionalString(body.note),
        createdByUserId: principal.subjectId
      },
      include: {
        account: true,
        project: true,
        opportunity: true,
        user: true
      }
    });

    return mapAllocation(allocation);
  }

  private async ensureAllocationTargets(input: {
    accountId: string;
    projectId?: string;
    opportunityId?: string;
    userId: string;
    workspaceId: string;
    tenantKey: string;
  }) {
    const [account, user, project, opportunity] = await Promise.all([
      this.prisma.account.findFirst({
        where: { id: input.accountId, workspaceId: input.workspaceId },
        select: { id: true }
      }),
      this.prisma.user.findFirst({
        where: {
          id: input.userId,
          status: "ACTIVE",
          subjectType: "INTERNAL_USER",
          roleBindings: {
            some: {
              workspaceId: input.workspaceId,
              tenantKey: input.tenantKey,
              endsAt: null
            }
          }
        },
        select: { id: true }
      }),
      input.projectId
        ? this.prisma.project.findFirst({
            where: { id: input.projectId, workspaceId: input.workspaceId, accountId: input.accountId },
            select: { id: true }
          })
        : Promise.resolve(undefined),
      input.opportunityId
        ? this.prisma.opportunity.findFirst({
            where: { id: input.opportunityId, workspaceId: input.workspaceId, accountId: input.accountId },
            select: { id: true }
          })
        : Promise.resolve(undefined)
    ]);

    if (!account) throw new NotFoundException("Allocation account not found in workspace");
    if (!user) throw new NotFoundException("Allocation user not found in workspace");
    if (input.projectId && !project) throw new NotFoundException("Allocation project not found for account/workspace");
    if (input.opportunityId && !opportunity) throw new NotFoundException("Allocation opportunity not found for account/workspace");
  }

  async projectPlSummary(query: any, principal: PrincipalContext): Promise<ProjectPlSummaryResponse> {
    assertCostView(principal);
    const period = parseReportBounds(query);
    // A locked month is served from its snapshot so the figures can never drift afterwards.
    const locked = period?.monthKey ? await this.isPeriodLocked(principal.workspaceId, period.monthKey) : false;
    const formulaErrors: string[] = [];
    const data = await this.computeProjectPl(query, principal, period, locked, formulaErrors);
    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        policy: "workspace_finance",
        principal: principal.displayName,
        rowScope: "workspace",
        source: "postgresql",
        locked,
        formulaErrors,
        canEdit: canEditCost(principal) && !locked,
        ...(period ? { fullMonthKeys: period.fullMonths } : {}),
        ...(period?.partial ? { partialPeriod: true } : {}),
        ...(period ? { periodKey: period.key, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() } : {})
      }
    };
  }

  async computeProjectPl(query: any, principal: PrincipalContext, period: ReportBounds | undefined, useLockedSnapshots: boolean, formulaErrors: string[] = []) {
    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: principal.workspaceId,
        ...(optionalString(query.accountId) ? { accountId: optionalString(query.accountId) } : {}),
        ...(optionalString(query.projectId) ? { id: optionalString(query.projectId) } : {})
      },
      include: {
        account: true,
        budgets: { orderBy: { updatedAt: "desc" }, take: 1 },
        costs: period
          ? { where: { occurredAt: { gte: period.start, lt: period.end } } }
          : true,
        paymentMilestones: period
          ? {
              where: {
                OR: [
                  { dueAt: { gte: period.start, lt: period.end } },
                  { paidAt: { gte: period.start, lt: period.end } }
                ]
              }
            }
          : true,
        paymentSchedules: true,
        // Only the snapshot of the viewed, locked month is ever read: a lock of another month says nothing about this one.
        plSnapshots: useLockedSnapshots && period
          ? { where: { status: "LOCKED", periodStart: period.start }, orderBy: { createdAt: "desc" }, take: 1 }
          : false,
        // Manual revenue is entered per month: only months wholly inside the range count.
        pnlPeriods: period
          ? { where: { periodKey: { in: period.fullMonths } } }
          : true,
        // The plan for a period is what was scheduled in it; without a period it is the task estimates.
        taskPlanningBlocks: period
          ? { where: { startAt: { gte: period.start, lt: period.end }, status: { not: "cancelled" } }, select: { plannedMinutes: true } }
          : false,
        tasks: {
          include: {
            timeEntries: period
              ? { where: { workDate: { gte: period.start, lt: period.end } }, include: { user: { select: { displayName: true } } } }
              : { include: { user: { select: { displayName: true } } } }
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });

    const entryUserIds = Array.from(new Set(projects.flatMap((project) => project.tasks.flatMap((task) => task.timeEntries.map((entry) => entry.userId)))));
    const [ratesByUser, monthly] = await Promise.all([
      this.loadCostRates(entryUserIds, principal.workspaceId),
      this.loadMonthlySetup(principal.workspaceId, period)
    ]);
    // A locked month is served from snapshots: its setup is not evaluated again.
    if (!useLockedSnapshots) formulaErrors.push(...monthly.errors);

    return projects.map((project) => {
      const latestBudget = project.budgets[0];
      const lockedSnapshot = useLockedSnapshots ? project.plSnapshots?.[0] : undefined;
      const currency = latestBudget?.currency ?? lockedSnapshot?.currency ?? "VND";
      const customRevenueAmount = project.pnlPeriods.length ? sum(project.pnlPeriods.map((row) => money(row.revenueAmount))) : undefined;
      const scheduleRevenue = sum(project.paymentSchedules.map((schedule) => money(schedule.totalAmount)));
      const milestoneRevenue = sum(project.paymentMilestones.map((milestone) => money(milestone.amount)));
      const paidRevenueAmount = sum(
        project.paymentMilestones
          .filter((milestone) => String(milestone.paymentStatus) === "PAID")
          .map((milestone) => money(milestone.amount))
      );
      const plannedRevenueAmount = money(latestBudget?.plannedRevenueAmount) || milestoneRevenue || scheduleRevenue;
      // The planned cost shown with a locked month is the one it was locked with.
      const plannedCostAmount = lockedSnapshot ? money(lockedSnapshot.plannedCostAmount) : money(latestBudget?.plannedCostAmount);
      const plannedMinutes = period
        ? sum((project.taskPlanningBlocks ?? []).map((block) => block.plannedMinutes))
        : sum(project.tasks.map((task) => task.estimateMinutes ?? 0));

      // Labor cost is always derived from approved hours × cost rate. LABOR rows
      // in ProjectCost (legacy seed data) are ignored so labor is never counted twice.
      const entries = project.tasks.flatMap((task) => task.timeEntries);
      const labor = summarizeLabor(entries, ratesByUser);
      const displayNames = new Map(entries.map((entry) => [entry.userId, (entry as { user?: { displayName?: string | null } }).user?.displayName ?? entry.userId]));
      const costItems = project.costs
        .filter((cost) => String(cost.costType) !== "LABOR")
        .map((cost) => mapCostItem(cost, project.name));
      // A snapshot keeps no split by expense group, so a locked month reports none (see lockedOtherCostAmount).
      const costByCategory = Object.fromEntries(COST_CATEGORIES.map((category) => [category, lockedSnapshot ? 0 : roundMoney(sum(costItems.filter((cost) => cost.category === category).map((cost) => cost.amount)))])) as Record<CostCategory, number>;
      const liveDirect = roundMoney(sum(costItems.filter((cost) => cost.costType !== "WRITE_OFF").map((cost) => cost.amount)));
      const liveWriteOff = roundMoney(sum(costItems.filter((cost) => cost.costType === "WRITE_OFF").map((cost) => cost.amount)));
      const sharedByMonth = monthly.sharedByProject.get(project.id);
      const liveShared = lockedSnapshot ? 0 : sum(Array.from(sharedByMonth?.values() ?? []));

      // User-defined calculated cost items: one evaluation per month that has a setup,
      // with that month's parameters and that month's figures for this project.
      const calculated = new Map<string, { code: string; label: string; category: CostCategory; amount: number }>();
      for (const [monthKey, setup] of monthly.setups) {
        // Already inside the frozen total of a locked month: never add live formula costs on top.
        if (lockedSnapshot || !setup.items.length) continue;
        const monthEntries = entries.filter((entry) => reportMonthKey(entry.workDate) === monthKey);
        const monthLabor = summarizeLabor(monthEntries, ratesByUser);
        const monthCosts = costItems.filter((cost) => cost.occurredOn.startsWith(monthKey));
        const monthRevenue = project.pnlPeriods.find((row) => row.periodKey === monthKey);
        // Only projects that were active in the month carry calculated costs.
        if (!monthLabor.approvedMinutes && !monthCosts.length && !monthRevenue) continue;
        const variables = new Map(setup.parameters);
        variables.set("DOANH_THU_THANG", monthRevenue ? money(monthRevenue.revenueAmount) : 0);
        variables.set("DOANH_THU_KE_HOACH", plannedRevenueAmount);
        variables.set("GIO_DUYET", monthLabor.approvedMinutes / 60);
        variables.set("CP_NHAN_SU", monthLabor.laborCostAmount);
        variables.set("CP_KHAC", sum(monthCosts.map((cost) => cost.amount)));
        variables.set("QUY_DUNG_CHUNG", sharedByMonth?.get(monthKey) ?? 0);
        variables.set("SO_NHAN_SU", monthLabor.people.filter((person) => person.approvedMinutes > 0).length);
        for (const item of setup.items) {
          const result = evaluateFormula(item.formula, variables);
          if (!result.ok) {
            const message = `${monthKey} · ${item.label}: ${result.error}`;
            if (!formulaErrors.includes(message)) formulaErrors.push(message);
            continue;
          }
          const current = calculated.get(item.code) ?? { code: item.code, label: item.label, category: item.category, amount: 0 };
          current.amount = roundMoney(current.amount + result.value);
          calculated.set(item.code, current);
        }
      }
      const calculatedItems = Array.from(calculated.values());
      const liveCalculated = roundMoney(sum(calculatedItems.map((item) => item.amount)));
      for (const item of calculatedItems) costByCategory[item.category] = roundMoney(costByCategory[item.category] + item.amount);
      const liveRevenue = resolveRevenue({ customRevenueAmount, plannedRevenueAmount, periodScoped: Boolean(period) });

      // Totals: frozen from the snapshot when the month is locked, otherwise live.
      const actualLaborCostAmount = lockedSnapshot ? money(lockedSnapshot.actualLaborCostAmount) : labor.laborCostAmount;
      const directCostAmount = lockedSnapshot ? money(lockedSnapshot.directCostAmount) : liveDirect;
      const writeOffAmount = lockedSnapshot ? money(lockedSnapshot.writeOffAmount) : liveWriteOff;
      const enteredCostAmount = roundMoney(directCostAmount + writeOffAmount);
      // A snapshot stores one figure for everything that is neither labor nor an entered cost line
      // (pool share + formula costs). It cannot be split back, so it is returned as one amount and
      // the live pool share / formula items are NOT returned next to it.
      const lockedOtherCostAmount = lockedSnapshot ? roundMoney(money(lockedSnapshot.totalCostAmount) - actualLaborCostAmount - enteredCostAmount) : undefined;
      const calculatedCostAmount = liveCalculated;
      const sharedCostAmount = liveShared;
      const totalCostAmount = lockedSnapshot ? money(lockedSnapshot.totalCostAmount) : roundMoney(actualLaborCostAmount + enteredCostAmount + sharedCostAmount + calculatedCostAmount);
      const otherCostAmount = roundMoney(totalCostAmount - actualLaborCostAmount);
      const revenueAmount = lockedSnapshot ? money(lockedSnapshot.revenueAmount) : liveRevenue.revenueAmount;
      // A month locked before revenue was required per period keeps the revenue it was locked with.
      const revenueBasis = lockedSnapshot && liveRevenue.revenueBasis === "none" && revenueAmount > 0 ? ("planned" as const) : liveRevenue.revenueBasis;
      const { grossMarginAmount, grossMarginPercent, expenseRatioPercent } = computeMargin(revenueAmount, totalCostAmount);

      return {
        accountId: project.accountId,
        accountName: project.account.name,
        projectId: project.id,
        projectName: project.name,
        currency,
        plannedRevenueAmount,
        paidRevenueAmount,
        customRevenueAmount,
        revenueAmount,
        revenueBasis,
        expenseRatioPercent,
        plannedCostAmount,
        plannedMinutes,
        plannedMinutesBasis: (period ? "planning_blocks" : "task_estimates") as "planning_blocks" | "task_estimates",
        approvedLaborMinutes: labor.approvedMinutes,
        // A locked snapshot is final even if a rate is added later.
        missingRateMinutes: lockedSnapshot ? 0 : labor.missingRateMinutes,
        actualLaborCostAmount,
        directCostAmount,
        writeOffAmount,
        sharedCostAmount,
        calculatedCostAmount,
        calculatedItems,
        costByCategory,
        totalCostAmount,
        otherCostAmount,
        enteredCostAmount,
        ...(lockedOtherCostAmount === undefined ? {} : { lockedOtherCostAmount }),
        grossMarginAmount,
        grossMarginPercent,
        locked: Boolean(lockedSnapshot),
        // For a locked month the three lists below are CURRENT data (hours, per-person cost,
        // entered lines): the snapshot does not keep them, so they may differ from the totals.
        laborByPerson: labor.people
          .map((person) => ({ ...person, displayName: displayNames.get(person.userId) ?? person.userId }))
          .sort((left, right) => right.approvedMinutes - left.approvedMinutes),
        costItems,
        latestSnapshot: lockedSnapshot ? mapPlSnapshot(lockedSnapshot, project.name) : undefined
      };
    });
  }

  /**
   * First half of locking a month: the live figures to freeze. Refuses while any
   * parameter or formula of the month fails, because the affected costs would be
   * frozen out of the totals. Reads only; nothing is written here.
   */
  async preparePeriodSnapshots(periodKey: string, principal: PrincipalContext): Promise<PeriodSnapshotPlan> {
    const period = parseReportBounds({ period: requirePeriodKey(periodKey) })!;
    const formulaErrors: string[] = [];
    const rows = await this.computeProjectPl({}, principal, period, false, formulaErrors);
    if (formulaErrors.length) {
      throw new ConflictException({ statusCode: 409, error: "Conflict", message: `Chưa chốt được kỳ ${periodKey}: còn ${formulaErrors.length} lỗi tham số hoặc công thức. Sửa ở Thiết lập P&L rồi chốt lại.`, formulaErrors });
    }
    return { period, rows };
  }

  /**
   * Second half: supersedes any earlier lock of the month and writes one LOCKED
   * snapshot per project. `db` is the caller's transaction so the snapshots and
   * the period status change together or not at all.
   */
  async writePeriodSnapshots(db: Prisma.TransactionClient, plan: PeriodSnapshotPlan, principal: PrincipalContext) {
    const { period, rows } = plan;
    const inclusiveEnd = new Date(period.end.getTime() - 1);
    await db.projectPlSnapshot.updateMany({ where: { workspaceId: principal.workspaceId, periodStart: period.start, status: "LOCKED" }, data: { status: "SUPERSEDED" } });
    if (rows.length) {
      await db.projectPlSnapshot.createMany({
        data: rows.map((row) => ({
          workspaceId: principal.workspaceId,
          accountId: row.accountId,
          projectId: row.projectId,
          periodStart: period.start,
          periodEnd: inclusiveEnd,
          currency: row.currency,
          revenueAmount: row.revenueAmount,
          budgetAmount: row.plannedRevenueAmount,
          plannedCostAmount: row.plannedCostAmount,
          actualLaborCostAmount: row.actualLaborCostAmount,
          directCostAmount: row.directCostAmount,
          writeOffAmount: row.writeOffAmount,
          totalCostAmount: row.totalCostAmount,
          grossMarginAmount: row.grossMarginAmount,
          grossMarginPercent: row.grossMarginPercent,
          status: "LOCKED" as const,
          createdByUserId: principal.subjectId
        }))
      });
    }
    return { projectCount: rows.length, missingRateMinutes: sum(rows.map((row) => row.missingRateMinutes)) };
  }

  /** Planned (budgeted) cost of a project, compared against actual cost in the P&L. */
  async setPlannedCost(projectId: string, input: { plannedCostAmount?: unknown; periodKey?: unknown }, principal: PrincipalContext) {
    assertCostEdit(principal);
    const plannedCostAmount = requireMoney(input?.plannedCostAmount, "plannedCostAmount", { allowZero: true });
    // Edited from a month's statement: a locked month shows the planned cost it was locked with, so it cannot be changed from there.
    if (input?.periodKey !== undefined && input.periodKey !== null) await this.assertPeriodOpen(principal.workspaceId, requirePeriodKey(input.periodKey));
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, select: { id: true, accountId: true, code: true } });
    if (!project) throw new NotFoundException("Project không thuộc workspace hiện tại.");
    const existing = await this.prisma.projectBudget.findFirst({ where: { workspaceId: principal.workspaceId, projectId }, orderBy: { updatedAt: "desc" } });
    const row = existing
      ? await this.prisma.projectBudget.update({ where: { id: existing.id }, data: { plannedCostAmount } })
      : await this.prisma.projectBudget.create({ data: { workspaceId: principal.workspaceId, accountId: project.accountId, projectId, code: `${project.code}-BUDGET`, currency: "VND", revenueBasis: "manual", plannedRevenueAmount: 0, plannedCostAmount, status: "DRAFT", createdByUserId: principal.subjectId } });
    await this.prisma.auditEvent.create({
      data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "pnl.planned_cost_changed", resource: "project_budget", resourceId: row.id, before: existing ? { plannedCostAmount: existing.plannedCostAmount.toString() } : undefined, after: { plannedCostAmount: String(plannedCostAmount) }, requestId: randomUUID() }
    });
    return { data: { projectId, plannedCostAmount }, meta: { persisted: true } };
  }

  /**
   * Everything users set up per month (P&L setup screen), ready for calculation:
   * the shared cost pool split across active projects, the parameters as numbers
   * and the calculated cost items. The system adds no rule of its own here.
   */
  private async loadMonthlySetup(workspaceId: string, period: ReportBounds | undefined) {
    const sharedByProject = new Map<string, Map<string, number>>();
    const setups = new Map<string, MonthSetup>();
    const errors: string[] = [];
    const configs = await this.prisma.pnlConfiguration.findMany({
      where: { workspaceId, ...(period ? { periodKey: { in: period.fullMonths } } : {}) },
      select: { periodKey: true, pool: true, items: true, parameters: true }
    });
    for (const config of configs) {
      const parameters = new Map<string, number>();
      for (const raw of Array.isArray(config.parameters) ? config.parameters as Array<Record<string, unknown>> : []) {
        const code = typeof raw?.code === "string" ? raw.code.trim().toUpperCase() : "";
        if (!code) continue;
        const value = parseParameterValue(raw.value);
        if (value === undefined) errors.push(`${config.periodKey} · tham số ${code} chưa có giá trị số`);
        else if ((SYSTEM_VARIABLES as readonly string[]).includes(code)) errors.push(`${config.periodKey} · tham số ${code} trùng tên biến hệ thống`);
        else parameters.set(code, value);
      }
      const items = (Array.isArray(config.items) ? config.items as Array<Record<string, unknown>> : []).flatMap((raw) => {
        // Only calculated cost items are evaluated; anything else stored in the setup is ignored.
        if (typeof raw?.formula !== "string" || typeof raw.code !== "string" || raw.active === false) return [];
        if (!(COST_CATEGORIES as readonly string[]).includes(String(raw.category))) return [];
        return [{ code: raw.code, label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : raw.code, category: raw.category as CostCategory, formula: raw.formula }];
      });
      setups.set(config.periodKey, { parameters, items });
    }
    const pools = configs.flatMap((config) => {
      const pool = (config.pool ?? {}) as { total?: unknown; criteria?: unknown };
      const total = typeof pool.total === "number" && Number.isFinite(pool.total) ? pool.total : 0;
      const criteria = typeof pool.criteria === "string" ? pool.criteria : POOL_BY_HOURS;
      return total > 0 && criteria !== POOL_MANUAL ? [{ periodKey: config.periodKey, total, criteria }] : [];
    });
    if (!pools.length) return { sharedByProject, setups, errors };
    const months = pools.map((pool) => pool.periodKey).sort();
    const [entries, budgets] = await Promise.all([
      this.prisma.taskTimeEntry.findMany({
        where: { workspaceId, projectId: { not: null }, workDate: { gte: reportMonthStart(months[0]), lt: reportMonthStart(nextMonthKey(months[months.length - 1])) } },
        select: { projectId: true, userId: true, minutes: true, approvalStatus: true, workDate: true }
      }),
      pools.some((pool) => pool.criteria === POOL_BY_REVENUE)
        ? this.prisma.projectBudget.findMany({ where: { workspaceId }, orderBy: { updatedAt: "asc" }, select: { projectId: true, plannedRevenueAmount: true } })
        : Promise.resolve([])
    ]);
    const revenueByProject = new Map(budgets.map((budget) => [budget.projectId, money(budget.plannedRevenueAmount)]));
    for (const pool of pools) {
      const minutes = new Map<string, number>();
      const people = new Map<string, Set<string>>();
      for (const entry of entries) {
        if (!entry.projectId || !isApprovedEntry(entry) || reportMonthKey(entry.workDate) !== pool.periodKey) continue;
        minutes.set(entry.projectId, (minutes.get(entry.projectId) ?? 0) + entry.minutes);
        people.set(entry.projectId, (people.get(entry.projectId) ?? new Set()).add(entry.userId));
      }
      const active = Array.from(minutes.keys());
      const weights = new Map(active.map((projectId) => [projectId,
        pool.criteria === POOL_BY_REVENUE ? revenueByProject.get(projectId) ?? 0
          : pool.criteria === POOL_BY_HEADCOUNT ? people.get(projectId)?.size ?? 0
            : pool.criteria === POOL_EVEN ? 1
              : minutes.get(projectId) ?? 0]));
      for (const [projectId, share] of allocatePool(pool.total, weights)) {
        const byMonth = sharedByProject.get(projectId) ?? new Map<string, number>();
        byMonth.set(pool.periodKey, (byMonth.get(pool.periodKey) ?? 0) + share);
        sharedByProject.set(projectId, byMonth);
      }
    }
    return { sharedByProject, setups, errors };
  }

  /**
   * Hourly cost rate for one month, with the labor cost it produces: every active member,
   * plus anyone with approved minutes in the month who is no longer active ("Đã nghỉ"),
   * so their hours can still be given a rate.
   */
  async listCostRates(query: any, principal: PrincipalContext): Promise<CostRatesResponse> {
    assertCostView(principal);
    const periodKey = requirePeriodKey(query.periodKey);
    const start = reportMonthStart(periodKey);
    const end = reportMonthStart(nextMonthKey(periodKey));
    const select = { id: true, displayName: true, email: true, avatarUrl: true, departmentCode: true, resourceProfile: { select: { displayRole: true } } } as const;
    const [activeUsers, entries, locked] = await Promise.all([
      this.prisma.user.findMany({
        where: { status: "ACTIVE", subjectType: "INTERNAL_USER", roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() } } },
        select,
        orderBy: { displayName: "asc" }
      }),
      this.prisma.taskTimeEntry.findMany({
        where: { workspaceId: principal.workspaceId, workDate: { gte: start, lt: end } },
        select: { userId: true, minutes: true, approvalStatus: true, workDate: true }
      }),
      this.isPeriodLocked(principal.workspaceId, periodKey)
    ]);
    const activeIds = new Set(activeUsers.map((user) => user.id));
    const departedIds = Array.from(new Set(entries.filter((entry) => isApprovedEntry(entry) && entry.minutes > 0 && !activeIds.has(entry.userId)).map((entry) => entry.userId)));
    const departedUsers = departedIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: departedIds } }, select, orderBy: { displayName: "asc" } })
      : [];
    const users = [...activeUsers.map((user) => ({ ...user, inactive: false })), ...departedUsers.map((user) => ({ ...user, inactive: true }))];
    const ratesByUser = await this.loadCostRates(users.map((user) => user.id), principal.workspaceId);
    const labor = new Map(summarizeLabor(entries, ratesByUser).people.map((person) => [person.userId, person]));
    // The rate "in force for the month" is the one applying on its last instant.
    const lastInstant = new Date(end.getTime() - 1);
    return {
      data: users.map((user) => {
        const rate = effectiveCostRate(ratesByUser.get(user.id) ?? [], lastInstant);
        const person = labor.get(user.id);
        return {
          userId: user.id,
          displayName: user.displayName || user.email,
          avatarUrl: user.avatarUrl ?? undefined,
          role: user.resourceProfile?.displayRole ?? user.departmentCode ?? undefined,
          hourlyCostRate: rate?.hourlyCostRate,
          rateFromPeriodKey: rate ? reportMonthKey(rate.effectiveFrom) : undefined,
          approvedMinutes: person?.approvedMinutes ?? 0,
          laborCostAmount: person?.laborCostAmount ?? 0,
          ...(user.inactive ? { inactive: true } : {})
        };
      }),
      // statementFrozen: the month's P&L uses its locked snapshot; the labor cost listed here is current data.
      meta: { periodKey, locked, canEdit: canEditCost(principal) && !locked, currency: "VND", statementFrozen: locked }
    };
  }

  async setCostRate(input: CostRateInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const periodKey = requirePeriodKey(input?.periodKey);
    const userId = optionalString(input?.userId);
    if (!userId) throw new BadRequestException("userId is required");
    const hourlyCostRate = input.hourlyCostRate === null ? null : requireMoney(input.hourlyCostRate, "hourlyCostRate", { allowZero: true });
    await this.assertPeriodOpen(principal.workspaceId, periodKey);
    // A departed member keeps no role binding; having logged time in the workspace is enough to carry a rate.
    const user = await this.prisma.user.findFirst({
      where: { id: userId, subjectType: "INTERNAL_USER", OR: [{ roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey } } }, { taskTimeEntries: { some: { workspaceId: principal.workspaceId } } }] },
      select: { id: true, resourceProfile: { select: { displayRole: true } } }
    });
    if (!user) throw new NotFoundException("Nhân sự không thuộc workspace hiện tại.");
    const effectiveFrom = reportMonthStart(periodKey);
    await this.assertRateChangeKeepsLockedMonths(principal.workspaceId, userId, periodKey);
    const existing = await this.prisma.costRateProfile.findFirst({ where: { userId, workspaceId: principal.workspaceId, effectiveFrom, active: true } });
    if (hourlyCostRate === null) {
      if (existing) await this.prisma.costRateProfile.delete({ where: { id: existing.id } });
    } else if (existing) {
      await this.prisma.costRateProfile.update({ where: { id: existing.id }, data: { hourlyCostRate, effectiveTo: null } });
    } else {
      await this.prisma.costRateProfile.create({ data: { workspaceId: principal.workspaceId, userId, role: user.resourceProfile?.displayRole ?? "member", currency: "VND", hourlyCostRate, effectiveFrom } });
    }
    await this.prisma.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId,
        actorUserId: principal.subjectId,
        action: "pnl.cost_rate_changed",
        resource: "cost_rate_profile",
        resourceId: userId,
        before: existing ? { periodKey, hourlyCostRate: existing.hourlyCostRate.toString() } : undefined,
        after: { periodKey, hourlyCostRate: hourlyCostRate === null ? null : String(hourlyCostRate) },
        requestId: randomUUID()
      }
    });
    return { data: { userId, periodKey, hourlyCostRate }, meta: { persisted: true } };
  }

  /**
   * A rate entered for month M also applies to every later month until the person's next
   * own rate. Refuses the change when one of those later months is locked: its frozen
   * figures were calculated with the rate being changed.
   */
  private async assertRateChangeKeepsLockedMonths(workspaceId: string, userId: string, periodKey: string) {
    const [lockedLater, nextOwnRate] = await Promise.all([
      this.prisma.pnlPeriod.findFirst({ where: { workspaceId, projectId: null, status: "LOCKED", periodKey: { gt: periodKey } }, orderBy: { periodKey: "asc" }, select: { periodKey: true } }),
      this.prisma.costRateProfile.findFirst({ where: { userId, workspaceId, active: true, effectiveFrom: { gt: reportMonthStart(periodKey) } }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } })
    ]);
    if (!lockedLater) return;
    // The earliest locked later month inherits the rate unless the person's own next rate starts in or before it.
    if (nextOwnRate && reportMonthKey(nextOwnRate.effectiveFrom) <= lockedLater.periodKey) return;
    throw new ConflictException(`Đơn giá của kỳ ${periodKey} đang được dùng tiếp cho kỳ ${lockedLater.periodKey} đã chốt. Mở lại kỳ ${lockedLater.periodKey} trước khi sửa đơn giá này.`);
  }

  async listProjectCosts(query: any, principal: PrincipalContext): Promise<ProjectCostItemsResponse> {
    assertCostView(principal);
    const period = parseReportBounds(query);
    const locked = period?.monthKey ? await this.isPeriodLocked(principal.workspaceId, period.monthKey) : false;
    const projectId = optionalString(query.projectId);
    const rows = await this.prisma.projectCost.findMany({
      where: {
        workspaceId: principal.workspaceId,
        costType: { not: "LABOR" },
        ...(projectId ? { projectId } : {}),
        ...(period ? { occurredAt: { gte: period.start, lt: period.end } } : {})
      },
      include: { project: { select: { name: true } } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 500
    });
    // Lines of a locked month cannot be added, changed or removed, so the screen must not offer it.
    return { data: rows.map((row) => mapCostItem(row, row.project.name)), meta: { canEdit: canEditCost(principal) && !locked, locked } };
  }

  async createProjectCost(input: ProjectCostItemInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const data = parseCostItemInput(input);
    const project = await this.prisma.project.findFirst({ where: { id: data.projectId, workspaceId: principal.workspaceId }, select: { id: true, accountId: true, name: true } });
    if (!project) throw new NotFoundException("Project không thuộc workspace hiện tại.");
    await this.assertPeriodOpen(principal.workspaceId, reportMonthKey(data.occurredAt));
    const row = await this.prisma.projectCost.create({
      data: { workspaceId: principal.workspaceId, accountId: project.accountId, projectId: project.id, costType: data.costType as never, category: data.category, label: data.label, amount: data.amount, occurredAt: data.occurredAt, note: data.note, createdByUserId: principal.subjectId }
    });
    await this.auditProjectCost(principal, "pnl.project_cost_created", row.id, undefined, row);
    return { data: mapCostItem(row, project.name), meta: { persisted: true } };
  }

  async updateProjectCost(costId: string, input: ProjectCostItemInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const existing = await this.findEditableCost(costId, principal);
    const data = parseCostItemInput({ ...input, projectId: existing.projectId });
    await this.assertPeriodOpen(principal.workspaceId, reportMonthKey(data.occurredAt));
    const row = await this.prisma.projectCost.update({ where: { id: existing.id }, data: { costType: data.costType as never, category: data.category, label: data.label, amount: data.amount, occurredAt: data.occurredAt, note: data.note ?? null } });
    await this.auditProjectCost(principal, "pnl.project_cost_changed", row.id, existing, row);
    return { data: mapCostItem(row, existing.project.name), meta: { persisted: true } };
  }

  async deleteProjectCost(costId: string, principal: PrincipalContext) {
    assertCostEdit(principal);
    const existing = await this.findEditableCost(costId, principal);
    await this.prisma.projectCost.delete({ where: { id: existing.id } });
    await this.auditProjectCost(principal, "pnl.project_cost_deleted", existing.id, existing, undefined);
    return { data: { id: existing.id }, meta: { deleted: true } };
  }

  private async findEditableCost(costId: string, principal: PrincipalContext) {
    const existing = await this.prisma.projectCost.findFirst({ where: { id: costId, workspaceId: principal.workspaceId }, include: { project: { select: { name: true } } } });
    if (!existing) throw new NotFoundException("Không tìm thấy khoản chi phí.");
    if (String(existing.costType) === "LABOR") throw new BadRequestException("Chi phí nhân sự được tính từ giờ đã duyệt × cost rate, không sửa trực tiếp.");
    await this.assertPeriodOpen(principal.workspaceId, reportMonthKey(existing.occurredAt));
    return existing;
  }

  private async auditProjectCost(principal: PrincipalContext, action: string, resourceId: string, before: { costType: unknown; label: string; amount: unknown; occurredAt: Date } | undefined, after: { costType: unknown; label: string; amount: unknown; occurredAt: Date } | undefined) {
    const snapshot = (row: { costType: unknown; label: string; amount: unknown; occurredAt: Date }) => ({ costType: String(row.costType), label: row.label, amount: String(row.amount), occurredAt: row.occurredAt.toISOString() });
    await this.prisma.auditEvent.create({
      data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource: "project_cost", resourceId, before: before ? snapshot(before) : undefined, after: after ? snapshot(after) : undefined, requestId: randomUUID() }
    });
  }

  /**
   * Rates of one workspace. Rows without a workspace are legacy data and only
   * apply to people who have no rate of their own in this workspace.
   */
  private async loadCostRates(userIds: string[], workspaceId: string) {
    const ratesByUser = new Map<string, CostRateRow[]>();
    if (!userIds.length) return ratesByUser;
    const rows = await this.prisma.costRateProfile.findMany({ where: { userId: { in: userIds }, active: true, OR: [{ workspaceId }, { workspaceId: null }] } });
    const scoped = new Set(rows.filter((row) => row.userId && row.workspaceId === workspaceId).map((row) => row.userId as string));
    for (const row of rows) {
      if (!row.userId || (scoped.has(row.userId) && row.workspaceId !== workspaceId)) continue;
      const list = ratesByUser.get(row.userId) ?? [];
      list.push({ userId: row.userId, hourlyCostRate: money(row.hourlyCostRate), effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo });
      ratesByUser.set(row.userId, list);
    }
    return ratesByUser;
  }

  async isPeriodLocked(workspaceId: string, periodKey: string) {
    const locked = await this.prisma.pnlPeriod.findFirst({ where: { workspaceId, projectId: null, periodKey, status: "LOCKED" }, select: { id: true } });
    return Boolean(locked);
  }

  /** A locked month is immutable: no rate or cost line dated in it can change. */
  async assertPeriodOpen(workspaceId: string, periodKey: string) {
    if (await this.isPeriodLocked(workspaceId, periodKey)) throw new ConflictException(`Kỳ ${periodKey} đã chốt; mở lại kỳ trước khi sửa chi phí.`);
  }
}

function requirePeriodKey(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new BadRequestException("periodKey must use YYYY-MM");
  return value;
}

function requireMoney(value: unknown, field: string, options: { allowZero: boolean }) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_MONEY_AMOUNT || (!options.allowZero && value === 0)) {
    throw new BadRequestException(`${field} phải là số ${options.allowZero ? "không âm" : "lớn hơn 0"}.`);
  }
  return roundMoney(value);
}

function parseCostItemInput(input: ProjectCostItemInput) {
  const projectId = optionalString(input?.projectId);
  if (!projectId) throw new BadRequestException("projectId is required");
  const costType = String(input.costType ?? "OTHER");
  if (!PROJECT_COST_ITEM_TYPES.has(costType)) throw new BadRequestException("Loại chi phí không hợp lệ.");
  if (!(COST_CATEGORIES as readonly string[]).includes(String(input.category))) throw new BadRequestException("Chọn nhóm chi phí hợp lệ.");
  const category = input.category as CostCategory;
  const label = optionalString(input.label);
  if (!label) throw new BadRequestException("Nội dung chi phí là bắt buộc.");
  if (label.length > 200) throw new BadRequestException("Nội dung chi phí tối đa 200 ký tự.");
  if (typeof input.occurredOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new BadRequestException("Ngày phát sinh phải có dạng YYYY-MM-DD.");
  const occurredAt = reportDayStart(input.occurredOn);
  if (Number.isNaN(occurredAt.getTime()) || reportDayKey(occurredAt) !== input.occurredOn) throw new BadRequestException("Ngày phát sinh không hợp lệ.");
  const note = optionalString(input.note);
  if (note && note.length > 1000) throw new BadRequestException("Ghi chú tối đa 1000 ký tự.");
  return { projectId, costType, category, label, amount: requireMoney(input.amount, "amount", { allowZero: false }), occurredAt, note };
}

function reportDayKey(date: Date) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mapCostItem(cost: { id: string; projectId: string; costType: unknown; category?: string | null; label: string; amount: unknown; currency: string; occurredAt: Date; note?: string | null }, projectName?: string): ProjectCostItem {
  return {
    id: cost.id,
    projectId: cost.projectId,
    projectName,
    costType: String(cost.costType) as ProjectCostItem["costType"],
    category: normalizeCostCategory(cost.category),
    label: cost.label,
    amount: money(cost.amount),
    currency: cost.currency,
    occurredOn: reportDayKey(cost.occurredAt),
    note: cost.note ?? undefined
  };
}

function mapAllocation(allocation: {
  id: string;
  accountId: string;
  account?: { name: string } | null;
  projectId?: string | null;
  project?: { name: string } | null;
  opportunityId?: string | null;
  userId: string;
  user?: { displayName: string } | null;
  role: string;
  skill?: string | null;
  status: string;
  allocationPercent: number;
  plannedMinutes: number;
  startAt: Date;
  endAt: Date;
  overbookApproved: boolean;
  approvedByUserId?: string | null;
  note?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ResourceAllocationSummary {
  return {
    id: allocation.id,
    accountId: allocation.accountId,
    accountName: allocation.account?.name,
    projectId: allocation.projectId ?? undefined,
    projectName: allocation.project?.name,
    opportunityId: allocation.opportunityId ?? undefined,
    userId: allocation.userId,
    userDisplayName: allocation.user?.displayName,
    role: allocation.role,
    skill: allocation.skill ?? undefined,
    status: toContractStatus(allocation.status),
    allocationPercent: allocation.allocationPercent,
    plannedMinutes: allocation.plannedMinutes,
    startAt: allocation.startAt.toISOString(),
    endAt: allocation.endAt.toISOString(),
    overbookApproved: allocation.overbookApproved,
    approvedByUserId: allocation.approvedByUserId ?? undefined,
    note: allocation.note ?? undefined,
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString()
  };
}

function mapPlSnapshot(
  snapshot: {
    id: string;
    accountId: string;
    projectId: string;
    periodStart: Date;
    periodEnd: Date;
    currency: string;
    revenueAmount: unknown;
    budgetAmount: unknown;
    plannedCostAmount: unknown;
    actualLaborCostAmount: unknown;
    directCostAmount: unknown;
    writeOffAmount: unknown;
    totalCostAmount: unknown;
    grossMarginAmount: unknown;
    grossMarginPercent?: unknown | null;
    status: string;
    createdAt: Date;
  },
  projectName: string
): ProjectPlSnapshotSummary {
  return {
    id: snapshot.id,
    accountId: snapshot.accountId,
    projectId: snapshot.projectId,
    projectName,
    periodStart: snapshot.periodStart.toISOString(),
    periodEnd: snapshot.periodEnd.toISOString(),
    currency: snapshot.currency,
    revenueAmount: money(snapshot.revenueAmount),
    budgetAmount: money(snapshot.budgetAmount),
    plannedCostAmount: money(snapshot.plannedCostAmount),
    actualLaborCostAmount: money(snapshot.actualLaborCostAmount),
    directCostAmount: money(snapshot.directCostAmount),
    writeOffAmount: money(snapshot.writeOffAmount),
    totalCostAmount: money(snapshot.totalCostAmount),
    grossMarginAmount: money(snapshot.grossMarginAmount),
    grossMarginPercent: snapshot.grossMarginPercent === null || snapshot.grossMarginPercent === undefined
      ? undefined
      : money(snapshot.grossMarginPercent),
    status: snapshot.status.toLowerCase() as ProjectPlSnapshotSummary["status"],
    createdAt: snapshot.createdAt.toISOString()
  };
}

function toAllocationStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (!["REQUESTED", "TENTATIVE", "RESERVED", "CONFIRMED", "RELEASED", "CANCELLED"].includes(normalized)) {
    throw new BadRequestException("Unsupported allocation status");
  }
  return normalized as never;
}

function toContractStatus(status: string) {
  return status.toLowerCase() as ResourceAllocationSummary["status"];
}

function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function nonEmptyString(value: unknown, field: string) {
  const trimmed = optionalString(value);
  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }
  return trimmed;
}

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException("Expected integer value");
  }
  return parsed;
}

function parseRequiredDate(value: unknown, field: string) {
  const parsed = parseDate(value);
  if (!parsed) {
    throw new BadRequestException(`${field} is required`);
  }
  return parsed;
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parsePeriodBounds(value: unknown): ReportBounds | undefined {
  const key = optionalString(value);
  if (!key) return undefined;
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new BadRequestException("period must use YYYY-MM format");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new BadRequestException("period must use a valid month");
  if (!Number.isInteger(year)) throw new BadRequestException("period must use YYYY-MM format");
  return { key, start: reportMonthStart(key), end: reportMonthStart(nextMonthKey(key)), monthKey: key, fullMonths: [key], partial: false };
}

function parseReportBounds(query: { period?: unknown; startDate?: unknown; endDate?: unknown }): ReportBounds | undefined {
  const startKey = optionalString(query.startDate);
  const endKey = optionalString(query.endDate);
  if (!startKey && !endKey) return parsePeriodBounds(query.period);
  if (!startKey || !endKey || !/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
    throw new BadRequestException("startDate and endDate must use YYYY-MM-DD format");
  }
  // Day boundaries follow the reporting timezone, the same one the UI month uses.
  const start = reportDayStart(startKey);
  const inclusiveEnd = reportDayStart(endKey);
  if (Number.isNaN(start.getTime()) || Number.isNaN(inclusiveEnd.getTime()) || start > inclusiveEnd) {
    throw new BadRequestException("startDate must be before or equal to endDate");
  }
  const end = new Date(inclusiveEnd);
  end.setUTCDate(end.getUTCDate() + 1);
  // The UI sends explicit dates even for a whole month; recognise it so month locks apply.
  const monthKey = startKey.slice(0, 7);
  const isWholeMonth = startKey.endsWith("-01") && end.getTime() === reportMonthStart(nextMonthKey(monthKey)).getTime();
  const fullMonths = monthKeysBetween(monthKey, reportMonthKey(inclusiveEnd)).filter((key) => reportMonthStart(key).getTime() >= start.getTime() && reportMonthStart(nextMonthKey(key)).getTime() <= end.getTime());
  const partial = !startKey.endsWith("-01") || end.getTime() !== reportMonthStart(reportMonthKey(end)).getTime();
  return { key: `${startKey}:${endKey}`, start, end, fullMonths, partial, ...(isWholeMonth ? { monthKey } : {}) };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(next, delta);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function money(value: unknown) {
  if (value === undefined || value === null) {
    return 0;
  }
  return Number(value);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
