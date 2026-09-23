import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { RedisHealthModule } from "../../shared/redis/redis-health.module";
import { PlatformHealthController } from "./platform-health.controller";

@Module({
  imports: [PrismaModule, RedisHealthModule],
  controllers: [PlatformHealthController]
})
export class PlatformHealthModule {}
