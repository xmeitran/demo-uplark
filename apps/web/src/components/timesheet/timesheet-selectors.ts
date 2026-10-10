/**
 * Pure derivation layer for the Timesheet screens (spec 35).
 *
 * Every metric the UI shows is computed here so the rules stay testable and
 * swapping mock data for the real API changes nothing downstream.
 *
 * Locked rules (spec 35 §5b, @kha 2026-07-29):
 *   • Person standard hours = 8h × working days (Mon–Fri minus public holidays),
 *     scaled by contract ratio.
 *   • Project planned hours = SUM of entered task estimates, rolled up
 *     task → stage → milestone → project. Never a stored stage/project field.
 */

import {
  eachDate,
  isWorkingDay,
  monthBounds,
  monthOf
} from "./timesheet-dates";
import { isClosedNodeStatus, isTaskOverdue } from "./timesheet-status";
import type {
  MemberState,
  MilestoneNode,
  Person,
  ProjectNode,
  StageNode,
  TaskNode,
  TimeLog,
  TimesheetDataset,
  WorkGroup
} from "./timesheet-types";
import { WORK_GROUPS } from "./timesheet-types";

/* ── Filters ────────────────────────────────────────────────────────────── */

export interface TimesheetFilters {
  month: string;
  departmentId: string | "all";
  personId: string | "all";
  /** Supports both the legacy single-person value and the multi-select UI. */
  personIds?: string[];
  projectId: string | "all";
  workGroup: WorkGroup | "all";
}

function selectedPersonIds(filters: TimesheetFilters) {
  if (filters.personIds) return filters.personIds;
  return filters.personId === "all" ? [] : [filters.personId];
}

export function filterLogs(dataset: TimesheetDataset, filters: TimesheetFilters): TimeLog[] {
  const peopleById = new Map(dataset.people.map((person) => [person.id, person]));
  const personIds = selectedPersonIds(filters);
  return dataset.logs.filter((log) => {
    if (monthOf(log.date) !== filters.month) return false;
    if (personIds.length > 0 && !personIds.includes(log.personId)) return false;
    if (filters.projectId !== "all" && log.projectId !== filters.projectId) return false;
    if (filters.workGroup !== "all" && log.workGroup !== filters.workGroup) return false;
    if (filters.departmentId !== "all") {
      const person = peopleById.get(log.personId);
      if (!person || person.departmentId !== filters.departmentId) return false;
    }
    return true;
  });
}

export function peopleInScope(dataset: TimesheetDataset, filters: TimesheetFilters): Person[] {
  const personIds = selectedPersonIds(filters);
  return dataset.people.filter((person) => {
    if (!person.active) return false;
    if (filters.departmentId !== "all" && person.departmentId !== filters.departmentId) return false;
    if (personIds.length > 0 && !personIds.includes(person.id)) return false;
    return true;
  });
}

/* ── Calendar / standard hours ──────────────────────────────────────────── */

export function workingDaysInMonth(month: string, holidays: readonly string[], upToISO?: string): string[] {
  const { start, end } = monthBounds(month);
  const cap = upToISO && upToISO < end ? upToISO : end;
  return eachDate(start, cap).filter((iso) => isWorkingDay(iso, holidays));
}

/** MTS-01: 8h × working days × contract ratio. */
export function standardMinutesFor(person: Person, workingDays: number): number {
  return Math.round(person.standardMinutesPerDay * person.contractRatio * workingDays);
}

/* ── Monthly per-person summary (MTS-01, MTS-04) ────────────────────────── */

export interface PersonMonthSummary {
  person: Person;
  actualMinutes: number;
  standardMinutes: number;
  /** actual / standard, as a percentage. */
  completionPercent: number;
  missingMinutes: number;
  daysLogged: number;
  workingDays: number;
  missingDays: string[];
  projectCount: number;
  billableMinutes: number;
  byWorkGroup: Record<WorkGroup, number>;
  /** MTS-04 traffic light. */
  quality: "good" | "warning" | "critical";
}

export function buildPersonMonthSummaries(
  dataset: TimesheetDataset,
  filters: TimesheetFilters,
  logs: TimeLog[]
): PersonMonthSummary[] {
  const workingDays = workingDaysInMonth(filters.month, dataset.holidays, dataset.generatedAt);
  const logsByPerson = new Map<string, TimeLog[]>();
  for (const log of logs) {
    const bucket = logsByPerson.get(log.personId);
    if (bucket) bucket.push(log);
    else logsByPerson.set(log.personId, [log]);
  }

  return peopleInScope(dataset, filters)
    .map((person) => {
      const personLogs = logsByPerson.get(person.id) ?? [];
      const actualMinutes = sum(personLogs.map((log) => log.minutes));
      const standardMinutes = standardMinutesFor(person, workingDays.length);
      const loggedDays = new Set(personLogs.map((log) => log.date));
      const missingDays = workingDays.filter((iso) => !loggedDays.has(iso));
      const completionPercent = standardMinutes > 0 ? (actualMinutes / standardMinutes) * 100 : 0;

      const byWorkGroup = emptyWorkGroupTotals();
      for (const log of personLogs) byWorkGroup[log.workGroup] += log.minutes;

      return {
        person,
        actualMinutes,
        standardMinutes,
        completionPercent,
        missingMinutes: Math.max(0, standardMinutes - actualMinutes),
        // Working days only, so "x/y ngày" can never exceed y because of weekend logs.
        daysLogged: workingDays.length - missingDays.length,
        workingDays: workingDays.length,
        missingDays,
        projectCount: new Set(personLogs.map((log) => log.projectId)).size,
        billableMinutes: sum(personLogs.filter((log) => log.billable).map((log) => log.minutes)),
        byWorkGroup,
        quality: completionPercent >= 90 ? "good" : completionPercent >= 70 ? "warning" : "critical"
      } satisfies PersonMonthSummary;
    })
    .sort((a, b) => b.actualMinutes - a.actualMinutes);
}

/* ── Monthly headline KPIs (MTS-01) ─────────────────────────────────────── */

export interface MonthlyKpis {
  actualMinutes: number;
  standardMinutes: number;
  completionPercent: number;
  missingMinutes: number;
  projectCount: number;
  peopleCount: number;
  workingDays: number;
  dayCoveragePercent: number;
  billablePercent: number;
}

export function buildMonthlyKpis(
  dataset: TimesheetDataset,
  filters: TimesheetFilters,
  logs: TimeLog[],
  summaries: PersonMonthSummary[]
): MonthlyKpis {
  const workingDays = workingDaysInMonth(filters.month, dataset.holidays, dataset.generatedAt);
  const actualMinutes = sum(logs.map((log) => log.minutes));
  // Completeness is judged on the people in scope only: hours of former/inactive
  // users stay in the total but must not fill anyone else's standard hours.
  const scopedActualMinutes = sum(summaries.map((item) => item.actualMinutes));
  const standardMinutes = sum(summaries.map((item) => item.standardMinutes));
  const possibleDays = summaries.length * workingDays.length;
  const loggedDays = sum(summaries.map((item) => item.daysLogged));

  return {
    actualMinutes,
    standardMinutes,
    completionPercent: standardMinutes > 0 ? (scopedActualMinutes / standardMinutes) * 100 : 0,
    missingMinutes: Math.max(0, standardMinutes - scopedActualMinutes),
    projectCount: new Set(logs.map((log) => log.projectId)).size,
    peopleCount: summaries.length,
    workingDays: workingDays.length,
    dayCoveragePercent: possibleDays > 0 ? (loggedDays / possibleDays) * 100 : 0,
    billablePercent: actualMinutes > 0 ? (sum(logs.filter((log) => log.billable).map((log) => log.minutes)) / actualMinutes) * 100 : 0
  };
}

/* ── Per-person × per-day load matrix ───────────────────────────────────── */

/**
 * A day only counts as overloaded past this share of the person's standard day.
 * A flat >100% rule flags 8h20m as an alarm, which is noise — the Scrum
 * handbook's own guidance is that 100% utilisation is not the target and teams
 * need slack, so a tolerance band is the honest reading.
 */
export const OVERLOAD_THRESHOLD_PERCENT = 110;
/** Below this share of the standard day, the day reads as under-logged. */
export const UNDERLOAD_THRESHOLD_PERCENT = 90;

export interface PersonDayCell {
  date: string;
  minutes: number;
  entryCount: number;
  isWorkingDay: boolean;
  /** minutes ÷ that person's own standard day (8h × contract ratio). */
  loadPercent: number;
}

export interface PersonDayRow {
  person: Person;
  cells: PersonDayCell[];
  totalMinutes: number;
  standardMinutes: number;
  daysLogged: number;
  /** Working days where the person logged more than their standard day. */
  overloadedDays: number;
  /** Working days with no entry at all. */
  emptyWorkingDays: number;
  /** Highest single-day load in the period. */
  peakMinutes: number;
}

export interface PersonDayMatrix {
  days: Array<{ date: string; isWorkingDay: boolean }>;
  rows: PersonDayRow[];
  /** Total logged per day across everyone in scope. */
  dayTotals: number[];
}

/**
 * "How many hours a day is each person actually logged for?"
 *
 * The load percentage is always against that person's OWN standard day
 * (8h × contract ratio), never a team average — a 50% part-timer logging 4h has
 * a full day, and must not read as half-loaded.
 */
export function buildPersonDayMatrix(
  dataset: TimesheetDataset,
  filters: TimesheetFilters,
  logs: TimeLog[]
): PersonDayMatrix {
  const { start, end } = monthBounds(filters.month);
  const cap = dataset.generatedAt < end ? dataset.generatedAt : end;
  const days = eachDate(start, cap).map((date) => ({
    date,
    isWorkingDay: isWorkingDay(date, dataset.holidays)
  }));

  const byPersonDay = new Map<string, { minutes: number; entries: number }>();
  for (const log of logs) {
    const key = `${log.personId}|${log.date}`;
    const bucket = byPersonDay.get(key) ?? { minutes: 0, entries: 0 };
    bucket.minutes += log.minutes;
    bucket.entries += 1;
    byPersonDay.set(key, bucket);
  }

  const rows = peopleInScope(dataset, filters)
    .map((person) => {
      const standardDay = person.standardMinutesPerDay * person.contractRatio;
      const cells = days.map((day) => {
        const bucket = byPersonDay.get(`${person.id}|${day.date}`);
        const minutes = bucket?.minutes ?? 0;
        return {
          date: day.date,
          minutes,
          entryCount: bucket?.entries ?? 0,
          isWorkingDay: day.isWorkingDay,
          loadPercent: standardDay > 0 ? (minutes / standardDay) * 100 : 0
        } satisfies PersonDayCell;
      });

      const workingCells = cells.filter((cell) => cell.isWorkingDay);
      return {
        person,
        cells,
        totalMinutes: sum(cells.map((cell) => cell.minutes)),
        standardMinutes: Math.round(standardDay * workingCells.length),
        daysLogged: cells.filter((cell) => cell.minutes > 0).length,
        overloadedDays: workingCells.filter((cell) => cell.loadPercent > OVERLOAD_THRESHOLD_PERCENT).length,
        emptyWorkingDays: workingCells.filter((cell) => cell.minutes === 0).length,
        peakMinutes: cells.reduce((acc, cell) => Math.max(acc, cell.minutes), 0)
      } satisfies PersonDayRow;
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  return {
    days,
    rows,
    dayTotals: days.map((_, index) => sum(rows.map((row) => row.cells[index]?.minutes ?? 0)))
  };
}

/** The individual entries behind one person-day cell, for the hover detail. */
export function logsForPersonDay(logs: TimeLog[], personId: string, date: string): TimeLog[] {
  return logs
    .filter((log) => log.personId === personId && log.date === date)
    .sort((a, b) => b.minutes - a.minutes);
}

/* ── Work-group split (MTS-03) ──────────────────────────────────────────── */

export interface WorkGroupSlice {
  workGroup: WorkGroup;
  minutes: number;
  percent: number;
}

export function buildWorkGroupSplit(logs: TimeLog[]): WorkGroupSlice[] {
  const totals = emptyWorkGroupTotals();
  for (const log of logs) totals[log.workGroup] += log.minutes;
  const total = sum(Object.values(totals));
  return WORK_GROUPS.map((workGroup) => ({
    workGroup,
    minutes: totals[workGroup],
    percent: total > 0 ? (totals[workGroup] / total) * 100 : 0
  })).filter((slice) => slice.minutes > 0);
}

/* ── Per-person project drill-down (MTS-02) ─────────────────────────────── */

export interface PersonProjectRow {
  project: ProjectNode;
  actualMinutes: number;
  /** Estimate of the tasks listed for this person only, never the whole project's. */
  estimateMinutes: number;
  taskCount: number;
  milestones: Array<{
    milestone: MilestoneNode;
    actualMinutes: number;
    stages: Array<{
      stage: StageNode;
      actualMinutes: number;
      tasks: Array<{ task: TaskNode; actualMinutes: number }>;
    }>;
  }>;
}

export function buildPersonProjectRows(dataset: TimesheetDataset, logs: TimeLog[]): PersonProjectRow[] {
  const minutesByTask = new Map<string, number>();
  for (const log of logs) minutesByTask.set(log.taskId, (minutesByTask.get(log.taskId) ?? 0) + log.minutes);
  const touchedProjectIds = new Set(logs.map((log) => log.projectId));

  return dataset.projects
    .filter((project) => touchedProjectIds.has(project.id))
    .map((project) => {
      const milestones = project.milestones
        .map((milestone) => {
          const stages = milestone.stages
            .map((stage) => {
              const tasks = stage.tasks
                .map((task) => ({ task, actualMinutes: minutesByTask.get(task.id) ?? 0 }))
                .filter((row) => row.actualMinutes > 0);
              return { stage, actualMinutes: sum(tasks.map((row) => row.actualMinutes)), tasks };
            })
            .filter((row) => row.actualMinutes > 0);
          return { milestone, actualMinutes: sum(stages.map((row) => row.actualMinutes)), stages };
        })
        .filter((row) => row.actualMinutes > 0);

      const actualMinutes = sum(milestones.map((row) => row.actualMinutes));
      return {
        project,
        actualMinutes,
        estimateMinutes: sum(milestones.flatMap((m) => m.stages.flatMap((s) => s.tasks.map((row) => row.task.estimateMinutes)))),
        taskCount: sum(milestones.flatMap((m) => m.stages.map((s) => s.tasks.length))),
        milestones
      } satisfies PersonProjectRow;
    })
    .sort((a, b) => b.actualMinutes - a.actualMinutes);
}

/* ── Project rollups (PTS-01, PTS-02, PTS-04) ───────────────────────────── */

export function projectEstimateMinutes(project: ProjectNode): number {
  return sum(project.milestones.flatMap((m) => m.stages.flatMap((s) => s.tasks.map((t) => t.estimateMinutes))));
}

export function projectTasks(project: ProjectNode): TaskNode[] {
  return project.milestones.flatMap((m) => m.stages.flatMap((s) => s.tasks));
}

export interface ProjectSummaryRow {
  project: ProjectNode;
  estimateMinutes: number;
  /** Hours in the viewed period (the filtered logs). */
  actualMinutes: number;
  /** Every hour of the project inside the loaded data window, whatever the period filter. */
  allTimeActualMinutes: number;
  /** False when the loaded window may start after the project did: all-time figures are then "trong dữ liệu đã tải". */
  coversWholeProject: boolean;
  /** All-time actual − estimate. */
  varianceMinutes: number;
  /** All-time actual ÷ estimate; 0 when there is no estimate (see `risk`). */
  consumptionPercent: number;
  /** PTS-05 guard: % of tasks that actually carry an estimate. */
  estimateCoveragePercent: number;
  taskCount: number;
  completedTaskCount: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  milestoneCount: number;
  activeMemberCount: number;
  onLeaveMemberCount: number;
  loggingMemberCount: number;
  deadline: string | null;
  /** PTS-04 signal on the all-time figures; `no_estimate` = nothing to compare against. */
  risk: "ok" | "watch" | "over" | "no_estimate";
}

export function buildProjectSummaries(
  dataset: TimesheetDataset,
  logs: TimeLog[],
  today: string
): ProjectSummaryRow[] {
  const minutesByProject = new Map<string, number>();
  const peopleByProject = new Map<string, Set<string>>();
  for (const log of logs) {
    minutesByProject.set(log.projectId, (minutesByProject.get(log.projectId) ?? 0) + log.minutes);
    const bucket = peopleByProject.get(log.projectId) ?? new Set<string>();
    bucket.add(log.personId);
    peopleByProject.set(log.projectId, bucket);
  }
  const allTimeMinutesByProject = new Map<string, number>();
  for (const log of dataset.logs) {
    allTimeMinutesByProject.set(log.projectId, (allTimeMinutesByProject.get(log.projectId) ?? 0) + log.minutes);
  }

  return dataset.projects
    .map((project) => {
      const tasks = projectTasks(project);
      const estimateMinutes = projectEstimateMinutes(project);
      const actualMinutes = minutesByProject.get(project.id) ?? 0;
      const withEstimate = tasks.filter((task) => task.estimateMinutes > 0).length;
      const allTimeActualMinutes = allTimeMinutesByProject.get(project.id) ?? 0;
      const consumptionPercent = estimateMinutes > 0 ? (allTimeActualMinutes / estimateMinutes) * 100 : 0;

      return {
        project,
        estimateMinutes,
        actualMinutes,
        allTimeActualMinutes,
        coversWholeProject: !dataset.windowStart || (project.startDate !== null && project.startDate >= dataset.windowStart),
        varianceMinutes: allTimeActualMinutes - estimateMinutes,
        consumptionPercent,
        estimateCoveragePercent: tasks.length > 0 ? (withEstimate / tasks.length) * 100 : 0,
        taskCount: tasks.length,
        completedTaskCount: tasks.filter((task) => task.status === "completed").length,
        blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
        overdueTaskCount: tasks.filter((task) => isTaskOverdue(task, project.status, today)).length,
        milestoneCount: project.milestones.length,
        activeMemberCount: project.members.filter((member) => member.state === "active").length,
        onLeaveMemberCount: project.members.filter((member) => member.state === "on_leave").length,
        loggingMemberCount: peopleByProject.get(project.id)?.size ?? 0,
        deadline: project.deadline,
        risk: estimateMinutes <= 0 ? "no_estimate" : consumptionPercent > 100 ? "over" : consumptionPercent > 85 ? "watch" : "ok"
      } satisfies ProjectSummaryRow;
    })
    .sort((a, b) => b.actualMinutes - a.actualMinutes);
}

export interface ProjectBreakdownNode {
  id: string;
  name: string;
  level: "milestone" | "stage" | "task";
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  estimateMinutes: number;
  /** Hours in the viewed period. */
  actualMinutes: number;
  /** Hours inside the whole loaded window; the variance is measured on this, never on one period. */
  allTimeActualMinutes: number;
  variancePercent: number | null;
  startDate: string | null;
  dueDate: string | null;
  /** Tasks only: see isTaskOverdue. */
  overdue?: boolean;
  children?: ProjectBreakdownNode[];
}

/**
 * PTS-02: Estimate + Actual at every level of Milestone → Stage → Task.
 * `logs` are the viewed period's; `allLogs` every loaded log, used for the variance against the estimate.
 */
export function buildProjectBreakdown(
  project: ProjectNode,
  logs: TimeLog[],
  people: Person[],
  today: string,
  allLogs: TimeLog[] = logs
): ProjectBreakdownNode[] {
  const nameById = new Map(people.map((person) => [person.id, person.name]));
  const minutesOf = (source: TimeLog[]) => {
    const byTask = new Map<string, number>();
    for (const log of source) {
      if (log.projectId !== project.id) continue;
      byTask.set(log.taskId, (byTask.get(log.taskId) ?? 0) + log.minutes);
    }
    return byTask;
  };
  const minutesByTask = minutesOf(logs);
  const allTimeByTask = minutesOf(allLogs);
  const variance = (allTime: number, estimate: number) => (estimate > 0 ? ((allTime - estimate) / estimate) * 100 : null);

  return project.milestones.map((milestone) => {
    const stageNodes: ProjectBreakdownNode[] = milestone.stages.map((stage) => {
      const taskNodes: ProjectBreakdownNode[] = stage.tasks.map((task) => {
        const actual = minutesByTask.get(task.id) ?? 0;
        const allTime = allTimeByTask.get(task.id) ?? 0;
        return {
          id: task.id,
          name: task.name,
          level: "task",
          status: task.status,
          ownerId: task.assigneeId,
          ownerName: task.assigneeId ? nameById.get(task.assigneeId) ?? null : null,
          estimateMinutes: task.estimateMinutes,
          actualMinutes: actual,
          allTimeActualMinutes: allTime,
          variancePercent: variance(allTime, task.estimateMinutes),
          startDate: task.startDate,
          dueDate: task.dueDate,
          overdue: isTaskOverdue(task, project.status, today)
        };
      });
      const estimate = sum(taskNodes.map((node) => node.estimateMinutes));
      const actual = sum(taskNodes.map((node) => node.actualMinutes));
      const allTime = sum(taskNodes.map((node) => node.allTimeActualMinutes));
      return {
        id: stage.id,
        name: stage.name,
        level: "stage",
        status: stage.status,
        ownerId: stage.ownerId,
        ownerName: stage.ownerId ? nameById.get(stage.ownerId) ?? null : null,
        estimateMinutes: estimate,
        actualMinutes: actual,
        allTimeActualMinutes: allTime,
        variancePercent: variance(allTime, estimate),
        startDate: stage.startDate,
        dueDate: stage.dueDate,
        children: taskNodes
      };
    });

    const estimate = sum(stageNodes.map((node) => node.estimateMinutes));
    const actual = sum(stageNodes.map((node) => node.actualMinutes));
    const allTime = sum(stageNodes.map((node) => node.allTimeActualMinutes));
    return {
      id: milestone.id,
      name: milestone.name,
      level: "milestone",
      status: milestone.status,
      ownerId: milestone.picId,
      ownerName: milestone.picId ? nameById.get(milestone.picId) ?? null : null,
      estimateMinutes: estimate,
      actualMinutes: actual,
      allTimeActualMinutes: allTime,
      variancePercent: variance(allTime, estimate),
      startDate: milestone.startDate,
      dueDate: milestone.dueDate,
      children: stageNodes
    };
  });
}

/* ── Project member state (PTS-03) ──────────────────────────────────────── */

export interface ProjectMemberRow {
  person: Person;
  role?: string;
  state: MemberState;
  joinedAt?: string;
  actualMinutes: number;
  openTaskCount: number;
  lastLoggedDate: string | null;
}

export function buildProjectMemberRows(
  project: ProjectNode,
  dataset: TimesheetDataset,
  logs: TimeLog[]
): ProjectMemberRow[] {
  const peopleById = new Map(dataset.people.map((person) => [person.id, person]));
  const projectLogs = logs.filter((log) => log.projectId === project.id);
  const tasks = projectTasks(project);

  const rows: ProjectMemberRow[] = [];
  for (const member of project.members) {
    const person = peopleById.get(member.personId);
    if (!person) continue;
    const memberLogs = projectLogs.filter((log) => log.personId === member.personId);
    const dates = memberLogs.map((log) => log.date).sort();
    rows.push({
      person,
      role: member.role,
      state: member.state,
      joinedAt: member.joinedAt,
      actualMinutes: sum(memberLogs.map((log) => log.minutes)),
      openTaskCount: tasks.filter((task) => task.assigneeId === member.personId && !isClosedNodeStatus(task.status)).length,
      lastLoggedDate: dates.length > 0 ? dates[dates.length - 1] : null
    });
  }
  return rows.sort((a, b) => b.actualMinutes - a.actualMinutes);
}

/* ── Data readiness (PTS-05) ────────────────────────────────────────────── */

export interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ProjectReadinessRow {
  project: ProjectNode;
  score: number;
  checks: ReadinessCheck[];
}

export function buildProjectReadiness(
  dataset: TimesheetDataset,
  logs: TimeLog[],
  today: string
): ProjectReadinessRow[] {
  const summaries = new Map(buildProjectSummaries(dataset, logs, today).map((row) => [row.project.id, row]));

  return dataset.projects
    .map((project) => {
      const tasks = projectTasks(project);
      const stages = project.milestones.flatMap((milestone) => milestone.stages);
      const summary = summaries.get(project.id);
      const withEstimate = tasks.filter((task) => task.estimateMinutes > 0).length;
      const withDue = tasks.filter((task) => task.dueDate !== null).length;
      const withAssignee = tasks.filter((task) => task.assigneeId !== null).length;
      const stagesWithOwner = stages.filter((stage) => stage.ownerId !== null).length;

      const checks: ReadinessCheck[] = [
        {
          key: "deadline",
          label: "Có deadline dự án",
          passed: project.deadline !== null,
          detail: project.deadline ?? "Chưa có ngày kết thúc kế hoạch"
        },
        {
          key: "milestone",
          label: "Có phân rã milestone",
          passed: project.milestones.length > 0,
          detail: `${project.milestones.length} milestone`
        },
        {
          key: "estimate",
          label: "Task có estimate ≥ 80%",
          passed: tasks.length > 0 && withEstimate / tasks.length >= 0.8,
          detail: `${withEstimate}/${tasks.length} task`
        },
        {
          key: "due",
          label: "Task có ngày hạn ≥ 80%",
          passed: tasks.length > 0 && withDue / tasks.length >= 0.8,
          detail: `${withDue}/${tasks.length} task`
        },
        {
          key: "assignee",
          label: "Task có người phụ trách ≥ 90%",
          passed: tasks.length > 0 && withAssignee / tasks.length >= 0.9,
          detail: `${withAssignee}/${tasks.length} task`
        },
        {
          key: "stage-owner",
          label: "Stage có owner",
          passed: stages.length > 0 && stagesWithOwner / stages.length >= 0.8,
          detail: `${stagesWithOwner}/${stages.length} stage`
        },
        {
          key: "log",
          label: "Có log giờ trong kỳ",
          passed: (summary?.actualMinutes ?? 0) > 0,
          detail: summary && summary.actualMinutes > 0 ? `${Math.round(summary.actualMinutes / 60)}h` : "Chưa có log"
        }
      ];

      const passed = checks.filter((check) => check.passed).length;
      return {
        project,
        score: Math.round((passed / checks.length) * 100),
        checks
      } satisfies ProjectReadinessRow;
    })
    .sort((a, b) => a.score - b.score);
}

/* ── Utilities ──────────────────────────────────────────────────────────── */

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function emptyWorkGroupTotals(): Record<WorkGroup, number> {
  return {
    customer_project: 0,
    internal_project: 0,
    ticket_maintenance: 0,
    meeting: 0,
    training: 0,
    other: 0
  };
}
