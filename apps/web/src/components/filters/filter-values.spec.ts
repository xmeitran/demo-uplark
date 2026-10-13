import { describe, expect, it } from "vitest";
import { dayOf, fromCsvParam, isWithinRange, matchesAny, rangesOverlap, toCsvParam } from "./filter-values";

describe("toCsvParam / fromCsvParam", () => {
  it("omits the parameter when nothing is selected", () => {
    expect(toCsvParam([])).toBeUndefined();
    expect(toCsvParam(["", " "])).toBeUndefined();
    expect(toCsvParam(["a", "b", "a"])).toBe("a,b");
  });

  it("reads csv, repeated parameters and nothing", () => {
    expect(fromCsvParam(" a, b ,,a")).toEqual(["a", "b"]);
    expect(fromCsvParam(["a,b", "c", "b"])).toEqual(["a", "b", "c"]);
    expect(fromCsvParam(null)).toEqual([]);
    expect(fromCsvParam(undefined)).toEqual([]);
  });
});

describe("matchesAny", () => {
  it("matches everything while nothing is selected", () => {
    expect(matchesAny([], undefined)).toBe(true);
    expect(matchesAny([], "x")).toBe(true);
  });

  it("needs one selected value among the row's values", () => {
    expect(matchesAny(["a", "b"], "b")).toBe(true);
    expect(matchesAny(["a"], ["x", "a"])).toBe(true);
    expect(matchesAny(["a"], ["x"])).toBe(false);
    expect(matchesAny(["a"], undefined)).toBe(false);
  });
});

describe("isWithinRange", () => {
  it("is inclusive and open-ended on an empty bound", () => {
    const range = { from: "2026-10-01", to: "2026-10-31" };
    expect(isWithinRange("2026-10-01", range)).toBe(true);
    expect(isWithinRange("2026-10-31", range)).toBe(true);
    expect(isWithinRange("2026-11-01", range)).toBe(false);
    expect(isWithinRange("2030-01-01", { from: "2026-10-01", to: "" })).toBe(true);
    expect(isWithinRange("2026-09-30", { from: "2026-10-01", to: "" })).toBe(false);
  });

  it("lets a missing day through only for all time", () => {
    expect(isWithinRange("", { from: "", to: "" })).toBe(true);
    expect(isWithinRange(undefined, { from: "2026-10-01", to: "" })).toBe(false);
  });
});

describe("rangesOverlap", () => {
  const range = { from: "2026-10-10", to: "2026-10-20" };

  it("counts a shared boundary day as overlap", () => {
    expect(rangesOverlap("2026-10-01", "2026-10-10", range)).toBe(true);
    expect(rangesOverlap("2026-10-20", "2026-11-05", range)).toBe(true);
    expect(rangesOverlap("2026-10-01", "2026-10-09", range)).toBe(false);
    expect(rangesOverlap("2026-10-21", "2026-10-30", range)).toBe(false);
  });

  it("treats empty span ends and empty range bounds as open", () => {
    expect(rangesOverlap("2026-10-25", "", range)).toBe(false);
    expect(rangesOverlap("2026-10-15", "", range)).toBe(true);
    expect(rangesOverlap("", "2026-10-09", range)).toBe(false);
    expect(rangesOverlap("2020-01-01", "2020-01-02", { from: "", to: "" })).toBe(true);
  });
});

describe("dayOf", () => {
  it("returns the Vietnam calendar day, which is ahead of UTC late in the evening", () => {
    expect(dayOf("2026-10-12T17:30:00.000Z")).toBe("2026-10-13");
    expect(dayOf("2026-10-12T16:59:59.000Z")).toBe("2026-10-12");
    expect(dayOf("2026-10-13")).toBe("2026-10-13");
  });

  it("returns an empty day for missing or invalid input", () => {
    expect(dayOf(null)).toBe("");
    expect(dayOf("not a date")).toBe("");
  });
});
