import { localDateKey } from "../../shared/working-days";
import { isActualTimeEntry } from "./member-participation";

const COMPLETED_TASK_STATUSES = new Set(["done", "completed", "closed"]);
const CLOSED_TASK_STATUSES = new Set(["done", "completed", "closed", "cancelled", "canceled"]);
const CANCELLED_TASK_STATUSES = new Set(["cancelled", "canceled"]);

export type DerivedTaskStatus = "not_started" | "waiting" | "in_progress" | "completed" | "overdue" | "blocked" | "cancelled";

export interface TaskStatusTimeEntry {
  minutes?: number;
  approvalStatus?: unknown;
  workDate?: Date | string | null;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
}

export interface TaskStatusSubtask {
  derivedStatus?: DerivedTaskStatus | string | null;
  status?: string | null;
}

export interface DeriveTaskStatusInput {
  rawStatus?: unknown;
  plannedStartAt?: Date | string | null;
  dueAt?: Date | string | null;
  estimateMinutes?: number | null;
  loggedMinutes?: number | null;
  timeEntries?: ReadonlyArray<TaskStatusTimeEntry> | null;
  subtasks?: ReadonlyArray<TaskStatusSubtask> | null;
  now?: Date;
}

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

function normalizeStatus(status: unknown): string {
  return String(status ?? "").trim().toLowerCase();
}

/**
 * Task dates are entered as calendar dates by users and persisted as ISO values.
 * Comparing the date portion keeps a task due on a given day open for that whole day.
 */
function dateKey(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  // The day in Vietnam time: between 00:00 and 07:00 local the UTC date is still yesterday.
  return localDateKey(date);
}

function hasActualTimeOutsidePlan(input: DeriveTaskStatusInput): boolean {
  const startKey = dateKey(input.plannedStartAt);
  const dueKey = dateKey(input.dueAt);
  if ((!startKey && !dueKey) || !input.timeEntries?.length) return false;

  return input.timeEntries.some((entry) => {
    if (!isActualTimeEntry(entry)) return false;
    const entryKey = dateKey(entry.workDate ?? entry.startAt ?? entry.endAt);
    if (!entryKey) return false;
    return Boolean((startKey && entryKey < startKey) || (dueKey && entryKey > dueKey));
  });
}

function childStatus(child: TaskStatusSubtask): DerivedTaskStatus {
  const status = normalizeStatus(child.derivedStatus ?? child.status);
  if (status === "done" || status === "completed" || status === "closed") return "completed";
  if (status === "overdue") return "overdue";
  if (status === "waiting" || status === "pending") return "waiting";
  if (status === "blocked") return "blocked";
  if (status === "in_progress" || status === "in-progress" || status === "doing") return "in_progress";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "not_started";
}

/**
 * Derives the status people should see from the task plan and actual work.
 * The raw database status remains the user's/system confirmation input; this function
 * is deliberately pure so every API response and gate can use the same rules.
 */
export function deriveTaskStatus(input: DeriveTaskStatusInput): DerivedTaskStatus {
  const rawStatus = normalizeStatus(input.rawStatus);
  const now = input.now ?? new Date();
  const todayKey = dateKey(now);
  const plannedStartKey = dateKey(input.plannedStartAt);
  const dueKey = dateKey(input.dueAt);
  const actualMinutes = input.loggedMinutes ?? (input.timeEntries ?? []).reduce(
    (sum, entry) => sum + (isActualTimeEntry(entry) ? Number(entry.minutes ?? 0) : 0),
    0,
  );
  const subtasks = input.subtasks ?? [];
  // A cancelled sub-task is out of the work: it neither blocks nor completes the parent (it used to block it forever).
  const children = subtasks.map(childStatus).filter((status) => status !== "cancelled");
  const hasChildren = children.length > 0;
  const allChildrenCompleted = hasChildren && children.every((status) => status === "completed");
  const childIsOverdue = children.some((status) => status === "overdue");

  if (isCancelledTaskStatus(rawStatus)) return "cancelled";
  if (rawStatus === "archived") return "completed";

  const isExplicitlyCompleted = isCompletedTaskStatus(rawStatus);
  if (hasChildren) {
    // A parent still reflects an overdue child until every child is resolved.
    if (childIsOverdue) return "overdue";
    // A parent is only complete after its children are complete and the parent itself
    // has been confirmed. A raw "done" status is that confirmation in the current model.
    if (allChildrenCompleted && isExplicitlyCompleted) return "completed";
    if (dueKey && todayKey && dueKey < todayKey) return "overdue";
    if (children.includes("blocked")) return "blocked";
    if (children.includes("waiting")) return "waiting";
    if (children.includes("in_progress") || rawStatus === "in_progress") return "in_progress";
    return "not_started";
  }

  // For a normal task, an explicit completion is the user's final confirmation.
  // Late actual work remains visible in history but must not turn the completed task
  // back into an overdue task.
  if (isExplicitlyCompleted) return "completed";
  if (hasActualTimeOutsidePlan(input)) return "overdue";
  if (dueKey && todayKey && dueKey < todayKey) return "overdue";
  if (rawStatus === "blocked") return "blocked";
  if (rawStatus === "waiting" || rawStatus === "pending") return "waiting";
  if ((input.estimateMinutes ?? 0) > 0 && actualMinutes >= (input.estimateMinutes ?? 0)) return "completed";
  if (actualMinutes > 0 || rawStatus === "in_progress" || rawStatus === "doing") return "in_progress";
  if (plannedStartKey && todayKey && plannedStartKey > todayKey) return "not_started";
  return "not_started";
}
