import { describe, expect, it } from "vitest";
import { isClosedNodeStatus, isTaskOverdue, normalizeNodeStatus } from "./timesheet-status";

describe("normalizeNodeStatus", () => {
  it.each(["cancelled", "archived", "skipped", "Canceled"])("treats %s as closed", (status) => {
    expect(isClosedNodeStatus(normalizeNodeStatus(status))).toBe(true);
  });

  it("maps review to in progress and paused to not started", () => {
    expect(normalizeNodeStatus("review")).toBe("in_progress");
    expect(normalizeNodeStatus("In Progress")).toBe("in_progress");
    expect(normalizeNodeStatus("paused")).toBe("not_started");
    expect(isClosedNodeStatus(normalizeNodeStatus("todo"))).toBe(false);
  });
});

describe("isTaskOverdue", () => {
  const today = "2026-10-11";

  it("is true only for open work past its due date", () => {
    expect(isTaskOverdue({ status: "in_progress", dueDate: "2026-10-10" }, "active", today)).toBe(true);
    expect(isTaskOverdue({ status: "in_progress", dueDate: today }, "active", today)).toBe(false);
    expect(isTaskOverdue({ status: "completed", dueDate: "2026-10-01" }, "active", today)).toBe(false);
    expect(isTaskOverdue({ status: "cancelled", dueDate: "2026-10-01" }, "active", today)).toBe(false);
    expect(isTaskOverdue({ status: "not_started", dueDate: null }, "active", today)).toBe(false);
  });

  it("does not flag a paused task while its project is On Hold", () => {
    const paused = { status: "not_started", dueDate: "2026-10-01", paused: true };
    expect(isTaskOverdue(paused, "on_hold", today)).toBe(false);
    expect(isTaskOverdue(paused, "active", today)).toBe(true);
  });
});
