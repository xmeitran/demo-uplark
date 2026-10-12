import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { FrameworkConversionAdminService } from "./framework-conversion-admin.service";

/** Table 9.1: both handlers are Admin-only (assertAdmin in the service). */
@Controller()
export class FrameworkConversionController {
  constructor(
    @Inject(FrameworkConversionAdminService) private readonly conversions: FrameworkConversionAdminService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("projects/:projectId/framework-conversion")
  async preview(@Param("projectId") projectId: string, @Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string, @Query("position") position?: string | string[]) {
    return this.conversions.preview(projectId, Array.isArray(position) ? position[0] : position, await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Post("projects/:projectId/framework-conversion")
  async apply(@Param("projectId") projectId: string, @Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() input: { position?: unknown }) {
    return this.conversions.apply(projectId, input, await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }
}
