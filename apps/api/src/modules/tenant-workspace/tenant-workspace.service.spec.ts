import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { TenantWorkspaceService, organizationKey } from "./tenant-workspace.service";

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

