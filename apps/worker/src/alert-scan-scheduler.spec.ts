import { describe, expect, it, vi } from "vitest";
import { alertScanConfigFromEnv, runAlertScanIfDue, vietnamClock } from "./alert-scan-scheduler";

const config = { enabled: true, apiUrl: "http://api:4000", token: "secret", minute: 7 * 60 + 30, pollIntervalMs: 60_000 };
function redis() {
  const keys = new Set<string>();
  return { keys, set: vi.fn(async (key: string) => (keys.has(key) ? null : (keys.add(key), "OK"))), del: vi.fn(async (key: string) => keys.delete(key)) };
}

describe("alert scan schedule", () => {
  it("is off unless enabled, and needs the API address and the token", () => {
    expect(alertScanConfigFromEnv({}).enabled).toBe(false);
    expect(() => alertScanConfigFromEnv({ ALERT_SCAN_ENABLED: "true", CRM_API_INTERNAL_URL: "http://api:4000" })).toThrow("ALERT_SCAN_TOKEN");
    expect(() => alertScanConfigFromEnv({ ALERT_SCAN_ENABLED: "true", ALERT_SCAN_TOKEN: "x" })).toThrow("ALERT_SCAN_API_URL");
    expect(() => alertScanConfigFromEnv({ ALERT_SCAN_ENABLED: "true", ALERT_SCAN_TOKEN: "x", ALERT_SCAN_API_URL: "http://a", ALERT_SCAN_TIME: "7h" })).toThrow("HH:MM");
    expect(alertScanConfigFromEnv({ ALERT_SCAN_ENABLED: "true", ALERT_SCAN_TOKEN: "x", CRM_API_INTERNAL_URL: "http://api:4000/" })).toMatchObject({ apiUrl: "http://api:4000", minute: 450 });
  });

  it("reads the clock in Vietnam time", () => {
    expect(vietnamClock(new Date("2026-10-13T23:45:00.000Z"))).toEqual({ localDate: "2026-10-14", minute: 6 * 60 + 45 });
  });

  it("runs once per day from the configured time on", async () => {
    const store = redis();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 })) as unknown as typeof fetch;
    const at = (iso: string) => runAlertScanIfDue({ config, redis: store, now: new Date(iso), fetchImpl });
    await expect(at("2026-10-14T00:00:00.000Z")).resolves.toBe("not_due"); // 07:00
    await expect(at("2026-10-14T00:30:00.000Z")).resolves.toBe("ran"); // 07:30
    await expect(at("2026-10-14T05:00:00.000Z")).resolves.toBe("already_ran");
    await expect(at("2026-10-15T01:00:00.000Z")).resolves.toBe("ran");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith("http://api:4000/api/internal/alert-scan", { method: "POST", headers: { "x-alert-scan-token": "secret" } });
  });

  it("retries on the next poll after a failed call", async () => {
    const store = redis();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const now = new Date("2026-10-14T01:00:00.000Z");
    await expect(runAlertScanIfDue({ config, redis: store, now, fetchImpl })).rejects.toThrow("503");
    expect(store.keys.size).toBe(0);
    await expect(runAlertScanIfDue({ config, redis: store, now, fetchImpl: vi.fn(async () => ({ ok: true, status: 201 })) as unknown as typeof fetch })).resolves.toBe("ran");
  });
});
