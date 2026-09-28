import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunitiesService } from "./opportunities.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [AccountsController, OpportunitiesController],
  providers: [AccountsService, OpportunitiesService],
  exports: [AccountsService, OpportunitiesService],
})
export class SalesCrmModule {}
