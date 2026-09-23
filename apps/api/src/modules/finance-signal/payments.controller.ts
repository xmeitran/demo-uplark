import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("schedules")
  async listSchedules(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.payments.listSchedules(query, principal);
  }

  @Post("schedules")
  async createSchedule(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.payments.createSchedule(body, principal);
  }

  @Get("schedules/:paymentScheduleId")
  async getSchedule(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("paymentScheduleId") paymentScheduleId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.payments.getSchedule(paymentScheduleId, principal);
  }

  @Get("schedules/:paymentScheduleId/milestones")
  async listMilestones(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("paymentScheduleId") paymentScheduleId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.payments.listMilestones(paymentScheduleId, principal);
  }

  @Post("schedules/:paymentScheduleId/milestones")
  async addMilestone(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("paymentScheduleId") paymentScheduleId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.payments.addMilestone(paymentScheduleId, body, principal);
  }

  @Post("milestones/:milestoneId/evidence")
  async addEvidence(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("milestoneId") milestoneId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.payments.addEvidence(milestoneId, body, principal);
  }

  @Get("ar-aging")
  async arAging(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.payments.arAging(principal);
  }
}
