export type ProductRouteClassification = "visible" | "detail" | "beta" | "disabled";
export type ProductShell = "constructor" | "shopify";

export type ProductRoute = {
  classification: ProductRouteClassification;
  href: string;
  id: string;
  label: string;
  match?: "exact" | "prefix";
  navGroup?: string;
  shells?: readonly ProductShell[];
  /**
   * Name of a server env var that must be "true"/"1" for this route to be
   * reachable in production, even though its classification is "visible".
   * Lets a route ship as visible/GA in navigation config while the backing
   * API stays behind its own rollout flag until both are ready together.
   */
  productionFlag?: string;
};

/**
 * Canonical, presentation-free route policy. Keep this module Edge-safe: no
 * React, browser or Node-only imports. Shells map `id` to their own icons.
 */
export const PRODUCT_ROUTES: readonly ProductRoute[] = [
  { id: "dashboard", href: "/", label: "Dashboard", classification: "visible", shells: ["constructor", "shopify"], navGroup: "Vận hành lõi" },
  { id: "projects", href: "/projects", label: "Projects", classification: "visible", shells: ["constructor"], navGroup: "Navigate" },
  { id: "calendar", href: "/calendar", label: "Calendar", classification: "visible", shells: ["constructor"], navGroup: "Navigate" },
  { id: "resource-mgmt", href: "/resource-mgmt", label: "Nguồn lực", classification: "visible", shells: ["constructor", "shopify"], navGroup: "Triển khai" },
  { id: "project-controls", href: "/project-controls", label: "Kiểm soát dự án", classification: "visible", shells: ["constructor", "shopify"], navGroup: "Triển khai" },
  { id: "people", href: "/people", label: "Hồ sơ nhân sự", classification: "visible", shells: ["constructor"], navGroup: "Triển khai" },
  { id: "users", href: "/users", label: "Users", classification: "visible", shells: ["constructor"], navGroup: "Navigate" },
  { id: "clients", href: "/clients", label: "Clients", classification: "visible", shells: ["constructor"], navGroup: "Navigate" },
  { id: "settings", href: "/settings", label: "Settings", classification: "visible", shells: ["constructor"], navGroup: "Settings" },
  // Admin is linked conditionally by the sidebar after the session role is known;
  // keep it out of the generic production navigation list while allowing the
  // protected page/API to render for authorized workspace administrators.
  { id: "admin", href: "/admin", label: "Admin", classification: "detail", shells: ["constructor"], navGroup: "Settings" },
  { id: "analytics", href: "/analytics", label: "Analytics", classification: "visible", shells: ["constructor"], navGroup: "Quản trị", productionFlag: "WORKFORCE_ANALYTICS_GA_ENABLED" },

  // Timesheet ships against mock data first (spec 35 §7). Keep it "beta" so it
  // is navigable locally but never reachable in production until the real
  // endpoints replace `timesheet-mock-data`.
  { id: "timesheet", href: "/timesheet", label: "Timesheet", classification: "beta", shells: ["constructor"], navGroup: "Triển khai" },
  // P&L uses the canonical project-control summary when available and keeps a
  // clearly labelled demo fallback while period-close and revenue contracts are
  // still being finalized.
  { id: "pnl", href: "/pnl", label: "P&L", classification: "beta", shells: ["constructor"], navGroup: "Triển khai" },

  { id: "project-detail", href: "/projects/", label: "Project detail", classification: "detail", match: "prefix" },
  { id: "user-detail", href: "/users/", label: "User detail", classification: "detail", match: "prefix" },
  { id: "people-detail", href: "/people/", label: "People detail", classification: "detail", match: "prefix" },
  { id: "client-detail", href: "/clients/", label: "Client detail", classification: "detail", match: "prefix" },
  { id: "task-detail", href: "/tasks/", label: "Task detail", classification: "detail", match: "prefix" },

  { id: "pipeline", href: "/pipeline", label: "Cơ hội", classification: "beta", shells: ["shopify"], navGroup: "Vận hành lõi" },
  { id: "accounts", href: "/accounts", label: "Khách hàng", classification: "beta", shells: ["shopify"], navGroup: "Vận hành lõi" },
  { id: "tasks", href: "/tasks", label: "Công việc", classification: "beta", shells: ["shopify"], navGroup: "Vận hành lõi" },
  { id: "proposals", href: "/proposals", label: "Đề xuất", classification: "beta", shells: ["shopify"], navGroup: "Thương mại" },
  { id: "finance", href: "/finance", label: "Tài chính", classification: "beta", shells: ["shopify"], navGroup: "Thương mại" },
  { id: "delivery", href: "/delivery", label: "Dự án triển khai", classification: "beta", shells: ["shopify"], navGroup: "Triển khai" },
  { id: "support", href: "/support", label: "Hỗ trợ khách hàng", classification: "beta", shells: ["shopify"], navGroup: "Khách hàng" },
  { id: "portal", href: "/portal", label: "Giao diện khách hàng", classification: "beta", shells: ["shopify"], navGroup: "Khách hàng" },
  { id: "management", href: "/management", label: "Điều hành", classification: "beta", shells: ["shopify"], navGroup: "Quản trị" },
  { id: "policy", href: "/policy", label: "Chính sách", classification: "beta", shells: ["shopify"], navGroup: "Quản trị" },
  { id: "data", href: "/data", label: "Dữ liệu", classification: "beta", shells: ["shopify"], navGroup: "Quản trị" },

  ...["activity", "chats", "constructor-x", "files", "invoices", "knowledge", "mail", "messenger", "notes"].map((id) => ({
    id,
    href: `/${id}`,
    label: id,
    classification: "disabled" as const
  }))
];

export const PRODUCTION_VISIBLE_ROUTES = PRODUCT_ROUTES.filter((route) => route.classification === "visible").map((route) => route.href);
export const PRODUCTION_DISABLED_ROUTES = PRODUCT_ROUTES.filter((route) => route.classification === "disabled").map((route) => route.href);
export const SYSTEM_ROUTES = ["/login", "/signup", "/unavailable", "/dashboard", "/workspace"] as const;

export function matchProductRoute(pathname: string): ProductRoute | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PRODUCT_ROUTES.find((route) => route.match !== "prefix" && route.href === normalized)
    ?? PRODUCT_ROUTES.find((route) => route.match === "prefix" && normalized.startsWith(route.href) && normalized.length > route.href.length)
    ?? PRODUCT_ROUTES.find((route) => route.classification === "beta" && normalized.startsWith(`${route.href}/`));
}

export function getShellRoutes(shell: ProductShell, environment: string = process.env.NODE_ENV ?? "production"): ProductRoute[] {
  return PRODUCT_ROUTES.filter((route) => route.shells?.includes(shell) && (
    route.classification === "visible" || (environment !== "production" && route.classification === "beta")
  ));
}

export function getProductionRouteDecision(
  pathname: string,
  environment = process.env.NODE_ENV
): "allow" | "unavailable" | "unclassified" {
  const route = matchProductRoute(pathname);
  if (!route) return "unclassified";
  // Render's demo deployment is an isolated staging runtime. Expose the
  // completed beta surfaces there for review without promoting them to a
  // real production deployment yet.
  // The Render review/demo runtime is intentionally isolated from production
  // writes.  It may be configured either with the server-side CRM_ENV flag or
  // the public staging bypass flag (the latter is useful when a service was
  // provisioned from an older blueprint and has not received CRM_ENV yet).
  const stagingRuntime = process.env.CRM_ENV === "staging"
    || process.env.NEXT_PUBLIC_STAGING_BYPASS_AUTH === "true";
  if (route.classification === "beta" && stagingRuntime) return "allow";
  if (route.classification !== "visible" && route.classification !== "detail") return "unavailable";
  if (!isProductionFlagEnabled(route, environment)) return "unavailable";
  return "allow";
}

/**
 * A route's own `productionFlag` (if any) must resolve truthy in production.
 * Outside production every route is reachable, matching how beta routes are
 * already always navigable in non-production shells.
 */
function isProductionFlagEnabled(route: ProductRoute, environment: string | undefined): boolean {
  if (!route.productionFlag) return true;
  if (environment !== "production") return true;
  const raw = process.env[route.productionFlag];
  return raw === "true" || raw === "1";
}

export function isProductionVisibleRoute(href: string) {
  return matchProductRoute(href)?.classification === "visible";
}

export function isProductionDisabledRoute(href: string) {
  return matchProductRoute(href)?.classification === "disabled";
}

export function isLocalNavigationVisibleRoute(href: string) {
  const route = matchProductRoute(href);
  const stagingBetaEnabled = process.env.NODE_ENV !== "production"
    || process.env.NEXT_PUBLIC_STAGING_BYPASS_AUTH === "true";
  return route?.classification === "visible" || (stagingBetaEnabled && route?.classification === "beta");
}
