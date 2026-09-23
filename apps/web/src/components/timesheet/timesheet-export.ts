import {
  buildDailySeries,
  buildMonthlyKpis,
  buildPersonMonthSummaries,
  buildProjectSummaries,
  type TimesheetFilters
} from "./timesheet-selectors";
import { formatMonth } from "./timesheet-format";
import {
  NODE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  WORK_GROUP_LABELS,
  type TimesheetDataset,
  type TimeLog
} from "./timesheet-types";

type XlsxModule = typeof import("xlsx");

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

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function dateLabel(value: string | null | undefined) {
  return value ? value : "Chưa đặt";
}

function setSheetLayout(sheet: Record<string, unknown>, widths: number[]) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
}

function styleHeader(XLSX: XlsxModule, sheet: Record<string, any>, range: string) {
  const decoded = XLSX.utils.decode_range(range);
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let column = decoded.s.c; column <= decoded.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address];
      if (!cell) continue;
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: "1D4ED8" } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true }
      };
    }
  }
}

function styleTitle(sheet: Record<string, any>, address: string) {
  const cell = sheet[address];
  if (!cell) return;
  cell.s = {
    font: { bold: true, sz: 16, color: { rgb: "0F172A" } },
    alignment: { horizontal: "left" }
  };
}

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

/**
 * Builds the two-sheet workbook used by the Timesheet export button.
 * The raw sheet is intentionally one row per live time entry. The dashboard
 * is a snapshot of the exact filters currently visible in the workbench.
 */
export function buildTimesheetWorkbook(XLSX: XlsxModule, context: TimesheetExportContext) {
  const { dataset, filters, logs, scopeLabel, view } = context;
  const peopleById = new Map(dataset.people.map((person) => [person.id, person]));
  const projectsById = new Map(dataset.projects.map((project) => [project.id, project]));
  const taskIndex = makeTaskIndex(dataset);
  const summaries = buildPersonMonthSummaries(dataset, filters, logs);
  const kpis = buildMonthlyKpis(dataset, filters, logs, summaries);
  const daily = buildDailySeries(dataset, filters, logs, summaries);
  const projectRows = buildProjectSummaries(dataset, logs, dataset.generatedAt);

  const rawHeader = [
    "Ngày",
    "User ID",
    "Nhân sự",
    "Phòng ban",
    "Vai trò",
    "Project ID",
    "Mã dự án",
    "Tên dự án",
    "Khách hàng / tài khoản",
    "Trạng thái dự án",
    "Milestone",
    "Giai đoạn",
    "Task ID",
    "Task",
    "Trạng thái task",
    "Nhóm công việc",
    "Tính phí",
    "Số phút",
    "Số giờ",
    "Giờ estimate task",
    "Ghi chú"
  ];
  const rawRows = logs
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.personId.localeCompare(b.personId) || a.id.localeCompare(b.id))
    .map((log) => {
      const person = peopleById.get(log.personId);
      const project = projectsById.get(log.projectId);
      const task = taskIndex.get(`${log.projectId}:${log.taskId}`);
      return [
        log.date,
        log.personId,
        person?.name ?? log.personId,
        person?.departmentId ?? "Chưa phân loại",
        person?.role ?? "—",
        log.projectId,
        project?.code ?? log.projectId,
        project?.name ?? "Chưa xác định",
        project?.accountName ?? "—",
        project ? PROJECT_STATUS_LABELS[project.status] : "—",
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

  const workbook = XLSX.utils.book_new();
  const rawSheet = XLSX.utils.aoa_to_sheet([rawHeader, ...rawRows]);
  setSheetLayout(rawSheet, [12, 26, 24, 18, 24, 28, 22, 34, 26, 18, 26, 26, 28, 42, 18, 22, 12, 12, 12, 18, 42]);
  styleHeader(XLSX, rawSheet, `A1:U1`);
  rawSheet["!autofilter"] = { ref: `A1:U${Math.max(1, rawRows.length + 1)}` };

  const filterText = [
    `Kỳ báo cáo: ${formatMonth(filters.month)}`,
    `Phạm vi: ${scopeLabel}`,
    `Chế độ xem: ${view}`,
    `Phòng ban: ${filters.departmentId === "all" ? "Tất cả" : filters.departmentId}`,
    `Nhân sự: ${filters.personId === "all" ? "Tất cả" : filters.personId}`,
    `Dự án: ${filters.projectId === "all" ? "Tất cả" : filters.projectId}`,
    `Nhóm công việc: ${filters.workGroup === "all" ? "Tất cả" : WORK_GROUP_LABELS[filters.workGroup]}`
  ];
  const dashboardRows: Array<Array<string | number | boolean | null>> = [
    ["Timesheet dashboard"],
    ["Snapshot dữ liệu live theo đúng bộ lọc trên màn hình"],
    ["Cập nhật lúc", new Date().toISOString(), "Múi giờ trình duyệt", "Asia/Ho_Chi_Minh"],
    ...filterText.map((item) => [item]),
    [],
    ["Chỉ số tổng quan", "Giá trị", "Đơn vị", "Diễn giải"],
    ["Giờ thực tế", hours(kpis.actualMinutes), "giờ", "Tổng thời lượng từ Data Raw"],
    ["Giờ tiêu chuẩn", hours(kpis.standardMinutes), "giờ", "8 giờ/ngày làm việc, trừ ngày off"],
    ["Mức hoàn thành", percent(kpis.completionPercent), "%", "Giờ thực tế / giờ tiêu chuẩn"],
    ["Tỷ lệ ngày có ghi nhận", percent(kpis.dayCoveragePercent), "%", "Ngày có log / ngày làm việc có thể ghi nhận"],
    ["Tỷ lệ tính phí", percent(kpis.billablePercent), "%", "Giờ billable / giờ thực tế"],
    ["Số dòng raw", logs.length, "dòng", "Một dòng tương ứng một time entry"],
    ["Số nhân sự", kpis.peopleCount, "người", "Theo phạm vi lọc"],
    ["Số dự án có log", kpis.projectCount, "dự án", "Theo phạm vi lọc"],
    ["Ngày làm việc trong kỳ", kpis.workingDays, "ngày", "Đã loại trừ ngày off"],
    [],
    ["Tổng hợp theo ngày", "Giờ thực tế", "Giờ tiêu chuẩn", "Chênh lệch giờ", "Ngày làm việc", "Số dòng log", "Số nhân sự"],
    ...daily.map((day) => [
      day.date,
      hours(day.actualMinutes),
      hours(day.standardMinutes),
      hours(day.actualMinutes - day.standardMinutes),
      day.isWorkingDay ? "Có" : "Không",
      day.entryCount,
      day.peopleLogged
    ]),
    [],
    ["Tổng hợp theo nhân sự", "User ID", "Phòng ban", "Giờ thực tế", "Giờ tiêu chuẩn", "Hoàn thành %", "Thiếu giờ", "Ngày có log", "Ngày làm việc", "Ngày thiếu log", "Dự án", "Giờ tính phí"],
    ...summaries.map((item) => [
      item.person.name,
      item.person.id,
      item.person.departmentId,
      hours(item.actualMinutes),
      hours(item.standardMinutes),
      percent(item.completionPercent),
      hours(item.missingMinutes),
      item.daysLogged,
      item.workingDays,
      item.missingDays.length,
      item.projectCount,
      hours(item.billableMinutes)
    ]),
    [],
    ["Tổng hợp theo dự án", "Project ID", "Mã dự án", "Tên dự án", "Khách hàng / tài khoản", "Trạng thái", "Estimate giờ", "Actual giờ", "Chênh lệch giờ", "Tiêu thụ %", "Độ phủ estimate %", "Task", "Task hoàn thành", "Task bị chặn", "Task quá hạn", "Nhân sự đang log", "Deadline", "Cảnh báo"],
    ...projectRows.map((row) => [
      row.project.id,
      row.project.code,
      row.project.name,
      row.project.accountName,
      PROJECT_STATUS_LABELS[row.project.status],
      hours(row.estimateMinutes),
      hours(row.actualMinutes),
      hours(row.varianceMinutes),
      percent(row.consumptionPercent),
      percent(row.estimateCoveragePercent),
      row.taskCount,
      row.completedTaskCount,
      row.blockedTaskCount,
      row.overdueTaskCount,
      row.loggingMemberCount,
      dateLabel(row.deadline),
      row.risk === "over" ? "Vượt estimate" : row.risk === "watch" ? "Theo dõi" : "Bình thường"
    ])
  ];
  const dashboardSheet = XLSX.utils.aoa_to_sheet(dashboardRows);
  setSheetLayout(dashboardSheet, [34, 28, 22, 22, 18, 16, 16, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 20]);
  styleTitle(dashboardSheet, "A1");
  const headerRows = [
    12,
    23,
    25 + daily.length,
    27 + daily.length + summaries.length
  ];
  for (const row of headerRows) styleHeader(XLSX, dashboardSheet, `A${row}:R${row}`);
  XLSX.utils.book_append_sheet(workbook, dashboardSheet, "Dashboard");
  // Keep the reader-facing output first and the source-level table second.
  XLSX.utils.book_append_sheet(workbook, rawSheet, "Data Raw");

  return workbook;
}

export async function exportTimesheetWorkbook(context: TimesheetExportContext): Promise<TimesheetExportResult> {
  const XLSX = await import("xlsx");
  const workbook = buildTimesheetWorkbook(XLSX, context);
  const filename = `uplark-timesheet-${context.filters.month}-${context.view}.xlsx`;
  XLSX.writeFile(workbook, filename, { bookType: "xlsx", cellStyles: true });
  return { filename, logCount: context.logs.length };
}
