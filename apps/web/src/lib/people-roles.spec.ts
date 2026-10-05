import { describe, expect, it } from "vitest";
import { normalizeBusinessRole, systemRoleLabel } from "./people-roles";

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
