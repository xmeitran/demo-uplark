import { describe, expect, it, vi } from "vitest";
import {
  alignItemsToOrder,
  buildHierarchyOrderInput,
  createHierarchyOrderCoordinator,
  isHierarchyOrderResponse,
  isSortableTopLevelTask,
  reorderSiblingIds
} from "./hierarchy-order";
import { putProjectHierarchyOrder } from "./hierarchy-order-client";

describe("project hierarchy ordering", () => {
  it("reorders only known siblings and leaves missing/cross-parent ids unchanged", () => {
    expect(reorderSiblingIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorderSiblingIds(["a", "b"], "foreign", "b")).toEqual(["a", "b"]);
    expect(reorderSiblingIds(["a", "b"], "a", null)).toEqual(["a", "b"]);
  });

  it("aligns items only for an exact complete permutation", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(alignItemsToOrder(items, ["b", "a"], (item) => item.id)).toEqual([{ id: "b" }, { id: "a" }]);
    expect(alignItemsToOrder(items, ["a", "a"], (item) => item.id)).toBeNull();
    expect(alignItemsToOrder(items, ["a"], (item) => item.id)).toBeNull();
    expect(alignItemsToOrder(items, ["a", "foreign"], (item) => item.id)).toBeNull();
  });

  it("excludes subtasks and archived tasks from board permutations", () => {
    expect(isSortableTopLevelTask({})).toBe(true);
    expect(isSortableTopLevelTask({ parentTaskId: "parent-1" })).toBe(false);
    expect(isSortableTopLevelTask({ archivedAt: "2026-07-31T00:00:00.000Z" })).toBe(false);
  });

  it("never lets a late failure roll back a newer confirmed order", () => {
    const coordinator = createHierarchyOrderCoordinator(["a", "b"]);
    const first = coordinator.begin(["b", "a"]);
    const second = coordinator.begin(["a", "b"]);

    expect(coordinator.confirm(second, ["a", "b"])).toEqual(["a", "b"]);
    expect(coordinator.reject(first)).toBeNull();
  });

  it("rolls back the latest optimistic request to its confirmed snapshot", () => {
    const coordinator = createHierarchyOrderCoordinator(["a", "b"]);
    const request = coordinator.begin(["b", "a"]);
    expect(coordinator.reject(request)).toEqual(["a", "b"]);
  });

  it("builds and validates the public reorder contract", () => {
    const request = buildHierarchyOrderInput({
      kind: "stage",
      parentId: "milestone-1",
      orderedIds: ["stage-2", "stage-1"],
      expectedVersion: 7
    });
    expect(request).toEqual({
      kind: "stage",
      parentId: "milestone-1",
      orderedIds: ["stage-2", "stage-1"],
      expectedVersion: 7
    });
    expect(isHierarchyOrderResponse({
      kind: "stage",
      parentId: "milestone-1",
      orderedIds: ["stage-2", "stage-1"],
      hierarchyOrderVersion: 8
    })).toBe(true);
  });

  it("parses canonical success and structured conflict payloads", async () => {
    const successFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      kind: "task",
      parentId: "stage-1",
      orderedIds: ["task-2", "task-1"],
      hierarchyOrderVersion: 4
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(putProjectHierarchyOrder("project-1", {
      kind: "task",
      parentId: "stage-1",
      orderedIds: ["task-2", "task-1"],
      expectedVersion: 3
    }, successFetcher)).resolves.toMatchObject({ ok: true });

    const conflictFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: "Hierarchy order changed",
      current: {
        kind: "task",
        parentId: "stage-1",
        orderedIds: ["task-1", "task-2"],
        hierarchyOrderVersion: 4
      }
    }), { status: 409, headers: { "content-type": "application/json" } }));
    await expect(putProjectHierarchyOrder("project-1", {
      kind: "task",
      parentId: "stage-1",
      orderedIds: ["task-2", "task-1"],
      expectedVersion: 3
    }, conflictFetcher)).resolves.toMatchObject({
      ok: false,
      status: 409,
      canonical: { hierarchyOrderVersion: 4 }
    });
  });
});
