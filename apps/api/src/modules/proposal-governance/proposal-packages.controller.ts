import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { ProposalPackagesService } from "./proposal-packages.service";

@Controller()
export class ProposalPackagesController {
  constructor(
    @Inject(ProposalPackagesService) private readonly proposals: ProposalPackagesService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("proposal-packages")
  async list(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.proposals.list(query, principal);
  }

  @Post("proposal-packages")
  async create(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.create(body, principal);
  }

  @Get("proposal-packages/:proposalPackageId")
  async get(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("proposalPackageId") proposalPackageId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.get(proposalPackageId, principal);
  }

  @Patch("proposal-packages/:proposalPackageId")
  async update(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("proposalPackageId") proposalPackageId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.update(proposalPackageId, body, principal);
  }

  @Post("proposal-packages/:proposalPackageId/documents")
  async addDocument(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("proposalPackageId") proposalPackageId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.addDocument(proposalPackageId, body, principal);
  }

  @Post("proposal-packages/:proposalPackageId/submit-review")
  async submitReview(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("proposalPackageId") proposalPackageId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.submitReview(proposalPackageId, body, principal);
  }

  @Post("proposal-packages/:proposalPackageId/approval-requests/:approvalRequestId/decision")
  async recordDecision(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("proposalPackageId") proposalPackageId: string,
    @Param("approvalRequestId") approvalRequestId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.recordDecision(proposalPackageId, approvalRequestId, body, principal);
  }

  @Post("proposal-packages/approval-callback")
  async approvalCallback(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.approvalCallback(body, principal);
  }

  @Post("proposal-packages/:proposalPackageId/send-to-customer")
  async sendToCustomer(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("proposalPackageId") proposalPackageId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.proposals.sendToCustomer(proposalPackageId, body, principal);
  }
}
