import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { clearCrmSessionCookies } from "./session-cookie";

describe("clearCrmSessionCookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("expires both host-only and configured shared-domain session cookies", () => {
    vi.stubEnv("CRM_SESSION_COOKIE_DOMAIN", ".mindtheoperation.com");
    vi.stubEnv("NODE_ENV", "production");
    const response = NextResponse.json({ ok: true });

    clearCrmSessionCookies(response);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.match(/lcrm_session=/g)).toHaveLength(2);
    expect(setCookie).toContain("Domain=.mindtheoperation.com");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Secure");
  });
});
