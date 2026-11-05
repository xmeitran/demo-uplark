import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { TenantWorkspaceService, organizationKey } from "./tenant-workspace.service";
import { larkDirectoryUser } from "../workspace-admin/workspace-admin.service";

describe("TenantWorkspaceService", () => {
  it("creates the configured default workspace when it is missing", async () => {
    const prisma = {
      tenantWorkspace: {
        upsert: vi.fn().mockResolvedValue({
          id: "twk-foundation",
          tenantKey: "prod",
          workspaceKey: "default",
          name: "Default Workspace"
        })
      }
    } as any;
    const service = new TenantWorkspaceService(prisma);

    const workspace = await service.ensureDefaultWorkspace();

    expect(workspace).toMatchObject({ id: "twk-foundation", tenantKey: "prod", workspaceKey: "default" });
    expect(prisma.tenantWorkspace.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantKey_workspaceKey: { tenantKey: "prod", workspaceKey: "default" } },
        create: expect.objectContaining({ id: "twk-foundation", tenantKey: "prod", workspaceKey: "default" })
      })
    );
  });

  it("resolves an active workspace into API context", async () => {
    const prisma = {
      tenantWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "twk-alpha",
          tenantKey: "prod",
          workspaceKey: "alpha",
          status: "active"
        })
      }
    } as any;
    const service = new TenantWorkspaceService(prisma);

    await expect(service.resolveWorkspace({ tenantKey: "prod", workspaceKey: "alpha" })).resolves.toEqual({
      tenantKey: "prod",
      workspaceId: "twk-alpha",
      workspaceKey: "alpha"
    });
  });
});

it("never reactivates an existing default workspace during resolution", async () => {
  const prisma: any = { tenantWorkspace: {
    findUnique: vi.fn().mockResolvedValue({ id: "twk-foundation", tenantKey: "prod", workspaceKey: "default", status: "suspended" }),
    upsert: vi.fn()
  } };
  const service = new TenantWorkspaceService(prisma);
  await expect(service.resolveWorkspace({ tenantKey: "prod", workspaceKey: "default" })).rejects.toThrow("inactive");
  expect(prisma.tenantWorkspace.upsert).not.toHaveBeenCalled();
});

describe("organizations", () => {
  it("lets only System Founder manage organizations", async () => {
    const prisma = { tenantWorkspace: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() } } as any;
    const service = new TenantWorkspaceService(prisma);
    const founderGm = { tenantKey: "prod", workspaceId: "twk-foundation", roleCodes: ["FOUNDER_GM", "WORKSPACE_ADMIN"] } as any;
    await expect(service.listOrganizations(founderGm)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createOrganization(founderGm, { name: "Org B" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setOrganizationMember(founderGm, "twk-b", { user: "HN454", systemRole: "FOUNDER_GM" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tenantWorkspace.create).not.toHaveBeenCalled();
  });

  describe("adding by user ID someone the Lark directory sync never brought in", () => {
    const founder = { tenantKey: "prod", workspaceId: "twk-foundation", subjectId: "usr-founder", roleCodes: ["SYSTEM_FOUNDER"] } as any;
    const fromLark = { userId: "HN900", openId: "ou_900", email: "growth@upbase.asia", name: "Growth Person" };
    function setup(existing: { id: string } | null = null) {
      const tx = {
        user: { findUnique: vi.fn(async () => existing && { ...existing, email: "growth@upbase.asia", status: "ACTIVE", subjectType: "INTERNAL_USER" }), create: vi.fn(async ({ data }: any) => ({ id: "usr-new", ...data })) },
        portalIdentity: { createMany: vi.fn() },
        roleBinding: { findMany: vi.fn(async () => []), updateMany: vi.fn(), upsert: vi.fn(), count: vi.fn(async () => 1) },
        role: { findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: `role-${where.code}` })) },
        auditEvent: { create: vi.fn() }
      };
      const prisma = {
        tenantWorkspace: { findFirst: vi.fn(async () => ({ id: "twk-growth", tenantKey: "prod" })) },
        user: { findUnique: vi.fn(async () => null) },
        portalIdentity: { findFirst: vi.fn(async () => null) },
        $transaction: vi.fn(async (run: any) => run(tx))
      } as any;
      const service = new TenantWorkspaceService(prisma);
      service.larkDirectoryUser = vi.fn(async (id: string) => (id.toUpperCase() === "HN900" ? fromLark : null));
      return { service, tx, prisma };
    }

    it("looks the ID up in Lark, creates the account and links it so their Lark sign-in finds it", async () => {
      const { service, tx } = setup();
      const result = await service.setOrganizationMember(founder, "twk-growth", { user: "hn900" });
      expect(tx.user.create.mock.calls[0][0].data).toMatchObject({ email: "growth@upbase.asia", displayName: "Growth Person" });
      expect(tx.portalIdentity.createMany).toHaveBeenCalledWith({ data: [
        { userId: "usr-new", provider: "lark_user_id", providerUserId: "HN900", tenantKey: "prod" },
        { userId: "usr-new", provider: "lark", providerUserId: "ou_900", tenantKey: "prod" }
      ], skipDuplicates: true });
      expect(tx.roleBinding.upsert.mock.calls[0][0].create).toMatchObject({ userId: "usr-new", workspaceId: "twk-growth", roleId: "role-WORKSPACE_USER" });
      expect(result).toMatchObject({ id: "usr-new", created: true, verifiedOnLark: true });
    });

    it("reuses the account already holding the Lark email (added by email earlier) instead of a duplicate", async () => {
      const { service, tx } = setup({ id: "usr-by-email" });
      const result = await service.setOrganizationMember(founder, "twk-growth", { user: "HN900" });
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(tx.portalIdentity.createMany.mock.calls[0][0].data[0]).toMatchObject({ userId: "usr-by-email", providerUserId: "HN900" });
      expect(result).toMatchObject({ id: "usr-by-email", created: false });
    });

    it("adds by the ID alone when Lark will not show that person (another team outside the app's contact range)", async () => {
      const { service, tx } = setup();
      const result = await service.setOrganizationMember(founder, "twk-growth", { user: "HN777" });
      expect(tx.user.create.mock.calls[0][0].data).toMatchObject({ email: "hn777@lark.local", displayName: "HN777" });
      expect(tx.portalIdentity.createMany).toHaveBeenCalledWith({ data: [{ userId: "usr-new", provider: "lark_user_id", providerUserId: "HN777", tenantKey: "prod" }], skipDuplicates: true });
      expect(result).toMatchObject({ created: true, verifiedOnLark: false });
    });

    it("refuses something that is neither an email nor an ID", async () => {
      const { service, prisma } = setup();
      await expect(service.setOrganizationMember(founder, "twk-growth", { user: "Nguyễn Văn A" })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("does not ask Lark for an ID the CRM already knows", async () => {
      const { service, prisma } = setup();
      prisma.portalIdentity.findFirst.mockResolvedValue({ user: { id: "usr-dx", email: "dx@upbase.asia", status: "ACTIVE", subjectType: "INTERNAL_USER" } });
      const result = await service.setOrganizationMember(founder, "twk-growth", { user: "HN454" });
      expect(service.larkDirectoryUser).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("verifiedOnLark");
    });
  });

  it("reads a Lark directory user, falling back to the sync's placeholder email, and null whenever Lark cannot say", async () => {
    vi.stubEnv("LARK_APP_ID", "cli_test");
    vi.stubEnv("LARK_APP_SECRET", "s");
    const users: Record<string, unknown> = { HN900: { user_id: "HN900", open_id: "ou_900", name: " Growth Person ", enterprise_email: "Growth@UpBase.asia" }, HN901: { user_id: "HN901", open_id: "ou_901", name: "No Mail" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t" }) };
      const id = decodeURIComponent(url.split("/users/")[1].split("?")[0]);
      return users[id] ? { ok: true, status: 200, json: async () => ({ code: 0, data: { user: users[id] } }) } : { ok: false, status: 400, json: async () => ({ code: 99992351, msg: "not found" }) };
    }));
    try {
      expect(await larkDirectoryUser("HN900")).toEqual({ userId: "HN900", openId: "ou_900", email: "growth@upbase.asia", name: "Growth Person" });
      expect(await larkDirectoryUser("HN901")).toMatchObject({ email: "hn901@lark.local" });
      expect(await larkDirectoryUser("HN000")).toBeNull();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
      expect(await larkDirectoryUser("HN900")).toBeNull();
      vi.stubEnv("LARK_APP_ID", "");
      expect(await larkDirectoryUser("HN900")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("keys an organization by its name without accents", () => {
    expect(organizationKey("Công ty Đông Á  #2")).toBe("cong-ty-dong-a-2");
    expect(organizationKey("!!!")).toBe("org");
  });

  it("never stops the Lark sign-in organization, and a founder cannot remove themselves from the one they work in", async () => {
    const founder = { tenantKey: "prod", workspaceId: "twk-b", subjectId: "usr-founder", roleCodes: ["SYSTEM_FOUNDER"] } as any;
    const prisma = {
      tenantWorkspace: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id, tenantKey: "prod", workspaceKey: where.id === "twk-foundation" ? "default" : "org-b", name: "Org", status: "active" })), update: vi.fn() },
      $transaction: vi.fn()
    } as any;
    const service = new TenantWorkspaceService(prisma);
    await expect(service.updateOrganization(founder, "twk-foundation", { status: "inactive" })).rejects.toThrow("mặc định");
    await expect(service.removeOrganizationMember(founder, "twk-b", "usr-founder")).rejects.toThrow("Không thể tự gỡ");
    expect(prisma.tenantWorkspace.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

