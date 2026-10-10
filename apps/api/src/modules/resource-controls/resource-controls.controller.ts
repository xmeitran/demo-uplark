import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
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

  @Get("cost-rates")
  async listCostRates(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.resourceControls.listCostRates(query, principal);
  }

  @Put("cost-rates")
  async setCostRate(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.resourceControls.setCostRate(body, principal);
  }

  @Get("project-costs")
  async listProjectCosts(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.resourceControls.listProjectCosts(query, principal);
  }

  @Post("project-costs")
  async createProjectCost(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.resourceControls.createProjectCost(body, principal);
  }

  @Patch("project-costs/:costId")
  async updateProjectCost(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("costId") costId: string, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.resourceControls.updateProjectCost(costId, body, principal);
  }

  @Delete("project-costs/:costId")
  async deleteProjectCost(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("costId") costId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.resourceControls.deleteProjectCost(costId, principal);
  }

  @Put("project-costs/planned/:projectId")
  async setPlannedCost(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.resourceControls.setPlannedCost(projectId, body, principal);
  }
}
