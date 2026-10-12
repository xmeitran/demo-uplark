import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { LarkTransport } from "./lark-client";
import { LarkIntegrationController } from "./lark-integration.controller";
import { LarkIntegrationService } from "./lark-integration.service";

/** Lark groups, bots and personal leave. Plugs into the other modules through lark-hooks.ts (registered at module init). */
@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [LarkIntegrationController],
  providers: [LarkTransport, LarkIntegrationService],
  exports: [LarkIntegrationService]
})
export class LarkIntegrationModule {}
