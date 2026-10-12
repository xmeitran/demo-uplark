import { ForbiddenException } from "@nestjs/common";
import type { PrincipalContext } from "@b2b-crm/contracts";

/**
 * Rules 7.7 / D-34 — the cost permission group ("Admin - nhóm quyền chi phí", CR-10): Xem, Sửa, Duyệt, Xuất theo quyền
 * được cấp. One model for every P&L and staff-cost screen and endpoint:
 * view = any cost permission, edit = COST_EDIT, lock/reopen a cost period = COST_APPROVE, export = COST_EXPORT.
 * Founder/GM implicitly holds all of them.
 */
const COST_VIEW_ROLES = new Set(["FOUNDER_GM", "COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"]);
const COST_EDIT_ROLES = new Set(["FOUNDER_GM", "COST_EDIT"]);
const COST_APPROVE_ROLES = new Set(["FOUNDER_GM", "COST_APPROVE"]);
const COST_EXPORT_ROLES = new Set(["FOUNDER_GM", "COST_EXPORT"]);

const holds = (principal: PrincipalContext, roles: Set<string>) => principal.roleCodes.some((role) => roles.has(role));

export const canViewCost = (principal: PrincipalContext) => holds(principal, COST_VIEW_ROLES);
export const canEditCost = (principal: PrincipalContext) => holds(principal, COST_EDIT_ROLES);
export const canApproveCost = (principal: PrincipalContext) => holds(principal, COST_APPROVE_ROLES);
/** Export is done by the browser from data the viewer already holds; the API tells the screens whether to offer it. */
export const canExportCost = (principal: PrincipalContext) => holds(principal, COST_EXPORT_ROLES);

export function assertCostView(principal: PrincipalContext) {
  if (!canViewCost(principal)) throw new ForbiddenException("Financial P&L access requires an assigned cost permission group");
}

export function assertCostEdit(principal: PrincipalContext) {
  if (!canEditCost(principal)) throw new ForbiddenException("Cần quyền Sửa chi phí (COST_EDIT) hoặc Founder/GM để thay đổi chi phí nhân sự và khoản mục chi phí.");
}

export function assertCostApprove(principal: PrincipalContext) {
  if (!canApproveCost(principal)) throw new ForbiddenException("Cần quyền Duyệt chi phí (COST_APPROVE) hoặc Founder/GM để chốt hoặc mở lại kỳ chi phí.");
}

/**
 * Mục 6.1 dòng Quyền: "Admin - PM sửa; Admin khác xem". Judged on the roles bound to the account (every Admin role
 * implies WORKSPACE_ADMIN, so the effective codes cannot tell a PM from a Dx Director). Founder/GM and a bound
 * Workspace Admin hold every Admin right, as for "đổi PIC" in the role catalogue (contracts/access-control.ts).
 */
const PROJECT_SETUP_EDIT_ROLES = new Set(["PM", "FOUNDER_GM", "WORKSPACE_ADMIN"]);
export const canEditProjectSetup = (principal: PrincipalContext) => (principal.heldRoleCodes ?? principal.roleCodes).some((role) => PROJECT_SETUP_EDIT_ROLES.has(role));

export function assertProjectSetupEdit(principal: PrincipalContext) {
  if (!canEditProjectSetup(principal)) throw new ForbiddenException("Thiết lập P&L của dự án do PM sửa (Founder/GM, Workspace Admin cũng sửa được); Admin khác chỉ xem.");
}
