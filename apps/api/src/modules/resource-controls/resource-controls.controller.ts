import { Body, Controller, Get, Headers, Inject, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { ResourceControlsService } from "./resource-controls.service";

@Controller()
export class ResourceControlsController {
  constructor(
    @Inject(PrincipalService)
    private readonly principals: PrincipalService,
    @Inject(ResourceControlsService)
    private readonly resourceControls: ResourceControlsService
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

  @Get("project-controls/pl-summary")
  async projectPlSummary(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.resourceControls.projectPlSummary(query, principal);
  }
}
