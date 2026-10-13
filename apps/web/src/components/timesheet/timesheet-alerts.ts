import { isWorkingDay, monthBounds } from "./timesheet-dates";
import { buildProjectSummaries, peopleInScope, selectedProjectIds, type TimesheetFilters } from "./timesheet-selectors";
import type { TimeLog, TimesheetDataset } from "./timesheet-types";

export type TimesheetAlertTone = "danger" | "warning" | "info";

export interface TimesheetAlert {
  id: string;
  tone: TimesheetAlertTone;
  label: string;
  detail: string;
  count: number;
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
  const missingPeople = todayInPeriod ? peopleInScope(dataset, filters).filter((person) => !loggedToday.has(person.id)).length : 0;

  const alerts: TimesheetAlert[] = [];
  if (missingPeople > 0) alerts.push({ id: "missing-logs", tone: "warning", label: "nhân sự chưa ghi giờ hôm nay", detail: "Kiểm tra bảng giờ cá nhân", count: missingPeople });
  if (overdueTasks > 0) alerts.push({ id: "overdue-tasks", tone: "danger", label: "task quá hạn", detail: "Mở Project Sheet để xử lý", count: overdueTasks });
  if (blockedTasks > 0) alerts.push({ id: "blocked-tasks", tone: "danger", label: "task đang bị chặn", detail: "Cần cập nhật blocker hoặc owner", count: blockedTasks });
  if (overPlanProjects > 0) alerts.push({ id: "over-plan", tone: "warning", label: "dự án vượt kế hoạch giờ", detail: "Xem chênh lệch kế hoạch/thực tế", count: overPlanProjects });
  return alerts;
}
