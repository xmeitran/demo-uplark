const COMPLETED_TASK_STATUSES = new Set(["done", "completed", "closed"]);

export function isCompletedTaskStatus(status: unknown): boolean {
  return COMPLETED_TASK_STATUSES.has(String(status ?? "").trim().toLowerCase());
}
