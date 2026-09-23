import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AddProposalDocumentInput,
  CreateProposalPackageInput,
  PrincipalContext,
  RecordApprovalDecisionInput,
  SendProposalToCustomerInput,
  SubmitProposalReviewInput,
  UpdateProposalPackageInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { buildPaginationMeta, nonEmptyString, normalizePagination, optionalBoolean, optionalNumber, optionalString } from "../../shared/http/request-context";
import { money, toApiEnum, toIso, toPrismaEnum } from "../../shared/http/api-mappers";

const includeProposal = {
  account: true,
  opportunity: true,
  documents: { orderBy: [{ documentType: "asc" as const }, { version: "desc" as const }] },
  approvalRequests: {
    include: { decisions: { orderBy: { decidedAt: "desc" as const } } },
    orderBy: { createdAt: "desc" as const }
  }
};

@Injectable()
export class ProposalPackagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where = {
      workspaceId: principal.workspaceId,
      ...(optionalString(query.accountId, "accountId") ? { accountId: query.accountId } : {}),
      ...(optionalString(query.opportunityId, "opportunityId") ? { opportunityId: query.opportunityId } : {}),
      ...(optionalString(query.status, "status") ? { status: toPrismaEnum(query.status) as any } : {})
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.proposalPackage.findMany({
        where,
        include: { account: true, opportunity: true },
        orderBy: [{ updatedAt: "desc" }, { version: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.proposalPackage.count({ where })
    ]);

    return {
      data: rows.map((row) => this.mapSummary(row)),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length })
      }
    };
  }

  async get(proposalPackageId: string, principal: PrincipalContext) {
    const proposal = await this.findProposal(proposalPackageId, principal.workspaceId);
    return this.mapDetail(proposal);
  }

  async create(input: CreateProposalPackageInput, principal: PrincipalContext) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: nonEmptyString(input.opportunityId, "opportunityId"), workspaceId: principal.workspaceId },
      include: { account: true }
    });
    if (!opportunity) {
      throw new NotFoundException("Opportunity not found");
    }

    const latest = await this.prisma.proposalPackage.findFirst({
      where: { opportunityId: opportunity.id, workspaceId: principal.workspaceId },
      orderBy: { version: "desc" },
      select: { version: true }
    });

    const proposal = await this.prisma.proposalPackage.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId: opportunity.accountId,
        opportunityId: opportunity.id,
        packageType: toPrismaEnum(input.packageType) as any,
        version: (latest?.version ?? 0) + 1,
        title: optionalString(input.title, "title") ?? `${opportunity.title} proposal`,
        currency: optionalString(input.currency, "currency") ?? "VND",
        proposedAmount: optionalNumber(input.proposedAmount, "proposedAmount") ?? opportunity.amount,
        discountPercent: optionalNumber(input.discountPercent, "discountPercent") ?? 0,
        paymentTermSummary: optionalString(input.paymentTermSummary, "paymentTermSummary") ?? undefined,
        scopeRiskLevel: toPrismaEnum(input.scopeRiskLevel ?? "low") as any,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
        createdByUserId: principal.subjectId
      },
      include: includeProposal
    });

    return this.mapDetail(proposal);
  }

  async update(proposalPackageId: string, input: UpdateProposalPackageInput, principal: PrincipalContext) {
    await this.findProposal(proposalPackageId, principal.workspaceId);
    const proposal = await this.prisma.proposalPackage.update({
      where: { id: proposalPackageId },
      data: {
        title: optionalString(input.title, "title") ?? undefined,
        currency: optionalString(input.currency, "currency") ?? undefined,
        proposedAmount: optionalNumber(input.proposedAmount, "proposedAmount") ?? undefined,
        discountPercent: optionalNumber(input.discountPercent, "discountPercent") ?? undefined,
        paymentTermSummary: optionalString(input.paymentTermSummary, "paymentTermSummary"),
        scopeRiskLevel: input.scopeRiskLevel ? (toPrismaEnum(input.scopeRiskLevel) as any) : undefined,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? undefined,
        status: input.status ? (toPrismaEnum(input.status) as any) : undefined
      },
      include: includeProposal
    });

    return this.mapDetail(proposal);
  }

  async addDocument(proposalPackageId: string, input: AddProposalDocumentInput, principal: PrincipalContext) {
    await this.findProposal(proposalPackageId, principal.workspaceId);
    const document = await this.prisma.proposalDocument.create({
      data: {
        workspaceId: principal.workspaceId,
        proposalPackageId,
        documentType: toPrismaEnum(input.documentType) as any,
        version: input.version ?? 1,
        title: nonEmptyString(input.title, "title"),
        storageProvider: optionalString(input.storageProvider, "storageProvider") ?? "lark_drive",
        storageKey: optionalString(input.storageKey, "storageKey") ?? undefined,
        externalUrl: optionalString(input.externalUrl, "externalUrl") ?? undefined,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
        checksum: optionalString(input.checksum, "checksum") ?? undefined,
        createdByUserId: principal.subjectId
      }
    });

    return this.mapDocument(document);
  }

  async submitReview(proposalPackageId: string, input: SubmitProposalReviewInput, principal: PrincipalContext) {
    const proposal = await this.findProposal(proposalPackageId, principal.workspaceId);
    const missing = this.gateFailures(proposal).missingDocuments;
    const reason = optionalString(input.reason, "reason") ?? (missing.length > 0 ? `Missing documents: ${missing.join(", ")}` : "Proposal readiness review");

    await this.prisma.$transaction(async (tx) => {
      await tx.dealApprovalRequest.upsert({
        where: {
          workspaceId_proposalPackageId_requestType_requiredRoleCode: {
            workspaceId: principal.workspaceId,
            proposalPackageId,
            requestType: "PROPOSAL_READINESS" as any,
            requiredRoleCode: "FOUNDER_GM"
          }
        },
        update: { status: "SUBMITTED" as any, reason, submittedAt: new Date(), requestedByUserId: principal.subjectId },
        create: {
          workspaceId: principal.workspaceId,
          proposalPackageId,
          opportunityId: proposal.opportunityId,
          requestType: "PROPOSAL_READINESS" as any,
          status: "SUBMITTED" as any,
          requiredRoleCode: "FOUNDER_GM",
          requestedByUserId: principal.subjectId,
          severity: missing.length > 0 ? "high" : "standard",
          reason,
          submittedAt: new Date()
        }
      });
      await tx.proposalPackage.update({ where: { id: proposalPackageId }, data: { status: "INTERNAL_REVIEW" as any, submittedAt: new Date() } });
    });

    return this.get(proposalPackageId, principal);
  }

  async recordDecision(proposalPackageId: string, approvalRequestId: string, input: RecordApprovalDecisionInput, principal: PrincipalContext) {
    const request = await this.prisma.dealApprovalRequest.findFirst({
      where: { id: approvalRequestId, proposalPackageId, workspaceId: principal.workspaceId }
    });
    if (!request) {
      throw new NotFoundException("Approval request not found");
    }

    const status = input.decision === "approved" ? "APPROVED" : input.decision === "rejected" ? "REJECTED" : "REVISION_REQUESTED";
    await this.prisma.$transaction([
      this.prisma.dealApprovalDecision.create({
        data: {
          workspaceId: principal.workspaceId,
          approvalRequestId,
          decision: input.decision,
          decidedByUserId: principal.subjectId,
          comment: optionalString(input.comment, "comment") ?? undefined,
          larkTaskId: optionalString(input.larkTaskId, "larkTaskId") ?? undefined
        }
      }),
      this.prisma.dealApprovalRequest.update({
        where: { id: approvalRequestId },
        data: { status: status as any, decidedAt: new Date() }
      }),
      this.prisma.proposalPackage.update({
        where: { id: proposalPackageId },
        data: {
          status: input.decision === "approved" ? ("INTERNALLY_APPROVED" as any) : input.decision === "rejected" ? ("WITHDRAWN" as any) : ("REVISION_REQUIRED" as any),
          approvedAt: input.decision === "approved" ? new Date() : undefined
        }
      })
    ]);

    return this.get(proposalPackageId, principal);
  }

  async approvalCallback(input: any, principal: PrincipalContext) {
    const instanceCode = nonEmptyString(input.larkApprovalInstanceCode, "larkApprovalInstanceCode");
    const request = await this.prisma.dealApprovalRequest.findFirst({
      where: { larkApprovalInstanceCode: instanceCode, workspaceId: principal.workspaceId }
    });
    if (!request) {
      throw new NotFoundException("Approval request not found");
    }

    const decision = input.status === "APPROVED" ? "approved" : input.status === "REJECTED" ? "rejected" : "revision_requested";
    return this.recordDecision(request.proposalPackageId, request.id, { decision, comment: optionalString(input.comment, "comment") ?? undefined, larkTaskId: optionalString(input.larkTaskId, "larkTaskId") ?? undefined }, principal);
  }

  async sendToCustomer(proposalPackageId: string, _input: SendProposalToCustomerInput, principal: PrincipalContext) {
    const proposal = await this.findProposal(proposalPackageId, principal.workspaceId);
    const gate = this.gateFailures(proposal);
    if (!gate.proposalSentReady) {
      throw new BadRequestException(`Proposal cannot be sent: ${gate.failures.join("; ")}`);
    }

    const updated = await this.prisma.proposalPackage.update({
      where: { id: proposalPackageId },
      data: { status: "SENT_TO_CUSTOMER" as any, customerVisible: true, sentAt: new Date() },
      include: includeProposal
    });

    return this.mapDetail(updated);
  }

  private async findProposal(proposalPackageId: string, workspaceId: string) {
    const proposal = await this.prisma.proposalPackage.findFirst({
      where: { id: proposalPackageId, workspaceId },
      include: includeProposal
    });
    if (!proposal) {
      throw new NotFoundException("Proposal package not found");
    }
    return proposal;
  }

  private gateFailures(proposal: any) {
    const documentTypes = new Set(proposal.documents.map((document: any) => toApiEnum(document.documentType)));
    const missingDocuments = (["proposal", "sow"] as const).filter((type) => !documentTypes.has(type));
    const pendingApprovalRequestIds = proposal.approvalRequests.filter((request: any) => ["DRAFT", "SUBMITTED"].includes(request.status)).map((request: any) => request.id);
    const failures = [
      ...missingDocuments.map((type) => `Missing ${type} document`),
      ...pendingApprovalRequestIds.map((id: string) => `Approval request ${id} is pending`)
    ];
    return {
      proposalPackageId: proposal.id,
      proposalSentReady: failures.length === 0,
      contractingReady: missingDocuments.length === 0 && proposal.status === "CUSTOMER_ACCEPTED",
      missingDocuments,
      pendingApprovalRequestIds,
      failures
    };
  }

  private mapSummary(row: any) {
    return {
      id: row.id,
      accountId: row.accountId,
      accountName: row.account?.name ?? "",
      opportunityId: row.opportunityId,
      opportunityTitle: row.opportunity?.title ?? "",
      packageType: toApiEnum(row.packageType),
      status: toApiEnum(row.status),
      version: row.version,
      title: row.title,
      currency: row.currency,
      proposedAmount: money(row.proposedAmount),
      discountPercent: money(row.discountPercent),
      paymentTermSummary: row.paymentTermSummary ?? undefined,
      scopeRiskLevel: toApiEnum(row.scopeRiskLevel),
      customerVisible: row.customerVisible,
      submittedAt: toIso(row.submittedAt),
      approvedAt: toIso(row.approvedAt),
      sentAt: toIso(row.sentAt),
      acceptedAt: toIso(row.acceptedAt),
      createdAt: toIso(row.createdAt)!,
      updatedAt: toIso(row.updatedAt)!
    };
  }

  private mapDetail(row: any) {
    return {
      ...this.mapSummary(row),
      documents: row.documents.map((document: any) => this.mapDocument(document)),
      approvalRequests: row.approvalRequests.map((request: any) => ({
        id: request.id,
        proposalPackageId: request.proposalPackageId,
        opportunityId: request.opportunityId,
        requestType: toApiEnum(request.requestType),
        status: toApiEnum(request.status),
        requiredRoleCode: request.requiredRoleCode,
        assignedToUserId: request.assignedToUserId ?? undefined,
        severity: request.severity,
        reason: request.reason,
        larkApprovalInstanceCode: request.larkApprovalInstanceCode ?? undefined,
        submittedAt: toIso(request.submittedAt),
        decidedAt: toIso(request.decidedAt),
        decisions: request.decisions.map((decision: any) => ({
          id: decision.id,
          approvalRequestId: decision.approvalRequestId,
          decision: decision.decision,
          decidedByUserId: decision.decidedByUserId ?? undefined,
          comment: decision.comment ?? undefined,
          larkTaskId: decision.larkTaskId ?? undefined,
          decidedAt: toIso(decision.decidedAt)!
        }))
      })),
      gateCheck: this.gateFailures(row)
    };
  }

  private mapDocument(document: any) {
    return {
      id: document.id,
      proposalPackageId: document.proposalPackageId,
      documentType: toApiEnum(document.documentType),
      version: document.version,
      title: document.title,
      storageProvider: document.storageProvider,
      storageKey: document.storageKey ?? undefined,
      externalUrl: document.externalUrl ?? undefined,
      customerVisible: document.customerVisible,
      checksum: document.checksum ?? undefined,
      createdAt: toIso(document.createdAt)!
    };
  }
}
