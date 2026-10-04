const COMPLETED_TASK_STATUSES = new Set(["done", "completed", "closed"]);
const CLOSED_TASK_STATUSES = new Set(["done", "completed", "closed", "cancelled", "canceled"]);
const CANCELLED_TASK_STATUSES = new Set(["cancelled", "canceled"]);

export function isCompletedTaskStatus(status: unknown): boolean {
  return COMPLETED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function isClosedTaskStatus(status: unknown): boolean {
  return CLOSED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function isCancelledTaskStatus(status: unknown): boolean {
  return CANCELLED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}
