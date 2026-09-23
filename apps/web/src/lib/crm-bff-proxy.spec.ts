import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCrmApiEndpoint,
  buildCrmApiUrl,
  normalizeCrmApiBaseUrl,
  proxyCrmBffJson,
  resolveProtectedCrmBffSession,
  requireCrmSessionForBffWrite
} from "./crm-bff-proxy";

describe("crm-bff-proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies write requests without a session before reaching the API", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/tasks?principal=founder"),
      path: "/tasks",
      method: "POST",
      body: { title: "New task" },
      fetcher,
      getSessionToken: () => undefined
    });

    await expect(response.json()).resolves.toEqual({ message: "Bearer session is required" });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("denies ticket support writes without a session before reaching the API", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/tickets"),
      path: "/tickets",
      method: "POST",
      body: {
        accountId: "acc-alpha",
        category: "bug_incident",
        priority: "high",
        source: "portal",
        title: "Support request",
        description: "Support request body",
        customerVisibleSummary: "We received the support request."
      },
      fetcher,
      getSessionToken: () => undefined
    });

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards authenticated writes with bearer auth and no-store cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "task-1" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/tasks?principal=founder"),
      apiBaseUrl: "http://api.local",
      path: "/tasks",
      method: "POST",
      body: { title: "New task" },
      fetcher,
      getSessionToken: () => "session-token"
    });

    expect(response.status).toBe(201);
    expect(fetcher).toHaveBeenCalledWith("http://api.local/api/tasks", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer session-token"
      },
      body: JSON.stringify({ title: "New task" })
    });
  });

  it("allows explicitly opted-in local dev writes to use principal fallback without a session", async () => {
    vi.stubEnv("CRM_ALLOW_PRINCIPAL_FALLBACK", "true");
    vi.stubEnv("CRM_PUBLIC_SESSION_REQUIRED", "0");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "comment-1" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/tasks/task-1/comments?principal=founder"),
      apiBaseUrl: "http://api.local",
      path: "/tasks/task-1/comments",
      method: "POST",
      body: { body: "Ready for review", visibility: "internal" },
      principalFallback: "founder",
      requireSessionForWrites: false,
      fetcher,
      getSessionToken: () => undefined
    });

    expect(response.status).toBe(201);
    expect(fetcher).toHaveBeenCalledWith("http://api.local/api/tasks/task-1/comments?principal=founder", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ body: "Ready for review", visibility: "internal" })
    });
  });

  it("denies production business reads without a session before reaching the API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetcher = vi.fn<typeof fetch>();

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/accounts?principal=founder"),
      apiBaseUrl: "http://api.local",
      path: "/accounts",
      fetcher,
      getSessionToken: () => undefined
    });

    await expect(response.json()).resolves.toEqual({ message: "Bearer session is required" });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps opted-in local write fallback fail-closed in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetcher = vi.fn<typeof fetch>();

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/tasks/task-1/comments?principal=founder"),
      apiBaseUrl: "http://api.local",
      path: "/tasks/task-1/comments",
      method: "POST",
      body: { body: "Ready for review", visibility: "internal" },
      principalFallback: "founder",
      requireSessionForWrites: false,
      fetcher,
      getSessionToken: () => undefined
    });

    await expect(response.json()).resolves.toEqual({ message: "Bearer session is required" });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("expires both host and shared-domain session cookies when an authenticated proxy call is rejected", async () => {
    vi.stubEnv("CRM_SESSION_COOKIE_DOMAIN", ".mindtheoperation.com");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Session is invalid or expired" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await proxyCrmBffJson({
      request: new Request("http://web.local/api/projects"),
      apiBaseUrl: "http://api.local",
      path: "/projects",
      fetcher,
      getSessionToken: () => "stale-session"
    });
    const setCookie = (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();

    expect(response.status).toBe(401);
    expect(response.headers.get("x-crm-session-status")).toBe("invalid");
    expect(setCookie).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp("^lcrm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT")),
        expect.stringContaining("Domain=.mindtheoperation.com")
      ])
    );
    vi.unstubAllEnvs();
  });

  it("keeps read-only demo principal fallback only when no bearer session exists", () => {
    vi.stubEnv("CRM_ALLOW_PRINCIPAL_FALLBACK", "true");
    vi.stubEnv("CRM_PUBLIC_SESSION_REQUIRED", "0");

    expect(
      buildCrmApiUrl({
        apiBaseUrl: "http://api.local",
        path: "/tasks",
        requestUrl: "http://web.local/api/tasks?status=open",
        principalFallback: "founder"
      })
    ).toBe("http://api.local/api/tasks?status=open&principal=founder");

    expect(
      buildCrmApiUrl({
        apiBaseUrl: "http://api.local",
        path: "/tasks",
        requestUrl: "http://web.local/api/tasks?principal=founder&status=open",
        sessionToken: "session-token",
        principalFallback: "founder"
      })
    ).toBe("http://api.local/api/tasks?status=open");
  });

  it("does not append demo principal fallback when protected reads are fail-closed", () => {
    vi.stubEnv("CRM_PUBLIC_SESSION_REQUIRED", "1");

    expect(
      buildCrmApiUrl({
        apiBaseUrl: "http://api.local",
        path: "/tasks",
        requestUrl: "http://web.local/api/tasks?status=open",
        principalFallback: "founder"
      })
    ).toBe("http://api.local/api/tasks?status=open");
  });

  it("normalizes API base URLs to the Nest global /api prefix once", () => {
    expect(normalizeCrmApiBaseUrl("http://api.local")).toBe("http://api.local/api");
    expect(normalizeCrmApiBaseUrl("http://api.local/api")).toBe("http://api.local/api");
    expect(buildCrmApiEndpoint("/auth/demo/session", "http://api.local")).toBe(
      "http://api.local/api/auth/demo/session"
    );
    expect(buildCrmApiEndpoint("/auth/demo/session", "http://api.local/api")).toBe(
      "http://api.local/api/auth/demo/session"
    );
  });

  it("exposes a reusable write session gate", async () => {
    const denied = await requireCrmSessionForBffWrite(() => undefined);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.response.status).toBe(401);
    }

    const allowed = await requireCrmSessionForBffWrite(() => "session-token");
    expect(allowed).toEqual({ ok: true, sessionToken: "session-token" });
  });

  it("exposes a reusable protected read session gate", async () => {
    vi.stubEnv("CRM_PUBLIC_SESSION_REQUIRED", "1");

    const denied = await resolveProtectedCrmBffSession(() => undefined);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.response.status).toBe(401);
    }

    const allowed = await resolveProtectedCrmBffSession(() => "session-token");
    expect(allowed).toEqual({ ok: true, sessionToken: "session-token" });
  });
});

it("preserves project creation receipts through the BFF", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  await proxyCrmBffJson({ request: new Request("http://web.local/api/projects", { headers: { "Idempotency-Key": "same-retry-key" } }), path: "/projects", method: "POST", body: { name: "Project" }, fetcher, getSessionToken: () => "session" });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe("same-retry-key");
});
