import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEMO_PNL_PROJECTS } from "./pnl-data";
import { buildPnlWorkbook } from "./pnl-export";

describe("buildPnlWorkbook", () => {
  it("exports each P&L data block as a separate reader-facing sheet", async () => {
    const workbook = buildPnlWorkbook(ExcelJS, { period: "2026-09", projects: DEMO_PNL_PROJECTS });
    const serialized = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(serialized);

    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual([
      "Tổng quan",
      "Theo dự án",
      "Logwork theo ngày",
      "Theo nhân sự",
      "Chi phí",
      "Data Raw"
    ]);
    expect(reopened.getWorksheet("Theo dự án")?.getRow(1).getCell(1).value).toBe("Báo cáo P&L");
    expect(reopened.getWorksheet("Logwork theo ngày")?.getRow(5).values).toContain("Logwork giờ");
    expect(reopened.getWorksheet("Theo nhân sự")?.getRow(5).values).toContain("Nhân sự");
    expect(reopened.getWorksheet("Chi phí")?.getRow(5).values).toContain("Chi phí");
    expect(reopened.getWorksheet("Data Raw")?.rowCount).toBe(DEMO_PNL_PROJECTS.length + 1);
    expect(reopened.getWorksheet("Data Raw")?.getRow(1).values).toContain("P&L giờ");
  });
});
