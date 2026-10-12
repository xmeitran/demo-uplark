import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_ROLE_CODES, type PrincipalContext } from "@b2b-crm/contracts";
import { BrdGovernanceService } from "./brd-governance.service";

const manager: PrincipalContext = {
  subjectType: "internal_user",
  subjectId: "usr-manager",
  displayName: "PM",
  email: "pm@example.com",
  tenantKey: "prod",
  workspaceId: "workspace-1",
  workspaceKey: "default",
  roleCodes: ["PM"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "test",
  grantVersion: "test"
};

const member = { ...manager, subjectId: "usr-member", roleCodes: ["WORKSPACE_USER"] };

function createPrismaMock(overrides: Record<string, any> = {}) {
  let pnlPeriodStatus = "OPEN";
  const task = {
    id: "task-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    planApprovalStatus: "DRAFT",
    plannedStartAt: null,
    dueAt: null,
    estimateMinutes: 60,
    taskTypeLayer1: null,
    taskTypeLayer2: null
  };
  const prisma: Record<string, any> = {
    projectTask: {
      findFirst: vi.fn().mockResolvedValue(task),
      findUnique: vi.fn().mockResolvedValue(task),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...task, ...data }))
    },
    taskPlanHistory: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "history-1" })
    },
    taskPlanningBlock: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    taskTimelineChangeRequest: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "change-1", status: "PENDING", ...data })),
      findFirst: vi.fn().mockResolvedValue({
        id: "change-1", workspaceId: "workspace-1", projectId: "project-1", taskId: "task-1", status: "PENDING",
        proposedStartAt: new Date("2026-09-10T00:00:00.000Z"), proposedEndAt: new Date("2026-09-12T00:00:00.000Z"), proposedEstimateMinutes: 120,
        requestedByUserId: "usr-member", reason: "Customer moved the workshop"
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "change-1", ...data }))
    },
    overtimePlan: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "ot-1", ...data })),
      findFirst: vi.fn().mockResolvedValue({ id: "ot-1", workspaceId: "workspace-1", approvalStatus: "PENDING" }),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "ot-1", ...data }))
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: "usr-member" })
    },
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: "project-1" })
    },
    pnlConfiguration: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(async ({ create }: any) => ({ id: "config-1", ...create }))
    },
    pnlPeriod: {
      findFirst: vi.fn().mockImplementation(async (args: any = {}) => args.where?.status === "LOCKED" && pnlPeriodStatus !== "LOCKED" ? null : ({ id: "period-1", workspaceId: "workspace-1", projectId: null, periodKey: "2026-09", status: pnlPeriodStatus, periodStart: new Date("2026-09-01T00:00:00.000Z"), periodEnd: new Date("2026-09-30T00:00:00.000Z"), revenueAmount: 0, allocations: [] })),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "period-1", status: "OPEN", ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => { pnlPeriodStatus = data.status ?? pnlPeriodStatus; return { id: "period-1", status: pnlPeriodStatus, ...data }; }),
      delete: vi.fn().mockResolvedValue({ id: "period-1" })
    },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }
  };
  prisma.$transaction = vi.fn(async (operation: any) => typeof operation === "function" ? operation(prisma) : Promise.all(operation));
  for (const [delegate, value] of Object.entries(overrides)) {
    prisma[delegate] = { ...prisma[delegate], ...value };
  }
  return prisma;
}

describe("BrdGovernanceService — EV-029/EV-061/EV-006/EV-007", () => {
  it("submits a typed task plan and records a versioned history row", async () => {
    const prisma = createPrismaMock();
    const service = new BrdGovernanceService(prisma as any);

    const result = await service.submitTaskPlan("task-1", {
      plannedStartAt: "2026-09-01T00:00:00.000Z",
      dueAt: "2026-09-03T00:00:00.000Z",
      estimateMinutes: 120,
      taskTypeLayer1: "DELIVERY",
      taskTypeLayer2: "CUSTOMER_PROJECT"
    }, member);

    expect(result.meta).toEqual({ approvalStatus: "SUBMITTED", timelineLocked: false });
    expect(prisma.projectTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1" },
      data: expect.objectContaining({ planApprovalStatus: "SUBMITTED", estimateMinutes: 120 })
    }));
    // D-02/D-04: a submitted plan never reclassifies the task, whatever the client sends.
    const submitted = prisma.projectTask.update.mock.calls[0][0].data;
    expect(submitted).not.toHaveProperty("taskTypeLayer1");
    expect(submitted).not.toHaveProperty("taskTypeLayer2");
    expect(prisma.taskPlanHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 1, action: "SUBMITTED", taskId: "task-1" }) }));
  });

  it("rejects reversed planning dates before persistence", async () => {
    const prisma = createPrismaMock();
    const service = new BrdGovernanceService(prisma as any);
    const base = { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" } as any;

    await expect(service.submitTaskPlan("task-1", { ...base, plannedStartAt: "2026-09-03", dueAt: "2026-09-01" }, member)).rejects.toThrow("dueAt must be on or after plannedStartAt");
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
  });

  it("approves a submitted plan, locks its planning blocks, and snapshots the baseline", async () => {
    const prisma = createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({
      id: "task-1", workspaceId: "workspace-1", projectId: "project-1", planApprovalStatus: "SUBMITTED",
      plannedStartAt: new Date("2026-09-01T00:00:00.000Z"), dueAt: new Date("2026-09-03T00:00:00.000Z"), estimateMinutes: 120,
      taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT"
    }) } });
    const service = new BrdGovernanceService(prisma as any);

    const result = await service.approveTaskPlan("task-1", manager);

    expect(result.meta).toEqual({ approvalStatus: "APPROVED", timelineLocked: true });
    expect(prisma.taskPlanningBlock.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "APPROVED" }) }));
    expect(prisma.taskPlanHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "APPROVED", approvedByUserId: manager.subjectId }) }));
  });

  it("requires a manager to approve a plan and prevents edits after approval", async () => {
    const prisma = createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({ id: "task-1", workspaceId: "workspace-1", planApprovalStatus: "APPROVED" }) } });
    const service = new BrdGovernanceService(prisma as any);

    await expect(service.approveTaskPlan("task-1", member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submitTaskPlan("task-1", { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" }, manager)).rejects.toBeInstanceOf(ConflictException);
  });

  it("creates and approves a timeline change request with an immutable audit trail", async () => {
    const prisma = createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({ id: "task-1", workspaceId: "workspace-1", projectId: "project-1", planApprovalStatus: "APPROVED", estimateMinutes: 60 }) } });
    const service = new BrdGovernanceService(prisma as any);

    const pending = await service.requestTimelineChange("task-1", { proposedStartAt: "2026-09-10", proposedEndAt: "2026-09-12", proposedEstimateMinutes: 120, reason: "Customer moved the workshop" }, member);
    expect(pending.meta).toEqual({ status: "PENDING", timelineLocked: true });

    const approved = await service.reviewTimelineChange("change-1", { decision: "APPROVED", reviewNote: "Approved by PM" }, manager);
    expect(approved.meta).toEqual({ timelineLocked: true });
    expect(prisma.taskTimelineChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", reviewedByUserId: manager.subjectId }) }));
    expect(prisma.taskPlanHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "TIMELINE_CHANGE_APPROVED" }) }));
  });

  it("Kế toán (FINANCE_ADMIN, a User-type role) approves no plan; every Admin role of the catalogue does", async () => {
    const submitted = { id: "task-1", workspaceId: "workspace-1", projectId: "project-1", planApprovalStatus: "SUBMITTED", plannedStartAt: new Date("2026-09-01T00:00:00.000Z"), dueAt: new Date("2026-09-03T00:00:00.000Z"), estimateMinutes: 120 };
    const service = () => new BrdGovernanceService(createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({ ...submitted }) } }) as any);

    await expect(service().approveTaskPlan("task-1", { ...member, roleCodes: ["FINANCE_ADMIN"] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service().reviewTimelineChange("change-1", { decision: "APPROVED" }, { ...member, roleCodes: ["FINANCE_ADMIN"] })).rejects.toBeInstanceOf(ForbiddenException);
    expect([...ADMIN_ROLE_CODES].sort()).toEqual(["BD_LEAD", "DX_DIRECTOR", "FOUNDER_GM", "PM", "WORKSPACE_ADMIN"]);
    for (const role of ADMIN_ROLE_CODES) await expect(service().approveTaskPlan("task-1", { ...member, roleCodes: [role] })).resolves.toMatchObject({ meta: { approvalStatus: "APPROVED" } });
  });
});
