import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";

describe("AuthService admin user management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes only the minimal workspace directory to assignment pickers", async () => {
    const { service, prisma } = makeService({ principal: { subjectType: "internal_user", roleCodes: ["SALES_OWNER"] } });
    await expect(service.listWorkspaceUsers("Bearer sales-session")).resolves.toMatchObject({ data: [] });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ id: true, displayName: true }) }));
    expect(prisma.user.findMany.mock.calls[0][0].select).not.toHaveProperty("sessions");
  });

  it("rejects full admin user directory for non-Founder roles", async () => {
    const { service, prisma } = makeService({ principal: { subjectType: "internal_user", roleCodes: ["SALES_OWNER"] } });
    await expect(service.listUsers("Bearer sales-session")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("rejects workspace user directory reads from portal principals", async () => {
    const { service, prisma } = makeService({
      principal: { subjectType: "portal_user", roleCodes: [] }
    });

    await expect(service.listWorkspaceUsers("Bearer portal-session")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("keeps suspended user directory reads restricted to Founder/GM", async () => {
    const { service, prisma } = makeService({
      principal: { subjectType: "internal_user", roleCodes: ["DELIVERY_LEAD"] }
    });

    await expect(service.listUsers("Bearer delivery-session", true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("creates workspace-scoped customer grants for internal users", async () => {
    const { service, prisma, workspaces } = makeService();

    await expect(
      service.createInternalUser("Bearer founder-session", {
        email: "new.user@example.com",
        displayName: "New User",
        roleCode: "DELIVERY_LEAD",
        accountId: "acc-1"
      } as any)
    ).resolves.toMatchObject({
      email: "new.user@example.com",
      roleCode: "DELIVERY_LEAD",
      tenantKey: "prod",
      workspaceId: "twk-foundation"
    });

    expect(workspaces.resolveWorkspace).toHaveBeenCalledWith({
      tenantKey: "prod",
      workspaceId: "twk-foundation",
      workspaceKey: "default"
    });
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", workspaceId: "twk-foundation" },
      select: { id: true }
    });
    expect(prisma.customerAccessGrant.create).toHaveBeenCalledWith({
      data: {
        userId: "usr-new",
        workspaceId: "twk-foundation",
        accountId: "acc-1",
        projectId: undefined,
        scope: "CUSTOMER_ACCOUNT"
      }
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "new.user@example.com",
        displayName: "New User",
        subjectType: "INTERNAL_USER",
        status: "ACTIVE"
      })
    });
  });

  it("keeps user, role-binding, and grant counts unchanged when the grant target is outside the workspace", async () => {
    const { service, prisma } = makeService({
      account: null
    });
    const before = await readMutationCounts(prisma);

    await expect(
      service.createInternalUser("Bearer founder-session", {
        email: "new.user@example.com",
        displayName: "New User",
        roleCode: "DELIVERY_LEAD",
        accountId: "acc-outside"
      } as any)
    ).rejects.toBeInstanceOf(NotFoundException);

    const after = await readMutationCounts(prisma);
    expect(after).toEqual(before);
    expect(prisma.role.upsert).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.roleBinding.upsert).not.toHaveBeenCalled();
    expect(prisma.customerAccessGrant.create).not.toHaveBeenCalled();
  });

  it("adds a workspace membership without overwriting an existing global identity owned by another workspace", async () => {
    const { service, prisma } = makeService({
      existingUser: {
        id: "usr-shared",
        email: "shared.user@example.com",
        displayName: "Existing Global Name",
        departmentCode: "existing-department",
        subjectType: "INTERNAL_USER",
        status: "ACTIVE",
        roleBindings: [{ workspaceId: "twk-other" }]
      }
    });

    await expect(service.createInternalUser("Bearer founder-session", {
      email: "shared.user@example.com",
      displayName: "Attempted Workspace Override",
      departmentCode: "new-department",
      roleCode: "SALES_OWNER"
    } as any)).resolves.toMatchObject({
      id: "usr-shared",
      email: "shared.user@example.com",
      displayName: "Existing Global Name",
      workspaceId: "twk-foundation"
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.roleBinding.upsert).toHaveBeenCalledWith({
      where: {
        userId_roleId_tenantKey_workspaceId: {
          userId: "usr-shared",
          roleId: "role-delivery",
          tenantKey: "prod",
          workspaceId: "twk-foundation"
        }
      },
      update: { startsAt: expect.any(Date), endsAt: null },
      create: {
        userId: "usr-shared",
        roleId: "role-delivery",
        tenantKey: "prod",
        workspaceId: "twk-foundation"
      }
    });
  });

  it("rejects attempts to create a user in another workspace", async () => {
    const { service, prisma, workspaces } = makeService();

    await expect(service.createInternalUser("Bearer founder-session", {
      email: "new.user@example.com",
      displayName: "New User",
      roleCode: "DELIVERY_LEAD",
      workspaceId: "twk-other"
    } as any)).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaces.resolveWorkspace).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects destructive user changes before opening a transaction when caller is not Founder/GM", async () => {
    const { service, prisma } = makeService({
      principal: { subjectType: "internal_user", roleCodes: ["DELIVERY_LEAD"] }
    });

    await expect(service.deactivateUser("Bearer delivery-session", "usr-target")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function makeService({
  principal = { subjectType: "internal_user", roleCodes: ["FOUNDER_GM"] },
  account = { id: "acc-1" },
  project = { id: "prj-1" },
  existingUser = null
}: {
  principal?: { subjectType: string; roleCodes: string[] };
  account?: { id: string } | null;
  project?: { id: string } | null;
  existingUser?: Record<string, any> | null;
} = {}) {
  const newUser = {
    id: "usr-new",
    email: "new.user@example.com",
    displayName: "New User",
    departmentCode: null,
    subjectType: "INTERNAL_USER",
    status: "ACTIVE"
  };
  const prisma: any = {
    role: {
      upsert: vi.fn().mockResolvedValue({ id: "role-delivery", code: "DELIVERY_LEAD" })
    },
    user: {
      create: vi.fn().mockResolvedValue(newUser),
      update: vi.fn().mockResolvedValue(newUser),
      count: vi.fn().mockResolvedValue(existingUser ? 1 : 0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: "usr-target" }),
      findUnique: vi.fn().mockResolvedValue(existingUser)
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    roleBinding: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => where.role ? { id: "rb-admin" } : null),
      upsert: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(existingUser ? 1 : 0)
    },
    account: {
      findFirst: vi.fn().mockResolvedValue(account)
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(project)
    },
    customerAccessGrant: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0)
    },
    portalSession: {
      updateMany: vi.fn()
    },
    $transaction: vi.fn()
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  const workspaces = {
    resolveWorkspace: vi.fn().mockResolvedValue({
      tenantKey: "prod",
      workspaceId: "twk-foundation",
      workspaceKey: "default"
    })
  };
  const principals = {
    resolveFromAuthorization: vi.fn().mockResolvedValue({
      subjectType: principal.subjectType,
      roleCodes: principal.roleCodes,
      tenantKey: "prod",
      workspaceId: "twk-foundation",
      workspaceKey: "default"
    })
  };

  return {
    prisma,
    workspaces,
    principals,
    service: new AuthService(prisma as any, workspaces as any, principals as any)
  };
}

async function readMutationCounts(prisma: any) {
  const [users, roleBindings, grants] = await Promise.all([
    prisma.user.count(),
    prisma.roleBinding.count(),
    prisma.customerAccessGrant.count()
  ]);
  return { users, roleBindings, grants };
}

describe("AuthService membership lifecycle", () => {
  it("rejects final-founder deactivation before ending roles or sessions", async () => {
    const { service, prisma } = makeService();
    prisma.roleBinding.findFirst.mockResolvedValue({ id: "founder-binding" });
    prisma.user.count.mockResolvedValue(0);
    prisma.roleBinding.updateMany = vi.fn();
    await expect(service.deactivateUser("Bearer founder", "usr-target")).rejects.toThrow("at least one active Founder");
    expect(prisma.roleBinding.updateMany).not.toHaveBeenCalled();
    expect(prisma.portalSession.updateMany).not.toHaveBeenCalled();
  });
  it("rejects final-founder demotion", async () => {
    const { service, prisma } = makeService();
    prisma.roleBinding.findFirst.mockResolvedValue({ id: "founder-binding" });
    prisma.user.count.mockResolvedValue(0);
    await expect(service.changeUserRole("Bearer founder", "usr-target", "SALES_OWNER")).rejects.toThrow("at least one active Founder");
  });
  it("does not implicitly reactivate a suspended identity through create-user", async () => {
    const { service, prisma } = makeService({ existingUser: { id: "usr-old", status: "SUSPENDED", roleBindings: [] } });
    await expect(service.createInternalUser("Bearer founder", { email: "old@example.com", displayName: "Old", roleCode: "SALES_OWNER" } as any)).rejects.toThrow("explicit reactivation");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("keeps demo sessions off unless explicitly opted into a local runtime", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CRM_ENABLE_DEMO_SESSION", "true"); vi.stubEnv("CRM_LOCAL_AUTH_ENABLED", "false");
    const { service } = makeService();
    await expect(service.createDemoSession()).rejects.toBeInstanceOf(ForbiddenException);
    vi.unstubAllEnvs();
  });
});
