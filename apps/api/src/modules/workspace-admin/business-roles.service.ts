import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { BUSINESS_ROLE_CATALOGUE, accountTypeOf, isBusinessRoleCode, roleCatalogueEntry, type PrincipalContext, type WorkspaceBusinessRoleOption, type WorkspaceRolesResponse } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { assertAdmin } from "./workspace-admin.service";

const SYSTEM_ROLES = [
  { code: "FOUNDER_GM", label: "Founder/GM" },
  { code: "WORKSPACE_ADMIN", label: "Workspace Admin" },
  { code: "WORKSPACE_USER", label: "Workspace User" }
] as const;

/**
 * Admin › Setting: the business roles (Vai trò nghiệp vụ) an organization uses. Built-in roles can be renamed or hidden;
 * an organization's own role has a name and the built-in role whose permissions it carries. Holding an own role means
 * holding its built-in role too, so every permission check keeps reading the built-in codes.
 */
@Injectable()
export class BusinessRolesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Any internal member may read the names: they are shown wherever a person's role is. */
  async list(principal: PrincipalContext): Promise<WorkspaceRolesResponse> {
    if (principal.subjectType !== "internal_user") throw new ForbiddenException("Internal member required");
    const [rows, bindings] = await Promise.all([
      this.prisma.workspaceBusinessRole.findMany({ where: { workspaceId: principal.workspaceId }, orderBy: { createdAt: "asc" } }),
      this.prisma.roleBinding.findMany({
        where: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, user: { status: "ACTIVE" }, ...activeMembershipWhere() },
        select: { userId: true, role: { select: { code: true, baseRoleCode: true } } }
      })
    ]);
    // Who holds what: an own role counts instead of the built-in role it carries.
    const held = new Map<string, Set<string>>();
    for (const binding of bindings) held.set(binding.userId, (held.get(binding.userId) ?? new Set()).add(binding.role.code));
    const ownCodes = new Set(bindings.filter((binding) => binding.role.baseRoleCode).map((binding) => binding.role.code));
    const count = (pick: (codes: Set<string>) => string | undefined, code: string) => [...held.values()].filter((codes) => pick(codes) === code).length;
    const businessOf = (codes: Set<string>) => [...codes].find((code) => ownCodes.has(code)) ?? BUSINESS_ROLE_CATALOGUE.find((entry) => codes.has(entry.code))?.code;
    const systemOf = (codes: Set<string>) => SYSTEM_ROLES.find((role) => codes.has(role.code))?.code;

    const byCode = new Map(rows.map((row) => [row.code, row]));
    const ownRoles = rows.filter((row) => !isBusinessRoleCode(row.code));
    const bases = new Map((await this.prisma.role.findMany({ where: { code: { in: ownRoles.map((row) => row.code) } }, select: { code: true, baseRoleCode: true } })).map((role) => [role.code, role.baseRoleCode ?? ""]));
    const option = (code: string, label: string, baseRoleCode: string, builtIn: boolean): WorkspaceBusinessRoleOption => ({
      code, label, baseRoleCode, builtIn, hidden: byCode.get(code)?.hidden ?? false, accountType: accountTypeOf([baseRoleCode]), memberCount: count(businessOf, code)
    });
    return { data: {
      systemRoles: SYSTEM_ROLES.map((role) => ({ ...role, accountType: accountTypeOf([role.code]), memberCount: count(systemOf, role.code) })),
      businessRoles: [
        ...BUSINESS_ROLE_CATALOGUE.map((entry) => option(entry.code, byCode.get(entry.code)?.label ?? entry.label, entry.code, true)),
        ...ownRoles.map((row) => option(row.code, row.label, bases.get(row.code) ?? "", false))
      ]
    } };
  }

  async create(principal: PrincipalContext, input: { label?: unknown; baseRoleCode?: unknown }) {
    assertAdmin(principal);
    const label = this.label(input?.label);
    const baseRoleCode = typeof input?.baseRoleCode === "string" ? input.baseRoleCode : "";
    if (!isBusinessRoleCode(baseRoleCode)) throw new BadRequestException("Chọn vai trò gốc để lấy quyền");
    await this.assertLabelFree(principal, label);
    const code = `BR_${randomBytes(5).toString("hex").toUpperCase()}`;
    await this.prisma.$transaction([
      this.prisma.role.create({ data: { code, name: label, type: "BUSINESS", baseRoleCode, description: `Vai trò riêng của workspace ${principal.workspaceId}` } }),
      this.prisma.workspaceBusinessRole.create({ data: { workspaceId: principal.workspaceId, code, label } }),
      this.audit(principal, "admin.business_role.created", code, undefined, { label, baseRoleCode })
    ]);
    return { code, label, baseRoleCode };
  }

  /** Rename or hide/show. A built-in role keeps its code and permissions; only what this organization sees changes. */
  async update(principal: PrincipalContext, code: string, input: { label?: unknown; hidden?: unknown }) {
    assertAdmin(principal);
    const builtIn = roleCatalogueEntry(code);
    const row = await this.prisma.workspaceBusinessRole.findUnique({ where: { workspaceId_code: { workspaceId: principal.workspaceId, code } } });
    if (!isBusinessRoleCode(code) && !row) throw new NotFoundException("Không tìm thấy vai trò");
    const label = input?.label === undefined ? undefined : this.label(input.label);
    if (label && label.toLocaleLowerCase("vi") !== (row?.label ?? builtIn?.label)?.toLocaleLowerCase("vi")) await this.assertLabelFree(principal, label, code);
    if (input?.hidden !== undefined && typeof input.hidden !== "boolean") throw new BadRequestException("hidden must be true or false");
    const hidden = input?.hidden as boolean | undefined;
    const saved = await this.prisma.workspaceBusinessRole.upsert({
      where: { workspaceId_code: { workspaceId: principal.workspaceId, code } },
      update: { ...(label ? { label } : {}), ...(hidden !== undefined ? { hidden } : {}) },
      create: { workspaceId: principal.workspaceId, code, label: label ?? builtIn!.label, hidden: hidden ?? false }
    });
    await this.audit(principal, "admin.business_role.updated", code, row ? { label: row.label, hidden: row.hidden } : undefined, { label: saved.label, hidden: saved.hidden });
    return { code, label: saved.label, hidden: saved.hidden };
  }

  /** Only an organization's own role, and only once nobody holds it. */
  async remove(principal: PrincipalContext, code: string) {
    assertAdmin(principal);
    if (isBusinessRoleCode(code)) throw new BadRequestException("Vai trò có sẵn chỉ ẩn được, không xóa được");
    const row = await this.prisma.workspaceBusinessRole.findUnique({ where: { workspaceId_code: { workspaceId: principal.workspaceId, code } } });
    if (!row) throw new NotFoundException("Không tìm thấy vai trò");
    const holders = await this.prisma.roleBinding.count({ where: { workspaceId: principal.workspaceId, role: { code }, ...activeMembershipWhere() } });
    if (holders) throw new ConflictException(`Còn ${holders} người đang giữ vai trò này. Đổi vai trò của họ trước khi xóa.`);
    // The Role row stays: ended bindings in the history still point at it.
    await this.prisma.$transaction([
      this.prisma.workspaceBusinessRole.delete({ where: { workspaceId_code: { workspaceId: principal.workspaceId, code } } }),
      this.audit(principal, "admin.business_role.deleted", code, { label: row.label }, undefined)
    ]);
    return { deleted: true };
  }

  private label(value: unknown) {
    const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!label) throw new BadRequestException("Nhập tên vai trò");
    if (label.length > 60) throw new BadRequestException("Tên vai trò tối đa 60 ký tự");
    return label;
  }

  private async assertLabelFree(principal: PrincipalContext, label: string, exceptCode?: string) {
    const { data } = await this.list(principal);
    if (data.businessRoles.some((role) => role.code !== exceptCode && role.label.toLocaleLowerCase("vi") === label.toLocaleLowerCase("vi"))) {
      throw new ConflictException(`Đã có vai trò tên "${label}"`);
    }
  }

  private audit(principal: PrincipalContext, action: string, code: string, before?: object, after?: object) {
    return this.prisma.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource: "business_role", resourceId: code, before, after, requestId: randomUUID() } });
  }
}
