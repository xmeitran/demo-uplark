import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ProjectsService } from "./projects.service";

/** Every model method exists and answers "nothing found"; a test overrides only what its rule depends on. */
function mockPrisma() {
  const defaults: Record<string, () => unknown> = {
    findFirst: () => null, findUnique: () => null, findMany: () => [], count: () => 0, groupBy: () => [],
    aggregate: () => ({ _sum: { minutes: 0 } }), updateMany: () => ({ count: 0 })
  };
  const models: Record<string, any> = {};
  const root: Record<string, any> = { $queryRaw: vi.fn().mockResolvedValue([{ id: "prj-1", hierarchyOrderVersion: 0 }]) };
  const prisma: any = new Proxy(root, {
    get(target, key: string) {
      if (key in target || typeof key !== "string" || key === "then") return target[key];
      models[key] ??= new Proxy({}, {
        get(methods: Record<string, any>, method: string) {
          methods[method] ??= vi.fn(async (args?: any) => (defaults[method] ? defaults[method]() : { id: `${key}-1`, ...(args?.data ?? {}) }));
          return methods[method];
        }
      });
      return models[key];
    }
  });
  root.$transaction = vi.fn(async (input: any) => (typeof input === "function" ? input(prisma) : Promise.all(input)));
  return prisma;
}

const member: PrincipalContext = {
  subjectType: "internal_user", subjectId: "usr-1", displayName: "Member", tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: ["WORKSPACE_USER"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g"
};
const pm: PrincipalContext = { ...member, subjectId: "pm-1", roleCodes: ["PM"] };
const rootItem = { id: "item-root", kind: "ROOT", sortOrder: 10, contractType: "INTERNAL", status: "active", code: "HM-01", name: "HĐ gốc", valueAmount: null, estimateMinutes: null, changeRequestId: null, archivedAt: null };
const appendix = { ...rootItem, id: "item-appendix", kind: "APPENDIX", sortOrder: 20, contractType: "FIXED_PRICE", code: "HM-02" };
const task = {
  id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", parentTaskId: null, title: "Task", status: "todo",
  ownerUserId: null, assigneeUserId: null, taskAssignees: [], estimateMinutes: 60, planApprovalStatus: "DRAFT", contractItemId: "item-root",
  taskTypeLayer1: "DELIVERY", taskTypeLayer2: null, createdAt: new Date(), updatedAt: new Date()
};

function setup(items: any[] = [rootItem], taskRow: Record<string, unknown> = task) {
  const prisma = mockPrisma();
  prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress", projectType: "delivery" });
  prisma.account.findFirst.mockResolvedValue({ id: "acc-1", workspaceId: "twk-1", code: "ACC" });
  prisma.projectStage.findFirst.mockImplementation(async (args: any) => args?.select?.milestone
    ? { milestone: { name: "M1", gateStatus: "open" } }
    : { id: "stage-1", projectId: "prj-1", accountId: "acc-1", ownerUserId: null, taskTypeLayer1: "DELIVERY", afterPnlClose: false });
  prisma.projectContractItem.findMany.mockResolvedValue(items);
  prisma.projectContractItem.findFirst.mockImplementation(async (args: any) => items.find((item) => item.id === args.where.id) ?? null);
  prisma.projectTask.findFirst.mockResolvedValue(taskRow);
  prisma.projectTask.create.mockImplementation(async ({ data }: any) => ({ ...taskRow, id: "task-new", ...data }));
  prisma.projectTask.update.mockImplementation(async ({ data }: any) => ({ ...taskRow, ...data }));
  return { prisma, service: new ProjectsService(prisma, {} as any) };
}
const audits = (prisma: any) => prisma.auditEvent.create.mock.calls.map((call: any[]) => call[0].data);
const newTask = { accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", title: "New" } as any;

describe("task line item on create (D-01, D-06)", () => {
  it("a project with exactly one line item assigns it and derives Layer 2 from its type", async () => {
    const { prisma, service } = setup([rootItem]);
    await service.createTask(newTask, member);
    expect(prisma.projectTask.create.mock.calls[0][0].data).toMatchObject({ contractItemId: "item-root", taskTypeLayer2: "INTERNAL_PROJECT" });
  });

  it("with several line items the root item is the default; another item needs PM (Admin)", async () => {
    const { prisma, service } = setup([rootItem, appendix]);
    await service.createTask(newTask, member);
    expect(prisma.projectTask.create.mock.calls[0][0].data.contractItemId).toBe("item-root");
    await expect(service.createTask({ ...newTask, contractItemId: "item-appendix" }, member)).rejects.toBeInstanceOf(ForbiddenException);
    await service.createTask({ ...newTask, contractItemId: "item-appendix" }, pm);
    expect(prisma.projectTask.create.mock.calls[1][0].data).toMatchObject({ contractItemId: "item-appendix", taskTypeLayer2: "CUSTOMER_PROJECT" });
  });

  it("a project without any line item leaves the task in Chưa có hạng mục (D-07)", async () => {
    const { prisma, service } = setup([]);
    await service.createTask(newTask, member);
    expect(prisma.projectTask.create.mock.calls[0][0].data.contractItemId).toBeUndefined();
  });
});

describe("moving a task between line items (D-05, D-06)", () => {
  it("is refused for a non-PM and needs a reason from the PM", async () => {
    const { service } = setup([rootItem, appendix]);
    await expect(service.updateTask("task-1", { contractItemId: "item-appendix", contractItemChangeReason: "x" } as any, member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateTask("task-1", { contractItemId: "item-appendix" } as any, pm)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("takes sub-tasks and time entries of unlocked months along, leaves locked months alone, and is audited with the reason", async () => {
    const { prisma, service } = setup([rootItem, appendix]);
    prisma.projectTask.findMany.mockImplementation(async (args: any) => (args.where.parentTaskId?.in?.includes("task-1") ? [{ id: "sub-1" }] : []));
    prisma.pnlPeriod.findMany.mockResolvedValue([{ periodKey: "2026-09" }]);
    prisma.taskTimeEntry.updateMany.mockResolvedValue({ count: 3 });

    await service.updateTask("task-1", { contractItemId: "item-appendix", contractItemChangeReason: "Việc thuộc phụ lục" } as any, pm);

    expect(prisma.projectTask.update.mock.calls[0][0].data).toMatchObject({ contractItemId: "item-appendix", taskTypeLayer2: "CUSTOMER_PROJECT" });
    expect(prisma.projectTask.updateMany).toHaveBeenCalledWith({ where: { workspaceId: "twk-1", id: { in: ["sub-1"] } }, data: { contractItemId: "item-appendix" } });
    const entryUpdate = prisma.taskTimeEntry.updateMany.mock.calls.find((call: any[]) => "contractItemId" in call[0].data)![0];
    expect(entryUpdate.where.taskId).toEqual({ in: ["task-1", "sub-1"] });
    expect(entryUpdate.where.NOT).toHaveLength(1);
    expect(entryUpdate.where.NOT[0].workDate.lt.getTime()).toBeGreaterThan(entryUpdate.where.NOT[0].workDate.gte.getTime());
    expect(audits(prisma).find((row: any) => row.action === "task.contract_item_changed")).toMatchObject({
      actorUserId: "pm-1", before: { contractItemId: "item-root" },
      after: { contractItemId: "item-appendix", reason: "Việc thuộc phụ lục", subtaskCount: 1, timeEntryCount: 3 }
    });
  });

  it("a sub-task always repeats its parent's line item", async () => {
    const { prisma, service } = setup([rootItem, appendix], { ...task, id: "sub-1", parentTaskId: "task-1", contractItemId: "item-root" });
    prisma.projectTask.findFirst.mockImplementation(async (args: any) => args?.select?.contractItem
      ? { contractItemId: "item-appendix", contractItem: { contractType: "FIXED_PRICE" } }
      : { ...task, id: "sub-1", parentTaskId: "task-1", contractItemId: "item-root" });
    await service.updateTask("sub-1", { contractItemId: "item-root", title: "Sub" } as any, pm);
    expect(prisma.projectTask.update.mock.calls[0][0].data.contractItemId).toBe("item-appendix");
  });
});

describe("line item CRUD (D-22, D-23, history)", () => {
  it("only PM (Admin) or the project manager creates a line item, and it is audited", async () => {
    const { prisma, service } = setup([]);
    await expect(service.createProjectContractItem("prj-1", { name: "HĐ gốc" }, member)).rejects.toBeInstanceOf(ForbiddenException);
    await service.createProjectContractItem("prj-1", { name: "HĐ gốc", contractType: "FIXED_PRICE", valueAmount: 100 }, pm);
    expect(prisma.projectContractItem.create.mock.calls[0][0].data).toMatchObject({ code: "HM-01", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 100 });
    expect(audits(prisma).map((row: any) => row.action)).toContain("contract_item.created");
  });

  it("rejects a type outside the catalogue and a change-request item whose request is not approved", async () => {
    const { service } = setup([rootItem]);
    await expect(service.createProjectContractItem("prj-1", { name: "x", contractType: "RETAINER" }, pm)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createProjectContractItem("prj-1", { name: "CR", kind: "CHANGE_REQUEST", changeRequestId: "risk-1" }, pm)).rejects.toBeInstanceOf(ConflictException);
  });

  it("the root item adopts the tasks that had no line item yet (D-07)", async () => {
    const { prisma, service } = setup([]);
    prisma.projectTask.findMany.mockResolvedValueOnce([{ id: "task-1" }, { id: "task-2" }]).mockResolvedValue([]);
    prisma.projectTask.updateMany.mockResolvedValue({ count: 2 });
    await service.createProjectContractItem("prj-1", { name: "HĐ gốc" }, pm);
    expect(prisma.projectTask.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["task-1", "task-2"] } }, data: { contractItemId: "projectContractItem-1" } });
    expect(audits(prisma).find((row: any) => row.action === "contract_item.created").after.adoptedTaskCount).toBe(2);
  });

  it("locks type and base value once hours are logged, and re-derives Layer 2 when the type is first set", async () => {
    const { prisma, service } = setup([{ ...appendix, valueAmount: 100 }, { ...rootItem, contractType: null }]);
    prisma.taskTimeEntry.groupBy.mockResolvedValue([{ contractItemId: "item-appendix" }, { contractItemId: "item-root" }]);
    await expect(service.updateProjectContractItem("prj-1", "item-appendix", { contractType: "INTERNAL" }, pm)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateProjectContractItem("prj-1", "item-appendix", { valueAmount: 5 }, pm)).rejects.toBeInstanceOf(ConflictException);

    prisma.projectContractItem.update.mockImplementation(async ({ data }: any) => ({ ...rootItem, contractType: null, ...data }));
    prisma.projectTask.findMany.mockResolvedValue([{ id: "task-1", taskTypeLayer2: "CUSTOMER_PROJECT", stage: { afterPnlClose: false }, contractItem: { contractType: "INTERNAL" } }]);
    await service.updateProjectContractItem("prj-1", "item-root", { contractType: "INTERNAL" }, pm);
    expect(prisma.projectTask.updateMany).toHaveBeenCalledWith({ where: { workspaceId: "twk-1", id: { in: ["task-1"] } }, data: { taskTypeLayer2: "INTERNAL_PROJECT" } });
    expect(audits(prisma).map((row: any) => row.action)).toEqual(expect.arrayContaining(["contract_item.updated", "project.tasks_reclassified"]));
  });

  it("a referenced line item cannot be deleted, an unused one can", async () => {
    const { prisma, service } = setup([rootItem]);
    prisma.projectTask.count.mockResolvedValueOnce(1);
    await expect(service.deleteProjectContractItem("prj-1", "item-root", pm)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.deleteProjectContractItem("prj-1", "item-root", pm)).resolves.toEqual({ deleted: true });
    expect(audits(prisma).map((row: any) => row.action)).toContain("contract_item.deleted");
  });
});

describe("project kind and lost-deal Pre-sale", () => {
  it("changing the project kind re-derives Layer 2 of its tasks", async () => {
    const { prisma, service } = setup([rootItem]);
    prisma.projectStage.findFirst.mockResolvedValue({ ownerUserId: "pm-1" });
    const projectRow = await prisma.project.findFirst();
    prisma.project.findFirst.mockImplementation(async (args: any) => (args?.where?.projectType ? null
      : prisma.project.update.mock.calls.length > 0 ? { ...projectRow, projectType: "internal_worklog" } : projectRow));
    prisma.project.findFirstOrThrow.mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress", projectType: "internal_worklog" });
    prisma.projectTask.findMany.mockResolvedValue([{ id: "task-1", taskTypeLayer2: "CUSTOMER_PROJECT", stage: { afterPnlClose: false }, contractItem: null }]);
    const result = await service.updateProject("prj-1", { projectType: "internal_worklog" } as any, pm);
    expect(prisma.projectTask.updateMany).toHaveBeenCalledWith({ where: { workspaceId: "twk-1", id: { in: ["task-1"] } }, data: { taskTypeLayer2: "INTERNAL_PROJECT" } });
    expect(result.isInternalWorklog).toBe(true);
  });

  it("the internal worklog project takes no line items", async () => {
    const { prisma, service } = setup([]);
    prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", projectType: "internal_worklog" });
    await expect(service.createProjectContractItem("prj-1", { name: "x" }, pm)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns Pre-sale minutes of lost deals per month, labelled Chi phí Pre-sale, to admins and cost viewers only", async () => {
    const { prisma, service } = setup();
    await expect(service.lostDealPreSaleSummary(member)).rejects.toBeInstanceOf(ForbiddenException);
    prisma.project.findMany.mockResolvedValue([
      { id: "lost", code: "L", name: "Lost", status: "closed", statusHistory: [{ toStatus: "closed", closeReasonCode: "lost_deal", changedAt: new Date("2026-09-20") }] },
      { id: "reclosed", code: "R", name: "Reclosed", status: "closed", statusHistory: [
        { toStatus: "closed", closeReasonCode: "lost_deal", changedAt: new Date("2026-08-01") }, { toStatus: "closed", closeReasonCode: "internal_cancel", changedAt: new Date("2026-09-01") }] }
    ]);
    prisma.taskTimeEntry.findMany.mockResolvedValue([{ projectId: "lost", workDate: new Date("2026-09-02"), minutes: 120 }]);
    const summary = await service.lostDealPreSaleSummary({ ...member, roleCodes: ["WORKSPACE_ADMIN"] });
    expect(prisma.taskTimeEntry.findMany.mock.calls[0][0].where).toMatchObject({ projectId: { in: ["lost"] }, taskTypeLayer1: "PRE_SALE" });
    expect(summary).toMatchObject({ label: "Chi phí Pre-sale", level: "company", totalMinutes: 120, months: [{ month: "2026-09", minutes: 120 }] });
  });
});

describe("contract item values by account type (P&L spec 6.1 Quyền, PL-26)", () => {
  const priced = { ...appendix, projectId: "prj-1", valueAmount: 60_000_000 };

  it("a User account gets the items without their value; Admin accounts and the cost permission group get it", async () => {
    const forUser = await setup([priced]).service.listProjectContractItems("prj-1", member);
    expect(forUser.data[0]).toMatchObject({ code: "HM-02", contractType: "FIXED_PRICE" });
    expect(forUser.data[0].valueAmount).toBeUndefined();
    expect(forUser.meta.canViewValues).toBe(false);

    for (const principal of [pm, { ...member, roleCodes: ["WORKSPACE_USER", "COST_VIEW"] }]) {
      const response = await setup([priced]).service.listProjectContractItems("prj-1", principal);
      expect(response.data[0].valueAmount).toBe(60_000_000);
      expect(response.meta.canViewValues).toBe(true);
    }
  });
});
