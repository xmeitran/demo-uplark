/**
 * "Sổ vấn đề và yêu cầu thay đổi" (rules 5.4, V-23…V-32, 8.2): the catalogues shared by the API and the web.
 * Transition rules live in the API (delivery-handoff/issue-log.ts); the web only renders what the API allows.
 */
export const ISSUE_LOG_TYPES = ["blocker", "risk", "issue", "change_request"] as const;
export type IssueLogType = (typeof ISSUE_LOG_TYPES)[number];

export const ISSUE_LOG_TYPE_LABELS: Record<IssueLogType, string> = {
  blocker: "Blocker",
  risk: "Risk",
  issue: "Issue",
  change_request: "Yêu cầu thay đổi"
};

/** Record code prefix per type; the running number is per project and prefix, never reused. */
export const ISSUE_LOG_CODE_PREFIX: Record<IssueLogType, string> = { blocker: "BLK", risk: "RSK", issue: "ISS", change_request: "CR" };

export const ISSUE_LOG_BRI_STATUSES = ["pending", "in_progress", "resolved", "accepted"] as const;
export const ISSUE_LOG_CR_STATUSES = ["new", "assessing", "commercial_review", "customer_approval", "approved", "implementing", "closed", "not_cr", "rejected", "deferred"] as const;
export type IssueLogStatus = (typeof ISSUE_LOG_BRI_STATUSES)[number] | (typeof ISSUE_LOG_CR_STATUSES)[number] | "cancelled";

export const ISSUE_LOG_STATUS_LABELS: Record<IssueLogStatus, string> = {
  pending: "Chờ xử lý",
  in_progress: "Đang xử lý",
  resolved: "Đã xử lý",
  accepted: "Chấp nhận",
  new: "Mới ghi nhận",
  assessing: "Đang đánh giá",
  commercial_review: "Chờ duyệt thương mại",
  customer_approval: "Chờ khách duyệt",
  approved: "Đã duyệt",
  implementing: "Đang triển khai",
  closed: "Đã đóng",
  not_cr: "Không phải CR",
  rejected: "Từ chối",
  deferred: "Hoãn",
  cancelled: "Huỷ"
};

/** Statuses in which a record still needs work. Everything else is final. */
export const ISSUE_LOG_OPEN_STATUSES: readonly IssueLogStatus[] = ["pending", "in_progress", "new", "assessing", "commercial_review", "customer_approval", "approved", "implementing"];

export function isIssueLogOpen(status: string): boolean {
  return (ISSUE_LOG_OPEN_STATUSES as readonly string[]).includes(status);
}

export const ISSUE_LOG_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IssueLogSeverity = (typeof ISSUE_LOG_SEVERITIES)[number];
export const ISSUE_LOG_SEVERITY_LABELS: Record<IssueLogSeverity, string> = { low: "Thấp", medium: "Trung bình", high: "Cao", critical: "Nghiêm trọng" };

export type IssueLogDueState = "no_due" | "on_time" | "overdue";
export const ISSUE_LOG_DUE_STATE_LABELS: Record<IssueLogDueState, string> = { no_due: "Chưa đặt hạn", on_time: "Trong hạn", overdue: "Quá hạn" };

/** V-31: what the record affects decides who it is escalated to. */
export const ISSUE_LOG_IMPACT_AREAS = ["resource", "delivery", "timeline", "scope", "cost", "customer_commitment"] as const;
export type IssueLogImpactArea = (typeof ISSUE_LOG_IMPACT_AREAS)[number];
export const ISSUE_LOG_IMPACT_AREA_LABELS: Record<IssueLogImpactArea, string> = {
  resource: "Nguồn lực",
  delivery: "Delivery",
  timeline: "Timeline",
  scope: "Phạm vi",
  cost: "Chi phí",
  customer_commitment: "Cam kết với khách"
};
export type IssueLogEscalationLevel = "none" | "dx_director" | "bd_lead";
export const ISSUE_LOG_ESCALATION_LABELS: Record<IssueLogEscalationLevel, string> = { none: "Chưa chuyển cấp", dx_director: "Dx Director", bd_lead: "BD Lead" };

export function escalationLevelForImpactArea(area: IssueLogImpactArea): IssueLogEscalationLevel {
  return area === "resource" || area === "delivery" ? "dx_director" : "bd_lead";
}

/**
 * 8.2: the steps of a change request, in order, with the status each one sits in and its SLA in working days.
 * `slaDays` here is the document's default and marks which steps have a deadline; the API takes the actual number
 * of days from the system parameter `changeRequestStepSlaDays` (issue-log.service.ts).
 */
export const CHANGE_REQUEST_STEPS = [
  { code: "CR-01", label: "Ghi nhận", status: "new", slaDays: null },
  { code: "CR-02", label: "Đối chiếu baseline, phân loại", status: "assessing", slaDays: 1 },
  { code: "CR-03", label: "Đánh giá impact kỹ thuật", status: "assessing", slaDays: 3 },
  { code: "CR-04", label: "Impact Pack", status: "assessing", slaDays: 2 },
  { code: "CR-G1", label: "Chọn Case 1 / Case 2", status: "assessing", slaDays: null },
  { code: "CR-05A", label: "Đánh giá chi phí (Case 1)", status: "assessing", slaDays: 1 },
  { code: "CR-05B", label: "Duyệt thương mại (Case 2)", status: "commercial_review", slaDays: 1 },
  { code: "CR-06", label: "Đàm phán với khách", status: "customer_approval", slaDays: 1 },
  { code: "CR-07", label: "Lấy xác nhận chính thức", status: "customer_approval", slaDays: 1 },
  { code: "CR-07C", label: "Ghi nhận quyết định", status: "approved", slaDays: null },
  { code: "CR-08A", label: "Cập nhật giải pháp", status: "implementing", slaDays: 2 },
  { code: "CR-08B", label: "Hạng mục, task, baseline mới", status: "implementing", slaDays: 1 },
  { code: "CR-08C", label: "Triển khai, QA/UAT", status: "implementing", slaDays: null },
  { code: "CR-09", label: "Đóng", status: "closed", slaDays: null }
] as const satisfies ReadonlyArray<{ code: string; label: string; status: IssueLogStatus; slaDays: number | null }>;
export type ChangeRequestStepCode = (typeof CHANGE_REQUEST_STEPS)[number]["code"];

export interface IssueLogFieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "select" | "user";
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** V-24: must be filled when the record is created with this type. */
  requiredOnCreate?: boolean;
  /** V-32: only PM, admins and the project's BD may read or write it. */
  commercial?: boolean;
  /** Computed by the system; never typed in. */
  auto?: boolean;
}

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export const CHANGE_REQUEST_INTAKE_CHANNELS = {
  request_form: "Form yêu cầu",
  email: "Email",
  lark: "Lark chat hoặc nhóm",
  meeting: "Họp hoặc demo",
  ticket: "Ticket",
  one_on_one: "Trao đổi 1-1",
  other: "Khác"
} as const;

export const CHANGE_REQUEST_CASES = { case_1: "Case 1 (PM xử lý)", case_2: "Case 2 (PM phối hợp BD)" } as const;

/** V-24: the type-specific part of a record, stored in ProjectRisk.extension. */
export const ISSUE_LOG_EXTENSION_FIELDS: Record<IssueLogType, readonly IssueLogFieldDef[]> = {
  blocker: [
    { key: "blockedItem", label: "Task hoặc milestone bị chặn", kind: "text" },
    { key: "unblockDueAt", label: "Hạn tháo gỡ", kind: "date" },
    { key: "causeSide", label: "Nguyên nhân", kind: "select", requiredOnCreate: true, options: options({ customer: "Phía khách", internal: "Nội bộ" }) }
  ],
  risk: [
    { key: "likelihood", label: "Khả năng xảy ra", kind: "select", requiredOnCreate: true, options: options({ Low: "Thấp", Medium: "Trung bình", High: "Cao" }) },
    { key: "expectedImpact", label: "Tác động dự kiến", kind: "textarea" },
    { key: "response", label: "Phương án giảm thiểu", kind: "textarea" }
  ],
  issue: [
    { key: "actualImpact", label: "Tác động đã xảy ra", kind: "textarea", requiredOnCreate: true },
    { key: "response", label: "Hành động khắc phục", kind: "textarea" },
    { key: "completionDueAt", label: "Hạn hoàn thành", kind: "date" }
  ],
  change_request: [
    { key: "requesterName", label: "Người yêu cầu", kind: "text", requiredOnCreate: true },
    { key: "requesterRole", label: "Vai trò người yêu cầu", kind: "text" },
    { key: "intakeChannel", label: "Kênh tiếp nhận", kind: "select", requiredOnCreate: true, options: options(CHANGE_REQUEST_INTAKE_CHANNELS) },
    { key: "initialReceiver", label: "Người tiếp nhận ban đầu", kind: "text" },
    { key: "changeReason", label: "Lý do thay đổi", kind: "textarea", requiredOnCreate: true },
    { key: "baselineRef", label: "Baseline liên quan", kind: "select", options: options({ B0: "B0 (phạm vi và giá đã ký)", B1: "B1 (milestone, timeline, giờ dự kiến)", both: "Cả B0 và B1" }) },
    { key: "baselineVersion", label: "Phiên bản baseline", kind: "text" },
    { key: "technicalImpact", label: "Đánh giá impact kỹ thuật", kind: "textarea" },
    { key: "estimatedEffortMd", label: "Effort dự kiến (MD)", kind: "number" },
    { key: "timelineImpactDays", label: "Impact timeline (ngày)", kind: "number" },
    { key: "resourceImpact", label: "Impact nguồn lực", kind: "textarea" },
    { key: "costImpact", label: "Impact chi phí", kind: "textarea", commercial: true },
    { key: "commercialCase", label: "Case thương mại (CR-G1)", kind: "select", options: options(CHANGE_REQUEST_CASES) },
    { key: "caseBasis", label: "Căn cứ chọn case (V-28)", kind: "textarea" },
    { key: "feeOption", label: "Phương án phí", kind: "textarea", commercial: true },
    { key: "contractImpact", label: "Ảnh hưởng HĐ, SOW, phụ lục", kind: "textarea", commercial: true },
    { key: "proposedTimeline", label: "Timeline đề xuất", kind: "text" },
    { key: "newAcceptanceCriteria", label: "Tiêu chí nghiệm thu mới", kind: "textarea" },
    { key: "customerApprovedAt", label: "Ngày khách duyệt", kind: "date" },
    { key: "customerApproverName", label: "Người duyệt phía khách", kind: "text" },
    { key: "approvalEvidence", label: "Bằng chứng duyệt (email, form, phụ lục)", kind: "text" },
    { key: "newBaselineVersion", label: "Phiên bản baseline mới", kind: "text", auto: true },
    { key: "actualEffortMd", label: "Effort thực tế (MD, tự tính)", kind: "number", auto: true },
    { key: "actualTimelineImpactDays", label: "Impact timeline thực tế (ngày)", kind: "number" },
    { key: "closeEvidence", label: "Bằng chứng đóng", kind: "text" }
  ]
};

/** Inputs a transition may ask for that are not extension fields. */
export const ISSUE_LOG_ACTION_FIELDS: readonly IssueLogFieldDef[] = [
  { key: "note", label: "Lý do / ghi chú", kind: "textarea" },
  { key: "ownerUserId", label: "Người chịu trách nhiệm", kind: "user" },
  { key: "resolutionEvidence", label: "Bằng chứng xử lý (mô tả hoặc đường dẫn)", kind: "textarea" },
  { key: "impactArea", label: "Loại ảnh hưởng", kind: "select", options: options(ISSUE_LOG_IMPACT_AREA_LABELS) },
  { key: "targetType", label: "Phân loại thành", kind: "select", options: options(ISSUE_LOG_TYPE_LABELS) },
  { key: "convertTo", label: "Chuyển thành", kind: "select", options: options({ none: "Không tạo bản ghi mới (task thường)", issue: "Issue", blocker: "Blocker" }) },
  { key: "targetStep", label: "Quay về bước", kind: "select", options: options({ "CR-04": "CR-04 Impact Pack", "CR-05": "CR-05 Đánh giá chi phí" }) }
];

export function issueLogFieldDef(type: IssueLogType, key: string): IssueLogFieldDef | undefined {
  return ISSUE_LOG_EXTENSION_FIELDS[type].find((field) => field.key === key) ?? ISSUE_LOG_ACTION_FIELDS.find((field) => field.key === key);
}

export type IssueLogExtension = Record<string, string | number | null | undefined>;

export interface IssueLogAllowedAction {
  action: string;
  label: string;
  /** Field keys (extension or action fields) that must be sent with the action. */
  requires: string[];
  optional?: string[];
  tone?: "primary" | "danger" | "neutral";
}

export interface IssueLogHistoryEntry {
  id: string;
  action: string;
  label: string;
  fromStatus?: string;
  toStatus?: string;
  fromStep?: string;
  toStep?: string;
  note?: string;
  actorUserId?: string;
  actorDisplayName?: string;
  at: string;
}

export interface IssueLogTransitionInput {
  action: string;
  note?: string;
  ownerUserId?: string;
  resolutionEvidence?: string;
  impactArea?: IssueLogImpactArea;
  targetType?: IssueLogType;
  convertTo?: "none" | "issue" | "blocker";
  targetStep?: "CR-04" | "CR-05";
  extension?: IssueLogExtension;
}
