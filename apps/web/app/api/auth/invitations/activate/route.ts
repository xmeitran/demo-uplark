import { resolveAuthPublicOrigin } from "@/lib/auth-bff-security";
import { proxyNativeAuth } from "@/lib/native-auth-proxy";
import { NextResponse } from "next/server";
import type { PortalInvitationActivationResponse } from "@b2b-crm/contracts";
import { buildCrmApiEndpoint } from "../../../../../src/lib/crm-bff-proxy";
import { setCrmSessionCookie } from "../../../../../src/lib/session-cookie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const publicOrigin = resolveAuthPublicOrigin(request);
  if (!publicOrigin) return NextResponse.json({ message: "Untrusted public origin" }, { status: 400 });
  const token = requestUrl.searchParams.get("token");
  if (!token) {
    const url = new URL("/login", publicOrigin);
    url.searchParams.set("auth_error", "missing_invitation_token");
    return NextResponse.redirect(url);
  }

  const nextResponse = NextResponse.redirect(new URL("/api/auth/lark/start?returnTo=/", publicOrigin));
  nextResponse.cookies.set("lcrm_invitation_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/api/auth"
  });

  return nextResponse;
}


export async function POST(request: Request) { return proxyNativeAuth(request, "invitations/activate"); }
