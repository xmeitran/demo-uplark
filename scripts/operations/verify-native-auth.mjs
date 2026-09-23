import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const database = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
assert(["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)
  && /(?:^|_)test(?:_|$)/.test(database.pathname.slice(1)), "An isolated loopback test database is required");
assert(process.env.NODE_ENV !== "production", "Refusing production execution");
const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
require("reflect-metadata");
const { PrismaClient } = require("@prisma/client");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./dist/app.module.js");
const { configureAppSecurity } = require("./dist/bootstrap-security.js");
const { hashPassword, totpAt } = require("./dist/modules/identity-access/auth-security.service.js");
const prisma = new PrismaClient();
const run = `native-auth-${randomUUID()}`;
const password = `Test-only-${randomBytes(18).toString("base64url")}`;
const nextPassword = `Changed-${randomBytes(18).toString("base64url")}`;
let app;
let passed = 0;
let base;
let providerProfile;
let providerCalls = 0;
const mailDir = await mkdtemp(join(tmpdir(), "crm-auth-mail-"));
const provider = createServer((req, res) => {
  providerCalls++;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(req.url === "/token"
    ? { code: 0, access_token: "fixture-token" }
    : { code: 0, data: providerProfile }));
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
const providerBase = `http://127.0.0.1:${provider.address().port}`;

async function check(name, action) {
  await action(); passed++;
  console.log(`PASS ${name}`);
}
async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
function ok(result) { assert(result.status >= 200 && result.status < 300, `Expected success, received HTTP ${result.status}: ${result.body.message || ""}`); return result.body; }
function denied(result) { assert(result.status >= 400 && result.status < 500, `Expected rejection, received HTTP ${result.status}`); }
async function login(email, pwd = password, workspaceId) {
  return request("/auth/password/login", { method: "POST", body: { email, password: pwd, workspaceId } });
}
async function deliveredToken(email, purpose) {
  const files = (await readdir(mailDir)).sort().reverse();
  for (const file of files) {
    const mail = JSON.parse(await readFile(join(mailDir, file), "utf8"));
    if (mail.to === email && mail.subject.toLowerCase().includes(purpose)) {
      const link = mail.text.match(/https?:\/\/\S+/)?.[0];
      if (link) return new URL(link).searchParams.get("token");
    }
  }
  throw new Error(`No local ${purpose} delivery found`);
}

try {
  Object.assign(process.env, {
    NODE_ENV: "test", FOUNDATION_TENANT_KEY: run, FOUNDATION_WORKSPACE_KEY: "default",
    CRM_AUTH_MAIL_MODE: "spool", CRM_AUTH_MAIL_SPOOL: mailDir,
    CRM_AUTH_PUBLIC_ORIGIN: "http://localhost:3000", CRM_AUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    CRM_LOCAL_AUTH_ENABLED: "true", CRM_ENABLE_DEMO_SESSION: "false", CRM_ENABLE_DIRECT_LARK_SESSION: "false",
    CRM_ALLOW_PRINCIPAL_FALLBACK: "false", CRM_PUBLIC_SESSION_REQUIRED: "1",
    LARK_APP_ID: "fixture-app", LARK_APP_SECRET: "fixture-secret-not-real",
    LARK_OAUTH_STATE_SECRET: randomBytes(32).toString("hex"),
    LARK_OAUTH_AUTHORIZE_URL: `${providerBase}/authorize`, LARK_OAUTH_TOKEN_URL: `${providerBase}/token`,
    LARK_USER_INFO_URL: `${providerBase}/user-info`, LARK_ALLOWED_TENANT_KEYS: "fixture-tenant",
    LARK_OAUTH_REDIRECT_URIS: "http://localhost:3000/api/auth/lark/callback",
    LARK_OAUTH_REDIRECT_URI: "http://localhost:3000/api/auth/lark/callback",
    PUBLIC_WEB_URL: "http://localhost:3000", CRM_LARK_AUTO_PROVISION: "false"
  });
  const workspace = await prisma.tenantWorkspace.create({ data: { tenantKey: run, workspaceKey: "default", name: run } });
  const foreign = await prisma.tenantWorkspace.create({ data: { tenantKey: `${run}-foreign`, workspaceKey: "default", name: `${run} foreign` } });
  process.env.FOUNDATION_WORKSPACE_ID = workspace.id;
  const founderRole = await prisma.role.upsert({ where: { code: "FOUNDER_GM" }, create: { code: "FOUNDER_GM", name: "Founder", type: "SYSTEM" }, update: {} });
  const salesRole = await prisma.role.upsert({ where: { code: "SALES_OWNER" }, create: { code: "SALES_OWNER", name: "Sales", type: "BUSINESS" }, update: {} });
  const passwordHash = await hashPassword(password);
  async function user(suffix, target = workspace, role = founderRole) {
    return prisma.user.create({ data: {
      email: `${run}-${suffix}@example.test`, displayName: `Auth test ${suffix}`, passwordHash, emailVerifiedAt: new Date(),
      roleBindings: { create: { roleId: role.id, tenantKey: target.tenantKey, workspaceId: target.id } }
    } });
  }
  const founder = await user("founder");
  const outsider = await user("outsider", foreign);
  providerProfile = { open_id: `${run}-lark`, name: founder.displayName, email: founder.email, tenant_key: "fixture-tenant" };
  await prisma.portalIdentity.create({ data: { provider: "lark", providerUserId: providerProfile.open_id, tenantKey: run, userId: founder.id } });
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api"); configureAppSecurity(app); await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  let ownerToken;
  await check("anonymous admin denied and real password login accepted", async () => {
    assert.equal((await request("/auth/admin/users")).status, 401);
    assert.equal((await login(founder.email, "wrong-password-123")).status, 401);
    const body = ok(await login(founder.email)); ownerToken = body.token;
    assert.equal(typeof ownerToken, "string"); assert(body.principal.roleCodes.includes("FOUNDER_GM"));
    ok(await request("/auth/admin/users", { token: ownerToken }));
  });
  await check("default-off demo and direct linked sessions denied", async () => {
    denied(await request("/auth/demo/session", { method: "POST", body: {} }));
    denied(await request("/auth/lark/session", { method: "POST", body: { openId: providerProfile.open_id } }));
  });
  await check("session ownership and workspace boundaries", async () => {
    const otherToken = ok(await login(outsider.email, password, foreign.id)).token;
    const otherSessions = ok(await request("/auth/sessions", { token: otherToken })).data;
    denied(await request(`/auth/sessions/${otherSessions[0].id}/revoke`, { method: "POST", token: ownerToken, body: {} }));
    denied(await request("/auth/workspaces/switch", { method: "POST", token: ownerToken, body: { workspaceId: foreign.id } }));
    const second = ok(await login(founder.email)).token;
    ok(await request("/auth/sessions/revoke-others", { method: "POST", token: ownerToken, body: {} }));
    assert.equal((await request("/auth/me", { token: second })).status, 401);
  });
  await check("last Founder cannot self-deactivate or demote", async () => {
    denied(await request(`/auth/admin/users/${founder.id}/deactivate`, { method: "POST", token: ownerToken, body: {} }));
    denied(await request(`/auth/admin/users/${founder.id}/role`, { method: "PATCH", token: ownerToken, body: { roleCode: "SALES_OWNER" } }));
  });
  let invitee, memberToken;
  await check("invitation activation persists least role and is one-use", async () => {
    const email = `${run}-invited@example.test`;
    ok(await request("/auth/admin/invitations", { method: "POST", token: ownerToken, body: { email, displayName: "Invited Member", roleCode: "SALES_OWNER" } }));
    const token = await deliveredToken(email, "invitation");
    const body = ok(await request("/auth/invitations/activate", { method: "POST", body: { token, displayName: "Invited Member", password } }));
    memberToken = body.token; assert(body.principal.roleCodes.includes("SALES_OWNER"));
    assert(!body.principal.roleCodes.includes("FOUNDER_GM"));
    invitee = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal((await request("/auth/admin/users", { token: memberToken })).status, 403);
    const directory = ok(await request("/auth/workspace/users", { token: memberToken })).data;
    assert(directory.some(item => item.id === founder.id));
    assert(directory.every(item => !["passwordHash", "mfaSecret", "identities", "sessions"].some(field => field in item)));
    denied(await request("/auth/invitations/activate", { method: "POST", body: { token, displayName: "Replay", password } }));
  });
  await check("revoked invitation cannot be activated", async () => {
    const email = `${run}-revoked@example.test`;
    ok(await request("/auth/admin/invitations", { method: "POST", token: ownerToken, body: { email, displayName: "Revoked", roleCode: "SALES_OWNER" } }));
    const token = await deliveredToken(email, "invitation");
    const invitation = await prisma.portalInvitation.findFirstOrThrow({ where: { invitedEmail: email, workspaceId: workspace.id } });
    ok(await request(`/auth/admin/invitations/${invitation.id}/revoke`, { method: "POST", token: ownerToken, body: {} }));
    denied(await request("/auth/invitations/activate", { method: "POST", body: { token, displayName: "Revoked", password } }));
  });
  await check("recovery is generic, single-use and revokes existing sessions", async () => {
    const known = ok(await request("/auth/password/forgot", { method: "POST", body: { email: invitee.email } }));
    const unknown = ok(await request("/auth/password/forgot", { method: "POST", body: { email: `${run}-unknown@example.test` } }));
    assert.deepEqual(known, unknown);
    const token = await deliveredToken(invitee.email, "reset");
    ok(await request("/auth/password/reset", { method: "POST", body: { token, password: nextPassword } }));
    denied(await request("/auth/password/reset", { method: "POST", body: { token, password } }));
    assert.equal((await request("/auth/me", { token: memberToken })).status, 401);
    memberToken = ok(await login(invitee.email, nextPassword)).token;
  });
  let recoveryCodes;
  await check("MFA enrollment requires proof and revokes prior sessions", async () => {
    denied(await request("/auth/mfa/enroll", { method: "POST", token: memberToken, body: { password: "incorrect-password" } }));
    const setup = ok(await request("/auth/mfa/enroll", { method: "POST", token: memberToken, body: { password: nextPassword } }));
    const code = totpAt(setup.secret, Math.floor(Date.now() / 30000));
    const result = ok(await request("/auth/mfa/confirm", { method: "POST", token: memberToken, body: { code } }));
    recoveryCodes = result.recoveryCodes; assert.equal(recoveryCodes.length, 10);
    assert.equal((await request("/auth/me", { token: memberToken })).status, 401);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    assert(stored.mfaSecret !== setup.secret); assert(!stored.mfaRecoveryHashes.includes(recoveryCodes[0]));
  });
  await check("MFA challenge and recovery codes are one-use", async () => {
    const challenge = ok(await login(invitee.email, nextPassword)); assert.equal(challenge.mfaRequired, true); assert.equal(challenge.token, undefined);
    const body = { challengeToken: challenge.challengeToken, code: recoveryCodes[0] };
    memberToken = ok(await request("/auth/mfa/challenge", { method: "POST", body })).token;
    denied(await request("/auth/mfa/challenge", { method: "POST", body }));
    const second = ok(await login(invitee.email, nextPassword));
    denied(await request("/auth/mfa/challenge", { method: "POST", body: { challengeToken: second.challengeToken, code: recoveryCodes[0] } }));
    ok(await request("/auth/mfa/challenge", { method: "POST", body: { challengeToken: second.challengeToken, code: recoveryCodes[1] } }));
  });
  async function authorize(invitationToken) {
    const binding = invitationToken ? `&invitationTokenHash=${createHash("sha256").update(invitationToken).digest("hex")}` : "";
    return ok(await request(`/auth/lark/authorize-url?redirectUri=${encodeURIComponent("http://localhost:3000/api/auth/lark/callback")}&returnTo=%2Fusers${binding}`));
  }
  async function callback(state, invitationToken) {
    return request("/auth/lark/callback", { method: "POST", body: { state, invitationToken, code: "fixture-once", redirectUri: "http://localhost:3000/api/auth/lark/callback" } });
  }
  await check("SSO is retained and rejects state replay before provider calls", async () => {
    const auth = await authorize(); const response = ok(await callback(auth.state));
    assert.equal(response.principal.subjectId, founder.id);
    const calls = providerCalls; denied(await callback(auth.state)); assert.equal(providerCalls, calls);
  });
  await check("SSO cannot bypass enrolled account MFA", async () => {
    providerProfile = { ...providerProfile, open_id: `${run}-invited-lark`, email: invitee.email, name: invitee.displayName };
    await prisma.portalIdentity.create({ data: { provider: "lark", providerUserId: providerProfile.open_id, tenantKey: run, userId: invitee.id } });
    const auth = await authorize(); const body = ok(await callback(auth.state));
    assert.equal(body.mfaRequired, true); assert.equal(body.token, undefined);
  });
  await check("profile/email verification and protected MFA/password changes persist", async () => {
    ok(await request("/auth/account", { method: "PATCH", token: memberToken, body: { displayName: "Updated Member" } }));
    assert.equal(ok(await request("/auth/account", { token: memberToken })).displayName, "Updated Member");
    const email = `${run}-changed@example.test`;
    ok(await request("/auth/email/change-request", { method: "POST", token: memberToken, body: { email, password: nextPassword, code: recoveryCodes[2] } }));
    const verification = await deliveredToken(email, "verification");
    ok(await request("/auth/email/verify", { method: "POST", body: { token: verification } }));
    denied(await request("/auth/email/verify", { method: "POST", body: { token: verification } }));
    assert.equal((await request("/auth/me", { token: memberToken })).status, 401);
    const challenge = ok(await login(email, nextPassword));
    memberToken = ok(await request("/auth/mfa/challenge", { method: "POST", body: { challengeToken: challenge.challengeToken, code: recoveryCodes[3] } })).token;
    denied(await request("/auth/mfa/disable", { method: "POST", token: memberToken, body: { password: nextPassword, code: "invalid" } }));
    ok(await request("/auth/mfa/disable", { method: "POST", token: memberToken, body: { password: nextPassword, code: recoveryCodes[4] } }));
    assert.equal((await request("/auth/me", { token: memberToken })).status, 401);
    memberToken = ok(await login(email, nextPassword)).token;
    const changedPassword = `Final-${randomBytes(18).toString("base64url")}`;
    ok(await request("/auth/password/change", { method: "POST", token: memberToken, body: { currentPassword: nextPassword, newPassword: changedPassword } }));
    assert.equal((await request("/auth/me", { token: memberToken })).status, 401);
    ok(await login(email, changedPassword));
  });
  await check("suspended member cannot reactivate via SSO auto-provision", async () => {
    ok(await request(`/auth/admin/users/${invitee.id}/deactivate`, { method: "POST", token: ownerToken, body: {} }));
    process.env.CRM_LARK_AUTO_PROVISION = "true";
    const auth = await authorize(); denied(await callback(auth.state));
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } }); assert.equal(stored.status, "SUSPENDED");
    process.env.CRM_LARK_AUTO_PROVISION = "false";
  });
  await check("SSO invitation validates recipient and activates without a password", async () => {
    const email = `${run}-sso-only@example.test`;
    ok(await request("/auth/admin/invitations", { method: "POST", token: ownerToken, body: { email, displayName: "SSO Member", roleCode: "SALES_OWNER" } }));
    const token = await deliveredToken(email, "invitation");
    let auth = await authorize(token);
    denied(await callback(auth.state, token)); // Profile belongs to a different recipient.
    providerProfile = { ...providerProfile, open_id: `${run}-sso-only`, email, name: "SSO Member" };
    auth = await authorize(token);
    const body = ok(await callback(auth.state, token));
    assert(body.principal.roleCodes.includes("SALES_OWNER"));
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(stored.passwordHash, null);
    auth = await authorize(token); denied(await callback(auth.state, token));
  });
  await check("concurrent Founder demotions preserve one active Founder", async () => {
    const secondFounder = await user("second-founder");
    const secondToken = ok(await login(secondFounder.email)).token;
    const results = await Promise.all([
      request(`/auth/admin/users/${founder.id}/role`, { method: "PATCH", token: ownerToken, body: { roleCode: "SALES_OWNER" } }),
      request(`/auth/admin/users/${secondFounder.id}/role`, { method: "PATCH", token: secondToken, body: { roleCode: "SALES_OWNER" } })
    ]);
    assert.equal(results.filter(item => item.status >= 200 && item.status < 300).length, 1);
    assert.equal(results.filter(item => item.status >= 400 && item.status < 500).length, 1);
    assert.equal(await prisma.roleBinding.count({ where: { workspaceId: workspace.id, roleId: founderRole.id, endsAt: null, user: { status: "ACTIVE" } } }), 1);
  });
  await check("inactive default workspace is never implicitly reactivated", async () => {
    await prisma.tenantWorkspace.update({ where: { id: workspace.id }, data: { status: "suspended" } });
    denied(await login(founder.email));
    assert.equal((await prisma.tenantWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).status, "suspended");
  });
  console.log(`Native auth integration: ${passed} scenarios passed. Fixture namespace: ${run}`);
} finally {
  if (app) await app.close();
  await prisma.$disconnect();
  await new Promise(resolve => provider.close(resolve));
}
