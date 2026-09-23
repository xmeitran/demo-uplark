import { isSameOriginAuthRequest } from "./auth-bff-security";
import { shouldFailClosedOnProtectedFallback } from "./crm-public-session-policy";

export const CRM_SESSION_COOKIE_NAME = "lcrm_session";
export const DEFAULT_CRM_API_BASE_URL = "http://localhost:4000";

// Synthetic token created by /api/auth/demo/session for local development.
// Must NEVER be forwarded to the upstream production API — it's not a valid bearer token.
const LOCAL_DEV_SESSION_TOKEN = "local-founder-dev-session";

function localAutoAuthEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.CRM_LOCAL_AUTO_AUTH === "true";
}

export type CrmBffMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface CrmBffProxyOptions {
  request: Request;
  path: string;
  method?: CrmBffMethod;
  body?: unknown;
  principalFallback?: string;
  requireSessionForWrites?: boolean;
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
  getSessionToken?: () => Promise<string | undefined> | string | undefined;
}

const WRITE_METHODS = new Set<CrmBffMethod>(["POST", "PATCH", "PUT", "DELETE"]);

export async function proxyCrmBffJson(options: CrmBffProxyOptions): Promise<Response> {
  const method = options.method ?? "GET";
  if (WRITE_METHODS.has(method) && options.path.startsWith("/auth/") && !isSameOriginAuthRequest(options.request)) return Response.json({message:"Same-origin request required"}, {status:403});
  const fetcher = options.fetcher ?? fetch;
  const sessionToken = await resolveSessionToken(options.getSessionToken);

  if (WRITE_METHODS.has(method) && (options.requireSessionForWrites ?? true) && !sessionToken && !localAutoAuthEnabled()) {
    return Response.json({ message: "Bearer session is required" }, { status: 401 });
  }

  if (!sessionToken && shouldFailClosedOnProtectedFallback({})) {
    return Response.json({ message: "Bearer session is required" }, { status: 401 });
  }

  const targetUrl = buildCrmApiUrl({
    apiBaseUrl: options.apiBaseUrl,
    path: options.path,
    requestUrl: options.request.url,
    sessionToken,
    principalFallback: options.principalFallback ?? (localAutoAuthEnabled() ? "founder" : undefined)
  });
  const hasBody = options.body !== undefined;

  const response = await fetcher(targetUrl, {
    method,
    cache: "no-store",
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(method === "POST" && options.path === "/projects" && options.request.headers.get("Idempotency-Key") ? { "Idempotency-Key": options.request.headers.get("Idempotency-Key")! } : {}),
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {})
    },
    body: hasBody ? JSON.stringify(options.body) : undefined
  });

  return proxyResponseBody(response, Boolean(sessionToken));
}

export function buildCrmApiUrl(input: {
  path: string;
  requestUrl: string;
  sessionToken?: string;
  principalFallback?: string;
  apiBaseUrl?: string;
}) {
  const targetUrl = new URL(buildCrmApiEndpoint(input.path, input.apiBaseUrl));
  const incomingUrl = new URL(input.requestUrl);

  for (const [key, value] of incomingUrl.searchParams.entries()) {
    if (key !== "principal") {
      targetUrl.searchParams.append(key, value);
    }
  }

  if (!input.sessionToken && !shouldFailClosedOnProtectedFallback({})) {
    const requestedPrincipal = incomingUrl.searchParams.get("principal") ?? input.principalFallback;
    if (requestedPrincipal) {
      targetUrl.searchParams.set("principal", requestedPrincipal);
    }
  }

  return targetUrl.toString();
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    return undefined;
  }

  return JSON.parse(text);
}

export async function requireCrmSessionForBffWrite(getSessionToken?: CrmBffProxyOptions["getSessionToken"]) {
  const sessionToken = await resolveSessionToken(getSessionToken);
  if (!sessionToken) {
    return {
      ok: false as const,
      response: Response.json({ message: "Bearer session is required" }, { status: 401 })
    };
  }

  return { ok: true as const, sessionToken };
}

export async function resolveProtectedCrmBffSession(getSessionToken?: CrmBffProxyOptions["getSessionToken"]) {
  const sessionToken = await resolveSessionToken(getSessionToken);
  if (!sessionToken && shouldFailClosedOnProtectedFallback({})) {
    return {
      ok: false as const,
      response: Response.json({ message: "Bearer session is required" }, { status: 401 })
    };
  }

  return { ok: true as const, sessionToken };
}

async function resolveSessionToken(getSessionToken?: CrmBffProxyOptions["getSessionToken"]) {
  if (getSessionToken) {
    return getSessionToken();
  }

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get(CRM_SESSION_COOKIE_NAME)?.value;

  // Strip the synthetic local dev token — it must not be sent to the upstream API.
  if (process.env.NODE_ENV !== "production" && token === LOCAL_DEV_SESSION_TOKEN) {
    return undefined;
  }

  return token;
}

async function proxyResponseBody(response: Response, hadSessionToken = false) {
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";
  const headers = new Headers({
    "content-type": contentType
  });

  if (hadSessionToken && response.status === 401) {
    headers.set("x-crm-session-status", "invalid");
    for (const cookie of expiredCrmSessionCookies()) {
      headers.append("set-cookie", cookie);
    }
  }

  if (!body) {
    return new Response(null, { status: response.status, headers });
  }

  return new Response(body, {
    status: response.status,
    headers
  });
}

function expiredCrmSessionCookies() {
  const domain = process.env.CRM_SESSION_COOKIE_DOMAIN?.trim();
  return [
    expiredCrmSessionCookie(),
    domain ? expiredCrmSessionCookie(domain) : undefined
  ].filter(Boolean) as string[];
}

function expiredCrmSessionCookie(domain?: string) {
  return [
    `${CRM_SESSION_COOKIE_NAME}=`,
    domain ? `Domain=${domain}` : undefined,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : undefined
  ].filter(Boolean).join("; ");
}

export function getCrmApiBaseUrl(apiBaseUrl?: string) {
  return normalizeCrmApiBaseUrl(
    apiBaseUrl ?? process.env.CRM_API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_CRM_API_BASE_URL
  );
}

export function buildCrmApiEndpoint(path: string, apiBaseUrl?: string) {
  return new URL(path.replace(/^\/+/, ""), `${getCrmApiBaseUrl(apiBaseUrl)}/`).toString();
}

export function normalizeCrmApiBaseUrl(rawBaseUrl: string) {
  const url = new URL(rawBaseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/api") ? pathname : `${pathname}/api`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
