import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsService } from "./projects.service";
import type { PrincipalContext } from "@b2b-crm/contracts";

const blockerDelegates = [
  "projectTask",
  "taskStatusHistory",
  "taskTimeEntry",
  "taskPlanningBlock",
  "ticket",
  "ticketStatusHistory",
  "projectArtifact",
  "fileObject",
  "projectComment",
  "projectActivity",
  "projectRisk",
  "projectAttachment",
  "taskComment",
  "taskAttachment",
  "projectProgressShareLink",
  "contract",
  "paymentSchedule",
  "paymentMilestone",
  "invoice",
  "invoicePayment",
  "resourceAllocation",
  "projectCost",
  "projectPlSnapshot",
  "customerAccessGrant"
] as const;

function createPrismaMock(overrides: Partial<Record<(typeof blockerDelegates)[number], number>> = {}) {
  const prisma: Record<string, any> = {
    project: {
      findFirst: vi.fn().mockResolvedValue({
        id: "prj-1",
        workspaceId: "twk-1",
        accountId: "acc-1"
      }),
      delete: vi.fn().mockResolvedValue({ id: "prj-1" })
    },
    projectMember: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 })
    },
    projectBudget: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops))
  };

  for (const delegate of blockerDelegates) {
    prisma[delegate] = {
      count: vi.fn().mockResolvedValue(overrides[delegate] ?? 0)
    };
  }

  return prisma;
}

function withMutationDependencies(prisma: Record<string, any>) {
  prisma.$queryRaw ??= vi.fn().mockResolvedValue([]);
  prisma.auditEvent ??= { create: vi.fn().mockResolvedValue({ id: "audit-1" }) };
  prisma.tenantWorkspace ??= { findUnique: vi.fn().mockResolvedValue({ id: "twk-1", status: "active", tenantKey: "prod" }) };
  prisma.projectMember ??= {};
  prisma.projectMember.findFirst ??= vi.fn().mockResolvedValue({ userId: "usr-1" });
  prisma.projectMember.findMany ??= vi.fn().mockResolvedValue([{ userId: "usr-1" }]);
  return prisma;
}

const principal: PrincipalContext = {
  subjectType: "internal_user",
  subjectId: "usr-1",
  displayName: "Test User",
  email: "test@example.com",
  tenantKey: "prod",
  workspaceId: "twk-1",
  workspaceKey: "default",
  roleCodes: ["DELIVERY_LEAD"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "test",
  grantVersion: "test"
};

const portalPrincipal: PrincipalContext = {
  ...principal,
  subjectType: "portal_user",
  subjectId: "portal-1",
  displayName: "Portal User",
  roleCodes: [],
  accountIds: ["acc-1"],
  projectIds: ["prj-1"],
  customerAccountIds: ["acc-1"],
  customerProjectIds: ["prj-1"]
};

describe("ProjectsService.deleteProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a domain error instead of deleting projects with operational records", async () => {
    const prisma = createPrismaMock({ projectTask: 3, projectArtifact: 1 });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteProject("prj-1", principal)).rejects.toThrow(BadRequestException);
    await expect(service.deleteProject("prj-1", principal)).rejects.toThrow("operational records");
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it("cleans lightweight metadata before deleting an otherwise empty project", async () => {
    const prisma = createPrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteProject("prj-1", principal)).resolves.toEqual({ deleted: true, id: "prj-1" });

    expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({ where: { projectId: "prj-1", workspaceId: "twk-1" } });
    expect(prisma.projectBudget.deleteMany).toHaveBeenCalledWith({ where: { projectId: "prj-1", workspaceId: "twk-1" } });
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: "prj-1" } });
  });

  it("converts remaining foreign-key failures to a clear domain error", async () => {
    const prisma = createPrismaMock();
    prisma.$transaction = vi.fn().mockRejectedValue({ code: "P2003" });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteProject("prj-1", principal)).rejects.toThrow("linked to operational records");
  });
});

function createTaskDeletePrismaMock(options: { hasHistory?: boolean; archivedAt?: Date } = {}) {
  const taskRecord = {
    id: "task-1",
    workspaceId: "twk-1",
    accountId: "acc-1",
    projectId: "prj-1",
    status: "todo",
    archivedAt: options.archivedAt ?? null,
    cancelledAt: null
  };
  const counts = options.hasHistory ? [0, 1, 0, 1, 0, 0] : [0, 0, 0, 0, 0, 0];
  const prisma: Record<string, any> = {
    projectTask: {
      findFirst: vi.fn().mockResolvedValue(taskRecord),
      count: vi.fn()
        .mockResolvedValueOnce(counts[0])
        .mockResolvedValueOnce(counts[1]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({ ...taskRecord, status: "archived" }),
      delete: vi.fn().mockResolvedValue({ id: "task-1" })
    },
    taskStatusHistory: {
      count: vi.fn().mockResolvedValue(counts[1]),
      create: vi.fn().mockResolvedValue({ id: "hist-1" })
    },
    taskTimeEntry: {
      count: vi.fn().mockResolvedValue(counts[2])
    },
    taskPlanningBlock: {
      count: vi.fn().mockResolvedValue(counts[3])
    },
    taskComment: {
      count: vi.fn().mockResolvedValue(counts[4])
    },
    taskAttachment: {
      count: vi.fn().mockResolvedValue(counts[5])
    }
  };
  prisma.$transaction = vi.fn(async (input: any) => {
    if (typeof input === "function") {
      return input(prisma);
    }
    return Promise.all(input);
  });
  return prisma;
}

describe("ProjectsService.deleteTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hard-deletes draft tasks that have no operational history", async () => {
    const prisma = createTaskDeletePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTask("task-1", principal)).resolves.toEqual({
      deleted: true,
      archived: false,
      id: "task-1"
    });

    expect(prisma.projectTask.delete).toHaveBeenCalledWith({ where: { id: "task-1" } });
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
  });

  it("archives tasks that already have operational history instead of hard-deleting them", async () => {
    const prisma = createTaskDeletePrismaMock({ hasHistory: true });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const result = await service.deleteTask("task-1", principal);

    expect(result).toMatchObject({
      deleted: false,
      archived: true,
      id: "task-1"
    });
    expect(prisma.projectTask.delete).not.toHaveBeenCalled();
    expect(prisma.projectTask.updateMany).toHaveBeenCalledWith({
      where: {
        parentTaskId: "task-1",
        workspaceId: "twk-1"
      },
      data: { parentTaskId: null }
    });
    expect(prisma.taskStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        fromStatus: "todo",
        toStatus: "archived",
        changedByUserId: principal.subjectId
      })
    });
    expect(prisma.projectTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        status: "archived",
        archivedByUserId: principal.subjectId,
        archiveReason: expect.stringContaining("preserved")
      })
    });
  });

  it("returns the existing archive result without creating duplicate history", async () => {
    const archivedAt = new Date("2026-07-06T08:30:00.000Z");
    const prisma = createTaskDeletePrismaMock({ archivedAt });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTask("task-1", principal)).resolves.toEqual({
      deleted: false,
      archived: true,
      id: "task-1",
      archivedAt: archivedAt.toISOString()
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.projectTask.delete).not.toHaveBeenCalled();
    expect(prisma.taskStatusHistory.create).not.toHaveBeenCalled();
  });

  it("blocks portal principals before deleting or archiving tasks", async () => {
    const prisma = createTaskDeletePrismaMock({ hasHistory: true });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTask("task-1", portalPrincipal)).rejects.toThrow(ForbiddenException);
    expect(prisma.projectTask.findFirst).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.getTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads active child tasks for task detail subtasks", async () => {
    const prisma = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          account: { name: "Account" },
          projectId: "prj-1",
          project: { name: "Project" },
          stageId: "stage-1",
          stage: { stageKey: "implementation", activity: "Build feature" },
          opportunityId: null,
          ticketId: null,
          parentTaskId: null,
          title: "Parent task",
          description: null,
          taskType: "implementation",
          status: "in_progress",
          priority: "medium",
          ownerUserId: null,
          owner: null,
          assigneeUserId: null,
          assignee: null,
          ownerTeamId: null,
          ownerTeam: null,
          plannedStartAt: null,
          dueAt: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          estimateMinutes: 120,
          customerVisible: false,
          createdByUserId: "usr-1",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          statusHistory: [],
          timeEntries: [],
          planningBlocks: [
            {
              id: "plan-1",
              taskId: "task-1",
              accountId: "acc-1",
              account: { name: "Account" },
              projectId: "prj-1",
              project: { name: "Project" },
              userId: "usr-1",
              user: { displayName: "Planner" },
              title: "Parent task",
              notes: "Two-hour plan",
              startAt: new Date("2026-07-02T02:00:00.000Z"),
              endAt: new Date("2026-07-02T04:00:00.000Z"),
              plannedMinutes: 120,
              status: "planned",
              source: "manual",
              createdAt: new Date("2026-07-01T01:00:00.000Z"),
              updatedAt: new Date("2026-07-01T01:00:00.000Z")
            }
          ],
          subtasks: [
            {
              id: "subtask-1",
              workspaceId: "twk-1",
              accountId: "acc-1",
              account: { name: "Account" },
              projectId: "prj-1",
              project: { name: "Project" },
              stageId: "stage-1",
              stage: { stageKey: "implementation", activity: "Build feature" },
              parentTaskId: "task-1",
              title: "Checklist backend item",
              description: null,
              taskType: "checklist",
              status: "todo",
              priority: "medium",
              ownerUserId: null,
              owner: null,
              assigneeUserId: null,
              assignee: null,
              ownerTeamId: null,
              ownerTeam: null,
              plannedStartAt: null,
              dueAt: null,
              startedAt: null,
              completedAt: null,
              cancelledAt: null,
              estimateMinutes: 0,
              customerVisible: false,
              createdByUserId: "usr-1",
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
              updatedAt: new Date("2026-07-01T00:00:00.000Z"),
              statusHistory: [],
              timeEntries: []
            }
          ]
        })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const task = await service.getTask("task-1", principal);

    expect(prisma.projectTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task-1", workspaceId: "twk-1" }),
      include: expect.objectContaining({
        planningBlocks: expect.objectContaining({
          include: expect.objectContaining({
            account: { select: { name: true } },
            project: { select: { name: true } },
            user: { select: { displayName: true, email: true, avatarUrl: true } }
          }),
          take: 100
        }),
        subtasks: expect.objectContaining({
          where: { archivedAt: null },
          include: expect.objectContaining({ account: true, project: true })
        })
      })
    }));
    expect(task.subtasks).toEqual([expect.objectContaining({
      id: "subtask-1",
      parentTaskId: "task-1",
      title: "Checklist backend item"
    })]);
    expect(task).toMatchObject({
      loggedMinutes: 0,
      approvedMinutes: 0,
      planningBlocks: [{ id: "plan-1", plannedMinutes: 120, userDisplayName: "Planner" }]
    });
  });

  it("does not query internal planning or actual-work records in portal task detail", async () => {
    const prisma = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-portal",
          workspaceId: "twk-1",
          accountId: "acc-1",
          account: { name: "Account" },
          projectId: "prj-1",
          project: { name: "Project" },
          title: "Customer-visible task",
          taskType: "implementation",
          status: "in_progress",
          priority: "medium",
          estimateMinutes: 120,
          customerVisible: true,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          statusHistory: [],
          subtasks: [
            {
              id: "subtask-visible",
              workspaceId: "twk-1",
              accountId: "acc-1",
              account: { name: "Account" },
              projectId: "prj-1",
              project: { name: "Project" },
              parentTaskId: "task-portal",
              title: "Customer-visible subtask",
              taskType: "checklist",
              status: "todo",
              priority: "medium",
              estimateMinutes: 30,
              customerVisible: true,
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
              updatedAt: new Date("2026-07-01T00:00:00.000Z"),
              statusHistory: []
            }
          ]
        })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const task = await service.getTask("task-portal", portalPrincipal);
    const query = prisma.projectTask.findFirst.mock.calls[0][0];

    expect(query.where).toMatchObject({
      id: "task-portal",
      workspaceId: "twk-1",
      customerVisible: true
    });
    expect(query.include).not.toHaveProperty("planningBlocks");
    expect(query.include).not.toHaveProperty("timeEntries");
    expect(query.include.subtasks.include).not.toHaveProperty("timeEntries");
    expect(query.include.subtasks.where).toEqual({ archivedAt: null, customerVisible: true });
    expect(task.planningBlocks).toBeUndefined();
    expect(task.timeEntries).toEqual([]);
    expect(task.subtasks).toEqual([expect.objectContaining({ id: "subtask-visible", customerVisible: true })]);
  });

  it("does not query internal actual-work records in portal task lists", async () => {
    const portalTask = {
      id: "task-portal",
      workspaceId: "twk-1",
      accountId: "acc-1",
      account: { name: "Account" },
      projectId: "prj-1",
      project: { name: "Project" },
      title: "Customer-visible task",
      taskType: "implementation",
      status: "in_progress",
      priority: "medium",
      estimateMinutes: 120,
      customerVisible: true,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      statusHistory: []
    };
    const prisma = {
      projectTask: {
        findMany: vi.fn().mockResolvedValue([portalTask]),
        count: vi.fn().mockResolvedValue(1)
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const result = await service.listTasks({ limit: 10 }, portalPrincipal);
    const query = prisma.projectTask.findMany.mock.calls[0][0];

    expect(query.where).toMatchObject({
      workspaceId: "twk-1",
      customerVisible: true
    });
    expect(query.include).not.toHaveProperty("timeEntries");
    expect(result.data[0].timeEntries).toEqual([]);
  });
});

describe("ProjectsService.listTaskPlanningBlocks", () => {
  it("uses workspace-scoped overlap paging and returns stable mapped block ids", async () => {
    const startAt = new Date("2026-07-14T00:00:00.000Z");
    const endAt = new Date("2026-07-21T00:00:00.000Z");
    const blocks = [
      {
        id: "plan-page-2-a",
        workspaceId: "twk-1",
        taskId: "task-1",
        task: { id: "task-1", title: "Canonical task" },
        accountId: "acc-1",
        account: { name: "Account" },
        projectId: "prj-1",
        project: { name: "Project" },
        userId: "usr-1",
        user: { displayName: "Planner", email: "planner@example.com", avatarUrl: null },
        title: "Overlap from previous day",
        notes: null,
        startAt: new Date("2026-07-13T23:30:00.000Z"),
        endAt: new Date("2026-07-14T00:30:00.000Z"),
        plannedMinutes: 60,
        status: "planned",
        source: "manual",
        createdByUserId: "usr-1",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
        updatedAt: new Date("2026-07-13T12:00:00.000Z")
      },
      {
        id: "plan-page-2-b",
        workspaceId: "twk-1",
        taskId: "task-1",
        task: { id: "task-1", title: "Canonical task" },
        accountId: "acc-1",
        account: { name: "Account" },
        projectId: "prj-1",
        project: { name: "Project" },
        userId: "usr-1",
        user: { displayName: "Planner", email: "planner@example.com", avatarUrl: null },
        title: "Inside requested range",
        notes: "Second stable id",
        startAt: new Date("2026-07-15T02:00:00.000Z"),
        endAt: new Date("2026-07-15T03:00:00.000Z"),
        plannedMinutes: 60,
        status: "in_progress",
        source: "manual",
        createdByUserId: "usr-1",
        createdAt: new Date("2026-07-14T12:00:00.000Z"),
        updatedAt: new Date("2026-07-14T12:00:00.000Z")
      }
    ];
    const prisma = {
      taskPlanningBlock: {
        findMany: vi.fn().mockResolvedValue(blocks),
        count: vi.fn().mockResolvedValue(5)
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const result = await service.listTaskPlanningBlocks({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      taskId: "task-1",
      limit: 2,
      offset: 1
    }, principal);

    const expectedWhere = {
      workspaceId: "twk-1",
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      taskId: "task-1"
    };
    expect(prisma.taskPlanningBlock.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      include: expect.any(Object),
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
      take: 2,
      skip: 1
    });
    expect(prisma.taskPlanningBlock.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.data.map((block) => block.id)).toEqual(["plan-page-2-a", "plan-page-2-b"]);
    expect(result.meta).toEqual({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      pagination: {
        limit: 2,
        offset: 1,
        returned: 2,
        total: 5,
        hasNextPage: true,
        hasPreviousPage: true
      }
    });
  });
});

describe("ProjectsService.createTaskPlanningBlock", () => {
  it("preserves the task estimate while creating planning blocks in one transaction", async () => {
    const task = {
      id: "task-1",
      workspaceId: "twk-1",
      accountId: "acc-1",
      projectId: "prj-1",
      title: "Atomic planning task",
      estimateMinutes: 240
    };
    const createdBlock = (id: string, plannedMinutes: number) => ({
      id,
      taskId: task.id,
      accountId: task.accountId,
      account: { name: "Account" },
      projectId: task.projectId,
      project: { name: "Project" },
      userId: "usr-1",
      user: { displayName: "Planner", email: "planner@example.com", avatarUrl: null },
      title: task.title,
      notes: "Atomic plan",
      startAt: new Date("2026-07-14T02:00:00.000Z"),
      endAt: new Date("2026-07-14T03:00:00.000Z"),
      plannedMinutes,
      billable: false,
      workType: "consulting",
      status: "planned",
      source: "manual",
      createdByUserId: "usr-1",
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      updatedAt: new Date("2026-07-13T00:00:00.000Z")
    });
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue(task),
        update: vi.fn()
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "usr-1" }])
      },
      taskPlanningBlock: {
        create: vi.fn()
          .mockResolvedValueOnce(createdBlock("plan-60", 60))
          .mockResolvedValueOnce(createdBlock("plan-120", 120))
      },
      projectActivity: {
        create: vi.fn().mockResolvedValue({ id: "activity-1" })
      }
    };
    prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const sixtyMinuteResult = await service.createTaskPlanningBlock(task.id, {
      userId: "usr-1",
      notes: "Atomic plan",
      startAt: "2026-07-14T02:00:00.000Z",
      endAt: "2026-07-14T03:00:00.000Z",
      plannedMinutes: 60,
      billable: false,
      workType: "consulting",
      status: "planned"
    }, principal, "usr-1");
    const oneHundredTwentyMinuteResult = await service.createTaskPlanningBlock(task.id, {
      userId: "usr-1",
      notes: "Atomic plan",
      startAt: "2026-07-15T02:00:00.000Z",
      endAt: "2026-07-15T04:00:00.000Z",
      plannedMinutes: 120,
      billable: false,
      workType: "consulting",
      status: "planned"
    }, principal, "usr-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
    expect(prisma.taskPlanningBlock.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        taskId: task.id,
        plannedMinutes: 60,
        billable: false,
        workType: "consulting"
      })
    }));
    expect(prisma.taskPlanningBlock.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        taskId: task.id,
        plannedMinutes: 120,
        billable: false,
        workType: "consulting"
      })
    }));
    expect(sixtyMinuteResult).toMatchObject({
      id: "plan-60",
      plannedMinutes: 60,
      billable: false,
      workType: "consulting"
    });
    expect(oneHundredTwentyMinuteResult).toMatchObject({
      id: "plan-120",
      plannedMinutes: 120,
      billable: false,
      workType: "consulting"
    });
    expect(task.estimateMinutes).toBe(240);
  });
});

const planningUpdatedAt = new Date("2026-07-13T00:00:00.000Z");

function planningBlockFixture(status = "planned", updatedAt = planningUpdatedAt) {
  return {
    id: "plan-1",
    workspaceId: "twk-1",
    taskId: "task-1",
    task: { id: "task-1", title: "Persist planning completion" },
    accountId: "acc-1",
    account: { name: "Account" },
    projectId: "prj-1",
    project: { name: "Project" },
    milestoneId: "milestone-1",
    milestone: { id: "milestone-1", name: "Implementation", sortOrder: 10 },
    userId: "usr-1",
    user: { displayName: "Planner", email: "planner@example.com", avatarUrl: null },
    title: "Persist planning completion",
    notes: null,
    startAt: new Date("2026-07-14T02:00:00.000Z"),
    endAt: new Date("2026-07-14T03:30:00.000Z"),
    plannedMinutes: 60,
    billable: false,
    workType: "consulting",
    status,
    source: "manual",
    createdByUserId: "usr-1",
    createdAt: new Date("2026-07-12T00:00:00.000Z"),
    updatedAt
  };
}

function createPlanningTransitionPrismaMock(options: {
  initial?: ReturnType<typeof planningBlockFixture> | null;
  current?: ReturnType<typeof planningBlockFixture> | null;
  updateCount?: number;
  auditError?: Error;
  taskStatus?: string;
} = {}) {
  const initial = options.initial === undefined ? planningBlockFixture() : options.initial;
  const changed = options.current === undefined
    ? planningBlockFixture("completed", new Date("2026-07-13T00:01:00.000Z"))
    : options.current;
  const taskPlanningBlock = {
    findFirst: vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(changed),
    updateMany: vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 })
  };
  const prisma: Record<string, any> = {
    taskPlanningBlock,
    auditEvent: {
      create: options.auditError
        ? vi.fn().mockRejectedValue(options.auditError)
        : vi.fn().mockResolvedValue({ id: "audit-1" })
    },
    projectActivity: {
      create: vi.fn().mockResolvedValue({ id: "activity-1" })
    },
    projectTask: {
      update: vi.fn()
    },
    taskStatusHistory: {
      create: vi.fn().mockResolvedValue({ id: "history-1" })
    },
    taskTimeEntry: {
      upsert: vi.fn().mockResolvedValue({
        id: "time-plan-1",
        sourcePlanningBlockId: "plan-1"
      }),
      update: vi.fn()
    },
    $queryRaw: vi.fn().mockResolvedValue([{
      id: "task-1",
      workspaceId: "twk-1",
      accountId: "acc-1",
      projectId: "prj-1",
      status: options.taskStatus ?? "todo",
      startedAt: null
    }])
  };
  prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
  return prisma;
}

describe("ProjectsService.transitionTaskPlanningBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["planned", "in_progress"],
    ["planned", "completed"],
    ["planned", "cancelled"],
    ["in_progress", "completed"],
    ["in_progress", "cancelled"]
  ] as const)("persists a valid %s -> %s transition", async (fromStatus, targetStatus) => {
    const prisma = createPlanningTransitionPrismaMock({
      initial: planningBlockFixture(fromStatus),
      current: planningBlockFixture(targetStatus, new Date("2026-07-13T00:01:00.000Z"))
    });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const result = await service.transitionTaskPlanningBlock("plan-1", {
      status: targetStatus,
      expectedUpdatedAt: planningUpdatedAt.toISOString(),
      reason: "Work finished"
    }, principal, principal.subjectId);

    expect(result).toMatchObject({ id: "plan-1", status: targetStatus });
    expect(prisma.taskPlanningBlock.updateMany).toHaveBeenCalledWith({
      where: {
        id: "plan-1",
        workspaceId: "twk-1",
        status: fromStatus,
        updatedAt: planningUpdatedAt
      },
      data: { status: targetStatus }
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "twk-1",
        actorUserId: "usr-1",
        action: "planning_status_changed",
        resource: "TaskPlanningBlock",
        resourceId: "plan-1",
        before: { status: fromStatus },
        after: { status: targetStatus, reason: "Work finished" },
        requestId: `task-planning-block:plan-1:${targetStatus}:${planningUpdatedAt.toISOString()}`
      })
    });
    expect(prisma.projectActivity.create).toHaveBeenCalledTimes(1);
    expect(prisma.projectActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activityType: "planning_status_changed",
        projectId: "prj-1",
        accountId: "acc-1"
      })
    });
    if (targetStatus === "completed") {
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.taskStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: "task-1",
          fromStatus: "todo",
          toStatus: "in_progress",
          changedByUserId: "usr-1",
          reason: "Actual work logged"
        })
      });
      expect(prisma.projectTask.update).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: {
          status: "in_progress",
          startedAt: new Date("2026-07-14T02:00:00.000Z")
        }
      });
      expect(prisma.taskTimeEntry.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.taskTimeEntry.upsert).toHaveBeenCalledWith({
        where: { sourcePlanningBlockId: "plan-1" },
        create: expect.objectContaining({
          workspaceId: "twk-1",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          userId: "usr-1",
          workDate: new Date("2026-07-14T02:00:00.000Z"),
          startAt: new Date("2026-07-14T02:00:00.000Z"),
          endAt: new Date("2026-07-14T03:30:00.000Z"),
          timeZone: "Asia/Ho_Chi_Minh",
          minutes: 60,
          billable: false,
          workType: "consulting",
          approvalStatus: "approved",
          sourcePlanningBlockId: "plan-1"
        }),
        update: {}
      });
    } else {
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.taskStatusHistory.create).not.toHaveBeenCalled();
      expect(prisma.projectTask.update).not.toHaveBeenCalled();
      expect(prisma.taskTimeEntry.upsert).not.toHaveBeenCalled();
    }
    expect(prisma.taskTimeEntry.update).not.toHaveBeenCalled();
  });

  it("reconciles a same-target completion without another status update, audit, or activity", async () => {
    const prisma = createPlanningTransitionPrismaMock({
      initial: planningBlockFixture("completed"),
      taskStatus: "in_progress"
    });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, principal, principal.subjectId)).resolves.toMatchObject({ status: "completed" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.taskPlanningBlock.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(prisma.projectActivity.create).not.toHaveBeenCalled();
    expect(prisma.taskStatusHistory.create).not.toHaveBeenCalled();
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
    expect(prisma.taskTimeEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns idempotent success when a competing request already reached the target", async () => {
    const prisma = createPlanningTransitionPrismaMock({
      updateCount: 0,
      current: planningBlockFixture("completed", new Date("2026-07-13T00:02:00.000Z")),
      taskStatus: "in_progress"
    });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, principal, principal.subjectId)).resolves.toMatchObject({ status: "completed" });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(prisma.projectActivity.create).not.toHaveBeenCalled();
    expect(prisma.taskStatusHistory.create).not.toHaveBeenCalled();
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
    expect(prisma.taskTimeEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it("denies completing another user's planning block without a time-review role", async () => {
    const prisma = createPlanningTransitionPrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    const otherUserPrincipal = {
      ...principal,
      subjectId: "usr-other",
      roleCodes: []
    };

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, otherUserPrincipal, otherUserPrincipal.subjectId)).rejects.toThrow(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.taskPlanningBlock.updateMany).not.toHaveBeenCalled();
    expect(prisma.taskTimeEntry.upsert).not.toHaveBeenCalled();
  });

  it("allows Delivery Lead to complete planning for another user", async () => {
    const prisma = createPlanningTransitionPrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    const deliveryLead = {
      ...principal,
      subjectId: "usr-lead",
      roleCodes: ["DELIVERY_LEAD"]
    };

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, deliveryLead, deliveryLead.subjectId)).resolves.toMatchObject({
      id: "plan-1",
      status: "completed"
    });

    expect(prisma.taskTimeEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "usr-1" })
    }));
  });

  it("rejects a stale transition when the current state differs from the target", async () => {
    const prisma = createPlanningTransitionPrismaMock({
      updateCount: 0,
      current: planningBlockFixture("in_progress", new Date("2026-07-13T00:02:00.000Z"))
    });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, principal, principal.subjectId)).rejects.toThrow(ConflictException);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(prisma.projectActivity.create).not.toHaveBeenCalled();
  });

  it("rejects transitions out of a terminal state", async () => {
    const prisma = createPlanningTransitionPrismaMock({ initial: planningBlockFixture("completed") });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "cancelled",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, principal, principal.subjectId)).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or cross-workspace planning block", async () => {
    const prisma = createPlanningTransitionPrismaMock({ initial: null });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("other-workspace-plan", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, principal, principal.subjectId)).rejects.toThrow(NotFoundException);
    expect(prisma.taskPlanningBlock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "other-workspace-plan", workspaceId: "twk-1" }
    }));
  });

  it("denies portal principals before reading or mutating planning data", async () => {
    const prisma = createPlanningTransitionPrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, portalPrincipal, portalPrincipal.subjectId)).rejects.toThrow(ForbiddenException);
    expect(prisma.taskPlanningBlock.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps mutation and audit in one transaction and stops when audit persistence fails", async () => {
    const prisma = createPlanningTransitionPrismaMock({ auditError: new Error("audit unavailable") });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.transitionTaskPlanningBlock("plan-1", {
      status: "completed",
      expectedUpdatedAt: planningUpdatedAt.toISOString()
    }, principal, principal.subjectId)).rejects.toThrow("audit unavailable");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.taskPlanningBlock.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.projectActivity.create).not.toHaveBeenCalled();
  });
});

function createStageDeletePrismaMock() {
  const stageRecord = {
    id: "stage-1",
    accountId: "acc-1",
    account: { name: "Account" },
    projectId: "prj-1",
    project: { name: "Project" },
    milestoneId: "milestone-1",
    milestone: { id: "milestone-1", name: "Implementation", sortOrder: 10 },
    workspaceId: "twk-1",
    stageKey: "implementation",
    phase: "Implementation",
    activity: "Build feature",
    sortOrder: 10,
    cumulativePercent: 50,
    activityPercent: 25,
    criteria: "Done",
    status: "in_progress",
    progressPercent: 50,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z")
  };
  const prisma: Record<string, any> = {
    projectStage: {
      findFirst: vi.fn().mockResolvedValue(stageRecord),
      findMany: vi.fn().mockResolvedValue([
        { id: "stage-1" },
        { id: "stage-2" }
      ]),
      update: vi.fn().mockResolvedValue(stageRecord),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0)
    },
    projectTask: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ id: "task-1" }])
        .mockResolvedValueOnce([{ id: "task-2" }])
        .mockResolvedValueOnce([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 })
    },
    projectMilestone: {
      update: vi.fn().mockResolvedValue({ id: "milestone-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "milestone-2", sortOrder: 20 }),
      delete: vi.fn().mockResolvedValue({ id: "milestone-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    project: {
      update: vi.fn().mockResolvedValue({ hierarchyOrderVersion: 1 })
    },
    taskAttachment: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    taskComment: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    taskPlanningBlock: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    taskTimeEntry: {
      findMany: vi.fn().mockResolvedValue([{ id: "time-1" }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    projectCost: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    taskStatusHistory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    projectMember: {
      findMany: vi.fn().mockResolvedValue([{ userId: "usr-1" }])
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: "usr-1" }])
    }
  };
  prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: "prj-1", hierarchyOrderVersion: 0 }]);
  prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
  return prisma;
}

function createTaskUpdatePrismaMock() {
  const taskRecord = {
    id: "task-1",
    workspaceId: "twk-1",
    accountId: "acc-1",
    account: { name: "Account" },
    projectId: "prj-1",
    project: { name: "Project" },
    stageId: "stage-1",
    stage: { stageKey: "implementation", activity: "Build feature" },
    opportunityId: null,
    ticketId: null,
    parentTaskId: null,
    title: "Renamed task",
    description: null,
    taskType: "implementation",
    status: "todo",
    priority: "medium",
    ownerUserId: null,
    owner: null,
    assigneeUserId: null,
    assignee: null,
    ownerTeamId: null,
    ownerTeam: null,
    plannedStartAt: null,
    dueAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    estimateMinutes: 480,
    customerVisible: false,
    createdByUserId: "usr-1",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    statusHistory: [],
    timeEntries: []
  };
  const prisma: Record<string, any> = {
    account: {
      findFirst: vi.fn().mockResolvedValue({ id: "acc-1", workspaceId: "twk-1" })
    },
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1" }),
      update: vi.fn().mockResolvedValue({ hierarchyOrderVersion: 1 })
    },
    projectStage: {
      findFirst: vi.fn().mockResolvedValue({ id: "stage-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1" })
    },
    projectTask: {
      findFirst: vi.fn().mockResolvedValue(taskRecord),
      update: vi.fn().mockResolvedValue(taskRecord)
    },
    taskStatusHistory: {
      create: vi.fn()
    },
    projectMember: {
      findMany: vi.fn().mockResolvedValue([{ userId: "usr-1" }])
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: "usr-1" }])
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  };
  return prisma;
}

function createTaskCreatePrismaMock() {
  const prisma = {
    account: {
      findFirst: vi.fn().mockResolvedValue({ id: "acc-1", workspaceId: "twk-1" })
    },
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: "prj-1", workspaceId: "twk-1", accountId: "acc-1" }),
      update: vi.fn().mockResolvedValue({ hierarchyOrderVersion: 1 })
    },
    projectStage: {
      findFirst: vi.fn().mockResolvedValue({ id: "stage-1", workspaceId: "twk-1", accountId: "acc-1", projectId: "prj-1" })
    },
    projectTask: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => ({
        id: "task-created",
        ...data,
        account: { name: "Account" },
        project: { name: "Project" },
        stage: { stageKey: "implementation", activity: "Build feature" },
        owner: null,
        assignee: null,
        ownerTeam: null,
        archivedAt: null,
        archivedByUserId: null,
        archiveReason: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-07-13T00:00:00.000Z"),
        updatedAt: new Date("2026-07-13T00:00:00.000Z"),
        statusHistory: [],
        timeEntries: []
      }))
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "prj-1", hierarchyOrderVersion: 0 }]),
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  };

  return prisma;
}

describe("ProjectsService.createTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists trimmed description and the canonical planned start instant", async () => {
    const prisma = createTaskCreatePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    const created = await service.createTask({
      accountId: "acc-1",
      projectId: "prj-1",
      stageId: "stage-1",
      title: "  Prepare rollout  ",
      description: "  Confirm the production checklist.  ",
      plannedStartAt: "2026-07-14T00:00:00.000Z",
      dueAt: "2026-07-15T00:00:00.000Z"
    }, principal, principal.subjectId);

    expect(prisma.projectTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Prepare rollout",
        description: "Confirm the production checklist.",
        plannedStartAt: new Date("2026-07-14T00:00:00.000Z"),
        dueAt: new Date("2026-07-15T00:00:00.000Z")
      }),
      include: expect.any(Object)
    });
    expect(created).toMatchObject({
      description: "Confirm the production checklist.",
      plannedStartAt: "2026-07-14T00:00:00.000Z",
      dueAt: "2026-07-15T00:00:00.000Z"
    });
  });

  it("rejects a planned start later than the due date before creating the task", async () => {
    const prisma = createTaskCreatePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTask({
      accountId: "acc-1",
      title: "Invalid schedule",
      plannedStartAt: "2026-07-16T00:00:00.000Z",
      dueAt: "2026-07-15T00:00:00.000Z"
    }, principal, principal.subjectId)).rejects.toThrow("plannedStartAt must not be later than dueAt");

    expect(prisma.projectTask.create).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.updateStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames milestone phase across grouped stages without overwriting stage activity", async () => {
    const prisma = createStageDeletePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await service.updateStage("prj-1", "stage-1", { phase: "Renamed Milestone", activity: "Should not apply" }, principal, {
      scope: "milestone"
    });

    expect(prisma.projectMilestone.update).toHaveBeenCalledWith({
      where: { id: "milestone-1" },
      data: { name: "Renamed Milestone", normalizedKey: "renamed milestone" }
    });
    expect(prisma.projectStage.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: "prj-1",
        workspaceId: "twk-1",
        milestoneId: "milestone-1"
      },
      data: expect.objectContaining({
        phase: "Renamed Milestone"
      })
    });
    const updateData = prisma.projectStage.updateMany.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("activity");
    expect(updateData).not.toHaveProperty("sortOrder");
    expect(Object.values(updateData)).not.toContain(undefined);
    expect(prisma.projectStage.update).not.toHaveBeenCalled();
  });

  it("rejects milestone rename collisions without changing stage compatibility fields", async () => {
    const prisma = createStageDeletePrismaMock();
    prisma.projectMilestone.findFirst.mockResolvedValue({ id: "milestone-existing" });
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateStage(
      "prj-1",
      "stage-1",
      { phase: "Existing Milestone" },
      principal,
      { scope: "milestone" }
    )).rejects.toThrow(BadRequestException);

    expect(prisma.projectMilestone.update).not.toHaveBeenCalled();
    expect(prisma.projectStage.updateMany).not.toHaveBeenCalled();
  });

  it("rejects direct sortOrder writes outside the complete hierarchy endpoint", async () => {
    const prisma = createStageDeletePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateStage(
      "prj-1",
      "stage-1",
      { sortOrder: 999 } as any,
      principal
    )).rejects.toThrow(BadRequestException);

    expect(prisma.projectStage.findFirst).not.toHaveBeenCalled();
  });

  it("renames a stage without sending undefined fields to Prisma", async () => {
    const prisma = createStageDeletePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await service.updateStage("prj-1", "stage-1", {
      activity: "Renamed stage",
      ownerUserId: null,
      plannedEndAt: null
    }, principal);

    expect(prisma.projectStage.update).toHaveBeenCalledWith({
      where: { id: "stage-1" },
      data: expect.objectContaining({
        activity: "Renamed stage",
        ownerUserId: null,
        plannedEndAt: null
      }),
      include: expect.any(Object)
    });
    const updateData = prisma.projectStage.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("phase");
    expect(updateData).not.toHaveProperty("sortOrder");
    expect(Object.values(updateData)).not.toContain(undefined);
  });

  it("rejects invalid stage owner ids before Prisma foreign key errors", async () => {
    const prisma = createStageDeletePrismaMock();
    prisma.user.findMany.mockResolvedValue([]);
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateStage("prj-1", "stage-1", {
      ownerUserId: "U"
    }, principal, { scope: "milestone" })).rejects.toThrow(BadRequestException);

    expect(prisma.projectStage.updateMany).not.toHaveBeenCalled();
    expect(prisma.projectStage.update).not.toHaveBeenCalled();
  });

  it("rejects active stage owners who are not project members", async () => {
    const prisma = createStageDeletePrismaMock();
    prisma.user.findMany.mockResolvedValue([{ id: "usr-outside" }]);
    prisma.projectMember.findMany.mockResolvedValue([]);
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateStage("prj-1", "stage-1", {
      ownerUserId: "usr-outside"
    }, principal)).rejects.toThrow(BadRequestException);

    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "twk-1",
        projectId: "prj-1",
        userId: { in: ["usr-outside"] }
      },
      select: { userId: true }
    });
    expect(prisma.projectStage.update).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.updateTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames a task without sending undefined fields to Prisma", async () => {
    const prisma = createTaskUpdatePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await service.updateTask("task-1", {
      projectId: "prj-1",
      stageId: "stage-1",
      title: "Renamed task",
      description: null,
      dueAt: null,
      estimateMinutes: 480
    }, principal);

    expect(prisma.projectTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        projectId: "prj-1",
        stageId: "stage-1",
        title: "Renamed task",
        description: null,
        dueAt: null,
        estimateMinutes: 480
      }),
      include: expect.any(Object)
    });
    const updateData = prisma.projectTask.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("taskType");
    expect(updateData).not.toHaveProperty("ownerTeamId");
    expect(Object.values(updateData)).not.toContain(undefined);
  });

  it.each(["SALES_OWNER", "DELIVERY_LEAD", "FOUNDER_GM"])("rejects project relocation through PATCH for %s, preserving the dedicated hierarchy boundary", async (roleCode) => {
    const prisma = createTaskUpdatePrismaMock();
    const current = await prisma.projectTask.findFirst();
    prisma.projectTask.findFirst.mockResolvedValue({ ...current, assigneeUserId: "usr-1" });
    prisma.project.findFirst.mockImplementation(async ({ where }: any) => ({ id: where.id, workspaceId: "twk-1", accountId: "acc-1" }));
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateTask("task-1", { projectId: "prj-2", stageId: null }, {
      ...principal, roleCodes: [roleCode]
    })).rejects.toThrow("Task hierarchy parent changes require a dedicated move endpoint");
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects invalid task assignee ids before Prisma foreign key errors", async () => {
    const prisma = createTaskUpdatePrismaMock();
    prisma.user.findMany.mockResolvedValue([]);
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateTask("task-1", {
      assigneeUserId: "U",
      ownerUserId: "U"
    }, principal)).rejects.toThrow(BadRequestException);

    expect(prisma.projectTask.update).not.toHaveBeenCalled();
  });

  it("rejects active task assignees who are not project members", async () => {
    const prisma = createTaskUpdatePrismaMock();
    prisma.user.findMany.mockResolvedValue([{ id: "usr-outside" }]);
    prisma.projectMember.findMany.mockResolvedValue([]);
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateTask("task-1", {
      assigneeUserId: "usr-outside",
      ownerUserId: "usr-outside"
    }, principal)).rejects.toThrow(BadRequestException);

    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "twk-1",
        projectId: "prj-1",
        userId: { in: ["usr-outside"] }
      },
      select: { userId: true }
    });
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.deleteStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a stage together with its tasks and task-scoped records", async () => {
    const prisma = createStageDeletePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteStage("prj-1", "stage-1", principal)).resolves.toMatchObject({
      deleted: true,
      id: "stage-1",
      scope: "stage",
      deletedStageIds: ["stage-1"],
      deletedTaskIds: ["task-1", "task-2"]
    });

    const taskFilter = { in: ["task-1", "task-2"] };
    expect(prisma.taskAttachment.deleteMany).toHaveBeenCalledWith({ where: { taskId: taskFilter, workspaceId: "twk-1" } });
    expect(prisma.taskComment.deleteMany).toHaveBeenCalledWith({ where: { taskId: taskFilter, workspaceId: "twk-1" } });
    expect(prisma.taskPlanningBlock.deleteMany).toHaveBeenCalledWith({ where: { taskId: taskFilter, workspaceId: "twk-1" } });
    expect(prisma.projectCost.updateMany).toHaveBeenCalledWith({
      where: {
        taskTimeEntryId: { in: ["time-1"] },
        workspaceId: "twk-1"
      },
      data: { taskTimeEntryId: null }
    });
    expect(prisma.taskTimeEntry.deleteMany).toHaveBeenCalledWith({ where: { taskId: taskFilter, workspaceId: "twk-1" } });
    expect(prisma.taskStatusHistory.deleteMany).toHaveBeenCalledWith({ where: { taskId: taskFilter, workspaceId: "twk-1" } });
    expect(prisma.projectTask.deleteMany).toHaveBeenCalledWith({ where: { id: taskFilter, workspaceId: "twk-1" } });
    expect(prisma.projectStage.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["stage-1"] },
        projectId: "prj-1",
        workspaceId: "twk-1"
      }
    });
  });

  it("deletes all stages in the same milestone phase when scope is milestone", async () => {
    const prisma = createStageDeletePrismaMock();
    prisma.projectTask.findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "task-1" },
        { id: "task-2" }
      ])
      .mockResolvedValueOnce([]);
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteStage("prj-1", "stage-1", principal, { scope: "milestone" })).resolves.toMatchObject({
      deleted: true,
      id: "stage-1",
      scope: "milestone",
      deletedStageIds: ["stage-1", "stage-2"],
      deletedTaskIds: ["task-1", "task-2"]
    });

    expect(prisma.projectStage.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "prj-1",
        workspaceId: "twk-1",
        milestoneId: "milestone-1"
      },
      select: { id: true }
    });
    expect(prisma.projectStage.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["stage-1", "stage-2"] },
        projectId: "prj-1",
        workspaceId: "twk-1"
      }
    });
  });

  it("denies portal principals before deleting stage or task records", async () => {
    const prisma = createStageDeletePrismaMock();
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteStage("prj-1", "stage-1", portalPrincipal)).rejects.toThrow(ForbiddenException);
    expect(prisma.projectStage.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectStage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.projectTask.deleteMany).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.listProjects", () => {
  it("maps the On Hold filter to imported paused project statuses", async () => {
    const prisma = {
      project: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(13)
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await service.listProjects({ limit: 10, offset: 0, status: "on_hold" }, principal);

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "twk-1",
          AND: [
            {
              OR: [
                { status: { equals: "on_hold", mode: "insensitive" } },
                { status: { equals: "paused", mode: "insensitive" } },
                { status: { equals: "pause", mode: "insensitive" } }
              ]
            }
          ]
        })
      })
    );
    expect(prisma.project.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: "twk-1",
        AND: expect.any(Array)
      })
    });
  });
});

describe("ProjectsService.listProjectActivities", () => {
  it("builds an exact activity feed from status history, actual work, and planning records", async () => {
    const prisma = {
      project: {
        findFirst: vi.fn().mockResolvedValue({
          id: "prj-1",
          workspaceId: "twk-1",
          accountId: "acc-1"
        })
      },
      projectActivity: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      },
      taskStatusHistory: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "hist-1",
            workspaceId: "twk-1",
            taskId: "task-1",
            accountId: "acc-1",
            projectId: "prj-1",
            fromStatus: "todo",
            toStatus: "in_progress",
            changedByUserId: "usr-1",
            changedAt: new Date("2026-07-02T02:30:00.000Z"),
            reason: "Task updated",
            task: {
              title: "Configure approval workflow",
              account: { name: "AMOBEAR" },
              project: { name: "AMOBEAR - HRM" }
            },
            changedBy: {
              displayName: "Nguyen Hung Viet Kha",
              avatarUrl: "https://example.com/avatar.png"
            }
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      },
      taskTimeEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "time-1",
            taskId: "task-1",
            accountId: "acc-1",
            projectId: "prj-1",
            userId: "usr-1",
            workDate: new Date("2026-07-02T03:00:00.000Z"),
            minutes: 180,
            workType: "delivery",
            note: "Actual implementation",
            createdAt: new Date("2026-07-02T03:01:00.000Z"),
            updatedAt: new Date("2026-07-02T03:01:00.000Z"),
            task: {
              title: "Configure approval workflow",
              account: { name: "AMOBEAR" },
              project: { name: "AMOBEAR - HRM" }
            },
            user: {
              displayName: "Nguyen Hung Viet Kha",
              avatarUrl: "https://example.com/avatar.png"
            }
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      },
      taskPlanningBlock: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "plan-1",
            taskId: "task-1",
            accountId: "acc-1",
            account: { name: "AMOBEAR" },
            projectId: "prj-1",
            project: { name: "AMOBEAR - HRM" },
            userId: "usr-1",
            title: "Configure approval workflow",
            startAt: new Date("2026-07-02T01:00:00.000Z"),
            endAt: new Date("2026-07-02T04:00:00.000Z"),
            plannedMinutes: 180,
            notes: "Planned implementation",
            createdByUserId: "usr-1",
            createdAt: new Date("2026-07-02T00:55:00.000Z"),
            updatedAt: new Date("2026-07-02T00:55:00.000Z"),
            task: { title: "Configure approval workflow" },
            user: {
              displayName: "Nguyen Hung Viet Kha",
              avatarUrl: "https://example.com/avatar.png"
            }
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.listProjectActivities("prj-1", { limit: 10 }, principal)).resolves.toMatchObject({
      data: [
        {
          id: "task-time:time-1",
          activityType: "work_logged",
          actionLabel: "Logged actual work",
          occurredTime: "10:00",
          createdByDisplayName: "Nguyen Hung Viet Kha",
          createdByAvatarUrl: "https://example.com/avatar.png"
        },
        {
          id: "task-status:hist-1",
          activityType: "task_status_changed",
          actionLabel: "Status changed",
          occurredTime: "09:30",
          fromValue: "To do",
          toValue: "In progress",
          target: "To do -> In progress",
          createdByDisplayName: "Nguyen Hung Viet Kha",
          createdByAvatarUrl: "https://example.com/avatar.png"
        },
        {
          id: "task-plan:plan-1",
          activityType: "work_planned",
          actionLabel: "Planned work",
          occurredTime: "08:00"
        }
      ],
      meta: {
        pagination: {
          total: 3,
          returned: 3
        }
      }
    });

    expect(prisma.projectActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: "twk-1",
        projectId: "prj-1",
        activityType: { notIn: ["work_logged", "work_planned", "task_status_changed"] }
      }),
      take: 10
    }));
    expect(prisma.taskStatusHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    expect(prisma.taskTimeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    expect(prisma.taskPlanningBlock.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });
});

describe("ProjectsService.createTimeEntry", () => {
  it("persists actual work, promotes task status, and records project activity", async () => {
    const workDate = "2026-07-01T02:00:00.000Z";
    const startAt = "2026-07-01T02:00:00.000Z";
    const endAt = "2026-07-01T04:00:00.000Z";
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: "prj-1",
          title: "Configure approval workflow",
          status: "todo",
          startedAt: null
        }),
        update: vi.fn().mockResolvedValue({ id: "task-1" })
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "usr-1" }])
      },
      taskStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: "hist-1" })
      },
      taskTimeEntry: {
        create: vi.fn().mockResolvedValue({
          id: "time-1",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          userId: "usr-1",
          user: { id: "usr-1", displayName: "Test User" },
          workDate: new Date(workDate),
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          timeZone: "Asia/Ho_Chi_Minh",
          minutes: 120,
          billable: true,
          workType: "08:00 - 10:00",
          approvalStatus: "submitted",
          note: "Finished workflow setup",
          createdAt: new Date(workDate)
        }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { minutes: 480 } })
      },
      projectActivity: {
        create: vi.fn().mockResolvedValue({ id: "act-1" })
      },
      $queryRaw: vi.fn().mockResolvedValue([{
        id: "task-1",
        workspaceId: "twk-1",
        accountId: "acc-1",
        projectId: "prj-1",
        status: "todo",
        startedAt: null
      }]),
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTimeEntry("task-1", {
      userId: "usr-1",
      workDate,
      startAt,
      endAt,
      timeZone: "Asia/Ho_Chi_Minh",
      minutes: 120,
      workType: "08:00 - 10:00",
      approvalStatus: "submitted",
      note: "Finished workflow setup"
    }, principal, "usr-1")).resolves.toMatchObject({
      id: "time-1",
      userDisplayName: "Test User",
      minutes: 120,
      approvalStatus: "submitted",
      dailyActualLog: {
        localDate: "2026-07-01",
        timeZone: "Asia/Ho_Chi_Minh",
        totalMinutes: 480,
        targetMinutes: 480,
        state: "target_met"
      }
    });

    expect(prisma.taskTimeEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workDate: new Date(startAt),
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        timeZone: "Asia/Ho_Chi_Minh",
        minutes: 120,
        approvalStatus: "submitted"
      })
    }));

    expect(prisma.taskStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        fromStatus: "todo",
        toStatus: "in_progress",
        reason: "Actual work logged"
      })
    });
    expect(prisma.projectTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({ status: "in_progress" })
    });
    expect(prisma.projectActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "prj-1",
        activityType: "work_logged",
        subject: "Logged work: Configure approval workflow"
      })
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(prisma.$queryRaw.mock.calls[1][1]).toBe("[\"twk-1\",\"usr-1\",\"2026-07-01\"]");
    expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      prisma.taskTimeEntry.create.mock.invocationCallOrder[0]
    );
    expect(prisma.taskTimeEntry.aggregate).toHaveBeenCalledWith({
      where: {
        workspaceId: "twk-1",
        userId: "usr-1",
        approvalStatus: { in: ["submitted", "approved", "done"] },
        OR: [
          {
            startAt: {
              gte: new Date("2026-06-30T17:00:00.000Z"),
              lt: new Date("2026-07-01T17:00:00.000Z")
            }
          },
          {
            startAt: null,
            workDate: {
              gte: new Date("2026-06-30T17:00:00.000Z"),
              lt: new Date("2026-07-01T17:00:00.000Z")
            }
          }
        ]
      },
      _sum: { minutes: true }
    });
  });

  it("returns over-target metadata and uses workDate for a legacy entry without a start window", async () => {
    const workDate = "2026-07-01T17:00:00.000Z";
    const createdAt = new Date("2026-07-01T17:01:00.000Z");
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-legacy",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: null,
          title: "Legacy actual work",
          status: "in_progress",
          startedAt: new Date(workDate)
        })
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "usr-1" }])
      },
      taskTimeEntry: {
        create: vi.fn().mockResolvedValue({
          id: "time-legacy",
          taskId: "task-legacy",
          accountId: "acc-1",
          projectId: null,
          userId: "usr-1",
          user: { id: "usr-1", displayName: "Test User" },
          workDate: new Date(workDate),
          startAt: null,
          endAt: null,
          timeZone: "Asia/Ho_Chi_Minh",
          minutes: 45,
          billable: true,
          workType: "delivery",
          approvalStatus: "submitted",
          note: "Legacy entry",
          createdAt
        }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { minutes: 525 } })
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "task-legacy", status: "in_progress", startedAt: new Date(workDate) }]),
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTimeEntry("task-legacy", {
      userId: "usr-1",
      workDate,
      minutes: 45,
      approvalStatus: "submitted",
      note: "Legacy entry"
    }, principal, "usr-1")).resolves.toMatchObject({
      id: "time-legacy",
      dailyActualLog: {
        localDate: "2026-07-02",
        totalMinutes: 525,
        targetMinutes: 480,
        state: "over_target"
      }
    });

    expect(prisma.taskTimeEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: "twk-1",
        userId: "usr-1",
        approvalStatus: { in: ["submitted", "approved", "done"] },
        OR: [
          {
            startAt: {
              gte: new Date("2026-07-01T17:00:00.000Z"),
              lt: new Date("2026-07-02T17:00:00.000Z")
            }
          },
          {
            startAt: null,
            workDate: {
              gte: new Date("2026-07-01T17:00:00.000Z"),
              lt: new Date("2026-07-02T17:00:00.000Z")
            }
          }
        ]
      })
    }));
  });
});

describe("ProjectsService.updateTask", () => {
  it("records task status history when a direct task patch changes status", async () => {
    const updatedTask = {
      id: "task-1",
      workspaceId: "twk-1",
      accountId: "acc-1",
      account: { name: "AMOBEAR" },
      projectId: "prj-1",
      project: { name: "AMOBEAR - HRM" },
      title: "Configure approval workflow",
      description: null,
      taskType: "implementation",
      status: "in_progress",
      priority: "medium",
      ownerUserId: null,
      assigneeUserId: null,
      ownerTeamId: null,
      plannedStartAt: null,
      dueAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      estimateMinutes: 180,
      customerVisible: false,
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T02:30:00.000Z"),
      statusHistory: [],
      timeEntries: []
    };
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          ...updatedTask,
          status: "todo"
        }),
        update: vi.fn().mockResolvedValue(updatedTask)
      },
      taskStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: "hist-1" })
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.updateTask("task-1", { status: "in_progress" }, principal, "usr-1")).resolves.toMatchObject({
      id: "task-1",
      status: "in_progress"
    });

    expect(prisma.taskStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "twk-1",
        taskId: "task-1",
        accountId: "acc-1",
        projectId: "prj-1",
        fromStatus: "todo",
        toStatus: "in_progress",
        changedByUserId: "usr-1",
        reason: "Task updated"
      })
    });
  });
});

describe("ProjectsService.listTaskTimeEntries", () => {
  it("does not hide legacy submitted actual work when no approval filter is requested", async () => {
    const prisma = {
      taskTimeEntry: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await service.listTaskTimeEntries({
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-07-01T00:00:00.000Z",
      limit: 10
    }, principal);

    expect(prisma.taskTimeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: "twk-1",
        OR: [
          { startAt: { gte: new Date("2026-06-01T00:00:00.000Z"), lt: new Date("2026-07-01T00:00:00.000Z") } },
          { startAt: null, workDate: { gte: new Date("2026-06-01T00:00:00.000Z"), lt: new Date("2026-07-01T00:00:00.000Z") } }
        ]
      }
    }));
  });

  it("lists actual work entries for the calendar range with task/project context", async () => {
    const prisma = {
      taskTimeEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "time-1",
            taskId: "task-1",
            accountId: "acc-1",
            account: { name: "AMOBEAR" },
            projectId: "prj-1",
            project: { name: "AMOBEAR - HRM" },
            task: { title: "Run UAT" },
            userId: "usr-1",
            user: { displayName: "Test User", email: "test@example.com", avatarUrl: "https://example.com/avatar.png" },
            workDate: new Date("2026-07-02T02:00:00.000Z"),
            startAt: new Date("2026-07-02T02:00:00.000Z"),
            endAt: new Date("2026-07-02T03:30:00.000Z"),
            timeZone: "Asia/Ho_Chi_Minh",
            minutes: 90,
            billable: true,
            workType: "delivery",
            approvalStatus: "submitted",
            note: "Actual UAT",
            createdAt: new Date("2026-07-02T02:00:00.000Z")
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.listTaskTimeEntries({
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-08T00:00:00.000Z",
      approvalStatus: "done",
      limit: 10
    }, principal)).resolves.toMatchObject({
      data: [
        {
          id: "time-1",
          taskTitle: "Run UAT",
          projectName: "AMOBEAR - HRM",
          userDisplayName: "Test User",
          minutes: 90,
          startAt: "2026-07-02T02:00:00.000Z",
          endAt: "2026-07-02T03:30:00.000Z",
          timeZone: "Asia/Ho_Chi_Minh",
          approvalStatus: "submitted"
        }
      ]
    });

    expect(prisma.taskTimeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        task: { include: { account: true, project: true } },
        user: true,
        reviewedBy: true
      },
      where: expect.objectContaining({
        workspaceId: "twk-1",
        OR: [
          { startAt: { gte: new Date("2026-07-01T00:00:00.000Z"), lt: new Date("2026-07-08T00:00:00.000Z") } },
          { startAt: null, workDate: { gte: new Date("2026-07-01T00:00:00.000Z"), lt: new Date("2026-07-08T00:00:00.000Z") } }
        ],
        approvalStatus: "approved"
      })
    }));
  });
});

describe("ProjectsService.deleteTaskPlanningBlock", () => {
  it("deletes a completed planning block and lets the database retain generated actual time", async () => {
    const prisma = {
      taskPlanningBlock: {
        findFirst: vi.fn().mockResolvedValue({ id: "plan-1", userId: "usr-owner" }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTaskPlanningBlock("plan-1", principal)).resolves.toEqual({
      deleted: true,
      id: "plan-1"
    });

    expect(prisma.taskPlanningBlock.deleteMany).toHaveBeenCalledWith({
      where: { id: "plan-1", workspaceId: "twk-1" }
    });
  });

  it("allows the planning owner to delete without a privileged role", async () => {
    const prisma = {
      taskPlanningBlock: {
        findFirst: vi.fn().mockResolvedValue({ id: "plan-owner", userId: "usr-owner" }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    const owner = { ...principal, subjectId: "usr-owner", roleCodes: [] };

    await expect(service.deleteTaskPlanningBlock("plan-owner", owner)).resolves.toEqual({
      deleted: true,
      id: "plan-owner"
    });
  });

  it.each([
    ["Founder/GM", ["FOUNDER_GM"]],
    ["secondary Delivery Lead", ["SALES_OWNER", "DELIVERY_LEAD"]]
  ])("allows %s to delete another user's planning block", async (_label, roleCodes) => {
    const prisma = {
      taskPlanningBlock: {
        findFirst: vi.fn().mockResolvedValue({ id: "plan-other", userId: "usr-owner" }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    const privileged = { ...principal, subjectId: "usr-privileged", roleCodes };

    await expect(service.deleteTaskPlanningBlock("plan-other", privileged)).resolves.toEqual({
      deleted: true,
      id: "plan-other"
    });
  });

  it("denies an unrelated internal user before deleting another user's planning block", async () => {
    const prisma = {
      taskPlanningBlock: {
        findFirst: vi.fn().mockResolvedValue({ id: "plan-other", userId: "usr-owner" }),
        deleteMany: vi.fn()
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    const unrelated = { ...principal, subjectId: "usr-unrelated", roleCodes: [] };

    await expect(service.deleteTaskPlanningBlock("plan-other", unrelated)).rejects.toThrow(ForbiddenException);
    expect(prisma.taskPlanningBlock.deleteMany).not.toHaveBeenCalled();
  });

  it("returns not found without deleting a planning block from another workspace", async () => {
    const prisma = {
      taskPlanningBlock: {
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn()
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTaskPlanningBlock("foreign-plan", principal)).rejects.toThrow(NotFoundException);
    expect(prisma.taskPlanningBlock.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-plan", workspaceId: "twk-1" },
      select: { id: true, userId: true }
    });
    expect(prisma.taskPlanningBlock.deleteMany).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.deleteTaskTimeEntry", () => {
  it("deletes an actual work entry and unlinks cost rows in the same workspace", async () => {
    const prisma: Record<string, any> = {
      taskTimeEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: "time-1" }),
        delete: vi.fn().mockResolvedValue({ id: "time-1" })
      },
      projectCost: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTaskTimeEntry("time-1", principal)).resolves.toEqual({
      deleted: true,
      id: "time-1"
    });

    expect(prisma.taskTimeEntry.findFirst).toHaveBeenCalledWith({
      where: { id: "time-1", workspaceId: "twk-1" },
      select: { id: true }
    });
    expect(prisma.projectCost.updateMany).toHaveBeenCalledWith({
      where: { taskTimeEntryId: "time-1", workspaceId: "twk-1" },
      data: { taskTimeEntryId: null }
    });
    expect(prisma.taskTimeEntry.delete).toHaveBeenCalledWith({ where: { id: "time-1" } });
  });

  it("returns not found when the actual work entry is outside the principal workspace", async () => {
    const prisma: Record<string, any> = {
      taskTimeEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
        delete: vi.fn()
      },
      projectCost: {
        updateMany: vi.fn()
      },
      $transaction: vi.fn()
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTaskTimeEntry("time-1", principal)).rejects.toThrow(NotFoundException);

    expect(prisma.taskTimeEntry.findFirst).toHaveBeenCalledWith({
      where: { id: "time-1", workspaceId: "twk-1" },
      select: { id: true }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("denies portal users from deleting actual work entries", async () => {
    const prisma: Record<string, any> = {
      taskTimeEntry: {
        findFirst: vi.fn()
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.deleteTaskTimeEntry("time-1", portalPrincipal)).rejects.toThrow(ForbiddenException);
    expect(prisma.taskTimeEntry.findFirst).not.toHaveBeenCalled();
  });
});

describe("ProjectsService task comments and attachments", () => {
  it("persists task comments and records project activity", async () => {
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: "prj-1",
          title: "Prepare rollout"
        })
      },
      taskComment: {
        create: vi.fn().mockResolvedValue({
          id: "comment-1",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          body: "Ready for review",
          visibility: "internal",
          status: "active",
          syncStatus: "not_synced",
          createdByUserId: "usr-1",
          createdBy: {
            displayName: "Test User",
            avatarUrl: "https://example.com/avatar.png"
          },
          createdAt: new Date("2026-07-02T03:00:00.000Z"),
          updatedAt: new Date("2026-07-02T03:00:00.000Z")
        })
      },
      projectActivity: {
        create: vi.fn().mockResolvedValue({ id: "act-1" })
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTaskComment("task-1", {
      body: "Ready for review",
      visibility: "internal"
    }, principal, "usr-1")).resolves.toMatchObject({
      id: "comment-1",
      body: "Ready for review",
      syncStatus: "not_synced",
      createdByDisplayName: "Test User",
      createdByAvatarUrl: "https://example.com/avatar.png"
    });

    expect(prisma.taskComment.create).toHaveBeenCalledWith({
      include: { createdBy: true },
      data: expect.objectContaining({
        workspaceId: "twk-1",
        taskId: "task-1",
        body: "Ready for review",
        createdByUserId: "usr-1"
      })
    });
    expect(prisma.projectActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activityType: "task_comment",
        subject: "Commented on task: Prepare rollout"
      })
    });
  });

  it("links active file objects to task attachments", async () => {
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: "prj-1",
          title: "Prepare rollout"
        })
      },
      fileObject: {
        findFirst: vi.fn().mockResolvedValue({
          id: "file-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: "prj-1",
          status: "active",
          fileName: "handoff.pdf",
          contentType: "application/pdf",
          byteSize: 1234,
          checksumSha256: "abc",
          storageProvider: "local",
          ownerType: "task",
          ownerId: "task-1",
          customerVisible: false,
          internalOnly: true,
          allowedRoles: [],
          scanStatus: "pending",
          createdAt: new Date("2026-07-02T03:00:00.000Z")
        })
      },
      taskAttachment: {
        create: vi.fn().mockResolvedValue({
          id: "att-1",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          fileObjectId: "file-1",
          syncStatus: "not_synced",
          createdByUserId: "usr-1",
          createdAt: new Date("2026-07-02T03:00:00.000Z"),
          fileObject: {
            id: "file-1",
            accountId: "acc-1",
            projectId: "prj-1",
            fileName: "handoff.pdf",
            contentType: "application/pdf",
            byteSize: 1234,
            checksumSha256: "abc",
            storageProvider: "local",
            ownerType: "task",
            ownerId: "task-1",
            customerVisible: false,
            internalOnly: true,
            allowedRoles: [],
            scanStatus: "pending",
            status: "active",
            createdAt: new Date("2026-07-02T03:00:00.000Z")
          }
        })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTaskAttachment("task-1", {
      fileObjectId: "file-1"
    }, principal, "usr-1")).resolves.toMatchObject({
      id: "att-1",
      file: {
        fileName: "handoff.pdf"
      }
    });

    expect(prisma.fileObject.findFirst).toHaveBeenCalledWith({
      where: {
        id: "file-1",
        workspaceId: "twk-1",
        accountId: "acc-1",
        status: "active",
        ownerType: "task",
        ownerId: "task-1"
      }
    });
    expect(prisma.taskAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "twk-1",
        taskId: "task-1",
        fileObjectId: "file-1",
        createdByUserId: "usr-1"
      }),
      include: expect.any(Object)
    });
  });

  it("denies portal users from creating internal task comments", async () => {
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: "prj-1",
          title: "Prepare rollout",
          customerVisible: true
        })
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTaskComment("task-1", {
      body: "Internal note",
      visibility: "internal"
    }, portalPrincipal, "portal-1")).rejects.toThrow(ForbiddenException);

    expect(prisma.projectTask.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "task-1",
        workspaceId: "twk-1",
        customerVisible: true,
        OR: [{ accountId: { in: ["acc-1"] } }, { projectId: { in: ["prj-1"] } }]
      })
    });
  });

  it("denies portal users from reading planning blocks and actual work entries", async () => {
    const service = new ProjectsService({} as any);

    await expect(service.listTaskPlanningBlocks({
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-08T00:00:00.000Z"
    }, portalPrincipal)).rejects.toThrow(ForbiddenException);

    await expect(service.listTaskTimeEntries({
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-08T00:00:00.000Z"
    }, portalPrincipal)).rejects.toThrow(ForbiddenException);
  });

  it("rejects broad file reuse when attaching a file that is not owned by the task", async () => {
    const prisma: Record<string, any> = {
      projectTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          workspaceId: "twk-1",
          accountId: "acc-1",
          projectId: "prj-1",
          title: "Prepare rollout"
        })
      },
      fileObject: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createTaskAttachment("task-1", {
      fileObjectId: "file-1"
    }, principal, "usr-1")).rejects.toThrow(NotFoundException);

    expect(prisma.fileObject.findFirst).toHaveBeenCalledWith({
      where: {
        id: "file-1",
        workspaceId: "twk-1",
        accountId: "acc-1",
        status: "active",
        ownerType: "task",
        ownerId: "task-1"
      }
    });
  });
});

describe("ProjectsService interaction remediation", () => {
  it("propagates a project account change to milestones before stages", async () => {
    const updateModels = [
      "projectMilestone",
      "projectStage",
      "projectTask",
      "projectArtifact",
      "fileObject",
      "fileDownloadGrant",
      "projectComment",
      "projectActivity",
      "projectRisk",
      "projectAttachment",
      "taskComment",
      "taskAttachment",
      "taskStatusHistory",
      "taskTimeEntry",
      "projectBudget",
      "projectCost",
      "projectPlSnapshot",
      "resourceAllocation",
      "contract",
      "paymentSchedule",
      "paymentMilestone",
      "invoice",
      "invoicePayment",
      "ticket",
      "ticketStatusHistory",
      "customerAccessGrant",
      "projectProgressShareLink"
    ];
    const prisma = Object.fromEntries(updateModels.map((model) => [
      model,
      { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
    ])) as Record<string, { updateMany: ReturnType<typeof vi.fn> }>;
    const service = new ProjectsService({} as never);

    await (service as any).propagateProjectAccount(prisma, {
      workspaceId: "workspace-a",
      projectId: "project-a",
      accountId: "account-b"
    });

    expect(prisma.projectMilestone.updateMany).toHaveBeenCalledWith({
      where: { projectId: "project-a", workspaceId: "workspace-a" },
      data: { accountId: "account-b" }
    });
    expect(prisma.projectMilestone.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.projectStage.updateMany.mock.invocationCallOrder[0]);
  });

  it("rejects a project opportunity outside the selected account/workspace before writing", async () => {
    const prisma: Record<string, any> = {
      account: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", code: "ACME" }) },
      opportunity: { findFirst: vi.fn().mockResolvedValue(null) },
      project: { create: vi.fn() },
      $transaction: vi.fn()
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createProject({
      accountId: "acc-1",
      opportunityId: "opp-other-workspace",
      name: "Unsafe project"
    }, principal)).rejects.toThrow(NotFoundException);

    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: "opp-other-workspace", workspaceId: "twk-1", accountId: "acc-1" },
      select: { id: true }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists visible project metadata and workspace-validates members", async () => {
    const createdProject = {
      id: "prj-new", workspaceId: "twk-1", accountId: "acc-1", code: "ACME-NEW",
      name: "Complete project", status: "planning", projectType: "delivery", scopeSummary: "Full rollout",
      priority: "high", tags: ["crm", "launch"], color: "#1a2b3c",
      account: { name: "Acme" }, members: [], budgets: [], costs: [], stages: [], tasks: []
    };
    const prisma: Record<string, any> = {
      account: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", code: "ACME" }) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "usr-1" }, { id: "usr-2" }]) },
      project: { create: vi.fn().mockResolvedValue(createdProject), findFirstOrThrow: vi.fn().mockResolvedValue(createdProject) },
      projectMilestone: {
        create: vi.fn()
          .mockImplementation(async ({ data }: any) => ({ id: `milestone-${data.normalizedKey}`, ...data }))
      },
      projectStage: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
      projectMember: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 })
      },
      projectBudget: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "budget-1" })
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await service.createProject({
      accountId: "acc-1", code: "ACME-NEW", name: "Complete project", status: "planning",
      projectType: "delivery", scopeSummary: "Full rollout", ownerUserId: "usr-1",
      memberUserIds: ["usr-1", "usr-2"], budgetAmount: 125000,
      plannedStartAt: "2026-07-15T00:00:00.000Z", plannedEndAt: "2026-09-30T00:00:00.000Z",
      priority: "high", tags: ["crm", "launch", "crm"], color: "#1A2B3C"
    }, principal);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["usr-1", "usr-2"] }, status: "ACTIVE",
        roleBindings: { some: { workspaceId: "twk-1", tenantKey: "prod", startsAt: { lte: expect.any(Date) }, OR: [{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }] } }
      },
      select: { id: true }
    });
    expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ priority: "high", tags: ["crm", "launch"], color: "#1a2b3c" })
    }));
    expect(prisma.projectMember.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        { workspaceId: "twk-1", projectId: "prj-new", userId: "usr-1", relation: "member" },
        { workspaceId: "twk-1", projectId: "prj-new", userId: "usr-2", relation: "member" }
      ]
    }));
    expect(prisma.projectBudget.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plannedRevenueAmount: 125000, currency: "VND" })
    }));
  });

  it("reviews a submitted time entry with optimistic concurrency and audit fields", async () => {
    const updatedAt = new Date("2026-07-15T01:00:00.000Z");
    const reviewedAt = new Date("2026-07-15T01:05:00.000Z");
    const reviewedEntry = {
      id: "time-1", taskId: "task-1", accountId: "acc-1", projectId: "prj-1", userId: "usr-2",
      workDate: new Date("2026-07-15T00:00:00.000Z"), minutes: 60, billable: true, workType: "delivery",
      approvalStatus: "approved", reviewedByUserId: "usr-1", reviewedAt, reviewNote: "Checked",
      createdAt: new Date("2026-07-15T00:00:00.000Z"), updatedAt: reviewedAt,
      task: { title: "Configure CRM", account: { name: "Acme" }, project: { name: "CRM" } },
      user: { displayName: "Consultant" }, reviewedBy: { displayName: "Delivery Lead" }
    };
    const prisma: Record<string, any> = {
      taskTimeEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: "time-1", approvalStatus: "submitted", updatedAt }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue(reviewedEntry)
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.reviewTaskTimeEntry("time-1", {
      status: "approved", expectedUpdatedAt: updatedAt.toISOString(), reason: "Checked"
    }, principal)).resolves.toMatchObject({
      id: "time-1", approvalStatus: "approved", reviewedByUserId: "usr-1",
      reviewedByDisplayName: "Delivery Lead", reviewNote: "Checked"
    });
    expect(prisma.taskTimeEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: "twk-1", approvalStatus: "submitted", updatedAt }),
      data: expect.objectContaining({ reviewedByUserId: "usr-1", reviewNote: "Checked" })
    }));
  });

  it("rejects a stale time-entry review without updating", async () => {
    const prisma: Record<string, any> = {
      taskTimeEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: "time-1", approvalStatus: "submitted", updatedAt: new Date("2026-07-15T02:00:00.000Z")
        }),
        updateMany: vi.fn()
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    await expect(service.reviewTaskTimeEntry("time-1", {
      status: "rejected", expectedUpdatedAt: "2026-07-15T01:00:00.000Z", reason: "Incorrect hours"
    }, principal)).rejects.toThrow(ConflictException);
    expect(prisma.taskTimeEntry.updateMany).not.toHaveBeenCalled();
  });

  it("creates a project document with immutable binary version 1", async () => {
    const file = {
      id: "file-1", accountId: "acc-1", projectId: "prj-1", fileName: "requirements.pdf",
      contentType: "application/pdf", byteSize: 42, checksumSha256: "abc123", storageProvider: "local",
      storageKey: "twk-1/acc-1/file-1", ownerType: "general", customerVisible: false,
      internalOnly: true, allowedRoles: [], scanStatus: "clean", status: "active",
      createdAt: new Date("2026-07-15T00:00:00.000Z")
    };
    const artifact = {
      id: "doc-1", accountId: "acc-1", projectId: "prj-1", code: "PRJ-DOC-1", name: "Requirements",
      artifactType: "requirements", storageKey: file.storageKey, customerVisible: false, internalOnly: true,
      allowedRoles: [], signedUrlExpiresSeconds: 300, createdAt: new Date("2026-07-15T00:00:00.000Z"),
      updatedAt: new Date("2026-07-15T00:00:00.000Z"), account: { name: "Acme" }, project: { name: "CRM" },
      versions: [{
        id: "doc-version-1", artifactId: "doc-1", fileObjectId: "file-1", version: 1, note: "Initial",
        createdByUserId: "usr-1", createdAt: new Date("2026-07-15T00:00:00.000Z"),
        fileObject: file, createdBy: { displayName: "Test User" }
      }]
    };
    const prisma: Record<string, any> = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ" }) },
      fileObject: { findFirst: vi.fn().mockResolvedValue(file), update: vi.fn().mockResolvedValue(file) },
      projectDocumentVersion: {
        findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "doc-version-1" })
      },
      projectArtifact: {
        create: vi.fn().mockResolvedValue({ id: "doc-1" }),
        findFirstOrThrow: vi.fn().mockResolvedValue(artifact)
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    await expect(service.createProjectDocument("prj-1", {
      name: "Requirements", artifactType: "requirements", fileObjectId: "file-1", note: "Initial"
    }, principal)).resolves.toMatchObject({
      id: "doc-1", versions: [{ version: 1, fileObjectId: "file-1", note: "Initial" }],
      latestVersion: { version: 1, fileObjectId: "file-1" }
    });
    expect(prisma.projectDocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactId: "doc-1", fileObjectId: "file-1", version: 1 })
    }));
  });

  it("appends immutable document version 2 and advances the artifact pointer", async () => {
    const createdAt = new Date("2026-07-15T03:00:00.000Z");
    const file = {
      id: "file-2", accountId: "acc-1", projectId: "prj-1", fileName: "requirements-v2.pdf",
      contentType: "application/pdf", byteSize: 84, checksumSha256: "def456", storageProvider: "local",
      storageKey: "twk-1/acc-1/file-2", ownerType: "general", customerVisible: false,
      internalOnly: true, allowedRoles: [], scanStatus: "clean", status: "active", createdAt
    };
    const artifact = {
      id: "doc-1", accountId: "acc-1", projectId: "prj-1", code: "PRJ-DOC-1", name: "Requirements",
      artifactType: "requirements", storageKey: file.storageKey, customerVisible: false, internalOnly: true,
      allowedRoles: [], signedUrlExpiresSeconds: 300, createdAt, updatedAt: createdAt,
      account: { name: "Acme" }, project: { name: "CRM" },
      versions: [{
        id: "doc-version-2", artifactId: "doc-1", fileObjectId: "file-2", version: 2, note: "Approved copy",
        createdByUserId: "usr-1", createdAt, fileObject: file, createdBy: { displayName: "Test User" }
      }]
    };
    const prisma: Record<string, any> = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ" }) },
      fileObject: { findFirst: vi.fn().mockResolvedValue(file), update: vi.fn().mockResolvedValue(file) },
      projectDocumentVersion: {
        findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "doc-version-2" })
      },
      projectArtifact: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-1", customerVisible: false, internalOnly: true, allowedRoles: [], versions: [{ version: 1 }]
        }),
        update: vi.fn().mockResolvedValue({ id: "doc-1" }),
        findFirstOrThrow: vi.fn().mockResolvedValue(artifact)
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createProjectDocumentVersion("prj-1", "doc-1", {
      fileObjectId: "file-2", expectedVersion: 1, note: "Approved copy"
    }, principal)).resolves.toMatchObject({
      id: "doc-1", latestVersion: { version: 2, fileObjectId: "file-2", note: "Approved copy" }
    });
    expect(prisma.projectDocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactId: "doc-1", fileObjectId: "file-2", version: 2 })
    }));
    expect(prisma.projectArtifact.update).toHaveBeenCalledWith({
      where: { id: "doc-1" }, data: { storageKey: file.storageKey }
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("upgrades a legacy artifact without versions by accepting expectedVersion zero", async () => {
    const createdAt = new Date("2026-07-15T04:00:00.000Z");
    const file = {
      id: "file-first", accountId: "acc-1", projectId: "prj-1", fileName: "legacy-first.pdf",
      contentType: "application/pdf", byteSize: 21, checksumSha256: "legacy123", storageProvider: "local",
      storageKey: "twk-1/acc-1/file-first", customerVisible: false, internalOnly: true, allowedRoles: [],
      scanStatus: "clean", status: "active", createdAt
    };
    const artifact = {
      id: "doc-legacy", accountId: "acc-1", projectId: "prj-1", code: "LEGACY", name: "Legacy document",
      artifactType: "project_document", storageKey: file.storageKey, customerVisible: false, internalOnly: true,
      allowedRoles: [], signedUrlExpiresSeconds: 300, createdAt, updatedAt: createdAt,
      account: { name: "Acme" }, project: { name: "CRM" },
      versions: [{
        id: "doc-version-first", artifactId: "doc-legacy", fileObjectId: file.id, version: 1,
        createdByUserId: "usr-1", createdAt, fileObject: file, createdBy: { displayName: "Test User" }
      }]
    };
    const prisma: Record<string, any> = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ" }) },
      fileObject: { findFirst: vi.fn().mockResolvedValue(file), update: vi.fn().mockResolvedValue(file) },
      projectDocumentVersion: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      projectArtifact: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-legacy", customerVisible: false, internalOnly: true, allowedRoles: [], versions: []
        }),
        update: vi.fn(), findFirstOrThrow: vi.fn().mockResolvedValue(artifact)
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createProjectDocumentVersion("prj-1", "doc-legacy", {
      fileObjectId: file.id, expectedVersion: 0
    }, principal)).resolves.toMatchObject({ latestVersion: { version: 1, fileObjectId: file.id } });
    expect(prisma.projectDocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactId: "doc-legacy", fileObjectId: file.id, version: 1 })
    }));
  });

  it("translates a concurrent document-version write into an actionable conflict", async () => {
    const prisma: Record<string, any> = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ" }) },
      $transaction: vi.fn().mockRejectedValue({ code: "P2002" })
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);

    await expect(service.createProjectDocumentVersion("prj-1", "doc-1", {
      fileObjectId: "file-2", expectedVersion: 1
    }, principal)).rejects.toThrow("Document version changed; reload the document and try again");
  });

  it("rejects a document file outside the project workspace/account chain", async () => {
    const prisma: Record<string, any> = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ" }) },
      fileObject: { findFirst: vi.fn().mockResolvedValue(null) },
      projectDocumentVersion: { findUnique: vi.fn() },
      projectArtifact: { create: vi.fn() },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new ProjectsService(withMutationDependencies(prisma) as any);
    await expect(service.createProjectDocument("prj-1", {
      name: "Foreign file", fileObjectId: "file-other-workspace"
    }, principal)).rejects.toThrow(NotFoundException);
    expect(prisma.projectArtifact.create).not.toHaveBeenCalled();
  });
});
