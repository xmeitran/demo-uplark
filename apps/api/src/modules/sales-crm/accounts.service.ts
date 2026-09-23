import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateAccountContactInput, CreateAccountInput, PrincipalContext, UpdateAccountContactInput, UpdateAccountInput } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  buildPaginationMeta,
  nonEmptyString,
  normalizePagination,
  optionalNumber,
  optionalString
} from "../../shared/http/request-context";
import { mapAccountSummary, mapContactSummary } from "./accounts.mapper";

const accountInclude = {
  ownerTeam: true,
  picUser: true
};

const contactInclude = {
  account: true
};

@Injectable()
export class AccountsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listAccounts(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const search = optionalString(query.q ?? query.search, "q");
    const stage = optionalString(query.stage, "stage");

    const where = {
      workspaceId: principal.workspaceId,
      ...(principal.subjectType === "portal_user" ? { AND: [{ OR: [{ id: { in: principal.customerAccountIds } }, { projects: { some: { id: { in: principal.customerProjectIds } } } }] }] } : {}),
      ...(stage ? { stage } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { code: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [accounts, total] = await this.prisma.$transaction([
      this.prisma.account.findMany({
        where,
        include: accountInclude,
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }, { id: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.account.count({ where })
    ]);

    return {
      data: accounts.map(mapAccountSummary),
      meta: {
        principal,
        rowScope: "workspace",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: accounts.length })
      }
    };
  }

  async getAccount(accountId: string, principal: PrincipalContext) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, workspaceId: principal.workspaceId, ...(principal.subjectType === "portal_user" ? { OR: [{ id: { in: principal.customerAccountIds } }, { projects: { some: { id: { in: principal.customerProjectIds } } } }] } : {}) },
      include: accountInclude
    });

    if (!account) {
      throw new NotFoundException("Account not found");
    }

    return mapAccountSummary(account);
  }

  async createAccount(input: CreateAccountInput, principal: PrincipalContext) {
    const code = nonEmptyString(input.code, "code").toUpperCase();
    const name = nonEmptyString(input.name, "name");
    const annualValue = optionalNumber(input.annualValue, "annualValue") ?? 0;

    const account = await this.prisma.account.create({
      data: {
        workspaceId: principal.workspaceId,
        code,
        name,
        stage: input.stage?.trim() || "new",
        ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId") ?? undefined,
        picUserId: optionalString(input.picUserId, "picUserId") ?? undefined,
        annualValue,
        commercialNote: optionalString(input.commercialNote, "commercialNote") ?? undefined
      },
      include: accountInclude
    });

    return mapAccountSummary(account);
  }

  async updateAccount(accountId: string, input: UpdateAccountInput, principal: PrincipalContext) {
    await this.ensureAccount(accountId, principal.workspaceId);

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: {
        name: optionalString(input.name, "name") ?? undefined,
        stage: optionalString(input.stage, "stage") ?? undefined,
        ownerTeamId: optionalString(input.ownerTeamId, "ownerTeamId"),
        picUserId: optionalString(input.picUserId, "picUserId"),
        annualValue: optionalNumber(input.annualValue, "annualValue") ?? undefined,
        commercialNote: optionalString(input.commercialNote, "commercialNote")
      },
      include: accountInclude
    });

    return mapAccountSummary(account);
  }

  async deleteAccount(accountId: string, principal: PrincipalContext) {
    const account = await this.ensureAccount(accountId, principal.workspaceId);
    const relatedCounts = await this.prisma.$transaction([
      this.prisma.project.count({ where: { accountId, workspaceId: principal.workspaceId } }),
      this.prisma.opportunity.count({ where: { accountId } }),
      this.prisma.projectTask.count({ where: { accountId, workspaceId: principal.workspaceId } })
    ]);

    if (relatedCounts.some((count) => count > 0)) {
      throw new BadRequestException("Account has operational records and cannot be deleted");
    }

    await this.prisma.account.delete({ where: { id: account.id } });
    return { deleted: true, id: account.id };
  }

  async listContacts(accountId: string, query: any, principal: PrincipalContext) {
    await this.ensureAccount(accountId, principal.workspaceId);
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });

    const [contacts, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where: { accountId, workspaceId: principal.workspaceId },
        include: contactInclude,
        orderBy: [{ createdAt: "desc" }, { name: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.contact.count({ where: { accountId, workspaceId: principal.workspaceId } })
    ]);

    return {
      data: contacts.map(mapContactSummary),
      meta: {
        principal,
        rowScope: "account",
        hiddenFields: [],
        pagination: buildPaginationMeta({ ...pagination, total, returned: contacts.length })
      }
    };
  }

  async createContact(accountId: string, input: CreateAccountContactInput, principal: PrincipalContext) {
    await this.ensureAccount(accountId, principal.workspaceId);

    const contact = await this.prisma.contact.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId,
        name: nonEmptyString(input.name, "name"),
        email: optionalString(input.email, "email") ?? undefined,
        phone: optionalString(input.phone, "phone") ?? undefined,
        role: optionalString(input.role, "role") ?? undefined,
        influence: optionalString(input.influence, "influence") ?? undefined
      },
      include: contactInclude
    });

    return mapContactSummary(contact);
  }

  async updateContact(accountId: string, contactId: string, input: UpdateAccountContactInput, principal: PrincipalContext) {
    await this.ensureContact(accountId, contactId, principal.workspaceId);

    const contact = await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        name: optionalString(input.name, "name") ?? undefined,
        email: optionalString(input.email, "email"),
        phone: optionalString(input.phone, "phone"),
        role: optionalString(input.role, "role"),
        influence: optionalString(input.influence, "influence")
      },
      include: contactInclude
    });

    return mapContactSummary(contact);
  }

  async deleteContact(accountId: string, contactId: string, principal: PrincipalContext) {
    const contact = await this.ensureContact(accountId, contactId, principal.workspaceId);
    await this.prisma.contact.delete({ where: { id: contact.id } });

    return { deleted: true, id: contact.id };
  }

  private async ensureAccount(accountId: string, workspaceId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, workspaceId } });
    if (!account) {
      throw new NotFoundException("Account not found");
    }

    return account;
  }

  private async ensureContact(accountId: string, contactId: string, workspaceId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, accountId, workspaceId } });
    if (!contact) {
      throw new NotFoundException("Contact not found");
    }

    return contact;
  }
}
