import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { canViewCost } from "../resource-controls/cost-permissions";
import { randomUUID } from "node:crypto";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { Prisma, SubjectStatus } from "@prisma/client";
import type {
  PrincipalContext
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  isWorkspaceAdmin
} from "./milestone-reviewer";
import { can, isAdminAccount } from "@b2b-crm/contracts";
import { projectPmUserId, visibleProjectWhere } from "./project-visibility";
import { ResourceControlsService } from "../resource-controls/resource-controls.service";
import { recordBaselineChange } from "./baseline.service";
import { issueLogActor, type IssueLogContext } from "./issue-log.service";
import { assertStageGateOpen } from "./gates.service";
import { TIME_REVIEW_ROLE_CODES, TASK_PLAN_APPROVER_ROLES } from "./projects.shared";


type ActiveUserLookupClient = Pick<Prisma.TransactionClient, "user">;
type ProjectAssignmentLookupClient = Pick<Prisma.TransactionClient, "projectMember" | "user">;

/** Who may see or change a project and its tasks, plus the small guards and lookups every project service shares (split out of ProjectsService). */
@Injectable()
export class ProjectPermissionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(NotificationsService) private readonly notifications?: NotificationsService,
    @Optional() @Inject(ResourceControlsService) private readonly costPeriods?: ResourceControlsService
  ) {}

  /** Issue log (rules 5.4, V-23…V-32, 8.2): the rules and persistence live in issue-log.ts / issue-log.service.ts. */
  async issueLogContext(projectId: string, principal: PrincipalContext): Promise<IssueLogContext> {
    return { prisma: this.prisma, notifications: this.notifications, principal, actor: issueLogActor(principal, await this.projectPermissions(this.prisma, projectId, principal)),
      // G7 asks the P&L hour gate itself (one rule for "Chờ xử lý that blocks G7").
      ...(this.costPeriods ? { pendingHoursBlockingG7: (workspaceId: string, id: string) => this.costPeriods!.pendingHoursBlockingG7(workspaceId, id) } : {}) };
  }

  async canReclassifyTask(client: Prisma.TransactionClient, projectId: string | null | undefined, principal: PrincipalContext) {
    return principal.roleCodes.some((roleCode) => TASK_PLAN_APPROVER_ROLES.has(roleCode)) || this.canManageProjectOrAdmin(client, projectId, principal);
  }

  async lockProjectMembers(tx: Prisma.TransactionClient, workspaceId: string, projectId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-members:${workspaceId}:${projectId}`}, 0))::text`;
  }

  async auditMutation(tx: Prisma.TransactionClient, principal: PrincipalContext, action: string, resource: string, resourceId: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
    await tx.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource, resourceId, before, after, requestId: randomUUID() } });
  }

  async projectPermissions(tx: Prisma.TransactionClient, projectId: string, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user") return { canManage: false, canLogForOthers: false, isMember: false };
    const member = await tx.projectMember.findFirst({ where: { workspaceId: principal.workspaceId, projectId, userId: principal.subjectId,
      user: { status: SubjectStatus.ACTIVE, roleBindings: { some: { workspaceId: principal.workspaceId, tenantKey: principal.tenantKey, ...activeMembershipWhere() } } } } });
    const picUserId = await projectPmUserId(tx, principal.workspaceId, projectId);
    // 7.7 matrix: the PIC and every Admin (Founder/GM, Workspace Admin, PM, Dx Director, BD Lead) manage the project; a Delivery Lead manages the projects they are a member of.
    return { isMember: Boolean(member), canManage: can("project.plan.update", { roleCodes: principal.roleCodes, isProjectPic: picUserId === principal.subjectId }) || (principal.roleCodes.includes("DELIVERY_LEAD") && Boolean(member)),
      canLogForOthers: principal.roleCodes.some((role) => TIME_REVIEW_ROLE_CODES.has(role)) };
  }

  async assertProjectManager(tx: Prisma.TransactionClient, projectId: string, principal: PrincipalContext) {
    const permissions = await this.projectPermissions(tx, projectId, principal);
    if (!permissions.canManage) throw new ForbiddenException("Only the project PIC, a project Delivery Lead, or Founder/GM can manage this project");
  }

  /** Tasks and blocks outside any project fall back to Founder/GM. */
  async canManageProject(client: Prisma.TransactionClient, projectId: string | null | undefined, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user") return false;
    return projectId ? (await this.projectPermissions(client, projectId, principal)).canManage : isAdminAccount(principal);
  }

  async canManageProjectOrAdmin(client: Prisma.TransactionClient, projectId: string | null | undefined, principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user") return false;
    return isWorkspaceAdmin(principal.roleCodes) || this.canManageProject(client, projectId, principal);
  }

  async assertProjectManagerOrAdmin(client: Prisma.TransactionClient, projectId: string, principal: PrincipalContext) {
    if (!(await this.canManageProjectOrAdmin(client, projectId, principal))) {
      throw new ForbiddenException("Chỉ PIC dự án, Delivery Lead của dự án, Workspace Admin hoặc Founder/GM mới được thực hiện thao tác này");
    }
  }

  /** A locked milestone opens only when the previous one is approved; until then nothing may be added to or logged in it. */
  async assertMilestoneUnlocked(client: any, workspaceId: string, stageId: string | null | undefined, action: string) {
    if (!stageId || typeof client?.projectStage?.findFirst !== "function") return;
    const stage = await client.projectStage.findFirst({ where: { id: stageId, workspaceId }, select: { milestone: { select: { name: true, gateStatus: true } } } });
    if (stage?.milestone?.gateStatus === "locked") {
      throw new ConflictException(`Milestone "${stage.milestone.name}" đang khóa cho đến khi milestone trước được duyệt, nên chưa thể ${action}.`);
    }
    // V-11 at stage level: no time in a stage whose preceding gate (G1–G8) is not approved. Planning ahead stays possible (V-04).
    if (action === "log giờ") await assertStageGateOpen(client, workspaceId, stageId, action);
  }

  /**
   * Founder/GM, Workspace Admin and anyone allowed to see cost (P&L needs every hour) read planning blocks and time entries of the whole workspace.
   * Any other internal user reads their own rows plus those of projects they are a member of or lead a stage in.
   */
  timeRecordVisibilityWhere(principal: PrincipalContext) {
    if (isWorkspaceAdmin(principal.roleCodes) || canViewCost(principal)) return {};
    const memberOrLead: Prisma.ProjectWhereInput = { OR: [
      { members: { some: { userId: principal.subjectId, workspaceId: principal.workspaceId } } },
      { stages: { some: { ownerUserId: principal.subjectId } } }
    ] };
    return { AND: [{ OR: [{ userId: principal.subjectId }, { task: { project: memberOrLead } }] }] };
  }

  /** By-id access to one planning block / time entry: the person's own rows, or rows of a task they may reach (taskAccessWhere). */
  timeRecordAccessWhere(principal: PrincipalContext) {
    const taskWhere = this.taskAccessWhere(principal);
    return Object.keys(taskWhere).length === 0 ? {} : { OR: [{ userId: principal.subjectId }, { task: taskWhere }] };
  }

  /** Next baseline version after a direct edit of a baselined field by someone allowed to make it. */
  recordPlanBaseline(tx: Prisma.TransactionClient, principal: PrincipalContext, projectId: string, layers: readonly ("B0" | "B1")[], causeId: string, reason: string) {
    return recordBaselineChange(tx, { workspaceId: principal.workspaceId, projectId, layers, cause: { type: "plan_edit", id: causeId, reason }, actor: { userId: principal.subjectId, displayName: principal.displayName } });
  }

  async ensureActiveWorkspaceUsers(
    tx: ActiveUserLookupClient,
    workspaceId: string,
    tenantKey: string,
    userIds: string[]
  ) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const users = await tx.user.findMany({
      where: {
        id: { in: uniqueIds },
        status: SubjectStatus.ACTIVE,
        roleBindings: { some: { workspaceId, tenantKey, ...activeMembershipWhere() } }
      },
      select: { id: true }
    });
    const found = new Set(users.map((user) => user.id));
    const missing = uniqueIds.filter((userId) => !found.has(userId));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown, inactive, or out-of-workspace user(s): ${missing.join(", ")}`);
    }
  }

  async ensureProjectAssignmentUsers(
    tx: ProjectAssignmentLookupClient,
    workspaceId: string,
    tenantKey: string,
    projectId: string,
    userIds: string[]
  ) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    await this.ensureActiveWorkspaceUsers(tx, workspaceId, tenantKey, uniqueIds);

    const members = await tx.projectMember.findMany({
      where: {
        workspaceId,
        projectId,
        userId: { in: uniqueIds }
      },
      select: { userId: true }
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const missing = uniqueIds.filter((userId) => !memberIds.has(userId));
    if (missing.length > 0) {
      throw new BadRequestException(`User(s) are not project members: ${missing.join(", ")}`);
    }
  }

  async ensureProject(projectId: string, workspaceId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return project;
  }

  taskAccessWhere(principal: PrincipalContext): Prisma.ProjectTaskWhereInput {
    if (principal.subjectType !== "portal_user") {
      // 7.7: a task of a project is reachable only by accounts that see the project. Tasks outside any project are unchanged.
      const visible = visibleProjectWhere(principal);
      return Object.keys(visible).length === 0 ? {} : { AND: [{ OR: [{ projectId: null }, { project: visible }] }] };
    }

    const customerAccountIds = Array.from(new Set(principal.customerAccountIds.filter(Boolean)));
    const customerProjectIds = Array.from(new Set(principal.customerProjectIds.filter(Boolean)));
    const grantWhere: Prisma.ProjectTaskWhereInput[] = [];
    if (customerAccountIds.length > 0) {
      grantWhere.push({ accountId: { in: customerAccountIds } });
    }
    if (customerProjectIds.length > 0) {
      grantWhere.push({ projectId: { in: customerProjectIds } });
    }

    if (grantWhere.length === 0) {
      return { id: "__task_access_denied__" };
    }

    return {
      customerVisible: true,
      OR: grantWhere
    };
  }

  async ensureTaskForPrincipal(taskId: string, principal: PrincipalContext, options?: { include?: Prisma.ProjectTaskInclude }) {
    const task = await this.prisma.projectTask.findFirst({
      where: {
        id: taskId,
        workspaceId: principal.workspaceId,
        ...this.taskAccessWhere(principal)
      },
      ...(options?.include ? { include: options.include } : {})
    });
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return task;
  }

  assertInternalTaskPrincipal(principal: PrincipalContext, message: string) {
    if (principal.subjectType !== "internal_user") {
      throw new ForbiddenException(message);
    }
  }
}
