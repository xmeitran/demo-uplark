import { expect, it } from "vitest";
import { canViewTimesheetGroup } from "./timesheet-access";

it("allows only Founder/GM and Workspace Admin to view group Timesheet data", () => {
  expect(canViewTimesheetGroup(["FOUNDER_GM"])).toBe(true);
  expect(canViewTimesheetGroup(["WORKSPACE_ADMIN"])).toBe(true);
  expect(canViewTimesheetGroup(["DELIVERY_LEAD"])).toBe(false);
  expect(canViewTimesheetGroup(["FINANCE_ADMIN"])).toBe(false);
  expect(canViewTimesheetGroup(["WORKSPACE_USER"])).toBe(false);
  expect(canViewTimesheetGroup()).toBe(false);
});
