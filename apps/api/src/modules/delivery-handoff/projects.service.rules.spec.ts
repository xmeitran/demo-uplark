import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ProjectsService } from "./projects.service";
import { MANUAL_CLOSE_ACTION, REARM_ACTION } from "./project-warnings";

/** Every model method exists and answers "nothing found"; a test overrides only what its rule depends on. */
function mockPrisma() {
  const defaults: Record<string, () => unknown> = {
    findFirst: () => null, findUnique: () => null, findMany: () => [], count: () => 0, groupBy: () => [],
    aggregate: () => ({ _sum: { minutes: 0, plannedMinutes: 0 } }),
    updateMany: () => ({ count: 0 }), deleteMany: () => ({ count: 0 }), createMany: () => ({ count: 0 })
  };
  const models: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const root: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "prj-1", hierarchyOrderVersion: 0, status: "in_progress", startedAt: new Date() }])
  };
  const prisma: any = new Proxy(root, {
    get(target, key: string) {
      if (key in target || typeof key !== "string" || key === "then") return target[key];
      models[key] ??= new Proxy({}, {
        get(methods: Record<string, any>, method: string) {
          methods[method] ??= vi.fn(async (args?: any) => (defaults[method] ? defaults[method]() : { id: `${key}-1`, ...(args?.data ?? {}) }));
          return methods[method];
        }
      }) as any;
      return models[key];
    }
  });
  root.$transaction = vi.fn(async (input: any) => (typeof input === "function" ? input(prisma) : Promise.all(input)));
  return prisma;
}

const base: PrincipalContext = {
  subjectType: "internal_user", subjectId: "usr-1", displayName: "Member", tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: ["WORKSPACE_USER"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g"
};
const as = (subjectId: string, ...roleCodes: string[]): PrincipalContext => ({ ...base, subjectId, roleCodes: roleCodes.length ? roleCodes : ["WORKSPACE_USER"] });
const portal: PrincipalContext = { ...base, subjectType: "portal_user", subjectId: "portal-1", roleCodes: [], customerAccountIds: ["acc-1"], customerProjectIds: ["prj-1"] };
const project = { id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress" };
const task = {
  id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", parentTaskId: null, title: "Task", status: "todo",
  ownerUserId: null, assigneeUserId: null, taskAssignees: [], archivedAt: null, cancelledAt: null, completedAt: null, startedAt: null,
  plannedStartAt: new Date("2026-10-05T02:00:00.000Z"), dueAt: new Date("2026-10-09T10:00:00.000Z"), estimateMinutes: 240, planApprovalStatus: "DRAFT",
  customerVisible: true, createdAt: new Date(), updatedAt: new Date()
};

function setup(overrides: { pic?: string | null; member?: boolean; task?: Record<string, unknown>; project?: Record<string, unknown> } = {}) {
  const prisma = mockPrisma();
  prisma.project.findFirst.mockResolvedValue({ ...project, ...overrides.project });
  prisma.account.findFirst.mockResolvedValue({ id: "acc-1", workspaceId: "twk-1", code: "ACC" });
  prisma.projectStage.findFirst.mockImplementation(async (args: any) => args?.select?.milestone
    ? { milestone: { name: "M1", gateStatus: "open" } }
    : { id: "stage-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", milestoneId: "ms-1", phase: "M1", activity: "Build", status: "in_progress", ownerUserId: overrides.pic ?? null });
  prisma.projectMember.findFirst.mockResolvedValue(overrides.member ? { userId: "member" } : null);
  prisma.projectMember.findMany.mockImplementation(async (args: any) => (args?.where?.userId?.in ?? []).map((userId: string) => ({ userId })));
  prisma.user.findMany.mockImplementation(async (args: any) => (args?.where?.id?.in ?? []).map((id: string) => ({ id, displayName: id })));
  const taskRow = { ...task, ...overrides.task };
  prisma.projectTask.findFirst.mockResolvedValue(taskRow);
  prisma.projectTask.update.mockImplementation(async ({ data }: any) => ({ ...taskRow, ...data }));
  prisma.projectTask.create.mockImplementation(async ({ data }: any) => ({ ...taskRow, id: "task-new", ...data }));
  const notifications = { resolveMilestoneNotifications: vi.fn(), createMilestoneApprovalRequest: vi.fn() };
  return { prisma, notifications, service: new ProjectsService(prisma, notifications as any) };
}

const auditActions = (prisma: any) => prisma.auditEvent.create.mock.calls.map((call: any[]) => call[0].data.action);

describe("portal users cannot write delivery data", () => {
  it.each([
    ["deleteProject", (s: ProjectsService) => s.deleteProject("prj-1", portal)],
    ["createTask", (s: ProjectsService) => s.createTask({ accountId: "acc-1", title: "x" } as any, portal)],
    ["transitionTask", (s: ProjectsService) => s.transitionTask("task-1", { status: "done", changedAt: "2020-01-01T00:00:00.000Z" } as any, portal)],
    ["deleteTask", (s: ProjectsService) => s.deleteTask("task-1", portal)],
    ["createProjectDocument", (s: ProjectsService) => s.createProjectDocument("prj-1", { name: "d", fileObjectId: "f" } as any, portal)],
    ["updateProjectDocument", (s: ProjectsService) => s.updateProjectDocument("prj-1", "doc-1", { name: "d" } as any, portal)],
    ["createProjectDocumentVersion", (s: ProjectsService) => s.createProjectDocumentVersion("prj-1", "doc-1", { fileObjectId: "f", expectedVersion: 1 } as any, portal)],
    ["deleteProjectDocument", (s: ProjectsService) => s.deleteProjectDocument("prj-1", "doc-1", portal)],
    ["createProjectActivity", (s: ProjectsService) => s.createProjectActivity("prj-1", { subject: "s" } as any, portal)],
    ["updateProjectActivity", (s: ProjectsService) => s.updateProjectActivity("prj-1", "act-1", { subject: "s" } as any, portal)],
    ["deleteProjectActivity", (s: ProjectsService) => s.deleteProjectActivity("prj-1", "act-1", portal)],
    ["createProjectRisk", (s: ProjectsService) => s.createProjectRisk("prj-1", { description: "r" } as any, portal)],
    ["updateProjectRisk", (s: ProjectsService) => s.updateProjectRisk("prj-1", "risk-1", { status: "closed" } as any, portal)],
    ["deleteProjectRisk", (s: ProjectsService) => s.deleteProjectRisk("prj-1", "risk-1", portal)]
  ] as const)("%s is rejected before any read or write", async (_name, call) => {
    const { prisma, service } = setup();
    await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectTask.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("destructive project changes", () => {
  it("deleteProject needs a project manager or workspace admin and is audited", async () => {
    const denied = setup({ member: true });
    await expect(denied.service.deleteProject("prj-1", as("usr-1"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied.prisma.project.delete).not.toHaveBeenCalled();

    for (const actor of [as("usr-admin", "WORKSPACE_ADMIN"), as("usr-founder", "FOUNDER_GM"), as("usr-pic")]) {
      const { prisma, service } = setup({ pic: "usr-pic" });
      await expect(service.deleteProject("prj-1", actor)).resolves.toEqual({ deleted: true, id: "prj-1" });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "project.deleted", actorUserId: actor.subjectId, before: { code: "PRJ", name: "Project", status: "in_progress", accountId: "acc-1" } }) });
    }
  });

  it("deleteStage needs a project manager, is audited, and closes the NL-03 warnings of what it deleted", async () => {
    const denied = setup({ member: true });
    await expect(denied.service.deleteStage("prj-1", "stage-1", as("usr-1"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied.prisma.projectStage.deleteMany).not.toHaveBeenCalled();
    expect(denied.prisma.projectTask.deleteMany).not.toHaveBeenCalled();

    const { prisma, service } = setup({ pic: "usr-pic" });
    prisma.projectTask.findMany.mockResolvedValueOnce([{ id: "task-1" }]).mockResolvedValue([]);
    prisma.projectWarning.findMany.mockImplementation(async (args: any) => (args.where.dedupeKey ? [{ id: "warn-1" }] : []));
    await expect(service.deleteStage("prj-1", "stage-1", as("usr-pic"))).resolves.toMatchObject({ deleted: true, deletedTaskIds: ["task-1"] });
    expect(prisma.projectWarning.findMany).toHaveBeenCalledWith({ where: { projectId: "prj-1", dedupeKey: { in: ["NL-03:stage:stage-1", "NL-03:task:task-1"] }, status: "open" }, select: { id: true } });
    expect(prisma.projectWarning.update).toHaveBeenCalledWith({ where: { id: "warn-1" }, data: expect.objectContaining({ status: "closed", closeReason: "Stage/Task đã bị xóa" }) });
    expect(auditActions(prisma)).toContain("project.stage_deleted");
  });

  it("deleteTask hard-deletes only for a manager or admin; anyone else archives the task", async () => {
    const member = setup({ member: true });
    await expect(member.service.deleteTask("task-1", as("usr-1"))).resolves.toMatchObject({ deleted: false, archived: true });
    expect(member.prisma.projectTask.delete).not.toHaveBeenCalled();
    expect(member.prisma.projectTask.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: expect.objectContaining({ status: "archived", archivedByUserId: "usr-1" }) });
    expect(auditActions(member.prisma)).toEqual(["task.archived"]);

    const manager = setup({ pic: "usr-pic" });
    await expect(manager.service.deleteTask("task-1", as("usr-pic"))).resolves.toEqual({ deleted: true, archived: false, id: "task-1" });
    expect(manager.prisma.projectTask.delete).toHaveBeenCalledWith({ where: { id: "task-1" } });
    expect(manager.prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "task.deleted", resourceId: "task-1", before: expect.objectContaining({ title: "Task", projectId: "prj-1" }) }) });
  });
});

describe("task rules", () => {
  it("transitionTask writes no history row when the status is unchanged", async () => {
    const { prisma, service } = setup();
    await expect(service.transitionTask("task-1", { status: "todo" } as any, as("usr-1"), "usr-1")).resolves.toMatchObject({ id: "task-1", status: "todo" });
    expect(prisma.taskStatusHistory.create).not.toHaveBeenCalled();
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
  });

  it("changing the owner needs the same permission as changing assignees, however the assignees are sent", async () => {
    const current = { ownerUserId: "usr-owner", assigneeUserId: "usr-a", taskAssignees: [{ userId: "usr-a", isPrimary: true }] };
    // A project member who neither owns nor is assigned the task, sending the unchanged assignee list plus a new owner.
    const outsider = setup({ member: true, task: current });
    await expect(outsider.service.updateTask("task-1", { ownerUserId: "usr-1", assigneeUserIds: ["usr-a"] } as any, as("usr-1"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(outsider.prisma.projectTask.update).not.toHaveBeenCalled();

    const owner = setup({ member: true, task: current });
    await expect(owner.service.updateTask("task-1", { ownerUserId: "usr-b", assigneeUserIds: ["usr-a"] } as any, as("usr-owner"))).resolves.toMatchObject({ id: "task-1" });
    expect(auditActions(owner.prisma)).toContain("task.assignee_transferred");

    // Ordinary edits by an internal member stay open.
    const editor = setup({ member: true, task: current });
    await expect(editor.service.updateTask("task-1", { title: "Renamed", assigneeUserIds: ["usr-a"], ownerUserId: "usr-owner" } as any, as("usr-1"))).resolves.toMatchObject({ id: "task-1" });
  });

  it("an approved task plan locks start, due and estimate except for the approver roles", async () => {
    const approved = { planApprovalStatus: "APPROVED" };
    for (const change of [{ dueAt: "2026-10-12T10:00:00.000Z" }, { plannedStartAt: "2026-10-06T02:00:00.000Z" }, { estimateMinutes: 300 }]) {
      const { prisma, service } = setup({ member: true, task: approved });
      await expect(service.updateTask("task-1", change as any, as("usr-1", "DELIVERY_LEAD"))).rejects.toThrow("yêu cầu thay đổi timeline");
      expect(prisma.projectTask.update).not.toHaveBeenCalled();
    }

    // Re-sending the approved values with another edit is not a plan change.
    const same = setup({ member: true, task: approved });
    await expect(same.service.updateTask("task-1", { title: "Renamed", dueAt: task.dueAt.toISOString(), plannedStartAt: task.plannedStartAt.toISOString(), estimateMinutes: 240 } as any, as("usr-1"))).resolves.toMatchObject({ id: "task-1" });

    const approver = setup({ member: true, task: approved });
    await expect(approver.service.updateTask("task-1", { dueAt: "2026-10-12T10:00:00.000Z" } as any, as("usr-pm", "PM"))).resolves.toMatchObject({ id: "task-1" });

    const draft = setup({ member: true });
    await expect(draft.service.updateTask("task-1", { dueAt: "2026-10-12T10:00:00.000Z" } as any, as("usr-1"))).resolves.toMatchObject({ id: "task-1" });
  });

  it("a locked milestone accepts neither new tasks nor time logs", async () => {
    const locked = (prisma: any) => prisma.projectStage.findFirst.mockImplementation(async (args: any) => args?.select?.milestone
      ? { milestone: { name: "UAT", gateStatus: "locked" } }
      : { id: "stage-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", milestoneId: "ms-2", ownerUserId: null });

    const create = setup({ member: true });
    locked(create.prisma);
    await expect(create.service.createTask({ projectId: "prj-1", stageId: "stage-1", title: "New" } as any, as("usr-1"))).rejects.toBeInstanceOf(ConflictException);
    expect(create.prisma.projectTask.create).not.toHaveBeenCalled();

    const log = setup({ member: true });
    locked(log.prisma);
    await expect(log.service.createTimeEntry("task-1", { minutes: 60 } as any, as("usr-1"), "usr-1")).rejects.toThrow("UAT");
    expect(log.prisma.taskTimeEntry.create).not.toHaveBeenCalled();

    // An open milestone is unaffected.
    const open = setup({ member: true });
    await expect(open.service.createTask({ projectId: "prj-1", stageId: "stage-1", title: "New" } as any, as("usr-1"))).resolves.toMatchObject({ id: "task-new" });
    expect(open.prisma.projectTaskAssignee.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("a planning block can only be created for a member of the task's project", async () => {
    const { prisma, service } = setup({ member: true });
    prisma.projectMember.findMany.mockResolvedValue([]);
    await expect(service.createTaskPlanningBlock("task-1", { userId: "usr-outsider", startAt: "2026-10-05T02:00:00.000Z", endAt: "2026-10-05T03:00:00.000Z" } as any, as("usr-1"), "usr-1")).rejects.toThrow("not project members");
    expect(prisma.taskPlanningBlock.create).not.toHaveBeenCalled();
  });
});

describe("project status", () => {
  const createInput = { accountId: "acc-1", name: "New project", code: "NEW", createStageTemplate: false };
  function createSetup() {
    const ctx = setup();
    ctx.prisma.tenantWorkspace.findUnique.mockResolvedValue({ id: "twk-1", status: "active", tenantKey: "prod" });
    const created = { ...project, id: "prj-new", account: { name: "Acme" }, members: [], budgets: [], costs: [], stages: [], tasks: [] };
    ctx.prisma.project.create.mockImplementation(async ({ data }: any) => ({ ...created, status: data.status }));
    ctx.prisma.project.findFirstOrThrow.mockResolvedValue(created);
    return ctx;
  }

  it("rejects a status outside the catalogue on create and update", async () => {
    const create = createSetup();
    await expect(create.service.createProject({ ...createInput, status: "pilot" } as any, as("usr-1"))).rejects.toBeInstanceOf(BadRequestException);
    expect(create.prisma.project.create).not.toHaveBeenCalled();

    const update = setup({ pic: "usr-1" });
    await expect(update.service.updateProject("prj-1", { status: "archived" } as any, as("usr-1"))).rejects.toThrow("Trạng thái dự án không hợp lệ");
    expect(update.prisma.project.update).not.toHaveBeenCalled();
  });

  it("applies the reason rule on create and writes the first status history row", async () => {
    const noReason = createSetup();
    await expect(noReason.service.createProject({ ...createInput, status: "on_hold" } as any, as("usr-1"))).rejects.toThrow("On Hold bắt buộc phải nhập lý do");
    expect(noReason.prisma.project.create).not.toHaveBeenCalled();

    const planning = createSetup();
    await planning.service.createProject(createInput as any, as("usr-1"));
    expect(planning.prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "planning" }) }));
    expect(planning.prisma.projectStatusHistory.create).toHaveBeenCalledWith({ data: { workspaceId: "twk-1", projectId: "prj-new", fromStatus: undefined, toStatus: "planning", reason: undefined, changedByUserId: "usr-1" } });

    // Legacy alias accepted; created On Hold with open assigned tasks raises NL-02 like a later change would.
    const onHold = createSetup();
    onHold.prisma.projectTask.count.mockResolvedValue(2);
    await onHold.service.createProject({ ...createInput, status: "paused", statusReason: "Chờ khách hàng ký" } as any, as("usr-1"));
    expect(onHold.prisma.projectStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ toStatus: "on_hold", reason: "Chờ khách hàng ký" }) });
    expect(onHold.prisma.projectWarning.create).toHaveBeenCalledWith({ data: expect.objectContaining({ typeCode: "NL-02", dedupeKey: "NL-02:on-hold-open-tasks" }) });
  });

  it("reads the current status under the project lock, so a concurrent change is not acted on twice", async () => {
    const { prisma, service } = setup({ pic: "usr-1" });
    // The pre-transaction read still says on_hold; by the time the lock is held another request already resumed the project.
    prisma.project.findFirst.mockResolvedValueOnce({ ...project, status: "on_hold" }).mockResolvedValue({ ...project, status: "in_progress" });
    prisma.project.findFirstOrThrow.mockResolvedValue({ ...project, account: { name: "Acme" }, members: [], budgets: [], costs: [], stages: [], tasks: [] });
    const order: string[] = [];
    prisma.$queryRaw.mockImplementation(async () => { order.push("lock"); return []; });
    prisma.project.update.mockImplementation(async () => { order.push("write"); return project; });

    await service.updateProject("prj-1", { status: "active" } as any, as("usr-1"));

    expect(order[0]).toBe("lock");
    expect(prisma.project.findFirst.mock.calls.at(-1)?.[0]).toEqual({ where: { id: "prj-1", workspaceId: "twk-1" }, select: { status: true } });
    // active -> active under the lock: no second history row and no second NL-02 closure.
    expect(prisma.projectStatusHistory.create).not.toHaveBeenCalled();
  });

  it("flags work that is already ownerless when the project leaves planning", async () => {
    const { prisma, service } = setup({ pic: "usr-1", project: { status: "planning" } });
    prisma.project.findFirstOrThrow.mockResolvedValue({ ...project, account: { name: "Acme" }, members: [], budgets: [], costs: [], stages: [], tasks: [] });
    prisma.projectTask.findMany.mockResolvedValue([{ ...task }]);
    // After the write the project is active, which is what the warning sync reads.
    prisma.project.update.mockImplementation(async () => { prisma.project.findFirst.mockResolvedValue({ ...project, status: "active" }); return project; });

    await service.updateProject("prj-1", { status: "active" } as any, as("usr-1"));

    expect(prisma.projectWarning.create).toHaveBeenCalledWith({ data: expect.objectContaining({ typeCode: "NL-03", dedupeKey: "NL-03:task:task-1" }) });
  });
});

describe("project warnings", () => {
  const closedWarning = (...actions: string[]) => ({ id: "warn-1", status: "closed", events: actions.map((action) => ({ action })) });

  it("does not reopen a manually closed NL-03 on an unrelated edit, and reopens once an owner was set and removed again", async () => {
    const suppressed = setup({ member: true });
    suppressed.prisma.projectWarning.findFirst.mockImplementation(async (args: any) => (args.where.status ? null : closedWarning("opened", MANUAL_CLOSE_ACTION)));
    await suppressed.service.updateTask("task-1", { title: "Still nobody" } as any, as("usr-1"));
    expect(suppressed.prisma.projectWarning.create).not.toHaveBeenCalled();

    // Setting an owner re-arms the closed warning...
    const assigned = setup({ pic: "usr-1", task: { ownerUserId: null } });
    assigned.prisma.projectWarning.findFirst.mockImplementation(async (args: any) => (args.where.status ? null : closedWarning("opened", MANUAL_CLOSE_ACTION)));
    await assigned.service.updateTask("task-1", { ownerUserId: "usr-2" } as any, as("usr-1"));
    expect(assigned.prisma.projectWarning.update).toHaveBeenCalledWith({ where: { id: "warn-1" }, data: { events: { create: expect.objectContaining({ action: REARM_ACTION }) } } });

    // ...so the next time the task is ownerless the warning opens again.
    const reopened = setup({ member: true });
    reopened.prisma.projectWarning.findFirst.mockImplementation(async (args: any) => (args.where.status ? null : closedWarning("opened", MANUAL_CLOSE_ACTION, REARM_ACTION)));
    await reopened.service.updateTask("task-1", { title: "Ownerless again" } as any, as("usr-1"));
    expect(reopened.prisma.projectWarning.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dedupeKey: "NL-03:task:task-1" }) });
  });

  it("marks a closure made by a person so it can be told apart from an automatic one", async () => {
    const { prisma, service } = setup({ pic: "usr-1" });
    prisma.projectWarning.findFirst.mockResolvedValue({ id: "warn-1", status: "open" });
    prisma.projectWarning.findMany.mockResolvedValue([{ id: "warn-1" }]);
    prisma.projectWarning.findUniqueOrThrow.mockResolvedValue({ id: "warn-1", projectId: "prj-1", typeCode: "NL-03", severity: "high", title: "t", status: "closed", openedAt: new Date(), events: [] });
    await service.closeProjectWarning("prj-1", "warn-1", { reason: "Đã biết, chưa cần phân công" }, as("usr-1"));
    expect(prisma.projectWarning.update).toHaveBeenCalledWith({ where: { id: "warn-1" }, data: expect.objectContaining({ events: { create: expect.objectContaining({ action: MANUAL_CLOSE_ACTION }) } }) });
  });

  it("closes NL-01 once the departed member has no open task left, and writes the warning in the task's transaction", async () => {
    const { prisma, service } = setup({ member: true, task: { ownerUserId: "usr-2", status: "in_progress" } });
    prisma.projectWarning.findMany.mockImplementation(async (args: any) => (args.where.typeCode === "NL-01" ? [{ dedupeKey: "NL-01:usr-gone" }] : args.where.dedupeKey === "NL-01:usr-gone" ? [{ id: "warn-nl01" }] : []));
    let insideTransaction = false;
    prisma.$transaction.mockImplementation(async (callback: any) => { insideTransaction = true; try { return await callback(prisma); } finally { insideTransaction = false; } });
    const warningWrites: boolean[] = [];
    prisma.projectWarning.update.mockImplementation(async () => { warningWrites.push(insideTransaction); return {}; });

    await service.transitionTask("task-1", { status: "done" } as any, as("usr-1"), "usr-1");

    expect(prisma.projectTask.count).toHaveBeenCalledWith({ where: expect.objectContaining({ projectId: "prj-1", OR: [{ ownerUserId: "usr-gone" }, { assigneeUserId: "usr-gone" }, { taskAssignees: { some: { userId: "usr-gone" } } }] }) });
    expect(prisma.projectWarning.update).toHaveBeenCalledWith({ where: { id: "warn-nl01" }, data: expect.objectContaining({ status: "closed" }) });
    expect(warningWrites).toEqual([true]);

    // Still one open task for that member: the warning stays.
    const open = setup({ member: true, task: { ownerUserId: "usr-2" } });
    open.prisma.projectWarning.findMany.mockImplementation(async (args: any) => (args.where.typeCode === "NL-01" ? [{ dedupeKey: "NL-01:usr-gone" }] : []));
    open.prisma.projectTask.count.mockResolvedValue(1);
    await open.service.transitionTask("task-1", { status: "in_progress" } as any, as("usr-1"), "usr-1");
    expect(open.prisma.projectWarning.update).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  it("getUserProjectParticipation for another user needs an admin; the period covers whole local days", async () => {
    const query = { userId: "usr-2", startDate: "2026-10-01", endDate: "2026-10-31" };
    const denied = setup({ member: true });
    await expect(denied.service.getUserProjectParticipation(query, as("usr-1", "DELIVERY_LEAD"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied.prisma.taskTimeEntry.findMany).not.toHaveBeenCalled();

    const self = setup();
    await expect(self.service.getUserProjectParticipation({ ...query, userId: "usr-1" }, as("usr-1"))).resolves.toMatchObject({ data: { userId: "usr-1" } });

    const admin = setup();
    const result = await admin.service.getUserProjectParticipation(query, as("usr-admin", "WORKSPACE_ADMIN"));
    expect(admin.prisma.taskTimeEntry.findMany.mock.calls[0][0].where).toMatchObject({
      userId: "usr-2",
      workDate: { gte: new Date("2026-09-30T17:00:00.000Z"), lt: new Date("2026-10-31T17:00:00.000Z") },
      approvalStatus: { notIn: ["rejected", "cancelled", "canceled", "planned"] }
    });
    expect(result.data.endDate).toBe("2026-10-31T16:59:59.999Z");
  });

  it("does not report members of a completed project as missing data", async () => {
    const { prisma, service } = setup({ project: { status: "done" } });
    prisma.projectMember.findMany.mockResolvedValue([{ userId: "usr-2", user: { displayName: "B", email: "b@x.vn", status: "ACTIVE" } }]);
    const result = await service.listProjectMemberParticipation("prj-1", { startDate: "2026-10-01", endDate: "2026-10-31" }, as("usr-1"));
    expect(result.data[0]).toMatchObject({ userId: "usr-2", participationState: "no_log" });
  });

  it("filters the project list by PIC (first stage owner) for a comma-separated list instead of an unknown column", async () => {
    const { prisma, service } = setup();
    prisma.$queryRaw.mockResolvedValue([{ id: "prj-1" }, { id: "prj-7" }]);
    await expect(service.listProjects({ ownerUserId: "usr-a, usr-b" }, as("usr-1"))).resolves.toMatchObject({ data: [] });
    const where = prisma.project.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("ownerUserId");
    expect(where.AND).toEqual([{ id: { in: ["prj-1", "prj-7"] } }]);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(["twk-1", expect.objectContaining({ values: ["usr-a", "usr-b"] })]);

    const unfiltered = setup();
    await unfiltered.service.listProjects({}, as("usr-1"));
    expect(unfiltered.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("milestone gate", () => {
  it("clears the approval request and the old reviewer's notification when the reviewer changes", async () => {
    const milestone = {
      id: "ms-1", projectId: "prj-1", workspaceId: "twk-1", sortOrder: 10, gateStatus: "pending_review", requiredDocumentCount: 0, requiredDocumentTypes: [],
      evidenceMode: "file_or_link", ownerTeamId: null, unlockCriteria: null, customerConfirmationRequired: false, reviewerMode: "specific_user", reviewerUserId: "usr-old", reviewerRole: null,
      approvalRequestedAt: new Date("2026-10-01T00:00:00.000Z")
    };
    const { prisma, notifications, service } = setup();
    prisma.projectMilestone.findFirst.mockResolvedValue(milestone);
    const actor = as("usr-lead", "DELIVERY_LEAD");

    await service.updateProjectMilestoneGate("prj-1", "ms-1", { reviewerUserId: "usr-new" }, actor);
    expect(prisma.projectMilestone.update.mock.calls[0][0].data).toMatchObject({ reviewerUserId: "usr-new", approvalRequestedAt: null, approvalRequestedByUserId: null, approvalRequestedByName: null });
    expect(notifications.resolveMilestoneNotifications).toHaveBeenCalledWith("ms-1", actor);

    // Saving the gate unchanged keeps the pending request and its notification.
    const unchanged = setup();
    unchanged.prisma.projectMilestone.findFirst.mockResolvedValue(milestone);
    await unchanged.service.updateProjectMilestoneGate("prj-1", "ms-1", { reviewerUserId: "usr-old" }, actor);
    expect(unchanged.prisma.projectMilestone.update.mock.calls[0][0].data.approvalRequestedAt).toBeUndefined();
    expect(unchanged.notifications.resolveMilestoneNotifications).not.toHaveBeenCalled();
  });
});
