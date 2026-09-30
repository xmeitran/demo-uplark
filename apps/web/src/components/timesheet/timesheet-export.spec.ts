import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildTimesheetWorkbook } from "./timesheet-export";
import { getTimesheetDataset } from "./timesheet-mock-data";
import { filterLogs, type TimesheetFilters } from "./timesheet-selectors";

describe("buildTimesheetWorkbook", () => {
  it("puts the visual overview before the raw data and preserves every filtered log", async () => {
    const dataset = getTimesheetDataset();
    const filters: TimesheetFilters = {
      month: "2026-07",
      departmentId: "all",
      personId: "all",
      projectId: "all",
      workGroup: "all"
    };
    const logs = filterLogs(dataset, filters);

    const workbook = buildTimesheetWorkbook(ExcelJS, {
      dataset,
      filters,
      logs,
      scopeLabel: "Toàn workspace",
      view: "Theo tháng"
    });
    const serialized = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(serialized);

    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Tổng quan & Biểu đồ", "Data Raw"]);
    expect(reopened.getWorksheet("Data Raw")?.rowCount).toBe(logs.length + 1);
    expect(reopened.getWorksheet("Data Raw")?.autoFilter).toBe(`A1:U${logs.length + 1}`);
  });
});
