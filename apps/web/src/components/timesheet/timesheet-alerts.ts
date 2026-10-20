import { isWorkingDay, monthBounds } from "./timesheet-dates";
import { buildProjectSummaries, leaveFraction, peopleInScope, projectTasks, selectedProjectIds, type TimesheetFilters } from "./timesheet-selectors";
import { isTaskOverdue } from "./timesheet-status";
import type { TimeLog, TimesheetDataset } from "./timesheet-types";

export type TimesheetAlertTone = "danger" | "warning" | "info";

export interface TimesheetAlertItem {
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface TimesheetAlert {
  id: string;
  tone: TimesheetAlertTone;
  label: string;
  detail: string;
  count: number;
  items: TimesheetAlertItem[];
}

/**
 * Build the compact alert strip used by the group Timesheet views.
 * Every count follows the active filters: project filter for task/plan alerts,
 * department/person filters for "chưa ghi giờ hôm nay" — which only exists when
 * the viewed period contains today and today is a working day.
 */
export function buildTimesheetAlerts(dataset: TimesheetDataset, logs: TimeLog[], today: string, filters: TimesheetFilters): TimesheetAlert[] {
  const projectIds = selectedProjectIds(filters);
  const summaries = buildProjectSummaries(dataset, logs, today).filter((row) => projectIds.length === 0 || projectIds.includes(row.project.id));
  const overdueTasks = summaries.reduce((total, row) => total + row.overdueTaskCount, 0);
  const blockedTasks = summaries.reduce((total, row) => total + row.blockedTaskCount, 0);
  // All-time actual vs all-time estimate (see buildProjectSummaries), not the period's hours.
  const overPlanProjects = summaries.filter((row) => row.risk === "over").length;
  // Anyone with an entry today has logged, whatever project/work-group filter narrows `logs`.
  const loggedToday = new Set(dataset.logs.filter((log) => log.date === today).map((log) => log.personId));
  const monthRange = monthBounds(filters.month);
  const periodStart = filters.dateFrom || monthRange.start;
  const periodEnd = filters.dateTo || monthRange.end;
  const todayInPeriod = today >= periodStart && today <= periodEnd && isWorkingDay(today, dataset.holidays);
  // Nobody on a full day of approved leave is asked to log (rules §543: leave turns off missing-log reminders).
  const missingToday = (person: { id: string }) => !loggedToday.has(person.id) && leaveFraction(dataset, person.id, today) < 1;
  const missingPeople = todayInPeriod ? peopleInScope(dataset, filters).filter(missingToday).length : 0;

  const missingLogItems: TimesheetAlertItem[] = todayInPeriod
    ? peopleInScope(dataset, filters)
        .filter(missingToday)
        .map((person) => ({
          id: person.id,
          title: person.name,
          detail: "Chưa ghi giờ hôm nay · mở Timesheet theo nhân sự",
          href: `/timesheet?person=${encodeURIComponent(person.id)}&from=${today}&to=${today}`
        }))
    : [];
  const overdueItems: TimesheetAlertItem[] = summaries.flatMap((row) => projectTasks(row.project)
    .filter((task) => isTaskOverdue(task, row.project.status, today))
    .map((task) => ({
      id: `${row.project.id}:${task.id}`,
      title: task.name,
      detail: `${row.project.code} — ${row.project.name}`,
      href: `/tasks/${encodeURIComponent(task.id)}`
    })));
  const blockedItems: TimesheetAlertItem[] = summaries.flatMap((row) => projectTasks(row.project)
    .filter((task) => task.status === "blocked")
    .map((task) => ({
      id: `${row.project.id}:${task.id}`,
      title: task.name,
      detail: `${row.project.code} — ${row.project.name}`,
      href: `/tasks/${encodeURIComponent(task.id)}`
    })));
  const overPlanItems: TimesheetAlertItem[] = summaries
    .filter((row) => row.risk === "over")
    .map((row) => ({
      id: row.project.id,
      title: row.project.name,
      detail: `${row.project.code} · mở Project Sheet để xem chênh lệch giờ`,
      href: `/projects/${encodeURIComponent(row.project.id)}?tab=Project%20Sheet`
    }));

  const alerts: TimesheetAlert[] = [];
  if (missingPeople > 0) alerts.push({ id: "missing-logs", tone: "warning", label: "nhân sự chưa ghi giờ hôm nay", detail: "Kiểm tra bảng giờ cá nhân", count: missingLogItems.length, items: missingLogItems });
  if (overdueTasks > 0) alerts.push({ id: "overdue-tasks", tone: "danger", label: "task quá hạn", detail: "Mở task cụ thể để xử lý", count: overdueItems.length, items: overdueItems });
  if (blockedTasks > 0) alerts.push({ id: "blocked-tasks", tone: "danger", label: "task đang bị chặn", detail: "Mở task cụ thể để cập nhật blocker hoặc owner", count: blockedItems.length, items: blockedItems });
  if (overPlanProjects > 0) alerts.push({ id: "over-plan", tone: "warning", label: "dự án vượt kế hoạch giờ", detail: "Mở Project Sheet của từng dự án", count: overPlanItems.length, items: overPlanItems });
  return alerts;
}
