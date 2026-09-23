import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTicketInput, PrincipalContext, UpdateTicketInput } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { buildPaginationMeta, nonEmptyString, normalizePagination, optionalDate, optionalInteger, optionalString } from "../../shared/http/request-context";
import { toIso } from "../../shared/http/api-mappers";

const ticketInclude = {
  statusHistory: { orderBy: { createdAt: "desc" as const }, take: 50 }
};

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const where = {
      workspaceId: principal.workspaceId,
      ...(optionalString(query.accountId, "accountId") ? { accountId: query.accountId } : {}),
      ...(optionalString(query.projectId, "projectId") ? { projectId: query.projectId } : {}),
      ...(optionalString(query.status, "status") ? { status: query.status } : {}),
      ...(optionalString(query.priority, "priority") ? { priority: query.priority } : {})
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: ticketInclude,
        orderBy: [{ updatedAt: "desc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.ticket.count({ where })
    ]);

    return {
      data: rows.map((row) => this.mapTicket(row)),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length })
      }
    };
  }

  async get(ticketId: string, principal: PrincipalContext) {
    const ticket = await this.findTicket(ticketId, principal.workspaceId);
    return this.mapTicket(ticket);
  }

  async create(input: CreateTicketInput, principal: PrincipalContext) {
    const account = await this.ensureAccount(nonEmptyString(input.accountId, "accountId"), principal.workspaceId);
    if (input.projectId) {
      await this.ensureProject(input.projectId, principal.workspaceId, account.id);
    }
    if (input.idempotencyKey) {
      const existing = await this.prisma.ticket.findFirst({
        where: { workspaceId: principal.workspaceId, idempotencyKey: input.idempotencyKey },
        include: ticketInclude
      });
      if (existing) {
        return this.mapTicket(existing);
      }
    }

    const code = `${account.code}-TKT-${Date.now().toString(36).toUpperCase()}`;
    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          workspaceId: principal.workspaceId,
          accountId: account.id,
          projectId: optionalString(input.projectId, "projectId") ?? undefined,
          requesterUserId: optionalString(input.requesterUserId, "requesterUserId") ?? principal.subjectId,
          code,
          title: nonEmptyString(input.title, "title"),
          description: input.description?.trim() ?? "",
          category: input.category?.trim() || "other_triage",
          source: input.source?.trim() || "internal",
          ownerQueue: "customer_success",
          priority: input.priority?.trim() || "medium",
          status: "open",
          customerVisibleNote: optionalString(input.customerVisibleSummary, "customerVisibleSummary") ?? undefined,
          internalNote: optionalString(input.internalNote, "internalNote") ?? undefined,
          idempotencyKey: optionalString(input.idempotencyKey, "idempotencyKey") ?? undefined
        }
      });
      await tx.ticketStatusHistory.create({
        data: {
          workspaceId: principal.workspaceId,
          ticketId: created.id,
          accountId: created.accountId,
          projectId: created.projectId,
          toStatus: created.status,
          changedByUserId: principal.subjectId,
          reason: "created",
          customerVisibleNote: created.customerVisibleNote,
          internalNote: created.internalNote
        }
      });
      return tx.ticket.findUniqueOrThrow({ where: { id: created.id }, include: ticketInclude });
    });

    return this.mapTicket(ticket);
  }

  async update(ticketId: string, input: UpdateTicketInput, principal: PrincipalContext) {
    const existing = await this.findTicket(ticketId, principal.workspaceId);
    const nextStatus = optionalString(input.status, "status") ?? undefined;
    const ticket = await this.prisma.$transaction(async (tx) => {
      if (nextStatus && nextStatus !== existing.status) {
        await tx.ticketStatusHistory.create({
          data: {
            workspaceId: principal.workspaceId,
            ticketId: existing.id,
            accountId: existing.accountId,
            projectId: existing.projectId,
            fromStatus: existing.status,
            toStatus: nextStatus,
            changedByUserId: principal.subjectId,
            reason: optionalString(input.transitionReason, "transitionReason") ?? undefined,
            customerVisibleNote: optionalString(input.customerVisibleNote, "customerVisibleNote") ?? undefined,
            internalNote: optionalString(input.internalNote, "internalNote") ?? undefined
          }
        });
      }

      return tx.ticket.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          priority: optionalString(input.priority, "priority") ?? undefined,
          category: optionalString(input.category, "category") ?? undefined,
          ownerQueue: optionalString(input.ownerQueue, "ownerQueue") ?? undefined,
          customerVisibleNote: optionalString(input.customerVisibleNote, "customerVisibleNote"),
          internalNote: optionalString(input.internalNote, "internalNote"),
          requestedAction: optionalString(input.requestedAction, "requestedAction"),
          customerOwner: optionalString(input.customerOwner, "customerOwner"),
          customerDueAt: optionalDate(input.customerDueAt, "customerDueAt"),
          escalationOwnerUserId: optionalString(input.escalationOwnerUserId, "escalationOwnerUserId"),
          escalationReason: optionalString(input.escalationReason, "escalationReason"),
          recoveryAction: optionalString(input.recoveryAction, "recoveryAction"),
          nextUpdateAt: optionalDate(input.nextUpdateAt, "nextUpdateAt"),
          resolutionSummary: optionalString(input.resolutionSummary, "resolutionSummary"),
          resolutionType: optionalString(input.resolutionType, "resolutionType"),
          closureReason: optionalString(input.closureReason, "closureReason"),
          confirmationState: optionalString(input.confirmationState, "confirmationState"),
          convertedChangeRequestId: optionalString(input.convertedChangeRequestId, "convertedChangeRequestId"),
          reopenCount: optionalInteger((input as any).reopenCount, "reopenCount") ?? undefined
        },
        include: ticketInclude
      });
    });

    return this.mapTicket(ticket);
  }

  private async findTicket(ticketId: string, workspaceId: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, workspaceId }, include: ticketInclude });
    if (!ticket) {
      throw new NotFoundException("Ticket not found");
    }
    return ticket;
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

  private mapTicket(row: any) {
    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId ?? undefined,
      requesterUserId: row.requesterUserId ?? undefined,
      code: row.code,
      title: row.title,
      description: row.description ?? undefined,
      category: row.category ?? undefined,
      source: row.source ?? undefined,
      ownerQueue: row.ownerQueue ?? undefined,
      priority: row.priority,
      status: row.status,
      firstResponseDueAt: toIso(row.firstResponseDueAt),
      resolutionDueAt: toIso(row.resolutionDueAt),
      customerVisibleNote: row.customerVisibleNote ?? undefined,
      internalNote: row.internalNote ?? undefined,
      resolutionSummary: row.resolutionSummary ?? undefined,
      resolutionType: row.resolutionType ?? undefined,
      closureReason: row.closureReason ?? undefined,
      confirmationState: row.confirmationState ?? undefined,
      reopenCount: row.reopenCount,
      escalationOwnerUserId: row.escalationOwnerUserId ?? undefined,
      escalationReason: row.escalationReason ?? undefined,
      recoveryAction: row.recoveryAction ?? undefined,
      nextUpdateAt: toIso(row.nextUpdateAt),
      requestedAction: row.requestedAction ?? undefined,
      customerOwner: row.customerOwner ?? undefined,
      customerDueAt: toIso(row.customerDueAt),
      resolutionSlaPausedAt: toIso(row.resolutionSlaPausedAt),
      convertedChangeRequestId: row.convertedChangeRequestId ?? undefined,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      statusHistory: row.statusHistory?.map((history: any) => ({
        id: history.id,
        ticketId: history.ticketId,
        accountId: history.accountId,
        projectId: history.projectId ?? undefined,
        fromStatus: history.fromStatus ?? undefined,
        toStatus: history.toStatus,
        changedByUserId: history.changedByUserId ?? undefined,
        reason: history.reason ?? undefined,
        customerVisibleNote: history.customerVisibleNote ?? undefined,
        internalNote: history.internalNote ?? undefined,
        createdAt: toIso(history.createdAt)!
      }))
    };
  }
}
