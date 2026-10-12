import { describe, expect, it } from "vitest";
import {
  NO_VALUE, formatDateTime, formatDay, formatExactVnd, formatHoursValue, formatMillions, formatMonth, formatDong, formatEnteredPercent, formatMonthShort, formatPercent,
  formatSignedPercent, formatUpdatedAt, monthRangeLabel, monthsBetween
} from "./pnl-format";

describe("pnl-format", () => {
  it("formats đồng as triệu đồng with the wireframe's figures", () => {
    expect(formatMillions(1_240_000_000, "overview")).toBe("1.240");
    expect(formatMillions(67_200_000, "overview")).toBe("67,2");
    expect(formatMillions(67_200_000)).toBe("67,2");
    expect(formatMillions(30_970_000)).toBe("30,97");
    expect(formatMillions(60_000_000)).toBe("60,0"); // the same on the report tile and on Thiết lập P&L (mục 6.1)
    expect(formatMillions(5_260_000)).toBe("5,26");
    expect(formatMillions(3_200_000, "table")).toBe("3,20");
    expect(formatMillions(22_600_000, "table")).toBe("22,60");
    expect(formatMillions(540_000, "table")).toBe("0,54");
    expect(formatMillions(0, "table")).toBe("0"); // mục 6.7: cột OT "0"
    expect(formatMillions(0)).toBe("0");
  });

  it("never shows 0 for a missing figure (PL-25)", () => {
    expect(formatMillions(null)).toBe(NO_VALUE);
    expect(formatMillions(undefined, "table")).toBe(NO_VALUE);
    expect(formatPercent(null)).toBe(NO_VALUE);
    expect(formatHoursValue(null)).toBe(NO_VALUE);
    expect(formatDong(null)).toBe(NO_VALUE);
    expect(formatEnteredPercent(null)).toBe(NO_VALUE);
    expect(formatExactVnd(null)).toBeUndefined();
  });

  it("keeps the exact đồng for tooltips and the cost rate unrounded to millions", () => {
    expect(formatExactVnd(67_200_000)).toBe("67.200.000 đ");
    expect(formatDong(162_380.95)).toBe("162.381");
  });

  it("formats minutes as hours", () => {
    expect(formatHoursValue(6330)).toBe("105,5");
    expect(formatHoursValue(128_400)).toBe("2.140");
    expect(formatHoursValue(0)).toBe("0");
    expect(formatHoursValue(20)).toBe("0,33"); // a 20-minute block is not rounded away: the reconciliation line must add up
  });

  it("rounds percentages once, at display", () => {
    expect(formatPercent(53.9137)).toBe("53,9%");
    expect(formatPercent(34)).toBe("34,0%");
    expect(formatPercent(63.6, 0)).toBe("64%");
    expect(formatPercent(3.2941)).toBe("3,3%");
    expect(formatEnteredPercent(70)).toBe("70%");
    expect(formatEnteredPercent(33.33)).toBe("33,33%");
    expect(formatSignedPercent(5.19)).toBe("+5%");
    expect(formatSignedPercent(-3.4)).toBe("−3%");
    expect(formatSignedPercent(0.2)).toBe("0%");
  });

  it("formats months, days and the update time in Vietnam time", () => {
    expect(formatMonth("2026-03")).toBe("03/2026");
    expect(formatMonthShort("2026-03-15")).toBe("03/26");
    expect(monthRangeLabel("2026-03", "2026-07")).toBe("Từ 03/2026 đến 07/2026"); // one control, as the wireframe writes it
    expect(formatMonthShort(null)).toBe(NO_VALUE);
    expect(formatDay("2026-07-30")).toBe("30/07/2026");
    expect(formatDay("2026-10-01T18:05:00.000Z")).toBe("02/10/2026"); // an instant is read in Vietnam time
    expect(formatDay("2026-10-02T03:00:00.000Z", false)).toBe("02/10");
    expect(formatDay(null)).toBe(NO_VALUE);
    expect(formatUpdatedAt("2026-10-12T01:30:00.000Z")).toBe("08:30 ngày 12/10");
    expect(formatDateTime("2026-10-01T18:05:00.000Z")).toBe("02/10/2026 01:05");
    expect(formatUpdatedAt("not a date")).toBe(NO_VALUE);
  });

  it("lists the months of a range across a year end", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-03", "2026-03")).toEqual(["2026-03"]);
    expect(monthsBetween("2026-05", "2026-03")).toEqual([]);
  });
});
