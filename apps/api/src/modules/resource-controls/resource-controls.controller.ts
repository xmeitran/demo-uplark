import { Body, Controller, Get, Headers, Inject, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { PnlConfigService } from "./pnl-config.service";
import { ResourceControlsService } from "./resource-controls.service";

@Controller()
export class ResourceControlsController {
  constructor(
    @Inject(PrincipalService)
    private readonly principals: PrincipalService,
    @Inject(ResourceControlsService)
    private readonly resourceControls: ResourceControlsService,
    @Inject(PnlConfigService) private readonly pnlConfig: PnlConfigService
  ) {}

  @Get("capacity/summary")
  async capacitySummary(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.resourceControls.capacitySummary(query, principal);
  }

  @Post("capacity/allocations")
  async createAllocation(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.resourceControls.createAllocation(body, principal);
  }

  /** Trang hồ sơ từng người: that person's monthly costs — the same table as GET /pnl/staff-costs (mục 6.7). */
  @Get("staff-costs")
  async listStaffCosts(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.pnlConfig.staffCostsOfUser(String(Array.isArray(query.userId) ? query.userId[0] : query.userId ?? ""), principal);
  }
}
