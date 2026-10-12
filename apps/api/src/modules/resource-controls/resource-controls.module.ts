import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { PnlConfigService } from "./pnl-config.service";
import { PnlController } from "./pnl.controller";
import { PnlService } from "./pnl.service";
import { ResourceControlsController } from "./resource-controls.controller";
import { ResourceControlsService } from "./resource-controls.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [ResourceControlsController, PnlController],
  providers: [ResourceControlsService, PnlService, PnlConfigService],
  // PnlService.pendingHoursBlockingG7(workspaceId, projectId) is what the G7 approval asks before it lets a project through.
  exports: [ResourceControlsService, PnlService, PnlConfigService]
})
export class ResourceControlsModule {}
