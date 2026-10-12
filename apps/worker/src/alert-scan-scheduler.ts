/**
 * 7.5 "Quét đầu ngày": once a day the worker asks the API to run the alert scan (POST /api/internal/alert-scan).
 * The scan itself lives in the API (apps/api/src/modules/alerts) because it reuses the P&L gate and the issue-log
 * rules; the worker only keeps the clock. Deployments without a worker call the same endpoint from a cron
 * (scripts/operations/run-alert-scan.mjs, docs/alert-scan.md).
 */
export interface AlertScanConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
  /** Minute of the day in Vietnam time from which the scan is due. */
  minute: number;
  pollIntervalMs: number;
}

type RedisLike = { set(...args: any[]): Promise<unknown>; del(key: string): Promise<unknown> };

export function alertScanConfigFromEnv(env: NodeJS.ProcessEnv): AlertScanConfig {
  const off: AlertScanConfig = { enabled: false, apiUrl: "", token: "", minute: 0, pollIntervalMs: 60_000 };
  if (env.ALERT_SCAN_ENABLED !== "true") return off;
  const apiUrl = (env.ALERT_SCAN_API_URL ?? env.CRM_API_INTERNAL_URL)?.trim().replace(/\/$/, "");
  const token = env.ALERT_SCAN_TOKEN?.trim();
  if (!apiUrl) throw new Error("ALERT_SCAN_API_URL or CRM_API_INTERNAL_URL is required when the alert scan is enabled.");
  if (!token) throw new Error("ALERT_SCAN_TOKEN is required when the alert scan is enabled.");
  const time = env.ALERT_SCAN_TIME?.trim() || "07:30";
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error("ALERT_SCAN_TIME must use HH:MM (Vietnam time).");
  return { enabled: true, apiUrl, token, minute: Number(match[1]) * 60 + Number(match[2]), pollIntervalMs: 60_000 };
}

/** Local date and minute of the day in Vietnam (UTC+7, no daylight saving). */
export function vietnamClock(at: Date) {
  const local = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  return { localDate: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * Runs the scan at most once per Vietnam calendar day, from the configured time on. The Redis key makes that hold
 * across restarts and replicas; a failed call releases it so the next poll retries. Weekends and workspace days off
 * are skipped by the API, which owns the calendar.
 */
export async function runAlertScanIfDue(options: { config: AlertScanConfig; redis: RedisLike; now?: Date; fetchImpl?: typeof fetch }): Promise<"not_due" | "already_ran" | "ran"> {
  const { localDate, minute } = vietnamClock(options.now ?? new Date());
  if (minute < options.config.minute) return "not_due";
  const key = `alert-scan:${localDate}`;
  if ((await options.redis.set(key, "1", "EX", 36 * 60 * 60, "NX")) !== "OK") return "already_ran";
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.config.apiUrl}/api/internal/alert-scan`, { method: "POST", headers: { "x-alert-scan-token": options.config.token } });
    if (!response.ok) throw new Error(`Alert scan returned HTTP ${response.status}`);
    return "ran";
  } catch (error) {
    await options.redis.del(key);
    throw error;
  }
}

export function createAlertScanScheduler(options: { config: AlertScanConfig; redis: RedisLike }) {
  if (!options.config.enabled) return { enabled: false, stop: async () => undefined };
  const timer = setInterval(() => {
    void runAlertScanIfDue(options).then((outcome) => { if (outcome === "ran") console.log("Daily alert scan finished"); }).catch((error) => console.error("Daily alert scan failed", error));
  }, options.config.pollIntervalMs);
  return { enabled: true, stop: async () => clearInterval(timer) };
}
