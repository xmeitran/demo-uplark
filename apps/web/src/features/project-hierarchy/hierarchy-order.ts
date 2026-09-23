import type {
  ProjectHierarchyOrderInput,
  ProjectHierarchyOrderKind,
  ProjectHierarchyOrderResponse
} from "@b2b-crm/contracts";

export type HierarchyOrderSnapshot<T> = {
  requestId: number;
  previous: T;
  optimistic: T;
};

export type HierarchyOrderCoordinator<T> = {
  begin: (optimistic: T) => HierarchyOrderSnapshot<T>;
  confirm: (snapshot: HierarchyOrderSnapshot<T>, canonical: T) => T | null;
  reject: (snapshot: HierarchyOrderSnapshot<T>) => T | null;
  replaceConfirmed: (canonical: T) => void;
};

export function createHierarchyOrderCoordinator<T>(initial: T): HierarchyOrderCoordinator<T> {
  let latestRequestId = 0;
  let confirmed = initial;

  return {
    begin(optimistic) {
      latestRequestId += 1;
      return {
        requestId: latestRequestId,
        previous: confirmed,
        optimistic
      };
    },
    confirm(snapshot, canonical) {
      if (snapshot.requestId !== latestRequestId) return null;
      confirmed = canonical;
      return canonical;
    },
    reject(snapshot) {
      if (snapshot.requestId !== latestRequestId) return null;
      confirmed = snapshot.previous;
      return snapshot.previous;
    },
    replaceConfirmed(canonical) {
      latestRequestId += 1;
      confirmed = canonical;
    }
  };
}

export function reorderSiblingIds(ids: readonly string[], activeId: string, overId: string | null) {
  if (!overId || activeId === overId) return [...ids];
  const fromIndex = ids.indexOf(activeId);
  const toIndex = ids.indexOf(overId);
  if (fromIndex < 0 || toIndex < 0) return [...ids];

  const reordered = [...ids];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

export function isSortableTopLevelTask(task: { parentTaskId?: string; archivedAt?: string }) {
  return !task.parentTaskId && !task.archivedAt;
}

export function alignItemsToOrder<T>(
  items: readonly T[],
  orderedIds: readonly string[],
  getId: (item: T) => string
): T[] | null {
  if (items.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) {
    return null;
  }

  const byId = new Map(items.map((item) => [getId(item), item]));
  const aligned = orderedIds.map((id) => byId.get(id));
  return aligned.every((item): item is T => item !== undefined) ? aligned : null;
}

export function buildHierarchyOrderInput(input: {
  kind: ProjectHierarchyOrderKind;
  parentId: string | null;
  orderedIds: readonly string[];
  expectedVersion: number;
}): ProjectHierarchyOrderInput {
  return {
    kind: input.kind,
    parentId: input.parentId,
    orderedIds: [...input.orderedIds],
    expectedVersion: input.expectedVersion
  };
}

export function isHierarchyOrderResponse(value: unknown): value is ProjectHierarchyOrderResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectHierarchyOrderResponse>;
  return (candidate.kind === "milestone" || candidate.kind === "stage" || candidate.kind === "task")
    && (candidate.parentId === null || typeof candidate.parentId === "string")
    && Array.isArray(candidate.orderedIds)
    && candidate.orderedIds.every((id) => typeof id === "string")
    && Number.isInteger(candidate.hierarchyOrderVersion)
    && Number(candidate.hierarchyOrderVersion) >= 0;
}
