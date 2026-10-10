/** EV-064: the single project status catalogue. Stored values may still be legacy aliases; compare through normalizeProjectStatus. */
export const PROJECT_STATUS_CODES = ["planning", "active", "in_review", "on_hold", "at_risk", "completed"] as const;
export type ProjectStatusCode = (typeof PROJECT_STATUS_CODES)[number];

/** Canonical code -> every stored value that means it (first entry is what legacy rows mostly hold). */
export const PROJECT_STATUS_ALIASES: Record<ProjectStatusCode, string[]> = {
  planning: ["planning", "not_started", "todo"],
  active: ["in_progress", "active", "onboarding", "discovery"],
  in_review: ["in_review", "review", "acceptance"],
  on_hold: ["on_hold", "paused", "pause"],
  at_risk: ["at_risk", "blocked", "cancelled"],
  completed: ["completed", "done", "closed"]
};

function statusKey(status: unknown) {
  return String(status ?? "").trim().toLowerCase().replace(/[_\s-]+/g, "_");
}

export function normalizeProjectStatus(status: unknown): ProjectStatusCode | null {
  const key = statusKey(status);
  return PROJECT_STATUS_CODES.find((code) => PROJECT_STATUS_ALIASES[code].includes(key)) ?? null;
}

/** True for a catalogue code or one of its legacy aliases; anything else must be rejected on write. */
export function isKnownProjectStatus(status: unknown): boolean {
  return normalizeProjectStatus(status) !== null;
}

/** Stored values to match when filtering a list by status; unknown values are matched as-is. */
export function projectStatusFilterValues(status: string | null): string[] | null {
  if (!status) return null;
  const code = normalizeProjectStatus(status);
  return code ? PROJECT_STATUS_ALIASES[code] : [statusKey(status)];
}

export interface ProjectStatusChange {
  changed: boolean;
  from: string;
  to: string;
  /** Vietnamese message for a 400 when the change is not allowed. */
  error?: string;
}

/** On Hold needs a reason and At Risk needs an action/blocker; an unchanged status needs nothing. */
export function validateProjectStatusChange(currentStatus: unknown, nextStatus: unknown, reason: unknown): ProjectStatusChange {
  const from = normalizeProjectStatus(currentStatus) ?? statusKey(currentStatus);
  const to = normalizeProjectStatus(nextStatus) ?? statusKey(nextStatus);
  const change: ProjectStatusChange = { changed: from !== to, from, to };
  if (!change.changed || String(reason ?? "").trim()) return change;
  if (to === "on_hold") return { ...change, error: "Chuyển dự án sang On Hold bắt buộc phải nhập lý do." };
  if (to === "at_risk") return { ...change, error: "Chuyển dự án sang At Risk bắt buộc phải ghi kèm action hoặc blocker." };
  return change;
}
