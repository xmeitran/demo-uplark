export const TASK_REMINDER_TIME_ZONE = "Asia/Ho_Chi_Minh" as const;
export const TASK_REMINDER_TARGET_MINUTES = 480 as const;

const HCM_OFFSET_MINUTES = 7 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type TaskReminderSlot = "morning_plan" | "pm_follow_up" | "evening_actual";

export type ReminderTask = {
  id: string;
  title: string;
  projectName?: string;
  assigneeUserId?: string;
  plannedStartAt?: Date;
  dueAt?: Date;
  estimateMinutes: number;
};

export type ReminderPlanningBlock = {
  taskId: string;
  plannedMinutes: number;
};

export type ReminderTimeEntry = {
  taskId: string;
  minutes: number;
};

export type ReminderUserFacts = {
  userId: string;
  displayName: string;
  larkOpenId?: string;
  tasks: ReminderTask[];
  planningBlocks: ReminderPlanningBlock[];
  timeEntries: ReminderTimeEntry[];
};

export type MissingTaskField = "Người phụ trách" | "Ngày bắt đầu" | "Hạn hoàn tất" | "Giờ ước tính";

export type TaskFieldIssue = {
  taskId: string;
  taskTitle: string;
  projectName?: string;
  missingFields: MissingTaskField[];
};

export type PlanReminderIssue = {
  kind: "plan";
  userId: string;
  displayName: string;
  larkOpenId?: string;
  hasPlan: boolean;
  taskFieldIssues: TaskFieldIssue[];
};

export type ActualReminderIssue = {
  kind: "actual";
  userId: string;
  displayName: string;
  larkOpenId?: string;
  totalMinutes: number;
  targetMinutes: number;
  taskWithoutActual: Array<{ taskId: string; taskTitle: string; projectName?: string }>;
};

export type VietnamWorkdayWindow = {
  localDate: string;
  localMinute: number;
  weekday: number;
  startAt: Date;
  endAt: Date;
};

export const TASK_REMINDER_SCHEDULE: ReadonlyArray<{ slot: TaskReminderSlot; minute: number }> = [
  { slot: "morning_plan", minute: 8 * 60 + 30 },
  { slot: "pm_follow_up", minute: 14 * 60 },
  { slot: "evening_actual", minute: 17 * 60 + 30 }
];

export function normalizeReminderSchedule(value: unknown): ReadonlyArray<{ slot: TaskReminderSlot; minute: number }> {
  if (!Array.isArray(value)) return TASK_REMINDER_SCHEDULE;
  const slots = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as { slot?: unknown; time?: unknown; enabled?: unknown };
    if (item.enabled === false || typeof item.slot !== "string" || typeof item.time !== "string") return [];
    const match = /^(\d{2}):(\d{2})$/.exec(item.time);
    if (!match) return [];
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59 || !["morning_plan", "pm_follow_up", "evening_actual"].includes(item.slot)) return [];
    return [{ slot: item.slot as TaskReminderSlot, minute: hour * 60 + minute }];
  });
  return slots.length ? slots.sort((left, right) => left.minute - right.minute) : TASK_REMINDER_SCHEDULE;
}

export function getVietnamWorkdayWindow(at: Date): VietnamWorkdayWindow {
  const local = new Date(at.getTime() + HCM_OFFSET_MINUTES * MINUTE_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const startAt = new Date(Date.UTC(year, month - 1, day) - HCM_OFFSET_MINUTES * MINUTE_MS);

  return {
    localDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    localMinute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekday: local.getUTCDay(),
    startAt,
    endAt: new Date(startAt.getTime() + DAY_MS)
  };
}

export function isWorkingDay(window: VietnamWorkdayWindow, excludedDates: ReadonlySet<string>) {
  return window.weekday !== 0 && window.weekday !== 6 && !excludedDates.has(window.localDate);
}

function taskMissingFields(task: ReminderTask): MissingTaskField[] {
  const fields: MissingTaskField[] = [];
  if (!task.assigneeUserId) fields.push("Người phụ trách");
  if (!task.plannedStartAt) fields.push("Ngày bắt đầu");
  if (!task.dueAt) fields.push("Hạn hoàn tất");
  if (task.estimateMinutes <= 0) fields.push("Giờ ước tính");
  return fields;
}

function taskTouchesDay(task: ReminderTask, window: VietnamWorkdayWindow) {
  if (task.plannedStartAt && task.plannedStartAt < window.endAt && (!task.dueAt || task.dueAt >= window.startAt)) {
    return true;
  }
  return Boolean(task.dueAt && task.dueAt >= window.startAt && task.dueAt < window.endAt);
}

export function findPlanIssues(users: ReminderUserFacts[], window: VietnamWorkdayWindow): PlanReminderIssue[] {
  return users.flatMap((user) => {
    const plannedTaskIds = new Set(user.planningBlocks.map((block) => block.taskId));
    const hasPlan = user.planningBlocks.length > 0;
    const relevantTasks = user.tasks.filter((task) => plannedTaskIds.has(task.id) || taskTouchesDay(task, window));
    const candidates = relevantTasks.length > 0 ? relevantTasks : hasPlan ? [] : user.tasks;
    const taskFieldIssues = candidates.flatMap((task) => {
      const missingFields = taskMissingFields(task);
      return missingFields.length > 0
        ? [{ taskId: task.id, taskTitle: task.title, projectName: task.projectName, missingFields }]
        : [];
    });

    if (hasPlan && taskFieldIssues.length === 0) return [];
    return [{
      kind: "plan" as const,
      userId: user.userId,
      displayName: user.displayName,
      larkOpenId: user.larkOpenId,
      hasPlan,
      taskFieldIssues
    }];
  });
}

export function findActualIssues(
  users: ReminderUserFacts[],
  targetMinutes: number = TASK_REMINDER_TARGET_MINUTES
): ActualReminderIssue[] {
  return users.flatMap((user) => {
    const actualTaskIds = new Set(user.timeEntries.map((entry) => entry.taskId));
    const plannedTaskIds = new Set(user.planningBlocks.map((block) => block.taskId));
    const taskById = new Map(user.tasks.map((task) => [task.id, task]));
    const taskWithoutActual = [...plannedTaskIds].flatMap((taskId) => {
      if (actualTaskIds.has(taskId)) return [];
      const task = taskById.get(taskId);
      return [{ taskId, taskTitle: task?.title ?? "Task không còn trong danh sách active", projectName: task?.projectName }];
    });
    const totalMinutes = user.timeEntries.reduce((total, entry) => total + entry.minutes, 0);
    if (totalMinutes >= targetMinutes && taskWithoutActual.length === 0) return [];
    return [{
      kind: "actual" as const,
      userId: user.userId,
      displayName: user.displayName,
      larkOpenId: user.larkOpenId,
      totalMinutes,
      targetMinutes,
      taskWithoutActual
    }];
  });
}

export function dueReminderSlots(
  window: VietnamWorkdayWindow,
  catchUpMinutes: number,
  schedule: ReadonlyArray<{ slot: TaskReminderSlot; minute: number }> = TASK_REMINDER_SCHEDULE
): TaskReminderSlot[] {
  return schedule
    .filter(({ minute }) => window.localMinute >= minute && window.localMinute <= minute + catchUpMinutes)
    .map(({ slot }) => slot);
}
