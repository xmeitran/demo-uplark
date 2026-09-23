import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccountsWithAuth, getAuthMeWithAuth, getTasksWithAuth } from "./api";

describe("crm api static fallback", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not return demo account rows when the API is unavailable", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));

    const response = await getAccountsWithAuth({
      baseUrl: "http://api.local",
      principal: "founder"
    });

    expect(response.data).toEqual([]);
    expect(response.meta).toMatchObject({
      principal: "API unavailable",
      rowScope: "static_fallback"
    });
  });

  it("does not return demo task rows when the task API fails", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));

    const response = await getTasksWithAuth({
      baseUrl: "http://api.local",
      principal: "founder"
    });

    expect(response.data).toEqual([]);
    expect(response.meta).toMatchObject({
      principal: "API unavailable",
      rowScope: "static_fallback"
    });
  });

  it("returns the direct PrincipalContext shape from auth/me", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        subjectType: "internal_user",
        subjectId: "usr-lark-ou_123",
        displayName: "Nguyễn Hùng Việt Kha",
        email: "khanhv@upbase.asia",
        avatarUrl: "https://example.com/avatar.png",
        tenantKey: "prod",
        workspaceId: "twk-foundation",
        workspaceKey: "default",
        roleCodes: ["FOUNDER_GM"],
        accountIds: [],
        projectIds: [],
        customerAccountIds: [],
        customerProjectIds: [],
        roleVersion: "roles:test",
        grantVersion: "grants:test"
      })
    );

    await expect(getAuthMeWithAuth({ baseUrl: "http://api.local", sessionToken: "session-token" })).resolves.toMatchObject({
      displayName: "Nguyễn Hùng Việt Kha",
      email: "khanhv@upbase.asia",
      avatarUrl: "https://example.com/avatar.png"
    });
  });
});
