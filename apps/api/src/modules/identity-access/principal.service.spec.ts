import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrincipalService, canUsePrincipalFallback } from "./principal.service";

describe("PrincipalService principal fallback policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects fallback principals in production without resolving them", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const service = new PrincipalService({} as any, {} as any);
    const fallbackSpy = vi.spyOn(service, "resolveFallbackPrincipal");

    await expect(service.resolveFromAuthorization(undefined, "founder")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(canUsePrincipalFallback()).toBe(false);
  });

  it("rejects fallback principals when public sessions are explicitly required", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRM_ALLOW_PRINCIPAL_FALLBACK", "true");
    vi.stubEnv("CRM_PUBLIC_SESSION_REQUIRED", "1");
    const service = new PrincipalService({} as any, {} as any);
    const fallbackSpy = vi.spyOn(service, "resolveFallbackPrincipal");

    await expect(service.resolveFromAuthorization(undefined, "founder")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(canUsePrincipalFallback()).toBe(false);
  });

  it("rejects fallback principals in local tooling unless explicitly opted in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const service = new PrincipalService({} as any, {} as any);
    const fallbackSpy = vi.spyOn(service, "resolveFallbackPrincipal");

    await expect(service.resolveFromAuthorization(undefined, "founder")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(canUsePrincipalFallback()).toBe(false);
  });

  it("keeps fallback principals available only for explicitly opted-in local tooling", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRM_ALLOW_PRINCIPAL_FALLBACK", "true");
    const service = new PrincipalService({} as any, {} as any);
    const principal = { subjectId: "usr-founder", displayName: "Founder" };
    vi.spyOn(service, "resolveFallbackPrincipal").mockResolvedValue(principal as any);

    await expect(service.resolveFromAuthorization(undefined, "founder")).resolves.toBe(principal);
    expect(canUsePrincipalFallback()).toBe(true);
  });
});

describe("PrincipalService workspace grant scope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads customer grants only from the resolved workspace when creating a session", async () => {
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(),
      tenantWorkspace: { findUnique: vi.fn().mockResolvedValue({ status: "active" }) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "usr-1",
          email: "customer@example.com",
          displayName: "Customer User",
          avatarUrl: null,
          subjectType: "PORTAL_USER",
          status: "ACTIVE",
          roleBindings: [],
          customerGrants: [{ accountId: "acc-1", projectId: null }]
        })
      },
      portalSession: {
        create: vi.fn().mockResolvedValue({})
      }
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    const workspaces = {
      resolveWorkspace: vi.fn().mockResolvedValue({
        tenantKey: "prod",
        workspaceId: "twk-foundation",
        workspaceKey: "default"
      })
    };
    const service = new PrincipalService(prisma as any, workspaces as any);

    await expect(service.createSessionForUser("usr-1")).resolves.toMatchObject({
      principal: {
        workspaceId: "twk-foundation",
        accountIds: ["acc-1"]
      }
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          customerGrants: {
            where: {
              workspaceId: "twk-foundation",
              startsAt: { lte: expect.any(Date) },
              OR: [{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }]
            }
          }
        })
      })
    );
  });
});

describe("PrincipalService active session boundaries", () => {
  function fixture(overrides: Record<string, any> = {}) {
    const user = { id: "usr-1", email: "a@example.com", displayName: "A", subjectType: "INTERNAL_USER", status: "ACTIVE", roleBindings: [{ id: "rb-1", workspaceId: "ws-1", tenantKey: "tenant", role: { code: "FOUNDER_GM" } }], customerGrants: [], ...overrides };
    const workspace = { id: "ws-1", workspaceId: "ws-1", tenantKey: "tenant", workspaceKey: "main", status: "active" };
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(1), $transaction: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      tenantWorkspace: { findUnique: vi.fn().mockResolvedValue(workspace) },
      portalSession: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: "s-1", user, workspace, expiresAt: new Date(Date.now() + 60000), revokedAt: null, roleVersion: "r", grantVersion: "g" }) }
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    const workspaces = { resolveWorkspace: vi.fn().mockResolvedValue(workspace), toContext: vi.fn().mockReturnValue(workspace) };
    return { service: new PrincipalService(prisma, workspaces as any), prisma, user, workspace };
  }
  it("does not issue sessions for users with no active membership or grants", async () => {
    const { service, prisma } = fixture({ roleBindings: [] });
    await expect(service.createSessionForUser("usr-1")).rejects.toThrow("membership");
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });
  it("rejects a session after its final membership is removed", async () => {
    const { service } = fixture({ roleBindings: [] });
    await expect(service.resolveSessionToken("token")).rejects.toThrow("membership");
  });
  it("does not issue sessions before account MFA is verified", async () => {
    const { service, prisma } = fixture({ mfaEnabledAt: new Date() });
    await expect(service.createSessionForUser("usr-1")).rejects.toThrow("Multi-factor");
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });
  it("rejects unstamped sessions when the account enables MFA", async () => {
    const { service } = fixture({ mfaEnabledAt: new Date() });
    await expect(service.resolveSessionToken("token")).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("rejects sessions into an inactive workspace", async () => {
    const { service, workspace } = fixture(); workspace.status = "suspended";
    await expect(service.resolveSessionToken("token")).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("persists explicit authentication freshness and MFA proof", async () => {
    const { service, prisma } = fixture({ mfaEnabledAt: new Date() });
    const authenticatedAt = new Date("2026-01-01T00:00:00Z");
    await service.createSessionForUser("usr-1", undefined, { authMethod: "lark", authenticatedAt, mfaVerifiedAt: authenticatedAt });
    expect(prisma.portalSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authMethod: "lark", authenticatedAt, mfaVerifiedAt: authenticatedAt }) });
  });
});
