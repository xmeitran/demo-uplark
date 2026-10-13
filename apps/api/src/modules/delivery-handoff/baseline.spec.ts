import { describe, expect, it } from "vitest";
import { baselineChangeBlocker, diffBaselines, estimateFindings } from "./baseline";
import { captureBaseline, getProjectBaseline, isBaselineLocked, recordBaselineChange, syncEstimateNotices } from "./baseline.service";
import { fakePrisma } from "./fake-prisma.testing";
import { gateHooks } from "./gates";

const actor = { userId: "pm", displayName: "PM" };
const scope = { workspaceId: "w", projectId: "p1" };

function project() {
  return fakePrisma({
    projectMilestone: [{ id: "m1", workspaceId: "w", projectId: "p1", name: "Milestone 1", sortOrder: 10 }],
    projectStage: [{ id: "s1", workspaceId: "w", projectId: "p1", milestoneId: "m1", activity: "Validate", sortOrder: 10, plannedStartAt: new Date("2026-10-01"), plannedEndAt: new Date("2026-10-10"), slaDays: 2, ownerUserId: "pm" }],
    projectTask: [
      { id: "t1", workspaceId: "w", projectId: "p1", stageId: "s1", parentTaskId: null, archivedAt: null, title: "Khảo sát", plannedStartAt: null, dueAt: new Date("2026-10-08"), estimateMinutes: 480, sortOrder: 10 },
      { id: "t1a", workspaceId: "w", projectId: "p1", stageId: "s1", parentTaskId: "t1", archivedAt: null, title: "Phỏng vấn", plannedStartAt: null, dueAt: null, estimateMinutes: 240, sortOrder: 10 }
    ]
  });
}

describe("plan baseline versions (v2 13/10: one baseline, plan only, locked at G1)", () => {
  it("G1 passing locks the baseline as version 1: milestones, stages and top-level tasks, no money", async () => {
    const { prisma, table } = project();
    expect(await isBaselineLocked(prisma, "p1")).toBe(false);
    await gateHooks.captureBaseline(Object.assign({ tx: prisma, actor }, { gate: { id: "g1", code: "G2", workspaceId: "w", projectId: "p1", status: "approved" }, project: {} }));
    expect(table("projectBaseline")).toEqual([]); // only G1 locks the baseline
    await gateHooks.captureBaseline(Object.assign({ tx: prisma, actor }, { gate: { id: "g1", code: "G1", workspaceId: "w", projectId: "p1", status: "approved" }, project: {} }));

    const baseline = await getProjectBaseline(prisma, "w", "p1", { isPm: true });
    expect(baseline.locked).toBe(true);
    expect(table("projectBaseline")).toHaveLength(1); // no second (commercial) layer is written
    expect(baseline.current).toMatchObject({ version: 1, causeType: "gate", causeCode: "G1", createdByName: "PM", totals: { tasks: 1, estimateMinutes: 480 } });
    expect(baseline.current?.snapshot.tasks?.map((task) => task.id)).toEqual(["t1"]); // sub-tasks are not baselined
    expect(baseline.current?.snapshot.stages?.[0]).toMatchObject({ id: "s1", plannedEndAt: "2026-10-10T00:00:00.000Z", slaDays: 2 });
    expect(JSON.stringify(baseline)).not.toMatch(/valueAmount|lineItems|B0/);
    expect(await isBaselineLocked(prisma, "p1")).toBe(true);
  });

  it("a change writes the next version with reason and cause, keeps the old one, and reports the diff; no change, no version", async () => {
    const { prisma, table } = project();
    await captureBaseline(prisma, { ...scope, cause: { type: "manual", reason: "Khóa baseline" }, actor });
    expect(await recordBaselineChange(prisma, { ...scope, cause: { type: "plan_edit", reason: "Không đổi gì" }, actor })).toBeUndefined();

    table("projectTask")[0].estimateMinutes = 960;
    table("projectTask")[0].title = "Khảo sát (đổi tên)"; // a rename alone is not a baseline change
    table("projectStage")[0].plannedEndAt = new Date("2026-10-15");
    expect(await recordBaselineChange(prisma, { ...scope, cause: { type: "stage_extension", id: "ext1", reason: "Gia hạn stage" }, actor })).toBe(2);

    const { history, current } = await getProjectBaseline(prisma, "w", "p1", { isPm: false });
    expect(history.map((version) => version.version)).toEqual([2, 1]);
    expect(current).toMatchObject({ version: 2, reason: "Gia hạn stage", causeType: "stage_extension", causeId: "ext1" });
    expect(current?.diff).toEqual([
      { entity: "stage", id: "s1", name: "Validate", change: "changed", fields: [{ field: "Ngày kết thúc", before: "2026-10-10T00:00:00.000Z", after: "2026-10-15T00:00:00.000Z" }] },
      { entity: "task", id: "t1", name: "Khảo sát (đổi tên)", change: "changed", fields: [{ field: "Giờ dự kiến (phút)", before: 480, after: 960 }] }
    ]);
    // The first version is untouched.
    expect((table("projectBaseline").find((row) => row.version === 1)?.snapshot as any).tasks[0].estimateMinutes).toBe(480);
  });

  it("rows of the retired commercial layer B0 stay stored and are never read", async () => {
    const { prisma, table } = project();
    table("projectBaseline").push({ id: "old-b0", workspaceId: "w", projectId: "p1", layer: "B0", version: 1, snapshot: { lineItems: [{ id: "i1", valueAmount: 100_000_000 }] }, reason: "cũ", causeType: "gate", createdAt: new Date("2026-09-01") });
    expect(await isBaselineLocked(prisma, "p1")).toBe(false);
    const baseline = await getProjectBaseline(prisma, "w", "p1", { isPm: true });
    expect(baseline).toMatchObject({ locked: false, current: null, history: [] });
    expect(table("projectBaseline")).toHaveLength(1);
  });

  it("a project without a baseline is not locked by a change and a version needs a reason", async () => {
    const { prisma, table } = project();
    expect(await recordBaselineChange(prisma, { ...scope, cause: { type: "plan_edit", reason: "Đổi trước G1" }, actor })).toBeUndefined();
    expect(table("projectBaseline")).toEqual([]);
    await expect(captureBaseline(prisma, { ...scope, cause: { type: "manual", reason: "  " }, actor })).rejects.toThrow(/lý do/);
  });

  it("diff lists added and removed rows", () => {
    const before = { tasks: [{ id: "t1", stageId: "s1", title: "A", plannedStartAt: null, dueAt: null, estimateMinutes: 60 }] };
    const after = { tasks: [{ ...before.tasks[0], estimateMinutes: 120 }, { id: "t2", stageId: "s1", title: "B", plannedStartAt: null, dueAt: null, estimateMinutes: 480 }] };
    expect(diffBaselines(before, after)).toEqual([
      { entity: "task", id: "t1", name: "A", change: "changed", fields: [{ field: "Giờ dự kiến (phút)", before: 60, after: 120 }] },
      { entity: "task", id: "t2", name: "B", change: "added" }
    ]);
    expect(diffBaselines(after, before).map((entry) => entry.change)).toEqual(["changed", "removed"]);
  });

  it("D-21: after the baseline is locked only an Admin (PM, Dx Director) changes timeline or estimate", () => {
    expect(baselineChangeBlocker({ locked: false, isApprover: false })).toBeNull();
    expect(baselineChangeBlocker({ locked: true, isApprover: true })).toBeNull();
    expect(baselineChangeBlocker({ locked: true, isApprover: false })).toMatch(/^Baseline đã khóa/);
  });
});

describe("D-19 estimate rules (Ghi nhận: record and remind, never block)", () => {
  const task = (id: string, estimateMinutes: number, parentTaskId: string | null = null) => ({ id, title: id, parentTaskId, estimateMinutes });

  it("flags a task whose sub-tasks together plan more than the task's own estimate; nothing else is compared", () => {
    expect(estimateFindings([task("a", 300), task("b", 99_999)])).toEqual([]);
    expect(estimateFindings([task("a", 300), task("a1", 200, "a"), task("a2", 160, "a")])).toEqual([
      { dedupeKey: "D-19:task:a", taskId: "a", title: "Tổng giờ dự kiến các sub-task vượt giờ của task", detail: 'Task "a": các sub-task dự kiến 6 giờ, task 5 giờ.' }
    ]);
    // A task without an estimate has nothing to compare its sub-tasks against.
    expect(estimateFindings([task("a", 0), task("a1", 200, "a")])).toEqual([]);
  });

  it("keeps one open notice for the PM and closes it when the plan fits again", async () => {
    const { prisma, table } = project();
    table("projectTask")[1].estimateMinutes = 600; // sub-task 10h under a task of 8h
    await syncEstimateNotices(prisma, "w", "p1", "u1");
    await syncEstimateNotices(prisma, "w", "p1", "u1");
    expect(table("projectWarning")).toHaveLength(1);
    expect(table("projectWarning")[0]).toMatchObject({ typeCode: "D-19", dedupeKey: "D-19:task:t1", ownerUserId: "pm", taskId: "t1", severity: "low" });
    table("projectTask")[1].estimateMinutes = 240;
    await syncEstimateNotices(prisma, "w", "p1", "u1");
    expect(table("projectWarning")[0].status).toBe("closed");
  });
});
