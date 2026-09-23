import { resolveAuthPublicOrigin } from "@/lib/auth-bff-security";
import { isSameOriginAuthRequest } from "@/lib/auth-bff-security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildCrmApiEndpoint, CRM_SESSION_COOKIE_NAME } from "../../../../../src/lib/crm-bff-proxy";
import { clearCrmSessionCookies } from "../../../../../src/lib/session-cookie";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return NextResponse.json({message:"Same-origin request required"}, {status:403});
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(CRM_SESSION_COOKIE_NAME)?.value;
  const revocation = sessionToken
    ? await revokeApiSession(sessionToken)
    : { reachable: true, revoked: false };

  const requestUrl = new URL(request.url);
  const publicOrigin = resolveAuthPublicOrigin(request);
  if (!publicOrigin) return NextResponse.json({ message: "Untrusted public origin" }, { status: 400 });
  const loginUrl = new URL("/login", publicOrigin);
  loginUrl.searchParams.set("returnTo", "/");
  if (revocation.reachable) {
    loginUrl.searchParams.set("logged_out", "1");
  } else {
    loginUrl.searchParams.set("auth_error", "logout_cleanup_failed");
  }
  const response = NextResponse.redirect(loginUrl, 303);
  clearCrmSessionCookies(response);

  return response;
}


async function revokeApiSession(sessionToken: string) {
  try {
    const response = await fetch(
      buildCrmApiEndpoint("/auth/session/revoke"),
      {
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${sessionToken}`
        }
      }
    );

    if (!response.ok) {
      return { reachable: false, revoked: false };
    }

    const payload = await response.json().catch(() => ({ revoked: false })) as { revoked?: boolean };
    return { reachable: true, revoked: payload.revoked === true };
  } catch {
    return { reachable: false, revoked: false };
  }
}
