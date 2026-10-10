const COMPLETED_TASK_STATUSES = new Set(["done", "completed", "closed"]);
const CLOSED_TASK_STATUSES = new Set(["done", "completed", "closed", "cancelled", "canceled"]);
const CANCELLED_TASK_STATUSES = new Set(["cancelled", "canceled"]);

/**
 * The single list of terminal task/stage statuses: work in one of these is closed and is never open, overdue or reminded.
 * (apps/worker cannot import from the API; task-reminder-rules.ts mirrors this list.)
 */
export const CLOSED_WORK_STATUSES = ["completed", "done", "cancelled", "canceled", "closed", "archived"];

export function isClosedWorkStatus(status: unknown): boolean {
  return CLOSED_WORK_STATUSES.includes(String(status ?? "").trim().toLowerCase());
}

export function isCompletedTaskStatus(status: unknown): boolean {
  return COMPLETED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function isClosedTaskStatus(status: unknown): boolean {
  return CLOSED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function isCancelledTaskStatus(status: unknown): boolean {
  return CANCELLED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}
