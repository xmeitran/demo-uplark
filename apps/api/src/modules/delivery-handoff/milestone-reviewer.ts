import type { ProjectMilestoneReviewerMode } from "@b2b-crm/contracts";

export const DEFAULT_MILESTONE_REVIEWER_MODE: ProjectMilestoneReviewerMode = "workspace_admin";
export const MILESTONE_REVIEWER_MODES = new Set<ProjectMilestoneReviewerMode>(["workspace_admin", "specific_user"]);
export const WORKSPACE_ADMIN_ROLE_CODES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);

export function normalizeMilestoneReviewerMode(value: unknown): ProjectMilestoneReviewerMode {
  return MILESTONE_REVIEWER_MODES.has(value as ProjectMilestoneReviewerMode)
    ? value as ProjectMilestoneReviewerMode
    : DEFAULT_MILESTONE_REVIEWER_MODE;
}

export function isWorkspaceAdmin(roleCodes: readonly string[] = []) {
  return roleCodes.some((roleCode) => WORKSPACE_ADMIN_ROLE_CODES.has(roleCode));
}

export function canApproveMilestoneReviewer(input: {
  reviewerMode: ProjectMilestoneReviewerMode;
  reviewerUserId?: string | null;
  principalUserId: string;
  principalRoleCodes: readonly string[];
}) {
  if (input.reviewerMode === "workspace_admin") return isWorkspaceAdmin(input.principalRoleCodes);
  return Boolean(input.reviewerUserId) && input.reviewerUserId === input.principalUserId;
}
