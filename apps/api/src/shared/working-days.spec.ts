import { describe, expect, it } from "vitest";
import { addWorkingDays, addWorkspaceWorkingDays, isWorkingDay, localDateKey, workingDaysBetween } from "./working-days";

// 2026-10-09 is a Friday.
const friday = new Date("2026-10-09T03:00:00.000Z");

describe("working days", () => {
  it("uses the Vietnam calendar date of an instant", () => {
    expect(localDateKey(new Date("2026-10-09T16:59:59.000Z"))).toBe("2026-10-09");
    expect(localDateKey(new Date("2026-10-09T17:00:00.000Z"))).toBe("2026-10-10");
  });

  it("treats weekends and workspace days off as non-working", () => {
    expect(isWorkingDay("2026-10-09")).toBe(true);
    expect(isWorkingDay("2026-10-10")).toBe(false);
    expect(isWorkingDay("2026-10-11")).toBe(false);
    expect(isWorkingDay("2026-10-12", new Set(["2026-10-12"]))).toBe(false);
  });

  it("skips the weekend and days off when adding working days, ending at the end of that Vietnam day", () => {
    expect(addWorkingDays(friday, 1).toISOString()).toBe("2026-10-12T16:59:59.999Z");
    expect(localDateKey(addWorkingDays(friday, 1, new Set(["2026-10-12"])))).toBe("2026-10-13");
    expect(localDateKey(addWorkingDays(friday, 3))).toBe("2026-10-14");
    expect(localDateKey(addWorkingDays(friday, 0))).toBe("2026-10-09");
  });

  it("counts elapsed working days", () => {
    expect(workingDaysBetween(friday, new Date("2026-10-12T03:00:00.000Z"))).toBe(1);
    expect(workingDaysBetween(friday, new Date("2026-10-11T03:00:00.000Z"))).toBe(0);
    expect(workingDaysBetween(friday, new Date("2026-10-14T03:00:00.000Z"), new Set(["2026-10-13"]))).toBe(2);
    expect(workingDaysBetween(friday, new Date("2026-10-01T03:00:00.000Z"))).toBe(0);
  });

  it("reads the active days off of the workspace", async () => {
    const findMany = async ({ where }: any) => (where.workspaceId === "twk-1" && where.isActive ? [{ date: new Date("2026-10-12T00:00:00.000Z") }] : []);
    expect(localDateKey(await addWorkspaceWorkingDays({ workspaceDayOff: { findMany } }, "twk-1", friday, 1))).toBe("2026-10-13");
    expect(localDateKey(await addWorkspaceWorkingDays({}, "twk-1", friday, 1))).toBe("2026-10-12");
  });
});
