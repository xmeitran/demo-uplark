import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAccessMemberSummary } from "@b2b-crm/contracts";
import { fetchWorkspaceUserOptions, mapWorkspaceUserToOption } from "./workspace-users";

describe("workspace user options", () => {
  it("maps synced Lark users into picker options without seed identities", () => {
    const user: AdminAccessMemberSummary = {
      id: "usr-lark-855fdgc8",
      email: "khanhv@upbase.asia",
      displayName: "Nguyễn Hùng Việt Kha",
      avatarUrl: "https://avatar.example/kha.png",
      departmentCode: "CDS",
      larkOpenId: "ou_123",
      larkTenantKey: "prod",
      hasResourceProfile: true,
      resourceDisplayRole: "Founder",
      resourceSkills: ["CRM"],
      subjectType: "internal",
      status: "active",
      tenantKey: "prod",
      roleCodes: ["FOUNDER_GM"],
      accountIds: [],
      accountNames: [],
      projectIds: [],
      projectNames: [],
      activeSessionCount: 1,
      createdAt: "2026-07-01T00:00:00.000Z"
    };

    expect(mapWorkspaceUserToOption(user)).toMatchObject({
      id: "usr-lark-855fdgc8",
      email: "khanhv@upbase.asia",
      name: "Nguyễn Hùng Việt Kha",
      initials: "NK",
      avatarUrl: "https://avatar.example/kha.png",
      role: "Founder",
      department: "CDS",
      status: "active"
    });
  });

  it("uses role code fallback when no resource profile role exists", () => {
    const user: AdminAccessMemberSummary = {
      id: "usr-lark-ou_456",
      email: "delivery@example.com",
      displayName: "Delivery Lead",
      hasResourceProfile: false,
      resourceSkills: [],
      subjectType: "internal",
      status: "active",
      tenantKey: "prod",
      roleCodes: ["DELIVERY_LEAD"],
      accountIds: [],
      accountNames: [],
      projectIds: [],
      projectNames: [],
      activeSessionCount: 0,
      createdAt: "2026-07-01T00:00:00.000Z"
    };

    expect(mapWorkspaceUserToOption(user).role).toBe("Delivery Lead");
  });
});


describe("workspace directory fetch", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the minimal member directory rather than the admin endpoint and filters inactive users", async () => {
    const base = {id:"member",email:"member@example.test",displayName:"Team Member",roleCodes:["SALES_OWNER"],status:"active"};
    const fetcher = vi.fn().mockResolvedValue(Response.json({data:[base,{...base,id:"suspended",status:"suspended"}]}));
    vi.stubGlobal("fetch",fetcher);
    const result = await fetchWorkspaceUserOptions();
    expect(fetcher).toHaveBeenCalledWith("/api/workspace/users",expect.objectContaining({credentials:"same-origin",cache:"no-store"}));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({id:"member",role:"Sales Owner"});
  });
});
