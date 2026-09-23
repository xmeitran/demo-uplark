import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import type { CreateWorkspaceDayOffInput, UpdateWorkspaceDayOffInput } from "@b2b-crm/contracts";
import { PrincipalService } from "../identity-access/principal.service";
import { WorkspaceCalendarService } from "./workspace-calendar.service";

@Controller("workspace/day-offs")
export class WorkspaceCalendarController {
  constructor(
    @Inject(WorkspaceCalendarService) private readonly calendar: WorkspaceCalendarService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get()
  async list(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, unknown>) {
    const principal = await this.principals.resolveFromAuthorization(authorization, typeof query.principal === "string" ? query.principal : undefined);
    return this.calendar.list(query, principal);
  }

  @Post()
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Body() input: CreateWorkspaceDayOffInput
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.calendar.create(input, principal);
  }

  @Patch(":dayOffId")
  async update(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("dayOffId") dayOffId: string,
    @Body() input: UpdateWorkspaceDayOffInput
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.calendar.update(dayOffId, input, principal);
  }
}
