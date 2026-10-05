import { describe, expect, it } from "vitest";
import { MANUAL_WORKSPACE_ROLE_OPTIONS, normalizeBusinessRole, systemRoleLabel } from "./people-roles";

it("keeps Workspace Admin available for manual assignment", () => {
  expect(MANUAL_WORKSPACE_ROLE_OPTIONS).toEqual([
    { value: "FOUNDER_GM", label: "Founder/GM" },
    { value: "WORKSPACE_ADMIN", label: "Workspace Admin" },
    { value: "WORKSPACE_USER", label: "Workspace User" },
  ]);
});

describe("people role normalization", () => {
  it("exposes only the agreed business role labels", () => {
    expect(normalizeBusinessRole("CDS_DX_ENABLER")).toBe("DX enabler");
    expect(normalizeBusinessRole("DELIVERY_LEAD")).toBe("Project Manager");
    expect(normalizeBusinessRole("Implementation consultant")).toBe("Project Manager");
    expect(normalizeBusinessRole("SALES_OWNER")).toBe("Business development");
    expect(normalizeBusinessRole("WORKSPACE_ADMIN")).toBe("Chưa gán");
  });

  it("keeps system role labels separate from business role labels", () => {
    expect(systemRoleLabel("FOUNDER_GM")).toBe("Founder/GM");
    expect(systemRoleLabel("WORKSPACE_ADMIN")).toBe("Workspace Admin");
    expect(systemRoleLabel("WORKSPACE_USER")).toBe("Workspace User");
  });
});
