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
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import type { DateRange } from "@/components/filters/filter-dates";
import { dayOf, isWithinRange, matchesAny } from "@/components/filters/filter-values";
import { formatVietnamDate } from "@/lib/vietnam-time";

/** Empty arrays and an empty range mean "all". `statuses` may hold OPEN_ISSUE_STATUS, `owners` may hold UNASSIGNED_ISSUE_OWNER. */
export type IssueLogFilters = { query: string; due: DateRange; types: string[]; severities: string[]; owners: string[]; statuses: string[] };
export const EMPTY_ISSUE_LOG_FILTERS: IssueLogFilters = { query: "", due: { from: "", to: "" }, types: [], severities: [], owners: [], statuses: [] };
export const OPEN_ISSUE_STATUS = "open";
export const UNASSIGNED_ISSUE_OWNER = "__unassigned__";

/** How many of the filters narrow the list. */
export function activeIssueLogFilterCount(filters: IssueLogFilters) {
  return [filters.query.trim(), filters.due.from || filters.due.to, filters.types.length, filters.severities.length, filters.owners.length, filters.statuses.length].filter(Boolean).length;
}

export function filterIssueLog(records: readonly ProjectRiskSummary[], filters: IssueLogFilters) {
  return records.filter((record) =>
    matchesSearch(filters.query, record.code, record.description, record.nextStep, record.ownerDisplayName, locationLabel(record))
    && isWithinRange(dayOf(record.dueAt), filters.due)
    && matchesAny(filters.types, record.type)
    && matchesAny(filters.severities, record.severity)
    && matchesAny(filters.owners, record.ownerUserId || UNASSIGNED_ISSUE_OWNER)
    && (matchesAny(filters.statuses, record.status) || (record.isOpen && filters.statuses.includes(OPEN_ISSUE_STATUS))));
}

export function locationLabel(record: Pick<ProjectRiskSummary, "milestoneName" | "stageName" | "taskTitle">) {
  return [record.milestoneName, record.stageName, record.taskTitle].filter(Boolean).join(" › ") || "Chưa gắn vị trí";
}

/**
 * The form's date picker hands back display text ("Oct 13, 2026"); the API takes the calendar day (YYYY-MM-DD).
 * Text that is not a date is returned as is, so the API still reports it.
 */
export function isoDay(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateLabel(value?: string | null) {
  return value ? formatVietnamDate(value) : "";
}

export function fieldDisplay(def: IssueLogFieldDef, value: unknown, memberName: (id: string) => string | undefined = () => undefined) {
  if (value === undefined || value === null || value === "") return "";
  if (def.kind === "select") return def.options?.find((option) => option.value === value)?.label ?? String(value);
  if (def.kind === "user") return memberName(String(value)) ?? String(value);
  if (def.kind === "date") return dateLabel(String(value));
  return String(value);
}

export const ISSUE_LOG_CSV_HEADERS = ["Mã", "Loại", "Nội dung", "Vị trí", "Mức ảnh hưởng", "Người chịu trách nhiệm", "Trạng thái", "Hạn xử lý", "Tình trạng hạn", "Tuổi (ngày)", "Chuyển cấp", "Bước tiếp theo", "Bằng chứng", "Người báo", "Thời điểm báo", "Thông tin theo loại"] as const;

export function issueLogCsvRows(records: readonly ProjectRiskSummary[]) {
  return records.map((record) => [
    record.code,
    ISSUE_LOG_TYPE_LABELS[record.type],
    record.description,
    locationLabel(record),
    ISSUE_LOG_SEVERITY_LABELS[record.severity],
    record.ownerDisplayName ?? "Chưa phân công",
    ISSUE_LOG_STATUS_LABELS[record.status],
    dateLabel(record.dueAt),
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
