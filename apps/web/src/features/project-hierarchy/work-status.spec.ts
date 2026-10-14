import { describe, expect, it } from "vitest";
import { deriveMilestoneWorkStatus } from "./work-status";

describe("deriveMilestoneWorkStatus", () => {
  it("keeps an overdue milestone out of Hoàn tất even when its stage is marked done", () => {
    expect(deriveMilestoneWorkStatus({
      stageStatus: "done",
      taskStatuses: ["overdue", "done", "in-progress"]
    })).toBe("at-risk");
  });

  it("shows an unfinished milestone as in progress", () => {
    expect(deriveMilestoneWorkStatus({
      stageStatus: "done",
      taskStatuses: ["done", "in-progress"]
    })).toBe("in-progress");
  });

  it("shows a milestone as done only when every task is closed", () => {
    expect(deriveMilestoneWorkStatus({
      stageStatus: "in-progress",
      taskStatuses: ["done", "cancelled"]
    })).toBe("done");
  });

  it("falls back to the stage status when there are no tasks", () => {
    expect(deriveMilestoneWorkStatus({ stageStatus: "upcoming", taskStatuses: [] })).toBe("upcoming");
  });
});
