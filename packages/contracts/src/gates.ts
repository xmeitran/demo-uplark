/**
 * "Điểm chốt" G1–G8 of the standard project flow (rules 7.2, 8.1) and the project status proposal (5.1, 7.3):
 * the catalogue and the API shapes shared by the API and the web. The rules live in the API
 * (delivery-handoff/gates.ts, status-proposal.ts); the web only renders what the API returns.
 */
export const PROJECT_GATE_CODES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const;
export type ProjectGateCode = (typeof PROJECT_GATE_CODES)[number];

export interface ProjectGateDefinition {
  code: ProjectGateCode;
  name: string;
  /** stageKey of the TPL-001 stage whose end the gate sits on ("Gắn tại"). */
  stageKey: string;
  /** True when the gate also closes its milestone (G1, G4, G7, G8): passing it opens the next milestone. */
  closesMilestone: boolean;
  /** "Tài liệu bắt buộc": a project document counts when its type equals one of these (case-insensitive). */
  requiredDocumentTypes: readonly string[];
  /** "Chuẩn bị (User)". */
  preparedBy: string;
  /** "Duyệt (Admin)". */
  approvedBy: string;
  /** G7 only (V-12, chốt 11/10 #8): the PM prepares the acceptance minutes and also moves the project on. */
  preparerMayApprove: boolean;
  /** G7 only: the project's BD may approve next to the PM. */
  bdMayApprove: boolean;
  /** G1, G2, G4, G7: after the internal approval the customer confirms (V-14). */
  customerConfirmation: boolean;
  /** Which 7.6 parameter holds the customer's response deadline in working days. */
  customerResponseParameter: "customerResponseWorkingDays" | "customerResponseG4WorkingDays";
  /** What counts as the customer's confirmation. */
  customerEvidence: string;
  /** G1: the PM confirms BD collected instalment 1; G7: collected in full (PL-16). A tick only — no amount, never in EBIT. Loại Khách hàng projects only. */
  paymentConfirmation: boolean;
  /** G8 (V-16): a Go-live date is required. */
  goLiveDate: boolean;
  /** "Điều kiện dữ liệu thêm", as shown to the user. */
  dataConditions: readonly string[];
  /** "Sau khi duyệt". */
  opensNext: string;
}

const CUSTOMER_EVIDENCE = "Khách xác nhận bằng thao tác, hoặc email/biên bản do PM tải lên";

function gate(definition: Partial<ProjectGateDefinition> & Pick<ProjectGateDefinition, "code" | "name" | "stageKey" | "requiredDocumentTypes" | "preparedBy" | "opensNext">): ProjectGateDefinition {
  return {
    closesMilestone: false, approvedBy: "PM", preparerMayApprove: false, bdMayApprove: false, customerConfirmation: false,
    customerResponseParameter: "customerResponseWorkingDays", customerEvidence: CUSTOMER_EVIDENCE, paymentConfirmation: false, goLiveDate: false, dataConditions: [],
    ...definition
  };
}

/** Table 8.1, for template TPL-001. The end-of-Optimize gate of BRD 2.1 is merged into G8 (chốt 11/10 #10). */
export const PROJECT_GATE_CATALOGUE: Record<ProjectGateCode, ProjectGateDefinition> = {
  G1: gate({
    code: "G1", name: "Đóng scope & kick-off", stageKey: "validate", closesMilestone: true,
    requiredDocumentTypes: ["Proposal", "Biên bản đóng scope"], preparedBy: "BD, Dx", customerConfirmation: true, paymentConfirmation: true,
    dataConditions: ["Giá trị dự án đã nhập", "Baseline kế hoạch khóa", "PM xác nhận đã thu đợt 1 theo thông tin từ BD"],
    opensNext: "Mở Milestone 2; Đang triển khai"
  }),
  G2: gate({ code: "G2", name: "Duyệt thiết kế", stageKey: "design", requiredDocumentTypes: ["BRD", "FRD", "SRS"], preparedBy: "Dx", customerConfirmation: true, opensNext: "Mở Build" }),
  G3: gate({ code: "G3", name: "Hoàn tất Build", stageKey: "build", requiredDocumentTypes: ["Đường dẫn hệ thống", "Test case"], preparedBy: "Dx", opensNext: "Mở Deployment Preparation" }),
  G4: gate({
    code: "G4", name: "Sẵn sàng triển khai", stageKey: "deployment_preparation", closesMilestone: true,
    requiredDocumentTypes: ["SOP", "Video hướng dẫn", "HDSD"], preparedBy: "Dx, PQA", customerConfirmation: true, customerResponseParameter: "customerResponseG4WorkingDays",
    customerEvidence: "Khách xác nhận tài liệu cùng phiên bản demo cuối cùng của hệ thống (thao tác, hoặc email/biên bản do PM tải lên)",
    opensNext: "Mở Milestone 3"
  }),
  G5: gate({ code: "G5", name: "Kết thúc Pilot", stageKey: "pilot", requiredDocumentTypes: ["Log bug Pilot", "Đề xuất cải tiến Pilot"], preparedBy: "Dx", opensNext: "Mở Onboard" }),
  G6: gate({ code: "G6", name: "Kết thúc Onboard", stageKey: "onboard", requiredDocumentTypes: ["Log bug Onboard", "Đề xuất cải tiến Onboard"], preparedBy: "Dx", opensNext: "Mở Acceptance" }),
  G7: gate({
    code: "G7", name: "Nghiệm thu hệ thống", stageKey: "acceptance", closesMilestone: true,
    requiredDocumentTypes: ["Biên bản nghiệm thu"], preparedBy: "PM", approvedBy: "PM, BD", preparerMayApprove: true, bdMayApprove: true, customerConfirmation: true, paymentConfirmation: true,
    customerEvidence: "Biên bản nghiệm thu khách đã ký",
    dataConditions: ["Khách đã ký biên bản nghiệm thu", "PM xác nhận đã thu đủ theo thông tin từ BD", "P&L không còn giờ Chờ xử lý", "Vấn đề còn mở có người và hạn"],
    opensNext: "Mở Milestone 4; Đã hoàn thành; đóng P&L dự án"
  }),
  G8: gate({
    code: "G8", name: "Bàn giao CS & Go-live", stageKey: "handover", closesMilestone: true,
    requiredDocumentTypes: ["Tài liệu bàn giao CS", "Xác nhận CS đã nhận"], preparedBy: "Dx, PQA", goLiveDate: true,
    dataConditions: ["Có ngày Go-live", "Tồn đọng chuyển sang CS có PIC và hạn"],
    opensNext: "Kết thúc triển khai; Đang bảo trì"
  })
};

export function isProjectGateCode(value: unknown): value is ProjectGateCode {
  return typeof value === "string" && (PROJECT_GATE_CODES as readonly string[]).includes(value);
}

/**
 * not_submitted → submitted → (rejected → submitted …) → awaiting_customer (G1, G2, G4, G7) → approved.
 * `exception` is the audited Dx Director bypass of V-11. Approved and exception let the next stage start.
 */
export const PROJECT_GATE_STATUSES = ["not_submitted", "submitted", "rejected", "awaiting_customer", "approved", "exception"] as const;
export type ProjectGateStatus = (typeof PROJECT_GATE_STATUSES)[number];

export const PROJECT_GATE_STATUS_LABELS: Record<ProjectGateStatus, string> = {
  not_submitted: "Chờ nộp hồ sơ",
  submitted: "Chờ duyệt",
  rejected: "Từ chối – chờ nộp lại",
  awaiting_customer: "Chờ khách xác nhận",
  approved: "Đã duyệt",
  exception: "Mở theo ngoại lệ"
};

export const PROJECT_GATE_ACTIONS = ["submit", "approve", "reject", "approve_conditional", "confirm_payment", "confirm_customer", "exception"] as const;
export type ProjectGateAction = (typeof PROJECT_GATE_ACTIONS)[number];

/** What the PM's payment tick of a gate says (PL-16): G1 "đã thu đợt 1", G7 "đã thu đủ". */
export function gatePaymentText(code: string): string {
  return code === "G7" ? "đã thu đủ" : "đã thu đợt 1";
}

/** `confirm_payment` reads "Xác nhận đã thu đợt 1" at G1 and "Xác nhận đã thu đủ" at G7. */
export function gateActionLabel(action: ProjectGateAction, code: string): string {
  return action === "confirm_payment" ? `Xác nhận ${gatePaymentText(code)}` : PROJECT_GATE_ACTION_LABELS[action];
}

export const PROJECT_GATE_ACTION_LABELS: Record<ProjectGateAction, string> = {
  submit: "Nộp hồ sơ",
  approve: "Duyệt",
  reject: "Từ chối",
  approve_conditional: "Duyệt có điều kiện",
  confirm_payment: "Xác nhận đã thu tiền",
  confirm_customer: "Ghi nhận khách xác nhận",
  exception: "Ngoại lệ"
};

export interface ProjectGateActionInput {
  action: ProjectGateAction;
  /** submit: optional note. reject / exception: mandatory reason. approve_conditional: what is still outstanding. confirm_payment: optional note. */
  reason?: string;
  /** approve_conditional: who clears the outstanding part and by when; becomes an Issue in the issue log. */
  conditionOwnerUserId?: string;
  conditionDueAt?: string;
  /** confirm_customer: who confirmed on the customer's side, when, and the email / minutes link or file reference. */
  customerConfirmedBy?: string;
  customerConfirmedAt?: string;
  customerEvidence?: string;
  /** G8: YYYY-MM-DD, given on submit or approve. */
  goLiveDate?: string;
}

export interface ProjectGateHistoryEntry {
  at: string;
  action: ProjectGateAction | "migrated";
  label: string;
  byUserId: string | null;
  byName: string | null;
  fromStatus: ProjectGateStatus | null;
  toStatus: ProjectGateStatus;
  note?: string;
}

export interface ProjectStageSlaSummary {
  stageId: string;
  stageName: string;
  slaDays: number | null;
  startedAt?: string;
  /** Suggested due date: start + SLA working days + the working days spent waiting for the customer. */
  dueAt?: string;
  finishedAt?: string;
  paused: boolean;
  /** Working days waited for the customer so far (V-19); never counted as delay. */
  customerWaitDays: number;
  overrun: boolean;
  overrunDays: number;
  /** Approved extensions of the stage's due date, oldest first (TD-04 closes on one, TD-05 counts them). */
  extensions?: import("./baseline").StageExtensionSummary[];
  /** Extensions of the stage; every one counts toward TD-05. */
  extensionCount?: number;
  /** extensionCount reached `stageExtensionAbnormalCount`. */
  extensionAbnormal?: boolean;
  /** The due date after the latest extension. */
  extendedDueAt?: string;
  /** The caller may extend the stage (Admin: PM or Dx Director, D-21). */
  canExtend?: boolean;
}

export const G7_BLOCKING_PENDING_REASON_LABELS = {
  layer2_mismatch: "Lớp 2 không khớp",
  missing_classification: "Thiếu phân loại"
} as const;
export type G7BlockingPendingReason = keyof typeof G7_BLOCKING_PENDING_REASON_LABELS;

export interface ProjectGatePnlPendingCheck {
  blocked: boolean;
  /** One row per reason that has entries; an entry with several reasons is counted under each. */
  /** `reason` is a P&L hour-gate reason code (PnlGateReasonCode); the label comes with it. */
  reasons: Array<{ reason: G7BlockingPendingReason | (string & {}); label: string; entryCount: number; minutes: number }>;
  /** The pending-hours worklist, filtered to the project. */
  worklistHref: string;
}

export interface ProjectGateSummary {
  id: string;
  code: ProjectGateCode;
  definition: ProjectGateDefinition;
  projectId: string;
  milestoneId: string;
  milestoneName: string;
  stageId: string;
  stageName: string;
  status: ProjectGateStatus;
  statusLabel: string;
  /** False until the preceding gate is approved (or opened by exception). */
  reachable: boolean;
  documents: Array<{ type: string; present: boolean; documentName?: string }>;
  openTaskCount: number;
  /** Everything that still blocks a plain approval, in Vietnamese. */
  missingRequirements: string[];
  submittedAt?: string;
  submittedByUserId?: string;
  submittedByName?: string;
  decision?: "approved" | "conditional" | "rejected";
  decidedAt?: string;
  decidedByUserId?: string;
  decidedByName?: string;
  decisionReason?: string;
  conditionIssueId?: string;
  conditionIssueCode?: string;
  /** The gate asks for the PM's payment tick: G1 / G7 of a Loại Khách hàng project (PL-16). */
  paymentConfirmationRequired: boolean;
  paymentConfirmedAt?: string;
  paymentConfirmedByName?: string;
  paymentNote?: string;
  customerRequestedAt?: string;
  customerDueAt?: string;
  customerOverdue: boolean;
  customerConfirmedAt?: string;
  customerConfirmedBy?: string;
  customerEvidence?: string;
  customerRecordedByName?: string;
  exceptionAt?: string;
  exceptionByName?: string;
  exceptionReason?: string;
  goLiveDate?: string;
  /** When the gate was passed: customer confirmation, else the internal approval, else the exception. The P&L closing point reads G7's. */
  passedAt?: string;
  /** G7 only (P&L spec 12/10 point 6): hours "Chờ xử lý" that block the approval. Cost-rate waits are never listed. */
  pnlPendingCheck?: ProjectGatePnlPendingCheck;
  sla?: ProjectStageSlaSummary;
  allowedActions: ProjectGateAction[];
  history: ProjectGateHistoryEntry[];
}

export interface ProjectGateListResponse {
  projectId: string;
  /** False for projects on hand-built frameworks: they keep their milestone gates. */
  usesStageGates: boolean;
  data: ProjectGateSummary[];
  /** SLA of every stage that has one, including stages without a gate. */
  stageSla: ProjectStageSlaSummary[];
  /** Whether the caller may open a gate by exception (V-11: Dx Director / Admin only). */
  canException: boolean;
}

export type ProjectStatusProposalState = "pending" | "confirmed" | "declined" | "superseded";

export interface ProjectStatusProposalSummary {
  id: string;
  projectId: string;
  fromStatus: string;
  proposedStatus: string;
  proposedStatusLabel: string;
  /** "Căn cứ": why the rules imply this status. */
  basis: string;
  /** Pre-filled reason when the status needs one (Tạm dừng, Có rủi ro). */
  suggestedReason?: string;
  status: ProjectStatusProposalState;
  createdAt: string;
  decidedAt?: string;
  decidedByName?: string;
  declineReason?: string;
  /** Whether the caller is one of the roles 5.1 lets confirm or decline. */
  canDecide: boolean;
}

export interface DecideProjectStatusProposalInput {
  decision: "confirm" | "decline";
  /** confirm: reason / action for Tạm dừng and Có rủi ro (defaults to the suggested one). decline: mandatory. */
  reason?: string;
}
