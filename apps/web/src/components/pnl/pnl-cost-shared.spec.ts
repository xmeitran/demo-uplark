import { describe, expect, it } from "vitest";
import { checklistRow, configCheckParts, filterTree, formulaText, importResultText, mapStaffCostSheet, nextFormulaStep, parseDecimalInput, setupTabOf, visibleTreeRows, formatDecimalInput, formatMoneyInput, parseImportAmount, parseMoneyInput } from "./pnl-cost-shared";

describe("P&L setup input", () => {
  it("reads typed numbers", () => {
    expect(parseDecimalInput("26.300")).toBe(26300);
    expect(parseDecimalInput("5,5")).toBe(5.5);
    expect(parseDecimalInput("400000")).toBe(400000);
    expect(parseDecimalInput("1.250.000,5")).toBe(1250000.5);
    expect(parseDecimalInput("")).toBeUndefined();
    expect(parseDecimalInput("abc")).toBeUndefined();
  });
});

describe("Khoản mục tree", () => {
  const items = [
    { code: "REV", parentCode: null }, { code: "REV.REC", parentCode: "REV" },
    { code: "COST", parentCode: null }, { code: "COST.FO", parentCode: "COST" }, { code: "COST.FO.AI", parentCode: "COST.FO" }, { code: "COST.COMM", parentCode: "COST" }
  ];
  it("keeps the API order and marks groups", () => {
    const rows = visibleTreeRows(items, new Set());
    expect(rows.map((row) => row.code)).toEqual(items.map((item) => item.code));
    expect(rows.filter((row) => row.hasChildren).map((row) => row.code)).toEqual(["REV", "COST", "COST.FO"]);
    expect(rows.every((row) => row.expanded)).toBe(true);
  });
  it("hides every descendant of a collapsed group", () => {
    const rows = visibleTreeRows(items, new Set(["COST"]));
    expect(rows.map((row) => row.code)).toEqual(["REV", "REV.REC", "COST"]);
    expect(rows.find((row) => row.code === "COST")?.expanded).toBe(false);
    expect(visibleTreeRows(items, new Set(["COST.FO"])).map((row) => row.code)).toEqual(["REV", "REV.REC", "COST", "COST.FO", "COST.COMM"]);
  });
  it("writes a formula from tokens and says what may come next", () => {
    const operands = [{ token: { item: "REV.REC" }, label: "Doanh thu ghi nhận" }, { token: { param: "commissionPercent" }, label: "Tỷ lệ hoa hồng" }];
    const tokens = [{ item: "REV.REC" }, { op: "*" as const }, { param: "commissionPercent" }];
    expect(formulaText(tokens, operands)).toBe("[Doanh thu ghi nhận] × [Tỷ lệ hoa hồng]");
    expect(nextFormulaStep([])).toBe("operand");
    expect(nextFormulaStep(tokens.slice(0, 1))).toBe("operator");
    expect(nextFormulaStep(tokens.slice(0, 2))).toBe("operand");
  });
  it("turns the configuration check into the three statements of the status bar", () => {
    const ok = { hasCycle: false, cycleCodes: [], allGroupsSummed: true, groupErrors: [], requiredWithoutValue: [{}], periodKey: "2026-10", errors: [] };
    expect(configCheckParts(ok)).toEqual([
      { ok: true, text: "Không có tham chiếu vòng" }, { ok: true, text: "Mọi dòng tổng do hệ thống cộng" }, { ok: false, text: "1 khoản mục bắt buộc chưa có số ở kỳ 10/2026" }
    ]);
    expect(configCheckParts({ ...ok, hasCycle: true, cycleCodes: ["A", "B"] })[0]).toEqual({ ok: false, text: "Có tham chiếu vòng: A → B" });
  });
});

describe("checklist and fix links", () => {
  it("builds a checklist line with its detail and link, and no link once the condition is met", () => {
    const item = { ok: false, label: "Mọi quỹ của tháng đã chia đủ và xác nhận", detail: "còn: Công cụ AI", target: "funds", targetLabel: "Quỹ chi phí chung" };
    expect(checklistRow(item, "2026-09")).toEqual({ ok: false, text: "Mọi quỹ của tháng đã chia đủ và xác nhận · còn: Công cụ AI", link: { href: "/pnl/costs?tab=funds&periodKey=2026-09", label: "Quỹ chi phí chung" } });
    expect(checklistRow({ ...item, ok: true, detail: null }, "2026-09")).toEqual({ ok: true, text: "Mọi quỹ của tháng đã chia đủ và xác nhận", link: null });
    // The one fixTargetHref (pnl-query.ts): the hours worklist and the project list are reachable from a checklist line too.
    expect(checklistRow({ ok: false, label: "Không còn giờ Chờ xử lý", detail: "còn 117,5 giờ", target: "pending_hours", targetLabel: "Danh sách" }, "2026-09").link).toEqual({ href: "/pnl/hours?periodKey=2026-09", label: "Danh sách" });
    expect(checklistRow({ ...item, target: null, targetLabel: null }, "2026-09").link).toBeNull();
  });
  it("keeps only the two Admin settings tabs and sends legacy values to Khoản mục", () => {
    expect(setupTabOf("periods")).toBe("items");
    expect(setupTabOf("funds")).toBe("items");
    expect(setupTabOf("templates")).toBe("items");
    expect(setupTabOf("parameters")).toBe("parameters");
    expect(setupTabOf(null)).toBe("items");
    expect(setupTabOf("other-costs")).toBe("items");
  });
});

describe("staff cost import", () => {
  const columns = [
    { key: "employeeCode", label: "Mã NS", required: true }, { key: "displayName", label: "Nhân sự", required: false },
    { key: "baseSalaryAmount", label: "Lương tiêu chuẩn", required: true }, { key: "overtimeAmount", label: "OT", required: false }
  ];
  it("maps sheet rows by the template's header, skips blank lines and leaves non-numbers out", () => {
    const result = mapStaffCostSheet([
      ["Mã NS", "Nhân sự", "OT", "Lương tiêu chuẩn"],
      ["NS-012", "Nhân sự A", 0, 20_000_000],
      [null, null, null, null],
      ["NS-031", "PM-1", "", "26.000.000"],
      ["NS-044", "BD-1", "n/a", null]
    ], columns);
    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toEqual([
      { employeeCode: "NS-012", overtimeAmount: 0, baseSalaryAmount: 20_000_000 },
      { employeeCode: "NS-031", baseSalaryAmount: 26_000_000 },
      { employeeCode: "NS-044" }
    ]);
  });
  it("reports missing required columns instead of importing", () => {
    expect(mapStaffCostSheet([["Mã NS", "OT"], ["NS-012", 0]], columns)).toEqual({ rows: [], missingColumns: ["Lương tiêu chuẩn"] });
  });
  it("summarises the import result as the screen shows it", () => {
    expect(importResultText({ periodKey: "2026-09", validCount: 44, errors: [{ employeeCode: "NS-099", reason: "không tồn tại" }] })).toBe("Import 09/2026: 44 dòng hợp lệ vào Nháp · 1 dòng lỗi: mã NS-099 không tồn tại");
    expect(importResultText({ periodKey: "2026-09", validCount: 45, errors: [] })).toBe("Import 09/2026: 45 dòng hợp lệ vào Nháp · không có dòng lỗi");
  });
});

describe("filterTree", () => {
  const tree = [
    { code: "REV", parentCode: null }, { code: "COST", parentCode: null }, { code: "COST.STAFF", parentCode: "COST" },
    { code: "COST.STAFF.DEL", parentCode: "COST.STAFF" }, { code: "COST.FUND", parentCode: "COST" }
  ];

  it("keeps a hit together with its ancestors, in tree order", () => {
    expect(filterTree(tree, (item) => item.code === "COST.STAFF.DEL").map((item) => item.code)).toEqual(["COST", "COST.STAFF", "COST.STAFF.DEL"]);
    expect(filterTree(tree, (item) => item.code.endsWith("FUND") || item.code === "REV").map((item) => item.code)).toEqual(["REV", "COST", "COST.FUND"]);
    expect(filterTree(tree, () => false)).toEqual([]);
  });

  it("survives a parent cycle", () => {
    expect(filterTree([{ code: "A", parentCode: "B" }, { code: "B", parentCode: "A" }], (item) => item.code === "A").map((item) => item.code)).toEqual(["A", "B"]);
  });
});

describe("formatDecimalInput (review 19/10: C19)", () => {
  it("prefills a stored number so it reads back unchanged, decimals included", () => {
    for (const value of [12.345, 26.3, 400000, 0.125, 5]) expect(parseDecimalInput(formatDecimalInput(value))).toBe(value);
    expect(formatDecimalInput(null)).toBe("");
  });
});

describe("money typed or imported (21/10/2026)", () => {
  it("refuses a minus sign or a decimal tail instead of saving another number", () => {
    expect(parseMoneyInput("150.000")).toBe(150000);
    expect(parseMoneyInput("-500.000")).toBeUndefined();
    expect(parseMoneyInput("150.000,5")).toBeUndefined();
    expect(formatMoneyInput("150.000,5")).toBe("150.000,5");
  });

  it("reads en-US grouping in an import cell as thousands", () => {
    expect(parseImportAmount("150,000")).toBe(150000);
    expect(parseImportAmount("33.333")).toBe(33333);
    expect(parseImportAmount("5,5")).toBe(5.5);
  });
});
