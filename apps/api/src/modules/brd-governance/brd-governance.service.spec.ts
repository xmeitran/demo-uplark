import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
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
// P&L endpoints follow the cost permissions, not the delivery manager roles.
const finance = { ...manager, subjectId: "usr-finance", roleCodes: ["FOUNDER_GM"] };
const snapshotPlan = { period: { key: "2026-09" }, rows: [] };
const resourceControls = {
  preparePeriodSnapshots: vi.fn().mockResolvedValue(snapshotPlan),
  writePeriodSnapshots: vi.fn().mockResolvedValue({ projectCount: 3, missingRateMinutes: 0 })
};

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
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

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
      data: expect.objectContaining({ planApprovalStatus: "SUBMITTED", estimateMinutes: 120, taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" })
    }));
    expect(prisma.taskPlanHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 1, action: "SUBMITTED", taskId: "task-1" }) }));
  });

  it("rejects incomplete task types and reversed planning dates before persistence", async () => {
    const prisma = createPrismaMock();
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);
    const base = { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" } as any;

    await expect(service.submitTaskPlan("task-1", { ...base, taskTypeLayer1: "INVALID" }, member)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submitTaskPlan("task-1", { ...base, plannedStartAt: "2026-09-03", dueAt: "2026-09-01" }, member)).rejects.toThrow("dueAt must be on or after plannedStartAt");
    expect(prisma.projectTask.update).not.toHaveBeenCalled();
  });

  it("approves a submitted plan, locks its planning blocks, and snapshots the baseline", async () => {
    const prisma = createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({
      id: "task-1", workspaceId: "workspace-1", projectId: "project-1", planApprovalStatus: "SUBMITTED",
      plannedStartAt: new Date("2026-09-01T00:00:00.000Z"), dueAt: new Date("2026-09-03T00:00:00.000Z"), estimateMinutes: 120,
      taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT"
    }) } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    const result = await service.approveTaskPlan("task-1", manager);

    expect(result.meta).toEqual({ approvalStatus: "APPROVED", timelineLocked: true });
    expect(prisma.taskPlanningBlock.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "APPROVED" }) }));
    expect(prisma.taskPlanHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "APPROVED", approvedByUserId: manager.subjectId }) }));
  });

  it("requires a manager to approve a plan and prevents edits after approval", async () => {
    const prisma = createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({ id: "task-1", workspaceId: "workspace-1", planApprovalStatus: "APPROVED" }) } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    await expect(service.approveTaskPlan("task-1", member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submitTaskPlan("task-1", { taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT" }, manager)).rejects.toBeInstanceOf(ConflictException);
  });

  it("creates and approves a timeline change request with an immutable audit trail", async () => {
    const prisma = createPrismaMock({ projectTask: { findFirst: vi.fn().mockResolvedValue({ id: "task-1", workspaceId: "workspace-1", projectId: "project-1", planApprovalStatus: "APPROVED", estimateMinutes: 60 }) } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    const pending = await service.requestTimelineChange("task-1", { proposedStartAt: "2026-09-10", proposedEndAt: "2026-09-12", proposedEstimateMinutes: 120, reason: "Customer moved the workshop" }, member);
    expect(pending.meta).toEqual({ status: "PENDING", timelineLocked: true });

    const approved = await service.reviewTimelineChange("change-1", { decision: "APPROVED", reviewNote: "Approved by PM" }, manager);
    expect(approved.meta).toEqual({ timelineLocked: true });
    expect(prisma.taskTimelineChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", reviewedByUserId: manager.subjectId }) }));
    expect(prisma.taskPlanHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "TIMELINE_CHANGE_APPROVED" }) }));
  });

  it("locks and reopens a P&L period only with a recorded reason", async () => {
    const prisma = createPrismaMock();
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    const locked = await service.lockPnlPeriod("period-1", finance);
    expect(locked.meta).toEqual({ locked: true, immutable: true, snapshotProjects: 3, missingRateMinutes: 0 });
    expect(resourceControls.preparePeriodSnapshots).toHaveBeenCalledWith("2026-09", finance);
    // Snapshots, status and audit go through the same transaction client.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(resourceControls.writePeriodSnapshots).toHaveBeenCalledWith(prisma, snapshotPlan, finance);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "pnl.period_locked" }) }));

    await expect(service.reopenPnlPeriod("period-1", { reason: "Corrected approved revenue" }, finance)).resolves.toMatchObject({ meta: { locked: false, auditReason: "Corrected approved revenue" } });
    await expect(service.reopenPnlPeriod("period-1", { reason: " " }, finance)).rejects.toThrow("reason is required");
  });

  it("does not lock, and changes nothing, while the month has formula errors", async () => {
    const prisma = createPrismaMock();
    const failing = { ...resourceControls, preparePeriodSnapshots: vi.fn().mockRejectedValue(new ConflictException({ message: "Chưa chốt được kỳ 2026-09", formulaErrors: ["2026-09 · BHXH: lỗi"] })), writePeriodSnapshots: vi.fn() };
    const service = new BrdGovernanceService(prisma as any, failing as any);

    await expect(service.lockPnlPeriod("period-1", finance)).rejects.toMatchObject({ response: { formulaErrors: ["2026-09 · BHXH: lỗi"] } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(failing.writePeriodSnapshots).not.toHaveBeenCalled();
    expect(prisma.pnlPeriod.update).not.toHaveBeenCalled();
  });

  it("rolls the whole lock back when a write inside it fails", async () => {
    const prisma = createPrismaMock({ pnlPeriod: { update: vi.fn().mockRejectedValue(new Error("db down")) } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    await expect(service.lockPnlPeriod("period-1", finance)).rejects.toThrow("db down");
    // Everything ran inside the one transaction callback, so the database rolls the snapshots back with it.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("lets a COST_APPROVE-only user lock a month that has no saved setup row", async () => {
    const prisma = createPrismaMock({ pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);
    const approver = { ...manager, roleCodes: ["COST_APPROVE"] };

    await expect(service.lockPnlPeriod("2026-11", approver)).resolves.toMatchObject({ meta: { locked: true, snapshotProjects: 3 } });
    expect(prisma.pnlPeriod.findFirst).toHaveBeenCalledWith({ where: { workspaceId: "workspace-1", projectId: null, periodKey: "2026-11" } });
    expect(resourceControls.preparePeriodSnapshots).toHaveBeenCalledWith("2026-11", approver);
    expect(prisma.pnlPeriod.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workspaceId: "workspace-1", periodKey: "2026-11", periodStart: new Date("2026-11-01T00:00:00.000Z"), periodEnd: new Date("2026-11-30T00:00:00.000Z"), status: "LOCKED", lockedByUserId: "usr-manager" }) });
    // An unknown row id is still a 404, and an editor still cannot lock.
    await expect(service.lockPnlPeriod("missing-id", approver)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.lockPnlPeriod("2026-11", { ...manager, roleCodes: ["COST_EDIT"] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("stores entered revenue only when it is an explicit, bounded number for the right month", async () => {
    const prisma = createPrismaMock({ pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);
    const base = { projectId: "project-1", periodKey: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30" };

    for (const revenueAmount of [undefined, null, "500", Number.NaN, Number.POSITIVE_INFINITY, -1, 1e13 + 1]) {
      await expect(service.upsertPnlPeriod({ ...base, revenueAmount } as any, finance), String(revenueAmount)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.upsertPnlPeriod({ ...base, periodStart: "2026-09-02", revenueAmount: 1 }, finance)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upsertPnlPeriod({ ...base, periodEnd: "2026-09-29", revenueAmount: 1 }, finance)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upsertPnlPeriod({ ...base, periodStart: "2026-10-01", periodEnd: "2026-10-31", revenueAmount: 1 }, finance)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pnlPeriod.create).not.toHaveBeenCalled();

    // 0 and the upper bound are valid entries.
    await service.upsertPnlPeriod({ ...base, revenueAmount: 0 }, finance);
    await service.upsertPnlPeriod({ ...base, revenueAmount: 1e13 }, finance);
    expect(prisma.pnlPeriod.create.mock.calls.map(([args]: any) => args.data.revenueAmount.toString())).toEqual(["0", "10000000000000"]);
    // The workspace row carries no revenue: it may be saved without one.
    await expect(service.upsertPnlPeriod({ periodKey: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30" }, finance)).resolves.toBeDefined();
  });

  it("removes an entered monthly revenue under the same permission and lock rules", async () => {
    const row = { id: "period-prj", workspaceId: "workspace-1", projectId: "project-1", periodKey: "2026-09", status: "OPEN", revenueAmount: 500 };
    const open = vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.status === "LOCKED" ? null : where.projectId === "project-1" ? row : null));
    const prisma = createPrismaMock({ pnlPeriod: { findFirst: open } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    await expect(service.removePnlPeriodRevenue({ projectId: "project-1", periodKey: "2026-09" }, finance)).resolves.toEqual({ data: { projectId: "project-1", periodKey: "2026-09" }, meta: { deleted: true } });
    expect(prisma.pnlPeriod.delete).toHaveBeenCalledWith({ where: { id: "period-prj" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "pnl.period_revenue_removed", before: expect.objectContaining({ revenueAmount: "500" }) }) }));

    await expect(service.removePnlPeriodRevenue({ projectId: "project-1", periodKey: "2026-09" }, { ...manager, roleCodes: ["COST_VIEW"] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removePnlPeriodRevenue({ periodKey: "2026-09" }, finance)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.removePnlPeriodRevenue({ projectId: "project-1" }, finance)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.removePnlPeriodRevenue({ projectId: "other", periodKey: "2026-09" }, finance)).rejects.toBeInstanceOf(NotFoundException);

    // Workspace month locked: the revenue stays.
    const lockedPrisma = createPrismaMock({ pnlPeriod: { findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.status === "LOCKED" ? { id: "period-ws" } : row)) } });
    await expect(new BrdGovernanceService(lockedPrisma as any, resourceControls as any).removePnlPeriodRevenue({ projectId: "project-1", periodKey: "2026-09" }, finance)).rejects.toBeInstanceOf(ConflictException);
    expect(lockedPrisma.pnlPeriod.delete).not.toHaveBeenCalled();
  });

  it("uses cost permissions for P&L actions: view, edit and approve are separate", async () => {
    const prisma = createPrismaMock();
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);
    const withRole = (role: string) => ({ ...manager, roleCodes: [role] });

    // A delivery manager or workspace admin without a cost permission can no longer touch P&L.
    await expect(service.getPnlConfiguration("2026-09", manager)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.upsertPnlPeriod({ periodKey: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30", projectId: "project-1", revenueAmount: 1 }, withRole("WORKSPACE_ADMIN"))).rejects.toBeInstanceOf(ForbiddenException);
    // Viewers read, editors write, only approvers lock.
    await expect(service.getPnlConfiguration("2026-09", withRole("COST_VIEW"))).resolves.toBeDefined();
    await expect(service.upsertPnlConfiguration({ periodKey: "2026-09", items: [], parameters: [], pool: {}, templates: [] }, withRole("COST_VIEW"))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.lockPnlPeriod("period-1", withRole("COST_EDIT"))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.lockPnlPeriod("period-1", withRole("COST_APPROVE"))).resolves.toMatchObject({ meta: { locked: true } });
  });

  it("refuses manual revenue and configuration changes in a locked month", async () => {
    const findFirst = vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.status === "LOCKED" ? { id: "period-ws" } : null));
    const prisma = createPrismaMock({ pnlPeriod: { findFirst, create: vi.fn(), update: vi.fn() }, pnlConfiguration: { upsert: vi.fn() } });
    const service = new BrdGovernanceService(prisma as any, resourceControls as any);

    await expect(service.upsertPnlPeriod({ periodKey: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30", projectId: "project-1", revenueAmount: 500 }, finance)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.upsertPnlConfiguration({ periodKey: "2026-09", items: [], parameters: [], pool: {}, templates: [] }, finance)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.pnlPeriod.create).not.toHaveBeenCalled();
    expect(prisma.pnlConfiguration.upsert).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({ where: { workspaceId: "workspace-1", projectId: null, periodKey: "2026-09", status: "LOCKED" }, select: { id: true } });
  });
});
