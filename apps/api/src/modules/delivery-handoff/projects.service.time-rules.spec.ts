import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ProjectsService } from "./projects.service";
import { STANDARD_DAY_MINUTES } from "./daily-actual-log";

/** Every model method exists and answers "nothing found"; a test overrides only what its rule depends on. */
function mockPrisma() {
  const defaults: Record<string, () => unknown> = {
    findFirst: () => null, findUnique: () => null, findMany: () => [], count: () => 0,
    aggregate: () => ({ _sum: { minutes: 0, overtimeMinutes: 0, plannedMinutes: 0 } }),
    updateMany: () => ({ count: 0 }), deleteMany: () => ({ count: 0 }), createMany: () => ({ count: 0 })
  };
  const models: Record<string, any> = {};
  const root: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", hierarchyOrderVersion: 0, status: "in_progress", startedAt: new Date() }])
  };
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

const base: PrincipalContext = {
  subjectType: "internal_user", subjectId: "usr-1", displayName: "Member", tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: ["WORKSPACE_USER"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g"
};
const as = (subjectId: string, ...roleCodes: string[]): PrincipalContext => ({ ...base, subjectId, roleCodes: roleCodes.length ? roleCodes : ["WORKSPACE_USER"] });
const admin = as("usr-1", "FOUNDER_GM", "WORKSPACE_ADMIN");
const taskRow = {
  id: "task-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", parentTaskId: null, title: "Task", status: "in_progress",
  ownerUserId: null, assigneeUserId: null, taskAssignees: [], archivedAt: null, cancelledAt: null, completedAt: null, startedAt: new Date(),
  plannedStartAt: null, dueAt: null, estimateMinutes: 0, planApprovalStatus: "DRAFT", taskTypeLayer1: null as string | null, taskTypeLayer2: null as string | null,
  customerVisible: false, createdAt: new Date(), updatedAt: new Date()
};

function setup(overrides: {
  project?: Record<string, unknown>; stage?: Record<string, unknown>; task?: Record<string, unknown>; parent?: Record<string, unknown>;
  pic?: string; dayOff?: { name: string } | null; logged?: { minutes: number; overtimeMinutes?: number }; planned?: number
} = {}) {
  const prisma = mockPrisma();
  const task = { ...taskRow, ...overrides.task };
  prisma.project.findFirst.mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress", projectType: "delivery", ...overrides.project });
  prisma.account.findFirst.mockResolvedValue({ id: "acc-1", workspaceId: "twk-1", code: "ACC" });
  prisma.projectStage.findFirst.mockImplementation(async (args: any) => args?.select?.milestone
    ? { milestone: { name: "M1", gateStatus: "open" } }
    : { id: "stage-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", milestoneId: "ms-1", ownerUserId: overrides.pic ?? null, taskTypeLayer1: "DELIVERY", afterPnlClose: false, ...overrides.stage });
  prisma.projectMember.findFirst.mockResolvedValue({ userId: "member" });
  prisma.projectMember.findMany.mockImplementation(async (args: any) => (args?.where?.userId?.in ?? []).map((userId: string) => ({ userId })));
  prisma.user.findMany.mockImplementation(async (args: any) => (args?.where?.id?.in ?? []).map((id: string) => ({ id, displayName: id })));
  prisma.projectTask.findFirst.mockImplementation(async (args: any) => (args?.where?.id === "task-parent"
    ? { id: "task-parent", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1", stageId: "stage-1", taskTypeLayer1: "PRE_SALE", ...overrides.parent }
    : task));
  prisma.projectTask.update.mockImplementation(async ({ data }: any) => ({ ...task, ...data }));
  prisma.projectTask.create.mockImplementation(async ({ data }: any) => ({ ...task, id: "task-new", ...data }));
  prisma.workspaceDayOff.findFirst.mockResolvedValue(overrides.dayOff ? { id: "off-1", date: new Date("2026-10-06T00:00:00.000Z"), ...overrides.dayOff } : null);
  prisma.taskTimeEntry.aggregate.mockResolvedValue({ _sum: { minutes: overrides.logged?.minutes ?? 0, overtimeMinutes: overrides.logged?.overtimeMinutes ?? 0 } });
  prisma.taskPlanningBlock.aggregate.mockResolvedValue({ _sum: { plannedMinutes: overrides.planned ?? 0 } });
  prisma.taskTimeEntry.create.mockImplementation(async ({ data }: any) => ({ id: "time-1", createdAt: new Date(), ...data }));
  const notifications = { resolveMilestoneNotifications: vi.fn(), createMilestoneApprovalRequest: vi.fn() };
  return { prisma, service: new ProjectsService(prisma, notifications as any) };
}

const auditActions = (prisma: any) => prisma.auditEvent.create.mock.calls.map((call: any[]) => call[0].data.action);
const createdTask = (prisma: any) => prisma.projectTask.create.mock.calls[0][0].data;
const newTask = { projectId: "prj-1", stageId: "stage-1", title: "New" } as any;
// 2026-10-06 09:00–11:00 Asia/Ho_Chi_Minh
const log = (minutes = 120) => ({ workDate: "2026-10-06T02:00:00.000Z", startAt: "2026-10-06T02:00:00.000Z", endAt: new Date(Date.parse("2026-10-06T02:00:00.000Z") + minutes * 60000).toISOString(), minutes, selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }) as any;

describe("task classification on write (D-02, D-04, matrix 4.3)", () => {
  it("a task created in a stage inherits the stage's Layer 1 and gets the derived Layer 2; a client-sent Layer 2 is ignored", async () => {
    const { prisma, service } = setup();
    await service.createTask({ ...newTask, taskTypeLayer2: "INTERNAL_PROJECT" }, as("usr-1"));
    expect(createdTask(prisma)).toMatchObject({ taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" });

    const maintenance = setup({ stage: { taskTypeLayer1: "PM", afterPnlClose: true } });
    await maintenance.service.createTask({ ...newTask, taskTypeLayer2: "CUSTOMER_PROJECT" }, as("usr-1"));
    expect(createdTask(maintenance.prisma)).toMatchObject({ taskTypeLayer1: "PM", taskTypeLayer2: "TICKET_MAINTENANCE" });
  });

  it("a stage without template values leaves the task Chờ phân loại instead of guessing", async () => {
    const { prisma, service } = setup({ stage: { taskTypeLayer1: null, afterPnlClose: null } });
    await service.createTask(newTask, as("usr-1"));
    expect(createdTask(prisma).taskTypeLayer1).toBeUndefined();
    expect(createdTask(prisma).taskTypeLayer2).toBeUndefined();
  });

  it("a sub-task repeats its parent's Layer 1 whatever the client sends", async () => {
    const { prisma, service } = setup();
    await service.createTask({ projectId: "prj-1", parentTaskId: "task-parent", title: "Sub", taskTypeLayer1: "PM" } as any, as("usr-founder", "FOUNDER_GM"));
    expect(createdTask(prisma)).toMatchObject({ taskTypeLayer1: "PRE_SALE", taskTypeLayer2: "CUSTOMER_PROJECT" });
  });

  it("only an Admin account or the project manager overrides the stage's Layer 1, and the override is audited", async () => {
    const member = setup();
    await expect(member.service.createTask({ ...newTask, taskTypeLayer1: "PM" }, as("usr-1"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(member.prisma.projectTask.create).not.toHaveBeenCalled();

    for (const actor of [as("usr-pm", "PM"), as("usr-dx", "DX_DIRECTOR"), as("usr-pic")]) {
      const { prisma, service } = setup({ pic: "usr-pic" });
      await service.createTask({ ...newTask, taskTypeLayer1: "PM" }, actor);
      expect(createdTask(prisma).taskTypeLayer1).toBe("PM");
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "task.created", after: expect.objectContaining({ taskTypeLayer1: "PM", taskTypeLayer1OverriddenFrom: "DELIVERY" }) }) });
    }
    await expect(setup().service.createTask({ ...newTask, taskTypeLayer1: "SALES" }, as("usr-pm", "PM"))).rejects.toBeInstanceOf(BadRequestException);
  });

  it("Pre-sale in a stage after the P&L close gate (Ticket/bảo trì) is not saved", async () => {
    const { prisma, service } = setup({ stage: { taskTypeLayer1: "PRE_SALE", afterPnlClose: true } });
    await expect(service.createTask(newTask, as("usr-1"))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.projectTask.create).not.toHaveBeenCalled();
  });

  it("updateTask ignores a client-sent Layer 2, fills an empty Layer 1 from the stage and audits the reclassification", async () => {
    const { prisma, service } = setup({ task: { assigneeUserId: "usr-1" } });
    prisma.pnlPeriod.findMany.mockResolvedValue([{ periodKey: "2026-09" }]);
    await service.updateTask("task-1", { title: "Renamed", taskTypeLayer2: "INTERNAL_PROJECT" } as any, as("usr-1"));
    expect(prisma.projectTask.update.mock.calls[0][0].data).toMatchObject({ taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" });
    // D-03: the task's time entries follow, except those of a locked P&L month.
    expect(prisma.taskTimeEntry.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "twk-1", taskId: { in: ["task-1"] },
        NOT: [{ workDate: { gte: new Date("2026-08-31T17:00:00.000Z"), lt: new Date("2026-09-30T17:00:00.000Z") } }]
      },
      data: { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" }
    });
    expect(auditActions(prisma)).toContain("task.reclassified");
  });

  it("changing a task's Layer 1 afterwards is reserved for Admin accounts / the project manager; a sub-task cannot be changed at all", async () => {
    const classified = { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" };
    const member = setup({ task: classified });
    await expect(member.service.updateTask("task-1", { taskTypeLayer1: "PM" } as any, as("usr-1"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(member.prisma.projectTask.update).not.toHaveBeenCalled();

    const pm = setup({ task: classified });
    await pm.service.updateTask("task-1", { taskTypeLayer1: "PM" } as any, as("usr-pm", "PM"));
    expect(pm.prisma.projectTask.update.mock.calls[0][0].data.taskTypeLayer1).toBe("PM");
    expect(pm.prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "task.reclassified", before: classified, after: expect.objectContaining({ taskTypeLayer1: "PM" }) }) });

    const sub = setup({ task: { ...classified, taskTypeLayer1: "PRE_SALE", parentTaskId: "task-parent" } });
    await sub.service.updateTask("task-1", { taskTypeLayer1: "PM" } as any, as("usr-pm", "PM"));
    expect(sub.prisma.projectTask.update.mock.calls[0][0].data.taskTypeLayer1).toBe("PRE_SALE");
  });
});

describe("time log rules (D-03, D-09, D-13, D-14, D-16, V-07)", () => {
  it("a time entry copies the task's classification and is recorded without an approval step", async () => {
    const { prisma, service } = setup({ task: { taskTypeLayer1: "PM", taskTypeLayer2: "TICKET_MAINTENANCE" } });
    await service.createTimeEntry("task-1", { ...log(), approvalStatus: "submitted", taskTypeLayer1: "DELIVERY", taskTypeLayer2: "INTERNAL_PROJECT" } as any, as("usr-1"), "usr-1");
    expect(prisma.taskTimeEntry.create.mock.calls[0][0].data).toMatchObject({
      taskTypeLayer1: "PM", taskTypeLayer2: "TICKET_MAINTENANCE", approvalStatus: "approved", regularMinutes: 120, overtimeMinutes: 0, loggedWhileOnHold: false
    });
  });

  it("a log needs a day (D-10)", async () => {
    const { prisma, service } = setup();
    await expect(service.createTimeEntry("task-1", { minutes: 60 } as any, as("usr-1"), "usr-1")).rejects.toThrow("Hãy chọn ngày làm việc");
    expect(prisma.taskTimeEntry.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a member", as("usr-1")],
    ["Founder/GM + Workspace Admin (the removed bypass)", admin]
  ])("the 8h standard-hours cap across all projects blocks %s", async (_who, actor) => {
    const full = setup({ logged: { minutes: STANDARD_DAY_MINUTES - 60 } });
    await expect(full.service.createTimeEntry("task-1", log(120), actor, "usr-1")).rejects.toBeInstanceOf(ConflictException);
    expect(full.prisma.taskTimeEntry.create).not.toHaveBeenCalled();
    // The cap reads every project: the daily total is not filtered by task or project.
    expect(full.prisma.taskTimeEntry.aggregate.mock.calls[0][0].where).not.toHaveProperty("projectId");
    expect(full.prisma.taskTimeEntry.aggregate.mock.calls[0][0].where).not.toHaveProperty("taskId");

    const fits = setup({ logged: { minutes: STANDARD_DAY_MINUTES - 120 } });
    await expect(fits.service.createTimeEntry("task-1", log(120), actor, "usr-1")).resolves.toMatchObject({ id: "time-1" });
  });

  it("overtime minutes already logged that day do not use up the standard-hours cap (D-14)", async () => {
    const { service } = setup({ logged: { minutes: STANDARD_DAY_MINUTES + 60, overtimeMinutes: 180 } });
    await expect(service.createTimeEntry("task-1", log(120), as("usr-1"), "usr-1")).resolves.toMatchObject({ id: "time-1" });
  });

  it.each([
    ["a member", as("usr-1")],
    ["Founder/GM + Workspace Admin", admin]
  ])("a workspace day off blocks logging for %s", async (_who, actor) => {
    const { prisma, service } = setup({ dayOff: { name: "Nghỉ lễ" } });
    await expect(service.createTimeEntry("task-1", log(60), actor, "usr-1")).rejects.toThrow("Nghỉ lễ");
    expect(prisma.taskTimeEntry.create).not.toHaveBeenCalled();
  });

  it("a project on hold still takes the log and flags it for PM review; any other open status does not", async () => {
    for (const status of ["on_hold", "paused"]) {
      const { prisma, service } = setup({ project: { status } });
      await expect(service.createTimeEntry("task-1", log(), as("usr-1"), "usr-1")).resolves.toMatchObject({ loggedWhileOnHold: true });
      expect(prisma.taskTimeEntry.create.mock.calls[0][0].data.loggedWhileOnHold).toBe(true);
    }
    const active = setup({ project: { status: "in_progress" } });
    const entry = await active.service.createTimeEntry("task-1", log(), as("usr-1"), "usr-1");
    expect(entry.loggedWhileOnHold).toBeUndefined();
  });

  it("a closed project is locked for time logs, for an Admin too", async () => {
    const { prisma, service } = setup({ project: { status: "closed" } });
    await expect(service.createTimeEntry("task-1", log(), admin, "usr-1")).rejects.toThrow("Đã đóng");
    expect(prisma.taskTimeEntry.create).not.toHaveBeenCalled();
  });
});

describe("planning blocks (D-09, D-13, D-15)", () => {
  const block = { userId: "usr-1", startAt: "2026-10-06T02:00:00.000Z", endAt: "2026-10-06T04:00:00.000Z" } as any;

  it("the daily plan shares the 8h cap and the day-off lock, with no Admin bypass", async () => {
    const full = setup({ planned: STANDARD_DAY_MINUTES - 60 });
    await expect(full.service.createTaskPlanningBlock("task-1", block, admin, "usr-1")).rejects.toBeInstanceOf(ConflictException);
    // The day is the person's local day, the same window actual hours use.
    expect(full.prisma.taskPlanningBlock.aggregate.mock.calls[0][0].where.startAt).toEqual({ gte: new Date("2026-10-05T17:00:00.000Z"), lt: new Date("2026-10-06T17:00:00.000Z") });

    const holiday = setup({ dayOff: { name: "Nghỉ lễ" } });
    await expect(holiday.service.createTaskPlanningBlock("task-1", block, admin, "usr-1")).rejects.toThrow("Nghỉ lễ");
    expect(holiday.prisma.taskPlanningBlock.create).not.toHaveBeenCalled();
  });

  it("completing a block never creates a time log from planned hours", async () => {
    const { prisma, service } = setup();
    const updatedAt = new Date("2026-10-06T05:00:00.000Z");
    const planned = { id: "plan-1", workspaceId: "twk-1", taskId: "task-1", accountId: "acc-1", projectId: "prj-1", userId: "usr-1", title: "Plan",
      startAt: new Date(block.startAt), endAt: new Date(block.endAt), plannedMinutes: 120, billable: true, workType: "delivery", status: "planned", source: "manual", createdAt: updatedAt, updatedAt };
    prisma.taskPlanningBlock.findFirst.mockResolvedValueOnce(planned).mockResolvedValue({ ...planned, status: "completed" });
    prisma.taskPlanningBlock.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.transitionTaskPlanningBlock("plan-1", { status: "completed", expectedUpdatedAt: updatedAt.toISOString() }, as("usr-1"), "usr-1");

    expect(result).toMatchObject({ id: "plan-1", status: "completed" });
    expect(result).not.toHaveProperty("actualLogWarning");
    expect(prisma.taskTimeEntry.create).not.toHaveBeenCalled();
    expect(prisma.taskStatusHistory.create).not.toHaveBeenCalled();
    expect(auditActions(prisma)).toEqual(["planning_status_changed"]);
  });
});

describe("legacy Layer 2 metadata on time logs", () => {
  const billable = { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" };
  const warningsOpened = (prisma: any) => prisma.projectWarning.create.mock.calls.map((call: any[]) => call[0].data);

  it("allows a log without Layer 2 while still rejecting invalid legacy values", async () => {
    const { prisma, service } = setup({ task: billable });
    const entry = await service.createTimeEntry("task-1", { ...log(), selectedTaskTypeLayer2: undefined }, as("usr-1"), "usr-1");
    expect(entry.selectedTaskTypeLayer2).toBeUndefined();
    expect(prisma.taskTimeEntry.create).toHaveBeenCalled();

    const invalid = setup({ task: billable });
    await expect(invalid.service.createTimeEntry("task-1", { ...log(), selectedTaskTypeLayer2: "DAY_OFF_COMPANY" }, as("usr-1"), "usr-1")).rejects.toBeInstanceOf(BadRequestException);
    const preSale = setup({ task: { taskTypeLayer1: "PRE_SALE", taskTypeLayer2: "CUSTOMER_PROJECT" } });
    await expect(preSale.service.createTimeEntry("task-1", { ...log(), selectedTaskTypeLayer2: "TICKET_MAINTENANCE" }, as("usr-1"), "usr-1")).rejects.toThrow("Pre-sale");
    expect(invalid.prisma.taskTimeEntry.create).not.toHaveBeenCalled();
    expect(preSale.prisma.taskTimeEntry.create).not.toHaveBeenCalled();
  });

  it("a choice equal to the task's value is stored next to the derived one and raises nothing", async () => {
    const { prisma, service } = setup({ task: billable });
    const entry = await service.createTimeEntry("task-1", log(), as("usr-1"), "usr-1");
    expect(prisma.taskTimeEntry.create.mock.calls[0][0].data).toMatchObject({ taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT" });
    expect(entry.layer2Mismatch).toBeUndefined();
    expect(prisma.projectWarning.create).not.toHaveBeenCalled();
  });

  it("a choice that differs is saved, flagged, and opens ONE data warning per project", async () => {
    const { prisma, service } = setup({ task: billable });
    prisma.taskTimeEntry.findMany.mockResolvedValue([
      { minutes: 120, taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT" },
      { minutes: 60, taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }
    ]);
    const entry = await service.createTimeEntry("task-1", { ...log(), selectedTaskTypeLayer2: "INTERNAL_PROJECT" }, as("usr-1"), "usr-1");
    expect(entry).toMatchObject({ id: "time-1", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT", layer2Mismatch: true });
    expect(warningsOpened(prisma)).toEqual([expect.objectContaining({ projectId: "prj-1", typeCode: "DL-02", dedupeKey: "DL-02:layer2-mismatch", title: "Lớp 2 không khớp: 1 giờ log" })]);

    // The warning is already open: the next mismatch refreshes it instead of adding a second one.
    prisma.projectWarning.findFirst.mockResolvedValue({ id: "warn-1", title: "old", detail: "old", severity: "medium" });
    await service.createTimeEntry("task-1", { ...log(), selectedTaskTypeLayer2: "INTERNAL_PROJECT" }, as("usr-1"), "usr-1");
    expect(prisma.projectWarning.create).toHaveBeenCalledTimes(1);
    expect(prisma.projectWarning.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "warn-1" } }));
  });

  it("a task without a derived Layer 2 is 'thiếu phân loại', not a mismatch; a trial project raises no warning", async () => {
    const pending = setup({ task: { taskTypeLayer1: "DELIVERY", taskTypeLayer2: null } });
    expect((await pending.service.createTimeEntry("task-1", log(), as("usr-1"), "usr-1")).layer2Mismatch).toBeUndefined();
    expect(pending.prisma.projectWarning.create).not.toHaveBeenCalled();

    const trial = setup({ task: billable, project: { isTestProject: true } });
    trial.prisma.taskTimeEntry.findMany.mockResolvedValue([{ minutes: 120, taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT" }]);
    await trial.service.createTimeEntry("task-1", { ...log(), selectedTaskTypeLayer2: "INTERNAL_PROJECT" }, as("usr-1"), "usr-1");
    expect(trial.prisma.projectWarning.create).not.toHaveBeenCalled();
  });

  it("the author corrects the choice; the warning closes once no mismatched entry is left", async () => {
    const { prisma, service } = setup({ task: billable });
    const stored = { id: "time-1", userId: "usr-1", projectId: "prj-1", workDate: new Date("2026-10-06T02:00:00.000Z"), taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT", minutes: 120 };
    prisma.taskTimeEntry.findFirst.mockResolvedValue(stored);
    prisma.taskTimeEntry.update.mockImplementation(async ({ data }: any) => ({ ...stored, ...data, createdAt: new Date(), updatedAt: new Date() }));
    prisma.taskTimeEntry.findMany.mockResolvedValue([{ minutes: 120, taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }]);
    prisma.projectWarning.findMany.mockResolvedValue([{ id: "warn-1" }]);

    const updated = await service.updateTimeEntryLayer2("time-1", { selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }, as("usr-1"));
    expect(updated).toMatchObject({ selectedTaskTypeLayer2: "CUSTOMER_PROJECT" });
    expect(updated.layer2Mismatch).toBeUndefined();
    expect(prisma.projectWarning.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "warn-1" }, data: expect.objectContaining({ status: "closed" }) }));
    expect(auditActions(prisma)).toContain("task.time_entry_layer2_changed");

    // Somebody else who does not manage the project may not; an invalid value is refused before anything is read further.
    await expect(service.updateTimeEntryLayer2("time-1", { selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }, as("usr-2"))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateTimeEntryLayer2("time-1", { selectedTaskTypeLayer2: "nope" } as any, as("usr-1"))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateTimeEntryLayer2("time-1", { selectedTaskTypeLayer2: "CUSTOMER_PROJECT" }, as("usr-pm", "PM"))).resolves.toMatchObject({ id: "time-1" });
  });
});

describe("project payloads outside the P&L tab (PL-02, PL-26)", () => {
  const stored = { id: "prj-1", workspaceId: "twk-1", accountId: "acc-1", code: "PRJ", name: "Project", status: "in_progress", projectType: "delivery", marginPercent: 31,
    budgets: [{ plannedRevenueAmount: 900, currency: "VND" }], costs: [{ amount: 400 }], isTestProject: true };

  it("only an Admin account changes the trial flag after creation; the change is audited and returned", async () => {
    const user = setup();
    await expect(user.service.updateProject("prj-1", { isTestProject: true }, as("usr-1"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.prisma.project.update).not.toHaveBeenCalled();

    const pm = setup();
    pm.prisma.project.findFirstOrThrow.mockResolvedValue(stored);
    pm.prisma.project.update.mockResolvedValue(stored);
    const result = await pm.service.updateProject("prj-1", { isTestProject: true }, as("usr-pm", "PM"));
    expect(pm.prisma.project.update.mock.calls[0][0].data.isTestProject).toBe(true);
    expect(auditActions(pm.prisma)).toContain("project.test_flag_changed");
    expect(result.isTestProject).toBe(true);
    // PM is an Admin account but holds no cost permission here: the update response carries no money either.
    expect(result).toMatchObject({ budgetAmount: undefined, spentAmount: undefined, marginPercent: undefined, budgetCurrency: undefined });
    const costViewer = setup();
    costViewer.prisma.project.findFirstOrThrow.mockResolvedValue(stored);
    costViewer.prisma.project.update.mockResolvedValue(stored);
    expect(await costViewer.service.updateProject("prj-1", { name: "Project" }, as("usr-pm", "PM", "COST_VIEW"))).toMatchObject({ budgetAmount: 900, spentAmount: 400, marginPercent: 31 });
  });
});
