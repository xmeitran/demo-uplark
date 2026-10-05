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

  it("does not auto-provision uninvited provider users when the feature is disabled", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "false");
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    const { state } = await service.createAuthorizeUrl({ redirectUri }); mockProvider();
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("auto-provisions a verified Lark user with a non-admin workspace role", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    vi.stubEnv("CRM_LARK_DEFAULT_ROLE_CODE", "WORKSPACE_USER");
    const { service, prisma, nativeAuth, tx } = makeService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    tx.user.create.mockResolvedValue({ id: "usr-new", email: "person@example.com", displayName: "Person", status: "ACTIVE" });
    const { state } = await service.createAuthorizeUrl({ redirectUri }); mockProvider();

    await service.completeCallback({ code: "code", state, redirectUri });

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "person@example.com", emailVerifiedAt: expect.any(Date), subjectType: "INTERNAL_USER", status: "ACTIVE" })
    }));
    expect(tx.roleBinding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roleId: "role-workspace-user", tenantKey: "prod", workspaceId: "twk-foundation" })
    }));
    expect(nativeAuth.completeIdentityLogin).toHaveBeenCalledWith("usr-new", expect.objectContaining({ workspaceId: "twk-foundation" }), { authMethod: "lark" });
  });

  it("prefers the Lark enterprise email when OAuth also returns a personal email", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    vi.stubEnv("CRM_LARK_DEFAULT_ROLE_CODE", "WORKSPACE_USER");
    const { service, prisma, tx } = makeService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    tx.user.create.mockResolvedValue({ id: "usr-new", email: "mai@upbase.asia", displayName: "Person", status: "ACTIVE" });
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_test", user_id: "ou_test_user", tenant_key: "tn_test", email: "mai.personal@gmail.com", name: "Person" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, tenant_access_token: "tenant-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { user: { enterprise_email: "mai@upbase.asia" } } }) }));

    await service.completeCallback({ code: "code", state, redirectUri });

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "mai@upbase.asia" })
    }));
  });

  it("reuses the existing CRM member through stable Lark user id after an app change", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    const { service, prisma, nativeAuth } = makeService();
    const existingMember = { id: "usr-lark-HCM273", email: "maitns@upbase.asia", displayName: "Trần Ngô Sao Mai", status: "ACTIVE" };
    prisma.portalIdentity.findUnique.mockResolvedValue(null);
    prisma.portalIdentity.findFirst.mockResolvedValue({ user: existingMember });
    prisma.portalIdentity.upsert.mockResolvedValue({ userId: existingMember.id });
    prisma.user.update.mockResolvedValue(existingMember);
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_new_app_id", user_id: "HCM273", tenant_key: "tn_test", email: "tranngosaomai@gmail.com", name: "Trần Ngô Sao Mai" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 1 }) }));

    await service.completeCallback({ code: "code", state, redirectUri });

    expect(prisma.portalIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "usr-lark-HCM273", providerUserId: "ou_new_app_id", tenantKey: "prod" })
    }));
    expect(nativeAuth.completeIdentityLogin).toHaveBeenCalledWith("usr-lark-HCM273", expect.objectContaining({ workspaceId: "twk-foundation" }), { authMethod: "lark" });
  });

  it("uses the configured enterprise email when production has not imported the legacy Lark identity", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    vi.stubEnv("CRM_LARK_DEFAULT_ROLE_CODE", "WORKSPACE_USER");
    vi.stubEnv("CRM_LARK_ENTERPRISE_EMAIL_OVERRIDES", "HCM273=maitns@upbase.asia");
    const { service, prisma, nativeAuth } = makeService();
    const existingMember = { id: "usr-lark-HCM273", email: "maitns@upbase.asia", displayName: "Trần Ngô Sao Mai", status: "ACTIVE" };
    prisma.portalIdentity.findUnique.mockResolvedValue(null);
    prisma.portalIdentity.findFirst.mockResolvedValue(null);
    prisma.portalIdentity.upsert.mockResolvedValue({ userId: existingMember.id });
    prisma.user.findMany.mockResolvedValue([existingMember]);
    prisma.user.update.mockResolvedValue(existingMember);
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_new_app_id", user_id: "HCM273", tenant_key: "tn_test", email: "tranngosaomai@gmail.com", name: "Trần Ngô Sao Mai" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 1 }) }));

    await service.completeCallback({ code: "code", state, redirectUri });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { in: ["maitns@upbase.asia", "tranngosaomai@gmail.com"] } }
    }));
    expect(prisma.portalIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: existingMember.id, providerUserId: "ou_new_app_id", tenantKey: "prod" })
    }));
    expect(nativeAuth.completeIdentityLogin).toHaveBeenCalledWith(existingMember.id, expect.objectContaining({ workspaceId: "twk-foundation" }), { authMethod: "lark" });
  });

  it("repairs a stale open-id link when the stable Lark user id resolves to another CRM member", async () => {
    const { service, prisma, nativeAuth } = makeService();
    const canonicalMember = { id: "usr-lark-HCM273", email: "maitns@upbase.asia", displayName: "Trần Ngô Sao Mai", status: "ACTIVE" };
    prisma.portalIdentity.findUnique.mockResolvedValue({ user: { id: "usr-auto-provisioned", email: "tranngosaomai@gmail.com", displayName: "Trần Ngô Sao Mai", status: "ACTIVE" } });
    prisma.portalIdentity.findFirst.mockResolvedValue({ user: canonicalMember });
    prisma.portalIdentity.upsert.mockResolvedValue({ userId: canonicalMember.id });
    prisma.user.update.mockResolvedValue(canonicalMember);
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_new_app_id", user_id: "HCM273", tenant_key: "tn_test", email: "tranngosaomai@gmail.com", name: "Trần Ngô Sao Mai" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 1 }) }));

    await service.completeCallback({ code: "code", state, redirectUri });

    expect(nativeAuth.completeIdentityLogin).toHaveBeenCalledWith(canonicalMember.id, expect.objectContaining({ workspaceId: "twk-foundation" }), { authMethod: "lark" });
    expect(prisma.portalIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { userId: canonicalMember.id },
      create: expect.objectContaining({ userId: canonicalMember.id, providerUserId: "ou_new_app_id", tenantKey: "prod" })
    }));
  });

  it("repairs an existing linked CRM user when Lark provides an enterprise email", async () => {
    const { service, prisma } = makeService();
    prisma.portalIdentity.findUnique.mockResolvedValue({
      user: { id: "usr-1", email: "mai.personal@gmail.com", displayName: "Person", status: "ACTIVE" }
    });
    prisma.user.findFirst.mockResolvedValue(null);
    const { state } = await service.createAuthorizeUrl({ redirectUri });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_test", user_id: "ou_test_user", tenant_key: "tn_test", email: "mai.personal@gmail.com", name: "Person" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, tenant_access_token: "tenant-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { user: { enterprise_email: "mai@upbase.asia" } } }) }));

    await service.completeCallback({ code: "code", state, redirectUri });

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "usr-1" },
      data: expect.objectContaining({ email: "mai@upbase.asia" })
    }));
  });

  it("rejects auto-provision configuration that would grant an admin role", async () => {
    vi.stubEnv("CRM_LARK_AUTO_PROVISION", "true");
    vi.stubEnv("CRM_LARK_DEFAULT_ROLE_CODE", "WORKSPACE_ADMIN");
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    const { state } = await service.createAuthorizeUrl({ redirectUri }); mockProvider();
    await expect(service.completeCallback({ code: "code", state, redirectUri })).rejects.toThrow("non-admin workspace role");
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
  const tx = {
    $executeRaw: vi.fn(),
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "usr-new", email: "person@example.com", displayName: "Person", status: "ACTIVE" })
    },
    role: { findUnique: vi.fn().mockResolvedValue({ id: "role-workspace-user", code: "WORKSPACE_USER" }) },
    portalIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ userId: "usr-new" }),
      create: vi.fn().mockResolvedValue({ userId: "usr-new" })
    },
    roleBinding: { create: vi.fn().mockResolvedValue({}) }
  };
  const prisma = {
    authActionToken: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    portalIdentity: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ userId: "usr-1" }) },
    user: { findFirst: vi.fn().mockResolvedValue(user), findMany: vi.fn().mockResolvedValue([user]), update: vi.fn().mockResolvedValue(user) },
    roleBinding: { findFirst: vi.fn().mockResolvedValue({ id: "rb-1" }) },
    customerAccessGrant: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
  };
  const workspaces = { resolveWorkspace: vi.fn().mockResolvedValue({ tenantKey: "prod", workspaceId: "twk-foundation", workspaceKey: "default" }) };
  const principals = { createSessionForUser: vi.fn() };
  const nativeAuth = { acceptSsoInvitation: vi.fn().mockResolvedValue({ userId: "usr-1" }), completeIdentityLogin: vi.fn().mockResolvedValue({ token: "session-token", expiresAt: "future" }) };
  return { service: new LarkAuthService(prisma as any, workspaces as any, principals as any, nativeAuth as any), prisma, principals, nativeAuth, tx };
}
function mockProvider() {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, access_token: "provider-token" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { open_id: "ou_test", tenant_key: "tn_test", email: "person@example.com", name: "Person" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 1 }) }));
}
