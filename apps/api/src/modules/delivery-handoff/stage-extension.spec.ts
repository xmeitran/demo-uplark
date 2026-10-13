import { describe, expect, it } from "vitest";
import { captureBaseline } from "./baseline.service";
import { fakePrisma } from "./fake-prisma.testing";
import { extendStage, stageExtensionState } from "./stage-extension";

function seed() {
  const fake = fakePrisma({
    projectStage: [{ id: "s1", workspaceId: "w", projectId: "p1", milestoneId: "m1", activity: "Build", sortOrder: 10, plannedStartAt: null, plannedEndAt: new Date("2026-10-16"), slaDays: 5, ownerUserId: "pm" }]
  });
  const ctx = (isPm = true) => ({ prisma: fake.prisma, principal: { workspaceId: "w", subjectId: "pm", displayName: "PM" }, actor: { isPm }, now: new Date("2026-10-14T03:00:00.000Z") });
  return { ...fake, ctx };
}

describe("stage extensions (TD-05, D-21)", () => {
  it("only an Admin (PM, Dx Director) extends, with a reason and a later date; before/after and approver are kept", async () => {
    const { ctx, table } = seed();
    await expect(extendStage(ctx(false), "p1", "s1", { newDueAt: "2026-10-20", reason: "Khách đổi lịch" })).rejects.toThrow(/Chỉ Admin/);
    await expect(extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: " " })).rejects.toThrow(/lý do/);
    await expect(extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-15", reason: "Sớm hơn" })).rejects.toThrow(/sau hạn hiện tại/);
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: "Khách đổi lịch" });
    // A bare day is due through the END of that day in Vietnam, not at UTC midnight (07:00 local).
    const endOf20th = new Date("2026-10-20T23:59:59.999+07:00");
    expect(table("projectStageExtension")[0]).toMatchObject({ stageId: "s1", previousDueAt: new Date("2026-10-16"), newDueAt: endOf20th, reason: "Khách đổi lịch", approvedByUserId: "pm", approvedByName: "PM" });
    expect(table("projectStage")[0].plannedEndAt).toEqual(endOf20th);
    expect(table("projectWarning")).toEqual([]); // the first extension is not abnormal
  });

  it("every extension counts: the second one opens TD-05, whatever its reason; each writes a baseline version", async () => {
    const { ctx, table, prisma } = seed();
    await captureBaseline(prisma, { workspaceId: "w", projectId: "p1", cause: { type: "manual", reason: "Khóa" }, actor: { userId: "pm" } });
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-20", reason: "Lần 1" });
    expect(table("projectWarning")).toEqual([]);
    // A change-request link sent by an old client is ignored: the extension counts like any other.
    await extendStage(ctx(), "p1", "s1", { newDueAt: "2026-10-22", reason: "Khách thêm yêu cầu", changeRequestId: "cr1" } as any);
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
    expect(table("projectBaseline").map((row) => [row.version, row.causeType])).toEqual([[1, "manual"], [2, "stage_extension"], [3, "stage_extension"], [4, "stage_extension"]]);

    expect(stageExtensionState([], 2).extensionAbnormal).toBe(false);
    // A stored row of the old flow (changeRequestId set) counts too.
    const state = stageExtensionState([...table("projectStageExtension"), { id: "old", stageId: "s1", previousDueAt: new Date("2026-10-26"), newDueAt: new Date("2026-10-28T16:59:59.999Z"), reason: "Do CR-001", changeRequestId: "cr1", approvedByName: null, approvedAt: new Date("2026-10-15") }] as any, 2);
    expect(state).toMatchObject({ extensionCount: 4, extensionAbnormal: true, extendedDueAt: "2026-10-28T16:59:59.999Z" });
    expect(state.extensions.map((item) => item.reason)).toEqual(["Lần 1", "Khách thêm yêu cầu", "Lần 3", "Do CR-001"]);
  });
});
