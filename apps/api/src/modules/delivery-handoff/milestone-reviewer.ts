import { ADMIN_ROLE_CODES, type ProjectMilestoneReviewerMode } from "@b2b-crm/contracts";

export const DEFAULT_MILESTONE_REVIEWER_MODE: ProjectMilestoneReviewerMode = "workspace_admin";
export const MILESTONE_REVIEWER_MODES = new Set<ProjectMilestoneReviewerMode>(["workspace_admin", "specific_user"]);
/** Every role code whose holder is an Admin account (ROLE_CATALOGUE): Founder/GM, Workspace Admin, PM, Dx Director, BD Lead. */
export const WORKSPACE_ADMIN_ROLE_CODES = new Set(ADMIN_ROLE_CODES);

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
  // The sender may approve their own dossier (chốt 23/10): the designated reviewer, or any admin when none is designated.
  if (input.reviewerMode === "workspace_admin") return isWorkspaceAdmin(input.principalRoleCodes);
  return Boolean(input.reviewerUserId) && input.reviewerUserId === input.principalUserId;
}
