import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { ProposalPackagesController } from "./proposal-packages.controller";
import { ProposalPackagesService } from "./proposal-packages.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [ProposalPackagesController],
  providers: [ProposalPackagesService],
  exports: [ProposalPackagesService]
})
export class ProposalGovernanceModule {}
