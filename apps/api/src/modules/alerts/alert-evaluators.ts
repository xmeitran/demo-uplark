/**
 * 7.5 trigger catalogue — the time-based evaluators of the daily scan. Pure: plain values in, the warnings that
 * SHOULD be open out. alert-scan.ts loads the data and reconciles the result with the stored ProjectWarning rows.
 */
import type { SystemParameterValues } from "@b2b-crm/contracts";
import { addWorkingDays, isWorkingDay, localDateKey, workingDaysBetween } from "../../shared/working-days";
import { CLOSED_WORK_STATUSES, isCancelledTaskStatus, isClosedWorkStatus, isCompletedTaskStatus } from "../delivery-handoff/task-status";
import { normalizeProjectStatus } from "../delivery-handoff/project-status";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface WantedWarning {
  projectId: string;
  dedupeKey: string;
  typeCode: string;
  severity: string;
  title: string;
  detail: string;
  ownerUserId?: string | null;
  dueAt?: Date | null;
  milestoneId?: string | null;
  stageId?: string | null;
  taskId?: string | null;
}

export interface ScanTask {
  id: string;
  projectId: string;
  title: string;
  status: string;
  parentTaskId: string | null;
  stageId: string | null;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  dueAt: Date | null;
  estimateMinutes: number;
  /** "Giờ đã ghi" of this task only (member-participation.ts definition). */
  loggedMinutes: number;
}

export interface ScanStage {
  id: string;
  projectId: string;
  activity: string;
  status: string;
  ownerUserId: string | null;
  milestoneId: string | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
}

export interface ScanClock {
  now: Date;
  dayOffKeys: ReadonlySet<string>;
  params: SystemParameterValues;
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} giờ`;
const percent = (value: number) => `${Math.round(value)}%`;
const isOpenStage = (stage: ScanStage) => !isClosedWorkStatus(stage.status) && String(stage.status).toLowerCase() !== "skipped";

/** Projects whose plan is live: progress and resource triggers are not evaluated for planning, on-hold, completed or closed ones. */
export function isRunningProject(status: unknown): boolean {
  const code = normalizeProjectStatus(status);
  return code !== null && !["planning", "on_hold", "completed", "closed"].includes(code);
}

/** Working days from `from`'s date to `to`'s date, both included. */
export function inclusiveWorkingDays(from: Date, to: Date, dayOffKeys: ReadonlySet<string>): number {
  return workingDaysBetween(new Date(from.getTime() - DAY_MS), to, dayOffKeys);
}

/** `hours` clock hours later, counting only hours that fall on a working day ("24 giờ làm việc" = the same time one working day later). */
export function addWorkingHours(start: Date, hoursToAdd: number, dayOffKeys: ReadonlySet<string> = new Set()): Date {
  let at = start.getTime();
  for (let remaining = Math.max(0, Math.ceil(hoursToAdd)); remaining > 0; ) {
    at += HOUR_MS;
    if (isWorkingDay(localDateKey(new Date(at)), dayOffKeys)) remaining -= 1;
  }
  return new Date(at);
}

interface TaskRollup { task: ScanTask; estimateMinutes: number; loggedMinutes: number }

/** Top-level tasks with their sub-tasks folded in: the estimate is the task's own, or the sum of its sub-tasks when it has none. */
function rollupTasks(tasks: readonly ScanTask[]): TaskRollup[] {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, ScanTask[]>();
  for (const task of tasks) {
    if (task.parentTaskId && ids.has(task.parentTaskId)) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
  }
  return tasks.filter((task) => !task.parentTaskId || !ids.has(task.parentTaskId)).map((task) => {
    const subtasks = (children.get(task.id) ?? []).filter((subtask) => !isCancelledTaskStatus(subtask.status));
    return {
      task,
      estimateMinutes: task.estimateMinutes > 0 ? task.estimateMinutes : subtasks.reduce((sum, subtask) => sum + Math.max(0, subtask.estimateMinutes), 0),
      loggedMinutes: task.loggedMinutes + subtasks.reduce((sum, subtask) => sum + subtask.loggedMinutes, 0)
    };
  });
}

/** Tasks without sub-tasks: the unit "khối lượng" is measured in (7.6 "Cách đo khối lượng đã xong"). */
function leafTasks(tasks: readonly ScanTask[]): ScanTask[] {
  const parents = new Set(tasks.map((task) => task.parentTaskId).filter(Boolean));
  return tasks.filter((task) => !parents.has(task.id) && !isCancelledTaskStatus(task.status));
}

// ---------------------------------------------------------------------------
// NL-03 — running task or stage without an owner (same dedupe keys as the event-driven trigger in projects.service)
// ---------------------------------------------------------------------------
export function evaluateMissingOwners(project: { id: string; status: string }, tasks: readonly ScanTask[], stages: readonly ScanStage[]): WantedWarning[] {
  if (normalizeProjectStatus(project.status) === "planning") return [];
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  return [
    ...tasks.filter((task) => !CLOSED_WORK_STATUSES.includes(String(task.status).toLowerCase()) && !task.ownerUserId && !task.assigneeUserId).map((task) => ({
      projectId: project.id, dedupeKey: `NL-03:task:${task.id}`, typeCode: "NL-03", severity: "high",
      title: "Task chưa có người phụ trách", detail: `Task "${task.title}" đang chạy nhưng chưa có người phụ trách. Cần phân công.`,
      taskId: task.id, stageId: task.stageId, milestoneId: task.stageId ? stageById.get(task.stageId)?.milestoneId ?? null : null
    })),
    ...stages.filter((stage) => !CLOSED_WORK_STATUSES.includes(String(stage.status).toLowerCase()) && !stage.ownerUserId).map((stage) => ({
      projectId: project.id, dedupeKey: `NL-03:stage:${stage.id}`, typeCode: "NL-03", severity: "high",
      title: "Stage chưa có người phụ trách", detail: `Stage "${stage.activity}" đang chạy nhưng chưa có người phụ trách. Cần phân công.`,
      stageId: stage.id, milestoneId: stage.milestoneId
    }))
  ];
}

// ---------------------------------------------------------------------------
// NL-04 — planned more than N working days ago, still no logged hour by that person on that task
// ---------------------------------------------------------------------------
export interface ScanPlanBlock { taskId: string; projectId: string | null; userId: string; startAt: Date; plannedMinutes: number; status: string }

export function evaluatePlanWithoutLog(
  projectId: string,
  tasks: readonly ScanTask[],
  blocks: readonly ScanPlanBlock[],
  /** `${taskId}:${userId}` -> the latest work date that person logged on that task. */
  lastLogAt: ReadonlyMap<string, Date>,
  clock: ScanClock
): WantedWarning[] {
  const limit = clock.params.plannedNoLogWorkingDays;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const earliest = new Map<string, ScanPlanBlock>();
  for (const block of blocks) {
    const task = taskById.get(block.taskId);
    if (!task || isClosedWorkStatus(task.status) || String(block.status).toLowerCase() !== "planned") continue;
    const key = `${block.taskId}:${block.userId}`;
    const logged = lastLogAt.get(key);
    if (logged && localDateKey(logged) >= localDateKey(block.startAt)) continue;
    if (!earliest.has(key) || block.startAt < earliest.get(key)!.startAt) earliest.set(key, block);
  }
  const wanted: WantedWarning[] = [];
  for (const block of earliest.values()) {
    const waited = workingDaysBetween(block.startAt, clock.now, clock.dayOffKeys);
    if (waited <= limit) continue;
    const task = taskById.get(block.taskId)!;
    wanted.push({
      projectId, dedupeKey: `NL-04:task:${block.taskId}:user:${block.userId}`, typeCode: "NL-04", severity: "medium",
      title: "Có kế hoạch nhưng chưa có giờ log",
      detail: `"${task.title}" có kế hoạch từ ${localDateKey(block.startAt)} (${waited} ngày làm việc, hạn ${limit}) mà người được lập kế hoạch chưa ghi giờ.`,
      ownerUserId: block.userId, dueAt: addWorkingDays(block.startAt, limit, clock.dayOffKeys), taskId: task.id, stageId: task.stageId
    });
  }
  return wanted;
}

// ---------------------------------------------------------------------------
// NL-05 — a person's planned hours across running projects exceed the standard hours of the period (a week)
// ---------------------------------------------------------------------------
function mondayKey(at: Date): string {
  const key = localDateKey(at);
  const weekday = (new Date(`${key}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  return new Date(Date.parse(`${key}T00:00:00.000Z`) - weekday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Period = Monday–Sunday in Vietnam time; evaluated for the current and the next week. Standard hours of the period =
 * working days × "Giờ chuẩn một ngày". ProjectWarning needs a project, so the record sits on the project carrying most
 * of the person's plan that week (`projectIds` lists every candidate so an already open record can stay where it is).
 */
export function evaluateOverCapacity(blocks: readonly ScanPlanBlock[], userNames: ReadonlyMap<string, string>, clock: ScanClock): Array<WantedWarning & { projectIds: string[] }> {
  const thisWeek = mondayKey(clock.now);
  const weeks = [thisWeek, new Date(Date.parse(`${thisWeek}T00:00:00.000Z`) + 7 * DAY_MS).toISOString().slice(0, 10)];
  const totals = new Map<string, Map<string, number>>();
  for (const block of blocks) {
    if (!block.projectId || ["cancelled", "canceled"].includes(String(block.status).toLowerCase())) continue;
    const week = mondayKey(block.startAt);
    if (!weeks.includes(week)) continue;
    const key = `${block.userId}|${week}`;
    const byProject = totals.get(key) ?? new Map<string, number>();
    byProject.set(block.projectId, (byProject.get(block.projectId) ?? 0) + Math.max(0, block.plannedMinutes));
    totals.set(key, byProject);
  }
  const wanted: Array<WantedWarning & { projectIds: string[] }> = [];
  for (const [key, byProject] of totals) {
    const [userId, week] = key.split("|");
    const monday = new Date(`${week}T05:00:00.000Z`);
    const sunday = new Date(monday.getTime() + 6 * DAY_MS);
    const capacity = inclusiveWorkingDays(monday, sunday, clock.dayOffKeys) * clock.params.standardDayHours * 60;
    const planned = [...byProject.values()].reduce((sum, minutes) => sum + minutes, 0);
    if (planned <= capacity) continue;
    const projectIds = [...byProject.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([projectId]) => projectId);
    wanted.push({
      projectId: projectIds[0], projectIds, dedupeKey: `NL-05:user:${userId}:week:${week}`, typeCode: "NL-05", severity: "medium",
      title: "Giờ kế hoạch vượt quỹ giờ chuẩn",
      detail: `${userNames.get(userId) ?? userId}: tuần từ ${week} có ${hours(planned)} kế hoạch trên ${projectIds.length} dự án đang chạy, quỹ giờ chuẩn ${hours(capacity)}.`,
      ownerUserId: userId, dueAt: sunday
    });
  }
  return wanted;
}

// ---------------------------------------------------------------------------
// TD-01 — logged / estimated hours of a task or a stage at or over the threshold
// ---------------------------------------------------------------------------
export function evaluateHoursUsed(projectId: string, tasks: readonly ScanTask[], stages: readonly ScanStage[], clock: ScanClock): WantedWarning[] {
  const threshold = clock.params.hoursUsedThresholdPercent;
  const rollups = rollupTasks(tasks.filter((task) => !isCancelledTaskStatus(task.status)));
  const wanted: WantedWarning[] = [];
  const line = (label: string, logged: number, estimate: number) => `${label}: đã ghi ${hours(logged)} trên ${hours(estimate)} dự kiến (${percent((logged / estimate) * 100)}, ngưỡng ${threshold}%).`;
  // Over 100% is one level up from "reached the threshold" (V-37 resends when the level rises).
  const severity = (logged: number, estimate: number) => (logged > estimate ? "high" : "medium");
  for (const { task, estimateMinutes, loggedMinutes } of rollups) {
    // Without an estimate there is nothing to compare against (V-35 "Không đủ căn cứ").
    if (isClosedWorkStatus(task.status) || estimateMinutes <= 0 || (loggedMinutes / estimateMinutes) * 100 < threshold) continue;
    wanted.push({
      projectId, dedupeKey: `TD-01:task:${task.id}`, typeCode: "TD-01", severity: severity(loggedMinutes, estimateMinutes),
      title: "Giờ đã ghi của task vượt ngưỡng", detail: line(`Task "${task.title}"`, loggedMinutes, estimateMinutes),
      ownerUserId: task.assigneeUserId ?? task.ownerUserId, taskId: task.id, stageId: task.stageId
    });
  }
  for (const stage of stages.filter(isOpenStage)) {
    const inStage = rollups.filter((item) => item.task.stageId === stage.id);
    const estimate = inStage.reduce((sum, item) => sum + item.estimateMinutes, 0);
    const logged = inStage.reduce((sum, item) => sum + item.loggedMinutes, 0);
    if (estimate <= 0 || (logged / estimate) * 100 < threshold) continue;
    wanted.push({
      projectId, dedupeKey: `TD-01:stage:${stage.id}`, typeCode: "TD-01", severity: severity(logged, estimate),
      title: "Giờ đã ghi của stage vượt ngưỡng", detail: line(`Stage "${stage.activity}"`, logged, estimate),
      ownerUserId: stage.ownerUserId, stageId: stage.id, milestoneId: stage.milestoneId
    });
  }
  return wanted;
}

// ---------------------------------------------------------------------------
// TD-02 — an open task or sub-task whose due date has passed
// ---------------------------------------------------------------------------
export function evaluateOverdueTasks(projectId: string, tasks: readonly ScanTask[], clock: ScanClock): WantedWarning[] {
  const today = localDateKey(clock.now);
  return tasks.filter((task) => task.dueAt && !isClosedWorkStatus(task.status) && localDateKey(task.dueAt) < today).map((task) => ({
    projectId, dedupeKey: `TD-02:task:${task.id}`, typeCode: "TD-02", severity: "medium",
    title: `${task.parentTaskId ? "Sub-task" : "Task"} quá hạn`,
    detail: `"${task.title}" có hạn ${localDateKey(task.dueAt!)} nhưng chưa hoàn thành (quá ${workingDaysBetween(task.dueAt!, clock.now, clock.dayOffKeys)} ngày làm việc).`,
    ownerUserId: task.assigneeUserId ?? task.ownerUserId, dueAt: task.dueAt, taskId: task.id, stageId: task.stageId
  }));
}

// ---------------------------------------------------------------------------
// TD-03 — risk of delay, per running stage with planned dates
// ---------------------------------------------------------------------------
export interface DelayRiskFigures {
  /** Estimated hours of completed leaf tasks / estimated hours of all leaf tasks. */
  donePercent: number;
  /** Working days elapsed / working days planned. */
  timePercent: number;
  usedPercent: number;
  remainingMinutes: number;
  capacityMinutes: number;
  conditions: Array<"A" | "B" | "C">;
}

/** Null when the stage lacks what the rule reads (planned dates, estimates): "Không đủ căn cứ", no warning. */
export function delayRiskFigures(stage: ScanStage, stageTasks: readonly ScanTask[], clock: ScanClock): DelayRiskFigures | null {
  if (!stage.plannedStartAt || !stage.plannedEndAt || stage.plannedEndAt < stage.plannedStartAt || localDateKey(stage.plannedStartAt) > localDateKey(clock.now)) return null;
  const leaves = leafTasks(stageTasks);
  const total = leaves.reduce((sum, task) => sum + Math.max(0, task.estimateMinutes), 0);
  if (total <= 0) return null;
  const open = leaves.filter((task) => !isCompletedTaskStatus(task.status));
  const remainingMinutes = open.reduce((sum, task) => sum + Math.max(0, task.estimateMinutes), 0);
  const donePercent = ((total - remainingMinutes) / total) * 100;
  const plannedDays = inclusiveWorkingDays(stage.plannedStartAt, stage.plannedEndAt, clock.dayOffKeys);
  const ended = localDateKey(clock.now) > localDateKey(stage.plannedEndAt);
  const elapsedDays = inclusiveWorkingDays(stage.plannedStartAt, ended ? stage.plannedEndAt : clock.now, clock.dayOffKeys);
  const timePercent = plannedDays > 0 ? Math.min(100, (elapsedDays / plannedDays) * 100) : ended ? 100 : 0;
  const usedPercent = (stageTasks.filter((task) => !isCancelledTaskStatus(task.status)).reduce((sum, task) => sum + task.loggedMinutes, 0) / total) * 100;
  // ponytail: capacity = remaining working days × standard day × people still assigned in this stage; it ignores their
  // load on other projects and personal leave. Subtract ResourceCapacityPeriod / other plans when that precision matters.
  const people = new Set(open.map((task) => task.assigneeUserId ?? task.ownerUserId).filter(Boolean)).size;
  const remainingDays = ended ? 0 : inclusiveWorkingDays(clock.now, stage.plannedEndAt, clock.dayOffKeys);
  const capacityMinutes = remainingDays * clock.params.standardDayHours * 60 * people;
  const behind = timePercent - donePercent > clock.params.progressGapPoints;
  const conditions: DelayRiskFigures["conditions"] = [];
  if (behind && usedPercent >= clock.params.hoursUsedThresholdPercent) conditions.push("A");
  if (behind) conditions.push("B");
  if (remainingMinutes > capacityMinutes) conditions.push("C");
  return { donePercent, timePercent, usedPercent, remainingMinutes, capacityMinutes, conditions };
}

export function evaluateDelayRisk(projectId: string, tasks: readonly ScanTask[], stages: readonly ScanStage[], clock: ScanClock): WantedWarning[] {
  const wanted: WantedWarning[] = [];
  for (const stage of stages.filter(isOpenStage)) {
    const figures = delayRiskFigures(stage, tasks.filter((task) => task.stageId === stage.id), clock);
    if (!figures?.conditions.length) continue;
    const reasons = [
      figures.conditions.includes("A") ? `(A) đã dùng ${percent(figures.usedPercent)} giờ dự kiến và khối lượng xong tụt sau nhịp thời gian` : figures.conditions.includes("B") ? "(B) khối lượng xong tụt sau nhịp thời gian" : "",
      figures.conditions.includes("C") ? `(C) còn ${hours(figures.remainingMinutes)} việc, năng lực còn lại ${hours(figures.capacityMinutes)}` : ""
    ].filter(Boolean);
    wanted.push({
      projectId, dedupeKey: `TD-03:stage:${stage.id}`, typeCode: "TD-03",
      // (B) alone is the early signal; hours also used up (A) or not enough capacity left (C) is one level up.
      severity: figures.conditions.includes("A") || figures.conditions.includes("C") ? "high" : "medium",
      title: "Nguy cơ chậm tiến độ",
      detail: `Stage "${stage.activity}": xong ${percent(figures.donePercent)} khối lượng khi đã qua ${percent(figures.timePercent)} thời gian (khoảng lệch cho phép ${clock.params.progressGapPoints} điểm). ${reasons.join("; ")}.`,
      ownerUserId: stage.ownerUserId, dueAt: stage.plannedEndAt, stageId: stage.id, milestoneId: stage.milestoneId
    });
  }
  return wanted;
}

/**
 * TD-03 closes only after its condition has been absent on 2 consecutive working days. The streak is kept in the
 * warning's own event log: "condition_absent" once per clear working day, "condition_present" when it comes back.
 */
export const CONDITION_ABSENT_ACTION = "condition_absent";
export const CONDITION_PRESENT_ACTION = "condition_present";
const STREAK_BREAKERS = [CONDITION_PRESENT_ACTION, "opened", "refreshed"];
/** True while the newest condition marker says "absent": the warning is counting clear days. */
export function hasClearStreak(events: ReadonlyArray<{ action: string }>): boolean {
  return [...events].reverse().find((event) => event.action === CONDITION_ABSENT_ACTION || STREAK_BREAKERS.includes(event.action))?.action === CONDITION_ABSENT_ACTION;
}
export function clearStreakDecision(events: ReadonlyArray<{ action: string; at: Date }>, clock: Pick<ScanClock, "now" | "dayOffKeys">, requiredDays = 2): "wait" | "mark" | "close" {
  const today = localDateKey(clock.now);
  if (!isWorkingDay(today, clock.dayOffKeys)) return "wait";
  const days = new Set<string>();
  for (let index = events.length - 1; index >= 0 && !STREAK_BREAKERS.includes(events[index].action); index -= 1) {
    if (events[index].action === CONDITION_ABSENT_ACTION) days.add(localDateKey(events[index].at));
  }
  if (days.has(today)) return "wait";
  return days.size + 1 >= requiredDays ? "close" : "mark";
}

// ---------------------------------------------------------------------------
// TD-06 — a proposed change of estimate or timeline that nobody has approved yet
// ---------------------------------------------------------------------------
export interface ScanPlanChange { id: string; projectId: string; taskId: string; taskTitle: string; stageId: string | null; createdAt: Date; reason: string }

export function evaluatePendingPlanChanges(changes: readonly ScanPlanChange[], pmByProject: ReadonlyMap<string, string | null>): WantedWarning[] {
  return changes.map((change) => ({
    projectId: change.projectId, dedupeKey: `TD-06:request:${change.id}`, typeCode: "TD-06", severity: "medium",
    title: "Thay đổi kế hoạch chưa được duyệt",
    detail: `Task "${change.taskTitle}" có đề xuất đổi giờ dự kiến hoặc timeline từ ${localDateKey(change.createdAt)} chưa được duyệt. Lý do: ${change.reason}`,
    ownerUserId: pmByProject.get(change.projectId) ?? null, taskId: change.taskId, stageId: change.stageId
  }));
}

// ---------------------------------------------------------------------------
// BRI-04 — a handoff file waiting for review longer than the review deadline
// ---------------------------------------------------------------------------
export interface ScanHandoff { milestoneId: string; projectId: string; milestoneName: string; requestedAt: Date; reviewerUserId: string | null; /** A gate submission: one record per gate (two gates can share a milestone). */ dedupeKey?: string }

export function evaluateHandoffReview(handoffs: readonly ScanHandoff[], clock: ScanClock): WantedWarning[] {
  const wanted: WantedWarning[] = [];
  for (const handoff of handoffs) {
    const deadline = addWorkingHours(handoff.requestedAt, clock.params.handoffReviewWorkingHours, clock.dayOffKeys);
    if (clock.now <= deadline) continue;
    wanted.push({
      projectId: handoff.projectId, dedupeKey: handoff.dedupeKey ?? `BRI-04:milestone:${handoff.milestoneId}`, typeCode: "BRI-04", severity: "high",
      title: "Hồ sơ chuyển tiếp chờ duyệt quá hạn",
      detail: `Hồ sơ chuyển tiếp của "${handoff.milestoneName}" nộp ${localDateKey(handoff.requestedAt)}, quá ${clock.params.handoffReviewWorkingHours} giờ làm việc vẫn chưa có kết quả duyệt.`,
      ownerUserId: handoff.reviewerUserId, dueAt: deadline, milestoneId: handoff.milestoneId
    });
  }
  return wanted;
}

// ---------------------------------------------------------------------------
// DL-01 — "Chờ xử lý" hours past the handling deadline; one record per project (the PM's worklist)
// ---------------------------------------------------------------------------
export interface ScanPendingHours { projectId: string; minutes: number; loggedAt: Date }

export function evaluatePendingHours(entries: readonly ScanPendingHours[], pmByProject: ReadonlyMap<string, string | null>, clock: ScanClock): WantedWarning[] {
  const overdue = new Map<string, { count: number; minutes: number; firstDeadline: Date }>();
  for (const entry of entries) {
    const deadline = addWorkingDays(entry.loggedAt, clock.params.pendingHoursWorkingDays, clock.dayOffKeys);
    if (clock.now <= deadline) continue;
    const current = overdue.get(entry.projectId);
    overdue.set(entry.projectId, { count: (current?.count ?? 0) + 1, minutes: (current?.minutes ?? 0) + entry.minutes, firstDeadline: current && current.firstDeadline < deadline ? current.firstDeadline : deadline });
  }
  return [...overdue.entries()].map(([projectId, item]) => ({
    projectId, dedupeKey: "DL-01:pending-hours", typeCode: "DL-01", severity: "medium",
    title: "Giờ Chờ xử lý quá hạn",
    detail: `${item.count} giờ log (${hours(item.minutes)}) ở Chờ xử lý đã quá hạn ${clock.params.pendingHoursWorkingDays} ngày làm việc; hạn sớm nhất ${localDateKey(item.firstDeadline)}.`,
    ownerUserId: pmByProject.get(projectId) ?? null, dueAt: item.firstDeadline
  }));
}

// ---------------------------------------------------------------------------
// TD-04, TD-05, BRI-05: fed by the stage SLA clock (stage-sla.ts), the stage extensions (stage-extension.ts) and the
// customer step of the gates (ProjectGate.customerRequestedAt); alert-scan.ts loads them.
// ---------------------------------------------------------------------------

/** TD-04 needs: the stage's SLA in working days, when it started, the days spent waiting for the customer, and the due date of its latest approved extension. */
export interface ScanStageSla { stageId: string; projectId: string; activity: string; milestoneId: string | null; startedAt: Date; slaWorkingDays: number; customerWaitWorkingDays: number; ownerUserId: string | null; extendedDueAt?: Date | null }
export function evaluateStageSla(stages: readonly ScanStageSla[], clock: ScanClock): WantedWarning[] {
  return stages.flatMap((stage) => {
    const used = workingDaysBetween(stage.startedAt, clock.now, clock.dayOffKeys) - stage.customerWaitWorkingDays;
    // "Kết thúc khi: Stage đóng hoặc gia hạn được duyệt" — an approved extension that is still ahead covers the overrun.
    if (used <= stage.slaWorkingDays || (stage.extendedDueAt && clock.now <= stage.extendedDueAt)) return [];
    return [{
      projectId: stage.projectId, dedupeKey: `TD-04:stage:${stage.stageId}`, typeCode: "TD-04", severity: "high", title: "Stage vượt SLA",
      detail: `Stage "${stage.activity}" đã dùng ${used} ngày làm việc (không tính ${stage.customerWaitWorkingDays} ngày chờ khách), SLA ${stage.slaWorkingDays} ngày.`,
      ownerUserId: stage.ownerUserId, dueAt: addWorkingDays(stage.startedAt, stage.slaWorkingDays + stage.customerWaitWorkingDays, clock.dayOffKeys), stageId: stage.stageId, milestoneId: stage.milestoneId
    }];
  });
}

// TD-05 (mode "event") is opened by the extension that crosses the threshold and closed by the PM: delivery-handoff/stage-extension.ts.

/** BRI-05 needs: when the gate file was sent to the customer. The cause is the customer, so nobody internal is named (V-35). */
export interface ScanCustomerWait { milestoneId: string; projectId: string; gate: string; milestoneName: string; sentAt: Date }
export function evaluateCustomerWait(waits: readonly ScanCustomerWait[], clock: ScanClock): WantedWarning[] {
  return waits.flatMap((wait) => {
    const days = wait.gate === "G4" ? clock.params.customerResponseG4WorkingDays : clock.params.customerResponseWorkingDays;
    const deadline = addWorkingDays(wait.sentAt, days, clock.dayOffKeys);
    if (clock.now <= deadline) return [];
    return [{
      projectId: wait.projectId, dedupeKey: `BRI-05:milestone:${wait.milestoneId}`, typeCode: "BRI-05", severity: "high", title: "Khách quá hạn phản hồi",
      detail: `Nguyên nhân từ khách: hồ sơ ${wait.gate} "${wait.milestoneName}" gửi ${localDateKey(wait.sentAt)}, quá ${days} ngày làm việc chưa có xác nhận.`,
      ownerUserId: null, dueAt: deadline, milestoneId: wait.milestoneId
    }];
  });
}
