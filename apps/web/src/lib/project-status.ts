/**
 * Project Status catalogue for the web app. Mirrors apps/api/src/modules/delivery-handoff/project-status.ts:
 * keep the catalogue, alias and close-reason tables identical to the API's (project-status.spec.ts compares them).
 * Prefer the payload's `statusCode`; the alias table is only the fallback for payloads that do not carry it yet.
 */
export const PROJECT_STATUS_CODES = ["planning", "active", "pilot", "onboarding", "in_review", "on_hold", "at_risk", "completed", "maintenance", "closed"] as const;
export type ProjectStatusCode = (typeof PROJECT_STATUS_CODES)[number];

export interface ProjectStatusDefinition {
  code: ProjectStatusCode;
  label: string;
  /** Display, sort and grouping order. */
  order: number;
  /** Precedence when several conditions hold (1 wins); for the future proposal engine. */
  priorityRank: number;
  reasonRequired: boolean;
  reasonLabel?: string;
}

export const PROJECT_STATUS_CATALOGUE = {
  planning: { code: "planning", label: "Lên kế hoạch", order: 1, priorityRank: 10, reasonRequired: false },
  active: { code: "active", label: "Đang triển khai", order: 2, priorityRank: 9, reasonRequired: false },
  pilot: { code: "pilot", label: "Đang chạy thử", order: 3, priorityRank: 8, reasonRequired: false },
  onboarding: { code: "onboarding", label: "Đang mở rộng sử dụng", order: 4, priorityRank: 7, reasonRequired: false },
  in_review: { code: "in_review", label: "Chờ duyệt nghiệm thu", order: 5, priorityRank: 6, reasonRequired: false },
  on_hold: { code: "on_hold", label: "Tạm dừng", order: 6, priorityRank: 3, reasonRequired: true, reasonLabel: "Lý do tạm dừng" },
  at_risk: { code: "at_risk", label: "Có rủi ro", order: 7, priorityRank: 2, reasonRequired: true, reasonLabel: "Hành động hoặc blocker" },
  completed: { code: "completed", label: "Đã hoàn thành", order: 8, priorityRank: 5, reasonRequired: false },
  maintenance: { code: "maintenance", label: "Đang bảo trì", order: 9, priorityRank: 4, reasonRequired: false },
  closed: { code: "closed", label: "Đã đóng", order: 10, priorityRank: 1, reasonRequired: true, reasonLabel: "Lý do đóng" }
} as const satisfies Record<ProjectStatusCode, ProjectStatusDefinition>;

export const PROJECT_STATUS_ALIASES: Record<ProjectStatusCode, string[]> = {
  planning: ["planning", "not_started", "todo", "discovery", "khảo_sát", "lên_kế_hoạch"],
  active: ["in_progress", "active", "đang_chạy", "đang_triển_khai"],
  pilot: ["pilot", "đang_chạy_thử"],
  onboarding: ["onboarding", "onboard", "đang_mở_rộng_sử_dụng"],
  in_review: ["in_review", "review", "acceptance", "nghiệm_thu", "chờ_duyệt_nghiệm_thu"],
  on_hold: ["on_hold", "paused", "pause", "tạm_dừng"],
  at_risk: ["at_risk", "blocked", "có_rủi_ro"],
  completed: ["completed", "done", "hoàn_thành", "đã_hoàn_thành"],
  maintenance: ["maintenance", "đang_bảo_trì"],
  closed: ["closed", "cancelled", "canceled", "archived", "đã_đóng"]
};

/** Closing a project requires one of these. */
export const PROJECT_CLOSE_REASONS = {
  lost_deal: "Thua deal",
  client_stopped: "Khách dừng hợp tác",
  maintenance_expired: "Hết hạn bảo trì",
  internal_cancel: "Hủy nội bộ"
} as const;
export type ProjectCloseReasonCode = keyof typeof PROJECT_CLOSE_REASONS;

/** The only labels a Project Status is shown with. */
export const PROJECT_STATUS_LABELS = {
  planning: PROJECT_STATUS_CATALOGUE.planning.label,
  active: PROJECT_STATUS_CATALOGUE.active.label,
  pilot: PROJECT_STATUS_CATALOGUE.pilot.label,
  onboarding: PROJECT_STATUS_CATALOGUE.onboarding.label,
  in_review: PROJECT_STATUS_CATALOGUE.in_review.label,
  on_hold: PROJECT_STATUS_CATALOGUE.on_hold.label,
  at_risk: PROJECT_STATUS_CATALOGUE.at_risk.label,
  completed: PROJECT_STATUS_CATALOGUE.completed.label,
  maintenance: PROJECT_STATUS_CATALOGUE.maintenance.label,
  closed: PROJECT_STATUS_CATALOGUE.closed.label
} as const satisfies Record<ProjectStatusCode, string>;

export const UNKNOWN_PROJECT_STATUS_LABEL = "Chưa xác định";
export type ProjectStatusLabel = (typeof PROJECT_STATUS_LABELS)[ProjectStatusCode] | typeof UNKNOWN_PROJECT_STATUS_LABEL;

/** Pill colour family: pilot/onboarding share Active's, maintenance shares Completed's, closed is a neutral slate. */
export const PROJECT_STATUS_COLOR_FAMILY: Record<ProjectStatusCode, "planning" | "active" | "in_review" | "on_hold" | "at_risk" | "completed" | "closed"> = {
  planning: "planning", active: "active", pilot: "active", onboarding: "active", in_review: "in_review",
  on_hold: "on_hold", at_risk: "at_risk", completed: "completed", maintenance: "completed", closed: "closed"
};

/** Status options in catalogue order, valued by label (the web's Project["status"]). */
export const PROJECT_STATUS_OPTIONS = PROJECT_STATUS_CODES.map((code) => ({ code, value: PROJECT_STATUS_LABELS[code], label: PROJECT_STATUS_LABELS[code] }));

/** Set only by the system (acceptance / maintenance flow): never offered in a manual status picker. */
export const PROJECT_SYSTEM_OWNED_STATUS_CODES: readonly ProjectStatusCode[] = ["completed", "maintenance"];

/** What a manual status picker may offer; pass the project's current label so it still shows when system-owned. */
export function manualProjectStatusOptions(currentLabel?: string) {
  return PROJECT_STATUS_OPTIONS.filter((option) => option.value === currentLabel || !PROJECT_SYSTEM_OWNED_STATUS_CODES.includes(option.code));
}

/**
 * For a quick-edit form with no reason field: only statuses that save without a reason, plus the current one.
 * A closed project offers nothing else, because leaving Closed is a reopen and needs a reason.
 */
export function quickProjectStatusOptions(currentLabel: string) {
  const closed = currentLabel === PROJECT_STATUS_LABELS.closed;
  return manualProjectStatusOptions(currentLabel).filter((option) => option.value === currentLabel || (!closed && !PROJECT_STATUS_CATALOGUE[option.code].reasonRequired));
}

export function normalizeProjectStatus(status: unknown): ProjectStatusCode | null {
  const key = String(status ?? "").trim().toLowerCase().replace(/[_\s-]+/g, "_");
  return PROJECT_STATUS_CODES.find((code) => PROJECT_STATUS_ALIASES[code].includes(key)) ?? null;
}

/** Canonical status of a project payload: `statusCode` first, then the raw status; null when neither is known. */
export function resolveProjectStatus(project?: { statusCode?: unknown; status?: unknown } | null): ProjectStatusCode | null {
  return normalizeProjectStatus(project?.statusCode) ?? normalizeProjectStatus(project?.status);
}

/** Unknown or missing status is shown as "Chưa xác định", never as active. */
export function projectStatusLabel(code: ProjectStatusCode | null | undefined): ProjectStatusLabel {
  return code ? PROJECT_STATUS_LABELS[code] : UNKNOWN_PROJECT_STATUS_LABEL;
}

/** Catalogue position for sorting/grouping; unknown statuses go last. Accepts a code, alias or label. */
export function projectStatusOrder(status: unknown): number {
  const code = normalizeProjectStatus(status);
  return code ? PROJECT_STATUS_CATALOGUE[code].order : PROJECT_STATUS_CODES.length + 1;
}

export type ProjectStatusColorFamily = (typeof PROJECT_STATUS_COLOR_FAMILY)[ProjectStatusCode];

/** A page's per-family pill style spread over every catalogue label, so each page keeps its own six colours. */
export function projectStatusStyleMap<T>(families: Record<ProjectStatusColorFamily, T>, unknown: T): Record<ProjectStatusLabel, T> {
  const entries = PROJECT_STATUS_CODES.map((code) => [PROJECT_STATUS_LABELS[code], families[PROJECT_STATUS_COLOR_FAMILY[code]]]);
  return { ...Object.fromEntries(entries), [UNKNOWN_PROJECT_STATUS_LABEL]: unknown } as Record<ProjectStatusLabel, T>;
}
