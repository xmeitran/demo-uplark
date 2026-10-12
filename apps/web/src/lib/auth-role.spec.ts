import { describe, expect, it } from "vitest";
import { canViewCostFigures, hasAnyAuthRole, isAdminView, primaryAuthRole } from "./auth-role";

describe("isAdminView", () => {
  it("is true only for an Admin account working in admin view", () => {
    expect(isAdminView({ role: "PM", roleCodes: ["PM"], accountType: "ADMIN", viewMode: "admin" })).toBe(true);
    expect(isAdminView({ role: "WORKSPACE_ADMIN", roleCodes: ["WORKSPACE_ADMIN"] })).toBe(true);
    expect(isAdminView({ role: "FOUNDER_GM", roleCodes: ["FOUNDER_GM"], accountType: "ADMIN", viewMode: "user" })).toBe(false);
    expect(isAdminView({ role: "WORKSPACE_USER", roleCodes: ["WORKSPACE_USER"], accountType: "USER", viewMode: "admin" })).toBe(false);
    expect(isAdminView(null)).toBe(false);
  });
});

describe("primaryAuthRole", () => {
  it("shows Founder/GM first after a fresh login even when bindings arrive in another order", () => {
    expect(primaryAuthRole(["DELIVERY_LEAD", "FOUNDER_GM"])).toBe("FOUNDER_GM");
  });

  it("uses the highest known role priority", () => {
    expect(primaryAuthRole(["SALES_OWNER", "FINANCE_ADMIN"])).toBe("FINANCE_ADMIN");
  });

  it("preserves an unknown role when no known priority applies", () => {
    expect(primaryAuthRole(["CUSTOMER_ADMIN"])).toBe("CUSTOMER_ADMIN");
  });

  it("uses Member when the session has no roles", () => {
    expect(primaryAuthRole()).toBe("Member");
  });

  it("authorizes against every role binding instead of only the display-primary role", () => {
    expect(hasAnyAuthRole({
      role: "FINANCE_ADMIN",
      roleCodes: ["FINANCE_ADMIN", "DELIVERY_LEAD"]
    }, ["FOUNDER_GM", "DELIVERY_LEAD"])).toBe(true);
    expect(hasAnyAuthRole({
      role: "FINANCE_ADMIN",
      roleCodes: ["FINANCE_ADMIN"]
    }, ["FOUNDER_GM", "DELIVERY_LEAD"])).toBe(false);
  });

  it("keeps legacy locally stored users compatible through the collapsed role fallback", () => {
    expect(hasAnyAuthRole({ role: "DELIVERY_LEAD" }, ["FOUNDER_GM", "DELIVERY_LEAD"])).toBe(true);
  });

  it("shows money figures only to the cost permission group and Founder/GM", () => {
    for (const code of ["FOUNDER_GM", "COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"]) {
      expect(canViewCostFigures({ role: "PM", roleCodes: ["PM", code] })).toBe(true);
    }
    expect(canViewCostFigures({ role: "WORKSPACE_ADMIN", roleCodes: ["PM", "WORKSPACE_ADMIN", "SALES_OWNER"] })).toBe(false);
    expect(canViewCostFigures(null)).toBe(false);
  });
});
