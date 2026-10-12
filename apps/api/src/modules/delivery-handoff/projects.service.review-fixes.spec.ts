/** One spec per fix of the 2026-10-12 code review that lives in ProjectsService and its helpers. Each fails without its fix. */
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { expandRoleCodes, type PrincipalContext } from "@b2b-crm/contracts";
import { LarkIntegrationController } from "../lark-integration/lark-integration.controller";
import { captureBaseline } from "./baseline.service";
import { lockedContractItemFields } from "./contract-item";
import { fakePrisma } from "./fake-prisma.testing";
import { syncProjectStatus } from "./gates.service";
import { issueLogHooks, runHooks } from "./issue-log.service";
import { ProjectVisibilityGuard, firstStageOf, projectPmUserId, visibleProjectWhere } from "./project-visibility";
import { ProjectsService } from "./projects.service";

/** Every model method exists and answers "nothing found"; a test overrides only what its rule depends on. */
function mockPrisma() {
  const defaults: Record<string, () => unknown> = {
    findFirst: () => null, findMany: () => [], count: () => 0, groupBy: () => [], aggregate: () => ({ _sum: { minutes: 0, overtimeMinutes: 0 } }),
    updateMany: () => ({ count: 1 }), deleteMany: () => ({ count: 1 })
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

const as = (subjectId: string, held: string[], extra: Partial<PrincipalContext> = {}): PrincipalContext => ({
  subjectType: "internal_user", subjectId, displayName: subjectId, tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: expandRoleCodes(held), heldRoleCodes: held, accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g", ...extra
});
const founder = as("usr-1", ["FOUNDER_GM"]);
const dx = as("usr-dx", ["DX"]);
// 06/10/2026 09:00 in Vietnam.
const WORK_DATE = new Date("2026-10-06T02:00:00.000Z");

/** A running project with one task, the way projects.service.cost-period-lock.spec.ts sets it up. */
function setup() {
  const prisma = mockPrisma();
  prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", status: "active", projectType: "delivery" });
  prisma.projectTask.findFirst.mockResolvedValue({ id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", parentTaskId: null, title: "Task", status: "in_progress", estimateMinutes: 0, taskAssignees: [], archivedAt: null });
  prisma.projectStage.findFirst.mockImplementation(async (args: any) => (args?.select?.milestone ? { milestone: { name: "M1", gateStatus: "open" } } : { id: "stage-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", ownerUserId: null, taskTypeLayer1: null, afterPnlClose: null }));
  prisma.projectMember.findMany.mockImplementation(async (args: any) => (args?.where?.userId?.in ?? []).map((userId: string) => ({ userId })));
  prisma.user.findMany.mockImplementation(async (args: any) => (args?.where?.id?.in ?? []).map((id: string) => ({ id, displayName: id })));
  prisma.taskTimeEntry.create.mockImplementation(async ({ data }: any) => ({ id: "time-1", createdAt: new Date(), ...data }));
  const entry = { id: "time-1", userId: "usr-dx", taskId: "task-1", projectId: "prj-1", minutes: 120, workDate: WORK_DATE, approvalStatus: "submitted", billable: true, reviewedByUserId: null, updatedAt: WORK_DATE, taskTypeLayer1: "DELIVERY", selectedTaskTypeLayer2: "INTERNAL_PROJECT" };
  prisma.taskTimeEntry.findFirst.mockResolvedValue(entry);
  return { prisma, service: new ProjectsService(prisma) };
}

describe("1 · /tasks/* follows project visibility (7.7)", () => {
  const scope = (principal: PrincipalContext) => ({ AND: [{ OR: [{ projectId: null }, { project: visibleProjectWhere(principal) }] }] });

  it("a User lists and opens only tasks of projects they can see (or of no project); an Admin all, unless in user view", async () => {
    const prisma = mockPrisma();
    const service = new ProjectsService(prisma);
    await service.listTasks({}, dx);
    expect(prisma.projectTask.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "twk-1", archivedAt: null, ...scope(dx) });
    expect(prisma.projectTask.count.mock.calls[0][0].where).toEqual(prisma.projectTask.findMany.mock.calls[0][0].where);
    // GET/PATCH/DELETE /tasks/:id, transitions, comments, attachments, history all go through the same lookup.
    await expect(service.getTask("task-other", dx)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.projectTask.findFirst.mock.calls.at(-1)[0].where).toEqual({ id: "task-other", workspaceId: "twk-1", ...scope(dx) });
    await expect(service.listTaskComments("task-other", {}, dx)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.projectTask.findFirst.mock.calls.at(-1)[0].where).toMatchObject(scope(dx));

    await service.listTasks({}, as("usr-pm", ["PM"]));
    expect(prisma.projectTask.findMany.mock.calls[1][0].where).toEqual({ workspaceId: "twk-1", archivedAt: null });
    const pmUserView = as("usr-pm", ["PM"], { viewMode: "user" });
    await service.listTasks({}, pmUserView);
    expect(prisma.projectTask.findMany.mock.calls[2][0].where).toMatchObject(scope(pmUserView));
  });

  it("time entries and planning blocks by id: the person's own rows, or rows of a task they may reach", async () => {
    const prisma = mockPrisma();
    const service = new ProjectsService(prisma);
    const own = { OR: [{ userId: "usr-dx" }, { task: scope(dx) }] };
    await expect(service.deleteTaskTimeEntry("time-9", dx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateTimeEntryLayer2("time-9", { selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }, dx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.confirmLegacyTimeEntryGroup("time-9", dx)).rejects.toBeInstanceOf(NotFoundException);
    for (const call of prisma.taskTimeEntry.findFirst.mock.calls) expect(call[0].where).toEqual({ id: "time-9", workspaceId: "twk-1", ...own });
    expect(prisma.taskTimeEntry.findFirst).toHaveBeenCalledTimes(3);
    await expect(service.deleteTaskPlanningBlock("block-9", dx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.transitionTaskPlanningBlock("block-9", { status: "cancelled", expectedUpdatedAt: WORK_DATE.toISOString() } as any, dx)).rejects.toBeInstanceOf(NotFoundException);
    for (const call of prisma.taskPlanningBlock.findFirst.mock.calls) expect(call[0].where).toEqual({ id: "block-9", workspaceId: "twk-1", ...own });
    // An Admin is not narrowed.
    await expect(service.deleteTaskPlanningBlock("block-9", founder)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taskPlanningBlock.findFirst.mock.calls.at(-1)[0].where).toEqual({ id: "block-9", workspaceId: "twk-1" });
  });

  it("the Lark project routes sit behind the project visibility guard", () => {
    expect(Reflect.getMetadata("__guards__", LarkIntegrationController)).toContain(ProjectVisibilityGuard);
  });
});

describe("3 · milestone configuration after approval (review finding not reproducible)", () => {
  it("an approved milestone's configuration cannot be edited at all, so it is never reopened and the next one never re-locked", async () => {
    const { prisma, service } = setup();
    prisma.projectGate.count.mockResolvedValue(8);
    prisma.projectMilestone.findFirst.mockResolvedValue({ id: "m1", projectId: "prj-1", sortOrder: 10, gateStatus: "approved", requiredDocumentTypes: ["BBNT"], requiredDocumentCount: 1, evidenceMode: "file_or_link", ownerTeamId: null, unlockCriteria: { text: "" }, customerConfirmationRequired: false, reviewerMode: "workspace_admin", reviewerUserId: null, reviewerRole: null });
    await expect(service.updateProjectMilestoneGate("prj-1", "m1", { requiredDocumentTypes: ["BBNT", "Biên bản kick-off"] }, as("usr-admin", ["WORKSPACE_ADMIN"]))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.projectMilestone.update).not.toHaveBeenCalled();
  });
});

describe("7 · back-logging and the daily cap", () => {
  const log = (minutes: number) => ({ workDate: WORK_DATE.toISOString(), startAt: WORK_DATE.toISOString(), endAt: new Date(WORK_DATE.getTime() + minutes * 60_000).toISOString(), minutes, selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }) as any;

  it("11 · the daily cap reads the workspace's stored 'Giờ chuẩn một ngày', not the import-time default", async () => {
    const { prisma, service } = setup();
    prisma.systemParameter.findMany.mockResolvedValue([{ key: "standardDayHours", value: 6, createdAt: new Date() }]);
    await expect(service.createTimeEntry("task-1", log(420), founder, "usr-1")).rejects.toThrow("Daily log cannot exceed 6 office hours");
    await expect(service.createTimeEntry("task-1", log(360), founder, "usr-1")).resolves.toMatchObject({ id: "time-1" });
  });

  it("LOW · a full day of approved personal leave has its own message", async () => {
    const { prisma, service } = setup();
    prisma.personalLeave.findMany.mockResolvedValue([{ startDate: new Date("2026-10-06T00:00:00.000Z"), endDate: new Date("2026-10-06T00:00:00.000Z"), startHalfDay: false, endHalfDay: false }]);
    await expect(service.createTimeEntry("task-1", log(60), founder, "usr-1")).rejects.toThrow("Ngày này đã có đơn nghỉ phép cả ngày được duyệt nên không ghi giờ hành chính được.");
  });
});

describe("8 · contract base values after the contract is signed (P&L spec 6.1)", () => {
  it("a signed contract locks type and value of every line item, even ones without hours or invoices", () => {
    const item = { contractType: "FIXED_PRICE", valueAmount: 100 };
    expect(lockedContractItemFields(item, { valueAmount: 200, contractType: "TIME_MATERIAL" }, { hasTimeEntries: false, hasIssuedInvoice: false })).toEqual([]);
    expect(lockedContractItemFields(item, { valueAmount: 200, contractType: "TIME_MATERIAL" }, { hasTimeEntries: false, hasIssuedInvoice: false, contractSigned: true })).toEqual(["loại hợp đồng", "giá trị gốc"]);
    // Read-only as a whole: also a value that was never filled in. An unchanged value is not a change.
    expect(lockedContractItemFields({ contractType: "FIXED_PRICE", valueAmount: null }, { valueAmount: 200 }, { hasTimeEntries: false, hasIssuedInvoice: false, contractSigned: true })).toEqual(["giá trị gốc"]);
    expect(lockedContractItemFields(item, { valueAmount: 100 }, { hasTimeEntries: false, hasIssuedInvoice: false, contractSigned: true })).toEqual([]);
  });

  it("update and delete read ProjectPnlRecord.contractStatus and answer in Vietnamese", async () => {
    const { prisma, service } = setup();
    prisma.projectContractItem.findFirst.mockResolvedValue({ id: "item-1", code: "HM-01", name: "Gốc", kind: "ROOT", status: "active", contractType: "FIXED_PRICE", valueAmount: 100, estimateMinutes: null, changeRequestId: null, sortOrder: 10, archivedAt: null });
    prisma.projectPnlRecord.findFirst.mockResolvedValue({ contractStatus: "signed" });
    await expect(service.updateProjectContractItem("prj-1", "item-1", { valueAmount: 200 }, founder)).rejects.toThrow("Hợp đồng đã ở trạng thái Đã ký nên giá trị gốc đã khóa. Muốn đổi phải qua yêu cầu thay đổi.");
    await expect(service.deleteProjectContractItem("prj-1", "item-1", founder)).rejects.toThrow(/Hợp đồng đã ở trạng thái Đã ký nên không xóa được hạng mục/);
    expect(prisma.projectContractItem.update).not.toHaveBeenCalled();
    expect(prisma.projectContractItem.delete).not.toHaveBeenCalled();
    // Nháp: the delete goes through.
    prisma.projectPnlRecord.findFirst.mockResolvedValue({ contractStatus: "draft" });
    await expect(service.deleteProjectContractItem("prj-1", "item-1", founder)).resolves.toEqual({ deleted: true });
  });
});

describe("9 · baseline drift (D-20, D-21)", () => {
  const lockedProject = async () => {
    const fake = fakePrisma({
      project: [{ id: "p1", workspaceId: "twk-1", accountId: "acc-1", status: "active", projectType: "delivery" }],
      projectStage: [{ id: "s1", workspaceId: "twk-1", projectId: "p1", milestoneId: "m1", activity: "Build", sortOrder: 10, ownerUserId: "usr-1" }],
      projectTask: [{ id: "t1", workspaceId: "twk-1", projectId: "p1", stageId: "s1", title: "Dựng base", estimateMinutes: 120, status: "todo", ownerUserId: "usr-1", assigneeUserId: null }],
      projectContractItem: [{ id: "i1", workspaceId: "twk-1", projectId: "p1", code: "HM-01", name: "Gốc", kind: "ROOT", sortOrder: 10, valueAmount: 100, contractType: "FIXED_PRICE", estimateMinutes: 600, createdAt: new Date() }]
    });
    await captureBaseline(fake.prisma, { workspaceId: "twk-1", projectId: "p1", cause: { type: "manual", reason: "Khóa" }, actor: { userId: "usr-1" } });
    const versions = () => fake.table("projectBaseline").map((row) => `${row.layer}v${row.version}:${row.causeType}`);
    return { ...fake, service: new ProjectsService(fake.prisma), versions };
  };

  it("archiving a top-level task writes the next B1 version", async () => {
    const { prisma, table, service, versions } = await lockedProject();
    const task = table("projectTask")[0];
    task.archivedAt = new Date();
    await (service as any).afterTaskArchived(prisma, founder, { ...task, status: "todo" }, task.archivedAt);
    expect(versions()).toEqual(["B0v1:manual", "B1v1:manual", "B1v2:plan_edit"]);
    expect(table("projectBaseline").at(-1)).toMatchObject({ reason: 'Lưu trữ task "Dựng base"', createdByUserId: "usr-1" });
  });

  it("adding and deleting a contract line item writes the next B0 version", async () => {
    const { prisma, table, service, versions } = await lockedProject();
    await service.createProjectContractItem("p1", { name: "Phụ lục 1", kind: "APPENDIX", valueAmount: 50, contractType: "FIXED_PRICE" }, founder);
    expect(versions()).toEqual(["B0v1:manual", "B1v1:manual", "B0v2:plan_edit"]);
    const appendix = table("projectContractItem").find((item) => item.name === "Phụ lục 1")!;
    // The fake has no delete: give it one that removes the row, as Prisma would.
    prisma.projectContractItem.delete = async ({ where }: any) => table("projectContractItem").splice(table("projectContractItem").findIndex((item) => item.id === where.id), 1)[0];
    prisma.invoice.count = async () => 0;
    await service.deleteProjectContractItem("p1", appendix.id, founder);
    expect(versions().at(-1)).toBe("B0v3:plan_edit");
  });

  it("Kế toán (User-type FINANCE_ADMIN) is not a plan approver: a task that adds planned hours after B1 is refused", async () => {
    const { prisma, service } = setup();
    prisma.account.findFirst.mockResolvedValue({ id: "acc-1" });
    prisma.projectBaseline.findFirst.mockResolvedValue({ id: "b1" });
    const input = { projectId: "prj-1", stageId: "stage-1", accountId: "acc-1", title: "Thêm việc", estimateMinutes: 60 } as any;
    await expect(service.createTask(input, as("usr-kt", ["FINANCE_ADMIN"]))).rejects.toThrow(/Baseline B1 đã khóa/);
    expect(prisma.projectTask.create).not.toHaveBeenCalled();
  });

  it("a member's task without planned hours (V-03) is saved after B1 but writes no B1 version; an Admin's does", async () => {
    const run = async (principal: PrincipalContext) => {
      const { prisma, service } = setup();
      prisma.account.findFirst.mockResolvedValue({ id: "acc-1" });
      prisma.projectBaseline.findFirst.mockResolvedValue({ id: "b1", layer: "B1", version: 1, snapshot: { milestones: [], stages: [], tasks: [] } });
      prisma.projectTask.findMany.mockResolvedValue([{ id: "task-9", stageId: "stage-1", title: "Việc phát sinh", plannedStartAt: null, dueAt: null, estimateMinutes: 0, contractItemId: null, parentTaskId: null }]);
      prisma.projectTask.create.mockImplementation(async ({ data }: any) => ({ id: "task-9", taskAssignees: [], ...data }));
      prisma.projectTask.findUnique.mockResolvedValue(null); // the created row is the result
      await service.createTask({ projectId: "prj-1", stageId: "stage-1", accountId: "acc-1", title: "Việc phát sinh" } as any, principal);
      return { created: prisma.projectTask.create.mock.calls.length, versions: prisma.projectBaseline.create.mock.calls.map((call: any) => `${call[0].data.layer}v${call[0].data.version}:${call[0].data.causeType}`) };
    };
    expect(await run(dx)).toEqual({ created: 1, versions: [] });
    expect(await run(as("usr-pm", ["PM"]))).toEqual({ created: 1, versions: ["B1v2:plan_edit"] });
  });
});

describe("10 · project status", () => {
  it("Đã hoàn thành / Đang bảo trì are the system's on a G1–G8 project: not set by hand, and not left by hand for a status the sync would undo", async () => {
    const { prisma, service } = setup();
    prisma.projectGate.count.mockResolvedValue(8);
    for (const status of ["completed", "maintenance"]) {
      await expect(service.updateProject("prj-1", { status } as any, founder)).rejects.toThrow(/do hệ thống tự chuyển khi G7 \/ G8 được duyệt/);
    }
    prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", status: "completed", projectType: "delivery" });
    await expect(service.updateProject("prj-1", { status: "active" } as any, founder)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectStatusHistory.create).not.toHaveBeenCalled();
    // Có rủi ro stays a person's call; and a project on a hand-built framework is completed by hand as before.
    await service.updateProject("prj-1", { status: "at_risk", statusReason: "Khách báo lỗi" } as any, founder).catch(() => undefined);
    expect(prisma.project.update).toHaveBeenCalledTimes(1);
    prisma.projectGate.count.mockResolvedValue(0);
    prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", status: "active", projectType: "delivery" });
    await service.updateProject("prj-1", { status: "completed" } as any, founder).catch(() => undefined);
    expect(prisma.project.update).toHaveBeenCalledTimes(2);
  });

  it("Layer 2 of a time entry after G7 (P&L closed): only an Admin, with a reason, which is audited", async () => {
    const { prisma, service } = setup();
    prisma.projectGate.findFirst.mockResolvedValue({ status: "approved" });
    const change = (principal: PrincipalContext, reason?: string) => service.updateTimeEntryLayer2("time-1", { selectedTaskTypeLayer2: "CUSTOMER_PROJECT", reason }, principal);
    await expect(change(dx)).rejects.toThrow(/Dự án đã qua G7/);
    await expect(change(dx, "Chọn nhầm")).rejects.toBeInstanceOf(ConflictException);
    await expect(change(founder)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.taskTimeEntry.update).not.toHaveBeenCalled();
    await change(founder, "Chọn nhầm khi ghi giờ").catch(() => undefined);
    expect(prisma.taskTimeEntry.update).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create.mock.calls.find((call: any) => call[0].data.action === "task.time_entry_layer2_changed")[0].data.after).toMatchObject({ afterPnlClose: true, reason: "Chọn nhầm khi ghi giờ" });
    // Before G7 the person who logged corrects it freely.
    prisma.projectGate.findFirst.mockResolvedValue({ status: "awaiting_customer" });
    await change(dx).catch(() => undefined);
    expect(prisma.taskTimeEntry.update).toHaveBeenCalledTimes(2);
  });

  it("deleting a time entry recomputes the status proposal, like logging one", async () => {
    const { service } = setup();
    const recompute = vi.spyOn(service, "recomputeStatusProposal").mockResolvedValue(undefined);
    await service.deleteTaskTimeEntry("time-1", founder);
    expect(recompute).toHaveBeenCalledWith("prj-1", founder);
  });

  const statusCtx = (prisma: any) => ({ prisma, workspaceId: "w", actorUserId: null, recordStatusChange: vi.fn(), now: new Date("2026-10-14T03:00:00.000Z") });

  it("one writer per project: the sync takes the project's advisory lock before it reads the pending proposal", async () => {
    const { prisma } = fakePrisma({ project: [{ id: "p1", workspaceId: "w", status: "active" }] });
    const order: string[] = [];
    prisma.$queryRaw = vi.fn(async (_strings: unknown, value: string) => { order.push(`lock:${value}`); return []; });
    const findFirst = prisma.projectStatusProposal.findFirst;
    prisma.projectStatusProposal.findFirst = async (args: any) => { order.push("read-proposal"); return findFirst(args); };
    await syncProjectStatus(statusCtx(prisma), prisma, "p1");
    expect(order[0]).toBe("lock:project-status:p1");
    expect(order).toContain("read-proposal");
  });

  it("a confirmed 'Chờ khách xác nhận' hold ends with the wait even when the PM retyped the reason", async () => {
    const changedAt = new Date("2026-10-13T03:00:05.000Z");
    const seed = (proposalBasis: string) => fakePrisma({
      project: [{ id: "p1", workspaceId: "w", status: "on_hold" }],
      projectGate: ["G1", "G2", "G3", "G4"].map((code) => ({ id: code, workspaceId: "w", projectId: "p1", code, status: "approved", stageId: `s-${code}` })),
      projectStatusHistory: [{ id: "h1", projectId: "p1", toStatus: "on_hold", reason: "Đợi chị Lan bên khách ký", changedAt }],
      projectStatusProposal: [{ id: "sp1", workspaceId: "w", projectId: "p1", status: "confirmed", proposedStatus: "on_hold", basis: proposalBasis, createdAt: new Date("2026-10-13T02:00:00.000Z"), decidedAt: new Date("2026-10-13T03:00:04.000Z") }]
    });
    const fromWait = seed("Chờ khách xác nhận tại G4");
    await syncProjectStatus(statusCtx(fromWait.prisma), fromWait.prisma, "p1");
    expect(fromWait.table("projectStatusProposal").filter((row) => row.id !== "sp1")).toMatchObject([{ proposedStatus: "active", fromStatus: "on_hold" }]);
    // A pause both sides agreed on still ends only when a person says so.
    const agreed = seed("Hai bên thống nhất tạm dừng");
    await syncProjectStatus(statusCtx(agreed.prisma), agreed.prisma, "p1");
    expect(agreed.table("projectStatusProposal").filter((row) => row.id !== "sp1")).toEqual([]);
  });
});

describe("11 · change-request side effects", () => {
  it("a failing hook is written to the record's history and returned with the record, instead of only to the console", async () => {
    const { prisma, table } = fakePrisma();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    issueLogHooks.failsForTheSpec = async () => { throw new Error("Không tạo được stage Change Request"); };
    const record = { id: "risk-1", events: [] as any[] };
    try {
      await runHooks(["failsForTheSpec"], { ctx: { prisma, principal: founder, actor: { userId: "usr-1", isAdmin: true, isPm: true, isBd: false, isMember: true } }, record, project: { id: "p1" } });
    } finally {
      delete issueLogHooks.failsForTheSpec;
      error.mockRestore();
    }
    expect(table("projectRiskEvent")).toMatchObject([{ riskId: "risk-1", action: "side_effect_failed", note: "failsForTheSpec: Không tạo được stage Change Request", actorUserId: "usr-1" }]);
    expect(table("auditEvent")).toMatchObject([{ action: "issue_log.side_effect_failed", resourceId: "risk-1" }]);
    expect(record.events).toMatchObject([{ action: "side_effect_failed", changes: { label: "Bước tự động chưa hoàn tất" } }]);
  });
});

describe("12 · PM of a project: one rule", () => {
  it("is the owner of the first stage by stage order, then creation time — whatever the milestone order", async () => {
    const stages = [
      { id: "late", sortOrder: 20, createdAt: new Date("2026-01-01"), ownerUserId: "u-late", milestone: { sortOrder: 1 } },
      { id: "first", sortOrder: 10, createdAt: new Date("2026-02-01"), ownerUserId: "u-pm", milestone: { sortOrder: 9 } },
      { id: "twin", sortOrder: 10, createdAt: new Date("2026-03-01"), ownerUserId: "u-twin", milestone: { sortOrder: 1 } }
    ];
    expect(firstStageOf(stages)?.ownerUserId).toBe("u-pm");
    const findFirst = vi.fn().mockResolvedValue({ ownerUserId: "u-pm" });
    await expect(projectPmUserId({ projectStage: { findFirst } }, "w", "p1")).resolves.toBe("u-pm");
    expect(findFirst).toHaveBeenCalledWith({ where: { workspaceId: "w", projectId: "p1" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { ownerUserId: true } });
  });
});
