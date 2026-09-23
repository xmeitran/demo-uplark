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
  isoWeekKey,
  monthBounds,
  monthOf,
  startOfIsoWeek
} from "./timesheet-mock-data";
import type {
  MemberState,
  MilestoneNode,
  NodeStatus,
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
  projectId: string | "all";
  workGroup: WorkGroup | "all";
}

export function filterLogs(dataset: TimesheetDataset, filters: TimesheetFilters): TimeLog[] {
  const peopleById = new Map(dataset.people.map((person) => [person.id, person]));
  return dataset.logs.filter((log) => {
    if (monthOf(log.date) !== filters.month) return false;
    if (filters.personId !== "all" && log.personId !== filters.personId) return false;
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
  return dataset.people.filter((person) => {
    if (!person.active) return false;
    if (filters.departmentId !== "all" && person.departmentId !== filters.departmentId) return false;
    if (filters.personId !== "all" && person.id !== filters.personId) return false;
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
        daysLogged: loggedDays.size,
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
  const standardMinutes = sum(summaries.map((item) => item.standardMinutes));
  const possibleDays = summaries.length * workingDays.length;
  const loggedDays = sum(summaries.map((item) => item.daysLogged));

  return {
    actualMinutes,
    standardMinutes,
    completionPercent: standardMinutes > 0 ? (actualMinutes / standardMinutes) * 100 : 0,
    missingMinutes: Math.max(0, standardMinutes - actualMinutes),
    projectCount: new Set(logs.map((log) => log.projectId)).size,
    peopleCount: summaries.length,
    workingDays: workingDays.length,
    dayCoveragePercent: possibleDays > 0 ? (loggedDays / possibleDays) * 100 : 0,
    billablePercent: actualMinutes > 0 ? (sum(logs.filter((log) => log.billable).map((log) => log.minutes)) / actualMinutes) * 100 : 0
  };
}

/* ── Daily / weekly series (MTS-01, DTS-01, WTS-01) ─────────────────────── */

export interface DayBucket {
  date: string;
  label: string;
  actualMinutes: number;
  standardMinutes: number;
  isWorkingDay: boolean;
  entryCount: number;
  peopleLogged: number;
}

export function buildDailySeries(
  dataset: TimesheetDataset,
  filters: TimesheetFilters,
  logs: TimeLog[],
  summaries: PersonMonthSummary[]
): DayBucket[] {
  const { start, end } = monthBounds(filters.month);
  const cap = dataset.generatedAt < end ? dataset.generatedAt : end;
  const perDayStandard = sum(summaries.map((item) => item.person.standardMinutesPerDay * item.person.contractRatio));
  const byDate = new Map<string, TimeLog[]>();
  for (const log of logs) {
    const bucket = byDate.get(log.date);
    if (bucket) bucket.push(log);
    else byDate.set(log.date, [log]);
  }

  return eachDate(start, cap).map((iso) => {
    const dayLogs = byDate.get(iso) ?? [];
    const working = isWorkingDay(iso, dataset.holidays);
    return {
      date: iso,
      label: `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`,
      actualMinutes: sum(dayLogs.map((log) => log.minutes)),
      standardMinutes: working ? Math.round(perDayStandard) : 0,
      isWorkingDay: working,
      entryCount: dayLogs.length,
      peopleLogged: new Set(dayLogs.map((log) => log.personId)).size
    } satisfies DayBucket;
  });
}

export interface WeekBucket {
  weekKey: string;
  label: string;
  startDate: string;
  actualMinutes: number;
  standardMinutes: number;
  workingDays: number;
  daysLogged: number;
  compliancePercent: number;
}

export function buildWeeklySeries(
  dataset: TimesheetDataset,
  filters: TimesheetFilters,
  days: DayBucket[]
): WeekBucket[] {
  const grouped = new Map<string, DayBucket[]>();
  for (const day of days) {
    const key = isoWeekKey(day.date);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(day);
    else grouped.set(key, [day]);
  }

  return Array.from(grouped.entries())
    .map(([weekKey, bucketDays]) => {
      const workingDays = bucketDays.filter((day) => day.isWorkingDay);
      const actualMinutes = sum(bucketDays.map((day) => day.actualMinutes));
      const standardMinutes = sum(workingDays.map((day) => day.standardMinutes));
      return {
        weekKey,
        label: `Tuần ${weekKey.slice(-2)}`,
        startDate: startOfIsoWeek(bucketDays[0].date),
        actualMinutes,
        standardMinutes,
        workingDays: workingDays.length,
        daysLogged: workingDays.filter((day) => day.actualMinutes > 0).length,
        compliancePercent: standardMinutes > 0 ? (actualMinutes / standardMinutes) * 100 : 0
      } satisfies WeekBucket;
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/* ── Cumulative flow + cycle time (Jira §4.2 reporting standards) ───────── */

const FLOW_STATES: NodeStatus[] = ["not_started", "in_progress", "blocked", "completed"];

export interface FlowDayPoint {
  date: string;
  label: string;
  not_started: number;
  in_progress: number;
  blocked: number;
  completed: number;
  /** Items started but not finished — the band thickness that matters. */
  wip: number;
  /** Total items created up to this day. */
  total: number;
}

export interface CumulativeFlowResult {
  points: FlowDayPoint[];
  /** Mean WIP across the covered days. */
  averageWip: number;
  /** Items completed inside the covered range. */
  throughput: number;
  /** Items completed per calendar week inside the range. */
  throughputPerWeek: number;
  /** Days where the blocked band grew — bottleneck evidence. */
  blockedGrowthDays: number;
  peakBlocked: number;
}

/**
 * Cumulative flow: how many items sit in each workflow state on each day.
 *
 * Rendered as a stacked area, so the total height is everything created so far,
 * each band's thickness is the WIP in that state, and the slope of the
 * `completed` band is throughput. A band that stays thick over time is the
 * bottleneck — that is the whole point of the diagram.
 */
export function buildCumulativeFlow(
  dataset: TimesheetDataset,
  filters: TimesheetFilters
): CumulativeFlowResult {
  const { start, end } = monthBounds(filters.month);
  const cap = dataset.generatedAt < end ? dataset.generatedAt : end;
  const days = eachDate(start, cap);

  const events = dataset.statusEvents
    .filter((event) => filters.projectId === "all" || event.projectId === filters.projectId)
    .slice()
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  // Replay the whole history so a task created before the month still counts.
  const stateByTask = new Map<string, NodeStatus>();
  let cursor = 0;
  const points: FlowDayPoint[] = [];

  const applyUpTo = (dateInclusive: string) => {
    while (cursor < events.length && events[cursor].changedAt <= dateInclusive) {
      stateByTask.set(events[cursor].taskId, events[cursor].toStatus);
      cursor += 1;
    }
  };

  for (const date of days) {
    applyUpTo(date);
    const counts: Record<NodeStatus, number> = { not_started: 0, in_progress: 0, blocked: 0, completed: 0 };
    for (const state of stateByTask.values()) counts[state] += 1;
    points.push({
      date,
      label: `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`,
      ...counts,
      wip: counts.in_progress + counts.blocked,
      total: stateByTask.size
    });
  }

  const completedInRange = events.filter(
    (event) => event.toStatus === "completed" && event.changedAt >= start && event.changedAt <= cap
  ).length;
  const weeks = Math.max(1, days.length / 7);

  let blockedGrowthDays = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].blocked > points[index - 1].blocked) blockedGrowthDays += 1;
  }

  return {
    points,
    averageWip: points.length > 0 ? sum(points.map((point) => point.wip)) / points.length : 0,
    throughput: completedInRange,
    throughputPerWeek: completedInRange / weeks,
    blockedGrowthDays,
    peakBlocked: points.reduce((acc, point) => Math.max(acc, point.blocked), 0)
  };
}

export interface CycleTimePoint {
  taskId: string;
  taskName: string;
  projectCode: string;
  /** Completion date — the x axis. */
  completedAt: string;
  /** Days from first `in_progress` to `completed` — the y axis. */
  cycleDays: number;
  /** Numeric x for the scatter plot (days since range start). */
  x: number;
  /** Rolling mean of the last `ROLLING_WINDOW` completions, in order. */
  rollingAverage: number;
  outlier: boolean;
}

export interface ControlChartResult {
  points: CycleTimePoint[];
  mean: number;
  median: number;
  standardDeviation: number;
  /** mean + 2σ — the upper control limit. */
  upperLimit: number;
  outliers: number;
  /** Days covered, used to label the x axis. */
  days: string[];
  /**
   * Control limits computed from a handful of points are noise. Below this many
   * completions the limits are shown but must be labelled as provisional.
   */
  sampleAdequate: boolean;
}

/** Minimum completions before mean ± 2σ limits are worth acting on. */
export const CONTROL_CHART_MIN_SAMPLE = 12;

const ROLLING_WINDOW = 5;

/**
 * Control chart: cycle time per completed item, with a rolling average and an
 * upper control limit at mean + 2σ.
 *
 * Used for stability and forecasting: tight scatter under the limit means the
 * process is predictable, so cycle time can be used to forecast. Points above
 * the limit are the ones worth a post-mortem — not the average.
 *
 * Cycle time is measured from the first `in_progress` transition, NOT from task
 * creation: time sitting in the backlog is lead time, and conflating the two
 * flatters the delivery process.
 */
export function buildControlChart(
  dataset: TimesheetDataset,
  filters: TimesheetFilters
): ControlChartResult {
  const { start, end } = monthBounds(filters.month);
  const cap = dataset.generatedAt < end ? dataset.generatedAt : end;
  const days = eachDate(start, cap);

  const taskMeta = new Map<string, { name: string; projectCode: string }>();
  for (const project of dataset.projects) {
    if (filters.projectId !== "all" && project.id !== filters.projectId) continue;
    for (const milestone of project.milestones) {
      for (const stage of milestone.stages) {
        for (const task of stage.tasks) taskMeta.set(task.id, { name: task.name, projectCode: project.code });
      }
    }
  }

  const startedAt = new Map<string, string>();
  const completedAt = new Map<string, string>();
  for (const event of dataset.statusEvents.slice().sort((a, b) => a.changedAt.localeCompare(b.changedAt))) {
    if (!taskMeta.has(event.taskId)) continue;
    if (event.toStatus === "in_progress" && !startedAt.has(event.taskId)) startedAt.set(event.taskId, event.changedAt);
    if (event.toStatus === "completed") completedAt.set(event.taskId, event.changedAt);
  }

  const raw = [...completedAt.entries()]
    .filter(([taskId, done]) => done >= start && done <= cap && startedAt.has(taskId))
    .map(([taskId, done]) => {
      const began = startedAt.get(taskId) as string;
      return {
        taskId,
        taskName: taskMeta.get(taskId)?.name ?? taskId,
        projectCode: taskMeta.get(taskId)?.projectCode ?? "",
        completedAt: done,
        cycleDays: Math.max(1, daysBetweenISO(began, done)),
        x: daysBetweenISO(start, done)
      };
    })
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const values = raw.map((item) => item.cycleDays);
  const mean = values.length > 0 ? sum(values) / values.length : 0;
  const variance = values.length > 0 ? sum(values.map((value) => (value - mean) ** 2)) / values.length : 0;
  const standardDeviation = Math.sqrt(variance);
  const upperLimit = mean + 2 * standardDeviation;

  const points = raw.map((item, index) => {
    const window = values.slice(Math.max(0, index - ROLLING_WINDOW + 1), index + 1);
    return {
      ...item,
      rollingAverage: Math.round((sum(window) / window.length) * 10) / 10,
      outlier: item.cycleDays > upperLimit
    } satisfies CycleTimePoint;
  });

  return {
    points,
    mean: Math.round(mean * 10) / 10,
    median: Math.round(median(values) * 10) / 10,
    standardDeviation: Math.round(standardDeviation * 10) / 10,
    upperLimit: Math.round(upperLimit * 10) / 10,
    outliers: points.filter((point) => point.outlier).length,
    days,
    sampleAdequate: points.length >= CONTROL_CHART_MIN_SAMPLE
  };
}

function daysBetweenISO(fromISO: string, toISO: string): number {
  return Math.round(
    (new Date(`${toISO}T00:00:00Z`).getTime() - new Date(`${fromISO}T00:00:00Z`).getTime()) / 86_400_000
  );
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
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

/* ── Weekly planned-vs-actual effort per task ───────────────────────────── */

export interface WeeklyEffortPerTaskPoint {
  weekKey: string;
  label: string;
  startDate: string;
  /** Tasks that carry an estimate AND were worked on during the week. */
  taskCount: number;
  /** Tasks worked on in the week that have no estimate (excluded from averages). */
  excludedTaskCount: number;
  /** Average entered estimate of those tasks. */
  plannedMinutesPerTask: number | null;
  /** Average total effort logged on those same tasks, up to the end of the week. */
  actualMinutesPerTask: number | null;
  /** actual / planned, as a percentage. 100% = effort matches the plan. */
  matchPercent: number | null;
  /** % of tasks worked on in the week that carry an estimate. */
  estimateCoveragePercent: number;
}

/**
 * Weekly "is our effort per task matching the plan?" series.
 *
 * Both lines are measured on the SAME denominator — the set of tasks worked on
 * during that week that carry an entered estimate — so they are directly
 * comparable:
 *   • planned  = average `estimateMinutes` of those tasks (whole-task plan)
 *   • actual   = average effort logged on those tasks from the start of the
 *                range through the end of that week (whole-task consumption)
 *
 * Tasks with no estimate are excluded from both averages and reported
 * separately, so a project with poor estimate coverage cannot silently make the
 * plan line look better than it is.
 *
 * The result is a direct plan-versus-consumption comparison for the selected range.
 */
export function buildWeeklyEffortPerTask(
  dataset: TimesheetDataset,
  logs: TimeLog[],
  weeks: WeekBucket[]
): WeeklyEffortPerTaskPoint[] {
  const estimateByTask = new Map<string, number>();
  for (const project of dataset.projects) {
    for (const milestone of project.milestones) {
      for (const stage of milestone.stages) {
        for (const task of stage.tasks) estimateByTask.set(task.id, task.estimateMinutes);
      }
    }
  }

  return weeks.map((week) => {
    const weekEnd = addDaysISO(week.startDate, 7);
    const tasksInWeek = new Set<string>();
    for (const log of logs) {
      if (log.date >= week.startDate && log.date < weekEnd) tasksInWeek.add(log.taskId);
    }

    const withEstimate = [...tasksInWeek].filter((taskId) => (estimateByTask.get(taskId) ?? 0) > 0);
    const excluded = tasksInWeek.size - withEstimate.length;

    if (withEstimate.length === 0) {
      return {
        weekKey: week.weekKey,
        label: week.label,
        startDate: week.startDate,
        taskCount: 0,
        excludedTaskCount: excluded,
        plannedMinutesPerTask: null,
        actualMinutesPerTask: null,
        matchPercent: null,
        estimateCoveragePercent: tasksInWeek.size === 0 ? 0 : 0
      } satisfies WeeklyEffortPerTaskPoint;
    }

    const taskIds = new Set(withEstimate);
    const cumulativeByTask = new Map<string, number>();
    for (const log of logs) {
      if (!taskIds.has(log.taskId)) continue;
      if (log.date >= weekEnd) continue; // effort to date, through the end of this week
      cumulativeByTask.set(log.taskId, (cumulativeByTask.get(log.taskId) ?? 0) + log.minutes);
    }

    const plannedTotal = sum(withEstimate.map((taskId) => estimateByTask.get(taskId) ?? 0));
    const actualTotal = sum(withEstimate.map((taskId) => cumulativeByTask.get(taskId) ?? 0));
    const planned = plannedTotal / withEstimate.length;
    const actual = actualTotal / withEstimate.length;

    return {
      weekKey: week.weekKey,
      label: week.label,
      startDate: week.startDate,
      taskCount: withEstimate.length,
      excludedTaskCount: excluded,
      plannedMinutesPerTask: Math.round(planned),
      actualMinutesPerTask: Math.round(actual),
      matchPercent: planned > 0 ? (actual / planned) * 100 : null,
      estimateCoveragePercent: tasksInWeek.size > 0 ? (withEstimate.length / tasksInWeek.size) * 100 : 0
    } satisfies WeeklyEffortPerTaskPoint;
  });
}

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
        estimateMinutes: projectEstimateMinutes(project),
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
  actualMinutes: number;
  varianceMinutes: number;
  consumptionPercent: number;
  /** PTS-05 guard: % of tasks that actually carry an estimate. */
  estimateCoveragePercent: number;
  taskCount: number;
  completedTaskCount: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  milestoneCount: number;
  activeMemberCount: number;
  onHoldMemberCount: number;
  loggingMemberCount: number;
  deadline: string | null;
  /** PTS-04 signal. */
  risk: "ok" | "watch" | "over";
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

  return dataset.projects
    .map((project) => {
      const tasks = projectTasks(project);
      const estimateMinutes = projectEstimateMinutes(project);
      const actualMinutes = minutesByProject.get(project.id) ?? 0;
      const withEstimate = tasks.filter((task) => task.estimateMinutes > 0).length;
      const consumptionPercent = estimateMinutes > 0 ? (actualMinutes / estimateMinutes) * 100 : 0;

      return {
        project,
        estimateMinutes,
        actualMinutes,
        varianceMinutes: actualMinutes - estimateMinutes,
        consumptionPercent,
        estimateCoveragePercent: tasks.length > 0 ? (withEstimate / tasks.length) * 100 : 0,
        taskCount: tasks.length,
        completedTaskCount: tasks.filter((task) => task.status === "completed").length,
        blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
        overdueTaskCount: tasks.filter((task) => task.status !== "completed" && task.dueDate !== null && task.dueDate < today).length,
        milestoneCount: project.milestones.length,
        activeMemberCount: project.members.filter((member) => member.state === "active").length,
        onHoldMemberCount: project.members.filter((member) => member.state === "on_hold").length,
        loggingMemberCount: peopleByProject.get(project.id)?.size ?? 0,
        deadline: project.deadline,
        risk: consumptionPercent > 100 ? "over" : consumptionPercent > 85 ? "watch" : "ok"
      } satisfies ProjectSummaryRow;
    })
    .sort((a, b) => b.actualMinutes - a.actualMinutes);
}

export interface ProjectBreakdownNode {
  id: string;
  name: string;
  level: "milestone" | "stage" | "task";
  status: string;
  ownerName: string | null;
  estimateMinutes: number;
  actualMinutes: number;
  variancePercent: number | null;
  startDate: string | null;
  dueDate: string | null;
  children?: ProjectBreakdownNode[];
}

/** PTS-02: Estimate + Actual at every level of Milestone → Stage → Task. */
export function buildProjectBreakdown(
  project: ProjectNode,
  logs: TimeLog[],
  people: Person[]
): ProjectBreakdownNode[] {
  const nameById = new Map(people.map((person) => [person.id, person.name]));
  const minutesByTask = new Map<string, number>();
  for (const log of logs) {
    if (log.projectId !== project.id) continue;
    minutesByTask.set(log.taskId, (minutesByTask.get(log.taskId) ?? 0) + log.minutes);
  }

  return project.milestones.map((milestone) => {
    const stageNodes: ProjectBreakdownNode[] = milestone.stages.map((stage) => {
      const taskNodes: ProjectBreakdownNode[] = stage.tasks.map((task) => {
        const actual = minutesByTask.get(task.id) ?? 0;
        return {
          id: task.id,
          name: task.name,
          level: "task",
          status: task.status,
          ownerName: task.assigneeId ? nameById.get(task.assigneeId) ?? null : null,
          estimateMinutes: task.estimateMinutes,
          actualMinutes: actual,
          variancePercent: task.estimateMinutes > 0 ? ((actual - task.estimateMinutes) / task.estimateMinutes) * 100 : null,
          startDate: task.startDate,
          dueDate: task.dueDate
        };
      });
      const estimate = sum(taskNodes.map((node) => node.estimateMinutes));
      const actual = sum(taskNodes.map((node) => node.actualMinutes));
      return {
        id: stage.id,
        name: stage.name,
        level: "stage",
        status: stage.status,
        ownerName: stage.ownerId ? nameById.get(stage.ownerId) ?? null : null,
        estimateMinutes: estimate,
        actualMinutes: actual,
        variancePercent: estimate > 0 ? ((actual - estimate) / estimate) * 100 : null,
        startDate: stage.startDate,
        dueDate: stage.dueDate,
        children: taskNodes
      };
    });

    const estimate = sum(stageNodes.map((node) => node.estimateMinutes));
    const actual = sum(stageNodes.map((node) => node.actualMinutes));
    return {
      id: milestone.id,
      name: milestone.name,
      level: "milestone",
      status: milestone.status,
      ownerName: milestone.picId ? nameById.get(milestone.picId) ?? null : null,
      estimateMinutes: estimate,
      actualMinutes: actual,
      variancePercent: estimate > 0 ? ((actual - estimate) / estimate) * 100 : null,
      startDate: milestone.startDate,
      dueDate: milestone.dueDate,
      children: stageNodes
    };
  });
}

/* ── Project member state (PTS-03) ──────────────────────────────────────── */

export interface ProjectMemberRow {
  person: Person;
  role: string;
  state: MemberState;
  joinedAt: string;
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
      openTaskCount: tasks.filter((task) => task.assigneeId === member.personId && task.status !== "completed").length,
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
          detail: project.deadline ?? "Chưa đặt deadline"
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
