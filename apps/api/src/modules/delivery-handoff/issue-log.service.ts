/**
 * Persistence of the issue log: code assignment, create / edit / transition, history, warnings and in-app notifications.
 * The rules themselves are in issue-log.ts. ProjectsService delegates its risk endpoints here.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ISSUE_LOG_EXTENSION_FIELDS,
  ISSUE_LOG_SEVERITY_LABELS,
  ISSUE_LOG_STATUS_LABELS,
  ISSUE_LOG_TYPE_LABELS,
  ISSUE_LOG_TYPES,
  isIssueLogOpen,
  type CreateProjectRiskInput,
  type IssueLogExtension,
  type IssueLogHistoryEntry,
  type IssueLogStatus,
  type IssueLogTransitionInput,
  type IssueLogType,
  type PnlG7Blockers,
  type PrincipalContext,
  type ProjectRiskSummary,
  type UpdateProjectRiskInput
} from "@b2b-crm/contracts";
import { nonEmptyString, optionalDate, optionalString } from "../../shared/http/request-context";
import {
  allowedActions,
  assertRequiredOnCreate,
  INITIAL_ISSUE_LOG_STATUS,
  isIssueLogType,
  issueLogAgeDays,
  issueLogCode,
  issueLogDueState,
  issueLogWarningKeys,
  issueLogWarnings,
  parseImpactArea,
  parseIssueLogSeverity,
  parseIssueLogType,
  planTransition,
  readExtension,
  sanitizeExtension,
  type IssueLogActor
} from "./issue-log";
import { WORKSPACE_ADMIN_ROLE_CODES, isWorkspaceAdmin } from "./milestone-reviewer";
import { projectPmUserId } from "./project-visibility";
import { closeProjectWarnings, isWarningSuppressed, openOrRefreshProjectWarning, rearmManuallyClosedWarning } from "./project-warnings";

export const issueLogInclude = {
  account: true,
  project: true,
  owner: true,
  createdBy: true,
  milestone: { select: { id: true, name: true } },
  stage: { select: { id: true, activity: true } },
  task: { select: { id: true, title: true } },
  events: { orderBy: { at: "asc" as const } }
};

/** Minimal surface of NotificationsService this file uses; all of it is in-app only. */
export interface IssueLogNotifier {
  notifyProjectRiskOwner(input: any): Promise<unknown>;
  resolveProjectRiskNotifications(workspaceId: string, riskId: string): Promise<unknown>;
  notifyIssueLogEvent?(input: { workspaceId: string; recipientUserIds: string[]; projectId: string; riskId: string; event: string; title: string; body: string }): Promise<unknown>;
}

export interface IssueLogContext {
  prisma: any;
  notifications?: IssueLogNotifier | null;
  principal: PrincipalContext;
  actor: IssueLogActor;
  now?: Date;
  /** The P&L hour gate's answer for G7 (ResourceControlsService.pendingHoursBlockingG7); absent in unit specs = nothing blocks. */
  pendingHoursBlockingG7?: (workspaceId: string, projectId: string) => Promise<PnlG7Blockers>;
}

type HookInput = { ctx: IssueLogContext; record: any; project: any };

/**
 * Side effects of a saved record. Each one is called with the committed record and may not throw into the request.
 * `sendLarkMessage` is assigned by the Lark integration (lark-hooks.ts).
 */
export const issueLogHooks: Record<string, (input: HookInput) => Promise<void>> = {
  /** V-26: a customer-side Blocker that stops progress — the Tạm dừng proposal itself comes from the status sync (status-proposal.ts). */
  async suggestProjectOnHold() {},
  /** TODO(7.5): Lark bot messages to the project's internal group (new record, severity change, escalation). Out of scope: in-app only for now. */
  async sendLarkMessage() {},
  /** V-31: in-app notification to the leaders an escalation goes to. */
  async notifyEscalation({ ctx, record, project }) {
    const leaders = await workspaceAdminUserIds(ctx);
    await notifyEvent(ctx, project, record, "escalated", leaders, "Vấn đề được chuyển cấp", `chuyển cấp tới ${record.escalationLevel === "dx_director" ? "Dx Director" : "BD Lead"}`);
  }
};

export async function runHooks(names: string[], input: HookInput) {
  for (const name of [...names, "sendLarkMessage"]) {
    try {
      await issueLogHooks[name]?.(input);
    } catch (error) {
      // The record is already saved; a failing side effect must not turn the request into an error — but it must not
      // vanish either: it goes on the record's history (and the audit trail), which the response and the screen show.
      console.error(`Issue log hook ${name} failed`, error);
      if (name === "sendLarkMessage") continue; // a message channel, with its own delivery log
      try {
        const at = input.ctx.now ?? new Date();
        const event = { action: "side_effect_failed", label: "Bước tự động chưa hoàn tất", note: `${name}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) };
        await writeEvent(input.ctx.prisma, { ...input.ctx, now: at }, input.record.id, event);
        if (Array.isArray(input.record.events)) input.record.events.push({ id: `side-effect-failed:${name}:${at.getTime()}`, ...event, changes: { label: event.label }, actorUserId: input.ctx.principal.subjectId, actorName: input.ctx.principal.displayName, at });
      } catch (recordError) {
        console.error(`Issue log hook ${name}: failure could not be recorded`, recordError);
      }
    }
  }
}

async function workspaceAdminUserIds(ctx: IssueLogContext): Promise<string[]> {
  if (typeof ctx.prisma.user?.findMany !== "function") return [];
  const users = await ctx.prisma.user.findMany({
    where: { status: "ACTIVE", roleBindings: { some: { workspaceId: ctx.principal.workspaceId, tenantKey: ctx.principal.tenantKey, role: { code: { in: [...WORKSPACE_ADMIN_ROLE_CODES] } } } } },
    select: { id: true }
  });
  return users.map((user: { id: string }) => user.id);
}

/** The project's PM for notifications: the PIC, i.e. the owner of its first stage. */
async function projectPicUserId(ctx: IssueLogContext, projectId: string): Promise<string | null> {
  if (typeof ctx.prisma.projectStage?.findFirst !== "function") return null;
  return projectPmUserId(ctx.prisma, ctx.principal.workspaceId, projectId);
}

async function notifyEvent(ctx: IssueLogContext, project: any, record: any, event: string, recipients: Array<string | null | undefined>, title: string, what: string) {
  const recipientUserIds = [...new Set(recipients.filter((id): id is string => Boolean(id) && id !== ctx.principal.subjectId))];
  if (!ctx.notifications?.notifyIssueLogEvent || !recipientUserIds.length) return;
  try {
    await ctx.notifications.notifyIssueLogEvent({
      workspaceId: ctx.principal.workspaceId, recipientUserIds, projectId: project.id, riskId: record.id, event, title,
      body: `${project.name} · ${ISSUE_LOG_TYPE_LABELS[record.type as IssueLogType]} ${record.code} ${what}: ${record.description}`
    });
  } catch (error) {
    console.error("Issue log notification failed", error);
  }
}

export async function notifyOwner(ctx: IssueLogContext, project: any, record: any, event: "created" | "reassigned") {
  if (!ctx.notifications || !record.ownerUserId || record.ownerUserId === ctx.principal.subjectId) return;
  try {
    await ctx.notifications.notifyProjectRiskOwner({
      workspaceId: ctx.principal.workspaceId, recipientUserId: record.ownerUserId, projectId: project.id, projectCode: project.code, projectName: project.name,
      riskId: record.id, riskCategory: `${ISSUE_LOG_TYPE_LABELS[record.type as IssueLogType]} ${record.code}`, riskDescription: record.description, event
    });
  } catch (error) {
    console.error("Project risk notification failed", error);
  }
}

async function resolveNotifications(ctx: IssueLogContext, riskId: string) {
  try {
    await ctx.notifications?.resolveProjectRiskNotifications(ctx.principal.workspaceId, riskId);
  } catch (error) {
    console.error("Project risk notification resolution failed", error);
  }
}

/** V-11: "Ngoại lệ chỉ Dx Director (Admin) duyệt"; Founder/GM and Workspace Admin hold every Admin right. */
const GATE_EXCEPTION_ROLE_CODES = new Set(["DX_DIRECTOR", "FOUNDER_GM", "WORKSPACE_ADMIN"]);
/** V-31: the leader who co-signs "Chấp nhận" (two PMs, or a PM and the PIC, used to be enough). */
const ACCEPT_LEADER_ROLE_CODES = new Set(["DX_DIRECTOR", "BD_LEAD", "FOUNDER_GM", "WORKSPACE_ADMIN"]);

export function issueLogActor(principal: PrincipalContext, permissions: { canManage: boolean; isMember: boolean }): IssueLogActor {
  const isAdmin = isWorkspaceAdmin(principal.roleCodes);
  // PM and BD Lead reach WORKSPACE_ADMIN only by implication, so the role actually bound decides (V-11).
  const canGrantGateException = (principal.heldRoleCodes ?? principal.roleCodes).some((code) => GATE_EXCEPTION_ROLE_CODES.has(code));
  return { userId: principal.subjectId, isAdmin, isPm: isAdmin || permissions.canManage, isBd: permissions.isMember && principal.roleCodes.includes("SALES_OWNER"), isMember: permissions.isMember, canGrantGateException,
    isLeader: (principal.heldRoleCodes ?? principal.roleCodes).some((code) => ACCEPT_LEADER_ROLE_CODES.has(code)) };
}

/** Next code of a type in a project. The counter row is locked by the upsert until the transaction commits and never decreases. */
export async function nextIssueLogCode(tx: any, projectId: string, type: IssueLogType): Promise<string> {
  const prefix = issueLogCode(type, 0).split("-")[0];
  const counter = await tx.projectRiskCounter.upsert({
    where: { projectId_prefix: { projectId, prefix } },
    create: { projectId, prefix, last: 1 },
    update: { last: { increment: 1 } }
  });
  return issueLogCode(type, counter.last);
}

const EVENT_LABELS: Record<string, string> = { created: "Ghi nhận bản ghi", updated: "Cập nhật thông tin", migrated: "Chuyển đổi dữ liệu", converted_from: "Tạo từ kết luận “Không phải CR”" /* history of rows written before 13/10/2026 */ };

function iso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : undefined;
}

export function mapIssueLogRecord(risk: any, actor: IssueLogActor, now = new Date()): ProjectRiskSummary {
  const type = risk.type as IssueLogType;
  const stored = readExtension(risk);
  const extension: IssueLogExtension = {};
  // A stored row of the retired Yêu cầu thay đổi type has no field catalogue: it maps with an empty extension.
  for (const def of ISSUE_LOG_EXTENSION_FIELDS[type] ?? []) {
    const value = def.key === "likelihood" || def.key === "response" ? risk[def.key] : stored[def.key];
    if (value !== undefined && value !== null && value !== "") extension[def.key] = value;
  }
  const open = isIssueLogOpen(risk.status) && isIssueLogType(type);
  const mayEdit = open && (actor.isPm || risk.ownerUserId === actor.userId || risk.createdByUserId === actor.userId);
  const history: IssueLogHistoryEntry[] = (risk.events ?? []).map((event: any) => ({
    id: event.id,
    action: event.action,
    label: EVENT_LABELS[event.action] ?? (event.changes as { label?: string } | null)?.label ?? event.action,
    fromStatus: event.fromStatus ?? undefined,
    toStatus: event.toStatus ?? undefined,
    note: event.note ?? undefined,
    actorUserId: event.actorUserId ?? undefined,
    actorDisplayName: event.actorName ?? undefined,
    at: new Date(event.at).toISOString()
  }));
  return {
    id: risk.id,
    accountId: risk.accountId,
    accountName: risk.account?.name ?? "",
    projectId: risk.projectId,
    projectName: risk.project?.name ?? "",
    code: risk.code,
    type,
    severity: risk.severity,
    milestoneId: risk.milestoneId ?? undefined,
    milestoneName: risk.milestone?.name ?? undefined,
    stageId: risk.stageId ?? undefined,
    stageName: risk.stage?.activity ?? undefined,
    taskId: risk.taskId ?? undefined,
    taskTitle: risk.task?.title ?? undefined,
    evidence: risk.evidence ?? undefined,
    nextStep: risk.nextStep ?? undefined,
    impactArea: risk.impactArea ?? undefined,
    escalationLevel: risk.escalationLevel ?? "none",
    escalatedAt: iso(risk.escalatedAt),
    resolutionEvidence: risk.resolutionEvidence ?? undefined,
    resolutionProposedAt: iso(risk.resolutionProposedAt),
    cancelReason: risk.cancelReason ?? undefined,
    closedAt: iso(risk.closedAt),
    extension,
    isOpen: open,
    ageDays: issueLogAgeDays(risk, now),
    dueState: issueLogDueState(risk, now),
    allowedActions: allowedActions(risk, actor),
    canEdit: mayEdit,
    history,
    // Legacy fields older screens still read.
    category: type === "blocker" ? "Blocker" : type === "risk" ? "Risk" : "Issue",
    description: risk.description,
    likelihood: risk.likelihood === "Low" || risk.likelihood === "High" ? risk.likelihood : "Medium",
    impact: risk.impact === "Low" || risk.impact === "High" ? risk.impact : "Medium",
    response: risk.response ?? "",
    switchTrigger: risk.switchTrigger ?? undefined,
    dueAt: iso(risk.dueAt),
    ownerUserId: risk.ownerUserId ?? undefined,
    ownerDisplayName: risk.owner?.displayName ?? undefined,
    status: risk.status as IssueLogStatus,
    createdByUserId: risk.createdByUserId ?? undefined,
    createdByDisplayName: risk.createdBy?.displayName ?? undefined,
    createdAt: iso(risk.createdAt) ?? now.toISOString(),
    updatedAt: iso(risk.updatedAt) ?? now.toISOString()
  };
}

/** Opens / refreshes the warnings the record should have and closes the ones it no longer should (BRI-01…03). */
export async function syncIssueLogWarnings(client: any, record: any, actorUserId: string | null, now = new Date()) {
  const wanted = issueLogWarnings(record, now);
  const wantedKeys = new Set(wanted.map((warning) => warning.dedupeKey));
  const stale = issueLogWarningKeys(record.id).filter((key) => !wantedKeys.has(key));
  const reason = isIssueLogOpen(record.status) ? "Điều kiện cảnh báo không còn" : `Bản ghi ${record.code}: ${ISSUE_LOG_STATUS_LABELS[record.status as IssueLogStatus] ?? record.status}`;
  await closeProjectWarnings(client, { projectId: record.projectId, dedupeKey: { in: stale } }, actorUserId, reason);
  // The condition is gone: a warning someone closed by hand may open again the next time it comes back (as NL-03).
  for (const key of stale) await rearmManuallyClosedWarning(client, record.projectId, key, actorUserId, "Điều kiện cảnh báo không còn");
  for (const warning of wanted) {
    if (await isWarningSuppressed(client, record.projectId, warning.dedupeKey)) continue;
    await openOrRefreshProjectWarning(client, {
      workspaceId: record.workspaceId, projectId: record.projectId, ...warning,
      milestoneId: record.milestoneId ?? null, stageId: record.stageId ?? null, taskId: record.taskId ?? null,
      ownerUserId: record.ownerUserId ?? null, dueAt: record.dueAt ?? null, actorUserId
    });
  }
}

/**
 * Overdue is a function of the clock, not of a write.
 * ponytail: the API has no scheduler, so this runs when a project's log is read; call it from the daily scan (7.5 "Quét đầu ngày") once one exists.
 */
export async function refreshProjectIssueLogWarnings(client: any, workspaceId: string, projectId: string, now = new Date()) {
  const open = await client.projectRisk.findMany({ where: { workspaceId, projectId, closedAt: null, type: { in: [...ISSUE_LOG_TYPES] } } });
  for (const record of open) {
    try {
      await syncIssueLogWarnings(client, record, null, now);
    } catch (error) {
      console.error("Issue log warning refresh failed", error);
    }
  }
}

/** A location must belong to the project; a task or stage fills in the levels above it. */
async function resolveLocation(tx: any, projectId: string, input: { milestoneId?: string | null; stageId?: string | null; taskId?: string | null }) {
  let { milestoneId = null, stageId = null, taskId = null } = input;
  if (taskId) {
    const task = await tx.projectTask.findFirst({ where: { id: taskId, projectId }, select: { stageId: true } });
    if (!task) throw new BadRequestException("Task không thuộc dự án này.");
    stageId = task.stageId ?? stageId;
  }
  if (stageId) {
    const stage = await tx.projectStage.findFirst({ where: { id: stageId, projectId }, select: { milestoneId: true } });
    if (!stage) throw new BadRequestException("Stage không thuộc dự án này.");
    milestoneId = stage.milestoneId ?? milestoneId;
  }
  if (milestoneId && !(await tx.projectMilestone.findFirst({ where: { id: milestoneId, projectId }, select: { id: true } }))) {
    throw new BadRequestException("Milestone không thuộc dự án này.");
  }
  return { milestoneId: milestoneId || null, stageId: stageId || null, taskId: taskId || null };
}

async function assertWorkspaceUser(tx: any, workspaceId: string, userId: string | null | undefined, label: string) {
  if (!userId || typeof tx.user?.findFirst !== "function") return;
  const user = await tx.user.findFirst({ where: { id: userId, roleBindings: { some: { workspaceId } } }, select: { id: true } });
  if (!user) throw new BadRequestException(`${label} không thuộc workspace.`);
}

async function writeEvent(tx: any, ctx: IssueLogContext, riskId: string, event: { action: string; label?: string; fromStatus?: string | null; toStatus?: string | null; note?: string; changes?: Record<string, unknown> }) {
  const { label, changes, ...rest } = event;
  await tx.projectRiskEvent.create({
    data: { riskId, ...rest, changes: label || changes ? { ...(changes ?? {}), ...(label ? { label } : {}) } : undefined, actorUserId: ctx.principal.subjectId, actorName: ctx.principal.displayName, at: ctx.now ?? new Date() }
  });
  // The same change in the workspace audit trail (Admin › Lịch sử, D-35).
  await tx.auditEvent?.create({
    data: { workspaceId: ctx.principal.workspaceId, actorUserId: ctx.principal.subjectId, action: `issue_log.${event.action}`, resource: "project_risk", resourceId: riskId, before: { status: event.fromStatus ?? null }, after: { status: event.toStatus ?? null, note: event.note ?? null, ...(changes ?? {}) }, requestId: randomUUID() }
  });
}

export async function createIssueLogRecord(ctx: IssueLogContext, project: any, input: CreateProjectRiskInput, extra: { tx?: any } = {}): Promise<any> {
  const { actor, principal } = ctx;
  const now = ctx.now ?? new Date();
  // V-23: every project member reports; nobody outside the project does.
  if (!actor.isMember && !actor.isPm) throw new ForbiddenException("Chỉ thành viên dự án mới được báo vấn đề vào sổ.");
  if ((input as { status?: unknown }).status && !["open", "pending"].includes(String((input as { status?: unknown }).status))) {
    throw new BadRequestException("Bản ghi mới luôn bắt đầu ở Chờ xử lý.");
  }
  const type = parseIssueLogType(input.type ?? input.category ?? "issue");
  const { extension, columns } = sanitizeExtension(type, { ...(input.likelihood ? { likelihood: input.likelihood } : {}), ...(input.response ? { response: input.response } : {}), ...(input.extension ?? {}) });
  if (type === "risk" && !columns.likelihood) columns.likelihood = "Medium";
  const draft = {
    type,
    status: INITIAL_ISSUE_LOG_STATUS,
    description: nonEmptyString(input.description, "description"),
    severity: parseIssueLogSeverity(input.severity ?? "medium"),
    evidence: optionalString(input.evidence, "evidence") ?? null,
    nextStep: optionalString(input.nextStep ?? input.switchTrigger, "nextStep") ?? null,
    impactArea: input.impactArea ? parseImpactArea(input.impactArea) : null,
    dueAt: optionalDate(input.dueAt, "dueAt") ?? null,
    ownerUserId: optionalString(input.ownerUserId, "ownerUserId") ?? null,
    likelihood: columns.likelihood ?? "Medium",
    response: columns.response ?? "",
    extension
  };
  assertRequiredOnCreate(type, draft);

  const write = async (tx: any) => {
    await assertWorkspaceUser(tx, principal.workspaceId, draft.ownerUserId, "Người chịu trách nhiệm");
    const location = await resolveLocation(tx, project.id, input);
    const code = await nextIssueLogCode(tx, project.id, type);
    const record = await tx.projectRisk.create({
      data: { workspaceId: principal.workspaceId, accountId: project.accountId, projectId: project.id, code, ...draft, ...location, createdByUserId: principal.subjectId },
      include: issueLogInclude
    });
    await writeEvent(tx, ctx, record.id, { action: "created", toStatus: record.status });
    await syncIssueLogWarnings(tx, record, principal.subjectId, now);
    return record;
  };
  const record = extra.tx ? await write(extra.tx) : await ctx.prisma.$transaction(write);
  if (extra.tx) return record;

  await notifyOwner(ctx, project, record, "created");
  // V-25: whatever a member logs reaches the PM, who classifies it.
  await notifyEvent(ctx, project, record, "created", [await projectPicUserId(ctx, project.id)], "Có bản ghi mới trong sổ vấn đề", "vừa được ghi nhận");
  await runHooks([], { ctx, record, project });
  return record;
}

const EDITABLE_LABELS: Record<string, string> = { description: "Mô tả", severity: "Mức ảnh hưởng", evidence: "Bằng chứng", nextStep: "Bước tiếp theo", impactArea: "Loại ảnh hưởng", dueAt: "Hạn xử lý", ownerUserId: "Người chịu trách nhiệm", milestoneId: "Milestone", stageId: "Stage", taskId: "Task", likelihood: "Khả năng xảy ra", response: "Phương án xử lý" };

function comparable(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

export async function updateIssueLogRecord(ctx: IssueLogContext, project: any, existing: any, input: UpdateProjectRiskInput): Promise<any> {
  const { actor, principal } = ctx;
  const now = ctx.now ?? new Date();
  if ((input as { status?: unknown }).status !== undefined && (input as { status?: unknown }).status !== existing.status) {
    throw new BadRequestException("Trạng thái chỉ đổi qua các bước chuyển của sổ, không sửa trực tiếp.");
  }
  if ((input as { type?: unknown }).type !== undefined && (input as { type?: unknown }).type !== existing.type) {
    throw new BadRequestException("Đổi loại bản ghi bằng thao tác Phân loại lại.");
  }
  if (!isIssueLogOpen(existing.status) || !isIssueLogType(existing.type)) throw new BadRequestException("Bản ghi đã kết thúc, không sửa được nữa.");
  if (!actor.isPm && existing.ownerUserId !== actor.userId && existing.createdByUserId !== actor.userId) {
    throw new ForbiddenException("Chỉ PM, người chịu trách nhiệm hoặc người báo mới được sửa bản ghi.");
  }
  const type = existing.type as IssueLogType;
  const { extension: extensionPatch, columns } = sanitizeExtension(type, { ...(input.likelihood ? { likelihood: input.likelihood } : {}), ...(input.response !== undefined ? { response: input.response } : {}), ...(input.extension ?? {}) });
  const patch: Record<string, unknown> = { ...columns };
  if (input.description !== undefined) patch.description = nonEmptyString(input.description, "description");
  if (input.severity !== undefined) patch.severity = parseIssueLogSeverity(input.severity);
  if (input.evidence !== undefined) patch.evidence = optionalString(input.evidence, "evidence") ?? null;
  if (input.nextStep !== undefined) patch.nextStep = optionalString(input.nextStep, "nextStep") ?? null;
  if (input.impactArea !== undefined) patch.impactArea = input.impactArea ? parseImpactArea(input.impactArea) : null;
  if (input.dueAt !== undefined) patch.dueAt = optionalDate(input.dueAt, "dueAt") ?? null;
  if (input.ownerUserId !== undefined) patch.ownerUserId = optionalString(input.ownerUserId, "ownerUserId") ?? null;
  if (patch.ownerUserId !== undefined && patch.ownerUserId !== existing.ownerUserId && !actor.isPm) throw new ForbiddenException("Chỉ PM mới được đổi người chịu trách nhiệm.");

  const record = await ctx.prisma.$transaction(async (tx: any) => {
    await assertWorkspaceUser(tx, principal.workspaceId, patch.ownerUserId as string | null | undefined, "Người chịu trách nhiệm");
    if (input.milestoneId !== undefined || input.stageId !== undefined || input.taskId !== undefined) {
      Object.assign(patch, await resolveLocation(tx, project.id, {
        milestoneId: input.milestoneId !== undefined ? input.milestoneId : existing.milestoneId,
        stageId: input.stageId !== undefined ? input.stageId : existing.stageId,
        taskId: input.taskId !== undefined ? input.taskId : existing.taskId
      }));
    }
    const extension = { ...readExtension(existing), ...extensionPatch };
    const changed = [
      ...Object.keys(patch).filter((key) => comparable(patch[key]) !== comparable(existing[key])).map((key) => EDITABLE_LABELS[key] ?? key),
      ...Object.keys(extensionPatch).filter((key) => extensionPatch[key] !== readExtension(existing)[key]).map((key) => ISSUE_LOG_EXTENSION_FIELDS[type].find((def) => def.key === key)?.label ?? key)
    ];
    assertRequiredOnCreate(type, { ...existing, ...patch, extension });
    const updated = await tx.projectRisk.update({ where: { id: existing.id }, data: { ...patch, extension }, include: issueLogInclude });
    if (changed.length) {
      const severityNote = patch.severity && patch.severity !== existing.severity ? ` (mức ảnh hưởng: ${ISSUE_LOG_SEVERITY_LABELS[existing.severity as keyof typeof ISSUE_LOG_SEVERITY_LABELS] ?? existing.severity} → ${ISSUE_LOG_SEVERITY_LABELS[updated.severity as keyof typeof ISSUE_LOG_SEVERITY_LABELS]})` : "";
      await writeEvent(tx, ctx, existing.id, { action: "updated", fromStatus: existing.status, toStatus: existing.status, note: `${changed.join(", ")}${severityNote}`, changes: { fields: [...new Set(changed)] } });
      updated.events = await tx.projectRiskEvent.findMany({ where: { riskId: existing.id }, orderBy: { at: "asc" } });
    }
    await syncIssueLogWarnings(tx, updated, principal.subjectId, now);
    return updated;
  });

  if (record.ownerUserId && record.ownerUserId !== existing.ownerUserId) {
    await resolveNotifications(ctx, record.id);
    await notifyOwner(ctx, project, record, "reassigned");
  }
  return record;
}

export async function transitionIssueLogRecord(ctx: IssueLogContext, project: any, existing: any, input: IssueLogTransitionInput): Promise<any> {
  const { principal } = ctx;
  const now = ctx.now ?? new Date();
  const plan = planTransition(existing, ctx.actor, input, now);

  const record = await ctx.prisma.$transaction(async (tx: any) => {
    await assertWorkspaceUser(tx, principal.workspaceId, plan.data.ownerUserId as string | undefined, "Người chịu trách nhiệm");
    const data: Record<string, unknown> = { ...plan.data, extension: plan.extension };
    let note = plan.note;
    if (plan.newType) {
      // The old code stays in the history and is never handed out again.
      data.type = plan.newType;
      data.code = await nextIssueLogCode(tx, project.id, plan.newType);
      note = `${existing.code} → ${data.code} (${ISSUE_LOG_TYPE_LABELS[existing.type as IssueLogType]} → ${ISSUE_LOG_TYPE_LABELS[plan.newType]})${note ? `. ${note}` : ""}`;
    }
    // Guard against two people moving the same record at once: only the state we validated may be replaced.
    const claimed = await tx.projectRisk.updateMany({ where: { id: existing.id, status: existing.status }, data });
    if (claimed.count !== 1) throw new BadRequestException("Bản ghi vừa được người khác cập nhật. Tải lại và thử lại.");
    await writeEvent(tx, ctx, existing.id, { action: plan.action, label: plan.label, fromStatus: existing.status, toStatus: plan.toStatus, note });
    const updated = await tx.projectRisk.findFirst({ where: { id: existing.id }, include: issueLogInclude });
    await syncIssueLogWarnings(tx, updated, principal.subjectId, now);
    return updated;
  });

  if (!isIssueLogOpen(record.status)) await resolveNotifications(ctx, record.id);
  else if (record.ownerUserId && record.ownerUserId !== existing.ownerUserId) await notifyOwner(ctx, project, record, "reassigned");
  if (plan.action === "propose_resolve") {
    await notifyEvent(ctx, project, record, "resolution_proposed", [await projectPicUserId(ctx, project.id)], "Vấn đề chờ PM xác nhận đã xử lý", "được báo đã xử lý");
  }
  if (plan.action === "accept" && record.status !== "accepted") {
    await notifyEvent(ctx, project, record, "accept_pending", [...(await workspaceAdminUserIds(ctx)), await projectPicUserId(ctx, project.id)], "Vấn đề chờ đồng ý Chấp nhận", "được đề nghị Chấp nhận");
  }
  await runHooks(plan.hooks, { ctx, record, project });
  return record;
}

export async function loadIssueLogRecord(prisma: any, workspaceId: string, projectId: string, riskId: string) {
  const record = await prisma.projectRisk.findFirst({ where: { id: riskId, projectId, workspaceId }, include: issueLogInclude });
  if (!record) throw new NotFoundException("Project risk not found");
  return record;
}
