import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { WorkforceAnalyticsController } from "./workforce-analytics.controller";
import { WorkforceAnalyticsService } from "./workforce-analytics.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [WorkforceAnalyticsController],
  providers: [WorkforceAnalyticsService],
  exports: [WorkforceAnalyticsService]
})
export class WorkforceAnalyticsModule {}
