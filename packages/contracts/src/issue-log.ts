/**
 * "Sổ vấn đề" (rules 5.4, V-23…V-26, V-31): the catalogues shared by the API and the web. Three types — Blocker, Risk,
 * Issue. "Yêu cầu thay đổi" is no longer recorded in the system (chốt 13/10); rows of that retired type stay stored
 * but are never listed. Transition rules live in the API (delivery-handoff/issue-log.ts).
 */
export const ISSUE_LOG_TYPES = ["blocker", "risk", "issue"] as const;
export type IssueLogType = (typeof ISSUE_LOG_TYPES)[number];

export const ISSUE_LOG_TYPE_LABELS: Record<IssueLogType, string> = {
  blocker: "Blocker",
  risk: "Risk",
  issue: "Issue"
};

/** Record code prefix per type; the running number is per project and prefix, never reused. */
export const ISSUE_LOG_CODE_PREFIX: Record<IssueLogType, string> = { blocker: "BLK", risk: "RSK", issue: "ISS" };

export const ISSUE_LOG_BRI_STATUSES = ["pending", "in_progress", "resolved", "accepted"] as const;
export type IssueLogStatus = (typeof ISSUE_LOG_BRI_STATUSES)[number] | "cancelled";

export const ISSUE_LOG_STATUS_LABELS: Record<IssueLogStatus, string> = {
  pending: "Chờ xử lý",
  in_progress: "Đang xử lý",
  resolved: "Đã xử lý",
  accepted: "Chấp nhận",
  cancelled: "Huỷ"
};

/** Statuses in which a record still needs work. Everything else is final. */
export const ISSUE_LOG_OPEN_STATUSES: readonly IssueLogStatus[] = ["pending", "in_progress"];

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

export interface IssueLogFieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "select" | "user";
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** V-24: must be filled when the record is created with this type. */
  requiredOnCreate?: boolean;
  /** Computed by the system; never typed in. */
  auto?: boolean;
}

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

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
  ]
};

/** Inputs a transition may ask for that are not extension fields. */
export const ISSUE_LOG_ACTION_FIELDS: readonly IssueLogFieldDef[] = [
  { key: "note", label: "Lý do / ghi chú", kind: "textarea" },
  { key: "ownerUserId", label: "Người chịu trách nhiệm", kind: "user" },
  { key: "resolutionEvidence", label: "Bằng chứng xử lý (mô tả hoặc đường dẫn)", kind: "textarea" },
  { key: "impactArea", label: "Loại ảnh hưởng", kind: "select", options: options(ISSUE_LOG_IMPACT_AREA_LABELS) },
  { key: "targetType", label: "Phân loại thành", kind: "select", options: options(ISSUE_LOG_TYPE_LABELS) }
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
  extension?: IssueLogExtension;
}
