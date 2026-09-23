import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  OvertimePlanInput,
  PnlPeriodInput,
  PrincipalContext,
  ReopenPnlPeriodInput,
  ResourceMonthlyCostInput,
  ReviewTimelineChangeInput,
  SubmitTaskPlanInput,
  TimelineChangeRequestInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";

const TASK_LAYER1 = new Set(["PRE_SALE", "DELIVERY", "PM"]);
const TASK_LAYER2 = new Set(["CUSTOMER_PROJECT", "INTERNAL_PROJECT", "TICKET_MAINTENANCE", "DAY_OFF_COMPANY"]);
const MANAGER_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"]);

function isoDate(value: unknown, field: string, dateOnly = false) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required`);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} is invalid`);
  return parsed;
}

function dateKey(value: Date) { return value.toISOString().slice(0, 10); }
function money(value: number | undefined) { return new Prisma.Decimal(typeof value === "number" && Number.isFinite(value) ? value : 0); }
function isManager(principal: PrincipalContext) { return principal.roleCodes.some((role) => MANAGER_ROLES.has(role)); }

@Injectable()
export class BrdGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(principal: PrincipalContext) {
    if (!isManager(principal)) throw new ForbiddenException("PM, BD Lead, Dx Director or Founder/GM role is required");
  }

  private async taskForWorkspace(taskId: string, principal: PrincipalContext) {
    const task = await this.prisma.projectTask.findFirst({ where: { id: taskId, workspaceId: principal.workspaceId } });
    if (!task) throw new NotFoundException("Task not found in workspace");
    return task;
  }

  async submitTaskPlan(taskId: string, input: SubmitTaskPlanInput, principal: PrincipalContext) {
    const task = await this.taskForWorkspace(taskId, principal);
    if (task.planApprovalStatus === "APPROVED") throw new ConflictException("Approved plan is locked; create a timeline change request");
    if (!TASK_LAYER1.has(input.taskTypeLayer1) || !TASK_LAYER2.has(input.taskTypeLayer2)) throw new BadRequestException("A valid two-layer task type is required");
    const estimate = input.estimateMinutes ?? task.estimateMinutes;
    if (!Number.isInteger(estimate) || estimate < 0) throw new BadRequestException("estimateMinutes must be a non-negative integer");
    const plannedStartAt = input.plannedStartAt ? isoDate(input.plannedStartAt, "plannedStartAt") : null;
    const dueAt = input.dueAt ? isoDate(input.dueAt, "dueAt") : null;
    if (plannedStartAt && dueAt && dueAt < plannedStartAt) throw new BadRequestException("dueAt must be on or after plannedStartAt");
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.projectTask.update({ where: { id: taskId }, data: {
        plannedStartAt, dueAt, estimateMinutes: estimate, taskTypeLayer1: input.taskTypeLayer1, taskTypeLayer2: input.taskTypeLayer2,
        planApprovalStatus: "SUBMITTED", planSubmittedAt: new Date()
      } });
      const previousHistory = await tx.taskPlanHistory.findFirst({ where: { taskId }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.taskPlanHistory.create({ data: {
        workspaceId: principal.workspaceId, projectId: task.projectId, taskId, version: (previousHistory?.version ?? 0) + 1,
        action: "SUBMITTED", before: { plannedStartAt: task.plannedStartAt, dueAt: task.dueAt, estimateMinutes: task.estimateMinutes, taskTypeLayer1: task.taskTypeLayer1, taskTypeLayer2: task.taskTypeLayer2 },
        after: { plannedStartAt, dueAt, estimateMinutes: estimate, taskTypeLayer1: input.taskTypeLayer1, taskTypeLayer2: input.taskTypeLayer2 }, changedByUserId: principal.subjectId
      } });
      return { data: next, meta: { approvalStatus: "SUBMITTED", timelineLocked: false } };
    });
  }

  async approveTaskPlan(taskId: string, principal: PrincipalContext) {
    this.assertManager(principal);
    const task = await this.taskForWorkspace(taskId, principal);
    if (!["SUBMITTED", "CHANGE_REQUESTED"].includes(task.planApprovalStatus)) throw new ConflictException("Task plan must be submitted before approval");
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.projectTask.update({ where: { id: taskId }, data: {
        planApprovalStatus: "APPROVED", planApprovedAt: new Date(), planApprovedByUserId: principal.subjectId,
        baselineStartAt: task.plannedStartAt, baselineEndAt: task.dueAt, baselineEstimateMinutes: task.estimateMinutes
      } });
      await tx.taskPlanningBlock.updateMany({ where: { taskId, workspaceId: principal.workspaceId }, data: { approvalStatus: "APPROVED", lockedAt: new Date(), lockedByUserId: principal.subjectId } });
      const previousHistory = await tx.taskPlanHistory.findFirst({ where: { taskId }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.taskPlanHistory.create({ data: { workspaceId: principal.workspaceId, projectId: task.projectId, taskId, version: (previousHistory?.version ?? 0) + 1, action: "APPROVED", before: { planApprovalStatus: task.planApprovalStatus }, after: { planApprovalStatus: "APPROVED", baselineStartAt: task.plannedStartAt, baselineEndAt: task.dueAt, baselineEstimateMinutes: task.estimateMinutes }, changedByUserId: principal.subjectId, approvedByUserId: principal.subjectId } });
      return { data: next, meta: { approvalStatus: "APPROVED", timelineLocked: true } };
    });
  }

  async requestTimelineChange(taskId: string, input: TimelineChangeRequestInput, principal: PrincipalContext) {
    const task = await this.taskForWorkspace(taskId, principal);
    if (task.planApprovalStatus !== "APPROVED") throw new ConflictException("Timeline change requests are only needed after PM approval");
    if (typeof input.reason !== "string" || input.reason.trim().length < 3) throw new BadRequestException("reason is required");
    const proposedStartAt = input.proposedStartAt ? isoDate(input.proposedStartAt, "proposedStartAt") : null;
    const proposedEndAt = input.proposedEndAt ? isoDate(input.proposedEndAt, "proposedEndAt") : null;
    if (proposedStartAt && proposedEndAt && proposedEndAt < proposedStartAt) throw new BadRequestException("proposedEndAt must be on or after proposedStartAt");
    const request = await this.prisma.taskTimelineChangeRequest.create({ data: { workspaceId: principal.workspaceId, projectId: task.projectId, taskId, requestedByUserId: principal.subjectId, proposedStartAt, proposedEndAt, proposedEstimateMinutes: input.proposedEstimateMinutes, reason: input.reason.trim() } });
    return { data: request, meta: { status: "PENDING", timelineLocked: true } };
  }

  async reviewTimelineChange(requestId: string, input: ReviewTimelineChangeInput, principal: PrincipalContext) {
    this.assertManager(principal);
    if (!input || !["APPROVED", "REJECTED"].includes(input.decision)) throw new BadRequestException("decision must be APPROVED or REJECTED");
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.taskTimelineChangeRequest.findFirst({ where: { id: requestId, workspaceId: principal.workspaceId } });
      if (!request) throw new NotFoundException("Timeline change request not found");
      if (request.status !== "PENDING") throw new ConflictException("Timeline change request has already been reviewed");
      const task = await tx.projectTask.findUnique({ where: { id: request.taskId } });
      if (!task) throw new NotFoundException("Task not found");
      const now = new Date();
      if (input.decision === "REJECTED") {
        const rejected = await tx.taskTimelineChangeRequest.update({ where: { id: requestId }, data: { status: "REJECTED", reviewedByUserId: principal.subjectId, reviewedAt: now, reviewNote: input.reviewNote?.trim() } });
        return { data: rejected, meta: { timelineLocked: true } };
      }
      const next = await tx.projectTask.update({ where: { id: task.id }, data: {
        plannedStartAt: request.proposedStartAt, dueAt: request.proposedEndAt, estimateMinutes: request.proposedEstimateMinutes ?? task.estimateMinutes,
        baselineStartAt: request.proposedStartAt, baselineEndAt: request.proposedEndAt, baselineEstimateMinutes: request.proposedEstimateMinutes ?? task.estimateMinutes,
        planApprovalStatus: "APPROVED", planApprovedAt: now, planApprovedByUserId: principal.subjectId
      } });
      const approved = await tx.taskTimelineChangeRequest.update({ where: { id: requestId }, data: { status: "APPROVED", reviewedByUserId: principal.subjectId, reviewedAt: now, reviewNote: input.reviewNote?.trim() } });
      const previousHistory = await tx.taskPlanHistory.findFirst({ where: { taskId: task.id }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.taskPlanHistory.create({ data: { workspaceId: principal.workspaceId, projectId: task.projectId, taskId: task.id, version: (previousHistory?.version ?? 0) + 1, action: "TIMELINE_CHANGE_APPROVED", reason: request.reason, before: { plannedStartAt: task.plannedStartAt, dueAt: task.dueAt, estimateMinutes: task.estimateMinutes }, after: { plannedStartAt: request.proposedStartAt, dueAt: request.proposedEndAt, estimateMinutes: request.proposedEstimateMinutes ?? task.estimateMinutes }, changedByUserId: request.requestedByUserId, approvedByUserId: principal.subjectId } });
      return { data: approved, task: next, meta: { timelineLocked: true } };
    });
  }

  async createOvertimePlan(input: OvertimePlanInput, principal: PrincipalContext) {
    const userId = input.userId ?? principal.subjectId;
    if (userId !== principal.subjectId && !isManager(principal)) throw new ForbiddenException("Only managers can create an OT plan for another employee");
    if (!Number.isInteger(input.plannedMinutes) || input.plannedMinutes <= 0) throw new BadRequestException("plannedMinutes must be greater than zero");
    const workDate = isoDate(input.workDate, "workDate", true);
    const row = await this.prisma.overtimePlan.create({ data: { workspaceId: principal.workspaceId, projectId: input.projectId, userId, workDate, plannedMinutes: input.plannedMinutes, reason: input.reason.trim(), requestedByUserId: principal.subjectId } });
    return { data: row, meta: { approvalStatus: "PENDING", includedInPnl: false } };
  }

  async reviewOvertimePlan(planId: string, input: { decision: "APPROVED" | "REJECTED"; note?: string }, principal: PrincipalContext) {
    this.assertManager(principal);
    if (!input || !["APPROVED", "REJECTED"].includes(input.decision)) throw new BadRequestException("decision must be APPROVED or REJECTED");
    const plan = await this.prisma.overtimePlan.findFirst({ where: { id: planId, workspaceId: principal.workspaceId } });
    if (!plan) throw new NotFoundException("Overtime plan not found");
    return this.prisma.overtimePlan.update({ where: { id: planId }, data: { approvalStatus: input.decision, approvedByUserId: principal.subjectId, approvedAt: new Date(), reviewNote: input.note?.trim() } });
  }

  async upsertMonthlyCost(input: ResourceMonthlyCostInput, principal: PrincipalContext) {
    this.assertManager(principal);
    const start = isoDate(input.periodStart, "periodStart", true); const end = isoDate(input.periodEnd, "periodEnd", true);
    if (end < start) throw new BadRequestException("periodEnd must be on or after periodStart");
    const total = input.totalMonthlyIncome ?? [input.p1BaseAmount, input.p2AllowanceAmount, input.p3PerformanceAmount, input.p4OtherVariableAmount].reduce<number>((a, b) => a + (b ?? 0), 0);
    const existing = await this.prisma.resourceMonthlyCost.findUnique({ where: { workspaceId_userId_periodKey: { workspaceId: principal.workspaceId, userId: input.userId, periodKey: input.periodKey } } });
    if (existing?.status === "LOCKED") throw new ConflictException("A locked payroll period cannot be edited");
    const row = await this.prisma.resourceMonthlyCost.upsert({ where: { workspaceId_userId_periodKey: { workspaceId: principal.workspaceId, userId: input.userId, periodKey: input.periodKey } }, create: { workspaceId: principal.workspaceId, userId: input.userId, periodStart: start, periodEnd: end, periodKey: input.periodKey, currency: input.currency ?? "VND", p1BaseAmount: money(input.p1BaseAmount), p2AllowanceAmount: money(input.p2AllowanceAmount), p3PerformanceAmount: money(input.p3PerformanceAmount), p4OtherVariableAmount: money(input.p4OtherVariableAmount), overtimeAmount: money(input.overtimeAmount), socialInsuranceAmount: money(input.socialInsuranceAmount), pitAmount: money(input.pitAmount), otherAmount: money(input.otherAmount), totalMonthlyIncome: money(total), hourlyCostRate: input.hourlyCostRate === undefined ? undefined : money(input.hourlyCostRate) }, update: { periodStart: start, periodEnd: end, currency: input.currency ?? "VND", p1BaseAmount: money(input.p1BaseAmount), p2AllowanceAmount: money(input.p2AllowanceAmount), p3PerformanceAmount: money(input.p3PerformanceAmount), p4OtherVariableAmount: money(input.p4OtherVariableAmount), overtimeAmount: money(input.overtimeAmount), socialInsuranceAmount: money(input.socialInsuranceAmount), pitAmount: money(input.pitAmount), otherAmount: money(input.otherAmount), totalMonthlyIncome: money(total), hourlyCostRate: input.hourlyCostRate === undefined ? undefined : money(input.hourlyCostRate), status: "DRAFT" } });
    return { data: row, meta: { source: "manual", locked: false } };
  }

  async upsertPnlPeriod(input: PnlPeriodInput, principal: PrincipalContext) {
    this.assertManager(principal);
    const start = isoDate(input.periodStart, "periodStart", true); const end = isoDate(input.periodEnd, "periodEnd", true);
    const existing = await this.prisma.pnlPeriod.findFirst({ where: { workspaceId: principal.workspaceId, projectId: input.projectId ?? null, periodKey: input.periodKey } });
    if (existing?.status === "LOCKED") throw new ConflictException("Locked P&L period cannot be edited");
    const row = existing
      ? await this.prisma.pnlPeriod.update({ where: { id: existing.id }, data: { periodStart: start, periodEnd: end, currency: input.currency ?? "VND", revenueAmount: money(input.revenueAmount), status: "OPEN" } })
      : await this.prisma.pnlPeriod.create({ data: { workspaceId: principal.workspaceId, projectId: input.projectId, periodStart: start, periodEnd: end, periodKey: input.periodKey, currency: input.currency ?? "VND", revenueAmount: money(input.revenueAmount) } });
    return { data: row, meta: { status: row.status, advisory: row.status !== "LOCKED" } };
  }

  async lockPnlPeriod(periodId: string, principal: PrincipalContext) {
    this.assertManager(principal);
    const period = await this.prisma.pnlPeriod.findFirst({ where: { id: periodId, workspaceId: principal.workspaceId } });
    if (!period) throw new NotFoundException("P&L period not found");
    const row = await this.prisma.pnlPeriod.update({ where: { id: periodId }, data: { status: "LOCKED", lockedAt: new Date(), lockedByUserId: principal.subjectId } });
    return { data: row, meta: { locked: true, immutable: true } };
  }

  async reopenPnlPeriod(periodId: string, input: ReopenPnlPeriodInput, principal: PrincipalContext) {
    this.assertManager(principal);
    if (!input.reason?.trim()) throw new BadRequestException("reason is required to reopen a P&L period");
    const period = await this.prisma.pnlPeriod.findFirst({ where: { id: periodId, workspaceId: principal.workspaceId } });
    if (!period) throw new NotFoundException("P&L period not found");
    const row = await this.prisma.pnlPeriod.update({ where: { id: periodId }, data: { status: "REOPENED", reopenedAt: new Date(), reopenedByUserId: principal.subjectId, reopenReason: input.reason.trim() } });
    return { data: row, meta: { locked: false, auditReason: input.reason.trim() } };
  }

  async rebuildPnlAllocations(periodId: string, principal: PrincipalContext) {
    this.assertManager(principal);
    const period = await this.prisma.pnlPeriod.findFirst({ where: { id: periodId, workspaceId: principal.workspaceId } });
    if (!period) throw new NotFoundException("P&L period not found");
    if (period.status === "LOCKED") throw new ConflictException("Locked P&L period cannot be rebuilt");
    const entries = await this.prisma.taskTimeEntry.findMany({ where: { workspaceId: principal.workspaceId, projectId: period.projectId ?? undefined, workDate: { gte: period.periodStart, lte: period.periodEnd } }, include: { task: true, dayOff: true, overtimePlan: true } });
    let included = 0; let excluded = 0; let pending = 0;
    for (const entry of entries) {
      const standardMinutes = entry.regularMinutes || Math.min(entry.minutes, 480);
      const overtimeMinutes = entry.overtimeMinutes || Math.max(0, entry.minutes - 480);
      let status = "INCLUDED"; let reason: string | null = null;
      if (entry.dayOffId || entry.dayOff?.isActive || entry.task.taskTypeLayer2 === "DAY_OFF_COMPANY" || entry.task.taskTypeLayer2 === "INTERNAL_PROJECT") { status = "EXCLUDED"; reason = "day_off_or_internal"; }
      else if (entry.approvalStatus.toLowerCase() !== "approved" || !entry.task.taskTypeLayer1 || !entry.task.taskTypeLayer2) { status = "PENDING"; reason = "missing_approval_or_task_type"; }
      else if (overtimeMinutes > 0 && entry.overtimeApprovalStatus !== "approved" && entry.overtimePlan?.approvalStatus !== "APPROVED") { status = "PENDING"; reason = "overtime_not_preapproved"; }
      if (status === "INCLUDED") included += entry.minutes; else if (status === "EXCLUDED") excluded += entry.minutes; else pending += entry.minutes;
      await this.prisma.$transaction([
        this.prisma.taskTimeEntry.update({ where: { id: entry.id }, data: { regularMinutes: standardMinutes, overtimeMinutes, pnlStatus: status.toLowerCase(), pnlReason: reason } }),
        this.prisma.pnlTimeEntryAllocation.upsert({ where: { timeEntryId: entry.id }, create: { workspaceId: principal.workspaceId, periodId: period.id, timeEntryId: entry.id, status, reason, standardMinutes, overtimeMinutes, classifiedAt: new Date(), classifiedByUserId: principal.subjectId }, update: { periodId: period.id, status, reason, standardMinutes, overtimeMinutes, classifiedAt: new Date(), classifiedByUserId: principal.subjectId } })
      ]);
    }
    return { data: { includedMinutes: included, excludedMinutes: excluded, pendingMinutes: pending, loggedMinutes: included + excluded + pending }, meta: { periodId, source: "task_time_entries" } };
  }

  async pnlReconciliation(periodId: string, principal: PrincipalContext) {
    const period = await this.prisma.pnlPeriod.findFirst({ where: { id: periodId, workspaceId: principal.workspaceId }, include: { allocations: true } });
    if (!period) throw new NotFoundException("P&L period not found");
    const totals = period.allocations.reduce((acc, row) => { acc.logged += row.standardMinutes + row.overtimeMinutes; if (row.status === "INCLUDED") acc.included += row.standardMinutes + row.overtimeMinutes; else if (row.status === "EXCLUDED") acc.excluded += row.standardMinutes + row.overtimeMinutes; else acc.pending += row.standardMinutes + row.overtimeMinutes; return acc; }, { logged: 0, included: 0, excluded: 0, pending: 0 });
    return { data: { periodId, periodKey: period.periodKey, ...totals, reconciles: totals.included + totals.excluded + totals.pending === totals.logged, formula: "included + excluded + pending = logwork" }, meta: { status: period.status, source: "pnl_time_entry_allocations" } };
  }
}
