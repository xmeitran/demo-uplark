import { Controller, Get, Headers, Inject, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { OpportunitiesService } from "./opportunities.service";

@Controller("opportunities")
export class OpportunitiesController {
  constructor(
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get()
  async listOpportunities(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.opportunities.listOpportunities(query, principal);
  }
}
