/**
 * The single project status catalogue (rules 5.1 / V-18 / V-22 / 9.3). Stored values may still be legacy aliases;
 * compare through normalizeProjectStatus. Mirrored by apps/web/src/lib/project-status.ts — keep both tables identical.
 */
export const PROJECT_STATUS_CODES = ["planning", "active", "pilot", "onboarding", "in_review", "on_hold", "at_risk", "completed", "maintenance", "closed"] as const;
export type ProjectStatusCode = (typeof PROJECT_STATUS_CODES)[number];

export interface ProjectStatusDefinition {
  code: ProjectStatusCode;
  label: string;
  /** Display, sort and grouping order. */
  order: number;
  /** Precedence when several conditions hold (1 wins). Exported for the proposal engine; nothing computes proposals yet. */
  priorityRank: number;
  reasonRequired: boolean;
  reasonLabel?: string;
}

export const PROJECT_STATUS_CATALOGUE: Record<ProjectStatusCode, ProjectStatusDefinition> = {
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
};

/** Canonical code -> every stored value that means it (first entry is what legacy rows mostly hold). */
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

/** Closing a project requires one of these (V-22). */
export const PROJECT_CLOSE_REASONS = {
  lost_deal: "Thua deal",
  client_stopped: "Khách dừng hợp tác",
  maintenance_expired: "Hết hạn bảo trì",
  internal_cancel: "Hủy nội bộ"
} as const;
export type ProjectCloseReasonCode = keyof typeof PROJECT_CLOSE_REASONS;

export function isProjectCloseReason(value: unknown): value is ProjectCloseReasonCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROJECT_CLOSE_REASONS, value);
}

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

/** Closed is terminal: callers use this to block writes on a closed project (e.g. time logging, D-16). */
export function isProjectClosed(status: unknown): boolean {
  return normalizeProjectStatus(status) === "closed";
}

export function projectStatusLabel(status: unknown): string | undefined {
  const code = normalizeProjectStatus(status);
  return code ? PROJECT_STATUS_CATALOGUE[code].label : undefined;
}

/** Stored values to match when filtering a list by status; unknown values are matched as-is. */
export function projectStatusFilterValues(status: string | null): string[] | null {
  if (!status) return null;
  const code = normalizeProjectStatus(status);
  return code ? PROJECT_STATUS_ALIASES[code] : [statusKey(status)];
}

const CLOSE_ROLE_CODES = ["FOUNDER_GM", "WORKSPACE_ADMIN", "SALES_OWNER"];
const REOPEN_ROLE_CODES = ["FOUNDER_GM", "WORKSPACE_ADMIN"];

/** "Admin - PM hoặc User - BD": whoever manages the project, a workspace admin, or business development. */
export function canCloseProject(roleCodes: readonly string[] = [], managesProject = false): boolean {
  return managesProject || roleCodes.some((role) => CLOSE_ROLE_CODES.includes(role));
}

/** Only an admin may take a project out of Closed. */
export function canReopenProject(roleCodes: readonly string[] = []): boolean {
  return roleCodes.some((role) => REOPEN_ROLE_CODES.includes(role));
}

export interface ProjectStatusChange {
  changed: boolean;
  from: string;
  to: string;
  /** Vietnamese message for a 400 when the change is not allowed. */
  error?: string;
}

/**
 * V-18: On hold needs a reason, At risk an action/blocker, Closed a close reason from the list (its note is optional).
 * Leaving Closed is a reopen and needs a reason. An unchanged status needs nothing. Who may do it is checked by the caller.
 */
export function validateProjectStatusChange(currentStatus: unknown, nextStatus: unknown, reason: unknown, closeReasonCode?: unknown): ProjectStatusChange {
  const from = normalizeProjectStatus(currentStatus) ?? statusKey(currentStatus);
  const to = normalizeProjectStatus(nextStatus) ?? statusKey(nextStatus);
  const change: ProjectStatusChange = { changed: from !== to, from, to };
  if (!change.changed) return change;
  if (to === "closed") {
    return isProjectCloseReason(closeReasonCode) ? change : { ...change, error: `Đóng dự án bắt buộc chọn lý do đóng: ${Object.values(PROJECT_CLOSE_REASONS).join(" / ")}.` };
  }
  if (String(reason ?? "").trim()) return change;
  if (from === "closed") return { ...change, error: "Dự án đã đóng. Mở lại dự án bắt buộc phải nhập lý do." };
  if (to === "on_hold") return { ...change, error: "Chuyển dự án sang Tạm dừng bắt buộc phải nhập lý do tạm dừng." };
  if (to === "at_risk") return { ...change, error: "Chuyển dự án sang Có rủi ro bắt buộc phải ghi kèm hành động hoặc blocker." };
  return change;
}
