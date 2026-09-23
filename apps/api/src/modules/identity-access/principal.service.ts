import { activeMembershipWhere } from "./active-membership";
import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { lockUserAuth } from "./auth-lifecycle-lock";
import { createHash, randomBytes } from "node:crypto";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { bearerToken } from "../../shared/http/request-context";
import { TenantWorkspaceService, type WorkspaceContext } from "../tenant-workspace/tenant-workspace.service";

export interface SessionMetadata {
  authMethod?: string;
  userAgent?: string;
  ipAddress?: string;
  mfaVerifiedAt?: Date;
  authenticatedAt?: Date;
  expectedPasswordHash?: string | null;
  expectedMfaSecret?: string | null;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function canUsePrincipalFallback({
  crmAllowPrincipalFallback = process.env.CRM_ALLOW_PRINCIPAL_FALLBACK,
  crmPublicSessionRequired = process.env.CRM_PUBLIC_SESSION_REQUIRED,
  nodeEnv = process.env.NODE_ENV
}: {
  crmAllowPrincipalFallback?: string;
  crmPublicSessionRequired?: string;
  nodeEnv?: string;
} = {}) {
  if (nodeEnv === "production") {
    return false;
  }

  if (crmAllowPrincipalFallback !== "true") {
    return false;
  }

  if (crmPublicSessionRequired === "1") {
    return false;
  }

  return true;
}

@Injectable()
export class PrincipalService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TenantWorkspaceService)
    private readonly workspaces: TenantWorkspaceService
  ) {}

  async resolveFromAuthorization(authorization?: string, principalFallback?: string) {
    const token = bearerToken(authorization);
    if (token) {
      return this.resolveSessionToken(token);
    }

    if (principalFallback && canUsePrincipalFallback()) {
      return this.resolveFallbackPrincipal(principalFallback);
    }

    throw new UnauthorizedException("Bearer session is required");
  }

  async resolveSessionToken(token: string) {
    const session = await this.prisma.portalSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: {
        workspace: true,
        user: {
          include: {
            roleBindings: { where: { ...activeMembershipWhere() }, include: { role: true } },
            customerGrants: {
              where: { startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }
            }
          }
        }
      }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE" || session.workspace.status !== "active" || (session.user.mfaEnabledAt && !session.mfaVerifiedAt)) {
      throw new UnauthorizedException("Session is invalid or expired");
    }

    const workspace = this.workspaces.toContext(session.workspace);
    const scopedUser = {
      ...session.user,
      roleBindings: session.user.roleBindings.filter((binding) => {
        return binding.tenantKey === workspace.tenantKey && binding.workspaceId === workspace.workspaceId;
      }),
      customerGrants: session.user.customerGrants.filter((grant) => grant.workspaceId === workspace.workspaceId)
    };

    if (!scopedUser.roleBindings.length && !scopedUser.customerGrants.length) {
      throw new UnauthorizedException("Active workspace membership is required");
    }
    await this.prisma.portalSession.updateMany({
      where: { id: session.id, revokedAt: null }, data: { lastSeenAt: new Date() }
    });

    return this.mapPrincipal(scopedUser, this.roleVersion(scopedUser.roleBindings), this.grantVersion(scopedUser.customerGrants), workspace);
  }

  async createSessionForUser(userId: string, workspaceInput?: { workspaceId?: string | null; workspaceKey?: string | null; tenantKey?: string | null }, metadata: SessionMetadata = {}) {
    const workspace = await this.workspaces.resolveWorkspace(workspaceInput);
    return this.prisma.$transaction(async (tx) => {
      await lockUserAuth(tx, userId);
      return this.createSessionInTransaction(tx, userId, workspace, metadata);
    });
  }

  private async createSessionInTransaction(tx: import("@prisma/client").Prisma.TransactionClient, userId: string, workspace: WorkspaceContext, metadata: SessionMetadata) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: {
        roleBindings: { where: { ...activeMembershipWhere(), tenantKey: workspace.tenantKey, workspaceId: workspace.workspaceId }, include: { role: true } },
        customerGrants: { where: { workspaceId: workspace.workspaceId, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } }
      }
    });
    const currentWorkspace = await tx.tenantWorkspace.findUnique({ where: { id: workspace.workspaceId } });
    if (!user || user.status !== "ACTIVE" || currentWorkspace?.status !== "active" || (!user.roleBindings.length && !user.customerGrants.length)) {
      throw new UnauthorizedException("Active user and workspace membership are required");
    }
    if ((metadata.expectedPasswordHash !== undefined && user.passwordHash !== metadata.expectedPasswordHash)
      || (metadata.expectedMfaSecret !== undefined && user.mfaSecret !== metadata.expectedMfaSecret)) {
      throw new UnauthorizedException("Authentication changed; sign in again");
    }
    if (user.mfaEnabledAt && !metadata.mfaVerifiedAt) throw new UnauthorizedException("Multi-factor authentication is required");
    const token = randomBytes(32).toString("base64url");
    const configuredTtl = Number(process.env.CRM_SESSION_TTL_MS ?? SESSION_TTL_MS);
    const ttl = Number.isFinite(configuredTtl) && configuredTtl > 0 ? Math.min(configuredTtl, 7 * 86400000) : SESSION_TTL_MS;
    const expiresAt = new Date(Date.now() + ttl);
    const roleVersion = this.roleVersion(user.roleBindings);
    const grantVersion = this.grantVersion(user.customerGrants);
    await tx.portalSession.create({ data: {
      userId, tenantKey: workspace.tenantKey, workspaceId: workspace.workspaceId,
      tokenHash: this.hashToken(token), roleVersion, grantVersion, expiresAt,
      authMethod: metadata.authMethod ?? "legacy", userAgent: metadata.userAgent?.slice(0, 512),
      ipAddress: metadata.ipAddress?.slice(0, 64), mfaVerifiedAt: metadata.mfaVerifiedAt,
      authenticatedAt: metadata.authenticatedAt ?? new Date()
    } });
    return { token, expiresAt: expiresAt.toISOString(), principal: this.mapPrincipal(user, roleVersion, grantVersion, workspace) };
  }

  async listSessions(authorization?: string, principalFallback?: string) {
    const principal = await this.resolveFromAuthorization(authorization, principalFallback);
    const currentToken = bearerToken(authorization);
    const currentHash = currentToken ? this.hashToken(currentToken) : undefined;
    const sessions = await this.prisma.portalSession.findMany({
      where: { userId: principal.subjectId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 100
    });
    return { data: sessions.map((session) => ({
      id: session.id, current: currentHash ? session.tokenHash === currentHash : false, workspaceId: session.workspaceId,
      createdAt: session.createdAt.toISOString(), lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(), userAgent: session.userAgent, authMethod: session.authMethod
    })) };
  }

  async revokeOwnSession(authorization: string | undefined, sessionId?: string, others = false) {
    const principal = await this.resolveFromAuthorization(authorization);
    const currentHash = this.hashToken(bearerToken(authorization)!);
    return this.prisma.$transaction(async (tx) => {
      await lockUserAuth(tx, principal.subjectId);
      const result = await tx.portalSession.updateMany({
        where: { userId: principal.subjectId, revokedAt: null, ...(others ? { tokenHash: { not: currentHash } } : { id: sessionId }) }, data: { revokedAt: new Date() }
      });
      if (!others && !result.count) throw new NotFoundException("Session not found");
      return { revokedSessions: result.count };
    });
  }

  async listOwnWorkspaces(authorization?: string, principalFallback?: string) {
    const principal = await this.resolveFromAuthorization(authorization, principalFallback);
    const workspaces = await this.prisma.tenantWorkspace.findMany({
      where: { status: "active", OR: [
        { roleBindings: { some: { userId: principal.subjectId, ...activeMembershipWhere() } } },
        { customerGrants: { some: { userId: principal.subjectId, startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } } }
      ] }, orderBy: { name: "asc" }
    });
    return { data: workspaces.map((workspace) => ({ id: workspace.id, workspaceKey: workspace.workspaceKey, name: workspace.name, current: workspace.id === principal.workspaceId })) };
  }

  async switchWorkspace(authorization: string | undefined, workspaceId: string) {
    const principal = await this.resolveFromAuthorization(authorization);
    const workspace = await this.workspaces.resolveWorkspace({ workspaceId });
    return this.prisma.$transaction(async (tx) => {
      await lockUserAuth(tx, principal.subjectId);
      const current = await tx.portalSession.findUnique({ where: { tokenHash: this.hashToken(bearerToken(authorization)!) } });
      if (!current || current.revokedAt || current.expiresAt <= new Date()) throw new UnauthorizedException("Session is invalid or expired");
      const next = await this.createSessionInTransaction(tx, principal.subjectId, workspace, {
        authMethod: current.authMethod, userAgent: current.userAgent ?? undefined, ipAddress: current.ipAddress ?? undefined,
        mfaVerifiedAt: current.mfaVerifiedAt ?? undefined, authenticatedAt: current.authenticatedAt
      });
      await tx.portalSession.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
      return next;
    });
  }

  async revokeSessionToken(token: string) {
    const session = await this.prisma.portalSession.findUnique({
      where: { tokenHash: this.hashToken(token) }
    });

    if (!session) {
      return { revoked: false };
    }

    await this.prisma.portalSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    });

    return { revoked: true };
  }

  async resolveFallbackPrincipal(fallback: string) {
    const workspace = await this.workspaces.resolveWorkspace();
    const normalized = fallback.trim();
    const founderRoleCode = process.env.FOUNDATION_ADMIN_ROLE ?? "FOUNDER_GM";
    const where =
      normalized === "founder"
        ? {
            roleBindings: {
              some: {
                ...activeMembershipWhere(),
                tenantKey: workspace.tenantKey,
                workspaceId: workspace.workspaceId,
                role: { code: founderRoleCode }
              }
            }
          }
        : { OR: [{ id: normalized }, { email: normalized }] };

    const user = await this.prisma.user.findFirst({
      where: { status: "ACTIVE", ...where },
      include: {
        roleBindings: {
          where: {
            ...activeMembershipWhere(),
            tenantKey: workspace.tenantKey,
            workspaceId: workspace.workspaceId
          },
          include: { role: true }
        },
        customerGrants: {
          where: {
            workspaceId: workspace.workspaceId,
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }]
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    if (!user) {
      throw new UnauthorizedException("Fallback principal could not be resolved");
    }

    return this.mapPrincipal(user, this.roleVersion(user.roleBindings), this.grantVersion(user.customerGrants), workspace);
  }

  hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private mapPrincipal(
    user: {
      id: string;
      email: string;
      displayName: string;
      avatarUrl?: string | null;
      subjectType: string;
      roleBindings: Array<{ id: string; tenantKey: string; workspaceId?: string | null; role: { code: string } }>;
      customerGrants: Array<{ accountId?: string | null; projectId?: string | null }>;
    },
    roleVersion: string,
    grantVersion: string,
    workspace: WorkspaceContext
  ): PrincipalContext {
    const roleCodes = user.roleBindings.map((binding) => binding.role.code);
    const customerAccountIds = user.customerGrants.flatMap((grant) => (grant.accountId ? [grant.accountId] : []));
    const customerProjectIds = user.customerGrants.flatMap((grant) => (grant.projectId ? [grant.projectId] : []));

    return {
      subjectType: user.subjectType === "PORTAL_USER" ? "portal_user" : "internal_user",
      subjectId: user.id,
      tenantKey: workspace.tenantKey,
      workspaceId: workspace.workspaceId,
      workspaceKey: workspace.workspaceKey,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl ?? undefined,
      roleCodes,
      accountIds: customerAccountIds,
      projectIds: customerProjectIds,
      customerAccountIds,
      customerProjectIds,
      roleVersion,
      grantVersion
    };
  }

  private roleVersion(roleBindings: Array<{ id: string; role: { code: string } }>) {
    return `roles:${roleBindings.map((binding) => `${binding.role.code}:${binding.id}`).sort().join("|")}`;
  }

  private grantVersion(grants: Array<{ accountId?: string | null; projectId?: string | null }>) {
    return `grants:${grants.map((grant) => `${grant.accountId ?? "*"}:${grant.projectId ?? "*"}`).sort().join("|")}`;
  }
}
