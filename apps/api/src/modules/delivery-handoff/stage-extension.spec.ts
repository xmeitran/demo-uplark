import { describe, expect, it } from "vitest";
import { captureBaseline } from "./baseline.service";
import { fakePrisma } from "./fake-prisma.testing";
import { extendStage, stageExtensionState } from "./stage-extension";

function seed() {
  const fake = fakePrisma({
    projectStage: [{ id: "s1", workspaceId: "w", projectId: "p1", milestoneId: "m1", activity: "Build", sortOrder: 10, plannedStartAt: null, plannedEndAt: new Date("2026-10-16"), slaDays: 5, ownerUserId: "pm" }],
    projectRisk: [{ id: "cr1", workspaceId: "w", projectId: "p1", type: "change_request", code: "CR-001" }]
  });
  const ctx = (isPm = true) => ({ prisma: fake.prisma, principal: { workspaceId: "w", subjectId: "pm", displayName: "PM" }, actor: { isPm }, now: new Date("2026-10-14T03:00:00.000Z") });
  return { ...fake, ctx };
}

describe("stage extensions (TD-05, D-21, V-40)", () => {
  it("only an Admin (PM, Dx Director) extends, with a reason and a later date; before/after and approver are kept", async () => {
    const { ctx, table } = seed();
    await expect(extendStage(ctx(false), "p1", "s1", { newDueAt: "2026-10-20", reason: "Khách đổi lịch" })).rejects.toThrow(/Chỉ Admin/);
    await expect(extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: " " })).rejects.toThrow(/lý do/);
    await expect(extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-15", reason: "Sớm hơn" })).rejects.toThrow(/sau hạn hiện tại/);
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: "Khách đổi lịch" });
    // A bare day is due through the END of that day in Vietnam, not at UTC midnight (07:00 local).
    const endOf20th = new Date("2026-10-20T23:59:59.999+07:00");
    expect(table("projectStageExtension")[0]).toMatchObject({ stageId: "s1", previousDueAt: new Date("2026-10-16"), newDueAt: endOf20th, reason: "Khách đổi lịch", approvedByUserId: "pm", approvedByName: "PM", changeRequestId: null });
    expect(table("projectStage")[0].plannedEndAt).toEqual(endOf20th);
    expect(table("projectWarning")).toEqual([]); // the first extension is not abnormal
  });

  it("the second counted extension opens TD-05; one tied to a change request is stored but not counted; each writes a B1 version", async () => {
    const { ctx, table, prisma } = seed();
    await captureBaseline(prisma, { workspaceId: "w", projectId: "p1", layers: ["B1"], cause: { type: "manual", reason: "Khóa" }, actor: { userId: "pm" } });
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: "Lần 1" });
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-22", reason: "Do CR-001", changeRequestId: "cr1" });
    expect(table("projectWarning")).toEqual([]);
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-24", reason: "Lần 2" });
    expect(table("projectWarning")).toHaveLength(1);
    expect(table("projectWarning")[0]).toMatchObject({ typeCode: "TD-05", dedupeKey: "TD-05:stage:s1", stageId: "s1" });
    // One record per stage: a third extension refreshes the open warning instead of opening a second one.
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-26", reason: "Lần 3" });
    expect(table("projectWarning")).toHaveLength(1);
    expect(table("projectWarning")[0].detail).toContain("3 lần");
    // V-38: with the trigger switched off the event opens nothing.
    const off = seed();
    off.table("systemParameter").push({ workspaceId: "w", key: "alertTriggerOverrides", value: { "TD-05": { enabled: false } }, createdAt: new Date() });
    await extendStage(off.ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: "Lần 1" });
    await extendStage(off.ctx(), "p1", "s1", { newDueAt: "2026-10-22", reason: "Lần 2" });
    expect(off.table("projectWarning")).toEqual([]);
    expect(table("projectBaseline").map((row) => [row.version, row.causeType, row.causeCode ?? null])).toEqual([[1, "manual", null], [2, "stage_extension", null], [3, "change_request", "CR-001"], [4, "stage_extension", null], [5, "stage_extension", null]]);

    expect(stageExtensionState([], 2).extensionAbnormal).toBe(false);
    const state = stageExtensionState(table("projectStageExtension") as any, 2, new Map([["cr1", "CR-001"]]));
    expect(state).toMatchObject({ extensionCount: 3, extensionAbnormal: true, extendedDueAt: "2026-10-26T16:59:59.999Z" });
    expect(state.extensions.map((item) => [item.reason, item.counted, item.changeRequestCode])).toEqual([["Lần 1", true, undefined], ["Do CR-001", false, "CR-001"], ["Lần 2", true, undefined], ["Lần 3", true, undefined]]);
  });
});
