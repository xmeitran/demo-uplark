import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BUSINESS_ROLE_CATALOGUE, SYSTEM_FOUNDER_ROLE_CODE, isBusinessRoleCode, type PrincipalContext } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { nonEmptyString, optionalString, tenantKey, workspaceKey, workspaceName } from "../../shared/http/request-context";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { findLarkUserIdIdentity } from "../identity-access/lark-user-id";
import { keptOnRoleChange, keptRoleFilter, replaceBusinessRole } from "../identity-access/role-change";
import { larkDirectoryUser } from "../workspace-admin/workspace-admin.service";

/** "Công ty Ánh Dương" → "cong-ty-anh-duong": the organization's workspaceKey. */
export function organizationKey(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

// Same two dimensions as Admin › Users: one system role and at most one business role per organization.
const SYSTEM_ROLE_CODES: readonly string[] = ["FOUNDER_GM", "WORKSPACE_ADMIN", "WORKSPACE_USER"];

export interface WorkspaceContext {
  tenantKey: string;
  workspaceId: string;
  workspaceKey: string;
}

@Injectable()
export class TenantWorkspaceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Replaced in specs. */
  larkDirectoryUser = larkDirectoryUser;

  async ensureDefaultWorkspace() {
    return this.prisma.tenantWorkspace.upsert({
      where: {
        tenantKey_workspaceKey: {
          tenantKey: tenantKey(),
          workspaceKey: workspaceKey()
        }
      },
      update: {},
      create: {
        id: process.env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation",
        tenantKey: tenantKey(),
        workspaceKey: workspaceKey(),
        name: workspaceName(),
        status: "active",
        planCode: process.env.FOUNDATION_WORKSPACE_PLAN ?? "foundation",
        regionCode: process.env.FOUNDATION_WORKSPACE_REGION ?? undefined
      }
    });
  }

  async resolveWorkspace(input?: { workspaceId?: string | null; workspaceKey?: string | null; tenantKey?: string | null }) {
    if (input?.workspaceId) {
      const workspace = await this.prisma.tenantWorkspace.findUnique({ where: { id: input.workspaceId } });
      if (!workspace || workspace.status !== "active") {
        throw new NotFoundException("Workspace not found");
      }

      return this.toContext(workspace);
    }

    const key = input?.workspaceKey?.trim() || workspaceKey();
    const tenant = input?.tenantKey?.trim() || tenantKey();
    const workspace = await this.prisma.tenantWorkspace.findUnique({
      where: { tenantKey_workspaceKey: { tenantKey: tenant, workspaceKey: key } }
    });

    if (workspace && workspace.status === "active") {
      return this.toContext(workspace);
    }

    if (workspace) throw new NotFoundException("Workspace is inactive");

    if (tenant === tenantKey() && key === workspaceKey()) {
      return this.toContext(await this.ensureDefaultWorkspace());
    }

    throw new NotFoundException("Workspace not found");
  }

  async listWorkspaces(input?: { tenantKey?: string | null; onlyId?: string }) {
    const tenant = input?.tenantKey?.trim() || tenantKey();
    const workspaces = await this.prisma.tenantWorkspace.findMany({
      where: { tenantKey: tenant, ...(input?.onlyId ? { id: input.onlyId } : {}) },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });

    return {
      data: workspaces.map((workspace) => ({
        id: workspace.id,
        tenantKey: workspace.tenantKey,
        workspaceKey: workspace.workspaceKey,
        name: workspace.name,
        status: workspace.status,
        planCode: workspace.planCode,
        regionCode: workspace.regionCode ?? undefined,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString()
      })),
      meta: { tenantKey: tenant, total: workspaces.length }
    };
  }

  // Organizations (Tổ chức tab): each one is a workspace of the caller's tenant. System Founder only.

  async listOrganizations(principal: PrincipalContext) {
    this.requireSystemFounder(principal);
    const [workspaces, memberships, founders] = await Promise.all([
      this.prisma.tenantWorkspace.findMany({
        where: { tenantKey: principal.tenantKey },
        include: { _count: { select: { projects: true, accounts: true } } },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.roleBinding.groupBy({
        by: ["workspaceId", "userId"],
        where: { tenantKey: principal.tenantKey, workspaceId: { not: null }, user: { status: "ACTIVE" }, ...activeMembershipWhere() }
      }),
      this.prisma.user.findMany({
        where: { status: "ACTIVE", roleBindings: { some: { tenantKey: principal.tenantKey, workspaceId: null, role: { code: SYSTEM_FOUNDER_ROLE_CODE }, ...activeMembershipWhere() } } },
        select: { id: true, displayName: true, email: true },
        orderBy: { displayName: "asc" }
      })
    ]);
    return {
      data: workspaces.map((workspace) => ({
        id: workspace.id,
        workspaceKey: workspace.workspaceKey,
        name: workspace.name,
        status: workspace.status,
        current: workspace.id === principal.workspaceId,
        memberCount: memberships.filter((row) => row.workspaceId === workspace.id).length,
        projectCount: workspace._count.projects,
        clientCount: workspace._count.accounts,
        createdAt: workspace.createdAt.toISOString()
      })),
      systemFounders: founders
    };
  }

  async createOrganization(principal: PrincipalContext, input: { name?: unknown }) {
    this.requireSystemFounder(principal);
    const name = nonEmptyString(input?.name, "name").slice(0, 120);
    const base = organizationKey(name);
    const taken = new Set((await this.prisma.tenantWorkspace.findMany({
      where: { tenantKey: principal.tenantKey, workspaceKey: { startsWith: base } }, select: { workspaceKey: true }
    })).map((row) => row.workspaceKey));
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
    const workspace = await this.prisma.tenantWorkspace.create({ data: { tenantKey: principal.tenantKey, workspaceKey: key, name } });
    await this.audit(principal, workspace.id, "organization.created", "workspace", workspace.id, undefined, { name, workspaceKey: key });
    return { id: workspace.id, workspaceKey: key, name, status: workspace.status };
  }

  async updateOrganization(principal: PrincipalContext, workspaceId: string, input: { name?: unknown; status?: unknown }) {
    const workspace = await this.requireOrganization(principal, workspaceId);
    const name = optionalString(input?.name, "name")?.trim().slice(0, 120);
    const status = optionalString(input?.status, "status") ?? undefined;
    if (status && status !== "active" && status !== "inactive") throw new BadRequestException("status must be active or inactive");
    if (status === "inactive" && workspaceId === principal.workspaceId) throw new BadRequestException("Không thể ngừng tổ chức bạn đang làm việc");
    // Lark sign-in starts from this workspace for every organization, so stopping it would lock everyone out.
    if (status === "inactive" && workspace.tenantKey === tenantKey() && workspace.workspaceKey === workspaceKey()) {
      throw new BadRequestException("Đây là tổ chức mặc định khi đăng nhập Lark, không ngừng được");
    }
    const updated = await this.prisma.tenantWorkspace.update({ where: { id: workspaceId }, data: { ...(name ? { name } : {}), ...(status ? { status } : {}) } });
    await this.audit(principal, workspaceId, "organization.updated", "workspace", workspaceId, { name: workspace.name, status: workspace.status }, { name: updated.name, status: updated.status });
    return { id: updated.id, name: updated.name, status: updated.status };
  }

  async listOrganizationMembers(principal: PrincipalContext, workspaceId: string) {
    await this.requireOrganization(principal, workspaceId);
    const membership = { workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() };
    const users = await this.prisma.user.findMany({
      where: { roleBindings: { some: membership } },
      select: {
        id: true, email: true, displayName: true, status: true,
        roleBindings: { where: membership, select: { role: { select: { code: true } } } },
        identities: { where: { provider: "lark_user_id", tenantKey: principal.tenantKey }, select: { providerUserId: true }, take: 1 }
      },
      orderBy: { displayName: "asc" }
    });
    // The organization's business role names as set in its Admin › Setting (renamed, hidden and own roles).
    const rows = await this.prisma.workspaceBusinessRole.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    const label = new Map(rows.map((row) => [row.code, row]));
    const businessRoles = [
      ...BUSINESS_ROLE_CATALOGUE.map((entry) => ({ code: entry.code, label: label.get(entry.code)?.label ?? entry.label, hidden: label.get(entry.code)?.hidden ?? false })),
      ...rows.filter((row) => !isBusinessRoleCode(row.code)).map((row) => ({ code: row.code, label: row.label, hidden: row.hidden }))
    ];
    return { data: users.map(({ roleBindings, identities, ...user }) => ({ ...user, larkUserId: identities[0]?.providerUserId, roleCodes: roleBindings.map((binding) => binding.role.code) })), businessRoles };
  }

  /**
   * Adds someone to an organization or changes their roles there. `user` is a user ID (Lark ID such as HN454, or the CRM id)
   * or an email; an email nobody has yet creates the account, and the person signs in with Lark under that email.
   * `systemRole` / `businessRole` each replace only their own kind; omitted = unchanged, businessRole "" = none. Other codes (COST_*) stay.
   */
  async setOrganizationMember(principal: PrincipalContext, workspaceId: string, input: { user?: unknown; displayName?: unknown; systemRole?: unknown; businessRole?: unknown }) {
    await this.requireOrganization(principal, workspaceId);
    const ref = nonEmptyString(input?.user, "user");
    const email = ref.includes("@") ? ref.toLowerCase() : undefined;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Email không hợp lệ");
    let systemRole = input?.systemRole === undefined ? undefined : nonEmptyString(input.systemRole, "systemRole");
    if (systemRole && !SYSTEM_ROLE_CODES.includes(systemRole)) throw new BadRequestException(`Unsupported systemRole: ${systemRole}`);
    // Checked by replaceBusinessRole: a built-in role or one of this organization's own roles.
    const businessRole = input?.businessRole === undefined ? undefined : (optionalString(input.businessRole, "businessRole") || null);
    const now = new Date();
    const known = email
      ? null
      : await this.prisma.user.findUnique({ where: { id: ref } })
        ?? (await findLarkUserIdIdentity(this.prisma, ref, principal.tenantKey))?.user
        ?? null;
    // Someone the Lark directory sync never brought in (another team) is added by their Lark user ID alone: Lark does not
    // give the CRM other teams' emails, so their sign-in finds the account by this ID. Lark names them when it can.
    const byLarkId = !email && !known;
    if (byLarkId && !/^[A-Za-z0-9_-]{2,64}$/.test(ref)) throw new BadRequestException(`User ID không hợp lệ: ${ref}`);
    const lark = byLarkId ? await this.larkDirectoryUser(ref) : null;
    // Someone already in the CRM under another email (e.g. an older DX account) is found by the open_id Lark gave.
    const byOpenId = lark
      ? (await this.prisma.portalIdentity.findUnique({ where: { provider_providerUserId_tenantKey: { provider: "lark", providerUserId: lark.openId, tenantKey: principal.tenantKey } }, include: { user: true } }))?.user
      : undefined;
    const larkUserId = lark?.userId ?? ref;
    const newEmail = email ?? lark?.email ?? `${larkUserId}@lark.local`.toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      let user = known ?? byOpenId ?? await tx.user.findUnique({ where: { email: newEmail } });
      if (user && user.status !== "ACTIVE") throw new ConflictException("Tài khoản này đang bị khóa");
      if (user && user.subjectType !== "INTERNAL_USER") throw new ConflictException("Đây là tài khoản khách hàng, không thêm vào tổ chức được");
      const created = !user;
      user ??= await tx.user.create({ data: {
        email: newEmail, displayName: optionalString(input?.displayName, "displayName")?.trim().slice(0, 120) || lark?.name || (byLarkId ? larkUserId : newEmail.split("@")[0]), subjectType: "INTERNAL_USER", status: "ACTIVE"
      } });
      const userId = user.id;
      if (byLarkId) await tx.portalIdentity.createMany({ data: [
        { userId, provider: "lark_user_id", providerUserId: larkUserId, tenantKey: principal.tenantKey },
        ...(lark ? [{ userId, provider: "lark", providerUserId: lark.openId, tenantKey: principal.tenantKey }] : [])
      ], skipDuplicates: true });
      const membership = { userId, workspaceId, tenantKey: principal.tenantKey };
      const held = (await tx.roleBinding.findMany({ where: { ...membership, ...activeMembershipWhere(now) }, select: { role: { select: { code: true } } } })).map((binding) => binding.role.code);
      if (!held.length && !systemRole) systemRole = "WORKSPACE_USER";
      // Same rules as Admin › Users: a system role replaces the others (a User-type one also ends Admin-type business roles);
      // a business role replaces the business role and brings the default cost permissions.
      if (systemRole) {
        await tx.roleBinding.updateMany({ where: { ...membership, role: keptRoleFilter(keptOnRoleChange(systemRole)), ...activeMembershipWhere(now) }, data: { endsAt: now } });
        const role = await tx.role.findUniqueOrThrow({ where: { code: systemRole } });
        await tx.roleBinding.upsert({ where: { userId_roleId_tenantKey_workspaceId: { ...membership, roleId: role.id } }, update: { startsAt: now, endsAt: null }, create: { ...membership, roleId: role.id, startsAt: now } });
      }
      if (businessRole !== undefined) await replaceBusinessRole(tx, membership, businessRole, held, now);
      if (!await tx.roleBinding.count({ where: { ...membership, ...activeMembershipWhere(now) } })) throw new BadRequestException("Thành viên cần ít nhất một vai trò");
      await this.audit(principal, workspaceId, "organization.member.set", "user", userId, undefined, { email: user.email, systemRole, businessRole, created }, tx);
      return { id: userId, email: user.email, displayName: user.displayName, created, ...(byLarkId ? { verifiedOnLark: Boolean(lark) } : {}) };
    });
  }

  async removeOrganizationMember(principal: PrincipalContext, workspaceId: string, userId: string) {
    await this.requireOrganization(principal, workspaceId);
    const now = new Date();
    if (userId === principal.subjectId && workspaceId === principal.workspaceId) throw new BadRequestException("Không thể tự gỡ mình khỏi tổ chức bạn đang làm việc");
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.roleBinding.updateMany({ where: { userId, workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere(now) }, data: { endsAt: now } });
      if (!ended.count) throw new NotFoundException("Người này không thuộc tổ chức");
      const sessions = await tx.portalSession.updateMany({ where: { userId, workspaceId, revokedAt: null }, data: { revokedAt: now } });
      await this.audit(principal, workspaceId, "organization.member.removed", "user", userId, { endedRoles: ended.count }, { revokedSessions: sessions.count }, tx);
      return { removed: true, revokedSessions: sessions.count };
    });
  }

  private requireSystemFounder(principal: PrincipalContext) {
    if (!principal.roleCodes.includes(SYSTEM_FOUNDER_ROLE_CODE)) throw new ForbiddenException("Chỉ System Founder mới quản lý tổ chức");
  }

  private async requireOrganization(principal: PrincipalContext, workspaceId: string) {
    this.requireSystemFounder(principal);
    const workspace = await this.prisma.tenantWorkspace.findFirst({ where: { id: workspaceId, tenantKey: principal.tenantKey } });
    if (!workspace) throw new NotFoundException("Không tìm thấy tổ chức");
    return workspace;
  }

  private audit(principal: PrincipalContext, workspaceId: string, action: string, resource: string, resourceId: string, before?: object, after?: object, client: Pick<PrismaService, "auditEvent"> = this.prisma) {
    return client.auditEvent.create({ data: { workspaceId, actorUserId: principal.subjectId, action, resource, resourceId, before, after, requestId: randomUUID() } });
  }

  toContext(workspace: { id: string; tenantKey: string; workspaceKey: string }): WorkspaceContext {
    return {
      tenantKey: workspace.tenantKey,
      workspaceId: workspace.id,
      workspaceKey: workspace.workspaceKey
    };
  }
}
