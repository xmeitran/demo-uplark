import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tenantKey = process.env.DEMO_TENANT_KEY ?? "prod";
const workspaceKey = process.env.DEMO_WORKSPACE_KEY ?? "default";
const workspaceId = process.env.DEMO_WORKSPACE_ID ?? "twk-foundation";
const prefix = "render-pnl-demo";

async function main() {
  const workspace = await prisma.tenantWorkspace.findFirst({
    where: { id: workspaceId, tenantKey, workspaceKey, status: "active" }
  });
  if (!workspace) {
    throw new Error(`P&L demo seed workspace not found: ${tenantKey}/${workspaceKey}/${workspaceId}`);
  }

  const operator = await prisma.user.findFirst({
    where: {
      status: "ACTIVE",
      subjectType: "INTERNAL_USER",
      roleBindings: {
        some: {
          tenantKey,
          workspaceId: workspace.id,
          endsAt: null,
          role: { code: { in: ["FOUNDER_GM", "WORKSPACE_ADMIN", "COST_VIEW"] } }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  if (!operator) {
    throw new Error(`No active P&L-capable operator found in workspace ${workspace.id}`);
  }

  const account = await prisma.account.upsert({
    where: { workspaceId_code: { workspaceId: workspace.id, code: `${prefix}-account` } },
    update: { name: "Render P&L Demo Client", stage: "implementation", annualValue: "180000000" },
    create: {
      id: `${prefix}-account`,
      workspaceId: workspace.id,
      code: `${prefix}-account`,
      name: "Render P&L Demo Client",
      stage: "implementation",
      annualValue: "180000000",
      commercialNote: "Deterministic production demo data"
    }
  });

  const project = await prisma.project.upsert({
    where: { workspaceId_code: { workspaceId: workspace.id, code: `${prefix}-project` } },
    update: {
      accountId: account.id,
      name: "Render P&L Demo Project",
      status: "active",
      marginPercent: "35"
    },
    create: {
      id: `${prefix}-project`,
      workspaceId: workspace.id,
      accountId: account.id,
      code: `${prefix}-project`,
      name: "Render P&L Demo Project",
      status: "active",
      marginPercent: "35"
    }
  });

  const task = await prisma.projectTask.upsert({
    where: { id: `${prefix}-task` },
    update: {
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      title: "Render P&L Demo Task",
      status: "in_progress",
      assigneeUserId: operator.id,
      ownerUserId: operator.id,
      createdByUserId: operator.id,
      estimateMinutes: 960
    },
    create: {
      id: `${prefix}-task`,
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      title: "Render P&L Demo Task",
      description: "Deterministic data used to verify production P&L rendering.",
      taskType: "implementation",
      status: "in_progress",
      priority: "medium",
      assigneeUserId: operator.id,
      ownerUserId: operator.id,
      createdByUserId: operator.id,
      estimateMinutes: 960
    }
  });

  await prisma.projectMember.upsert({
    where: {
      workspaceId_projectId_userId_relation: {
        workspaceId: workspace.id,
        projectId: project.id,
        userId: operator.id,
        relation: "pnl_demo_owner"
      }
    },
    update: {},
    create: { workspaceId: workspace.id, projectId: project.id, userId: operator.id, relation: "pnl_demo_owner" }
  });

  await prisma.taskTimeEntry.upsert({
    where: { id: `${prefix}-time-entry` },
    update: {
      workspaceId: workspace.id,
      taskId: task.id,
      accountId: account.id,
      projectId: project.id,
      userId: operator.id,
      workDate: new Date("2026-10-01T00:00:00.000Z"),
      minutes: 240,
      regularMinutes: 240,
      billable: true,
      workType: "delivery",
      approvalStatus: "approved",
      pnlStatus: "included",
      note: "Render P&L demo labor"
    },
    create: {
      id: `${prefix}-time-entry`,
      workspaceId: workspace.id,
      taskId: task.id,
      accountId: account.id,
      projectId: project.id,
      userId: operator.id,
      workDate: new Date("2026-10-01T00:00:00.000Z"),
      minutes: 240,
      regularMinutes: 240,
      billable: true,
      workType: "delivery",
      approvalStatus: "approved",
      pnlStatus: "included",
      note: "Render P&L demo labor"
    }
  });

  await prisma.costRateProfile.upsert({
    where: { id: `${prefix}-cost-rate` },
    update: { userId: operator.id, hourlyCostRate: "500000", active: true },
    create: {
      id: `${prefix}-cost-rate`,
      userId: operator.id,
      role: "Render P&L demo operator",
      currency: "VND",
      hourlyCostRate: "500000",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z")
    }
  });

  await prisma.projectBudget.upsert({
    where: { code: `${prefix}-budget` },
    update: {
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      currency: "VND",
      revenueBasis: "contracted",
      plannedRevenueAmount: "180000000",
      plannedCostAmount: "90000000",
      baselineMinutes: 960,
      status: "ACTIVE",
      createdByUserId: operator.id
    },
    create: {
      id: `${prefix}-budget`,
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      code: `${prefix}-budget`,
      currency: "VND",
      revenueBasis: "contracted",
      plannedRevenueAmount: "180000000",
      plannedCostAmount: "90000000",
      baselineMinutes: 960,
      status: "ACTIVE",
      createdByUserId: operator.id
    }
  });

  await prisma.projectCost.upsert({
    where: { id: `${prefix}-labor-cost` },
    update: {
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      costType: "LABOR",
      label: "Render P&L demo labor",
      currency: "VND",
      amount: "2000000",
      occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      billable: true,
      createdByUserId: operator.id
    },
    create: {
      id: `${prefix}-labor-cost`,
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      taskTimeEntryId: `${prefix}-time-entry`,
      costType: "LABOR",
      label: "Render P&L demo labor",
      currency: "VND",
      amount: "2000000",
      occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      billable: true,
      createdByUserId: operator.id
    }
  });

  await prisma.projectCost.upsert({
    where: { id: `${prefix}-external-cost` },
    update: {
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      costType: "EXTERNAL",
      label: "Render P&L demo external cost",
      currency: "VND",
      amount: "5000000",
      occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      billable: false,
      createdByUserId: operator.id
    },
    create: {
      id: `${prefix}-external-cost`,
      workspaceId: workspace.id,
      accountId: account.id,
      projectId: project.id,
      costType: "EXTERNAL",
      label: "Render P&L demo external cost",
      currency: "VND",
      amount: "5000000",
      occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      billable: false,
      createdByUserId: operator.id
    }
  });

  console.log(`Render P&L demo seed applied: workspace=${workspace.id} project=${project.id} operator=${operator.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
