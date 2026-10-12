import {
  ISSUE_LOG_DUE_STATE_LABELS,
  ISSUE_LOG_ESCALATION_LABELS,
  ISSUE_LOG_EXTENSION_FIELDS,
  ISSUE_LOG_SEVERITY_LABELS,
  ISSUE_LOG_STATUS_LABELS,
  ISSUE_LOG_TYPE_LABELS,
  type IssueLogFieldDef,
  type ProjectRiskSummary
} from "@b2b-crm/contracts";
import { formatVietnamDate } from "@/lib/vietnam-time";

export type IssueLogFilters = { type: string; severity: string; owner: string; status: string };
export const EMPTY_ISSUE_LOG_FILTERS: IssueLogFilters = { type: "all", severity: "all", owner: "all", status: "all" };

export function filterIssueLog(records: readonly ProjectRiskSummary[], filters: IssueLogFilters) {
  return records.filter((record) =>
    (filters.type === "all" || record.type === filters.type)
    && (filters.severity === "all" || record.severity === filters.severity)
    && (filters.owner === "all" || (record.ownerUserId ?? "") === filters.owner)
    && (filters.status === "all" || (filters.status === "open" ? record.isOpen : record.status === filters.status)));
}

export function locationLabel(record: Pick<ProjectRiskSummary, "milestoneName" | "stageName" | "taskTitle">) {
  return [record.milestoneName, record.stageName, record.taskTitle].filter(Boolean).join(" › ") || "Chưa gắn vị trí";
}

export function dateLabel(value?: string | null) {
  return value ? formatVietnamDate(value) : "";
}

/** The deadline that drives "Tình trạng hạn": the step SLA of a change request, the due date otherwise. */
export function effectiveDueAt(record: ProjectRiskSummary) {
  return record.type === "change_request" ? record.stepDueAt ?? record.dueAt : record.dueAt;
}

export function fieldDisplay(def: IssueLogFieldDef, value: unknown, memberName: (id: string) => string | undefined = () => undefined) {
  if (value === undefined || value === null || value === "") return "";
  if (def.kind === "select") return def.options?.find((option) => option.value === value)?.label ?? String(value);
  if (def.kind === "user") return memberName(String(value)) ?? String(value);
  if (def.kind === "date") return dateLabel(String(value));
  return String(value);
}

export const ISSUE_LOG_CSV_HEADERS = ["Mã", "Loại", "Nội dung", "Vị trí", "Mức ảnh hưởng", "Người chịu trách nhiệm", "Trạng thái", "Bước CR", "Hạn xử lý", "Tình trạng hạn", "Tuổi (ngày)", "Chuyển cấp", "Bước tiếp theo", "Bằng chứng", "Người báo", "Thời điểm báo", "Thông tin theo loại"] as const;

export function issueLogCsvRows(records: readonly ProjectRiskSummary[]) {
  return records.map((record) => [
    record.code,
    ISSUE_LOG_TYPE_LABELS[record.type],
    record.description,
    locationLabel(record),
    ISSUE_LOG_SEVERITY_LABELS[record.severity],
    record.ownerDisplayName ?? "Chưa phân công",
    ISSUE_LOG_STATUS_LABELS[record.status],
    record.crStep ?? "",
    dateLabel(effectiveDueAt(record)),
    ISSUE_LOG_DUE_STATE_LABELS[record.dueState],
    record.ageDays,
    ISSUE_LOG_ESCALATION_LABELS[record.escalationLevel],
    record.nextStep ?? "",
    record.evidence ?? "",
    record.createdByDisplayName ?? "",
    dateLabel(record.createdAt),
    ISSUE_LOG_EXTENSION_FIELDS[record.type].map((def) => [def.label, fieldDisplay(def, record.extension[def.key])]).filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("; ")
  ]);
}
