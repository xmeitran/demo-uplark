import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEMO_PNL_PROJECTS } from "./pnl-data";
import { buildPnlWorkbook } from "./pnl-export";

describe("buildPnlWorkbook", () => {
  it("exports a visual overview before a complete raw project table", async () => {
    const workbook = buildPnlWorkbook(ExcelJS, { period: "2026-09", projects: DEMO_PNL_PROJECTS });
    const serialized = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(serialized);

    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Tổng quan & Biểu đồ", "Data Raw"]);
    expect(reopened.getWorksheet("Data Raw")?.rowCount).toBe(DEMO_PNL_PROJECTS.length + 1);
    expect(reopened.getWorksheet("Data Raw")?.getRow(1).values).toContain("P&L giờ");
  });
});
