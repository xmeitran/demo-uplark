import type { Workbook, Worksheet } from "exceljs";

export type ExcelCell = string | number | Date | null;

/** A YYYY-MM-DD key as a real Excel date (ExcelJS writes Date values in UTC). */
export function excelDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function styleExcelHeaderCells(sheet: Worksheet, rowNumber: number, lastColumn: number) {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

/**
 * Export rule for every Excel download: one table per sheet. The header is
 * row 1 (frozen, filterable) and nothing else shares the sheet, so the data
 * can be filtered, pivoted or pasted without cleaning.
 */
export function addExcelTableSheet(workbook: Workbook, name: string, header: string[], rows: ExcelCell[][], widths: number[], formats: Record<number, string> = {}) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRows([header, ...rows]);
  sheet.columns = widths.map((width) => ({ width }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  styleExcelHeaderCells(sheet, 1, header.length);
  for (const [column, numFmt] of Object.entries(formats)) sheet.getColumn(Number(column)).numFmt = numFmt;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: header.length } };
  return sheet;
}
