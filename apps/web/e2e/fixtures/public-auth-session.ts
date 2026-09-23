import type { BrowserContext } from "@playwright/test";

export const PUBLIC_AUTH_SESSION_COOKIE_NAME = process.env.CRM_E2E_SESSION_COOKIE_NAME ?? "lcrm_session";

export interface PublicAuthSessionFixtureResult {
  available: boolean;
  reason?: string;
}

async function requestLocalDemoSession(context: BrowserContext, baseURL: string): Promise<PublicAuthSessionFixtureResult> {
  const origin = new URL(baseURL).origin;
  const response = await context.request.post(new URL("/api/auth/demo/session", origin).toString(), {
    headers: { Origin: origin },
    data: {},
    maxRedirects: 0
  });

  if (!response.ok()) {
    const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
    const safeMessages = ["Same-origin request required", "Demo sessions are disabled in production", "No active demo user is available", "Active workspace membership is required", "Account is inactive", "Untrusted public origin"];
    const detail = typeof body?.message === "string" && safeMessages.includes(body.message) ? ` (${body.message})` : "";
    return { available: false, reason: `Local demo-session bootstrap returned HTTP ${response.status()}${detail}; check local demo flags and API connectivity.` };
  }

  const cookies = await context.cookies(origin);
  const session = cookies.find((cookie) => cookie.name === PUBLIC_AUTH_SESSION_COOKIE_NAME && cookie.httpOnly && cookie.value);
  return session
    ? { available: true }
    : { available: false, reason: "Local demo-session bootstrap did not install the expected HttpOnly session cookie." };
}

function isLocalBaseUrl(baseURL: string) {
  const hostname = new URL(baseURL).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function canRequestDemoSession(baseURL: string) {
  return isLocalBaseUrl(baseURL) && (
    process.env.CI !== "true" ||
    process.env.CRM_E2E_USE_DEMO_SESSION === "1" ||
    process.env.CRM_E2E_START_API === "1"
  );
}

export async function installPublicAuthSessionFixture(
  context: BrowserContext,
  baseURL: string | undefined
): Promise<PublicAuthSessionFixtureResult> {
  if (!baseURL) {
    return {
      available: false,
      reason: "E2E_BASE_URL or Playwright baseURL is required for public authenticated smoke."
    };
  }

  const token = process.env.CRM_E2E_SESSION_TOKEN;
  if (!token && canRequestDemoSession(baseURL)) {
    return requestLocalDemoSession(context, baseURL);
  }

  if (!token) {
    return {
      available: false,
      reason:
        "CRM_E2E_SESSION_TOKEN is required for public authenticated smoke, or set CRM_E2E_USE_DEMO_SESSION=1 with a running localhost demo-session API."
    };
  }

  const publicUrl = new URL(baseURL);
  await context.addCookies([
    {
      name: PUBLIC_AUTH_SESSION_COOKIE_NAME,
      value: token,
      url: publicUrl.origin,
      httpOnly: true,
      secure: publicUrl.protocol === "https:",
      sameSite: "Lax"
    }
  ]);

  return { available: true };
}

export function shouldRequirePublicAuthSmoke() {
  return process.env.CRM_PUBLIC_AUTH_SMOKE_REQUIRED === "1" || process.env.CRM_E2E_REQUIRE_AUTH === "1";
}
