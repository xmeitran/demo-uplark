/**
 * Rules of the issue log ("Sổ vấn đề": 5.4, V-23…V-26, V-31) — three types: Blocker, Risk, Issue. Yêu cầu thay đổi is not
 * recorded in the system any more (chốt 13/10); rows of that retired type stay in the table, read-only and unlisted.
 * Pure: no database access.
 * Persistence, warnings and notifications are in issue-log.service.ts.
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  ISSUE_LOG_CODE_PREFIX,
  ISSUE_LOG_EXTENSION_FIELDS,
  ISSUE_LOG_IMPACT_AREAS,
  ISSUE_LOG_SEVERITIES,
  ISSUE_LOG_STATUS_LABELS,
  ISSUE_LOG_TYPE_LABELS,
  ISSUE_LOG_TYPES,
  escalationLevelForImpactArea,
  isIssueLogOpen,
  issueLogFieldDef,
  type IssueLogAllowedAction,
  type IssueLogDueState,
  type IssueLogExtension,
  type IssueLogFieldDef,
  type IssueLogImpactArea,
  type IssueLogSeverity,
  type IssueLogStatus,
  type IssueLogTransitionInput,
  type IssueLogType
} from "@b2b-crm/contracts";
import { localDateKey } from "../../shared/working-days";

/**
 * Who is acting, in the document's roles mapped onto what the service already knows:
 * PM = project manager (PIC / project Delivery Lead / Founder-GM) or workspace admin;
 * Dx Director and BD Lead (the "Admin" leaders) = workspace admin roles (FOUNDER_GM, WORKSPACE_ADMIN);
 * BD phụ trách dự án = a SALES_OWNER who is a project member; member = project member.
 */
export interface IssueLogActor {
  userId: string;
  isAdmin: boolean;
  isPm: boolean;
  isBd: boolean;
  isMember: boolean;
  /** V-11: holds Dx Director (or Founder/GM, Workspace Admin) itself — not through PM / BD Lead. Absent = same as isAdmin. */
  canGrantGateException?: boolean;
}

export interface IssueLogRecordState {
  id?: string;
  code?: string;
  type: string;
  status: string;
  severity?: string;
  ownerUserId?: string | null;
  createdByUserId?: string | null;
  dueAt?: Date | null;
  createdAt?: Date;
  closedAt?: Date | null;
  impactArea?: string | null;
  likelihood?: string | null;
  response?: string | null;
  resolutionEvidence?: string | null;
  resolutionProposedAt?: Date | null;
  acceptPmUserId?: string | null;
  acceptLeaderUserId?: string | null;
  extension?: unknown;
}

/** Extension keys kept in their own (pre-existing) columns instead of the JSON document. */
const COLUMN_BACKED_KEYS = new Set(["likelihood", "response"]);
const LEGACY_RISK_CATEGORIES = new Set(["financial", "operational", "external", "strategic"]);

export function issueLogCode(type: IssueLogType, running: number) {
  return `${ISSUE_LOG_CODE_PREFIX[type]}-${String(running).padStart(3, "0")}`;
}

/** Accepts the canonical type or a legacy category label; anything else is rejected. */
export function parseIssueLogType(value: unknown): IssueLogType {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ISSUE_LOG_TYPES as readonly string[]).includes(key)) return key as IssueLogType;
  if (LEGACY_RISK_CATEGORIES.has(key)) return "risk";
  throw new BadRequestException("Loại bản ghi phải là Blocker, Risk hoặc Issue.");
}

export function parseIssueLogSeverity(value: unknown): IssueLogSeverity {
  const key = String(value ?? "").trim().toLowerCase();
  if ((ISSUE_LOG_SEVERITIES as readonly string[]).includes(key)) return key as IssueLogSeverity;
  throw new BadRequestException("Mức ảnh hưởng phải là Thấp, Trung bình, Cao hoặc Nghiêm trọng.");
}

export function parseImpactArea(value: unknown): IssueLogImpactArea {
  if ((ISSUE_LOG_IMPACT_AREAS as readonly string[]).includes(String(value))) return value as IssueLogImpactArea;
  throw new BadRequestException("Loại ảnh hưởng không hợp lệ.");
}

function isBlank(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function coerceField(def: IssueLogFieldDef, raw: unknown): string | number | null {
  if (isBlank(raw)) return null;
  if (def.kind === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new BadRequestException(`${def.label}: phải là số.`);
    return value;
  }
  const text = String(raw).trim();
  if (def.kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}/.test(text) || Number.isNaN(Date.parse(text))) throw new BadRequestException(`${def.label}: ngày không hợp lệ.`);
    return text.slice(0, 10);
  }
  if (def.kind === "select" && !def.options?.some((option) => option.value === text)) throw new BadRequestException(`${def.label}: giá trị không hợp lệ.`);
  return text;
}

/**
 * Keeps only the fields the type defines, coerced to their kind. Unknown keys are dropped; system-computed
 * fields cannot be typed in.
 */
export function sanitizeExtension(type: IssueLogType, input: unknown): { extension: IssueLogExtension; columns: { likelihood?: string; response?: string } } {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const extension: IssueLogExtension = {};
  const columns: { likelihood?: string; response?: string } = {};
  for (const def of ISSUE_LOG_EXTENSION_FIELDS[type]) {
    if (!(def.key in source) || def.auto) continue;
    const value = coerceField(def, source[def.key]);
    if (COLUMN_BACKED_KEYS.has(def.key)) columns[def.key as "likelihood" | "response"] = value === null ? (def.key === "response" ? "" : undefined) : String(value);
    else extension[def.key] = value;
  }
  return { extension, columns };
}

export function readExtension(record: IssueLogRecordState): IssueLogExtension {
  return record.extension && typeof record.extension === "object" && !Array.isArray(record.extension) ? (record.extension as IssueLogExtension) : {};
}

/** Current value of a field key, wherever it is stored. */
export function fieldValue(record: IssueLogRecordState, key: string): unknown {
  if (key === "likelihood" || key === "response" || key === "ownerUserId" || key === "resolutionEvidence" || key === "impactArea") return record[key];
  return readExtension(record)[key];
}

/** V-24: the fields a type must have when it is created (or when a record is classified into it). */
export function missingRequiredOnCreate(type: IssueLogType, record: IssueLogRecordState): IssueLogFieldDef[] {
  return ISSUE_LOG_EXTENSION_FIELDS[type].filter((def) => def.requiredOnCreate && isBlank(fieldValue(record, def.key)));
}

export function assertRequiredOnCreate(type: IssueLogType, record: IssueLogRecordState) {
  const missing = missingRequiredOnCreate(type, record);
  if (missing.length) throw new BadRequestException(`${ISSUE_LOG_TYPE_LABELS[type]} bắt buộc có: ${missing.map((def) => def.label).join(", ")}.`);
}

export const INITIAL_ISSUE_LOG_STATUS: IssueLogStatus = "pending";

function isOwner(record: IssueLogRecordState, actor: IssueLogActor) {
  return Boolean(record.ownerUserId) && record.ownerUserId === actor.userId;
}

/** The transitions this actor may run on this record right now, with the fields each one asks for. */
export function allowedActions(record: IssueLogRecordState, actor: IssueLogActor): IssueLogAllowedAction[] {
  const actions: IssueLogAllowedAction[] = [];
  const status = record.status;
  if (status === "cancelled") return actions;

  // A row of a type the log no longer has (the retired Yêu cầu thay đổi) is history: nobody acts on it.
  if (!isIssueLogType(record.type)) return actions;
  {
    if (status === "pending") {
      if (actor.isPm || isOwner(record, actor)) actions.push({ action: "start", label: "Bắt đầu xử lý", requires: ["ownerUserId"], tone: "primary" });
      if (actor.isPm) actions.push({ action: "reclassify", label: "Phân loại lại", requires: ["targetType"], optional: ["note"], tone: "neutral" });
    }
    if (status === "in_progress") {
      if (isOwner(record, actor) && !record.resolutionProposedAt) {
        actions.push({ action: "propose_resolve", label: "Báo đã xử lý (chờ PM xác nhận)", requires: ["resolutionEvidence"], tone: "primary" });
      }
      if (actor.isPm) {
        actions.push({ action: "resolve", label: "PM xác nhận Đã xử lý", requires: ["resolutionEvidence"], tone: "primary" });
        if (record.acceptPmUserId !== actor.userId && record.acceptLeaderUserId !== actor.userId) {
          actions.push({ action: "accept", label: "Chấp nhận (cần PM và Dx Director/BD Lead)", requires: ["note", "impactArea"], tone: "neutral" });
        }
      }
    }
    if ((status === "pending" || status === "in_progress") && (actor.isPm || isOwner(record, actor))) {
      actions.push({ action: "escalate", label: "Chuyển cấp", requires: ["impactArea", "note"], tone: "neutral" });
    }
  }
  if (actor.isAdmin) actions.push({ action: "cancel", label: "Huỷ bản ghi", requires: ["note"], tone: "danger" });
  return actions;
}

export interface IssueLogTransitionPlan {
  action: string;
  label: string;
  /** Column values to write (status, step, evidence…); `extension` is the full merged document. */
  data: Record<string, unknown>;
  extension: IssueLogExtension;
  toStatus: IssueLogStatus;
  note?: string;
  /** Set when the record gets a new type: it needs a new code. */
  newType?: IssueLogType;
  /** Named side effects the service runs after commit (see issueLogHooks). */
  hooks: string[];
}

const FINAL_STATUSES: readonly string[] = ["resolved", "accepted", "cancelled"];

/**
 * Validates one transition (allowed from this state, by this actor, with its mandatory fields) and returns what to write.
 * Throws 403 when the actor may not run it and 400 when it is not available or a mandatory field is missing.
 */
export function planTransition(record: IssueLogRecordState, actor: IssueLogActor, input: IssueLogTransitionInput, now = new Date()): IssueLogTransitionPlan {
  const action = String(input?.action ?? "").trim();
  const type = record.type as IssueLogType;
  const allowed = allowedActions(record, actor).find((candidate) => candidate.action === action);
  if (!allowed) {
    // Tell "not yours to do" apart from "not possible from here".
    const everyone: IssueLogActor = { userId: record.ownerUserId ?? actor.userId, isAdmin: true, isPm: true, isBd: true, isMember: true };
    if (allowedActions(record, everyone).some((candidate) => candidate.action === action)) {
      throw new ForbiddenException(action === "cancel" ? "Chỉ Admin mới được huỷ bản ghi trong sổ." : "Bạn không có quyền thực hiện bước này.");
    }
    throw new BadRequestException(`Không thể thực hiện "${action}" khi bản ghi đang ở trạng thái ${ISSUE_LOG_STATUS_LABELS[record.status as IssueLogStatus] ?? record.status}.`);
  }

  // A reclassification carries the fields of the type the record becomes.
  const { extension: extensionPatch, columns } = sanitizeExtension(action === "reclassify" && !isBlank(input.targetType) ? parseIssueLogType(input.targetType) : type, input.extension);
  const extension = { ...readExtension(record), ...extensionPatch };
  const data: Record<string, unknown> = { ...columns };
  const note = isBlank(input.note) ? undefined : String(input.note).trim();
  if (!isBlank(input.ownerUserId)) data.ownerUserId = String(input.ownerUserId).trim();
  if (!isBlank(input.resolutionEvidence)) data.resolutionEvidence = String(input.resolutionEvidence).trim();
  if (!isBlank(input.impactArea)) data.impactArea = parseImpactArea(input.impactArea);

  const merged: IssueLogRecordState = { ...record, ...data, extension };
  const missing = allowed.requires.filter((key) => {
    if (key === "note") return !note;
    if (key === "targetType") return isBlank(input.targetType);
    return isBlank(fieldValue(merged, key));
  });
  if (missing.length) {
    throw new BadRequestException(`Bước "${allowed.label}" bắt buộc có: ${missing.map((key) => issueLogFieldDef(type, key)?.label ?? key).join(", ")}.`);
  }

  const plan: IssueLogTransitionPlan = { action, label: allowed.label, data, extension, toStatus: record.status as IssueLogStatus, note, hooks: [] };

  switch (action) {
    case "start":
      plan.toStatus = "in_progress";
      break;
    case "propose_resolve":
      data.resolutionProposedAt = now;
      break;
    case "resolve":
      plan.toStatus = "resolved";
      break;
    case "accept": {
      // V-31: two people, the PM and a leader (Dx Director / BD Lead). An admin fills the leader seat first.
      const leaderSeat = actor.isAdmin && !record.acceptLeaderUserId;
      if (leaderSeat) data.acceptLeaderUserId = actor.userId;
      else data.acceptPmUserId = actor.userId;
      const pm = leaderSeat ? record.acceptPmUserId : actor.userId;
      const leader = leaderSeat ? actor.userId : record.acceptLeaderUserId;
      if (pm && leader && pm !== leader) plan.toStatus = "accepted";
      else plan.label = leaderSeat ? "Leader đồng ý Chấp nhận, chờ PM xác nhận" : "PM đề nghị Chấp nhận, chờ Dx Director/BD Lead";
      break;
    }
    case "escalate":
      data.escalationLevel = escalationLevelForImpactArea(merged.impactArea as IssueLogImpactArea);
      data.escalatedAt = now;
      plan.hooks.push("notifyEscalation");
      break;
    case "reclassify": {
      const target = parseIssueLogType(input.targetType);
      if (target === type) throw new BadRequestException("Bản ghi đã thuộc loại này.");
      assertRequiredOnCreate(target, merged);
      plan.newType = target;
      plan.toStatus = "pending";
      // V-26: a Blocker on the customer's side proposes Tạm dừng when it stops progress.
      if (target === "blocker" && extension.causeSide === "customer") plan.hooks.push("suggestProjectOnHold");
      break;
    }
    case "cancel":
      plan.toStatus = "cancelled";
      data.cancelReason = note;
      break;
  }

  if (FINAL_STATUSES.includes(plan.toStatus)) data.closedAt = now;
  data.status = plan.toStatus;
  return plan;
}

/** "Tình trạng hạn": Chưa đặt hạn, Trong hạn, Quá hạn — against the record's due date. */
export function issueLogDueState(record: IssueLogRecordState, now = new Date()): IssueLogDueState {
  const due = record.dueAt;
  if (!due) return "no_due";
  return localDateKey(record.closedAt ?? now) > localDateKey(new Date(due)) ? "overdue" : "on_time";
}

/** "Tuổi (ngày)": calendar days since the record was reported, frozen when it closes. */
export function issueLogAgeDays(record: IssueLogRecordState, now = new Date()): number {
  if (!record.createdAt) return 0;
  return Math.max(0, Math.floor(((record.closedAt ?? now).getTime() - new Date(record.createdAt).getTime()) / 86_400_000));
}

/** One of the log's three types; false for a stored row of the retired Yêu cầu thay đổi type. */
export function isIssueLogType(value: unknown): value is IssueLogType {
  return (ISSUE_LOG_TYPES as readonly unknown[]).includes(value);
}

/** 5.1: an open Blocker, Risk or Issue makes a project "Có rủi ro". */
export function countsTowardProjectAtRisk(record: Pick<IssueLogRecordState, "type" | "status">): boolean {
  return isIssueLogType(record.type) && isIssueLogOpen(record.status);
}

export interface IssueLogWarning {
  dedupeKey: string;
  typeCode: "BRI-01" | "BRI-02" | "BRI-03";
  title: string;
  detail?: string;
  severity: string;
}

/** Every warning key a record can ever hold, so the ones no longer wanted can be closed. */
export function issueLogWarningKeys(recordId: string): string[] {
  return [`BRI-01:${recordId}`, `BRI-02:${recordId}`, `BRI-03:${recordId}`];
}

/** The warnings a record should have open right now (7.5: BRI-01, BRI-02, BRI-03). */
export function issueLogWarnings(record: IssueLogRecordState & { id: string; code: string; description?: string }, now = new Date()): IssueLogWarning[] {
  if (!isIssueLogOpen(record.status) || !isIssueLogType(record.type)) return [];
  const name = `${ISSUE_LOG_TYPE_LABELS[record.type as IssueLogType] ?? record.type} ${record.code}`;
  const overdue = issueLogDueState(record, now) === "overdue";
  const warnings: IssueLogWarning[] = [{ dedupeKey: `BRI-01:${record.id}`, typeCode: "BRI-01", title: `Có ${name} đang mở`, detail: record.description, severity: record.severity === "critical" ? "high" : "medium" }];
  if (overdue) warnings.push({ dedupeKey: `BRI-02:${record.id}`, typeCode: "BRI-02", title: `${name} quá hạn xử lý`, detail: record.description, severity: "high" });
  if (record.severity === "critical" || record.impactArea === "customer_commitment") {
    warnings.push({ dedupeKey: `BRI-03:${record.id}`, typeCode: "BRI-03", title: `${name}: mức ảnh hưởng cao nhất hoặc ảnh hưởng cam kết với khách`, detail: record.description, severity: "high" });
  }
  return warnings;
}
