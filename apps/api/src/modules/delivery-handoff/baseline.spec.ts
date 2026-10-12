import { describe, expect, it } from "vitest";
import { baselineChangeBlocker, diffBaselines, estimateFindings } from "./baseline";
import { captureBaseline, getProjectBaseline, isBaselineLocked, recordBaselineChange, syncEstimateNotices } from "./baseline.service";
import { fakePrisma } from "./fake-prisma.testing";
import { gateHooks } from "./gates";

const actor = { userId: "pm", displayName: "PM" };
const scope = { workspaceId: "w", projectId: "p1" };

function project() {
  return fakePrisma({
    projectContractItem: [{ id: "i1", workspaceId: "w", projectId: "p1", code: "HM-01", name: "HĐ gốc", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 100_000_000, currency: "VND", estimateMinutes: 4800, status: "active", sortOrder: 10 }],
    projectMilestone: [{ id: "m1", workspaceId: "w", projectId: "p1", name: "Milestone 1", sortOrder: 10 }],
    projectStage: [{ id: "s1", workspaceId: "w", projectId: "p1", milestoneId: "m1", activity: "Validate", sortOrder: 10, plannedStartAt: new Date("2026-10-01"), plannedEndAt: new Date("2026-10-10"), slaDays: 2, ownerUserId: "pm" }],
    projectTask: [
      { id: "t1", workspaceId: "w", projectId: "p1", stageId: "s1", parentTaskId: null, archivedAt: null, title: "Khảo sát", plannedStartAt: null, dueAt: new Date("2026-10-08"), estimateMinutes: 480, contractItemId: "i1", sortOrder: 10 },
      { id: "t1a", workspaceId: "w", projectId: "p1", stageId: "s1", parentTaskId: "t1", archivedAt: null, title: "Phỏng vấn", plannedStartAt: null, dueAt: null, estimateMinutes: 240, contractItemId: "i1", sortOrder: 10 }
    ]
  });
}

describe("baseline versions (D-20, D-21)", () => {
  it("G1 passing locks B0 and B1 as version 1; B0 holds line items, B1 milestones, stages and top-level tasks", async () => {
    const { prisma, table } = project();
    expect(await isBaselineLocked(prisma, "p1")).toBe(false);
    await gateHooks.captureBaseline(Object.assign({ tx: prisma, actor }, { gate: { id: "g1", code: "G2", workspaceId: "w", projectId: "p1", status: "approved" }, project: {} }));
    expect(table("projectBaseline")).toEqual([]); // only G1 locks the baseline
    await gateHooks.captureBaseline(Object.assign({ tx: prisma, actor }, { gate: { id: "g1", code: "G1", workspaceId: "w", projectId: "p1", status: "approved" }, project: {} }));

    const baseline = await getProjectBaseline(prisma, "w", "p1", { isPm: true });
    expect(baseline.locked).toBe(true);
    expect(baseline.current.B0).toMatchObject({ version: 1, causeType: "gate", causeCode: "G1", createdByName: "PM", totals: { lineItems: 1, valueAmount: 100_000_000, estimateMinutes: 4800 } });
    expect(baseline.current.B0?.snapshot.lineItems).toEqual([{ id: "i1", code: "HM-01", name: "HĐ gốc", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 100_000_000, currency: "VND", estimateMinutes: 4800 }]);
    expect(baseline.current.B1?.snapshot.tasks?.map((task) => task.id)).toEqual(["t1"]); // sub-tasks are not baselined
    expect(baseline.current.B1?.snapshot.stages?.[0]).toMatchObject({ id: "s1", plannedEndAt: "2026-10-10T00:00:00.000Z", slaDays: 2 });
    expect(await isBaselineLocked(prisma, "p1")).toBe(true);
  });

  it("a change writes the next version with reason and cause, keeps the old one, and reports the diff; no change, no version", async () => {
    const { prisma, table } = project();
    await captureBaseline(prisma, { ...scope, cause: { type: "manual", reason: "Khóa baseline" }, actor });
    expect(await recordBaselineChange(prisma, { ...scope, cause: { type: "plan_edit", reason: "Không đổi gì" }, actor })).toEqual({});

    table("projectTask")[0].estimateMinutes = 960;
    table("projectTask")[0].title = "Khảo sát (đổi tên)"; // a rename alone is not a baseline change
    table("projectStage")[0].plannedEndAt = new Date("2026-10-15");
    expect(await recordBaselineChange(prisma, { ...scope, cause: { type: "change_request", id: "cr1", code: "CR-001", reason: "CR-001 được khách duyệt" }, actor })).toEqual({ B1: 2 });

    const { history, current } = await getProjectBaseline(prisma, "w", "p1", { isPm: false });
    expect(history.map((version) => `${version.layer} v${version.version}`).sort()).toEqual(["B0 v1", "B1 v1", "B1 v2"]);
    expect(current.B1).toMatchObject({ version: 2, reason: "CR-001 được khách duyệt", causeType: "change_request", causeId: "cr1", causeCode: "CR-001" });
    expect(current.B1?.diff).toEqual([
      { entity: "stage", id: "s1", name: "Validate", change: "changed", fields: [{ field: "Ngày kết thúc", before: "2026-10-10T00:00:00.000Z", after: "2026-10-15T00:00:00.000Z" }] },
      { entity: "task", id: "t1", name: "Khảo sát (đổi tên)", change: "changed", fields: [{ field: "Giờ dự kiến (phút)", before: 480, after: 960 }] }
    ]);
    // The first version is untouched.
    expect((table("projectBaseline").find((row) => row.layer === "B1" && row.version === 1)?.snapshot as any).tasks[0].estimateMinutes).toBe(480);
  });

  it("a project without a baseline is not locked by a change (recordBaselineChange starts no layer) and a version needs a reason", async () => {
    const { prisma, table } = project();
    expect(await recordBaselineChange(prisma, { ...scope, cause: { type: "change_request", reason: "CR trước G1" }, actor })).toEqual({});
    expect(table("projectBaseline")).toEqual([]);
    await expect(captureBaseline(prisma, { ...scope, cause: { type: "manual", reason: "  " }, actor })).rejects.toThrow(/lý do/);
  });

  it("diff lists added and removed rows", () => {
    const before = { lineItems: [{ id: "i1", code: "HM-01", name: "HĐ gốc", kind: "ROOT", contractType: null, valueAmount: 10, currency: "VND", estimateMinutes: 60 }] };
    const after = { lineItems: [{ ...before.lineItems[0], valueAmount: 20 }, { id: "i2", code: "CR-001", name: "CR", kind: "CHANGE_REQUEST", contractType: null, valueAmount: null, currency: "VND", estimateMinutes: 480 }] };
    expect(diffBaselines(before, after)).toEqual([
      { entity: "lineItem", id: "i1", name: "HĐ gốc", change: "changed", fields: [{ field: "Giá trị", before: 10, after: 20 }] },
      { entity: "lineItem", id: "i2", name: "CR", change: "added" }
    ]);
    expect(diffBaselines(after, before).map((entry) => entry.change)).toEqual(["changed", "removed"]);
  });

  it("D-21: after B1 is locked only an Admin (PM, Dx Director) changes timeline or estimate", () => {
    expect(baselineChangeBlocker({ b1Locked: false, isApprover: false })).toBeNull();
    expect(baselineChangeBlocker({ b1Locked: true, isApprover: true })).toBeNull();
    expect(baselineChangeBlocker({ b1Locked: true, isApprover: false })).toMatch(/D-21/);
  });
});

describe("D-19 estimate rules (Ghi nhận: record and remind, never block)", () => {
  const items = [{ id: "i1", code: "HM-01", name: "HĐ gốc", estimateMinutes: 600 }, { id: "i2", code: "HM-02", name: "Chưa có estimate", estimateMinutes: null }];
  const task = (id: string, estimateMinutes: number, parentTaskId: string | null = null, contractItemId = "i1") => ({ id, title: id, parentTaskId, contractItemId, estimateMinutes });

  it("flags tasks that plan more than the line item's estimate gốc, and sub-tasks that plan more than their task", () => {
    expect(estimateFindings(items, [task("a", 300), task("b", 300)])).toEqual([]);
    expect(estimateFindings(items, [task("a", 300), task("b", 360), task("c", 9999, null, "i2")]).map((finding) => finding.dedupeKey)).toEqual(["D-19:item:i1"]);
    expect(estimateFindings(items, [task("a", 300), task("a1", 200, "a"), task("a2", 160, "a")])).toEqual([
      { dedupeKey: "D-19:task:a", taskId: "a", title: "Tổng giờ dự kiến các sub-task vượt giờ của task", detail: 'Task "a": các sub-task dự kiến 6 giờ, task 5 giờ.' }
    ]);
    // A task without an estimate has nothing to compare its sub-tasks against.
    expect(estimateFindings(items, [task("a", 0), task("a1", 200, "a")])).toEqual([]);
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
