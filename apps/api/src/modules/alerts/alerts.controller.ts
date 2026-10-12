import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { AlertsService } from "./alerts.service";

/** 7.5 / 7.6 Admin endpoints. Every handler is Admin-only (assertAdmin in the service) except the token-guarded scheduled scan. */
@Controller()
export class AlertsController {
  constructor(
    @Inject(AlertsService) private readonly alerts: AlertsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("admin/parameters")
  async parameters(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    return this.alerts.listParameters(await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Get("admin/parameters/:key/history")
  async parameterHistory(@Param("key") key: string, @Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    return this.alerts.parameterHistory(key, await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Patch("admin/parameters/:key")
  async updateParameter(@Param("key") key: string, @Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() input: { value?: unknown; reset?: boolean }) {
    return this.alerts.updateParameter(key, input, await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Get("admin/alert-triggers")
  async triggers(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    return this.alerts.listTriggers(await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Patch("admin/alert-triggers/:code")
  async updateTrigger(@Param("code") code: string, @Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() input: unknown) {
    return this.alerts.updateTrigger(code, input, await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Get("admin/warnings")
  async warnings(
    @Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string,
    @Query("status") status?: string, @Query("typeCode") typeCode?: string, @Query("projectId") projectId?: string, @Query("severity") severity?: string
  ) {
    const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || undefined;
    return this.alerts.listWarnings({ status: first(status), typeCode: first(typeCode), projectId: first(projectId), severity: first(severity) }, await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Post("admin/alert-scan")
  async scanNow(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    return this.alerts.scanNow(await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  /** Called by the worker's daily schedule or an external cron (docs/alert-scan.md). */
  @Post("internal/alert-scan")
  async scheduledScan(@Headers("x-alert-scan-token") token?: string, @Query("force") force?: string) {
    return this.alerts.scanAll(token, force === "1" || force === "true");
  }
}
