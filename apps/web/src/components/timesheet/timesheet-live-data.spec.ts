import { describe, expect, it } from "vitest";
import { buildTimesheetDateRanges, dateOnly, projectMemberState, resolveTaskStatus, selectableTimesheetMonths, TIMESHEET_HISTORY_DAYS, timesheetWindowStart, yearsBetween } from "./timesheet-live-data";
import { normalizeNodeStatus } from "./timesheet-status";

describe("timesheet history ranges", () => {
  it("uses a bounded reporting history for the live workbench", () => {
    expect(TIMESHEET_HISTORY_DAYS).toBe(365);
  });

  it("splits a long history into contiguous API-safe windows", () => {
    const startAt = new Date("2026-01-01T00:00:00.000Z");
    const endAt = new Date("2026-10-01T00:00:00.000Z");

    const ranges = buildTimesheetDateRanges(startAt, endAt, 90);

    expect(ranges.length).toBe(4);
    expect(ranges[0]).toEqual({
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-04-01T00:00:00.000Z"
    });
    expect(ranges.at(-1)?.endAt).toBe(endAt.toISOString());
    expect(ranges.every((range) => new Date(range.endAt).getTime() - new Date(range.startAt).getTime() <= 90 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(ranges.slice(1).every((range, index) => range.startAt === ranges[index].endAt)).toBe(true);
  });
});

describe("live timesheet status mapping", () => {
  it.each([
    ["ACTIVE", "active"],
    ["ON_LEAVE", "on_leave"],
    ["INACTIVE", "released"],
    ["SUSPENDED", "released"]
  ])("maps employment status %s to HR member state %s", (employmentStatus, expected) => {
    expect(projectMemberState(employmentStatus)).toBe(expected);
  });

  it.each(["waiting", "pending", "on_hold"])("maps %s to Đang chờ", (status) => {
    expect(normalizeNodeStatus(status)).toBe("waiting");
  });

  it("keeps completed aliases as Đã hoàn thành", () => {
    expect(normalizeNodeStatus("done")).toBe("completed");
  });

  it("does not let a generic time-entry status overwrite the task status", () => {
    expect(resolveTaskStatus("todo", "in_progress")).toBe("todo");
    expect(resolveTaskStatus("completed", "in_progress")).toBe("completed");
    expect(resolveTaskStatus(undefined, "completed")).toBe("completed");
  });
});

describe("timesheet calendar rules", () => {
  it("reads dates as Asia/Ho_Chi_Minh days, not UTC slices", () => {
    // 18:00Z on the 30th is already 01:00 on the 1st in Vietnam.
    expect(dateOnly("2026-09-30T18:00:00.000Z")).toBe("2026-10-01");
    expect(dateOnly("2026-09-30")).toBe("2026-09-30");
    expect(dateOnly(undefined)).toBeNull();
    expect(timesheetWindowStart(new Date("2026-10-10T18:00:00.000Z"))).toBe("2025-10-11");
  });

  it("leaves the partly loaded oldest month out of the period picker and always offers the current month", () => {
    const months = selectableTimesheetMonths(["2025-10-20", "2025-11-03", "2026-09-30"], "2025-10-11", "2026-10-11");
    expect(months).toEqual(["2025-11", "2026-09", "2026-10"]);
    // A window that starts on the 1st loads that month completely.
    expect(selectableTimesheetMonths(["2025-10-20"], "2025-10-01", "2026-10-11")).toContain("2025-10");
  });

  it("asks for day-offs of every year the window touches", () => {
    expect(yearsBetween("2025-10-11", "2026-10-12")).toEqual([2025, 2026]);
    expect(yearsBetween("2026-01-01", "2026-12-31")).toEqual([2026]);
  });
});
