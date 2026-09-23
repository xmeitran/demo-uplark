import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformHealthController } from "./platform-health.controller";

describe("PlatformHealthController", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns static service health without touching dependencies", () => {
    const controller = new PlatformHealthController({ ping: async () => true } as any, { ping: async () => ({ ok: true }) } as any);

    expect(controller.health()).toMatchObject({
      ok: true,
      service: "b2b-crm-saas-api",
      product: "b2b-crm-saas"
    });
  });

  it("returns redacted readiness when PostgreSQL and Redis checks pass", async () => {
    const controller = new PlatformHealthController(
      { ping: async () => true } as any,
      { ping: async () => ({ ok: true, response: "PONG" }) } as any
    );

    await expect(controller.ready()).resolves.toMatchObject({
      ok: true,
      service: "b2b-crm-saas-api"
    });
    await expect(controller.ready()).resolves.not.toHaveProperty("checks");
  });

  it("can expose dependency details for internal diagnostics when explicitly enabled", async () => {
    vi.stubEnv("CRM_READY_DETAIL_ENABLED", "true");
    const controller = new PlatformHealthController(
      { ping: async () => true } as any,
      { ping: async () => ({ ok: true, response: "PONG" }) } as any
    );

    await expect(controller.ready()).resolves.toMatchObject({
      checks: {
        postgres: { ok: true },
        redis: { ok: true, response: "PONG" }
      }
    });
  });

  it("fails readiness without exposing dependency details by default", async () => {
    const controller = new PlatformHealthController(
      { ping: async () => true } as any,
      { ping: async () => ({ ok: false, reason: "REDIS_URL is not set" }) } as any
    );

    try {
      await controller.ready();
      throw new Error("Expected ready to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        ok: false,
        service: "b2b-crm-saas-api"
      });
      expect((error as ServiceUnavailableException).getResponse()).not.toHaveProperty("checks");
    }
  });
});
