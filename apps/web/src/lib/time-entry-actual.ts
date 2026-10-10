const NOT_ACTUAL = new Set(["rejected", "cancelled", "planned"]);

/**
 * The one definition of "actual hours": every time entry except rejected, cancelled or planned ones.
 * A missing status counts as actual. Mirrors the API rule; do not re-implement it per screen.
 */
export function isActualTimeEntry(entry?: { approvalStatus?: string | null } | null) {
  return !NOT_ACTUAL.has(String(entry?.approvalStatus ?? "").trim().toLowerCase());
}
