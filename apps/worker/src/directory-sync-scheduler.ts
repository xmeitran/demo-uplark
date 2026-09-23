import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const HEARTBEAT_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export type DirectorySyncSchedulerOptions = {
  enabled: boolean;
  redis: {
    set: (...args: any[]) => Promise<unknown>;
    eval: (...args: any[]) => Promise<unknown>;
  };
  intervalMs: number;
  startupDelayMs: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  lockKey?: string;
  ownerId?: string;
  runSync?: () => Promise<void>;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  setRepeatingTimer?: (handler: () => void, delayMs: number) => unknown;
  clearRepeatingTimer?: (timer: unknown) => void;
};

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function directorySyncConfigFromEnv(env: NodeJS.ProcessEnv) {
  const enabled = env.LARK_DIRECTORY_SYNC_ENABLED === "true";
  if (!enabled) {
    return {
      enabled,
      intervalMs: 900_000,
      startupDelayMs: 60_000,
      leaseTtlMs: 1_200_000,
      heartbeatMs: 30_000
    };
  }
  const leaseTtlMs = positiveInteger(
    env.LARK_DIRECTORY_SYNC_LEASE_TTL_MS,
    1_200_000,
    "LARK_DIRECTORY_SYNC_LEASE_TTL_MS"
  );
  const heartbeatMs = positiveInteger(
    env.LARK_DIRECTORY_SYNC_HEARTBEAT_MS,
    30_000,
    "LARK_DIRECTORY_SYNC_HEARTBEAT_MS"
  );
  if (heartbeatMs >= leaseTtlMs) {
    throw new Error("LARK_DIRECTORY_SYNC_HEARTBEAT_MS must be lower than LARK_DIRECTORY_SYNC_LEASE_TTL_MS.");
  }
  return {
    enabled,
    intervalMs: positiveInteger(
      env.LARK_DIRECTORY_SYNC_INTERVAL_MS,
      900_000,
      "LARK_DIRECTORY_SYNC_INTERVAL_MS"
    ),
    startupDelayMs: positiveInteger(
      env.LARK_DIRECTORY_SYNC_STARTUP_DELAY_MS,
      60_000,
      "LARK_DIRECTORY_SYNC_STARTUP_DELAY_MS"
    ),
    leaseTtlMs,
    heartbeatMs
  };
}

export function directorySyncCommand() {
  const candidates = [
    resolve(process.cwd(), "scripts/operations/sync-lark-cds-users.mjs"),
    resolve(process.cwd(), "../../scripts/operations/sync-lark-cds-users.mjs")
  ];
  const scriptPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  return {
    command: process.execPath,
    args: [
      scriptPath,
      "--apply",
      "--trigger=scheduled"
    ]
  };
}

export async function runSyncProcess(): Promise<void> {
  const { command, args } = directorySyncCommand();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Lark directory sync exited with code=${code ?? "null"} signal=${signal ?? "none"}.`));
    });
  });
}

export function createDirectorySyncScheduler(options: DirectorySyncSchedulerOptions) {
  if (!options.enabled) {
    return {
      enabled: false,
      stop: async () => undefined,
      runNow: async () => false
    };
  }

  const lockKey = options.lockKey ?? "b2b-crm:lark-directory-sync:lease";
  const ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`;
  const runSync = options.runSync ?? runSyncProcess;
  const setTimer = options.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const setRepeatingTimer = options.setRepeatingTimer ?? ((handler, delayMs) => setInterval(handler, delayMs));
  const clearRepeatingTimer = options.clearRepeatingTimer
    ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  let localRunActive = false;
  let stopped = false;
  let startupTimer: unknown;
  let intervalTimer: unknown;
  let activeRunPromise: Promise<boolean> | undefined;

  function runNow(): Promise<boolean> {
    if (stopped || localRunActive) return Promise.resolve(false);
    localRunActive = true;
    activeRunPromise = (async () => {
      let acquired = false;
      let heartbeatTimer: unknown;
      try {
        acquired = (await options.redis.set(lockKey, ownerId, "PX", options.leaseTtlMs, "NX")) === "OK";
        if (!acquired) return false;

        heartbeatTimer = setRepeatingTimer(async () => {
          try {
            const renewed = await options.redis.eval(
              HEARTBEAT_SCRIPT,
              1,
              lockKey,
              ownerId,
              String(options.leaseTtlMs)
            );
            if (renewed !== 1) {
              console.error("Lark directory sync lease heartbeat lost ownership");
            }
          } catch (error) {
            console.error("Lark directory sync lease heartbeat failed", error);
          }
        }, options.heartbeatMs);

        await runSync();
        return true;
      } finally {
        if (heartbeatTimer) clearRepeatingTimer(heartbeatTimer);
        if (acquired) {
          try {
            await options.redis.eval(RELEASE_SCRIPT, 1, lockKey, ownerId);
          } catch (error) {
            console.error("Lark directory sync lease release failed", error);
          }
        }
        localRunActive = false;
        activeRunPromise = undefined;
      }
    })();
    return activeRunPromise;
  }

  function schedule() {
    startupTimer = setTimer(() => {
      if (stopped) return;
      void runNow().catch((error) => console.error("Scheduled Lark directory sync failed", error));
      if (stopped) return;
      intervalTimer = setRepeatingTimer(() => {
        void runNow().catch((error) => console.error("Scheduled Lark directory sync failed", error));
      }, options.intervalMs);
    }, options.startupDelayMs);
  }

  async function stop() {
    stopped = true;
    if (startupTimer) clearTimer(startupTimer);
    if (intervalTimer) clearRepeatingTimer(intervalTimer);
    if (activeRunPromise) {
      await activeRunPromise.catch(() => false);
    }
  }

  schedule();
  return { enabled: true, stop, runNow };
}
