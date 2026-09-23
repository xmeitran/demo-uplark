import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectsService } from "./delivery-handoff/projects.service";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.slice(1);
  } catch {
    return "";
  }
})();
const safeDatabase = /(?:^|[_-])(ci|test)(?:$|[_-])/i.test(databaseName);
const runId = `hierarchy-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const triggerShadowSchema = "hierarchy_trigger_shadow";

async function captureRejection(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected hierarchy reorder to reject");
}

async function snapshotHierarchyState(
  prisma: PrismaClient,
  workspaceIds: string[],
  projectIds: string[]
) {
  const [projects, milestones, stages, tasks, audits] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds }, workspaceId: { in: workspaceIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        hierarchyOrderVersion: true,
        updatedAt: true
      }
    }),
    prisma.projectMilestone.findMany({
      where: { projectId: { in: projectIds }, workspaceId: { in: workspaceIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        sortOrder: true,
        updatedAt: true
      }
    }),
    prisma.projectStage.findMany({
      where: { projectId: { in: projectIds }, workspaceId: { in: workspaceIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        milestoneId: true,
        sortOrder: true,
        updatedAt: true
      }
    }),
    prisma.projectTask.findMany({
      where: { projectId: { in: projectIds }, workspaceId: { in: workspaceIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        stageId: true,
        parentTaskId: true,
        sortOrder: true,
        archivedAt: true,
        updatedAt: true
      }
    }),
    prisma.auditEvent.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        resource: "project_hierarchy",
        resourceId: { in: projectIds }
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        resourceId: true,
        action: true,
        createdAt: true
      }
    })
  ]);

  return JSON.parse(JSON.stringify({ projects, milestones, stages, tasks, audits }));
}

function expectNoHierarchyLeak(error: unknown, forbiddenIds: string[]) {
  expect(error).toBeInstanceOf(HttpException);
  const response = (error as HttpException).getResponse();
  const serialized = JSON.stringify(response);
  for (const forbiddenId of forbiddenIds) {
    expect(serialized).not.toContain(forbiddenId);
  }
  for (const forbiddenKey of [
    "orderedIds",
    "hierarchyOrderVersion",
    "current",
    "canonical"
  ]) {
    expect(serialized).not.toContain(`"${forbiddenKey}"`);
  }
}

describe.runIf(safeDatabase)("project hierarchy order on PostgreSQL", () => {
  const prisma = new PrismaClient();
  const service = new ProjectsService(prisma as never);
  const ids: Record<string, string> = {};
  let principal: PrincipalContext;

  beforeAll(async () => {
    const workspace = await prisma.tenantWorkspace.create({
      data: {
        tenantKey: `${runId}-tenant`,
        workspaceKey: `${runId}-workspace`,
        name: runId
      }
    });
    const user = await prisma.user.create({
      data: {
        email: `${runId}@example.test`,
        displayName: "Hierarchy Test User"
      }
    });
    const account = await prisma.account.create({
      data: {
        workspaceId: workspace.id,
        code: `${runId}-account`,
        name: runId,
        stage: "active"
      }
    });
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        accountId: account.id,
        code: `${runId}-project`,
        name: runId,
        status: "planning"
      }
    });
    const role = await prisma.role.upsert({ where: { code: "DELIVERY_LEAD" }, update: {}, create: { code: "DELIVERY_LEAD", name: "Delivery Lead", type: "BUSINESS" } });
    await prisma.roleBinding.create({ data: { userId: user.id, roleId: role.id, tenantKey: workspace.tenantKey, workspaceId: workspace.id } });
    await prisma.projectMember.create({ data: { workspaceId: workspace.id, projectId: project.id, userId: user.id, relation: "member" } });
    const [milestoneA, milestoneB] = await Promise.all([
      prisma.projectMilestone.create({
        data: {
          workspaceId: workspace.id,
          accountId: account.id,
          projectId: project.id,
          name: "Discovery",
          normalizedKey: "discovery",
          sortOrder: 10
        }
      }),
      prisma.projectMilestone.create({
        data: {
          workspaceId: workspace.id,
          accountId: account.id,
          projectId: project.id,
          name: "Delivery",
          normalizedKey: "delivery",
          sortOrder: 20
        }
      })
    ]);
    const stage = await prisma.projectStage.create({
      data: {
        workspaceId: workspace.id,
        accountId: account.id,
        projectId: project.id,
        milestoneId: milestoneA.id,
        stageKey: `${runId}-stage`,
        phase: "Discovery",
        activity: "Research",
        sortOrder: 10,
        cumulativePercent: 0,
        activityPercent: 0,
        criteria: "Done"
      }
    });
    const tasks = await Promise.all(["Task A", "Task B"].map((title, index) =>
      prisma.projectTask.create({
        data: {
          workspaceId: workspace.id,
          accountId: account.id,
          projectId: project.id,
          stageId: stage.id,
          title,
          sortOrder: (index + 1) * 10
        }
      })
    ));
    Object.assign(ids, {
      workspace: workspace.id,
      user: user.id,
      account: account.id,
      project: project.id,
      milestoneA: milestoneA.id,
      milestoneB: milestoneB.id,
      stage: stage.id,
      taskA: tasks[0].id,
      taskB: tasks[1].id
    });

    const foreignWorkspace = await prisma.tenantWorkspace.create({
      data: {
        tenantKey: `${runId}-foreign-tenant`,
        workspaceKey: `${runId}-foreign-workspace`,
        name: `${runId} Foreign`
      }
    });
    const foreignAccount = await prisma.account.create({
      data: {
        workspaceId: foreignWorkspace.id,
        code: `${runId}-foreign-account`,
        name: `${runId} Foreign`,
        stage: "active"
      }
    });
    const foreignProject = await prisma.project.create({
      data: {
        workspaceId: foreignWorkspace.id,
        accountId: foreignAccount.id,
        code: `${runId}-foreign-project`,
        name: `${runId} Foreign`,
        status: "planning"
      }
    });
    const [foreignMilestoneA, foreignMilestoneB] = await Promise.all([
      prisma.projectMilestone.create({
        data: {
          workspaceId: foreignWorkspace.id,
          accountId: foreignAccount.id,
          projectId: foreignProject.id,
          name: "Foreign Discovery",
          normalizedKey: "foreign-discovery",
          sortOrder: 10
        }
      }),
      prisma.projectMilestone.create({
        data: {
          workspaceId: foreignWorkspace.id,
          accountId: foreignAccount.id,
          projectId: foreignProject.id,
          name: "Foreign Delivery",
          normalizedKey: "foreign-delivery",
          sortOrder: 20
        }
      })
    ]);
    const foreignStage = await prisma.projectStage.create({
      data: {
        workspaceId: foreignWorkspace.id,
        accountId: foreignAccount.id,
        projectId: foreignProject.id,
        milestoneId: foreignMilestoneA.id,
        stageKey: `${runId}-foreign-stage`,
        phase: "Foreign Discovery",
        activity: "Foreign Research",
        sortOrder: 10,
        cumulativePercent: 0,
        activityPercent: 0,
        criteria: "Done"
      }
    });
    const foreignTask = await prisma.projectTask.create({
      data: {
        workspaceId: foreignWorkspace.id,
        accountId: foreignAccount.id,
        projectId: foreignProject.id,
        stageId: foreignStage.id,
        title: "Foreign Task",
        sortOrder: 10
      }
    });
    Object.assign(ids, {
      foreignWorkspace: foreignWorkspace.id,
      foreignAccount: foreignAccount.id,
      foreignProject: foreignProject.id,
      foreignMilestoneA: foreignMilestoneA.id,
      foreignMilestoneB: foreignMilestoneB.id,
      foreignStage: foreignStage.id,
      foreignTask: foreignTask.id
    });

    principal = {
      subjectId: user.id,
      subjectType: "internal_user",
      displayName: user.displayName,
      tenantKey: workspace.tenantKey,
      workspaceId: workspace.id,
      workspaceKey: workspace.workspaceKey,
      roleCodes: ["DELIVERY_LEAD"],
      accountIds: [],
      projectIds: [],
      customerAccountIds: [],
      customerProjectIds: [],
      roleVersion: "test",
      grantVersion: "test"
    };
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${triggerShadowSchema}" CASCADE`);
    if (ids.workspace) {
      const workspaceIds = [ids.workspace, ids.foreignWorkspace].filter(Boolean);
      await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.projectTask.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.projectStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.projectMilestone.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.projectMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.roleBinding.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.account.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.tenantWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await prisma.user.delete({ where: { id: ids.user } });
    }
    await prisma.$disconnect();
  });

  it("persists canonical milestone/task order and rejects stale or partial writes atomically", async () => {
    await service.reorderProjectHierarchy(ids.project, {
      kind: "milestone",
      parentId: null,
      orderedIds: [ids.milestoneB, ids.milestoneA],
      expectedVersion: 0
    }, principal);

    await expect(service.reorderProjectHierarchy(ids.project, {
      kind: "milestone",
      parentId: null,
      orderedIds: [ids.milestoneA, ids.milestoneB],
      expectedVersion: 0
    }, principal)).rejects.toBeInstanceOf(ConflictException);

    await service.reorderProjectHierarchy(ids.project, {
      kind: "task",
      parentId: ids.stage,
      orderedIds: [ids.taskB, ids.taskA],
      expectedVersion: 1
    }, principal);

    await expect(service.reorderProjectHierarchy(ids.project, {
      kind: "task",
      parentId: ids.stage,
      orderedIds: [ids.taskA],
      expectedVersion: 2
    }, principal)).rejects.toBeInstanceOf(BadRequestException);

    await service.deleteTask(ids.taskA, principal);

    const concurrent = await Promise.allSettled([
      service.reorderProjectHierarchy(ids.project, {
        kind: "milestone",
        parentId: null,
        orderedIds: [ids.milestoneA, ids.milestoneB],
        expectedVersion: 3
      }, principal),
      service.reorderProjectHierarchy(ids.project, {
        kind: "milestone",
        parentId: null,
        orderedIds: [ids.milestoneA, ids.milestoneB],
        expectedVersion: 3
      }, principal)
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    const conflict = rejected?.status === "rejected" ? rejected.reason : undefined;
    expect(conflict).toBeInstanceOf(ConflictException);

    const [project, milestones, tasks, audits] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: ids.project } }),
      prisma.projectMilestone.findMany({
        where: { projectId: ids.project },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.projectTask.findMany({
        where: { projectId: ids.project, stageId: ids.stage },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.auditEvent.findMany({
        where: {
          workspaceId: ids.workspace,
          resource: "project_hierarchy",
          resourceId: ids.project
        }
      })
    ]);
    expect(project.hierarchyOrderVersion).toBe(4);
    expect(milestones.map((item) => item.id)).toEqual([ids.milestoneA, ids.milestoneB]);
    expect(tasks.map((item) => item.id)).toEqual([ids.taskB]);
    expect(audits).toHaveLength(3);
    expect((conflict as ConflictException).getResponse()).toMatchObject({
      current: {
        orderedIds: milestones.map((item) => item.id),
        hierarchyOrderVersion: project.hierarchyOrderVersion
      },
      canonical: {
        orderedIds: milestones.map((item) => item.id),
        hierarchyOrderVersion: project.hierarchyOrderVersion
      }
    });
  });

  it("returns 404 without leaking or mutating either workspace when a principal targets a foreign project path", async () => {
    const workspaceIds = [ids.workspace, ids.foreignWorkspace];
    const projectIds = [ids.project, ids.foreignProject];
    const before = await snapshotHierarchyState(prisma, workspaceIds, projectIds);

    const error = await captureRejection(() => service.reorderProjectHierarchy(
      ids.foreignProject,
      {
        kind: "milestone",
        parentId: null,
        orderedIds: [ids.foreignMilestoneB, ids.foreignMilestoneA],
        expectedVersion: 0
      },
      principal
    ));

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as HttpException).getStatus()).toBe(404);
    expectNoHierarchyLeak(error, [
      ids.foreignWorkspace,
      ids.foreignProject,
      ids.foreignMilestoneA,
      ids.foreignMilestoneB
    ]);
    expect(await snapshotHierarchyState(prisma, workspaceIds, projectIds)).toEqual(before);
  });

  it("returns 404 without leaking or mutating either workspace when a principal supplies a foreign parent", async () => {
    const workspaceIds = [ids.workspace, ids.foreignWorkspace];
    const projectIds = [ids.project, ids.foreignProject];
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
    const before = await snapshotHierarchyState(prisma, workspaceIds, projectIds);

    const error = await captureRejection(() => service.reorderProjectHierarchy(
      ids.project,
      {
        kind: "stage",
        parentId: ids.foreignMilestoneA,
        orderedIds: [ids.foreignStage],
        expectedVersion: project.hierarchyOrderVersion
      },
      principal
    ));

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as HttpException).getStatus()).toBe(404);
    expectNoHierarchyLeak(error, [
      ids.foreignWorkspace,
      ids.foreignProject,
      ids.foreignMilestoneA,
      ids.foreignStage
    ]);
    expect(await snapshotHierarchyState(prisma, workspaceIds, projectIds)).toEqual(before);
  });

  it("returns 400 without leaking or mutating either workspace when a complete-length order contains a foreign member", async () => {
    const workspaceIds = [ids.workspace, ids.foreignWorkspace];
    const projectIds = [ids.project, ids.foreignProject];
    const [project, currentTasks] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: ids.project } }),
      prisma.projectTask.findMany({
        where: {
          workspaceId: ids.workspace,
          projectId: ids.project,
          stageId: ids.stage,
          parentTaskId: null,
          archivedAt: null
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true }
      })
    ]);
    const forgedOrder = [
      ids.foreignTask,
      ...currentTasks.slice(1).map((task) => task.id)
    ];
    const before = await snapshotHierarchyState(prisma, workspaceIds, projectIds);

    const error = await captureRejection(() => service.reorderProjectHierarchy(
      ids.project,
      {
        kind: "task",
        parentId: ids.stage,
        orderedIds: forgedOrder,
        expectedVersion: project.hierarchyOrderVersion
      },
      principal
    ));

    expect(forgedOrder).toHaveLength(currentTasks.length);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as HttpException).getStatus()).toBe(400);
    expectNoHierarchyLeak(error, [
      ids.foreignWorkspace,
      ids.foreignProject,
      ids.foreignStage,
      ids.foreignTask
    ]);
    expect(await snapshotHierarchyState(prisma, workspaceIds, projectIds)).toEqual(before);
  });

  it("keeps old-shaped stage writes compatible without overriding new-app rename or reparent identity", async () => {
    const legacyStage = `${runId}-legacy-stage`;
    const concurrentStageA = `${runId}-legacy-concurrent-a`;
    const concurrentStageB = `${runId}-legacy-concurrent-b`;

    await prisma.$executeRaw`
      INSERT INTO "ProjectStage" (
        "id", "workspaceId", "accountId", "projectId", "stageKey", "phase", "activity",
        "sortOrder", "cumulativePercent", "activityPercent", "criteria", "updatedAt"
      ) VALUES (
        ${legacyStage}, ${ids.workspace}, ${ids.account}, ${ids.project}, ${legacyStage},
        'Legacy Discovery', 'Legacy Research', 30, 0, 0, 'Done', CURRENT_TIMESTAMP
      )
    `;
    const inserted = await prisma.projectStage.findUniqueOrThrow({
      where: { id: legacyStage },
      include: { milestone: true }
    });
    expect(inserted.milestoneId).toBeTruthy();
    expect(inserted.milestone.normalizedKey).toBe("legacy discovery");
    expect(inserted.milestone.workspaceId).toBe(ids.workspace);
    expect(inserted.milestone.accountId).toBe(ids.account);

    await Promise.all([
      prisma.$executeRaw`
        INSERT INTO "ProjectStage" (
          "id", "workspaceId", "accountId", "projectId", "stageKey", "phase", "activity",
          "sortOrder", "cumulativePercent", "activityPercent", "criteria", "updatedAt"
        ) VALUES (
          ${concurrentStageA}, ${ids.workspace}, ${ids.account}, ${ids.project}, ${concurrentStageA},
          'Legacy Concurrent', 'Legacy A', 40, 0, 0, 'Done', CURRENT_TIMESTAMP
        )
      `,
      prisma.$executeRaw`
        INSERT INTO "ProjectStage" (
          "id", "workspaceId", "accountId", "projectId", "stageKey", "phase", "activity",
          "sortOrder", "cumulativePercent", "activityPercent", "criteria", "updatedAt"
        ) VALUES (
          ${concurrentStageB}, ${ids.workspace}, ${ids.account}, ${ids.project}, ${concurrentStageB},
          'Legacy Concurrent', 'Legacy B', 50, 0, 0, 'Done', CURRENT_TIMESTAMP
        )
      `
    ]);
    const concurrentStages = await prisma.projectStage.findMany({
      where: { id: { in: [concurrentStageA, concurrentStageB] } },
      select: { milestoneId: true }
    });
    expect(concurrentStages).toHaveLength(2);
    expect(new Set(concurrentStages.map((stage) => stage.milestoneId)).size).toBe(1);

    await prisma.$executeRaw`
      UPDATE "ProjectStage"
      SET "phase" = 'Legacy Updated', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${legacyStage}
    `;
    const legacyUpdated = await prisma.projectStage.findUniqueOrThrow({
      where: { id: legacyStage },
      include: { milestone: true }
    });
    expect(legacyUpdated.milestone.normalizedKey).toBe("legacy updated");

    const milestoneIdBeforeRename = legacyUpdated.milestoneId;
    await service.updateStage(ids.project, legacyStage, {
      phase: "New App Rename"
    }, principal, { scope: "milestone" });
    const renamed = await prisma.projectStage.findUniqueOrThrow({
      where: { id: legacyStage },
      include: { milestone: true }
    });
    expect(renamed.milestoneId).toBe(milestoneIdBeforeRename);
    expect(renamed.milestone.normalizedKey).toBe("new app rename");

    const explicitTarget = await prisma.projectMilestone.create({
      data: {
        workspaceId: ids.workspace,
        accountId: ids.account,
        projectId: ids.project,
        name: "Explicit Target",
        normalizedKey: "explicit target",
        sortOrder: 90
      }
    });
    await prisma.$executeRaw`
      UPDATE "ProjectStage"
      SET
        "milestoneId" = ${explicitTarget.id},
        "phase" = 'Explicit Target',
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${legacyStage}
    `;
    expect((await prisma.projectStage.findUniqueOrThrow({
      where: { id: legacyStage },
      select: { milestoneId: true }
    })).milestoneId).toBe(explicitTarget.id);

    const beforeDriftAttempt = await snapshotHierarchyState(
      prisma,
      [ids.workspace, ids.foreignWorkspace],
      [ids.project, ids.foreignProject]
    );
    await expect(prisma.$executeRaw`
      INSERT INTO "ProjectStage" (
        "id", "workspaceId", "accountId", "projectId", "stageKey", "phase", "activity",
        "sortOrder", "cumulativePercent", "activityPercent", "criteria", "updatedAt"
      ) VALUES (
        ${`${runId}-legacy-drift`}, ${ids.foreignWorkspace}, ${ids.foreignAccount},
        ${ids.project}, ${`${runId}-legacy-drift`}, 'Legacy Drift', 'Legacy Drift',
        60, 0, 0, 'Done', CURRENT_TIMESTAMP
      )
    `).rejects.toThrow("ProjectStage tenant/account does not match owning Project");
    expect(await snapshotHierarchyState(
      prisma,
      [ids.workspace, ids.foreignWorkspace],
      [ids.project, ids.foreignProject]
    )).toEqual(beforeDriftAttempt);
  });

  it("pins the compatibility trigger to public relations and removes PUBLIC function execution", async () => {
    const catalog = await prisma.$queryRaw<Array<{
      isSecurityDefiner: boolean;
      functionSettings: string[] | null;
      publicCanExecute: boolean;
      triggerEnabled: string;
    }>>`
      SELECT
        p.prosecdef AS "isSecurityDefiner",
        p.proconfig AS "functionSettings",
        EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ) AS "publicCanExecute",
        trigger.tgenabled AS "triggerEnabled"
      FROM pg_proc p
      JOIN pg_namespace namespace ON namespace.oid = p.pronamespace
      JOIN pg_trigger trigger ON trigger.tgfoid = p.oid
      WHERE namespace.nspname = 'public'
        AND p.proname = 'compat_fill_project_stage_milestone'
        AND NOT trigger.tgisinternal
    `;
    expect(catalog).toEqual([{
      isSecurityDefiner: false,
      functionSettings: ["search_path=pg_catalog, public, pg_temp"],
      publicCanExecute: false,
      triggerEnabled: "O"
    }]);

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${triggerShadowSchema}"`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${triggerShadowSchema}"."Project"
      AS SELECT * FROM public."Project" WHERE "id" = '${ids.project}'
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${triggerShadowSchema}"."ProjectMilestone"
      (LIKE public."ProjectMilestone" INCLUDING DEFAULTS)
    `);
    const shadowStageId = `${runId}-shadow-search-path`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL search_path = "${triggerShadowSchema}", public`
      );
      await tx.$executeRaw`
        INSERT INTO public."ProjectStage" (
          "id", "workspaceId", "accountId", "projectId", "stageKey", "phase", "activity",
          "sortOrder", "cumulativePercent", "activityPercent", "criteria", "updatedAt"
        ) VALUES (
          ${shadowStageId}, ${ids.workspace}, ${ids.account}, ${ids.project}, ${shadowStageId},
          'Pinned Search Path', 'Pinned Search Path', 70, 0, 0, 'Done', CURRENT_TIMESTAMP
        )
      `;
    });
    const [publicStage, shadowMilestones] = await Promise.all([
      prisma.projectStage.findUniqueOrThrow({
        where: { id: shadowStageId },
        include: { milestone: true }
      }),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*) AS count FROM "${triggerShadowSchema}"."ProjectMilestone"`
      )
    ]);
    expect(publicStage.milestone.normalizedKey).toBe("pinned search path");
    expect(shadowMilestones[0]?.count).toBe(0n);
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${triggerShadowSchema}" CASCADE`);
  });

  it("keeps old-SHA project account reassignment atomic and reconciles stable milestones", async () => {
    const replacementAccount = await prisma.account.create({
      data: {
        workspaceId: ids.workspace,
        code: `${runId}-replacement-account`,
        name: `${runId} Replacement`,
        stage: "active"
      }
    });
    const readOwnership = async () => {
      const [project, milestones, stages, tasks] = await Promise.all([
        prisma.project.findUniqueOrThrow({
          where: { id: ids.project },
          select: { id: true, accountId: true }
        }),
        prisma.projectMilestone.findMany({
          where: { projectId: ids.project },
          orderBy: { id: "asc" },
          select: {
            id: true,
            workspaceId: true,
            accountId: true,
            normalizedKey: true,
            sortOrder: true
          }
        }),
        prisma.projectStage.findMany({
          where: { projectId: ids.project },
          orderBy: { id: "asc" },
          select: { id: true, workspaceId: true, accountId: true, milestoneId: true }
        }),
        prisma.projectTask.findMany({
          where: { projectId: ids.project },
          orderBy: { id: "asc" },
          select: { id: true, workspaceId: true, accountId: true }
        })
      ]);
      return { project, milestones, stages, tasks };
    };
    const before = await readOwnership();
    const oldShaReassign = async (tx: Prisma.TransactionClient) => {
      await tx.project.update({
        where: { id: ids.project },
        data: { accountId: replacementAccount.id }
      });
      await tx.projectStage.updateMany({
        where: { projectId: ids.project, workspaceId: ids.workspace },
        data: { accountId: replacementAccount.id }
      });
      await tx.projectTask.updateMany({
        where: { projectId: ids.project, workspaceId: ids.workspace },
        data: { accountId: replacementAccount.id }
      });
    };

    await expect(prisma.$transaction(async (tx) => {
      await oldShaReassign(tx);
      throw new Error("rollback rehearsal");
    })).rejects.toThrow("rollback rehearsal");
    expect(await readOwnership()).toEqual(before);

    await prisma.$transaction(oldShaReassign);
    const after = await readOwnership();
    expect(after.project.accountId).toBe(replacementAccount.id);
    expect(after.milestones.every((row) => row.accountId === replacementAccount.id)).toBe(true);
    expect(after.stages.every((row) => row.accountId === replacementAccount.id)).toBe(true);
    expect(after.tasks.every((row) => row.accountId === replacementAccount.id)).toBe(true);
    expect(after.milestones.map(({ accountId: _accountId, ...row }) => row))
      .toEqual(before.milestones.map(({ accountId: _accountId, ...row }) => row));
    expect(after.stages.map(({ accountId: _accountId, ...row }) => row))
      .toEqual(before.stages.map(({ accountId: _accountId, ...row }) => row));
    expect(after.tasks.map(({ accountId: _accountId, ...row }) => row))
      .toEqual(before.tasks.map(({ accountId: _accountId, ...row }) => row));
  });
});
