import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { ArtifactsController } from "./artifacts.controller";
import { ArtifactsService } from "./artifacts.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [ArtifactsController],
  providers: [ArtifactsService],
  exports: [ArtifactsService]
})
export class ArtifactMgmtModule {}
