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

export function hasAnyAuthRole(
  user: { role: string; roleCodes?: string[] } | null | undefined,
  allowedRoleCodes: readonly string[]
) {
  if (!user) return false;
  const roleCodes = user.roleCodes?.length ? user.roleCodes : [user.role];
  return roleCodes.some((roleCode) => allowedRoleCodes.includes(roleCode));
}
