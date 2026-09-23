import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { resolveAnalyticsPolicy } from "./analytics-policy";
import { WorkforceAnalyticsService } from "./workforce-analytics.service";

const FROM = new Date("2026-07-01T17:00:00.000Z");
const TO = new Date("2026-08-01T17:00:00.000Z");

function principal(roleCodes: string[] = ["FOUNDER_GM"]): PrincipalContext {
  return {
    subjectType: "internal_user",
    subjectId: "viewer-1",
    tenantKey: "prod",
    workspaceId: "workspace-1",
    workspaceKey: "default",
    displayName: "Analytics Viewer",
    email: "viewer@example.com",
    roleCodes,
    accountIds: [],
    projectIds: [],
    customerAccountIds: [],
    customerProjectIds: [],
    roleVersion: "roles:test",
    grantVersion: "grants:test"
  } as PrincipalContext;
}

function filters(overrides: Record<string, unknown> = {}) {
  return {
    from: FROM.toISOString(),
    to: TO.toISOString(),
    timezone: "Asia/Ho_Chi_Minh",
    grain: "day",
    compare: "none",
    departmentIds: [],
    teamIds: [],
    userIds: [],
    accountIds: [],
    projectIds: [],
    projectStatuses: [],
    taskStatuses: [],
    workTypes: [],
    billable: "all",
    ...overrides
  };
}

function range() {
  return {
    from: FROM,
    to: TO,
    timezone: "Asia/Ho_Chi_Minh",
    grain: "day",
    compare: "none"
  };
}

function prismaMock() {
  return {
    account: { findMany: vi.fn().mockResolvedValue([]) },
    accountMember: { findMany: vi.fn().mockResolvedValue([]) },
    department: { findMany: vi.fn().mockResolvedValue([]) },
    project: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([])
    },
    projectMember: { findMany: vi.fn().mockResolvedValue([]) },
    projectTask: { groupBy: vi.fn().mockResolvedValue([]) },
    taskTimeEntry: { groupBy: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    workspaceMemberProfile: { findMany: vi.fn().mockResolvedValue([]) },
    workspaceTeam: { findMany: vi.fn().mockResolvedValue([]) },
    workspaceTeamMember: { findMany: vi.fn().mockResolvedValue([]) }
  };
}

describe("WorkforceAnalyticsService scope resolution", () => {
  it("uses OR within department/team selections and AND across person, department and team", async () => {
    const prisma = prismaMock();
    prisma.workspaceMemberProfile.findMany.mockResolvedValue([
      { userId: "department-only" },
      { userId: "both" }
    ]);
    prisma.workspaceTeamMember.findMany.mockResolvedValue([
      { userId: "team-only" },
      { userId: "both" }
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: "both" }, { id: "team-only" }]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal();

    const scope = await (service as any).resolveScope(
      resolveAnalyticsPolicy(viewer),
      viewer,
      filters({
        departmentIds: ["department-a", "department-b"],
        teamIds: ["team-a", "team-b"],
        userIds: ["both", "team-only"]
      }),
      range()
    );

    expect(prisma.workspaceMemberProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ departmentId: { in: ["department-a", "department-b"] } })
    }));
    expect(prisma.workspaceTeamMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: { in: ["team-a", "team-b"] } })
    }));
    expect(scope.userIds).toEqual(["both"]);
    expect(scope.emptyScope).toBe(false);
  });

  it("keeps every matching member when only one multi-select dimension is used", async () => {
    const prisma = prismaMock();
    prisma.workspaceMemberProfile.findMany.mockResolvedValue([
      { userId: "department-a-user" },
      { userId: "department-b-user" }
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: "department-a-user" }, { id: "department-b-user" }]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal();

    const scope = await (service as any).resolveScope(
      resolveAnalyticsPolicy(viewer),
      viewer,
      filters({ departmentIds: ["department-a", "department-b"] }),
      range()
    );

    expect(scope.userIds).toEqual(["department-a-user", "department-b-user"]);
  });

  it("rejects a requested person outside the authorized workspace workforce", async () => {
    const prisma = prismaMock();
    prisma.user.findMany.mockResolvedValue([{ id: "workspace-user" }]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal();

    const scope = await (service as any).resolveScope(
      resolveAnalyticsPolicy(viewer),
      viewer,
      filters({ userIds: ["other-workspace-user"] }),
      range()
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        status: "ACTIVE",
        subjectType: "INTERNAL_USER",
        roleBindings: { some: { workspaceId: "workspace-1", tenantKey: "prod", endsAt: null } }
      },
      select: { id: true }
    });
    expect(scope.userIds).toEqual([]);
    expect(scope.workforceUserIds).toEqual([]);
    expect(scope.emptyScope).toBe(true);
  });

  it("drops a stale project that does not belong to the selected workspace account", async () => {
    const prisma = prismaMock();
    prisma.account.findMany.mockResolvedValue([{ id: "account-a" }]);
    prisma.project.findMany.mockResolvedValue([]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal();

    const scope = await (service as any).resolveScope(
      resolveAnalyticsPolicy(viewer),
      viewer,
      filters({ accountIds: ["account-a"], projectIds: ["project-from-account-b"] }),
      range()
    );

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        id: { in: ["project-from-account-b"] },
        accountId: { in: ["account-a"] }
      },
      select: { id: true }
    });
    expect(scope.accountIds).toEqual(["account-a"]);
    expect(scope.projectIds).toEqual([]);
    expect(scope.emptyScope).toBe(true);
    expect(scope.warnings).toContain("scope_resolved_empty");
  });

  it("intersects selected accounts with the Delivery Lead's authorized projects", async () => {
    const prisma = prismaMock();
    prisma.projectMember.findMany
      .mockResolvedValueOnce([{ projectId: "project-a" }, { projectId: "project-b" }])
      .mockResolvedValueOnce([{ userId: "delivery-user" }]);
    prisma.account.findMany.mockResolvedValue([{ id: "account-a" }]);
    prisma.project.findMany.mockResolvedValue([{ id: "project-a" }]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal(["DELIVERY_LEAD"]);

    const scope = await (service as any).resolveScope(
      resolveAnalyticsPolicy(viewer),
      viewer,
      filters({ accountIds: ["account-a"] }),
      range()
    );

    expect(prisma.projectMember.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        workspaceId: "workspace-1",
        userId: "viewer-1",
        relation: { in: ["delivery_lead", "project_lead", "owner"], mode: "insensitive" }
      },
      select: { projectId: true }
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        id: { in: ["project-a", "project-b"] },
        accountId: { in: ["account-a"] }
      },
      select: { id: true }
    });
    expect(scope.projectIds).toEqual(["project-a"]);
    expect(scope.workforceUserIds).toEqual(["delivery-user"]);
  });

  it("keeps Delivery Lead scope empty when no managed relation exists", async () => {
    const prisma = prismaMock();
    prisma.projectMember.findMany.mockResolvedValue([]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal(["DELIVERY_LEAD"]);

    const scope = await (service as any).resolveScope(
      resolveAnalyticsPolicy(viewer),
      viewer,
      filters(),
      range()
    );

    expect(scope.projectIds).toEqual([]);
    expect(scope.workforceUserIds).toEqual([]);
    expect(scope.emptyScope).toBe(true);
  });

  it.each(["FINANCE_ADMIN", "SALES_OWNER"])("rejects identity filters for %s", async (roleCode) => {
    const prisma = prismaMock();
    const service = new WorkforceAnalyticsService(prisma as never);

    await expect(service.summary({
      from: FROM.toISOString(),
      to: TO.toISOString(),
      userId: "known-user"
    }, principal([roleCode]))).rejects.toThrow("user, department and team filters are not authorized");

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("returns no identity breakdown and sanitizes meta for Finance", async () => {
    const prisma = prismaMock();
    prisma.user.findMany.mockResolvedValue([{ id: "finance-user" }]);
    const service = new WorkforceAnalyticsService(prisma as never);

    const response = await service.breakdown({
      from: FROM.toISOString(),
      to: TO.toISOString(),
      by: "department"
    }, principal(["FINANCE_ADMIN"]));

    expect(response.rows).toEqual([]);
    expect(response.meta.warnings).toContain("identity_breakdown_not_authorized");
    expect(response.meta.filters.userIds).toEqual([]);
    expect(response.meta.filters.departmentIds).toEqual([]);
    expect(response.meta.filters.teamIds).toEqual([]);
  });

  it("does not query or build workspace groups for an empty workforce scope", async () => {
    const prisma = prismaMock();
    const service = new WorkforceAnalyticsService(prisma as never);
    const policy = resolveAnalyticsPolicy(principal());

    const result = await (service as any).buildMembershipBreakdowns(
      {} as never,
      {
        policy,
        workspaceId: "workspace-1",
        userIds: [],
        workforceUserIds: [],
        emptyScope: true,
        warnings: ["scope_resolved_empty"]
      },
      range(),
      "workspace-1"
    );

    expect(result).toEqual({ departments: [], teams: [], suppressedGroups: 0 });
    expect(prisma.department.findMany).not.toHaveBeenCalled();
    expect(prisma.workspaceTeam.findMany).not.toHaveBeenCalled();
    expect(prisma.workspaceMemberProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.workspaceTeamMember.findMany).not.toHaveBeenCalled();
  });
});

describe("WorkforceAnalyticsService filter facets", () => {
  it("scopes project, task and work-type counts to authorized dimensions and date range", async () => {
    const prisma = prismaMock();
    prisma.department.findMany.mockResolvedValue([{ id: "department-1", name: "Delivery" }]);
    prisma.workspaceTeam.findMany.mockResolvedValue([{ id: "team-1", name: "Implementation" }]);
    prisma.user.findMany.mockResolvedValue([{ id: "user-1", displayName: "User One" }]);
    prisma.account.findMany.mockResolvedValue([{ id: "account-1", name: "Account One" }]);
    prisma.project.findMany.mockResolvedValue([{ id: "project-1", name: "Project One", accountId: "account-1", status: "active" }]);
    prisma.project.groupBy.mockResolvedValue([{ status: "active", _count: { _all: 1 } }]);
    prisma.projectTask.groupBy.mockResolvedValue([{ status: "in_progress", _count: { _all: 2 } }]);
    prisma.taskTimeEntry.groupBy.mockResolvedValue([{ workType: "delivery", _count: { _all: 3 } }]);
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal();
    const policy = resolveAnalyticsPolicy(viewer);
    const scope = {
      policy,
      workspaceId: "workspace-1",
      projectIds: ["project-1"],
      userIds: ["user-1"],
      accountIds: ["account-1"],
      workforceUserIds: ["user-1"],
      emptyScope: false,
      warnings: []
    };

    const result = await (service as any).buildFilterOptions(
      scope,
      "workspace-1",
      filters({ billable: "billable" }),
      range()
    );

    const projectWhere = {
      workspaceId: "workspace-1",
      id: { in: ["project-1"] },
      accountId: { in: ["account-1"] }
    };
    expect(prisma.project.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: projectWhere,
      _count: { _all: true }
    });
    expect(prisma.projectTask.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: {
        workspaceId: "workspace-1",
        archivedAt: null,
        cancelledAt: null,
        status: { not: "cancelled" },
        createdAt: { lt: TO },
        OR: [{ completedAt: null }, { completedAt: { gte: FROM } }],
        subtasks: { none: {} },
        projectId: { in: ["project-1"] },
        assigneeUserId: { in: ["user-1"] },
        accountId: { in: ["account-1"] }
      },
      _count: { _all: true }
    });
    expect(prisma.taskTimeEntry.groupBy).toHaveBeenCalledWith({
      by: ["workType"],
      where: {
        workspaceId: "workspace-1",
        projectId: { in: ["project-1"] },
        userId: { in: ["user-1"] },
        accountId: { in: ["account-1"] },
        billable: true,
        OR: [
          { startAt: { gte: FROM, lt: TO } },
          { startAt: null, workDate: { gte: FROM, lt: TO } }
        ]
      },
      _count: { _all: true }
    });
    expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: "workspace-1",
        id: { in: ["account-1"] },
        projects: { some: { workspaceId: "workspace-1", id: { in: ["project-1"] } } }
      }
    }));
    expect(result.projectStatuses).toEqual([{ id: "active", label: "active", count: 1 }]);
    expect(result.taskStatuses).toEqual([{ id: "in_progress", label: "in_progress", count: 2 }]);
    expect(result.workTypes).toEqual([{ id: "delivery", label: "delivery", count: 3 }]);
  });

  it("does not expose workforce dimensions when user breakdown is forbidden", async () => {
    const prisma = prismaMock();
    const service = new WorkforceAnalyticsService(prisma as never);
    const viewer = principal(["SALES_OWNER"]);
    const policy = resolveAnalyticsPolicy(viewer);

    const result = await (service as any).buildFilterOptions(
      {
        policy,
        workspaceId: "workspace-1",
        accountIds: ["account-1"],
        workforceUserIds: [],
        emptyScope: false,
        warnings: []
      },
      "workspace-1",
      filters({ accountIds: ["account-1"] }),
      range()
    );

    expect(prisma.department.findMany).not.toHaveBeenCalled();
    expect(prisma.workspaceTeam.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(result.departments).toEqual([]);
    expect(result.teams).toEqual([]);
    expect(result.users).toEqual([]);
  });
});
