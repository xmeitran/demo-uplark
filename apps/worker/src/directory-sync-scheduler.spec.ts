import { describe, expect, it, vi } from "vitest";
import {
  createDirectorySyncScheduler,
  directorySyncCommand,
  directorySyncConfigFromEnv
} from "./directory-sync-scheduler.js";

function noSchedule() {
  return 1;
}

function schedulerOptions(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    redis: {
      set: vi.fn(async () => "OK"),
      eval: vi.fn(async () => 1)
    },
    intervalMs: 900_000,
    startupDelayMs: 60_000,
    leaseTtlMs: 1_200_000,
    heartbeatMs: 30_000,
    setTimer: noSchedule,
    clearTimer: vi.fn(),
    setRepeatingTimer: noSchedule,
    clearRepeatingTimer: vi.fn(),
    runSync: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("Lark directory sync scheduler", () => {
  it("does nothing when the feature flag is disabled", async () => {
    const redis = { set: vi.fn(), eval: vi.fn() };
    const scheduler = createDirectorySyncScheduler({
      ...schedulerOptions(),
      enabled: false,
      redis
    });

    expect(scheduler.enabled).toBe(false);
    expect(await scheduler.runNow()).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("skips the run when another worker owns the Redis lease", async () => {
    const runSync = vi.fn(async () => undefined);
    const redis = {
      set: vi.fn(async () => null),
      eval: vi.fn(async () => 0)
    };
    const scheduler = createDirectorySyncScheduler(schedulerOptions({ redis, runSync }));

    expect(await scheduler.runNow()).toBe(false);
    expect(runSync).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("prevents local overlap and releases only through the owner-safe script", async () => {
    let finish!: () => void;
    const runSync = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const redis = {
      set: vi.fn(async () => "OK"),
      eval: vi.fn(async () => 1)
    };
    const scheduler = createDirectorySyncScheduler(schedulerOptions({ redis, runSync }));

    const first = scheduler.runNow();
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));
    expect(await scheduler.runNow()).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      "b2b-crm:lark-directory-sync:lease",
      expect.any(String),
      "PX",
      1_200_000,
      "NX"
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
      1,
      "b2b-crm:lark-directory-sync:lease",
      expect.any(String)
    );
  });

  it("spawns the shared one-shot script in additive apply mode", () => {
    const command = directorySyncCommand();

    expect(command.command).toBe(process.execPath);
    expect(command.args.at(-2)).toBe("--apply");
    expect(command.args.at(-1)).toBe("--trigger=scheduled");
    expect(command.args[0]).toMatch(/scripts\/operations\/sync-lark-cds-users\.mjs$/);
  });

  it("does not validate lease settings while the feature is disabled", () => {
    expect(directorySyncConfigFromEnv({
      LARK_DIRECTORY_SYNC_ENABLED: "false",
      LARK_DIRECTORY_SYNC_LEASE_TTL_MS: "invalid",
      LARK_DIRECTORY_SYNC_HEARTBEAT_MS: "invalid"
    }).enabled).toBe(false);

    expect(() => directorySyncConfigFromEnv({
      LARK_DIRECTORY_SYNC_ENABLED: "true",
      LARK_DIRECTORY_SYNC_LEASE_TTL_MS: "1000",
      LARK_DIRECTORY_SYNC_HEARTBEAT_MS: "1000"
    })).toThrow(/must be lower/);
  });

  it("stop waits for the active run and a stopped startup callback cannot rearm the interval", async () => {
    let startupCallback: (() => void) | undefined;
    let finish!: () => void;
    let stopped = false;
    const setRepeatingTimer = vi.fn(() => 2);
    const scheduler = createDirectorySyncScheduler(schedulerOptions({
      setTimer: (handler: () => void) => {
        startupCallback = handler;
        return 1;
      },
      setRepeatingTimer,
      runSync: () => new Promise<void>((resolve) => {
        finish = resolve;
      })
    }));

    const active = scheduler.runNow();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await active;
    await stopping;
    startupCallback?.();
    expect(setRepeatingTimer).toHaveBeenCalledTimes(1);
  });
});
