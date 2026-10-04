export type MilestoneGateSelection = {
  id: string;
  status?: string;
  gateStatus?: string;
};

export function selectActiveMilestone<T extends MilestoneGateSelection>(milestones: readonly T[]): T | undefined {
  return milestones.find((milestone) => milestone.gateStatus === "open")
    ?? milestones.find((milestone) => milestone.status === "in-progress" && milestone.gateStatus !== "locked" && milestone.gateStatus !== "approved")
    ?? milestones[0];
}
