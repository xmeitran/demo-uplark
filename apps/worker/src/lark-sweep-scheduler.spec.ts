import { describe, expect, it, vi } from "vitest";
import { larkSweepConfigFromEnv, runLarkSweepIfDue } from "./lark-sweep-scheduler.js";

describe("Lark sweep scheduler", () => {
  it("is off by default and needs an API url and a token when on", () => {
    expect(larkSweepConfigFromEnv({}).enabled).toBe(false);
    expect(() => larkSweepConfigFromEnv({ LARK_SWEEP_ENABLED: "true" })).toThrow("LARK_SWEEP_API_URL");
    expect(() => larkSweepConfigFromEnv({ LARK_SWEEP_ENABLED: "true", CRM_API_INTERNAL_URL: "http://api:4000" })).toThrow("LARK_SWEEP_TOKEN");
    expect(larkSweepConfigFromEnv({ LARK_SWEEP_ENABLED: "true", CRM_API_INTERNAL_URL: "http://api:4000/", ALERT_SCAN_TOKEN: "t" })).toMatchObject({ enabled: true, apiUrl: "http://api:4000", token: "t", intervalMs: 3_600_000 });
  });

  it("calls the API once per interval slot and releases the slot when the call fails", async () => {
    const config = larkSweepConfigFromEnv({ LARK_SWEEP_ENABLED: "true", CRM_API_INTERNAL_URL: "http://api:4000", LARK_SWEEP_TOKEN: "secret" });
    const keys = new Set<string>();
    const redis = { set: vi.fn(async (key: string) => (keys.has(key) ? null : (keys.add(key), "OK"))), del: vi.fn(async (key: string) => keys.delete(key)) };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const now = new Date("2026-10-12T02:10:00.000Z");
    expect(await runLarkSweepIfDue({ config, redis, now, fetchImpl })).toBe("ran");
    expect(fetchImpl).toHaveBeenCalledWith("http://api:4000/api/internal/lark-sweep", { method: "POST", headers: { "x-lark-sweep-token": "secret" } });
    expect(await runLarkSweepIfDue({ config, redis, now: new Date("2026-10-12T02:50:00.000Z"), fetchImpl })).toBe("already_ran");

    const failing = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const later = new Date("2026-10-12T03:10:00.000Z");
    await expect(runLarkSweepIfDue({ config, redis, now: later, fetchImpl: failing })).rejects.toThrow("HTTP 500");
    expect(await runLarkSweepIfDue({ config, redis, now: later, fetchImpl })).toBe("ran");
  });
});
