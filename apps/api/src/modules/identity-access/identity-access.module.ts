import { SessionController } from "./session.controller";
import { NativeAuthService } from "./native-auth.service";
import { NativeAuthController } from "./native-auth.controller";
import { AuthSecurityService } from "./auth-security.service";
import { AuthMailService } from "./auth-mail.service";
import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { TenantWorkspaceModule } from "../tenant-workspace/tenant-workspace.module";
import { AdminUsersController, AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LarkAuthService } from "./lark-auth.service";
import { PrincipalService } from "./principal.service";

@Module({
  imports: [PrismaModule, forwardRef(() => TenantWorkspaceModule)],
  controllers: [AuthController, AdminUsersController, NativeAuthController, SessionController],
  providers: [AuthService, LarkAuthService, PrincipalService, NativeAuthService, AuthSecurityService, AuthMailService],
  exports: [PrincipalService]
})
export class IdentityAccessModule {}
