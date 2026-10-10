import type { TimesheetFilters } from "./timesheet-selectors";
import { formatDepartmentLabel } from "@/lib/department-labels";
import { projectStatusLabel } from "@/lib/project-status";
import { addExcelTableSheet, excelDate, styleExcelHeaderCells, type ExcelCell } from "@/lib/excel-table-sheet";
import {
  NODE_STATUS_LABELS,
  WORK_GROUP_LABELS,
  type TimesheetDataset,
  type TimeLog
} from "./timesheet-types";

type ExcelJsModule = typeof import("exceljs");

export interface TimesheetExportContext {
  dataset: TimesheetDataset;
  filters: TimesheetFilters;
  logs: TimeLog[];
  scopeLabel: string;
  view: string;
}

export interface TimesheetExportResult {
  filename: string;
  logCount: number;
}

function hours(minutes: number | null | undefined) {
  return Math.round(((minutes ?? 0) / 60) * 100) / 100;
}

function monthBoundsOf(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}` };
}

type Cell = ExcelCell;
const addTableSheet = addExcelTableSheet;

function makeTaskIndex(dataset: TimesheetDataset) {
  const index = new Map<string, { milestoneName: string; stageName: string; taskName: string; taskStatus: string; estimateMinutes: number }>();
  for (const project of dataset.projects) {
    for (const milestone of project.milestones) {
      for (const stage of milestone.stages) {
        for (const task of stage.tasks) {
          index.set(`${project.id}:${task.id}`, {
            milestoneName: milestone.name,
            stageName: stage.name,
            taskName: task.name,
            taskStatus: NODE_STATUS_LABELS[task.status],
            estimateMinutes: task.estimateMinutes
          });
        }
      }
    }
  }
  return index;
}

export const TIMESHEET_EXPORT_SHEETS = ["Tổng quan", "Theo dự án", "Theo nhân sự", "Tiến độ theo Ngày", "Raw Data"] as const;

/**
 * Builds the Timesheet export following the Project_Management_Dashboard
 * template: five sheets, one table per sheet. Every summary sheet is derived
 * from the same filtered logs as "Raw Data", so the sheets always reconcile.
 */
export function buildTimesheetWorkbook(ExcelJS: ExcelJsModule, context: TimesheetExportContext) {
  const { dataset, filters, logs } = context;
  const peopleById = new Map(dataset.people.map((person) => [person.id, person]));
  const projectsById = new Map(dataset.projects.map((project) => [project.id, project]));
  const taskIndex = makeTaskIndex(dataset);
  const taskKey = (log: TimeLog) => `${log.projectId}:${log.taskId}`;
  const round2 = (value: number) => Math.round(value * 100) / 100;

  type Bucket = { minutes: number; people: Set<string>; projects: Set<string>; tasks: Set<string>; dates: Set<string> };
  const bucket = (): Bucket => ({ minutes: 0, people: new Set(), projects: new Set(), tasks: new Set(), dates: new Set() });
  const add = (target: Bucket, log: TimeLog) => { target.minutes += log.minutes; target.people.add(log.personId); target.projects.add(log.projectId); target.tasks.add(taskKey(log)); target.dates.add(log.date); };
  const total = bucket();
  const byProject = new Map<string, Bucket>();
  const byPerson = new Map<string, Bucket>();
  const byDate = new Map<string, Bucket>();
  for (const log of logs) {
    add(total, log);
    for (const [map, key] of [[byProject, log.projectId], [byPerson, log.personId], [byDate, log.date]] as const) {
      const current = map.get(key) ?? bucket();
      add(current, log);
      map.set(key, current);
    }
  }
  // Estimate of the tasks that were actually logged, so it matches "Giờ estimate task" in Raw Data.
  const estimateMinutes = (tasks: Set<string>) => Array.from(tasks).reduce((sum, key) => sum + (taskIndex.get(key)?.estimateMinutes ?? 0), 0);

  const workbook = new ExcelJS.Workbook();

  // 1 · Tổng quan
  const range = monthBoundsOf(filters.month);
  const overview = workbook.addWorksheet(TIMESHEET_EXPORT_SHEETS[0]);
  overview.addRows([
    ["Từ ngày", excelDate(range.from)],
    ["Đến ngày", excelDate(range.to)],
    [],
    ["CHỈ SỐ TỔNG QUAN DỰ ÁN", "Giá trị"],
    ["Tổng số giờ thực tế", hours(total.minutes)],
    ["Tổng số giờ Estimate", hours(estimateMinutes(total.tasks))],
    ["Tổng số dự án", total.projects.size],
    ["Tổng số nhân sự", total.people.size],
    ["Tổng số task", total.tasks.size]
  ]);
  overview.columns = [{ width: 34 }, { width: 18 }];
  overview.getCell("B1").numFmt = "dd/mm/yyyy";
  overview.getCell("B2").numFmt = "dd/mm/yyyy";
  styleExcelHeaderCells(overview, 4, 2);

  // 2 · Theo dự án
  const projectRows: Cell[][] = Array.from(byProject.entries())
    .sort((left, right) => right[1].minutes - left[1].minutes)
    .map(([projectId, data]) => {
      const project = projectsById.get(projectId);
      const estimate = estimateMinutes(data.tasks);
      return [
        project?.name ?? "Chưa xác định",
        project?.code ?? projectId,
        project?.accountName ?? "—",
        project ? projectStatusLabel(project.status) : "—",
        hours(data.minutes),
        hours(estimate),
        data.people.size,
        data.tasks.size,
        estimate > 0 ? round2((data.minutes / estimate) * 100) : 0
      ];
    });
  addTableSheet(workbook, TIMESHEET_EXPORT_SHEETS[1], ["Tên dự án", "Mã dự án", "Khách hàng / tài khoản", "Trạng thái dự án", "Tổng_số_giờ", "Giờ_Estimate", "Số_nhân_sự", "Số_task", "Tỷ_lệ_so_với_Estimate_(%)"], projectRows, [42, 22, 28, 20, 14, 14, 12, 10, 24]);

  // 3 · Theo nhân sự
  const personRows: Cell[][] = Array.from(byPerson.entries())
    .sort((left, right) => right[1].minutes - left[1].minutes)
    .map(([personId, data]) => {
      const person = peopleById.get(personId);
      return [
        person?.name ?? personId,
        person?.role ?? "—",
        person?.departmentId ? formatDepartmentLabel(person.departmentId) : "Chưa phân loại",
        hours(data.minutes),
        data.projects.size,
        data.tasks.size,
        data.dates.size,
        data.dates.size ? round2(data.minutes / 60 / data.dates.size) : 0
      ];
    });
  addTableSheet(workbook, TIMESHEET_EXPORT_SHEETS[2], ["Nhân sự", "Vai trò", "Phòng ban", "Tổng_số_giờ", "Số_dự_án", "Số_task", "Ngày_làm_việc_đã_log", "Trung_bình_giờ/ngày"], personRows, [28, 24, 20, 14, 12, 10, 22, 20]);

  // 4 · Tiến độ theo Ngày (only days that have logs)
  const dayRows: Cell[][] = Array.from(byDate.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, data]) => [excelDate(date), hours(data.minutes), data.people.size, data.projects.size, data.tasks.size]);
  addTableSheet(workbook, TIMESHEET_EXPORT_SHEETS[3], ["Ngày", "Tổng_số_giờ", "Số_nhân_sự", "Số_dự_án", "Số_task"], dayRows, [14, 14, 14, 12, 10], { 1: "dd/mm/yyyy" });

  // 5 · Raw Data: one row per time entry
  const rawRows: Cell[][] = logs
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.personId.localeCompare(b.personId) || a.id.localeCompare(b.id))
    .map((log) => {
      const person = peopleById.get(log.personId);
      const project = projectsById.get(log.projectId);
      const task = taskIndex.get(taskKey(log));
      return [
        excelDate(log.date),
        log.personId,
        person?.name ?? log.personId,
        person?.departmentId ? formatDepartmentLabel(person.departmentId) : "Chưa phân loại",
        person?.role ?? "—",
        log.projectId,
        project?.code ?? log.projectId,
        project?.name ?? "Chưa xác định",
        project?.accountName ?? "—",
        project ? projectStatusLabel(project.status) : "—",
        task?.milestoneName ?? "Chưa phân loại",
        task?.stageName ?? "Chưa phân loại",
        log.taskId,
        task?.taskName ?? log.taskId,
        task?.taskStatus ?? "Chưa xác định",
        WORK_GROUP_LABELS[log.workGroup],
        log.billable ? "Có" : "Không",
        log.minutes,
        hours(log.minutes),
        task?.estimateMinutes ? hours(task.estimateMinutes) : null,
        log.note || ""
      ];
    });
  addTableSheet(
    workbook,
    TIMESHEET_EXPORT_SHEETS[4],
    ["Ngày", "User ID", "Nhân sự", "Phòng ban", "Vai trò", "Project ID", "Mã dự án", "Tên dự án", "Khách hàng / tài khoản", "Trạng thái dự án", "Milestone", "Giai đoạn", "Task ID", "Task", "Trạng thái task", "Nhóm công việc", "Tính phí", "Số phút", "Số giờ", "Giờ estimate task", "Ghi chú"],
    rawRows,
    [12, 26, 24, 18, 24, 28, 22, 34, 26, 18, 26, 26, 28, 42, 18, 22, 12, 12, 12, 18, 42],
    { 1: "dd/mm/yyyy" }
  );

  return workbook;
}

export async function exportTimesheetWorkbook(context: TimesheetExportContext): Promise<TimesheetExportResult> {
  const ExcelJS = await import("exceljs");
  const workbook = buildTimesheetWorkbook(ExcelJS, context);
  const filename = `uplark-timesheet-${context.filters.month}-${context.view}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return { filename, logCount: context.logs.length };
}
