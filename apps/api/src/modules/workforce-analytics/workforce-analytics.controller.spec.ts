import { NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkforceAnalyticsController, isWorkforceAnalyticsApiEnabled } from "./workforce-analytics.controller";

describe("workforce analytics API gate", () => {
  beforeEach(() => {
    // These cases exercise an absent flag, independent of the runtime launching Vitest.
    vi.stubEnv("WORKFORCE_ANALYTICS_GA_ENABLED", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when the GA flag is missing", () => {
    expect(isWorkforceAnalyticsApiEnabled({ nodeEnv: "production" })).toBe(false);
  });

  it("allows explicit local and test compatibility but honors an explicit off switch", () => {
    expect(isWorkforceAnalyticsApiEnabled({ nodeEnv: "development" })).toBe(true);
    expect(isWorkforceAnalyticsApiEnabled({ nodeEnv: "test" })).toBe(true);
    expect(isWorkforceAnalyticsApiEnabled({ nodeEnv: "development", enabled: "false" })).toBe(false);
    expect(isWorkforceAnalyticsApiEnabled({ nodeEnv: "production", enabled: "true" })).toBe(true);
  });

  it("blocks every endpoint before resolving a principal when disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKFORCE_ANALYTICS_GA_ENABLED", "false");
    const principals = { resolveFromAuthorization: vi.fn() };
    const analytics = { summary: vi.fn(), breakdown: vi.fn(), export: vi.fn() };
    const controller = new WorkforceAnalyticsController(principals as never, analytics as never);

    await expect(controller.summary("Bearer token", {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.breakdown("Bearer token", {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.export("Bearer token", {})).rejects.toBeInstanceOf(NotFoundException);
    expect(principals.resolveFromAuthorization).not.toHaveBeenCalled();
  });

  it("delegates the full export only after the explicit production flag is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKFORCE_ANALYTICS_GA_ENABLED", "true");
    const viewer = { subjectId: "viewer-1" };
    const payload = { meta: { policy: "test" }, breakdowns: { projects: [] } };
    const principals = { resolveFromAuthorization: vi.fn().mockResolvedValue(viewer) };
    const analytics = { summary: vi.fn(), breakdown: vi.fn(), export: vi.fn().mockResolvedValue(payload) };
    const controller = new WorkforceAnalyticsController(principals as never, analytics as never);

    await expect(controller.export("Bearer token", { projectId: "project-1" })).resolves.toBe(payload);
    expect(principals.resolveFromAuthorization).toHaveBeenCalledWith("Bearer token", undefined);
    expect(analytics.export).toHaveBeenCalledWith({ projectId: "project-1" }, viewer);
  });
});
