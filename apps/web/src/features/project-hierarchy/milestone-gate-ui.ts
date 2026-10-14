export type MilestoneGateSelection = {
  id: string;
  status?: string;
  gateStatus?: string;
};

/**
 * A milestone's work-entry lock comes from the gate, not from its derived
 * delivery status. A legacy `upcoming` status can still be an editable
 * planning bucket when no gate has explicitly locked it.
 */
export function isMilestoneWorkLocked(milestone: MilestoneGateSelection): boolean {
  return milestone.gateStatus === "locked";
}

export function selectActiveMilestone<T extends MilestoneGateSelection>(milestones: readonly T[]): T | undefined {
  const actionable = milestones.find((milestone) => ["open", "pending_review", "rejected", "conditional"].includes(milestone.gateStatus ?? ""));
  if (actionable) return actionable;

  // Legacy projects may not have gate metadata yet. Keep the old status-based
  // fallback for those records, but never fall back to an already approved or
  // locked milestone when gate metadata is present.
  const legacyActive = milestones.find((milestone) => milestone.status === "in-progress" && !milestone.gateStatus);
  if (legacyActive) return legacyActive;

  if (milestones.length > 0 && milestones.every((milestone) => !milestone.gateStatus && milestone.status === "done")) {
    return undefined;
  }

  if (milestones.length > 0 && milestones.every((milestone) => !milestone.gateStatus)) {
    return milestones[0];
  }

  // No actionable milestone remains. This is the completed state when every
  // configured gate is approved, and the blocked state when all gates are
  // locked; both must not masquerade as the first milestone being active.
  return undefined;
}
