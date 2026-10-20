const ROLE_DISPLAY_PRIORITY = [
  "FOUNDER_GM",
  "WORKSPACE_ADMIN",
  "WORKSPACE_USER",
  "FINANCE_ADMIN",
  "DELIVERY_LEAD",
  "SALES_OWNER"
] as const;

export function primaryAuthRole(roleCodes?: string[]) {
  if (!roleCodes?.length) return "Member";
  return ROLE_DISPLAY_PRIORITY.find((roleCode) => roleCodes.includes(roleCode)) ?? roleCodes[0];
}

/**
 * 7.7: the one check for "show admin screens and controls" — an Admin account that is working in admin view.
 * An Admin in user view gets what a User gets. The view switch itself keys on the account, not on this.
 */
export function isAdminView(user: { role: string; roleCodes?: string[]; accountType?: "ADMIN" | "USER"; viewMode?: "admin" | "user" } | null | undefined) {
  if (!user || user.viewMode === "user") return false;
  return user.accountType === "ADMIN" || hasAnyAuthRole(user, ["FOUNDER_GM", "WORKSPACE_ADMIN"]);
}

export function hasAnyAuthRole(
  user: { role: string; roleCodes?: string[] } | null | undefined,
  allowedRoleCodes: readonly string[]
) {
  if (!user) return false;
  const roleCodes = user.roleCodes?.length ? user.roleCodes : [user.role];
  return roleCodes.some((roleCode) => allowedRoleCodes.includes(roleCode));
}

/** Mirrors the API's `canViewCost` (rules 7.7): money figures are for the cost permission group and Founder/GM. */
const COST_VIEW_ROLE_CODES = ["FOUNDER_GM", "COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"] as const;
export function canViewCostFigures(user: { role: string; roleCodes?: string[] } | null | undefined) {
  return hasAnyAuthRole(user, COST_VIEW_ROLE_CODES);
}

/** Mirrors the API's canEditProjectSetup: "Giá trị dự án" is edited by a bound PM, Founder/GM or Workspace Admin. */
const PROJECT_SETUP_EDIT_ROLES = new Set(["PM", "FOUNDER_GM", "WORKSPACE_ADMIN"]);
export function canEditProjectSetup(user: { roleCodes?: string[]; heldRoleCodes?: string[] } | null | undefined) {
  return (user?.heldRoleCodes ?? user?.roleCodes ?? []).some((role) => PROJECT_SETUP_EDIT_ROLES.has(role));
}
