import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import {
  createDirectorySyncScheduler,
  directorySyncConfigFromEnv
} from "./directory-sync-scheduler.js";
import {
  createTaskReminderScheduler,
  taskReminderConfigFromEnv
} from "./lark-task-reminders.js";

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for @b2b-crm/worker");
  }

  const redis = new Redis(redisUrl, {
    connectTimeout: 3000,
    maxRetriesPerRequest: 1
  });
  const directorySyncConfig = directorySyncConfigFromEnv(process.env);
  const scheduler = createDirectorySyncScheduler({
    ...directorySyncConfig,
    redis
  });
  const taskReminderConfig = taskReminderConfigFromEnv(process.env);
  const taskReminderScheduler = createTaskReminderScheduler({
    config: taskReminderConfig,
    prisma: taskReminderConfig.enabled ? new PrismaClient() : undefined,
    redis
  });

  const shutdown = async () => {
    await Promise.all([scheduler.stop(), taskReminderScheduler.stop()]);
    redis.disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  const ping = await redis.ping();
  console.log(`b2b-crm-saas worker ready: redis=${ping} larkDirectorySync=${scheduler.enabled ? "enabled" : "disabled"} larkTaskReminders=${taskReminderScheduler.enabled ? "enabled" : "disabled"}`);

  setInterval(async () => {
    try {
      await redis.ping();
    } catch (error) {
      console.error("b2b-crm-saas worker redis ping failed", error);
    }
  }, 60_000);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
