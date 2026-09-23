export type PlanningActualPresentation<Planning, Actual> =
  | {
      kind: "planned";
      planningBlockId: string;
      record: Planning;
    }
  | {
      kind: "actual";
      planningBlockId?: string;
      record: Actual;
    };

type PlanningRecord = { id: string };
type ActualRecord = { id: string; sourcePlanningBlockId?: string | null };

/**
 * Builds the canonical presentation shared by Calendar and Task Detail.
 * The backend retains both records; when an actual entry points at its source
 * planning block, the actual representation is the only one shown.
 */
export function buildPlanningActualPresentation<
  Planning extends PlanningRecord,
  Actual extends ActualRecord
>(
  planningBlocks: readonly Planning[],
  actualEntries: readonly Actual[]
): Array<PlanningActualPresentation<Planning, Actual>> {
  const materializedPlanningIds = new Set(
    actualEntries
      .map(entry => entry.sourcePlanningBlockId?.trim())
      .filter((id): id is string => Boolean(id))
  );

  return [
    ...planningBlocks
      .filter(block => !materializedPlanningIds.has(block.id))
      .map(record => ({
        kind: "planned" as const,
        planningBlockId: record.id,
        record
      })),
    ...actualEntries.map(record => ({
      kind: "actual" as const,
      planningBlockId: record.sourcePlanningBlockId?.trim() || undefined,
      record
    }))
  ];
}
