import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_ROUTES,
  PRODUCTION_DISABLED_ROUTES,
  PRODUCTION_VISIBLE_ROUTES,
  getProductionRouteDecision,
  getShellRoutes,
  matchProductRoute,
  SYSTEM_ROUTES
} from "./production-route-readiness";

describe("canonical product route readiness", () => {
  it("classifies every route once", () => {
    expect(new Set(PRODUCT_ROUTES.map((route) => route.id)).size).toBe(PRODUCT_ROUTES.length);
    expect(new Set(PRODUCT_ROUTES.map((route) => route.href)).size).toBe(PRODUCT_ROUTES.length);
    expect(PRODUCTION_VISIBLE_ROUTES).toEqual([
      "/", "/projects", "/calendar", "/resource-mgmt", "/project-controls", "/people", "/users", "/clients", "/settings", "/analytics"
    ]);
    expect(PRODUCTION_DISABLED_ROUTES).toContain("/notes");
    expect(SYSTEM_ROUTES).toEqual(["/login", "/signup", "/unavailable", "/dashboard", "/workspace"]);
    const pagePatterns = [
      "/", "/projects", "/projects/:id", "/calendar", "/resource-mgmt", "/project-controls", "/people", "/people/:id", "/users", "/users/:id",
      "/clients", "/clients/:id", "/settings", "/analytics", "/tasks", "/tasks/:id", "/accounts", "/pipeline", "/proposals",
      "/finance", "/finance/:id", "/delivery", "/delivery/:id", "/support", "/portal", "/management", "/policy", "/data",
      "/activity", "/chats", "/constructor-x", "/files", "/invoices", "/knowledge", "/mail", "/messenger", "/notes"
    ];
    for (const pattern of pagePatterns) {
      expect(matchProductRoute(pattern.replace(":id", "record-1")), pattern).toBeDefined();
    }
  });

  it("exposes Analytics only in the Constructor production shell", () => {
    expect(matchProductRoute("/analytics")).toMatchObject({
      classification: "visible",
      shells: ["constructor"]
    });
    expect(getProductionRouteDecision("/analytics")).toBe("allow");
    expect(getShellRoutes("constructor", "production").map((route) => route.href)).toContain("/analytics");
    expect(getShellRoutes("shopify", "production").map((route) => route.href)).not.toContain("/analytics");
  });

  describe("Analytics production visibility requires its own GA flag", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("blocks /analytics in production when WORKFORCE_ANALYTICS_GA_ENABLED is unset or false", () => {
      expect(getProductionRouteDecision("/analytics", "production")).toBe("unavailable");
      vi.stubEnv("WORKFORCE_ANALYTICS_GA_ENABLED", "false");
      expect(getProductionRouteDecision("/analytics", "production")).toBe("unavailable");
    });

    it("allows /analytics in production once WORKFORCE_ANALYTICS_GA_ENABLED is true", () => {
      vi.stubEnv("WORKFORCE_ANALYTICS_GA_ENABLED", "true");
      expect(getProductionRouteDecision("/analytics", "production")).toBe("allow");
    });

    it("never gates /analytics outside production, matching beta-route dev behavior", () => {
      expect(getProductionRouteDecision("/analytics", "development")).toBe("allow");
      expect(getProductionRouteDecision("/analytics", "test")).toBe("allow");
    });

    it("does not affect routes without a productionFlag", () => {
      expect(getProductionRouteDecision("/projects", "production")).toBe("allow");
      expect(getProductionRouteDecision("/pipeline", "production")).toBe("unavailable");
    });
  });

  it("matches authenticated detail routes without putting them in top-level navigation", () => {
    expect(matchProductRoute("/projects/prj-1")?.classification).toBe("detail");
    expect(matchProductRoute("/people/u-01")?.classification).toBe("detail");
    expect(matchProductRoute("/users/usr-1")?.classification).toBe("detail");
    expect(matchProductRoute("/clients/acc-1")?.classification).toBe("detail");
    expect(matchProductRoute("/tasks/task-1")?.classification).toBe("detail");
    expect(getShellRoutes("constructor", "production").some((route) => route.classification === "detail")).toBe(false);
  });

  it("keeps beta routes out of production navigation and allows them only in development navigation", () => {
    expect(getShellRoutes("shopify", "production").map((route) => route.href)).toEqual([
      "/", "/resource-mgmt", "/project-controls"
    ]);
    expect(getShellRoutes("shopify", "development").map((route) => route.href)).toContain("/pipeline");
    expect(getProductionRouteDecision("/pipeline")).toBe("unavailable");
    expect(getProductionRouteDecision("/totally-unknown-business-page")).toBe("unclassified");
  });
});
