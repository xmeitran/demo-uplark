import { describe, expect, it } from "vitest";
import { planFoundationRoleGrants } from "./foundation-role-grants";

describe("planFoundationRoleGrants", () => {
  const base = { founderUserId: "usr-founder", existingUserIds: new Set(["usr-founder", "usr-a", "usr-b", "usr-pm"]) };

  it("grants Workspace Admin only to a configured user who never held it", () => {
    expect(planFoundationRoleGrants({ ...base, workspaceAdminUserIds: ["usr-a", "usr-b", "usr-a"], existingBindingKeys: new Set(["usr-b:WORKSPACE_ADMIN"]) }))
      .toEqual([{ userId: "usr-a", roleCode: "WORKSPACE_ADMIN" }]);
  });

  it("leaves every existing binding untouched: nobody else is planned, whatever roles they hold", () => {
    const existingBindingKeys = new Set(["usr-pm:PM", "usr-pm:FOUNDER_GM", "usr-b:DELIVERY_LEAD", "usr-a:WORKSPACE_ADMIN"]);
    expect(planFoundationRoleGrants({ ...base, workspaceAdminUserIds: ["usr-a"], existingBindingKeys })).toEqual([]);
    expect(planFoundationRoleGrants({ ...base, workspaceAdminUserIds: [], existingBindingKeys })).toEqual([]);
  });

  it("does not re-grant a role an admin ended, and skips the founder and unknown users", () => {
    // An ended binding row still exists, so its key is present.
    expect(planFoundationRoleGrants({ ...base, workspaceAdminUserIds: ["usr-a", "usr-founder", "usr-not-yet"], existingBindingKeys: new Set(["usr-a:WORKSPACE_ADMIN"]) })).toEqual([]);
  });
});
