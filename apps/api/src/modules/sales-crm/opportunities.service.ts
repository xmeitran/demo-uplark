import { Inject, Injectable } from "@nestjs/common";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { buildPaginationMeta, normalizePagination, optionalString } from "../../shared/http/request-context";
import { mapOpportunitySummary } from "./opportunities.mapper";

const opportunityInclude = {
  account: true,
  owner: true
};

@Injectable()
export class OpportunitiesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listOpportunities(query: any, principal: PrincipalContext) {
    const pagination = normalizePagination({ limit: query.limit, offset: query.offset });
    const search = optionalString(query.q ?? query.search, "q");
    const stage = optionalString(query.stage, "stage");
    const where: any = {
      workspaceId: principal.workspaceId,
      ...(principal.subjectType === "portal_user"
        ? { accountId: { in: principal.customerAccountIds } }
        : {}),
      ...(stage ? { stage } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { account: { name: { contains: search, mode: "insensitive" } } }
            ]
          }
        : {})
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: opportunityInclude,
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }, { id: "asc" }],
        take: pagination.limit,
        skip: pagination.offset
      }),
      this.prisma.opportunity.count({ where })
    ]);

    return {
      data: rows.map((row) => mapOpportunitySummary(row)),
      meta: {
        principal,
        rowScope: principal.subjectType === "portal_user" ? "customer_accounts" : "workspace",
        hiddenFields: ["ownerEmail"],
        pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length })
      }
    };
  }
}
