import { describe, expect, it } from "vitest";
import {
  deriveTaskStatus,
  isCancelledTaskStatus,
  isClosedTaskStatus,
  isClosedWorkStatus,
  isCompletedTaskStatus,
} from "./task-status";

describe("task status semantics", () => {
  it.each(["done", "completed", "closed"])("treats %s as a completed status", (status) => {
    expect(isCompletedTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "blocked", "cancelled", ""])("does not treat %s as completed", (status) => {
    expect(isCompletedTaskStatus(status)).toBe(false);
  });

  it.each(["done", "completed", "closed", "cancelled", "canceled"])("treats %s as closed for gate evaluation", (status) => {
    expect(isClosedTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "blocked", ""])("does not treat %s as closed", (status) => {
    expect(isClosedTaskStatus(status)).toBe(false);
  });

  it.each(["cancelled", "canceled"])("treats %s as cancelled", (status) => {
    expect(isCancelledTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "done", "completed"])("does not treat %s as cancelled", (status) => {
    expect(isCancelledTaskStatus(status)).toBe(false);
  });

  it.each(["done", "completed", "closed", "cancelled", "canceled", "archived", " Done "])("treats %s as closed work (never open or overdue)", (status) => {
    expect(isClosedWorkStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "blocked", "review", ""])("treats %s as open work", (status) => {
    expect(isClosedWorkStatus(status)).toBe(false);
  });

  describe("derived business status", () => {
    const now = new Date("2026-10-14T04:00:00.000Z");

    it("keeps planned work as not started until its start date", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "todo",
          plannedStartAt: "2026-10-15T00:00:00.000Z",
          now,
        }),
      ).toBe("not_started");
    });

    it("marks work with actual time as in progress", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "todo",
          estimateMinutes: 120,
          loggedMinutes: 30,
          now,
        }),
      ).toBe("in_progress");
    });

    it("marks work complete when actual time reaches the estimate", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "in_progress",
          estimateMinutes: 120,
          loggedMinutes: 120,
          now,
        }),
      ).toBe("completed");
    });

    it("keeps explicitly waiting work in the waiting state", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "waiting",
          now,
        }),
      ).toBe("waiting");
    });

    it("marks unfinished work overdue after its due day", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "in_progress",
          dueAt: "2026-10-13T16:59:00.000Z", // 23:59 on 13/10 in Vietnam time, as the app stores a due day
          now,
        }),
      ).toBe("overdue");
    });

    it("judges 'today' in Vietnam time: overdue from 00:00 local, not from 07:00 when the UTC date turns", () => {
      const dueAt = "2026-10-13T16:59:00.000Z";
      expect(deriveTaskStatus({ rawStatus: "in_progress", dueAt, now: new Date("2026-10-13T17:30:00.000Z") })).toBe("overdue"); // 00:30 on 14/10 local
      expect(deriveTaskStatus({ rawStatus: "in_progress", dueAt, now: new Date("2026-10-13T16:30:00.000Z") })).not.toBe("overdue"); // 23:30 on 13/10 local
    });

    it("marks a task overdue when actual time was logged outside its plan", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "in_progress",
          plannedStartAt: "2026-10-10T00:00:00.000Z",
          dueAt: "2026-10-12T23:59:00.000Z",
          loggedMinutes: 30,
          timeEntries: [{ minutes: 30, startAt: "2026-10-13T02:00:00.000Z", endAt: "2026-10-13T02:30:00.000Z", approvalStatus: "approved" }],
          now,
        }),
      ).toBe("overdue");
    });

    it("treats explicit completion as final for a normal task even when its work was late", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "completed",
          plannedStartAt: "2026-10-10T00:00:00.000Z",
          dueAt: "2026-10-12T23:59:00.000Z",
          loggedMinutes: 30,
          timeEntries: [{ minutes: 30, startAt: "2026-10-13T02:00:00.000Z", endAt: "2026-10-13T02:30:00.000Z", approvalStatus: "approved" }],
          now,
        }),
      ).toBe("completed");
    });

    it("propagates an overdue child to its parent", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "in_progress",
          subtasks: [{ derivedStatus: "overdue" }],
          now,
        }),
      ).toBe("overdue");
    });

    it("does not complete a parent until every child is complete and the parent is confirmed", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "in_progress",
          subtasks: [{ derivedStatus: "completed" }, { derivedStatus: "completed" }],
          now,
        }),
      ).toBe("in_progress");

      expect(
        deriveTaskStatus({
          rawStatus: "done",
          subtasks: [{ derivedStatus: "completed" }, { derivedStatus: "completed" }],
          now,
        }),
      ).toBe("completed");
    });

    it("does not complete a confirmed parent while a child is still open", () => {
      expect(
        deriveTaskStatus({
          rawStatus: "done",
          subtasks: [{ derivedStatus: "completed" }, { derivedStatus: "in_progress" }],
          now,
        }),
      ).toBe("in_progress");
    });
  });
});
