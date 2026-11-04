import { ADMIN_ROLE_CODES, BUSINESS_ROLE_CODES, DEFAULT_COST_PERMISSION_ROLE_CODES, SYSTEM_FOUNDER_ROLE_CODE, accountTypeOf, isBusinessRoleCode, type CostPermissionCode } from "@b2b-crm/contracts";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { activeMembershipWhere } from "./active-membership";

// Shared by Admin › Users (auth.service) and Tổ chức (tenant-workspace.service), so both change roles the same way.

/**
 * Who belongs to an organization is decided by System Founders (user's call, 2026-11-04): adding someone — creating,
 * inviting, restoring an ended membership — needs System Founder. An organization's own admins still change roles and remove.
 */
export function assertCanAddMembers(principal: { roleCodes: readonly string[] }) {
  if (!principal.roleCodes.includes(SYSTEM_FOUNDER_ROLE_CODE)) {
    throw new ForbiddenException("Chỉ System Founder mới thêm hoặc khôi phục thành viên. Nhờ System Founder làm ở tab Tổ chức.");
  }
}

export const COST_PERMISSION_CODES: CostPermissionCode[] = ["COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"];
// A system-role change replaces the account's other roles but keeps its cost permissions and its business role (set separately).
const KEPT_ON_ROLE_CHANGE: string[] = [...COST_PERMISSION_CODES, ...BUSINESS_ROLE_CODES];

/**
 * Role codes that survive a change to `nextRoleCode`. A demotion to a User-type system role also ends the Admin-type
 * business roles (PM, Dx Director, BD Lead): they imply WORKSPACE_ADMIN, so keeping them would leave the account an Admin.
 */
export function keptOnRoleChange(nextRoleCode: string): string[] {
  return accountTypeOf([nextRoleCode]) === "ADMIN" ? KEPT_ON_ROLE_CHANGE : KEPT_ON_ROLE_CHANGE.filter((code) => !ADMIN_ROLE_CODES.includes(code));
}

/** Roles a system-role change ends: those not kept; an organization's own role is kept exactly when its built-in role is. */
export const keptRoleFilter = (kept: string[]) => ({ code: { notIn: kept }, OR: [{ baseRoleCode: null }, { baseRoleCode: { notIn: kept } }] });

/**
 * Replaces the account's business role in one workspace: a built-in one (ROLE_CATALOGUE) or the organization's own one
 * (Admin › Setting), which is bound together with the built-in role it carries so every permission check keeps reading
 * built-in codes. PM, BD Lead and Dx Director bring the cost permission group by default (7.7) unless the account has a grant.
 */
export async function replaceBusinessRole(
  tx: Prisma.TransactionClient,
  scope: { userId: string; workspaceId: string; tenantKey: string },
  next: string | null,
  heldRoleCodes: readonly string[],
  now = new Date()
) {
  let base = next;
  if (next !== null && !isBusinessRoleCode(next)) {
    const own = await tx.workspaceBusinessRole.findUnique({ where: { workspaceId_code: { workspaceId: scope.workspaceId, code: next } } });
    base = own ? (await tx.role.findUnique({ where: { code: next } }))?.baseRoleCode ?? null : null;
    if (!base || !isBusinessRoleCode(base)) throw new BadRequestException(`Vai trò nghiệp vụ không hợp lệ: ${next}`);
  }
  await tx.roleBinding.updateMany({ where: { ...scope, role: { OR: [{ code: { in: BUSINESS_ROLE_CODES } }, { baseRoleCode: { not: null } }] }, ...activeMembershipWhere(now) }, data: { endsAt: now } });
  const granted: string[] = [];
  if (next && base) {
    const withDefaults = DEFAULT_COST_PERMISSION_ROLE_CODES.includes(base) && !heldRoleCodes.some((code) => COST_PERMISSION_CODES.includes(code as CostPermissionCode));
    for (const code of new Set([base, next, ...(withDefaults ? COST_PERMISSION_CODES : [])])) {
      const role = await tx.role.findUnique({ where: { code } });
      if (!role) throw new BadRequestException(`Vai trò ${code} chưa được khởi tạo trong hệ thống`);
      await tx.roleBinding.upsert({ where: { userId_roleId_tenantKey_workspaceId: { ...scope, roleId: role.id } }, update: { startsAt: now, endsAt: null }, create: { ...scope, roleId: role.id, startsAt: now } });
      if (COST_PERMISSION_CODES.includes(code as CostPermissionCode)) granted.push(code);
    }
  }
  return { base, granted };
}
