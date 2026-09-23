import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { TicketsService } from "./tickets.service";

@Controller("tickets")
export class TicketsController {
  constructor(
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get()
  async list(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.tickets.list(query, principal);
  }

  @Post()
  async create(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.tickets.create(body, principal);
  }

  @Get(":ticketId")
  async get(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("ticketId") ticketId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.tickets.get(ticketId, principal);
  }

  @Patch(":ticketId")
  async update(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("ticketId") ticketId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.tickets.update(ticketId, body, principal);
  }
}
