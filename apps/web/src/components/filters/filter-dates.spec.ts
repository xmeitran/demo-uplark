import { describe, expect, it } from "vitest";
import { buildMonthList, datePresets, formatRangeLabel, hasChoice, monthPresets } from "./filter-dates";

describe("buildMonthList", () => {
  it("lists months newest first across a year boundary", () => {
    expect(buildMonthList({ min: "2025-11", max: "2026-02" })).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });

  it("keeps a selected month outside the span and drops malformed ones", () => {
    expect(buildMonthList({ min: "2026-09", max: "2026-10", include: ["2024-03", "2026-10", "2026-13", ""] })).toEqual(["2026-10", "2026-09", "2024-03"]);
  });
});

describe("datePresets", () => {
  const byId = (today: string) => Object.fromEntries(datePresets(["this-month", "last-month", "this-quarter", "this-year", "all"], today).map((preset) => [preset.id, `${preset.from}..${preset.to}`]));

  it("resolves whole periods from a Vietnam-local day", () => {
    expect(byId("2026-10-11")).toEqual({
      "this-month": "2026-10-01..2026-10-31",
      "last-month": "2026-09-01..2026-09-30",
      "this-quarter": "2026-10-01..2026-12-31",
      "this-year": "2026-01-01..2026-12-31",
      all: ".."
    });
  });

  it("handles January and leap February", () => {
    expect(byId("2024-01-31")["last-month"]).toBe("2023-12-01..2023-12-31");
    expect(byId("2024-02-10")["this-month"]).toBe("2024-02-01..2024-02-29");
    expect(byId("2024-02-10")["this-quarter"]).toBe("2024-01-01..2024-03-31");
  });

  it("keeps the order the screen asked for", () => {
    expect(datePresets(["all", "this-month"], "2026-10-11").map((preset) => preset.label)).toEqual(["Tất cả thời gian", "Tháng này"]);
  });
});

describe("monthPresets", () => {
  it("produces exactly the first and last day of each month", () => {
    expect(monthPresets(["2026-02", "2025-12"])).toEqual([
      { id: "2026-02", label: "Tháng 02/2026", from: "2026-02-01", to: "2026-02-28" },
      { id: "2025-12", label: "Tháng 12/2025", from: "2025-12-01", to: "2025-12-31" }
    ]);
  });
});

describe("formatRangeLabel", () => {
  const presets = datePresets(["this-month", "all"], "2026-10-11");

  it("uses the preset name when the range is a preset", () => {
    expect(formatRangeLabel({ from: "2026-10-01", to: "2026-10-31" }, presets)).toBe("Tháng này");
    expect(formatRangeLabel({ from: "", to: "" }, presets)).toBe("Tất cả thời gian");
  });

  it("formats a custom range as dd/mm/yyyy – dd/mm/yyyy", () => {
    expect(formatRangeLabel({ from: "2026-10-03", to: "2026-11-09" }, presets)).toBe("03/10/2026 – 09/11/2026");
    expect(formatRangeLabel({ from: "", to: "" })).toBe("Tất cả thời gian");
  });
});

describe("hasChoice", () => {
  it("needs two real options besides the catch-all", () => {
    expect(hasChoice([{ value: "all" }, { value: "a" }])).toBe(false);
    expect(hasChoice([{ value: "" }, { value: "a" }, { value: "b" }])).toBe(true);
  });
});
