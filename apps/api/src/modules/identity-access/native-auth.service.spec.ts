import { describe, expect, it, vi } from "vitest";
import { NativeAuthService } from "./native-auth.service";
import { AuthSecurityService, hashAuthToken, totpAt } from "./auth-security.service";
function setup(overrides: any = {}) {
  const db: any = { user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, authActionToken: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() }, portalInvitation: { findUnique: vi.fn() }, portalSession: { findUnique: vi.fn() }, auditEvent: { create: vi.fn() }, $executeRaw: vi.fn(), ...overrides };
  db.$transaction = (fn: any) => fn(db);
  const principals: any = { resolveFromAuthorization: vi.fn(), createSessionForUser: vi.fn() };
  const security: any = { limit: vi.fn(), decrypt: vi.fn() };
  const service = new NativeAuthService(db, principals, {} as any, security, {} as any);
  return { db, service, principals, security };
}
describe("NativeAuthService rejection and lifecycle boundaries", () => {
  it("rejects role escalation before any invitation mutation", async () => {
    const { db, service, principals } = setup();
    principals.resolveFromAuthorization.mockResolvedValue({ subjectId: "member", roleCodes: ["SALES_OWNER"] });
    db.user.findUniqueOrThrow.mockResolvedValue({ id: "member", status: "ACTIVE" });
    await expect(service.createInvitation("Bearer valid", { email: "new@example.com", roleCode: "FOUNDER_GM" })).rejects.toMatchObject({ status: 403 });
  });
  it("rejects expired invitation before password work or creating sessions", async () => {
    const { db, service, principals } = setup();
    db.portalInvitation.findUnique.mockResolvedValue({ status: "PENDING", expiresAt: new Date(0) });
    await expect(service.activateInvitation(undefined, { token: "x", password: "whatever" })).rejects.toMatchObject({ status: 401 });
    expect(principals.createSessionForUser).not.toHaveBeenCalled();
  });
  it("requires matching authenticated identity to accept an existing-user invite", async () => {
    const { db, service, principals } = setup();
    db.portalInvitation.findUnique.mockResolvedValue({ status: "PENDING", expiresAt: new Date(Date.now() + 60000), invitedEmail: "victim@example.com" });
    db.user.findUnique.mockResolvedValue({ id: "victim", email: "victim@example.com" });
    principals.resolveFromAuthorization.mockResolvedValue({ subjectId: "attacker", email: "attacker@example.com" });
    await expect(service.activateInvitation("Bearer attacker", { token: "stolen-invite", password: "replace victim password" })).rejects.toMatchObject({ status: 403 });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("rejects replayed MFA challenges before session issuance", async () => {
    const { db, service, principals } = setup();
    db.authActionToken.findUnique.mockResolvedValue({ purpose: "MFA_LOGIN", consumedAt: new Date(), expiresAt: new Date(Date.now() + 10000) });
    await expect(service.challenge({ challengeToken: "already-used", code: "123456" })).rejects.toMatchObject({ status: 401 });
    expect(principals.createSessionForUser).not.toHaveBeenCalled();
  });
  it("rejects previously accepted TOTP time step even if cryptographically valid", async () => {
    const { db, service, principals, security } = setup();
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", step = Math.floor(Date.now() / 30000);
    db.authActionToken.findUnique.mockResolvedValue({ id: "t", userId: "u", workspaceId: "w", purpose: "MFA_LOGIN", consumedAt: null, expiresAt: new Date(Date.now() + 10000) });
    db.authActionToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.findUniqueOrThrow.mockResolvedValue({ id: "u", status: "ACTIVE", mfaEnabledAt: new Date(), mfaSecret: "encrypted", mfaLastStep: step, mfaRecoveryHashes: [] });
    security.decrypt.mockReturnValue(secret);
    await expect(service.challenge({ challengeToken: "t", code: totpAt(secret, step) })).rejects.toMatchObject({ status: 401 });
    expect(principals.createSessionForUser).not.toHaveBeenCalled();
  });
  it("consumes recovery code once and passes MFA stamp to final session", async () => {
    const { db, service, principals } = setup();
    db.authActionToken.findUnique.mockResolvedValue({ id: "t", userId: "u", workspaceId: "w", purpose: "MFA_LOGIN", consumedAt: null, expiresAt: new Date(Date.now() + 10000), payload: { authMethod: "lark" } });
    db.authActionToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.findUniqueOrThrow.mockResolvedValue({ id: "u", status: "ACTIVE", mfaEnabledAt: new Date(), mfaSecret: "encrypted", mfaRecoveryHashes: [hashAuthToken("recovery-code")] });
    db.user.updateMany.mockResolvedValue({ count: 1 }); principals.createSessionForUser.mockResolvedValue({ token: "verified" });
    expect(await service.challenge({ challengeToken: "t", code: "recovery-code" })).toEqual({ token: "verified" });
    expect(db.user.updateMany.mock.calls[0][0].data.mfaRecoveryHashes).toEqual([]);
    expect(principals.createSessionForUser.mock.calls[0][2].mfaVerifiedAt).toBeInstanceOf(Date);
    expect(principals.createSessionForUser.mock.calls[0][2].authMethod).toBe("lark");
  });
  it("rejects SSO invitation recipient and workspace substitution", async () => {
    const { db, service } = setup();
    db.portalInvitation.findUnique.mockResolvedValue({ id: "i", invitedEmail: "recipient@example.com", status: "PENDING", expiresAt: new Date(Date.now() + 60000), workspaceId: "w", tenantKey: "t" });
    await expect(service.acceptSsoInvitation("token", { openId: "o", email: "attacker@example.com", displayName: "Attacker" }, { workspaceId: "w", tenantKey: "t" })).rejects.toMatchObject({ status: 403 });
    await expect(service.acceptSsoInvitation("token", { openId: "o", email: "recipient@example.com", displayName: "Recipient" }, { workspaceId: "foreign", tenantKey: "t" })).rejects.toMatchObject({ status: 401 });
  });
  it("rejects SSO identity linking to a different existing identity", async () => {
    const { db, service } = setup({ tenantWorkspace: { findUnique: vi.fn().mockResolvedValue({ status: "active" }) }, portalIdentity: { findUnique: vi.fn().mockResolvedValue({ userId: "other-owner" }) } });
    db.portalInvitation.findUnique.mockResolvedValue({ id: "i", invitedEmail: "recipient@example.com", status: "PENDING", expiresAt: new Date(Date.now() + 60000), workspaceId: "w", tenantKey: "t" });
    db.portalInvitation.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    db.user.findUnique.mockResolvedValue({ id: "recipient" });
    await expect(service.acceptSsoInvitation("token", { openId: "o", email: "recipient@example.com", displayName: "Recipient" }, { workspaceId: "w", tenantKey: "t" })).rejects.toMatchObject({ status: 409 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

});
