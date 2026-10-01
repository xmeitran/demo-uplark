import { describe, expect, it } from "vitest";
import { buildTimesheetDateRanges, resolveTaskStatus } from "./timesheet-live-data";
import { normalizeNodeStatus } from "./timesheet-status";

describe("timesheet history ranges", () => {
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
