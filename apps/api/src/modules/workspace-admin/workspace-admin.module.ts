import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { WorkspaceAdminController } from "./workspace-admin.controller";
import { WorkspaceAdminService } from "./workspace-admin.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [WorkspaceAdminController],
  providers: [WorkspaceAdminService]
})
export class WorkspaceAdminModule {}
