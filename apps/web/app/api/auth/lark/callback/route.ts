import { resolveAuthPublicOrigin } from "@/lib/auth-bff-security";
import { setMfaChallengeCookie } from "@/lib/native-auth-proxy";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { LarkOAuthCallbackResponse } from "@b2b-crm/contracts";
import { buildCrmApiEndpoint } from "../../../../../src/lib/crm-bff-proxy";
import { setCrmSessionCookie } from "../../../../../src/lib/session-cookie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const publicOrigin = resolveAuthPublicOrigin(request);
  if (!publicOrigin) return NextResponse.json({ message: "Untrusted public origin" }, { status: 400 });
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("lcrm_oauth_state")?.value;
  const invitationToken = cookieStore.get("lcrm_invitation_token")?.value;

  if (error) {
    const failure = redirectWithError(publicOrigin, `lark_${error}`); clearTransientAuthCookies(failure); return failure;
  }

  if (!code || !state || !expectedState || expectedState !== state) {
    const failure = redirectWithError(publicOrigin, "lark_state_mismatch"); clearTransientAuthCookies(failure); return failure;
  }

  const redirectUri = new URL("/api/auth/lark/callback", publicOrigin).toString();
  const response = await fetch(buildCrmApiEndpoint("/auth/lark/callback"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, state, redirectUri, invitationToken }),
    cache: "no-store"
  });
  const body = (await response.json()) as LarkOAuthCallbackResponse | { message?: string; mfaRequired?: boolean; challengeToken?: string; returnTo?: string };

  if (response.ok && "mfaRequired" in body && body.mfaRequired && body.challengeToken) {
    const target = new URL("/login", publicOrigin);
    target.searchParams.set("mfa", "1");
    target.searchParams.set("returnTo", safeReturnTo(body.returnTo || "/"));
    const nextResponse = NextResponse.redirect(target);
    setMfaChallengeCookie(nextResponse, body.challengeToken);
    clearTransientAuthCookies(nextResponse);
    return nextResponse;
  }

  if (!response.ok || !("token" in body)) {
    const errorMessage = "message" in body ? body.message : undefined;
    const nextResponse = redirectWithError(
      publicOrigin,
      invitationToken && errorMessage === "invitation_review_required"
        ? "invitation_review_required"
        : "lark_callback_failed"
    );
    clearTransientAuthCookies(nextResponse);
    return nextResponse;
  }

  const nextResponse = NextResponse.redirect(new URL(safeReturnTo(body.returnTo), publicOrigin));
  setCrmSessionCookie(nextResponse, body.token, body.expiresAt);
  clearTransientAuthCookies(nextResponse);

  return nextResponse;
}

function clearTransientAuthCookies(response: NextResponse) {
  response.cookies.set("lcrm_oauth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/api/auth/lark"
  });
  response.cookies.set("lcrm_invitation_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/api/auth"
  });
}

function redirectWithError(origin: string, error: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("auth_error", error);
  return NextResponse.redirect(url);
}

function safeReturnTo(returnTo: string) {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") && !/[\\\r\n]/.test(returnTo) ? returnTo : "/";
}
