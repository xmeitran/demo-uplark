import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  OvertimePlanInput,
  PnlPeriodInput,
  PrincipalContext,
  ReopenPnlPeriodInput,
  ReviewTimelineChangeInput,
  SubmitTaskPlanInput,
  TimelineChangeRequestInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { assertCostApprove, assertCostEdit, assertCostView } from "../resource-controls/cost-permissions";
import { ResourceControlsService } from "../resource-controls/resource-controls.service";

const TASK_LAYER1 = new Set(["PRE_SALE", "DELIVERY", "PM"]);
const TASK_LAYER2 = new Set(["CUSTOMER_PROJECT", "INTERNAL_PROJECT", "TICKET_MAINTENANCE", "DAY_OFF_COMPANY"]);
const MANAGER_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "FINANCE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"]);

function isoDate(value: unknown, field: string, dateOnly = false) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required`);
  if (dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} is invalid`);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} is invalid`);
  if (dateOnly && dateKey(parsed) !== value) throw new BadRequestException(`${field} is invalid`);
  return parsed;
}

function dateKey(value: Date) { return value.toISOString().slice(0, 10); }
const MAX_REVENUE_AMOUNT = 1e13;
/** A revenue figure must be an explicit number: a missing or malformed value is rejected, never stored as 0. */
function requireRevenue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_REVENUE_AMOUNT) {
    throw new BadRequestException("revenueAmount phải là số từ 0 đến 10.000.000.000.000 (nhập 0 nếu tháng này không ghi nhận doanh thu).");
  }
  return new Prisma.Decimal(value);
}
/** First and last calendar day (YYYY-MM-DD) of a YYYY-MM month. */
function monthDays(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  return { first: `${periodKey}-01`, last: `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}` };
}
function firstValue(value: unknown) { return Array.isArray(value) ? value[0] : value; }
function isManager(principal: PrincipalContext) { return principal.roleCodes.some((role) => MANAGER_ROLES.has(role)); }
function validatePeriodKey(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new BadRequestException("periodKey must use YYYY-MM");
  return value;
}

@Injectable()
export class BrdGovernanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ResourceControlsService) private readonly resourceControls: ResourceControlsService
  ) {}

  /** Once a month is locked nothing that feeds its P&L may change until it is reopened. */
  private async assertMonthOpen(workspaceId: string, periodKey: string) {
    const locked = await this.prisma.pnlPeriod.findFirst({ where: { workspaceId, projectId: null, periodKey, status: "LOCKED" }, select: { id: true } });
    if (locked) throw new ConflictException(`Kỳ ${periodKey} đã chốt; mở lại kỳ trước khi sửa.`);
  }

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

  async getPnlConfiguration(periodKey: string, principal: PrincipalContext) {
    assertCostView(principal);
    validatePeriodKey(periodKey);
    const row = await this.prisma.pnlConfiguration.findUnique({ where: { workspaceId_periodKey: { workspaceId: principal.workspaceId, periodKey } } });
    return { data: row, meta: { periodKey, source: row ? "database" : "defaults" } };
  }

  async getPnlPeriod(periodKey: string, principal: PrincipalContext, projectId?: string) {
    assertCostView(principal);
    validatePeriodKey(periodKey);
    const row = await this.prisma.pnlPeriod.findFirst({
      where: { workspaceId: principal.workspaceId, periodKey, projectId: projectId || null },
      orderBy: { updatedAt: "desc" }
    });
    return { data: row, meta: { periodKey, source: row ? "database" : "not_created" } };
  }

  async upsertPnlConfiguration(input: { periodKey: string; items: unknown; parameters: unknown; pool: unknown; templates: unknown }, principal: PrincipalContext) {
    assertCostEdit(principal);
    const periodKey = validatePeriodKey(input?.periodKey);
    if (!Array.isArray(input.items) || !Array.isArray(input.parameters) || !Array.isArray(input.templates) || !input.pool || typeof input.pool !== "object") {
      throw new BadRequestException("items, parameters, pool and templates must be valid configuration values");
    }
    await this.assertMonthOpen(principal.workspaceId, periodKey);
    const row = await this.prisma.pnlConfiguration.upsert({ where: { workspaceId_periodKey: { workspaceId: principal.workspaceId, periodKey } }, create: { workspaceId: principal.workspaceId, periodKey, items: input.items as Prisma.InputJsonValue, parameters: input.parameters as Prisma.InputJsonValue, pool: input.pool as Prisma.InputJsonValue, templates: input.templates as Prisma.InputJsonValue, updatedByUserId: principal.subjectId }, update: { items: input.items as Prisma.InputJsonValue, parameters: input.parameters as Prisma.InputJsonValue, pool: input.pool as Prisma.InputJsonValue, templates: input.templates as Prisma.InputJsonValue, updatedByUserId: principal.subjectId } });
    await this.prisma.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "pnl.configuration_changed", resource: "pnl_configuration", resourceId: row.id, after: { periodKey: row.periodKey, updatedByUserId: principal.subjectId }, requestId: randomUUID() } });
    return { data: row, meta: { persisted: true } };
  }

  async upsertPnlPeriod(input: PnlPeriodInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const periodKey = validatePeriodKey(input?.periodKey);
    const days = monthDays(periodKey);
    if (input.periodStart !== days.first || input.periodEnd !== days.last) throw new BadRequestException(`periodStart và periodEnd phải là ngày đầu và ngày cuối của kỳ ${periodKey} (${days.first} → ${days.last}).`);
    const start = isoDate(input.periodStart, "periodStart", true); const end = isoDate(input.periodEnd, "periodEnd", true);
    // A project's row IS its entered revenue for the month, so the amount is mandatory there.
    // The workspace row (no project) only carries the month's open/locked status.
    const revenueAmount = input.projectId || input.revenueAmount !== undefined ? requireRevenue(input.revenueAmount) : new Prisma.Decimal(0);
    if (input.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: input.projectId, workspaceId: principal.workspaceId }, select: { id: true } });
      if (!project) throw new BadRequestException("Project không thuộc workspace hiện tại.");
    }
    const existing = await this.prisma.pnlPeriod.findFirst({ where: { workspaceId: principal.workspaceId, projectId: input.projectId ?? null, periodKey } });
    if (existing?.status === "LOCKED") throw new ConflictException("Locked P&L period cannot be edited");
    // A project's manual revenue belongs to the month: the workspace lock covers it too.
    if (input.projectId) await this.assertMonthOpen(principal.workspaceId, periodKey);
    const row = existing
      ? await this.prisma.pnlPeriod.update({ where: { id: existing.id }, data: { periodStart: start, periodEnd: end, currency: input.currency ?? "VND", revenueAmount, status: "OPEN" } })
      : await this.prisma.pnlPeriod.create({ data: { workspaceId: principal.workspaceId, projectId: input.projectId, periodStart: start, periodEnd: end, periodKey, currency: input.currency ?? "VND", revenueAmount } });
    await this.prisma.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "pnl.period_changed", resource: "pnl_period", resourceId: row.id, before: existing ? { status: existing.status, revenueAmount: existing.revenueAmount.toString() } : undefined, after: { status: row.status, periodKey: row.periodKey, revenueAmount: row.revenueAmount.toString() }, requestId: randomUUID() } });
    return { data: row, meta: { status: row.status, advisory: row.status !== "LOCKED" } };
  }

  /**
   * Removes a project's entered revenue for one month, so the month is "chưa nhập" again
   * (no revenue, EBIT not computed) instead of an entered 0. Same permission and lock
   * rules as entering it.
   */
  async removePnlPeriodRevenue(query: { projectId?: unknown; periodKey?: unknown }, principal: PrincipalContext) {
    assertCostEdit(principal);
    const periodKey = validatePeriodKey(firstValue(query?.periodKey));
    const projectId = firstValue(query?.projectId);
    if (typeof projectId !== "string" || !projectId.trim()) throw new BadRequestException("projectId is required");
    const existing = await this.prisma.pnlPeriod.findFirst({ where: { workspaceId: principal.workspaceId, projectId, periodKey } });
    if (!existing) throw new NotFoundException(`Project chưa có doanh thu nhập cho kỳ ${periodKey}.`);
    if (existing.status === "LOCKED") throw new ConflictException("Locked P&L period cannot be edited");
    await this.assertMonthOpen(principal.workspaceId, periodKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.pnlPeriod.delete({ where: { id: existing.id } });
      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "pnl.period_revenue_removed", resource: "pnl_period", resourceId: existing.id, before: { projectId, periodKey, status: existing.status, revenueAmount: existing.revenueAmount.toString() }, requestId: randomUUID() } });
    });
    return { data: { projectId, periodKey }, meta: { deleted: true } };
  }

  /**
   * Locks a month. `periodRef` is the period row id or, for the workspace month, its
   * YYYY-MM key: an approver can then lock a month nobody saved a setup for (the
   * workspace row is created by the lock itself). The figures are computed first;
   * snapshots, status and audit are then written in ONE transaction.
   */
  async lockPnlPeriod(periodRef: string, principal: PrincipalContext) {
    assertCostApprove(principal);
    const byMonthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(periodRef);
    const period = await this.prisma.pnlPeriod.findFirst({ where: byMonthKey ? { workspaceId: principal.workspaceId, projectId: null, periodKey: periodRef } : { id: periodRef, workspaceId: principal.workspaceId } });
    if (!period && !byMonthKey) throw new NotFoundException("P&L period not found");
    if (period?.status === "LOCKED") throw new ConflictException("P&L period is already locked");
    const periodKey = period?.periodKey ?? periodRef;
    // Throws (409 with the list) while the month still has parameter or formula errors.
    const plan = period?.projectId ? undefined : await this.resourceControls.preparePeriodSnapshots(periodKey, principal);
    return this.prisma.$transaction(async (tx) => {
      const snapshot = plan ? await this.resourceControls.writePeriodSnapshots(tx, plan, principal) : undefined;
      const lock = { status: "LOCKED", lockedAt: new Date(), lockedByUserId: principal.subjectId };
      const days = monthDays(periodKey);
      const row = period
        ? await tx.pnlPeriod.update({ where: { id: period.id }, data: lock })
        : await tx.pnlPeriod.create({ data: { workspaceId: principal.workspaceId, periodKey, periodStart: isoDate(days.first, "periodStart", true), periodEnd: isoDate(days.last, "periodEnd", true), currency: "VND", revenueAmount: new Prisma.Decimal(0), ...lock } });
      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "pnl.period_locked", resource: "pnl_period", resourceId: row.id, before: { status: period?.status ?? "NOT_CREATED" }, after: { status: row.status, lockedByUserId: principal.subjectId, snapshotProjects: snapshot?.projectCount ?? 0 }, requestId: randomUUID() } });
      return { data: row, meta: { locked: true, immutable: true, snapshotProjects: snapshot?.projectCount ?? 0, missingRateMinutes: snapshot?.missingRateMinutes ?? 0 } };
    });
  }

  async reopenPnlPeriod(periodId: string, input: ReopenPnlPeriodInput, principal: PrincipalContext) {
    assertCostApprove(principal);
    if (!input.reason?.trim()) throw new BadRequestException("reason is required to reopen a P&L period");
    const period = await this.prisma.pnlPeriod.findFirst({ where: { id: periodId, workspaceId: principal.workspaceId } });
    if (!period) throw new NotFoundException("P&L period not found");
    if (period.status !== "LOCKED") throw new ConflictException("Only a locked P&L period can be reopened");
    const row = await this.prisma.pnlPeriod.update({ where: { id: periodId }, data: { status: "REOPENED", reopenedAt: new Date(), reopenedByUserId: principal.subjectId, reopenReason: input.reason.trim() } });
    await this.prisma.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "pnl.period_reopened", resource: "pnl_period", resourceId: periodId, before: { status: period.status }, after: { status: row.status, reason: input.reason.trim() }, requestId: randomUUID() } });
    return { data: row, meta: { locked: false, auditReason: input.reason.trim() } };
  }
}
