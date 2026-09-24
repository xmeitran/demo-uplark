import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { SubjectStatus, type Prisma } from "@prisma/client";
import type {
  CreateProjectInput,
  CreateProjectMilestoneInput,
  CreateProjectMilestoneTemplateInput,
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
          avatarUrl: true
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
    where: { workspaceId: principal.workspaceId, user: { status: SubjectStatus.ACTIVE,
      roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() } } } }
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
const COUNTABLE_DAILY_ACTUAL_LOG_STATUSES = ["submitted", "approved", "done"];
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

function canOverrideWorkspaceDayOff(principal: PrincipalContext) {
  return principal.roleCodes.some((roleCode) => WORKSPACE_DAY_OFF_OVERRIDE_ROLES.has(roleCode));
}

function workspaceDayOffMessage(dayOff: { date: Date; name: string }) {
  return `Ngày ${dayOff.date.toISOString().slice(0, 10)} đã bị khóa là “${dayOff.name}”. User không thể lập kế hoạch hoặc logwork trong ngày nghỉ này.`;
}

const taskInclude = {
  account: true,
  project: true,
  stage: true,
  owner: true,
  assignee: true,
  ownerTeam: true,
  archivedBy: true,
  statusHistory: { orderBy: { changedAt: "desc" as const }, take: 20 },
  timeEntries: { include: { user: true, dayOff: true }, orderBy: { workDate: "desc" as const }, take: 100 }
};

const portalTaskInclude = {
  account: true,
  project: true,
  stage: true,
  owner: true,
  assignee: true,
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

function normalizeProjectStatusFilter(status: string | null) {
  if (!status) return null;
  const normalized = status.trim().toLowerCase().replace(/[_\s-]+/g, "_");
  const map: Record<string, string[]> = {
    active: ["in_progress", "active", "onboarding", "discovery"],
    in_progress: ["in_progress", "active", "onboarding", "discovery"],
    in_review: ["in_review", "review", "acceptance"],
    planning: ["planning", "not_started", "todo"],
    on_hold: ["on_hold", "paused", "pause"],
    paused: ["on_hold", "paused", "pause"],
    completed: ["completed", "done", "closed"],
    at_risk: ["at_risk", "blocked", "cancelled"]
  };
  return map[normalized] ?? [normalized];
}

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
    const requiredDocumentCount = optionalInteger(milestone.requiredDocumentCount, `manualMilestones[${milestoneIndex}].requiredDocumentCount`) ?? 0;
    if (requiredDocumentCount < 0) {
      throw new BadRequestException("requiredDocumentCount must be non-negative");
    }
    const requiredDocumentTypes = Array.isArray(milestone.requiredDocumentTypes)
      ? milestone.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
      : [];
    return {
      name,
      sortOrder: optionalInteger(milestone.sortOrder, `manualMilestones[${milestoneIndex}].sortOrder`) ?? (milestoneIndex + 1) * 10,
      requiredDocumentCount,
      requiredDocumentTypes,
      unlockCriteria: optionalString(milestone.unlockCriteria, `manualMilestones[${milestoneIndex}].unlockCriteria`) ?? undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
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
          customerRole: optionalString(stage.customerRole, "customerRole") ?? undefined
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
        customerRole: String(stage.customerRole ?? "").trim() || undefined
      };
    });
    const requiredDocumentTypes = Array.isArray(item.requiredDocumentTypes)
      ? item.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
      : [];
    return {
      name,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : (milestoneIndex + 1) * 10,
      requiredDocumentCount: Number.isFinite(Number(item.requiredDocumentCount)) ? Math.max(0, Number(item.requiredDocumentCount)) : 0,
      requiredDocumentTypes,
      unlockCriteria: String(item.unlockCriteria ?? "").trim() || undefined,
      customerConfirmationRequired: Boolean(item.customerConfirmationRequired),
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

@Injectable()
export class ProjectsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listProjects(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const accountId = optionalString(query.accountId, "accountId");
    const statusAliases = normalizeProjectStatusFilter(optionalString(query.status, "status") ?? null);
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

    return {
      data: projects.map(mapProjectSummary),
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
    return { data: mapMilestoneTemplateSummary(updated) };
  }

  async getProject(projectId: string, principal: PrincipalContext) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, include: projectIncludeForPrincipal(principal) });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return mapProjectSummary(project);
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
        [...memberUserIds, ownerUserId].filter((value): value is string => Boolean(value))
      );

      const createdProject = await tx.project.create({
        data: {
          accountId: account.id,
          workspaceId: principal.workspaceId,
          opportunityId,
          code,
          name,
          status: input.status?.trim() || "planning",
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
          const configuredGate = usePilotTemplate && Array.isArray(input.manualMilestones) ? (input.manualMilestones[milestoneIndex] as any) : undefined;
          const milestone = await tx.projectMilestone.create({
            data: {
              workspaceId: principal.workspaceId,
              accountId: account.id,
              projectId: createdProject.id,
              name: milestoneTemplate.name,
              normalizedKey: normalizeMilestoneKey(milestoneTemplate.name),
              sortOrder: milestoneTemplate.sortOrder ?? (milestoneIndex + 1) * 10,
              requiredDocumentCount: configuredGate?.requiredDocumentCount ?? milestoneTemplate.requiredDocumentCount ?? 0,
              requiredDocumentTypes: configuredGate?.requiredDocumentTypes ?? milestoneTemplate.requiredDocumentTypes ?? [],
              unlockCriteria: (configuredGate?.unlockCriteria ?? milestoneTemplate.unlockCriteria) ? { text: configuredGate?.unlockCriteria ?? milestoneTemplate.unlockCriteria } : undefined,
              gateStatus: milestoneIndex === 0 ? "open" : "locked",
              customerConfirmationRequired: configuredGate?.customerConfirmationRequired ?? milestoneTemplate.customerConfirmationRequired ?? false,
              reviewerRole: configuredGate?.reviewerRole ?? milestoneTemplate.reviewerRole
            }
          });
          const stageRows = milestoneTemplate.stages.map((stage: any, stageIndex: number) => ({
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
          }));
          await tx.projectStage.createMany({ data: stageRows });
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

    const project = await this.prisma.$transaction(async (tx) => {
      await this.lockProjectMembers(tx, principal.workspaceId, projectId);
      await this.assertProjectManager(tx, projectId, principal);

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
          status: optionalString(input.status, "status") ?? undefined,
          projectType,
          scopeSummary: updatesScope ? scopeSummary : undefined,
          marginPercent: optionalNumber(input.marginPercent, "marginPercent"),
          priority: updatesPriority ? priority : undefined,
          tags,
          color: updatesColor ? color : undefined
        }
      });

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
          await tx.projectStage.update({
            where: { id: firstStageId },
            data: {
              plannedStartAt: updatesStageStart ? plannedStartAt : undefined,
              scopeSummary: updatesScope ? scopeSummary : undefined,
              ownerUserId: updatesOwner ? ownerUserId : undefined
            }
          });
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

  async deleteProject(projectId: string, principal: PrincipalContext) {
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const blockers = await this.getProjectDeleteBlockers(projectId, principal.workspaceId);
    if (blockers.length > 0) {
      throw new BadRequestException(`Project cannot be deleted because it has operational records: ${formatDeleteBlockers(blockers)}. Archive or remove those records first.`);
    }

    try {
      await this.prisma.$transaction([
        this.prisma.projectMember.deleteMany({ where: { projectId, workspaceId: principal.workspaceId } }),
        this.prisma.projectBudget.deleteMany({ where: { projectId, workspaceId: principal.workspaceId } }),
        this.prisma.project.delete({ where: { id: project.id } })
      ]);
    } catch (error) {
      if (isPrismaForeignKeyError(error)) {
        throw new BadRequestException("Project cannot be deleted because it is linked to operational records. Archive or remove linked records first.");
      }
      throw error;
    }

    return { deleted: true, id: project.id };
  }

  async getProjectHierarchy(projectId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project hierarchy is internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const milestones = await this.prisma.projectMilestone.findMany({
      where: {
        projectId: project.id,
        workspaceId: principal.workspaceId
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });

    return {
      projectId: project.id,
      hierarchyOrderVersion: project.hierarchyOrderVersion,
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        projectId: milestone.projectId,
        name: milestone.name,
        normalizedKey: milestone.normalizedKey,
        sortOrder: milestone.sortOrder,
        gateStatus: milestone.gateStatus,
        requiredDocumentCount: milestone.requiredDocumentCount,
        requiredDocumentTypes: milestone.requiredDocumentTypes,
        unlockCriteria: typeof milestone.unlockCriteria === "object" && milestone.unlockCriteria && "text" in milestone.unlockCriteria
          ? String((milestone.unlockCriteria as { text?: unknown }).text ?? "")
          : undefined,
        customerConfirmationRequired: milestone.customerConfirmationRequired,
        reviewerRole: milestone.reviewerRole
      }))
    };
  }

  async listProjectMilestoneGates(projectId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const [milestones, submittedDocumentCount] = await this.prisma.$transaction([
      this.prisma.projectMilestone.findMany({
        where: { projectId: project.id, workspaceId: principal.workspaceId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      }),
      this.prisma.projectDocumentVersion.count({ where: { projectId: project.id, workspaceId: principal.workspaceId } })
    ]);
    return {
      projectId: project.id,
      milestoneMode: project.milestoneMode,
      milestoneTemplateKey: project.milestoneTemplateKey,
      data: milestones.map((milestone) => ({
        id: milestone.id,
        projectId: milestone.projectId,
        name: milestone.name,
        normalizedKey: milestone.normalizedKey,
        sortOrder: milestone.sortOrder,
        gateStatus: milestone.gateStatus,
        requiredDocumentCount: milestone.requiredDocumentCount,
        requiredDocumentTypes: milestone.requiredDocumentTypes,
        submittedDocumentCount,
        unlockCriteria: typeof milestone.unlockCriteria === "object" && milestone.unlockCriteria && "text" in milestone.unlockCriteria
          ? String((milestone.unlockCriteria as { text?: unknown }).text ?? "")
          : "",
        customerConfirmationRequired: milestone.customerConfirmationRequired,
        reviewerRole: milestone.reviewerRole
      }))
    };
  }

  async updateProjectMilestoneGate(projectId: string, milestoneId: string, input: Record<string, unknown>, principal: PrincipalContext) {
    this.assertCanEditMilestoneGate(principal);
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const existing = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!existing) throw new NotFoundException("Project milestone not found");
    const requiredDocumentCount = input.requiredDocumentCount === undefined
      ? existing.requiredDocumentCount
      : optionalInteger(input.requiredDocumentCount, "requiredDocumentCount") ?? existing.requiredDocumentCount;
    if (requiredDocumentCount < 0) throw new BadRequestException("requiredDocumentCount must be non-negative");
    const requiredDocumentTypes = input.requiredDocumentTypes === undefined
      ? existing.requiredDocumentTypes
      : Array.isArray(input.requiredDocumentTypes)
        ? input.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
        : (() => { throw new BadRequestException("requiredDocumentTypes must be an array"); })();
    const unlockCriteria = input.unlockCriteria === undefined ? existing.unlockCriteria : { text: optionalString(input.unlockCriteria, "unlockCriteria") ?? "" };
    const gateStatus = input.gateStatus === undefined ? existing.gateStatus : optionalString(input.gateStatus, "gateStatus");
    if (gateStatus && !["open", "locked", "pending_review", "approved", "rejected", "conditional"].includes(gateStatus)) {
      throw new BadRequestException("Invalid milestone gate status");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectMilestone.update({
        where: { id: existing.id },
        data: {
          requiredDocumentCount,
          requiredDocumentTypes,
          unlockCriteria: unlockCriteria === null ? undefined : unlockCriteria as Prisma.InputJsonValue,
          gateStatus: gateStatus ?? existing.gateStatus,
          customerConfirmationRequired: input.customerConfirmationRequired === undefined ? existing.customerConfirmationRequired : Boolean(input.customerConfirmationRequired),
          reviewerRole: input.reviewerRole === undefined ? existing.reviewerRole : optionalString(input.reviewerRole, "reviewerRole") ?? null
        }
      });
      if (result.gateStatus === "approved") {
        const next = await tx.projectMilestone.findFirst({
          where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: existing.sortOrder } },
          orderBy: { sortOrder: "asc" }
        });
        if (next && next.gateStatus === "locked") {
          await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "open" } });
        }
      }
      await this.auditMutation(tx, principal, "project.milestone_gate_updated", "project_milestone", result.id, JSON.parse(JSON.stringify(existing)), JSON.parse(JSON.stringify(result)));
      return result;
    });
    return updated;
  }

  async evaluateProjectMilestoneGate(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!milestone) throw new NotFoundException("Project milestone not found");
    const submittedDocumentCount = await this.prisma.projectDocumentVersion.count({ where: { projectId: project.id, workspaceId: principal.workspaceId } });
    const documentsSatisfied = submittedDocumentCount >= milestone.requiredDocumentCount;
    const nextStatus = documentsSatisfied && milestone.requiredDocumentCount > 0 ? "pending_review" : documentsSatisfied ? "approved" : milestone.gateStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectMilestone.update({ where: { id: milestone.id }, data: { gateStatus: nextStatus } });
      if (nextStatus === "approved") {
        const next = await tx.projectMilestone.findFirst({ where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: milestone.sortOrder } }, orderBy: { sortOrder: "asc" } });
        if (next && next.gateStatus === "locked") await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "open" } });
      }
      return result;
    });
    return { ...updated, submittedDocumentCount, documentsSatisfied };
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
      return mapProjectStageSummary(stage);
    }

    const stage = await tx.projectStage.update({
      where: { id: stageId },
      data,
      include: stageInclude
    });

    await this.auditMutation(tx, principal, "project.stage_updated", "project_stage", stageId, { phase: existingStage.phase, ownerUserId: existingStage.ownerUserId }, JSON.parse(JSON.stringify(data)));
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
      await this.lockProjectHierarchy(tx, projectId, principal.workspaceId);
      const taskIds = await this.collectTaskIdsForStages(tx, stageIds, principal.workspaceId);
      deletedTaskIds = taskIds;
      await this.deleteTaskSubtree(tx, taskIds, principal.workspaceId);
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
    const project = await this.ensureProject(projectId, principal.workspaceId);
    const name = nonEmptyString(input.name, "name");
    const artifactType = input.artifactType?.trim() || "project_document";
    const code = input.code?.trim() || `${project.code}-DOC-${Date.now().toString(36).toUpperCase()}`;
    const fileObjectId = nonEmptyString(input.fileObjectId, "fileObjectId");
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
    await this.ensureProjectDocument(projectId, documentId, principal.workspaceId);

    const document = await this.prisma.projectArtifact.update({
      where: { id: documentId },
      data: {
        name: optionalString(input.name, "name") ?? undefined,
        artifactType: optionalString(input.artifactType, "artifactType") ?? undefined,
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
        ownerUserId: optionalString(input.ownerUserId, "ownerUserId") ?? undefined,
        status: input.status?.trim() || "open",
        createdByUserId
      },
      include: projectRiskInclude
    });

    return mapProjectRiskSummary(risk);
  }

  async updateProjectRisk(projectId: string, riskId: string, input: UpdateProjectRiskInput, principal: PrincipalContext) {
    await this.ensureProjectRisk(projectId, riskId, principal.workspaceId);

    const risk = await this.prisma.projectRisk.update({
      where: { id: riskId },
      data: {
        category: optionalString(input.category, "category") ?? undefined,
        description: optionalString(input.description, "description") ?? undefined,
        likelihood: optionalString(input.likelihood, "likelihood") ?? undefined,
        impact: optionalString(input.impact, "impact") ?? undefined,
        response: optionalString(input.response, "response") ?? undefined,
        switchTrigger: optionalString(input.switchTrigger, "switchTrigger"),
        ownerUserId: optionalString(input.ownerUserId, "ownerUserId"),
        status: optionalString(input.status, "status") ?? undefined
      },
      include: projectRiskInclude
    });

    return mapProjectRiskSummary(risk);
  }

  async deleteProjectRisk(projectId: string, riskId: string, principal: PrincipalContext) {
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
      ...(query.assigneeUserId ? { assigneeUserId: query.assigneeUserId } : {}),
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
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? undefined;
    const assigneeUserId = optionalString(input.assigneeUserId, "assigneeUserId") ?? undefined;
    const assignmentUserIds = [ownerUserId, assigneeUserId].filter((id): id is string => Boolean(id));
    if (normalized.projectId) {
      await this.ensureProjectAssignmentUsers(this.prisma, principal.workspaceId, principal.tenantKey, normalized.projectId, assignmentUserIds);
    } else {
      await this.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, assignmentUserIds);
    }

    if (!normalized.accountId) {
      throw new BadRequestException("accountId is required");
    }

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
      status: input.status?.trim() || "todo",
      priority: input.priority?.trim() || "medium",
      ownerUserId,
      assigneeUserId,
      ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId") ?? undefined,
      plannedStartAt: plannedStartAt ?? undefined,
      dueAt: dueAt ?? undefined,
      estimateMinutes: optionalInteger(input.estimateMinutes, "estimateMinutes") ?? 0,
      customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
      createdByUserId
    };

    const task = normalized.projectId && normalized.stageId && !normalized.parentTaskId
      ? await this.prisma.$transaction(async (tx) => {
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
          const created = await tx.projectTask.create({
            data: {
              ...data,
              sortOrder: (lastTask?.sortOrder ?? 0) + 10
            },
            include: taskInclude
          });
          await tx.project.update({
            where: { id: normalized.projectId! },
            data: { hierarchyOrderVersion: { increment: 1 } }
          });
          return created;
        }, { isolationLevel: "Serializable" })
      : await this.prisma.projectTask.create({
          data: { ...data, sortOrder: 10 },
          include: taskInclude
        });

    await this.prisma.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId,
        actorUserId: createdByUserId ?? principal.subjectId,
        action: "task.created",
        resource: "task",
        resourceId: task.id,
        requestId: randomUUID(),
        after: {
          title: task.title,
          projectId: task.projectId,
          status: task.status,
          taskType: task.taskType,
          taskTypeLayer1: task.taskTypeLayer1,
          taskTypeLayer2: task.taskTypeLayer2,
          estimateMinutes: task.estimateMinutes
        }
      }
    });
    if (task.projectId && typeof this.prisma.projectActivity?.create === "function") {
      await this.prisma.projectActivity.create({
        data: {
          workspaceId: principal.workspaceId,
          projectId: task.projectId,
          accountId: task.accountId,
          activityType: "task_created",
          subject: `Đã tạo task: ${task.title}`,
          note: [
            task.taskTypeLayer1 && task.taskTypeLayer2 ? `Task Type: ${task.taskTypeLayer1} / ${task.taskTypeLayer2}` : undefined,
            task.estimateMinutes ? `Estimate: ${task.estimateMinutes} phút` : undefined
          ].filter(Boolean).join(" · "),
          target: task.title,
          occurredAt: new Date(),
          status: "active",
          createdByUserId: createdByUserId ?? principal.subjectId
        }
      });
    }
    return mapTaskSummary(task);
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
    const ownerUserId = optionalString(input.ownerUserId, "ownerUserId");
    const assigneeUserId = optionalString(input.assigneeUserId, "assigneeUserId");
    const assignmentUserIds = [ownerUserId, assigneeUserId].filter((id): id is string => typeof id === "string");
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
        assigneeUserId,
        ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId"),
        plannedStartAt: optionalDate(input.plannedStartAt, "plannedStartAt"),
        dueAt: optionalDate(input.dueAt, "dueAt"),
        estimateMinutes: optionalInteger(input.estimateMinutes, "estimateMinutes") ?? undefined,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? undefined
      });

    const task = await this.prisma.$transaction(async (tx) => {
      const projectLocks = Array.from(new Set([existing.projectId, assignmentProjectId].filter((id): id is string => Boolean(id)))).sort();
      for (const projectId of projectLocks) await this.lockProjectMembers(tx, principal.workspaceId, projectId);
      const current = await tx.projectTask.findFirst({ where: { id: taskId, workspaceId: principal.workspaceId } });
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
      const assignmentChanged = (hasInputKey(input, "assigneeUserId") && assigneeUserId !== current.assigneeUserId) || (hasInputKey(input, "ownerUserId") && ownerUserId !== current.ownerUserId);
      const destinationProjectId = scope.projectId === undefined ? current.projectId : scope.projectId;
      const projectChanged = destinationProjectId !== current.projectId;
      if (projectChanged) {
        if (current.projectId) await this.assertProjectManager(tx, current.projectId, principal);
        else if (!principal.roleCodes.includes("FOUNDER_GM")) throw new ForbiddenException("Only Founder/GM can relocate a task without a project");
        if (destinationProjectId) await this.assertProjectManager(tx, destinationProjectId, principal);
        const retainedUsers = [ownerUserId === undefined ? current.ownerUserId : ownerUserId, assigneeUserId === undefined ? current.assigneeUserId : assigneeUserId].filter((id): id is string => Boolean(id));
        if (destinationProjectId) await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, destinationProjectId, retainedUsers);
        else await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, retainedUsers);
        await this.auditMutation(tx, principal, "task.project_changed", "task", taskId, { projectId: current.projectId }, { projectId: destinationProjectId });
      }
      if (assignmentChanged) {
        const permissions = current.projectId ? await this.projectPermissions(tx, current.projectId, principal) : { canManage: principal.roleCodes.includes("FOUNDER_GM"), isMember: true };
        const ownsTask = current.ownerUserId === principal.subjectId || current.assigneeUserId === principal.subjectId;
        if (!permissions.canManage && !(permissions.isMember && ownsTask)) throw new ForbiddenException("Only project managers or the current assigned task member can transfer this task");
        if (assignmentProjectId) await this.ensureProjectAssignmentUsers(tx, principal.workspaceId, principal.tenantKey, assignmentProjectId, assignmentUserIds);
        else await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, assignmentUserIds);
        await this.auditMutation(tx, principal, "task.assignee_transferred", "task", taskId,
          { ownerUserId: current.ownerUserId, assigneeUserId: current.assigneeUserId },
          { ownerUserId: ownerUserId === undefined ? current.ownerUserId : ownerUserId, assigneeUserId: assigneeUserId === undefined ? current.assigneeUserId : assigneeUserId });
      }
      if (requestedStatus !== undefined && requestedStatus !== null && requestedStatus !== current.status) {
        await tx.taskStatusHistory.create({ data: { workspaceId: principal.workspaceId, taskId: current.id, accountId: current.accountId, projectId: current.projectId, fromStatus: current.status, toStatus: requestedStatus, changedByUserId: principal.subjectId, changedAt: new Date(), reason: "Task updated" } });
      }
      const updated = await tx.projectTask.update({ where: { id: taskId }, data, include: taskInclude });
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
          ["plannedStartAt", current.plannedStartAt?.toISOString() ?? null, updated.plannedStartAt?.toISOString() ?? null],
          ["dueAt", current.dueAt?.toISOString() ?? null, updated.dueAt?.toISOString() ?? null],
          ["estimateMinutes", current.estimateMinutes, updated.estimateMinutes]
        ].filter(([, before, after]) => before !== after).map(([field]) => String(field));
        const fieldLabels: Record<string, string> = {
          title: "tên", description: "mô tả", taskType: "loại công việc", taskTypeLayer1: "nhóm Task Type",
          taskTypeLayer2: "bối cảnh Task Type", status: "trạng thái", priority: "ưu tiên", ownerUserId: "owner",
          assigneeUserId: "người phụ trách", plannedStartAt: "ngày bắt đầu", dueAt: "deadline", estimateMinutes: "estimate"
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

    if (subtaskCount + historyCount + timeEntryCount + planningBlockCount + commentCount + attachmentCount > 0) {
      const archivedAt = new Date();
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
              reason: "Task archived instead of deleted because it has operational history"
            }
          });
          await tx.projectTask.update({
            where: { id: task.id },
            data: {
              status: TASK_ARCHIVE_STATUS,
              archivedAt,
              archivedByUserId: principal.subjectId,
              archiveReason: "Deleted from UI; preserved because task has operational history",
              cancelledAt: task.cancelledAt ?? archivedAt
            }
          });
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
            reason: "Task archived instead of deleted because it has operational history"
          }
        });
        await tx.projectTask.update({
          where: { id: task.id },
          data: {
            status: TASK_ARCHIVE_STATUS,
            archivedAt,
            archivedByUserId: principal.subjectId,
            archiveReason: "Deleted from UI; preserved because task has operational history",
            cancelledAt: task.cancelledAt ?? archivedAt
          }
        });
      });

      return {
        deleted: false,
        archived: true,
        id: task.id,
        archivedAt: archivedAt.toISOString()
      };
    }

    if (task.projectId && task.stageId && task.parentTaskId === null) {
      await this.prisma.$transaction(async (tx) => {
        await this.lockProjectHierarchy(tx, task.projectId!, principal.workspaceId);
        await tx.projectTask.delete({ where: { id: task.id } });
        await tx.project.update({
          where: { id: task.projectId! },
          data: { hierarchyOrderVersion: { increment: 1 } }
        });
      }, { isolationLevel: "Serializable" });
    } else {
      await this.prisma.projectTask.delete({ where: { id: task.id } });
    }

    return { deleted: true, archived: false, id: task.id };
  }

  async transitionTask(taskId: string, input: TransitionProjectTaskInput, principal: PrincipalContext, changedByUserId?: string) {
    const existing = await this.ensureTaskForPrincipal(taskId, principal);
    const toStatus = nonEmptyString(input.status, "status");
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

      return tx.projectTask.update({
        where: { id: existing.id },
        data: {
          status: toStatus,
          startedAt: toStatus === "in_progress" && !existing.startedAt ? changedAt : undefined,
          completedAt: toStatus === "done" ? changedAt : undefined,
          cancelledAt: toStatus === "cancelled" ? changedAt : undefined
        },
        include: taskInclude
      });
    });

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
      await this.ensureActiveWorkspaceUsers(tx, principal.workspaceId, principal.tenantKey, [userId]);
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

    if (existing.status === targetStatus) {
      if (targetStatus === "completed") {
        await this.prisma.$transaction(async (tx) => {
          await this.materializePlanningActual(tx, existing, changedByUserId ?? principal.subjectId);
        });
      }
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
          if (targetStatus === "completed") {
            await this.materializePlanningActual(tx, current, changedByUserId ?? principal.subjectId);
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
        await this.materializePlanningActual(tx, changed, changedByUserId ?? principal.subjectId);
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
      select: { id: true }
    });
    if (!entry) {
      throw new NotFoundException("Task time entry not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.projectCost.updateMany({
        where: { taskTimeEntryId: entry.id, workspaceId: principal.workspaceId },
        data: { taskTimeEntryId: null }
      });
      await tx.taskTimeEntry.delete({ where: { id: entry.id } });
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
    const dailyLogWindow = getDailyActualLogWindow(workDate);
    const dayOffDateKeys = getLocalDateKeysForTimeRange(startAt, endAt, workDate);
    const timeZone = optionalString(input.timeZone, "timeZone") ?? DEFAULT_TIME_ENTRY_TIME_ZONE;
    if (timeZone.length > 80) {
      throw new BadRequestException("timeZone must be 80 characters or fewer");
    }
    const workType = optionalString(input.workType, "workType") ?? "delivery";
    if (workType.length > 80) {
      throw new BadRequestException("workType must be 80 characters or fewer");
    }
    const note = optionalString(input.note, "note") ?? undefined;

    const result = await this.prisma.$transaction(async (tx) => {
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
      if (!dayOff) {
        const dailyMinutes = typeof tx.taskTimeEntry.aggregate === "function" ? await tx.taskTimeEntry.aggregate({
          where: {
            workspaceId: principal.workspaceId,
            userId,
            approvalStatus: { not: "rejected" },
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
      const dailyLogLockScope = JSON.stringify([principal.workspaceId, userId, dailyLogWindow.localDate]);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dailyLogLockScope}, 0))::text`;

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
          billable: optionalBoolean(input.billable, "billable") ?? true,
          dayOffId: dayOff?.id,
          workType,
          taskTypeLayer1: task.taskTypeLayer1,
          taskTypeLayer2: task.taskTypeLayer2,
          approvalStatus: normalizeActualWorkApprovalStatus(optionalEnum(input.approvalStatus, "approvalStatus", TIME_APPROVAL_STATUSES)),
          note
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
          approvalStatus: { in: COUNTABLE_DAILY_ACTUAL_LOG_STATUSES },
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
    });

    return {
      ...mapTaskTimeEntrySummary(result.entry),
      dailyActualLog: result.dailyActualLog
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

  async listProjectMembers(projectId: string, query: any, principal: PrincipalContext) {
    this.assertInternalTaskPrincipal(principal, "Project member directory is internal");
    await this.ensureProject(projectId, principal.workspaceId);
    const pagination = normalizePagination(query);
    const q = optionalString(query.q ?? query.search, "q");
    const where: Prisma.UserWhereInput = { status: SubjectStatus.ACTIVE,
      roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() } },
      projectMembers: { some: { workspaceId: principal.workspaceId, projectId } },
      ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {})
    };
    const [users, total, permissions] = await Promise.all([
      this.prisma.user.findMany({ where, select: { id: true, displayName: true, email: true, avatarUrl: true,
        roleBindings: { where: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() }, select: { role: { select: { code: true } } } } }, orderBy: [{ displayName: "asc" }, { id: "asc" }], skip: pagination.offset, take: pagination.limit }),
      this.prisma.user.count({ where }), this.projectPermissions(this.prisma, projectId, principal)
    ]);
    return { data: users.map((user) => ({ userId: user.id, displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl ?? undefined, status: "active" as const, roleCodes: user.roleBindings.map((binding) => binding.role.code) })),
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
          tx.projectTask.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, archivedAt: null, status: { notIn: ["completed", "done", "cancelled", "closed"] }, OR: [{ ownerUserId: { in: removed } }, { assigneeUserId: { in: removed } }] } }),
          tx.projectStage.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ownerUserId: { in: removed }, status: { notIn: ["completed", "done", "cancelled", "closed"] } } })
        ]);
        if (tasks || stages) throw new ConflictException("Transfer the member's active tasks and milestones before removing them from the project");
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

  private async materializePlanningActual(tx: Prisma.TransactionClient, block: {
    id: string;
    workspaceId: string;
    taskId: string;
    accountId: string;
    projectId: string | null;
    userId: string;
    startAt: Date;
    endAt: Date;
    plannedMinutes: number;
    billable?: boolean | null;
    workType?: string | null;
    notes?: string | null;
  }, changedByUserId?: string) {
    await this.promoteTaskForActualWork(tx, {
      taskId: block.taskId,
      workspaceId: block.workspaceId,
      changedByUserId,
      occurredAt: block.startAt
    });

    await tx.taskTimeEntry.upsert({
      where: { sourcePlanningBlockId: block.id },
      create: {
        workspaceId: block.workspaceId,
        taskId: block.taskId,
        accountId: block.accountId,
        projectId: block.projectId,
        userId: block.userId,
        workDate: block.startAt,
        startAt: block.startAt,
        endAt: block.endAt,
        timeZone: DEFAULT_TIME_ENTRY_TIME_ZONE,
        minutes: block.plannedMinutes,
        billable: block.billable ?? true,
        workType: block.workType ?? "delivery",
        approvalStatus: DEFAULT_TIME_ENTRY_APPROVAL_STATUS,
        note: block.notes ?? undefined,
        sourcePlanningBlockId: block.id
      },
      update: {}
    });
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
