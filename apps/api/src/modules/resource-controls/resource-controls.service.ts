import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CapacitySummaryItem,
  CapacitySummaryResponse,
  CreateResourceAllocationInput,
  PrincipalContext,
  ProjectPlSnapshotSummary,
  ProjectPlSummaryResponse,
  ResourceAllocationSummary
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";

const DEFAULT_WEEKLY_CAPACITY_MINUTES = 2400;

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
      const allocatedMinutes = allocations.reduce((total, allocation) => total + allocation.plannedMinutes, 0);

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
    if (!principal.roleCodes.some((role) => ["FOUNDER_GM", "WORKSPACE_ADMIN", "FINANCE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"].includes(role))) {
      throw new ForbiddenException("Financial P&L access is restricted to workspace finance roles");
    }
    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: principal.workspaceId,
        ...(optionalString(query.accountId) ? { accountId: optionalString(query.accountId) } : {}),
        ...(optionalString(query.projectId) ? { id: optionalString(query.projectId) } : {})
      },
      include: {
        account: true,
        budgets: { orderBy: { updatedAt: "desc" }, take: 1 },
        costs: true,
        paymentMilestones: true,
        paymentSchedules: true,
        plSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        tasks: {
          include: {
            timeEntries: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });

    const data = projects.map((project) => {
      const latestBudget = project.budgets[0];
      const latestSnapshot = project.plSnapshots[0];
      const scheduleRevenue = sum(project.paymentSchedules.map((schedule) => money(schedule.totalAmount)));
      const milestoneRevenue = sum(project.paymentMilestones.map((milestone) => money(milestone.amount)));
      const paidRevenueAmount = sum(
        project.paymentMilestones
          .filter((milestone) => String(milestone.paymentStatus) === "PAID")
          .map((milestone) => money(milestone.amount))
      );
      const plannedRevenueAmount =
        money(latestBudget?.plannedRevenueAmount) || money(latestSnapshot?.revenueAmount) || milestoneRevenue || scheduleRevenue;
      const plannedCostAmount = money(latestBudget?.plannedCostAmount) || money(latestSnapshot?.plannedCostAmount);
      const approvedLaborMinutes = sum(
        project.tasks.flatMap((task) =>
          task.timeEntries
            .filter((entry) => String(entry.approvalStatus ?? "").toLowerCase() === "approved" && String(entry.pnlStatus ?? "included").toLowerCase() === "included")
            .map((entry) => entry.regularMinutes || Math.min(entry.minutes, 480))
        )
      );
      const actualLaborCostAmount =
        sum(project.costs.filter((cost) => String(cost.costType) === "LABOR").map((cost) => money(cost.amount))) ||
        money(latestSnapshot?.actualLaborCostAmount);
      const directCostAmount = sum(
        project.costs
          .filter((cost) => !["LABOR", "WRITE_OFF"].includes(String(cost.costType)))
          .map((cost) => money(cost.amount))
      ) || money(latestSnapshot?.directCostAmount);
      const writeOffAmount =
        sum(project.costs.filter((cost) => String(cost.costType) === "WRITE_OFF").map((cost) => money(cost.amount))) ||
        money(latestSnapshot?.writeOffAmount);
      const totalCostAmount =
        actualLaborCostAmount + directCostAmount + writeOffAmount || money(latestSnapshot?.totalCostAmount);
      const revenueBasis = paidRevenueAmount || plannedRevenueAmount;
      const grossMarginAmount = revenueBasis - totalCostAmount;
      const grossMarginPercent = revenueBasis > 0 ? round((grossMarginAmount / revenueBasis) * 100, 2) : undefined;

      return {
        accountId: project.accountId,
        accountName: project.account.name,
        projectId: project.id,
        projectName: project.name,
        currency: latestBudget?.currency ?? latestSnapshot?.currency ?? "VND",
        plannedRevenueAmount,
        paidRevenueAmount,
        plannedCostAmount,
        approvedLaborMinutes,
        actualLaborCostAmount,
        directCostAmount,
        writeOffAmount,
        totalCostAmount,
        grossMarginAmount,
        grossMarginPercent,
        latestSnapshot: latestSnapshot ? mapPlSnapshot(latestSnapshot, project.name) : undefined
      };
    });

    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        policy: "workspace_finance",
        principal: principal.displayName,
        rowScope: "workspace",
        source: "postgresql"
      }
    };
  }
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
