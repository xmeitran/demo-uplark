export const TIMESHEET_GROUP_ROLE_CODES = ["FOUNDER_GM", "WORKSPACE_ADMIN"] as const;

export function canViewTimesheetGroup(roleCodes?: readonly string[]) {
  return Boolean(roleCodes?.some((roleCode) => TIMESHEET_GROUP_ROLE_CODES.includes(roleCode as (typeof TIMESHEET_GROUP_ROLE_CODES)[number])));
}
