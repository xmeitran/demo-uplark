import { afterEach, describe, expect, it, vi } from "vitest";
import { installPublicAuthSessionFixture } from "../../e2e/fixtures/public-auth-session";

const context = () => ({
  request: { post: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200, json: async () => ({}) }) },
  cookies: vi.fn().mockResolvedValue([{ name: "lcrm_session", value: "local-test-cookie", httpOnly: true }]),
  addCookies: vi.fn()
});
afterEach(() => vi.unstubAllEnvs());

describe("public auth smoke fixture", () => {
  it("uses same-origin JSON and the browser context cookie jar for local bootstrap", async () => {
    vi.stubEnv("CRM_E2E_SESSION_TOKEN", "");
    vi.stubEnv("CRM_E2E_USE_DEMO_SESSION", "1");
    const browser = context();
    await expect(installPublicAuthSessionFixture(browser as any, "http://127.0.0.1:3903")).resolves.toEqual({ available: true });
    expect(browser.request.post).toHaveBeenCalledWith("http://127.0.0.1:3903/api/auth/demo/session", {
      headers: { Origin: "http://127.0.0.1:3903" }, data: {}, maxRedirects: 0
    });
    expect(browser.addCookies).not.toHaveBeenCalled();
  });

  it("never requests demo authentication from a remote host even when enabled", async () => {
    vi.stubEnv("CRM_E2E_SESSION_TOKEN", "");
    vi.stubEnv("CRM_E2E_USE_DEMO_SESSION", "1");
    const browser = context();
    expect((await installPublicAuthSessionFixture(browser as any, "https://crm.example.test")).available).toBe(false);
    expect(browser.request.post).not.toHaveBeenCalled();
  });

  it("preserves explicit external session-token installation", async () => {
    vi.stubEnv("CRM_E2E_SESSION_TOKEN", "explicit-test-token");
    const browser = context();
    expect((await installPublicAuthSessionFixture(browser as any, "https://crm.example.test")).available).toBe(true);
    expect(browser.request.post).not.toHaveBeenCalled();
    expect(browser.addCookies).toHaveBeenCalledWith([expect.objectContaining({ value: "explicit-test-token", httpOnly: true, secure: true })]);
  });

  it("reports an HTTP failure without exposing a response body", async () => {
    vi.stubEnv("CRM_E2E_SESSION_TOKEN", "");
    vi.stubEnv("CRM_E2E_USE_DEMO_SESSION", "1");
    const browser = context();
    browser.request.post.mockResolvedValue({ ok: () => false, status: () => 403, json: async () => ({ message: "sensitive unexpected detail" }) });
    expect(await installPublicAuthSessionFixture(browser as any, "http://localhost:3903")).toMatchObject({ available: false, reason: expect.stringContaining("HTTP 403") });
  });

  it("rejects successful responses without the expected HttpOnly cookie", async () => {
    vi.stubEnv("CRM_E2E_SESSION_TOKEN", "");
    vi.stubEnv("CRM_E2E_USE_DEMO_SESSION", "1");
    const browser = context();
    browser.cookies.mockResolvedValue([]);
    expect((await installPublicAuthSessionFixture(browser as any, "http://localhost:3903")).available).toBe(false);
  });
  it("classifies known bootstrap errors without echoing unrecognized response fields", async () => {
    vi.stubEnv("CRM_E2E_SESSION_TOKEN", "");
    vi.stubEnv("CRM_E2E_USE_DEMO_SESSION", "1");
    const browser = context();
    browser.request.post.mockResolvedValue({ ok: () => false, status: () => 403, json: async () => ({ message: "Same-origin request required", token: "private" }) });
    const result = await installPublicAuthSessionFixture(browser as any, "http://localhost:3903");
    expect(result.reason).toContain("Same-origin request required");
    expect(result.reason).not.toContain("private");
  });

});
