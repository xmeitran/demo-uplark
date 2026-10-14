import { ForbiddenException } from "@nestjs/common";
import type { AnalyticsRowScope, PrincipalContext } from "@b2b-crm/contracts";

/**
 * Row/field policy for workforce analytics, resolved once per request and
 * enforced in the service/query layer. Fields listed in `hiddenFields` are
 * never selected by any analytics query, regardless of role.
 */
export interface AnalyticsPolicy {
  rowScope: AnalyticsRowScope;
  /** Restrict facts to these project ids (undefined = no project restriction). */
  scopeKind: "workspace" | "managed_projects" | "self" | "related_accounts";
  /** Viewer may see named per-person rows inside the scope. */
  namedWorkforce: boolean;
  /** Viewer may see any per-person rows at all (named or pseudonymized). */
  userBreakdownAllowed: boolean;
  /** Viewer may filter or group results by user, department or team. */
  identityDimensionsAllowed: boolean;
  policyLabel: string;
  hiddenFields: string[];
}

export const ANALYTICS_HIDDEN_FIELDS = [
  "email",
  "note",
  "reviewNote",
  "privateComments",
  "costRate",
  "marginPercent",
  "budgetAmount",
  "plSnapshot"
] as const;

export function resolveAnalyticsPolicy(principal: PrincipalContext): AnalyticsPolicy {
  if (principal.subjectType !== "internal_user") {
    throw new ForbiddenException("Internal workforce analytics is not available to portal users");
  }

  const roles = new Set(principal.roleCodes ?? []);
  const hiddenFields = [...ANALYTICS_HIDDEN_FIELDS];

  // The account can retain Admin roles while deliberately working in User
  // view. Keep that mode private at the API boundary; hiding the nav alone is
  // not sufficient because a client can still call this endpoint directly.
  if (principal.viewMode === "user") {
    return {
      rowScope: "self",
      scopeKind: "self",
      namedWorkforce: true,
      userBreakdownAllowed: true,
      identityDimensionsAllowed: true,
      policyLabel: "member_user_view_self_scope",
      hiddenFields
    };
  }

  // Admin view is a workspace-level view. Business Admin roles (PM, Dx
  // Director and BD Lead) carry the effective WORKSPACE_ADMIN code, so this
  // check must run before narrower business-role policies such as
  // DELIVERY_LEAD or SALES_OWNER.
  if (roles.has("FOUNDER_GM") || roles.has("WORKSPACE_ADMIN")) {
    return {
      rowScope: "workspace",
      scopeKind: "workspace",
      namedWorkforce: true,
      userBreakdownAllowed: true,
      identityDimensionsAllowed: true,
      policyLabel: "admin_full_operational",
      hiddenFields
    };
  }

  if (roles.has("DELIVERY_LEAD")) {
    return {
      rowScope: "managed_projects",
      scopeKind: "managed_projects",
      namedWorkforce: true,
      userBreakdownAllowed: true,
      identityDimensionsAllowed: true,
      policyLabel: "delivery_lead_managed_projects",
      hiddenFields
    };
  }

  if (roles.has("FINANCE_ADMIN")) {
    return {
      rowScope: "financial_aggregate",
      scopeKind: "workspace",
      namedWorkforce: false,
      userBreakdownAllowed: false,
      identityDimensionsAllowed: false,
      policyLabel: "finance_admin_aggregate_only",
      hiddenFields
    };
  }

  if (roles.has("SALES_OWNER")) {
    return {
      rowScope: "related_accounts",
      scopeKind: "related_accounts",
      namedWorkforce: false,
      userBreakdownAllowed: false,
      identityDimensionsAllowed: false,
      policyLabel: "sales_owner_account_aggregate",
      hiddenFields
    };
  }

  return {
    rowScope: "self",
    scopeKind: "self",
    namedWorkforce: true,
    userBreakdownAllowed: true,
    identityDimensionsAllowed: true,
    policyLabel: "member_self_scope",
    hiddenFields
  };
}
