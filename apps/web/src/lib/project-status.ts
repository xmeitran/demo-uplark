/**
 * Project Status catalogue for the web app. Mirrors apps/api/src/modules/delivery-handoff/project-status.ts:
 * keep the alias table identical to the API's. Prefer the payload's `statusCode`; the alias table is only the
 * fallback for payloads that do not carry it yet.
 */
export const PROJECT_STATUS_CODES = ["planning", "active", "in_review", "on_hold", "at_risk", "completed"] as const;
export type ProjectStatusCode = (typeof PROJECT_STATUS_CODES)[number];

const PROJECT_STATUS_ALIASES: Record<ProjectStatusCode, string[]> = {
  planning: ["planning", "not_started", "todo"],
  active: ["in_progress", "active", "onboarding", "discovery"],
  in_review: ["in_review", "review", "acceptance"],
  on_hold: ["on_hold", "paused", "pause"],
  at_risk: ["at_risk", "blocked", "cancelled"],
  completed: ["completed", "done", "closed"]
};

/** The owner's standard catalogue: the only labels a Project Status is shown with. */
export const PROJECT_STATUS_LABELS = {
  planning: "Planning",
  active: "Active",
  in_review: "In Review",
  on_hold: "On Hold",
  at_risk: "At Risk",
  completed: "Completed"
} as const satisfies Record<ProjectStatusCode, string>;

export const UNKNOWN_PROJECT_STATUS_LABEL = "Chưa xác định";
export type ProjectStatusLabel = (typeof PROJECT_STATUS_LABELS)[ProjectStatusCode] | typeof UNKNOWN_PROJECT_STATUS_LABEL;

export function normalizeProjectStatus(status: unknown): ProjectStatusCode | null {
  const key = String(status ?? "").trim().toLowerCase().replace(/[_\s-]+/g, "_");
  return PROJECT_STATUS_CODES.find((code) => PROJECT_STATUS_ALIASES[code].includes(key)) ?? null;
}

/** Canonical status of a project payload: `statusCode` first, then the raw status; null when neither is known. */
export function resolveProjectStatus(project?: { statusCode?: unknown; status?: unknown } | null): ProjectStatusCode | null {
  return normalizeProjectStatus(project?.statusCode) ?? normalizeProjectStatus(project?.status);
}

/** Unknown or missing status is shown as "Chưa xác định", never as Active. */
export function projectStatusLabel(code: ProjectStatusCode | null | undefined): ProjectStatusLabel {
  return code ? PROJECT_STATUS_LABELS[code] : UNKNOWN_PROJECT_STATUS_LABEL;
}
