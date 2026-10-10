export function uiProjectDateToIso(value: string) {
  if (!value || value === "TBD") return null;
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isDisplayDate(value?: string | null): value is string {
  const normalized = value?.trim();
  return Boolean(
    normalized
    && normalized !== "TBD"
    && normalized !== "Not set"
    && normalized !== "Invalid Date"
  );
}

export function formatProjectDateRange(
  startDate?: string | null,
  dueDate?: string | null,
  fallback = "Not set"
) {
  const start = isDisplayDate(startDate) ? startDate.trim() : "";
  const due = isDisplayDate(dueDate) ? dueDate.trim() : "";

  if (start && due) return `${start} đến ${due}`;
  if (start) return `Từ ${start}`;
  if (due) return `Đến ${due}`;
  return fallback;
}

/**
 * Sort value for a project's due date: the timestamp of the real date (`dueAt`, else the parsed display date).
 * Sorting the formatted string put "Apr 2027" before "Mar 2026". Projects without a date sort last.
 */
export function projectDueSortValue(project: { dueAt?: string | null; dueDate?: string | null }) {
  const time = Date.parse(project.dueAt || (isDisplayDate(project.dueDate) ? project.dueDate : ""));
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
