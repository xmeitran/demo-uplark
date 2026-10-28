import { describe, expect, it } from "vitest";
import { isPlannedHoursInvalid, parsePlannedHours } from "./task-estimate";

describe("planned hours of a task", () => {
  it("keeps decimals instead of truncating them", () => {
    expect(parsePlannedHours("1.5")).toBe(1.5);
    expect(parsePlannedHours("1,5")).toBe(1.5);
    expect(parsePlannedHours("")).toBe(0);
    expect(parsePlannedHours("abc")).toBe(0);
  });

  it("accepts any non-negative estimate: the 8-hour limit is per day, not per task", () => {
    expect(isPlannedHoursInvalid(8)).toBe(false);
    expect(isPlannedHoursInvalid(8.5)).toBe(false);
    expect(isPlannedHoursInvalid(40)).toBe(false);
    expect(isPlannedHoursInvalid(-1)).toBe(true);
    expect(isPlannedHoursInvalid(Number.NaN)).toBe(true);
  });
});
