import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ADMIN_ROLE_CODES } from "@b2b-crm/contracts";
import type {
  OvertimePlanInput,
  PrincipalContext,
  ReviewTimelineChangeInput,
  SubmitTaskPlanInput,
  TimelineChangeRequestInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { isBaselineLocked, recordBaselineChange } from "../delivery-handoff/baseline.service";

// The roles that approve task plans and timeline change requests: the Admin accounts of the role catalogue (D-21).
// Kế toán (FINANCE_ADMIN) is a User-type role and approves no plan — same list as TASK_PLAN_APPROVER_ROLES in projects.service.ts.
const MANAGER_ROLES = new Set<string>(ADMIN_ROLE_CODES);

function isoDate(value: unknown, field: string, dateOnly = false) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required`);
  if (dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} is invalid`);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} is invalid`);
  if (dateOnly && dateKey(parsed) !== value) throw new BadRequestException(`${field} is invalid`);
  return parsed;
}

function dateKey(value: Date) { return value.toISOString().slice(0, 10); }
function isManager(principal: PrincipalContext) { return principal.roleCodes.some((role) => MANAGER_ROLES.has(role)); }
@Injectable()
export class BrdGovernanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    const estimate = input.estimateMinutes ?? task.estimateMinutes;
    if (!Number.isInteger(estimate) || estimate < 0) throw new BadRequestException("estimateMinutes must be a non-negative integer");
    const plannedStartAt = input.plannedStartAt ? isoDate(input.plannedStartAt, "plannedStartAt") : null;
    const dueAt = input.dueAt ? isoDate(input.dueAt, "dueAt") : null;
    if (plannedStartAt && dueAt && dueAt < plannedStartAt) throw new BadRequestException("dueAt must be on or after plannedStartAt");
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.projectTask.update({ where: { id: taskId }, data: {
        plannedStartAt, dueAt, estimateMinutes: estimate,
        planApprovalStatus: "SUBMITTED", planSubmittedAt: new Date()
      } });
      const previousHistory = await tx.taskPlanHistory.findFirst({ where: { taskId }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.taskPlanHistory.create({ data: {
        workspaceId: principal.workspaceId, projectId: task.projectId, taskId, version: (previousHistory?.version ?? 0) + 1,
        action: "SUBMITTED", before: { plannedStartAt: task.plannedStartAt, dueAt: task.dueAt, estimateMinutes: task.estimateMinutes },
        after: { plannedStartAt, dueAt, estimateMinutes: estimate }, changedByUserId: principal.subjectId
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
    // D-21: the plan is locked by the task's own approval, or — for a top-level task — by the project's baseline B1.
    if (task.planApprovalStatus !== "APPROVED" && !(!task.parentTaskId && await isBaselineLocked(this.prisma, task.projectId))) throw new ConflictException("Timeline change requests are only needed after PM approval");
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
      // D-20 / D-21: on a project whose baseline B1 is locked, the approved change is the next B1 version, linked to this request.
      if (task.projectId && !task.parentTaskId) {
        await recordBaselineChange(tx, { workspaceId: principal.workspaceId, projectId: task.projectId, layers: ["B1"], cause: { type: "timeline_change", id: request.id, reason: request.reason }, actor: { userId: principal.subjectId, displayName: principal.displayName } });
      }
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
}
