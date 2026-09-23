import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectsService } from "./delivery-handoff/projects.service";
import { AuthService } from "./identity-access/auth.service";
import { ResourceControlsService } from "./resource-controls/resource-controls.service";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.slice(1);
  } catch {
    return "";
  }
})();
const safeDatabase = /(?:^|[_-])(ci|test)(?:$|[_-])/i.test(databaseName);
const runId = `workspace-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.runIf(safeDatabase)("two-workspace isolation", () => {
  const prisma = new PrismaClient();
  const tenantKey = `${runId}-tenant`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.tenantWorkspace.create({ data: { tenantKey, workspaceKey: "a", name: `${runId} A` } }),
      prisma.tenantWorkspace.create({ data: { tenantKey, workspaceKey: "b", name: `${runId} B` } })
    ]);
    ids.workspaceA = workspaceA.id;
    ids.workspaceB = workspaceB.id;

    const role = await prisma.role.upsert({
      where: { code: "DELIVERY_LEAD" },
      update: {},
      create: { code: "DELIVERY_LEAD", name: "Delivery Lead", type: "BUSINESS" }
    });
    ids.role = role.id;
    const [userA, userB, sharedUser] = await Promise.all([
      prisma.user.create({ data: { email: `${runId}-a@example.test`, displayName: "Workspace A User" } }),
      prisma.user.create({ data: { email: `${runId}-b@example.test`, displayName: "Workspace B User" } }),
      prisma.user.create({ data: { email: `${runId}-shared@example.test`, displayName: "Shared User" } })
    ]);
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.sharedUser = sharedUser.id;

    await prisma.roleBinding.createMany({
      data: [
        { userId: userA.id, roleId: role.id, tenantKey, workspaceId: workspaceA.id },
        { userId: userB.id, roleId: role.id, tenantKey, workspaceId: workspaceB.id },
        { userId: sharedUser.id, roleId: role.id, tenantKey, workspaceId: workspaceA.id },
        { userId: sharedUser.id, roleId: role.id, tenantKey, workspaceId: workspaceB.id }
      ]
    });

    // The principal's claimed Founder role must also exist in the database.
    const founderRole = await prisma.role.upsert({
      where: { code: "FOUNDER_GM" }, update: {},
      create: { code: "FOUNDER_GM", name: "Founder", type: "BUSINESS" }
    });
    await prisma.roleBinding.create({ data: {
      userId: userA.id, roleId: founderRole.id, tenantKey, workspaceId: workspaceA.id
    } });

    const [accountA, accountB] = await Promise.all([
      prisma.account.create({ data: { workspaceId: workspaceA.id, code: `${runId}-A`, name: "Account A", stage: "active" } }),
      prisma.account.create({ data: { workspaceId: workspaceB.id, code: `${runId}-B`, name: "Account B", stage: "active" } })
    ]);
    ids.accountA = accountA.id;
    ids.accountB = accountB.id;
    const [projectA, projectB] = await Promise.all([
      prisma.project.create({
        data: { workspaceId: workspaceA.id, accountId: accountA.id, code: `${runId}-PA`, name: "Project A", status: "planning" }
      }),
      prisma.project.create({
        data: { workspaceId: workspaceB.id, accountId: accountB.id, code: `${runId}-PB`, name: "Project B", status: "planning" }
      })
    ]);
    ids.projectA = projectA.id;
    ids.projectB = projectB.id;
    // Valid self logging requires explicit project membership, not merely a workspace role.
    await prisma.projectMember.createMany({ data: [
      { workspaceId: workspaceA.id, projectId: projectA.id, userId: userA.id, relation: "member" },
      { workspaceId: workspaceB.id, projectId: projectB.id, userId: userB.id, relation: "member" }
    ] });


    const [taskA, taskB] = await Promise.all([
      prisma.projectTask.create({
        data: {
          workspaceId: workspaceA.id,
          accountId: accountA.id,
          projectId: projectA.id,
          title: `${runId} Task A`,
          status: "todo",
          estimateMinutes: 240
        }
      }),
      prisma.projectTask.create({
        data: {
          workspaceId: workspaceB.id,
          accountId: accountB.id,
          projectId: projectB.id,
          title: `${runId} Task B`,
          status: "todo"
        }
      })
    ]);
    ids.taskA = taskA.id;
    ids.taskB = taskB.id;

    ids.sessionTokenA = `${runId}-session-a`;
    ids.sessionTokenB = `${runId}-session-b`;
    await prisma.portalSession.createMany({
      data: [
        {
          userId: sharedUser.id,
          tenantKey,
          workspaceId: workspaceA.id,
          tokenHash: ids.sessionTokenA,
          roleVersion: "test",
          grantVersion: "test",
          expiresAt: new Date("2099-01-01T00:00:00.000Z")
        },
        {
          userId: sharedUser.id,
          tenantKey,
          workspaceId: workspaceB.id,
          tokenHash: ids.sessionTokenB,
          roleVersion: "test",
          grantVersion: "test",
          expiresAt: new Date("2099-01-01T00:00:00.000Z")
        }
      ]
    });
  });

  afterAll(async () => {
    if (!safeDatabase) return;
    const workspaceIds = [ids.workspaceA, ids.workspaceB].filter(Boolean);
    const taskIds = [ids.taskA, ids.taskB].filter(Boolean);
    const projectIds = [ids.projectA, ids.projectB].filter(Boolean);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.portalSession.deleteMany({ where: { tokenHash: { in: [ids.sessionTokenA, ids.sessionTokenB].filter(Boolean) } } });
    await prisma.taskTimeEntry.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskPlanningBlock.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.projectActivity.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.resourceAllocation.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB].filter(Boolean) } } });
    await prisma.projectMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.projectTask.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.account.deleteMany({ where: { id: { in: [ids.accountA, ids.accountB].filter(Boolean) } } });
    await prisma.roleBinding.deleteMany({ where: { tenantKey } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB, ids.sharedUser].filter(Boolean) } } });
    await prisma.tenantWorkspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  function principalA(): PrincipalContext {
    return {
      subjectType: "internal_user",
      subjectId: ids.userA,
      displayName: "Workspace A User",
      email: `${runId}-a@example.test`,
      tenantKey,
      workspaceId: ids.workspaceA,
      workspaceKey: "a",
      roleCodes: ["FOUNDER_GM", "DELIVERY_LEAD"],
      accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [],
      roleVersion: "test", grantVersion: "test"
    };
  }

  it("allows the same global user and role in two workspaces after the contract migration", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'RoleBinding'
        AND indexname IN (
          'RoleBinding_userId_roleId_tenantKey_key',
          'RoleBinding_userId_roleId_tenantKey_workspaceId_key'
        )
    `;
    expect(indexes.map((row) => row.indexname)).toEqual([
      "RoleBinding_userId_roleId_tenantKey_workspaceId_key"
    ]);

    const bindings = await prisma.roleBinding.findMany({
      where: { userId: ids.sharedUser, roleId: ids.role, tenantKey },
      orderBy: { workspaceId: "asc" }
    });
    expect(bindings).toHaveLength(2);
    expect(bindings.map((binding) => binding.workspaceId).sort()).toEqual([
      ids.workspaceA,
      ids.workspaceB
    ].sort());
  });

  it("returns only users with membership in the principal workspace", async () => {
    const principal = principalA();
    const auth = new AuthService(
      prisma as any,
      { resolveWorkspace: async () => ({ tenantKey, workspaceId: ids.workspaceA, workspaceKey: "a" }) } as any,
      { resolveFromAuthorization: async () => principal } as any
    );
    const response = await auth.listUsers("Bearer integration");
    expect(response.data.map((user) => user.id).sort()).toEqual([ids.sharedUser, ids.userA].sort());
    expect(response.data.some((user) => user.id === ids.userB)).toBe(false);
    await expect(auth.getUser("Bearer integration", ids.userB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("excludes workspace-B capacity and rejects cross-workspace allocation targets", async () => {
    const service = new ResourceControlsService(prisma as any);
    const principal = principalA();
    const capacity = await service.capacitySummary({
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-08T00:00:00.000Z"
    }, principal);
    expect(capacity.data.map((item) => item.userId).sort()).toEqual([ids.sharedUser, ids.userA].sort());
    expect(capacity.data.some((item) => item.userId === ids.userB)).toBe(false);

    const before = await prisma.resourceAllocation.count({ where: { workspaceId: ids.workspaceA } });
    await expect(service.createAllocation({
      accountId: ids.accountB,
      projectId: ids.projectB,
      userId: ids.userA,
      role: "Consultant",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-08T00:00:00.000Z"
    }, principal)).rejects.toBeInstanceOf(NotFoundException);
    await expect(prisma.resourceAllocation.count({ where: { workspaceId: ids.workspaceA } })).resolves.toBe(before);
  });

  it("rejects a workspace-B project member before creating a workspace-A project", async () => {
    const service = new ProjectsService(prisma as any);
    const before = await prisma.project.count({ where: { workspaceId: ids.workspaceA } });
    await expect(service.createProject({
      accountId: ids.accountA,
      name: "Rejected cross-workspace project",
      memberUserIds: [ids.userB],
      createStageTemplate: false
    }, principalA())).rejects.toBeInstanceOf(BadRequestException);
    await expect(prisma.project.count({ where: { workspaceId: ids.workspaceA } })).resolves.toBe(before);
  });

  it("rejects a workspace-B task assignee before creating the workspace-A task", async () => {
    const service = new ProjectsService(prisma as any);
    const before = await prisma.projectTask.count({ where: { workspaceId: ids.workspaceA } });
    await expect(service.createTask({
      accountId: ids.accountA,
      projectId: ids.projectA,
      title: "Rejected cross-workspace assignment",
      assigneeUserId: ids.userB
    }, principalA(), ids.userA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(prisma.projectTask.count({ where: { workspaceId: ids.workspaceA } })).resolves.toBe(before);
  });

  it("revokes only workspace-A sessions and preserves the shared user's workspace-B session", async () => {
    const principal = principalA();
    const auth = new AuthService(
      prisma as any,
      { resolveWorkspace: async () => ({ tenantKey, workspaceId: ids.workspaceA, workspaceKey: "a" }) } as any,
      { resolveFromAuthorization: async () => principal } as any
    );

    await expect(auth.revokeUserSessions("Bearer integration", ids.sharedUser)).resolves.toMatchObject({
      userId: ids.sharedUser,
      revokedSessions: 1
    });
    const [sessionA, sessionB] = await Promise.all([
      prisma.portalSession.findUniqueOrThrow({ where: { tokenHash: ids.sessionTokenA } }),
      prisma.portalSession.findUniqueOrThrow({ where: { tokenHash: ids.sessionTokenB } })
    ]);
    expect(sessionA.revokedAt).toBeInstanceOf(Date);
    expect(sessionB.revokedAt).toBeNull();
  });

  it("allows workspace-A planning writes and rejects workspace-B planning users without changing counts", async () => {
    const service = new ProjectsService(prisma as any);
    const before = await prisma.taskPlanningBlock.count({ where: { workspaceId: ids.workspaceA } });
    const baselineTask = await prisma.projectTask.findUniqueOrThrow({ where: { id: ids.taskA } });
    expect(baselineTask.estimateMinutes).toBe(240);
    const input = {
      startAt: "2026-07-20T01:00:00.000Z",
      endAt: "2026-07-20T03:00:00.000Z",
      plannedMinutes: 120
    };

    await expect(service.createTaskPlanningBlock(ids.taskA, {
      ...input,
      userId: ids.userB,
      title: "Foreign planning user"
    }, principalA(), ids.userA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(prisma.taskPlanningBlock.count({ where: { workspaceId: ids.workspaceA } })).resolves.toBe(before);
    await expect(prisma.projectTask.findUniqueOrThrow({ where: { id: ids.taskA } })).resolves.toMatchObject({
      estimateMinutes: 240
    });

    const created = await service.createTaskPlanningBlock(ids.taskA, {
      ...input,
      userId: ids.userA,
      title: "Workspace A plan"
    }, principalA(), ids.userA);
    const persisted = await prisma.taskPlanningBlock.findUniqueOrThrow({ where: { id: created.id } });
    expect(persisted).toMatchObject({
      workspaceId: ids.workspaceA,
      taskId: ids.taskA,
      userId: ids.userA,
      plannedMinutes: 120
    });
    await expect(prisma.projectTask.findUniqueOrThrow({ where: { id: ids.taskA } })).resolves.toMatchObject({
      estimateMinutes: 240
    });

    const transitionInput = {
      status: "completed" as const,
      expectedUpdatedAt: created.updatedAt
    };
    const completionResults = await Promise.all([
      service.transitionTaskPlanningBlock(created.id, transitionInput, principalA(), ids.userA),
      service.transitionTaskPlanningBlock(created.id, transitionInput, principalA(), ids.userA)
    ]);
    expect(completionResults).toEqual([
      expect.objectContaining({ id: created.id, status: "completed" }),
      expect.objectContaining({ id: created.id, status: "completed" })
    ]);
    await expect(prisma.taskTimeEntry.count({
      where: { sourcePlanningBlockId: created.id }
    })).resolves.toBe(1);
    await expect(prisma.taskTimeEntry.findUniqueOrThrow({
      where: { sourcePlanningBlockId: created.id }
    })).resolves.toMatchObject({
      taskId: ids.taskA,
      userId: ids.userA,
      minutes: 120,
      approvalStatus: "approved",
      sourcePlanningBlockId: created.id
    });
    await expect(prisma.taskStatusHistory.count({
      where: {
        taskId: ids.taskA,
        fromStatus: "todo",
        toStatus: "in_progress",
        reason: "Actual work logged"
      }
    })).resolves.toBe(1);
    const completedTask = await service.getTask(ids.taskA, principalA());
    expect(completedTask).toMatchObject({
      status: "in_progress",
      estimateMinutes: 240,
      loggedMinutes: 120,
      approvedMinutes: 120
    });

    const generatedActual = await prisma.taskTimeEntry.findUniqueOrThrow({
      where: { sourcePlanningBlockId: created.id }
    });
    await expect(service.deleteTaskPlanningBlock(created.id, principalA())).resolves.toEqual({
      deleted: true,
      id: created.id
    });
    await expect(prisma.taskPlanningBlock.findUnique({ where: { id: created.id } })).resolves.toBeNull();
    await expect(prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: generatedActual.id } })).resolves.toMatchObject({
      id: generatedActual.id,
      minutes: 120,
      sourcePlanningBlockId: null
    });
    await expect(prisma.projectTask.findUniqueOrThrow({ where: { id: ids.taskA } })).resolves.toMatchObject({
      status: "in_progress",
      estimateMinutes: 240
    });
  });

  it("returns not found when workspace A tries to delete a workspace B planning block", async () => {
    const service = new ProjectsService(prisma as any);
    const foreign = await prisma.taskPlanningBlock.create({
      data: {
        workspaceId: ids.workspaceB,
        taskId: ids.taskB,
        accountId: ids.accountB,
        projectId: ids.projectB,
        userId: ids.userB,
        title: "Workspace B plan",
        startAt: new Date("2026-07-21T01:00:00.000Z"),
        endAt: new Date("2026-07-21T02:00:00.000Z"),
        plannedMinutes: 60
      }
    });

    await expect(service.deleteTaskPlanningBlock(foreign.id, principalA())).rejects.toBeInstanceOf(NotFoundException);
    await expect(prisma.taskPlanningBlock.findUnique({ where: { id: foreign.id } })).resolves.toMatchObject({
      id: foreign.id,
      workspaceId: ids.workspaceB
    });
  });

  it("serializes manual logging and planning completion into one task promotion", async () => {
    const service = new ProjectsService(prisma as any);
    const task = await prisma.projectTask.create({
      data: {
        workspaceId: ids.workspaceA,
        accountId: ids.accountA,
        projectId: ids.projectA,
        title: `${runId} concurrent actual work`,
        status: "todo",
        estimateMinutes: 180
      }
    });

    try {
      const block = await service.createTaskPlanningBlock(task.id, {
        userId: ids.userA,
        title: task.title,
        startAt: "2026-07-22T01:00:00.000Z",
        endAt: "2026-07-22T02:00:00.000Z",
        plannedMinutes: 60
      }, principalA(), ids.userA);

      await Promise.all([
        service.transitionTaskPlanningBlock(block.id, {
          status: "completed",
          expectedUpdatedAt: block.updatedAt
        }, principalA(), ids.userA),
        service.createTimeEntry(task.id, {
          userId: ids.userA,
          workDate: "2026-07-22T02:00:00.000Z",
          startAt: "2026-07-22T02:00:00.000Z",
          endAt: "2026-07-22T02:30:00.000Z",
          minutes: 30,
          approvalStatus: "approved"
        }, principalA(), ids.userA)
      ]);

      await expect(prisma.taskTimeEntry.count({ where: { taskId: task.id } })).resolves.toBe(2);
      await expect(prisma.taskStatusHistory.count({
        where: {
          taskId: task.id,
          fromStatus: "todo",
          toStatus: "in_progress",
          reason: "Actual work logged"
        }
      })).resolves.toBe(1);
      await expect(prisma.projectTask.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject({
        status: "in_progress",
        estimateMinutes: 180
      });
    } finally {
      await prisma.taskTimeEntry.deleteMany({ where: { taskId: task.id } });
      await prisma.taskPlanningBlock.deleteMany({ where: { taskId: task.id } });
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: task.id } });
      await prisma.projectTask.delete({ where: { id: task.id } });
    }
  });

  it("allows workspace-A time writes and rejects workspace-B time users without changing counts", async () => {
    const service = new ProjectsService(prisma as any);
    const before = await prisma.taskTimeEntry.count({ where: { workspaceId: ids.workspaceA } });
    const input = {
      workDate: "2026-07-20T04:00:00.000Z",
      minutes: 60,
      approvalStatus: "submitted" as const
    };

    await expect(service.createTimeEntry(ids.taskA, {
      ...input,
      userId: ids.userB,
      note: "Foreign time user"
    }, principalA(), ids.userA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(prisma.taskTimeEntry.count({ where: { workspaceId: ids.workspaceA } })).resolves.toBe(before);

    const created = await service.createTimeEntry(ids.taskA, {
      ...input,
      userId: ids.userA,
      note: "Workspace A time"
    }, principalA(), ids.userA);
    const persisted = await prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(persisted).toMatchObject({
      workspaceId: ids.workspaceA,
      taskId: ids.taskA,
      userId: ids.userA,
      minutes: 60,
      approvalStatus: "submitted"
    });
  });

  it("deactivates only the selected workspace membership and preserves the shared global user", async () => {
    const principal = principalA();
    const auth = new AuthService(
      prisma as any,
      { resolveWorkspace: async () => ({ tenantKey, workspaceId: ids.workspaceA, workspaceKey: "a" }) } as any,
      { resolveFromAuthorization: async () => principal } as any
    );

    await expect(auth.deactivateUser("Bearer integration", ids.sharedUser)).resolves.toMatchObject({
      userId: ids.sharedUser,
      status: "active",
      endedRoleBindings: 1
    });
    const [bindingA, bindingB, sharedUser] = await Promise.all([
      prisma.roleBinding.findFirstOrThrow({ where: { userId: ids.sharedUser, workspaceId: ids.workspaceA, tenantKey } }),
      prisma.roleBinding.findFirstOrThrow({ where: { userId: ids.sharedUser, workspaceId: ids.workspaceB, tenantKey } }),
      prisma.user.findUniqueOrThrow({ where: { id: ids.sharedUser } })
    ]);
    expect(bindingA.endsAt).toBeInstanceOf(Date);
    expect(bindingB.endsAt).toBeNull();
    expect(sharedUser.status).toBe("ACTIVE");
  });
});
