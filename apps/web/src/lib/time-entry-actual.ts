const NOT_ACTUAL = new Set(["rejected", "cancelled", "planned"]);

/**
 * The one definition of "actual hours": every time entry except rejected, cancelled or planned ones.
 * A missing status counts as actual. Mirrors the API rule; do not re-implement it per screen.
 */
export function isActualTimeEntry(entry?: { approvalStatus?: string | null } | null) {
  return !NOT_ACTUAL.has(String(entry?.approvalStatus ?? "").trim().toLowerCase());
}

/** D-16: marker on a time log written while its project was "Tạm dừng" (TaskTimeEntrySummary.loggedWhileOnHold). */
export const ON_HOLD_LOG_REVIEW_LABEL = "Dự án đang tạm dừng — PM rà soát";

/** Section 9.2: marker on the logs of a day above 8 hours dated before the rule applied; the hours are kept as logged. */
export const BEFORE_EIGHT_HOUR_RULE_LABEL = "Trước quy tắc 8 giờ";

/**
 * V-07: a time log needs no approval — saving is recording. The stored approvalStatus only still tells apart the
 * legacy rows a reviewer once rejected; nothing is ever "chờ duyệt".
 */
export function timeEntryRecordLabel(entry?: { approvalStatus?: string | null } | null) {
  return isActualTimeEntry(entry) ? "Đã ghi nhận" : "Không tính";
}
