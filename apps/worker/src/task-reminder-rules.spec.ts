import { describe, expect, it } from "vitest";
import {
  dueReminderSlots,
  findActualIssues,
  findPlanIssues,
  getVietnamWorkdayWindow,
  isWorkingDay,
  type ReminderUserFacts
} from "./task-reminder-rules.js";

function user(overrides: Partial<ReminderUserFacts> = {}): ReminderUserFacts {
  return {
    userId: "usr-1",
    displayName: "Nguyen Van A",
    larkOpenId: "ou_1",
    tasks: [],
    planningBlocks: [],
    timeEntries: [],
    ...overrides
  };
}

describe("task reminder workday", () => {
  it("uses the Vietnam day boundary and skips weekends or configured holidays", () => {
    const friday = getVietnamWorkdayWindow(new Date("2026-09-11T01:30:00.000Z"));
    const saturday = getVietnamWorkdayWindow(new Date("2026-09-12T01:30:00.000Z"));
    expect(friday.localDate).toBe("2026-09-11");
    expect(friday.startAt).toEqual(new Date("2026-09-10T17:00:00.000Z"));
    expect(isWorkingDay(friday, new Set())).toBe(true);
    expect(isWorkingDay(friday, new Set(["2026-09-11"]))).toBe(false);
    expect(isWorkingDay(saturday, new Set())).toBe(false);
  });

  it("selects only slots inside the catch-up window", () => {
    expect(dueReminderSlots(getVietnamWorkdayWindow(new Date("2026-09-11T01:45:00.000Z")), 60)).toEqual(["morning_plan"]);
    expect(dueReminderSlots(getVietnamWorkdayWindow(new Date("2026-09-11T04:00:00.000Z")), 60)).toEqual([]);
    expect(dueReminderSlots(getVietnamWorkdayWindow(new Date("2026-09-11T10:30:00.000Z")), 60)).toEqual(["evening_actual"]);
  });
});

describe("plan reminder rules", () => {
  it("reports a missing plan and required operational task fields", () => {
    const window = getVietnamWorkdayWindow(new Date("2026-09-11T01:30:00.000Z"));
    const issues = findPlanIssues([user({
      tasks: [{ id: "task-1", title: "Prepare kickoff", estimateMinutes: 0 }]
    })], window);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ hasPlan: false });
    expect(issues[0].taskFieldIssues[0].missingFields).toEqual([
      "Người phụ trách", "Ngày bắt đầu", "Hạn hoàn tất", "Giờ ước tính"
    ]);
  });

  it("does not remind a user with a plan and complete task fields", () => {
    const window = getVietnamWorkdayWindow(new Date("2026-09-11T01:30:00.000Z"));
    expect(findPlanIssues([user({
      tasks: [{
        id: "task-1",
        title: "Prepare kickoff",
        assigneeUserId: "usr-1",
        plannedStartAt: new Date("2026-09-11T02:00:00.000Z"),
        dueAt: new Date("2026-09-11T05:00:00.000Z"),
        estimateMinutes: 180
      }],
      planningBlocks: [{ taskId: "task-1", plannedMinutes: 180 }]
    })], window)).toEqual([]);
  });
});

describe("actual reminder rules", () => {
  it("reports both the daily shortfall and planned tasks with no actual entry", () => {
    const issues = findActualIssues([user({
      tasks: [
        { id: "task-1", title: "Prepare kickoff", estimateMinutes: 240 },
        { id: "task-2", title: "Run workshop", estimateMinutes: 240 }
      ],
      planningBlocks: [
        { taskId: "task-1", plannedMinutes: 240 },
        { taskId: "task-2", plannedMinutes: 240 }
      ],
      timeEntries: [{ taskId: "task-1", minutes: 240 }]
    })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ totalMinutes: 240, targetMinutes: 480 });
    expect(issues[0].taskWithoutActual).toEqual([{ taskId: "task-2", taskTitle: "Run workshop", projectName: undefined }]);
  });

  it("does not remind when target and task coverage are complete", () => {
    expect(findActualIssues([user({
      tasks: [{ id: "task-1", title: "Prepare kickoff", estimateMinutes: 480 }],
      planningBlocks: [{ taskId: "task-1", plannedMinutes: 480 }],
      timeEntries: [{ taskId: "task-1", minutes: 480 }]
    })])).toEqual([]);
  });
});
