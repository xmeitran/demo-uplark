export type MilestoneGateSelection = {
  id: string;
  status?: string;
  gateStatus?: string;
};

export function selectActiveMilestone<T extends MilestoneGateSelection>(milestones: readonly T[]): T | undefined {
  return milestones.find((milestone) => ["open", "pending_review", "rejected", "conditional"].includes(milestone.gateStatus ?? ""))
    ?? milestones.find((milestone) => milestone.status === "in-progress" && milestone.gateStatus !== "locked" && milestone.gateStatus !== "approved")
    ?? milestones[0];
}
