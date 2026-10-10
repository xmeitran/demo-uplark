import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { PnlProject } from "./pnl-data";
import { buildPnlWorkbook } from "./pnl-export";

// Small fixture standing in for adapted API rows. Figures are deliberately NOT self-consistent
// arithmetic (EBIT ≠ revenue − cost, other ≠ total − labor): the export must copy the API's
// figures, so any recomputation in the export shows up as a wrong cell.
function project(overrides: Partial<PnlProject>): PnlProject {
  return {
    id: "P-1", code: "P-1", name: "CRM", client: "Khách hàng A", currency: "VND",
    plannedRevenue: 1000, paidRevenue: 400, plannedCost: 500, costAvailable: true,
    totalCost: 600, laborCost: 300, directCost: 100, writeOff: 0, otherCost: 301, enteredCost: 100,
    missingRateMinutes: 0, costItems: [{ id: "c1", projectId: "P-1", costType: "OTHER", category: "basic-activities", label: "Điện", amount: 100, currency: "VND", occurredOn: "2026-09-03" }],
    sharedCost: 150, calculatedItems: [{ code: "HH", label: "Hoa hồng", category: "sell-marketing", amount: 50 }], locked: false,
    grossMargin: 407, grossMarginPercent: 40.7, dataSource: "period", status: "Đã đối soát",
    revenue: 1000, revenueBasis: "custom", revenueScope: "Kỳ báo cáo", pnlResultStatus: "Tạm tính",
    planMinutes: 600, logworkMinutes: 480, pnlMinutes: 420, excludedMinutes: 0, pendingMinutes: 60,
    expenses: [
      { key: "salaries-related", label: "Salaries Related", amount: 300, color: "#000" },
      { key: "welfare-related", label: "Welfare Related", amount: 0, color: "#000" },
      { key: "basic-activities", label: "Basic Activities", amount: 100, color: "#000" },
      { key: "business-location", label: "Business Location", amount: 0, color: "#000" },
      { key: "sell-marketing", label: "Sell & MKT Expenses", amount: 50, color: "#000" },
      { key: "functional-operation", label: "Functional Operation", amount: 150, color: "#000" }
    ],
    daily: [{ date: "2026-09-03", label: "03/09", minutes: 480, pnlMinutes: 420, pendingMinutes: 60, entryCount: 3 }],
    people: [{ id: "u1", name: "An", role: "PM", planMinutes: 600, logworkMinutes: 480, pnlMinutes: 420, hourlyCostRate: 100, laborCost: 300, daily: {} }],
    ...overrides
  };
}

const LOCKED = project({
  id: "P-2", code: "P-2", name: "Portal", locked: true, lockedOtherCost: 70, sharedCost: 0, calculatedItems: [],
  totalCost: 500, laborCost: 400, otherCost: 100, enteredCost: 30, grossMargin: 500, grossMarginPercent: 50, pnlResultStatus: "Sẵn sàng",
  // Current data that drifted after the lock: must not be added to the frozen total.
  costItems: [{ id: "late", projectId: "P-2", costType: "OTHER", category: "basic-activities", label: "Nhập sau khi chốt", amount: 99_999, currency: "VND", occurredOn: "2026-09-20" }],
  people: [{ id: "u2", name: "Bình", role: "Dev", planMinutes: 0, logworkMinutes: 600, pnlMinutes: 600, hourlyCostRate: 77, laborCost: 770, daily: {} }],
  expenses: [
    { key: "salaries-related", label: "Salaries Related", amount: 400, color: "#000" },
    { key: "locked-entered", label: "Chi phí nhập tay đã chốt", amount: 30, color: "#000" },
    { key: "locked-other", label: "Chi phí khác đã chốt (quỹ dùng chung + khoản tính theo công thức)", amount: 70, color: "#000" }
  ]
});
const PROJECTS = [project({}), LOCKED];

async function reopen(projects: PnlProject[]) {
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await buildPnlWorkbook(ExcelJS, { period: "2026-09", projects }).xlsx.writeBuffer());
  const sheet = (name: string) => reopened.getWorksheet(name)!;
  const header = (name: string) => (sheet(name).getRow(1).values as unknown[]).slice(1) as string[];
  const column = (name: string, title: string) => (sheet(name).getColumn(header(name).indexOf(title) + 1).values as unknown[]).slice(2);
  const sum = (values: unknown[]) => values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
  return { reopened, sheet, header, column, sum };
}

describe("buildPnlWorkbook", () => {
  it("exports one table per sheet with the header on row 1", async () => {
    const { reopened, sheet, header } = await reopen(PROJECTS);

    expect(reopened.worksheets.map((worksheet) => worksheet.name)).toEqual(["Tổng quan", "Theo dự án", "Theo nhân sự", "Logwork theo ngày", "Chi phí theo nhóm", "Chi phí chi tiết", "Raw Data"]);
    // Every table sheet starts with its header and has a filter over exactly that table.
    for (const name of ["Theo dự án", "Theo nhân sự", "Logwork theo ngày", "Chi phí theo nhóm", "Chi phí chi tiết", "Raw Data"]) {
      expect(header(name).every((value) => typeof value === "string" && value.length > 0), name).toBe(true);
      expect(String(sheet(name).autoFilter), name).toMatch(/^A1:[A-Z]+\d+$/);
    }
    expect(header("Theo dự án").slice(0, 3)).toEqual(["Tên dự án", "Mã dự án", "Khách hàng"]);
    expect(sheet("Theo dự án").rowCount).toBe(PROJECTS.length + 1);
    expect(sheet("Raw Data").rowCount).toBe(PROJECTS.length + 1);
    expect(header("Raw Data").slice(-6)).toEqual(["Salaries Related", "Welfare Related", "Basic Activities", "Business Location", "Sell & MKT Expenses", "Functional Operation"]);
    expect(sheet("Logwork theo ngày").getCell("A2").value).toBeInstanceOf(Date);
    // Overview follows the dashboard template: period on top, then one KPI table.
    const overview = sheet("Tổng quan");
    expect([overview.getCell("A1").value, overview.getCell("B1").value, overview.getCell("A4").value]).toEqual(["Kỳ báo cáo", "Tháng 09/2026", "CHỈ SỐ TỔNG QUAN P&L"]);
  });

  it("uses one term for approved hours and Vietnamese money labels in every header", async () => {
    const { reopened, sheet, header } = await reopen(PROJECTS);
    const labels = [...reopened.worksheets.filter((worksheet) => worksheet.name !== "Tổng quan").flatMap((worksheet) => header(worksheet.name)), ...(sheet("Tổng quan").getColumn(1).values as unknown[]).map(String)];
    expect(labels).toContain("Giờ đã duyệt");
    expect(labels.filter((label) => /P&L (h|giờ|hợp lệ)|Giờ tính P&L|Margin|Revenue|^Cost$/i.test(label))).toEqual([]);
  });

  it("copies the API's EBIT, margin and other-cost figures instead of recomputing them", async () => {
    const { sheet, column } = await reopen([project({})]);
    // The fixture's EBIT (407) is not revenue − cost (400) and its other cost (301) is not total − labor (300).
    expect(column("Theo dự án", "EBIT")).toEqual([407]);
    expect(column("Theo dự án", "Biên EBIT (%)")).toEqual([40.7]);
    expect(column("Theo dự án", "Chi phí khác")).toEqual([301]);
    expect(column("Raw Data", "EBIT")).toEqual([407]);
    const overview = sheet("Tổng quan");
    expect([overview.getCell("A7").value, overview.getCell("B7").value, overview.getCell("A8").value, overview.getCell("B8").value]).toEqual(["EBIT", 407, "Biên EBIT", 40.7]);
  });

  it("adds up to the total cost on every cost sheet, including a locked month", async () => {
    const { sheet, column, sum } = await reopen(PROJECTS);
    const totalCost = 600 + 500;
    expect(sheet("Tổng quan").getCell("B6").value).toBe(totalCost);
    expect(sum(column("Theo dự án", "Tổng chi phí"))).toBe(totalCost);
    expect(sum(column("Chi phí theo nhóm", "Giá trị"))).toBe(totalCost);
    expect(sum(column("Chi phí chi tiết", "Số tiền"))).toBe(totalCost);

    // The locked project is three frozen rows; its live lines and per-person costs are not part of the total.
    const detail = sheet("Chi phí chi tiết");
    const lockedRows = (detail.getSheetValues() as unknown[][]).filter((row) => row?.[2] === "P-2").map((row) => [row[4], row[7]]);
    expect(lockedRows).toEqual([
      ["Chi phí nhân sự đã chốt", 400],
      ["Chi phí nhập tay đã chốt", 30],
      ["Chi phí khác đã chốt (quỹ dùng chung + khoản tính theo công thức)", 70]
    ]);
    expect(column("Chi phí theo nhóm", "Nhóm chi phí").slice(-2)).toEqual(["Chi phí nhập tay đã chốt", "Chi phí khác đã chốt (quỹ dùng chung + khoản tính theo công thức)"]);
    // Per-person rows of the locked project are marked as current data.
    expect(column("Theo nhân sự", "Ghi chú").at(-1)).toBe("Số hiện tại, có thể khác số đã chốt");
    expect(column("Theo nhân sự", "Ghi chú")[0] || "").toBe("");
    // Without a locked project the group sheet is exactly the six BRD groups.
    expect((await reopen([project({})])).sheet("Chi phí theo nhóm").rowCount).toBe(7);
  });
});
