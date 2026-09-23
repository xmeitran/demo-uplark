import { Injectable } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisHealthService {
  async ping() {
    const url = process.env.REDIS_URL;
    if (!url) {
      return { ok: false, reason: "REDIS_URL is not set" };
    }

    const client = new Redis(url, {
      connectTimeout: 3000,
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });

    try {
      await client.connect();
      const response = await client.ping();
      return { ok: response === "PONG", response };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Redis ping failed"
      };
    } finally {
      client.disconnect();
    }
  }
}
