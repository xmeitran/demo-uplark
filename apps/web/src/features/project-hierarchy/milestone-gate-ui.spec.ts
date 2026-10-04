import { describe, expect, it } from "vitest";
import { selectActiveMilestone } from "./milestone-gate-ui";

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
});
