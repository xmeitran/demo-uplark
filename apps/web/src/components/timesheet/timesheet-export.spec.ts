import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildTimesheetWorkbook } from "./timesheet-export";
import { getTimesheetDataset } from "./timesheet-dataset.fixture";
import { filterLogs, type TimesheetFilters } from "./timesheet-selectors";

describe("buildTimesheetWorkbook", () => {
  it("follows the dashboard template: five sheets, one table per sheet, all reconciling with Raw Data", async () => {
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
    const sheet = (name: string) => reopened.getWorksheet(name)!;
    const header = (name: string) => (sheet(name).getRow(1).values as unknown[]).slice(1);
    const column = (name: string, index: number) => (sheet(name).getColumn(index).values as unknown[]).slice(2) as number[];
    const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

    expect(reopened.worksheets.map((worksheet) => worksheet.name)).toEqual(["Tổng quan", "Theo dự án", "Theo nhân sự", "Tiến độ theo Ngày", "Raw Data"]);

    // Headers exactly as in the template.
    expect(header("Theo dự án")).toEqual(["Tên dự án", "Mã dự án", "Khách hàng / tài khoản", "Trạng thái dự án", "Tổng_số_giờ", "Giờ_Estimate", "Số_nhân_sự", "Số_task", "Tỷ_lệ_so_với_Estimate_(%)"]);
    expect(header("Theo nhân sự")).toEqual(["Nhân sự", "Vai trò", "Phòng ban", "Tổng_số_giờ", "Số_dự_án", "Số_task", "Ngày_làm_việc_đã_log", "Trung_bình_giờ/ngày"]);
    expect(header("Tiến độ theo Ngày")).toEqual(["Ngày", "Tổng_số_giờ", "Số_nhân_sự", "Số_dự_án", "Số_task"]);
    expect(header("Raw Data")).toEqual(["Ngày", "User ID", "Nhân sự", "Phòng ban", "Vai trò", "Project ID", "Mã dự án", "Tên dự án", "Khách hàng / tài khoản", "Trạng thái dự án", "Milestone", "Giai đoạn", "Task ID", "Task", "Trạng thái task", "Nhóm công việc", "Tính phí", "Số phút", "Số giờ", "Giờ estimate task", "Ghi chú"]);

    // Raw Data keeps every filtered log; dates are real dates.
    expect(sheet("Raw Data").rowCount).toBe(logs.length + 1);
    expect(sheet("Raw Data").autoFilter).toBe(`A1:U${logs.length + 1}`);
    expect(sheet("Raw Data").getCell("A2").value).toBeInstanceOf(Date);
    expect(sheet("Tiến độ theo Ngày").getCell("A2").value).toBeInstanceOf(Date);

    // Overview block sits where the template has it.
    const overview = sheet("Tổng quan");
    expect([overview.getCell("A1").value, overview.getCell("A2").value, overview.getCell("A4").value, overview.getCell("B4").value]).toEqual(["Từ ngày", "Đến ngày", "CHỈ SỐ TỔNG QUAN DỰ ÁN", "Giá trị"]);
    expect((overview.getCell("B1").value as Date).toISOString().slice(0, 10)).toBe("2026-07-01");
    expect((overview.getCell("B2").value as Date).toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(["A5", "A6", "A7", "A8", "A9"].map((address) => overview.getCell(address).value)).toEqual(["Tổng số giờ thực tế", "Tổng số giờ Estimate", "Tổng số dự án", "Tổng số nhân sự", "Tổng số task"]);

    // Every summary sheet adds up to the same total hours as the raw rows.
    const totalHours = sum(logs.map((log) => Math.round((log.minutes / 60) * 100) / 100));
    expect(overview.getCell("B5").value).toBeCloseTo(logs.reduce((total, log) => total + log.minutes, 0) / 60, 1);
    expect(sum(column("Raw Data", 19))).toBe(totalHours);
    for (const [name, index] of [["Theo dự án", 5], ["Theo nhân sự", 4], ["Tiến độ theo Ngày", 2]] as const) {
      expect(sum(column(name, index))).toBeCloseTo(overview.getCell("B5").value as number, 0);
    }
    expect(overview.getCell("B7").value).toBe(sheet("Theo dự án").rowCount - 1);
    expect(overview.getCell("B8").value).toBe(sheet("Theo nhân sự").rowCount - 1);
    expect(sheet("Tiến độ theo Ngày").rowCount - 1).toBe(new Set(logs.map((log) => log.date)).size);
    // Projects and people are ordered by hours, highest first.
    const projectHours = column("Theo dự án", 5);
    expect(projectHours).toEqual([...projectHours].sort((left, right) => right - left));
  });
});
