import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { NativeAuthService } from "./native-auth.service";
function metadata(request: any) { return { ipAddress: request.socket?.remoteAddress ?? "unknown", userAgent: typeof request.headers?.["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 300) : "" }; }
@Controller("auth")
export class NativeAuthController {
  constructor(@Inject(NativeAuthService) private readonly auth: NativeAuthService) {}
  @Get("capabilities") capabilities() { return this.auth.capabilities(); }
  @Post("password/login") login(@Body() body: any, @Req() req: any) { return this.auth.login(body, metadata(req)); }
  @Post("password/forgot") forgot(@Body() body: any, @Req() req: any) { return this.auth.forgot(body, metadata(req).ipAddress); }
  @Post("password/reset") reset(@Body() body: any, @Req() req: any) { return this.auth.reset(body, metadata(req).ipAddress); }
  @Post("password/change") change(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.changePassword(auth, body); }
  @Get("account") account(@Headers("authorization") auth?: string, @Query("principal") principalFallback?: string) { return this.auth.account(auth, principalFallback); }
  @Patch("account") update(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.updateAccount(auth, body); }
  @Post("email/verification-request") verification(@Headers("authorization") auth?: string) { return this.auth.requestVerification(auth); }
  @Post("email/change-request") emailChange(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.requestEmailChange(auth, body); }
  @Post("email/verify") verify(@Body() body: any, @Req() req: any) { return this.auth.verifyEmail(body, metadata(req).ipAddress); }
  @Post("mfa/challenge") challenge(@Body() body: any, @Req() req: any) { return this.auth.challenge(body, metadata(req)); }
  @Post("mfa/enroll") enroll(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.enrollMfa(auth, body); }
  @Post("mfa/confirm") confirm(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.confirmMfa(auth, body); }
  @Post("mfa/disable") disable(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.disableMfa(auth, body); }
  @Get("admin/invitations") invitations(@Headers("authorization") auth?: string) { return this.auth.listInvitations(auth); }
  @Post("admin/invitations") invite(@Headers("authorization") auth: string | undefined, @Body() body: any) { return this.auth.createInvitation(auth, body); }
  @Post("admin/invitations/:id/revoke") revoke(@Headers("authorization") auth: string | undefined, @Param("id") id: string) { return this.auth.revokeInvitation(auth, id); }
  @Post("invitations/activate") activate(@Headers("authorization") auth: string | undefined, @Body() body: any, @Req() req: any) { return this.auth.activateInvitation(auth, body, metadata(req)); }
}
