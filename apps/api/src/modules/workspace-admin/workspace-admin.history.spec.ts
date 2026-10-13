import { describe, expect, it, vi } from "vitest";
import { WorkspaceAdminService } from "./workspace-admin.service";

const admin = { subjectId: "u1", subjectType: "internal_user", workspaceId: "w1", roleCodes: ["WORKSPACE_ADMIN"] } as any;

function setup(total = 0) {
  const findMany = vi.fn().mockResolvedValue([]);
  const none = { findMany: vi.fn().mockResolvedValue([]) };
  const prisma = {
    auditEvent: { findMany, count: vi.fn().mockResolvedValue(total) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: "u9" }]) },
    projectMilestone: { findMany: vi.fn().mockResolvedValue([{ id: "m1" }]) },
    projectMilestoneTemplate: none, workspaceDayOff: none, pnlPeriod: none
  };
  return { service: new (WorkspaceAdminService as any)(prisma) as WorkspaceAdminService, findMany, prisma };
}

describe("WorkspaceAdminService.history filters", () => {
  it("keeps the old defaults: all admin actions, newest first, no offset", async () => {
    const { service, findMany } = setup(3);
    const result = await service.history(admin, 50);
    const args = findMany.mock.calls[0][0];
    expect(args.where.action.in).toContain("project.milestone_approved");
    expect(args.where.action.in).toHaveLength(11);
    expect([args.take, args.skip]).toEqual([50, 0]);
    expect(result.meta.total).toBe(3);
    expect(result.meta.actions).toHaveLength(11);
  });

  it("filters by day range, actors, category and action, and pages with offset", async () => {
    const { service, findMany } = setup(120);
    const result = await service.history(admin, 999, "all", { from: "2026-10-01", to: "2026-10-03", actorUserId: "u1,u2", category: "pnl,day_off", action: "pnl.period_locked,workspace.day_off_created,project.milestone_approved", offset: "50" });
    const { where, take, skip } = findMany.mock.calls[0][0];
    expect(where.action.in).toEqual(["workspace.day_off_created", "pnl.period_locked"]);
    expect(where.actorUserId).toEqual({ in: ["u1", "u2"] });
    expect(where.createdAt).toEqual({ gte: new Date("2026-09-30T17:00:00.000Z"), lt: new Date("2026-10-03T17:00:00.000Z") });
    expect([take, skip]).toEqual([50, 50]);
    expect(result.meta.pagination).toMatchObject({ offset: 50, total: 120, hasNextPage: true });
  });

  it("q matches action titles, actors and touched records", async () => {
    const { service, findMany } = setup();
    await service.history(admin, 50, "all", { q: "khóa kỳ" });
    const or = findMany.mock.calls[0][0].where.AND[0].OR;
    expect(or[0]).toEqual({ action: { in: ["pnl.period_locked"] } });
    expect(or[1]).toEqual({ actorUserId: { in: ["u9"] } });
    expect(or[2]).toEqual({ resourceId: { in: ["m1"] } });
  });

  it("scope=mine stays the caller's own approvals whatever actor is asked for", async () => {
    const { service, findMany } = setup();
    await service.history(admin, 12, "mine", { actorUserId: "u2" });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ actorUserId: "u1", action: "project.milestone_approved" });
  });
});
