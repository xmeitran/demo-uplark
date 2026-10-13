import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ProjectsService } from "./projects.service";
import { projectsServiceHooks } from "./framework-conversion.service";

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
const task = {
  id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", parentTaskId: null, title: "Task", status: "todo",
  ownerUserId: null, assigneeUserId: null, taskAssignees: [], estimateMinutes: 60, planApprovalStatus: "DRAFT",
  taskTypeLayer1: "DELIVERY", taskTypeLayer2: null, createdAt: new Date(), updatedAt: new Date()
};

function setup(taskRow: Record<string, unknown> = task) {
  const prisma = mockPrisma();
  prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress", projectType: "delivery" });
  prisma.account.findFirst.mockResolvedValue({ id: "acc-1", workspaceId: "twk-1", code: "ACC" });
  prisma.projectStage.findFirst.mockImplementation(async (args: any) => args?.select?.milestone
    ? { milestone: { name: "M1", gateStatus: "open" } }
    : { id: "stage-1", projectId: "prj-1", accountId: "acc-1", ownerUserId: null, taskTypeLayer1: "DELIVERY", afterPnlClose: false });
  prisma.projectTask.findFirst.mockResolvedValue(taskRow);
  prisma.projectTask.create.mockImplementation(async ({ data }: any) => ({ ...taskRow, id: "task-new", ...data }));
  prisma.projectTask.update.mockImplementation(async ({ data }: any) => ({ ...taskRow, ...data }));
  return { prisma, service: new ProjectsService(prisma, {} as any) };
}
const audits = (prisma: any) => prisma.auditEvent.create.mock.calls.map((call: any[]) => call[0].data);

describe("project kind and lost-deal Pre-sale", () => {
  it("changing the project kind re-derives Layer 2 of its tasks", async () => {
    const { prisma, service } = setup();
    prisma.projectStage.findFirst.mockResolvedValue({ ownerUserId: "pm-1" });
    const projectRow = await prisma.project.findFirst();
    prisma.project.findFirst.mockImplementation(async (args: any) => (args?.where?.projectType ? null
      : prisma.project.update.mock.calls.length > 0 ? { ...projectRow, projectType: "internal_worklog" } : projectRow));
    prisma.project.findFirstOrThrow.mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress", projectType: "internal_worklog" });
    prisma.projectTask.findMany.mockResolvedValue([{ id: "task-1", taskTypeLayer2: "CUSTOMER_PROJECT", stage: { afterPnlClose: false }}]);
    const result = await service.updateProject("prj-1", { projectType: "internal_worklog" } as any, pm);
    expect(prisma.projectTask.updateMany).toHaveBeenCalledWith({ where: { workspaceId: "twk-1", id: { in: ["task-1"] } }, data: { taskTypeLayer2: "INTERNAL_PROJECT" } });
    expect(result.isInternalWorklog).toBe(true);
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

  it("keeps the two helpers the conversion hooks call by name on ProjectsService", async () => {
    const { service } = setup();
    expect(typeof (service as any).rederiveProjectTaskLayer2).toBe("function");
    expect(typeof (service as any).reclassifyTaskTimeEntries).toBe("function");
    const hooks = projectsServiceHooks(service, { workspaceId: "twk-1", subjectType: "system", roleCodes: [] });
    await expect(hooks.rederiveLayer2!({ projectTask: { findMany: async () => [] }, project: { findFirst: async () => ({ id: "prj-1", projectType: "delivery" }) } } as any, "prj-1")).resolves.toBeDefined();
  });
});
