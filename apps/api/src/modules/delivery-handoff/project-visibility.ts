import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { can, type PrincipalContext } from "@b2b-crm/contracts";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { PrincipalService } from "../identity-access/principal.service";
import { INTERNAL_WORKLOG_PROJECT_TYPE } from "./task-classification";

/**
 * Rules 7.7 — which projects an account sees.
 * Admin (in admin view): every project of the workspace.
 * User, and an Admin working in user view: the projects they take part in — project member, PIC / owner of any stage,
 * owner or assignee of a task — plus the projects of a client they are the PIC of (the BD in charge of that client).
 * Portal (customer) principals: only the projects and clients of their customer grants. Service accounts see everything.
 */
export function seesAllProjects(principal: PrincipalContext) {
  if (principal.subjectType === "service_account") return true;
  return principal.subjectType === "internal_user" && can("project.view_all", principal) && principal.viewMode !== "user";
}

export function visibleProjectWhere(principal: PrincipalContext): Prisma.ProjectWhereInput {
  if (seesAllProjects(principal)) return {};
  if (principal.subjectType !== "internal_user") {
    return { OR: [{ id: { in: principal.customerProjectIds ?? [] } }, { accountId: { in: principal.customerAccountIds ?? [] } }] };
  }
  const userId = principal.subjectId;
  return { OR: [
    { members: { some: { userId, workspaceId: principal.workspaceId } } },
    { stages: { some: { ownerUserId: userId } } },
    { tasks: { some: { archivedAt: null, OR: [{ assigneeUserId: userId }, { ownerUserId: userId }] } } },
    { account: { picUserId: userId } },
    // D-08: the fixed "DX Internal Worklog" project is where everyone logs internal hours.
    { projectType: { equals: INTERNAL_WORKLOG_PROJECT_TYPE, mode: "insensitive" } }
  ] };
}

export async function canSeeProject(prisma: { project: { findFirst(args: any): Promise<unknown> } }, projectId: string, principal: PrincipalContext) {
  if (seesAllProjects(principal)) return true;
  return Boolean(await prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId, AND: [visibleProjectWhere(principal)] }, select: { id: true } }));
}

/**
 * The one rule for "PM / PIC of the project": the owner of its first stage (stage sortOrder, then creation time).
 * Permissions (ProjectsService.projectPermissions), warning owners, alert recipients and the Lark bots all read it here.
 */
export function firstStageOf<T extends { sortOrder: number; createdAt?: Date | string | null }>(stages: readonly T[]): T | undefined {
  return [...stages].sort((left, right) => left.sortOrder - right.sortOrder || new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime())[0];
}

export async function projectPmUserId(client: any, workspaceId: string, projectId: string): Promise<string | null> {
  const stage = await client.projectStage.findFirst({ where: { workspaceId, projectId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { ownerUserId: true } });
  return stage?.ownerUserId ?? null;
}

/** 7.7: revenue, cost and margin are for the cost permission group only. */
export function withoutProjectFinancials<T extends object>(summary: T, principal: PrincipalContext): T {
  if (can("project.financials.view", principal)) return summary;
  return { ...summary, marginPercent: undefined, budgetAmount: undefined, spentAmount: undefined, budgetCurrency: undefined };
}

/**
 * One gate for every route that names a project (`:projectId` in the path or `projectId` in the query): an account that
 * may not see the project gets 404, and the attempt is written to PolicyDecisionLog (7.7 "truy cập ngoài phạm vi được ghi lại").
 * ponytail: resolves the session a second time per request (the handler resolves it again); pass the principal on the
 * request object if that extra query ever shows up in a profile.
 */
@Injectable()
export class ProjectVisibilityGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const projectId = request.params?.projectId ?? request.query?.projectId;
    if (typeof projectId !== "string" || !projectId) return true;
    const principal = await this.principals.resolveFromAuthorization(request.headers?.authorization, request.query?.principal);
    if (await canSeeProject(this.prisma, projectId, principal)) return true;
    // A project that does not exist in the workspace is a plain 404 from the handler, not an out-of-scope access.
    if (await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, select: { id: true } })) {
      await this.prisma.policyDecisionLog.create({ data: {
        workspaceId: principal.workspaceId, userId: principal.subjectId, subjectType: "INTERNAL_USER",
        action: request.method === "GET" ? "READ" : "UPDATE", resource: "PROJECT", resourceId: projectId, decision: "DENY",
        reason: "project_out_of_scope", requestId: randomUUID(),
        context: { method: request.method, path: String(request.route?.path ?? request.url ?? "").slice(0, 200), accountType: principal.accountType ?? null, viewMode: principal.viewMode ?? null }
      } });
    }
    throw new NotFoundException("Project not found");
  }
}
