import { describe, expect, it } from "vitest";
import { allocatePool, computeMargin, effectiveCostRate, evaluateFormula, parseParameterValue, monthKeysBetween, nextMonthKey, normalizeCostCategory, reportDayStart, reportMonthKey, reportMonthStart, resolveRevenue, summarizeLabor } from "./pnl-calc";

const rate = (userId: string, month: string, hourlyCostRate: number) => ({ userId, hourlyCostRate, effectiveFrom: reportMonthStart(month), effectiveTo: null });

describe("pnl-calc", () => {
  it("uses Asia/Ho_Chi_Minh month boundaries", () => {
    expect(reportMonthStart("2026-10").toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(reportDayStart("2026-10-01").toISOString()).toBe("2026-09-30T17:00:00.000Z");
    // 06:00 on 1 Oct in Vietnam is still 30 Sep in UTC but belongs to October.
    expect(reportMonthKey(new Date("2026-09-30T23:00:00.000Z"))).toBe("2026-10");
    expect(reportMonthKey(new Date("2026-09-30T16:59:59.000Z"))).toBe("2026-09");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });

  it("carries a rate forward until a later month overrides it", () => {
    const rows = [rate("u1", "2026-08", 100_000), rate("u1", "2026-10", 150_000)];
    expect(effectiveCostRate(rows, new Date("2026-07-15T03:00:00.000Z"))).toBeUndefined();
    expect(effectiveCostRate(rows, new Date("2026-09-15T03:00:00.000Z"))?.hourlyCostRate).toBe(100_000);
    expect(effectiveCostRate(rows, new Date("2026-10-01T03:00:00.000Z"))?.hourlyCostRate).toBe(150_000);
    expect(effectiveCostRate([{ ...rows[0], effectiveTo: reportMonthStart("2026-09") }], new Date("2026-09-15T03:00:00.000Z"))).toBeUndefined();
  });

  it("costs approved hours at the rate of the work date, uncapped, and reports hours without a rate", () => {
    const rates = new Map([["u1", [rate("u1", "2026-09", 120_000), rate("u1", "2026-10", 180_000)]]]);
    const labor = summarizeLabor([
      { userId: "u1", minutes: 600, approvalStatus: "approved", workDate: new Date("2026-09-10T02:00:00.000Z") }, // 10h, no 8h cap
      { userId: "u1", minutes: 90, approvalStatus: "APPROVED", workDate: new Date("2026-10-02T02:00:00.000Z") },
      { userId: "u1", minutes: 60, approvalStatus: "rejected", workDate: new Date("2026-10-02T02:00:00.000Z") },
      { userId: "u1", minutes: 45, approvalStatus: "pending", workDate: new Date("2026-10-02T02:00:00.000Z") },
      { userId: "u2", minutes: 120, approvalStatus: "approved", workDate: new Date("2026-10-02T02:00:00.000Z") }
    ], rates);
    expect(labor.approvedMinutes).toBe(810);
    expect(labor.laborCostAmount).toBe(10 * 120_000 + 1.5 * 180_000);
    expect(labor.missingRateMinutes).toBe(120);
    expect(labor.people.find((person) => person.userId === "u1")).toEqual({ userId: "u1", approvedMinutes: 690, laborCostAmount: 1_470_000, missingRateMinutes: 0, hourlyCostRate: 180_000 });
    expect(labor.people.find((person) => person.userId === "u2")).toEqual({ userId: "u2", approvedMinutes: 120, laborCostAmount: 0, missingRateMinutes: 120 });
  });

  it("keeps revenue, EBIT and margin on one basis", () => {
    expect(resolveRevenue({ customRevenueAmount: 0, plannedRevenueAmount: 1000 })).toEqual({ revenueAmount: 0, revenueBasis: "custom" });
    expect(resolveRevenue({ customRevenueAmount: 800, plannedRevenueAmount: 1000 })).toEqual({ revenueAmount: 800, revenueBasis: "custom" });
    expect(resolveRevenue({ plannedRevenueAmount: 1000 })).toEqual({ revenueAmount: 1000, revenueBasis: "planned" });
    expect(resolveRevenue({ plannedRevenueAmount: 0 })).toEqual({ revenueAmount: 0, revenueBasis: "none" });
    // One month of cost is never compared with whole-project planned revenue.
    expect(resolveRevenue({ plannedRevenueAmount: 1000, periodScoped: true })).toEqual({ revenueAmount: 0, revenueBasis: "none" });
    expect(resolveRevenue({ customRevenueAmount: 300, plannedRevenueAmount: 1000, periodScoped: true })).toEqual({ revenueAmount: 300, revenueBasis: "custom" });
    expect(computeMargin(1000, 220)).toEqual({ grossMarginAmount: 780, grossMarginPercent: 78, expenseRatioPercent: 22 });
    expect(computeMargin(1000, 1333)).toEqual({ grossMarginAmount: -333, grossMarginPercent: -33.3, expenseRatioPercent: 133.3 });
    expect(computeMargin(0, 50)).toEqual({ grossMarginAmount: -50, grossMarginPercent: undefined, expenseRatioPercent: undefined });
  });

  it("allocates a shared pool exactly, by weight, with the remainder on the heaviest project", () => {
    const shares = allocatePool(1000, new Map([["a", 1], ["b", 1], ["c", 1], ["idle", 0]]));
    expect(Array.from(shares.values()).reduce((sum, value) => sum + value, 0)).toBe(1000);
    expect(shares.has("idle")).toBe(false);
    expect(allocatePool(5_260_000, new Map([["a", 300], ["b", 100]]))).toEqual(new Map([["a", 3_945_000], ["b", 1_315_000]]));
    expect(allocatePool(100, new Map([["a", 2], ["b", 1]]))).toEqual(new Map([["a", 67], ["b", 33]]));
    expect(allocatePool(100, new Map([["a", 0]])).size).toBe(0);
    expect(allocatePool(0, new Map([["a", 5]])).size).toBe(0);
  });

  it("normalizes cost categories and lists months in a range", () => {
    expect(normalizeCostCategory("sell-marketing")).toBe("sell-marketing");
    expect(normalizeCostCategory(null)).toBe("functional-operation");
    expect(normalizeCostCategory("bogus")).toBe("functional-operation");
    expect(monthKeysBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  // Same table as apps/web/src/components/pnl/pnl-cost-shared.spec.ts — keep the two in step.
  const PARAMETER_CASES: Array<[string, number | undefined]> = [
    ["5%", 0.05], ["12,5%", 0.125], ["12.5%", 0.125],
    // Leading-zero integer part is always a decimal.
    ["0.125", 0.125], ["0,005", 0.005], ["0.05", 0.05], ["0,5", 0.5],
    // One separator + exactly three digits after a non-zero 1–3 digit integer part: thousands.
    ["26.300", 26300], ["26.300 ₫", 26300], ["1,250", 1250], ["999.999", 999999],
    // Not that shape: a decimal.
    ["1250.300", 1250.3], ["1250,300", 1250.3], ["26.30", 26.3], ["26,3", 26.3], ["1.2500", 1.25],
    // Several separators of one kind: thousands.
    ["1.250.000", 1250000], ["1,250,000", 1250000], ["10.000.000 ₫", 10000000],
    // Mixed: the last one is the decimal mark.
    ["1.250,5", 1250.5], ["1,250.5", 1250.5], ["1.250.000,75", 1250000.75], ["1,250,000.75", 1250000.75],
    ["176 giờ", 176], ["200 USD", 200], ["-1.250,5", -1250.5], ["-5%", -0.05],
    ["1.2.3", undefined], ["1,250.5,5", undefined], ["chưa có", undefined], ["", undefined]
  ];

  it("reads parameter values by one unambiguous rule", () => {
    for (const [text, expected] of PARAMETER_CASES) expect(parseParameterValue(text), text).toBe(expected);
    expect(parseParameterValue(200)).toBe(200);
    expect(parseParameterValue(Number.NaN)).toBeUndefined();
  });

  it("calculates user formulas from parameters and system variables", () => {
    const vars = new Map<string, number>([["DOANH_THU_THANG", 80_000_000], ["TY_LE_HOA_HONG", 0.05], ["GIO_DUYET", 120], ["PHI_AI", 200], ["TY_GIA_USD", 26_300], ["TONG_GIO", 0], ["X", 10]]);
    const value = (formula: string) => { const result = evaluateFormula(formula, vars); return result.ok ? result.value : result.error; };
    expect(value("DOANH_THU_THANG × TY_LE_HOA_HONG")).toBe(4_000_000);
    expect(value("doanh_thu_thang * 5%")).toBe(4_000_000);
    expect(value("PHI_AI * TY_GIA_USD")).toBe(5_260_000);
    expect(value("(GIO_DUYET + 30) ÷ 3 − 10")).toBe(40);
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("-(2 + 3) * 4")).toBe(-20);
    expect(value("MAX(0; GIO_DUYET - 160) * 100000")).toBe(0);
    expect(value("MIN(GIO_DUYET, 100)")).toBe(100);
    expect(value("GIO_DUYET * 21.5%")).toBeCloseTo(25.8);
    expect(value("ROUND(10 / 3; 2)")).toBe(3.33);
    // A ratio over an empty month is 0, not an error.
    expect(value("PHI_AI * TY_GIA_USD * GIO_DUYET / TONG_GIO")).toBe(0);
  });

  it("always reads a comma as an argument separator, never as a decimal", () => {
    const vars = new Map<string, number>([["X", 10]]);
    const run = (formula: string) => evaluateFormula(formula, vars);
    // These two used to compute X/3.2 and 5000000.3.
    expect(run("ROUND(X/3,2)")).toEqual({ ok: true, value: 3.33 });
    expect(run("MIN(5000000,3000000)")).toEqual({ ok: true, value: 3_000_000 });
    expect(run("MAX(1,5; 2)")).toEqual({ ok: true, value: 5 });
    expect(run("MAX(1.5; 2, 0.25)")).toEqual({ ok: true, value: 2 });
    expect(run("X * 0.125")).toEqual({ ok: true, value: 1.25 });
  });

  it("rejects a comma decimal or a thousands separator in a formula and says what to write", () => {
    const error = (formula: string) => { const result = evaluateFormula(formula, new Map([["X", 10]])); return result.ok ? `computed ${result.value}` : result.error; };
    expect(error("X*21,5")).toContain("viết 21.5 thay cho 21,5");
    expect(error("X * 21,5%")).toContain("viết 21.5 thay cho 21,5");
    expect(error("(X*21,5) + 1")).toContain("viết 21.5 thay cho 21,5");
    expect(error("X*21,5")).toContain("không dùng dấu phân cách hàng nghìn");
    expect(error("X * 1,250,000")).toContain("thay cho 1,250");
    expect(error("X * 1.250.000")).toContain("Không dùng dấu phân cách hàng nghìn");
    expect(error("X * 1.250.000")).toContain("viết 1250000");
    // "26.300" is 26300 as a parameter; in a formula it would silently be 26.3.
    expect(error("X * 26.300")).toContain("dễ hiểu nhầm");
    expect(error("X, 2")).toContain("chỉ dùng để tách đối số");
    expect(error("X; 2")).toContain("chỉ dùng để tách đối số");
  });

  it("explains what is wrong with a formula instead of guessing", () => {
    const error = (formula: string) => { const result = evaluateFormula(formula, new Map([["A", 1]])); return result.ok ? "" : result.error; };
    expect(error("")).toContain("trống");
    expect(error("A * TY_LE")).toContain('"TY_LE"');
    expect(error("(A + 2")).toContain(")");
    expect(error("A + ")).toContain("giữa chừng");
    expect(error("A 2")).toContain("Thừa");
    expect(error("A $ 2")).toContain("không hợp lệ");
    expect(error("SUM(A; 2)")).toContain("Không có hàm");
    expect(error("process.exit()")).not.toBe("");
  });
});
