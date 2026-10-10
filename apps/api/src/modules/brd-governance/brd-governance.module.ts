import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { ResourceControlsModule } from "../resource-controls/resource-controls.module";
import { BrdGovernanceController } from "./brd-governance.controller";
import { BrdGovernanceService } from "./brd-governance.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule, ResourceControlsModule],
  controllers: [BrdGovernanceController],
  providers: [BrdGovernanceService],
  exports: [BrdGovernanceService]
})
export class BrdGovernanceModule {}
