import { describe, expect, it } from "vitest";
import { allMilestonesComplete, isMilestoneWorkLocked, selectActiveMilestone } from "./milestone-gate-ui";

describe("isMilestoneWorkLocked", () => {
  it("locks only an explicitly locked gate", () => {
    expect(isMilestoneWorkLocked({ id: "m1", status: "upcoming" })).toBe(false);
    expect(isMilestoneWorkLocked({ id: "m2", status: "upcoming", gateStatus: "open" })).toBe(false);
    expect(isMilestoneWorkLocked({ id: "m3", status: "done", gateStatus: "approved" })).toBe(false);
    expect(isMilestoneWorkLocked({ id: "m4", status: "upcoming", gateStatus: "locked" })).toBe(true);
  });
});

describe("selectActiveMilestone", () => {
  it("uses the open gate even when the legacy stage status is stale", () => {
    expect(selectActiveMilestone([
      { id: "m1", status: "in-progress", gateStatus: "locked" },
      { id: "m2", status: "upcoming", gateStatus: "open" }
    ])?.id).toBe("m2");
  });

  it("falls back to the first milestone for legacy projects without gate metadata", () => {
    expect(selectActiveMilestone([
      { id: "m1", status: "in-progress" },
      { id: "m2", status: "upcoming" }
    ])?.id).toBe("m1");
  });

  it("keeps a pending review milestone active even when all of its stages are done", () => {
    expect(selectActiveMilestone([
      { id: "m1", status: "done", gateStatus: "pending_review" },
      { id: "m2", status: "upcoming", gateStatus: "locked" }
    ])?.id).toBe("m1");
  });

  it("does not reopen the first milestone after every gate is approved", () => {
    expect(selectActiveMilestone([
      { id: "m1", status: "done", gateStatus: "approved" },
      { id: "m2", status: "done", gateStatus: "approved" }
    ])).toBeUndefined();
  });

  it("treats a legacy plan with every milestone done as complete", () => {
    expect(selectActiveMilestone([
      { id: "m1", status: "done" },
      { id: "m2", status: "done" }
    ])).toBeUndefined();
  });

  it("ignores non-milestone buckets when selecting the active milestone", () => {
    expect(selectActiveMilestone([
      { id: "__unassigned_tasks__", status: "in-progress" },
      { id: "m1", status: "done", gateStatus: "approved" }
    ], (milestone) => milestone.id !== "__unassigned_tasks__")).toBeUndefined();
  });
});

describe("allMilestonesComplete", () => {
  it("does not let a synthetic unassigned bucket keep a project incomplete", () => {
    expect(allMilestonesComplete([
      { id: "__unassigned_tasks__", status: "in-progress" },
      { id: "m1", status: "done", gateStatus: "approved" }
    ], (milestone) => milestone.id !== "__unassigned_tasks__")).toBe(true);
  });
});
