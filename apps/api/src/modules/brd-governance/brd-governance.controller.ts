import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import type {
  OvertimePlanInput,
  PnlPeriodInput,
  PrincipalContext,
  ReopenPnlPeriodInput,
  ReviewTimelineChangeInput,
  SubmitTaskPlanInput,
  TimelineChangeRequestInput
} from "@b2b-crm/contracts";
import { PrincipalService } from "../identity-access/principal.service";
import { BrdGovernanceService } from "./brd-governance.service";

@Controller()
export class BrdGovernanceController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalService,
    @Inject(BrdGovernanceService) private readonly governance: BrdGovernanceService
  ) {}

  private async principal(authorization: string | undefined, fallback: string | undefined): Promise<PrincipalContext> {
    return this.principals.resolveFromAuthorization(authorization, fallback);
  }

  @Post("tasks/:taskId/plan/submit")
  submitTaskPlan(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("taskId") taskId: string, @Body() body: SubmitTaskPlanInput) {
    return this.principal(auth, fallback).then((p) => this.governance.submitTaskPlan(taskId, body, p));
  }

  @Post("tasks/:taskId/plan/approve")
  approveTaskPlan(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("taskId") taskId: string) {
    return this.principal(auth, fallback).then((p) => this.governance.approveTaskPlan(taskId, p));
  }

  @Post("tasks/:taskId/timeline-change-requests")
  requestTimelineChange(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("taskId") taskId: string, @Body() body: TimelineChangeRequestInput) {
    return this.principal(auth, fallback).then((p) => this.governance.requestTimelineChange(taskId, body, p));
  }

  @Patch("timeline-change-requests/:requestId/review")
  reviewTimelineChange(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("requestId") requestId: string, @Body() body: ReviewTimelineChangeInput) {
    return this.principal(auth, fallback).then((p) => this.governance.reviewTimelineChange(requestId, body, p));
  }

  @Post("overtime-plans")
  createOvertimePlan(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: OvertimePlanInput) {
    return this.principal(auth, fallback).then((p) => this.governance.createOvertimePlan(body, p));
  }

  @Patch("overtime-plans/:planId/review")
  reviewOvertimePlan(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("planId") planId: string, @Body() body: { decision: "APPROVED" | "REJECTED"; note?: string }) {
    return this.principal(auth, fallback).then((p) => this.governance.reviewOvertimePlan(planId, body, p));
  }

  @Post("pnl-periods")
  upsertPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: PnlPeriodInput) {
    return this.principal(auth, fallback).then((p) => this.governance.upsertPnlPeriod(body, p));
  }

  /** Removes a project's entered revenue for a month: ?projectId=…&periodKey=YYYY-MM. */
  @Delete("pnl-periods")
  removePnlPeriodRevenue(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Query("periodKey") periodKey: string | undefined, @Query("projectId") projectId: string | undefined) {
    return this.principal(auth, fallback).then((p) => this.governance.removePnlPeriodRevenue({ periodKey, projectId }, p));
  }

  @Get("pnl-periods")
  getPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Query("periodKey") periodKey = "", @Query("projectId") projectId?: string) {
    return this.principal(auth, fallback).then((p) => this.governance.getPnlPeriod(periodKey, p, projectId));
  }

  @Get("pnl-configurations")
  getPnlConfiguration(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Query("periodKey") periodKey: string) {
    return this.principal(auth, fallback).then((p) => this.governance.getPnlConfiguration(periodKey, p));
  }

  @Patch("pnl-configurations")
  upsertPnlConfiguration(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) {
    return this.principal(auth, fallback).then((p) => this.governance.upsertPnlConfiguration(body, p));
  }

  /** :periodId is the period row id, or the month key (YYYY-MM) to lock the workspace month even before its row exists. */
  @Post("pnl-periods/:periodId/lock")
  lockPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodId") periodId: string) {
    return this.principal(auth, fallback).then((p) => this.governance.lockPnlPeriod(periodId, p));
  }

  @Post("pnl-periods/:periodId/reopen")
  reopenPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodId") periodId: string, @Body() body: ReopenPnlPeriodInput) {
    return this.principal(auth, fallback).then((p) => this.governance.reopenPnlPeriod(periodId, body, p));
  }
}
