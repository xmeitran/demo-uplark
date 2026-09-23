import { describe, expect, it } from "vitest";
import { hasAnyAuthRole, primaryAuthRole } from "./auth-role";

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
});
