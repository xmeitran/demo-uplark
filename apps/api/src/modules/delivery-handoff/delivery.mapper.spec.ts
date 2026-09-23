import { describe, expect, it } from "vitest";
import { mapProjectStageSummary, mapProjectSummary, mapTaskSummary } from "./delivery.mapper";

describe("delivery.mapper", () => {
  it("maps project aggregates from real stages and tasks", () => {
    const project = mapProjectSummary({
      id: "proj-1",
      accountId: "acc-1",
      account: { name: "Acme Co" },
      opportunityId: "opp-1",
      opportunity: { title: "ERP rollout", stage: "delivery" },
      code: "ACM-ERP",
      name: "ERP rollout",
      status: "in_progress",
      projectType: "implementation",
      scopeSummary: "Project-level rollout scope",
      marginPercent: "18.25",
      members: [
        {
          userId: "usr-member",
          relation: "member",
          user: {
            displayName: "Member One",
            email: "member@example.com",
            avatarUrl: "https://example.com/avatar.png"
          }
        },
        {
          userId: "usr-member",
          relation: "delivery_lead",
          user: {
            displayName: "Member One",
            email: "member@example.com",
            avatarUrl: null
          }
        }
      ],
      budgets: [{ plannedRevenueAmount: "50000", currency: "USD" }],
      costs: [{ amount: "1250.50" }, { amount: "749.50" }],
      stages: [
        {
          status: "done",
          progressPercent: 100,
          cumulativePercent: 25,
          ownerUserId: "usr-owner",
          owner: { displayName: "Owner One", avatarUrl: "https://example.com/owner.png" },
          scopeSummary: "Stage-level fallback scope",
          plannedStartAt: new Date("2026-06-01T00:00:00.000Z"),
          plannedEndAt: new Date("2026-06-10T00:00:00.000Z")
        },
        {
          status: "in_progress",
          progressPercent: 60,
          cumulativePercent: 50,
          actualStartAt: new Date("2026-06-11T00:00:00.000Z"),
          plannedEndAt: new Date("2026-06-30T00:00:00.000Z")
        }
      ],
      tasks: [
        { status: "done", assigneeUserId: "usr-member", estimateMinutes: 60, timeEntries: [{ minutes: 60, approvalStatus: "approved" }] },
        { status: "completed", assigneeUserId: "usr-member", estimateMinutes: 120, timeEntries: [{ minutes: 90, approvalStatus: "approved" }, { minutes: 30, approvalStatus: "pending" }] },
        { status: "in_progress", ownerUserId: "usr-member", estimateMinutes: 180, timeEntries: [] }
      ]
    });

    expect(project).toMatchObject({
      id: "proj-1",
      accountName: "Acme Co",
      opportunityTitle: "ERP rollout",
      opportunityStage: "delivery",
      projectType: "implementation",
      scopeSummary: "Project-level rollout scope",
      ownerUserId: "usr-owner",
      ownerDisplayName: "Owner One",
      ownerAvatarUrl: "https://example.com/owner.png",
      memberUserIds: ["usr-member"],
      members: [
        {
          userId: "usr-member",
          displayName: "Member One",
          email: "member@example.com",
          avatarUrl: "https://example.com/avatar.png",
          relation: "member",
          assignedTaskCount: 3,
          doneTaskCount: 1,
          doneTaskPercent: 33
        }
      ],
      budgetAmount: 50000,
      spentAmount: 2000,
      budgetCurrency: "USD",
      progressPercent: 33,
      taskCount: 3,
      completedTaskCount: 1,
      plannedMinutes: 360,
      loggedMinutes: 180,
      approvedMinutes: 150,
      stageCount: 2,
      activeStageCount: 1,
      plannedStartAt: "2026-06-01T00:00:00.000Z",
      plannedEndAt: "2026-06-30T00:00:00.000Z"
    });
  });

  it("reports 100 percent progress when every project task is completed even if stage progress is stale", () => {
    const project = mapProjectSummary({
      id: "proj-all-done",
      accountId: "acc-1",
      account: { name: "HHM" },
      code: "PRJ-042",
      name: "HHM - Quy trình thanh toán",
      status: "in_review",
      members: [],
      budgets: [],
      costs: [],
      stages: [
        {
          status: "in_progress",
          progressPercent: 80,
          cumulativePercent: 80
        }
      ],
      tasks: Array.from({ length: 41 }, () => ({ status: "completed" }))
    });

    expect(project).toMatchObject({
      taskCount: 41,
      completedTaskCount: 41,
      progressPercent: 100
    });
  });

  it("does not count legacy done status as canonical completed project progress", () => {
    const project = mapProjectSummary({
      id: "proj-legacy-done",
      accountId: "acc-1",
      account: { name: "ELMICH" },
      code: "PRJ-083",
      name: "ELMICH - KD-01",
      status: "in_progress",
      members: [],
      budgets: [],
      costs: [],
      stages: [],
      tasks: [
        { status: "completed" },
        { status: "done" },
        ...Array.from({ length: 77 }, () => ({ status: "todo" }))
      ]
    });

    expect(project).toMatchObject({
      taskCount: 79,
      completedTaskCount: 1,
      progressPercent: 1
    });
  });

  it("uses task completion ratio when imported stage progress says complete but tasks are still open", () => {
    const project = mapProjectSummary({
      id: "proj-imported-progress",
      accountId: "acc-1",
      account: { name: "ELMICH" },
      code: "PRJ-083",
      name: "ELMICH - KD-01",
      status: "in_progress",
      members: [],
      budgets: [],
      costs: [],
      stages: [
        {
          status: "completed",
          progressPercent: 100,
          cumulativePercent: 100
        }
      ],
      tasks: [
        { status: "completed" },
        ...Array.from({ length: 78 }, () => ({ status: "todo" }))
      ]
    });

    expect(project).toMatchObject({
      taskCount: 79,
      completedTaskCount: 1,
      progressPercent: 1
    });
  });

  it("maps project stages as milestone summaries", () => {
    const stage = mapProjectStageSummary({
      id: "stage-1",
      accountId: "acc-1",
      account: { name: "Acme Co" },
      projectId: "prj-1",
      project: { name: "CRM rollout" },
      stageKey: "uat",
      phase: "acceptance",
      activity: "UAT & Go-live Readiness",
      sortOrder: 40,
      cumulativePercent: 90,
      activityPercent: 25,
      criteria: "UAT sign-off is approved.",
      status: "in_progress",
      ownerUserId: "usr-1",
      owner: { displayName: "Delivery Lead", avatarUrl: "https://example.com/delivery-lead.png" },
      progressPercent: 60,
      createdAt: new Date("2026-06-30T01:00:00.000Z"),
      updatedAt: new Date("2026-06-30T02:00:00.000Z")
    });

    expect(stage).toMatchObject({
      id: "stage-1",
      stageKey: "uat",
      projectName: "CRM rollout",
      accountName: "Acme Co",
      ownerDisplayName: "Delivery Lead",
      ownerAvatarUrl: "https://example.com/delivery-lead.png",
      progressPercent: 60
    });
  });

  it("maps task operational metrics from history and time entries", () => {
    const task = mapTaskSummary({
      id: "task-1",
      accountId: "acc-1",
      account: { name: "Acme Co" },
      projectId: "prj-1",
      project: { name: "CRM rollout" },
      stageId: "stage-1",
      stage: { stageKey: "uat", activity: "UAT" },
      title: "Prepare UAT scenarios",
      taskType: "implementation",
      status: "done",
      priority: "high",
      ownerUserId: "usr-owner",
      owner: { displayName: "Owner", avatarUrl: "https://example.com/owner-avatar.png" },
      assigneeUserId: "usr-assignee",
      assignee: { displayName: "Assignee", avatarUrl: "https://example.com/assignee-avatar.png" },
      startedAt: new Date("2026-06-28T00:00:00.000Z"),
      completedAt: new Date("2026-06-30T00:00:00.000Z"),
      estimateMinutes: 240,
      customerVisible: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-30T00:00:00.000Z"),
      statusHistory: [
        {
          id: "hist-1",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          fromStatus: "in_progress",
          toStatus: "done",
          changedAt: new Date("2026-06-30T00:00:00.000Z")
        }
      ],
      timeEntries: [
        {
          id: "time-1",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          userId: "usr-assignee",
          user: { displayName: "Assignee" },
          workDate: new Date("2026-06-29T00:00:00.000Z"),
          minutes: 90,
          billable: true,
          workType: "delivery",
          approvalStatus: "approved",
          sourcePlanningBlockId: "plan-1",
          createdAt: new Date("2026-06-29T01:00:00.000Z")
        },
        {
          id: "time-2",
          taskId: "task-1",
          accountId: "acc-1",
          projectId: "prj-1",
          userId: "usr-assignee",
          workDate: new Date("2026-06-30T00:00:00.000Z"),
          minutes: 30,
          billable: true,
          workType: "delivery",
          approvalStatus: "submitted",
          createdAt: new Date("2026-06-30T01:00:00.000Z")
        }
      ],
      planningBlocks: [
        {
          id: "plan-1",
          taskId: "task-1",
          accountId: "acc-1",
          account: { name: "Acme Co" },
          projectId: "prj-1",
          project: { name: "CRM rollout" },
          userId: "usr-assignee",
          user: { displayName: "Assignee" },
          title: "Prepare UAT scenarios",
          notes: "Planned UAT window",
          startAt: new Date("2026-07-01T02:00:00.000Z"),
          endAt: new Date("2026-07-01T04:00:00.000Z"),
          plannedMinutes: 120,
          billable: false,
          workType: "consulting",
          status: "planned",
          source: "manual",
          createdAt: new Date("2026-06-30T02:00:00.000Z"),
          updatedAt: new Date("2026-06-30T02:00:00.000Z")
        }
      ],
      subtasks: [
        {
          id: "subtask-1",
          accountId: "acc-1",
          account: { name: "Acme Co" },
          projectId: "prj-1",
          project: { name: "CRM rollout" },
          stageId: "stage-1",
          stage: { stageKey: "uat", activity: "UAT" },
          parentTaskId: "task-1",
          title: "Review UAT checklist",
          taskType: "checklist",
          status: "todo",
          priority: "medium",
          estimateMinutes: 0,
          customerVisible: false,
          createdAt: new Date("2026-06-29T00:00:00.000Z"),
          updatedAt: new Date("2026-06-29T00:00:00.000Z"),
          statusHistory: [],
          timeEntries: []
        }
      ]
    });

    expect(task).toMatchObject({
      id: "task-1",
      status: "done",
      ownerAvatarUrl: "https://example.com/owner-avatar.png",
      assigneeAvatarUrl: "https://example.com/assignee-avatar.png",
      loggedMinutes: 120,
      approvedMinutes: 90,
      overdue: false,
      cycleTimeDays: 2,
      statusHistory: [{ toStatus: "done" }],
      timeEntries: [{ userDisplayName: "Assignee", sourcePlanningBlockId: "plan-1" }, { approvalStatus: "submitted" }],
      planningBlocks: [{
        id: "plan-1",
        userDisplayName: "Assignee",
        plannedMinutes: 120,
        billable: false,
        workType: "consulting"
      }],
      subtasks: [{ id: "subtask-1", parentTaskId: "task-1", title: "Review UAT checklist", status: "todo" }]
    });
  });
});
