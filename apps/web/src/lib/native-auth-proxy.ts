import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildCrmApiEndpoint, CRM_SESSION_COOKIE_NAME } from "./crm-bff-proxy";
import { clearCrmSessionCookies, setCrmSessionCookie } from "./session-cookie";
import { isSameOriginAuthRequest, redactAuthCredentials } from "./auth-bff-security";

export const MFA_COOKIE = "lcrm_mfa_challenge";
export function setMfaChallengeCookie(response: NextResponse, token: string) {
  response.cookies.set(MFA_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 300, path: "/api/auth" });
}

export async function proxyNativeAuth(request: Request, path: string) {
  if (request.method !== "GET" && !isSameOriginAuthRequest(request)) return NextResponse.json({ message: "Same-origin request required" }, { status: 403 });
  const store = await cookies();
  const session = store.get(CRM_SESSION_COOKIE_NAME)?.value;
  let payload: Record<string, unknown> | undefined;
  if (request.method !== "GET") {
    try { payload = await request.json(); } catch { return NextResponse.json({ message: "Invalid JSON" }, { status: 400 }); }
    if (!payload || Array.isArray(payload) || typeof payload !== "object") return NextResponse.json({ message: "Invalid request" }, { status: 400 });
    if (path === "mfa/challenge") payload.challengeToken = store.get(MFA_COOKIE)?.value;
  }
  try {
    const endpoint = new URL(buildCrmApiEndpoint(`/auth/${path}`));
    if (!session && request.method === "GET" && process.env.NODE_ENV !== "production" && process.env.CRM_LOCAL_AUTO_AUTH === "true" && ["account", "sessions", "workspaces"].includes(path)) {
      endpoint.searchParams.set("principal", "founder");
    }
    const upstream = await fetch(endpoint, {
      method: request.method, cache: "no-store", headers: {
        "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}),
        "user-agent": request.headers.get("user-agent") || "CRM browser",
      }, body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await upstream.json().catch(() => ({ message: "Authentication service unavailable" })) as Record<string, unknown>;
    const response = NextResponse.json(redactAuthCredentials(body), { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    if (upstream.ok) {
      if (body.signInRequired) clearCrmSessionCookies(response);
      const sessionBody = body.session && typeof body.session === "object" ? body.session as Record<string, unknown> : body;
      if (typeof sessionBody.token === "string" && typeof sessionBody.expiresAt === "string") {
        setCrmSessionCookie(response, sessionBody.token, sessionBody.expiresAt);
        response.cookies.set(MFA_COOKIE, "", { maxAge: 0, path: "/api/auth" });
      }
      if (body.mfaRequired && typeof body.challengeToken === "string") setMfaChallengeCookie(response, body.challengeToken);
    }
    // An invalid password/MFA code must not erase an otherwise valid session.
    if (upstream.status === 401 && ["account", "sessions", "workspaces"].includes(path)) clearCrmSessionCookies(response);
    return response;
  } catch { return NextResponse.json({ message: "Authentication service unavailable. Please try again." }, { status: 503 }); }
}
