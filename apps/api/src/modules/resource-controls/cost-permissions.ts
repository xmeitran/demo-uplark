import { ForbiddenException } from "@nestjs/common";
import type { PrincipalContext } from "@b2b-crm/contracts";

/**
 * One permission model for every P&L screen and endpoint:
 * view = any cost permission, edit = COST_EDIT, lock/reopen = COST_APPROVE.
 * Founder/GM implicitly holds all of them.
 */
const COST_VIEW_ROLES = new Set(["FOUNDER_GM", "COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"]);
const COST_EDIT_ROLES = new Set(["FOUNDER_GM", "COST_EDIT"]);
const COST_APPROVE_ROLES = new Set(["FOUNDER_GM", "COST_APPROVE"]);

const holds = (principal: PrincipalContext, roles: Set<string>) => principal.roleCodes.some((role) => roles.has(role));

export const canViewCost = (principal: PrincipalContext) => holds(principal, COST_VIEW_ROLES);
export const canEditCost = (principal: PrincipalContext) => holds(principal, COST_EDIT_ROLES);
export const canApproveCost = (principal: PrincipalContext) => holds(principal, COST_APPROVE_ROLES);

export function assertCostView(principal: PrincipalContext) {
  if (!canViewCost(principal)) throw new ForbiddenException("Financial P&L access requires an assigned cost permission group");
}

export function assertCostEdit(principal: PrincipalContext) {
  if (!canEditCost(principal)) throw new ForbiddenException("Cần quyền Sửa chi phí (COST_EDIT) hoặc Founder/GM để thay đổi số liệu P&L.");
}

export function assertCostApprove(principal: PrincipalContext) {
  if (!canApproveCost(principal)) throw new ForbiddenException("Cần quyền Duyệt chi phí (COST_APPROVE) hoặc Founder/GM để chốt hoặc mở lại kỳ.");
}
