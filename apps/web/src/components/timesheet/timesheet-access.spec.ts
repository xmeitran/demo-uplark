import { expect, it } from "vitest";
import { canViewTimesheetGroup, resolveTimesheetScope } from "./timesheet-access";

it("uses the canonical account type and view mode for Timesheet visibility", () => {
  expect(canViewTimesheetGroup({ role: "FOUNDER_GM", roleCodes: ["FOUNDER_GM"], accountType: "ADMIN", viewMode: "admin" })).toBe(true);
  expect(canViewTimesheetGroup({ role: "WORKSPACE_ADMIN", roleCodes: ["WORKSPACE_ADMIN"], accountType: "ADMIN", viewMode: "admin" })).toBe(true);
  expect(canViewTimesheetGroup({ role: "PM", accountType: "ADMIN", viewMode: "admin" })).toBe(true);
  expect(canViewTimesheetGroup({ role: "FOUNDER_GM", roleCodes: ["FOUNDER_GM"], accountType: "ADMIN", viewMode: "user" })).toBe(false);
  expect(canViewTimesheetGroup({ role: "DELIVERY_LEAD", roleCodes: ["DELIVERY_LEAD"], accountType: "USER", viewMode: "admin" })).toBe(false);
  expect(canViewTimesheetGroup({ role: "FINANCE_ADMIN", roleCodes: ["FINANCE_ADMIN"], accountType: "USER", viewMode: "admin" })).toBe(false);
  expect(canViewTimesheetGroup({ role: "WORKSPACE_USER", roleCodes: ["WORKSPACE_USER"], accountType: "USER", viewMode: "admin" })).toBe(false);
  expect(canViewTimesheetGroup()).toBe(false);
});

it("defaults an Admin view to the whole workspace instead of a stale personal scope", () => {
  const admin = { role: "PM", accountType: "ADMIN" as const, viewMode: "admin" as const };
  expect(resolveTimesheetScope(admin)).toBe("workspace");
  expect(resolveTimesheetScope(admin, "self")).toBe("workspace");
  expect(resolveTimesheetScope(admin, "managed_projects")).toBe("managed_projects");
  expect(resolveTimesheetScope({ role: "FOUNDER_GM", accountType: "ADMIN", viewMode: "user" }, "workspace")).toBe("self");
  expect(resolveTimesheetScope({ role: "DX", accountType: "USER", viewMode: "admin" }, "workspace")).toBe("self");
});
