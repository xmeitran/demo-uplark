import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import { bearerToken } from "../../shared/http/request-context";
import { AuthService } from "./auth.service";
import { LarkAuthService } from "./lark-auth.service";
import { PrincipalService } from "./principal.service";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly auth: AuthService,
    @Inject(LarkAuthService)
    private readonly larkAuth: LarkAuthService,
    @Inject(PrincipalService)
    private readonly principals: PrincipalService
  ) {}

  @Post("demo/session")
  createDemoSession() {
    return this.auth.createDemoSession();
  }

  @Get("me")
  getMe(@Headers("authorization") authorization?: string, @Query("principal") principal?: string) {
    return this.principals.resolveFromAuthorization(authorization, principal);
  }

  @Post("session/revoke")
  async revokeSession(@Headers("authorization") authorization?: string) {
    const token = bearerToken(authorization);
    if (!token) {
      return { revoked: false };
    }

    return this.principals.revokeSessionToken(token);
  }

  @Get("lark/authorize-url")
  createLarkAuthorizeUrl(@Query("returnTo") returnTo?: string, @Query("redirectUri") redirectUri?: string, @Query("invitationTokenHash") invitationTokenHash?: string) {
    return this.larkAuth.createAuthorizeUrl({ returnTo, redirectUri, invitationTokenHash });
  }

  @Post("lark/callback")
  completeLarkCallback(@Body() body: any) {
    return this.larkAuth.completeCallback(body);
  }

  @Post("lark/session")
  createLinkedLarkSession(@Body() body: any) {
    return this.larkAuth.createLinkedSession(body);
  }
}

@Controller("auth/admin/users")
export class AdminUsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  listUsers(@Headers("authorization") authorization?: string, @Query("includeSuspended") includeSuspended?: string, @Query("principal") principalFallback?: string) {
    return this.auth.listUsers(authorization, includeSuspended === "true", principalFallback);
  }

  @Get(":userId")
  getUser(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Query("includeSuspended") includeSuspended?: string
  ) {
    return this.auth.getUser(authorization, userId, includeSuspended === "true");
  }

  @Post()
  createInternalUser(@Headers("authorization") authorization: string | undefined, @Body() body: any) {
    return this.auth.createInternalUser(authorization, body);
  }

  @Post(":userId/deactivate")
  deactivateUser(@Headers("authorization") authorization: string | undefined, @Param("userId") userId: string) {
    return this.auth.deactivateUser(authorization, userId);
  }

  @Post(":userId/revoke-sessions")
  revokeUserSessions(@Headers("authorization") authorization: string | undefined, @Param("userId") userId: string) {
    return this.auth.revokeUserSessions(authorization, userId);
  }
}
