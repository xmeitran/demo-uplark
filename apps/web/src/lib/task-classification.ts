/**
 * Two-layer work classification (rules section 4): the one label map every screen and export uses.
 * Mirrors apps/api/src/modules/delivery-handoff/task-classification.ts — keep both tables identical.
 * Layer 1 is inherited from the stage; a task's Layer 2 is derived by the API and read-only. On a time log the person
 * logging chooses Layer 2 (see the bottom of this file).
 */
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

export const TASK_TYPE_LAYER1_FIELD_LABEL = "Lớp 1 · Vai trò đóng góp";
export const TASK_TYPE_LAYER2_FIELD_LABEL = "Lớp 2 · Bối cảnh công việc";

export const TASK_TYPE_LAYER1_OPTIONS = (Object.keys(TASK_TYPE_LAYER1_LABELS) as TaskTypeLayer1[])
  .map((value) => ({ value, label: TASK_TYPE_LAYER1_LABELS[value] }));

function labelOf(labels: Record<string, string>, value: unknown) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : TASK_TYPE_PENDING_LABEL;
}

export function taskTypeLayer1Label(value: unknown): string {
  return labelOf(TASK_TYPE_LAYER1_LABELS, value);
}

export function taskTypeLayer2Label(value: unknown): string {
  return labelOf(TASK_TYPE_LAYER2_LABELS, value);
}

/** "Delivery / Dự án tính phí" for table cells, history lines and export columns. */
export function taskTypeLabel(layer1: unknown, layer2: unknown): string {
  return `${taskTypeLayer1Label(layer1)} / ${taskTypeLayer2Label(layer2)}`;
}

// ── Layer 2 on a time log (P&L spec, decision 12/10 point 5) ─────────────────────────────────────────────────────────
// The task's Layer 2 stays derived and read-only; the person logging time picks one per log. A choice that differs
// from the task's is saved and shown as "Lớp 2 không khớp" until it is corrected.

export const TASK_TYPE_LAYER2_OPTIONS = (Object.keys(TASK_TYPE_LAYER2_LABELS) as TaskTypeLayer2[])
  .map((value) => ({ value, label: TASK_TYPE_LAYER2_LABELS[value] }));

export const LAYER2_MISMATCH_LABEL = "Lớp 2 không khớp";

/** The Layer 2 correction API answers 409 naming G7 once the project P&L is closed: only an Admin, with a reason, may still change it. */
export function isLayer2ReasonRequired(status: number, message: string): boolean {
  return status === 409 && /\bG7\b/.test(message);
}

export function isTaskTypeLayer2(value: unknown): value is TaskTypeLayer2 {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASK_TYPE_LAYER2_LABELS, value);
}

/** Matrix 4.3: Pre-sale × Ticket/bảo trì is the one impossible pair, so that option is not offered on a Pre-sale task. */
export function layer2OptionsForTask(taskTypeLayer1: unknown) {
  return TASK_TYPE_LAYER2_OPTIONS.filter((option) => !(taskTypeLayer1 === "PRE_SALE" && option.value === "TICKET_MAINTENANCE"));
}

/** Pre-selection of the log form: the task's derived value when there is one, otherwise nothing (the person must choose). */
export function defaultSelectedLayer2(taskTypeLayer2: unknown): TaskTypeLayer2 | "" {
  return isTaskTypeLayer2(taskTypeLayer2) ? taskTypeLayer2 : "";
}
