import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { AnalyticsMetricKey, PrincipalContext } from "@b2b-crm/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkforceAnalyticsService } from "./workforce-analytics.service";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.slice(1);
  } catch {
    return "";
  }
})();
const safeDatabase = /(?:^|[_-])(ci|test)(?:$|[_-])/i.test(databaseName);
const runId = `workforce-analytics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FROM = "2026-07-01T17:00:00.000Z";
const TO = "2026-08-01T17:00:00.000Z";

describe.runIf(safeDatabase)("workforce analytics workspace and role isolation", () => {
  const prisma = new PrismaClient();
  const service = new WorkforceAnalyticsService(prisma as never);
  const tenantKey = `${runId}-tenant`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.tenantWorkspace.create({ data: { tenantKey, workspaceKey: "a", name: `${runId} A` } }),
      prisma.tenantWorkspace.create({ data: { tenantKey, workspaceKey: "b", name: `${runId} B` } })
    ]);
    ids.workspaceA = workspaceA.id;
    ids.workspaceB = workspaceB.id;

    // The binding only establishes active workspace membership. Policy roles
    // come from each explicit PrincipalContext below, so a run-unique role
    // avoids cross-file upsert races in parallel integration execution.
    const membershipRole = await prisma.role.create({
      data: { code: `${runId}-MEMBER`, name: "Analytics integration member", type: "BUSINESS" }
    });
    ids.membershipRole = membershipRole.id;

    const users = await Promise.all([
      ["founderA", "Founder A"],
      ["founderB", "Founder B"],
      ["financeA", "Finance A"],
      ["salesA", "Sales A"],
      ["deliveryLeadA", "Delivery Lead A"],
      ["deliveryMemberA", "Delivery Member A"],
      ["sharedWorker", "Shared Worker"]
    ].map(async ([key, displayName]) => {
      const user = await prisma.user.create({
        data: { email: `${runId}-${key}@example.test`, displayName }
      });
      ids[key] = user.id;
      return user;
    }));
    expect(users).toHaveLength(7);

    await prisma.roleBinding.createMany({
      data: [
        { userId: ids.founderA, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceA },
        { userId: ids.founderB, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceB },
        { userId: ids.financeA, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceA },
        { userId: ids.salesA, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceA },
        { userId: ids.deliveryLeadA, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceA },
        { userId: ids.deliveryMemberA, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceA },
        { userId: ids.sharedWorker, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceA },
        { userId: ids.sharedWorker, roleId: ids.membershipRole, tenantKey, workspaceId: ids.workspaceB }
      ]
    });

    const [accountA, accountB] = await Promise.all([
      prisma.account.create({
        data: { workspaceId: ids.workspaceA, code: `${runId}-A`, name: "Analytics Account A", stage: "active", picUserId: ids.salesA }
      }),
      prisma.account.create({
        data: { workspaceId: ids.workspaceB, code: `${runId}-B`, name: "Analytics Account B", stage: "active" }
      })
    ]);
    ids.accountA = accountA.id;
    ids.accountB = accountB.id;

    const [managedProjectA, memberProjectA, projectB] = await Promise.all([
      prisma.project.create({
        data: { workspaceId: ids.workspaceA, accountId: ids.accountA, code: `${runId}-managed`, name: "Managed A", status: "active" }
      }),
      prisma.project.create({
        data: { workspaceId: ids.workspaceA, accountId: ids.accountA, code: `${runId}-member`, name: "Member-only A", status: "active" }
      }),
      prisma.project.create({
        data: { workspaceId: ids.workspaceB, accountId: ids.accountB, code: `${runId}-b`, name: "Project B", status: "active" }
      })
    ]);
    ids.managedProjectA = managedProjectA.id;
    ids.memberProjectA = memberProjectA.id;
    ids.projectB = projectB.id;

    await prisma.projectMember.createMany({
      data: [
        { workspaceId: ids.workspaceA, projectId: ids.managedProjectA, userId: ids.deliveryLeadA, relation: "Project_Lead" },
        { workspaceId: ids.workspaceA, projectId: ids.managedProjectA, userId: ids.sharedWorker, relation: "member" },
        { workspaceId: ids.workspaceA, projectId: ids.memberProjectA, userId: ids.deliveryLeadA, relation: "member" },
        { workspaceId: ids.workspaceA, projectId: ids.memberProjectA, userId: ids.deliveryMemberA, relation: "member" },
        { workspaceId: ids.workspaceA, projectId: ids.memberProjectA, userId: ids.sharedWorker, relation: "member" },
        { workspaceId: ids.workspaceB, projectId: ids.projectB, userId: ids.sharedWorker, relation: "owner" }
      ]
    });

    const tasks = await Promise.all([
      ["taskManagedA", ids.workspaceA, ids.accountA, ids.managedProjectA, "Managed A task"],
      ["taskMemberA", ids.workspaceA, ids.accountA, ids.memberProjectA, "Member A task"],
      ["taskB", ids.workspaceB, ids.accountB, ids.projectB, "Workspace B task"]
    ].map(async ([key, workspaceId, accountId, projectId, title]) => {
      const task = await prisma.projectTask.create({
        data: { workspaceId, accountId, projectId, title, status: "completed", completedAt: new Date("2026-07-10T02:00:00.000Z") }
      });
      ids[key] = task.id;
      return task;
    }));
    expect(tasks).toHaveLength(3);

    await prisma.taskTimeEntry.createMany({
      data: [
        {
          workspaceId: ids.workspaceA, taskId: ids.taskManagedA, accountId: ids.accountA,
          projectId: ids.managedProjectA, userId: ids.sharedWorker, workDate: new Date("2026-07-09T17:00:00.000Z"),
          startAt: new Date("2026-07-10T02:00:00.000Z"), minutes: 60, approvalStatus: "approved",
          reviewedAt: new Date("2026-07-10T04:00:00.000Z"), reviewedByUserId: ids.deliveryLeadA
        },
        {
          workspaceId: ids.workspaceA, taskId: ids.taskMemberA, accountId: ids.accountA,
          projectId: ids.memberProjectA, userId: ids.sharedWorker, workDate: new Date("2026-07-10T17:00:00.000Z"),
          startAt: new Date("2026-07-11T02:00:00.000Z"), minutes: 45, approvalStatus: "approved",
          reviewedAt: new Date("2026-07-11T04:00:00.000Z"), reviewedByUserId: ids.deliveryLeadA
        },
        {
          workspaceId: ids.workspaceB, taskId: ids.taskB, accountId: ids.accountB,
          projectId: ids.projectB, userId: ids.sharedWorker, workDate: new Date("2026-07-11T17:00:00.000Z"),
          startAt: new Date("2026-07-12T02:00:00.000Z"), minutes: 180, approvalStatus: "approved",
          reviewedAt: new Date("2026-07-12T04:00:00.000Z"), reviewedByUserId: ids.founderB
        }
      ]
    });

    const department = await prisma.department.create({
      data: { workspaceId: ids.workspaceA, code: `${runId}-delivery`, name: "Delivery A" }
    });
    ids.departmentA = department.id;
    await prisma.workspaceMemberProfile.create({
      data: {
        workspaceId: ids.workspaceA,
        userId: ids.sharedWorker,
        departmentId: ids.departmentA,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z")
      }
    });

    await prisma.resourceCapacityPeriod.createMany({
      data: [
        {
          workspaceId: ids.workspaceA, userId: ids.sharedWorker,
          periodStart: new Date(FROM), periodEnd: new Date(TO), availableMinutes: 1000
        },
        {
          workspaceId: ids.workspaceB, userId: ids.sharedWorker,
          periodStart: new Date(FROM), periodEnd: new Date(TO), availableMinutes: 2000
        }
      ]
    });
  });

  afterAll(async () => {
    if (!safeDatabase) return;
    const workspaceIds = [ids.workspaceA, ids.workspaceB].filter(Boolean);
    const projectIds = [ids.managedProjectA, ids.memberProjectA, ids.projectB].filter(Boolean);
    const taskIds = [ids.taskManagedA, ids.taskMemberA, ids.taskB].filter(Boolean);
    const userIds = [
      ids.founderA, ids.founderB, ids.financeA, ids.salesA, ids.deliveryLeadA,
      ids.deliveryMemberA, ids.sharedWorker
    ].filter(Boolean);

    await prisma.resourceCapacityPeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspaceMemberProfile.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.department.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.taskTimeEntry.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.projectMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.projectTask.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.account.deleteMany({ where: { id: { in: [ids.accountA, ids.accountB].filter(Boolean) } } });
    await prisma.roleBinding.deleteMany({ where: { tenantKey } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenantWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
    if (ids.membershipRole) await prisma.role.deleteMany({ where: { id: ids.membershipRole } });
    await prisma.$disconnect();
  });

  function principal(key: string, workspace: "A" | "B", roleCodes: string[], subjectType: PrincipalContext["subjectType"] = "internal_user"): PrincipalContext {
    return {
      subjectType,
      subjectId: ids[key],
      displayName: key,
      email: `${runId}-${key}@example.test`,
      tenantKey,
      workspaceId: workspace === "A" ? ids.workspaceA : ids.workspaceB,
      workspaceKey: workspace.toLowerCase(),
      roleCodes,
      accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [],
      roleVersion: "test", grantVersion: "test"
    } as PrincipalContext;
  }

  const query = { from: FROM, to: TO, timezone: "Asia/Ho_Chi_Minh", grain: "day", compare: "none" };

  it("isolates populated workspaces and reconciles summary, series, breakdown and full export", async () => {
    const summaryA = await service.summary(query, principal("founderA", "A", ["FOUNDER_GM"]));
    const summaryB = await service.summary(query, principal("founderB", "B", ["FOUNDER_GM"]));
    const reviewedA = metric(summaryA.totals, "reviewedApprovedMinutes");
    const reviewedB = metric(summaryB.totals, "reviewedApprovedMinutes");

    expect(reviewedA).toBe(105);
    expect(reviewedB).toBe(180);
    expect(summaryA.series.reduce((sum, bucket) => sum + bucket.reviewedApprovedMinutes, 0)).toBe(reviewedA);
    expect(summaryA.breakdowns.projects.reduce((sum, row) => sum + Number(row.metrics.reviewedApprovedMinutes ?? 0), 0)).toBe(reviewedA);
    expect(summaryA.breakdowns.projects.map((row) => row.label).sort()).toEqual(["Managed A", "Member-only A"]);
    expect(summaryA.breakdowns.projects.some((row) => row.label === "Project B")).toBe(false);

    const exported = await service.export(query, principal("founderA", "A", ["FOUNDER_GM"]));
    expect(exported.breakdowns.projects).toHaveLength(2);
    expect(metric(exported.totals, "reviewedApprovedMinutes")).toBe(reviewedA);
  });

  it("keeps Finance and Sales aggregate-only and rejects identity probes", async () => {
    for (const viewer of [
      principal("financeA", "A", ["FINANCE_ADMIN"]),
      principal("salesA", "A", ["SALES_OWNER"])
    ]) {
      await expect(service.summary({ ...query, userId: ids.sharedWorker }, viewer)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.summary({ ...query, departmentId: ids.departmentA }, viewer)).rejects.toBeInstanceOf(BadRequestException);

      const summary = await service.summary(query, viewer);
      expect(summary.breakdowns.users).toEqual([]);
      expect(summary.breakdowns.departments).toEqual([]);
      expect(summary.breakdowns.teams).toEqual([]);
      expect(summary.filterOptions.users).toEqual([]);
      expect(summary.filterOptions.departments).toEqual([]);
      expect(summary.filterOptions.teams).toEqual([]);

      const groupBreakdown = await service.breakdown({ ...query, by: "team" }, viewer);
      expect(groupBreakdown.rows).toEqual([]);
      expect(groupBreakdown.meta.filters.userIds).toEqual([]);
      expect(groupBreakdown.meta.filters.departmentIds).toEqual([]);
      expect(groupBreakdown.meta.filters.teamIds).toEqual([]);
    }

    await expect(service.summary(query, principal("salesA", "A", ["SALES_OWNER"], "portal_user")))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("uses only managed relations for Delivery Lead and never falls back to workspace groups on empty scope", async () => {
    const leadSummary = await service.summary(query, principal("deliveryLeadA", "A", ["DELIVERY_LEAD"]));
    expect(metric(leadSummary.totals, "reviewedApprovedMinutes")).toBe(60);
    expect(leadSummary.breakdowns.projects.map((row) => row.label)).toEqual(["Managed A"]);

    const memberOnly = await service.summary(query, principal("deliveryMemberA", "A", ["DELIVERY_LEAD"]));
    expect(metric(memberOnly.totals, "reviewedApprovedMinutes")).toBe(0);
    expect(memberOnly.breakdowns.users).toEqual([]);
    expect(memberOnly.breakdowns.projects).toEqual([]);
    expect(memberOnly.breakdowns.departments).toEqual([]);
    expect(memberOnly.breakdowns.teams).toEqual([]);
    expect(memberOnly.meta.warnings).toContain("scope_resolved_empty");
  });

  it("uses only capacity periods assigned to the principal workspace", async () => {
    const [summaryA, summaryB] = await Promise.all([
      service.summary(query, principal("founderA", "A", ["FOUNDER_GM"])),
      service.summary(query, principal("founderB", "B", ["FOUNDER_GM"]))
    ]);
    expect(metric(summaryA.totals, "capacityMinutes")).toBe(1000);
    expect(metric(summaryB.totals, "capacityMinutes")).toBe(2000);
  });
});

function metric(
  totals: Array<{ key: AnalyticsMetricKey; value: number | null }>,
  key: AnalyticsMetricKey
): number | null {
  return totals.find((item) => item.key === key)?.value ?? null;
}
