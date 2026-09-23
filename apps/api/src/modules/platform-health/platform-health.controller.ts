import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { RedisHealthService } from "../../shared/redis/redis-health.service";

function shouldExposeReadinessDetails() {
  return process.env.CRM_READY_DETAIL_ENABLED === "true";
}

@Controller()
export class PlatformHealthController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(RedisHealthService)
    private readonly redis: RedisHealthService
  ) {}

  @Get("health")
  health() {
    return {
      ok: true,
      service: "b2b-crm-saas-api",
      product: "b2b-crm-saas",
      checkedAt: new Date().toISOString()
    };
  }

  @Get("ready")
  async ready() {
    const db = await this.checkPostgres();
    const redis = await this.redis.ping();
    const checks = { postgres: db, redis };

    if (!db.ok || !redis.ok) {
      throw new ServiceUnavailableException({
        ok: false,
        service: "b2b-crm-saas-api",
        ...(shouldExposeReadinessDetails() ? { checks } : {})
      });
    }

    return {
      ok: true,
      service: "b2b-crm-saas-api",
      checkedAt: new Date().toISOString(),
      ...(shouldExposeReadinessDetails() ? { checks } : {})
    };
  }

  private async checkPostgres() {
    try {
      await this.prisma.ping();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Postgres ping failed"
      };
    }
  }
}
