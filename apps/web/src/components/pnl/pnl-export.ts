import { hours, type PnlProject } from "./pnl-data";

type ExcelJsModule = typeof import("exceljs");
type CellValue = string | number;

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

function styleTitle(sheet: import("exceljs").Worksheet) {
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  sheet.getRow(1).height = 24;
}

function styleHeader(sheet: import("exceljs").Worksheet, rowNumber: number, lastColumn: number) {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  sheet.getRow(rowNumber).height = 28;
}

function setSheetLayout(sheet: import("exceljs").Worksheet, widths: number[]) {
  sheet.columns = widths.map((width) => ({ width }));
  sheet.views = [{ state: "frozen", ySplit: 5 }];
}

function addMeta(sheet: import("exceljs").Worksheet, period: string, projectCount: number) {
  sheet.addRow(["Báo cáo P&L"]);
  sheet.addRow([`Kỳ báo cáo: ${formatPeriod(period)}`]);
  sheet.addRow(["Phạm vi", `${projectCount} project đang hiển thị`]);
  sheet.addRow([]);
  styleTitle(sheet);
}

function addDataBar(sheet: import("exceljs").Worksheet, ref: string) {
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
  sheet.addConditionalFormatting({ ref, rules: [dataBar] });
}

function moneyByProject(project: PnlProject) {
  return project.costAvailable ? Math.max(project.revenue - project.grossMargin, 0) : undefined;
}

/** Builds a multi-sheet P&L download. Each reader-facing data block gets its own worksheet. */
export function buildPnlWorkbook(ExcelJS: ExcelJsModule, { period, projects }: PnlExportContext) {
  const workbook = new ExcelJS.Workbook();
  const overviewSheet = workbook.addWorksheet("Tổng quan");
  const projectSheet = workbook.addWorksheet("Theo dự án");
  const dailySheet = workbook.addWorksheet("Logwork theo ngày");
  const peopleSheet = workbook.addWorksheet("Theo nhân sự");
  const expenseSheet = workbook.addWorksheet("Chi phí");
  const rawSheet = workbook.addWorksheet("Data Raw");

  const total = (selector: (project: PnlProject) => number) => projects.reduce((sum, project) => sum + selector(project), 0);
  const totalRevenue = total((project) => project.revenue);
  const totalExpenses = projects.reduce((sum, project) => sum + (moneyByProject(project) ?? 0), 0);
  const totalPnlMinutes = total((project) => project.pnlMinutes);
  const totalPendingMinutes = total((project) => project.pendingMinutes);
  const reconciledCount = projects.filter((project) => project.status === "Đã đối soát").length;

  addMeta(overviewSheet, period, projects.length);
  overviewSheet.addRows([
    ["Chỉ số tổng quan", "Giá trị", "Đơn vị", "Diễn giải"],
    ["Doanh thu", totalRevenue, "VND", "Doanh thu ghi nhận trong kỳ"],
    ["Tổng chi phí", totalExpenses, "VND", "Tổng chi phí có nguồn"],
    ["EBIT", totalRevenue - totalExpenses, "VND", "Doanh thu trừ tổng chi phí"],
    ["P&L hợp lệ", hours(totalPnlMinutes), "giờ", "Logwork đủ điều kiện P&L"],
    ["Chờ xử lý", hours(totalPendingMinutes), "giờ", "Logwork chưa đủ điều kiện P&L"],
    ["Dự án đã đối soát", reconciledCount, "dự án", "Đối soát giờ hoàn tất"],
    [],
    ["Phạm vi xuất", projects.length, "project", "Đã áp dụng bộ lọc trên màn hình"]
  ]);
  styleHeader(overviewSheet, 5, 4);
  setSheetLayout(overviewSheet, [34, 20, 14, 42]);

  addMeta(projectSheet, period, projects.length);
  const projectHeader = ["Project", "Mã dự án", "Khách hàng", "Owner", "Trạng thái", "Doanh thu", "Chi phí", "EBIT / Margin", "Plan giờ", "Logwork giờ", "P&L giờ", "Chờ xử lý giờ"];
  projectSheet.addRows([projectHeader, ...projects.map((project) => {
    const cost = moneyByProject(project);
    return [project.name, project.code, project.client, project.ownerDisplayName || "Chưa phân công", project.status, project.revenue, cost ?? "Chưa có dữ liệu", cost === undefined ? "Chưa đủ dữ liệu" : project.revenue - cost, hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.pendingMinutes)];
  })]);
  styleHeader(projectSheet, 5, projectHeader.length);
  setSheetLayout(projectSheet, [34, 18, 26, 24, 18, 18, 18, 18, 14, 16, 14, 18]);
  projectSheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, projects.length + 5), column: projectHeader.length } };

  const dailyMap = new Map<string, { label: string; logwork: number; pnl: number; pending: number; excluded: number; entries: number; projects: number }>();
  for (const project of projects) {
    for (const point of project.daily) {
      const current = dailyMap.get(point.date) ?? { label: point.label, logwork: 0, pnl: 0, pending: 0, excluded: 0, entries: 0, projects: 0 };
      const pnl = point.pnlMinutes ?? 0;
      const pending = point.pendingMinutes ?? 0;
      current.logwork += point.minutes;
      current.pnl += pnl;
      current.pending += pending;
      current.excluded += Math.max(point.minutes - pnl - pending, 0);
      current.entries += point.entryCount ?? 0;
      current.projects += point.minutes > 0 ? 1 : 0;
      dailyMap.set(point.date, current);
    }
  }
  const dailyHeader = ["Ngày", "Nhãn", "Logwork giờ", "P&L giờ", "Chờ xử lý giờ", "Bị loại giờ", "Entry", "Project có log"];
  addMeta(dailySheet, period, projects.length);
  dailySheet.addRows([dailyHeader, ...[...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => [date, row.label, hours(row.logwork), hours(row.pnl), hours(row.pending), hours(row.excluded), row.entries, row.projects])]);
  styleHeader(dailySheet, 5, dailyHeader.length);
  setSheetLayout(dailySheet, [16, 12, 16, 14, 18, 14, 12, 18]);
  if (dailyMap.size) addDataBar(dailySheet, `C6:C${5 + dailyMap.size}`);
  dailySheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, dailyMap.size + 5), column: dailyHeader.length } };

  const peopleMap = new Map<string, { name: string; role: string; projects: number; plan: number; logwork: number; pnl: number }>();
  for (const project of projects) {
    for (const person of project.people) {
      const current = peopleMap.get(person.id) ?? { name: person.name, role: person.role, projects: 0, plan: 0, logwork: 0, pnl: 0 };
      current.projects += 1;
      current.plan += person.planMinutes;
      current.logwork += person.logworkMinutes;
      current.pnl += person.pnlMinutes;
      peopleMap.set(person.id, current);
    }
  }
  const peopleHeader = ["Nhân sự", "Vai trò", "Số project", "Plan giờ", "Logwork giờ", "P&L giờ", "Chờ xử lý giờ", "Tỷ lệ P&L"];
  addMeta(peopleSheet, period, projects.length);
  peopleSheet.addRows([peopleHeader, ...[...peopleMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((person) => [person.name, person.role, person.projects, hours(person.plan), hours(person.logwork), hours(person.pnl), hours(person.logwork - person.pnl), person.logwork ? person.pnl / person.logwork : 0])]);
  styleHeader(peopleSheet, 5, peopleHeader.length);
  setSheetLayout(peopleSheet, [28, 24, 14, 14, 16, 14, 18, 14]);
  peopleSheet.getColumn(8).numFmt = "0.0%";
  peopleSheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, peopleMap.size + 5), column: peopleHeader.length } };

  const expenseMap = new Map<string, number>();
  for (const project of projects) for (const expense of project.expenses) expenseMap.set(expense.label, (expenseMap.get(expense.label) ?? 0) + expense.amount);
  const expenseHeader = ["Chi phí", "Giá trị", "Đơn vị", "Tỷ trọng", "Số project có phát sinh"];
  const expenseRows = [...expenseMap.entries()].map(([label, amount]) => [label, amount, projects[0]?.currency || "VND", totalExpenses ? amount / totalExpenses : 0, projects.filter((project) => project.expenses.some((expense) => expense.label === label && expense.amount > 0)).length]);
  addMeta(expenseSheet, period, projects.length);
  expenseSheet.addRows([expenseHeader, ...expenseRows, [], ["Tổng chi phí", totalExpenses, projects[0]?.currency || "VND", totalExpenses ? 1 : 0, projects.filter((project) => project.costAvailable).length]]);
  styleHeader(expenseSheet, 5, expenseHeader.length);
  setSheetLayout(expenseSheet, [26, 20, 14, 14, 24]);
  expenseSheet.getColumn(4).numFmt = "0.0%";
  expenseSheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, expenseRows.length + 5), column: expenseHeader.length } };

  const rawHeader = ["Project ID", "Mã dự án", "Dự án", "Khách hàng", "Kỳ báo cáo", "Trạng thái đối soát", "Plan giờ", "Logwork giờ", "P&L giờ", "Bị loại giờ", "Chờ xử lý giờ", "Doanh thu", "Tổng chi phí", "EBIT", "BD", "PM", "Delivery / DX", "AI / Công cụ", "Overhead", "Khác"];
  const rawRows: CellValue[][] = projects.map((project) => {
    const expenseByKey = new Map(project.expenses.map((expense) => [expense.key, expense.amount]));
    const totalCost = project.expenses.reduce((sum, expense) => sum + expense.amount, 0);
    return [project.id, project.code, project.name, project.client, period, project.status, hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.excludedMinutes), hours(project.pendingMinutes), project.revenue, totalCost, project.revenue - totalCost, expenseByKey.get("bd") ?? 0, expenseByKey.get("pm") ?? 0, expenseByKey.get("delivery-dx") ?? 0, expenseByKey.get("ai-tools") ?? 0, expenseByKey.get("overhead") ?? 0, expenseByKey.get("other") ?? 0];
  });
  rawSheet.addRows([rawHeader, ...rawRows]);
  setSheetLayout(rawSheet, [28, 18, 38, 28, 16, 20, 14, 16, 14, 14, 16, 20, 20, 20, 14, 14, 18, 16, 16, 14]);
  rawSheet.views = [{ state: "frozen", ySplit: 1 }];
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
