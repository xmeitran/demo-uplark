import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LarkAuthService } from "./lark-auth.service";

const redirectUri = "https://crm.example.com/api/auth/lark/callback";
describe("Lark authentication boundary", () => {
  beforeEach(() => {
    vi.stubEnv("LARK_APP_ID", "cli_test");
    vi.stubEnv("LARK_APP_SECRET", "secret_test");
    vi.stubEnv("LARK_OAUTH_STATE_SECRET", "state_secret_test");
    vi.stubEnv("LARK_OAUTH_REDIRECT_URIS", redirectUri);
    vi.stubEnv("FOUNDATION_TENANT_KEY", "prod");
    vi.stubEnv("FOUNDATION_WORKSPACE_KEY", "default");
    vi.stubEnv("LARK_ALLOWED_TENANT_KEYS", "tn_test");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("stores hashed one-use state and builds exact redirect", async () => {
    const { service, prisma } = makeService();
    const result = await service.createAuthorizeUrl({ returnTo: "/projects", redirectUri });
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(prisma.authActionToken.create.mock.calls[0][0].data.tokenHash).not.toBe(result.state);
    expect(prisma.authActionToken.create.mock.calls[0][0].data.purpose).toBe("LARK_STATE");
  });

  it("rejects unconfigured callback origins before creating OAuth state", async () => {
    const { service, prisma } = makeService();
    await expect(service.createAuthorizeUrl({ redirectUri: "https://attacker.example/callback" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.authActionToken.create).not.toHaveBeenCalled();
  });

  it("hands verified SSO identity to unified MFA continuation, not direct session factory", async () => {
    const { service, nativeAuth, principals } = makeService();
    const { state } = await service.createAuthorizeUrl({ returnTo: "/projects", redirectUri });
    mockProvider();
    nativeAuth.completeIdentityLogin.mockResolvedValue({ mfaRequired: true, challengeToken: "challenge", expiresAt: "future" });
    await expect(service.completeCallback({ code: "code", state, redirectUri })).resolves.toMatchObject({ mfaRequired: true, returnTo: "/projects" });
    expect(principals.createSessionForUser).not.toHaveBeenCalled();
    expect(nativeAuth.completeIdentityLogin).toHaveBeenCalledWith("usr-1", expect.objectContaining({ workspaceId: "twk-foundation" }), { authMethod: "lark" });
  });

  it("rejects replayed state before provider calls", async () => {
    const { service, prisma } = makeService();
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    prisma.authActionToken.updateMany.mockResolvedValue({ count: 0 });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toThrow("already used");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never revives suspended linked users even if legacy auto-provision flag is enabled", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    const { service, prisma, nativeAuth } = makeService();
    prisma.portalIdentity.findUnique.mockResolvedValue({ user: { id: "usr-1", status: "SUSPENDED" } });
    const { state } = await service.createAuthorizeUrl({ redirectUri }); mockProvider();
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(nativeAuth.completeIdentityLogin).not.toHaveBeenCalled();
  });

  it("rejects active identities with ended memberships", async () => {
    const { service, prisma } = makeService();
    prisma.roleBinding.findFirst.mockResolvedValue(null);
    const { state } = await service.createAuthorizeUrl({ redirectUri }); mockProvider();
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toThrow("membership");
    expect(prisma.portalIdentity.upsert).not.toHaveBeenCalled();
  });

  it("does not auto-provision uninvited provider users", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValue(null);
    const { state } = await service.createAuthorizeUrl({ redirectUri }); mockProvider();
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("bounds provider calls and does not expose provider error payloads", async () => {
    const { service } = makeService();
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    const fetcher = vi.fn().mockRejectedValue(new Error("private provider debug")); vi.stubGlobal("fetch", fetcher);
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toThrow("temporarily unavailable");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal), redirect: "error" });
  });

  it("binds invitation redemption to signed state and verified provider profile", async () => {
    const { createHash } = await import("node:crypto");
    const invitationToken = "secret-invite";
    const { service, nativeAuth } = makeService();
    const { state } = await service.createAuthorizeUrl({ redirectUri, invitationTokenHash: createHash("sha256").update(invitationToken).digest("hex") });
    mockProvider();
    await service.completeCallback({ code: "code", state, redirectUri, invitationToken });
    expect(nativeAuth.acceptSsoInvitation).toHaveBeenCalledWith(invitationToken, expect.objectContaining({ openId: "ou_test", email: "person@example.com" }), expect.objectContaining({ workspaceId: "twk-foundation" }));
  });

  it("rejects a substituted invitation before redeeming OAuth code", async () => {
    const { service, nativeAuth } = makeService();
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(service.completeCallback({ code: "code", state, redirectUri, invitationToken: "substituted" })).rejects.toThrow("Invitation does not match");
    expect(fetcher).not.toHaveBeenCalled();
    expect(nativeAuth.acceptSsoInvitation).not.toHaveBeenCalled();
  });

  it("rejects direct Lark sessions by default", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CRM_ENABLE_DIRECT_LARK_SESSION", "false");
    const { service } = makeService();
    await expect(service.createLinkedSession({ openId: "ou_test" })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function makeService() {
  const user = { id: "usr-1", email: "person@example.com", displayName: "Person", status: "ACTIVE" };
  const prisma = {
    authActionToken: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    portalIdentity: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ userId: "usr-1" }) },
    user: { findFirst: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue(user) },
    roleBinding: { findFirst: vi.fn().mockResolvedValue({ id: "rb-1" }) },
    customerAccessGrant: { findFirst: vi.fn().mockResolvedValue(null) }
  };
  const workspaces = { resolveWorkspace: vi.fn().mockResolvedValue({ tenantKey: "prod", workspaceId: "twk-foundation", workspaceKey: "default" }) };
  const principals = { createSessionForUser: vi.fn() };
  const nativeAuth = { acceptSsoInvitation: vi.fn().mockResolvedValue({ userId: "usr-1" }), completeIdentityLogin: vi.fn().mockResolvedValue({ token: "session-token", expiresAt: "future" }) };
  return { service: new LarkAuthService(prisma as any, workspaces as any, principals as any, nativeAuth as any), prisma, principals, nativeAuth };
}
function mockProvider() {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_test", tenant_key: "tn_test", email: "person@example.com", name: "Person" } }) }));
}
