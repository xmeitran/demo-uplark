import { hours, type PnlProject } from "./pnl-data";

type ExcelJsModule = typeof import("exceljs");

export interface PnlExportContext {
  period: string;
  projects: PnlProject[];
}

function formatPeriod(period: string) {
  const [year, month] = period.split("-");
  return `Tháng ${month}/${year}`;
}

function styleHeader(sheet: import("exceljs").Worksheet, rowNumber: number, lastColumn: number) {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

function setSheetLayout(sheet: import("exceljs").Worksheet, widths: number[]) {
  sheet.columns = widths.map((width) => ({ width }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/** Builds the two-tab P&L download: a reader-facing overview and auditable rows. */
export function buildPnlWorkbook(ExcelJS: ExcelJsModule, { period, projects }: PnlExportContext) {
  const workbook = new ExcelJS.Workbook();
  const overviewSheet = workbook.addWorksheet("Tổng quan & Biểu đồ");
  const rawSheet = workbook.addWorksheet("Data Raw");
  const total = (selector: (project: PnlProject) => number) => projects.reduce((sum, project) => sum + selector(project), 0);
  const totalRevenue = total((project) => project.revenue);
  const totalExpenses = total((project) => project.expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const totalPnlMinutes = total((project) => project.pnlMinutes);
  const totalPendingMinutes = total((project) => project.pendingMinutes);
  const reconciledCount = projects.filter((project) => project.status === "Đã đối soát").length;

  const overviewRows: Array<Array<string | number>> = [
    ["Báo cáo P&L"],
    [`Kỳ báo cáo: ${formatPeriod(period)}`],
    ["Phạm vi", `${projects.length} dự án đang hiển thị`],
    [],
    ["Chỉ số tổng quan", "Giá trị", "Đơn vị", "Diễn giải"],
    ["Doanh thu", totalRevenue, "VND", "Doanh thu ghi nhận trong kỳ"],
    ["Tổng chi phí", totalExpenses, "VND", "Tổng chi phí theo nhóm"],
    ["EBIT", totalRevenue - totalExpenses, "VND", "Doanh thu trừ tổng chi phí"],
    ["P&L hợp lệ", hours(totalPnlMinutes), "giờ", "Logwork đã đủ điều kiện P&L"],
    ["Chờ xử lý", hours(totalPendingMinutes), "giờ", "Logwork chưa đủ điều kiện P&L"],
    ["Dự án đã đối soát", reconciledCount, "dự án", "Logwork đã được đối soát"],
    [],
    ["Dự án", "Plan giờ", "Logwork giờ", "P&L giờ", "Chờ xử lý", "Trạng thái"],
    ...projects.map((project) => [project.name, hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.pendingMinutes), project.status])
  ];
  overviewSheet.addRows(overviewRows);
  setSheetLayout(overviewSheet, [38, 20, 20, 20, 18, 20]);
  overviewSheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  styleHeader(overviewSheet, 5, 4);
  styleHeader(overviewSheet, 13, 6);

  if (projects.length > 0) {
    // ExcelJS needs these fields at runtime even though its DataBar type omits color.
    const dataBar = {
      type: "dataBar",
      priority: 1,
      gradient: true,
      minLength: 4,
      maxLength: 100,
      showValue: true,
      cfvo: [{ type: "min" }, { type: "max" }],
      color: { argb: "FF2563EB" }
    } as unknown as import("exceljs").ConditionalFormattingRule;
    overviewSheet.addConditionalFormatting({ ref: `D14:D${13 + projects.length}`, rules: [dataBar] });
  }

  const rawHeader = [
    "Project ID", "Mã dự án", "Dự án", "Khách hàng", "Kỳ báo cáo", "Trạng thái đối soát",
    "Plan giờ", "Logwork giờ", "P&L giờ", "Bị loại giờ", "Chờ xử lý giờ", "Doanh thu", "Tổng chi phí", "EBIT",
    "BD", "PM", "Delivery / DX", "AI / Công cụ", "Overhead", "Khác"
  ];
  const rawRows = projects.map((project) => {
    const expenseByKey = new Map(project.expenses.map((expense) => [expense.key, expense.amount]));
    const totalCost = project.expenses.reduce((sum, expense) => sum + expense.amount, 0);
    return [
      project.id, project.code, project.name, project.client, period, project.status,
      hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.excludedMinutes), hours(project.pendingMinutes),
      project.revenue, totalCost, project.revenue - totalCost,
      expenseByKey.get("bd") ?? 0, expenseByKey.get("pm") ?? 0, expenseByKey.get("delivery-dx") ?? 0,
      expenseByKey.get("ai-tools") ?? 0, expenseByKey.get("overhead") ?? 0, expenseByKey.get("other") ?? 0
    ];
  });
  rawSheet.addRows([rawHeader, ...rawRows]);
  setSheetLayout(rawSheet, [28, 18, 38, 28, 16, 20, 14, 16, 14, 14, 16, 20, 20, 20, 14, 14, 18, 16, 16, 14]);
  styleHeader(rawSheet, 1, rawHeader.length);
  rawSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rawRows.length + 1), column: rawHeader.length } };

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
