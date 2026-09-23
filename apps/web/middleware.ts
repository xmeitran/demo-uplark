import { NextResponse, type NextRequest } from "next/server";
import { getProductionRouteDecision, matchProductRoute } from "./src/lib/production-route-readiness";
import { isStagingBypassAuthEnabled } from "./src/lib/crm-public-session-policy";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/favicon.ico") {
    const target = request.nextUrl.clone();
    target.pathname = "/icon.svg";
    return withDocumentNoStore(NextResponse.rewrite(target));
  }

  const isAuthenticated = Boolean(request.cookies.get("lcrm_session")?.value);
  
  const isAuthRoute = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup";
  if (isAuthRoute) {
    return withDocumentNoStore(NextResponse.next());
  }

  const localAutoAuth = (process.env.NODE_ENV !== "production" && process.env.CRM_LOCAL_AUTO_AUTH === "true") || isStagingBypassAuthEnabled();
  if (!isAuthenticated && !localAutoAuth) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    target.searchParams.set("returnTo", returnToFrom(request));
    return withDocumentNoStore(NextResponse.redirect(target));
  }

  if (request.nextUrl.pathname === "/dashboard" || request.nextUrl.pathname === "/workspace") {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    return withDocumentNoStore(NextResponse.redirect(target));
  }

  if (process.env.NODE_ENV === "production" && request.nextUrl.pathname !== "/unavailable") {
    const decision = getProductionRouteDecision(request.nextUrl.pathname);
    const isProductRoute = Boolean(matchProductRoute(request.nextUrl.pathname));
    if (decision === "unavailable" || (!isProductRoute && isMatchedBusinessPrefix(request.nextUrl.pathname))) {
      const target = request.nextUrl.clone();
      target.pathname = "/unavailable";
      target.search = "";
      target.searchParams.set("route", request.nextUrl.pathname);
      return withDocumentNoStore(NextResponse.rewrite(target));
    }
  }

  return withDocumentNoStore(NextResponse.next());
}

export const config = {
  matcher: [
    "/favicon.ico",
    "/",
    "/login",
    "/signup",
    "/unavailable",
    "/dashboard",
    "/workspace",
    // App routes
    "/calendar", "/calendar/:path*",
    "/projects", "/projects/:path*",
    "/users",    "/users/:path*",
    "/tasks",    "/tasks/:path*",
    "/notes",    "/notes/:path*",
    "/files",    "/files/:path*",
    "/mail",     "/mail/:path*",
    "/settings", "/settings/:path*",
    "/activity", "/activity/:path*",
    "/invoices", "/invoices/:path*",
    "/chats",    "/chats/:path*",
    "/clients",  "/clients/:path*",
    "/constructor-x", "/constructor-x/:path*",
    "/knowledge","/knowledge/:path*",
    "/messenger","/messenger/:path*",
    // Legacy/existing routes
    "/accounts/:path*",
    "/analytics", "/analytics/:path*",
    "/data/:path*",
    "/delivery/:path*",
    "/finance/:path*",
    "/management/:path*",
    "/pipeline/:path*",
    "/policy/:path*",
    "/portal/:path*",
    "/project-controls/:path*",
    "/proposals/:path*",
    "/resource-mgmt/:path*",
    "/support/:path*",
  ]
};



function isMatchedBusinessPrefix(pathname: string) {
  return [
    "/accounts", "/activity", "/analytics", "/calendar", "/chats", "/clients", "/constructor-x", "/data",
    "/delivery", "/files", "/finance", "/invoices", "/knowledge", "/mail", "/management",
    "/messenger", "/notes", "/pipeline", "/policy", "/portal", "/project-controls", "/projects",
    "/proposals", "/resource-mgmt", "/settings", "/support", "/tasks", "/users"
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function returnToFrom(request: NextRequest) {
  if (request.nextUrl.pathname === "/dashboard" || request.nextUrl.pathname === "/workspace") {
    return "/";
  }

  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }

  return value;
}

function withDocumentNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Surrogate-Control", "no-store");
  response.headers.set("Alt-Svc", "clear");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
