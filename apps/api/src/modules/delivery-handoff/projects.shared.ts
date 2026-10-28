// Constants, Prisma includes and pure helpers shared by ProjectsService and the services split out of it.
import { BadRequestException } from "@nestjs/common";
import type {
  CreateProjectMilestoneInput,
  ProjectTaskTemplateInput,
  ProjectMilestoneEvidenceMode,
  PrincipalContext
} from "@b2b-crm/contracts";
import {
  optionalInteger,
  optionalString
} from "../../shared/http/request-context";
import { evaluateMilestoneGate } from "./milestone-gate";
import {
  effectiveMilestoneRequiredDocumentCount,
  submittedMilestoneEvidenceCount,
  type MilestoneEvidenceCounts
} from "./milestone-evidence";
import {
  canApproveMilestoneReviewer,
  normalizeMilestoneReviewerMode
} from "./milestone-reviewer";
import { isTaskTypeLayer1, isValidTaskTypePair } from "./task-classification";
import { deriveTaskStatus } from "./task-status";

export const TIME_REVIEW_ROLE_CODES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "DELIVERY_LEAD"]);
export const PROJECT_HIERARCHY_EDIT_ROLE_CODES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "DELIVERY_LEAD"]);
export const BUILTIN_MILESTONE_TEMPLATE_KEY = "pilot-v1";
/** Refusal of a submit / review step on a project in "Không duyệt" mode (Project.milestoneApprovalRequired = false). */
export const NO_MILESTONE_APPROVAL_MESSAGE = "Dự án không duyệt milestone: milestone và điểm chốt tự hoàn thành khi hết task, không cần nộp hay duyệt hồ sơ.";
// Mirrors MANAGER_ROLES in brd-governance.service.ts: the roles that approve task plans and timeline change requests.
// Admin accounts only (D-21): FINANCE_ADMIN (Kế toán) is a User-type role in ROLE_CATALOGUE and approves no plan.
export const TASK_PLAN_APPROVER_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"]);

export function workspaceDayOffMessage(dayOff: { date: Date; name: string }) {
  return `Ngày ${dayOff.date.toISOString().slice(0, 10)} đã bị khóa là “${dayOff.name}”. User không thể lập kế hoạch hoặc logwork trong ngày nghỉ này.`;
}

export const taskPlanningBlockInclude = {
  account: true,
  project: true,
  task: true,
  user: true
};

export const taskTimeEntryInclude = {
  task: { include: { account: true, project: true } },
  user: true,
  reviewedBy: true,
  dayOff: true
};

export function isPrismaWriteConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return ["P2002", "P2034"].includes((error as { code?: string }).code ?? "");
}

export const MILESTONE_EVIDENCE_MODES = new Set(["file", "link", "file_or_link"]);

export function normalizeMilestoneEvidenceMode(value: unknown): ProjectMilestoneEvidenceMode {
  const mode = String(value ?? "file_or_link").trim().toLowerCase();
  if (!MILESTONE_EVIDENCE_MODES.has(mode)) {
    throw new BadRequestException("evidenceMode must be file, link, or file_or_link");
  }
  return mode as ProjectMilestoneEvidenceMode;
}

export type MilestoneReviewerUser = { id: string; displayName: string; email: string };

export function mapMilestoneGateSummary(
  milestone: any,
  evidenceCounts: MilestoneEvidenceCounts,
  reviewerUser?: MilestoneReviewerUser,
  approvedByUser?: MilestoneReviewerUser,
  principal?: PrincipalContext,
  approvalRequired = true
) {
  const evidenceMode = normalizeMilestoneEvidenceMode(milestone.evidenceMode);
  const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount(milestone);
  const submittedDocumentCount = submittedMilestoneEvidenceCount(evidenceCounts, evidenceMode);
  // The gate is about milestone deliverables, so count active top-level Tasks
  // only. Subtasks are execution detail and change-request stages are tracked
  // outside the ordinary milestone handoff.
  const taskStatuses = (milestone.stages ?? [])
    .filter((stage: any) => !stage.changeRequestId)
    .flatMap((stage: any) =>
      (stage.tasks ?? [])
        .filter((task: any) => !task.parentTaskId && !task.archivedAt)
        .map((task: any) => deriveTaskStatus({
          rawStatus: task.status,
          plannedStartAt: task.plannedStartAt,
          dueAt: task.dueAt,
          estimateMinutes: task.estimateMinutes,
          timeEntries: task.timeEntries,
          subtasks: task.subtasks
        }))
    );
  const evaluation = evaluateMilestoneGate({
    requiredDocumentCount,
    submittedDocumentCount,
    missingDocumentTypes: evidenceCounts.missingRequiredTypes,
    customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
    customerConfirmationAt: milestone.customerConfirmationAt,
    taskStatuses,
    approvalRequired
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
    reviewerApprovalRequired: approvalRequired && milestone.gateStatus !== "approved",
    canApprove: approvalRequired && principal
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

export function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export function hasInputKey(input: object, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function optionalEnum(value: unknown, fieldName: string, allowed: Set<string>) {
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

export type MilestoneTemplateRecord = CreateProjectMilestoneInput[];

export const MAX_TASK_ESTIMATE_MINUTES = 8 * 60;
export const TASK_ESTIMATE_CAP_MESSAGE = "Giờ kế hoạch của một task tối đa 8 giờ (480 phút). Việc dài hơn hãy tách thành nhiều task hoặc sub-task.";

const hoursLabel = (minutes: number) => `${Math.round(minutes / 6) / 10} giờ`;

/**
 * Why a plan or a log does not fit the day (D-13): approved full-day leave has its own message; otherwise the day's
 * standard hours, what the person already has on that day, and what is left.
 */
export function dayCapMessage(capMinutes: number, kind: "plan" | "log", usedMinutes: number) {
  const action = kind === "plan" ? "lập kế hoạch" : "ghi giờ";
  if (capMinutes === 0) return `Ngày này đã có đơn nghỉ phép cả ngày được duyệt nên không ${action} hành chính được.`;
  const used = Math.max(0, usedMinutes);
  const already = used > 0
    ? ` Ngày này người thực hiện đã ${kind === "plan" ? "có kế hoạch" : "ghi"} ${hoursLabel(used)}, còn ${action} được tối đa ${hoursLabel(Math.max(0, capMinutes - used))}.`
    : "";
  return `Mỗi người chỉ ${action} tối đa ${hoursLabel(capMinutes)} hành chính một ngày.${already} Hãy giảm số giờ hoặc chọn ngày khác.`;
}

/**
 * `unchangedValue` is the task's stored estimate on an update: an older estimate above the cap that is sent back
 * as is (the forms resend every field) is not a change, so it never blocks saving the other fields.
 */
export function validateTaskEstimateMinutes(value: unknown, path = "estimateMinutes", unchangedValue?: number | null) {
  if (value === undefined || value === null) return undefined;
  const estimateMinutes = optionalInteger(value, path);
  if (estimateMinutes === undefined || estimateMinutes === null) return undefined;
  if (unchangedValue !== undefined && unchangedValue !== null && estimateMinutes === unchangedValue) return estimateMinutes;
  if (estimateMinutes < 0 || estimateMinutes > MAX_TASK_ESTIMATE_MINUTES) {
    throw new BadRequestException(TASK_ESTIMATE_CAP_MESSAGE);
  }
  return estimateMinutes;
}

export function milestoneTemplateKey(value: unknown, fallback: string) {
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

/** Layer 1 on a template stage or template task (rules 4.1): optional, but never an unknown value. */
export function templateTaskTypeLayer1(value: unknown, path: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isTaskTypeLayer1(value)) throw new BadRequestException(`${path} must be PRE_SALE, DELIVERY or PM`);
  return value;
}

/** Matrix 4.3: the invalid cell blocks the save. */
export function assertTaskTypePair(layer1: string | null | undefined, layer2: string | null | undefined) {
  if (!isValidTaskTypePair(layer1, layer2)) {
    throw new BadRequestException("Task Pre-sale không thể nằm trong stage sau mốc đóng P&L (Ticket/bảo trì). Bán thêm cho khách đang bảo trì là một dự án mới.");
  }
}

export function normalizeTemplateTasks(value: unknown, path: string, depth = 0): ProjectTaskTemplateInput[] {
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
      taskTypeLayer1: templateTaskTypeLayer1(task.taskTypeLayer1, `${path}[${taskIndex}].taskTypeLayer1`),
      estimateMinutes,
      plannedStartAt: optionalString(task.plannedStartAt, `${path}[${taskIndex}].plannedStartAt`) ?? undefined,
      dueAt: optionalString(task.dueAt, `${path}[${taskIndex}].dueAt`) ?? undefined,
      subtasks: normalizeTemplateTasks(task.subtasks, `${path}[${taskIndex}].subtasks`, depth + 1)
    };
  });
}

export function normalizeMilestoneTemplateMilestones(value: unknown): MilestoneTemplateRecord {
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
        gateCode: typeof stage.gateCode === "string" ? stage.gateCode : undefined,
        upbaseRole: String(stage.upbaseRole ?? "").trim() || undefined,
        customerRole: String(stage.customerRole ?? "").trim() || undefined,
        taskTypeLayer1: templateTaskTypeLayer1(stage.taskTypeLayer1, `milestones[${milestoneIndex}].stages[${stageIndex}].taskTypeLayer1`),
        afterPnlClose: typeof stage.afterPnlClose === "boolean" ? stage.afterPnlClose : undefined,
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
