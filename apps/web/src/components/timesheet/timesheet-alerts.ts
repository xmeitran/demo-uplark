import { buildProjectSummaries } from "./timesheet-selectors";
import type { TimeLog, TimesheetDataset } from "./timesheet-types";

export type TimesheetAlertTone = "danger" | "warning" | "info";

export interface TimesheetAlert {
  id: string;
  tone: TimesheetAlertTone;
  label: string;
  detail: string;
  count: number;
}

/** Build the compact alert strip used by the group Timesheet views. */
export function buildTimesheetAlerts(dataset: TimesheetDataset, logs: TimeLog[], today: string): TimesheetAlert[] {
  const summaries = buildProjectSummaries(dataset, logs, today);
  const overdueTasks = summaries.reduce((total, row) => total + row.overdueTaskCount, 0);
  const blockedTasks = summaries.reduce((total, row) => total + row.blockedTaskCount, 0);
  const overPlanProjects = summaries.filter((row) => row.risk === "over").length;
  const loggedToday = new Set(logs.filter((log) => log.date === today).map((log) => log.personId));
  const missingPeople = dataset.people.filter((person) => person.active && !loggedToday.has(person.id)).length;

  const alerts: TimesheetAlert[] = [];
  if (missingPeople > 0) alerts.push({ id: "missing-logs", tone: "warning", label: "nhân sự chưa ghi giờ hôm nay", detail: "Kiểm tra bảng giờ cá nhân", count: missingPeople });
  if (overdueTasks > 0) alerts.push({ id: "overdue-tasks", tone: "danger", label: "task quá hạn", detail: "Mở Project Sheet để xử lý", count: overdueTasks });
  if (blockedTasks > 0) alerts.push({ id: "blocked-tasks", tone: "danger", label: "task đang bị chặn", detail: "Cần cập nhật blocker hoặc owner", count: blockedTasks });
  if (overPlanProjects > 0) alerts.push({ id: "over-plan", tone: "warning", label: "dự án vượt kế hoạch giờ", detail: "Xem chênh lệch kế hoạch/thực tế", count: overPlanProjects });
  return alerts;
}
