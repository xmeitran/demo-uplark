import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { Prisma } from "@prisma/client";
import type {
  CreateProjectInput,
  CreateProjectMilestoneInput,
  ProjectCloseReasonCode,
  CreateProjectMilestoneTemplateInput,
  ProjectPlanPreviewInput,
  CreateProjectActivityInput,
  CreateProjectDocumentInput,
  CreateProjectDocumentVersionInput,
  CreateProjectRiskInput,
  CreateProjectStageInput,
  CreateProjectTaskInput,
  CreateTaskTimeEntryResponse,
  ProjectHierarchyOrderInput,
  ProjectHierarchyOrderKind,
  CreateTaskAttachmentInput,
  CreateTaskCommentInput,
  CreateTaskPlanningBlockInput,
  CreateTaskTimeEntryInput,
  PrincipalContext,
  ReviewTaskTimeEntryInput,
  TransitionProjectTaskInput,
  TransitionTaskPlanningBlockInput,
  UpdateProjectActivityInput,
  UpdateProjectDocumentInput,
  UpdateProjectInput,
  UpdateProjectMilestoneTemplateInput,
  UpdateProjectRiskInput,
  UpdateProjectStageInput,
  UpdateProjectTaskInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  buildPaginationMeta,
  nonEmptyString,
  normalizePagination,
  optionalBoolean,
  optionalDate,
  optionalInteger,
  optionalNumber,
  optionalString
} from "../../shared/http/request-context";
import {
  mapProjectActivitySummary,
  mapProjectDocumentSummary,
  mapProjectStageSummary,
  mapProjectSummary,
  deriveProjectMemberEmploymentStatus,
  mapTaskAttachmentSummary,
  mapTaskCommentSummary,
  mapTaskSummary
} from "./delivery.mapper";
import { DEFAULT_PROJECT_STAGE_TEMPLATE, PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";
import { dateOnlyToUtcDate, getLocalDateKeysForTimeRange, lockWorkspaceDayOffDates } from "../workspace-calendar/day-off-time";
import { CLOSED_WORK_STATUSES, isCancelledTaskStatus, isCompletedTaskStatus } from "./task-status";
import {
  countMilestoneEvidence,
  effectiveMilestoneRequiredDocumentCount
} from "./milestone-evidence";
import {
  isWorkspaceAdmin,
  DEFAULT_MILESTONE_REVIEWER_MODE,
  normalizeMilestoneReviewerMode
} from "./milestone-reviewer";
import { INTERNAL_WORKLOG_PROJECT_TYPE, ISSUE_LOG_TYPES, PROJECT_TYPE_LABELS, can, isAdminAccount } from "@b2b-crm/contracts";
import { canSeeProject, projectPmUserId, visibleProjectWhere, withoutProjectFinancials } from "./project-visibility";
import { buildRuleBasedProjectPlan } from "./project-plan-rules";
import { canCloseProject, canReopenProject, isKnownProjectStatus, normalizeProjectStatus, projectStatusFilterValues, validateProjectStatusChange, PROJECT_STATUS_ALIASES, PROJECT_STATUS_CATALOGUE } from "./project-status";
import { deriveMemberParticipation, NON_ACTUAL_TIME_ENTRY_STATUSES, participationWindow } from "./member-participation";
import { projectLifecycleHooks } from "../lark-integration/lark-hooks";
import { ResourceControlsService } from "../resource-controls/resource-controls.service";
import { canEditProjectSetup, canViewCost } from "../resource-controls/cost-permissions";
import { deriveTaskTypeLayer2, isInternalWorklogProjectType, isTaskTypeLayer1, resolveTaskTypeLayer1, taskTypeLayer1Label, taskTypeLayer2Label } from "./task-classification";
import { closeProjectWarnings, isWarningSuppressed, MANUAL_CLOSE_ACTION, mapProjectWarning, openOrRefreshProjectWarning, rearmManuallyClosedWarning } from "./project-warnings";
import type { IssueLogTransitionInput } from "@b2b-crm/contracts";
import { baselineChangeBlocker } from "./baseline";
import { isBaselineLocked, recordBaselineChange, syncEstimateNotices } from "./baseline.service";
import { createIssueLogRecord, issueLogInclude, loadIssueLogRecord, mapIssueLogRecord, refreshProjectIssueLogWarnings, transitionIssueLogRecord, updateIssueLogRecord } from "./issue-log.service";
import type { DecideProjectStatusProposalInput, ProjectGateActionInput, UpdateTaskTimeEntryLayer2Input } from "@b2b-crm/contracts";
import { isStartedStageStatus } from "./gates";
import { AUTOMATIC_PROJECT_STATUSES } from "./status-proposal";
import { actOnProjectGate, assertStageGateOpen, createProjectGate, decideStatusProposal, listProjectGates, pendingStatusProposal, projectIdsWithPendingProposal, loadProjectGatePosition, projectUsesStageGates, syncProjectStatus, type StatusSyncContext } from "./gates.service";
import { PROJECT_HIERARCHY_EDIT_ROLE_CODES, BUILTIN_MILESTONE_TEMPLATE_KEY, TASK_PLAN_APPROVER_ROLES, workspaceDayOffMessage, taskPlanningBlockInclude, taskTimeEntryInclude, isPrismaWriteConflict, normalizeMilestoneEvidenceMode, mapMilestoneGateSummary, omitUndefined, hasInputKey, optionalEnum, validateTaskEstimateMinutes, templateTaskTypeLayer1, assertTaskTypePair, normalizeTemplateTasks, normalizeMilestoneTemplateMilestones } from "./projects.shared";
import { PROJECT_MANAGE_FORBIDDEN_MESSAGE, ProjectPermissionsService } from "./project-permissions.service";
import { TimeEntriesService } from "./time-entries.service";
import { MilestoneGatesService } from "./milestone-gates.service";
import { TaskClassificationService } from "./task-classification.service";
import { ProjectTemplatesService } from "./project-templates.service";
export { MAX_TASK_ESTIMATE_MINUTES } from "./projects.shared"; // kept for existing importers
export { validateTaskEstimateMinutes } from "./projects.shared"; // kept for existing importers
export { buildSpreadsheetTemplateDraft } from "./project-templates.service"; // kept for existing importers

const projectInclude = {
  account: true,
  opportunity: true,
  members: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          avatarUrl: true,
          status: true,
          resourceProfile: { select: { employmentStatus: true } }
        }
      }
    },
    orderBy: { createdAt: "asc" as const }
  },
  budgets: {
    orderBy: { updatedAt: "desc" as const },
    take: 1
  },
  costs: {
    select: {
      amount: true
    }
  },
  stages: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    select: {
      status: true,
      progressPercent: true,
      cumulativePercent: true,
      scopeSummary: true,
      ownerUserId: true,
      owner: {
        select: {
          displayName: true,
          avatarUrl: true
        }
      },
      plannedStartAt: true,
      plannedEndAt: true,
      actualStartAt: true,
      actualEndAt: true
    }
  },
  tasks: {
    where: {
      archivedAt: null
    },
    select: {
      assigneeUserId: true,
      ownerUserId: true,
      taskAssignees: { select: { userId: true } },
      status: true,
      estimateMinutes: true,
      timeEntries: {
        select: {
          minutes: true,
          approvalStatus: true
        }
      }
    }
  }
};

function projectIncludeForPrincipal(principal: PrincipalContext) {
  return { ...projectInclude, members: { ...projectInclude.members,
    where: { workspaceId: principal.workspaceId }
  } };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

const stageInclude = {
  account: true,
  project: true,
  milestone: true,
  owner: true
};

const projectDocumentInclude = {
  account: true,
  project: true,
  milestone: { select: { id: true, name: true, sortOrder: true, gateStatus: true } },
  versions: {
    include: { fileObject: true, createdBy: true },
    orderBy: { version: "asc" as const }
  }
};

const projectActivityInclude = {
  account: true,
  project: true,
  createdBy: true
};

type ProjectDeleteBlocker = {
  label: string;
  count: number;
};

type DeleteStageOptions = {
  scope?: string;
};

type UpdateStageOptions = {
  scope?: string;
};
type TaskAssigneeClient = Pick<Prisma.TransactionClient, "projectTaskAssignee">;

type ProjectActivityFeedItem = {
  id: string;
  accountId: string;
  account?: { name?: string | null } | null;
  accountName?: string;
  projectId: string;
  project?: { name?: string | null } | null;
  projectName?: string;
  activityType: string;
  subject: string;
  note?: string | null;
  target?: string | null;
  occurredAt: Date;
  occurredTime?: string;
  actionLabel?: string;
  fromValue?: string;
  toValue?: string;
  entityType?: string;
  entityId?: string;
  status: string;
  createdByUserId?: string | null;
  createdBy?: {
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};
const COMMENT_VISIBILITIES = new Set(["internal", "customer"]);
const COMMENT_STATUSES = new Set(["active", "deleted"]);
const WORKSPACE_DAY_OFF_OVERRIDE_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);
const PROJECT_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const CANONICAL_PROJECT_ACTIVITY_TYPES = new Set(["work_logged", "work_planned", "task_status_changed"]);
const ACTIVITY_DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";
const TASK_ARCHIVE_STATUS = "archived";

/** Only for a task's planned date range. Planning blocks and time logs are blocked on a day off for everyone (D-09). */
function canOverrideWorkspaceDayOff(principal: PrincipalContext) {
  return principal.roleCodes.some((roleCode) => WORKSPACE_DAY_OFF_OVERRIDE_ROLES.has(roleCode));
}

const taskInclude = {
  account: true,
  project: true,
  stage: { include: { milestone: true } },
  owner: true,
  assignee: true,
  taskAssignees: {
    include: { user: true },
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }]
  },
  ownerTeam: true,
  archivedBy: true,
  statusHistory: { orderBy: { changedAt: "desc" as const }, take: 20 },
  timeEntries: { include: { user: true, dayOff: true }, orderBy: { workDate: "desc" as const }, take: 100 }
};

const portalTaskInclude = {
  account: true,
  project: true,
  stage: { include: { milestone: true } },
  owner: true,
  assignee: true,
  taskAssignees: {
    include: { user: true },
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }]
  },
  ownerTeam: true,
  archivedBy: true,
  statusHistory: { orderBy: { changedAt: "desc" as const }, take: 20 }
};

const taskDetailInclude = {
  ...taskInclude,
  planningBlocks: {
    include: {
      account: { select: { name: true } },
      project: { select: { name: true } },
      user: { select: { displayName: true, email: true, avatarUrl: true } }
    },
    orderBy: [{ startAt: "desc" as const }, { createdAt: "desc" as const }],
    take: 100
  },
  subtasks: {
    include: taskInclude,
    where: { archivedAt: null },
    orderBy: [{ completedAt: "asc" as const }, { createdAt: "asc" as const }]
  }
};

const portalTaskDetailInclude = {
  ...portalTaskInclude,
  subtasks: {
    include: portalTaskInclude,
    where: { archivedAt: null, customerVisible: true },
    orderBy: [{ completedAt: "asc" as const }, { createdAt: "asc" as const }]
  }
};

const taskCommentInclude = {
  createdBy: true
};

const taskAttachmentInclude = {
  fileObject: true
};

function shouldIncludeArchivedTasks(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "include"].includes(normalized);
}

function buildProjectStatusWhere(statuses: string[]): Prisma.ProjectWhereInput {
  if (statuses.length === 1) {
    return { status: { equals: statuses[0], mode: "insensitive" } };
  }

  return {
    OR: statuses.map((status) => ({
      status: { equals: status, mode: "insensitive" }
    }))
  };
}

/** One comma-joined query value as trimmed, unique, non-empty items (at most 50). */
function csvFilter(value: unknown, fieldName: string) {
  return Array.from(new Set((optionalString(value, fieldName) ?? "").split(",").map((item) => item.trim()).filter(Boolean))).slice(0, 50);
}

/** `from` / `to` of the project list: inclusive Asia/Ho_Chi_Minh days (YYYY-MM-DD), either may be left out. */
function projectPeriodFilter(query: any): { from: Date | null; to: Date | null } | null {
  const day = (value: unknown, fieldName: string, time: string) => {
    const text = optionalString(value, fieldName)?.trim();
    if (!text) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T${time}+07:00`) : new Date(NaN);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${fieldName} phải có dạng YYYY-MM-DD.`);
    return date;
  };
  const from = day(query?.from, "from", "00:00:00.000");
  const to = day(query?.to, "to", "23:59:59.999");
  if (from && to && to < from) throw new BadRequestException("to phải sau hoặc bằng from.");
  return from || to ? { from, to } : null;
}

function participationPeriod(query: any) {
  const start = optionalDate(query?.startDate, "startDate");
  const end = optionalDate(query?.endDate, "endDate");
  if (!start || !end) throw new BadRequestException("startDate và endDate là bắt buộc.");
  if (end < start) throw new BadRequestException("endDate phải sau hoặc bằng startDate.");
  // Whole Asia/Ho_Chi_Minh days; `end` is exclusive.
  return participationWindow(start, end);
}

/** Last instant covered by a participation period, for echoing the inclusive endDate back to the caller. */
function periodEndInclusive(period: { end: Date }) {
  return new Date(period.end.getTime() - 1).toISOString();
}

function sameInstant(left: Date | null | undefined, right: Date | null | undefined) {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

/**
 * A project that was used keeps its history (tasks, hours, issue log, activity), so it is closed, never deleted.
 * `code` lets the UI offer "Đóng dự án" instead of a dead end.
 */
export const PROJECT_HAS_RECORDS_CODE = "PROJECT_HAS_RECORDS";
function projectHasRecordsError(details?: string) {
  return {
    statusCode: 400,
    error: "Bad Request",
    code: PROJECT_HAS_RECORDS_CODE,
    message: "Dự án đã có dữ liệu vận hành (task, giờ log, tài liệu, sổ vấn đề, lịch sử hoạt động…) nên không xóa được. Hãy đóng dự án (trạng thái Đã đóng, có lý do) thay vì xóa.",
    ...(details ? { details } : {})
  };
}

function formatDeleteBlockers(blockers: ProjectDeleteBlocker[]) {
  return blockers.map(blocker => `${blocker.count} ${blocker.label}`).join(", ");
}

function isPrismaForeignKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2003";
}

function isPrismaSerializationConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const prismaError = error as { code?: string; meta?: { code?: string } };
  return prismaError.code === "P2034"
    || (prismaError.code === "P2010" && prismaError.meta?.code === "40001");
}

export function parseProjectHierarchyOrderInput(raw: ProjectHierarchyOrderInput): ProjectHierarchyOrderInput {
  if (!raw || typeof raw !== "object") {
    throw new BadRequestException("Hierarchy order input is required");
  }
  const kind = raw.kind;
  if (!["milestone", "stage", "task"].includes(kind)) {
    throw new BadRequestException("kind must be milestone, stage, or task");
  }
  if (raw.parentId !== null && typeof raw.parentId !== "string") {
    throw new BadRequestException("parentId must be a string or null");
  }
  if (!Array.isArray(raw.orderedIds) || raw.orderedIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new BadRequestException("orderedIds must be an array of non-empty IDs");
  }
  if (!Number.isInteger(raw.expectedVersion) || raw.expectedVersion < 0) {
    throw new BadRequestException("expectedVersion must be a non-negative integer");
  }
  if (kind === "milestone" && raw.parentId !== null) {
    throw new BadRequestException("parentId must be null when kind is milestone");
  }
  if (kind !== "milestone" && !raw.parentId?.trim()) {
    throw new BadRequestException("parentId is required for stage and task ordering");
  }

  return {
    kind,
    parentId: raw.parentId,
    orderedIds: raw.orderedIds.map((id) => id.trim()),
    expectedVersion: raw.expectedVersion
  };
}

export function assertCompleteHierarchyPermutation(currentIds: string[], orderedIds: string[]) {
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new BadRequestException("orderedIds must not contain duplicates");
  }
  if (currentIds.length !== orderedIds.length) {
    throw new BadRequestException("orderedIds must contain the complete sortable sibling set");
  }
  const currentSet = new Set(currentIds);
  if (orderedIds.some((id) => !currentSet.has(id))) {
    throw new BadRequestException("orderedIds contains an item outside the requested sibling scope");
  }
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeMilestoneName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new BadRequestException("phase must not be blank");
  }
  return normalized;
}

function normalizeMilestoneKey(value: string) {
  return normalizeMilestoneName(value).toLocaleLowerCase("en-US");
}

function buildLegacyMilestoneTemplate() {
  const grouped = new Map<string, { name: string; sortOrder: number; stages: any[] }>();
  for (const stage of DEFAULT_PROJECT_STAGE_TEMPLATE) {
    const name = normalizeMilestoneName(stage.phase);
    const key = normalizeMilestoneKey(name);
    const current = grouped.get(key) ?? { name, sortOrder: (grouped.size + 1) * 10, stages: [] };
    current.stages.push(stage);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).map((milestone) => ({
    ...milestone,
    requiredDocumentCount: 0,
    requiredDocumentTypes: [],
    customerConfirmationRequired: false,
    stages: milestone.stages.map((stage) => ({ ...stage }))
  }));
}

function normalizeManualMilestones(input: unknown) {
  if (!Array.isArray(input)) {
    throw new BadRequestException("manualMilestones must be an array");
  }
  return input.map((raw, milestoneIndex) => {
    if (!raw || typeof raw !== "object") {
      throw new BadRequestException(`manualMilestones[${milestoneIndex}] is invalid`);
    }
    const milestone = raw as Record<string, unknown>;
    const name = normalizeMilestoneName(String(milestone.name ?? ""));
    const stages = milestone.stages;
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new BadRequestException(`Milestone "${name}" must contain at least one stage`);
    }
    const requiredDocumentTypes = Array.isArray(milestone.requiredDocumentTypes)
      ? milestone.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
      : [];
    const configuredRequiredDocumentCount = optionalInteger(milestone.requiredDocumentCount, `manualMilestones[${milestoneIndex}].requiredDocumentCount`) ?? 0;
    if (configuredRequiredDocumentCount < 0) {
      throw new BadRequestException("requiredDocumentCount must be non-negative");
    }
    const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount({
      requiredDocumentCount: configuredRequiredDocumentCount,
      requiredDocumentTypes
    });
    const reviewerMode = normalizeMilestoneReviewerMode(milestone.reviewerMode);
    const reviewerUserId = optionalString(milestone.reviewerUserId, `manualMilestones[${milestoneIndex}].reviewerUserId`) ?? undefined;
    if (reviewerMode === "specific_user" && !reviewerUserId) {
      throw new BadRequestException(`Milestone "${name}" needs a reviewerUserId when reviewerMode is specific_user`);
    }
    return {
      name,
      sortOrder: optionalInteger(milestone.sortOrder, `manualMilestones[${milestoneIndex}].sortOrder`) ?? (milestoneIndex + 1) * 10,
      requiredDocumentCount,
      requiredDocumentTypes,
      evidenceMode: normalizeMilestoneEvidenceMode(milestone.evidenceMode),
      ownerTeamId: optionalString(milestone.ownerTeamId, `manualMilestones[${milestoneIndex}].ownerTeamId`) ?? undefined,
      unlockCriteria: optionalString(milestone.unlockCriteria, `manualMilestones[${milestoneIndex}].unlockCriteria`) ?? undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerMode,
      reviewerUserId,
      reviewerRole: optionalString(milestone.reviewerRole, `manualMilestones[${milestoneIndex}].reviewerRole`) ?? undefined,
      stages: stages.map((stageRaw, stageIndex) => {
        if (!stageRaw || typeof stageRaw !== "object") {
          throw new BadRequestException(`Milestone "${name}" stage ${stageIndex + 1} is invalid`);
        }
        const stage = stageRaw as Record<string, unknown>;
        const activity = nonEmptyString(String(stage.activity ?? ""), `manualMilestones[${milestoneIndex}].stages[${stageIndex}].activity`);
        return {
          stageKey: optionalString(stage.stageKey, "stageKey") ?? `${normalizeMilestoneKey(name)}-${stageIndex + 1}`,
          phase: optionalString(stage.phase, "phase") ?? activity,
          activity,
          sortOrder: optionalInteger(stage.sortOrder, "sortOrder") ?? (stageIndex + 1) * 10,
          cumulativePercent: optionalInteger(stage.cumulativePercent, "cumulativePercent") ?? 0,
          activityPercent: optionalInteger(stage.activityPercent, "activityPercent") ?? 0,
          criteria: optionalString(stage.criteria, "criteria") ?? "Stage completion criteria",
          upbaseRole: optionalString(stage.upbaseRole, "upbaseRole") ?? undefined,
          customerRole: optionalString(stage.customerRole, "customerRole") ?? undefined,
          taskTypeLayer1: templateTaskTypeLayer1(stage.taskTypeLayer1, `manualMilestones[${milestoneIndex}].stages[${stageIndex}].taskTypeLayer1`),
          afterPnlClose: typeof stage.afterPnlClose === "boolean" ? stage.afterPnlClose : undefined,
          tasks: normalizeTemplateTasks(stage.tasks, `manualMilestones[${milestoneIndex}].stages[${stageIndex}].tasks`)
        };
      })
    };
  });
}

export function isLegacyMilestonePlaceholder(input: {
  activity: string;
  phase: string;
  milestoneName: string;
  activeTaskCount: number;
}) {
  if (input.activeTaskCount > 0) {
    return false;
  }
  const activity = normalizeMilestoneKey(input.activity);
  return activity === normalizeMilestoneKey(input.phase)
    || activity === normalizeMilestoneKey(input.milestoneName);
}

/** The "Loại dự án" filter of the list: the stored type. Nội bộ also covers the fixed DX Internal Worklog project. */
function buildProjectCategoryWhere(category: string): Prisma.ProjectWhereInput {
  const normalized = category.trim().toLowerCase().replace(/[_\s-]+/g, "_");
  return { projectType: { in: normalized === "internal" ? ["internal", INTERNAL_WORKLOG_PROJECT_TYPE] : [normalized] } };
}

function assertTaskDateRange(plannedStartAt?: Date | null, dueAt?: Date | null) {
  if (plannedStartAt && dueAt && plannedStartAt > dueAt) {
    throw new BadRequestException("Ngày bắt đầu không được sau ngày kết thúc / hạn hoàn tất. Hãy chọn lại hai ngày.");
  }
}

function optionalStringArray(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an array`);
  }

  const seen = new Set<string>();
  for (const item of value) {
    const normalized = optionalString(item, fieldName);
    if (typeof normalized === "string") {
      seen.add(normalized);
    }
  }
  return Array.from(seen);
}

function normalizeProjectType(value: unknown) {
  const normalized = optionalString(value, "projectType");
  if (normalized === undefined || normalized === null) {
    return normalized;
  }
  return normalized.toLowerCase().replace(/[_\s-]+/g, "_");
}

/** V-01: Loại dự án is required — Khách hàng, Nội bộ or Đào tạo (the fixed worklog project keeps its own kind). */
function requireProjectType(value: unknown) {
  const normalized = normalizeProjectType(value);
  if (!normalized || !(Object.prototype.hasOwnProperty.call(PROJECT_TYPE_LABELS, normalized) || normalized === INTERNAL_WORKLOG_PROJECT_TYPE)) {
    throw new BadRequestException(`Chọn Loại dự án: ${Object.values(PROJECT_TYPE_LABELS).join(", ")}.`);
  }
  return normalized;
}

function normalizeProjectTags(value: unknown) {
  const tags = optionalStringArray(value, "tags");
  if (tags === undefined) return undefined;
  const normalized = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  if (normalized.length > 20) {
    throw new BadRequestException("tags cannot contain more than 20 values");
  }
  if (normalized.some((tag) => tag.length > 40)) {
    throw new BadRequestException("each tag must be 40 characters or fewer");
  }
  return normalized;
}

function normalizeProjectColor(value: unknown) {
  const color = optionalString(value, "color");
  if (color === undefined || color === null) return color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new BadRequestException("color must be a 6-digit hex value");
  }
  return color.toLowerCase();
}

function stageKeyFromActivity(activity: string) {
  return activity
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "stage";
}

function formatActivityTimeHHmm(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ACTIVITY_DISPLAY_TIME_ZONE
  }).format(date);
}

function humanizeActivityToken(value?: string | null) {
  if (!value) {
    return "Empty";
  }

  const map: Record<string, string> = {
    todo: "To do",
    not_started: "Not started",
    in_progress: "In progress",
    progress: "In progress",
    done: "Done",
    completed: "Completed",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    blocked: "Blocked",
    paused: "Paused",
    on_hold: "On hold",
    urgent: "Urgent",
    high: "High",
    medium: "Medium",
    low: "Low",
    planned: "Planned",
    submitted: "Submitted",
    approved: "Approved",
    rejected: "Rejected",
    delivery: "Delivery",
    internal: "Internal",
    customer: "Customer"
  };
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return map[normalized] ?? value.trim().replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMinutesLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "0m";
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${remainingMinutes}m`;
}

function compareActivityFeedItemsDesc(left: ProjectActivityFeedItem, right: ProjectActivityFeedItem) {
  const occurredDiff = right.occurredAt.getTime() - left.occurredAt.getTime();
  if (occurredDiff !== 0) {
    return occurredDiff;
  }
  return right.createdAt.getTime() - left.createdAt.getTime();
}

function mapStatusHistoryToProjectActivity(history: any): ProjectActivityFeedItem {
  const occurredAt = new Date(history.changedAt);
  const fromValue = humanizeActivityToken(history.fromStatus);
  const toValue = humanizeActivityToken(history.toStatus);
  const taskTitle = history.task?.title ?? "Task";
  const time = formatActivityTimeHHmm(occurredAt);

  return {
    id: `task-status:${history.id}`,
    accountId: history.accountId,
    account: history.task?.account ?? null,
    projectId: history.projectId,
    project: history.task?.project ?? null,
    activityType: "task_status_changed",
    subject: `Changed task status: ${taskTitle}`,
    note: [`${time ?? "--:--"} - Status changed from ${fromValue} to ${toValue}`, history.reason].filter(Boolean).join("\n"),
    target: `${fromValue} -> ${toValue}`,
    occurredAt,
    occurredTime: time,
    actionLabel: "Status changed",
    fromValue,
    toValue,
    entityType: "task",
    entityId: history.taskId,
    status: "active",
    createdByUserId: history.changedByUserId,
    createdBy: history.changedBy ?? null,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}

function mapTimeEntryToProjectActivity(entry: any): ProjectActivityFeedItem {
  const occurredAt = new Date(entry.startAt ?? entry.workDate);
  const taskTitle = entry.task?.title ?? "Task";
  const minutesLabel = formatMinutesLabel(entry.minutes);
  const workType = humanizeActivityToken(entry.workType);
  const time = formatActivityTimeHHmm(occurredAt);
  const endTime = entry.endAt ? formatActivityTimeHHmm(entry.endAt) : undefined;
  const timeWindow = endTime ? `${time ?? "--:--"}-${endTime}` : time ?? "--:--";

  return {
    id: `task-time:${entry.id}`,
    accountId: entry.accountId,
    account: entry.task?.account ?? null,
    projectId: entry.projectId,
    project: entry.task?.project ?? null,
    activityType: "work_logged",
    subject: `Đã ghi giờ thực tế: ${taskTitle}`,
    note: [`${timeWindow} - Ghi ${minutesLabel} giờ thực tế (${workType})`, entry.note].filter(Boolean).join("\n"),
    target: `${minutesLabel} - ${taskTitle}`,
    occurredAt,
    occurredTime: time,
    actionLabel: "Đã ghi giờ thực tế",
    entityType: "task",
    entityId: entry.taskId,
    status: "active",
    createdByUserId: entry.userId,
    createdBy: entry.user ?? null,
    createdAt: entry.createdAt ? new Date(entry.createdAt) : occurredAt,
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : occurredAt
  };
}

function mapPlanningBlockToProjectActivity(block: any): ProjectActivityFeedItem {
  const occurredAt = new Date(block.startAt);
  const taskTitle = block.task?.title ?? block.title ?? "Task";
  const minutesLabel = formatMinutesLabel(block.plannedMinutes);
  const fromTime = formatActivityTimeHHmm(block.startAt);
  const toTime = formatActivityTimeHHmm(block.endAt);

  return {
    id: `task-plan:${block.id}`,
    accountId: block.accountId,
    account: block.account ?? block.task?.account ?? null,
    projectId: block.projectId,
    project: block.project ?? block.task?.project ?? null,
    activityType: "work_planned",
    subject: `Planned work: ${taskTitle}`,
    note: [`${fromTime ?? "--:--"}-${toTime ?? "--:--"} - Planned ${minutesLabel}`, block.notes].filter(Boolean).join("\n"),
    target: `${minutesLabel} - ${taskTitle}`,
    occurredAt,
    occurredTime: fromTime,
    actionLabel: "Planned work",
    entityType: "task",
    entityId: block.taskId,
    status: "active",
    createdByUserId: block.createdByUserId ?? block.userId,
    createdBy: block.user ?? null,
    createdAt: block.createdAt ? new Date(block.createdAt) : occurredAt,
    updatedAt: block.updatedAt ? new Date(block.updatedAt) : occurredAt
  };
}

function mapStoredProjectActivityToFeedItem(activity: any): ProjectActivityFeedItem {
  const occurredAt = new Date(activity.occurredAt);
  const createdAt = activity.createdAt ? new Date(activity.createdAt) : occurredAt;

  return {
    ...activity,
    occurredAt,
    occurredTime: formatActivityTimeHHmm(occurredAt),
    actionLabel: activity.actionLabel ?? humanizeActivityToken(activity.activityType),
    createdAt,
    updatedAt: activity.updatedAt ? new Date(activity.updatedAt) : createdAt
  };
}

@Injectable()
export class ProjectsService {
  // The focused services this class was split into. Nest injects them; a hand-built instance (specs, scripts/operations) builds its own.
  private readonly permissions: ProjectPermissionsService;
  private readonly timeEntries: TimeEntriesService;
  private readonly milestoneGates: MilestoneGatesService;
  private readonly classification: TaskClassificationService;
  private readonly templates: ProjectTemplatesService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(NotificationsService) private readonly notifications?: NotificationsService,
    // D-28: the cost-period lock (time entries of a locked period are frozen). Optional only for unit specs.
    @Optional() @Inject(ResourceControlsService) private readonly costPeriods?: ResourceControlsService,
    @Optional() @Inject(ProjectPermissionsService) permissions?: ProjectPermissionsService,
    @Optional() @Inject(TimeEntriesService) timeEntries?: TimeEntriesService,
    @Optional() @Inject(MilestoneGatesService) milestoneGates?: MilestoneGatesService,
    @Optional() @Inject(TaskClassificationService) classification?: TaskClassificationService,
    @Optional() @Inject(ProjectTemplatesService) templates?: ProjectTemplatesService
  ) {
    this.permissions = permissions ?? new ProjectPermissionsService(prisma, notifications, costPeriods);
    this.timeEntries = timeEntries ?? new TimeEntriesService(prisma, this.permissions, costPeriods);
    this.milestoneGates = milestoneGates ?? new MilestoneGatesService(prisma, this.permissions, notifications);
    this.classification = classification ?? new TaskClassificationService(prisma, this.permissions, this.timeEntries);
    this.templates = templates ?? new ProjectTemplatesService(prisma, this.permissions);
  }

  async listProjects(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    // Multi-select filters arrive as one comma-joined value each; a single value still works.
    const accountIds = csvFilter(query.accountId, "accountId");
    const ownerUserIds = csvFilter(query.ownerUserId, "ownerUserId");
    const statusAliases = Array.from(new Set(csvFilter(query.status, "status").flatMap((status) => projectStatusFilterValues(status) ?? [])));
    const categories = csvFilter(query.category, "category");
    const period = projectPeriodFilter(query);
    const search = optionalString(query.q ?? query.search, "q");
    const andFilters: Prisma.ProjectWhereInput[] = [];

    if (search) {
      andFilters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { account: { name: { contains: search, mode: "insensitive" } } },
          { opportunity: { is: { title: { contains: search, mode: "insensitive" } } } }
        ]
      });
    }

    if (categories.length === 1) {
      andFilters.push(buildProjectCategoryWhere(categories[0]));
    } else if (categories.length > 1) {
      andFilters.push({ OR: categories.map(buildProjectCategoryWhere) });
    }

    if (statusAliases.length > 0) {
      andFilters.push(buildProjectStatusWhere(statusAliases));
    }

    if (period) {
      // Project has no date columns: its period is the earliest stage start to the latest stage end, the same
      // dates mapProjectSummary returns as plannedStartAt / plannedEndAt. A missing start or end is open-ended.
      // Columns are UTC `timestamp`s; AT TIME ZONE 'UTC' keeps the comparison independent of the session time zone.
      const startsBy = period.to ? Prisma.sql`(MIN(COALESCE(s."actualStartAt", s."plannedStartAt")) IS NULL OR MIN(COALESCE(s."actualStartAt", s."plannedStartAt")) AT TIME ZONE 'UTC' <= ${period.to})` : Prisma.sql`TRUE`;
      const endsFrom = period.from ? Prisma.sql`(MAX(COALESCE(s."actualEndAt", s."plannedEndAt")) IS NULL OR MAX(COALESCE(s."actualEndAt", s."plannedEndAt")) AT TIME ZONE 'UTC' >= ${period.from})` : Prisma.sql`TRUE`;
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p."id"
        FROM "Project" p
        LEFT JOIN "ProjectStage" s ON s."projectId" = p."id"
        WHERE p."workspaceId" = ${principal.workspaceId}
        GROUP BY p."id"
        HAVING ${startsBy} AND ${endsFrom}
      `;
      andFilters.push({ id: { in: rows.map((row) => row.id) } });
    }

    if (ownerUserIds.length > 0) {
      // Project has no owner column: the PIC is the owner of its first stage, in the same order mapProjectSummary and projectPermissions use.
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p."id"
        FROM "Project" p
        WHERE p."workspaceId" = ${principal.workspaceId}
          AND (
            SELECT s."ownerUserId" FROM "ProjectStage" s
            WHERE s."projectId" = p."id"
            ORDER BY s."sortOrder" ASC, s."createdAt" ASC
            LIMIT 1
          ) IN (${Prisma.join(ownerUserIds)})
      `;
      andFilters.push({ id: { in: rows.map((row) => row.id) } });
    }

    // 7.7: a User (or an Admin in user view) lists only the projects they take part in.
    const visibility = visibleProjectWhere(principal);
    if (visibility.OR) andFilters.push(visibility);

    const where: Prisma.ProjectWhereInput = {
      workspaceId: principal.workspaceId,
      ...(accountIds.length === 1 ? { accountId: accountIds[0] } : accountIds.length > 1 ? { accountId: { in: accountIds } } : {}),
      ...(andFilters.length > 0 ? { AND: andFilters } : {})
    };

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: projectIncludeForPrincipal(principal),
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.project.count({ where })
    ]);

    const openWarningCounts = await this.countOpenWarnings(principal.workspaceId, projects.map((project) => project.id));

    // 7.7: status proposals are shown to those who may confirm them (Admin, or the project's PIC), not to regular staff.
    const proposalProjectIds = principal.subjectType === "internal_user" ? await projectIdsWithPendingProposal(this.prisma, principal.workspaceId, projects.map((project) => project.id)) : new Set<string>();
    const seesProposal = (summary: { id: string; ownerUserId?: string }) => proposalProjectIds.has(summary.id) && (isWorkspaceAdmin(principal.roleCodes) || summary.ownerUserId === principal.subjectId);

    return {
      data: projects.map((project) => withoutProjectFinancials(mapProjectSummary(project), principal)).map((summary) => ({ ...summary, openWarningCount: openWarningCounts[summary.id] ?? 0, ...(seesProposal(summary) ? { hasPendingStatusProposal: true } : {}) })),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: projects.length })
      }
    };
  }
  async listMilestoneTemplates(principal: PrincipalContext) { return this.templates.listMilestoneTemplates(principal); } // kept for existing callers
  async createMilestoneTemplate(input: CreateProjectMilestoneTemplateInput, principal: PrincipalContext) { return this.templates.createMilestoneTemplate(input, principal); } // kept for existing callers
  async updateMilestoneTemplate(templateId: string, input: UpdateProjectMilestoneTemplateInput, principal: PrincipalContext) { return this.templates.updateMilestoneTemplate(templateId, input, principal); } // kept for existing callers

  async getProject(projectId: string, principal: PrincipalContext) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId, AND: [visibleProjectWhere(principal)] }, include: projectIncludeForPrincipal(principal) });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return { ...withoutProjectFinancials(mapProjectSummary(project), principal), ...(await this.projectValueFor(project.id, principal)), ...(await this.currentStatusContext(project)), ...(await this.pendingProposalFor(project.id, principal)) };
  }

  /**
   * PL-13 "Giá trị dự án" (doanh thu dự kiến) for the detail header, with the same view/edit rules as the P&L screen
   * (cost-permission holders see it, PM/Founder/Workspace Admin edit it; after G1 a change needs a reason).
   */
  private async projectValueFor(projectId: string, principal: PrincipalContext) {
    if (!canViewCost(principal) || typeof (this.prisma as any).projectPnlRecord?.findUnique !== "function") return {};
    const [record, position] = await Promise.all([
      this.prisma.projectPnlRecord.findUnique({ where: { projectId }, select: { projectValueAmount: true } }),
      loadProjectGatePosition(this.prisma, principal.workspaceId, projectId)
    ]);
    const amount = record?.projectValueAmount == null ? null : Number(record.projectValueAmount);
    return { projectValue: { amount, canEdit: canEditProjectSetup(principal), reasonRequired: position.g1Passed && amount !== null } };
  }

  /** 7.7: the pending status proposal, for those who may confirm it (PIC / PM / Admin) only. */
  private async pendingProposalFor(projectId: string, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user" || typeof (this.prisma as any).projectStatusProposal?.findFirst !== "function") return {};
    const { actor } = await this.permissions.issueLogContext(projectId, principal);
    if (!actor.isPm && !actor.isAdmin) return {};
    const proposal = await pendingStatusProposal(this.prisma, principal.workspaceId, projectId, actor);
    return proposal ? { pendingStatusProposal: proposal, hasPendingStatusProposal: true } : {};
  }

  /** Reason and start of the current status, from the latest history row that led to it. */
  private async currentStatusContext(project: { id: string; workspaceId: string; status: string }) {
    if (typeof (this.prisma as any).projectStatusHistory?.findFirst !== "function") return {};
    const [latest, openWarningCounts] = await Promise.all([
      this.prisma.projectStatusHistory.findFirst({ where: { projectId: project.id }, orderBy: { changedAt: "desc" } }),
      this.countOpenWarnings(project.workspaceId, [project.id])
    ]);
    const current = latest && latest.toStatus === (normalizeProjectStatus(project.status) ?? project.status) ? latest : null;
    return {
      statusReason: current?.reason ?? undefined,
      statusSince: current?.changedAt.toISOString(),
      closeReasonCode: current?.toStatus === "closed" ? (current.closeReasonCode as ProjectCloseReasonCode | null) ?? undefined : undefined,
      openWarningCount: openWarningCounts[project.id] ?? 0
    };
  }

  private async countOpenWarnings(workspaceId: string, projectIds: string[]): Promise<Record<string, number>> {
    if (!projectIds.length || typeof (this.prisma as any).projectWarning?.groupBy !== "function") return {};
    const rows = await this.prisma.projectWarning.groupBy({ by: ["projectId"], where: { workspaceId, projectId: { in: projectIds }, status: "open" }, _count: { _all: true } });
    return Object.fromEntries(rows.map((row) => [row.projectId, row._count._all]));
  }

  async listProjectStatusHistory(projectId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project status history is internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const rows = await this.prisma.projectStatusHistory.findMany({ where: { projectId, workspaceId: principal.workspaceId }, orderBy: { changedAt: "desc" } });
    const names = await this.userDisplayNames(rows.map((row) => row.changedByUserId));
    return {
      data: rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        fromStatus: row.fromStatus ?? undefined,
        toStatus: row.toStatus,
        reason: row.reason ?? undefined,
        closeReasonCode: (row.closeReasonCode as ProjectCloseReasonCode | null) ?? undefined,
        changedByUserId: row.changedByUserId ?? undefined,
        changedByDisplayName: row.changedByUserId ? names.get(row.changedByUserId) : undefined,
        changedAt: row.changedAt.toISOString()
      }))
    };
  }

  private async userDisplayNames(userIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
    if (!ids.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  async listProjectWarnings(projectId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project warnings are internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const status = optionalEnum(query.status, "status", new Set(["open", "closed"]));
    const warnings = await this.prisma.projectWarning.findMany({
      where: { projectId, workspaceId: principal.workspaceId, ...(status ? { status } : {}) },
      include: { events: { orderBy: { at: "asc" } } },
      // "open" sorts after "closed", so desc puts open warnings first.
      orderBy: [{ status: "desc" }, { openedAt: "desc" }]
    });
    return { data: warnings.map(mapProjectWarning) };
  }

  async projectWarningCounts(query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project warnings are internal");
    const projectIds = Array.from(new Set(String(query.projectIds ?? "").split(",").map((id) => id.trim()).filter(Boolean)));
    const rows = await this.prisma.projectWarning.groupBy({
      by: ["projectId"],
      where: { workspaceId: principal.workspaceId, status: "open", project: visibleProjectWhere(principal), ...(projectIds.length ? { projectId: { in: projectIds } } : {}) },
      _count: { _all: true }
    });
    return { data: Object.fromEntries(rows.map((row) => [row.projectId, row._count._all])) };
  }

  async closeProjectWarning(projectId: string, warningId: string, input: { reason?: string }, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project warnings are internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const reason = optionalString(input?.reason, "reason");
    if (!reason) throw new BadRequestException("Đóng cảnh báo bắt buộc phải nhập lý do.");
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.assertProjectManager(tx, projectId, principal);
      const warning = await tx.projectWarning.findFirst({ where: { id: warningId, projectId, workspaceId: principal.workspaceId } });
      if (!warning) throw new NotFoundException("Project warning not found");
      if (warning.status !== "open") throw new ConflictException("Cảnh báo này đã được đóng.");
      await closeProjectWarnings(tx, { projectId, id: warningId }, principal.subjectId, reason, MANUAL_CLOSE_ACTION);
      await this.permissions.auditMutation(tx, principal, "project.warning_closed", "project_warning", warningId, { status: "open" }, { status: "closed", closeReason: reason });
      return mapProjectWarning(await tx.projectWarning.findUniqueOrThrow({ where: { id: warningId }, include: { events: { orderBy: { at: "asc" } } } }));
    });
  }

  /** Every warning a task write can change: NL-03 for the task itself and NL-01 for members who left with open tasks. */
  private async syncTaskOwnerWarning(client: any, principal: PrincipalContext, task: { id: string; projectId: string | null; stageId?: string | null; title: string; status: string; archivedAt?: Date | null; ownerUserId: string | null; assigneeUserId: string | null }) {
    await this.syncMissingOwnerWarning(client, principal, {
      projectId: task.projectId, kind: "task", id: task.id, label: task.title, stageId: task.stageId,
      hasOwner: Boolean(task.ownerUserId || task.assigneeUserId),
      isOpen: !task.archivedAt && !CLOSED_WORK_STATUSES.includes(task.status)
    });
    if (task.projectId) await this.closeResolvedDepartedMemberWarnings(client, principal, task.projectId);
  }

  private syncStageOwnerWarning(client: any, principal: PrincipalContext, stage: { id: string; projectId: string; activity: string; status: string; ownerUserId: string | null; milestoneId?: string | null }) {
    return this.syncMissingOwnerWarning(client, principal, { projectId: stage.projectId, kind: "stage", id: stage.id, label: stage.activity, hasOwner: Boolean(stage.ownerUserId), isOpen: !CLOSED_WORK_STATUSES.includes(stage.status), stageId: stage.id, milestoneId: stage.milestoneId });
  }

  /** NL-01 closes itself once the departed member has no open task left in the project (reassigned or closed). */
  private async closeResolvedDepartedMemberWarnings(client: any, principal: PrincipalContext, projectId: string) {
    if (typeof client?.projectWarning?.findMany !== "function") return;
    const open = await client.projectWarning.findMany({ where: { projectId, typeCode: "NL-01", status: "open" }, select: { dedupeKey: true } });
    for (const warning of open ?? []) {
      const userId = String(warning.dedupeKey).slice("NL-01:".length);
      const remaining = await client.projectTask.count({
        where: { workspaceId: principal.workspaceId, projectId, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES },
          OR: [{ ownerUserId: userId }, { assigneeUserId: userId }, { taskAssignees: { some: { userId } } }] }
      });
      if (!remaining) await closeProjectWarnings(client, { projectId, dedupeKey: warning.dedupeKey }, principal.subjectId, "Task của thành viên đã được phân công lại hoặc đóng");
    }
  }

  /** NL-03 for every open task and stage of a project: used when the project leaves planning, where NL-03 is not tracked. */
  private async syncProjectMissingOwnerWarnings(client: any, principal: PrincipalContext, projectId: string) {
    if (typeof client?.projectWarning?.findFirst !== "function") return;
    const [tasks, stages] = await Promise.all([
      client.projectTask.findMany({ where: { workspaceId: principal.workspaceId, projectId, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES }, ownerUserId: null, assigneeUserId: null }, select: { id: true, projectId: true, stageId: true, title: true, status: true, archivedAt: true, ownerUserId: true, assigneeUserId: true } }),
      client.projectStage.findMany({ where: { workspaceId: principal.workspaceId, projectId, ownerUserId: null, status: { notIn: CLOSED_WORK_STATUSES } }, select: { id: true, projectId: true, activity: true, status: true, ownerUserId: true, milestoneId: true } })
    ]);
    for (const task of tasks ?? []) {
      await this.syncMissingOwnerWarning(client, principal, { projectId, kind: "task", id: task.id, label: task.title, stageId: task.stageId, hasOwner: false, isOpen: true });
    }
    for (const stage of stages ?? []) await this.syncStageOwnerWarning(client, principal, stage);
  }

  /**
   * NL-03: a running task/stage without an owner on a non-planning project. Closed as soon as an owner is set or the work is closed.
   * A warning a person closed by hand is not reopened by later edits while the work is still ownerless; it is re-armed once an owner was set.
   */
  private async syncMissingOwnerWarning(client: any, principal: PrincipalContext, target: {
    projectId?: string | null; kind: "task" | "stage"; id: string; label: string; hasOwner: boolean; isOpen: boolean; stageId?: string | null; milestoneId?: string | null;
  }) {
    if (!target.projectId || typeof client?.projectWarning?.findFirst !== "function") return;
    const dedupeKey = `NL-03:${target.kind}:${target.id}`;
    if (target.hasOwner || !target.isOpen) {
      await closeProjectWarnings(client, { projectId: target.projectId, dedupeKey }, principal.subjectId, target.hasOwner ? "Đã gán người phụ trách" : "Công việc đã đóng");
      if (target.hasOwner) await rearmManuallyClosedWarning(client, target.projectId, dedupeKey, principal.subjectId, "Đã gán người phụ trách");
      return;
    }
    const project = await client.project.findFirst({ where: { id: target.projectId, workspaceId: principal.workspaceId }, select: { status: true } });
    if (!project || normalizeProjectStatus(project.status) === "planning") return;
    if (await isWarningSuppressed(client, target.projectId, dedupeKey)) return;
    await openOrRefreshProjectWarning(client, {
      workspaceId: principal.workspaceId,
      projectId: target.projectId,
      dedupeKey,
      typeCode: "NL-03",
      severity: "high",
      title: `${target.kind === "task" ? "Task" : "Stage"} chưa có người phụ trách`,
      detail: `${target.kind === "task" ? "Task" : "Stage"} "${target.label}" đang chạy nhưng chưa có người phụ trách. Cần phân công.`,
      taskId: target.kind === "task" ? target.id : undefined,
      stageId: target.stageId,
      milestoneId: target.milestoneId,
      actorUserId: principal.subjectId
    });
  }

  async listProjectMemberParticipation(projectId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project member directory is internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const period = participationPeriod(query);
    const members = await this.prisma.projectMember.findMany({
      where: { workspaceId: principal.workspaceId, projectId },
      select: { userId: true, user: { select: { displayName: true, email: true, avatarUrl: true, status: true, resourceProfile: { select: { employmentStatus: true } } } } },
      orderBy: { createdAt: "asc" }
    });
    const unique = Array.from(new Map(members.map((member) => [member.userId, member])).values());
    const participation = await this.computeMemberParticipation(project, unique.map((member) => member.userId), period);
    return {
      data: unique.map((member) => ({
        userId: member.userId,
        displayName: member.user.displayName,
        email: member.user.email,
        avatarUrl: member.user.avatarUrl ?? undefined,
        employmentStatus: deriveProjectMemberEmploymentStatus(member.user),
        ...participation.get(member.userId)!
      })),
      meta: { projectId, projectStatus: normalizeProjectStatus(project.status) ?? project.status, startDate: period.start.toISOString(), endDate: periodEndInclusive(period) }
    };
  }

  /** EV-035: derived per request from project status, actual time entries in the period and open tasks. */
  private async computeMemberParticipation(project: { id: string; workspaceId: string; status: string }, userIds: string[], period: { start: Date; end: Date }) {
    const [entries, tasks] = userIds.length ? await Promise.all([
      this.prisma.taskTimeEntry.groupBy({
        by: ["userId"],
        where: { workspaceId: project.workspaceId, task: { projectId: project.id }, userId: { in: userIds }, workDate: { gte: period.start, lt: period.end }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } },
        _sum: { minutes: true }
      }),
      this.prisma.projectTask.findMany({
        where: { workspaceId: project.workspaceId, projectId: project.id, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES },
          OR: [{ ownerUserId: { in: userIds } }, { assigneeUserId: { in: userIds } }, { taskAssignees: { some: { userId: { in: userIds } } } }] },
        select: { ownerUserId: true, assigneeUserId: true, plannedStartAt: true, dueAt: true, taskAssignees: { select: { userId: true } } }
      })
    ]) : [[], []];
    const minutesByUser = new Map(entries.map((row) => [row.userId, row._sum.minutes ?? 0]));
    const projectStatus = normalizeProjectStatus(project.status);
    const projectOnHold = projectStatus === "on_hold";
    const projectCompleted = projectStatus === "completed";
    return new Map(userIds.map((userId) => {
      const openTasks = tasks.filter((task) => task.ownerUserId === userId || task.assigneeUserId === userId || task.taskAssignees.some((row) => row.userId === userId));
      const actualMinutes = minutesByUser.get(userId) ?? 0;
      const { state, reason } = deriveMemberParticipation({ projectOnHold, projectCompleted, actualMinutes, openTasks });
      return [userId, { participationState: state, participationReason: reason, actualMinutes, openTaskCount: openTasks.length }];
    }));
  }

  /** EV-035 "Project Active theo thành viên": projects with actual time in the period, On Hold projects listed apart. */
  async getUserProjectParticipation(query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project participation is internal");
    const userId = optionalString(query.userId, "userId") ?? principal.subjectId;
    if (userId !== principal.subjectId && !isWorkspaceAdmin(principal.roleCodes)) {
      throw new ForbiddenException("Chỉ Workspace Admin hoặc Founder/GM mới được xem mức tham gia dự án của người khác");
    }
    const period = participationPeriod(query);
    const [entries, onHoldProjects] = await Promise.all([
      this.prisma.taskTimeEntry.findMany({
        where: { workspaceId: principal.workspaceId, userId, workDate: { gte: period.start, lt: period.end }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES }, task: { projectId: { not: null } } },
        select: { minutes: true, task: { select: { projectId: true } } }
      }),
      this.prisma.project.findMany({
        where: { workspaceId: principal.workspaceId, members: { some: { userId, workspaceId: principal.workspaceId } }, ...buildProjectStatusWhere(PROJECT_STATUS_ALIASES.on_hold) },
        select: { id: true, code: true, name: true, status: true },
        orderBy: { name: "asc" }
      })
    ]);
    const minutesByProject = new Map<string, number>();
    for (const entry of entries) minutesByProject.set(entry.task.projectId!, (minutesByProject.get(entry.task.projectId!) ?? 0) + entry.minutes);
    const loggedProjects = minutesByProject.size ? await this.prisma.project.findMany({
      where: { workspaceId: principal.workspaceId, id: { in: Array.from(minutesByProject.keys()) } },
      select: { id: true, code: true, name: true, status: true },
      orderBy: { name: "asc" }
    }) : [];
    const item = (project: { id: string; code: string; name: string; status: string }) => ({ projectId: project.id, code: project.code, name: project.name, status: normalizeProjectStatus(project.status) ?? project.status });
    return {
      data: {
        userId,
        startDate: period.start.toISOString(),
        endDate: periodEndInclusive(period),
        activeProjects: loggedProjects.filter((project) => normalizeProjectStatus(project.status) !== "on_hold").map((project) => ({ ...item(project), actualMinutes: minutesByProject.get(project.id) ?? 0 })),
        onHoldProjects: onHoldProjects.map(item)
      }
    };
  }
  async createAiTemplateDraft(rawInput: any, principal: PrincipalContext) { return this.templates.createAiTemplateDraft(rawInput, principal); } // kept for existing callers

  async previewProjectPlan(rawInput: ProjectPlanPreviewInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project planning is internal");
    const input = rawInput && typeof rawInput === "object" ? rawInput : ({} as ProjectPlanPreviewInput);
    const name = nonEmptyString(input.name, "name");
    const scopeSummary = optionalString(input.scopeSummary, "scopeSummary") ?? undefined;
    const acceptanceCriteria = optionalString(input.acceptanceCriteria, "acceptanceCriteria") ?? undefined;
    const milestoneMode = input.milestoneMode === "manual" ? "manual" : "auto";

    if (milestoneMode === "manual") {
      const milestones = normalizeManualMilestones(input.manualMilestones);
      return buildRuleBasedProjectPlan(
        { name, scopeSummary, acceptanceCriteria, milestoneMode, manualMilestones: milestones },
        { key: "manual", milestones },
        "manual"
      );
    }

    const requestedTemplateKey = input.milestoneTemplateKey?.trim() || BUILTIN_MILESTONE_TEMPLATE_KEY;
    if (requestedTemplateKey === BUILTIN_MILESTONE_TEMPLATE_KEY) {
      return buildRuleBasedProjectPlan(
        { name, scopeSummary, acceptanceCriteria, milestoneMode, milestoneTemplateKey: requestedTemplateKey },
        { key: requestedTemplateKey, milestones: PILOT_PROJECT_MILESTONE_TEMPLATE as unknown as CreateProjectMilestoneInput[] },
        requestedTemplateKey
      );
    }

    const savedTemplate = await this.prisma.projectMilestoneTemplate.findFirst({
      where: { workspaceId: principal.workspaceId, key: requestedTemplateKey, status: "active" }
    });
    if (!savedTemplate) {
      throw new BadRequestException("Milestone template không tồn tại hoặc đã được lưu trữ");
    }
    const milestones = normalizeMilestoneTemplateMilestones(savedTemplate.milestones);
    return buildRuleBasedProjectPlan(
      { name, scopeSummary, acceptanceCriteria, milestoneMode, milestoneTemplateKey: requestedTemplateKey },
      { key: requestedTemplateKey, milestones },
      requestedTemplateKey
    );
  }

  async createProject(input: CreateProjectInput, principal: PrincipalContext, idempotencyKey?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Only internal users can create projects");
    const requestKey = idempotencyKey?.trim();
    if (requestKey !== undefined && (!requestKey || requestKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestKey))) throw new BadRequestException("Idempotency-Key must be 1–128 letters, digits, dot, colon, underscore or hyphen");
    const keyHash = requestKey ? createHash("sha256").update(JSON.stringify([principal.workspaceId, principal.subjectId, requestKey])).digest("hex") : undefined;
    const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
    const account = await this.ensureAccount(input.accountId, principal.workspaceId);
    const opportunityId = optionalString(input.opportunityId, "opportunityId") ?? undefined;
    if (opportunityId) {
      await this.ensureOpportunity(opportunityId, principal.workspaceId, account.id);
    }
    const code = input.code?.trim() || `${account.code}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const name = nonEmptyString(input.name, "name");
    const projectType = requireProjectType(input.projectType);
    await this.assertSingleInternalWorklog(this.prisma, principal.workspaceId, projectType);
    const scopeSummary = optionalString(input.scopeSummary, "scopeSummary") ?? undefined;
    // No PIC chosen: the creator is the PIC (and a member), otherwise a non-Admin could not manage the project they just created.
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? principal.subjectId;
    const memberUserIds = Array.from(new Set([...(optionalStringArray(input.memberUserIds, "memberUserIds") ?? []), principal.subjectId, ownerUserId]));
    const budgetAmount = optionalNumber(input.budgetAmount, "budgetAmount");
    const plannedStartAt = optionalDate(input.plannedStartAt, "plannedStartAt") ?? undefined;
    const plannedEndAt = optionalDate(input.plannedEndAt, "plannedEndAt") ?? undefined;
    assertTaskDateRange(plannedStartAt, plannedEndAt);
    const priority = optionalEnum(input.priority, "priority", PROJECT_PRIORITIES) ?? undefined;
    const tags = normalizeProjectTags(input.tags) ?? [];
    const color = normalizeProjectColor(input.color) ?? undefined;
    // 5.1: a new project always starts at "Lên kế hoạch"; a status sent by the client is ignored.
    const status = "planning";
    const statusReason = optionalString(input.statusReason, "statusReason") ?? undefined;
    const initialStatus = validateProjectStatusChange(undefined, status, statusReason);
    if (initialStatus.error) throw new BadRequestException(initialStatus.error);
    const usePilotTemplate = input.milestoneMode !== "manual";
    let selectedMilestoneTemplates: readonly any[] = PILOT_PROJECT_MILESTONE_TEMPLATE;
    if (usePilotTemplate) {
      const templateKey = input.milestoneTemplateKey?.trim() || BUILTIN_MILESTONE_TEMPLATE_KEY;
      if (templateKey !== BUILTIN_MILESTONE_TEMPLATE_KEY) {
        const savedTemplate = await this.prisma.projectMilestoneTemplate.findFirst({
          where: { workspaceId: principal.workspaceId, key: templateKey, status: "active" }
        });
        if (!savedTemplate) throw new BadRequestException("Milestone template không tồn tại hoặc đã được lưu trữ");
        selectedMilestoneTemplates = normalizeMilestoneTemplateMilestones(savedTemplate.milestones);
      }
    }

    const requestedTeamIds = Array.from(new Set([
      ...selectedMilestoneTemplates.map((milestone: any) => typeof milestone.ownerTeamId === "string" ? milestone.ownerTeamId : ""),
      ...(Array.isArray(input.manualMilestones) ? input.manualMilestones.map((milestone: any) => typeof milestone?.ownerTeamId === "string" ? milestone.ownerTeamId : "") : [])
    ].filter(Boolean)));
    const requestedReviewerUserIds = Array.from(new Set([
      ...selectedMilestoneTemplates.map((milestone: any) => milestone.reviewerMode === "specific_user" && typeof milestone.reviewerUserId === "string" ? milestone.reviewerUserId : ""),
      ...(Array.isArray(input.manualMilestones) ? input.manualMilestones.map((milestone: any) => milestone?.reviewerMode === "specific_user" && typeof milestone.reviewerUserId === "string" ? milestone.reviewerUserId : "") : [])
    ].filter(Boolean)));
    if (requestedTeamIds.length > 0) {
      const teamCount = await this.prisma.workspaceTeam.count({ where: { workspaceId: principal.workspaceId, active: true, id: { in: requestedTeamIds } } });
      if (teamCount !== requestedTeamIds.length) throw new BadRequestException("Một hoặc nhiều team phụ trách không tồn tại trong workspace");
    }

    const response = await this.prisma.$transaction(async (tx) => {
      await this.permissions.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [principal.subjectId]);
      const workspace = await tx.tenantWorkspace.findUnique({ where: { id: principal.workspaceId } });
      if (!workspace || workspace.status !== "active" || workspace.tenantKey !== principal.tenantKey) throw new ForbiddenException("Active workspace is required");
      if (keyHash) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-create:${keyHash}`}, 0))::text`;
        const receipt = await tx.projectCreateReceipt.findUnique({ where: { keyHash } });
        if (receipt) {
          if (receipt.requestHash !== requestHash) throw new ConflictException("This creation key was already used with different project details. Start a new submission.");
          return receipt.response as unknown as ReturnType<typeof mapProjectSummary>;
        }
      }
      await this.permissions.ensureActiveWorkspaceUsers(
        tx,
        principal.workspaceId,
        principal.tenantKey,
        [...memberUserIds, ownerUserId, ...requestedReviewerUserIds].filter((value): value is string => Boolean(value))
      );

      const createdProject = await tx.project.create({
        data: {
          accountId: account.id,
          workspaceId: principal.workspaceId,
          opportunityId,
          code,
          name,
          status,
          projectType,
          scopeSummary,
          marginPercent: optionalNumber(input.marginPercent, "marginPercent") ?? undefined,
          priority,
          tags,
          color,
          isTestProject: optionalBoolean(input.isTestProject, "isTestProject") ?? false,
          milestoneMode: input.milestoneMode === "manual" ? "manual" : "auto",
          milestoneTemplateKey: input.milestoneMode === "manual" ? undefined : (input.milestoneTemplateKey?.trim() || "pilot-v1")
        },
        include: projectIncludeForPrincipal(principal)
      });

      const shouldSeedHierarchy = input.createStageTemplate ?? true;
      if (shouldSeedHierarchy) {
        // New project creation defaults to the pilot-standard hierarchy unless
        // the caller explicitly chooses manual milestones. The old template is
        // retained only as an internal compatibility helper for callers that
        // opt out of the new structure.
        const manualMilestones = input.milestoneMode === "manual" ? normalizeManualMilestones(input.manualMilestones) : undefined;
        if (input.milestoneMode === "manual" && (!manualMilestones || manualMilestones.length === 0)) {
          throw new BadRequestException("At least one manual milestone with one stage is required");
        }
        const milestoneTemplates: readonly any[] = usePilotTemplate
          ? selectedMilestoneTemplates
          : manualMilestones ?? buildLegacyMilestoneTemplate();
        for (let milestoneIndex = 0; milestoneIndex < milestoneTemplates.length; milestoneIndex += 1) {
          const milestoneTemplate = milestoneTemplates[milestoneIndex];
          // Only the manual flow is allowed to override the template gate. The
          // create modal always has a draft milestone list in memory, so using
          // it for auto/template projects can silently replace configured
          // requirements with zero values.
          const configuredGate = input.milestoneMode === "manual" && Array.isArray(input.manualMilestones)
            ? (input.manualMilestones[milestoneIndex] as any)
            : undefined;
          const milestone = await tx.projectMilestone.create({
            data: {
              workspaceId: principal.workspaceId,
              accountId: account.id,
              projectId: createdProject.id,
              name: milestoneTemplate.name,
              normalizedKey: normalizeMilestoneKey(milestoneTemplate.name),
              sortOrder: milestoneTemplate.sortOrder ?? (milestoneIndex + 1) * 10,
              requiredDocumentCount: effectiveMilestoneRequiredDocumentCount({
                requiredDocumentCount: configuredGate?.requiredDocumentCount ?? milestoneTemplate.requiredDocumentCount ?? 0,
                requiredDocumentTypes: configuredGate?.requiredDocumentTypes ?? milestoneTemplate.requiredDocumentTypes ?? []
              }),
              requiredDocumentTypes: configuredGate?.requiredDocumentTypes ?? milestoneTemplate.requiredDocumentTypes ?? [],
              evidenceMode: configuredGate?.evidenceMode ?? milestoneTemplate.evidenceMode ?? "file_or_link",
              ownerTeamId: configuredGate?.ownerTeamId ?? milestoneTemplate.ownerTeamId ?? undefined,
              unlockCriteria: (configuredGate?.unlockCriteria ?? milestoneTemplate.unlockCriteria) ? {
                text: configuredGate?.unlockCriteria ?? milestoneTemplate.unlockCriteria,
                evidenceMode: configuredGate?.evidenceMode ?? milestoneTemplate.evidenceMode ?? "file_or_link",
                ownerTeamId: configuredGate?.ownerTeamId ?? milestoneTemplate.ownerTeamId ?? undefined
              } : undefined,
              gateStatus: milestoneIndex === 0 ? "open" : "locked",
              customerConfirmationRequired: configuredGate?.customerConfirmationRequired ?? milestoneTemplate.customerConfirmationRequired ?? false,
              reviewerMode: configuredGate?.reviewerMode ?? milestoneTemplate.reviewerMode ?? DEFAULT_MILESTONE_REVIEWER_MODE,
              reviewerUserId: (configuredGate?.reviewerMode ?? milestoneTemplate.reviewerMode ?? DEFAULT_MILESTONE_REVIEWER_MODE) === "specific_user"
                ? configuredGate?.reviewerUserId ?? milestoneTemplate.reviewerUserId ?? undefined
                : undefined,
              reviewerRole: configuredGate?.reviewerRole ?? milestoneTemplate.reviewerRole
            }
          });
          for (let stageIndex = 0; stageIndex < milestoneTemplate.stages.length; stageIndex += 1) {
            const stage = milestoneTemplate.stages[stageIndex];
            const stageData = {
                milestoneId: milestone.id,
                accountId: account.id,
                workspaceId: principal.workspaceId,
                projectId: createdProject.id,
                stageKey: stage.stageKey || `${normalizeMilestoneKey(milestoneTemplate.name)}-${stageIndex + 1}`,
                phase: stage.phase || stage.activity,
                activity: stage.activity,
                sortOrder: stage.sortOrder ?? (stageIndex + 1) * 10,
                cumulativePercent: stage.cumulativePercent ?? Math.round(((stageIndex + 1) / milestoneTemplate.stages.length) * 100),
                activityPercent: stage.activityPercent ?? 0,
                criteria: stage.criteria || "Stage completion criteria",
                upbaseRole: stage.upbaseRole,
                customerRole: stage.customerRole,
                taskTypeLayer1: stage.taskTypeLayer1,
                afterPnlClose: stage.afterPnlClose,
                slaDays: Number.isFinite(Number(stage.slaDays)) ? Math.round(Number(stage.slaDays)) : undefined,
                ownerUserId: milestoneIndex === 0 && stageIndex === 0 ? ownerUserId : undefined,
                plannedStartAt: milestoneIndex === 0 && stageIndex === 0 ? plannedStartAt : undefined,
                plannedEndAt: milestoneIndex === milestoneTemplates.length - 1 && stageIndex === milestoneTemplate.stages.length - 1 ? plannedEndAt : undefined,
                scopeSummary: milestoneIndex === 0 && stageIndex === 0 ? scopeSummary : undefined,
                acceptanceCriteria: milestoneIndex === milestoneTemplates.length - 1 && stageIndex === milestoneTemplate.stages.length - 1
                  ? optionalString(input.acceptanceCriteria, "acceptanceCriteria") ?? undefined
                  : undefined
            };
            // Keep lightweight service mocks and older adapters compatible when
            // the template contains no tasks to persist.
            if (typeof (tx.projectStage as any).create !== "function") {
              await tx.projectStage.createMany({ data: [stageData] });
              continue;
            }
            const createdStage = await tx.projectStage.create({ data: stageData });
            // 8.1: the template stage names the gate (G1–G8) that sits at its end.
            await createProjectGate(tx, createdStage, stage.gateCode);
            // D-04: one derived Layer 2 for every task of the stage. D-02: Layer 1 from the stage, a sub-task repeats its parent.
            const stageTaskTypeLayer2 = deriveTaskTypeLayer2({ projectType, afterPnlClose: stage.afterPnlClose });
            const createTemplateTask = async (task: any, parentTaskId?: string, taskIndex = 0, parentTaskTypeLayer1?: string): Promise<void> => {
              const taskTypeLayer1 = parentTaskId ? parentTaskTypeLayer1 : task.taskTypeLayer1 ?? stage.taskTypeLayer1;
              assertTaskTypePair(taskTypeLayer1, stageTaskTypeLayer2);
              const status = String(task.status ?? "todo").trim() || "todo";
              const taskDate = optionalDate(task.plannedStartAt, "plannedStartAt");
              const taskDue = optionalDate(task.dueAt, "dueAt");
              assertTaskDateRange(taskDate, taskDue);
              const createdTask = await tx.projectTask.create({
                data: {
                  workspaceId: principal.workspaceId,
                  accountId: account.id,
                  projectId: createdProject.id,
                  stageId: createdStage.id,
                  parentTaskId,
                  sortOrder: (taskIndex + 1) * 10,
                  title: nonEmptyString(task.title, "task.title"),
                  description: task.description,
                  taskType: task.taskType ?? "implementation",
                  taskTypeLayer1,
                  taskTypeLayer2: stageTaskTypeLayer2,
                  status,
                  priority: task.priority ?? "medium",
                  ownerUserId,
                  estimateMinutes: task.estimateMinutes ?? 0,
                  plannedStartAt: taskDate ?? undefined,
                  dueAt: taskDue ?? undefined,
                  customerVisible: false,
                  createdByUserId: principal.subjectId,
                  startedAt: status === "in_progress" ? new Date() : undefined,
                  completedAt: isCompletedTaskStatus(status) ? new Date() : undefined
                }
              });
              for (let subtaskIndex = 0; subtaskIndex < (task.subtasks ?? []).length; subtaskIndex += 1) {
                await createTemplateTask(task.subtasks[subtaskIndex], createdTask.id, subtaskIndex, taskTypeLayer1);
              }
            };
            for (let taskIndex = 0; taskIndex < (stage.tasks ?? []).length; taskIndex += 1) {
              await createTemplateTask(stage.tasks[taskIndex], undefined, taskIndex);
            }
          }
        }
      }

      await this.syncProjectMembers(tx, {
        workspaceId: principal.workspaceId,
        projectId: createdProject.id,
        userIds: memberUserIds,
        relation: "member"
      });

      if (budgetAmount !== undefined && budgetAmount !== null) {
        await this.upsertProjectBudget(tx, {
          workspaceId: principal.workspaceId,
          accountId: account.id,
          projectId: createdProject.id,
          projectCode: createdProject.code,
          budgetAmount,
          principal
        });
      }

      // After the hierarchy is seeded, so NL-02 sees the tasks a project created directly in On Hold already has.
      await this.recordProjectStatusChange(tx, principal, createdProject.id, { to: initialStatus.to }, statusReason);

      const persisted = await tx.project.findFirstOrThrow({
        where: { id: createdProject.id, workspaceId: principal.workspaceId },
        include: projectIncludeForPrincipal(principal)
      });
      const result = withoutProjectFinancials(mapProjectSummary(persisted), principal);
      await this.permissions.auditMutation(tx, principal, "project.created", "project", persisted.id, undefined, { memberUserIds });
      if (keyHash) await tx.projectCreateReceipt.create({ data: { keyHash, workspaceId: principal.workspaceId, actorUserId: principal.subjectId, requestHash, projectId: persisted.id, response: JSON.parse(JSON.stringify(result)) } });
      return result;
    }).catch((error) => {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new ConflictException("Project code already exists. Choose another code and retry.");
      throw error;
    });

    projectLifecycleHooks.onProjectCreated(response, principal); // Kept as a no-op extension point; project creation does not create Lark groups.
    return response;
  }

  async updateProject(projectId: string, input: UpdateProjectInput, principal: PrincipalContext, options: { confirmsStatusProposal?: boolean } = {}) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project changes are internal");
    const existingProject = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const nextAccountId = optionalString(input.accountId, "accountId") ?? undefined;
    if (nextAccountId) {
      await this.ensureAccount(nextAccountId, principal.workspaceId);
    }
    const updatesOpportunity = hasInputKey(input, "opportunityId");
    const nextOpportunityId = updatesOpportunity
      ? optionalString(input.opportunityId, "opportunityId")
      : existingProject.opportunityId;
    const effectiveAccountId = nextAccountId ?? existingProject.accountId;
    if (nextOpportunityId) {
      await this.ensureOpportunity(nextOpportunityId, principal.workspaceId, effectiveAccountId);
    }

    const updatesStageStart = hasInputKey(input, "plannedStartAt");
    const updatesStageEnd = hasInputKey(input, "plannedEndAt");
    const updatesScope = hasInputKey(input, "scopeSummary");
    const updatesAcceptance = hasInputKey(input, "acceptanceCriteria");
    const updatesOwner = hasInputKey(input, "ownerUserId");
    const updatesMembers = hasInputKey(input, "memberUserIds");
    const updatesBudget = hasInputKey(input, "budgetAmount");
    // PL-02: the trial flag moves the project in or out of every P&L total, so after creation only an Admin account changes it.
    const requestedTestFlag = hasInputKey(input, "isTestProject") ? optionalBoolean(input.isTestProject, "isTestProject") ?? false : undefined;
    const isTestProject = requestedTestFlag !== undefined && requestedTestFlag !== Boolean((existingProject as { isTestProject?: boolean }).isTestProject) ? requestedTestFlag : undefined;
    if (isTestProject !== undefined && !isAdminAccount(principal)) throw new ForbiddenException("Chỉ tài khoản Admin (PM) mới được đổi cờ Dự án thử nghiệm.");
    const updatesProjectType = hasInputKey(input, "projectType");
    const updatesPriority = hasInputKey(input, "priority");
    const updatesTags = hasInputKey(input, "tags");
    const updatesColor = hasInputKey(input, "color");
    const plannedStartAt = updatesStageStart ? optionalDate(input.plannedStartAt, "plannedStartAt") : undefined;
    const plannedEndAt = updatesStageEnd ? optionalDate(input.plannedEndAt, "plannedEndAt") : undefined;
    if (updatesStageStart && updatesStageEnd) assertTaskDateRange(plannedStartAt, plannedEndAt);
    const scopeSummary = updatesScope ? optionalString(input.scopeSummary, "scopeSummary") : undefined;
    const acceptanceCriteria = updatesAcceptance ? optionalString(input.acceptanceCriteria, "acceptanceCriteria") : undefined;
    const ownerUserId = updatesOwner ? optionalString(input.ownerUserId, "ownerUserId") : undefined;
    const memberUserIds = updatesMembers ? optionalStringArray(input.memberUserIds, "memberUserIds") : undefined;
    const budgetAmount = updatesBudget ? optionalNumber(input.budgetAmount, "budgetAmount") : undefined;
    const projectType = updatesProjectType ? requireProjectType(input.projectType) : undefined;
    const priority = updatesPriority ? optionalEnum(input.priority, "priority", PROJECT_PRIORITIES) : undefined;
    const tags = updatesTags ? normalizeProjectTags(input.tags) ?? [] : undefined;
    const color = updatesColor ? normalizeProjectColor(input.color) : undefined;
    const nextStatus = this.parseProjectStatus(input.status);
    const statusReason = optionalString(input.statusReason, "statusReason") ?? undefined;
    const closeReasonCode = optionalString(input.closeReasonCode, "closeReasonCode") ?? undefined;
    const statusOnlyRequest = Object.keys(input).every((key) => ["status", "statusReason", "closeReasonCode"].includes(key));
    if (updatesOwner && (ownerUserId ?? null) !== await projectPmUserId(this.prisma, principal.workspaceId, projectId)) {
      this.assertCanChangePic(principal);
    }

    const project = await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      const { canManage } = await this.permissions.projectPermissions(tx, projectId, principal);
      // Read under the project lock: two concurrent status changes must each see the other's result,
      // otherwise both could act on the same stale "from" and leave NL-02 open on a project that is not On Hold.
      const lockedProject = nextStatus ? await tx.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, select: { status: true } }) : null;
      const statusChange = nextStatus ? validateProjectStatusChange((lockedProject ?? existingProject).status, nextStatus, statusReason, closeReasonCode) : undefined;
      const closes = Boolean(statusChange?.changed) && statusChange?.to === "closed";
      const reopens = Boolean(statusChange?.changed) && statusChange?.from === "closed";
      // V-22: closing is open to BD and workspace admins who do not manage the project, but only as a status-only request.
      // 5.1: an Admin (PM, Leader) may also confirm a status proposal of a project they do not manage.
      const adminConfirmsProposal = Boolean(options.confirmsStatusProposal) && statusOnlyRequest && isWorkspaceAdmin(principal.roleCodes);
      if (!canManage && !adminConfirmsProposal && !((closes || reopens) && statusOnlyRequest)) {
        throw new ForbiddenException(PROJECT_MANAGE_FORBIDDEN_MESSAGE);
      }
      if (closes && !canCloseProject(principal.roleCodes, canManage)) throw new ForbiddenException("Chỉ PM/Admin hoặc BD mới được đóng dự án.");
      if (reopens && !canReopenProject(principal.roleCodes)) throw new ForbiddenException("Dự án đã đóng: chỉ Admin mới được mở lại và phải ghi lý do.");
      if (statusChange?.error) throw new BadRequestException(statusChange.error);
      // Mục 2.2 "Đóng, thua deal — chỉ trước G1": after G1 the Pre-sale hours belong to the project for good.
      const gatePosition = (closes && closeReasonCode === "lost_deal") || (projectType !== undefined && projectType !== existingProject.projectType)
        ? await loadProjectGatePosition(tx, principal.workspaceId, projectId) : undefined;
      if (closes && closeReasonCode === "lost_deal" && gatePosition?.g1Passed) {
        throw new BadRequestException("Lý do “Thua deal” chỉ dùng khi dự án chưa qua G1. Dự án đã qua G1: chọn lý do đóng khác (Khách dừng hợp tác, Hủy nội bộ…).");
      }
      // Loại dự án decides Layer 2 of the logged hours and the P&L template: it is fixed once G1 is approved.
      if (projectType !== undefined && projectType !== existingProject.projectType && gatePosition?.g1Passed) {
        throw new ConflictException("Loại dự án chỉ đổi được trước khi G1 được duyệt. Dự án này đã qua G1 nên giữ nguyên Loại dự án.");
      }
      // 5.1 "Hệ thống tự chuyển": on a G1–G8 project Đã hoàn thành / Đang bảo trì follow G7 / G8. Set by hand, the sync
      // would re-apply the gate's status in this same request and leave two history rows.
      if (statusChange?.changed && await projectUsesStageGates(tx, principal.workspaceId, projectId)) {
        const systemOwned = (code: string) => (AUTOMATIC_PROJECT_STATUSES as readonly string[]).includes(code);
        if (systemOwned(statusChange.to) || (systemOwned(statusChange.from) && !["at_risk", "on_hold", "closed"].includes(statusChange.to))) {
          throw new BadRequestException("Đã hoàn thành và Đang bảo trì do hệ thống tự chuyển khi G7 / G8 được duyệt, không đặt hoặc bỏ bằng tay. Từ hai trạng thái này chỉ chuyển tay sang Có rủi ro, Tạm dừng hoặc Đã đóng.");
        }
      }
      await this.assertSingleInternalWorklog(tx, principal.workspaceId, projectType, projectId);

      await this.permissions.ensureActiveWorkspaceUsers(
        tx,
        principal.workspaceId,
        principal.tenantKey,
        [
          ...(memberUserIds ?? []),
          typeof ownerUserId === "string" ? ownerUserId : undefined
        ].filter((value): value is string => Boolean(value))
      );

      await tx.project.update({
        where: { id: projectId },
        data: {
          accountId: nextAccountId,
          opportunityId: updatesOpportunity ? nextOpportunityId : undefined,
          code: optionalString(input.code, "code") ?? undefined,
          name: optionalString(input.name, "name") ?? undefined,
          status: nextStatus,
          projectType,
          scopeSummary: updatesScope ? scopeSummary : undefined,
          marginPercent: optionalNumber(input.marginPercent, "marginPercent"),
          priority: updatesPriority ? priority : undefined,
          tags,
          color: updatesColor ? color : undefined,
          isTestProject
        }
      });
      if (isTestProject !== undefined) {
        await this.permissions.auditMutation(tx, principal, "project.test_flag_changed", "project", projectId, { isTestProject: Boolean((existingProject as { isTestProject?: boolean }).isTestProject) }, { isTestProject });
        await this.timeEntries.syncLayer2MismatchWarning(tx, principal.workspaceId, projectId, principal.subjectId); // PL-02: a trial project raises no warning
      }

      // Table 4.2: the project kind decides Layer 2, so a kind change re-derives every task of the project.
      if (projectType !== undefined && projectType !== existingProject.projectType) {
        await this.permissions.auditMutation(tx, principal, "project.kind_changed", "project", projectId, { projectType: existingProject.projectType }, { projectType });
        await this.classification.rederiveProjectTaskLayer2(tx, principal, projectId, "project.kind_changed");
      }

      if (statusChange?.changed) await this.recordProjectStatusChange(tx, principal, projectId, statusChange, statusReason, closes ? closeReasonCode : undefined);

      if (nextAccountId && nextAccountId !== existingProject.accountId) {
        await this.propagateProjectAccount(tx, {
          workspaceId: principal.workspaceId,
          projectId,
          accountId: nextAccountId
        });
      }

      if (updatesStageStart || updatesStageEnd || updatesScope || updatesAcceptance || updatesOwner) {
        const stages = await tx.projectStage.findMany({
          where: { projectId, workspaceId: principal.workspaceId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true }
        });
        const firstStageId = stages[0]?.id;
        const lastStageId = stages[stages.length - 1]?.id;

        if (firstStageId) {
          const firstStage = await tx.projectStage.update({
            where: { id: firstStageId },
            data: {
              plannedStartAt: updatesStageStart ? plannedStartAt : undefined,
              scopeSummary: updatesScope ? scopeSummary : undefined,
              ownerUserId: updatesOwner ? ownerUserId : undefined
            }
          });
          if (updatesOwner && firstStage) await this.syncStageOwnerWarning(tx, principal, firstStage);
        }

        if (lastStageId) {
          await tx.projectStage.update({
            where: { id: lastStageId },
            data: {
              plannedEndAt: updatesStageEnd ? plannedEndAt : undefined,
              acceptanceCriteria: updatesAcceptance ? acceptanceCriteria : undefined
            }
          });
        }
      }

      if (updatesMembers && memberUserIds) {
        await this.syncProjectMembers(tx, {
          workspaceId: principal.workspaceId,
          projectId,
          userIds: memberUserIds,
          relation: "member", principal, protectAssignments: true
        });
      }

      if (updatesBudget && budgetAmount !== undefined) {
        const updatedProject = await tx.project.findFirstOrThrow({
          where: { id: projectId, workspaceId: principal.workspaceId },
          select: { code: true, accountId: true }
        });
        await this.upsertProjectBudget(tx, {
          workspaceId: principal.workspaceId,
          accountId: updatedProject.accountId,
          projectId,
          projectCode: updatedProject.code,
          budgetAmount: budgetAmount ?? 0,
          principal
        });
      }

      return tx.project.findFirstOrThrow({
        where: { id: projectId, workspaceId: principal.workspaceId },
        include: projectIncludeForPrincipal(principal)
      });
    });

    if (nextStatus) await this.recomputeStatusProposal(projectId, principal);
    projectLifecycleHooks.onProjectChanged(projectId); // Kept as a no-op extension point; project changes do not sync Lark groups.
    return withoutProjectFinancials(mapProjectSummary(project), principal);
  }

  // ─── Stage gates G1–G8 and status proposal (rules 7.2, 7.3, 8.1): logic in gates.ts / gates.service.ts / status-proposal.ts ───

  private statusSyncContext(workspaceId: string, principal?: PrincipalContext): StatusSyncContext {
    // Without a user (scheduler, time log) the change is written as the system's: no actor on the history row.
    const actor = principal ?? ({ workspaceId, subjectId: null } as unknown as PrincipalContext);
    return { prisma: this.prisma, workspaceId, actorUserId: principal?.subjectId ?? null, recordStatusChange: (tx, projectId, change, reason) => this.recordProjectStatusChange(tx, actor, projectId, change, reason) };
  }

  /**
   * V-17: recompute the status the rules imply for a project — applies Đã hoàn thành / Đang bảo trì automatically and
   * keeps one pending proposal for everything else. Call it after anything that can change the answer: gate actions,
   * issue-log changes, status changes and the first time log in a stage. Never throws into the caller's request.
   */
  async recomputeStatusProposal(projectId: string, principal?: PrincipalContext) {
    try {
      // Unit specs mock only the models they exercise.
      if (typeof (this.prisma as any).projectStatusProposal?.findFirst !== "function") return;
      const project = await this.prisma.project.findFirst({ where: { id: projectId, ...(principal ? { workspaceId: principal.workspaceId } : {}) }, select: { workspaceId: true } });
      if (!project) return;
      const ctx = this.statusSyncContext(project.workspaceId, principal);
      await this.prisma.$transaction((tx) => syncProjectStatus(ctx, tx, projectId));
      projectLifecycleHooks.onStatusProposalChanged(projectId); // 7.5 bot "Trạng thái dự án"
    } catch (error) {
      console.error("Status proposal recompute failed", error);
    }
  }

  async listProjectGates(projectId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project gates are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    return listProjectGates(await this.permissions.issueLogContext(projectId, principal), project);
  }

  async actOnProjectGate(projectId: string, gateId: string, input: ProjectGateActionInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project gates are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    return actOnProjectGate({ ...(await this.permissions.issueLogContext(projectId, principal)), status: this.statusSyncContext(principal.workspaceId, principal) }, project, gateId, input);
  }

  async decideProjectStatusProposal(projectId: string, proposalId: string, input: DecideProjectStatusProposalInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project status proposals are internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const { actor } = await this.permissions.issueLogContext(projectId, principal);
    return decideStatusProposal({ prisma: this.prisma, principal, actor }, projectId, proposalId, input,
      (status, reason) => this.updateProject(projectId, { status, statusReason: reason } as UpdateProjectInput, principal, { confirmsStatusProposal: true }));
  }

  /** Rejects anything outside the project status catalogue (legacy aliases are still accepted). */
  private parseProjectStatus(value: unknown) {
    const status = optionalString(value, "status") ?? undefined;
    if (status !== undefined && !isKnownProjectStatus(status)) {
      throw new BadRequestException(`Trạng thái dự án không hợp lệ: "${status}". Giá trị hợp lệ: ${Object.values(PROJECT_STATUS_CATALOGUE).map((item) => item.label).join(", ")}.`);
    }
    return status;
  }

  /** `from` is absent for the first row, written when the project is created. */
  private async recordProjectStatusChange(tx: Prisma.TransactionClient, principal: PrincipalContext, projectId: string, change: { from?: string; to: string }, reason?: string, closeReasonCode?: string) {
    // Unit specs mock only the models they exercise.
    if (typeof (tx as any).projectStatusHistory?.create === "function") {
      await tx.projectStatusHistory.create({ data: { workspaceId: principal.workspaceId, projectId, fromStatus: change.from, toStatus: change.to, reason, closeReasonCode, changedByUserId: principal.subjectId } });
    }
    const action = change.to === "closed" ? "project.closed" : change.from === "closed" ? "project.reopened" : "project.status_changed";
    await this.permissions.auditMutation(tx, principal, action, "project", projectId, { status: change.from ?? null }, { status: change.to, reason: reason ?? null, ...(closeReasonCode ? { closeReasonCode } : {}) });
    if (typeof (tx as any).projectWarning?.findFirst !== "function") return;
    // NL-03 is not tracked while planning, so work that is already ownerless must be flagged when the project leaves it.
    if (change.from === "planning" && change.to !== "planning") await this.syncProjectMissingOwnerWarnings(tx, principal, projectId);

    const dedupeKey = "NL-02:on-hold-open-tasks";
    if (change.from === "on_hold") {
      await closeProjectWarnings(tx, { projectId, dedupeKey }, principal.subjectId, "Project đã thoát Tạm dừng");
    }
    if (change.to === "on_hold") {
      const openTasks = await tx.projectTask.count({
        where: { workspaceId: principal.workspaceId, projectId, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES },
          OR: [{ ownerUserId: { not: null } }, { assigneeUserId: { not: null } }, { taskAssignees: { some: {} } }] }
      });
      if (!openTasks) return;
      const firstStage = await tx.projectStage.findFirst({ where: { workspaceId: principal.workspaceId, projectId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { ownerUserId: true } });
      await openOrRefreshProjectWarning(tx, {
        workspaceId: principal.workspaceId,
        projectId,
        dedupeKey,
        typeCode: "NL-02",
        severity: "medium",
        title: "Project Tạm dừng: PM cần rà soát các Task đang mở",
        detail: `Project chuyển sang Tạm dừng khi thành viên còn ${openTasks} Task đang mở. PM/Project PIC cần quyết định tạm dừng, đổi hạn hoặc phân công lại từng Task.`,
        ownerUserId: firstStage?.ownerUserId ?? undefined,
        actorUserId: principal.subjectId
      });
    }
  }

  async deleteProject(projectId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Projects are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    await this.permissions.assertProjectManagerOrAdmin(this.prisma, projectId, principal);
    const blockers = await this.getProjectDeleteBlockers(projectId, principal.workspaceId);
    if (blockers.length > 0) {
      throw new BadRequestException(projectHasRecordsError(formatDeleteBlockers(blockers)));
    }

    try {
      await this.prisma.$transaction([
        this.prisma.projectMember.deleteMany({ where: { projectId, workspaceId: principal.workspaceId } }),
        this.prisma.projectBudget.deleteMany({ where: { projectId, workspaceId: principal.workspaceId } }),
        this.prisma.project.delete({ where: { id: project.id } }),
        this.prisma.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "project.deleted", resource: "project", resourceId: project.id, before: { code: project.code, name: project.name, status: project.status, accountId: project.accountId }, requestId: randomUUID() } })
      ]);
    } catch (error) {
      if (isPrismaForeignKeyError(error)) {
        throw new BadRequestException(projectHasRecordsError());
      }
      throw error;
    }

    return { deleted: true, id: project.id };
  }

  async getProjectHierarchy(projectId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project hierarchy is internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const milestones = await this.prisma.projectMilestone.findMany({
      where: {
        projectId: project.id,
        workspaceId: principal.workspaceId
      },
      include: {
        ownerTeam: { select: { id: true, name: true } },
        stages: {
          // Keep hierarchy gate counts aligned with the milestone handoff:
          // change-request stages and subtasks are not ordinary deliverables.
          where: { changeRequestId: null },
          select: {
            tasks: {
              where: { workspaceId: principal.workspaceId, archivedAt: null, parentTaskId: null },
              select: {
                parentTaskId: true,
                status: true,
                plannedStartAt: true,
                dueAt: true,
                estimateMinutes: true,
                timeEntries: {
                  select: { minutes: true, approvalStatus: true, workDate: true, startAt: true, endAt: true }
                },
                subtasks: {
                  where: { workspaceId: principal.workspaceId, archivedAt: null },
                  select: {
                    status: true,
                    plannedStartAt: true,
                    dueAt: true,
                    estimateMinutes: true,
                    timeEntries: {
                      select: { minutes: true, approvalStatus: true, workDate: true, startAt: true, endAt: true }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    const reviewerUsers = await this.milestoneGates.loadMilestoneReviewerUsers(milestones, principal);
    const documentEvidenceByMilestone = new Map(
      await Promise.all(milestones.map(async (milestone) => [
        milestone.id,
        await this.milestoneGates.loadProjectMilestoneEvidence(project.id, milestone.id, principal.workspaceId)
      ] as const))
    );

    return {
      projectId: project.id,
      hierarchyOrderVersion: project.hierarchyOrderVersion,
      milestones: milestones.map((milestone) => mapMilestoneGateSummary(
        milestone,
        countMilestoneEvidence(
          milestone,
          documentEvidenceByMilestone.get(milestone.id) ?? []
        ),
        milestone.reviewerUserId ? reviewerUsers.get(milestone.reviewerUserId) : undefined,
        milestone.reviewerApprovedByUserId ? reviewerUsers.get(milestone.reviewerApprovedByUserId) : undefined,
        principal
      ))
    };
  }
  async listProjectMilestoneGates(projectId: string, principal: PrincipalContext) { return this.milestoneGates.listProjectMilestoneGates(projectId, principal); } // kept for existing callers
  async updateProjectMilestoneGate(projectId: string, milestoneId: string, input: Record<string, unknown>, principal: PrincipalContext) { const result = await this.milestoneGates.updateProjectMilestoneGate(projectId, milestoneId, input, principal); await this.recomputeStatusProposal(projectId, principal); return result; } // kept for existing callers
  async evaluateProjectMilestoneGate(projectId: string, milestoneId: string, principal: PrincipalContext) { const result = await this.milestoneGates.evaluateProjectMilestoneGate(projectId, milestoneId, principal); await this.recomputeStatusProposal(projectId, principal); return result; } // kept for existing callers
  // V-17: approving a milestone can move the project (all approved → Đã hoàn thành on a project without G1–G8).
  async approveProjectMilestone(projectId: string, milestoneId: string, principal: PrincipalContext) { const result = await this.milestoneGates.approveProjectMilestone(projectId, milestoneId, principal); await this.recomputeStatusProposal(projectId, principal); return result; } // kept for existing callers
  async requestProjectMilestoneApproval(projectId: string, milestoneId: string, principal: PrincipalContext) { return this.milestoneGates.requestProjectMilestoneApproval(projectId, milestoneId, principal); } // kept for existing callers

  async reorderProjectHierarchy(
    projectId: string,
    rawInput: ProjectHierarchyOrderInput,
    principal: PrincipalContext
  ) {
    this.assertCanEditProjectHierarchy(principal);
    const input = parseProjectHierarchyOrderInput(rawInput);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const lockedProjects = await tx.$queryRaw<Array<{ id: string; hierarchyOrderVersion: number }>>`
        SELECT "id", "hierarchyOrderVersion"
        FROM "Project"
        WHERE "id" = ${projectId}
          AND "workspaceId" = ${principal.workspaceId}
        FOR UPDATE
      `;
      const lockedProject = lockedProjects[0];
      if (!lockedProject) {
        throw new NotFoundException("Project not found");
      }

      const currentIds = await this.canonicalHierarchySiblingIds(tx, {
        workspaceId: principal.workspaceId,
        projectId,
        kind: input.kind,
        parentId: input.parentId
      });

      if (lockedProject.hierarchyOrderVersion !== input.expectedVersion) {
        const current = {
          kind: input.kind,
          parentId: input.parentId,
          orderedIds: currentIds,
          hierarchyOrderVersion: lockedProject.hierarchyOrderVersion
        };
        throw new ConflictException({
          message: "Project hierarchy order changed; reload and try again",
          ...current,
          current,
          canonical: current
        });
      }

      assertCompleteHierarchyPermutation(currentIds, input.orderedIds);
      if (arraysEqual(currentIds, input.orderedIds)) {
        return {
          kind: input.kind,
          parentId: input.parentId,
          orderedIds: currentIds,
          hierarchyOrderVersion: lockedProject.hierarchyOrderVersion
        };
      }

      await Promise.all(input.orderedIds.map((id, index) => {
        const sortOrder = (index + 1) * 10;
        if (input.kind === "milestone") {
          return tx.projectMilestone.update({ where: { id }, data: { sortOrder } });
        }
        if (input.kind === "stage") {
          return tx.projectStage.update({ where: { id }, data: { sortOrder } });
        }
        return tx.projectTask.update({ where: { id }, data: { sortOrder } });
      }));

      const updatedProject = await tx.project.update({
        where: { id: projectId },
        data: { hierarchyOrderVersion: { increment: 1 } },
        select: { hierarchyOrderVersion: true }
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: principal.workspaceId,
          actorUserId: principal.subjectId,
          action: "project_hierarchy_reordered",
          resource: "project_hierarchy",
          resourceId: projectId,
          before: {
            kind: input.kind,
            parentId: input.parentId,
            orderedIds: currentIds,
            hierarchyOrderVersion: lockedProject.hierarchyOrderVersion
          },
          after: {
            kind: input.kind,
            parentId: input.parentId,
            orderedIds: input.orderedIds,
            hierarchyOrderVersion: updatedProject.hierarchyOrderVersion
          },
          requestId: `project-hierarchy:${projectId}:${input.expectedVersion}:${input.kind}:${Date.now()}`
        }
      });

      return {
        kind: input.kind,
        parentId: input.parentId,
        orderedIds: input.orderedIds,
        hierarchyOrderVersion: updatedProject.hierarchyOrderVersion
      };
    }, {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 10_000
      });
    } catch (error) {
      if (!isPrismaSerializationConflict(error)) {
        throw error;
      }
      const current = await this.prisma.$transaction(async (tx) => {
        const project = await this.lockProjectHierarchy(tx, projectId, principal.workspaceId);
        const orderedIds = await this.canonicalHierarchySiblingIds(tx, {
          workspaceId: principal.workspaceId,
          projectId,
          kind: input.kind,
          parentId: input.parentId
        });
        return {
          kind: input.kind,
          parentId: input.parentId,
          orderedIds,
          hierarchyOrderVersion: project.hierarchyOrderVersion
        };
      });
      throw new ConflictException({
        message: "Project hierarchy order changed; reload and try again",
        ...current,
        current,
        canonical: current
      });
    }
  }

  async listStages(projectId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project stages are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const stages = await this.prisma.projectStage.findMany({
      where: { projectId, workspaceId: principal.workspaceId, ...(query.status ? { status: query.status } : {}) },
      include: stageInclude,
      orderBy: [
        { milestone: { sortOrder: "asc" } },
        { sortOrder: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ]
    });

    return {
      data: stages.map(mapProjectStageSummary),
      meta: {
        principal,
        rowScope: "project",
        hiddenFields: [],
        hierarchyOrderVersion: project.hierarchyOrderVersion
      }
    };
  }

  async createStage(projectId: string, input: CreateProjectStageInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project stages are internal");
    if (hasInputKey(input, "sortOrder")) {
      throw new BadRequestException("sortOrder can only be changed through the hierarchy order endpoint");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.permissions.assertProjectManager(tx, projectId, principal);
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const activity = nonEmptyString(input.activity, "activity");
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? undefined;
    await this.permissions.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, project.id, ownerUserId ? [ownerUserId] : []);
    const baseStageKey = optionalString(input.stageKey, "stageKey") ?? stageKeyFromActivity(activity);
    const stageKey = `${baseStageKey}-${Date.now().toString(36)}`.slice(0, 64);
    const phase = normalizeMilestoneName(optionalString(input.phase, "phase") ?? activity);
    const normalizedKey = normalizeMilestoneKey(phase);

    const stage = await (async () => {
      await this.lockProjectHierarchy(tx, project.id, principal.workspaceId);
      let milestone = await tx.projectMilestone.findFirst({
        where: {
          projectId: project.id,
          workspaceId: principal.workspaceId,
          normalizedKey
        }
      });
      if (!milestone) {
        const lastMilestone = await tx.projectMilestone.findFirst({
          where: { projectId: project.id, workspaceId: principal.workspaceId },
          orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
          select: { sortOrder: true }
        });
        milestone = await tx.projectMilestone.create({
          data: {
            accountId: project.accountId,
            workspaceId: principal.workspaceId,
            projectId: project.id,
            name: phase,
            normalizedKey,
            sortOrder: (lastMilestone?.sortOrder ?? 0) + 10
          }
        });
      }
      await this.permissions.assertMilestoneUnlockedById(tx, principal.workspaceId, milestone.id, "thêm stage");
      const lastStage = await tx.projectStage.findFirst({
        where: {
          projectId: project.id,
          workspaceId: principal.workspaceId,
          milestoneId: milestone.id
        },
        orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
        select: { sortOrder: true }
      });
      const createdStage = await tx.projectStage.create({
        data: {
          accountId: project.accountId,
          workspaceId: principal.workspaceId,
          projectId: project.id,
          milestoneId: milestone.id,
          stageKey,
          phase,
          activity,
          sortOrder: (lastStage?.sortOrder ?? 0) + 10,
          cumulativePercent: optionalInteger(input.cumulativePercent, "cumulativePercent") ?? 0,
          activityPercent: optionalInteger(input.activityPercent, "activityPercent") ?? 0,
          criteria: optionalString(input.criteria, "criteria") ?? "Stage completion criteria",
          description: optionalString(input.description, "description") ?? undefined,
          status: optionalString(input.status, "status") ?? "not_started",
          ownerUserId,
          plannedStartAt: optionalDate(input.plannedStartAt, "plannedStartAt") ?? undefined,
          plannedEndAt: optionalDate(input.plannedEndAt, "plannedEndAt") ?? undefined,
          acceptanceCriteria: optionalString(input.acceptanceCriteria, "acceptanceCriteria") ?? undefined,
          blockerSummary: optionalString(input.blockerSummary, "blockerSummary") ?? undefined,
          scopeSummary: optionalString(input.scopeSummary, "scopeSummary") ?? undefined,
          standardMinutes: optionalInteger(input.standardMinutes, "standardMinutes") ?? undefined,
          progressPercent: optionalInteger(input.progressPercent, "progressPercent") ?? 0
        },
        include: stageInclude
      });
      await tx.project.update({
        where: { id: project.id },
        data: { hierarchyOrderVersion: { increment: 1 } }
      });
      return createdStage;
    })();

    await this.syncMissingOwnerWarning(tx, principal, { projectId: project.id, kind: "stage", id: stage.id, label: stage.activity, hasOwner: Boolean(stage.ownerUserId), isOpen: !CLOSED_WORK_STATUSES.includes(stage.status), stageId: stage.id, milestoneId: stage.milestoneId });
    return mapProjectStageSummary(stage);
    }, { isolationLevel: "Serializable" });
  }

  /** 7.7: "PM và Dx Director đổi PIC" (Founder/GM and Workspace Admin hold every Admin right). */
  private assertCanChangePic(principal: PrincipalContext) {
    if (!can("project.pic.change", principal)) throw new ForbiddenException("Chỉ PM, Dx Director hoặc Admin toàn quyền mới đổi PIC dự án.");
  }

  async updateStage(
    projectId: string,
    stageId: string,
    input: UpdateProjectStageInput,
    principal: PrincipalContext,
    options: UpdateStageOptions = {}
  ) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project stages are internal");
    if (hasInputKey(input, "sortOrder")) {
      throw new BadRequestException("sortOrder can only be changed through the hierarchy order endpoint");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.permissions.assertProjectManager(tx, projectId, principal);
    const existingStage = await tx.projectStage.findFirst({ where: { id: stageId, projectId, workspaceId: principal.workspaceId } });
    if (!existingStage) throw new NotFoundException("Project stage not found");
    if (hasInputKey(input, "phase")) nonEmptyString(input.phase, "Milestone name");
    if (hasInputKey(input, "activity")) nonEmptyString(input.activity, "Stage name");
    const scope = options.scope?.trim().toLowerCase() === "milestone" ? "milestone" : "stage";
    const requestedPhase = optionalString(input.phase, "phase") ?? undefined;
    const data = omitUndefined({
      phase: requestedPhase,
      activity: optionalString(input.activity, "activity") ?? undefined,
      cumulativePercent: optionalInteger(input.cumulativePercent, "cumulativePercent") ?? undefined,
      activityPercent: optionalInteger(input.activityPercent, "activityPercent") ?? undefined,
      criteria: optionalString(input.criteria, "criteria") ?? undefined,
      description: optionalString(input.description, "description"),
      status: optionalString(input.status, "status") ?? undefined,
      ownerUserId: optionalString(input.ownerUserId, "ownerUserId"),
      plannedStartAt: optionalDate(input.plannedStartAt, "plannedStartAt"),
      plannedEndAt: optionalDate(input.plannedEndAt, "plannedEndAt"),
      actualStartAt: optionalDate(input.actualStartAt, "actualStartAt"),
      actualEndAt: optionalDate(input.actualEndAt, "actualEndAt"),
      acceptanceCriteria: optionalString(input.acceptanceCriteria, "acceptanceCriteria"),
      blockerSummary: optionalString(input.blockerSummary, "blockerSummary"),
      scopeSummary: optionalString(input.scopeSummary, "scopeSummary"),
      standardMinutes: optionalInteger(input.standardMinutes, "standardMinutes"),
      progressPercent: optionalInteger(input.progressPercent, "progressPercent") ?? undefined
    });
    // D-21: after the baseline is locked the stage timeline changes only through "Gia hạn stage" (Admin approval, reason, new baseline version).
    if ((["plannedStartAt", "plannedEndAt"] as const).some((key) => data[key] !== undefined && !sameInstant(data[key] as Date | null, existingStage[key])) && await isBaselineLocked(tx, projectId)) {
      throw new ConflictException("Baseline đã khóa: ngày kế hoạch của stage chỉ đổi qua thao tác Gia hạn stage (tab Điểm chốt & Tài liệu), có lý do và người duyệt (D-21).");
    }
    // V-11: a stage starts only after the gate before it is approved. Starting it also starts its SLA clock.
    if (typeof data.status === "string" && isStartedStageStatus(data.status) && !isStartedStageStatus(existingStage.status)) {
      await assertStageGateOpen(tx, principal.workspaceId, existingStage.id, `bắt đầu stage "${existingStage.activity}"`);
      if (data.actualStartAt === undefined && !existingStage.actualStartAt) (data as { actualStartAt?: Date | null }).actualStartAt = new Date();
    }
    await this.permissions.ensureProjectAssignmentUsers(
      tx,
      principal.workspaceId,
      principal.tenantKey,
      existingStage.projectId,
      typeof data.ownerUserId === "string" ? [data.ownerUserId] : []
    );
    if (hasInputKey(input, "ownerUserId")) {
      // The PIC is the owner of the project's first stage, so changing that owner is a PIC change (7.7).
      const firstStage = await tx.projectStage.findFirst({ where: { projectId, workspaceId: principal.workspaceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, ownerUserId: true, milestoneId: true } });
      const touchesFirstStage = firstStage && (firstStage.id === stageId || (options.scope?.trim().toLowerCase() === "milestone" && firstStage.milestoneId === existingStage.milestoneId));
      if (touchesFirstStage && (optionalString(input.ownerUserId, "ownerUserId") ?? null) !== firstStage.ownerUserId) this.assertCanChangePic(principal);
    }

    if (scope === "milestone") {
      const milestoneData = omitUndefined({ ...data, activity: undefined });
      const stage = await (async () => {
        if (requestedPhase) {
          await this.lockProjectHierarchy(tx, projectId, principal.workspaceId);
          const phase = normalizeMilestoneName(requestedPhase);
          const normalizedKey = normalizeMilestoneKey(phase);
          const collision = await tx.projectMilestone.findFirst({
            where: {
              workspaceId: principal.workspaceId,
              projectId,
              normalizedKey,
              id: { not: existingStage.milestoneId }
            },
            select: { id: true }
          });
          if (collision) {
            throw new BadRequestException("A milestone with this phase already exists; use an explicit stage move");
          }
          await tx.projectMilestone.update({
            where: { id: existingStage.milestoneId },
            data: { name: phase, normalizedKey }
          });
          milestoneData.phase = phase;
        }
        await tx.projectStage.updateMany({
          where: {
            projectId,
            workspaceId: principal.workspaceId,
            milestoneId: existingStage.milestoneId
          },
          data: milestoneData
        });
        if (requestedPhase) {
          await tx.project.update({
            where: { id: projectId },
            data: { hierarchyOrderVersion: { increment: 1 } }
          });
        }
        return tx.projectStage.findFirst({
          where: {
            id: stageId,
            projectId,
            workspaceId: principal.workspaceId
          },
          include: stageInclude
        });
      })();

      if (!stage) {
        throw new NotFoundException("Project stage not found");
      }

      await this.permissions.auditMutation(tx, principal, "project.milestone_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
      // The update above rewrote owner/status on every stage of the milestone, not just this one.
      const milestoneStages = typeof tx.projectStage.findMany === "function"
        ? await tx.projectStage.findMany({ where: { projectId, workspaceId: principal.workspaceId, milestoneId: existingStage.milestoneId }, select: { id: true, projectId: true, activity: true, status: true, ownerUserId: true, milestoneId: true } })
        : [];
      for (const milestoneStage of milestoneStages ?? []) await this.syncStageOwnerWarning(tx, principal, milestoneStage);
      return mapProjectStageSummary(stage);
    }

    if (requestedPhase) {
      const phase = normalizeMilestoneName(requestedPhase);
      const normalizedKey = normalizeMilestoneKey(phase);
      const stage = await (async () => {
        await this.lockProjectHierarchy(tx, projectId, principal.workspaceId);
        let milestone = await tx.projectMilestone.findFirst({
          where: {
            workspaceId: principal.workspaceId,
            projectId,
            normalizedKey
          }
        });
        if (!milestone) {
          const lastMilestone = await tx.projectMilestone.findFirst({
            where: { workspaceId: principal.workspaceId, projectId },
            orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
            select: { sortOrder: true }
          });
          milestone = await tx.projectMilestone.create({
            data: {
              workspaceId: principal.workspaceId,
              accountId: existingStage.accountId,
              projectId,
              name: phase,
              normalizedKey,
              sortOrder: (lastMilestone?.sortOrder ?? 0) + 10
            }
          });
        }
        let stageSortOrder = existingStage.sortOrder;
        if (milestone.id !== existingStage.milestoneId) {
          const lastStage = await tx.projectStage.findFirst({
            where: {
              workspaceId: principal.workspaceId,
              projectId,
              milestoneId: milestone.id
            },
            orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
            select: { sortOrder: true }
          });
          stageSortOrder = (lastStage?.sortOrder ?? 0) + 10;
        }
        const updated = await tx.projectStage.update({
          where: { id: stageId },
          data: {
            ...data,
            phase,
            milestoneId: milestone.id,
            sortOrder: stageSortOrder
          },
          include: stageInclude
        });
        if (milestone.id !== existingStage.milestoneId) {
          const remaining = await tx.projectStage.count({
            where: { milestoneId: existingStage.milestoneId }
          });
          if (remaining === 0) {
            await tx.projectMilestone.delete({ where: { id: existingStage.milestoneId } });
          }
          await tx.project.update({
            where: { id: projectId },
            data: { hierarchyOrderVersion: { increment: 1 } }
          });
        }
        return updated;
      })();
      await this.permissions.auditMutation(tx, principal, "project.stage_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
      await this.syncMissingOwnerWarning(tx, principal, { projectId, kind: "stage", id: stageId, label: stage.activity, hasOwner: Boolean(stage.ownerUserId), isOpen: !CLOSED_WORK_STATUSES.includes(stage.status), stageId, milestoneId: stage.milestoneId });
      return mapProjectStageSummary(stage);
    }

    const stage = await tx.projectStage.update({
      where: { id: stageId },
      data,
      include: stageInclude
    });

    await this.permissions.auditMutation(tx, principal, "project.stage_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
      await this.syncMissingOwnerWarning(tx, principal, { projectId, kind: "stage", id: stageId, label: stage.activity, hasOwner: Boolean(stage.ownerUserId), isOpen: !CLOSED_WORK_STATUSES.includes(stage.status), stageId, milestoneId: stage.milestoneId });
      return mapProjectStageSummary(stage);
    }, { isolationLevel: "Serializable" });
  }

  async deleteStage(projectId: string, stageId: string, principal: PrincipalContext, options: DeleteStageOptions = {}) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project stages are internal");
    const stage = await this.ensureStage(projectId, stageId, principal.workspaceId);
    const scope = options.scope?.trim().toLowerCase() === "milestone" ? "milestone" : "stage";
    const stages = scope === "milestone"
      ? await this.prisma.projectStage.findMany({
          where: {
            projectId,
            workspaceId: principal.workspaceId,
            milestoneId: stage.milestoneId
          },
          select: { id: true }
        })
      : [{ id: stage.id }];
    const stageIds = stages.map(item => item.id);
    let deletedTaskIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.permissions.assertProjectManager(tx, projectId, principal);
      await this.lockProjectHierarchy(tx, projectId, principal.workspaceId);
      const taskIds = await this.collectTaskIdsForStages(tx, stageIds, principal.workspaceId);
      deletedTaskIds = taskIds;
      await this.deleteTaskSubtree(tx, taskIds, principal.workspaceId);
      await closeProjectWarnings(tx, { projectId, dedupeKey: { in: [...stageIds.map((id) => `NL-03:stage:${id}`), ...taskIds.map((id) => `NL-03:task:${id}`)] } }, principal.subjectId, "Stage/Task đã bị xóa");
      await this.closeResolvedDepartedMemberWarnings(tx, principal, projectId);
      await this.permissions.auditMutation(tx, principal, scope === "milestone" ? "project.milestone_deleted" : "project.stage_deleted", "project_stage", stage.id,
        { phase: stage.phase, activity: stage.activity, status: stage.status, ownerUserId: stage.ownerUserId, milestoneId: stage.milestoneId, deletedStageIds: stageIds, deletedTaskIds: taskIds });
      await tx.projectStage.deleteMany({
        where: {
          id: { in: stageIds },
          projectId,
          workspaceId: principal.workspaceId
        }
      });
      const remainingStages = await tx.projectStage.count({
        where: { milestoneId: stage.milestoneId }
      });
      if (remainingStages === 0) {
        await tx.projectMilestone.deleteMany({
          where: {
            id: stage.milestoneId,
            workspaceId: principal.workspaceId,
            projectId
          }
        });
      }
      await tx.project.update({
        where: { id: projectId },
        data: { hierarchyOrderVersion: { increment: 1 } }
      });
    }, { isolationLevel: "Serializable" });

    return {
      deleted: true,
      id: stage.id,
      scope,
      deletedStageIds: stageIds,
      deletedTaskIds
    };
  }

  async listProjectDocuments(projectId: string, query: any, principal: PrincipalContext) {
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const artifactType = optionalString(query.artifactType, "artifactType");

    const where = {
      workspaceId: principal.workspaceId,
      projectId,
      ...(artifactType ? { artifactType } : {}),
      // Customers only ever see documents shared with them.
      ...(principal.subjectType === "portal_user" ? { customerVisible: true, internalOnly: false } : {})
    };

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.projectArtifact.findMany({
        where,
        include: projectDocumentInclude,
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.projectArtifact.count({ where })
    ]);

    return {
      data: documents.map(mapProjectDocumentSummary),
      meta: {
        principal,
        rowScope: "project",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: documents.length })
      }
    };
  }

  async createProjectDocument(projectId: string, input: CreateProjectDocumentInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const name = nonEmptyString(input.name, "name");
    const artifactType = input.artifactType?.trim() || "project_document";
    const code = input.code?.trim() || `${project.code}-DOC-${Date.now().toString(36).toUpperCase()}`;
    const fileObjectId = nonEmptyString(input.fileObjectId, "fileObjectId");
    const milestoneId = optionalString(input.milestoneId, "milestoneId");
    if (milestoneId) await this.ensureProjectMilestone(project.id, milestoneId, principal.workspaceId);
    const note = optionalString(input.note, "note") ?? undefined;
    const customerVisible = optionalBoolean(input.customerVisible, "customerVisible") ?? false;
    const internalOnly = optionalBoolean(input.internalOnly, "internalOnly") ?? true;
    const allowedRoles = stringArray(input.allowedRoles);

    const document = await this.prisma.$transaction(async (tx) => {
      const file = await this.ensureProjectDocumentFile(tx, fileObjectId, project, principal.workspaceId);
      const existingVersion = await tx.projectDocumentVersion.findUnique({ where: { fileObjectId } });
      if (existingVersion) throw new ConflictException("File is already linked to a project document version");

      const artifact = await tx.projectArtifact.create({
        data: {
          workspaceId: principal.workspaceId,
          accountId: project.accountId,
          projectId: project.id,
          milestoneId: milestoneId ?? undefined,
          code,
          name,
          artifactType,
          storageKey: file.storageKey,
          customerVisible,
          internalOnly,
          allowedRoles,
          signedUrlExpiresSeconds: optionalInteger(input.signedUrlExpiresSeconds, "signedUrlExpiresSeconds") ?? 300
        }
      });
      await tx.projectDocumentVersion.create({
        data: {
          workspaceId: principal.workspaceId,
          accountId: project.accountId,
          projectId: project.id,
          artifactId: artifact.id,
          fileObjectId: file.id,
          version: 1,
          note,
          createdByUserId: principal.subjectId
        }
      });
      await tx.fileObject.update({
        where: { id: file.id },
        data: {
          ownerType: "project_document",
          ownerId: artifact.id,
          customerVisible,
          internalOnly,
          allowedRoles
        }
      });

      return tx.projectArtifact.findFirstOrThrow({
        where: { id: artifact.id, workspaceId: principal.workspaceId },
        include: projectDocumentInclude
      });
    });

    return mapProjectDocumentSummary(document);
  }

  async updateProjectDocument(projectId: string, documentId: string, input: UpdateProjectDocumentInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    await this.ensureProjectDocument(projectId, documentId, principal.workspaceId);
    let milestoneId: string | null | undefined;
    if (input.milestoneId !== undefined) {
      milestoneId = optionalString(input.milestoneId, "milestoneId") ?? null;
      if (milestoneId) await this.ensureProjectMilestone(project.id, milestoneId, principal.workspaceId);
    }

    const document = await this.prisma.projectArtifact.update({
      where: { id: documentId },
      data: {
        name: optionalString(input.name, "name") ?? undefined,
        artifactType: optionalString(input.artifactType, "artifactType") ?? undefined,
        milestoneId,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? undefined,
        internalOnly: optionalBoolean(input.internalOnly, "internalOnly") ?? undefined,
        allowedRoles: input.allowedRoles === undefined ? undefined : stringArray(input.allowedRoles),
        signedUrlExpiresSeconds: optionalInteger(input.signedUrlExpiresSeconds, "signedUrlExpiresSeconds") ?? undefined
      },
      include: projectDocumentInclude
    });

    return mapProjectDocumentSummary(document);
  }

  async createProjectDocumentVersion(
    projectId: string,
    documentId: string,
    input: CreateProjectDocumentVersionInput,
    principal: PrincipalContext
  ) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const fileObjectId = nonEmptyString(input.fileObjectId, "fileObjectId");
    const expectedVersion = optionalInteger(input.expectedVersion, "expectedVersion");
    if (expectedVersion === undefined || expectedVersion === null || expectedVersion < 0) {
      throw new BadRequestException("expectedVersion must be zero or greater");
    }
    const note = optionalString(input.note, "note") ?? undefined;

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const artifact = await tx.projectArtifact.findFirst({
          where: { id: documentId, projectId: project.id, workspaceId: principal.workspaceId },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } }
        });
        if (!artifact) throw new NotFoundException("Project document not found");
        const currentVersion = artifact.versions[0]?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          throw new ConflictException(`Expected document version ${expectedVersion}, found ${currentVersion}`);
        }

        const file = await this.ensureProjectDocumentFile(tx, fileObjectId, project, principal.workspaceId);
        const existingVersion = await tx.projectDocumentVersion.findUnique({ where: { fileObjectId } });
        if (existingVersion) throw new ConflictException("File is already linked to a project document version");

        await tx.projectDocumentVersion.create({
          data: {
            workspaceId: principal.workspaceId,
            accountId: project.accountId,
            projectId: project.id,
            artifactId: artifact.id,
            fileObjectId: file.id,
            version: currentVersion + 1,
            note,
            createdByUserId: principal.subjectId
          }
        });
        await tx.fileObject.update({
          where: { id: file.id },
          data: {
            ownerType: "project_document",
            ownerId: artifact.id,
            customerVisible: artifact.customerVisible,
            internalOnly: artifact.internalOnly,
            allowedRoles: artifact.allowedRoles
          }
        });
        await tx.projectArtifact.update({
          where: { id: artifact.id },
          data: { storageKey: file.storageKey }
        });

        return tx.projectArtifact.findFirstOrThrow({
          where: { id: artifact.id, workspaceId: principal.workspaceId },
          include: projectDocumentInclude
        });
      }, { isolationLevel: "Serializable" });

      return mapProjectDocumentSummary(document);
    } catch (error) {
      if (isPrismaWriteConflict(error)) {
        throw new ConflictException("Document version changed; reload the document and try again");
      }
      throw error;
    }
  }

  async deleteProjectDocument(projectId: string, documentId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const document = await this.ensureProjectDocument(projectId, documentId, principal.workspaceId);
    await this.prisma.projectArtifact.delete({ where: { id: document.id } });
    return { deleted: true, id: document.id };
  }

  async listProjectActivities(projectId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project activity is internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination({ limit: query.limit ?? 10, offset: query.offset });
    const status = optionalString(query.status, "status")?.toLowerCase();
    const feedFetchLimit = pagination.offset + pagination.limit;

    const where = {
      workspaceId: principal.workspaceId,
      projectId,
      ...(status ? { status } : {}),
      activityType: { notIn: Array.from(CANONICAL_PROJECT_ACTIVITY_TYPES) }
    };
    const includeCanonicalEvents = !status || status === "active";

    const storedActivityQuery = this.prisma.projectActivity.findMany({
      where,
      include: projectActivityInclude,
      orderBy: [{ occurredAt: "desc" as const }, { createdAt: "desc" as const }],
      take: feedFetchLimit
    });
    const storedActivityCountQuery = this.prisma.projectActivity.count({ where });

    const statusHistoryWhere: Prisma.TaskStatusHistoryWhereInput = {
      workspaceId: principal.workspaceId,
      projectId
    };
    const timeEntryWhere: Prisma.TaskTimeEntryWhereInput = {
      workspaceId: principal.workspaceId,
      projectId
    };
    const planningBlockWhere: Prisma.TaskPlanningBlockWhereInput = {
      workspaceId: principal.workspaceId,
      projectId
    };

    const [
      activities,
      storedActivityTotal,
      statusHistories,
      statusHistoryTotal,
      timeEntries,
      timeEntryTotal,
      planningBlocks,
      planningBlockTotal
    ] = await Promise.all([
      storedActivityQuery,
      storedActivityCountQuery,
      includeCanonicalEvents
        ? this.prisma.taskStatusHistory.findMany({
            where: statusHistoryWhere,
            include: {
              task: { include: { account: true, project: true } },
              changedBy: true
            },
            orderBy: [{ changedAt: "desc" }, { id: "desc" }],
            take: feedFetchLimit
          })
        : Promise.resolve([]),
      includeCanonicalEvents ? this.prisma.taskStatusHistory.count({ where: statusHistoryWhere }) : Promise.resolve(0),
      includeCanonicalEvents
        ? this.prisma.taskTimeEntry.findMany({
            where: timeEntryWhere,
            include: taskTimeEntryInclude,
            orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
            take: feedFetchLimit
          })
        : Promise.resolve([]),
      includeCanonicalEvents ? this.prisma.taskTimeEntry.count({ where: timeEntryWhere }) : Promise.resolve(0),
      includeCanonicalEvents
        ? this.prisma.taskPlanningBlock.findMany({
            where: planningBlockWhere,
            include: taskPlanningBlockInclude,
            orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
            take: feedFetchLimit
          })
        : Promise.resolve([]),
      includeCanonicalEvents ? this.prisma.taskPlanningBlock.count({ where: planningBlockWhere }) : Promise.resolve(0)
    ]);

    const feedItems = [
      ...activities.map(mapStoredProjectActivityToFeedItem),
      ...statusHistories.map(mapStatusHistoryToProjectActivity),
      ...timeEntries.map(mapTimeEntryToProjectActivity),
      ...planningBlocks.map(mapPlanningBlockToProjectActivity)
    ]
      .sort(compareActivityFeedItemsDesc)
      .slice(pagination.offset, pagination.offset + pagination.limit);
    const total = storedActivityTotal + statusHistoryTotal + timeEntryTotal + planningBlockTotal;

    return {
      data: feedItems.map(mapProjectActivitySummary),
      meta: {
        principal,
        rowScope: "project",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: feedItems.length })
      }
    };
  }

  async createProjectActivity(projectId: string, input: CreateProjectActivityInput, principal: PrincipalContext, createdByUserId?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project activities can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);

    const activity = await this.prisma.projectActivity.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId: project.accountId,
        projectId: project.id,
        activityType: input.activityType?.trim() || "note",
        subject: nonEmptyString(input.subject, "subject"),
        note: optionalString(input.note, "note") ?? undefined,
        target: optionalString(input.target, "target") ?? undefined,
        occurredAt: optionalDate(input.occurredAt, "occurredAt") ?? new Date(),
        status: input.status?.trim() || "active",
        createdByUserId
      },
      include: projectActivityInclude
    });

    return mapProjectActivitySummary(activity);
  }

  async updateProjectActivity(projectId: string, activityId: string, input: UpdateProjectActivityInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project activities can only be changed by internal users");
    await this.ensureProjectActivity(projectId, activityId, principal.workspaceId);

    const activity = await this.prisma.projectActivity.update({
      where: { id: activityId },
      data: {
        activityType: optionalString(input.activityType, "activityType") ?? undefined,
        subject: optionalString(input.subject, "subject") ?? undefined,
        note: optionalString(input.note, "note"),
        target: optionalString(input.target, "target"),
        occurredAt: optionalDate(input.occurredAt, "occurredAt") ?? undefined,
        status: optionalString(input.status, "status") ?? undefined
      },
      include: projectActivityInclude
    });

    return mapProjectActivitySummary(activity);
  }

  async deleteProjectActivity(projectId: string, activityId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project activities can only be changed by internal users");
    const activity = await this.ensureProjectActivity(projectId, activityId, principal.workspaceId);
    await this.prisma.projectActivity.delete({ where: { id: activity.id } });
    return { deleted: true, id: activity.id };
  }

  async listProjectRisks(projectId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project issue log is internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const status = optionalString(query.status, "status");
    const type = optionalString(query.type, "type");

    const where = {
      workspaceId: principal.workspaceId,
      projectId,
      ...(status ? { status } : {}),
      // Rows of the retired type change_request stay stored and are never listed (chốt 13/10).
      type: { in: ISSUE_LOG_TYPES.filter((item) => !type || item === type) }
    };
    const ctx = await this.permissions.issueLogContext(projectId, principal);
    await refreshProjectIssueLogWarnings(this.prisma, principal.workspaceId, projectId);

    const [risks, total] = await this.prisma.$transaction([
      this.prisma.projectRisk.findMany({
        where,
        include: issueLogInclude,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.projectRisk.count({ where })
    ]);

    return {
      data: risks.map((risk) => mapIssueLogRecord(risk, ctx.actor)),
      meta: {
        principal,
        rowScope: "project",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: risks.length })
      }
    };
  }

  async createProjectRisk(projectId: string, input: CreateProjectRiskInput, principal: PrincipalContext, createdByUserId?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project risks can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const ctx = await this.permissions.issueLogContext(projectId, principal);
    const record = await createIssueLogRecord(ctx, project, input);
    await this.recomputeStatusProposal(projectId, principal); // V-17: an open Blocker/Risk/Issue proposes "Có rủi ro"
    return mapIssueLogRecord(record, ctx.actor);
  }

  async transitionProjectRisk(projectId: string, riskId: string, input: IssueLogTransitionInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project risks can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const existing = await loadIssueLogRecord(this.prisma, principal.workspaceId, projectId, riskId);
    const ctx = await this.permissions.issueLogContext(projectId, principal);
    const record = await transitionIssueLogRecord(ctx, project, existing, input);
    await this.recomputeStatusProposal(projectId, principal); // V-17
    return mapIssueLogRecord(record, ctx.actor);
  }

  async updateProjectRisk(projectId: string, riskId: string, input: UpdateProjectRiskInput, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project risks can only be changed by internal users");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const existing = await loadIssueLogRecord(this.prisma, principal.workspaceId, projectId, riskId);
    const ctx = await this.permissions.issueLogContext(projectId, principal);
    const record = await updateIssueLogRecord(ctx, project, existing, input);
    await this.recomputeStatusProposal(projectId, principal); // V-17
    return mapIssueLogRecord(record, ctx.actor);
  }

  /** Nothing in the log is ever removed: "delete" is the admin-only Huỷ transition and needs a reason. */
  async deleteProjectRisk(projectId: string, riskId: string, principal: PrincipalContext, reason?: string) {
    return this.transitionProjectRisk(projectId, riskId, { action: "cancel", note: reason }, principal);
  }

  async listTasks(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const includeArchived = shouldIncludeArchivedTasks(query.includeArchived);
    const status = optionalString(query.status, "status");
    const where: Prisma.ProjectTaskWhereInput = {
      workspaceId: principal.workspaceId,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(status ? { status } : {}),
      ...(query.assigneeUserId ? {
        OR: [
          { assigneeUserId: query.assigneeUserId },
          { taskAssignees: { some: { userId: query.assigneeUserId } } }
        ]
      } : {}),
      ...(!includeArchived && status !== TASK_ARCHIVE_STATUS ? { archivedAt: null } : {})
    };
    Object.assign(where, this.permissions.taskAccessWhere(principal));

    const include = principal.subjectType === "portal_user" ? portalTaskInclude : taskInclude;
    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.projectTask.findMany({
        where,
        include,
        orderBy: query.projectId
          ? [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
          : [{ dueAt: "asc" }, { updatedAt: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.projectTask.count({ where })
    ]);

    return {
      data: tasks.map(mapTaskSummary),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: tasks.length })
      }
    };
  }

  async getTask(taskId: string, principal: PrincipalContext) {
    const include = principal.subjectType === "portal_user" ? portalTaskDetailInclude : taskDetailInclude;
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal, { include });
    return mapTaskSummary(task);
  }

  async createTask(input: CreateProjectTaskInput, principal: PrincipalContext, createdByUserId?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Tasks can only be created by internal users");
    if (hasInputKey(input, "sortOrder")) {
      throw new BadRequestException("sortOrder can only be changed through the hierarchy order endpoint");
    }
    const plannedStartAt = optionalDate(input.plannedStartAt, "plannedStartAt");
    const dueAt = optionalDate(input.dueAt, "dueAt");
    assertTaskDateRange(plannedStartAt, dueAt);
    if (!canOverrideWorkspaceDayOff(principal) && (plannedStartAt || dueAt) && typeof this.prisma.workspaceDayOff?.findFirst === "function") {
      const scheduleStart = plannedStartAt ?? dueAt!;
      const scheduleEnd = dueAt ?? plannedStartAt!;
      const dayOffKeys = getLocalDateKeysForTimeRange(scheduleStart, scheduleEnd, scheduleStart);
      const blockedDay = await this.prisma.workspaceDayOff.findFirst({
        where: { workspaceId: principal.workspaceId, isActive: true, date: { in: dayOffKeys.map(dateOnlyToUtcDate) } },
        select: { date: true, name: true },
        orderBy: { date: "asc" }
      });
      if (blockedDay) throw new ConflictException(workspaceDayOffMessage(blockedDay));
    }

    const normalized = await this.normalizeTaskScope(input, principal.workspaceId);
    // 7.7 / V-03: a task is added only in a project the account takes part in (Admin: any project).
    if (normalized.projectId && !(await canSeeProject(this.prisma, normalized.projectId, { ...principal, viewMode: "admin" }))) {
      throw new ForbiddenException("Chỉ thành viên dự án hoặc Admin mới được thêm task vào dự án này.");
    }
    const gateStageId = normalized.stageId
      ?? (normalized.parentTaskId ? (await this.prisma.projectTask.findFirst({ where: { id: normalized.parentTaskId, workspaceId: principal.workspaceId }, select: { stageId: true } }))?.stageId : undefined);
    await this.permissions.assertMilestoneUnlocked(this.prisma, principal.workspaceId, gateStageId, "tạo task");
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? undefined;
    const assigneeUserId = optionalString(input.assigneeUserId, "assigneeUserId") ?? undefined;
    const requestedAssigneeUserIds = optionalStringArray(input.assigneeUserIds, "assigneeUserIds") ?? [];
    const assigneeUserIds = Array.from(new Set([
      ...(assigneeUserId ? [assigneeUserId] : []),
      ...requestedAssigneeUserIds
    ]));
    const primaryAssigneeUserId = assigneeUserId ?? assigneeUserIds[0];
    const assignmentUserIds = [ownerUserId, ...assigneeUserIds].filter((id): id is string => Boolean(id));
    if (normalized.projectId) {
      await this.permissions.ensureProjectAssignmentUsers(this.prisma, principal.workspaceId, principal.tenantKey, normalized.projectId, assignmentUserIds);
    } else {
      await this.permissions.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentUserIds);
    }

    if (!normalized.accountId) {
      throw new BadRequestException("accountId is required");
    }

    // D-21 / V-03: once the baseline is locked, a new task that adds planned hours is an Admin's (PM, Dx Director) call and becomes the next baseline version.
    const baselineLocked = !normalized.parentTaskId && await isBaselineLocked(this.prisma, normalized.projectId);
    const isBaselineApprover = baselineLocked && await this.permissions.canReclassifyTask(this.prisma, normalized.projectId, principal);
    if (baselineLocked && (validateTaskEstimateMinutes(input.estimateMinutes) ?? 0) > 0) {
      const blocker = baselineChangeBlocker({ locked: baselineLocked, isApprover: isBaselineApprover });
      if (blocker) throw new ConflictException(blocker);
    }
    // D-02 / D-04: Layer 1 comes from the stage (a sub-task repeats its parent); Layer 2 is derived, whatever the client sent.
    const classification = await this.taskClassificationContext(this.prisma, principal.workspaceId, normalized);
    const layer1 = await this.resolveRequestedTaskTypeLayer1(this.prisma, principal, normalized.projectId, input.taskTypeLayer1, {
      isSubtask: Boolean(normalized.parentTaskId), parentLayer1: classification.parentLayer1, stageLayer1: classification.stageLayer1
    });
    assertTaskTypePair(layer1.value, classification.taskTypeLayer2);

    const requestedStatus = input.status?.trim() || "todo";
    const createdStatusAt = new Date();
    const data: Prisma.ProjectTaskUncheckedCreateInput = {
      accountId: normalized.accountId,
      workspaceId: principal.workspaceId,
      projectId: normalized.projectId,
      stageId: normalized.stageId,
      opportunityId: normalized.opportunityId,
      ticketId: normalized.ticketId,
      parentTaskId: normalized.parentTaskId,
      title: nonEmptyString(input.title, "title"),
      description: optionalString(input.description, "description") ?? undefined,
      taskType: input.taskType?.trim() || "implementation",
      taskTypeLayer1: layer1.value ?? undefined,
      taskTypeLayer2: classification.taskTypeLayer2 ?? undefined,
      status: requestedStatus,
      priority: input.priority?.trim() || "medium",
      ownerUserId,
      assigneeUserId: primaryAssigneeUserId,
      ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId") ?? undefined,
      plannedStartAt: plannedStartAt ?? undefined,
      dueAt: dueAt ?? undefined,
      estimateMinutes: validateTaskEstimateMinutes(input.estimateMinutes) ?? 0,
      customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
      createdByUserId,
      startedAt: requestedStatus === "in_progress" ? createdStatusAt : undefined,
      completedAt: isCompletedTaskStatus(requestedStatus) ? createdStatusAt : undefined,
      cancelledAt: isCancelledTaskStatus(requestedStatus) ? createdStatusAt : undefined
    };

    const inHierarchy = Boolean(normalized.projectId && normalized.stageId && !normalized.parentTaskId);
    // One transaction for the task, its assignees and its warnings, so a failed step never leaves a half-created task.
    const taskResult = await this.prisma.$transaction(async (tx) => {
      let sortOrder = 10;
      if (inHierarchy) {
        await this.lockProjectHierarchy(tx, normalized.projectId!, principal.workspaceId);
        const lastTask = await tx.projectTask.findFirst({
          where: {
            workspaceId: principal.workspaceId,
            projectId: normalized.projectId,
            stageId: normalized.stageId,
            parentTaskId: null,
            archivedAt: null
          },
          orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
          select: { sortOrder: true }
        });
        sortOrder = (lastTask?.sortOrder ?? 0) + 10;
      }
      const created = await tx.projectTask.create({ data: { ...data, sortOrder }, include: taskInclude });
      await this.syncTaskAssignees(tx, principal.workspaceId, created.id, assigneeUserIds, primaryAssigneeUserId);
      if (inHierarchy) {
        await tx.project.update({
          where: { id: normalized.projectId! },
          data: { hierarchyOrderVersion: { increment: 1 } }
        });
      }
      const hydrated = typeof tx.projectTask.findUnique === "function"
        ? await tx.projectTask.findUnique({ where: { id: created.id }, include: taskInclude })
        : null;
      const result = hydrated ?? created;
      await this.syncTaskOwnerWarning(tx, principal, result);
      return result;
    }, inHierarchy ? { isolationLevel: "Serializable" } : undefined);
    const task = taskResult;
    // D-21: a baseline version carries its approver. A member's task without planned hours (V-03) is saved but writes no version;
    // it enters the next version an Admin (PM, Dx Director) writes.
    if (isBaselineApprover && taskResult.projectId) {
      const cause = { type: "plan_edit" as const, id: taskResult.id, reason: `Thêm task "${taskResult.title}" sau khi baseline khóa` };
      await this.prisma.$transaction((tx) => recordBaselineChange(tx, { workspaceId: principal.workspaceId, projectId: taskResult.projectId!, cause, actor: { userId: principal.subjectId, displayName: principal.displayName } }));
    }
    // D-19: sub-task hours against the task — recorded and flagged to the PM, never blocked.
    await syncEstimateNotices(this.prisma, principal.workspaceId, taskResult.projectId, principal.subjectId);

    if (taskResult.projectId && taskResult.stageId) {
      await this.milestoneGates.evaluateMilestoneGateForTask(taskResult, principal);
    }

    await this.prisma.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId,
        actorUserId: createdByUserId ?? principal.subjectId,
        action: "task.created",
        resource: "task",
        resourceId: task.id,
        requestId: randomUUID(),
        after: {
          title: taskResult.title,
          projectId: taskResult.projectId,
          status: taskResult.status,
          taskType: taskResult.taskType,
          taskTypeLayer1: taskResult.taskTypeLayer1,
          taskTypeLayer2: taskResult.taskTypeLayer2,
          ...(layer1.overridden ? { taskTypeLayer1OverriddenFrom: classification.stageLayer1 } : {}),
          estimateMinutes: taskResult.estimateMinutes,
          assigneeUserIds
        }
      }
    });
    if (taskResult.projectId && typeof this.prisma.projectActivity?.create === "function") {
      await this.prisma.projectActivity.create({
        data: {
          workspaceId: principal.workspaceId,
          projectId: taskResult.projectId,
          accountId: taskResult.accountId,
          activityType: "task_created",
          subject: `Đã tạo task: ${taskResult.title}`,
          note: [
            `Phân loại: ${taskTypeLayer1Label(taskResult.taskTypeLayer1)} / ${taskTypeLayer2Label(taskResult.taskTypeLayer2)}`,
            taskResult.estimateMinutes ? `Giờ kế hoạch: ${taskResult.estimateMinutes} phút` : undefined
          ].filter(Boolean).join(" · "),
          target: taskResult.title,
          occurredAt: new Date(),
          status: "active",
          createdByUserId: createdByUserId ?? principal.subjectId
        }
      });
    }
    return mapTaskSummary(taskResult);
  }

  async updateTask(taskId: string, input: UpdateProjectTaskInput, principal: PrincipalContext, changedByUserId?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task changes are internal");
    const scope = await this.normalizeTaskScope(input, principal.workspaceId, true);
    const existing = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    await this.permissions.assertCanEditTask(this.prisma, existing, principal);
    const stageChanged = scope.stageId !== undefined && scope.stageId !== existing.stageId;
    if (
      (scope.projectId !== undefined && scope.projectId !== existing.projectId)
      || (scope.parentTaskId !== undefined && scope.parentTaskId !== existing.parentTaskId)
    ) {
      throw new BadRequestException("Không đổi project hoặc task cha của task ở màn sửa này. Có thể chuyển task giữa các stage trong cùng project.");
    }
    if (stageChanged) {
      if (!existing.projectId || existing.parentTaskId) {
        throw new BadRequestException("Chỉ task cấp cao nhất trong project mới được chuyển stage.");
      }
      await this.permissions.assertProjectManager(this.prisma, existing.projectId, principal);
      await this.permissions.assertMilestoneUnlocked(this.prisma, principal.workspaceId, scope.stageId, "chuyển task");
    }
    const requestedStatus = optionalString(input.status, "status");
    const statusChangedAt = requestedStatus == null ? undefined : new Date();
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId");
    const assigneeUserId = optionalString(input.assigneeUserId, "assigneeUserId");
    const hasAssigneeList = hasInputKey(input, "assigneeUserIds");
    const requestedAssigneeUserIds = hasAssigneeList ? (optionalStringArray(input.assigneeUserIds, "assigneeUserIds") ?? []) : undefined;
    const assignmentUserIds = [
      ownerUserId,
      ...(hasAssigneeList ? requestedAssigneeUserIds ?? [] : [assigneeUserId])
    ].filter((id): id is string => typeof id === "string");
    const assignmentProjectId = scope.projectId === null ? null : scope.projectId ?? existing.projectId;
    if (assignmentProjectId) {
      await this.permissions.ensureProjectAssignmentUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentProjectId, assignmentUserIds);
    } else {
      await this.permissions.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentUserIds);
    }

    // D-04: Layer 2 is re-derived on every save and a client-sent value is ignored. D-02: a sub-task repeats its parent;
    // on a framework task an unset Layer 1 is filled from the stage, and any other change is a reclassification.
    const classification = await this.taskClassificationContext(this.prisma, principal.workspaceId, {
      projectId: assignmentProjectId,
      stageId: scope.stageId !== undefined ? scope.stageId : existing.stageId,
      parentTaskId: existing.parentTaskId
    });
    let nextTaskTypeLayer1: string | undefined;
    if (existing.parentTaskId) {
      nextTaskTypeLayer1 = classification.parentLayer1 ?? undefined;
    } else if (input.taskTypeLayer1 !== undefined && input.taskTypeLayer1 !== null) {
      if (!isTaskTypeLayer1(input.taskTypeLayer1)) throw new BadRequestException("taskTypeLayer1 must be PRE_SALE, DELIVERY or PM");
      if (input.taskTypeLayer1 !== existing.taskTypeLayer1) {
        if (input.taskTypeLayer1 !== classification.stageLayer1 && !(await this.permissions.canReclassifyTask(this.prisma, existing.projectId, principal))) {
          throw new ForbiddenException("Chỉ PM, Dx Director, BD Lead, Workspace Admin, Founder/GM hoặc người quản lý dự án mới được đổi Lớp 1 của task.");
        }
        nextTaskTypeLayer1 = input.taskTypeLayer1;
      }
    } else if (!existing.taskTypeLayer1) {
      nextTaskTypeLayer1 = classification.stageLayer1 ?? undefined;
    }
    assertTaskTypePair(nextTaskTypeLayer1 ?? existing.taskTypeLayer1, classification.taskTypeLayer2);

    const data: Prisma.ProjectTaskUncheckedUpdateInput = omitUndefined({
        ...scope,
        title: optionalString(input.title, "title") ?? undefined,
        description: optionalString(input.description, "description"),
        taskType: optionalString(input.taskType, "taskType") ?? undefined,
        taskTypeLayer1: nextTaskTypeLayer1,
        taskTypeLayer2: classification.taskTypeLayer2,
        status: requestedStatus ?? undefined,
        priority: optionalString(input.priority, "priority") ?? undefined,
        ownerUserId,
        assigneeUserId: hasAssigneeList ? (assigneeUserId ?? requestedAssigneeUserIds?.[0] ?? null) : assigneeUserId,
        ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId"),
        plannedStartAt: optionalDate(input.plannedStartAt, "plannedStartAt"),
        dueAt: optionalDate(input.dueAt, "dueAt"),
        estimateMinutes: hasInputKey(input, "estimateMinutes")
          ? validateTaskEstimateMinutes(input.estimateMinutes, "estimateMinutes", existing.estimateMinutes)
          : undefined,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? undefined,
        completedAt: requestedStatus == null
          ? undefined
          : isCompletedTaskStatus(requestedStatus)
            ? existing.completedAt ?? statusChangedAt
            : null,
        startedAt: requestedStatus === "in_progress" && !existing.startedAt ? statusChangedAt : undefined,
        cancelledAt: requestedStatus == null
          ? undefined
          : isCancelledTaskStatus(requestedStatus)
            ? existing.cancelledAt ?? statusChangedAt
            : null
      });

    const task = await this.prisma.$transaction(async (tx) => {
      const projectLocks = Array.from(new Set([existing.projectId, assignmentProjectId].filter((id): id is string => Boolean(id)))).sort();
      for (const projectId of projectLocks) await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      const current = await tx.projectTask.findFirst({
        where: { id: taskId, workspaceId: principal.workspaceId },
        include: { taskAssignees: { select: { userId: true, isPrimary: true } } }
      });
      if (!current) throw new NotFoundException("Task not found");
      if (!canOverrideWorkspaceDayOff(principal) && typeof tx.workspaceDayOff?.findFirst === "function") {
        const nextPlannedStartAt = hasInputKey(input, "plannedStartAt") ? optionalDate(input.plannedStartAt, "plannedStartAt") : current.plannedStartAt;
        const nextDueAt = hasInputKey(input, "dueAt") ? optionalDate(input.dueAt, "dueAt") : current.dueAt;
        if (nextPlannedStartAt || nextDueAt) {
          const scheduleStart = nextPlannedStartAt ?? nextDueAt!;
          const scheduleEnd = nextDueAt ?? nextPlannedStartAt!;
          const dayOffKeys = getLocalDateKeysForTimeRange(scheduleStart, scheduleEnd, scheduleStart);
          await lockWorkspaceDayOffDates(tx, principal.workspaceId, dayOffKeys);
          const blockedDay = await tx.workspaceDayOff.findFirst({
            where: { workspaceId: principal.workspaceId, isActive: true, date: { in: dayOffKeys.map(dateOnlyToUtcDate) } },
            select: { date: true, name: true },
            orderBy: { date: "asc" }
          });
          if (blockedDay) throw new ConflictException(workspaceDayOffMessage(blockedDay));
        }
      }
      const currentAssigneeUserIds = Array.from(new Set([
        ...(current.taskAssignees ?? []).map((row) => row.userId),
        ...(current.assigneeUserId ? [current.assigneeUserId] : [])
      ]));
      const nextAssigneeUserIds = hasAssigneeList
        ? Array.from(new Set(requestedAssigneeUserIds ?? []))
        : hasInputKey(input, "assigneeUserId")
          ? (assigneeUserId ? [assigneeUserId] : [])
          : currentAssigneeUserIds;
      const nextPrimaryAssigneeUserId = hasAssigneeList
        ? (assigneeUserId ?? nextAssigneeUserIds[0] ?? null)
        : assigneeUserId;
      // Handing a task to another owner is a transfer too, whichever way the assignees were sent.
      const ownerChanged = hasInputKey(input, "ownerUserId") && (ownerUserId ?? null) !== current.ownerUserId;
      const assignmentChanged = ownerChanged || (hasAssigneeList
        ? nextAssigneeUserIds.join("|") !== currentAssigneeUserIds.join("|") || nextPrimaryAssigneeUserId !== current.assigneeUserId
        : hasInputKey(input, "assigneeUserId") && assigneeUserId !== current.assigneeUserId);
      // D-21: once the baseline is locked, every top-level task of the project is plan-locked exactly like an approved plan.
      const baselineLocked = !current.parentTaskId && await isBaselineLocked(tx, current.projectId);
      if ((current.planApprovalStatus === "APPROVED" || baselineLocked) && !principal.roleCodes.some((roleCode) => TASK_PLAN_APPROVER_ROLES.has(roleCode))) {
        const nextStart = optionalDate(input.plannedStartAt, "plannedStartAt");
        const nextDue = optionalDate(input.dueAt, "dueAt");
        const nextEstimate = validateTaskEstimateMinutes(input.estimateMinutes, "estimateMinutes", current.estimateMinutes);
        // undefined means "not sent": only a value that differs from the approved plan is a change.
        const planChanged = (nextStart !== undefined && !sameInstant(nextStart, current.plannedStartAt))
          || (nextDue !== undefined && !sameInstant(nextDue, current.dueAt))
          || (nextEstimate !== undefined && nextEstimate !== current.estimateMinutes);
        if (planChanged) {
          throw new ConflictException("Kế hoạch của task đã được duyệt và khóa. Hãy gửi yêu cầu thay đổi timeline (Timeline Change Request) để đổi ngày bắt đầu, hạn hoàn thành hoặc giờ kế hoạch.");
        }
      }
      const destinationProjectId = scope.projectId === undefined ? current.projectId : scope.projectId;
      const projectChanged = destinationProjectId !== current.projectId;
      if (projectChanged) {
        if (current.projectId) await this.permissions.assertProjectManager(tx, current.projectId, principal);
        else if (!isAdminAccount(principal)) throw new ForbiddenException("Only Founder/GM can relocate a task without a project");
        if (destinationProjectId) await this.permissions.assertProjectManager(tx, destinationProjectId, principal);
        const retainedUsers = Array.from(new Set([
          ownerUserId === undefined ? current.ownerUserId : ownerUserId,
          ...nextAssigneeUserIds
        ].filter((id): id is string => Boolean(id))));
        if (destinationProjectId) await this.permissions.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, destinationProjectId, retainedUsers);
        else await this.permissions.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, retainedUsers);
        await this.permissions.auditMutation(tx, principal, "task.project_changed", "task", taskId, { projectId: current.projectId }, { projectId: destinationProjectId });
      }
      if (assignmentChanged) {
        const permissions = current.projectId ? await this.permissions.projectPermissions(tx, current.projectId, principal) : { canManage: isAdminAccount(principal), isMember: true };
        const ownsTask = current.ownerUserId === principal.subjectId
          || current.assigneeUserId === principal.subjectId
          || currentAssigneeUserIds.includes(principal.subjectId);
        if (!permissions.canManage && !(permissions.isMember && ownsTask)) throw new ForbiddenException("Chỉ người quản lý dự án hoặc thành viên đang được giao task mới được chuyển giao task này.");
        if (assignmentProjectId) await this.permissions.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, assignmentProjectId, assignmentUserIds);
        else await this.permissions.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, assignmentUserIds);
        await this.syncTaskAssignees(tx, principal.workspaceId, taskId, nextAssigneeUserIds, nextPrimaryAssigneeUserId ?? undefined);
        await this.permissions.auditMutation(tx, principal, "task.assignee_transferred", "task", taskId,
          { ownerUserId: current.ownerUserId, assigneeUserId: current.assigneeUserId, assigneeUserIds: currentAssigneeUserIds },
          { ownerUserId: ownerUserId === undefined ? current.ownerUserId : ownerUserId, assigneeUserId: nextPrimaryAssigneeUserId ?? (assigneeUserId === undefined ? current.assigneeUserId : assigneeUserId), assigneeUserIds: nextAssigneeUserIds });
      }
      if (requestedStatus !== undefined && requestedStatus !== null && requestedStatus !== current.status) {
        await tx.taskStatusHistory.create({ data: { workspaceId: principal.workspaceId, taskId: current.id, accountId: current.accountId, projectId: current.projectId, fromStatus: current.status, toStatus: requestedStatus, changedByUserId: principal.subjectId, changedAt: new Date(), reason: "Task updated" } });
      }
      let updateData = data;
      const hierarchyMembershipChanged = stageChanged && !current.parentTaskId && Boolean(current.projectId);
      const movesIntoHierarchy = hierarchyMembershipChanged && Boolean(scope.stageId);
      if (hierarchyMembershipChanged) {
        await this.lockProjectHierarchy(tx, current.projectId!, principal.workspaceId);
      }
      if (movesIntoHierarchy) {
        const lastTask = await tx.projectTask.findFirst({
          where: {
            workspaceId: principal.workspaceId,
            projectId: current.projectId,
            stageId: scope.stageId,
            parentTaskId: null,
            archivedAt: null,
            id: { not: taskId }
          },
          orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
          select: { sortOrder: true }
        });
        updateData = { ...data, sortOrder: (lastTask?.sortOrder ?? 0) + 10 };
      }
      const updated = await tx.projectTask.update({ where: { id: taskId }, data: updateData, include: taskInclude });
      if (hierarchyMembershipChanged) {
        await tx.project.update({ where: { id: current.projectId! }, data: { hierarchyOrderVersion: { increment: 1 } } });
      }
      if ((updated.taskTypeLayer1 ?? null) !== (current.taskTypeLayer1 ?? null) || (updated.taskTypeLayer2 ?? null) !== (current.taskTypeLayer2 ?? null)) {
        await this.classification.cascadeTaskClassification(tx, principal, updated, {
          taskTypeLayer1: current.taskTypeLayer1 ?? null, taskTypeLayer2: current.taskTypeLayer2 ?? null
        });
      }
      await this.syncTaskOwnerWarning(tx, principal, updated);
      await this.permissions.auditMutation(
        tx,
        principal,
        "task.updated",
        "task",
        taskId,
        {
          title: current.title,
          description: current.description,
          taskType: current.taskType,
          taskTypeLayer1: current.taskTypeLayer1,
          taskTypeLayer2: current.taskTypeLayer2,
          status: current.status,
          priority: current.priority,
          ownerUserId: current.ownerUserId,
          assigneeUserId: current.assigneeUserId,
          assigneeUserIds: currentAssigneeUserIds,
          stageId: current.stageId,
          plannedStartAt: current.plannedStartAt?.toISOString() ?? null,
          dueAt: current.dueAt?.toISOString() ?? null,
          estimateMinutes: current.estimateMinutes
        },
        {
          title: updated.title,
          description: updated.description,
          taskType: updated.taskType,
          taskTypeLayer1: updated.taskTypeLayer1,
          taskTypeLayer2: updated.taskTypeLayer2,
          status: updated.status,
          priority: updated.priority,
          ownerUserId: updated.ownerUserId,
          assigneeUserId: updated.assigneeUserId,
          assigneeUserIds: nextAssigneeUserIds,
          stageId: updated.stageId,
          plannedStartAt: updated.plannedStartAt?.toISOString() ?? null,
          dueAt: updated.dueAt?.toISOString() ?? null,
          estimateMinutes: updated.estimateMinutes
        }
      );
      if (updated.projectId && typeof tx.projectActivity?.create === "function") {
        const changedFields = [
          ["title", current.title, updated.title],
          ["description", current.description, updated.description],
          ["taskType", current.taskType, updated.taskType],
          ["taskTypeLayer1", current.taskTypeLayer1, updated.taskTypeLayer1],
          ["taskTypeLayer2", current.taskTypeLayer2, updated.taskTypeLayer2],
          ["stageId", current.stageId, updated.stageId],
          ["status", current.status, updated.status],
          ["priority", current.priority, updated.priority],
          ["ownerUserId", current.ownerUserId, updated.ownerUserId],
          ["assigneeUserId", current.assigneeUserId, updated.assigneeUserId],
          ["assigneeUserIds", currentAssigneeUserIds.join("|"), nextAssigneeUserIds.join("|")],
          ["plannedStartAt", current.plannedStartAt?.toISOString() ?? null, updated.plannedStartAt?.toISOString() ?? null],
          ["dueAt", current.dueAt?.toISOString() ?? null, updated.dueAt?.toISOString() ?? null],
          ["estimateMinutes", current.estimateMinutes, updated.estimateMinutes]
        ].filter(([, before, after]) => before !== after).map(([field]) => String(field));
        const fieldLabels: Record<string, string> = {
          title: "tên", description: "mô tả", taskType: "loại công việc", taskTypeLayer1: "Lớp 1 (vai trò đóng góp)",
          taskTypeLayer2: "Lớp 2 (bối cảnh công việc)", stageId: "stage", status: "trạng thái", priority: "ưu tiên", ownerUserId: "owner",
          assigneeUserId: "người phụ trách", plannedStartAt: "ngày bắt đầu", dueAt: "deadline", estimateMinutes: "giờ kế hoạch"
          ,assigneeUserIds: "người đồng phụ trách"
        };
        await tx.projectActivity.create({
          data: {
            workspaceId: principal.workspaceId,
            projectId: updated.projectId,
            accountId: updated.accountId,
            activityType: "task_updated",
            subject: `Đã cập nhật task: ${updated.title}`,
            note: changedFields.length > 0
              ? `Đã chỉnh sửa: ${changedFields.map((field) => fieldLabels[field] ?? field).join(", ")}.`
              : "Đã lưu thay đổi task vào lịch sử.",
            target: updated.title,
            occurredAt: new Date(),
            status: "active",
            createdByUserId: changedByUserId ?? principal.subjectId
          }
        });
      }
      // D-21 (Ghi nhận): an Admin's direct change of dates or estimate after the baseline is locked becomes the next baseline version
      // (before/after, who, why). Nothing is written when no baselined field changed.
      if (baselineLocked && updated.projectId) {
        await recordBaselineChange(tx, {
          workspaceId: principal.workspaceId, projectId: updated.projectId, actor: { userId: principal.subjectId, displayName: principal.displayName },
          cause: { type: "plan_edit", id: updated.id, reason: optionalString(input.planChangeReason, "planChangeReason") ?? `Admin sửa trực tiếp kế hoạch task "${updated.title}"` }
        });
      }
      return updated;
    });
    await syncEstimateNotices(this.prisma, principal.workspaceId, task.projectId, principal.subjectId); // D-19
    if ((requestedStatus !== undefined || stageChanged) && task.projectId && task.stageId) {
      await this.milestoneGates.evaluateMilestoneGateForTask(task, principal);
    }
    return mapTaskSummary(task);
  }

  async deleteTask(taskId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Tasks are internal");
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    await this.permissions.assertCanEditTask(this.prisma, task, principal);

    if (task.archivedAt) {
      return {
        deleted: false,
        archived: true,
        id: task.id,
        archivedAt: task.archivedAt.toISOString()
      };
    }

    const [subtaskCount, historyCount, timeEntryCount, planningBlockCount, commentCount, attachmentCount] = await this.prisma.$transaction([
      this.prisma.projectTask.count({ where: { parentTaskId: task.id, workspaceId: principal.workspaceId } }),
      this.prisma.taskStatusHistory.count({ where: { taskId: task.id, workspaceId: principal.workspaceId } }),
      this.prisma.taskTimeEntry.count({ where: { taskId: task.id, workspaceId: principal.workspaceId } }),
      this.prisma.taskPlanningBlock.count({ where: { taskId: task.id, workspaceId: principal.workspaceId } }),
      this.prisma.taskComment.count({ where: { taskId: task.id, workspaceId: principal.workspaceId } }),
      this.prisma.taskAttachment.count({ where: { taskId: task.id, workspaceId: principal.workspaceId } })
    ]);

    const hasHistory = subtaskCount + historyCount + timeEntryCount + planningBlockCount + commentCount + attachmentCount > 0;
    // A hard delete cannot be undone, so only a project manager or workspace admin gets one; for everyone else the task is archived.
    if (hasHistory || !(await this.permissions.canManageProjectOrAdmin(this.prisma, task.projectId, principal))) {
      const archivedAt = new Date();
      const archiveNote = hasHistory
        ? { history: "Task archived instead of deleted because it has operational history", task: "Deleted from UI; preserved because task has operational history" }
        : { history: "Task archived instead of deleted: only a project manager or workspace admin can delete permanently", task: "Deleted from UI; archived because only a project manager or workspace admin can delete permanently" };
      const hierarchyMembershipChanges = Boolean(
        task.projectId
        && task.stageId
        && (task.parentTaskId === null || subtaskCount > 0)
      );
      if (hierarchyMembershipChanges) {
        await this.prisma.$transaction(async (tx) => {
          await this.lockProjectHierarchy(tx, task.projectId!, principal.workspaceId);
          const promotedChildren = await tx.projectTask.findMany({
            where: {
              parentTaskId: task.id,
              workspaceId: principal.workspaceId,
              projectId: task.projectId,
              stageId: task.stageId,
              archivedAt: null
            },
            select: { id: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
          });
          const lastTopLevel = await tx.projectTask.findFirst({
            where: {
              workspaceId: principal.workspaceId,
              projectId: task.projectId,
              stageId: task.stageId,
              parentTaskId: null,
              archivedAt: null,
              id: { not: task.id }
            },
            orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
            select: { sortOrder: true }
          });
          let nextSortOrder = (lastTopLevel?.sortOrder ?? 0) + 10;
          for (const child of promotedChildren) {
            await tx.projectTask.update({
              where: { id: child.id },
              data: { parentTaskId: null, sortOrder: nextSortOrder }
            });
            nextSortOrder += 10;
          }
          await tx.taskStatusHistory.create({
            data: {
              workspaceId: principal.workspaceId,
              taskId: task.id,
              accountId: task.accountId,
              projectId: task.projectId,
              fromStatus: task.status,
              toStatus: TASK_ARCHIVE_STATUS,
              changedByUserId: principal.subjectId,
              changedAt: archivedAt,
              reason: archiveNote.history
            }
          });
          await tx.projectTask.update({
            where: { id: task.id },
            data: {
              status: TASK_ARCHIVE_STATUS,
              archivedAt,
              archivedByUserId: principal.subjectId,
              archiveReason: archiveNote.task,
              cancelledAt: task.cancelledAt ?? archivedAt
            }
          });
          await this.afterTaskArchived(tx, principal, task, archivedAt);
          await tx.project.update({
            where: { id: task.projectId! },
            data: { hierarchyOrderVersion: { increment: 1 } }
          });
        }, { isolationLevel: "Serializable" });

        return {
          deleted: false,
          archived: true,
          id: task.id,
          archivedAt: archivedAt.toISOString()
        };
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.projectTask.updateMany({
          where: {
            parentTaskId: task.id,
            workspaceId: principal.workspaceId
          },
          data: { parentTaskId: null }
        });
        await tx.taskStatusHistory.create({
          data: {
            workspaceId: principal.workspaceId,
            taskId: task.id,
            accountId: task.accountId,
            projectId: task.projectId,
            fromStatus: task.status,
            toStatus: TASK_ARCHIVE_STATUS,
            changedByUserId: principal.subjectId,
            changedAt: archivedAt,
            reason: archiveNote.history
          }
        });
        await tx.projectTask.update({
          where: { id: task.id },
          data: {
            status: TASK_ARCHIVE_STATUS,
            archivedAt,
            archivedByUserId: principal.subjectId,
            archiveReason: archiveNote.task,
            cancelledAt: task.cancelledAt ?? archivedAt
          }
        });
        await this.afterTaskArchived(tx, principal, task, archivedAt);
      });

      return {
        deleted: false,
        archived: true,
        id: task.id,
        archivedAt: archivedAt.toISOString()
      };
    }

    const inHierarchy = Boolean(task.projectId && task.stageId && task.parentTaskId === null);
    await this.prisma.$transaction(async (tx) => {
      if (inHierarchy) await this.lockProjectHierarchy(tx, task.projectId!, principal.workspaceId);
      await tx.projectTask.delete({ where: { id: task.id } });
      if (inHierarchy) {
        await tx.project.update({
          where: { id: task.projectId! },
          data: { hierarchyOrderVersion: { increment: 1 } }
        });
      }
      if (task.projectId) {
        await closeProjectWarnings(tx, { projectId: task.projectId, dedupeKey: `NL-03:task:${task.id}` }, principal.subjectId, "Task đã bị xóa");
        await this.closeResolvedDepartedMemberWarnings(tx, principal, task.projectId);
      }
      await this.permissions.auditMutation(tx, principal, "task.deleted", "task", task.id, { title: task.title, projectId: task.projectId, stageId: task.stageId, status: task.status, ownerUserId: task.ownerUserId, assigneeUserId: task.assigneeUserId });
    }, inHierarchy ? { isolationLevel: "Serializable" } : undefined);

    return { deleted: true, archived: false, id: task.id };
  }

  async transitionTask(taskId: string, input: TransitionProjectTaskInput, principal: PrincipalContext, changedByUserId?: string) {
    // No portal write is intended here: a customer could otherwise set any status string and backdate changedAt.
    this.permissions.assertInternalTaskPrincipal(principal, "Task status can only be changed by internal users");
    const existing = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    await this.permissions.assertCanEditTask(this.prisma, existing, principal);
    const toStatus = nonEmptyString(input.status, "status");
    // Nothing changed: no history row, no timestamps touched.
    if (toStatus === existing.status) return this.getTask(taskId, principal);
    // Backdating a status change moves completedAt / SLA clocks, so only a project manager or Admin may pass changedAt.
    const requestedChangedAt = optionalDate(input.changedAt, "changedAt");
    const changedAt = requestedChangedAt && await this.permissions.canManageProjectOrAdmin(this.prisma, existing.projectId, principal) ? requestedChangedAt : new Date();

    const task = await this.prisma.$transaction(async (tx) => {
      await tx.taskStatusHistory.create({
        data: {
          workspaceId: principal.workspaceId,
          taskId: existing.id,
          accountId: existing.accountId,
          projectId: existing.projectId,
          fromStatus: existing.status,
          toStatus,
          changedByUserId,
          changedAt,
          reason: optionalString(input.reason, "reason") ?? undefined
        }
      });

      const updated = await tx.projectTask.update({
        where: { id: existing.id },
        data: {
          status: toStatus,
          startedAt: toStatus === "in_progress" && !existing.startedAt ? changedAt : undefined,
          completedAt: isCompletedTaskStatus(toStatus) ? existing.completedAt ?? changedAt : null,
          cancelledAt: isCancelledTaskStatus(toStatus) ? existing.cancelledAt ?? changedAt : null
        },
        include: taskInclude
      });
      await this.syncTaskOwnerWarning(tx, principal, updated);
      return updated;
    });

    if (task.projectId && task.stageId) {
      await this.milestoneGates.evaluateMilestoneGateForTask(task, principal);
    }
    return mapTaskSummary(task);
  }
  async listTaskPlanningBlocks(query: any, principal: PrincipalContext) { return this.timeEntries.listTaskPlanningBlocks(query, principal); } // kept for existing callers
  async createTaskPlanningBlock(taskId: string, input: CreateTaskPlanningBlockInput, principal: PrincipalContext, fallbackUserId?: string) { return this.timeEntries.createTaskPlanningBlock(taskId, input, principal, fallbackUserId); } // kept for existing callers
  async transitionTaskPlanningBlock(blockId: string, input: TransitionTaskPlanningBlockInput, principal: PrincipalContext, changedByUserId?: string) { return this.timeEntries.transitionTaskPlanningBlock(blockId, input, principal, changedByUserId); } // kept for existing callers
  async listTaskTimeEntries(query: any, principal: PrincipalContext) { return this.timeEntries.listTaskTimeEntries(query, principal); } // kept for existing callers
  async deleteTaskPlanningBlock(blockId: string, principal: PrincipalContext) { return this.timeEntries.deleteTaskPlanningBlock(blockId, principal); } // kept for existing callers
  async deleteTaskTimeEntry(entryId: string, principal: PrincipalContext) { return this.timeEntries.deleteTaskTimeEntry(entryId, principal, (projectId, actor) => this.recomputeStatusProposal(projectId, actor)); } // kept for existing callers
  async reviewTaskTimeEntry(entryId: string, input: ReviewTaskTimeEntryInput, principal: PrincipalContext) { return this.timeEntries.reviewTaskTimeEntry(entryId, input, principal); } // kept for existing callers
  async createTimeEntry(taskId: string, input: CreateTaskTimeEntryInput, principal: PrincipalContext, fallbackUserId?: string): Promise<CreateTaskTimeEntryResponse> { return this.timeEntries.createTimeEntry(taskId, input, principal, fallbackUserId, (projectId, actor) => this.recomputeStatusProposal(projectId, actor)); } // kept for existing callers
  async updateTimeEntryLayer2(entryId: string, input: UpdateTaskTimeEntryLayer2Input, principal: PrincipalContext) { return this.timeEntries.updateTimeEntryLayer2(entryId, input, principal); } // kept for existing callers

  async listTaskComments(taskId: string, query: any, principal: PrincipalContext) {
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where: Prisma.TaskCommentWhereInput = {
      workspaceId: principal.workspaceId,
      taskId: task.id,
      status: optionalEnum(query.status, "status", COMMENT_STATUSES) ?? "active"
    };
    const visibility = optionalEnum(query.visibility, "visibility", COMMENT_VISIBILITIES);
    if (principal.subjectType === "portal_user") {
      where.visibility = "customer";
    } else if (visibility) {
      where.visibility = visibility;
    }

    const [comments, total] = await Promise.all([
      this.prisma.taskComment.findMany({
        where,
        include: taskCommentInclude,
        orderBy: [{ createdAt: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.taskComment.count({ where })
    ]);

    return {
      data: comments.map(mapTaskCommentSummary),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: comments.length })
      }
    };
  }

  async createTaskComment(taskId: string, input: CreateTaskCommentInput, principal: PrincipalContext, createdByUserId?: string) {
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const parentCommentId = optionalString(input.parentCommentId, "parentCommentId");
    const visibility = optionalEnum(input.visibility, "visibility", COMMENT_VISIBILITIES) ?? "internal";
    if (principal.subjectType === "portal_user" && visibility !== "customer") {
      throw new ForbiddenException("Portal users can only create customer-visible task comments");
    }

    if (parentCommentId) {
      const parent = await this.prisma.taskComment.findFirst({
        where: { id: parentCommentId, taskId: task.id, workspaceId: principal.workspaceId, status: "active" },
        select: { id: true }
      });
      if (!parent) {
        throw new BadRequestException("Parent task comment does not belong to selected task");
      }
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taskComment.create({
        data: {
          workspaceId: principal.workspaceId,
          taskId: task.id,
          accountId: task.accountId,
          projectId: task.projectId,
          parentCommentId: parentCommentId ?? undefined,
          body: nonEmptyString(input.body, "body"),
          visibility,
          status: "active",
          larkTaskGuid: optionalString(input.larkTaskGuid, "larkTaskGuid") ?? undefined,
          syncStatus: "not_synced",
          createdByUserId
        },
        include: taskCommentInclude
      });

      if (task.projectId) {
        await tx.projectActivity.create({
          data: {
            workspaceId: principal.workspaceId,
            projectId: task.projectId,
            accountId: task.accountId,
            activityType: "task_comment",
            subject: `Commented on task: ${task.title}`,
            note: created.body,
            target: task.title,
            occurredAt: created.createdAt,
            status: "active",
            createdByUserId
          }
        });
      }

      return created;
    });

    return mapTaskCommentSummary(comment);
  }

  async listTaskAttachments(taskId: string, query: any, principal: PrincipalContext) {
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where: Prisma.TaskAttachmentWhereInput = {
      workspaceId: principal.workspaceId,
      taskId: task.id,
      ...(principal.subjectType === "portal_user" ? { fileObject: { customerVisible: true, internalOnly: false } } : {})
    };
    const commentId = optionalString(query.commentId, "commentId");
    if (commentId) where.commentId = commentId;

    const [attachments, total] = await Promise.all([
      this.prisma.taskAttachment.findMany({
        where,
        include: taskAttachmentInclude,
        orderBy: [{ createdAt: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.taskAttachment.count({ where })
    ]);

    return {
      data: attachments.map(mapTaskAttachmentSummary),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: attachments.length })
      }
    };
  }

  async createTaskAttachment(taskId: string, input: CreateTaskAttachmentInput, principal: PrincipalContext, createdByUserId?: string) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task attachments are internal");
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const fileObjectId = nonEmptyString(input.fileObjectId, "fileObjectId");

    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: fileObjectId,
        workspaceId: principal.workspaceId,
        accountId: task.accountId,
        status: "active",
        ownerType: "task",
        ownerId: task.id
      }
    });
    if (!file) {
      throw new NotFoundException("File object not found");
    }
    if ((file.projectId ?? null) !== (task.projectId ?? null)) {
      throw new BadRequestException("File object does not belong to selected task project");
    }

    const commentId = optionalString(input.commentId, "commentId");
    if (commentId) {
      const comment = await this.prisma.taskComment.findFirst({
        where: { id: commentId, taskId: task.id, workspaceId: principal.workspaceId, status: "active" },
        select: { id: true }
      });
      if (!comment) {
        throw new BadRequestException("Comment does not belong to selected task");
      }
    }

    const attachment = await this.prisma.taskAttachment.create({
      data: {
        workspaceId: principal.workspaceId,
        taskId: task.id,
        accountId: task.accountId,
        projectId: task.projectId,
        fileObjectId: file.id,
        commentId: commentId ?? undefined,
        larkTaskGuid: optionalString(input.larkTaskGuid, "larkTaskGuid") ?? undefined,
        syncStatus: "not_synced",
        createdByUserId
      },
      include: taskAttachmentInclude
    });

    return mapTaskAttachmentSummary(attachment);
  }

  async deleteTaskAttachment(taskId: string, attachmentId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task attachments are internal");
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: {
        id: attachmentId,
        taskId: task.id,
        workspaceId: principal.workspaceId
      },
      select: { id: true }
    });
    if (!attachment) {
      throw new NotFoundException("Task attachment not found");
    }

    await this.prisma.taskAttachment.delete({ where: { id: attachment.id } });
    return { deleted: true, id: attachment.id };
  }

  private async normalizeTaskScope(input: Partial<CreateProjectTaskInput> | Partial<UpdateProjectTaskInput>, workspaceId: string, allowPartial = false) {
    const projectId = optionalString(input.projectId, "projectId");
    const stageId = optionalString(input.stageId, "stageId");
    const explicitAccountId = optionalString(input.accountId, "accountId");

    if (allowPartial && projectId === undefined && stageId === undefined && explicitAccountId === undefined) {
      return {};
    }

    const stage = typeof stageId === "string" ? await this.prisma.projectStage.findFirst({ where: { id: stageId, workspaceId } }) : undefined;
    const project =
      typeof projectId === "string"
        ? await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } })
        : stage?.projectId
          ? await this.prisma.project.findFirst({ where: { id: stage.projectId, workspaceId } })
          : undefined;

    const accountId = explicitAccountId ?? stage?.accountId ?? project?.accountId;
    if (!accountId) {
      throw new BadRequestException("accountId is required when task is not attached to a project or stage");
    }

    await this.ensureAccount(accountId, workspaceId);
    if (typeof projectId === "string" && !project) {
      throw new NotFoundException("Project not found");
    }
    if (typeof stageId === "string" && !stage) {
      throw new NotFoundException("Project stage not found");
    }
    if (project && project.accountId !== accountId) {
      throw new BadRequestException("Project does not belong to accountId");
    }
    if (stage && (stage.accountId !== accountId || (project && stage.projectId !== project.id))) {
      throw new BadRequestException("Project stage does not belong to the selected account/project");
    }

    const parentTaskId = optionalString(input.parentTaskId, "parentTaskId");
    const parentTask = parentTaskId ? await this.prisma.projectTask.findFirst({ where: { id: parentTaskId, workspaceId } }) : undefined;
    if (parentTaskId) {
      if (!parentTask) {
        throw new NotFoundException("Parent task not found");
      }
      if (parentTask.accountId !== accountId || (project && parentTask.projectId !== project.id) || (projectId === null && parentTask.projectId)) {
        throw new BadRequestException("Parent task does not belong to the selected account/project");
      }
    }

    return {
      accountId,
      workspaceId,
      // A sub-task lives in its parent's project, so the project's visibility and gates apply to it too.
      projectId: projectId === null ? null : project?.id ?? projectId ?? parentTask?.projectId ?? undefined,
      stageId,
      opportunityId: optionalString(input.opportunityId, "opportunityId"),
      ticketId: optionalString(input.ticketId, "ticketId"),
      parentTaskId
    };
  }

  /**
   * What a task's classification comes from: its parent (D-02), its stage (a sub-task without one uses its parent's)
   * and its project (D-04). Layer 2 is derived here and nowhere else on the write path.
   */
  private async taskClassificationContext(
    client: Prisma.TransactionClient,
    workspaceId: string,
    scope: { projectId?: string | null; stageId?: string | null; parentTaskId?: string | null }
  ) {
    const parent = scope.parentTaskId
      ? await client.projectTask.findFirst({ where: { id: scope.parentTaskId, workspaceId }, select: { stageId: true, taskTypeLayer1: true } })
      : null;
    const stageId = scope.stageId ?? parent?.stageId;
    const stage = stageId
      ? await client.projectStage.findFirst({ where: { id: stageId, workspaceId }, select: { taskTypeLayer1: true, afterPnlClose: true } })
      : null;
    const project = scope.projectId
      ? await client.project.findFirst({ where: { id: scope.projectId, workspaceId }, select: { projectType: true } })
      : null;
    return {
      parentLayer1: parent?.taskTypeLayer1 ?? null,
      stageLayer1: stage?.taskTypeLayer1 ?? null,
      taskTypeLayer2: deriveTaskTypeLayer2({ projectType: project?.projectType, afterPnlClose: stage?.afterPnlClose })
    };
  }

  /** D-08: one DX Internal Worklog project per workspace. */
  private async assertSingleInternalWorklog(client: Prisma.TransactionClient, workspaceId: string, projectType: string | null | undefined, exceptProjectId?: string) {
    if (!isInternalWorklogProjectType(projectType) || typeof (client as any).project?.findFirst !== "function") return;
    const other = await client.project.findFirst({ where: { workspaceId, projectType: "internal_worklog", ...(exceptProjectId ? { id: { not: exceptProjectId } } : {}) }, select: { id: true } });
    if (other) throw new ConflictException("Workspace đã có dự án DX Internal Worklog; mỗi workspace chỉ có một dự án loại này.");
  }
  async lostDealPreSaleSummary(principal: PrincipalContext) { return this.classification.lostDealPreSaleSummary(principal); } // kept for existing callers
  // Called by name from the conversion hooks (framework-conversion.service.ts projectsServiceHooks, scripts/operations/convert-legacy-data.ts).
  private async rederiveProjectTaskLayer2(tx: Prisma.TransactionClient, principal: PrincipalContext, projectId: string, cause: string) { return this.classification.rederiveProjectTaskLayer2(tx, principal, projectId, cause); }
  private async reclassifyTaskTimeEntries(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[], classification: { taskTypeLayer1?: string | null; taskTypeLayer2?: string | null }) { return this.classification.reclassifyTaskTimeEntries(tx, workspaceId, taskIds, classification); }

  /**
   * D-02: validates a client-sent Layer 1 and decides whether it counts. Replacing the stage's value is an override:
   * only an Admin account (PM, Dx Director, BD Lead, Workspace Admin, Founder/GM) or the project's manager may do it.
   */
  private async resolveRequestedTaskTypeLayer1(
    client: Prisma.TransactionClient,
    principal: PrincipalContext,
    projectId: string | null | undefined,
    requested: unknown,
    context: { isSubtask: boolean; parentLayer1?: string | null; stageLayer1: string | null }
  ) {
    if (requested !== undefined && requested !== null && !isTaskTypeLayer1(requested)) {
      throw new BadRequestException("taskTypeLayer1 must be PRE_SALE, DELIVERY or PM");
    }
    const isOverride = !context.isSubtask && Boolean(requested) && Boolean(context.stageLayer1) && requested !== context.stageLayer1;
    const canOverride = isOverride && await this.permissions.canReclassifyTask(client, projectId, principal);
    if (isOverride && !canOverride) {
      throw new ForbiddenException("Chỉ PM, Dx Director, BD Lead, Workspace Admin, Founder/GM hoặc người quản lý dự án mới được đổi Lớp 1 khác với stage.");
    }
    return resolveTaskTypeLayer1({ requested: requested as string | null | undefined, canOverride, ...context });
  }
  async classifyStage(projectId: string, stageId: string, input: { taskTypeLayer1?: unknown; afterPnlClose?: unknown }, principal: PrincipalContext) { return this.classification.classifyStage(projectId, stageId, input, principal); } // kept for existing callers
  async confirmLegacyTimeEntryGroup(entryId: string, principal: PrincipalContext) { return this.timeEntries.confirmLegacyTimeEntryGroup(entryId, principal); } // kept for existing callers
  private async standardDayCapMinutes(client: Prisma.TransactionClient, workspaceId: string, userId: string, localDate: string) { return this.timeEntries.standardDayCapMinutes(client, workspaceId, userId, localDate); } // kept for existing callers

  /** NL-03 closes with the task; the archive is audited like any other task change. */
  private async afterTaskArchived(tx: Prisma.TransactionClient, principal: PrincipalContext, task: { id: string; projectId: string | null; stageId?: string | null; title: string; status: string; ownerUserId: string | null; assigneeUserId: string | null }, archivedAt: Date) {
    await this.syncTaskOwnerWarning(tx, principal, { ...task, status: TASK_ARCHIVE_STATUS, archivedAt });
    await this.permissions.auditMutation(tx, principal, "task.archived", "task", task.id, { status: task.status }, { status: TASK_ARCHIVE_STATUS, archivedAt: archivedAt.toISOString() });
    // D-20 / D-21: an archived task leaves the baselined plan — the next version says so (nothing is written before the baseline is locked or for a sub-task).
    if (task.projectId) await this.permissions.recordPlanBaseline(tx, principal, task.projectId, task.id, `Lưu trữ task "${task.title}"`);
  }

  async listProjectMembers(projectId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project member directory is internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination(query);
    const q = optionalString(query.q ?? query.search, "q");
    const where: Prisma.UserWhereInput = {
      projectMembers: { some: { workspaceId: principal.workspaceId, projectId } },
      ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {})
    };
    // EV-035: participation is only derivable for a period; without one the directory is unchanged.
    const period = query.startDate || query.endDate ? participationPeriod(query) : undefined;
    const [users, total, permissions] = await Promise.all([
      this.prisma.user.findMany({ where, select: { id: true, displayName: true, email: true, avatarUrl: true, status: true,
        resourceProfile: { select: { employmentStatus: true } },
        roleBindings: { where: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() }, select: { role: { select: { code: true } } } } }, orderBy: [{ displayName: "asc" }, { id: "asc" }], skip: pagination.offset, take: pagination.limit }),
      this.prisma.user.count({ where }), this.permissions.projectPermissions(this.prisma, projectId, principal)
    ]);
    const participation = period
      ? await this.computeMemberParticipation(await this.permissions.ensureProject(projectId, principal.workspaceId), users.map((user) => user.id), period)
      : undefined;
    return { data: users.map((user) => {
      const employmentStatus = deriveProjectMemberEmploymentStatus(user);
      return {
        ...participation?.get(user.id),
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? undefined,
        status: employmentStatus === "ACTIVE" ? "active" : employmentStatus === "ON_LEAVE" ? "on_hold" : "released",
        employmentStatus,
        roleCodes: user.roleBindings.map((binding) => binding.role.code)
      };
    }),
      meta: { pagination: buildPaginationMeta({ ...pagination, total, returned: users.length }), permissions: { canManage: permissions.canManage, canLogForOthers: permissions.canLogForOthers }, principalUserId: principal.subjectId } };
  }

  async listTaskAssignmentHistory(taskId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task assignment history is internal");
    await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const pagination = normalizePagination(query);
    const where = { workspaceId: principal.workspaceId, resource: "task", resourceId: taskId, action: "task.assignee_transferred" };
    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pagination.limit, skip: pagination.offset }),
      this.prisma.auditEvent.count({ where })
    ]);
    return { data: events.map((event) => ({ id: event.id, changedByUserId: event.actorUserId, changedAt: event.createdAt.toISOString(), before: event.before, after: event.after })), meta: { pagination: buildPaginationMeta({ ...pagination, total, returned: events.length }) } };
  }

  async listTaskHistory(taskId: string, query: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Task history is internal");
    const task = await this.permissions.ensureTaskForPrincipal(taskId, principal);
    const pagination = normalizePagination({ limit: query.limit ?? 30, offset: query.offset });
    const auditWhere = {
      workspaceId: principal.workspaceId,
      resource: "task",
      resourceId: taskId,
      action: { in: ["task.created", "task.updated", "task.assignee_transferred", "task.project_changed"] }
    };
    const statusWhere = { workspaceId: principal.workspaceId, taskId };
    const [auditEvents, auditTotal, statusHistory, statusTotal] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where: auditWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pagination.offset + pagination.limit
      }),
      this.prisma.auditEvent.count({ where: auditWhere }),
      this.prisma.taskStatusHistory.findMany({
        where: statusWhere,
        orderBy: [{ changedAt: "desc" }, { id: "desc" }],
        take: pagination.offset + pagination.limit
      }),
      this.prisma.taskStatusHistory.count({ where: statusWhere })
    ]);

    const history = [
      ...auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        changedByUserId: event.actorUserId,
        changedAt: event.createdAt.toISOString(),
        before: event.before,
        after: event.after,
        reason: undefined
      })),
      ...statusHistory.map((event) => ({
        id: `status:${event.id}`,
        action: "task.status_changed",
        changedByUserId: event.changedByUserId,
        changedAt: event.changedAt.toISOString(),
        before: { status: event.fromStatus },
        after: { status: event.toStatus },
        reason: event.reason
      }))
    ].sort((left, right) => {
      const timeDelta = new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime();
      return timeDelta || right.id.localeCompare(left.id);
    });

    return {
      data: history.slice(pagination.offset, pagination.offset + pagination.limit),
      meta: {
        pagination: buildPaginationMeta({
          ...pagination,
          total: auditTotal + statusTotal,
          returned: Math.min(pagination.limit, Math.max(0, history.length - pagination.offset))
        }),
        taskId: task.id
      }
    };
  }

  private async syncTaskAssignees(
    tx: TaskAssigneeClient,
    workspaceId: string,
    taskId: string,
    userIds: string[],
    primaryUserId?: string
  ) {
    const assigneeModel = (tx as any).projectTaskAssignee;
    if (!assigneeModel || typeof assigneeModel.deleteMany !== "function" || typeof assigneeModel.createMany !== "function") return;
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    await assigneeModel.deleteMany({ where: { workspaceId, taskId } });
    if (uniqueIds.length === 0) return;

    await assigneeModel.createMany({
      data: uniqueIds.map((userId, index) => ({
        workspaceId,
        taskId,
        userId,
        isPrimary: userId === primaryUserId || (!primaryUserId && index === 0)
      })),
      skipDuplicates: true
    });
  }

  private async syncProjectMembers(
    tx: Prisma.TransactionClient,
    input: { workspaceId: string; projectId: string; userIds: string[]; relation: string; principal?: PrincipalContext; protectAssignments?: boolean }
  ) {
    const uniqueUserIds = Array.from(new Set(input.userIds.filter(Boolean)));
    if (input.protectAssignments) {
      const existing = await tx.projectMember.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, select: { userId: true } });
      const removed = Array.from(new Set(existing.map((row) => row.userId))).filter((id) => !uniqueUserIds.includes(id));
      if (removed.length) {
        const [tasks, stages] = await Promise.all([
          tx.projectTask.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES }, OR: [{ ownerUserId: { in: removed } }, { assigneeUserId: { in: removed } }] } }),
          tx.projectStage.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ownerUserId: { in: removed }, status: { notIn: CLOSED_WORK_STATUSES } } })
        ]);
        if (tasks || stages) throw new ConflictException(`Chưa gỡ được thành viên khỏi dự án: người này còn phụ trách ${[tasks ? `${tasks} task đang mở` : "", stages ? `${stages} stage/milestone chưa xong` : ""].filter(Boolean).join(" và ")}. Hãy chuyển các việc đó cho thành viên khác trước.`);
        // The block above covers owner/primary assignee; co-assignees can still leave with open tasks -> NL-01.
        if (input.principal && typeof (tx as any).projectWarning?.findFirst === "function") {
          const coAssigned = await tx.projectTaskAssignee.groupBy({
            by: ["userId"],
            where: { workspaceId: input.workspaceId, userId: { in: removed }, task: { projectId: input.projectId, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES } } },
            _count: { _all: true }
          });
          const names = coAssigned.length ? new Map((await tx.user.findMany({ where: { id: { in: coAssigned.map((row) => row.userId) } }, select: { id: true, displayName: true } })).map((user) => [user.id, user.displayName])) : new Map<string, string>();
          for (const row of coAssigned) {
            await openOrRefreshProjectWarning(tx, {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              dedupeKey: `NL-01:${row.userId}`,
              typeCode: "NL-01",
              severity: "high",
              title: "Thành viên rời Project Team khi còn Task đang mở",
              detail: `${names.get(row.userId) ?? row.userId} đã bị gỡ khỏi Project Team khi còn ${row._count._all} Task đang mở (đồng phụ trách). PM cần phân công lại.`,
              actorUserId: input.principal.subjectId
            });
          }
        }
      }
      if (input.principal && uniqueUserIds.length) {
        await closeProjectWarnings(tx, { projectId: input.projectId, dedupeKey: { in: uniqueUserIds.map((id) => `NL-01:${id}`) } }, input.principal.subjectId, "Thành viên đã được thêm lại vào Project Team");
      }
      if (input.principal) await this.permissions.auditMutation(tx, input.principal, "project.members_changed", "project", input.projectId, { memberUserIds: Array.from(new Set(existing.map((row) => row.userId))) }, { memberUserIds: uniqueUserIds });
    }
    await tx.projectMember.deleteMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId } });
    if (!uniqueUserIds.length) return;
    await tx.projectMember.createMany({ data: uniqueUserIds.map((userId) => ({ workspaceId: input.workspaceId, projectId: input.projectId, userId, relation: input.relation })), skipDuplicates: true });
  }

  private async upsertProjectBudget(
    tx: Prisma.TransactionClient,
    input: {
      workspaceId: string;
      accountId: string;
      projectId: string;
      projectCode: string;
      budgetAmount: number;
      principal: PrincipalContext;
    }
  ) {
    const amount = Math.max(0, input.budgetAmount);
    const existing = await tx.projectBudget.findFirst({
      where: { workspaceId: input.workspaceId, projectId: input.projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });

    if (existing) {
      await tx.projectBudget.update({
        where: { id: existing.id },
        data: {
          accountId: input.accountId,
          currency: "VND",
          plannedRevenueAmount: amount,
          status: amount > 0 ? "ACTIVE" : "DRAFT"
        }
      });
      return;
    }

    await tx.projectBudget.create({
      data: {
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        projectId: input.projectId,
        code: `${input.projectCode}-BUDGET`,
        currency: "VND",
        revenueBasis: "manual",
        plannedRevenueAmount: amount,
        plannedCostAmount: 0,
        status: amount > 0 ? "ACTIVE" : "DRAFT",
        createdByUserId: input.principal.subjectId
      }
    });
  }

  private async propagateProjectAccount(
    tx: Prisma.TransactionClient,
    input: { workspaceId: string; projectId: string; accountId: string }
  ) {
    const where = { projectId: input.projectId, workspaceId: input.workspaceId };
    const data = { accountId: input.accountId };

    await tx.projectMilestone.updateMany({ where, data });
    await tx.projectStage.updateMany({ where, data });
    await tx.projectTask.updateMany({ where, data });
    await tx.projectArtifact.updateMany({ where, data });
    await tx.fileObject.updateMany({ where, data });
    await tx.fileDownloadGrant.updateMany({ where, data });
    await tx.projectComment.updateMany({ where, data });
    await tx.projectActivity.updateMany({ where, data });
    await tx.projectRisk.updateMany({ where, data });
    await tx.projectAttachment.updateMany({ where, data });
    await tx.taskComment.updateMany({ where, data });
    await tx.taskAttachment.updateMany({ where, data });
    await tx.taskStatusHistory.updateMany({ where, data });
    await tx.taskTimeEntry.updateMany({ where, data });
    await tx.projectBudget.updateMany({ where, data });
    await tx.projectCost.updateMany({ where, data });
    await tx.projectPlSnapshot.updateMany({ where, data });
    await tx.resourceAllocation.updateMany({ where, data });
    await tx.contract.updateMany({ where, data });
    await tx.paymentSchedule.updateMany({ where, data });
    await tx.paymentMilestone.updateMany({ where, data });
    await tx.invoice.updateMany({ where, data });
    await tx.invoicePayment.updateMany({ where, data });
    await tx.ticket.updateMany({ where, data });
    await tx.ticketStatusHistory.updateMany({ where, data });
    await tx.customerAccessGrant.updateMany({ where, data });
    await tx.projectProgressShareLink.updateMany({ where, data });
  }

  private async ensureAccount(accountId: string, workspaceId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, workspaceId } });
    if (!account) {
      throw new NotFoundException("Account not found");
    }

    return account;
  }

  private async ensureOpportunity(opportunityId: string, workspaceId: string, accountId: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, workspaceId, accountId },
      select: { id: true }
    });
    if (!opportunity) {
      throw new NotFoundException("Opportunity not found for account/workspace");
    }
    return opportunity;
  }

  private async getProjectDeleteBlockers(projectId: string, workspaceId: string): Promise<ProjectDeleteBlocker[]> {
    const where = { projectId, workspaceId };
    const [
      tasks,
      taskStatusHistory,
      taskTimeEntries,
      taskPlanningBlocks,
      tickets,
      ticketStatusHistory,
      artifacts,
      files,
      comments,
      activities,
      risks,
      attachments,
      taskComments,
      taskAttachments,
      progressShareLinks,
      contracts,
      paymentSchedules,
      paymentMilestones,
      invoices,
      invoicePayments,
      resourceAllocations,
      costs,
      plSnapshots,
      customerAccessGrants
    ] = await Promise.all([
      this.prisma.projectTask.count({ where }),
      this.prisma.taskStatusHistory.count({ where }),
      this.prisma.taskTimeEntry.count({ where }),
      this.prisma.taskPlanningBlock.count({ where }),
      this.prisma.ticket.count({ where }),
      this.prisma.ticketStatusHistory.count({ where }),
      this.prisma.projectArtifact.count({ where }),
      this.prisma.fileObject.count({ where }),
      this.prisma.projectComment.count({ where }),
      this.prisma.projectActivity.count({ where }),
      this.prisma.projectRisk.count({ where }),
      this.prisma.projectAttachment.count({ where }),
      this.prisma.taskComment.count({ where }),
      this.prisma.taskAttachment.count({ where }),
      this.prisma.projectProgressShareLink.count({ where }),
      this.prisma.contract.count({ where }),
      this.prisma.paymentSchedule.count({ where }),
      this.prisma.paymentMilestone.count({ where }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoicePayment.count({ where }),
      this.prisma.resourceAllocation.count({ where }),
      this.prisma.projectCost.count({ where }),
      this.prisma.projectPlSnapshot.count({ where }),
      this.prisma.customerAccessGrant.count({ where })
    ]);

    return [
      { label: "tasks", count: tasks },
      { label: "task status history records", count: taskStatusHistory },
      { label: "task time entries", count: taskTimeEntries },
      { label: "task planning blocks", count: taskPlanningBlocks },
      { label: "tickets", count: tickets },
      { label: "ticket history records", count: ticketStatusHistory },
      { label: "documents/artifacts", count: artifacts },
      { label: "files", count: files },
      { label: "project comments", count: comments },
      { label: "project activities", count: activities },
      { label: "project risks", count: risks },
      { label: "project attachments", count: attachments },
      { label: "task comments", count: taskComments },
      { label: "task attachments", count: taskAttachments },
      { label: "progress share links", count: progressShareLinks },
      { label: "contracts", count: contracts },
      { label: "payment schedules", count: paymentSchedules },
      { label: "payment milestones", count: paymentMilestones },
      { label: "invoices", count: invoices },
      { label: "invoice payments", count: invoicePayments },
      { label: "resource allocations", count: resourceAllocations },
      { label: "project costs", count: costs },
      { label: "P&L snapshots", count: plSnapshots },
      { label: "customer access grants", count: customerAccessGrants }
    ].filter(blocker => blocker.count > 0);
  }

  private async ensureStage(projectId: string, stageId: string, workspaceId: string) {
    const stage = await this.prisma.projectStage.findFirst({ where: { id: stageId, projectId, workspaceId } });
    if (!stage) {
      throw new NotFoundException("Project stage not found");
    }

    return stage;
  }

  private async collectTaskIdsForStages(tx: Prisma.TransactionClient | PrismaService, stageIds: string[], workspaceId: string) {
    if (stageIds.length === 0) return [];

    const directTasks = await tx.projectTask.findMany({
      where: {
        stageId: { in: stageIds },
        workspaceId
      },
      select: { id: true }
    });
    const collected = new Set(directTasks.map(task => task.id));
    let frontier = Array.from(collected);

    while (frontier.length > 0) {
      const children = await tx.projectTask.findMany({
        where: {
          parentTaskId: { in: frontier },
          workspaceId
        },
        select: { id: true }
      });
      frontier = children.map(task => task.id).filter(id => !collected.has(id));
      for (const id of frontier) {
        collected.add(id);
      }
    }

    return Array.from(collected);
  }

  private async deleteTaskSubtree(tx: Prisma.TransactionClient, taskIds: string[], workspaceId: string) {
    if (taskIds.length === 0) return;

    const taskIdFilter = { in: taskIds };
    const timeEntries = await tx.taskTimeEntry.findMany({
      where: {
        taskId: taskIdFilter,
        workspaceId
      },
      select: { id: true, workDate: true }
    });
    // D-28: deleting a task (or its stage) may not take the hours of a locked cost period with it.
    await this.timeEntries.assertTimeEntryPeriodOpen(workspaceId, timeEntries.map(entry => entry.workDate));
    const timeEntryIds = timeEntries.map(entry => entry.id);

    await tx.taskAttachment.deleteMany({ where: { taskId: taskIdFilter, workspaceId } });
    await tx.taskComment.deleteMany({ where: { taskId: taskIdFilter, workspaceId } });
    await tx.taskPlanningBlock.deleteMany({ where: { taskId: taskIdFilter, workspaceId } });
    if (timeEntryIds.length > 0) {
      await tx.projectCost.updateMany({
        where: {
          taskTimeEntryId: { in: timeEntryIds },
          workspaceId
        },
        data: { taskTimeEntryId: null }
      });
    }
    await tx.taskTimeEntry.deleteMany({ where: { taskId: taskIdFilter, workspaceId } });
    await tx.taskStatusHistory.deleteMany({ where: { taskId: taskIdFilter, workspaceId } });
    await tx.projectTask.deleteMany({ where: { id: taskIdFilter, workspaceId } });
  }

  private async ensureProjectDocument(projectId: string, documentId: string, workspaceId: string) {
    const document = await this.prisma.projectArtifact.findFirst({ where: { id: documentId, projectId, workspaceId } });
    if (!document) {
      throw new NotFoundException("Project document not found");
    }

    return document;
  }

  private async ensureProjectMilestone(projectId: string, milestoneId: string, workspaceId: string) {
    const milestone = await this.prisma.projectMilestone.findFirst({
      where: { id: milestoneId, projectId, workspaceId },
      select: { id: true }
    });
    if (!milestone) throw new BadRequestException("Milestone does not belong to this project");
    return milestone;
  }

  private async ensureProjectDocumentFile(
    tx: Prisma.TransactionClient,
    fileObjectId: string,
    project: { id: string; accountId: string },
    workspaceId: string
  ) {
    const file = await tx.fileObject.findFirst({
      where: {
        id: fileObjectId,
        workspaceId,
        accountId: project.accountId,
        projectId: project.id,
        status: "active",
        scanStatus: "clean",
        deletedAt: null,
        revokedAt: null
      }
    });
    if (!file) {
      throw new NotFoundException("Clean project file not found in workspace/account/project");
    }
    return file;
  }

  private async ensureProjectActivity(projectId: string, activityId: string, workspaceId: string) {
    const activity = await this.prisma.projectActivity.findFirst({ where: { id: activityId, projectId, workspaceId } });
    if (!activity) {
      throw new NotFoundException("Project activity not found");
    }

    return activity;
  }

  private assertCanEditProjectHierarchy(principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project hierarchy is internal");
    if (!principal.roleCodes.some((roleCode) => PROJECT_HIERARCHY_EDIT_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Sắp xếp lại milestone, stage, task cần quyền Founder/GM, Workspace Admin hoặc Delivery Lead.");
    }
  }

  private async lockProjectHierarchy(tx: Prisma.TransactionClient, projectId: string, workspaceId: string) {
    const projects = await tx.$queryRaw<Array<{ id: string; hierarchyOrderVersion: number }>>`
      SELECT "id", "hierarchyOrderVersion"
      FROM "Project"
      WHERE "id" = ${projectId}
        AND "workspaceId" = ${workspaceId}
      FOR UPDATE
    `;
    const project = projects[0];
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private async canonicalHierarchySiblingIds(
    tx: Prisma.TransactionClient,
    input: {
      workspaceId: string;
      projectId: string;
      kind: ProjectHierarchyOrderKind;
      parentId: string | null;
    }
  ) {
    if (input.kind === "milestone") {
      if (input.parentId !== null) {
        throw new BadRequestException("parentId must be null when kind is milestone");
      }
      const milestones = await tx.projectMilestone.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId
        },
        select: { id: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
      });
      return milestones.map((milestone) => milestone.id);
    }

    if (!input.parentId) {
      throw new BadRequestException("parentId is required for stage and task ordering");
    }

    if (input.kind === "stage") {
      const milestone = await tx.projectMilestone.findFirst({
        where: {
          id: input.parentId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        },
        select: { id: true, name: true }
      });
      if (!milestone) {
        throw new NotFoundException("Project milestone not found");
      }
      const stages = await tx.projectStage.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          milestoneId: milestone.id
        },
        select: {
          id: true,
          activity: true,
          phase: true,
          _count: {
            select: {
              tasks: {
                where: { archivedAt: null }
              }
            }
          }
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
      });
      return stages
        .filter((stage) => !isLegacyMilestonePlaceholder({
          activity: stage.activity,
          phase: stage.phase,
          milestoneName: milestone.name,
          activeTaskCount: stage._count.tasks
        }))
        .map((stage) => stage.id);
    }

    const stage = await tx.projectStage.findFirst({
      where: {
        id: input.parentId,
        workspaceId: input.workspaceId,
        projectId: input.projectId
      },
      select: { id: true }
    });
    if (!stage) {
      throw new NotFoundException("Project stage not found");
    }
    const tasks = await tx.projectTask.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        stageId: stage.id,
        parentTaskId: null,
        archivedAt: null
      },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    return tasks.map((task) => task.id);
  }

  private async ensureTask(taskId: string, workspaceId: string) {
    const task = await this.prisma.projectTask.findFirst({ where: { id: taskId, workspaceId } });
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return task;
  }
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}
