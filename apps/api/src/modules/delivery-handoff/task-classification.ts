/**
 * Two-layer work classification (rules section 4, D-02..D-04).
 * Layer 1 (vai trò đóng góp) is set on the stage of the milestone framework and inherited by its tasks.
 * Layer 2 (bối cảnh công việc) is never chosen: deriveTaskTypeLayer2 is the only place it is decided.
 * Labels are mirrored by apps/web/src/lib/task-classification.ts — keep both tables identical.
 */
import { INTERNAL_WORKLOG_PROJECT_TYPE, projectKindOf } from "@b2b-crm/contracts";

export const TASK_TYPE_LAYER1_LABELS = { PRE_SALE: "Pre-sale", DELIVERY: "Delivery", PM: "PM" } as const;
export type TaskTypeLayer1 = keyof typeof TASK_TYPE_LAYER1_LABELS;

export const TASK_TYPE_LAYER2_LABELS = {
  CUSTOMER_PROJECT: "Dự án tính phí",
  TICKET_MAINTENANCE: "Ticket/bảo trì",
  INTERNAL_PROJECT: "Nội bộ"
} as const;
export type TaskTypeLayer2 = keyof typeof TASK_TYPE_LAYER2_LABELS;

/** Shown wherever a layer has no value: the system could not classify, nobody guessed. */
export const TASK_TYPE_PENDING_LABEL = "Chờ phân loại";

export function isTaskTypeLayer1(value: unknown): value is TaskTypeLayer1 {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASK_TYPE_LAYER1_LABELS, value);
}

export function taskTypeLayer1Label(value: unknown): string {
  return isTaskTypeLayer1(value) ? TASK_TYPE_LAYER1_LABELS[value] : TASK_TYPE_PENDING_LABEL;
}

export function taskTypeLayer2Label(value: unknown): string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASK_TYPE_LAYER2_LABELS, value)
    ? TASK_TYPE_LAYER2_LABELS[value as TaskTypeLayer2]
    : TASK_TYPE_PENDING_LABEL;
}

/** The fixed "DX Internal Worklog" project (D-08) is marked by this project type. */
export { INTERNAL_WORKLOG_PROJECT_TYPE };

export function isInternalWorklogProjectType(projectType: unknown): boolean {
  return projectKindOf(projectType) === INTERNAL_WORKLOG_PROJECT_TYPE;
}

/** Loại Khách hàng: the only kind with a Giá trị dự án, payment confirmations and chargeable hours. */
export function isCustomerProjectType(projectType: unknown): boolean {
  return projectKindOf(projectType) === "delivery";
}

export interface TaskTypeLayer2Context {
  /** Project.projectType (Loại dự án); null when the task hangs off no project. */
  projectType: string | null | undefined;
  /** Stage position against the P&L close gate (G7, section 3.4): true = after, false = before, null = not known. */
  afterPnlClose: boolean | null | undefined;
}

/**
 * Table 4.2 (v2, chốt 13/10): Layer 2 follows Loại dự án and the task's position, row by row —
 *  1. DX Internal Worklog project -> Nội bộ.
 *  5. Loại Nội bộ or Đào tạo (không tính phí) -> Nội bộ.
 *  2. Loại Khách hàng, before the P&L close gate -> Dự án tính phí. An internal UpBase project that counts mandays is
 *     created as Loại Khách hàng (row 4), so it lands here too.
 *  3. Loại Khách hàng, from Milestone 4 on (after the gate) -> Ticket/bảo trì.
 * Returns null ("Chờ phân loại") for a task without a project, or a stage with no known position against the gate.
 */
export function deriveTaskTypeLayer2(context: TaskTypeLayer2Context): TaskTypeLayer2 | null {
  const kind = projectKindOf(context.projectType);
  if (!kind) return null;
  if (kind !== "delivery") return "INTERNAL_PROJECT";
  if (context.afterPnlClose === true) return "TICKET_MAINTENANCE";
  if (context.afterPnlClose === false) return "CUSTOMER_PROJECT";
  return null;
}

/** Matrix 4.3: the only invalid cell is Pre-sale x Ticket/bảo trì (an upsell to a maintenance client is a new project). */
export function isValidTaskTypePair(layer1: string | null | undefined, layer2: string | null | undefined): boolean {
  return !(layer1 === "PRE_SALE" && layer2 === "TICKET_MAINTENANCE");
}

/**
 * D-02: a sub-task repeats its parent, a framework task takes its stage's value. A requested value only counts on a
 * top-level task, and a value that differs from the stage's is an override reserved for Admin accounts / the project manager.
 */
export function resolveTaskTypeLayer1(input: {
  requested: string | null | undefined;
  parentLayer1?: string | null;
  isSubtask: boolean;
  stageLayer1: string | null | undefined;
  canOverride: boolean;
}): { value: TaskTypeLayer1 | null; overridden: boolean } {
  if (input.isSubtask) return { value: isTaskTypeLayer1(input.parentLayer1) ? input.parentLayer1 : null, overridden: false };
  const inherited = isTaskTypeLayer1(input.stageLayer1) ? input.stageLayer1 : null;
  if (!isTaskTypeLayer1(input.requested) || input.requested === inherited) return { value: inherited, overridden: false };
  // No stage value to inherit: whoever adds the task to the framework fills the field (V-03).
  if (!inherited) return { value: input.requested, overridden: false };
  return input.canOverride ? { value: input.requested, overridden: true } : { value: inherited, overridden: false };
}

// ── P&L spec, decision 12/10 point 5: Layer 2 on a TIME LOG is chosen by the person logging ──────────────────────────
// The task keeps its derived Layer 2 (above); the entry stores both. A choice that differs from the task's value is
// saved, never refused: the hour gate holds it at "Chờ xử lý — Lớp 2 không khớp" and the PM gets a data warning.

export function isTaskTypeLayer2(value: unknown): value is TaskTypeLayer2 {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASK_TYPE_LAYER2_LABELS, value);
}

export const LAYER2_MISMATCH_LABEL = "Lớp 2 không khớp";
/** Warning type and dedupe key: one open warning per project. */
export const LAYER2_MISMATCH_WARNING_TYPE = "DL-02";

/**
 * Legacy rows (no selection) never mismatch. A task whose Layer 2 could not be derived is "thiếu phân loại",
 * not a mismatch: there is nothing to compare the choice with.
 */
export function isLayer2Mismatch(selected: string | null | undefined, derived: string | null | undefined): boolean {
  return Boolean(selected) && Boolean(derived) && selected !== derived;
}
