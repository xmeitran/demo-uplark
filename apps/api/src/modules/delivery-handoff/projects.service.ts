import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { canViewCost } from "../resource-controls/cost-permissions";
import { createHash, randomUUID } from "node:crypto";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { Prisma, SubjectStatus } from "@prisma/client";
import type {
  CreateProjectInput,
  CreateProjectMilestoneInput,
  ProjectTaskTemplateInput,
  ProjectMilestoneEvidenceMode,
  ProjectMilestoneReviewerMode,
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
  mapProjectRiskSummary,
  mapProjectStageSummary,
  mapProjectSummary,
  deriveProjectMemberEmploymentStatus,
  mapTaskAttachmentSummary,
  mapTaskCommentSummary,
  mapTaskPlanningBlockSummary,
  mapTaskSummary,
  mapTaskTimeEntrySummary
} from "./delivery.mapper";
import { DEFAULT_PROJECT_STAGE_TEMPLATE, PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";
import {
  buildDailyActualLogStatus,
  getDailyActualLogWindow
} from "./daily-actual-log";
import { dateOnlyToUtcDate, getLocalDateKeysForTimeRange, lockWorkspaceDayOffDates } from "../workspace-calendar/day-off-time";
import { CLOSED_WORK_STATUSES, isCancelledTaskStatus, isCompletedTaskStatus } from "./task-status";
import { evaluateMilestoneGate } from "./milestone-gate";
import {
  countMilestoneEvidence,
  effectiveMilestoneRequiredDocumentCount,
  submittedMilestoneEvidenceCount,
  type MilestoneEvidenceDocument,
  type MilestoneEvidenceCounts
} from "./milestone-evidence";
import {
  canApproveMilestoneReviewer,
  isWorkspaceAdmin,
  DEFAULT_MILESTONE_REVIEWER_MODE,
  MILESTONE_REVIEWER_MODES,
  normalizeMilestoneReviewerMode
} from "./milestone-reviewer";
import { buildRuleBasedProjectPlan } from "./project-plan-rules";
import { isKnownProjectStatus, normalizeProjectStatus, projectStatusFilterValues, validateProjectStatusChange, PROJECT_STATUS_ALIASES } from "./project-status";
import { deriveMemberParticipation, NON_ACTUAL_TIME_ENTRY_STATUSES, participationWindow } from "./member-participation";
import { closeProjectWarnings, isWarningSuppressed, MANUAL_CLOSE_ACTION, mapProjectWarning, openOrRefreshProjectWarning, rearmManuallyClosedWarning } from "./project-warnings";

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

const projectRiskInclude = {
  account: true,
  project: true,
  owner: true,
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

type ActiveUserLookupClient = Pick<Prisma.TransactionClient, "user">;
type ProjectAssignmentLookupClient = Pick<Prisma.TransactionClient, "projectMember" | "user">;
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

const MAX_CALENDAR_RANGE_DAYS = 90;
const COMMENT_VISIBILITIES = new Set(["internal", "customer"]);
const COMMENT_STATUSES = new Set(["active", "deleted"]);
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
const TIME_REVIEW_ROLE_CODES = new Set(["FOUNDER_GM", "DELIVERY_LEAD"]);
const WORKSPACE_DAY_OFF_OVERRIDE_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);
const PROJECT_HIERARCHY_EDIT_ROLE_CODES = new Set(["FOUNDER_GM", "DELIVERY_LEAD"]);
const MILESTONE_TEMPLATE_ADMIN_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);
const BUILTIN_MILESTONE_TEMPLATE_KEY = "pilot-v1";
const PROJECT_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const DEFAULT_TIME_ENTRY_APPROVAL_STATUS = "approved";
const DEFAULT_TIME_ENTRY_TIME_ZONE = "Asia/Ho_Chi_Minh";
const CANONICAL_PROJECT_ACTIVITY_TYPES = new Set(["work_logged", "work_planned", "task_status_changed"]);
const ACTIVITY_DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";
const TASK_ARCHIVE_STATUS = "archived";
const APPROVED_TIME_ENTRY_STATUSES = ["approved", "done"];
// Mirrors MANAGER_ROLES in brd-governance.service.ts: the roles that approve task plans and timeline change requests.
const TASK_PLAN_APPROVER_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "FINANCE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"]);
const MANUAL_ACTUAL_LOG_MESSAGE = "Kế hoạch đã được đánh dấu hoàn thành nhưng chưa ghi nhận giờ thực tế. Vui lòng log giờ thủ công cho task này.";

function canOverrideWorkspaceDayOff(principal: PrincipalContext) {
  return principal.roleCodes.some((roleCode) => WORKSPACE_DAY_OFF_OVERRIDE_ROLES.has(roleCode));
}

function workspaceDayOffMessage(dayOff: { date: Date; name: string }) {
  return `Ngày ${dayOff.date.toISOString().slice(0, 10)} đã bị khóa là “${dayOff.name}”. User không thể lập kế hoạch hoặc logwork trong ngày nghỉ này.`;
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

const taskPlanningBlockInclude = {
  account: true,
  project: true,
  task: true,
  user: true
};

const taskTimeEntryInclude = {
  task: { include: { account: true, project: true } },
  user: true,
  reviewedBy: true,
  dayOff: true
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

function formatDeleteBlockers(blockers: ProjectDeleteBlocker[]) {
  return blockers.map(blocker => `${blocker.count} ${blocker.label}`).join(", ");
}

function isPrismaForeignKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2003";
}

function isPrismaWriteConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return ["P2002", "P2034"].includes((error as { code?: string }).code ?? "");
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

const MILESTONE_EVIDENCE_MODES = new Set(["file", "link", "file_or_link"]);

function normalizeMilestoneEvidenceMode(value: unknown): ProjectMilestoneEvidenceMode {
  const mode = String(value ?? "file_or_link").trim().toLowerCase();
  if (!MILESTONE_EVIDENCE_MODES.has(mode)) {
    throw new BadRequestException("evidenceMode must be file, link, or file_or_link");
  }
  return mode as ProjectMilestoneEvidenceMode;
}

type MilestoneReviewerUser = { id: string; displayName: string; email: string };

function mapMilestoneGateSummary(
  milestone: any,
  evidenceCounts: MilestoneEvidenceCounts,
  reviewerUser?: MilestoneReviewerUser,
  approvedByUser?: MilestoneReviewerUser,
  principal?: PrincipalContext
) {
  const evidenceMode = normalizeMilestoneEvidenceMode(milestone.evidenceMode);
  const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount(milestone);
  const submittedDocumentCount = submittedMilestoneEvidenceCount(evidenceCounts, evidenceMode);
  const taskStatuses = (milestone.stages ?? []).flatMap((stage: any) =>
    (stage.tasks ?? []).map((task: any) => task.status)
  );
  const evaluation = evaluateMilestoneGate({
    requiredDocumentCount,
    submittedDocumentCount,
    missingDocumentTypes: evidenceCounts.missingRequiredTypes,
    customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
    customerConfirmationAt: milestone.customerConfirmationAt,
    taskStatuses
  });

  return {
    id: milestone.id,
    projectId: milestone.projectId,
    name: milestone.name,
    normalizedKey: milestone.normalizedKey,
    sortOrder: milestone.sortOrder,
    gateStatus: milestone.gateStatus,
    requiredDocumentCount,
    requiredDocumentTypes: milestone.requiredDocumentTypes,
    evidenceMode,
    ownerTeamId: milestone.ownerTeamId ?? undefined,
    ownerTeamName: milestone.ownerTeam?.name ?? undefined,
    submittedDocumentCount,
    documentsSatisfied: evaluation.documentsSatisfied,
    confirmationSatisfied: evaluation.confirmationSatisfied,
    taskCount: evaluation.taskCount,
    completedTaskCount: evaluation.completedTaskCount,
    tasksSatisfied: evaluation.tasksSatisfied,
    missingRequirements: evaluation.missingRequirements,
    unlockCriteria: typeof milestone.unlockCriteria === "object" && milestone.unlockCriteria && "text" in milestone.unlockCriteria
      ? String((milestone.unlockCriteria as { text?: unknown }).text ?? "")
      : undefined,
    customerConfirmationRequired: milestone.customerConfirmationRequired,
    customerConfirmationAt: milestone.customerConfirmationAt?.toISOString(),
    reviewerMode: normalizeMilestoneReviewerMode(milestone.reviewerMode),
    reviewerUserId: milestone.reviewerUserId ?? undefined,
    reviewerUserName: reviewerUser?.displayName,
    reviewerUserEmail: reviewerUser?.email,
    reviewerApprovedAt: milestone.reviewerApprovedAt?.toISOString(),
    reviewerApprovedByUserId: milestone.reviewerApprovedByUserId ?? undefined,
    reviewerApprovedByUserName: approvedByUser?.displayName,
    reviewerApprovalRequired: milestone.gateStatus !== "approved",
    canApprove: principal
      ? canApproveMilestoneReviewer({
          reviewerMode: normalizeMilestoneReviewerMode(milestone.reviewerMode),
          reviewerUserId: milestone.reviewerUserId,
          principalUserId: principal.subjectId,
          principalRoleCodes: principal.roleCodes
        })
      : undefined,
    reviewerRole: milestone.reviewerRole
  };
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

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function shouldPromoteTaskToInProgress(status: string) {
  return ["todo", "not_started", "planning", "upcoming"].includes(status.trim().toLowerCase());
}

function formatPlanningWindow(startAt: Date, endAt: Date, minutes: number) {
  return `${minutes} minutes planned from ${startAt.toISOString()} to ${endAt.toISOString()}`;
}

function buildProjectCategoryWhere(category: string): Prisma.ProjectWhereInput {
  const normalized = category.trim().toLowerCase().replace(/[_\s-]+/g, "_");
  if (normalized === "delivery") {
    return {
      OR: [
        { projectType: { equals: normalized, mode: "insensitive" } },
        { opportunityId: null },
        { opportunity: { is: { stage: { equals: "delivery", mode: "insensitive" } } } }
      ]
    };
  }

  return {
    OR: [
      { projectType: { equals: normalized, mode: "insensitive" } },
      {
        opportunity: {
          is: {
            stage: {
              equals: normalized,
              mode: "insensitive"
            }
          }
        }
      }
    ]
  };
}

function hasInputKey(input: object, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function optionalEnum(value: unknown, fieldName: string, allowed: Set<string>) {
  const normalized = optionalString(value, fieldName);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }

  const token = normalized.toLowerCase().replace(/[\s-]+/g, "_");
  if (!allowed.has(token)) {
    throw new BadRequestException(`${fieldName} is not supported`);
  }
  return token;
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

function assertTaskDateRange(plannedStartAt?: Date | null, dueAt?: Date | null) {
  if (plannedStartAt && dueAt && plannedStartAt > dueAt) {
    throw new BadRequestException("plannedStartAt must not be later than dueAt");
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
    subject: `Logged actual work: ${taskTitle}`,
    note: [`${timeWindow} - Logged ${minutesLabel} actual work as ${workType}`, entry.note].filter(Boolean).join("\n"),
    target: `${minutesLabel} - ${taskTitle}`,
    occurredAt,
    occurredTime: time,
    actionLabel: "Logged actual work",
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

type MilestoneTemplateRecord = CreateProjectMilestoneInput[];

export const MAX_TASK_ESTIMATE_MINUTES = 8 * 60;

export function validateTaskEstimateMinutes(value: unknown, path = "estimateMinutes") {
  if (value === undefined || value === null) return undefined;
  const estimateMinutes = optionalInteger(value, path);
  if (estimateMinutes === undefined || estimateMinutes === null) return undefined;
  if (estimateMinutes < 0 || estimateMinutes > MAX_TASK_ESTIMATE_MINUTES) {
    throw new BadRequestException(`${path} must be between 0 and ${MAX_TASK_ESTIMATE_MINUTES} minutes (8 hours)`);
  }
  return estimateMinutes;
}

function milestoneTemplateKey(value: unknown, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeTemplateTasks(value: unknown, path: string, depth = 0): ProjectTaskTemplateInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${path} must be an array`);
  if (depth > 3) throw new BadRequestException(`${path} is nested too deeply`);
  return value.map((rawTask, taskIndex) => {
    if (!rawTask || typeof rawTask !== "object") throw new BadRequestException(`${path}[${taskIndex}] is invalid`);
    const task = rawTask as Record<string, unknown>;
    const title = String(task.title ?? task.name ?? "").trim();
    if (!title) throw new BadRequestException(`${path}[${taskIndex}] needs a title`);
    const estimateMinutes = validateTaskEstimateMinutes(task.estimateMinutes, `${path}[${taskIndex}].estimateMinutes`);
    return {
      title,
      description: optionalString(task.description, `${path}[${taskIndex}].description`) ?? undefined,
      status: optionalString(task.status, `${path}[${taskIndex}].status`) ?? "todo",
      priority: optionalString(task.priority, `${path}[${taskIndex}].priority`) ?? "medium",
      taskType: optionalString(task.taskType, `${path}[${taskIndex}].taskType`) ?? "implementation",
      estimateMinutes,
      plannedStartAt: optionalString(task.plannedStartAt, `${path}[${taskIndex}].plannedStartAt`) ?? undefined,
      dueAt: optionalString(task.dueAt, `${path}[${taskIndex}].dueAt`) ?? undefined,
      subtasks: normalizeTemplateTasks(task.subtasks, `${path}[${taskIndex}].subtasks`, depth + 1)
    };
  });
}

function normalizeMilestoneTemplateMilestones(value: unknown): MilestoneTemplateRecord {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("A milestone template must contain at least one milestone");
  }
  return value.map((rawMilestone, milestoneIndex) => {
    if (!rawMilestone || typeof rawMilestone !== "object") throw new BadRequestException("Invalid milestone template item");
    const item = rawMilestone as Record<string, unknown>;
    const name = String(item.name ?? "").trim();
    if (!name) throw new BadRequestException(`Milestone ${milestoneIndex + 1} needs a name`);
    const rawStages = Array.isArray(item.stages) ? item.stages : [];
    if (rawStages.length === 0) throw new BadRequestException(`Milestone ${milestoneIndex + 1} needs at least one stage`);
    const stages = rawStages.map((rawStage, stageIndex) => {
      if (!rawStage || typeof rawStage !== "object") throw new BadRequestException("Invalid milestone stage");
      const stage = rawStage as Record<string, unknown>;
      const activity = String(stage.activity ?? "").trim();
      if (!activity) throw new BadRequestException(`Stage ${stageIndex + 1} in milestone ${milestoneIndex + 1} needs a name`);
      return {
        stageKey: milestoneTemplateKey(stage.stageKey, `stage-${milestoneIndex + 1}-${stageIndex + 1}`),
        phase: String(stage.phase ?? activity).trim() || activity,
        activity,
        sortOrder: Number.isFinite(Number(stage.sortOrder)) ? Number(stage.sortOrder) : (stageIndex + 1) * 10,
        criteria: String(stage.criteria ?? "").trim() || undefined,
        slaDays: Number.isFinite(Number(stage.slaDays)) ? Math.max(0, Number(stage.slaDays)) : undefined,
        upbaseRole: String(stage.upbaseRole ?? "").trim() || undefined,
        customerRole: String(stage.customerRole ?? "").trim() || undefined,
        tasks: normalizeTemplateTasks(stage.tasks, `milestones[${milestoneIndex}].stages[${stageIndex}].tasks`)
      };
    });
    const requiredDocumentTypes = Array.isArray(item.requiredDocumentTypes)
      ? item.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
      : [];
    const reviewerMode = normalizeMilestoneReviewerMode(item.reviewerMode);
    const reviewerUserId = String(item.reviewerUserId ?? "").trim() || undefined;
    if (reviewerMode === "specific_user" && !reviewerUserId) {
      throw new BadRequestException(`Milestone ${milestoneIndex + 1} needs a reviewerUserId when reviewerMode is specific_user`);
    }
    return {
      name,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : (milestoneIndex + 1) * 10,
      requiredDocumentCount: effectiveMilestoneRequiredDocumentCount({
        requiredDocumentCount: Number.isFinite(Number(item.requiredDocumentCount)) ? Math.max(0, Number(item.requiredDocumentCount)) : 0,
        requiredDocumentTypes
      }),
      requiredDocumentTypes,
      evidenceMode: normalizeMilestoneEvidenceMode(item.evidenceMode),
      ownerTeamId: String(item.ownerTeamId ?? "").trim() || undefined,
      unlockCriteria: String(item.unlockCriteria ?? "").trim() || undefined,
      customerConfirmationRequired: Boolean(item.customerConfirmationRequired),
      reviewerMode,
      reviewerUserId,
      reviewerRole: String(item.reviewerRole ?? "").trim() || undefined,
      stages
    };
  });
}

function mapMilestoneTemplateSummary(row: any, readOnly = false) {
  const milestones = normalizeMilestoneTemplateMilestones(row.milestones);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status ?? "active",
    readOnly: readOnly || undefined,
    milestones,
    milestoneCount: milestones.length,
    stageCount: milestones.reduce((total, milestone) => total + milestone.stages.length, 0),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined
  };
}

function spreadsheetText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

function spreadsheetColumnIndex(header: string[], aliases: string[], excludedAliases: string[] = []) {
  const exact = header.findIndex((cell) => aliases.includes(spreadsheetText(cell)) && !excludedAliases.includes(spreadsheetText(cell)));
  if (exact >= 0) return exact;
  return header.findIndex((cell) => aliases.some((alias) => {
    const normalized = spreadsheetText(cell);
    return !excludedAliases.some((excluded) => normalized === excluded || normalized.includes(excluded))
      && (normalized === alias || normalized.includes(alias));
  }));
}

function splitSpreadsheetRow(rawLine: string) {
  const delimiter = rawLine.includes("\t") ? "\t" : rawLine.includes(";") ? ";" : ",";
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    if (char === '"') {
      if (quoted && rawLine[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function buildSpreadsheetTemplateDraft(fileName: string, source: string) {
  const fallbackMilestone = fileName.replace(/\.(xlsx|xls|csv)$/i, "").replace(/[_-]+/g, " ").trim() || "Imported project";
  const aliases = {
    milestone: ["milestone", "giai doan", "phase", "workstream", "epic", "release", "moc", "nhom tinh nang", "project phase"],
    stage: ["stage", "activity", "hang muc", "work package", "module", "workstream", "phase"],
    task: ["task", "task criteria", "task tieu chi", "task tieu chi hoan thanh", "task criteria complete", "cong viec", "chi tiet cong viec", "mo ta cong viec", "mo ta", "noi dung", "description", "item", "detail", "deliverable", "tieu chi hoan thanh"],
    subtask: ["subtask", "sub task", "sub-task", "cong viec con", "con viec con", "chi tiet con"],
    project: ["project", "project name", "du an", "ten du an", "initiative"],
  };
  const groups = new Map<string, Map<string, { name: string; tasks: Array<{ title: string; subtasks: Array<{ title: string }> }> }>>();
  const warnings: string[] = [];
  const sheetBlocks: Array<{ name: string; rows: string[][] }> = [];
  const detectedColumns = new Set<string>();
  let rowCount = 0;
  let taskCount = 0;
  let subtaskCount = 0;
  let currentSheet = "Imported sheet";
  let currentRows: string[][] = [];
  const flushSheet = () => {
    if (currentRows.length) sheetBlocks.push({ name: currentSheet, rows: currentRows });
    currentRows = [];
  };
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sheetMatch = line.match(/^SHEET\s*:\s*(.*)$/i);
    if (sheetMatch) {
      flushSheet();
      currentSheet = sheetMatch[1].trim() || "Imported sheet";
      continue;
    }
    currentRows.push(splitSpreadsheetRow(line));
  }
  flushSheet();
  if (!sheetBlocks.length) sheetBlocks.push({ name: "Imported sheet", rows: [] });

  let projectName = fallbackMilestone;
  let explicitMilestoneColumn = false;
  let parsedTables = 0;
  for (const block of sheetBlocks) {
    const candidates = block.rows.slice(0, Math.min(block.rows.length, 40)).map((row, index) => {
      const normalized = row.map(spreadsheetText);
      const score = normalized.reduce((total, cell) => total + (Object.values(aliases).some((list) => list.some((alias) => cell === alias || cell.includes(alias))) ? 1 : 0), 0);
      return { index, row, normalized, score };
    });
    const headerCandidate = candidates.sort((a, b) => b.score - a.score)[0];
    const headerIndex = headerCandidate && headerCandidate.score > 0 ? headerCandidate.index : -1;
    const header = headerIndex >= 0 ? headerCandidate!.normalized : [];
    const milestoneColumn = spreadsheetColumnIndex(header, aliases.milestone);
    const stageColumn = spreadsheetColumnIndex(header, aliases.stage);
    const taskColumn = spreadsheetColumnIndex(header, aliases.task, aliases.subtask);
    const subtaskColumn = spreadsheetColumnIndex(header, aliases.subtask);
    const projectColumn = spreadsheetColumnIndex(header, aliases.project);
    const fallbackTaskColumn = taskColumn >= 0 ? taskColumn : spreadsheetColumnIndex(header, aliases.task, [...aliases.milestone, ...aliases.stage, ...aliases.subtask, ...aliases.project]);
    const effectiveTaskColumn = taskColumn >= 0 ? taskColumn : fallbackTaskColumn;
    if (headerIndex >= 0) parsedTables += 1;
    if (milestoneColumn >= 0) explicitMilestoneColumn = true;
    if (milestoneColumn >= 0) detectedColumns.add("Milestone");
    if (stageColumn >= 0) detectedColumns.add("Stage");
    if (effectiveTaskColumn >= 0) detectedColumns.add("Task");
    if (subtaskColumn >= 0) detectedColumns.add("Subtask");
    if (projectColumn >= 0) detectedColumns.add("Project");
    if (projectColumn >= 0) {
      const projectValue = block.rows.slice(headerIndex + 1).map((row) => row[projectColumn]).find((value) => value?.trim());
      if (projectValue) projectName = projectValue.trim();
    }
    const projectMarker = block.rows.slice(0, Math.min(block.rows.length, 12)).flat().find((value) => /^project\s*:/i.test(value.trim()));
    if (projectMarker) projectName = projectMarker.replace(/^project\s*:\s*/i, "").trim() || projectName;
    if (headerIndex < 0) warnings.push(`Không nhận diện được hàng tiêu đề ở sheet “${block.name}”; hệ thống dùng cách đoán cột.`);
    let activeMilestone = block.name !== "Imported sheet" ? block.name : fallbackMilestone;
    let activeStage = "General work";
    for (const row of block.rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0)) {
      const values = row.map((cell) => cell.trim());
      const nonEmpty = values.filter(Boolean);
      if (!nonEmpty.length) continue;
      rowCount += 1;
      if (/^project\s*:/i.test(nonEmpty[0])) continue;
      const rowLooksLikeSection = nonEmpty.length === 1 && nonEmpty[0].length < 120 && !/\d{1,4}[\-\/]\d{1,2}/.test(nonEmpty[0]);
      const rawMilestone = milestoneColumn >= 0 ? values[milestoneColumn] : "";
      if (rawMilestone) activeMilestone = rawMilestone;
      if (rowLooksLikeSection && milestoneColumn < 0) {
        activeMilestone = nonEmpty[0];
        continue;
      }
      const stageValue = stageColumn >= 0 ? values[stageColumn] : "";
      const taskValue = effectiveTaskColumn >= 0 ? values[effectiveTaskColumn] : "";
      const subtaskValue = subtaskColumn >= 0 ? values[subtaskColumn] : "";
      const fallbackDetail = !taskValue && stageValue && values.length > 2
        ? values.find((value, valueIndex) => value && valueIndex !== milestoneColumn && valueIndex !== stageColumn)
        : "";
      const resolvedTask = taskValue || fallbackDetail || "";
      const guessedStage = stageValue || (!resolvedTask ? nonEmpty.find((value) => value !== activeMilestone && !/^stt$|^no\.?$/i.test(value)) : activeStage) || "";
      if (!guessedStage || /^stt$|^no\.?$/i.test(guessedStage) || /^(status|trang thai|owner|pic|assignee|deadline|due date)$/i.test(guessedStage)) continue;
      if (stageValue) activeStage = stageValue;
      const stage = stageValue || guessedStage;
      const milestone = rawMilestone || activeMilestone || fallbackMilestone;
      const current = groups.get(milestone) ?? new Map<string, { name: string; tasks: Array<{ title: string; subtasks: Array<{ title: string }> }> }>();
      const stageRecord = current.get(stage) ?? { name: stage, tasks: [] };
      if (resolvedTask && resolvedTask !== stageValue) {
        const previousTask = stageRecord.tasks[stageRecord.tasks.length - 1];
        const task = previousTask?.title === resolvedTask ? previousTask : { title: resolvedTask, subtasks: [] };
        if (task !== previousTask) { stageRecord.tasks.push(task); taskCount += 1; }
        if (subtaskValue && !task.subtasks.some((subtask) => subtask.title === subtaskValue)) { task.subtasks.push({ title: subtaskValue }); subtaskCount += 1; }
      } else if (subtaskValue) {
        const parentTask = stageRecord.tasks[stageRecord.tasks.length - 1];
        if (parentTask && !parentTask.subtasks.some((subtask) => subtask.title === subtaskValue)) { parentTask.subtasks.push({ title: subtaskValue }); subtaskCount += 1; }
        else warnings.push(`Sheet “${block.name}” có Subtask nhưng chưa có Task cha ở milestone “${milestone}”, stage “${stage}”.`);
      }
      else if (!current.has(stage) && stageValue) stageRecord.tasks = [];
      current.set(stage, stageRecord);
      groups.set(milestone, current);
    }
  }
  if (sheetBlocks.length > 1) warnings.push(`Đã đọc ${sheetBlocks.length} sheet; hệ thống gộp các bảng theo milestone.`);
  if (!explicitMilestoneColumn) warnings.push("Không thấy cột Milestone/Giai đoạn rõ ràng; hệ thống dùng tên section, tên sheet hoặc tên file để giữ nhóm.");
  if (!parsedTables) warnings.push("Không tìm thấy header chuẩn; nên kiểm tra lại bản nháp trước khi lưu.");
  if (taskCount === 0) warnings.push("Chưa tạo được Task; hãy kiểm tra cột Task/Nội dung hoặc thêm Task trong bước rà soát.");
  const milestones = Array.from(groups.entries()).map(([name, stages]) => ({
    name,
    stages: Array.from(stages.values()).slice(0, 100)
  })).filter((milestone) => milestone.stages.length > 0).slice(0, 50);
  return {
    data: {
      sourceFileName: fileName,
      projectName,
      description: "Bản nháp được suy luận từ file dự án đã import; hãy rà soát milestone/stage trước khi tạo project.",
      milestones,
      warnings,
      stats: {
        sheetCount: sheetBlocks.length,
        rowCount,
        milestoneCount: milestones.length,
        stageCount: milestones.reduce((total, milestone) => total + milestone.stages.length, 0),
        taskCount,
        subtaskCount,
        detectedColumns: Array.from(detectedColumns),
        reviewRequired: warnings.length > 0
      }
    }
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(NotificationsService) private readonly notifications?: NotificationsService
  ) {}

  async listProjects(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const accountId = optionalString(query.accountId, "accountId");
    const ownerUserIds = Array.from(new Set((optionalString(query.ownerUserId, "ownerUserId") ?? "").split(",").map((id) => id.trim()).filter(Boolean)));
    const statusAliases = projectStatusFilterValues(optionalString(query.status, "status") ?? null);
    const category = optionalString(query.category, "category");
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

    if (category) {
      andFilters.push(buildProjectCategoryWhere(category));
    }

    if (statusAliases) {
      andFilters.push(buildProjectStatusWhere(statusAliases));
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

    const where: Prisma.ProjectWhereInput = {
      workspaceId: principal.workspaceId,
      ...(accountId ? { accountId } : {}),
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

    return {
      data: projects.map((project) => ({ ...mapProjectSummary(project), openWarningCount: openWarningCounts[project.id] ?? 0 })),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: projects.length })
      }
    };
  }

  async listMilestoneTemplates(principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Milestone templates are internal");
    const rows = await this.prisma.projectMilestoneTemplate.findMany({
      where: { workspaceId: principal.workspaceId, status: { not: "archived" } },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });
    const builtin = mapMilestoneTemplateSummary({
      id: `builtin:${BUILTIN_MILESTONE_TEMPLATE_KEY}`,
      key: BUILTIN_MILESTONE_TEMPLATE_KEY,
      name: "Pilot UpLark chuẩn",
      description: "Mẫu mặc định theo format pilot hiện tại của UpLark.",
      status: "active",
      milestones: PILOT_PROJECT_MILESTONE_TEMPLATE
    }, true);
    return { data: [builtin, ...rows.map((row) => mapMilestoneTemplateSummary(row))] };
  }

  async createMilestoneTemplate(input: CreateProjectMilestoneTemplateInput, principal: PrincipalContext) {
    this.assertCanManageMilestoneTemplates(principal);
    const name = nonEmptyString(input?.name, "name");
    const milestones = normalizeMilestoneTemplateMilestones(input?.milestones);
    const reviewerUserIds = Array.from(new Set(milestones.map((milestone: any) => milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId : undefined).filter((id): id is string => Boolean(id))));
    await this.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, reviewerUserIds);
    const key = milestoneTemplateKey(input?.key, milestoneTemplateKey(name, `template-${randomUUID().slice(0, 8)}`));
    if (key === BUILTIN_MILESTONE_TEMPLATE_KEY) throw new ConflictException("pilot-v1 is reserved for the system template");
    try {
      const row = await this.prisma.projectMilestoneTemplate.create({
        data: {
          workspaceId: principal.workspaceId,
          key,
          name,
          description: optionalString(input?.description, "description") ?? undefined,
          milestones: milestones as unknown as Prisma.InputJsonValue,
          createdByUserId: principal.subjectId
        }
      });
      await this.prisma.auditEvent.create({
        data: {
          workspaceId: principal.workspaceId,
          actorUserId: principal.subjectId,
          action: "project.milestone_template_created",
          resource: "project_milestone_template",
          resourceId: row.id,
          before: undefined,
          after: { key: row.key, name: row.name, status: row.status, milestoneCount: milestones.length },
          requestId: randomUUID()
        }
      });
      return { data: mapMilestoneTemplateSummary(row) };
    } catch (error) {
      if (isPrismaWriteConflict(error)) throw new ConflictException("Template key đã tồn tại trong workspace");
      throw error;
    }
  }

  async updateMilestoneTemplate(templateId: string, input: UpdateProjectMilestoneTemplateInput, principal: PrincipalContext) {
    this.assertCanManageMilestoneTemplates(principal);
    if (templateId.startsWith("builtin:")) throw new ForbiddenException("System template cannot be edited");
    const existing = await this.prisma.projectMilestoneTemplate.findFirst({ where: { id: templateId, workspaceId: principal.workspaceId } });
    if (!existing) throw new NotFoundException("Milestone template not found");
    const milestones = input?.milestones === undefined ? undefined : normalizeMilestoneTemplateMilestones(input.milestones);
    if (milestones) {
      const reviewerUserIds = Array.from(new Set(milestones.map((milestone: any) => milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId : undefined).filter((id): id is string => Boolean(id))));
      await this.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, reviewerUserIds);
    }
    const status = input?.status === undefined ? existing.status : optionalString(input.status, "status");
    if (status && !["active", "archived"].includes(status)) throw new BadRequestException("Invalid milestone template status");
    const updated = await this.prisma.projectMilestoneTemplate.update({
      where: { id: existing.id },
      data: {
        name: input?.name === undefined ? undefined : nonEmptyString(input.name, "name"),
        description: input?.description === undefined ? undefined : optionalString(input.description, "description") ?? null,
        milestones: milestones ? milestones as unknown as Prisma.InputJsonValue : undefined,
        status: status ?? existing.status
      }
    });
    await this.prisma.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId,
        actorUserId: principal.subjectId,
        action: "project.milestone_template_updated",
        resource: "project_milestone_template",
        resourceId: updated.id,
        before: { key: existing.key, name: existing.name, status: existing.status, milestoneCount: Array.isArray(existing.milestones) ? existing.milestones.length : undefined },
        after: { key: updated.key, name: updated.name, status: updated.status, milestoneCount: milestones?.length ?? (Array.isArray(updated.milestones) ? updated.milestones.length : undefined) },
        requestId: randomUUID()
      }
    });
    return { data: mapMilestoneTemplateSummary(updated) };
  }

  async getProject(projectId: string, principal: PrincipalContext) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, include: projectIncludeForPrincipal(principal) });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return { ...mapProjectSummary(project), ...(await this.currentStatusContext(project)) };
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
      openWarningCount: openWarningCounts[project.id] ?? 0
    };
  }

  private async countOpenWarnings(workspaceId: string, projectIds: string[]): Promise<Record<string, number>> {
    if (!projectIds.length || typeof (this.prisma as any).projectWarning?.groupBy !== "function") return {};
    const rows = await this.prisma.projectWarning.groupBy({ by: ["projectId"], where: { workspaceId, projectId: { in: projectIds }, status: "open" }, _count: { _all: true } });
    return Object.fromEntries(rows.map((row) => [row.projectId, row._count._all]));
  }

  async listProjectStatusHistory(projectId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project status history is internal");
    await this.ensureProject(projectId, principal.workspaceId);
    const rows = await this.prisma.projectStatusHistory.findMany({ where: { projectId, workspaceId: principal.workspaceId }, orderBy: { changedAt: "desc" } });
    const names = await this.userDisplayNames(rows.map((row) => row.changedByUserId));
    return {
      data: rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        fromStatus: row.fromStatus ?? undefined,
        toStatus: row.toStatus,
        reason: row.reason ?? undefined,
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
    this.assertInternalTaskPrincipal(principal, "Project warnings are internal");
    await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project warnings are internal");
    const projectIds = Array.from(new Set(String(query.projectIds ?? "").split(",").map((id) => id.trim()).filter(Boolean)));
    const rows = await this.prisma.projectWarning.groupBy({
      by: ["projectId"],
      where: { workspaceId: principal.workspaceId, status: "open", ...(projectIds.length ? { projectId: { in: projectIds } } : {}) },
      _count: { _all: true }
    });
    return { data: Object.fromEntries(rows.map((row) => [row.projectId, row._count._all])) };
  }

  async closeProjectWarning(projectId: string, warningId: string, input: { reason?: string }, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project warnings are internal");
    await this.ensureProject(projectId, principal.workspaceId);
    const reason = optionalString(input?.reason, "reason");
    if (!reason) throw new BadRequestException("Đóng cảnh báo bắt buộc phải nhập lý do.");
    return this.prisma.$transaction(async (tx) => {
      await this.assertProjectManager(tx, projectId, principal);
      const warning = await tx.projectWarning.findFirst({ where: { id: warningId, projectId, workspaceId: principal.workspaceId } });
      if (!warning) throw new NotFoundException("Project warning not found");
      if (warning.status !== "open") throw new ConflictException("Cảnh báo này đã được đóng.");
      await closeProjectWarnings(tx, { projectId, id: warningId }, principal.subjectId, reason, MANUAL_CLOSE_ACTION);
      await this.auditMutation(tx, principal, "project.warning_closed", "project_warning", warningId, { status: "open" }, { status: "closed", closeReason: reason });
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
    this.assertInternalTaskPrincipal(principal, "Project member directory is internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project participation is internal");
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

  async createAiTemplateDraft(rawInput: any, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project planning is internal");
    const input = rawInput && typeof rawInput === "object" ? rawInput : {};
    const fileName = nonEmptyString(input.fileName, "fileName");
    const text = typeof input.text === "string" ? input.text.trim() : "";
    const imageDataUrl = typeof input.imageDataUrl === "string" ? input.imageDataUrl.trim() : "";
    if (!text && !imageDataUrl) throw new BadRequestException("Upload an image or spreadsheet content to analyze");
    if (text.length > 120_000) throw new BadRequestException("Spreadsheet content is too large to analyze");
    if (imageDataUrl && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) {
      throw new BadRequestException("Only PNG, JPEG and WEBP images are supported");
    }

    if (text) return buildSpreadsheetTemplateDraft(fileName, text);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new BadRequestException("AI import is not configured. Set OPENAI_API_KEY on the API service first.");
    }

    const userContent: Array<Record<string, unknown>> = [{
      type: "text",
      text: `Read the uploaded project planning source (${fileName}) and produce a temporary project template. Do not invent business facts. Preserve names, order and dates when present. Return only JSON matching the required schema.\n\nSOURCE:\n${text || "The source is the attached image."}`
    }];
    if (imageDataUrl) userContent.push({ type: "image_url", image_url: { url: imageDataUrl, detail: "high" } });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CRM_AI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "project_template_draft",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                projectName: { type: "string" },
                description: { type: "string" },
                milestones: {
                  type: "array", items: { type: "object", additionalProperties: false, properties: {
                    name: { type: "string" },
                    stages: { type: "array", items: { type: "object", additionalProperties: false, properties: {
                      name: { type: "string" },
                      tasks: { type: "array", items: { $ref: "#/$defs/task" } }
                    }, required: ["name", "tasks"] } }
                  }, required: ["name", "stages"] }
                },
                warnings: { type: "array", items: { type: "string" } }
              },
              $defs: {
                task: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    subtasks: { type: "array", items: { $ref: "#/$defs/task" } }
                  },
                  required: ["title", "subtasks"]
                }
              },
              required: ["projectName", "description", "milestones", "warnings"]
            }
          }
        },
        messages: [
          { role: "system", content: "You extract project planning structures. A draft is temporary and must be reviewed by a human before persistence." },
          { role: "user", content: userContent }
        ]
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new BadRequestException(`AI import failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    const payload = await response.json() as any;
    const content = payload?.choices?.[0]?.message?.content;
    let parsed: any;
    try { parsed = JSON.parse(typeof content === "string" ? content : "{}"); } catch { throw new BadRequestException("AI returned an invalid template draft"); }
    const normalizeDraftTasks = (value: unknown): ProjectTaskTemplateInput[] => Array.isArray(value)
      ? value.map((task: any) => ({
          title: typeof task?.title === "string" ? task.title.trim() : "",
          subtasks: normalizeDraftTasks(task?.subtasks)
        })).filter((task) => task.title).slice(0, 200)
      : [];
    const milestones = Array.isArray(parsed.milestones) ? parsed.milestones.map((milestone: any) => ({
      name: typeof milestone?.name === "string" ? milestone.name.trim() : "",
      stages: Array.isArray(milestone?.stages) ? milestone.stages.map((stage: any) => ({
        name: typeof stage?.name === "string" ? stage.name.trim() : "",
        tasks: normalizeDraftTasks(stage?.tasks)
      })).filter((stage: any) => stage.name).slice(0, 100) : []
    })).filter((milestone: any) => milestone.name).slice(0, 50) : [];
    if (!milestones.length) throw new BadRequestException("AI could not find any milestone in the source");
    return { data: {
      sourceFileName: fileName,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName.trim() : "",
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      milestones,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((warning: unknown): warning is string => typeof warning === "string").slice(0, 20) : []
    }};
  }

  async previewProjectPlan(rawInput: ProjectPlanPreviewInput, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project planning is internal");
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
    this.assertInternalTaskPrincipal(principal, "Only internal users can create projects");
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
    const projectType = normalizeProjectType(input.projectType) ?? "delivery";
    const scopeSummary = optionalString(input.scopeSummary, "scopeSummary") ?? undefined;
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? undefined;
    const memberUserIds = Array.from(new Set([...(optionalStringArray(input.memberUserIds, "memberUserIds") ?? []), principal.subjectId, ...(ownerUserId ? [ownerUserId] : [])]));
    const budgetAmount = optionalNumber(input.budgetAmount, "budgetAmount");
    const plannedStartAt = optionalDate(input.plannedStartAt, "plannedStartAt") ?? undefined;
    const plannedEndAt = optionalDate(input.plannedEndAt, "plannedEndAt") ?? undefined;
    assertTaskDateRange(plannedStartAt, plannedEndAt);
    const priority = optionalEnum(input.priority, "priority", PROJECT_PRIORITIES) ?? undefined;
    const tags = normalizeProjectTags(input.tags) ?? [];
    const color = normalizeProjectColor(input.color) ?? undefined;
    const status = this.parseProjectStatus(input.status) ?? "planning";
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
      await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [principal.subjectId]);
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
      await this.ensureActiveWorkspaceUsers(
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
            const createTemplateTask = async (task: any, parentTaskId?: string, taskIndex = 0): Promise<void> => {
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
                await createTemplateTask(task.subtasks[subtaskIndex], createdTask.id, subtaskIndex);
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
      const result = mapProjectSummary(persisted);
      await this.auditMutation(tx, principal, "project.created", "project", persisted.id, undefined, { memberUserIds });
      if (keyHash) await tx.projectCreateReceipt.create({ data: { keyHash, workspaceId: principal.workspaceId, actorUserId: principal.subjectId, requestHash, projectId: persisted.id, response: JSON.parse(JSON.stringify(result)) } });
      return result;
    }).catch((error) => {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new ConflictException("Project code already exists. Choose another code and retry.");
      throw error;
    });

    return response;
  }

  async updateProject(projectId: string, input: UpdateProjectInput, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project changes are internal");
    const existingProject = await this.ensureProject(projectId, principal.workspaceId);
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
    const projectType = updatesProjectType ? normalizeProjectType(input.projectType) ?? "delivery" : undefined;
    const priority = updatesPriority ? optionalEnum(input.priority, "priority", PROJECT_PRIORITIES) : undefined;
    const tags = updatesTags ? normalizeProjectTags(input.tags) ?? [] : undefined;
    const color = updatesColor ? normalizeProjectColor(input.color) : undefined;
    const nextStatus = this.parseProjectStatus(input.status);
    const statusReason = optionalString(input.statusReason, "statusReason") ?? undefined;

    const project = await this.prisma.$transaction(async (tx) => {
      await this.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.assertProjectManager(tx, projectId, principal);
      // Read under the project lock: two concurrent status changes must each see the other's result,
      // otherwise both could act on the same stale "from" and leave NL-02 open on a project that is not On Hold.
      const lockedProject = nextStatus ? await tx.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, select: { status: true } }) : null;
      const statusChange = nextStatus ? validateProjectStatusChange((lockedProject ?? existingProject).status, nextStatus, statusReason) : undefined;
      if (statusChange?.error) throw new BadRequestException(statusChange.error);

      await this.ensureActiveWorkspaceUsers(
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
          color: updatesColor ? color : undefined
        }
      });

      if (statusChange?.changed) await this.recordProjectStatusChange(tx, principal, projectId, statusChange, statusReason);

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

    return mapProjectSummary(project);
  }

  /** Rejects anything outside the project status catalogue (legacy aliases are still accepted). */
  private parseProjectStatus(value: unknown) {
    const status = optionalString(value, "status") ?? undefined;
    if (status !== undefined && !isKnownProjectStatus(status)) {
      throw new BadRequestException(`Trạng thái dự án không hợp lệ: "${status}". Giá trị hợp lệ: Planning, Active, In Review, On Hold, At Risk, Completed.`);
    }
    return status;
  }

  /** `from` is absent for the first row, written when the project is created. */
  private async recordProjectStatusChange(tx: Prisma.TransactionClient, principal: PrincipalContext, projectId: string, change: { from?: string; to: string }, reason?: string) {
    // Unit specs mock only the models they exercise.
    if (typeof (tx as any).projectStatusHistory?.create === "function") {
      await tx.projectStatusHistory.create({ data: { workspaceId: principal.workspaceId, projectId, fromStatus: change.from, toStatus: change.to, reason, changedByUserId: principal.subjectId } });
    }
    await this.auditMutation(tx, principal, "project.status_changed", "project", projectId, { status: change.from ?? null }, { status: change.to, reason: reason ?? null });
    if (typeof (tx as any).projectWarning?.findFirst !== "function") return;
    // NL-03 is not tracked while planning, so work that is already ownerless must be flagged when the project leaves it.
    if (change.from === "planning" && change.to !== "planning") await this.syncProjectMissingOwnerWarnings(tx, principal, projectId);

    const dedupeKey = "NL-02:on-hold-open-tasks";
    if (change.from === "on_hold") {
      await closeProjectWarnings(tx, { projectId, dedupeKey }, principal.subjectId, "Project đã thoát On Hold");
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
        title: "Project On Hold: PM cần rà soát các Task đang mở",
        detail: `Project chuyển sang On Hold khi thành viên còn ${openTasks} Task đang mở. PM/Project PIC cần quyết định tạm dừng, đổi hạn hoặc phân công lại từng Task.`,
        ownerUserId: firstStage?.ownerUserId ?? undefined,
        actorUserId: principal.subjectId
      });
    }
  }

  async deleteProject(projectId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Projects are internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    await this.assertProjectManagerOrAdmin(this.prisma, projectId, principal);
    const blockers = await this.getProjectDeleteBlockers(projectId, principal.workspaceId);
    if (blockers.length > 0) {
      throw new BadRequestException(`Project cannot be deleted because it has operational records: ${formatDeleteBlockers(blockers)}. Archive or remove those records first.`);
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
        throw new BadRequestException("Project cannot be deleted because it is linked to operational records. Archive or remove linked records first.");
      }
      throw error;
    }

    return { deleted: true, id: project.id };
  }

  private async loadMilestoneReviewerUsers(milestones: readonly any[], principal: PrincipalContext) {
    const ids = Array.from(new Set(milestones.flatMap((milestone) => [milestone.reviewerUserId, milestone.reviewerApprovedByUserId]).filter((id): id is string => typeof id === "string" && Boolean(id))));
    const userModel = (this.prisma as any).user;
    if (ids.length === 0 || typeof userModel?.findMany !== "function") return new Map<string, MilestoneReviewerUser>();
    const users = await userModel.findMany({
      where: {
        id: { in: ids },
        status: SubjectStatus.ACTIVE,
        roleBindings: {
          some: {
            workspaceId: principal.workspaceId,
            tenantKey: principal.tenantKey,
            ...activeMembershipWhere()
          }
        }
      },
      select: { id: true, displayName: true, email: true }
    });
    return new Map<string, MilestoneReviewerUser>(users.map((user: MilestoneReviewerUser) => [user.id, user]));
  }

  private async loadProjectMilestoneEvidence(projectId: string, milestoneId: string, workspaceId: string): Promise<MilestoneEvidenceDocument[]> {
    const artifacts = await this.prisma.projectArtifact.findMany({
      where: { projectId, workspaceId, milestoneId },
      select: {
        artifactType: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            fileObject: {
              select: {
                storageProvider: true,
                status: true,
                scanStatus: true,
                deletedAt: true,
                revokedAt: true
              }
            }
          }
        }
      }
    });

    return artifacts.map((artifact: any) => {
      const fileObject = artifact.versions[0]?.fileObject;
      const latestVersionIsUsable = fileObject
        && fileObject.status === "active"
        && fileObject.scanStatus === "clean"
        && fileObject.deletedAt === null
        && fileObject.revokedAt === null;
      return {
        artifactType: artifact.artifactType,
        latestStorageProvider: latestVersionIsUsable ? fileObject.storageProvider : null
      };
    });
  }

  async getProjectHierarchy(projectId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project hierarchy is internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const milestones = await this.prisma.projectMilestone.findMany({
      where: {
        projectId: project.id,
        workspaceId: principal.workspaceId
      },
      include: {
        ownerTeam: { select: { id: true, name: true } },
        stages: {
          select: {
            tasks: {
              where: { workspaceId: principal.workspaceId, archivedAt: null },
              select: { status: true }
            }
          }
        }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
    const reviewerUsers = await this.loadMilestoneReviewerUsers(milestones, principal);
    const documentEvidenceByMilestone = new Map(
      await Promise.all(milestones.map(async (milestone) => [
        milestone.id,
        await this.loadProjectMilestoneEvidence(project.id, milestone.id, principal.workspaceId)
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

  async listProjectMilestoneGates(projectId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const milestones = await this.prisma.projectMilestone.findMany({
      where: { projectId: project.id, workspaceId: principal.workspaceId },
      include: {
        ownerTeam: { select: { id: true, name: true } },
        stages: {
          select: {
            tasks: {
              where: { workspaceId: principal.workspaceId, archivedAt: null },
              select: { status: true }
            }
          }
        }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    const reviewerUsers = await this.loadMilestoneReviewerUsers(milestones, principal);
    const documentEvidenceByMilestone = new Map(
      await Promise.all(milestones.map(async (milestone) => [
        milestone.id,
        await this.loadProjectMilestoneEvidence(project.id, milestone.id, principal.workspaceId)
      ] as const))
    );
    return {
      projectId: project.id,
      milestoneMode: project.milestoneMode,
      milestoneTemplateKey: project.milestoneTemplateKey,
      data: milestones.map((milestone) => mapMilestoneGateSummary(
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

  async updateProjectMilestoneGate(projectId: string, milestoneId: string, input: Record<string, unknown>, principal: PrincipalContext) {
    this.assertCanEditMilestoneGate(principal);
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const existing = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!existing) throw new NotFoundException("Project milestone not found");
    const requiredDocumentTypes = input.requiredDocumentTypes === undefined
      ? existing.requiredDocumentTypes
      : Array.isArray(input.requiredDocumentTypes)
        ? input.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
        : (() => { throw new BadRequestException("requiredDocumentTypes must be an array"); })();
    const configuredRequiredDocumentCount = input.requiredDocumentCount === undefined
        ? existing.requiredDocumentCount
        : optionalInteger(input.requiredDocumentCount, "requiredDocumentCount") ?? existing.requiredDocumentCount;
    if (configuredRequiredDocumentCount < 0) throw new BadRequestException("requiredDocumentCount must be non-negative");
    const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount({
      requiredDocumentCount: configuredRequiredDocumentCount,
      requiredDocumentTypes
    });
    const evidenceMode = input.evidenceMode === undefined ? existing.evidenceMode : normalizeMilestoneEvidenceMode(input.evidenceMode);
    const ownerTeamId = input.ownerTeamId === undefined
      ? existing.ownerTeamId
      : optionalString(input.ownerTeamId, "ownerTeamId") ?? null;
    if (ownerTeamId) {
      const team = await this.prisma.workspaceTeam.findFirst({ where: { id: ownerTeamId, workspaceId: principal.workspaceId, active: true }, select: { id: true } });
      if (!team) throw new BadRequestException("Team phụ trách không tồn tại trong workspace");
    }
    const unlockCriteria = input.unlockCriteria === undefined ? existing.unlockCriteria : { text: optionalString(input.unlockCriteria, "unlockCriteria") ?? "" };
    const gateStatus = input.gateStatus === undefined ? existing.gateStatus : optionalString(input.gateStatus, "gateStatus");
    if (gateStatus && !["open", "locked", "pending_review", "approved", "rejected", "conditional"].includes(gateStatus)) {
      throw new BadRequestException("Invalid milestone gate status");
    }
    if (gateStatus === "approved") {
      throw new BadRequestException("Milestone approval must be performed by the configured reviewer");
    }
    const reviewerMode = (input.reviewerMode === undefined
      ? normalizeMilestoneReviewerMode(existing.reviewerMode)
      : input.reviewerMode) as ProjectMilestoneReviewerMode;
    if (!MILESTONE_REVIEWER_MODES.has(reviewerMode as ProjectMilestoneReviewerMode)) {
      throw new BadRequestException("reviewerMode must be workspace_admin or specific_user");
    }
    const reviewerUserId = input.reviewerUserId === undefined
      ? existing.reviewerUserId
      : optionalString(input.reviewerUserId, "reviewerUserId") ?? null;
    if (reviewerMode === "specific_user") {
      if (!reviewerUserId) throw new BadRequestException("reviewerUserId is required when reviewerMode is specific_user");
      await this.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, [reviewerUserId]);
    }
    const confirmationRequested = input.customerConfirmationConfirmed === undefined
      ? undefined
      : Boolean(input.customerConfirmationConfirmed);
    const confirmationRequired = input.customerConfirmationRequired === undefined
      ? existing.customerConfirmationRequired
      : Boolean(input.customerConfirmationRequired);
    const confirmationReset = input.customerConfirmationRequired !== undefined && !confirmationRequired && confirmationRequested === undefined;
    const reviewerConfigurationChanged = reviewerMode !== normalizeMilestoneReviewerMode(existing.reviewerMode) || reviewerUserId !== (existing.reviewerUserId ?? null);
    const gateConfigurationChanged = reviewerConfigurationChanged
      || requiredDocumentCount !== existing.requiredDocumentCount
      || JSON.stringify(requiredDocumentTypes) !== JSON.stringify(existing.requiredDocumentTypes ?? [])
      || evidenceMode !== existing.evidenceMode
      || ownerTeamId !== (existing.ownerTeamId ?? null)
      || JSON.stringify(unlockCriteria) !== JSON.stringify(existing.unlockCriteria)
      || confirmationRequired !== existing.customerConfirmationRequired
      || confirmationRequested !== undefined;
    const nextGateStatus = gateStatus ?? (gateConfigurationChanged && existing.gateStatus !== "locked" ? "open" : existing.gateStatus);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectMilestone.update({
        where: { id: existing.id },
        data: {
          requiredDocumentCount,
          requiredDocumentTypes,
          evidenceMode,
          ownerTeamId,
          unlockCriteria: unlockCriteria === null ? undefined : unlockCriteria as Prisma.InputJsonValue,
          gateStatus: nextGateStatus,
          customerConfirmationRequired: confirmationRequired,
          customerConfirmationAt: confirmationRequested === undefined ? confirmationReset ? null : undefined : confirmationRequested ? new Date() : null,
          customerConfirmationByUserId: confirmationRequested === undefined ? confirmationReset ? null : undefined : confirmationRequested ? principal.subjectId : null,
          reviewerMode,
          reviewerUserId: reviewerMode === "specific_user" ? reviewerUserId : null,
          reviewerApprovedAt: gateConfigurationChanged ? null : undefined,
          reviewerApprovedByUserId: gateConfigurationChanged ? null : undefined,
          // The earlier request was for the old gate/reviewer: clear it so the next request notifies again.
          approvalRequestedAt: gateConfigurationChanged ? null : undefined,
          approvalRequestedByUserId: gateConfigurationChanged ? null : undefined,
          approvalRequestedByName: gateConfigurationChanged ? null : undefined,
          reviewerRole: input.reviewerRole === undefined ? existing.reviewerRole : optionalString(input.reviewerRole, "reviewerRole") ?? null
        }
      });
      if (gateConfigurationChanged && existing.gateStatus === "approved") {
        const next = await tx.projectMilestone.findFirst({
          where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: existing.sortOrder } },
          orderBy: { sortOrder: "asc" }
        });
        if (next && next.gateStatus === "open") {
          await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "locked" } });
        }
      }
      await this.auditMutation(tx, principal, "project.milestone_gate_updated", "project_milestone", result.id, JSON.parse(JSON.stringify(existing)), JSON.parse(JSON.stringify(result)));
      return result;
    });
    // Pending notifications still point the previous reviewer at a request that no longer exists.
    if (gateConfigurationChanged) await this.notifications?.resolveMilestoneNotifications(milestoneId, principal);
    return updated;
  }

  async evaluateProjectMilestoneGate(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!milestone) throw new NotFoundException("Project milestone not found");
    if (milestone.gateStatus === "locked") {
      throw new BadRequestException("Milestone is locked until the previous milestone is approved");
    }
    const evidenceMode = normalizeMilestoneEvidenceMode(milestone.evidenceMode);
    const documentEvidence = await this.loadProjectMilestoneEvidence(project.id, milestone.id, principal.workspaceId);
    const evidenceCounts = countMilestoneEvidence(milestone, documentEvidence);
    const submittedDocumentCount = submittedMilestoneEvidenceCount(evidenceCounts, evidenceMode);
    const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount(milestone);
    const taskRows = typeof this.prisma.projectTask?.findMany === "function"
      ? await this.prisma.projectTask.findMany({
          where: {
            projectId: project.id,
            workspaceId: principal.workspaceId,
            archivedAt: null,
            stage: { milestoneId: milestone.id }
          },
          select: { status: true }
        })
      : [];
    const evaluation = evaluateMilestoneGate({
      requiredDocumentCount,
      submittedDocumentCount,
      missingDocumentTypes: evidenceCounts.missingRequiredTypes,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      customerConfirmationAt: milestone.customerConfirmationAt,
      taskStatuses: taskRows.map((task: { status: unknown }) => task.status)
    });
    // Evaluation only proves the visible requirements. It must never impersonate
    // the configured reviewer or unlock the next milestone by itself.
    const nextStatus = evaluation.satisfied && milestone.gateStatus !== "approved"
      ? "pending_review"
      : milestone.gateStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectMilestone.update({ where: { id: milestone.id }, data: { gateStatus: nextStatus } });
      return result;
    });
    return {
      ...updated,
      requiredDocumentCount,
      submittedDocumentCount,
      ...evaluation,
      reviewerMode: normalizeMilestoneReviewerMode(updated.reviewerMode ?? milestone.reviewerMode),
      reviewerUserId: updated.reviewerUserId ?? milestone.reviewerUserId ?? undefined,
      reviewerApprovedAt: updated.reviewerApprovedAt?.toISOString?.() ?? updated.reviewerApprovedAt,
      reviewerApprovedByUserId: updated.reviewerApprovedByUserId ?? milestone.reviewerApprovedByUserId ?? undefined,
      reviewerApprovalRequired: updated.gateStatus !== "approved",
      canApprove: canApproveMilestoneReviewer({
        reviewerMode: normalizeMilestoneReviewerMode(updated.reviewerMode ?? milestone.reviewerMode),
        reviewerUserId: updated.reviewerUserId ?? milestone.reviewerUserId,
        principalUserId: principal.subjectId,
        principalRoleCodes: principal.roleCodes
      })
    };
  }

  async approveProjectMilestone(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone approval is internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!milestone) throw new NotFoundException("Project milestone not found");
    if (milestone.gateStatus !== "pending_review") {
      throw new BadRequestException("Milestone must be evaluated and pending review before approval");
    }

    const reviewerMode = normalizeMilestoneReviewerMode(milestone.reviewerMode);
    if (!canApproveMilestoneReviewer({
      reviewerMode,
      reviewerUserId: milestone.reviewerUserId,
      principalUserId: principal.subjectId,
      principalRoleCodes: principal.roleCodes
    })) {
      throw new ForbiddenException(reviewerMode === "specific_user"
        ? "Only the selected PIC can approve this milestone"
        : "Workspace administrator approval is required");
    }

    const evaluation = await this.evaluateProjectMilestoneGate(projectId, milestoneId, principal);
    if (!evaluation.satisfied) {
      throw new BadRequestException({
        message: "Milestone requirements are not complete",
        missingRequirements: evaluation.missingRequirements
      });
    }

    const approvedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.projectMilestone.update({
        where: { id: milestone.id },
        data: {
          gateStatus: "approved",
          reviewerApprovedAt: approvedAt,
          reviewerApprovedByUserId: principal.subjectId
        }
      });
      const next = await tx.projectMilestone.findFirst({
        where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: milestone.sortOrder } },
        orderBy: { sortOrder: "asc" }
      });
      if (next && next.gateStatus === "locked") {
        await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "open" } });
      }
      await this.auditMutation(tx, principal, "project.milestone_approved", "project_milestone", updated.id, JSON.parse(JSON.stringify(milestone)), JSON.parse(JSON.stringify(updated)));
      return updated;
    });

    await this.notifications?.resolveMilestoneNotifications(milestoneId, principal);

    return {
      ...result,
      ...evaluation,
      gateStatus: "approved",
      reviewerMode,
      reviewerUserId: result.reviewerUserId ?? milestone.reviewerUserId ?? undefined,
      reviewerApprovedAt: approvedAt.toISOString(),
      reviewerApprovedByUserId: principal.subjectId,
      reviewerApprovalRequired: false,
      canApprove: true
    };
  }

  async requestProjectMilestoneApproval(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone approval is internal");
    const evaluation = await this.evaluateProjectMilestoneGate(projectId, milestoneId, principal);
    if (!evaluation.satisfied) {
      throw new BadRequestException({
        message: "Milestone requirements are not complete",
        missingRequirements: evaluation.missingRequirements
      });
    }
    if (!this.notifications) {
      throw new BadRequestException("Approval notification service is not configured");
    }
    const requested = await this.notifications.createMilestoneApprovalRequest({ projectId, milestoneId, principal });
    return {
      ...evaluation,
      ...requested,
      reviewerApprovalRequired: true,
      canApprove: evaluation.canApprove
    };
  }

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
    const project = await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project stages are internal");
    if (hasInputKey(input, "sortOrder")) {
      throw new BadRequestException("sortOrder can only be changed through the hierarchy order endpoint");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.assertProjectManager(tx, projectId, principal);
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const activity = nonEmptyString(input.activity, "activity");
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? undefined;
    await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, project.id, ownerUserId ? [ownerUserId] : []);
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

  async updateStage(
    projectId: string,
    stageId: string,
    input: UpdateProjectStageInput,
    principal: PrincipalContext,
    options: UpdateStageOptions = {}
  ) {
    this.assertInternalTaskPrincipal(principal, "Project stages are internal");
    if (hasInputKey(input, "sortOrder")) {
      throw new BadRequestException("sortOrder can only be changed through the hierarchy order endpoint");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.assertProjectManager(tx, projectId, principal);
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
    await this.ensureProjectAssignmentUsers(
      tx,
      principal.workspaceId,
      principal.tenantKey,
      existingStage.projectId,
      typeof data.ownerUserId === "string" ? [data.ownerUserId] : []
    );

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

      await this.auditMutation(tx, principal, "project.milestone_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
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
      await this.auditMutation(tx, principal, "project.stage_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
      await this.syncMissingOwnerWarning(tx, principal, { projectId, kind: "stage", id: stageId, label: stage.activity, hasOwner: Boolean(stage.ownerUserId), isOpen: !CLOSED_WORK_STATUSES.includes(stage.status), stageId, milestoneId: stage.milestoneId });
      return mapProjectStageSummary(stage);
    }

    const stage = await tx.projectStage.update({
      where: { id: stageId },
      data,
      include: stageInclude
    });

    await this.auditMutation(tx, principal, "project.stage_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
      await this.syncMissingOwnerWarning(tx, principal, { projectId, kind: "stage", id: stageId, label: stage.activity, hasOwner: Boolean(stage.ownerUserId), isOpen: !CLOSED_WORK_STATUSES.includes(stage.status), stageId, milestoneId: stage.milestoneId });
      return mapProjectStageSummary(stage);
    }, { isolationLevel: "Serializable" });
  }

  async deleteStage(projectId: string, stageId: string, principal: PrincipalContext, options: DeleteStageOptions = {}) {
    this.assertInternalTaskPrincipal(principal, "Project stages are internal");
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
      await this.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.assertProjectManager(tx, projectId, principal);
      await this.lockProjectHierarchy(tx, projectId, principal.workspaceId);
      const taskIds = await this.collectTaskIdsForStages(tx, stageIds, principal.workspaceId);
      deletedTaskIds = taskIds;
      await this.deleteTaskSubtree(tx, taskIds, principal.workspaceId);
      await closeProjectWarnings(tx, { projectId, dedupeKey: { in: [...stageIds.map((id) => `NL-03:stage:${id}`), ...taskIds.map((id) => `NL-03:task:${id}`)] } }, principal.subjectId, "Stage/Task đã bị xóa");
      await this.closeResolvedDepartedMemberWarnings(tx, principal, projectId);
      await this.auditMutation(tx, principal, scope === "milestone" ? "project.milestone_deleted" : "project.stage_deleted", "project_stage", stage.id,
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
    await this.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const artifactType = optionalString(query.artifactType, "artifactType");

    const where = {
      workspaceId: principal.workspaceId,
      projectId,
      ...(artifactType ? { artifactType } : {})
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
    this.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const project = await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const project = await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const project = await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project documents can only be changed by internal users");
    const document = await this.ensureProjectDocument(projectId, documentId, principal.workspaceId);
    await this.prisma.projectArtifact.delete({ where: { id: document.id } });
    return { deleted: true, id: document.id };
  }

  async listProjectActivities(projectId: string, query: any, principal: PrincipalContext) {
    await this.ensureProject(projectId, principal.workspaceId);
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
    this.assertInternalTaskPrincipal(principal, "Project activities can only be changed by internal users");
    const project = await this.ensureProject(projectId, principal.workspaceId);

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
    this.assertInternalTaskPrincipal(principal, "Project activities can only be changed by internal users");
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
    this.assertInternalTaskPrincipal(principal, "Project activities can only be changed by internal users");
    const activity = await this.ensureProjectActivity(projectId, activityId, principal.workspaceId);
    await this.prisma.projectActivity.delete({ where: { id: activity.id } });
    return { deleted: true, id: activity.id };
  }

  async listProjectRisks(projectId: string, query: any, principal: PrincipalContext) {
    await this.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const status = optionalString(query.status, "status");

    const where = {
      workspaceId: principal.workspaceId,
      projectId,
      ...(status ? { status } : {})
    };

    const [risks, total] = await this.prisma.$transaction([
      this.prisma.projectRisk.findMany({
        where,
        include: projectRiskInclude,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.projectRisk.count({ where })
    ]);

    return {
      data: risks.map(mapProjectRiskSummary),
      meta: {
        principal,
        rowScope: "project",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: risks.length })
      }
    };
  }

  async createProjectRisk(projectId: string, input: CreateProjectRiskInput, principal: PrincipalContext, createdByUserId?: string) {
    this.assertInternalTaskPrincipal(principal, "Project risks can only be changed by internal users");
    const project = await this.ensureProject(projectId, principal.workspaceId);

    const risk = await this.prisma.projectRisk.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId: project.accountId,
        projectId: project.id,
        category: input.category?.trim() || "Operational",
        description: nonEmptyString(input.description, "description"),
        likelihood: input.likelihood?.trim() || "Medium",
        impact: input.impact?.trim() || "Medium",
        response: input.response?.trim() || "",
        switchTrigger: optionalString(input.switchTrigger, "switchTrigger") ?? undefined,
        dueAt: optionalDate(input.dueAt, "dueAt") ?? undefined,
        ownerUserId: optionalString(input.ownerUserId, "ownerUserId") ?? undefined,
        status: input.status?.trim() || "open",
        createdByUserId
      },
      include: projectRiskInclude
    });

    if (risk.ownerUserId) {
      await this.notifyProjectRiskOwnerSafely({ project, risk, workspaceId: principal.workspaceId, event: "created" });
    }

    return mapProjectRiskSummary(risk);
  }

  async updateProjectRisk(projectId: string, riskId: string, input: UpdateProjectRiskInput, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project risks can only be changed by internal users");
    const existingRisk = await this.ensureProjectRisk(projectId, riskId, principal.workspaceId);
    const project = await this.ensureProject(projectId, principal.workspaceId);

    const risk = await this.prisma.projectRisk.update({
      where: { id: riskId },
      data: {
        category: optionalString(input.category, "category") ?? undefined,
        description: optionalString(input.description, "description") ?? undefined,
        likelihood: optionalString(input.likelihood, "likelihood") ?? undefined,
        impact: optionalString(input.impact, "impact") ?? undefined,
        response: optionalString(input.response, "response") ?? undefined,
        switchTrigger: optionalString(input.switchTrigger, "switchTrigger"),
        dueAt: optionalDate(input.dueAt, "dueAt"),
        ownerUserId: optionalString(input.ownerUserId, "ownerUserId"),
        status: optionalString(input.status, "status") ?? undefined
      },
      include: projectRiskInclude
    });

    const resolved = ["resolved", "closed", "done"].includes(risk.status.toLowerCase());
    if (resolved) {
      await this.resolveProjectRiskNotificationsSafely(principal.workspaceId, risk.id);
    } else if (risk.ownerUserId && risk.ownerUserId !== existingRisk.ownerUserId && risk.ownerUserId !== principal.subjectId) {
      await this.resolveProjectRiskNotificationsSafely(principal.workspaceId, risk.id);
      await this.notifyProjectRiskOwnerSafely({ project, risk, workspaceId: principal.workspaceId, event: "reassigned" });
    }

    return mapProjectRiskSummary(risk);
  }

  async deleteProjectRisk(projectId: string, riskId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project risks can only be changed by internal users");
    const risk = await this.ensureProjectRisk(projectId, riskId, principal.workspaceId);
    await this.prisma.projectRisk.delete({ where: { id: risk.id } });
    return { deleted: true, id: risk.id };
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
    Object.assign(where, this.taskAccessWhere(principal));

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
    const task = await this.ensureTaskForPrincipal(taskId, principal, { include });
    return mapTaskSummary(task);
  }

  async createTask(input: CreateProjectTaskInput, principal: PrincipalContext, createdByUserId?: string) {
    this.assertInternalTaskPrincipal(principal, "Tasks can only be created by internal users");
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
    const gateStageId = normalized.stageId
      ?? (normalized.parentTaskId ? (await this.prisma.projectTask.findFirst({ where: { id: normalized.parentTaskId, workspaceId: principal.workspaceId }, select: { stageId: true } }))?.stageId : undefined);
    await this.assertMilestoneUnlocked(this.prisma, principal.workspaceId, gateStageId, "tạo task");
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
      await this.ensureProjectAssignmentUsers(this.prisma, principal.workspaceId, principal.tenantKey, normalized.projectId, assignmentUserIds);
    } else {
      await this.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentUserIds);
    }

    if (!normalized.accountId) {
      throw new BadRequestException("accountId is required");
    }

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
      taskTypeLayer1: input.taskTypeLayer1 ?? undefined,
      taskTypeLayer2: input.taskTypeLayer2 ?? undefined,
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

    if (isCompletedTaskStatus(requestedStatus)) {
      await this.evaluateMilestoneGateForTask(taskResult, principal);
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
            taskResult.taskTypeLayer1 && taskResult.taskTypeLayer2 ? `Task Type: ${taskResult.taskTypeLayer1} / ${taskResult.taskTypeLayer2}` : undefined,
            taskResult.estimateMinutes ? `Estimate: ${taskResult.estimateMinutes} phút` : undefined
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
    this.assertInternalTaskPrincipal(principal, "Task changes are internal");
    const scope = await this.normalizeTaskScope(input, principal.workspaceId, true);
    const existing = await this.ensureTaskForPrincipal(taskId, principal);
    if (
      (scope.projectId !== undefined && scope.projectId !== existing.projectId)
      || (scope.stageId !== undefined && scope.stageId !== existing.stageId)
      || (scope.parentTaskId !== undefined && scope.parentTaskId !== existing.parentTaskId)
    ) {
      throw new BadRequestException("Task hierarchy parent changes require a dedicated move endpoint");
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
      await this.ensureProjectAssignmentUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentProjectId, assignmentUserIds);
    } else {
      await this.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentUserIds);
    }

    const data: Prisma.ProjectTaskUncheckedUpdateInput = omitUndefined({
        ...scope,
        title: optionalString(input.title, "title") ?? undefined,
        description: optionalString(input.description, "description"),
        taskType: optionalString(input.taskType, "taskType") ?? undefined,
        taskTypeLayer1: hasInputKey(input, "taskTypeLayer1") ? input.taskTypeLayer1 : undefined,
        taskTypeLayer2: hasInputKey(input, "taskTypeLayer2") ? input.taskTypeLayer2 : undefined,
        status: requestedStatus ?? undefined,
        priority: optionalString(input.priority, "priority") ?? undefined,
        ownerUserId,
        assigneeUserId: hasAssigneeList ? (assigneeUserId ?? requestedAssigneeUserIds?.[0] ?? null) : assigneeUserId,
        ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId"),
        plannedStartAt: optionalDate(input.plannedStartAt, "plannedStartAt"),
        dueAt: optionalDate(input.dueAt, "dueAt"),
        estimateMinutes: hasInputKey(input, "estimateMinutes")
          ? validateTaskEstimateMinutes(input.estimateMinutes)
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
      for (const projectId of projectLocks) await this.lockProjectMembers(tx, principal.workspaceId, projectId);
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
      if (current.planApprovalStatus === "APPROVED" && !principal.roleCodes.some((roleCode) => TASK_PLAN_APPROVER_ROLES.has(roleCode))) {
        const nextStart = optionalDate(input.plannedStartAt, "plannedStartAt");
        const nextDue = optionalDate(input.dueAt, "dueAt");
        const nextEstimate = validateTaskEstimateMinutes(input.estimateMinutes);
        // undefined means "not sent": only a value that differs from the approved plan is a change.
        const planChanged = (nextStart !== undefined && !sameInstant(nextStart, current.plannedStartAt))
          || (nextDue !== undefined && !sameInstant(nextDue, current.dueAt))
          || (nextEstimate !== undefined && nextEstimate !== current.estimateMinutes);
        if (planChanged) {
          throw new ConflictException("Kế hoạch của task đã được duyệt và khóa. Hãy gửi yêu cầu thay đổi timeline (Timeline Change Request) để đổi ngày bắt đầu, hạn hoàn thành hoặc estimate.");
        }
      }
      const destinationProjectId = scope.projectId === undefined ? current.projectId : scope.projectId;
      const projectChanged = destinationProjectId !== current.projectId;
      if (projectChanged) {
        if (current.projectId) await this.assertProjectManager(tx, current.projectId, principal);
        else if (!principal.roleCodes.includes("FOUNDER_GM")) throw new ForbiddenException("Only Founder/GM can relocate a task without a project");
        if (destinationProjectId) await this.assertProjectManager(tx, destinationProjectId, principal);
        const retainedUsers = Array.from(new Set([
          ownerUserId === undefined ? current.ownerUserId : ownerUserId,
          ...nextAssigneeUserIds
        ].filter((id): id is string => Boolean(id))));
        if (destinationProjectId) await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, destinationProjectId, retainedUsers);
        else await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, retainedUsers);
        await this.auditMutation(tx, principal, "task.project_changed", "task", taskId, { projectId: current.projectId }, { projectId: destinationProjectId });
      }
      if (assignmentChanged) {
        const permissions = current.projectId ? await this.projectPermissions(tx, current.projectId, principal) : { canManage: principal.roleCodes.includes("FOUNDER_GM"), isMember: true };
        const ownsTask = current.ownerUserId === principal.subjectId
          || current.assigneeUserId === principal.subjectId
          || currentAssigneeUserIds.includes(principal.subjectId);
        if (!permissions.canManage && !(permissions.isMember && ownsTask)) throw new ForbiddenException("Only project managers or the current assigned task member can transfer this task");
        if (assignmentProjectId) await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, assignmentProjectId, assignmentUserIds);
        else await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, assignmentUserIds);
        await this.syncTaskAssignees(tx, principal.workspaceId, taskId, nextAssigneeUserIds, nextPrimaryAssigneeUserId ?? undefined);
        await this.auditMutation(tx, principal, "task.assignee_transferred", "task", taskId,
          { ownerUserId: current.ownerUserId, assigneeUserId: current.assigneeUserId, assigneeUserIds: currentAssigneeUserIds },
          { ownerUserId: ownerUserId === undefined ? current.ownerUserId : ownerUserId, assigneeUserId: nextPrimaryAssigneeUserId ?? (assigneeUserId === undefined ? current.assigneeUserId : assigneeUserId), assigneeUserIds: nextAssigneeUserIds });
      }
      if (requestedStatus !== undefined && requestedStatus !== null && requestedStatus !== current.status) {
        await tx.taskStatusHistory.create({ data: { workspaceId: principal.workspaceId, taskId: current.id, accountId: current.accountId, projectId: current.projectId, fromStatus: current.status, toStatus: requestedStatus, changedByUserId: principal.subjectId, changedAt: new Date(), reason: "Task updated" } });
      }
      const updated = await tx.projectTask.update({ where: { id: taskId }, data, include: taskInclude });
      await this.syncTaskOwnerWarning(tx, principal, updated);
      await this.auditMutation(
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
          title: "tên", description: "mô tả", taskType: "loại công việc", taskTypeLayer1: "nhóm Task Type",
          taskTypeLayer2: "bối cảnh Task Type", status: "trạng thái", priority: "ưu tiên", ownerUserId: "owner",
          assigneeUserId: "người phụ trách", plannedStartAt: "ngày bắt đầu", dueAt: "deadline", estimateMinutes: "estimate"
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
      return updated;
    });
    if (requestedStatus && isCompletedTaskStatus(requestedStatus)) {
      await this.evaluateMilestoneGateForTask(task, principal);
    }
    return mapTaskSummary(task);
  }

  async deleteTask(taskId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Tasks are internal");
    const task = await this.ensureTaskForPrincipal(taskId, principal);

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
    if (hasHistory || !(await this.canManageProjectOrAdmin(this.prisma, task.projectId, principal))) {
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
      await this.auditMutation(tx, principal, "task.deleted", "task", task.id, { title: task.title, projectId: task.projectId, stageId: task.stageId, status: task.status, ownerUserId: task.ownerUserId, assigneeUserId: task.assigneeUserId });
    }, inHierarchy ? { isolationLevel: "Serializable" } : undefined);

    return { deleted: true, archived: false, id: task.id };
  }

  async transitionTask(taskId: string, input: TransitionProjectTaskInput, principal: PrincipalContext, changedByUserId?: string) {
    // No portal write is intended here: a customer could otherwise set any status string and backdate changedAt.
    this.assertInternalTaskPrincipal(principal, "Task status can only be changed by internal users");
    const existing = await this.ensureTaskForPrincipal(taskId, principal);
    const toStatus = nonEmptyString(input.status, "status");
    // Nothing changed: no history row, no timestamps touched.
    if (toStatus === existing.status) return this.getTask(taskId, principal);
    const changedAt = optionalDate(input.changedAt, "changedAt") ?? new Date();

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

    if (isCompletedTaskStatus(toStatus)) {
      await this.evaluateMilestoneGateForTask(task, principal);
    }
    return mapTaskSummary(task);
  }

  async listTaskPlanningBlocks(query: any, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultEnd.getDate() + 7);

    const startAt = optionalDate(query.startAt, "startAt") ?? defaultStart;
    const endAt = optionalDate(query.endAt, "endAt") ?? defaultEnd;
    if (endAt <= startAt) {
      throw new BadRequestException("endAt must be after startAt");
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
    Object.assign(where, this.timeRecordVisibilityWhere(principal));

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
    this.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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
      throw new BadRequestException("endAt must be after startAt");
    }

    const diffMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    const plannedMinutes = optionalInteger(input.plannedMinutes, "plannedMinutes") ?? diffMinutes;
    if (plannedMinutes <= 0) {
      throw new BadRequestException("plannedMinutes must be greater than 0");
    }
    if (plannedMinutes > 480) {
      throw new BadRequestException("Daily plan cannot exceed 8 hours; create a separate approved overtime plan");
    }
    const workType = optionalString(input.workType, "workType") ?? "delivery";
    if (workType.length > 80) {
      throw new BadRequestException("workType must be 80 characters or fewer");
    }

    const block = await this.prisma.$transaction(async (tx) => {
      if (task.projectId) {
        await this.lockProjectMembers(tx, principal.workspaceId, task.projectId);
        await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, task.projectId, [userId]);
      } else await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [userId]);
      const planningDayKeys = getLocalDateKeysForTimeRange(startAt, endAt, startAt);
      await lockWorkspaceDayOffDates(tx, principal.workspaceId, planningDayKeys);
      if (!canOverrideWorkspaceDayOff(principal) && typeof tx.workspaceDayOff?.findFirst === "function") {
        const blockedDay = await tx.workspaceDayOff.findFirst({
          where: { workspaceId: principal.workspaceId, isActive: true, date: { in: planningDayKeys.map(dateOnlyToUtcDate) } },
          select: { date: true, name: true },
          orderBy: { date: "asc" }
        });
        if (blockedDay) throw new ConflictException(workspaceDayOffMessage(blockedDay));
      }
      const dayStart = new Date(startAt);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const plannedToday = typeof tx.taskPlanningBlock.aggregate === "function"
        ? await tx.taskPlanningBlock.aggregate({
            where: { workspaceId: principal.workspaceId, userId, startAt: { gte: dayStart, lt: dayEnd }, status: { not: "cancelled" } },
            _sum: { plannedMinutes: true }
          })
        : { _sum: { plannedMinutes: 0 } };
      if ((plannedToday._sum.plannedMinutes ?? 0) + plannedMinutes > 480) {
        throw new ConflictException("Daily plan cannot exceed 8 office hours; use a separate approved overtime plan");
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
    this.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
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
      where: { id: blockId, workspaceId: principal.workspaceId },
      include: taskPlanningBlockInclude
    });
    if (!existing) {
      throw new NotFoundException("Task planning block not found");
    }

    if (!canOverrideWorkspaceDayOff(principal) && typeof this.prisma.workspaceDayOff?.findFirst === "function") {
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
    if (targetStatus === "cancelled" && existing.userId !== principal.subjectId && !(await this.canManageProject(this.prisma, existing.projectId, principal))) {
      throw new ForbiddenException("Chỉ người được lập kế hoạch hoặc PM của dự án mới được hủy khối kế hoạch này");
    }

    let actualLogWarning: string | undefined;
    const withActualLogWarning = (block: any) => ({ ...mapTaskPlanningBlockSummary(block), ...(actualLogWarning ? { actualLogWarning } : {}) });

    if (existing.status === targetStatus) {
      if (targetStatus === "completed") {
        actualLogWarning = await this.prisma.$transaction((tx) => this.materializePlanningActual(tx, existing, principal));
      }
      return withActualLogWarning(existing);
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
          if (targetStatus === "completed") {
            actualLogWarning = await this.materializePlanningActual(tx, current, principal);
          }
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

      if (targetStatus === "completed") {
        actualLogWarning = await this.materializePlanningActual(tx, changed, principal);
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

    return withActualLogWarning(transitioned);
  }

  async listTaskTimeEntries(query: any, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultEnd.getDate() + 7);

    const startAt = optionalDate(query.startAt, "startAt") ?? defaultStart;
    const endAt = optionalDate(query.endAt, "endAt") ?? defaultEnd;
    if (endAt <= startAt) {
      throw new BadRequestException("endAt must be after startAt");
    }
    assertRangeWithinLimit(startAt, endAt, "Actual work calendar range");

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
    Object.assign(where, this.timeRecordVisibilityWhere(principal));

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
    this.assertInternalTaskPrincipal(principal, "Task planning blocks are internal");
    const block = await this.prisma.taskPlanningBlock.findFirst({
      where: { id: blockId, workspaceId: principal.workspaceId },
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

  async deleteTaskTimeEntry(entryId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { id: entryId, workspaceId: principal.workspaceId },
      select: { id: true, userId: true, taskId: true, projectId: true, minutes: true, workDate: true, approvalStatus: true, billable: true, reviewedByUserId: true }
    });
    if (!entry) {
      throw new NotFoundException("Task time entry not found");
    }

    await this.prisma.$transaction(async (tx) => {
      // Founder/GM, Workspace Admin and the project's manager may delete any entry; the author until a reviewer has approved it
      // (entries are created "approved" by default, so the status alone would lock every author out).
      if (!(await this.canManageProjectOrAdmin(tx, entry.projectId, principal))) {
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
      await this.auditMutation(tx, principal, "task.time_entry_deleted", "task_time_entry", entry.id, {
        userId: entry.userId, taskId: entry.taskId, projectId: entry.projectId, minutes: entry.minutes,
        workDate: entry.workDate?.toISOString?.() ?? null, approvalStatus: entry.approvalStatus, billable: entry.billable
      });
    });

    return { deleted: true, id: entry.id };
  }

  async reviewTaskTimeEntry(entryId: string, input: ReviewTaskTimeEntryInput, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Task time entries are internal");
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
        where: { id: entryId, workspaceId: principal.workspaceId },
        select: { id: true, approvalStatus: true, updatedAt: true }
      });
      if (!entry) throw new NotFoundException("Task time entry not found");
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
    fallbackUserId?: string
  ): Promise<CreateTaskTimeEntryResponse> {
    this.assertInternalTaskPrincipal(principal, "Task time entries are internal");
    const task = await this.ensureTaskForPrincipal(taskId, principal);
    const userId = optionalString(input.userId, "userId") ?? fallbackUserId;
    if (!userId) {
      throw new BadRequestException("userId is required");
    }
    if (userId !== principal.subjectId && !principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Only Founder/GM or Delivery Lead can log time for another user");
    }

    const inputStartAt = optionalDate(input.startAt, "startAt");
    const inputEndAt = optionalDate(input.endAt, "endAt");
    let minutes = optionalInteger(input.minutes, "minutes") ?? 0;
    if (minutes <= 0) {
      throw new BadRequestException("minutes must be greater than 0");
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
        throw new BadRequestException("endAt must be after startAt");
      }
      minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
      if (minutes <= 0) {
        throw new BadRequestException("time entry window must be greater than 0 minutes");
      }
    }
    const workDate = startAt ?? optionalDate(input.workDate, "workDate") ?? new Date();
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

    const result = await this.prisma.$transaction((tx) => this.writeTimeEntry(tx, principal, task, {
      userId, startAt, endAt, workDate, timeZone, minutes, workType, note,
      billable: optionalBoolean(input.billable, "billable") ?? true,
      approvalStatus: normalizeActualWorkApprovalStatus(optionalEnum(input.approvalStatus, "approvalStatus", TIME_APPROVAL_STATUSES))
    }));

    return {
      ...mapTaskTimeEntrySummary(result.entry),
      dailyActualLog: result.dailyActualLog
    };
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
          throw new BadRequestException("Time entry window must be within 07:00–19:00 and end after start");
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException("timeZone must be a valid IANA time zone");
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
    task: { id: string; accountId: string; projectId: string | null; stageId?: string | null; title: string; estimateMinutes?: number | null; taskTypeLayer1?: string | null; taskTypeLayer2?: string | null },
    entry: { userId: string; startAt?: Date | null; endAt?: Date | null; workDate: Date; timeZone: string; minutes: number; workType: string; note?: string; billable: boolean; approvalStatus: string; sourcePlanningBlockId?: string }
  ) {
    const { userId, startAt, endAt, workDate, timeZone, minutes, workType, note } = entry;
    const dailyLogWindow = getDailyActualLogWindow(workDate);
    const dayOffDateKeys = getLocalDateKeysForTimeRange(startAt, endAt, workDate);
    await this.assertMilestoneUnlocked(tx, principal.workspaceId, task.stageId, "log giờ");
    if (task.projectId) {
      await this.lockProjectMembers(tx, principal.workspaceId, task.projectId);
      await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, task.projectId, [userId]);
    } else await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [userId]);
    await lockWorkspaceDayOffDates(tx, principal.workspaceId, dayOffDateKeys);
    const dayOff = typeof tx.workspaceDayOff?.findFirst === "function"
      ? await tx.workspaceDayOff.findFirst({
          where: { workspaceId: principal.workspaceId, isActive: true, date: { in: dayOffDateKeys.map(dateOnlyToUtcDate) } },
          orderBy: { date: "asc" },
          select: { id: true, date: true, name: true }
        })
      : null;
    if (dayOff && !canOverrideWorkspaceDayOff(principal)) {
      throw new ConflictException(workspaceDayOffMessage(dayOff));
    }
    if (minutes > 480) {
      throw new BadRequestException("Daily log cannot exceed 8 office hours; log approved overtime separately");
    }
    // Serialize the per-user/day write before reading the current total. Without
    // this lock, two concurrent entries can both observe the same remaining
    // capacity and push the daily total past the 8-hour limit.
    const dailyLogLockScope = JSON.stringify([principal.workspaceId, userId, dailyLogWindow.localDate]);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dailyLogLockScope}, 0))::text`;
    if (!dayOff) {
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
        _sum: { minutes: true }
      }) : { _sum: { minutes: 0 } };
      if ((dailyMinutes._sum.minutes ?? 0) + minutes > 480) {
        throw new ConflictException("Daily log cannot exceed 8 office hours; create an approved overtime plan for the remainder");
      }
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
        const remainingTaskMinutes = Math.max(0, taskEstimateMinutes - currentTaskMinutes);
        throw new ConflictException(
          `Task actual time cannot exceed planned time. Remaining: ${remainingTaskMinutes} minutes`
        );
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
        dayOffId: dayOff?.id,
        workType,
        taskTypeLayer1: task.taskTypeLayer1,
        taskTypeLayer2: task.taskTypeLayer2,
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

    await this.auditMutation(tx, principal, "task.time_logged", "task_time_entry", created.id, undefined, { performerUserId: userId, taskId: task.id, minutes, workDate: workDate.toISOString() });
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

  async listTaskComments(taskId: string, query: any, principal: PrincipalContext) {
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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
    this.assertInternalTaskPrincipal(principal, "Task attachments are internal");
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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
    this.assertInternalTaskPrincipal(principal, "Task attachments are internal");
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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
    if (parentTaskId) {
      const parentTask = await this.prisma.projectTask.findFirst({ where: { id: parentTaskId, workspaceId } });
      if (!parentTask) {
        throw new NotFoundException("Parent task not found");
      }
      if (parentTask.accountId !== accountId || (project && parentTask.projectId !== project.id)) {
        throw new BadRequestException("Parent task does not belong to the selected account/project");
      }
    }

    return {
      accountId,
      workspaceId,
      projectId: projectId === null ? null : project?.id ?? projectId ?? undefined,
      stageId,
      opportunityId: optionalString(input.opportunityId, "opportunityId"),
      ticketId: optionalString(input.ticketId, "ticketId"),
      parentTaskId
    };
  }

  private async lockProjectMembers(tx: Prisma.TransactionClient, workspaceId: string, projectId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-members:${workspaceId}:${projectId}`}, 0))::text`;
  }

  private async auditMutation(tx: Prisma.TransactionClient, principal: PrincipalContext, action: string, resource: string, resourceId: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
    await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource, resourceId, before, after, requestId: randomUUID() } });
  }

  private async projectPermissions(tx: Prisma.TransactionClient, projectId: string, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user") return { canManage: false, canLogForOthers: false, isMember: false };
    const member = await tx.projectMember.findFirst({ where: { workspaceId: principal.workspaceId, projectId, userId: principal.subjectId,
      user: { status: SubjectStatus.ACTIVE, roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() } } } } });
    const firstStage = await tx.projectStage.findFirst({ where: { workspaceId: principal.workspaceId, projectId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { ownerUserId: true } });
    return { isMember: Boolean(member), canManage: principal.roleCodes.includes("FOUNDER_GM") || firstStage?.ownerUserId === principal.subjectId || (principal.roleCodes.includes("DELIVERY_LEAD") && Boolean(member)),
      canLogForOthers: principal.roleCodes.some((role) => TIME_REVIEW_ROLE_CODES.has(role)) };
  }

  private async assertProjectManager(tx: Prisma.TransactionClient, projectId: string, principal: PrincipalContext) {
    const permissions = await this.projectPermissions(tx, projectId, principal);
    if (!permissions.canManage) throw new ForbiddenException("Only the project PIC, a project Delivery Lead, or Founder/GM can manage this project");
  }

  /** Tasks and blocks outside any project fall back to Founder/GM. */
  private async canManageProject(client: Prisma.TransactionClient, projectId: string | null | undefined, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user") return false;
    return projectId ? (await this.projectPermissions(client, projectId, principal)).canManage : principal.roleCodes.includes("FOUNDER_GM");
  }

  private async canManageProjectOrAdmin(client: Prisma.TransactionClient, projectId: string | null | undefined, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user") return false;
    return isWorkspaceAdmin(principal.roleCodes) || this.canManageProject(client, projectId, principal);
  }

  private async assertProjectManagerOrAdmin(client: Prisma.TransactionClient, projectId: string, principal: PrincipalContext) {
    if (!(await this.canManageProjectOrAdmin(client, projectId, principal))) {
      throw new ForbiddenException("Chỉ PIC dự án, Delivery Lead của dự án, Workspace Admin hoặc Founder/GM mới được thực hiện thao tác này");
    }
  }

  /** A locked milestone opens only when the previous one is approved; until then nothing may be added to or logged in it. */
  private async assertMilestoneUnlocked(client: any, workspaceId: string, stageId: string | null | undefined, action: string) {
    if (!stageId || typeof client?.projectStage?.findFirst !== "function") return;
    const stage = await client.projectStage.findFirst({ where: { id: stageId, workspaceId }, select: { milestone: { select: { name: true, gateStatus: true } } } });
    if (stage?.milestone?.gateStatus === "locked") {
      throw new ConflictException(`Milestone "${stage.milestone.name}" đang khóa cho đến khi milestone trước được duyệt, nên chưa thể ${action}.`);
    }
  }

  /**
   * Founder/GM, Workspace Admin and anyone allowed to see cost (P&L needs every hour) read planning blocks and time entries of the whole workspace.
   * Any other internal user reads their own rows plus those of projects they are a member of or lead a stage in.
   */
  private timeRecordVisibilityWhere(principal: PrincipalContext) {
    if (isWorkspaceAdmin(principal.roleCodes) || canViewCost(principal)) return {};
    const memberOrLead: Prisma.ProjectWhereInput = { OR: [
      { members: { some: { userId: principal.subjectId, workspaceId: principal.workspaceId } } },
      { stages: { some: { ownerUserId: principal.subjectId } } }
    ] };
    return { AND: [{ OR: [{ userId: principal.subjectId }, { task: { project: memberOrLead } }] }] };
  }

  /** NL-03 closes with the task; the archive is audited like any other task change. */
  private async afterTaskArchived(tx: Prisma.TransactionClient, principal: PrincipalContext, task: { id: string; projectId: string | null; stageId?: string | null; title: string; status: string; ownerUserId: string | null; assigneeUserId: string | null }, archivedAt: Date) {
    await this.syncTaskOwnerWarning(tx, principal, { ...task, status: TASK_ARCHIVE_STATUS, archivedAt });
    await this.auditMutation(tx, principal, "task.archived", "task", task.id, { status: task.status }, { status: TASK_ARCHIVE_STATUS, archivedAt: archivedAt.toISOString() });
  }

  async listProjectMembers(projectId: string, query: any, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project member directory is internal");
    await this.ensureProject(projectId, principal.workspaceId);
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
      this.prisma.user.count({ where }), this.projectPermissions(this.prisma, projectId, principal)
    ]);
    const participation = period
      ? await this.computeMemberParticipation(await this.ensureProject(projectId, principal.workspaceId), users.map((user) => user.id), period)
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
    this.assertInternalTaskPrincipal(principal, "Task assignment history is internal");
    await this.ensureTaskForPrincipal(taskId, principal);
    const pagination = normalizePagination(query);
    const where = { workspaceId: principal.workspaceId, resource: "task", resourceId: taskId, action: "task.assignee_transferred" };
    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pagination.limit, skip: pagination.offset }),
      this.prisma.auditEvent.count({ where })
    ]);
    return { data: events.map((event) => ({ id: event.id, changedByUserId: event.actorUserId, changedAt: event.createdAt.toISOString(), before: event.before, after: event.after })), meta: { pagination: buildPaginationMeta({ ...pagination, total, returned: events.length }) } };
  }

  async listTaskHistory(taskId: string, query: any, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Task history is internal");
    const task = await this.ensureTaskForPrincipal(taskId, principal);
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

  private async ensureActiveWorkspaceUsers(
    tx: ActiveUserLookupClient,
    workspaceId: string,
    tenantKey: string,
    userIds: string[]
  ) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const users = await tx.user.findMany({
      where: {
        id: { in: uniqueIds },
        status: SubjectStatus.ACTIVE,
        roleBindings: { some: { workspaceId, tenantKey, ...activeMembershipWhere() } }
      },
      select: { id: true }
    });
    const found = new Set(users.map((user) => user.id));
    const missing = uniqueIds.filter((userId) => !found.has(userId));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown, inactive, or out-of-workspace user(s): ${missing.join(", ")}`);
    }
  }

  private async ensureProjectAssignmentUsers(
    tx: ProjectAssignmentLookupClient,
    workspaceId: string,
    tenantKey: string,
    projectId: string,
    userIds: string[]
  ) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    await this.ensureActiveWorkspaceUsers(tx, workspaceId, tenantKey, uniqueIds);

    const members = await tx.projectMember.findMany({
      where: {
        workspaceId,
        projectId,
        userId: { in: uniqueIds }
      },
      select: { userId: true }
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const missing = uniqueIds.filter((userId) => !memberIds.has(userId));
    if (missing.length > 0) {
      throw new BadRequestException(`User(s) are not project members: ${missing.join(", ")}`);
    }
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
        if (tasks || stages) throw new ConflictException("Transfer the member's active tasks and milestones before removing them from the project");
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
      if (input.principal) await this.auditMutation(tx, input.principal, "project.members_changed", "project", input.projectId, { memberUserIds: Array.from(new Set(existing.map((row) => row.userId))) }, { memberUserIds: uniqueUserIds });
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

  private async ensureProject(projectId: string, workspaceId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return project;
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
      select: { id: true }
    });
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

  private async ensureProjectRisk(projectId: string, riskId: string, workspaceId: string) {
    const risk = await this.prisma.projectRisk.findFirst({ where: { id: riskId, projectId, workspaceId } });
    if (!risk) {
      throw new NotFoundException("Project risk not found");
    }

    return risk;
  }

  private async notifyProjectRiskOwnerSafely(input: {
    project: { id: string; code: string; name: string };
    risk: { id: string; ownerUserId: string | null; category: string; description: string };
    workspaceId: string;
    event: "created" | "reassigned";
  }) {
    if (!this.notifications || !input.risk.ownerUserId) return;
    try {
      await this.notifications.notifyProjectRiskOwner({
        workspaceId: input.workspaceId,
        recipientUserId: input.risk.ownerUserId,
        projectId: input.project.id,
        projectCode: input.project.code,
        projectName: input.project.name,
        riskId: input.risk.id,
        riskCategory: input.risk.category,
        riskDescription: input.risk.description,
        event: input.event
      });
    } catch (error) {
      // The issue must remain saved even if notification delivery is temporarily unavailable.
      console.error("Project risk notification failed", error);
    }
  }

  private async resolveProjectRiskNotificationsSafely(workspaceId: string, riskId: string) {
    if (!this.notifications) return;
    try {
      await this.notifications.resolveProjectRiskNotifications(workspaceId, riskId);
    } catch (error) {
      console.error("Project risk notification resolution failed", error);
    }
  }

  private taskAccessWhere(principal: PrincipalContext): Prisma.ProjectTaskWhereInput {
    if (principal.subjectType !== "portal_user") {
      return {};
    }

    const customerAccountIds = Array.from(new Set(principal.customerAccountIds.filter(Boolean)));
    const customerProjectIds = Array.from(new Set(principal.customerProjectIds.filter(Boolean)));
    const grantWhere: Prisma.ProjectTaskWhereInput[] = [];
    if (customerAccountIds.length > 0) {
      grantWhere.push({ accountId: { in: customerAccountIds } });
    }
    if (customerProjectIds.length > 0) {
      grantWhere.push({ projectId: { in: customerProjectIds } });
    }

    if (grantWhere.length === 0) {
      return { id: "__task_access_denied__" };
    }

    return {
      customerVisible: true,
      OR: grantWhere
    };
  }

  private async evaluateMilestoneGateForTask(
    task: { projectId?: string | null; stageId?: string | null },
    principal: PrincipalContext
  ) {
    if (!task.projectId || !task.stageId || typeof this.prisma.projectStage?.findFirst !== "function") return;

    try {
      const stage = await this.prisma.projectStage.findFirst({
        where: {
          id: task.stageId,
          projectId: task.projectId,
          workspaceId: principal.workspaceId
        },
        select: { milestoneId: true }
      });
      if (stage?.milestoneId) {
        await this.evaluateProjectMilestoneGate(task.projectId, stage.milestoneId, principal);
      }
    } catch {
      // Task completion is durable even if a stale/legacy hierarchy record
      // cannot be re-evaluated. The handoff endpoint remains retryable.
    }
  }

  private async ensureTaskForPrincipal(taskId: string, principal: PrincipalContext, options?: { include?: Prisma.ProjectTaskInclude }) {
    const task = await this.prisma.projectTask.findFirst({
      where: {
        id: taskId,
        workspaceId: principal.workspaceId,
        ...this.taskAccessWhere(principal)
      },
      ...(options?.include ? { include: options.include } : {})
    });
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return task;
  }

  private assertInternalTaskPrincipal(principal: PrincipalContext, message: string) {
    if (principal.subjectType !== "internal_user") {
      throw new ForbiddenException(message);
    }
  }

  private assertCanEditProjectHierarchy(principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project hierarchy is internal");
    if (!principal.roleCodes.some((roleCode) => PROJECT_HIERARCHY_EDIT_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Founder/GM or Delivery Lead role is required to reorder project hierarchy");
    }
  }

  private assertCanEditMilestoneGate(principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    if (!principal.roleCodes.some((roleCode) => PROJECT_HIERARCHY_EDIT_ROLE_CODES.has(roleCode) || roleCode === "WORKSPACE_ADMIN")) {
      throw new ForbiddenException("Workspace admin, Founder/GM or Delivery Lead role is required to configure milestone gates");
    }
  }

  private assertCanManageMilestoneTemplates(principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Milestone templates are internal");
    if (!principal.roleCodes.some((roleCode) => MILESTONE_TEMPLATE_ADMIN_ROLES.has(roleCode))) {
      throw new ForbiddenException("Founder/GM or Workspace Admin role is required to manage milestone templates");
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

  private assertCanMaterializePlanningActual(userId: string, principal: PrincipalContext) {
    if (userId === principal.subjectId) {
      return;
    }
    if (!principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Only Founder/GM or Delivery Lead can complete planning for another user");
    }
  }

  private assertCanDeletePlanningBlock(userId: string, principal: PrincipalContext) {
    if (userId === principal.subjectId) {
      return;
    }
    if (!principal.roleCodes.some((roleCode) => TIME_REVIEW_ROLE_CODES.has(roleCode))) {
      throw new ForbiddenException("Only the planning owner, Founder/GM, or Delivery Lead can delete this planning block");
    }
  }

  /**
   * Turns a completed planning block into a time entry through the same rules as a manual log.
   * Returns a message when a rule rejects it: the block stays completed and the hours must be logged by hand.
   */
  private async materializePlanningActual(tx: Prisma.TransactionClient, block: {
    id: string;
    workspaceId: string;
    taskId: string;
    userId: string;
    startAt: Date;
    endAt: Date;
    plannedMinutes: number;
    billable?: boolean | null;
    workType?: string | null;
    notes?: string | null;
  }, principal: PrincipalContext): Promise<string | undefined> {
    const existingEntry = await tx.taskTimeEntry.findUnique({ where: { sourcePlanningBlockId: block.id }, select: { id: true } });
    if (existingEntry) return undefined;
    const task = await tx.projectTask.findFirst({ where: { id: block.taskId, workspaceId: block.workspaceId } });
    if (!task) throw new NotFoundException("Task not found");
    try {
      this.assertTimeEntryWindow(block.startAt, block.endAt, DEFAULT_TIME_ENTRY_TIME_ZONE);
      await this.writeTimeEntry(tx, principal, task, {
        userId: block.userId,
        startAt: block.startAt,
        endAt: block.endAt,
        workDate: block.startAt,
        timeZone: DEFAULT_TIME_ENTRY_TIME_ZONE,
        minutes: block.plannedMinutes,
        workType: block.workType ?? "delivery",
        note: block.notes ?? undefined,
        billable: block.billable ?? true,
        approvalStatus: DEFAULT_TIME_ENTRY_APPROVAL_STATUS,
        sourcePlanningBlockId: block.id
      });
      return undefined;
    } catch (error) {
      // writeTimeEntry rejects before its first write, so the block's completion in this transaction is still safe to commit.
      if (error instanceof HttpException && !(error instanceof NotFoundException)) return `${MANUAL_ACTUAL_LOG_MESSAGE} (${error.message})`;
      throw error;
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
        reason: "Actual work logged"
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
