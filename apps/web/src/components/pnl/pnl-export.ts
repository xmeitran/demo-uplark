import { addExcelTableSheet, excelDate, styleExcelHeaderCells, type ExcelCell } from "@/lib/excel-table-sheet";
import { EXPENSE_GROUPS, LOCKED_EXPENSE_ROWS, hours, type PnlProject } from "./pnl-data";

type ExcelJsModule = typeof import("exceljs");

export interface PnlExportContext {
  period: string;
  projects: PnlProject[];
}

function formatPeriod(period: string) {
  if (!period || period === "all") return "Tất cả thời gian";
  if (period.includes("_")) return period.split("_").join(" → ");
  const [year, month] = period.split("-");
  return year && month ? `Tháng ${month}/${year}` : period;
}

export const PNL_EXPORT_SHEETS = ["Tổng quan", "Theo dự án", "Theo nhân sự", "Logwork theo ngày", "Chi phí theo nhóm", "Chi phí chi tiết", "Raw Data"] as const;

/**
 * Builds the P&L download. Same rule as every export: one table per sheet,
 * header on row 1. "Tổng quan" follows the dashboard template (period on top,
 * then the KPI table); every other sheet is a single table.
 */
export function buildPnlWorkbook(ExcelJS: ExcelJsModule, { period, projects }: PnlExportContext) {
  const workbook = new ExcelJS.Workbook();
  const currency = projects[0]?.currency || "VND";
  const total = (selector: (project: PnlProject) => number) => projects.reduce((sum, project) => sum + selector(project), 0);
  const round2 = (value: number) => Math.round(value * 100) / 100;
  // Every money figure below is the API's per-project figure, or a plain sum of those across the
  // exported projects. Nothing is re-derived per project (no revenue − cost, no total − labor).
  const totalRevenue = total((project) => project.revenue);
  const totalCost = total((project) => project.totalCost);
  const totalEbit = round2(total((project) => project.grossMargin));
  // One project: the API's own margin. Several: the ratio of the two summed API figures (the API has no figure for an arbitrary selection).
  const ebitMargin = projects.length === 1 ? projects[0].grossMarginPercent ?? null : totalRevenue > 0 ? round2((totalEbit / totalRevenue) * 100) : null;
  const expenseAmount = (project: PnlProject, key: string) => project.expenses.find((expense) => expense.key === key)?.amount ?? 0;
  const lockedCount = projects.filter((project) => project.lockedOtherCost !== undefined).length;
  const LIVE_NOTE = "Số hiện tại, có thể khác số đã chốt";
  const missingRateMinutes = total((project) => project.missingRateMinutes);
  const groupLabel = new Map(EXPENSE_GROUPS.map((group) => [group.key, group.label]));

  // 1 · Tổng quan
  const overview = workbook.addWorksheet(PNL_EXPORT_SHEETS[0]);
  overview.addRows([
    ["Kỳ báo cáo", formatPeriod(period)],
    ["Số project", projects.length],
    [],
    ["CHỈ SỐ TỔNG QUAN P&L", "Giá trị", "Đơn vị"],
    ["Doanh thu", totalRevenue, currency],
    ["Tổng chi phí", totalCost, currency],
    ["EBIT", totalEbit, currency],
    ["Biên EBIT", ebitMargin, "%"],
    ["Giờ kế hoạch", hours(total((project) => project.planMinutes)), "giờ"],
    ["Logwork", hours(total((project) => project.logworkMinutes)), "giờ"],
    ["Giờ đã duyệt", hours(total((project) => project.pnlMinutes)), "giờ"],
    ["Chờ xử lý", hours(total((project) => project.pendingMinutes)), "giờ"],
    ["Giờ đã duyệt thiếu cost rate", hours(missingRateMinutes), "giờ"]
  ]);
  overview.columns = [{ width: 34 }, { width: 22 }, { width: 12 }];
  styleExcelHeaderCells(overview, 4, 3);

  // 2 · Theo dự án
  addExcelTableSheet(
    workbook,
    PNL_EXPORT_SHEETS[1],
    ["Tên dự án", "Mã dự án", "Khách hàng", "Owner", "Trạng thái", "Doanh thu", "Chi phí nhân sự", "Chi phí khác", "Tổng chi phí", "EBIT", "Biên EBIT (%)", "Chi phí kế hoạch", "Giờ kế hoạch", "Logwork giờ", "Giờ đã duyệt", "Chờ xử lý giờ", "Giờ thiếu cost rate", "Đã chốt kỳ"],
    projects.map((project) => [
      project.name, project.code, project.client, project.ownerDisplayName || "Chưa phân công", project.status,
      project.revenue, project.laborCost, project.otherCost, project.totalCost, project.grossMargin, project.grossMarginPercent ?? null, project.plannedCost,
      hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.pendingMinutes), hours(project.missingRateMinutes), project.locked ? "Có" : "Không"
    ]),
    [38, 20, 26, 24, 16, 18, 18, 18, 18, 18, 14, 18, 14, 14, 12, 16, 18, 12]
  );

  // 3 · Theo nhân sự (một dòng cho mỗi người ở mỗi dự án)
  const peopleRows: ExcelCell[][] = projects.flatMap((project) => project.people.map((person) => [
    person.name, person.role, project.name, project.code,
    hours(person.planMinutes), hours(person.logworkMinutes), hours(person.pnlMinutes), hours(person.logworkMinutes - person.pnlMinutes),
    person.hourlyCostRate ?? null, person.laborCost ?? null, hours(person.missingRateMinutes ?? 0),
    // A locked month freezes totals only: the per-person split is whatever the data says today.
    project.lockedOtherCost !== undefined ? LIVE_NOTE : ""
  ]));
  addExcelTableSheet(workbook, PNL_EXPORT_SHEETS[2], ["Nhân sự", "Vai trò", "Tên dự án", "Mã dự án", "Giờ kế hoạch", "Logwork giờ", "Giờ đã duyệt", "Chờ xử lý giờ", "Cost rate (₫/giờ)", "Chi phí nhân sự", "Giờ thiếu cost rate", "Ghi chú"], peopleRows, [28, 22, 38, 20, 14, 14, 14, 16, 18, 18, 18, 36]);

  // 4 · Logwork theo ngày (chỉ ngày có log)
  const dailyMap = new Map<string, { logwork: number; pnl: number; pending: number; excluded: number; entries: number; projects: number }>();
  for (const project of projects) {
    for (const point of project.daily) {
      if (!point.minutes) continue;
      const current = dailyMap.get(point.date) ?? { logwork: 0, pnl: 0, pending: 0, excluded: 0, entries: 0, projects: 0 };
      const pnl = point.pnlMinutes ?? 0;
      const pending = point.pendingMinutes ?? 0;
      current.logwork += point.minutes;
      current.pnl += pnl;
      current.pending += pending;
      current.excluded += Math.max(point.minutes - pnl - pending, 0);
      current.entries += point.entryCount ?? 0;
      current.projects += 1;
      dailyMap.set(point.date, current);
    }
  }
  addExcelTableSheet(
    workbook,
    PNL_EXPORT_SHEETS[3],
    ["Ngày", "Logwork giờ", "Giờ đã duyệt", "Chờ xử lý giờ", "Bị loại giờ", "Số entry", "Số dự án"],
    [...dailyMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, row]) => [excelDate(date), hours(row.logwork), hours(row.pnl), hours(row.pending), hours(row.excluded), row.entries, row.projects]),
    [14, 14, 12, 16, 14, 12, 12],
    { 1: "dd/mm/yyyy" }
  );

  // 5 · Chi phí theo nhóm (6 nhóm BRD; tháng đã chốt chỉ có 2 dòng "đã chốt" vì snapshot không tách nhóm).
  // Rows add up to the overview's "Tổng chi phí".
  const groupRows = [...EXPENSE_GROUPS.map((group) => ({ key: group.key, label: group.label })), ...(lockedCount ? [LOCKED_EXPENSE_ROWS.entered, LOCKED_EXPENSE_ROWS.other] : [])];
  addExcelTableSheet(
    workbook,
    PNL_EXPORT_SHEETS[4],
    ["Nhóm chi phí", "Giá trị", "Đơn vị", "Tỷ trọng (%)", "Số dự án có phát sinh"],
    groupRows.map((group) => {
      const amount = total((project) => expenseAmount(project, group.key));
      return [group.label, amount, currency, totalCost > 0 ? round2((amount / totalCost) * 100) : 0, projects.filter((project) => expenseAmount(project, group.key) > 0).length];
    }),
    [44, 20, 12, 16, 24]
  );

  // 6 · Chi phí chi tiết: mọi khoản tạo nên tổng chi phí của từng dự án (cộng lại đúng bằng tổng chi phí).
  // A locked project lists its three frozen amounts; the live lines are not mixed in, because they are no longer what the total is made of.
  const costRows: ExcelCell[][] = projects.flatMap((project) => project.lockedOtherCost !== undefined ? [
    [project.name, project.code, "Salaries Related", "Chi phí nhân sự đã chốt", "Số đã chốt", null, project.laborCost] as ExcelCell[],
    [project.name, project.code, "Đã chốt, không tách nhóm", LOCKED_EXPENSE_ROWS.entered.label, "Số đã chốt", null, project.enteredCost] as ExcelCell[],
    [project.name, project.code, "Đã chốt, không tách nhóm", LOCKED_EXPENSE_ROWS.other.label, "Số đã chốt", null, project.lockedOtherCost] as ExcelCell[]
  ] : [
    ...project.people.filter((person) => (person.laborCost ?? 0) > 0).map((person): ExcelCell[] => [project.name, project.code, "Salaries Related", `Chi phí nhân sự — ${person.name}`, "Giờ đã duyệt × cost rate", null, person.laborCost ?? 0]),
    ...project.costItems.map((item): ExcelCell[] => [project.name, project.code, groupLabel.get(item.category) ?? item.category, item.label, "Nhập tay", excelDate(item.occurredOn), item.amount]),
    ...project.calculatedItems.map((item): ExcelCell[] => [project.name, project.code, groupLabel.get(item.category) ?? item.category, item.label, "Công thức", null, item.amount]),
    ...(project.sharedCost > 0 ? [[project.name, project.code, "Functional Operation", "Quỹ dùng chung phân bổ", "Phân bổ quỹ", null, project.sharedCost] as ExcelCell[]] : [])
  ]);
  addExcelTableSheet(workbook, PNL_EXPORT_SHEETS[5], ["Tên dự án", "Mã dự án", "Nhóm chi phí", "Khoản", "Nguồn", "Ngày phát sinh", "Số tiền"], costRows, [38, 20, 24, 56, 24, 16, 18], { 6: "dd/mm/yyyy" });

  // 7 · Raw Data: một dòng cho mỗi dự án, đủ số để tự kiểm tra
  addExcelTableSheet(
    workbook,
    PNL_EXPORT_SHEETS[6],
    ["Project ID", "Mã dự án", "Tên dự án", "Khách hàng", "Kỳ báo cáo", "Trạng thái đối soát", "Giờ kế hoạch", "Logwork giờ", "Giờ đã duyệt", "Bị loại giờ", "Chờ xử lý giờ", "Doanh thu", "Nguồn doanh thu", "Đã thu", "Tổng chi phí", "EBIT", "Đã chốt kỳ", LOCKED_EXPENSE_ROWS.entered.label, LOCKED_EXPENSE_ROWS.other.label, ...EXPENSE_GROUPS.map((group) => group.label)],
    projects.map((project) => [
      project.id, project.code, project.name, project.client, formatPeriod(period), project.status,
      hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.excludedMinutes), hours(project.pendingMinutes),
      project.revenue, project.revenueBasis === "custom" ? "Nhập tay theo tháng" : project.revenueBasis === "none" ? "Chưa nhập cho kỳ" : "Kế hoạch", project.paidRevenue, project.totalCost, project.grossMargin,
      project.locked ? "Có" : "Không", expenseAmount(project, LOCKED_EXPENSE_ROWS.entered.key), expenseAmount(project, LOCKED_EXPENSE_ROWS.other.key),
      ...EXPENSE_GROUPS.map((group) => expenseAmount(project, group.key))
    ]),
    [28, 18, 38, 28, 18, 20, 14, 14, 14, 14, 16, 20, 20, 18, 20, 20, 12, 26, 44, 18, 18, 18, 18, 20, 22]
  );

  return workbook;
}

export async function exportPnlWorkbook(context: PnlExportContext) {
  const ExcelJS = await import("exceljs");
  const workbook = buildPnlWorkbook(ExcelJS, context);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `uplark-pnl-${context.period}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
