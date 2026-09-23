import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { buildCrmApiEndpoint, CRM_SESSION_COOKIE_NAME } from "../../../../src/lib/crm-bff-proxy";
import { clearCrmSessionCookies } from "../../../../src/lib/session-cookie";
import { isStagingBypassAuthEnabled } from "../../../../src/lib/crm-public-session-policy";

export const dynamic = "force-dynamic";

function localAutoAuthEnabled() {
  return (process.env.NODE_ENV !== "production" && process.env.CRM_LOCAL_AUTO_AUTH === "true") || isStagingBypassAuthEnabled();
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(CRM_SESSION_COOKIE_NAME)?.value;

  if (!sessionToken && !localAutoAuthEnabled()) {
    return NextResponse.json({ message: "Bearer session is required" }, { status: 401 });
  }

  const endpoint = new URL(buildCrmApiEndpoint("/auth/me"));
  if (localAutoAuthEnabled()) endpoint.searchParams.set("principal", "founder");
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {})
    }
  });
  const body = (await response.json().catch(() => ({ message: "Unable to read auth session" }))) as
    | PrincipalContext
    | { message?: string };
  const nextResponse = NextResponse.json(body, { status: response.status });

  if (response.status === 401) {
    clearCrmSessionCookies(nextResponse);
  }

  return nextResponse;
}
