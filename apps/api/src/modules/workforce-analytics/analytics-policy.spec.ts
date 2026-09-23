import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { resolveAnalyticsPolicy } from "./analytics-policy";

function principal(overrides: Partial<PrincipalContext>): PrincipalContext {
  return {
    subjectType: "internal_user",
    subjectId: "usr-1",
    tenantKey: "prod",
    workspaceId: "twk-foundation",
    workspaceKey: "default",
    displayName: "Test",
    email: "test@example.com",
    roleCodes: [],
    accountIds: [],
    projectIds: [],
    customerAccountIds: [],
    customerProjectIds: [],
    roleVersion: "roles:",
    grantVersion: "grants:",
    ...overrides
  } as PrincipalContext;
}

describe("resolveAnalyticsPolicy", () => {
  it("denies portal users entirely", () => {
    expect(() => resolveAnalyticsPolicy(principal({ subjectType: "portal_user" }))).toThrow(ForbiddenException);
  });

  it("gives Founder/GM full workspace scope with named workforce", () => {
    const policy = resolveAnalyticsPolicy(principal({ roleCodes: ["FOUNDER_GM", "SALES_OWNER"] }));
    expect(policy.rowScope).toBe("workspace");
    expect(policy.namedWorkforce).toBe(true);
    expect(policy.userBreakdownAllowed).toBe(true);
  });

  it("scopes Delivery Lead to member projects with named workforce", () => {
    const policy = resolveAnalyticsPolicy(principal({ roleCodes: ["DELIVERY_LEAD"] }));
    expect(policy.rowScope).toBe("managed_projects");
    expect(policy.scopeKind).toBe("managed_projects");
    expect(policy.namedWorkforce).toBe(true);
    expect(policy.identityDimensionsAllowed).toBe(true);
  });

  it("restricts Finance Admin to aggregate-only workforce analytics", () => {
    const policy = resolveAnalyticsPolicy(principal({ roleCodes: ["FINANCE_ADMIN"] }));
    expect(policy.rowScope).toBe("financial_aggregate");
    expect(policy.namedWorkforce).toBe(false);
    expect(policy.userBreakdownAllowed).toBe(false);
    expect(policy.identityDimensionsAllowed).toBe(false);
  });

  it("restricts Sales Owner to related-account aggregates without user breakdown", () => {
    const policy = resolveAnalyticsPolicy(principal({ roleCodes: ["SALES_OWNER"] }));
    expect(policy.rowScope).toBe("related_accounts");
    expect(policy.userBreakdownAllowed).toBe(false);
    expect(policy.identityDimensionsAllowed).toBe(false);
  });

  it("defaults role-less internal users to self scope", () => {
    const policy = resolveAnalyticsPolicy(principal({ roleCodes: [] }));
    expect(policy.rowScope).toBe("self");
    expect(policy.namedWorkforce).toBe(true);
  });

  it("always hides sensitive fields", () => {
    const policy = resolveAnalyticsPolicy(principal({ roleCodes: ["FOUNDER_GM"] }));
    for (const field of ["email", "note", "costRate", "marginPercent"]) {
      expect(policy.hiddenFields).toContain(field);
    }
  });
});
