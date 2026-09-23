import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { TenantWorkspaceController } from "./tenant-workspace.controller";
import { TenantWorkspaceService } from "./tenant-workspace.service";

@Module({
  imports: [PrismaModule, forwardRef(() => IdentityAccessModule)],
  controllers: [TenantWorkspaceController],
  providers: [TenantWorkspaceService],
  exports: [TenantWorkspaceService]
})
export class TenantWorkspaceModule {}
