import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AddPaymentEvidenceInput, AddPaymentMilestoneInput, CreatePaymentScheduleInput, PrincipalContext } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { buildPaginationMeta, nonEmptyString, normalizePagination, optionalBoolean, optionalDate, optionalInteger, optionalNumber, optionalString } from "../../shared/http/request-context";
import { money, optionalStringArray, toApiEnum, toIso, toPrismaEnum } from "../../shared/http/api-mappers";

const scheduleInclude = {
  account: true,
  contract: true,
  opportunity: true,
  project: true,
  proposalPackage: true,
  milestones: {
    include: {
      financeOwner: true,
      overdueOwner: true,
      invoices: true,
      arFollowUps: true,
      evidence: true
    },
    orderBy: [{ sequence: "asc" as const }, { createdAt: "asc" as const }]
  }
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSchedules(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where = {
      workspaceId: principal.workspaceId,
      ...(optionalString(query.accountId, "accountId") ? { accountId: query.accountId } : {}),
      ...(optionalString(query.projectId, "projectId") ? { projectId: query.projectId } : {}),
      ...(optionalString(query.status, "status") ? { status: toPrismaEnum(query.status) as any } : {})
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.paymentSchedule.findMany({
        where,
        include: scheduleInclude,
        orderBy: [{ updatedAt: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.paymentSchedule.count({ where })
    ]);

    return {
      data: rows.map((row) => this.mapSchedule(row)),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length })
      }
    };
  }

  async getSchedule(paymentScheduleId: string, principal: PrincipalContext) {
    const schedule = await this.findSchedule(paymentScheduleId, principal.workspaceId);
    return this.mapSchedule(schedule, true);
  }

  async createSchedule(input: CreatePaymentScheduleInput, principal: PrincipalContext) {
    const account = await this.ensureAccount(nonEmptyString(input.accountId, "accountId"), principal.workspaceId);
    if (input.projectId) {
      await this.ensureProject(input.projectId, principal.workspaceId, account.id);
    }
    if (input.opportunityId) {
      await this.ensureOpportunity(input.opportunityId, principal.workspaceId, account.id);
    }

    const code = input.code?.trim() || `${account.code}-PAY-${Date.now().toString(36).toUpperCase()}`;
    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentSchedule.create({
        data: {
          workspaceId: principal.workspaceId,
          accountId: account.id,
          contractId: optionalString(input.contractId, "contractId") ?? undefined,
          opportunityId: optionalString(input.opportunityId, "opportunityId") ?? undefined,
          projectId: optionalString(input.projectId, "projectId") ?? undefined,
          proposalPackageId: optionalString(input.proposalPackageId, "proposalPackageId") ?? undefined,
          code,
          title: nonEmptyString(input.title, "title"),
          status: toPrismaEnum(input.status ?? "draft") as any,
          currency: optionalString(input.currency, "currency") ?? "VND",
          totalAmount: optionalNumber(input.totalAmount, "totalAmount") ?? 0,
          customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
          allowedRoles: input.allowedRoles ?? [],
          createdByUserId: principal.subjectId
        }
      });

      if (input.milestones?.length) {
        await tx.paymentMilestone.createMany({
          data: input.milestones.map((milestone, index) => this.milestoneCreateData(created, milestone, principal.workspaceId, principal.subjectId, index + 1))
        });
      }

      return tx.paymentSchedule.findUniqueOrThrow({ where: { id: created.id }, include: scheduleInclude });
    });

    return this.mapSchedule(schedule, true);
  }

  async listMilestones(paymentScheduleId: string, principal: PrincipalContext) {
    const schedule = await this.findSchedule(paymentScheduleId, principal.workspaceId);
    return {
      data: schedule.milestones.map((milestone: any) => this.mapMilestone(milestone)),
      meta: { principal, rowScope: "schedule", hiddenFields: [] }
    };
  }

  async addMilestone(paymentScheduleId: string, input: AddPaymentMilestoneInput, principal: PrincipalContext) {
    const schedule = await this.findSchedule(paymentScheduleId, principal.workspaceId);
    const latest = await this.prisma.paymentMilestone.findFirst({
      where: { scheduleId: schedule.id, workspaceId: principal.workspaceId },
      orderBy: { sequence: "desc" },
      select: { sequence: true }
    });

    const milestone = await this.prisma.paymentMilestone.create({
      data: this.milestoneCreateData(schedule, input, principal.workspaceId, principal.subjectId, (latest?.sequence ?? 0) + 1),
      include: { financeOwner: true, overdueOwner: true, invoices: true, arFollowUps: true, evidence: true }
    });

    return this.mapMilestone(milestone);
  }

  async addEvidence(milestoneId: string, input: AddPaymentEvidenceInput, principal: PrincipalContext) {
    const milestone = await this.findMilestone(milestoneId, principal.workspaceId);
    const evidence = await this.prisma.paymentEvidence.create({
      data: {
        workspaceId: principal.workspaceId,
        milestoneId: milestone.id,
        accountId: milestone.accountId,
        evidenceType: toPrismaEnum(input.evidenceType) as any,
        title: nonEmptyString(input.title, "title"),
        storageProvider: optionalString(input.storageProvider, "storageProvider") ?? "lark_drive",
        storageKey: optionalString(input.storageKey, "storageKey") ?? undefined,
        externalUrl: optionalString(input.externalUrl, "externalUrl") ?? undefined,
        customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
        createdByUserId: principal.subjectId
      }
    });

    return this.mapEvidence(evidence);
  }

  async arAging(principal: PrincipalContext) {
    const now = new Date();
    const rows = await this.prisma.paymentMilestone.findMany({
      where: {
        workspaceId: principal.workspaceId,
        paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] as any },
        dueAt: { not: null }
      },
      include: { account: true, invoices: { orderBy: { createdAt: "desc" }, take: 1 }, arFollowUps: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ dueAt: "asc" }]
    });

    return {
      data: rows.map((row) => {
        const invoice = row.invoices[0];
        const outstanding = money(row.amount) - money(invoice?.paidAmount);
        return {
          accountId: row.accountId,
          accountName: row.account.name,
          milestoneId: row.id,
          invoiceId: invoice?.id,
          code: row.code,
          label: row.label,
          currency: invoice?.currency ?? "VND",
          outstandingAmount: outstanding,
          dueAt: toIso(row.dueAt),
          daysOverdue: row.dueAt ? Math.max(Math.floor((now.getTime() - row.dueAt.getTime()) / 86400000), 0) : 0,
          paymentStatus: toApiEnum(row.paymentStatus),
          nextActionAt: toIso(row.arFollowUps[0]?.nextActionAt)
        };
      }),
      meta: {
        principal,
        rowScope: "workspace",
        generatedAt: new Date().toISOString(),
        source: "postgresql"
      }
    };
  }

  private milestoneCreateData(schedule: any, input: AddPaymentMilestoneInput, workspaceId: string, userId: string, fallbackSequence: number) {
    const sequence = optionalInteger(input.sequence, "sequence") ?? fallbackSequence;
    return {
      workspaceId,
      scheduleId: schedule.id,
      accountId: schedule.accountId,
      contractId: schedule.contractId,
      projectId: schedule.projectId,
      code: input.code?.trim() || `${schedule.code}-M${String(sequence).padStart(2, "0")}`,
      sequence,
      label: nonEmptyString(input.label, "label"),
      triggerType: toPrismaEnum(input.triggerType ?? "manual") as any,
      triggerRef: optionalString(input.triggerRef, "triggerRef") ?? undefined,
      percentage: optionalNumber(input.percentage, "percentage") ?? undefined,
      amount: optionalNumber(input.amount, "amount") ?? 0,
      dueAt: optionalDate(input.dueAt, "dueAt") ?? undefined,
      financeOwnerUserId: optionalString(input.financeOwnerUserId, "financeOwnerUserId") ?? undefined,
      overdueOwnerUserId: optionalString(input.overdueOwnerUserId, "overdueOwnerUserId") ?? undefined,
      customerVisible: optionalBoolean(input.customerVisible, "customerVisible") ?? false,
      internalNote: optionalString(input.internalNote, "internalNote") ?? undefined,
      customerNote: optionalString(input.customerNote, "customerNote") ?? undefined,
      createdByUserId: userId
    };
  }

  private async findSchedule(paymentScheduleId: string, workspaceId: string) {
    const schedule = await this.prisma.paymentSchedule.findFirst({
      where: { id: paymentScheduleId, workspaceId },
      include: scheduleInclude
    });
    if (!schedule) {
      throw new NotFoundException("Payment schedule not found");
    }
    return schedule;
  }

  private async findMilestone(milestoneId: string, workspaceId: string) {
    const milestone = await this.prisma.paymentMilestone.findFirst({ where: { id: milestoneId, workspaceId } });
    if (!milestone) {
      throw new NotFoundException("Payment milestone not found");
    }
    return milestone;
  }

  private async ensureAccount(accountId: string, workspaceId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, workspaceId } });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
    return account;
  }

  private async ensureProject(projectId: string, workspaceId: string, accountId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId, accountId } });
    if (!project) {
      throw new BadRequestException("Project does not belong to selected account/workspace");
    }
    return project;
  }

  private async ensureOpportunity(opportunityId: string, workspaceId: string, accountId: string) {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, workspaceId, accountId } });
    if (!opportunity) {
      throw new BadRequestException("Opportunity does not belong to selected account/workspace");
    }
    return opportunity;
  }

  private mapSchedule(row: any, detail = false) {
    const paidAmount = row.milestones?.reduce((sum: number, milestone: any) => {
      return sum + (milestone.invoices ?? []).reduce((invoiceSum: number, invoice: any) => invoiceSum + money(invoice.paidAmount), 0);
    }, 0) ?? 0;
    const totalAmount = money(row.totalAmount);
    const mapped = {
      id: row.id,
      accountId: row.accountId,
      accountName: row.account?.name ?? "",
      contractId: row.contractId ?? undefined,
      contractCode: row.contract?.code ?? undefined,
      opportunityId: row.opportunityId ?? undefined,
      opportunityTitle: row.opportunity?.title ?? undefined,
      projectId: row.projectId ?? undefined,
      projectName: row.project?.name ?? undefined,
      proposalPackageId: row.proposalPackageId ?? undefined,
      proposalPackageTitle: row.proposalPackage?.title ?? undefined,
      code: row.code,
      title: row.title,
      status: toApiEnum(row.status),
      currency: row.currency,
      totalAmount,
      paidAmount,
      outstandingAmount: Math.max(totalAmount - paidAmount, 0),
      overdueAmount: (row.milestones ?? []).filter((milestone: any) => milestone.dueAt && milestone.dueAt < new Date() && milestone.paymentStatus !== "PAID").reduce((sum: number, milestone: any) => sum + money(milestone.amount), 0),
      customerVisible: row.customerVisible,
      allowedRoles: optionalStringArray(row.allowedRoles) ?? [],
      createdAt: toIso(row.createdAt)!,
      updatedAt: toIso(row.updatedAt)!
    };
    return detail ? { ...mapped, milestones: row.milestones.map((milestone: any) => this.mapMilestone(milestone)) } : mapped;
  }

  private mapMilestone(row: any) {
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      accountId: row.accountId,
      contractId: row.contractId ?? undefined,
      projectId: row.projectId ?? undefined,
      code: row.code,
      sequence: row.sequence,
      label: row.label,
      triggerType: toApiEnum(row.triggerType),
      triggerRef: row.triggerRef ?? undefined,
      percentage: money(row.percentage),
      amount: money(row.amount),
      dueAt: toIso(row.dueAt),
      invoiceReadyAt: toIso(row.invoiceReadyAt),
      invoicedAt: toIso(row.invoicedAt),
      paidAt: toIso(row.paidAt),
      status: toApiEnum(row.status),
      invoiceStatus: toApiEnum(row.invoiceStatus),
      paymentStatus: toApiEnum(row.paymentStatus),
      financeOwnerUserId: row.financeOwnerUserId ?? undefined,
      financeOwnerDisplayName: row.financeOwner?.displayName,
      overdueOwnerUserId: row.overdueOwnerUserId ?? undefined,
      overdueOwnerDisplayName: row.overdueOwner?.displayName,
      customerVisible: row.customerVisible,
      internalNote: row.internalNote ?? undefined,
      customerNote: row.customerNote ?? undefined,
      createdAt: toIso(row.createdAt)!,
      updatedAt: toIso(row.updatedAt)!,
      invoices: row.invoices?.map((invoice: any) => ({
        id: invoice.id,
        milestoneId: invoice.milestoneId,
        accountId: invoice.accountId,
        contractId: invoice.contractId ?? undefined,
        projectId: invoice.projectId ?? undefined,
        code: invoice.code,
        status: toApiEnum(invoice.status),
        paymentStatus: toApiEnum(invoice.paymentStatus),
        currency: invoice.currency,
        amount: money(invoice.amount),
        paidAmount: money(invoice.paidAmount),
        issuedAt: toIso(invoice.issuedAt),
        sentAt: toIso(invoice.sentAt),
        dueAt: toIso(invoice.dueAt),
        paidAt: toIso(invoice.paidAt),
        externalInvoiceNo: invoice.externalInvoiceNo ?? undefined,
        customerVisible: invoice.customerVisible,
        storageProvider: invoice.storageProvider,
        storageKey: invoice.storageKey ?? undefined,
        externalUrl: invoice.externalUrl ?? undefined,
        createdAt: toIso(invoice.createdAt)!,
        updatedAt: toIso(invoice.updatedAt)!
      })),
      arFollowUps: row.arFollowUps?.map((followUp: any) => ({
        id: followUp.id,
        milestoneId: followUp.milestoneId,
        invoiceId: followUp.invoiceId ?? undefined,
        accountId: followUp.accountId,
        ownerUserId: followUp.ownerUserId ?? undefined,
        status: toApiEnum(followUp.status),
        reason: followUp.reason,
        nextActionAt: toIso(followUp.nextActionAt),
        resolvedAt: toIso(followUp.resolvedAt),
        note: followUp.note ?? undefined,
        createdAt: toIso(followUp.createdAt)!,
        updatedAt: toIso(followUp.updatedAt)!
      })),
      evidence: row.evidence?.map((evidence: any) => this.mapEvidence(evidence))
    };
  }

  private mapEvidence(row: any) {
    return {
      id: row.id,
      milestoneId: row.milestoneId ?? undefined,
      invoiceId: row.invoiceId ?? undefined,
      accountId: row.accountId,
      evidenceType: toApiEnum(row.evidenceType),
      title: row.title,
      storageProvider: row.storageProvider,
      storageKey: row.storageKey ?? undefined,
      externalUrl: row.externalUrl ?? undefined,
      customerVisible: row.customerVisible,
      createdAt: toIso(row.createdAt)!
    };
  }
}
