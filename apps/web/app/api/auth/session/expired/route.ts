import { resolveAuthPublicOrigin } from "@/lib/auth-bff-security";
import { NextResponse } from "next/server";
import { clearCrmSessionCookies } from "../../../../../src/lib/session-cookie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const publicOrigin = resolveAuthPublicOrigin(request);
  if (!publicOrigin) return NextResponse.json({ message: "Untrusted public origin" }, { status: 400 });
  const loginUrl = new URL("/login", publicOrigin);
  loginUrl.searchParams.set("returnTo", safeReturnTo(requestUrl.searchParams.get("returnTo")));
  const reason = requestUrl.searchParams.get("reason");
  if (reason === "logout") {
    loginUrl.searchParams.set("logged_out", "1");
  } else if (reason === "logout_cleanup_failed") {
    loginUrl.searchParams.set("auth_error", "logout_cleanup_failed");
  } else {
    loginUrl.searchParams.set("auth_error", "session_required");
  }

  const response = NextResponse.redirect(loginUrl);
  clearCrmSessionCookies(response);

  return response;
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }

  return value;
}
