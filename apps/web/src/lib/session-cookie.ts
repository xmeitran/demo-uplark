import type { NextResponse } from "next/server";
import { CRM_SESSION_COOKIE_NAME } from "./crm-bff-proxy";

function configuredCookieDomain() {
  return process.env.CRM_SESSION_COOKIE_DOMAIN?.trim() || undefined;
}

function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/"
  };
}

export function setCrmSessionCookie(response: NextResponse, token: string, expiresAt: string) {
  const domain = configuredCookieDomain();
  response.cookies.set(CRM_SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(new Date(expiresAt)),
    ...(domain ? { domain } : {})
  });
}

export function clearCrmSessionCookies(response: NextResponse) {
  const domain = configuredCookieDomain();
  response.headers.append("set-cookie", expiredSessionCookie());

  if (domain) {
    response.headers.append("set-cookie", expiredSessionCookie(domain));
  }
}

function expiredSessionCookie(domain?: string) {
  return [
    `${CRM_SESSION_COOKIE_NAME}=`,
    domain ? `Domain=${domain}` : undefined,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : undefined
  ].filter(Boolean).join("; ");
}
