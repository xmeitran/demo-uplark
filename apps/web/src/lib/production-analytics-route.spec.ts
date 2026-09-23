import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "../../middleware";

describe("production Analytics route policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows an authenticated Analytics request once the GA flag is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKFORCE_ANALYTICS_GA_ENABLED", "true");
    const request = new NextRequest("https://crm.example.test/analytics?view=overview", {
      headers: { cookie: "lcrm_session=ga-route-proof" }
    });

    const response = middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("rewrites an authenticated Analytics request to unavailable while the GA flag is off", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://crm.example.test/analytics?view=overview", {
      headers: { cookie: "lcrm_session=ga-route-proof" }
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://crm.example.test/unavailable?route=%2Fanalytics"
    );
  });

  it("continues to rewrite an authenticated beta route to unavailable", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://crm.example.test/pipeline", {
      headers: { cookie: "lcrm_session=ga-route-proof" }
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://crm.example.test/unavailable?route=%2Fpipeline"
    );
  });
});
