import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ResourceControlsService } from "../resource-controls/resource-controls.service";
import { ProjectsService } from "./projects.service";

/** Every model method exists and answers "nothing found"; a test overrides only what its rule depends on. */
function mockPrisma() {
  const defaults: Record<string, () => unknown> = {
    findFirst: () => null, findMany: () => [], count: () => 0, aggregate: () => ({ _sum: { minutes: 0, overtimeMinutes: 0 } }),
    updateMany: () => ({ count: 1 }), deleteMany: () => ({ count: 0 })
  };
  const models: Record<string, any> = {};
  const root: Record<string, any> = { $queryRaw: vi.fn().mockResolvedValue([{ id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", hierarchyOrderVersion: 0, status: "in_progress", startedAt: new Date() }]) };
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

const admin: PrincipalContext = {
  subjectType: "internal_user", subjectId: "usr-1", displayName: "Admin", tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: ["FOUNDER_GM", "WORKSPACE_ADMIN"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g"
};
const member: PrincipalContext = { ...admin, subjectId: "usr-2", roleCodes: ["WORKSPACE_USER"] };
// 06/10/2026 09:00–11:00 in Vietnam: cost period 2026-10.
const WORK_DATE = new Date("2026-10-06T02:00:00.000Z");
const log = { workDate: WORK_DATE.toISOString(), startAt: WORK_DATE.toISOString(), endAt: "2026-10-06T04:00:00.000Z", minutes: 120, selectedTaskTypeLayer2: "CUSTOMER_PROJECT" } as any;
const LOCKED_MESSAGE = "Kỳ chi phí 2026-10 đã chốt nên không thể thêm, sửa, chuyển hoặc xóa giờ log của kỳ này. Admin mở lại kỳ tại Admin › Thiết lập P&L trước khi thao tác.";

/** The real lock reader (ResourceControlsService.assertPeriodOpen) over the same mocked database. */
function setup(lockedPeriods: string[] = []) {
  const prisma = mockPrisma();
  prisma.pnlPeriod.findFirst.mockImplementation(async (args: any) => (args.where.status === "LOCKED" && args.where.projectId === null && lockedPeriods.includes(args.where.periodKey) ? { id: "period-1" } : null));
  prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", status: "in_progress", projectType: "delivery" });
  prisma.projectTask.findFirst.mockResolvedValue({ id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", parentTaskId: null, title: "Task", status: "in_progress", estimateMinutes: 0, taskAssignees: [], archivedAt: null });
  prisma.projectStage.findFirst.mockImplementation(async (args: any) => (args?.select?.milestone ? { milestone: { name: "M1", gateStatus: "open" } } : { id: "stage-1", ownerUserId: null, taskTypeLayer1: null, afterPnlClose: null }));
  prisma.projectMember.findMany.mockImplementation(async (args: any) => (args?.where?.userId?.in ?? []).map((userId: string) => ({ userId })));
  prisma.user.findMany.mockImplementation(async (args: any) => (args?.where?.id?.in ?? []).map((id: string) => ({ id, displayName: id })));
  prisma.taskTimeEntry.create.mockImplementation(async ({ data }: any) => ({ id: "time-1", createdAt: new Date(), ...data }));
  const entry = { id: "time-1", userId: "usr-1", taskId: "task-1", projectId: "prj-1", minutes: 120, workDate: WORK_DATE, approvalStatus: "submitted", billable: true, reviewedByUserId: null, updatedAt: WORK_DATE, legacyPendingReason: "legacy_group_in_project" };
  prisma.taskTimeEntry.findFirst.mockResolvedValue(entry);
  prisma.taskTimeEntry.findFirstOrThrow.mockResolvedValue(entry);
  return { prisma, service: new ProjectsService(prisma, undefined, new ResourceControlsService(prisma)) };
}

describe("D-28: time entries of a locked cost period", () => {
  it("SAVES a new time entry dated in a locked period and tells the UI it waits at 'Tháng đã khóa' (P&L spec A-1a, Appendix B case 6)", async () => {
    const { prisma, service } = setup(["2026-10"]);
    await expect(service.createTimeEntry("task-1", log, member, "usr-2")).resolves.toMatchObject({ id: "time-1", savedInLockedPeriod: true });
    expect(prisma.taskTimeEntry.create).toHaveBeenCalledTimes(1);
  });

  it("an entry of an open period carries no locked-period flag", async () => {
    const { prisma, service } = setup(["2026-09"]);
    expect(await service.createTimeEntry("task-1", log, admin, "usr-1")).not.toHaveProperty("savedInLockedPeriod");
    expect(prisma.taskTimeEntry.create).toHaveBeenCalledTimes(1);
  });

  it("refuses deleting a time entry of a locked period, even for an Admin", async () => {
    const { prisma, service } = setup(["2026-10"]);
    await expect(service.deleteTaskTimeEntry("time-1", admin)).rejects.toThrow(LOCKED_MESSAGE);
    expect(prisma.taskTimeEntry.delete).not.toHaveBeenCalled();

    const open = setup();
    await expect(open.service.deleteTaskTimeEntry("time-1", admin)).resolves.toEqual({ deleted: true, id: "time-1" });
  });

  it("refuses changing a time entry of a locked period (review)", async () => {
    const { prisma, service } = setup(["2026-10"]);
    await expect(service.reviewTaskTimeEntry("time-1", { status: "rejected", reason: "sai", expectedUpdatedAt: WORK_DATE.toISOString() } as any, admin)).rejects.toThrow(LOCKED_MESSAGE);
    expect(prisma.taskTimeEntry.updateMany).not.toHaveBeenCalled();
  });

  it("refuses deleting tasks whose hours fall in a locked period", async () => {
    const { prisma, service } = setup(["2026-10"]);
    prisma.taskTimeEntry.findMany.mockResolvedValue([{ id: "time-0", workDate: new Date("2026-09-10T02:00:00.000Z") }, { id: "time-1", workDate: WORK_DATE }]);
    await expect((service as any).deleteTaskSubtree(prisma, ["task-1"], "twk-1")).rejects.toThrow(LOCKED_MESSAGE);
    expect(prisma.taskTimeEntry.deleteMany).not.toHaveBeenCalled();
    expect(prisma.projectTask.deleteMany).not.toHaveBeenCalled();
  });
});

describe("9.2: what the PM resolves from the Chờ xử lý worklist", () => {
  it("confirms an old Họp/Khác hour stays in the project, audited; not in a locked period, not by a plain member", async () => {
    const { prisma, service } = setup();
    await expect(service.confirmLegacyTimeEntryGroup("time-1", admin)).resolves.toEqual({ id: "time-1", legacyPendingReason: null });
    expect(prisma.taskTimeEntry.update).toHaveBeenCalledWith({ where: { id: "time-1" }, data: { legacyPendingReason: null } });
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: "task.time_entry_legacy_group_confirmed", resourceId: "time-1" });

    await expect(setup(["2026-10"]).service.confirmLegacyTimeEntryGroup("time-1", admin)).rejects.toThrow(LOCKED_MESSAGE);
    await expect(setup().service.confirmLegacyTimeEntryGroup("time-1", member)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("gives a stage its Layer 1 and side of the closing point; only tasks without a Layer 1 take it", async () => {
    const { prisma, service } = setup();
    prisma.projectTask.findMany.mockImplementation(async (args: any) => (args?.where?.stageId === "stage-1" ? [{ id: "task-1", taskTypeLayer2: null }] : []));
    await expect(service.classifyStage("prj-1", "stage-1", { taskTypeLayer1: "DELIVERY", afterPnlClose: false }, admin)).resolves.toEqual({ stageId: "stage-1", taskTypeLayer1: "DELIVERY", afterPnlClose: false, taskCount: 1 });
    expect(prisma.projectStage.update).toHaveBeenCalledWith({ where: { id: "stage-1" }, data: { taskTypeLayer1: "DELIVERY", afterPnlClose: false } });
    expect(prisma.projectTask.findMany.mock.calls[0][0].where).toMatchObject({ stageId: "stage-1", parentTaskId: null, taskTypeLayer1: null });
    expect(prisma.projectTask.updateMany).toHaveBeenCalledWith({ where: { workspaceId: "twk-1", id: { in: ["task-1"] } }, data: { taskTypeLayer1: "DELIVERY" } });
    expect(prisma.auditEvent.create.mock.calls.map((call: any[]) => call[0].data.action)).toContain("project.stage_classified");
  });

  it("validates the classification and the caller", async () => {
    const { prisma, service } = setup();
    await expect(service.classifyStage("prj-1", "stage-1", { taskTypeLayer1: "OTHER", afterPnlClose: false }, admin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.classifyStage("prj-1", "stage-1", { taskTypeLayer1: "PM" }, admin)).rejects.toBeInstanceOf(BadRequestException);
    // Matrix 4.3: Pre-sale never sits after the closing point.
    await expect(service.classifyStage("prj-1", "stage-1", { taskTypeLayer1: "PRE_SALE", afterPnlClose: true }, admin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.classifyStage("prj-1", "stage-1", { taskTypeLayer1: "PM", afterPnlClose: true }, member)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.projectStage.update).not.toHaveBeenCalled();
  });
});
