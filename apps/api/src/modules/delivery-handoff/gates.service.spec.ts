/** Review findings 5 and 6: the G7 exception, the one meaning of "gate passed", and the P&L hour gate as the only G7 data rule. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePrisma } from "./fake-prisma.testing";
import { gateHooks } from "./gates";
import { actOnProjectGate, listProjectGates } from "./gates.service";

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
