import { isAdminView } from "@/lib/auth-role";
import type { ViewerScope } from "./timesheet-types";

export type TimesheetViewer = {
  role: string;
  roleCodes?: string[];
  accountType?: "ADMIN" | "USER";
  viewMode?: "admin" | "user";
};

/** Timesheet follows the same Admin/User view contract as the rest of the app. */
export function canViewTimesheetGroup(viewer?: TimesheetViewer | null) {
  return isAdminView(viewer);
}

/**
 * Admin view starts with the whole workspace. A stale `scope=self` URL from
 * User view must not silently hide everyone else after the mode is switched.
 * Admins can still narrow to managed projects; personal data is represented
 * by switching to User view or by the person filter.
 */
export function resolveTimesheetScope(viewer: TimesheetViewer | null | undefined, requestedScope?: string | null): ViewerScope {
  if (!canViewTimesheetGroup(viewer)) return "self";
  return requestedScope === "managed_projects" ? "managed_projects" : "workspace";
}
