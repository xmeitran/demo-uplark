/** Public origins are configuration, never arbitrary forwarded-header input. */
function configuredAuthOrigins() {
  const origins = new Set<string>();
  for (const value of [process.env.PUBLIC_WEB_URL, process.env.CRM_AUTH_PUBLIC_ORIGIN]) {
    const origin = parseAuthOrigin(value);
    if (origin) origins.add(origin);
  }
  for (const value of (process.env.LARK_OAUTH_REDIRECT_URIS ?? "").split(",")) {
    try {
      const url = new URL(value.trim());
      if (url.pathname !== "/api/auth/lark/callback" || url.search || url.hash || url.username || url.password) continue;
      const origin = parseAuthOrigin(url.origin);
      if (origin) origins.add(origin);
    } catch { /* Ignore invalid configuration entries; resolution fails closed. */ }
  }
  return origins;
}

function parseAuthOrigin(value: string | null | undefined) {
  if (!value || /[\s,\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch { return undefined; }
}

/** Nginx must overwrite forwarding headers; only configured origins are accepted. */
export function resolveAuthPublicOrigin(request: Request): string | undefined {
  const allowed = configuredAuthOrigins();
  const requestUrl = new URL(request.url);
  if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname)) {
    allowed.add(requestUrl.origin);
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost !== null || forwardedProto !== null) {
    if (!forwardedHost || !forwardedProto || !["http", "https"].includes(forwardedProto) || /[\s,\\/@?#]/.test(forwardedHost)) return undefined;
    const forwardedOrigin = parseAuthOrigin(`${forwardedProto}://${forwardedHost}`);
    return forwardedOrigin && allowed.has(forwardedOrigin) ? forwardedOrigin : undefined;
  }
  if (allowed.has(requestUrl.origin)) return requestUrl.origin;
  // A single canonical deployment can use its explicit origin without proxy headers.
  return parseAuthOrigin(process.env.PUBLIC_WEB_URL);
}

/** Reject cross-origin form/JSON mutations before any upstream operation. */
export function isSameOriginAuthRequest(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const expected = resolveAuthPublicOrigin(request);
    return !!expected && parseAuthOrigin(origin) === expected;
  } catch { return false; }
}

export function safeAuthReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  return value.startsWith("/login") ? "/" : value;
}

export function redactAuthCredentials(body: Record<string, unknown>) {
  const { token: _token, challengeToken: _challenge, session, ...safe } = body;
  if (session && typeof session === "object") {
    const { token: _sessionToken, ...sessionInfo } = session as Record<string, unknown>;
    return { ...safe, session: sessionInfo };
  }
  return safe;
}
