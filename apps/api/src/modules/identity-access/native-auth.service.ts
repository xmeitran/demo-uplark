import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { PrincipalService } from "./principal.service";
import { TenantWorkspaceService } from "../tenant-workspace/tenant-workspace.service";
import { lockWorkspaceAuth } from "./auth-lifecycle-lock";
import { AuthMailService } from "./auth-mail.service";
import { AuthSecurityService, hashAuthToken, hashPassword, matchingTotpStep, newTotpSecret, randomAuthToken, verifyPassword } from "./auth-security.service";

type WorkspaceInput = { workspaceId?: string | null; workspaceKey?: string | null; tenantKey?: string | null };
type LoginMetadata = { authMethod?: string; userAgent?: string; ipAddress?: string; mfaVerifiedAt?: Date; authenticatedAt?: Date; expectedPasswordHash?: string | null; expectedMfaSecret?: string | null };
type Tx = Prisma.TransactionClient;
const INVALID = "Authentication failed or link is invalid or expired";
async function lockUser(tx: Tx, userId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user-auth:${userId}`})::bigint)`; }
function stringInput(value: unknown, name: string, max = 255): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException(`Invalid ${name}`);
  return value.trim();
}
function emailInput(value: unknown) { const email = stringInput(value, "email", 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Invalid email"); return email; }

@Injectable()
export class NativeAuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrincipalService) private readonly principals: PrincipalService,
    @Inject(TenantWorkspaceService) private readonly workspaces: TenantWorkspaceService,
    @Inject(AuthSecurityService) private readonly security: AuthSecurityService,
    @Inject(AuthMailService) private readonly mail: AuthMailService) {}

  capabilities() {
    const appId = process.env.LARK_APP_ID?.trim();
    const appSecret = process.env.LARK_APP_SECRET?.trim();
    const lark = Boolean(appId && appId !== "local-disabled" && appSecret && appSecret !== "local-disabled");
    return { password: true, invitations: true, mfa: true, registration: "invite-only", lark };
  }
  private async audit(tx: Tx, action: string, userId?: string, workspaceId?: string, resourceId?: string) {
    await tx.auditEvent.create({ data: { actorUserId: userId, workspaceId, action, resource: "auth", resourceId, requestId: randomUUID() } });
  }
  private async token(purpose: string, userId?: string, workspaceId?: string, payload?: Prisma.InputJsonValue, ttl = 900000) {
    const token = randomAuthToken(), expiresAt = new Date(Date.now() + ttl);
    await this.prisma.authActionToken.create({ data: { tokenHash: hashAuthToken(token), purpose, userId, workspaceId, payload, expiresAt } });
    return { token, expiresAt };
  }
  private async consume(tx: Tx, token: unknown, purpose: string) {
    const tokenHash = hashAuthToken(stringInput(token, "token", 512));
    const row = await tx.authActionToken.findUnique({ where: { tokenHash } });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt <= new Date()) throw new UnauthorizedException(INVALID);
    if (row.userId) await lockUser(tx, row.userId);
    const claimed = await tx.authActionToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) throw new UnauthorizedException(INVALID);
    return row;
  }
  private async requireUser(authorization?: string, principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.subjectId } });
    if (user.status !== "ACTIVE") throw new UnauthorizedException(INVALID);
    return { user, principal };
  }
  private async requireAdmin(authorization?: string) {
    const result = await this.requireUser(authorization);
    if (!result.principal.roleCodes.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN")) throw new ForbiddenException("Workspace administrator required");
    return result;
  }
  async login(body: any, metadata: LoginMetadata = {}) {
    const email = emailInput(body?.email);
    await this.security.limit("login-email", email, 12);
    await this.security.limit("login-ip", metadata.ipAddress ?? "unknown", 60);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await verifyPassword(body?.password, user?.passwordHash);
    if (!valid || !user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
      await this.audit(this.prisma, "auth.login.rejected", user?.id);
      throw new UnauthorizedException(INVALID);
    }
    let workspaceId = body.workspaceId ? stringInput(body.workspaceId, "workspaceId") : undefined;
    if (!workspaceId) {
      const membership = await this.prisma.roleBinding.findFirst({ where: { userId: user.id, workspace: { status: "active" }, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { createdAt: "asc" } });
      if (membership?.workspaceId) workspaceId = membership.workspaceId;
      else {
        const grant = await this.prisma.customerAccessGrant.findFirst({ where: { userId: user.id, workspace: { status: "active" }, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { createdAt: "asc" } });
        workspaceId = grant?.workspaceId;
      }
    }
    return this.completeIdentityLogin(user.id, { workspaceId }, { ...metadata, authMethod: "password", expectedPasswordHash: user.passwordHash });
  }
  async completeIdentityLogin(userId: string, workspaceInput?: WorkspaceInput, metadata: LoginMetadata = {}) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException(INVALID);
    const workspace = await this.workspaces.resolveWorkspace(workspaceInput);
    const member = await this.prisma.roleBinding.findFirst({ where: { userId, workspaceId: workspace.workspaceId, tenantKey: workspace.tenantKey, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
    const grant = member ? true : await this.prisma.customerAccessGrant.findFirst({ where: { userId, workspaceId: workspace.workspaceId, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
    if (!grant && !member) throw new UnauthorizedException(INVALID);
    if (user.mfaEnabledAt) {
      const challenge = await this.token("MFA_LOGIN", user.id, workspace.workspaceId, { authMethod: metadata.authMethod ?? "password", userAgent: metadata.userAgent ?? "", ipAddress: metadata.ipAddress ?? "", ...(metadata.expectedPasswordHash !== undefined ? { expectedPasswordHash: metadata.expectedPasswordHash } : {}) }, 300000);
      return { mfaRequired: true as const, challengeToken: challenge.token, expiresAt: challenge.expiresAt.toISOString() };
    }
    const session = await this.principals.createSessionForUser(user.id, workspace, metadata);
    await this.audit(this.prisma, "auth.login", user.id, workspace.workspaceId);
    return session;
  }
  private async verifyFactor(tx: Tx, user: User, code: unknown) {
    if (!user.mfaEnabledAt || !user.mfaSecret) throw new UnauthorizedException("MFA is not enabled");
    const normalized = stringInput(code, "code", 64);
    const recoveryHash = hashAuthToken(normalized);
    if (user.mfaRecoveryHashes.includes(recoveryHash)) {
      const consumed = await tx.user.updateMany({ where: { id: user.id, mfaRecoveryHashes: { has: recoveryHash } }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter(h => h !== recoveryHash) } });
      if (consumed.count !== 1) throw new UnauthorizedException(INVALID);
      await this.audit(tx, "auth.mfa.recovery_used", user.id);
      return;
    }
    const step = matchingTotpStep(this.security.decrypt(user.mfaSecret, user.id), normalized);
    if (step === null || (user.mfaLastStep !== null && step <= user.mfaLastStep)) throw new UnauthorizedException("Invalid or already used verification code");
    const consumed = await tx.user.updateMany({ where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
    if (consumed.count !== 1) throw new UnauthorizedException(INVALID);
  }
  async challenge(body: any, metadata: LoginMetadata = {}) {
    await this.security.limit("mfa-challenge", hashAuthToken(stringInput(body?.challengeToken, "challengeToken", 512)), 6, 300000);
    await this.security.limit("mfa-ip", metadata.ipAddress ?? "unknown", 60);
    const result = await this.prisma.$transaction(async tx => {
      const token = await this.consume(tx, body.challengeToken, "MFA_LOGIN");
      if (!token.userId || !token.workspaceId) throw new UnauthorizedException(INVALID);
      await lockUser(tx, token.userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.status !== "ACTIVE") throw new UnauthorizedException(INVALID);
      const payload = (token.payload ?? {}) as Record<string, unknown>;
      if (payload.expectedPasswordHash !== undefined && payload.expectedPasswordHash !== user.passwordHash) throw new UnauthorizedException(INVALID);
      await this.verifyFactor(tx, user, body.code);
      await this.audit(tx, "auth.mfa.verified", user.id, token.workspaceId);
      return { ...token, expectedMfaSecret: user.mfaSecret, expectedPasswordHash: user.passwordHash };
    });
    const payload = (result.payload ?? {}) as Record<string, string>;
    return this.principals.createSessionForUser(result.userId!, { workspaceId: result.workspaceId }, { authMethod: payload.authMethod ?? "password", userAgent: payload.userAgent, ipAddress: payload.ipAddress, mfaVerifiedAt: new Date(), expectedPasswordHash: result.expectedPasswordHash, expectedMfaSecret: result.expectedMfaSecret });
  }
  async forgot(body: any, ip = "unknown") {
    const email = emailInput(body?.email);
    await this.security.limit("reset-email", email, 3);
    await this.security.limit("reset-ip", ip, 30);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === "ACTIVE" && user.passwordHash && user.emailVerifiedAt) {
      const action = await this.token("PASSWORD_RESET", user.id);
      try { await this.mail.sendAction(email, "reset", action.token); } catch { await this.prisma.authActionToken.deleteMany({ where: { tokenHash: hashAuthToken(action.token) } }); await this.audit(this.prisma, "auth.password.reset_delivery_failed", user.id); }
    }
    return { accepted: true, message: "If the account is eligible, recovery instructions will be sent." };
  }
  async reset(body: any, ip = "unknown") {
    await this.security.limit("reset-complete", ip, 20);
    const passwordHash = await hashPassword(body?.password);
    await this.prisma.$transaction(async tx => {
      const token = await this.consume(tx, body?.token, "PASSWORD_RESET");
      if (!token.userId) throw new UnauthorizedException(INVALID);
      await lockUser(tx, token.userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.status !== "ACTIVE" || !user.passwordHash) throw new UnauthorizedException(INVALID);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.revokeSecurity(tx, user.id);
      await this.audit(tx, "auth.password.reset", user.id);
    });
    return { reset: true };
  }
  private async revokeSecurity(tx: Tx, userId: string) {
    await tx.portalSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.authActionToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
  }
  async account(authorization?: string, principalFallback?: string) {
    const { user } = await this.requireUser(authorization, principalFallback);
    const identities = await this.prisma.portalIdentity.findMany({ where: { userId: user.id }, select: { provider: true } });
    return { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, emailVerified: !!user.emailVerifiedAt, passwordEnabled: !!user.passwordHash, mfaEnabled: !!user.mfaEnabledAt, identities, createdAt: user.createdAt };
  }
  async updateAccount(authorization: string | undefined, body: any) {
    const { user, principal } = await this.requireUser(authorization);
    const displayName = stringInput(body?.displayName, "displayName", 120);
    let avatarUrl: string | null | undefined;
    if (body.avatarUrl !== undefined) {
      avatarUrl = body.avatarUrl ? stringInput(body.avatarUrl, "avatarUrl", 2048) : null;
      if (avatarUrl) { try { if (new URL(avatarUrl).protocol !== "https:") throw new Error(); } catch { throw new BadRequestException("Avatar URL must use HTTPS"); } }
    }
    await this.prisma.$transaction(async tx => { await lockUser(tx, user.id); await this.assertCurrentSession(tx, authorization, user.id); await tx.user.update({ where: { id: user.id }, data: { displayName, avatarUrl } }); await this.audit(tx, "auth.profile.updated", user.id, principal.workspaceId); });
    return this.account(authorization);
  }
  private async reauthenticate(authorization: string | undefined, user: User, password: unknown) {
    if (user.passwordHash) {
      await this.security.limit("reauth", user.id, 10);
      if (!await verifyPassword(password, user.passwordHash)) throw new UnauthorizedException("Current password is required");
      return;
    }
    const raw = authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const session = await this.prisma.portalSession.findUnique({ where: { tokenHash: hashAuthToken(raw) } });
    if (!session || session.userId !== user.id || session.authMethod !== "lark" || session.revokedAt || session.authenticatedAt < new Date(Date.now() - 300000)) throw new UnauthorizedException("Sign in again using SSO before changing security settings");
  }
  private async assertCurrentSession(tx: Tx, authorization: string | undefined, userId: string) {
    const raw = authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const session = await tx.portalSession.findUnique({ where: { tokenHash: hashAuthToken(raw) } });
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException(INVALID);
  }
  async changePassword(authorization: string | undefined, body: any) {
    const { user } = await this.requireUser(authorization);
    await this.reauthenticate(authorization, user, body?.currentPassword);
    const passwordHash = await hashPassword(body?.newPassword);
    await this.prisma.$transaction(async tx => {
      await lockUser(tx, user.id); await this.assertCurrentSession(tx, authorization, user.id); const latest = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (latest.passwordHash !== user.passwordHash || latest.status !== "ACTIVE") throw new UnauthorizedException(INVALID);
      if (latest.mfaEnabledAt) await this.verifyFactor(tx, latest, body.code);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.revokeSecurity(tx, user.id); await this.audit(tx, "auth.password.changed", user.id);
    });
    return { changed: true, signInRequired: true };
  }
  async enrollMfa(authorization: string | undefined, body: any) {
    const { user } = await this.requireUser(authorization);
    await this.reauthenticate(authorization, user, body?.password);
    const secret = newTotpSecret(); const encrypted = this.security.encrypt(secret, user.id);
    await this.prisma.$transaction(async tx => {
      await lockUser(tx, user.id); await this.assertCurrentSession(tx, authorization, user.id); const latest = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (latest.mfaEnabledAt || latest.status !== "ACTIVE" || latest.passwordHash !== user.passwordHash) throw new ConflictException("MFA already enabled or account changed");
      await tx.user.update({ where: { id: user.id }, data: { mfaPendingSecret: encrypted } });
      await tx.authActionToken.updateMany({ where: { userId: user.id, purpose: "MFA_ENROLL", consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.authActionToken.create({ data: { tokenHash: hashAuthToken(randomAuthToken()), purpose: "MFA_ENROLL", userId: user.id, expiresAt: new Date(Date.now() + 300000) } });
    });
    return { secret, otpauthUrl: `otpauth://totp/${encodeURIComponent(`CRM:${user.email}`)}?secret=${secret}&issuer=CRM&algorithm=SHA1&digits=6&period=30` };
  }
  async confirmMfa(authorization: string | undefined, body: any) {
    const { user } = await this.requireUser(authorization); await this.security.limit("mfa-enroll", user.id, 6, 300000);
    const recoveryCodes = Array.from({ length: 10 }, () => randomAuthToken().slice(0, 16));
    await this.prisma.$transaction(async tx => {
      await lockUser(tx, user.id); await this.assertCurrentSession(tx, authorization, user.id); const latest = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const enrollment = await tx.authActionToken.findFirst({ where: { userId: user.id, purpose: "MFA_ENROLL", consumedAt: null, expiresAt: { gt: new Date() } } });
      if (latest.mfaEnabledAt || !latest.mfaPendingSecret || !enrollment || latest.status !== "ACTIVE") throw new BadRequestException("Start MFA enrollment again");
      const step = matchingTotpStep(this.security.decrypt(latest.mfaPendingSecret, user.id), body?.code);
      if (step === null) throw new UnauthorizedException("Invalid verification code");
      await tx.user.update({ where: { id: user.id }, data: { mfaSecret: latest.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryHashes: recoveryCodes.map(hashAuthToken) } });
      await this.revokeSecurity(tx, user.id); await this.audit(tx, "auth.mfa.enabled", user.id);
    });
    return { enabled: true, recoveryCodes, signInRequired: true };
  }
  async disableMfa(authorization: string | undefined, body: any) {
    const { user } = await this.requireUser(authorization); await this.security.limit("mfa-disable", user.id, 6);
    await this.reauthenticate(authorization, user, body?.password);
    await this.prisma.$transaction(async tx => {
      await lockUser(tx, user.id); await this.assertCurrentSession(tx, authorization, user.id); const latest = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (latest.status !== "ACTIVE" || latest.passwordHash !== user.passwordHash) throw new UnauthorizedException(INVALID);
      await this.verifyFactor(tx, latest, body?.code);
      await tx.user.update({ where: { id: user.id }, data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
      await this.revokeSecurity(tx, user.id); await this.audit(tx, "auth.mfa.disabled", user.id);
    });
    return { enabled: false, signInRequired: true };
  }
  async requestVerification(authorization?: string) {
    const { user } = await this.requireUser(authorization); await this.security.limit("verify-email", user.id, 3);
    if (!user.emailVerifiedAt) { const action = await this.token("EMAIL_VERIFY", user.id, undefined, { email: user.email }); await this.mail.sendAction(user.email, "verification", action.token); }
    return { accepted: true };
  }
  async requestEmailChange(authorization: string | undefined, body: any) {
    const { user } = await this.requireUser(authorization); await this.security.limit("change-email", user.id, 3);
    await this.reauthenticate(authorization, user, body?.password);
    const email = emailInput(body?.email);
    if (email === user.email) throw new BadRequestException("Email is unchanged");
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException("Email unavailable");
    const action = { token: randomAuthToken() };
    await this.prisma.$transaction(async tx => { await lockUser(tx, user.id); await this.assertCurrentSession(tx, authorization, user.id); const latest = await tx.user.findUniqueOrThrow({ where: { id: user.id } }); if (latest.passwordHash !== user.passwordHash || latest.status !== "ACTIVE") throw new UnauthorizedException(INVALID); if (latest.mfaEnabledAt) await this.verifyFactor(tx, latest, body?.code); await tx.authActionToken.create({ data: { tokenHash: hashAuthToken(action.token), userId: user.id, purpose: "EMAIL_CHANGE", payload: { email, previousEmail: user.email }, expiresAt: new Date(Date.now() + 900000) } }); });
    await this.mail.sendAction(email, "verification", action.token);
    return { accepted: true };
  }
  async verifyEmail(body: any, ip = "unknown") {
    await this.security.limit("verify-complete", ip, 30);
    const raw = stringInput(body?.token, "token", 512);
    const found = await this.prisma.authActionToken.findUnique({ where: { tokenHash: hashAuthToken(raw) } });
    if (!found || !["EMAIL_VERIFY", "EMAIL_CHANGE"].includes(found.purpose)) throw new UnauthorizedException(INVALID);
    await this.prisma.$transaction(async tx => {
      const action = await this.consume(tx, raw, found.purpose);
      if (!action.userId) throw new UnauthorizedException(INVALID);
      await lockUser(tx, action.userId); const user = await tx.user.findUniqueOrThrow({ where: { id: action.userId } });
      const payload = action.payload as { email?: string; previousEmail?: string };
      if (user.status !== "ACTIVE" || !payload.email || (action.purpose === "EMAIL_VERIFY" ? user.email !== payload.email : user.email !== payload.previousEmail)) throw new UnauthorizedException(INVALID);
      await tx.user.update({ where: { id: user.id }, data: { email: payload.email, emailVerifiedAt: new Date() } });
      await this.revokeSecurity(tx, user.id); await this.audit(tx, "auth.email.verified", user.id);
    });
    return { verified: true, signInRequired: true };
  }
  private async assertAdminLocked(tx: Tx, authorization: string | undefined, userId: string, workspaceId: string) {
    await lockWorkspaceAuth(tx, workspaceId);
    const adminBinding = await tx.roleBinding.findFirst({ where: { userId, workspaceId, user: { status: "ACTIVE" }, workspace: { status: "active" }, role: { code: { in: ["FOUNDER_GM", "WORKSPACE_ADMIN"] } }, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
    if (!adminBinding) throw new ForbiddenException("Workspace administrator required");
    await this.assertCurrentSession(tx, authorization, userId);
  }
  async listInvitations(authorization?: string) {
    const { principal } = await this.requireAdmin(authorization);
    const rows = await this.prisma.portalInvitation.findMany({ where: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey }, orderBy: { createdAt: "desc" }, take: 100 });
    return { data: rows.map(row => ({ id: row.id, email: row.invitedEmail, displayName: row.requestedName, roleCode: row.roleCode, status: row.status === "PENDING" && row.expiresAt < new Date() ? "EXPIRED" : row.status, expiresAt: row.expiresAt, createdAt: row.createdAt })) };
  }
  async createInvitation(authorization: string | undefined, body: any) {
    const { user: actor, principal } = await this.requireAdmin(authorization);
    await this.security.limit("invite", actor.id, 30);
    const email = emailInput(body?.email), roleCode = stringInput(body?.roleCode, "roleCode");
    const allowed = ["FOUNDER_GM", "SALES_OWNER", "DELIVERY_LEAD", "FINANCE_ADMIN"];
    if (!allowed.includes(roleCode)) throw new BadRequestException("Invalid invitation role");
    if (!principal.workspaceId) throw new ForbiddenException("Workspace required");
    const token = randomAuthToken(); const expiresAt = new Date(Date.now() + 48 * 3600000);
    const invitation = await this.prisma.$transaction(async tx => {
      await this.assertAdminLocked(tx, authorization, actor.id, principal.workspaceId!);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${principal.workspaceId}:${email}`})::bigint)`;
      await tx.portalInvitation.updateMany({ where: { workspaceId: principal.workspaceId, invitedEmail: email, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      const row = await tx.portalInvitation.create({ data: { invitedEmail: email, requestedName: body.displayName ? stringInput(body.displayName, "displayName", 120) : undefined, roleCode, scope: "GLOBAL", tenantKey: principal.tenantKey, workspaceId: principal.workspaceId, tokenHash: hashAuthToken(token), invitedByUserId: actor.id, expiresAt } });
      await this.audit(tx, "auth.invitation.created", actor.id, principal.workspaceId, row.id); return row;
    });
    let delivery: "spool" | "smtp";
    try { delivery = await this.mail.sendAction(email, "invitation", token); } catch (error) { await this.prisma.portalInvitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } }); throw error; }
    return { id: invitation.id, email, roleCode, status: invitation.status, expiresAt, delivery };
  }
  async revokeInvitation(authorization: string | undefined, id: string) {
    const { user, principal } = await this.requireAdmin(authorization);
    const result = await this.prisma.$transaction(async tx => { if (!principal.workspaceId) throw new ForbiddenException("Workspace required"); await this.assertAdminLocked(tx, authorization, user.id, principal.workspaceId); const result = await tx.portalInvitation.updateMany({ where: { id, workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } }); if (result.count) await this.audit(tx, "auth.invitation.revoked", user.id, principal.workspaceId, id); return result; });
    return { revoked: result.count === 1 };
  }
  async activateInvitation(authorization: string | undefined, body: any, metadata: LoginMetadata = {}) {
    await this.security.limit("invite-accept-ip", metadata.ipAddress ?? "unknown", 20);
    const tokenHash = hashAuthToken(stringInput(body?.token ?? body?.invitationToken, "token", 512));
    const invitation = await this.prisma.portalInvitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) throw new UnauthorizedException(INVALID);
    const existing = await this.prisma.user.findUnique({ where: { email: invitation.invitedEmail } });
    let existingProof: string | undefined;
    if (existing) {
      const principal = await this.principals.resolveFromAuthorization(authorization);
      if (principal.subjectId !== existing.id || principal.email?.toLowerCase() !== invitation.invitedEmail) throw new ForbiddenException("Sign in as the invited account first");
      existingProof = existing.id;
    }
    const passwordHash = existing ? undefined : await hashPassword(body?.password);
    const displayName = existing ? existing.displayName : stringInput(body?.displayName ?? invitation.requestedName, "displayName", 120);
    const userId = await this.prisma.$transaction(async tx => {
      await lockWorkspaceAuth(tx, invitation.workspaceId);
      const claimed = await tx.portalInvitation.updateMany({ where: { id: invitation.id, status: "PENDING", expiresAt: { gt: new Date() }, consumedAt: null }, data: { status: "ACCEPTED", consumedAt: new Date() } });
      if (claimed.count !== 1) throw new UnauthorizedException(INVALID);
      const workspace = await tx.tenantWorkspace.findUnique({ where: { id: invitation.workspaceId } });
      if (!workspace || workspace.status !== "active" || workspace.tenantKey !== invitation.tenantKey) throw new UnauthorizedException(INVALID);
      let user = await tx.user.findUnique({ where: { email: invitation.invitedEmail } });
      if (user) {
        await lockUser(tx, user.id);
        await this.assertCurrentSession(tx, authorization, user.id);
        user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (user.status !== "ACTIVE" || user.id !== existingProof || user.subjectType !== "INTERNAL_USER") throw new ForbiddenException("Existing account requires matching authenticated identity");
      } else {
        if (!passwordHash) throw new UnauthorizedException(INVALID);
        user = await tx.user.create({ data: { email: invitation.invitedEmail, displayName, passwordHash, emailVerifiedAt: new Date(), subjectType: "INTERNAL_USER", status: "ACTIVE" } });
      }
      const suspendedMembership = await tx.roleBinding.findFirst({ where: { userId: user.id, workspaceId: invitation.workspaceId, endsAt: { lte: new Date() } } });
      const activeMembership = await tx.roleBinding.findFirst({ where: { userId: user.id, workspaceId: invitation.workspaceId, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
      if (suspendedMembership && !activeMembership) throw new ForbiddenException("Suspended membership requires administrator reactivation");
      const role = await tx.role.findUnique({ where: { code: invitation.roleCode } });
      if (!role || !["FOUNDER_GM", "SALES_OWNER", "DELIVERY_LEAD", "FINANCE_ADMIN"].includes(role.code)) throw new BadRequestException("Invitation role unavailable");
      const previous = await tx.roleBinding.findUnique({ where: { userId_roleId_tenantKey_workspaceId: { userId: user.id, roleId: role.id, tenantKey: invitation.tenantKey, workspaceId: invitation.workspaceId } } });
      if (previous?.endsAt && previous.endsAt <= new Date()) throw new ForbiddenException("Suspended membership requires administrator reactivation");
      if (!previous) await tx.roleBinding.create({ data: { userId: user.id, roleId: role.id, workspaceId: invitation.workspaceId, tenantKey: invitation.tenantKey } });
      await tx.portalInvitation.update({ where: { id: invitation.id }, data: { activatedUserId: user.id } });
      await this.audit(tx, "auth.invitation.accepted", user.id, invitation.workspaceId, invitation.id);
      return user.id;
    });
    return this.completeIdentityLogin(userId, { workspaceId: invitation.workspaceId }, { ...metadata, authMethod: "password" });
  }
  // Only the verified provider callback may invoke this; never expose profile proof in a public route.
  async acceptSsoInvitation(token: string, profile: { openId: string; email?: string; enterpriseEmail?: string; displayName: string; avatarUrl?: string }, workspace: { workspaceId: string; tenantKey: string; workspaceKey?: string }) {
    const tokenHash = hashAuthToken(stringInput(token, "invitation token", 512));
    return this.prisma.$transaction(async tx => {
      await lockWorkspaceAuth(tx, workspace.workspaceId);
      const invitation = await tx.portalInvitation.findUnique({ where: { tokenHash } });
      if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt <= new Date() || invitation.workspaceId !== workspace.workspaceId || invitation.tenantKey !== workspace.tenantKey) throw new UnauthorizedException(INVALID);
      const emails = [profile.email, profile.enterpriseEmail].filter((email): email is string => !!email).map(email => email.toLowerCase().trim());
      if (!emails.includes(invitation.invitedEmail)) throw new ForbiddenException("SSO email does not match the invitation recipient");
      const activeWorkspace = await tx.tenantWorkspace.findUnique({ where: { id: workspace.workspaceId } });
      if (!activeWorkspace || activeWorkspace.status !== "active") throw new UnauthorizedException(INVALID);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${workspace.workspaceId}:${invitation.invitedEmail}`})::bigint)`;
      const claimed = await tx.portalInvitation.updateMany({ where: { id: invitation.id, status: "PENDING", consumedAt: null, expiresAt: { gt: new Date() } }, data: { status: "ACCEPTED", consumedAt: new Date() } });
      if (claimed.count !== 1) throw new UnauthorizedException(INVALID);
      let user = await tx.user.findUnique({ where: { email: invitation.invitedEmail } });
      const linked = await tx.portalIdentity.findUnique({ where: { provider_providerUserId_tenantKey: { provider: "lark", providerUserId: profile.openId, tenantKey: workspace.tenantKey } } });
      if (linked && linked.userId !== user?.id) throw new ConflictException("SSO identity belongs to another account");
      if (user) {
        await lockUser(tx, user.id); user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (user.status !== "ACTIVE" || user.subjectType !== "INTERNAL_USER") throw new ForbiddenException("Existing account cannot be activated by SSO invitation");
        const suspended = await tx.roleBinding.findFirst({ where: { userId: user.id, workspaceId: workspace.workspaceId, endsAt: { lte: new Date() } } });
        const active = await tx.roleBinding.findFirst({ where: { userId: user.id, workspaceId: workspace.workspaceId, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
        if (suspended && !active) throw new ForbiddenException("Suspended membership requires administrator reactivation");
        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
      } else {
        user = await tx.user.create({ data: { email: invitation.invitedEmail, displayName: stringInput(profile.displayName, "displayName", 120), avatarUrl: profile.avatarUrl, status: "ACTIVE", subjectType: "INTERNAL_USER", emailVerifiedAt: new Date() } });
      }
      if (!linked) await tx.portalIdentity.create({ data: { userId: user.id, provider: "lark", providerUserId: profile.openId, tenantKey: workspace.tenantKey } });
      const role = await tx.role.findUnique({ where: { code: invitation.roleCode } });
      if (!role || !["FOUNDER_GM", "SALES_OWNER", "DELIVERY_LEAD", "FINANCE_ADMIN"].includes(role.code)) throw new BadRequestException("Invitation role unavailable");
      const priorRole = await tx.roleBinding.findUnique({ where: { userId_roleId_tenantKey_workspaceId: { userId: user.id, roleId: role.id, tenantKey: workspace.tenantKey, workspaceId: workspace.workspaceId } } });
      if (priorRole?.endsAt && priorRole.endsAt <= new Date()) throw new ForbiddenException("Suspended role requires administrator reactivation");
      await tx.roleBinding.upsert({ where: { userId_roleId_tenantKey_workspaceId: { userId: user.id, roleId: role.id, tenantKey: workspace.tenantKey, workspaceId: workspace.workspaceId } }, update: {}, create: { userId: user.id, roleId: role.id, tenantKey: workspace.tenantKey, workspaceId: workspace.workspaceId } });
      await tx.portalInvitation.update({ where: { id: invitation.id }, data: { activatedUserId: user.id } });
      await this.audit(tx, "auth.invitation.accepted_sso", user.id, workspace.workspaceId, invitation.id);
      return { userId: user.id, workspaceId: workspace.workspaceId, tenantKey: workspace.tenantKey };
    });
  }

}
