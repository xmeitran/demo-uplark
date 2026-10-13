import { describe, expect, it } from "vitest";
import { isPlannedHoursInvalid, parsePlannedHours } from "./task-estimate";

describe("planned hours of a task", () => {
  it("keeps decimals instead of truncating them", () => {
    expect(parsePlannedHours("1.5")).toBe(1.5);
    expect(parsePlannedHours("1,5")).toBe(1.5);
    expect(parsePlannedHours("")).toBe(0);
    expect(parsePlannedHours("abc")).toBe(0);
  });

  it("caps a new or changed estimate at 8 hours", () => {
    expect(isPlannedHoursInvalid(8)).toBe(false);
    expect(isPlannedHoursInvalid(8.5)).toBe(true);
    expect(isPlannedHoursInvalid(-1)).toBe(true);
  });

  it("leaves an older larger estimate alone until the user changes it", () => {
    expect(isPlannedHoursInvalid(16, 16)).toBe(false);
    expect(isPlannedHoursInvalid(12, 16)).toBe(true);
    expect(isPlannedHoursInvalid(6, 16)).toBe(false);
  });
});
