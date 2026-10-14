export type MilestoneWorkStatus = "upcoming" | "in-progress" | "at-risk" | "done";
export type MilestoneTaskStatus = "todo" | "upcoming" | "in-progress" | "at-risk" | "done" | "waiting" | "blocked" | "overdue" | "cancelled";

/**
 * A milestone cannot be shown as complete while one of its visible tasks is
 * overdue, blocked, or still open. Gate/stage status is only the fallback for
 * milestones that do not have tasks yet.
 */
export function deriveMilestoneWorkStatus(input: {
  stageStatus: MilestoneWorkStatus;
  taskStatuses: readonly MilestoneTaskStatus[];
}): MilestoneWorkStatus {
  const { stageStatus, taskStatuses } = input;
  if (taskStatuses.some((status) => status === "at-risk" || status === "overdue" || status === "blocked")) return "at-risk";
  if (taskStatuses.length === 0) return stageStatus;
  if (taskStatuses.every((status) => status === "done" || status === "cancelled")) return "done";
  return "in-progress";
}
