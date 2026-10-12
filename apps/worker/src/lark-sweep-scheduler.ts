/**
 * Keeps the clock for the API's Lark sweep (POST /api/internal/lark-sweep): bot messages that follow an event,
 * the reminders of V-14 / V-15 / V-20 and the personal-leave sync from Lark Approval (D-09). The work itself lives
 * in apps/api/src/modules/lark-integration; deployments without a worker call the same endpoint from a cron
 * (docs/lark-integration.md).
 */
export interface LarkSweepConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
  intervalMs: number;
  pollIntervalMs: number;
}

type RedisLike = { set(...args: any[]): Promise<unknown>; del(key: string): Promise<unknown> };

export function larkSweepConfigFromEnv(env: NodeJS.ProcessEnv): LarkSweepConfig {
  const off: LarkSweepConfig = { enabled: false, apiUrl: "", token: "", intervalMs: 0, pollIntervalMs: 60_000 };
  if (env.LARK_SWEEP_ENABLED !== "true") return off;
  const apiUrl = (env.LARK_SWEEP_API_URL ?? env.CRM_API_INTERNAL_URL)?.trim().replace(/\/$/, "");
  const token = (env.LARK_SWEEP_TOKEN ?? env.ALERT_SCAN_TOKEN)?.trim();
  if (!apiUrl) throw new Error("LARK_SWEEP_API_URL or CRM_API_INTERNAL_URL is required when the Lark sweep is enabled.");
  if (!token) throw new Error("LARK_SWEEP_TOKEN (or ALERT_SCAN_TOKEN) is required when the Lark sweep is enabled.");
  const minutes = Number(env.LARK_SWEEP_INTERVAL_MINUTES?.trim() || 60);
  if (!Number.isInteger(minutes) || minutes < 5) throw new Error("LARK_SWEEP_INTERVAL_MINUTES must be an integer of at least 5.");
  return { enabled: true, apiUrl, token, intervalMs: minutes * 60_000, pollIntervalMs: 60_000 };
}

/** Once per interval slot across restarts and replicas (Redis NX); a failed call releases the slot so the next poll retries. */
export async function runLarkSweepIfDue(options: { config: LarkSweepConfig; redis: RedisLike; now?: Date; fetchImpl?: typeof fetch }): Promise<"already_ran" | "ran"> {
  const key = `lark-sweep:${Math.floor((options.now ?? new Date()).getTime() / options.config.intervalMs)}`;
  if ((await options.redis.set(key, "1", "PX", options.config.intervalMs * 2, "NX")) !== "OK") return "already_ran";
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.config.apiUrl}/api/internal/lark-sweep`, { method: "POST", headers: { "x-lark-sweep-token": options.config.token } });
    if (!response.ok) throw new Error(`Lark sweep returned HTTP ${response.status}`);
    return "ran";
  } catch (error) {
    await options.redis.del(key);
    throw error;
  }
}

export function createLarkSweepScheduler(options: { config: LarkSweepConfig; redis: RedisLike }) {
  if (!options.config.enabled) return { enabled: false, stop: async () => undefined };
  const timer = setInterval(() => {
    void runLarkSweepIfDue(options).catch((error) => console.error("Lark sweep failed", error));
  }, options.config.pollIntervalMs);
  return { enabled: true, stop: async () => clearInterval(timer) };
}
