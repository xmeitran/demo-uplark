import { describe, expect, it, vi } from "vitest";
import { TenantWorkspaceService } from "./tenant-workspace.service";

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
