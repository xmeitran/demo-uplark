/** Review finding 2: applying a conversion must leave the running milestone usable (not "locked"), with history and baseline. */
import { describe, expect, it } from "vitest";
import { fakePrisma } from "./fake-prisma.testing";
import { milestoneKey, type FrameworkConversionPlan } from "./framework-conversion";
import { applyFrameworkConversion } from "./framework-conversion.service";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";

const scope = { workspaceId: "w", projectId: "p1" };
const now = new Date("2026-10-12T03:00:00.000Z");

function plan(operations: FrameworkConversionPlan["operations"]): FrameworkConversionPlan {
  return { projectId: "p1", projectCode: "P-1", projectName: "Dự án A", position: "milestone_2", positionLabel: "", handling: "", steps: [], notes: [], operations, totals: {} as any };
}

/** A project whose four TPL-001 milestones were just created the way `create_milestone` creates them: 1 open, 2–4 locked. */
function seed() {
  const stageOf = (key: string) => PILOT_PROJECT_MILESTONE_TEMPLATE.findIndex((milestone) => milestone.stages.some((stage) => stage.stageKey === key));
  return fakePrisma({
    project: [{ id: "p1", workspaceId: "w", accountId: "acc-1", name: "Dự án A", status: "Đang chạy" }],
    projectMilestone: PILOT_PROJECT_MILESTONE_TEMPLATE.map((milestone, index) => ({ id: `m${index + 1}`, ...scope, name: milestone.name, normalizedKey: milestoneKey(milestone.name), sortOrder: milestone.sortOrder, gateStatus: index === 0 ? "open" : "locked" })),
    projectStage: ["validate", "design", "build", "deployment_preparation", "pilot"].map((stageKey, index) => ({ id: `s-${stageKey}`, ...scope, stageKey, milestoneId: `m${stageOf(stageKey) + 1}`, sortOrder: (index + 1) * 10, activity: stageKey })),
    projectContractItem: [{ id: "i1", ...scope, code: "HM-01", name: "Gốc", kind: "ROOT", sortOrder: 10, valueAmount: 100, contractType: "FIXED_PRICE", createdAt: now }],
    projectTask: [{ id: "t1", ...scope, stageId: "s-pilot", title: "Chạy thử", estimateMinutes: 120, contractItemId: "i1" }]
  });
}

describe("applyFrameworkConversion (table 9.1)", () => {
  it("a project converted while Pilot is running: milestones 1–2 approved, milestone 3 open, milestone 4 locked — and G1 locks B0 / B1", async () => {
    const { prisma, table } = seed();
    await applyFrameworkConversion(prisma, plan([
      { type: "create_gate", stageKey: "validate", code: "G1", passed: true },
      { type: "create_gate", stageKey: "design", code: "G2", passed: true },
      { type: "create_gate", stageKey: "build", code: "G3", passed: true },
      { type: "create_gate", stageKey: "deployment_preparation", code: "G4", passed: true },
      { type: "create_gate", stageKey: "pilot", code: "G5", passed: false }
    ]), { workspaceId: "w", actor: { userId: "usr-pm", displayName: "PM" }, now });

    expect(table("projectGate").map((gate) => `${gate.code}:${gate.status ?? "not_submitted"}`)).toEqual(["G1:approved", "G2:approved", "G3:approved", "G4:approved", "G5:not_submitted"]);
    // Before the fix milestones 2–4 stayed "locked": every time log and new task in the running milestone answered 409.
    expect(table("projectMilestone").map((milestone) => milestone.gateStatus)).toEqual(["approved", "approved", "open", "locked"]);
    expect(table("projectMilestone")[0]).toMatchObject({ reviewerApprovedAt: now, reviewerApprovedByUserId: "usr-pm" });
    expect(table("projectBaseline").map((row) => `${row.layer}v${row.version}:${row.causeType}:${row.causeCode}`)).toEqual(["B0v1:gate:G1", "B1v1:gate:G1"]);
    expect(table("projectBaseline")[0]).toMatchObject({ causeId: table("projectGate")[0].id, createdByUserId: "usr-pm" });
  });

  it("before G1 nothing is unlocked and no baseline is written; a milestone approved the old way is never downgraded", async () => {
    const { prisma, table } = seed();
    table("projectMilestone")[1].gateStatus = "approved";
    await applyFrameworkConversion(prisma, plan([{ type: "create_gate", stageKey: "validate", code: "G1", passed: false }]), { workspaceId: "w", now });
    expect(table("projectMilestone").map((milestone) => milestone.gateStatus)).toEqual(["open", "approved", "open", "locked"]);
    expect(table("projectBaseline")).toEqual([]);
  });

  it("a status code change leaves a status-history row", async () => {
    const { prisma, table } = seed();
    await applyFrameworkConversion(prisma, plan([{ type: "set_project_status", from: "Đang chạy", to: "active" }]), { workspaceId: "w", actor: { userId: "usr-pm" }, now });
    expect(table("project")[0].status).toBe("active");
    expect(table("projectStatusHistory")).toMatchObject([{ workspaceId: "w", projectId: "p1", fromStatus: "Đang chạy", toStatus: "active", changedByUserId: "usr-pm" }]);
    expect(table("projectStatusHistory")[0].reason).toContain("Chuyển đổi khung");
  });
});
