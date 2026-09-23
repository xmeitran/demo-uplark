import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";

describe("platform dependency readiness", () => {
  it("can query PostgreSQL through Prisma", async () => {
    const prisma = new PrismaClient();

    try {
      const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("can ping Redis", async () => {
    const redisUrl = process.env.REDIS_URL;
    expect(redisUrl).toBeTruthy();

    const redis = new Redis(redisUrl!, {
      connectTimeout: 3000,
      maxRetriesPerRequest: 1
    });

    try {
      await expect(redis.ping()).resolves.toBe("PONG");
    } finally {
      redis.disconnect();
    }
  });
});
