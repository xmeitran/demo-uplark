import { NextResponse } from "next/server";
import { PRODUCT_ROUTES, getProductionRouteDecision } from "../../../src/lib/production-route-readiness";

export const dynamic = "force-dynamic";

/**
 * Routes gated by a server-only `productionFlag` cannot be evaluated in the
 * browser, so the sidebar asks here. Same decision function as the middleware.
 */
export async function GET() {
  const flaggedRoutes = PRODUCT_ROUTES.filter((route) => route.productionFlag);
  return NextResponse.json({
    data: { availableFlaggedRoutes: flaggedRoutes.filter((route) => getProductionRouteDecision(route.href) === "allow").map((route) => route.href) }
  });
}
