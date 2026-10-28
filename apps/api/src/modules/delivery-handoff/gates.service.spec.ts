/** Review findings 5 and 6: the G7 exception, the one meaning of "gate passed", and the P&L hour gate as the only G7 data rule. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePrisma } from "./fake-prisma.testing";
import { gateHooks } from "./gates";
import { MilestoneGatesService } from "./milestone-gates.service";
import { ProjectPermissionsService } from "./project-permissions.service";
import { actOnProjectGate, assertStageGateOpen, autoPassStageGates, decideStatusProposal, listProjectGates } from "./gates.service";

const principal = { subjectType: "internal_user", subjectId: "usr-director", displayName: "Dx Director", workspaceId: "w", tenantKey: "prod", roleCodes: ["DX_DIRECTOR", "WORKSPACE_ADMIN"] } as any;

function seed(blockingMinutes: number) {
  const fake = fakePrisma({
    project: [{ id: "p1", workspaceId: "w", accountId: "acc-1", status: "in_review" }],
    projectMilestone: [{ id: "m3", workspaceId: "w", projectId: "p1", name: "Milestone 3", sortOrder: 30, gateStatus: "open" }, { id: "m4", workspaceId: "w", projectId: "p1", name: "Milestone 4", sortOrder: 40, gateStatus: "locked" }],
    projectStage: [{ id: "s-acceptance", workspaceId: "w", projectId: "p1", milestoneId: "m3", activity: "Acceptance", stageKey: "acceptance", sortOrder: 10, status: "in_progress" }],
    projectGate: [{ id: "g7", workspaceId: "w", projectId: "p1", milestoneId: "m3", stageId: "s-acceptance", code: "G7", status: "awaiting_customer", sortOrder: 7, history: [] }]
  });
  const pendingHoursBlockingG7 = vi.fn(async (_workspaceId: string, projectId: string) => ({
    projectId, blockingMinutes, entryCount: blockingMinutes ? 1 : 0, waitingCostRateMinutes: 480,
    byReason: blockingMinutes ? [{ reason: "legacy_no_stage" as const, label: "Chưa có stage", minutes: blockingMinutes, entryCount: 1 }] : []
  }));
  const ctx = {
    prisma: fake.prisma, principal, pendingHoursBlockingG7,
    actor: { userId: "usr-director", isAdmin: true, isPm: true, isBd: false, isMember: false, canGrantGateException: true },
    status: { prisma: fake.prisma, workspaceId: "w", actorUserId: "usr-director", recordStatusChange: vi.fn() },
    now: new Date("2026-10-14T03:00:00.000Z")
  };
  return { ...fake, ctx, pendingHoursBlockingG7 };
}

describe("G7 (findings 5, 6)", () => {
  const closeProjectPnl = gateHooks.closeProjectPnl;
  afterEach(() => { gateHooks.closeProjectPnl = closeProjectPnl; });

  it("asks the P&L hour gate — its reasons reach the screen and block the exception", async () => {
    const { ctx, table, pendingHoursBlockingG7 } = seed(90);
    const list = await listProjectGates(ctx, { id: "p1" });
    expect(pendingHoursBlockingG7).toHaveBeenCalledWith("w", "p1");
    expect(list.data[0].pnlPendingCheck).toEqual({ blocked: true, worklistHref: "/pnl/hours?projectId=p1", reasons: [{ reason: "legacy_no_stage", label: "Chưa có stage", entryCount: 1, minutes: 90 }] });
    await expect(actOnProjectGate(ctx, { id: "p1", accountId: "acc-1" }, "g7", { action: "exception", reason: "Khách đã dùng hệ thống" } as any)).rejects.toThrow(/Còn giờ log Chờ xử lý/);
    expect(table("projectGate")[0].status).toBe("awaiting_customer");
  });

  it("an exception with clean hours passes G7 like an approval: P&L close hook, project Đã hoàn thành", async () => {
    const { ctx, table } = seed(0);
    gateHooks.closeProjectPnl = vi.fn();
    const list = await actOnProjectGate(ctx, { id: "p1", accountId: "acc-1" }, "g7", { action: "exception", reason: "Khách đã dùng hệ thống" } as any);
    expect(table("projectGate")[0]).toMatchObject({ status: "exception", exceptionByUserId: "usr-director" });
    expect(gateHooks.closeProjectPnl).toHaveBeenCalledTimes(1);
    expect(table("project")[0].status).toBe("completed");
    expect(ctx.status.recordStatusChange).toHaveBeenCalledWith(expect.anything(), "p1", { from: "in_review", to: "completed" }, "Hệ thống tự chuyển: G7 mở theo ngoại lệ");
    expect(table("projectMilestone").map((milestone) => milestone.gateStatus)).toEqual(["approved", "open"]);
    // Only the Dx Director (or Founder/GM, Workspace Admin) is offered the exception.
    expect(list.canException).toBe(true);
    expect((await listProjectGates({ ...ctx, actor: { ...ctx.actor, canGrantGateException: false } }, { id: "p1" })).canException).toBe(false);
  });
});

describe("status proposal decisions (review 19/10: D7)", () => {
  const row = () => ({ id: "sp-1", projectId: "p1", workspaceId: "w", fromStatus: "in_progress", proposedStatus: "on_hold", basis: [], status: "pending", createdAt: new Date() });
  function setup() {
    let current: any = row();
    const prisma = { projectStatusProposal: {
      findFirst: vi.fn(async () => ({ ...current })),
      updateMany: vi.fn(async ({ where, data }: any) => (current.status === where.status ? (current = { ...current, ...data }, { count: 1 }) : { count: 0 })),
      update: vi.fn(async ({ data }: any) => (current = { ...current, ...data }))
    } };
    const ctx = { prisma, principal: { workspaceId: "w", subjectId: "usr-pm" }, actor: { isPm: true, isAdmin: true } };
    return { ctx, prisma, current: () => current };
  }

  it("a confirm and a decline sent together: the second finds the proposal already decided", async () => {
    const { ctx } = setup();
    const apply = vi.fn(async () => undefined);
    await decideStatusProposal(ctx, "p1", "sp-1", { decision: "confirm" } as any, apply);
    // The decline was checked on a stale read: the conditional claim refuses it instead of overwriting "confirmed".
    await expect(decideStatusProposal({ ...ctx, prisma: { projectStatusProposal: { ...ctx.prisma.projectStatusProposal, findFirst: vi.fn(async () => row()) } } }, "p1", "sp-1", { decision: "decline", reason: "x" } as any, apply)).rejects.toThrow("đã được xử lý");
  });

  it("a confirm whose status change is refused leaves the proposal pending", async () => {
    const { ctx, current } = setup();
    await expect(decideStatusProposal(ctx, "p1", "sp-1", { decision: "confirm" } as any, async () => { throw new Error("cần lý do"); })).rejects.toThrow("cần lý do");
    expect(current().status).toBe("pending");
  });
});

describe("\"Không duyệt\" milestone mode on G1–G8", () => {
  const captureBaseline = gateHooks.captureBaseline;
  afterEach(() => { gateHooks.captureBaseline = captureBaseline; });
  const at = new Date("2026-10-28T03:00:00.000Z");
  function seedFree() {
    const stage = (id: string, milestoneId: string, sortOrder: number) => ({ id, workspaceId: "w", projectId: "p1", milestoneId, activity: id, stageKey: id, sortOrder, status: "in_progress", project: { milestoneApprovalRequired: false } });
    const gate = (id: string, code: string, stageId: string, milestoneId: string, sortOrder: number, status = "not_submitted") => ({ id, workspaceId: "w", projectId: "p1", milestoneId, stageId, code, status, sortOrder, history: [] });
    const task = (id: string, stageId: string, status: string) => ({ id, workspaceId: "w", projectId: "p1", stageId, status, archivedAt: null });
    return fakePrisma({
      project: [{ id: "p1", workspaceId: "w", accountId: "acc-1", status: "planning", milestoneApprovalRequired: false }],
      projectMilestone: [{ id: "m1", workspaceId: "w", projectId: "p1", sortOrder: 10, gateStatus: "open" }, { id: "m2", workspaceId: "w", projectId: "p1", sortOrder: 20, gateStatus: "open" }],
      // Intake has no gate of its own: G1 closes it together with Validate.
      projectStage: [stage("s-intake", "m1", 1), stage("s-validate", "m1", 2), stage("s-design", "m2", 3), stage("s-build", "m2", 4)],
      projectGate: [gate("g1", "G1", "s-validate", "m1", 1), gate("g2", "G2", "s-design", "m2", 2, "submitted"), gate("g3", "G3", "s-build", "m2", 3)],
      projectTask: [task("t1", "s-intake", "done"), task("t2", "s-validate", "done"), task("t3", "s-design", "cancelled"), task("t4", "s-build", "todo")]
    });
  }

  it("passes gates in order once their stages have no open task, approving the milestone a gate closes; a stage without tasks waits", async () => {
    const { prisma, table } = seedFree();
    gateHooks.captureBaseline = vi.fn();
    await autoPassStageGates(prisma, "w", "p1", "usr-1", at);
    expect(table("projectGate").map((gate) => gate.status)).toEqual(["approved", "approved", "not_submitted"]);
    expect(table("projectGate")[0]).toMatchObject({ decidedByUserId: "usr-1", decidedAt: at, history: [expect.objectContaining({ label: "Tự qua", toStatus: "approved" })] });
    expect(table("projectMilestone").map((milestone) => milestone.gateStatus)).toEqual(["approved", "open"]);
    expect(gateHooks.captureBaseline).toHaveBeenCalledTimes(2);
    expect((gateHooks.captureBaseline as any).mock.calls[0][0].gate.code).toBe("G1");

    table("projectTask")[3].archivedAt = at;
    await autoPassStageGates(prisma, "w", "p1", "usr-1", at);
    expect(table("projectGate")[2].status).toBe("not_submitted");
    Object.assign(table("projectTask")[3], { archivedAt: null, status: "done" });
    await autoPassStageGates(prisma, "w", "p1", "usr-1", at);
    expect(table("projectGate")[2].status).toBe("approved");
  });

  it("runs on every task change of the project", async () => {
    const { prisma, table } = seedFree();
    gateHooks.captureBaseline = vi.fn();
    await new MilestoneGatesService(prisma, new ProjectPermissionsService(prisma)).evaluateMilestoneGateForTask({ projectId: "p1", stageId: "s-validate" }, principal);
    expect(table("projectGate").map((gate) => gate.status)).toEqual(["approved", "approved", "not_submitted"]);
  });

  it("with review required, a task change on a G1–G8 project skips the milestone re-evaluation instead of failing into a warning", async () => {
    const { prisma, table } = seedFree();
    table("project")[0].milestoneApprovalRequired = true;
    const service = new MilestoneGatesService(prisma, new ProjectPermissionsService(prisma));
    const evaluate = vi.spyOn(service, "evaluateProjectMilestoneGate");
    const warn = vi.spyOn((service as any).logger, "warn");
    await service.evaluateMilestoneGateForTask({ projectId: "p1", stageId: "s-validate" }, principal);
    expect(evaluate).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(table("projectGate").map((gate) => gate.status)).toEqual(["not_submitted", "submitted", "not_submitted"]);
  });

  it("blocks no stage, offers no gate action and lists only the open tasks as missing", async () => {
    const { prisma, table } = seedFree();
    await expect(assertStageGateOpen(prisma, "w", "s-build", "log giờ")).resolves.toBeUndefined();
    table("projectStage").forEach((stage) => { stage.project = { milestoneApprovalRequired: true }; });
    await expect(assertStageGateOpen(prisma, "w", "s-build", "log giờ")).rejects.toThrow("Điểm chốt G2");

    const ctx = { prisma, principal, actor: { userId: "usr-director", isAdmin: true, isPm: true, isBd: false, isMember: true, canGrantGateException: true }, now: at } as any;
    const list = await listProjectGates(ctx, { id: "p1", milestoneApprovalRequired: false });
    expect(list).toMatchObject({ milestoneApprovalRequired: false, canException: false });
    expect(list.data.map((gate) => gate.allowedActions)).toEqual([[], [], []]);
    expect(list.data[2].missingRequirements).toEqual(["Còn 1 task của stage chưa hoàn thành."]);
    expect((await listProjectGates(ctx, { id: "p1" })).data[0].allowedActions).toContain("submit");
  });
});
