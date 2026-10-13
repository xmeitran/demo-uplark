// Kept in its own module (not in index.ts): `tsx` (the API's dev mode) resolves "@b2b-crm/contracts" to dist/index.d.ts,
// where values declared in index.ts itself do not exist at run time; re-exported modules do.

/**
 * Loại dự án (rules 2, 4.2, V-01): required when a project is created; it decides Layer 2 of every task and the
 * project's P&L item template. Stored on Project.projectType; `internal_worklog` is the fixed DX Internal Worklog project.
 */
export const PROJECT_TYPE_LABELS = { delivery: "Khách hàng", internal: "Nội bộ", training: "Đào tạo" } as const;
export type ProjectTypeCode = keyof typeof PROJECT_TYPE_LABELS;
export const PROJECT_TYPE_OPTIONS = (Object.keys(PROJECT_TYPE_LABELS) as ProjectTypeCode[]).map((value) => ({ value, label: PROJECT_TYPE_LABELS[value] }));
export const INTERNAL_WORKLOG_PROJECT_TYPE = "internal_worklog";
export type ProjectKind = ProjectTypeCode | typeof INTERNAL_WORKLOG_PROJECT_TYPE;

/**
 * The kind a stored project type stands for. Values written before the three types existed (an opportunity stage,
 * "Implementation"…) are customer projects; an empty value is no project at all (null).
 */
export function projectKindOf(projectType: unknown): ProjectKind | null {
  const kind = String(projectType ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (!kind) return null;
  if (kind === INTERNAL_WORKLOG_PROJECT_TYPE) return INTERNAL_WORKLOG_PROJECT_TYPE;
  if (kind === "internal" || kind === "noi_bo") return "internal";
  if (kind === "training" || kind === "dao_tao") return "training";
  return "delivery";
}

/** "Khách hàng" / "Nội bộ" / "Đào tạo"; the worklog project reads as Nội bộ. */
export function projectTypeLabel(projectType: unknown): string {
  const kind = projectKindOf(projectType);
  return kind === null ? "" : PROJECT_TYPE_LABELS[kind === INTERNAL_WORKLOG_PROJECT_TYPE ? "internal" : kind];
}
