import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import type {
  OvertimePlanInput,
  PnlPeriodInput,
  PrincipalContext,
  ReopenPnlPeriodInput,
  ResourceMonthlyCostInput,
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

  @Post("resource-costs/monthly")
  upsertMonthlyCost(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: ResourceMonthlyCostInput) {
    return this.principal(auth, fallback).then((p) => this.governance.upsertMonthlyCost(body, p));
  }

  @Post("pnl-periods")
  upsertPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: PnlPeriodInput) {
    return this.principal(auth, fallback).then((p) => this.governance.upsertPnlPeriod(body, p));
  }

  @Post("pnl-periods/:periodId/lock")
  lockPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodId") periodId: string) {
    return this.principal(auth, fallback).then((p) => this.governance.lockPnlPeriod(periodId, p));
  }

  @Post("pnl-periods/:periodId/reopen")
  reopenPnlPeriod(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodId") periodId: string, @Body() body: ReopenPnlPeriodInput) {
    return this.principal(auth, fallback).then((p) => this.governance.reopenPnlPeriod(periodId, body, p));
  }

  @Post("pnl-periods/:periodId/rebuild-allocations")
  rebuildPnlAllocations(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodId") periodId: string) {
    return this.principal(auth, fallback).then((p) => this.governance.rebuildPnlAllocations(periodId, p));
  }

  @Get("pnl-periods/:periodId/reconciliation")
  pnlReconciliation(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodId") periodId: string) {
    return this.principal(auth, fallback).then((p) => this.governance.pnlReconciliation(periodId, p));
  }
}
