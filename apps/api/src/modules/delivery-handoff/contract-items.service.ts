import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { canViewCost } from "../resource-controls/cost-permissions";
import { Prisma } from "@prisma/client";
import type {
  PrincipalContext
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  nonEmptyString,
  optionalNumber,
  optionalString
} from "../../shared/http/request-context";
import {
  isWorkspaceAdmin
} from "./milestone-reviewer";
import { isAdminAccount } from "@b2b-crm/contracts";
import { PROJECT_STATUS_ALIASES } from "./project-status";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "./member-participation";
import { nextMonthKey, reportMonthStart } from "../resource-controls/pnl-calc";
import { deriveTaskTypeLayer2, isInternalWorklogProjectType, isTaskTypeLayer1 } from "./task-classification";
import { CONTRACT_ITEM_KIND_LABELS, CONTRACT_ITEM_TYPE_LABELS, isContractItemKind, isContractItemType, isLostDealProject, lockedContractItemFields, resolveTaskContractItem, summarizeLostDealPreSale } from "./contract-item";
import { mapProjectContractItemSummary } from "./delivery.mapper";
import { isApprovedChangeRequest } from "./change-request-effects";
import { omitUndefined, hasInputKey, assertTaskTypePair } from "./projects.shared";
import { ProjectPermissionsService } from "./project-permissions.service";
import { TimeEntriesService } from "./time-entries.service";


/** Contract line items and the classification cascade: item CRUD, task↔item moves, Layer 2 re-derivation, lost-deal pre-sale summary (split out of ProjectsService). */
@Injectable()
export class ContractItemsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionsService) private readonly permissions: ProjectPermissionsService,
    @Inject(TimeEntriesService) private readonly timeEntries: TimeEntriesService
  ) {}

  /**
   * D-01 / D-05 / D-06: the contract line item a task is saved with, and that item's type for the Layer 2 derivation.
   * A sub-task repeats its parent; a project's only item (or its root item) is assigned by the system; anything else is
   * the PM's (Admin) decision, and moving a task needs a reason. The internal worklog project has no line items.
   */
  async resolveTaskContractItemFor(
    client: Prisma.TransactionClient,
    principal: PrincipalContext,
    input: { projectId?: string | null; parentTaskId?: string | null; currentItemId?: string | null; requested?: unknown; reason?: unknown }
  ) {
    if (input.parentTaskId) {
      const parent: any = await client.projectTask.findFirst({
        where: { id: input.parentTaskId, workspaceId: principal.workspaceId },
        select: { contractItemId: true, contractItem: { select: { contractType: true } } }
      });
      return { value: (parent?.contractItemId ?? null) as string | null, contractType: (parent?.contractItem?.contractType ?? null) as string | null, moved: false };
    }
    // Unit specs mock only the models they exercise.
    const items = input.projectId && typeof (client as any).projectContractItem?.findMany === "function"
      ? await client.projectContractItem.findMany({
          where: { workspaceId: principal.workspaceId, projectId: input.projectId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, kind: true, sortOrder: true, contractType: true, status: true }
        })
      : [];
    const requestedItemId = optionalString(input.requested, "contractItemId") ?? null;
    const isChange = Boolean(requestedItemId) && requestedItemId !== (input.currentItemId ?? null);
    const resolved = resolveTaskContractItem({
      isSubtask: false,
      currentItemId: input.currentItemId,
      requestedItemId,
      activeItems: items.filter((item) => item.status === "active"),
      canAssign: isChange && await this.permissions.canReclassifyTask(client, input.projectId, principal),
      reason: optionalString(input.reason, "contractItemChangeReason")
    });
    if (resolved.error) throw resolved.forbidden ? new ForbiddenException(resolved.error) : new BadRequestException(resolved.error);
    return { value: resolved.value, contractType: items.find((item) => item.id === resolved.value)?.contractType ?? null, moved: resolved.moved };
  }

  /** D-05: a task's line item is repeated by its sub-tasks and by its time entries of unlocked P&L months; always audited. */
  async cascadeTaskContractItem(
    tx: Prisma.TransactionClient,
    principal: PrincipalContext,
    taskId: string,
    change: { from: string | null; to: string | null; reason?: string | null }
  ) {
    const taskIds = [taskId];
    for (let parentIds = [taskId], depth = 0; parentIds.length > 0 && depth < 4 && typeof tx.projectTask.findMany === "function"; depth += 1) {
      const children = await tx.projectTask.findMany({ where: { workspaceId: principal.workspaceId, parentTaskId: { in: parentIds } }, select: { id: true } });
      parentIds = children.map((child) => child.id);
      taskIds.push(...parentIds);
    }
    if (taskIds.length > 1) {
      await tx.projectTask.updateMany({ where: { workspaceId: principal.workspaceId, id: { in: taskIds.slice(1) } }, data: { contractItemId: change.to } });
    }
    const timeEntryCount = await this.reclassifyTaskTimeEntries(tx, principal.workspaceId, taskIds, { contractItemId: change.to });
    await this.permissions.auditMutation(tx, principal, "task.contract_item_changed", "task", taskId, { contractItemId: change.from },
      { contractItemId: change.to, reason: change.reason ?? null, subtaskCount: taskIds.length - 1, timeEntryCount });
  }

  /**
   * Table 4.2: Layer 2 follows the project kind and the line item's type, so when either changes every affected task is
   * re-derived; their time entries of unlocked P&L months follow (D-03). Returns how many tasks changed.
   */
  async rederiveProjectTaskLayer2(tx: Prisma.TransactionClient, principal: PrincipalContext, projectId: string, cause: string, contractItemId?: string) {
    if (typeof tx.projectTask?.findMany !== "function") return 0;
    const project = await tx.project.findFirst({ where: { id: projectId, workspaceId: principal.workspaceId }, select: { projectType: true } });
    const tasks: any[] = await tx.projectTask.findMany({
      where: { workspaceId: principal.workspaceId, projectId, ...(contractItemId ? { contractItemId } : {}) },
      select: {
        id: true, taskTypeLayer2: true,
        stage: { select: { afterPnlClose: true } },
        parentTask: { select: { stage: { select: { afterPnlClose: true } } } },
        contractItem: { select: { contractType: true } }
      }
    });
    const changedByLayer2 = new Map<string | null, string[]>();
    for (const task of tasks) {
      const next = deriveTaskTypeLayer2({
        projectType: project?.projectType,
        afterPnlClose: (task.stage ?? task.parentTask?.stage)?.afterPnlClose,
        contractType: task.contractItem?.contractType
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
      await this.permissions.auditMutation(tx, principal, "project.tasks_reclassified", "project", projectId, { cause }, { contractItemId: contractItemId ?? null, taskCount, timeEntryCount });
    }
    return taskCount;
  }

  private async contractItemUsage(client: Prisma.TransactionClient, workspaceId: string, projectId: string) {
    const [entryRows, invoiceCount] = await Promise.all([
      client.taskTimeEntry.groupBy({ by: ["contractItemId"], where: { workspaceId, projectId, contractItemId: { not: null } }, _count: { _all: true } }),
      client.invoice.count({ where: { workspaceId, projectId, status: { in: ["ISSUED", "SENT"] } } })
    ]);
    // P&L spec 6.1: "khi Đã ký, giá trị gốc của mọi hạng mục chuyển sang chỉ đọc" — the contract status lives on the project's P&L record.
    const contractSigned = typeof (client as any).projectPnlRecord?.findFirst === "function"
      && (await client.projectPnlRecord.findFirst({ where: { workspaceId, projectId }, select: { contractStatus: true } }))?.contractStatus === "signed";
    return { itemsWithTimeEntries: new Set(entryRows.map((row) => row.contractItemId)), hasIssuedInvoice: invoiceCount > 0, contractSigned };
  }

  async listProjectContractItems(projectId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Contract line items are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const [items, usage, canManage] = await Promise.all([
      this.prisma.projectContractItem.findMany({
        where: { workspaceId: principal.workspaceId, projectId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { _count: { select: { tasks: true } } }
      }),
      this.contractItemUsage(this.prisma, principal.workspaceId, projectId),
      this.permissions.canReclassifyTask(this.prisma, projectId, principal)
    ]);
    // 6.1 "Quyền" / PL-26: Admin - PM edits, other Admins view; a User account does not get the values.
    const seesValues = isAdminAccount(principal) || canViewCost(principal);
    return {
      data: items.map((item) => mapProjectContractItemSummary(item, usage.hasIssuedInvoice || usage.itemsWithTimeEntries.has(item.id)))
        .map((item) => (seesValues ? item : { ...item, valueAmount: undefined })),
      meta: {
        canManage,
        canViewValues: seesValues,
        isInternalWorklog: isInternalWorklogProjectType(project.projectType),
        typeLabels: CONTRACT_ITEM_TYPE_LABELS,
        kindLabels: CONTRACT_ITEM_KIND_LABELS
      }
    };
  }

  /** Validates the editable fields of a line item; a key that was not sent stays undefined. */
  private parseContractItemInput(input: any) {
    const kind = optionalString(input.kind, "kind") ?? undefined;
    if (kind !== undefined && !isContractItemKind(kind)) throw new BadRequestException(`Loại nguồn hạng mục không hợp lệ. Giá trị hợp lệ: ${Object.values(CONTRACT_ITEM_KIND_LABELS).join(", ")}.`);
    const contractType = hasInputKey(input, "contractType") ? optionalString(input.contractType, "contractType") ?? null : undefined;
    if (contractType && !isContractItemType(contractType)) throw new BadRequestException(`Loại hợp đồng không hợp lệ. Giá trị hợp lệ: ${Object.values(CONTRACT_ITEM_TYPE_LABELS).join(", ")}.`);
    const valueAmount = hasInputKey(input, "valueAmount") ? optionalNumber(input.valueAmount, "valueAmount") ?? null : undefined;
    const estimateMinutes = hasInputKey(input, "estimateMinutes") ? optionalNumber(input.estimateMinutes, "estimateMinutes") ?? null : undefined;
    if ((valueAmount ?? 0) < 0 || (estimateMinutes ?? 0) < 0 || (estimateMinutes != null && !Number.isInteger(estimateMinutes))) {
      throw new BadRequestException("Giá trị và estimate gốc của hạng mục phải là số không âm.");
    }
    return {
      kind,
      contractType,
      valueAmount,
      estimateMinutes,
      code: optionalString(input.code, "code") ?? undefined,
      name: optionalString(input.name, "name") ?? undefined,
      changeRequestId: hasInputKey(input, "changeRequestId") ? optionalString(input.changeRequestId, "changeRequestId") ?? null : undefined,
      sortOrder: optionalNumber(input.sortOrder, "sortOrder") ?? undefined
    };
  }

  /** D-23: a change-request line item needs its request, in this project, in status Đã duyệt. */
  private async assertApprovedChangeRequest(tx: Prisma.TransactionClient, workspaceId: string, projectId: string, changeRequestId: string | null | undefined) {
    const request = changeRequestId ? await tx.projectRisk.findFirst({ where: { id: changeRequestId, workspaceId, projectId }, select: { type: true, status: true } }) : null;
    // The request passed CR-07C (customer approval on file, V-29) and has not been closed, rejected or deferred.
    if (!isApprovedChangeRequest(request)) {
      throw new ConflictException("Hạng mục của yêu cầu thay đổi chỉ tạo được khi yêu cầu đó ở trạng thái Đã duyệt.");
    }
  }

  async createProjectContractItem(projectId: string, input: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Contract line items are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    if (isInternalWorklogProjectType(project.projectType)) throw new BadRequestException("Dự án DX Internal Worklog không có hạng mục hợp đồng.");
    const fields = this.parseContractItemInput(input);
    const name = nonEmptyString(input.name, "name");
    const item = await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      if (!(await this.permissions.canReclassifyTask(tx, projectId, principal))) throw new ForbiddenException("Chỉ PM (Admin) hoặc người quản lý dự án mới được tạo hạng mục hợp đồng.");
      const existing = await tx.projectContractItem.findMany({ where: { workspaceId: principal.workspaceId, projectId }, select: { code: true, kind: true, status: true, sortOrder: true } });
      const hasRoot = existing.some((row) => row.kind === "ROOT" && row.status === "active");
      const kind = fields.kind ?? (hasRoot ? "APPENDIX" : "ROOT");
      if (kind === "ROOT" && hasRoot) throw new ConflictException("Dự án đã có hạng mục HĐ gốc; hạng mục mới phải là Phụ lục hoặc Yêu cầu thay đổi.");
      if (kind === "CHANGE_REQUEST") await this.assertApprovedChangeRequest(tx, principal.workspaceId, projectId, fields.changeRequestId);
      const code = fields.code ?? `HM-${String(existing.length + 1).padStart(2, "0")}`;
      if (existing.some((row) => row.code.toLowerCase() === code.toLowerCase())) throw new ConflictException(`Mã hạng mục "${code}" đã tồn tại trong dự án.`);
      const created = await tx.projectContractItem.create({
        data: {
          workspaceId: principal.workspaceId, projectId, code, name, kind,
          contractType: fields.contractType ?? null,
          valueAmount: fields.valueAmount ?? null,
          estimateMinutes: fields.estimateMinutes ?? null,
          changeRequestId: kind === "CHANGE_REQUEST" ? fields.changeRequestId : null,
          sortOrder: fields.sortOrder ?? Math.max(0, ...existing.map((row) => row.sortOrder)) + 10,
          createdByUserId: principal.subjectId
        }
      });
      // D-07: hours logged before the contract sit in "Chưa có hạng mục"; the root item takes them over when it appears.
      let adoptedTaskCount = 0;
      let adoptedTimeEntryCount = 0;
      if (kind === "ROOT") {
        const orphans = await tx.projectTask.findMany({ where: { workspaceId: principal.workspaceId, projectId, contractItemId: null }, select: { id: true } });
        const orphanIds = orphans.map((task) => task.id);
        if (orphanIds.length > 0) {
          adoptedTaskCount = (await tx.projectTask.updateMany({ where: { workspaceId: principal.workspaceId, id: { in: orphanIds } }, data: { contractItemId: created.id } })).count;
          adoptedTimeEntryCount = await this.reclassifyTaskTimeEntries(tx, principal.workspaceId, orphanIds, { contractItemId: created.id });
        }
      }
      await this.permissions.auditMutation(tx, principal, "contract_item.created", "project_contract_item", created.id, undefined,
        { projectId, code, name, kind, contractType: created.contractType, valueAmount: fields.valueAmount ?? null, estimateMinutes: created.estimateMinutes, changeRequestId: created.changeRequestId, adoptedTaskCount, adoptedTimeEntryCount });
      if (adoptedTaskCount > 0) await this.rederiveProjectTaskLayer2(tx, principal, projectId, "contract_item.created", created.id);
      // D-20: a line item is B0 (scope and price); adopted tasks change B1. No-op until the baseline is locked.
      await this.permissions.recordPlanBaseline(tx, principal, projectId, ["B0", "B1"], created.id, `Thêm hạng mục ${code} "${name}"`);
      return created;
    });
    return mapProjectContractItemSummary(item);
  }

  async updateProjectContractItem(projectId: string, itemId: string, input: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Contract line items are internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    const fields = this.parseContractItemInput(input);
    const status = optionalString(input.status, "status") ?? undefined;
    if (status !== undefined && status !== "active" && status !== "archived") throw new BadRequestException("status must be active or archived");
    const item = await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      if (!(await this.permissions.canReclassifyTask(tx, projectId, principal))) throw new ForbiddenException("Chỉ PM (Admin) hoặc người quản lý dự án mới được sửa hạng mục hợp đồng.");
      const current = await tx.projectContractItem.findFirst({ where: { id: itemId, workspaceId: principal.workspaceId, projectId } });
      if (!current) throw new NotFoundException("Contract line item not found");
      const usage = await this.contractItemUsage(tx, principal.workspaceId, projectId);
      const currentValue = current.valueAmount === null ? null : Number(current.valueAmount);
      const locked = lockedContractItemFields(
        { contractType: current.contractType, valueAmount: currentValue },
        { contractType: fields.contractType, valueAmount: fields.valueAmount },
        { hasTimeEntries: usage.itemsWithTimeEntries.has(itemId), hasIssuedInvoice: usage.hasIssuedInvoice, contractSigned: usage.contractSigned }
      );
      if (locked.length > 0) {
        throw new ConflictException(`${usage.contractSigned ? "Hợp đồng đã ở trạng thái Đã ký" : "Hạng mục đã có giờ log hoặc đã xuất hóa đơn"} nên ${locked.join(" và ")} đã khóa. Muốn đổi phải qua yêu cầu thay đổi.`);
      }
      const kind = fields.kind ?? current.kind;
      if (kind !== current.kind) {
        if (kind === "ROOT" && await tx.projectContractItem.count({ where: { workspaceId: principal.workspaceId, projectId, kind: "ROOT", status: "active", id: { not: itemId } } })) {
          throw new ConflictException("Dự án đã có hạng mục HĐ gốc.");
        }
        if (kind === "CHANGE_REQUEST") await this.assertApprovedChangeRequest(tx, principal.workspaceId, projectId, fields.changeRequestId ?? current.changeRequestId);
      }
      if (status === "archived" && current.status !== "archived"
        && await tx.projectTask.count({ where: { workspaceId: principal.workspaceId, contractItemId: itemId, archivedAt: null } })) {
        throw new ConflictException("Hạng mục còn task đang dùng. Chuyển các task sang hạng mục khác trước khi ngừng dùng hạng mục này.");
      }
      if (fields.code && fields.code !== current.code
        && await tx.projectContractItem.count({ where: { projectId, code: { equals: fields.code, mode: "insensitive" }, id: { not: itemId } } })) {
        throw new ConflictException(`Mã hạng mục "${fields.code}" đã tồn tại trong dự án.`);
      }
      const updated = await tx.projectContractItem.update({
        where: { id: itemId },
        data: omitUndefined({
          code: fields.code, name: fields.name, kind: fields.kind, contractType: fields.contractType, valueAmount: fields.valueAmount,
          estimateMinutes: fields.estimateMinutes, changeRequestId: fields.changeRequestId, sortOrder: fields.sortOrder,
          status, archivedAt: status === undefined ? undefined : status === "archived" ? current.archivedAt ?? new Date() : null
        }),
        include: { _count: { select: { tasks: true } } }
      });
      const snapshot = (row: typeof current) => ({
        code: row.code, name: row.name, kind: row.kind, contractType: row.contractType, valueAmount: row.valueAmount === null ? null : Number(row.valueAmount),
        estimateMinutes: row.estimateMinutes, changeRequestId: row.changeRequestId, sortOrder: row.sortOrder, status: row.status
      });
      await this.permissions.auditMutation(tx, principal, "contract_item.updated", "project_contract_item", itemId, snapshot(current), snapshot(updated));
      if (updated.contractType !== current.contractType) await this.rederiveProjectTaskLayer2(tx, principal, projectId, "contract_item.type_changed", itemId);
      await this.permissions.recordPlanBaseline(tx, principal, projectId, ["B0"], itemId, `Sửa hạng mục ${updated.code}`);
      return mapProjectContractItemSummary(updated, usage.hasIssuedInvoice || usage.itemsWithTimeEntries.has(itemId));
    });
    return item;
  }

  /** History is never deleted: a line item that a task or a time entry ever pointed at can only be archived. */
  async deleteProjectContractItem(projectId: string, itemId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Contract line items are internal");
    await this.permissions.ensureProject(projectId, principal.workspaceId);
    await this.prisma.$transaction(async (tx) => {
      await this.permissions.lockProjectMembers(tx, principal.workspaceId, projectId);
      if (!(await this.permissions.canReclassifyTask(tx, projectId, principal))) throw new ForbiddenException("Chỉ PM (Admin) hoặc người quản lý dự án mới được xóa hạng mục hợp đồng.");
      const current = await tx.projectContractItem.findFirst({ where: { id: itemId, workspaceId: principal.workspaceId, projectId } });
      if (!current) throw new NotFoundException("Contract line item not found");
      const [taskCount, timeEntryCount] = await Promise.all([
        tx.projectTask.count({ where: { workspaceId: principal.workspaceId, contractItemId: itemId } }),
        tx.taskTimeEntry.count({ where: { workspaceId: principal.workspaceId, contractItemId: itemId } })
      ]);
      if (taskCount + timeEntryCount > 0) {
        throw new ConflictException("Hạng mục đã có task hoặc giờ log nên không xóa được. Hãy chuyển sang trạng thái ngừng dùng để giữ lịch sử.");
      }
      if ((await this.contractItemUsage(tx, principal.workspaceId, projectId)).contractSigned) {
        throw new ConflictException("Hợp đồng đã ở trạng thái Đã ký nên không xóa được hạng mục. Muốn đổi phạm vi hoặc giá trị phải qua yêu cầu thay đổi.");
      }
      await tx.projectContractItem.delete({ where: { id: itemId } });
      await this.permissions.recordPlanBaseline(tx, principal, projectId, ["B0"], itemId, `Xóa hạng mục ${current.code}`);
      await this.permissions.auditMutation(tx, principal, "contract_item.deleted", "project_contract_item", itemId,
        { projectId, code: current.code, name: current.name, kind: current.kind, contractType: current.contractType }, undefined);
    });
    return { deleted: true };
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

  /** A reclassified task takes its sub-tasks (D-02) and its unlocked time entries (D-03 / D-05) with it; the change is audited. */
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
   * D-03 / D-05: a time entry keeps the classification it was written with. When its task is reclassified, the entries
   * of months that are not locked follow the task; entries of a locked P&L month never change.
   */
  async reclassifyTaskTimeEntries(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskIds: string[],
    classification: { taskTypeLayer1?: string | null; taskTypeLayer2?: string | null; contractItemId?: string | null }
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
