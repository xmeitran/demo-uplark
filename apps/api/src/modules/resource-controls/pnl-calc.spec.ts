import { describe, expect, it } from "vitest";
import { monthKeysBetween, nextMonthKey, normalizeCostCategory, reportDayStart, reportMonthKey, reportMonthStart } from "./pnl-calc";

describe("pnl-calc", () => {
  it("uses Asia/Ho_Chi_Minh month boundaries", () => {
    expect(reportMonthStart("2026-10").toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(reportDayStart("2026-10-01").toISOString()).toBe("2026-09-30T17:00:00.000Z");
    // 06:00 on 1 Oct in Vietnam is still 30 Sep in UTC but belongs to October.
    expect(reportMonthKey(new Date("2026-09-30T23:00:00.000Z"))).toBe("2026-10");
    expect(reportMonthKey(new Date("2026-09-30T16:59:59.000Z"))).toBe("2026-09");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });

  it("normalizes cost categories and lists months in a range", () => {
    expect(normalizeCostCategory("sell-marketing")).toBe("sell-marketing");
    expect(normalizeCostCategory(null)).toBe("functional-operation");
    expect(normalizeCostCategory("bogus")).toBe("functional-operation");
    expect(monthKeysBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});
