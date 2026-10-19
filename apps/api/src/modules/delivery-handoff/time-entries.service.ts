import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateTaskTimeEntryResponse,
  CreateTaskPlanningBlockInput,
  CreateTaskTimeEntryInput,
  PrincipalContext,
  ReviewTaskTimeEntryInput,
  TransitionTaskPlanningBlockInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  buildPaginationMeta,
  normalizePagination,
  optionalBoolean,
  optionalDate,
  optionalInteger,
  optionalString
} from "../../shared/http/request-context";
import {
  mapTaskPlanningBlockSummary,
  mapTaskTimeEntrySummary
} from "./delivery.mapper";
import {
  buildDailyActualLogStatus,
  getDailyActualLogWindow
} from "./daily-actual-log";
import { dateOnlyToUtcDate, getLocalDateKeysForTimeRange, lockWorkspaceDayOffDates } from "../workspace-calendar/day-off-time";
import { isAdminAccount } from "@b2b-crm/contracts";
import { normalizeProjectStatus } from "./project-status";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "./member-participation";
import { getStoredParameter } from "../../shared/system-parameters";
import { approvedPersonalLeaveMinutes } from "../lark-integration/personal-leave";
import { reportMonthKey } from "../resource-controls/pnl-calc";
import { ResourceControlsService } from "../resource-controls/resource-controls.service";
import { isProjectClosed as isClosedProjectStatus } from "./project-status";
import { isLayer2Mismatch, isTaskTypeLayer2, isValidTaskTypePair, LAYER2_MISMATCH_LABEL, LAYER2_MISMATCH_WARNING_TYPE, TASK_TYPE_LAYER2_LABELS } from "./task-classification";
import { closeProjectWarnings, openOrRefreshProjectWarning } from "./project-warnings";
import type { UpdateTaskTimeEntryLayer2Input } from "@b2b-crm/contracts";
import { isGatePassed } from "./gates";
import { TIME_REVIEW_ROLE_CODES, dayCapMessage, workspaceDayOffMessage, taskPlanningBlockInclude, taskTimeEntryInclude, optionalEnum } from "./projects.shared";
import { ProjectPermissionsService } from "./project-permissions.service";


const MAX_CALENDAR_RANGE_DAYS = 90;
const PLANNING_STATUSES = new Set(["planned", "in_progress", "completed", "cancelled"]);
const PLANNING_TRANSITION_STATUSES = new Set(["in_progress", "completed", "cancelled"]);
const PLANNING_STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  planned: new Set(["in_progress", "completed", "cancelled"]),
  in_progress: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set()
};
const TIME_APPROVAL_STATUSES = new Set(["planned", "submitted", "approved", "done", "rejected"]);
const TIME_REVIEW_STATUSES = new Set(["approved", "rejected"]);
const DEFAULT_TIME_ENTRY_APPROVAL_STATUS = "approved";
const DEFAULT_TIME_ENTRY_TIME_ZONE = "Asia/Ho_Chi_Minh";
const APPROVED_TIME_ENTRY_STATUSES = ["approved", "done"];

function shouldPromoteTaskToInProgress(status: string) {
  return ["todo", "not_started", "planning", "upcoming"].includes(status.trim().toLowerCase());
}

function formatPlanningWindow(startAt: Date, endAt: Date, minutes: number) {
  return `${minutes} minutes planned from ${startAt.toISOString()} to ${endAt.toISOString()}`;
}

function normalizeActualWorkApprovalStatus(status: string | undefined | null, fallbackStatus: string | undefined = DEFAULT_TIME_ENTRY_APPROVAL_STATUS) {
  if (!status) {
    return fallbackStatus;
  }
  return status === "done" ? DEFAULT_TIME_ENTRY_APPROVAL_STATUS : status;
}

function assertRangeWithinLimit(startAt: Date, endAt: Date, fieldName: string) {
  const spanMs = endAt.getTime() - startAt.getTime();
  const maxMs = MAX_CALENDAR_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (spanMs > maxMs) {
    throw new BadRequestException(`${fieldName} cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days`);
  }
}

/** recomputeStatusProposal still lives in ProjectsService; the caller hands it in so this service does not depend back on ProjectsService. */
export type RecomputeStatusProposal = (projectId: string, principal?: PrincipalContext) => Promise<unknown>;

/** Time entries and planning blocks: list / create / delete / review / Layer-2 correction, the write rules and the daily cap (split out of ProjectsService). */
@Injectable()
export class TimeEntriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionsService) private readonly permissions: ProjectPermissionsService,
    @Optional() @Inject(ResourceControlsService) private readonly costPeriods?: ResourceControlsService
  ) {}

  async listTaskPlanningBlocks(query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultEnd.getDate() + 7);

    const startAt = optionalDate(query.startAt, "startAt") ?? defaultStart;
    const endAt = optionalDate(query.endAt, "endAt") ?? defaultEnd;
    if (endAt <= startAt) {
      throw new BadRequestException("Giờ kết thúc phải sau giờ bắt đầu.");
    }
    assertRangeWithinLimit(startAt, endAt, "Planning calendar range");

    const where: Prisma.TaskPlanningBlockWhereInput = {
      workspaceId: principal.workspaceId,
      startAt: { lt: endAt },
      endAt: { gt: startAt }
    };

    const userId = optionalString(query.userId, "userId");
    const projectId = optionalString(query.projectId, "projectId");
    const taskId = optionalString(query.taskId, "taskId");
    const status = optionalEnum(query.status, "status", PLANNING_STATUSES);
    if (userId) where.userId = userId;
    if (projectId) where.projectId = projectId;
    if (taskId) where.taskId = taskId;
    if (status) where.status = status;
    Object.assign(where, this.permissions.timeRecordVisibilityWhere(principal));

    const [blocks, total] = await Promise.all([
      this.prisma.taskPlanningBlock.findMany({
        where,
        include: taskPlanningBlockInclude,
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.taskPlanningBlock.count({ where })
    ]);

    return {
      data: blocks.map(mapTaskPlanningBlockSummary),
      meta: {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        pagination: buildPaginationMeta({ ...pagination, total, returned: blocks.length })
      }
    };
  }

  async createTaskPlanningBlock(taskId: string, input: CreateTaskPlanningBlockInput, principal: PrincipalContext, fallbackUserId?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const userId = optionalString(input.userId, "userId") ?? fallbackUserId;
    if (!userId) {
      throw new BadRequestException("userId is required");
    }

    const startAt = optionalDate(input.startAt, "startAt");
    const endAt = optionalDate(input.endAt, "endAt");
    if (!startAt || !endAt) {
      throw new BadRequestException("startAt and endAt are required");
    }
    if (endAt <= startAt) {
      throw new BadRequestException("Giờ kết thúc phải sau giờ bắt đầu.");
    }

    const diffMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    const plannedMinutes = optionalInteger(input.plannedMinutes, "plannedMinutes") ?? diffMinutes;
    if (plannedMinutes <= 0) {
      throw new BadRequestException("Số phút kế hoạch phải lớn hơn 0.");
    }
    const standardDayMinutes = await this.standardDayMinutes(this.prisma, principal.workspaceId);
    if (plannedMinutes > standardDayMinutes) {
      throw new BadRequestException(this.dayCapMessage(standardDayMinutes, "plan", 0));
    }
    const workType = optionalString(input.workType, "workType") ?? "delivery";
    if (workType.length > 80) {
      throw new BadRequestException("workType must be 80 characters or fewer");
    }

    const block = await this.prisma.$transaction(async (tx) => {
      if (task.projectId) {
        await this.permissions.lockProjectMembers(tx, principal.workspaceId, task.projectId);
        await this.permissions.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, task.projectId, [userId]);
      } else await this.permissions.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [userId]);
      const planningDayKeys = getLocalDateKeysForTimeRange(startAt, endAt, startAt);
      await lockWorkspaceDayOffDates(tx, principal.workspaceId, planningDayKeys);
      // D-09: a workspace day off blocks planning for everyone, Admin accounts included.
      if (typeof tx.workspaceDayOff?.findFirst === "function") {
        const blockedDay = await tx.workspaceDayOff.findFirst({
          where: { workspaceId: principal.workspaceId, isActive: true, date: { in: planningDayKeys.map(dateOnlyToUtcDate) } },
          select: { date: true, name: true },
          orderBy: { date: "asc" }
        });
        if (blockedDay) throw new ConflictException(workspaceDayOffMessage(blockedDay));
      }
      // D-13: same local-day window and same cap as actual hours.
      const planningDay = getDailyActualLogWindow(startAt);
      const plannedToday = typeof tx.taskPlanningBlock.aggregate === "function"
        ? await tx.taskPlanningBlock.aggregate({
            where: { workspaceId: principal.workspaceId, userId, startAt: { gte: planningDay.startAt, lt: planningDay.endAt }, status: { not: "cancelled" } },
            _sum: { plannedMinutes: true }
          })
        : { _sum: { plannedMinutes: 0 } };
      const planCapMinutes = await this.standardDayCapMinutes(tx, principal.workspaceId, userId, planningDay.localDate);
      if ((plannedToday._sum.plannedMinutes ?? 0) + plannedMinutes > planCapMinutes) {
        throw new ConflictException(this.dayCapMessage(planCapMinutes, "plan", plannedToday._sum.plannedMinutes ?? 0));
      }
      const created = await tx.taskPlanningBlock.create({
        data: {
          workspaceId: principal.workspaceId,
          taskId: task.id,
          accountId: task.accountId,
          projectId: task.projectId,
          userId,
          title: optionalString(input.title, "title") ?? task.title,
          notes: optionalString(input.notes, "notes") ?? undefined,
          startAt,
          endAt,
          plannedMinutes,
          billable: optionalBoolean(input.billable, "billable") ?? true,
          workType,
          status: optionalEnum(input.status, "status", PLANNING_STATUSES) ?? "planned",
          source: "manual",
          createdByUserId: fallbackUserId
        },
        include: taskPlanningBlockInclude
      });

      if (task.projectId) {
        await tx.projectActivity.create({
          data: {
            workspaceId: principal.workspaceId,
            projectId: task.projectId,
            accountId: task.accountId,
            activityType: "work_planned",
            subject: `Planned work: ${task.title}`,
            note: [
              formatPlanningWindow(startAt, endAt, plannedMinutes),
              optionalString(input.notes, "notes") ?? undefined
            ].filter(Boolean).join("\n"),
            target: task.title,
            occurredAt: new Date(),
            status: "active",
            createdByUserId: fallbackUserId
          }
        });
      }

      return created;
    });

    return mapTaskPlanningBlockSummary(block);
  }

  async transitionTaskPlanningBlock(
    blockId: string,
    input: TransitionTaskPlanningBlockInput,
    principal: PrincipalContext,
    changedByUserId?: string
  ) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const targetStatus = optionalEnum(input.status, "status", PLANNING_TRANSITION_STATUSES);
    if (!targetStatus) {
      throw new BadRequestException("status is required");
    }
    const expectedUpdatedAt = optionalDate(input.expectedUpdatedAt, "expectedUpdatedAt");
    if (!expectedUpdatedAt) {
      throw new BadRequestException("expectedUpdatedAt is required");
    }
    const reason = optionalString(input.reason, "reason") ?? undefined;

    const existing = await this.prisma.taskPlanningBlock.findFirst({
      where: { id: blockId, workspaceId: principal.workspaceId, ...this.permissions.timeRecordAccessWhere(principal) },
      include: taskPlanningBlockInclude
    });
    if (!existing) {
      throw new NotFoundException("Task planning block not found");
    }

    // D-09: nobody works a plan on a workspace day off; with no Admin bypass left, cancelling must stay possible.
    if (targetStatus !== "cancelled" && typeof this.prisma.workspaceDayOff?.findFirst === "function") {
      const planningDayKeys = getLocalDateKeysForTimeRange(existing.startAt, existing.endAt, existing.startAt);
      const blockedDay = await this.prisma.workspaceDayOff.findFirst({
        where: { workspaceId: principal.workspaceId, isActive: true, date: { in: planningDayKeys.map(dateOnlyToUtcDate) } },
        select: { date: true, name: true },
        orderBy: { date: "asc" }
      });
      if (blockedDay) throw new ConflictException(workspaceDayOffMessage(blockedDay));
    }

    if (targetStatus === "completed") {
      this.assertCanMaterializePlanningActual(existing.userId, principal);
    }
    if (targetStatus === "cancelled" && existing.userId !== principal.subjectId && !(await this.permissions.canManageProject(this.prisma, existing.projectId, principal))) {
      throw new ForbiddenException("Chỉ người được lập kế hoạch hoặc PM của dự án mới được hủy khối kế hoạch này");
    }

    // D-15: completing a block only changes the block. Planned hours never become a time log; the person logs actual hours.
    if (existing.status === targetStatus) {
      return mapTaskPlanningBlockSummary(existing);
    }
    if (!PLANNING_STATUS_TRANSITIONS[existing.status]?.has(targetStatus)) {
      throw new ConflictException(`Task planning block cannot transition from ${existing.status} to ${targetStatus}`);
    }

    const transitioned = await this.prisma.$transaction(async (tx) => {
      const update = await tx.taskPlanningBlock.updateMany({
        where: {
          id: existing.id,
          workspaceId: principal.workspaceId,
          status: existing.status,
          updatedAt: expectedUpdatedAt
        },
        data: { status: targetStatus }
      });

      if (update.count === 0) {
        const current = await tx.taskPlanningBlock.findFirst({
          where: { id: existing.id, workspaceId: principal.workspaceId },
          include: taskPlanningBlockInclude
        });
        if (!current) {
          throw new NotFoundException("Task planning block not found");
        }
        if (current.status === targetStatus) {
          return current;
        }
        throw new ConflictException("Task planning block was changed by another request");
      }

      const changed = await tx.taskPlanningBlock.findFirst({
        where: { id: existing.id, workspaceId: principal.workspaceId },
        include: taskPlanningBlockInclude
      });
      if (!changed) {
        throw new NotFoundException("Task planning block not found");
      }

      const requestId = `task-planning-block:${existing.id}:${targetStatus}:${expectedUpdatedAt.toISOString()}`;
      await tx.auditEvent.create({
        data: {
          workspaceId: principal.workspaceId,
          actorUserId: changedByUserId,
          action: "planning_status_changed",
          resource: "TaskPlanningBlock",
          resourceId: existing.id,
          before: { status: existing.status },
          after: reason ? { status: targetStatus, reason } : { status: targetStatus },
          requestId
        }
      });

      if (existing.projectId) {
        await tx.projectActivity.create({
          data: {
            workspaceId: principal.workspaceId,
            projectId: existing.projectId,
            accountId: existing.accountId,
            activityType: "planning_status_changed",
            subject: `Planning status changed: ${existing.title}`,
            note: [
              `Planning status changed from ${existing.status} to ${targetStatus}.`,
              reason
            ].filter(Boolean).join("\n"),
            target: existing.title,
            occurredAt: new Date(),
            status: "active",
            createdByUserId: changedByUserId
          }
        });
      }

      return changed;
    });

    return mapTaskPlanningBlockSummary(transitioned);
  }

  async listTaskTimeEntries(query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultEnd.getDate() + 7);

    const startAt = optionalDate(query.startAt, "startAt") ?? defaultStart;
    const endAt = optionalDate(query.endAt, "endAt") ?? defaultEnd;
    if (endAt <= startAt) {
      throw new BadRequestException("Giờ kết thúc phải sau giờ bắt đầu.");
    }
    assertRangeWithinLimit(startAt, endAt, "Khoảng lịch giờ thực tế");

    const where: Prisma.TaskTimeEntryWhereInput = {
      workspaceId: principal.workspaceId,
      OR: [
        { startAt: { gte: startAt, lt: endAt } },
        { startAt: null, workDate: { gte: startAt, lt: endAt } }
      ]
    };

    const userId = optionalString(query.userId, "userId");
    const projectId = optionalString(query.projectId, "projectId");
    const taskId = optionalString(query.taskId, "taskId");
    const requestedApprovalStatus = optionalEnum(query.approvalStatus, "approvalStatus", TIME_APPROVAL_STATUSES);
    const approvalStatus = requestedApprovalStatus
      ? normalizeActualWorkApprovalStatus(requestedApprovalStatus)
      : undefined;
    if (userId) where.userId = userId;
    if (projectId) where.projectId = projectId;
    if (taskId) where.taskId = taskId;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    Object.assign(where, this.permissions.timeRecordVisibilityWhere(principal));

    const [entries, total] = await Promise.all([
      this.prisma.taskTimeEntry.findMany({
        where,
        include: taskTimeEntryInclude,
        orderBy: [{ startAt: "asc" }, { workDate: "asc" }, { createdAt: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.taskTimeEntry.count({ where })
    ]);

    return {
      data: entries.map(mapTaskTimeEntrySummary),
      meta: {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        pagination: buildPaginationMeta({ ...pagination, total, returned: entries.length })
      }
    };
  }

  async deleteTaskPlanningBlock(blockId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const block = await this.prisma.taskPlanningBlock.findFirst({
      where: { id: blockId, workspaceId: principal.workspaceId, ...this.permissions.timeRecordAccessWhere(principal) },
      select: { id: true, userId: true }
    });
    if (!block) {
      throw new NotFoundException("Task planning block not found");
    }
    this.assertCanDeletePlanningBlock(block.userId, principal);

    const deleted = await this.prisma.taskPlanningBlock.deleteMany({
      where: { id: block.id, workspaceId: principal.workspaceId }
    });
    if (deleted.count === 0) {
      throw new NotFoundException("Task planning block not found");
    }

    return { deleted: true, id: blockId };
  }

  async deleteTaskTimeEntry(entryId: string, principal: PrincipalContext, recomputeStatusProposal: RecomputeStatusProposal) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { id: entryId, workspaceId: principal.workspaceId, ...this.permissions.timeRecordAccessWhere(principal) },
      select: { id: true, userId: true, taskId: true, projectId: true, minutes: true, workDate: true, approvalStatus: true, billable: true, reviewedByUserId: true }
    });
    if (!entry) {
      throw new NotFoundException("Task time entry not found");
    }
    await this.assertTimeEntryPeriodOpen(principal.workspaceId, [entry.workDate]);

    await this.prisma.$transaction(async (tx) => {
      // Founder/GM, Workspace Admin and the project's manager may delete any entry; the author until a reviewer has approved it
      // (entries are created "approved" by default, so the status alone would lock every author out).
      if (!(await this.permissions.canManageProjectOrAdmin(tx, entry.projectId, principal))) {
        if (entry.userId !== principal.subjectId) {
          throw new ForbiddenException("Bạn chỉ được xóa time log của chính mình. Time log của người khác do PM dự án, Workspace Admin hoặc Founder/GM xóa.");
        }
        if (entry.reviewedByUserId && APPROVED_TIME_ENTRY_STATUSES.includes(String(entry.approvalStatus ?? "").toLowerCase())) {
          throw new ForbiddenException("Time log đã được duyệt nên bạn không thể tự xóa. Hãy nhờ PM dự án, Workspace Admin hoặc Founder/GM.");
        }
      }
      await tx.projectCost.updateMany({
        where: { taskTimeEntryId: entry.id, workspaceId: principal.workspaceId },
        data: { taskTimeEntryId: null }
      });
      await tx.taskTimeEntry.delete({ where: { id: entry.id } });
      await this.syncLayer2MismatchWarning(tx, principal.workspaceId, entry.projectId, principal.subjectId);
      await this.permissions.auditMutation(tx, principal, "task.time_entry_deleted", "task_time_entry", entry.id, {
        userId: entry.userId, taskId: entry.taskId, projectId: entry.projectId, minutes: entry.minutes,
        workDate: entry.workDate?.toISOString?.() ?? null, approvalStatus: entry.approvalStatus, billable: entry.billable
      });
    });
    // V-17: the last time log of a stage going away can change the status the rules imply, exactly like the first one arriving.
    if (entry.projectId) await recomputeStatusProposal(entry.projectId, principal);

    return { deleted: true, id: entry.id };
  }

  async reviewTaskTimeEntry(entryId: string, input: ReviewTaskTimeEntryInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    if (!principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Founder/GM or Delivery Lead role is required to review time entries");
    }

    const status = optionalEnum(input.status, "status", TIME_REVIEW_STATUSES);
    if (!status) throw new BadRequestException("status is required");
    const expectedUpdatedAt = optionalDate(input.expectedUpdatedAt, "expectedUpdatedAt");
    if (!expectedUpdatedAt) throw new BadRequestException("expectedUpdatedAt is required");
    const reason = optionalString(input.reason, "reason") ?? undefined;
    if (status === "rejected" && !reason) {
      throw new BadRequestException("reason is required when rejecting a time entry");
    }

    const reviewed = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.taskTimeEntry.findFirst({
        where: { id: entryId, workspaceId: principal.workspaceId, ...this.permissions.timeRecordAccessWhere(principal) },
        select: { id: true, approvalStatus: true, updatedAt: true, workDate: true }
      });
      if (!entry) throw new NotFoundException("Task time entry not found");
      await this.assertTimeEntryPeriodOpen(principal.workspaceId, [entry.workDate]);
      if (entry.approvalStatus !== "submitted") {
        throw new ConflictException("Only submitted time entries can be reviewed");
      }
      if (entry.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("Time entry changed since it was loaded");
      }

      const updated = await tx.taskTimeEntry.updateMany({
        where: {
          id: entry.id,
          workspaceId: principal.workspaceId,
          approvalStatus: "submitted",
          updatedAt: expectedUpdatedAt
        },
        data: {
          approvalStatus: status,
          reviewedByUserId: principal.subjectId,
          reviewedAt: new Date(),
          reviewNote: reason
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("Time entry changed while it was being reviewed");
      }

      return tx.taskTimeEntry.findFirstOrThrow({
        where: { id: entry.id, workspaceId: principal.workspaceId },
        include: taskTimeEntryInclude
      });
    });

    return mapTaskTimeEntrySummary(reviewed);
  }

  async createTimeEntry(
    taskId: string,
    input: CreateTaskTimeEntryInput,
    principal: PrincipalContext,
    fallbackUserId: string | undefined, recomputeStatusProposal: RecomputeStatusProposal
  ): Promise<CreateTaskTimeEntryResponse> {
    this.permissions.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const userId = optionalString(input.userId, "userId") ?? fallbackUserId;
    if (!userId) {
      throw new BadRequestException("userId is required");
    }
    if (userId !== principal.subjectId && !principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Bạn chỉ ghi giờ cho chính mình. Ghi giờ hộ người khác cần quyền Founder/GM, Workspace Admin hoặc Delivery Lead.");
    }

    const inputStartAt = optionalDate(input.startAt, "startAt");
    const inputEndAt = optionalDate(input.endAt, "endAt");
    let minutes = optionalInteger(input.minutes, "minutes") ?? 0;
    if (minutes <= 0) {
      throw new BadRequestException("Số phút ghi nhận phải lớn hơn 0.");
    }
    let startAt = inputStartAt;
    let endAt = inputEndAt;
    if (startAt && !endAt) {
      endAt = new Date(startAt.getTime() + minutes * 60 * 1000);
    } else if (!startAt && endAt) {
      startAt = new Date(endAt.getTime() - minutes * 60 * 1000);
    }
    if (startAt && endAt) {
      if (endAt <= startAt) {
        throw new BadRequestException("Giờ kết thúc phải sau giờ bắt đầu.");
      }
      minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
      if (minutes <= 0) {
        throw new BadRequestException("time entry window must be greater than 0 minutes");
      }
    }
    // D-10: a time log without a day is not saved; the server never fills in "now".
    const workDate = startAt ?? optionalDate(input.workDate, "workDate");
    if (!workDate) {
      throw new BadRequestException("Hãy chọn ngày làm việc cho giờ log.");
    }
    const timeZone = optionalString(input.timeZone, "timeZone") ?? DEFAULT_TIME_ENTRY_TIME_ZONE;
    if (timeZone.length > 80) {
      throw new BadRequestException("timeZone must be 80 characters or fewer");
    }
    this.assertTimeEntryWindow(startAt, endAt, timeZone);
    const workType = optionalString(input.workType, "workType") ?? "delivery";
    if (workType.length > 80) {
      throw new BadRequestException("workType must be 80 characters or fewer");
    }
    const note = optionalString(input.note, "note") ?? undefined;
    const selectedTaskTypeLayer2 = this.parseSelectedLayer2(input.selectedTaskTypeLayer2, task.taskTypeLayer1);

    const result = await this.prisma.$transaction((tx) => this.writeTimeEntry(tx, principal, task, {
      userId, startAt, endAt, workDate, timeZone, minutes, workType, note, selectedTaskTypeLayer2,
      billable: optionalBoolean(input.billable, "billable") ?? true,
      // V-07: a time log needs no approval. A client-sent status is ignored; saving is recording.
      approvalStatus: DEFAULT_TIME_ENTRY_APPROVAL_STATUS
    }));
    // V-17: a first time log in a stage can change the status the rules imply (never throws into this request).
    if (task.projectId) await recomputeStatusProposal(task.projectId, principal);

    return {
      ...mapTaskTimeEntrySummary(result.entry),
      dailyActualLog: result.dailyActualLog,
      // Tells the UI the hour was saved but waits at "Chờ xử lý – Tháng đã khóa".
      ...(await this.timeEntryPeriodLocked(principal.workspaceId, workDate) ? { savedInLockedPeriod: true } : {})
    };
  }

  private async timeEntryPeriodLocked(workspaceId: string, workDate: Date): Promise<boolean> {
    try {
      await this.assertTimeEntryPeriodOpen(workspaceId, [workDate]);
      return false;
    } catch (error) {
      if (error instanceof ConflictException) return true;
      throw error;
    }
  }

  /**
   * Layer 2 is legacy metadata. New time logs do not require it; when an older caller
   * still sends a value, keep validating that value for backwards compatibility.
   */
  private parseSelectedLayer2(value: unknown, taskTypeLayer1: string | null | undefined) {
    if (value === undefined || value === null || value === "") return null;
    if (!isTaskTypeLayer2(value)) {
      throw new BadRequestException(`Chọn Lớp 2 (bối cảnh công việc) khi ghi giờ: ${Object.values(TASK_TYPE_LAYER2_LABELS).join(", ")}.`);
    }
    if (!isValidTaskTypePair(taskTypeLayer1, value)) {
      throw new BadRequestException("Giờ của task Pre-sale không thể chọn Lớp 2 là Ticket/bảo trì.");
    }
    return value;
  }

  /**
   * "Lớp 2 không khớp": one open data warning per project while any of its entries carries a choice that differs from
   * the task's Layer 2; closed when none is left. Trial projects raise no warning (PL-02).
   * ponytail: reads the project's chosen-Layer-2 entries and compares in memory; move to a raw column comparison if a project ever holds 100k+ entries.
   */
  async syncLayer2MismatchWarning(tx: Prisma.TransactionClient, workspaceId: string, projectId: string | null | undefined, actorUserId: string | null) {
    if (!projectId || typeof tx.taskTimeEntry?.findMany !== "function") return;
    const [rows, project] = await Promise.all([
      tx.taskTimeEntry.findMany({ where: { workspaceId, projectId, selectedTaskTypeLayer2: { not: null } }, select: { minutes: true, taskTypeLayer2: true, selectedTaskTypeLayer2: true } }),
      typeof tx.project?.findFirst === "function" ? tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { isTestProject: true } }) : null
    ]);
    const mismatched = (rows ?? []).filter((row) => isLayer2Mismatch(row.selectedTaskTypeLayer2, row.taskTypeLayer2));
    const dedupeKey = `${LAYER2_MISMATCH_WARNING_TYPE}:layer2-mismatch`;
    if (mismatched.length === 0 || project?.isTestProject) {
      await closeProjectWarnings(tx, { projectId, dedupeKey }, actorUserId, project?.isTestProject ? "Dự án thử nghiệm không sinh cảnh báo" : "Không còn giờ log chọn Lớp 2 lệch với task");
      return;
    }
    const hours = Math.round(mismatched.reduce((sum, row) => sum + row.minutes, 0) / 6) / 10;
    await openOrRefreshProjectWarning(tx, {
      workspaceId, projectId, dedupeKey, typeCode: LAYER2_MISMATCH_WARNING_TYPE, severity: "medium", actorUserId,
      title: `${LAYER2_MISMATCH_LABEL}: ${mismatched.length} giờ log`,
      detail: `${mismatched.length} giờ log (${hours} giờ) có Lớp 2 người ghi chọn khác Lớp 2 của task nên đang Chờ xử lý. Sửa lại lựa chọn để giờ được tính vào P&L.`
    });
  }

  /**
   * Corrects a wrongly chosen Layer 2. Allowed for the person who logged the hour and for the project's PM / Admin
   * (2.4: the PM "sửa Lớp 2 chọn sai" from the pending worklist), until the cost period of the work date is locked.
   */
  async updateTimeEntryLayer2(entryId: string, input: UpdateTaskTimeEntryLayer2Input, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { id: entryId, workspaceId: principal.workspaceId, ...this.permissions.timeRecordAccessWhere(principal) },
      select: { id: true, userId: true, projectId: true, workDate: true, taskTypeLayer1: true, selectedTaskTypeLayer2: true }
    });
    if (!entry) throw new NotFoundException("Task time entry not found");
    const selected = this.parseSelectedLayer2(input?.selectedTaskTypeLayer2, entry.taskTypeLayer1);
    await this.assertTimeEntryPeriodOpen(principal.workspaceId, [entry.workDate]);
    // After G7 the project P&L is closed: a Layer 2 change would move hours in or out of a closed result.
    const reason = optionalString(input?.reason, "reason") ?? undefined;
    const g7 = entry.projectId && typeof (this.prisma as any).projectGate?.findFirst === "function"
      ? await this.prisma.projectGate.findFirst({ where: { workspaceId: principal.workspaceId, projectId: entry.projectId, code: "G7" }, select: { status: true } })
      : null;
    const afterPnlClose = isGatePassed(g7?.status);
    if (afterPnlClose && !(isAdminAccount(principal) && reason)) {
      throw new ConflictException("Dự án đã qua G7 nên P&L dự án đã đóng: chỉ Admin mới được sửa Lớp 2 của giờ log và phải ghi lý do.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (entry.userId !== principal.subjectId && !(await this.permissions.canManageProjectOrAdmin(tx, entry.projectId, principal))) {
        throw new ForbiddenException("Chỉ người ghi giờ, PM dự án hoặc Admin mới được sửa Lớp 2 của giờ log.");
      }
      const row = await tx.taskTimeEntry.update({ where: { id: entry.id }, data: { selectedTaskTypeLayer2: selected }, include: taskTimeEntryInclude });
      await this.permissions.auditMutation(tx, principal, "task.time_entry_layer2_changed", "task_time_entry", entry.id,
        { selectedTaskTypeLayer2: entry.selectedTaskTypeLayer2 ?? null }, { selectedTaskTypeLayer2: selected, ...(afterPnlClose ? { afterPnlClose: true, reason } : {}) });
      await this.syncLayer2MismatchWarning(tx, principal.workspaceId, entry.projectId, principal.subjectId);
      return row;
    });
    return mapTaskTimeEntrySummary(updated);
  }

  /** The 07:00–19:00 same-day window every time entry must fit in. */
  private assertTimeEntryWindow(startAt: Date | null | undefined, endAt: Date | null | undefined, timeZone: string) {
    if (startAt && endAt) {
      try {
        const timeParts = (value: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23"
        }).formatToParts(value).filter(({ type }) => type === "hour" || type === "minute").map(({ type, value: partValue }) => [type, Number(partValue)]));
        const startLocal = timeParts(startAt);
        const endLocal = timeParts(endAt);
        const startMinutes = startLocal.hour * 60 + startLocal.minute;
        const endMinutes = endLocal.hour * 60 + endLocal.minute;
        if (startMinutes < 7 * 60 || endMinutes > 19 * 60 || endMinutes <= startMinutes) {
          throw new BadRequestException("Khung giờ ghi nhận phải nằm trong 07:00–19:00 của cùng một ngày và giờ kết thúc phải sau giờ bắt đầu.");
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException("timeZone must be a valid IANA time zone");
      }
    }
  }

  /**
   * D-28 (Chặn): a time entry whose work date falls in a locked cost period cannot be changed, moved or deleted
   * (adding one is allowed: P&L spec A-1a, it waits at "Chờ xử lý – Tháng đã khóa").
   * The document gives no exception: the only way through is an Admin reopening the period (with person, time, reason).
   */
  async assertTimeEntryPeriodOpen(workspaceId: string, workDates: ReadonlyArray<Date | null | undefined>) {
    if (!this.costPeriods) return;
    const periodKeys = new Set(workDates.filter((date): date is Date => Boolean(date)).map((date) => reportMonthKey(date)));
    for (const periodKey of periodKeys) {
      try {
        await this.costPeriods.assertPeriodOpen(workspaceId, periodKey);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        throw new ConflictException(`Kỳ chi phí ${periodKey} đã chốt nên không thể thêm, sửa, chuyển hoặc xóa giờ log của kỳ này. Admin mở lại kỳ tại Admin › Thiết lập P&L trước khi thao tác.`);
      }
    }
  }

  /**
   * The one place a time entry is written: membership, day-off, daily cap, task-plan cap and milestone lock are all checked
   * before the first write, so a caller may catch a rule violation without leaving anything behind.
   */
  private async writeTimeEntry(
    tx: Prisma.TransactionClient,
    principal: PrincipalContext,
    task: { id: string; accountId: string; projectId: string | null; stageId?: string | null; title: string; estimateMinutes?: number | null; taskTypeLayer1?: string | null; taskTypeLayer2?: string | null; contractItemId?: string | null },
    entry: { userId: string; startAt?: Date | null; endAt?: Date | null; workDate: Date; timeZone: string; minutes: number; workType: string; note?: string; billable: boolean; approvalStatus: string; sourcePlanningBlockId?: string; selectedTaskTypeLayer2?: string | null }
  ) {
    const { userId, startAt, endAt, workDate, timeZone, minutes, workType, note } = entry;
    const dailyLogWindow = getDailyActualLogWindow(workDate);
    const dayOffDateKeys = getLocalDateKeysForTimeRange(startAt, endAt, workDate);
    // P&L spec A-1a / Appendix B case 6: an hour logged into a locked month IS saved; the hour gate keeps it at
    // "Chờ xử lý – Tháng đã khóa" until the period is reopened. Only changes and deletes of that month are refused (D-28).
    await this.permissions.assertMilestoneUnlocked(tx, principal.workspaceId, task.stageId, "log giờ");
    // D-16: a closed project takes no more hours; a project on hold still does, and each such log is flagged for the PM.
    const projectStatus = task.projectId && typeof tx.project?.findFirst === "function"
      ? (await tx.project.findFirst({ where: { id: task.projectId, workspaceId: principal.workspaceId }, select: { status: true } }))?.status
      : undefined;
    if (isClosedProjectStatus(projectStatus)) {
      throw new ConflictException("Dự án Đã đóng nên đã khóa ghi giờ. Mở lại dự án trước khi log giờ.");
    }
    const loggedWhileOnHold = normalizeProjectStatus(projectStatus) === "on_hold";
    if (task.projectId) {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, task.projectId);
      await this.permissions.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, task.projectId, [userId]);
    } else await this.permissions.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [userId]);
    await lockWorkspaceDayOffDates(tx, principal.workspaceId, dayOffDateKeys);
    // D-09: a workspace day off locks time logging for everyone — no role logs on it, so no role skips the daily cap either.
    const dayOff = typeof tx.workspaceDayOff?.findFirst === "function"
      ? await tx.workspaceDayOff.findFirst({
          where: { workspaceId: principal.workspaceId, isActive: true, date: { in: dayOffDateKeys.map(dateOnlyToUtcDate) } },
          orderBy: { date: "asc" },
          select: { id: true, date: true, name: true }
        })
      : null;
    if (dayOff) {
      throw new ConflictException(workspaceDayOffMessage(dayOff));
    }
    // D-13: standard hours per person per day across all projects. D-14: overtime is its own hour type and never counts here.
    const dayCapMinutes = await this.standardDayCapMinutes(tx, principal.workspaceId, userId, dailyLogWindow.localDate);
    if (minutes > dayCapMinutes) {
      throw new BadRequestException(this.dayCapMessage(dayCapMinutes, "log", 0));
    }
    // Serialize the per-user/day write before reading the current total. Without
    // this lock, two concurrent entries can both observe the same remaining
    // capacity and push the daily total past the 8-hour limit.
    const dailyLogLockScope = JSON.stringify([principal.workspaceId, userId, dailyLogWindow.localDate]);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dailyLogLockScope}, 0))::text`;
    const dailyMinutes = typeof tx.taskTimeEntry.aggregate === "function" ? await tx.taskTimeEntry.aggregate({
      where: {
        workspaceId: principal.workspaceId,
        userId,
        approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES },
        OR: [
          { startAt: { gte: dailyLogWindow.startAt, lt: dailyLogWindow.endAt } },
          { startAt: null, workDate: { gte: dailyLogWindow.startAt, lt: dailyLogWindow.endAt } }
        ]
      },
      _sum: { minutes: true, overtimeMinutes: true }
    }) : { _sum: { minutes: 0, overtimeMinutes: 0 } };
    const standardMinutesLogged = (dailyMinutes._sum.minutes ?? 0) - (dailyMinutes._sum.overtimeMinutes ?? 0);
    if (standardMinutesLogged + minutes > dayCapMinutes) {
      throw new ConflictException(this.dayCapMessage(dayCapMinutes, "log", standardMinutesLogged));
    }

    const taskEstimateMinutes = Math.max(0, Number(task.estimateMinutes ?? 0));
    if (taskEstimateMinutes > 0) {
      // Serialize task-level writes as well as the existing daily-capacity check.
      // This keeps two concurrent requests from both consuming the same remaining plan.
      const taskLogLockScope = JSON.stringify([principal.workspaceId, task.id, "actual"]);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskLogLockScope}, 0))::text`;
      const taskMinutes = typeof tx.taskTimeEntry.aggregate === "function"
        ? await tx.taskTimeEntry.aggregate({
            where: {
              workspaceId: principal.workspaceId,
              taskId: task.id,
              approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES }
            },
            _sum: { minutes: true }
          })
        : { _sum: { minutes: 0 } };
      const currentTaskMinutes = Math.max(0, Number(taskMinutes._sum.minutes ?? 0));
      if (currentTaskMinutes + minutes > taskEstimateMinutes) {
        // D-19 (Ghi nhận): hours beyond the task's estimate are logged, never refused; the overrun is kept in the
        // audit trail and the PM is reminded by warning TD-01 (hours logged against the estimate).
        await this.permissions.auditMutation(tx, principal, "time_entry.over_estimate", "task", task.id,
          { estimateMinutes: taskEstimateMinutes, loggedMinutes: currentTaskMinutes },
          { loggedMinutes: currentTaskMinutes + minutes, overMinutes: currentTaskMinutes + minutes - taskEstimateMinutes });
      }
    }

    await this.promoteTaskForActualWork(tx, {
      taskId: task.id,
      workspaceId: principal.workspaceId,
      changedByUserId: principal.subjectId,
      occurredAt: workDate
    });

    const created = await tx.taskTimeEntry.create({
      data: {
        workspaceId: principal.workspaceId,
        taskId: task.id,
        accountId: task.accountId,
        projectId: task.projectId,
        userId,
        workDate,
        startAt,
        endAt,
        timeZone,
        minutes,
        regularMinutes: minutes,
        overtimeMinutes: 0,
        billable: entry.billable,
        workType,
        // D-03: the entry copies its task's classification when written. Layer 2 is also chosen by the person logging
        // (P&L spec 12/10 point 5) and kept next to the task's value; the hour gate compares the two.
        taskTypeLayer1: task.taskTypeLayer1,
        taskTypeLayer2: task.taskTypeLayer2,
        selectedTaskTypeLayer2: entry.selectedTaskTypeLayer2 ?? undefined,
        loggedWhileOnHold,
        approvalStatus: entry.approvalStatus,
        note,
        sourcePlanningBlockId: entry.sourcePlanningBlockId
      },
      include: taskTimeEntryInclude
    });

    if (task.projectId) {
      await tx.projectActivity.create({
        data: {
          workspaceId: principal.workspaceId,
          projectId: task.projectId,
          accountId: task.accountId,
          activityType: "work_logged",
          subject: `Logged work: ${task.title}`,
          note: [`${minutes} minutes logged as ${workType}`, note].filter(Boolean).join("\n"),
          target: task.title,
          occurredAt: startAt ?? workDate,
          status: "active",
          createdByUserId: principal.subjectId
        }
      });
    }

    await this.permissions.auditMutation(tx, principal, "task.time_logged", "task_time_entry", created.id, undefined, { performerUserId: userId, taskId: task.id, minutes, workDate: workDate.toISOString() });
    if (isLayer2Mismatch(entry.selectedTaskTypeLayer2, task.taskTypeLayer2)) await this.syncLayer2MismatchWarning(tx, principal.workspaceId, task.projectId, principal.subjectId);
    const dailyActualLogAggregate = await tx.taskTimeEntry.aggregate({
      where: {
        workspaceId: principal.workspaceId,
        userId,
        approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES },
        OR: [
          {
            startAt: {
              gte: dailyLogWindow.startAt,
              lt: dailyLogWindow.endAt
            }
          },
          {
            startAt: null,
            workDate: {
              gte: dailyLogWindow.startAt,
              lt: dailyLogWindow.endAt
            }
          }
        ]
      },
      _sum: { minutes: true }
    });

    return {
      entry: created,
      dailyActualLog: buildDailyActualLogStatus(
        dailyLogWindow.localDate,
        dailyActualLogAggregate._sum.minutes ?? 0
      )
    };
  }

  /**
   * Section 9.2: an old "Họp"/"Khác" hour that sits in a customer project is not moved by the conversion; the PM
   * confirms it is this project's work ("họp trong dự án là task của dự án đó") and it then goes through the P&L gate.
   */
  async confirmLegacyTimeEntryGroup(entryId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { id: entryId, workspaceId: principal.workspaceId, ...this.permissions.timeRecordAccessWhere(principal) },
      select: { id: true, projectId: true, workDate: true, legacyPendingReason: true }
    });
    if (!entry) throw new NotFoundException("Task time entry not found");
    if (entry.legacyPendingReason !== "legacy_group_in_project") throw new ConflictException("Giờ log này không thuộc nhóm cũ Họp/Khác đang chờ PM rà.");
    await this.assertTimeEntryPeriodOpen(principal.workspaceId, [entry.workDate]);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.permissions.canReclassifyTask(tx, entry.projectId, principal))) {
        throw new ForbiddenException("Chỉ PM, Dx Director, BD Lead, Workspace Admin, Founder/GM hoặc người quản lý dự án mới được rà giờ log nhóm cũ.");
      }
      await tx.taskTimeEntry.update({ where: { id: entry.id }, data: { legacyPendingReason: null } });
      await this.permissions.auditMutation(tx, principal, "task.time_entry_legacy_group_confirmed", "task_time_entry", entry.id,
        { legacyPendingReason: entry.legacyPendingReason }, { legacyPendingReason: null, decision: "kept_in_project" });
    });
    return { id: entry.id, legacyPendingReason: null };
  }

  /**
   * D-09 / D-13 extension point: minutes of approved personal leave that reduce a person's daily cap.
   * The source is PersonalLeave, synced from the Lark leave Approval flow (lark-integration/personal-leave.ts).
   */
  private async approvedPersonalLeaveMinutes(client: Prisma.TransactionClient, workspaceId: string, userId: string, localDate: string, standardMinutes?: number): Promise<number> {
    return approvedPersonalLeaveMinutes(client, workspaceId, userId, localDate, standardMinutes);
  }

  /** 7.6 "Giờ chuẩn một ngày" as the Admin stored it for the workspace (read per request, not at import time). */
  private async standardDayMinutes(client: Prisma.TransactionClient, workspaceId: string) {
    return Math.round((await getStoredParameter(client, workspaceId, "standardDayHours")) * 60);
  }

  /** D-13: standard minutes a person may plan or log on a day = the daily cap minus approved personal leave. */
  async standardDayCapMinutes(client: Prisma.TransactionClient, workspaceId: string, userId: string, localDate: string) {
    const standardMinutes = await this.standardDayMinutes(client, workspaceId);
    return Math.max(0, standardMinutes - await this.approvedPersonalLeaveMinutes(client, workspaceId, userId, localDate, standardMinutes));
  }

  /** Why a plan or a log does not fit the day: approved full-day leave has its own message; otherwise the day's standard hours. */
  private dayCapMessage(capMinutes: number, kind: "plan" | "log", usedMinutes: number) {
    return dayCapMessage(capMinutes, kind, usedMinutes);
  }

  private assertCanMaterializePlanningActual(userId: string, principal: PrincipalContext) {
    if (userId === principal.subjectId) {
      return;
    }
    if (!principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Chỉ người được lập kế hoạch, Founder/GM, Workspace Admin hoặc Delivery Lead mới được hoàn thành kế hoạch của người khác.");
    }
  }

  private assertCanDeletePlanningBlock(userId: string, principal: PrincipalContext) {
    if (userId === principal.subjectId) {
      return;
    }
    if (!principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Chỉ người được lập kế hoạch, Founder/GM, Workspace Admin hoặc Delivery Lead mới được xóa khối kế hoạch này.");
    }
  }

  private async promoteTaskForActualWork(tx: Prisma.TransactionClient, input: {
    taskId: string;
    workspaceId: string;
    changedByUserId?: string;
    occurredAt: Date;
  }) {
    const tasks = await tx.$queryRaw<Array<{
      id: string;
      workspaceId: string;
      accountId: string;
      projectId: string | null;
      status: string;
      startedAt: Date | null;
    }>>`
      SELECT "id", "workspaceId", "accountId", "projectId", "status", "startedAt"
      FROM "ProjectTask"
      WHERE "id" = ${input.taskId}
        AND "workspaceId" = ${input.workspaceId}
      FOR UPDATE
    `;
    const task = tasks[0];
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    if (!shouldPromoteTaskToInProgress(task.status)) {
      return;
    }

    await tx.taskStatusHistory.create({
      data: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        accountId: task.accountId,
        projectId: task.projectId,
        fromStatus: task.status,
        toStatus: "in_progress",
        changedByUserId: input.changedByUserId,
        changedAt: input.occurredAt,
        reason: "Đã ghi giờ thực tế"
      }
    });

    await tx.projectTask.update({
      where: { id: task.id },
      data: {
        status: "in_progress",
        startedAt: task.startedAt ?? input.occurredAt
      }
    });
  }
}
