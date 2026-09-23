import { describe, expect, it } from "vitest";

import { buildPlanningActualPresentation } from "./planning-actual-presentation";

describe("planning and actual canonical presentation", () => {
  it("lets a source-linked actual entry replace its planning block", () => {
    const records = buildPlanningActualPresentation(
      [{ id: "plan-1", status: "completed" }],
      [{ id: "actual-1", sourcePlanningBlockId: "plan-1", minutes: 60 }]
    );

    expect(records).toEqual([{
      kind: "actual",
      planningBlockId: "plan-1",
      record: { id: "actual-1", sourcePlanningBlockId: "plan-1", minutes: 60 }
    }]);
  });

  it("retains plans that have not materialized and standalone actual entries", () => {
    const records = buildPlanningActualPresentation(
      [{ id: "plan-1", status: "planned" }, { id: "plan-2", status: "completed" }],
      [{ id: "actual-1", minutes: 30 }]
    );

    expect(records.map(record => `${record.kind}:${record.record.id}`)).toEqual([
      "planned:plan-1",
      "planned:plan-2",
      "actual:actual-1"
    ]);
  });

  it("keeps actual work after its deleted source link becomes null", () => {
    const records = buildPlanningActualPresentation(
      [],
      [{ id: "actual-1", sourcePlanningBlockId: null, minutes: 90 }]
    );

    expect(records).toEqual([{
      kind: "actual",
      planningBlockId: undefined,
      record: { id: "actual-1", sourcePlanningBlockId: null, minutes: 90 }
    }]);
  });

  it("suppresses a stale planning record when a canonical linked actual is present", () => {
    const records = buildPlanningActualPresentation(
      [{ id: "stale-plan", status: "completed" }],
      [{ id: "actual-1", sourcePlanningBlockId: "stale-plan" }]
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe("actual");
  });
});
