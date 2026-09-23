import { resolveAuthPublicOrigin } from "@/lib/auth-bff-security";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { safeAuthReturnTo } from "@/lib/auth-bff-security";
import { NextResponse } from "next/server";
import type { LarkAuthorizeUrlResponse } from "@b2b-crm/contracts";
import { buildCrmApiEndpoint } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const publicOrigin = resolveAuthPublicOrigin(request);
  if (!publicOrigin) return NextResponse.json({ message: "Untrusted public origin" }, { status: 400 });
  const returnTo = safeAuthReturnTo(requestUrl.searchParams.get("returnTo"));
  const redirectUri = new URL("/api/auth/lark/callback", publicOrigin).toString();
  const apiUrl = new URL(buildCrmApiEndpoint("/auth/lark/authorize-url"));
  apiUrl.searchParams.set("returnTo", returnTo);
  apiUrl.searchParams.set("redirectUri", redirectUri);
  const invitationToken = (await cookies()).get("lcrm_invitation_token")?.value;
  if (invitationToken) apiUrl.searchParams.set("invitationTokenHash", createHash("sha256").update(invitationToken).digest("hex"));

  const response = await fetch(apiUrl, { cache: "no-store" });
  const body = (await response.json()) as LarkAuthorizeUrlResponse | { message?: string };
  if (!response.ok || !("authorizationUrl" in body)) {
    return NextResponse.json(body, { status: response.status });
  }

  const nextResponse = NextResponse.redirect(body.authorizationUrl);
  nextResponse.cookies.set("lcrm_oauth_state", body.state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(body.expiresAt),
    path: "/api/auth/lark"
  });

  return nextResponse;
}
