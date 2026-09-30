import { activeMembershipWhere, isActiveMembership } from "./active-membership";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminAccessMemberSummary, CostPermissionCode, CreateInternalUserInput, EmploymentStatus, InternalRoleCode } from "@b2b-crm/contracts";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { nonEmptyString, optionalString } from "../../shared/http/request-context";
import { TenantWorkspaceService } from "../tenant-workspace/tenant-workspace.service";
import { ensureAnotherFounder, lockUserAuth, lockWorkspaceAuth } from "./auth-lifecycle-lock";
import { PrincipalService } from "./principal.service";

const COST_PERMISSION_CODES: CostPermissionCode[] = ["COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"];
const INTERNAL_ROLE_CODES: InternalRoleCode[] = ["FOUNDER_GM", "WORKSPACE_ADMIN", "WORKSPACE_USER", "SALES_OWNER", "DELIVERY_LEAD", "FINANCE_ADMIN", ...COST_PERMISSION_CODES];

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TenantWorkspaceService)
    private readonly workspaces: TenantWorkspaceService,
    @Inject(PrincipalService)
    private readonly principals: PrincipalService
  ) {}

  async createDemoSession() {
    if (process.env.NODE_ENV === "production" || process.env.CRM_ENABLE_DEMO_SESSION !== "true" || process.env.CRM_LOCAL_AUTH_ENABLED !== "true") {
      throw new ForbiddenException("Demo sessions are disabled in production");
    }

    const adminUserId = process.env.FOUNDATION_ADMIN_USER_ID?.trim();
    const adminEmail = process.env.FOUNDATION_ADMIN_EMAIL;
    const user = await this.prisma.user.findFirst({
      where: adminUserId
        ? { id: adminUserId, status: "ACTIVE" }
        : adminEmail
        ? { email: adminEmail, status: "ACTIVE" }
        : {
            status: "ACTIVE",
            roleBindings: { some: { endsAt: null, role: { code: process.env.FOUNDATION_ADMIN_ROLE ?? "FOUNDER_GM" } } }
          },
      orderBy: { createdAt: "asc" }
    });

    if (!user) {
      throw new NotFoundException("No active demo user is available");
    }

    return this.principals.createSessionForUser(user.id, undefined, { authMethod: "local-demo" });
  }

  async createInternalUser(authorization: string | undefined, input: CreateInternalUserInput) {
    const principal = await this.requireAdminPrincipal(authorization);

    if (
      (input.workspaceId && input.workspaceId !== principal.workspaceId)
      || (input.workspaceKey && input.workspaceKey !== principal.workspaceKey)
      || (input.tenantKey && input.tenantKey !== principal.tenantKey)
    ) {
      throw new ForbiddenException("Users can only be created in the caller workspace");
    }

    const email = nonEmptyString(input.email, "email").toLowerCase();
    const displayName = nonEmptyString(input.displayName, "displayName");
    const roleCode = this.normalizeRoleCode(input.roleCode);
    const workspace = await this.workspaces.resolveWorkspace({
      tenantKey: principal.tenantKey,
      workspaceId: principal.workspaceId,
      workspaceKey: principal.workspaceKey
    });
    const bindingTenantKey = workspace.tenantKey;

    const departmentCode = optionalString(input.departmentCode, "departmentCode") ?? undefined;
    const user = await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceAuth(tx, workspace.workspaceId);
      await this.requireCurrentAdmin(tx, principal.subjectId, workspace.workspaceId);
      // All foreign targets and existing identity ownership are read before the
      // first write. Any later failure rolls back user, binding, and grant.
      await this.ensureGrantTargetInWorkspace(tx, {
        accountId: input.accountId,
        projectId: input.projectId,
        workspaceId: workspace.workspaceId
      });

      let existingUser = await tx.user.findUnique({
        where: { email },
        include: {
          roleBindings: {
            where: { ...activeMembershipWhere() },
            select: { workspaceId: true }
          }
        }
      });
      if (existingUser) {
        await lockUserAuth(tx, existingUser.id);
        existingUser = await tx.user.findUnique({ where: { id: existingUser.id }, include: { roleBindings: { where: { ...activeMembershipWhere() }, select: { workspaceId: true } } } });
      }
      if (existingUser && existingUser.status !== "ACTIVE") {
        throw new ConflictException("Use explicit reactivation for a suspended user");
      }
      const endedMembership = existingUser ? await tx.roleBinding.findFirst({ where: { userId: existingUser.id, workspaceId: workspace.workspaceId, endsAt: { lte: new Date() } } }) : null;
      if (endedMembership) throw new ConflictException("Use explicit reactivation or role update for an existing membership");
      const hasForeignWorkspaceMembership = existingUser?.roleBindings.some(
        (binding) => binding.workspaceId !== workspace.workspaceId
      ) ?? false;
      if (existingUser && hasForeignWorkspaceMembership && existingUser.subjectType !== "INTERNAL_USER") {
        throw new ConflictException("Existing identity belongs to another workspace and cannot be converted silently");
      }

      const role = await tx.role.upsert({
        where: { code: roleCode },
        update: {},
        create: {
          code: roleCode,
          name: roleCode.replaceAll("_", " "),
          type: "BUSINESS"
        }
      });

      const persistedUser = existingUser
        ? hasForeignWorkspaceMembership
          ? existingUser
          : await tx.user.update({
              where: { id: existingUser.id },
              data: {
                displayName,
                departmentCode,
                subjectType: "INTERNAL_USER",
                status: "ACTIVE"
              }
            })
        : await tx.user.create({
            data: {
              email,
              displayName,
              departmentCode,
              subjectType: "INTERNAL_USER",
              status: "ACTIVE"
            }
          });

      await tx.roleBinding.upsert({
        where: {
          userId_roleId_tenantKey_workspaceId: {
            userId: persistedUser.id,
            roleId: role.id,
            tenantKey: bindingTenantKey,
            workspaceId: workspace.workspaceId
          }
        },
        update: { startsAt: new Date(), endsAt: null },
        create: { userId: persistedUser.id, roleId: role.id, tenantKey: bindingTenantKey, workspaceId: workspace.workspaceId }
      });

      if (input.accountId || input.projectId) {
        await tx.customerAccessGrant.create({
          data: {
            userId: persistedUser.id,
            workspaceId: workspace.workspaceId,
            accountId: input.accountId,
            projectId: input.projectId,
            scope: input.projectId ? "CUSTOMER_PROJECT" : "CUSTOMER_ACCOUNT"
          }
        });
      }

      return persistedUser;
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roleCode,
      subjectType: "internal_user" as const,
      status: "active" as const,
      tenantKey: bindingTenantKey,
      workspaceId: workspace.workspaceId,
      workspaceKey: workspace.workspaceKey,
      loginUrl: `${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/login?email=${encodeURIComponent(user.email)}`
    };
  }

  async listUsers(authorization?: string, includeSuspended = false, principalFallback?: string) {
    const principal = await this.requireAdminPrincipal(authorization, principalFallback);
    if (includeSuspended && !principal.roleCodes.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN")) {
      throw new ForbiddenException("Workspace Admin role is required to include suspended users");
    }

    const users = await this.prisma.user.findMany({
      where: {
        ...(includeSuspended ? {} : { status: "ACTIVE" as const }),
        roleBindings: {
          some: {
            workspaceId: principal.workspaceId,
            tenantKey: principal.tenantKey,
            ...(includeSuspended ? {} : activeMembershipWhere())
          }
        }
      },
      include: this.adminUserInclude(principal.workspaceId, principal.tenantKey, includeSuspended),
      orderBy: { createdAt: "asc" }
    });

    return {
      data: users.map((user) => this.mapAdminAccessMember(user, principal.workspaceId, principal.tenantKey)),
      meta: { tenantKey: principal.tenantKey, total: users.length }
    };
  }

  async listWorkspaceUsers(authorization?: string, principalFallback?: string) {
    const principal = await this.requireWorkspaceDirectoryPrincipal(authorization, principalFallback);
    const users = await this.prisma.user.findMany({
      where: { status: "ACTIVE", roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() } } },
      select: { id: true, email: true, displayName: true, avatarUrl: true, departmentCode: true,
        roleBindings: { where: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() }, select: { role: { select: { code: true } } } } },
      orderBy: { displayName: "asc" }, take: 500
    });
    return { data: users.map((user) => ({ id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl,
      departmentCode: user.departmentCode, status: "active", roleCodes: user.roleBindings.map((binding) => binding.role.code) })), meta: { total: users.length } };
  }

  async getUser(authorization: string | undefined, userId: string, includeSuspended = false, principalFallback?: string) {
    const principal = await this.requireAdminPrincipal(authorization, principalFallback);

    const user = await this.prisma.user.findFirst({
      where: {
        id: nonEmptyString(userId, "userId"),
        ...(includeSuspended ? {} : { status: "ACTIVE" as const }),
        roleBindings: {
          some: {
            workspaceId: principal.workspaceId,
            tenantKey: principal.tenantKey,
            ...(includeSuspended ? {} : activeMembershipWhere())
          }
        }
      },
      include: this.adminUserInclude(principal.workspaceId, principal.tenantKey, includeSuspended)
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return {
      data: this.mapAdminAccessMember(user, principal.workspaceId, principal.tenantKey),
      meta: { tenantKey: principal.tenantKey }
    };
  }

  async deactivateUser(authorization: string | undefined, userId: string) {
    const principal = await this.requireAdminPrincipal(authorization);
    await this.ensureUserInWorkspace(userId, principal.workspaceId, principal.tenantKey);

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceAuth(tx, principal.workspaceId);
      await lockUserAuth(tx, userId);
      await this.requireCurrentAdmin(tx, principal.subjectId, principal.workspaceId);
      await ensureAnotherFounder(tx, principal.workspaceId, userId);
      const endedRoleBindings = await tx.roleBinding.updateMany({
        where: { userId, workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        data: { endsAt: now }
      });
      const revokedSessions = await tx.portalSession.updateMany({
        where: { userId, workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, revokedAt: null },
        data: { revokedAt: now }
      });
      await tx.customerAccessGrant.updateMany({
        where: { userId, workspaceId: principal.workspaceId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        data: { endsAt: now }
      });
      const remainingMemberships = await tx.roleBinding.count({ where: { userId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
      await tx.authActionToken.updateMany({ where: { userId, consumedAt: null, ...(remainingMemberships ? { workspaceId: principal.workspaceId } : {}) }, data: { consumedAt: now } });
      const user = remainingMemberships === 0
        ? await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } })
        : await tx.user.findUniqueOrThrow({ where: { id: userId } });

      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "auth.member.deactivated", resource: "user", resourceId: userId, before: { status: "ACTIVE" }, after: { status: user.status, endedRoleBindings: endedRoleBindings.count, revokedSessions: revokedSessions.count }, requestId: randomUUID() } });
      return { endedRoleBindings, revokedSessions, user };
    });

    return {
      userId: result.user.id,
      status: result.user.status === "ACTIVE" ? "active" as const : "suspended" as const,
      endedRoleBindings: result.endedRoleBindings.count,
      revokedSessions: result.revokedSessions.count,
      grantVersion: `revoked:${Date.now()}`,
      roleVersion: `roles:${Date.now()}`
    };
  }

  async revokeUserSessions(authorization: string | undefined, userId: string) {
    const principal = await this.requireAdminPrincipal(authorization);
    await this.ensureUserInWorkspace(userId, principal.workspaceId, principal.tenantKey);

    const revokedSessions = await this.prisma.portalSession.updateMany({
      where: {
        userId,
        workspaceId: principal.workspaceId,
        tenantKey: principal.tenantKey,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });

    return {
      revokedSessions: revokedSessions.count,
      userId,
      grantVersion: `revoked:${Date.now()}`
    };
  }

  async changeUserRole(authorization: string | undefined, userId: string, roleCode: string, principalFallback?: string) {
    const principal = await this.requireAdminPrincipal(authorization, principalFallback);
    const normalized = this.normalizeRoleCode(roleCode);
    if (userId === principal.subjectId && normalized === "WORKSPACE_USER") {
      throw new ConflictException("Bạn không thể tự hạ quyền tài khoản quản trị hiện tại");
    }
    await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceAuth(tx, principal.workspaceId);
      await lockUserAuth(tx, userId);
      await this.requireCurrentAdmin(tx, principal.subjectId, principal.workspaceId);
      const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE", roleBindings: { some: { workspaceId: principal.workspaceId, ...activeMembershipWhere() } } }, include: { roleBindings: { where: { workspaceId: principal.workspaceId, ...activeMembershipWhere() }, include: { role: true } } } });
      if (!user) throw new NotFoundException("Active member not found");
      if (normalized !== "FOUNDER_GM") await ensureAnotherFounder(tx, principal.workspaceId, userId);
      const role = await tx.role.findUniqueOrThrow({ where: { code: normalized } });
      const previousRoleCodes = user.roleBindings?.map((binding: any) => binding.role?.code).filter(Boolean) ?? [];
      await tx.roleBinding.updateMany({ where: { userId, workspaceId: principal.workspaceId, role: { code: { notIn: COST_PERMISSION_CODES } }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, data: { endsAt: new Date() } });
      await tx.roleBinding.upsert({
        where: { userId_roleId_tenantKey_workspaceId: { userId, roleId: role.id, tenantKey: principal.tenantKey, workspaceId: principal.workspaceId } },
        create: { userId, roleId: role.id, tenantKey: principal.tenantKey, workspaceId: principal.workspaceId }, update: { startsAt: new Date(), endsAt: null }
      });
      await tx.portalSession.updateMany({ where: { userId, workspaceId: principal.workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "auth.member.role_changed", resource: "user", resourceId: userId, before: { roleCodes: previousRoleCodes }, after: { roleCode: normalized }, requestId: randomUUID() } });
    });
    return { userId, roleCode: normalized };
  }

  async reactivateUser(authorization: string | undefined, userId: string) {
    const principal = await this.requireAdminPrincipal(authorization);
    await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceAuth(tx, principal.workspaceId);
      await lockUserAuth(tx, userId);
      await this.requireCurrentAdmin(tx, principal.subjectId, principal.workspaceId);
      // Reactivation restores only the most recently ended role, never all historical grants/roles.
      const binding = await tx.roleBinding.findFirst({ where: { userId, workspaceId: principal.workspaceId, tenantKey: principal.tenantKey }, orderBy: { endsAt: "desc" } });
      if (!binding) throw new NotFoundException("Workspace member not found");
      const active = await tx.roleBinding.findFirst({ where: { userId, workspaceId: principal.workspaceId, ...activeMembershipWhere() } });
      if (active) throw new ConflictException("Member is already active");
      await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
      await tx.roleBinding.update({ where: { id: binding.id }, data: { startsAt: new Date(), endsAt: null } });
      await tx.portalSession.updateMany({ where: { userId, workspaceId: principal.workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "auth.member.reactivated", resource: "user", resourceId: userId, before: { status: "SUSPENDED" }, after: { status: "ACTIVE", restoredRoleBindingId: binding.id }, requestId: randomUUID() } });
    });
    return { userId, status: "active" };
  }

  async updateCostPermissions(authorization: string | undefined, userId: string, permissions: CostPermissionCode[], principalFallback?: string) {
    const principal = await this.requireAdminPrincipal(authorization, principalFallback);
    if (!Array.isArray(permissions)) throw new ForbiddenException("permissionCodes must be an array");
    const requested = [...new Set(permissions)].filter((code): code is CostPermissionCode => COST_PERMISSION_CODES.includes(code));
    if (requested.length !== permissions.length) throw new ForbiddenException("Unsupported cost permission code");
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceAuth(tx, principal.workspaceId);
      await lockUserAuth(tx, userId);
      await this.requireCurrentAdmin(tx, principal.subjectId, principal.workspaceId);
      const user = await tx.user.findFirst({ where: { id: userId, roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey } } }, include: { roleBindings: { where: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() }, include: { role: true } } } });
      if (!user) throw new NotFoundException("Workspace member not found");
      const isFounder = user.roleBindings.some((binding) => binding.role.code === "FOUNDER_GM");
      const next = isFounder ? COST_PERMISSION_CODES : requested;
      const before = user.roleBindings.map((binding) => binding.role.code).filter((code): code is CostPermissionCode => COST_PERMISSION_CODES.includes(code as CostPermissionCode));
      const now = new Date();
      await tx.roleBinding.updateMany({ where: { userId, workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, role: { code: { in: COST_PERMISSION_CODES } }, ...activeMembershipWhere() }, data: { endsAt: now } });
      for (const code of next) {
        const role = await tx.role.upsert({ where: { code }, update: {}, create: { code, name: code.replace("COST_", "Cost "), type: "BUSINESS" } });
        await tx.roleBinding.upsert({ where: { userId_roleId_tenantKey_workspaceId: { userId, roleId: role.id, tenantKey: principal.tenantKey, workspaceId: principal.workspaceId } }, update: { startsAt: now, endsAt: null }, create: { userId, roleId: role.id, tenantKey: principal.tenantKey, workspaceId: principal.workspaceId } });
      }
      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "auth.member.cost_permissions_changed", resource: "user", resourceId: userId, before: { permissionCodes: before }, after: { permissionCodes: next }, requestId: randomUUID() } });
      return next;
    });
    return { userId, costPermissionCodes: result };
  }

  async updateResourceProfile(authorization: string | undefined, userId: string, input: { departmentCode?: string; displayRole?: string; weeklyCapacityMinutes?: number; billableTargetPercent?: number; employmentStatus?: EmploymentStatus }, principalFallback?: string) {
    const principal = await this.requireAdminPrincipal(authorization, principalFallback);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkspaceAuth(tx, principal.workspaceId);
      await lockUserAuth(tx, userId);
      await this.requireCurrentAdmin(tx, principal.subjectId, principal.workspaceId);
      const user = await tx.user.findFirst({ where: { id: userId, roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey } } }, include: { resourceProfile: true } });
      if (!user) throw new NotFoundException("Workspace member not found");
      const employmentStatus = input.employmentStatus ?? (user.status === "ACTIVE" ? "ACTIVE" : "INACTIVE");
      const profile = await tx.resourceProfile.upsert({ where: { userId }, update: { displayRole: input.displayRole, employmentStatus, defaultWeeklyCapacityMinutes: input.weeklyCapacityMinutes, billableTargetPercent: input.billableTargetPercent, active: employmentStatus !== "INACTIVE" }, create: { userId, displayRole: input.displayRole, employmentStatus, defaultWeeklyCapacityMinutes: input.weeklyCapacityMinutes ?? 2400, billableTargetPercent: input.billableTargetPercent ?? 70, skills: [], active: employmentStatus !== "INACTIVE" } });
      const before = { status: user.status, departmentCode: user.departmentCode, displayRole: user.resourceProfile?.displayRole ?? null, active: user.resourceProfile?.active ?? null };
      const shouldSuspend = employmentStatus !== "ACTIVE";
      const nextUser = await tx.user.update({ where: { id: userId }, data: { departmentCode: input.departmentCode, status: shouldSuspend ? "SUSPENDED" : "ACTIVE" } });
      if (employmentStatus === "INACTIVE") await tx.roleBinding.updateMany({ where: { userId, workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() }, data: { endsAt: new Date() } });
      await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "people.profile_changed", resource: "user", resourceId: userId, before, after: { status: nextUser.status, departmentCode: nextUser.departmentCode, displayRole: profile.displayRole, employmentStatus }, requestId: randomUUID() } });
      return { user: nextUser, profile, employmentStatus };
    });
    return { data: { userId, status: result.user.status === "ACTIVE" ? "active" : "suspended", employmentStatus: result.employmentStatus, resourceDisplayRole: result.profile.displayRole }, meta: { audited: true } };
  }

  private async requireCurrentAdmin(tx: Prisma.TransactionClient, userId: string, workspaceId: string) {
    const binding = await tx.roleBinding.findFirst({ where: { userId, workspaceId, ...activeMembershipWhere(), role: { code: { in: ["FOUNDER_GM", "WORKSPACE_ADMIN"] } }, user: { status: "ACTIVE" } } });
    if (!binding) throw new ForbiddenException("Active Founder/GM or Workspace Admin membership is required");
  }

  private normalizeRoleCode(roleCode: string) {
    const normalized = nonEmptyString(roleCode, "roleCode") as InternalRoleCode;
    if (!INTERNAL_ROLE_CODES.includes(normalized)) {
      throw new ForbiddenException(`Unsupported internal roleCode: ${roleCode}`);
    }

    return normalized;
  }

  private async requireAdminPrincipal(authorization?: string, principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    if (!principal.roleCodes.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN")) {
      throw new ForbiddenException("Workspace Admin role is required for user management");
    }

    return principal;
  }

  private async requireWorkspaceDirectoryPrincipal(authorization?: string, principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    if (principal.subjectType !== "internal_user") {
      throw new ForbiddenException("Internal workspace role is required to read workspace users");
    }

    if (!principal.roleCodes.some((roleCode: string) => INTERNAL_ROLE_CODES.includes(roleCode as InternalRoleCode))) {
      throw new ForbiddenException("Internal workspace role is required to read workspace users");
    }

    return principal;
  }

  private async ensureGrantTargetInWorkspace(tx: Prisma.TransactionClient, input: {
    accountId?: string | null;
    projectId?: string | null;
    workspaceId: string;
  }) {
    if (input.accountId) {
      const account = await tx.account.findFirst({
        where: { id: input.accountId, workspaceId: input.workspaceId },
        select: { id: true }
      });
      if (!account) {
        throw new NotFoundException("Account grant target not found in workspace");
      }
    }

    if (input.projectId) {
      const project = await tx.project.findFirst({
        where: {
          id: input.projectId,
          workspaceId: input.workspaceId,
          ...(input.accountId ? { accountId: input.accountId } : {})
        },
        select: { id: true }
      });
      if (!project) {
        throw new NotFoundException("Project grant target not found in workspace");
      }
    }
  }

  private async ensureUserInWorkspace(userId: string, workspaceId: string, bindingTenantKey: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        roleBindings: { some: { workspaceId, tenantKey: bindingTenantKey, ...activeMembershipWhere() } }
      }
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private adminUserInclude(workspaceId: string, bindingTenantKey: string, includeSuspended: boolean) {
    return {
      identities: { where: { provider: { in: ["lark", "lark_user_id"] }, tenantKey: bindingTenantKey } },
      roleBindings: {
        where: { workspaceId, tenantKey: bindingTenantKey, ...(includeSuspended ? {} : activeMembershipWhere()) },
        include: { role: true }
      },
      customerGrants: {
        where: { workspaceId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        include: {
          account: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } }
        }
      },
      sessions: {
        where: { workspaceId, tenantKey: bindingTenantKey, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: "desc" as const }
      },
      resourceProfile: true,
      _count: {
        select: {
          projectMembers: { where: { workspaceId } },
          assignedTasks: { where: { workspaceId } },
          ownedTasks: { where: { workspaceId } },
          taskTimeEntries: { where: { workspaceId } }
        }
      }
    };
  }

  private mapAdminAccessMember(user: any, workspaceId: string, bindingTenantKey: string): AdminAccessMemberSummary {
    const larkOpenId = user.identities.find((identity: any) => identity.provider === "lark")?.providerUserId;
    const roleCodes = user.roleBindings.filter((binding: any) => isActiveMembership(binding)).map((binding: any) => binding.role.code);
    const costPermissionCodes = roleCodes.includes("FOUNDER_GM") ? COST_PERMISSION_CODES : roleCodes.filter((code: string): code is CostPermissionCode => COST_PERMISSION_CODES.includes(code as CostPermissionCode));

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? undefined,
      departmentCode: user.departmentCode ?? undefined,
      larkOpenId,
      larkTenantKey: user.identities[0]?.tenantKey,
      hasResourceProfile: Boolean(user.resourceProfile),
      resourceDisplayRole: user.resourceProfile?.displayRole ?? undefined,
      resourceSkills: user.resourceProfile?.skills ?? [],
      resourceWeeklyCapacityMinutes: user.resourceProfile?.defaultWeeklyCapacityMinutes,
      resourceBillableTargetPercent: user.resourceProfile?.billableTargetPercent,
      subjectType: user.subjectType === "PORTAL_USER" ? "portal" : "internal",
      status: user.status === "ACTIVE" && user.roleBindings.some((binding: any) => isActiveMembership(binding)) ? "active" : "suspended",
      tenantKey: bindingTenantKey,
      workspaceId,
      roleCodes,
      costPermissionCodes,
      employmentStatus: user.status === "ACTIVE" ? (user.resourceProfile?.employmentStatus ?? "ACTIVE") : (user.resourceProfile?.employmentStatus === "ON_LEAVE" ? "ON_LEAVE" : "INACTIVE"),
      accountIds: user.customerGrants.flatMap((grant: any) => (grant.accountId ? [grant.accountId] : [])),
      accountNames: user.customerGrants.flatMap((grant: any) => (grant.account?.name ? [grant.account.name] : [])),
      projectIds: user.customerGrants.flatMap((grant: any) => (grant.projectId ? [grant.projectId] : [])),
      projectNames: user.customerGrants.flatMap((grant: any) => (grant.project?.name ? [grant.project.name] : [])),
      projectMemberCount: user._count?.projectMembers ?? 0,
      assignedTaskCount: user._count?.assignedTasks ?? 0,
      ownedTaskCount: user._count?.ownedTasks ?? 0,
      timeEntryCount: user._count?.taskTimeEntries ?? 0,
      activeSessionCount: user.sessions.length,
      lastSeenAt: user.sessions[0]?.lastSeenAt?.toISOString(),
      createdAt: user.createdAt.toISOString()
    };
  }
}
