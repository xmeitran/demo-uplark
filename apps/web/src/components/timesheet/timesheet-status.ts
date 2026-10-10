import type { NodeStatus, ProjectStatus } from "./timesheet-types";

function statusKey(value?: string) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeNodeStatus(value?: string): NodeStatus {
  const normalized = statusKey(value);
  if (["done", "completed", "complete", "closed"].includes(normalized)) return "completed";
  if (["cancelled", "canceled", "archived", "skipped"].includes(normalized)) return "cancelled";
  if (["waiting", "pending", "on_hold"].includes(normalized)) return "waiting";
  if (["in_progress", "doing", "review", "in_review"].includes(normalized)) return "in_progress";
  if (["blocked", "blocking"].includes(normalized)) return "blocked";
  // `paused` and anything unknown: not started.
  return "not_started";
}

export function isPausedTaskStatus(value?: string) {
  return ["paused", "pause"].includes(statusKey(value));
}

/** Completed or cancelled/archived/skipped: not open work, never overdue. */
export function isClosedNodeStatus(status: string) {
  return status === "completed" || status === "cancelled";
}

/** The one overdue rule for Timesheet: open, past its due date, and not a paused task of an On Hold project. */
export function isTaskOverdue(
  task: { status: string; dueDate: string | null; paused?: boolean },
  projectStatus: ProjectStatus,
  today: string
) {
  if (isClosedNodeStatus(task.status) || !task.dueDate || task.dueDate >= today) return false;
  return !(task.paused && projectStatus === "on_hold");
}
