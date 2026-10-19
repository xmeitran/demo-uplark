/**
 * Rules of the stage gates G1–G8 (7.2 V-11…V-16, 8.1). Pure: no persistence here (gates.service.ts does that).
 * The catalogue itself is PROJECT_GATE_CATALOGUE in @b2b-crm/contracts.
 *
 * Roles are the ones the issue log already maps (issue-log.ts IssueLogActor): PM = project manager or workspace admin,
 * Dx Director = workspace admin, BD = SALES_OWNER who is a project member, preparer = any project member.
 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import {
  gatePaymentText,
  PROJECT_GATE_ACTIONS,
  PROJECT_GATE_ACTION_LABELS,
  PROJECT_GATE_CATALOGUE,
  type PnlG7Blockers,
  type ProjectGatePnlPendingCheck,
  type ProjectGateAction,
  type ProjectGateActionInput,
  type ProjectGateCode,
  type ProjectGateDefinition,
  type ProjectGateHistoryEntry,
  type ProjectGateStatus
} from "@b2b-crm/contracts";
import type { IssueLogActor } from "./issue-log";

export interface GateState {
  code: string;
  status: string;
  submittedByUserId?: string | null;
  paymentConfirmedAt?: Date | null;
  goLiveDate?: Date | null;
}

/** What the service reads from the database before a decision. */
export interface GateFacts {
  /** The preceding gate is approved or opened by exception (always true for G1). */
  reachable: boolean;
  documents: ReadonlyArray<{ type: string; present: boolean }>;
  /** Tasks of the closing stage(s) that are neither done nor cancelled. */
  openTaskCount: number;
  /** Loại Khách hàng: the only kind with a Giá trị dự án and payment confirmations (Nội bộ / Đào tạo need neither). */
  chargeable: boolean;
  /** G1 (D-22): Giá trị dự án has been entered on the project P&L screen. */
  projectValueReady: boolean;
  /** G7, G8: open Blocker/Risk/Issue records without an owner or a due date. */
  openIssuesWithoutOwnerOrDue: number;
  /** G7: hours "Chờ xử lý" for a missing / wrong classification (never cost-rate waits). */
  pnlPending?: ProjectGatePnlPendingCheck;
}

export interface GateRequirement {
  text: string;
  /** A conditional approval (V-13) may carry it over as an outstanding item in the issue log. */
  waivable: boolean;
}

export function gateDefinition(code: string): ProjectGateDefinition {
  const definition = PROJECT_GATE_CATALOGUE[code as ProjectGateCode];
  if (!definition) throw new BadRequestException(`Điểm chốt không hợp lệ: ${code}.`);
  return definition;
}

/** Approved, or opened by the audited exception: the next stage may start. */
export function isGatePassed(status: unknown): boolean {
  return status === "approved" || status === "exception";
}

/**
 * "G1 đã duyệt" and "mốc đóng P&L đã qua" of any project. On G1–G8 the gate rows answer. A project on hand-built
 * milestones has no gate rows and follows its own milestones, exactly as its status does (status-proposal.ts,
 * positionStatus): G1 = the first milestone is approved, the closing point = every milestone is approved.
 */
export function projectGatePosition(
  gates: ReadonlyArray<{ code: string; status: string }>,
  milestones: ReadonlyArray<{ sortOrder: number; gateStatus?: string | null }>,
  closeGate = "G7"
): { g1Passed: boolean; closePassed: boolean } {
  if (gates.length) {
    const passed = (code: string) => isGatePassed(gates.find((gate) => gate.code === code)?.status);
    return { g1Passed: passed("G1"), closePassed: passed(closeGate) };
  }
  const ordered = [...milestones].sort((left, right) => left.sortOrder - right.sortOrder);
  const approved = (milestone: { gateStatus?: string | null }) => milestone.gateStatus === "approved";
  return { g1Passed: ordered.length > 0 && approved(ordered[0]), closePassed: ordered.length > 0 && ordered.every(approved) };
}

function normalizeType(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("vi");
}

/** V-11: required documents are checked by TYPE. A document counts when it has a usable latest version. */
export function gateDocumentTicks(definition: ProjectGateDefinition, documents: ReadonlyArray<{ artifactType?: string | null; name?: string | null; usable: boolean }>) {
  return definition.requiredDocumentTypes.map((type) => {
    const match = documents.find((document) => document.usable && normalizeType(document.artifactType) === normalizeType(type));
    return { type, present: Boolean(match), ...(match?.name ? { documentName: match.name } : {}) };
  });
}

/** The gate a stage has to wait for: the nearest gate on an EARLIER stage that is not passed yet (V-11). */
export function blockingGateForStage<T extends { stageId: string; status: string }>(orderedStageIds: readonly string[], gates: readonly T[], stageId: string): T | null {
  const index = orderedStageIds.indexOf(stageId);
  for (let position = index - 1; position >= 0; position -= 1) {
    const gate = gates.find((item) => item.stageId === orderedStageIds[position]);
    if (gate) return isGatePassed(gate.status) ? null : gate;
  }
  return null;
}

const NOT_STARTED_STAGE_STATUSES = new Set(["", "not_started", "todo", "planned", "planning", "upcoming"]);

/** A stage status that means work on it has begun (or finished). */
export function isStartedStageStatus(status: unknown): boolean {
  return !NOT_STARTED_STAGE_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function stageBlockedMessage(gate: { code: string }, action: string) {
  const definition = PROJECT_GATE_CATALOGUE[gate.code as ProjectGateCode];
  return `Điểm chốt ${gate.code}${definition ? ` (${definition.name})` : ""} chưa được duyệt nên chưa thể ${action}. Nộp và duyệt hồ sơ chuyển tiếp ở tab Điểm chốt & Tài liệu, hoặc Dx Director mở theo ngoại lệ có lý do.`;
}

/** Everything still standing between the gate and a plain approval. */
export function gateRequirements(definition: ProjectGateDefinition, state: GateState, facts: GateFacts): GateRequirement[] {
  const requirements: GateRequirement[] = [];
  const missingDocuments = facts.documents.filter((document) => !document.present).map((document) => document.type);
  if (missingDocuments.length) requirements.push({ text: `Thiếu tài liệu bắt buộc: ${missingDocuments.join(", ")}.`, waivable: false });
  if (facts.openTaskCount > 0) requirements.push({ text: `Còn ${facts.openTaskCount} task của stage chưa hoàn thành hoặc chưa được chuyển có lý do.`, waivable: true });
  if (definition.paymentConfirmation && facts.chargeable && !state.paymentConfirmedAt) requirements.push({ text: `PM chưa xác nhận ${gatePaymentText(definition.code)} theo thông tin từ BD.`, waivable: false });
  if (definition.code === "G1" && facts.chargeable && !facts.projectValueReady) requirements.push({ text: "Chưa nhập Giá trị dự án (màn P&L dự án, ô Doanh thu).", waivable: false });
  if ((definition.code === "G7" || definition.code === "G8") && facts.openIssuesWithoutOwnerOrDue > 0) {
    requirements.push({ text: `Còn ${facts.openIssuesWithoutOwnerOrDue} vấn đề đang mở chưa có người chịu trách nhiệm hoặc hạn.`, waivable: false });
  }
  if (definition.goLiveDate && !state.goLiveDate) requirements.push({ text: "Chưa có ngày Go-live.", waivable: false });
  if (definition.code === "G7" && facts.pnlPending?.blocked) requirements.push({ text: g7PendingHoursMessage(facts.pnlPending), waivable: false });
  return requirements;
}

const DECISION_ACTIONS: readonly ProjectGateAction[] = ["approve", "approve_conditional", "reject"];

/** V-11: only the Dx Director (Founder/GM and Workspace Admin stand in) opens a gate by exception — a PM does not. */
export function canGrantGateException(actor: Pick<IssueLogActor, "isAdmin" | "canGrantGateException">): boolean {
  return actor.canGrantGateException ?? actor.isAdmin;
}

/** Why the actor cannot take the action in the gate's current state; null when they can. Input fields are checked by planGateAction. */
export function gateActionBlocker(definition: ProjectGateDefinition, state: GateState, facts: Pick<GateFacts, "reachable"> & Partial<Pick<GateFacts, "chargeable">>, actor: IssueLogActor, action: ProjectGateAction): { kind: "state" | "role"; message: string } | null {
  const status = state.status as ProjectGateStatus;
  const state_ = (message: string) => ({ kind: "state" as const, message });
  const role = (message: string) => ({ kind: "role" as const, message });
  if (isGatePassed(status)) return state_(`Điểm chốt ${definition.code} đã được mở, không còn thao tác.`);
  if (!facts.reachable) return state_(`Điểm chốt trước ${definition.code} chưa được duyệt.`);

  if (action === "submit") {
    if (status !== "not_submitted" && status !== "rejected") return state_("Hồ sơ đã nộp và đang chờ kết quả.");
    // G7: the PM prepares the acceptance minutes (chốt 11/10 #8). Elsewhere every project member may prepare (User).
    if (definition.preparerMayApprove ? !actor.isPm : !actor.isMember && !actor.isPm) return role(`Chỉ ${definition.preparedBy} của dự án mới được nộp hồ sơ ${definition.code}.`);
    return null;
  }
  if (DECISION_ACTIONS.includes(action)) {
    // A customer who refuses is recorded as a rejection, so reject also works while waiting for the customer.
    if (status !== "submitted" && !(action === "reject" && status === "awaiting_customer")) return state_("Chỉ duyệt hoặc từ chối hồ sơ đang chờ duyệt.");
    if (!actor.isPm && !(definition.bdMayApprove && actor.isBd)) return role(`Chỉ ${definition.approvedBy} (Admin) mới được duyệt ${definition.code}.`);
    // V-12: preparer and approver are two different people, except the acceptance minutes at G7.
    if (!definition.preparerMayApprove && state.submittedByUserId && state.submittedByUserId === actor.userId) {
      return role("Người chuẩn bị và người duyệt phải là hai người khác nhau (V-12).");
    }
    return null;
  }
  if (action === "confirm_payment") {
    if (!definition.paymentConfirmation) return state_(`${definition.code} không có bước xác nhận thu tiền.`);
    if (facts.chargeable === false) return state_("Dự án Loại Nội bộ, Đào tạo không có bước xác nhận thu tiền.");
    if (state.paymentConfirmedAt) return state_(`Đã xác nhận ${gatePaymentText(definition.code)}.`);
    if (!actor.isPm) return role(`Chỉ PM (Admin) mới được xác nhận ${gatePaymentText(definition.code)}.`);
    return null;
  }
  if (action === "confirm_customer") {
    if (status !== "awaiting_customer") return state_("Chỉ ghi nhận khách xác nhận sau khi PM đã duyệt nội bộ.");
    if (!actor.isPm && !actor.isBd) return role("Chỉ PM hoặc BD của dự án mới được ghi nhận xác nhận của khách.");
    return null;
  }
  if (action === "exception") {
    // V-11: "Ngoại lệ chỉ Dx Director (Admin) duyệt, có lý do."
    if (!canGrantGateException(actor)) return role("Chỉ Dx Director (Admin) mới được mở điểm chốt theo ngoại lệ.");
    return null;
  }
  return state_("Thao tác không hợp lệ.");
}

export function allowedGateActions(definition: ProjectGateDefinition, state: GateState, facts: Pick<GateFacts, "reachable"> & Partial<Pick<GateFacts, "chargeable">>, actor: IssueLogActor): ProjectGateAction[] {
  return PROJECT_GATE_ACTIONS.filter((action) => gateActionBlocker(definition, state, facts, actor, action) === null);
}

export interface GatePlan {
  toStatus: ProjectGateStatus;
  /** Column values to write on the ProjectGate row. */
  patch: Record<string, unknown>;
  history: ProjectGateHistoryEntry;
  /** The gate is now approved / opened by exception: unlock what comes next and recompute the project status. */
  passed: boolean;
  /** V-14 / V-19: start (true) or end (false) the customer wait; undefined = unchanged. */
  customerWait?: boolean;
  /** V-13: the outstanding part of a conditional approval, to be created as an Issue. */
  conditionIssue?: { description: string; ownerUserId: string; dueAt: string };
}

function required(value: unknown, message: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new BadRequestException(message);
  return text;
}

function parseDay(value: unknown, label: string): Date {
  const text = String(value ?? "").trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text);
  if (!text || Number.isNaN(date.getTime())) throw new BadRequestException(`${label}: ngày không hợp lệ.`);
  return date;
}

/**
 * Validates one action and returns what to write. Throws 403 for the wrong role, 409 for the wrong state and
 * 400 for a missing mandatory field or an unmet requirement.
 */
export function planGateAction(
  definition: ProjectGateDefinition,
  state: GateState,
  facts: GateFacts,
  actor: IssueLogActor & { displayName?: string | null },
  input: ProjectGateActionInput,
  now = new Date()
): GatePlan {
  const action = input.action;
  if (!PROJECT_GATE_ACTIONS.includes(action)) throw new BadRequestException("Thao tác điểm chốt không hợp lệ.");
  const blocker = gateActionBlocker(definition, state, facts, actor, action);
  if (blocker) throw blocker.kind === "role" ? new ForbiddenException(blocker.message) : new ConflictException(blocker.message);

  const fromStatus = state.status as ProjectGateStatus;
  const entry = (toStatus: ProjectGateStatus, note?: string): ProjectGateHistoryEntry => ({
    at: now.toISOString(), action, label: PROJECT_GATE_ACTION_LABELS[action], byUserId: actor.userId, byName: actor.displayName ?? null, fromStatus, toStatus, ...(note ? { note } : {})
  });
  const goLiveDate = input.goLiveDate !== undefined && definition.goLiveDate ? parseDay(input.goLiveDate, "Ngày Go-live") : undefined;
  const withGoLive = goLiveDate ? { goLiveDate } : {};
  const requirements = gateRequirements(definition, { ...state, goLiveDate: goLiveDate ?? state.goLiveDate }, facts);
  const fail = (items: GateRequirement[], hint = "") => new BadRequestException({ message: `Chưa đủ điều kiện ${definition.code}. ${items.map((item) => item.text).join(" ")}${hint}`, missingRequirements: items.map((item) => item.text) });

  if (action === "submit") {
    // V-11: a submission must carry every required document; the rest is judged by the approver.
    const missingDocuments = requirements.filter((item) => item.text.startsWith("Thiếu tài liệu"));
    if (missingDocuments.length) throw fail(missingDocuments);
    const note = String(input.reason ?? "").trim() || undefined;
    return {
      toStatus: "submitted",
      patch: { status: "submitted", submittedAt: now, submittedByUserId: actor.userId, decision: null, decidedAt: null, decidedByUserId: null, decisionReason: null, ...withGoLive },
      history: entry("submitted", note),
      passed: false
    };
  }

  if (action === "approve" || action === "approve_conditional") {
    const conditional = action === "approve_conditional";
    const blocking = requirements.filter((item) => !(conditional && item.waivable));
    if (blocking.length) throw fail(blocking, !conditional && blocking.every((item) => item.waivable) ? " Có thể dùng Duyệt có điều kiện, ghi tồn đọng vào sổ vấn đề." : "");
    let conditionIssue: GatePlan["conditionIssue"];
    let reason: string | undefined;
    if (conditional) {
      // V-13: the outstanding part goes to the issue log with an owner and a due date.
      reason = required(input.reason, "Duyệt có điều kiện bắt buộc ghi phần tồn đọng.");
      const ownerUserId = required(input.conditionOwnerUserId, "Duyệt có điều kiện bắt buộc có người chịu trách nhiệm phần tồn đọng.");
      const dueAt = parseDay(required(input.conditionDueAt, "Duyệt có điều kiện bắt buộc có hạn xử lý phần tồn đọng."), "Hạn xử lý tồn đọng");
      conditionIssue = { description: `[${definition.code}] Tồn đọng khi duyệt có điều kiện: ${reason}`, ownerUserId, dueAt: dueAt.toISOString() };
    }
    const toStatus: ProjectGateStatus = definition.customerConfirmation ? "awaiting_customer" : "approved";
    return {
      toStatus,
      patch: { status: toStatus, decision: conditional ? "conditional" : "approved", decidedAt: now, decidedByUserId: actor.userId, decisionReason: reason ?? null, ...withGoLive },
      history: entry(toStatus, reason),
      passed: toStatus === "approved",
      ...(definition.customerConfirmation ? { customerWait: true } : {}),
      ...(conditionIssue ? { conditionIssue } : {})
    };
  }

  if (action === "reject") {
    const reason = required(input.reason, "Từ chối bắt buộc ghi lý do và phần cần làm lại.");
    return {
      toStatus: "rejected",
      patch: { status: "rejected", decision: "rejected", decidedAt: now, decidedByUserId: actor.userId, decisionReason: reason },
      history: entry("rejected", reason),
      passed: false,
      ...(fromStatus === "awaiting_customer" ? { customerWait: false } : {})
    };
  }

  if (action === "confirm_payment") {
    const note = String(input.reason ?? "").trim() || undefined;
    return {
      toStatus: fromStatus,
      patch: { paymentConfirmedAt: now, paymentConfirmedByUserId: actor.userId, paymentNote: note ?? null },
      history: entry(fromStatus, note ?? `PM xác nhận BD ${gatePaymentText(definition.code)}`),
      passed: false
    };
  }

  if (action === "confirm_customer") {
    // G7 is passed (and the P&L closed) by this step, so the data condition is checked again: hours may have been logged since the internal approval.
    if (definition.code === "G7" && facts.pnlPending?.blocked) throw fail([{ text: g7PendingHoursMessage(facts.pnlPending), waivable: false }]);
    // V-14: who confirmed on the customer's side, when, and the email / signed minutes that proves it.
    const confirmedBy = required(input.customerConfirmedBy, "Bắt buộc ghi người xác nhận phía khách hàng.");
    const evidence = required(input.customerEvidence, `Bắt buộc có bằng chứng xác nhận (${definition.customerEvidence}).`);
    const confirmedAt = input.customerConfirmedAt ? parseDay(input.customerConfirmedAt, "Thời điểm khách xác nhận") : now;
    if (confirmedAt.getTime() > now.getTime() + 60_000) throw new BadRequestException("Thời điểm khách xác nhận không thể ở tương lai.");
    return {
      toStatus: "approved",
      patch: { status: "approved", customerConfirmedAt: confirmedAt, customerConfirmedBy: confirmedBy, customerEvidence: evidence, customerRecordedByUserId: actor.userId },
      history: entry("approved", `${confirmedBy} xác nhận. Bằng chứng: ${evidence}`),
      passed: true,
      customerWait: false
    };
  }

  // exception (V-11). It waives the documents and the customer wait, never the data condition: G7 closes the project P&L.
  if (definition.code === "G7" && facts.pnlPending?.blocked) throw fail([{ text: g7PendingHoursMessage(facts.pnlPending), waivable: false }]);
  // D-22: "Giá trị dự án" is required before G1 (level Chặn) — the revenue of the P&L, not a document an exception waives.
  if (definition.code === "G1" && facts.chargeable && !facts.projectValueReady) throw fail([{ text: "Chưa nhập Giá trị dự án (màn P&L dự án, ô Doanh thu).", waivable: false }]);
  const reason = required(input.reason, "Mở điểm chốt theo ngoại lệ bắt buộc ghi lý do.");
  return {
    toStatus: "exception",
    patch: { status: "exception", exceptionAt: now, exceptionByUserId: actor.userId, exceptionReason: reason },
    history: entry("exception", reason),
    passed: true,
    ...(fromStatus === "awaiting_customer" ? { customerWait: false } : {})
  };
}

/** Named hooks for what this change leaves out. Each is called at the right moment; nothing here may throw into the request. */
export const gateHooks: Record<string, (input: { gate: any; project: any; plan?: GatePlan }) => Promise<void>> = {
  /** TODO(V-14): bot message to the customer Lark group asking for confirmation, then up to 2 reminders there (customerReminderCount), then internal only. Waits for: Lark groups (V-02) and the scheduler scan. */
  async sendCustomerConfirmationRequest() {},
  /** TODO(V-11, V-15): put the submission in Admin › Approval and remind after handoffReviewWorkingHours (then warning BRI-04). Waits for: the scheduler scan and the approval queue reading ProjectGate. */
  async notifyApprovers() {},
  /** TODO(3.4, G7): close the project P&L when G7 is approved. Waits for: project-level P&L close (today P&L is locked per month). */
  async closeProjectPnl() {},
  /** TODO(V-09): push the gate's documents to the Wiki "Tài liệu tổng hợp giải pháp DX External". Waits for: decision [Cần chốt 9]. */
  async pushDocumentsToWiki() {},
  /** TODO(V-16): Go-live checklist beyond the Go-live date and the CS hand-over documents. Waits for: the checklist content, which the document leaves open. */
  async checkGoLiveChecklist() {}
};

export async function runGateHooks(names: string[], input: { gate: any; project: any; plan?: GatePlan }) {
  for (const name of names) {
    try {
      await gateHooks[name]?.(input);
    } catch (error) {
      console.error(`Gate hook ${name} failed`, error);
    }
  }
}

// ── G7 and the project P&L (P&L spec, decision 12/10 point 6; PL-16, A-9) ───────────────────────────────────────────

/**
 * The G7 data condition is the P&L hour gate's own answer (PnlService.pendingHoursBlockingG7): hours "Chờ xử lý" for a
 * wrong or missing classification or line item block; hours waiting only for a cost rate do not. No second rule here.
 */
export function g7PendingCheck(blockers: Pick<PnlG7Blockers, "projectId" | "blockingMinutes" | "byReason">): ProjectGatePnlPendingCheck {
  return {
    blocked: blockers.blockingMinutes > 0,
    reasons: blockers.byReason.map(({ reason, label, entryCount, minutes }) => ({ reason, label, entryCount, minutes })),
    worklistHref: `/pnl/hours?projectId=${encodeURIComponent(blockers.projectId)}`
  };
}

const hoursText = (minutes: number) => `${String(Math.round(minutes / 6) / 10).replace(".", ",")} giờ`;

export function g7PendingHoursMessage(check: ProjectGatePnlPendingCheck): string {
  return `Còn giờ log Chờ xử lý vì thiếu hoặc sai phân loại: ${check.reasons.map((item) => `${item.label} ${item.entryCount} giờ log (${hoursText(item.minutes)})`).join("; ")}. Xử lý tại danh sách giờ chờ: ${check.worklistHref}. Giờ chỉ chờ cost rate không chặn G7.`;
}

/** The moment a gate was passed — for G7, the P&L closing date. Read from the gate row; nothing is stored twice. */
export function gatePassedAt(gate: { status: string; customerConfirmedAt?: Date | string | null; decidedAt?: Date | string | null; exceptionAt?: Date | string | null }): Date | null {
  if (!isGatePassed(gate.status)) return null;
  const at = gate.status === "exception" ? gate.exceptionAt : gate.customerConfirmedAt ?? gate.decidedAt;
  return at ? new Date(at) : null;
}
