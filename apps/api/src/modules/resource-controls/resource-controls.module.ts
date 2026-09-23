import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { ResourceControlsController } from "./resource-controls.controller";
import { ResourceControlsService } from "./resource-controls.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [ResourceControlsController],
  providers: [ResourceControlsService],
  exports: [ResourceControlsService]
})
export class ResourceControlsModule {}
