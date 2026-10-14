import { Controller, Get, Headers, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { ProjectVisibilityGuard } from "../delivery-handoff/project-visibility";
import { PrincipalService } from "../identity-access/principal.service";
import { LarkIntegrationService } from "./lark-integration.service";

@Controller()
@UseGuards(ProjectVisibilityGuard)
export class LarkIntegrationController {
  constructor(
    @Inject(LarkIntegrationService) private readonly larkIntegration: LarkIntegrationService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  /** D-09: Admin › Ngày nghỉ, read-only. */
  @Get("admin/personal-leave")
  async personalLeave(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string, @Query("from") from?: string) {
    return this.larkIntegration.listPersonalLeave(await this.principals.resolveFromAuthorization(authorization, principalFallback), { from });
  }

  /** D-09: Admin › Ngày nghỉ › "Đồng bộ ngay". */
  @Post("admin/personal-leave/sync")
  async syncPersonalLeave(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    return this.larkIntegration.syncPersonalLeaveNow(await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  /** Called by the worker's schedule or an external cron (docs/lark-integration.md). */
  @Post("internal/lark-sweep")
  async scheduledSweep(@Headers("x-lark-sweep-token") token?: string) {
    return this.larkIntegration.scheduledSweep(token);
  }
}
