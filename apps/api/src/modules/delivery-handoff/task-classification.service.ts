import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { canViewCost } from "../resource-controls/cost-permissions";
import { Prisma } from "@prisma/client";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { isWorkspaceAdmin } from "./milestone-reviewer";
import { PROJECT_STATUS_ALIASES } from "./project-status";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "./member-participation";
import { nextMonthKey, reportMonthStart } from "../resource-controls/pnl-calc";
import { deriveTaskTypeLayer2, isTaskTypeLayer1 } from "./task-classification";
import { isLostDealProject, summarizeLostDealPreSale } from "./lost-deal";
import { assertTaskTypePair } from "./projects.shared";
import { ProjectPermissionsService } from "./project-permissions.service";
import { TimeEntriesService } from "./time-entries.service";

/** The classification cascade (rules 4, D-02…D-04): Layer 2 re-derivation, stage and task reclassification, and the lost-deal Pre-sale summary (D-07). */
@Injectable()
export class TaskClassificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionsService) private readonly permissions: ProjectPermissionsService,
    @Inject(TimeEntriesService) private readonly timeEntries: TimeEntriesService
  ) {}

  /**
   * Table 4.2: Layer 2 follows Loại dự án and the stage's position, so when the project type changes every task is
   * re-derived; their time entries of unlocked P&L months follow (D-03). Returns how many tasks changed.
   */
  async rederiveProjectTaskLayer2(tx: Prisma.TransactionClient, principal: PrincipalContext, projectId: string, cause: string) {
    if (typeof tx.projectTask?.findMany !== "function") return 0;
    const project = await tx.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, select: { projectType: true } });
    const tasks: any[] = await tx.projectTask.findMany({
      where: { workspaceId: principal.workspaceId, projectId },
      select: {
        id: true, taskTypeLayer2: true,
        stage: { select: { afterPnlClose: true } },
        parentTask: { select: { stage: { select: { afterPnlClose: true } } } }
      }
    });
    const changedByLayer2 = new Map<string | null, string[]>();
    for (const task of tasks) {
      const next = deriveTaskTypeLayer2({
        projectType: project?.projectType,
        afterPnlClose: (task.stage ?? task.parentTask?.stage)?.afterPnlClose
      });
      if (next !== (task.taskTypeLayer2 ?? null)) changedByLayer2.set(next, [...(changedByLayer2.get(next) ?? []), task.id]);
    }
    let taskCount = 0;
    let timeEntryCount = 0;
    for (const [taskTypeLayer2, taskIds] of changedByLayer2) {
      await tx.projectTask.updateMany({ where: { workspaceId: principal.workspaceId, id: { in: taskIds } }, data: { taskTypeLayer2 } });
      timeEntryCount += await this.reclassifyTaskTimeEntries(tx, principal.workspaceId, taskIds, { taskTypeLayer2 });
      taskCount += taskIds.length;
    }
    if (taskCount > 0) {
      await this.permissions.auditMutation(tx, principal, "project.tasks_reclassified", "project", projectId, { cause }, { taskCount, timeEntryCount });
    }
    return taskCount;
  }

  /**
   * D-07 / decision 5: Pre-sale hours of projects closed as "Thua deal" are not project cost; they are reported as the
   * separate company-level section "Chi phí Pre-sale". Minutes only — the P&L calculation prices them.
   */
  async lostDealPreSaleSummary(principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Pre-sale cost is internal");
    if (!isWorkspaceAdmin(principal.roleCodes) && !canViewCost(principal)) throw new ForbiddenException("Chỉ Admin hoặc người có quyền xem chi phí mới xem được Chi phí Pre-sale.");
    const closedProjects = await this.prisma.project.findMany({
      where: { workspaceId: principal.workspaceId, status: { in: PROJECT_STATUS_ALIASES.closed }, statusHistory: { some: { closeReasonCode: "lost_deal" } } },
      select: { id: true, code: true, name: true, status: true, statusHistory: { select: { toStatus: true, closeReasonCode: true, changedAt: true } } }
    });
    const lostDeals = new Map(closedProjects.filter((project) => isLostDealProject(project.status, project.statusHistory)).map((project) => [project.id, project]));
    const entries = lostDeals.size === 0 ? [] : await this.prisma.taskTimeEntry.findMany({
      where: { workspaceId: principal.workspaceId, projectId: { in: [...lostDeals.keys()] }, taskTypeLayer1: "PRE_SALE", approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } },
      select: { projectId: true, workDate: true, minutes: true }
    });
    return summarizeLostDealPreSale(entries.map((entry) => {
      const project = lostDeals.get(entry.projectId!)!;
      return { projectId: project.id, projectCode: project.code, projectName: project.name, workDate: entry.workDate, minutes: entry.minutes };
    }));
  }

  /**
   * Section 9.2 worklist: the PM settles what the legacy conversion could not map — a stage's Layer 1 and its side of
   * the P&L closing point. Top-level tasks of the stage that still have no Layer 1 take it (a value somebody chose is
   * kept, D-02); Layer 2 of the project's tasks is then re-derived (D-04) and unlocked time entries follow (D-03).
   */
  async classifyStage(projectId: string, stageId: string, input: { taskTypeLayer1?: unknown; afterPnlClose?: unknown }, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project stages are internal");
    const { taskTypeLayer1, afterPnlClose } = input;
    if (!isTaskTypeLayer1(taskTypeLayer1)) throw new BadRequestException("taskTypeLayer1 must be PRE_SALE, DELIVERY or PM");
    if (typeof afterPnlClose !== "boolean") throw new BadRequestException("afterPnlClose phải là true (sau mốc đóng P&L) hoặc false (trước mốc đóng P&L)");
    assertTaskTypePair(taskTypeLayer1, afterPnlClose ? "TICKET_MAINTENANCE" : "CUSTOMER_PROJECT");
    // One cascade per task of the stage: more statements than the default 5 s transaction allows on a large stage.
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.permissions.canReclassifyTask(tx, projectId, principal))) {
        throw new ForbiddenException("Chỉ PM, Dx Director, BD Lead, Workspace Admin, Founder/GM hoặc người quản lý dự án mới được phân loại stage.");
      }
      const stage = await tx.projectStage.findFirst({ where: { id: stageId, projectId, workspaceId: principal.workspaceId }, select: { id: true, taskTypeLayer1: true, afterPnlClose: true } });
      if (!stage) throw new NotFoundException("Project stage not found");
      await tx.projectStage.update({ where: { id: stage.id }, data: { taskTypeLayer1, afterPnlClose } });
      const tasks = await tx.projectTask.findMany({ where: { workspaceId: principal.workspaceId, stageId: stage.id, parentTaskId: null, taskTypeLayer1: null }, select: { id: true, taskTypeLayer2: true } });
      if (tasks.length > 0) {
        await tx.projectTask.updateMany({ where: { workspaceId: principal.workspaceId, id: { in: tasks.map((task) => task.id) } }, data: { taskTypeLayer1 } });
      }
      for (const task of tasks) {
        await this.cascadeTaskClassification(tx, principal, { id: task.id, taskTypeLayer1, taskTypeLayer2: task.taskTypeLayer2 }, { taskTypeLayer1: null, taskTypeLayer2: task.taskTypeLayer2 });
      }
      const layer2TaskCount = await this.rederiveProjectTaskLayer2(tx, principal, projectId, "stage_classified");
      await this.permissions.auditMutation(tx, principal, "project.stage_classified", "project_stage", stage.id,
        { taskTypeLayer1: stage.taskTypeLayer1, afterPnlClose: stage.afterPnlClose }, { taskTypeLayer1, afterPnlClose, taskCount: tasks.length, layer2TaskCount });
      return { stageId: stage.id, taskTypeLayer1, afterPnlClose, taskCount: tasks.length };
    }, { timeout: 60_000 });
  }

  /** A reclassified task takes its sub-tasks (D-02) and its unlocked time entries (D-03) with it; the change is audited. */
  async cascadeTaskClassification(
    tx: Prisma.TransactionClient,
    principal: PrincipalContext,
    task: { id: string; taskTypeLayer1: string | null; taskTypeLayer2: string | null },
    before: { taskTypeLayer1: string | null; taskTypeLayer2: string | null }
  ) {
    const classification = { taskTypeLayer1: task.taskTypeLayer1 ?? null, taskTypeLayer2: task.taskTypeLayer2 ?? null };
    const taskIds = [task.id];
    // Template nesting stops at four levels (normalizeTemplateTasks).
    for (let parentIds = [task.id], depth = 0; parentIds.length > 0 && depth < 4 && typeof tx.projectTask.findMany === "function"; depth += 1) {
      const children = await tx.projectTask.findMany({ where: { workspaceId: principal.workspaceId, parentTaskId: { in: parentIds } }, select: { id: true } });
      parentIds = children.map((child) => child.id);
      taskIds.push(...parentIds);
    }
    if (taskIds.length > 1) {
      await tx.projectTask.updateMany({ where: { workspaceId: principal.workspaceId, id: { in: taskIds.slice(1) } }, data: classification });
    }
    const timeEntryCount = await this.reclassifyTaskTimeEntries(tx, principal.workspaceId, taskIds, classification);
    await this.permissions.auditMutation(tx, principal, "task.reclassified", "task", task.id, before, { ...classification, subtaskCount: taskIds.length - 1, timeEntryCount });
  }

  /**
   * D-03: a time entry keeps the classification it was written with. When its task is reclassified, the entries
   * of months that are not locked follow the task; entries of a locked P&L month never change.
   */
  async reclassifyTaskTimeEntries(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskIds: string[],
    classification: { taskTypeLayer1?: string | null; taskTypeLayer2?: string | null }
  ) {
    if (taskIds.length === 0 || typeof tx.taskTimeEntry?.updateMany !== "function") return 0;
    const lockedPeriods = typeof tx.pnlPeriod?.findMany === "function"
      ? await tx.pnlPeriod.findMany({ where: { workspaceId, projectId: null, status: "LOCKED" }, select: { periodKey: true } })
      : [];
    const updated = await tx.taskTimeEntry.updateMany({
      where: {
        workspaceId,
        taskId: { in: taskIds },
        NOT: lockedPeriods.map(({ periodKey }) => ({ workDate: { gte: reportMonthStart(periodKey), lt: reportMonthStart(nextMonthKey(periodKey)) } }))
      },
      data: classification
    });
    // The task's Layer 2 moved under entries that carry a choice: the "Lớp 2 không khớp" warning follows.
    if ("taskTypeLayer2" in classification && typeof tx.projectTask?.findMany === "function") {
      const projects = await tx.projectTask.findMany({ where: { workspaceId, id: { in: taskIds }, projectId: { not: null } }, select: { projectId: true }, distinct: ["projectId"] });
      for (const { projectId } of projects ?? []) await this.timeEntries.syncLayer2MismatchWarning(tx, workspaceId, projectId, null);
    }
    return updated.count;
  }
}
