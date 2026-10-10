import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ResourceControlsService } from "./resource-controls.service";

const principal = {
  subjectId: "usr-founder",
  subjectType: "internal_user",
  displayName: "Founder",
  tenantKey: "prod",
  workspaceId: "twk-foundation",
  workspaceKey: "default",
  roleCodes: ["FOUNDER_GM"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "roles",
  grantVersion: "grants"
} as const;

describe("ResourceControlsService", () => {
  it("summarizes capacity from active users and overlapping allocations", async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "usr-1",
            displayName: "Nguyen Hung Viet Kha",
            email: "kha@example.com",
            avatarUrl: "https://cdn/avatar.png",
            departmentCode: "DEL",
            resourceProfile: {
              displayRole: "Implementation consultant",
              skills: ["lark_base"],
              defaultWeeklyCapacityMinutes: 2400,
              billableTargetPercent: 75
            },
            capacityPeriods: [],
            resourceAllocations: [
              {
                id: "alloc-1",
                accountId: "acc-1",
                account: { name: "AMOBEAR" },
                projectId: "prj-1",
                project: { name: "AMOBEAR - HRM" },
                opportunityId: null,
                userId: "usr-1",
                user: { displayName: "Nguyen Hung Viet Kha" },
                role: "Implementation consultant",
                skill: "lark_base",
                status: "CONFIRMED",
                allocationPercent: 50,
                plannedMinutes: 600,
                startAt: new Date("2026-07-01T00:00:00.000Z"),
                endAt: new Date("2026-07-08T00:00:00.000Z"),
                overbookApproved: false,
                approvedByUserId: null,
                note: null,
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
                updatedAt: new Date("2026-07-01T00:00:00.000Z")
              }
            ]
          }
        ])
      }
    } as any;
    const service = new ResourceControlsService(prisma);

    const response = await service.capacitySummary({ periodStart: "2026-07-01", periodEnd: "2026-07-08" }, principal as any);

    expect(response.data[0]).toMatchObject({
      userId: "usr-1",
      availableMinutes: 2400,
      allocatedMinutes: 600,
      remainingMinutes: 1800,
      utilizationPercent: 25,
      allocations: [
        expect.objectContaining({
          id: "alloc-1",
          status: "confirmed",
          projectName: "AMOBEAR - HRM"
        })
      ]
    });
  });

  it("computes project P&L from approved hours × cost rate, cost lines and one revenue basis", async () => {
    const prisma = {
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "prj-1",
            accountId: "acc-1",
            name: "AMOBEAR - HRM",
            account: { name: "AMOBEAR" },
            budgets: [{ currency: "VND", plannedRevenueAmount: 10_000_000, plannedCostAmount: 3_000_000 }],
            costs: [
              // Legacy LABOR rows must not be added on top of the computed labor cost.
              { id: "c0", projectId: "prj-1", costType: "LABOR", label: "seed", amount: 999_999, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") },
              { id: "c1", projectId: "prj-1", costType: "SOFTWARE", label: "Lark license", amount: 800_000, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") },
              { id: "c2", projectId: "prj-1", costType: "WRITE_OFF", label: "Giảm trừ", amount: 200_000, currency: "VND", occurredAt: new Date("2026-10-03T03:00:00.000Z") }
            ],
            paymentMilestones: [
              { paymentStatus: "PAID", amount: 4_000_000 },
              { paymentStatus: "UNPAID", amount: 6_000_000 }
            ],
            paymentSchedules: [],
            plSnapshots: [],
            pnlPeriods: [],
            tasks: [
              {
                timeEntries: [
                  { userId: "u1", user: { displayName: "Kha" }, approvalStatus: "approved", minutes: 600, workDate: new Date("2026-10-02T02:00:00.000Z") },
                  { userId: "u1", user: { displayName: "Kha" }, approvalStatus: "rejected", minutes: 60, workDate: new Date("2026-10-02T02:00:00.000Z") },
                  { userId: "u2", user: { displayName: "Mai" }, approvalStatus: "approved", minutes: 120, workDate: new Date("2026-10-02T02:00:00.000Z") }
                ]
              }
            ]
          }
        ])
      },
      costRateProfile: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "u1", workspaceId: "twk-foundation", hourlyCostRate: 200_000, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }
        ])
      },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;
    const service = new ResourceControlsService(prisma);

    const response = await service.projectPlSummary({}, principal as any);

    expect(response.data[0]).toMatchObject({
      accountName: "AMOBEAR",
      projectName: "AMOBEAR - HRM",
      plannedRevenueAmount: 10_000_000,
      paidRevenueAmount: 4_000_000,
      customRevenueAmount: undefined,
      revenueAmount: 10_000_000,
      revenueBasis: "planned",
      plannedCostAmount: 3_000_000,
      approvedLaborMinutes: 720,
      missingRateMinutes: 120,
      actualLaborCostAmount: 2_000_000, // 10h × 200k, uncapped; u2 has no rate
      directCostAmount: 800_000,
      writeOffAmount: 200_000,
      totalCostAmount: 3_000_000,
      grossMarginAmount: 7_000_000,
      grossMarginPercent: 70
    });
    expect(response.data[0].laborByPerson).toEqual([
      { userId: "u1", displayName: "Kha", approvedMinutes: 600, laborCostAmount: 2_000_000, missingRateMinutes: 0, hourlyCostRate: 200_000 },
      { userId: "u2", displayName: "Mai", approvedMinutes: 120, laborCostAmount: 0, missingRateMinutes: 120 }
    ]);
    expect(response.data[0].costItems.map((item) => [item.id, item.costType, item.amount, item.occurredOn])).toEqual([
      ["c1", "SOFTWARE", 800_000, "2026-10-02"],
      ["c2", "WRITE_OFF", 200_000, "2026-10-03"]
    ]);
  });

  it("uses manual revenue of the months in range as the basis, including an explicit zero", async () => {
    const project = (pnlPeriods: unknown[]) => ({
      id: "prj-1", accountId: "acc-1", name: "P", account: { name: "A" },
      budgets: [{ currency: "VND", plannedRevenueAmount: 1000, plannedCostAmount: 0 }],
      costs: [{ id: "c1", projectId: "prj-1", costType: "OTHER", label: "x", amount: 300, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") }],
      paymentMilestones: [{ paymentStatus: "PAID", amount: 400 }], paymentSchedules: [], plSnapshots: [], pnlPeriods, tasks: []
    });
    const make = (pnlPeriods: unknown[]) => new ResourceControlsService({
      project: { findMany: vi.fn().mockResolvedValue([project(pnlPeriods)]) },
      costRateProfile: { findMany: vi.fn().mockResolvedValue([]) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) }
    } as any);

    const withCustom = await make([{ revenueAmount: 500 }, { revenueAmount: 250 }]).projectPlSummary({ startDate: "2026-09-01", endDate: "2026-10-31" }, principal as any);
    expect(withCustom.data[0]).toMatchObject({ customRevenueAmount: 750, revenueAmount: 750, revenueBasis: "custom", totalCostAmount: 300, grossMarginAmount: 450, grossMarginPercent: 60 });

    const zero = await make([{ revenueAmount: 0 }]).projectPlSummary({ period: "2026-10" }, principal as any);
    expect(zero.data[0]).toMatchObject({ customRevenueAmount: 0, revenueAmount: 0, revenueBasis: "custom", grossMarginAmount: -300, grossMarginPercent: undefined });
  });

  it("limits P&L entries, costs and manual revenue to the requested month in the reporting timezone", async () => {
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([]) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) }
    } as any;
    const service = new ResourceControlsService(prisma);

    await service.projectPlSummary({ period: "2026-10" }, principal as any);

    const start = new Date("2026-09-30T17:00:00.000Z");
    const end = new Date("2026-10-31T17:00:00.000Z");
    const include = prisma.project.findMany.mock.calls[0][0].include;
    expect(include.tasks.include.timeEntries.where).toEqual({ workDate: { gte: start, lt: end } });
    expect(include.costs).toEqual({ where: { occurredAt: { gte: start, lt: end } } });
    expect(include.pnlPeriods).toEqual({ where: { periodKey: { in: ["2026-10"] } } });
    // An open month never reads snapshots: another month's lock must not leak into it.
    expect(include.plSnapshots).toBe(false);
    expect(include.taskPlanningBlocks.where.startAt).toEqual({ gte: start, lt: end });
  });

  it("rejects malformed P&L reporting periods", async () => {
    const prisma = { project: { findMany: vi.fn() } } as any;
    const service = new ResourceControlsService(prisma);

    await expect(service.projectPlSummary({ period: "2026-13" }, principal as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it("accepts an inclusive custom date range for P&L entries", async () => {
    const prisma = { project: { findMany: vi.fn().mockResolvedValue([]) }, pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    const service = new ResourceControlsService(prisma);

    await service.projectPlSummary({ startDate: "2026-10-07", endDate: "2026-11-14" }, principal as any);

    const start = new Date("2026-10-06T17:00:00.000Z");
    const end = new Date("2026-11-14T17:00:00.000Z");
    const include = prisma.project.findMany.mock.calls[0][0].include;
    expect(include.costs).toEqual({ where: { occurredAt: { gte: start, lt: end } } });
    expect(include.paymentMilestones.where.OR).toEqual([{ dueAt: { gte: start, lt: end } }, { paidAt: { gte: start, lt: end } }]);
    expect(include.tasks.include.timeEntries.where).toEqual({ workDate: { gte: start, lt: end } });
    // Neither October nor November is wholly inside 07/10 → 14/11: no monthly revenue is taken.
    expect(include.pnlPeriods).toEqual({ where: { periodKey: { in: [] } } });
  });

  it("rejects an allocation when the user is not an active member of the workspace", async () => {
    const prisma = {
      account: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1" }) },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      project: { findFirst: vi.fn() },
      opportunity: { findFirst: vi.fn() },
      resourceAllocation: { create: vi.fn() }
    } as any;
    const service = new ResourceControlsService(prisma);

    await expect(service.createAllocation({
      accountId: "acc-1",
      userId: "usr-other-workspace",
      role: "Consultant",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-08T00:00:00.000Z"
    }, principal as any)).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "usr-other-workspace",
        roleBindings: { some: { workspaceId: "twk-foundation", tenantKey: "prod", endsAt: null } }
      })
    }));
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it("enforces the P&L cost-permission boundary for non-finance roles", async () => {
    const prisma = { project: { findMany: vi.fn() } } as any;
    const service = new ResourceControlsService(prisma);

    await expect(service.projectPlSummary({}, { ...principal, roleCodes: ["WORKSPACE_USER"] } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  const baseProject = (overrides: Record<string, unknown> = {}) => ({
    id: "prj-1", accountId: "acc-1", name: "P1", account: { name: "A" },
    budgets: [{ currency: "VND", plannedRevenueAmount: 10_000, plannedCostAmount: 4_000 }],
    costs: [], paymentMilestones: [], paymentSchedules: [], plSnapshots: [], pnlPeriods: [], taskPlanningBlocks: [], tasks: [],
    ...overrides
  });

  it("groups cost lines by BRD expense group and plans a period from its planning blocks", async () => {
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([baseProject({
        costs: [
          { id: "c1", projectId: "prj-1", costType: "OTHER", category: "sell-marketing", label: "Commission", amount: 500, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") },
          { id: "c2", projectId: "prj-1", costType: "OTHER", category: null, label: "Bank fee", amount: 100, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") }
        ],
        taskPlanningBlocks: [{ plannedMinutes: 120 }, { plannedMinutes: 60 }],
        tasks: [{ estimateMinutes: 480, timeEntries: [] }]
      })]) },
      costRateProfile: { findMany: vi.fn() },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;

    const scoped = await new ResourceControlsService(prisma).projectPlSummary({ startDate: "2026-10-05", endDate: "2026-10-11" }, principal as any);
    expect(scoped.data[0]).toMatchObject({
      plannedMinutes: 180, plannedMinutesBasis: "planning_blocks", plannedCostAmount: 4_000,
      costByCategory: { "welfare-related": 0, "basic-activities": 0, "business-location": 0, "sell-marketing": 500, "functional-operation": 100 },
      directCostAmount: 600, totalCostAmount: 600, sharedCostAmount: 0, locked: false
    });

    const whole = await new ResourceControlsService(prisma).projectPlSummary({}, principal as any);
    expect(whole.data[0]).toMatchObject({ plannedMinutes: 480, plannedMinutesBasis: "task_estimates" });
  });

  it("allocates the month's shared cost pool to projects by approved hours", async () => {
    const entry = (projectId: string, userId: string, minutes: number, approvalStatus = "approved") => ({ projectId, userId, minutes, approvalStatus, workDate: new Date("2026-10-06T03:00:00.000Z") });
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([baseProject(), baseProject({ id: "prj-2", name: "P2" }), baseProject({ id: "prj-3", name: "Idle" })]) },
      costRateProfile: { findMany: vi.fn() },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([{ periodKey: "2026-10", pool: { total: 4_000, criteria: "Theo giờ tính P&L" } }]) },
      taskTimeEntry: { findMany: vi.fn().mockResolvedValue([entry("prj-1", "u1", 180), entry("prj-2", "u2", 60), entry("prj-2", "u2", 600, "rejected")]) }
    } as any;

    const response = await new ResourceControlsService(prisma).projectPlSummary({ period: "2026-10" }, principal as any);

    expect(response.data.map((row) => [row.projectId, row.sharedCostAmount, row.totalCostAmount, row.grossMarginAmount])).toEqual([
      // No revenue was entered for the month, and whole-project planned revenue is not a month figure.
      ["prj-1", 3_000, 3_000, -3_000],
      ["prj-2", 1_000, 1_000, -1_000],
      ["prj-3", 0, 0, 0]
    ]);
    expect(prisma.pnlConfiguration.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "twk-foundation", periodKey: { in: ["2026-10"] } });
  });

  it("acts as a calculator for the parameters and formulas users set up for the month", async () => {
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([
        baseProject({
          pnlPeriods: [{ periodKey: "2026-10", revenueAmount: 80_000_000 }],
          costs: [{ id: "c1", projectId: "prj-1", costType: "OTHER", category: "basic-activities", label: "Điện", amount: 1_000_000, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") }],
          tasks: [{ estimateMinutes: 0, timeEntries: [{ userId: "u1", user: { displayName: "Kha" }, approvalStatus: "approved", minutes: 600, workDate: new Date("2026-10-06T03:00:00.000Z") }] }]
        }),
        baseProject({ id: "prj-idle", name: "Idle" })
      ]) },
      costRateProfile: { findMany: vi.fn().mockResolvedValue([{ userId: "u1", workspaceId: "twk-foundation", hourlyCostRate: 200_000, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }]) },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([{
        periodKey: "2026-10",
        pool: { total: 0 },
        parameters: [
          { code: "ty_le_hoa_hong", value: "5%" },
          { code: "PHI_AI_USD", value: "200" },
          { code: "TY_GIA_USD", value: "26.300 ₫" },
          { code: "CHUA_NHAP", value: "" },
          { code: "GIO_DUYET", value: "1" }
        ],
        items: [
          { code: "HOA_HONG", label: "Hoa hồng bán hàng", category: "sell-marketing", formula: "DOANH_THU_THANG × TY_LE_HOA_HONG", active: true },
          { code: "AI", label: "Công cụ AI", category: "functional-operation", formula: "PHI_AI_USD * TY_GIA_USD", active: true },
          { code: "BHXH", label: "BHXH", category: "welfare-related", formula: "CP_NHAN_SU * 21.5%", active: true },
          { code: "PHAY", label: "Số viết dấu phẩy", category: "welfare-related", formula: "CP_NHAN_SU * 21,5%", active: true },
          { code: "TAT", label: "Đã tắt", category: "welfare-related", formula: "999999", active: false },
          { code: "LOI", label: "Thiếu tham số", category: "basic-activities", formula: "GIO_DUYET * DON_GIA_LA", active: true },
          { code: "DOANHTHU", label: "Mục cũ không phải khoản tính", group: "Doanh thu", formula: "DOANH_THU_GHI_NHAN_KY" }
        ]
      }]) }
    } as any;

    const response = await new ResourceControlsService(prisma).projectPlSummary({ period: "2026-10" }, principal as any);
    const [active, idle] = response.data;

    // labor 10h × 200k = 2,000,000; entered 1,000,000; calculated 4,000,000 + 5,260,000 + 430,000
    expect(active.calculatedItems).toEqual([
      { code: "HOA_HONG", label: "Hoa hồng bán hàng", category: "sell-marketing", amount: 4_000_000 },
      { code: "AI", label: "Công cụ AI", category: "functional-operation", amount: 5_260_000 },
      { code: "BHXH", label: "BHXH", category: "welfare-related", amount: 430_000 }
    ]);
    expect(active).toMatchObject({
      revenueAmount: 80_000_000, actualLaborCostAmount: 2_000_000, directCostAmount: 1_000_000, calculatedCostAmount: 9_690_000,
      totalCostAmount: 12_690_000, grossMarginAmount: 67_310_000, grossMarginPercent: 84.14,
      costByCategory: { "welfare-related": 430_000, "basic-activities": 1_000_000, "business-location": 0, "sell-marketing": 4_000_000, "functional-operation": 5_260_000 }
    });
    // A project with no activity in the month carries no calculated cost.
    expect(idle).toMatchObject({ calculatedCostAmount: 0, calculatedItems: [], totalCostAmount: 0 });
    // Problems are reported, and the affected item is left out instead of being guessed.
    expect(response.meta.formulaErrors).toEqual([
      "2026-10 · tham số CHUA_NHAP chưa có giá trị số",
      "2026-10 · tham số GIO_DUYET trùng tên biến hệ thống",
      "2026-10 · Số viết dấu phẩy: Số thập phân trong công thức viết bằng dấu chấm: viết 21.5 thay cho 21,5. Dấu phẩy chỉ tách đối số của hàm; không dùng dấu phân cách hàng nghìn",
      '2026-10 · Thiếu tham số: Chưa có tham số hoặc biến "DON_GIA_LA"'
    ]);
    expect(active).toMatchObject({ otherCostAmount: 10_690_000, enteredCostAmount: 1_000_000 });
    expect(active.lockedOtherCostAmount).toBeUndefined();
    expect(response.meta).toMatchObject({ canEdit: true, fullMonthKeys: ["2026-10"] });
    expect(response.meta.partialPeriod).toBeUndefined();
  });

  it("serves a locked month from its snapshot without adding live pool or formula costs on top", async () => {
    const snapshot = { status: "LOCKED", currency: "VND", revenueAmount: 9_000, plannedCostAmount: 1_234, actualLaborCostAmount: 2_000, directCostAmount: 500, writeOffAmount: 100, totalCostAmount: 3_000, grossMarginAmount: 6_000, grossMarginPercent: 66.67, periodStart: new Date("2026-09-30T17:00:00.000Z"), periodEnd: new Date("2026-10-31T16:59:59.999Z"), createdAt: new Date("2026-11-01T00:00:00.000Z"), id: "snap-1", accountId: "acc-1", projectId: "prj-1", budgetAmount: 0 };
    const entry = { userId: "u1", user: { displayName: "Kha" }, approvalStatus: "approved", minutes: 600, workDate: new Date("2026-10-06T03:00:00.000Z") };
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([baseProject({
        plSnapshots: [snapshot],
        pnlPeriods: [{ periodKey: "2026-10", revenueAmount: 9_000 }],
        costs: [{ id: "late", projectId: "prj-1", costType: "OTHER", category: "sell-marketing", label: "Added after lock", amount: 99_999, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") }],
        tasks: [{ estimateMinutes: 0, timeEntries: [entry] }]
      })]) },
      costRateProfile: { findMany: vi.fn().mockResolvedValue([{ userId: "u1", workspaceId: "twk-foundation", hourlyCostRate: 777, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }]) },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
      // The month still has a pool and a formula item — both are already inside the frozen 3,000.
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([{ periodKey: "2026-10", pool: { total: 5_000, criteria: "Chia đều" }, parameters: [{ code: "HONG", value: "" }], items: [{ code: "HH", label: "Hoa hồng", category: "sell-marketing", formula: "DOANH_THU_THANG * 10%", active: true }] }]) },
      taskTimeEntry: { findMany: vi.fn().mockResolvedValue([{ projectId: "prj-1", userId: "u1", minutes: 600, approvalStatus: "approved", workDate: entry.workDate }]) }
    } as any;
    const service = new ResourceControlsService(prisma);

    // The UI sends a whole month as explicit dates; it must still be recognised as the locked month.
    const response = await service.projectPlSummary({ startDate: "2026-10-01", endDate: "2026-10-31" }, principal as any);
    const [row] = response.data;
    expect(response.meta).toMatchObject({ locked: true, canEdit: false, formulaErrors: [] });
    expect(row).toMatchObject({
      locked: true, revenueAmount: 9_000, plannedCostAmount: 1_234, actualLaborCostAmount: 2_000, directCostAmount: 500, writeOffAmount: 100,
      enteredCostAmount: 600, lockedOtherCostAmount: 400, otherCostAmount: 1_000, totalCostAmount: 3_000, grossMarginAmount: 6_000, missingRateMinutes: 0,
      // Nothing live is returned next to the frozen amount.
      sharedCostAmount: 0, calculatedCostAmount: 0, calculatedItems: [],
      costByCategory: { "welfare-related": 0, "basic-activities": 0, "business-location": 0, "sell-marketing": 0, "functional-operation": 0 }
    });
    // The rows a statement shows add up to the frozen total.
    expect(row.actualLaborCostAmount + row.enteredCostAmount + (row.lockedOtherCostAmount ?? 0) + row.sharedCostAmount + row.calculatedCostAmount).toBe(row.totalCostAmount);
    expect(row.latestSnapshot).toMatchObject({ id: "snap-1", status: "locked" });
    expect(prisma.project.findMany.mock.calls[0][0].include.plSnapshots).toEqual({ where: { status: "LOCKED", periodStart: new Date("2026-09-30T17:00:00.000Z") }, orderBy: { createdAt: "desc" }, take: 1 });
  });

  it("never reports another month's lock on an open period", async () => {
    // A stale LOCKED snapshot row (e.g. of a reopened month) is present, but the viewed month is open.
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([baseProject({ plSnapshots: [{ id: "old", status: "LOCKED", totalCostAmount: 1 }] })]) },
      costRateProfile: { findMany: vi.fn() },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;
    const service = new ResourceControlsService(prisma);
    for (const query of [{ period: "2026-10" }, {}, { startDate: "2026-10-05", endDate: "2026-10-11" }]) {
      const response = await service.projectPlSummary(query, principal as any);
      expect(response.data[0].latestSnapshot, JSON.stringify(query)).toBeUndefined();
      expect(response.data[0].locked).toBe(false);
    }
    expect(prisma.project.findMany.mock.calls.every(([args]: any) => args.include.plSnapshots === false)).toBe(true);
  });

  it("takes revenue, pool and formula costs only for months wholly inside the range", async () => {
    const entry = (day: string, minutes: number) => ({ userId: "u1", user: { displayName: "Kha" }, approvalStatus: "approved", minutes, workDate: new Date(`${day}T03:00:00.000Z`) });
    const make = (pnlPeriods: unknown[], configs: unknown[]) => {
      const prisma = {
        project: { findMany: vi.fn().mockResolvedValue([baseProject({
          pnlPeriods,
          costs: [{ id: "c1", projectId: "prj-1", costType: "OTHER", category: "basic-activities", label: "Điện", amount: 300, currency: "VND", occurredAt: new Date("2026-10-08T03:00:00.000Z") }],
          tasks: [{ estimateMinutes: 0, timeEntries: [entry("2026-10-08", 60), entry("2026-11-03", 120)] }]
        })]) },
        costRateProfile: { findMany: vi.fn().mockResolvedValue([{ userId: "u1", workspaceId: "twk-foundation", hourlyCostRate: 1_000, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }]) },
        pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
        pnlConfiguration: { findMany: vi.fn().mockResolvedValue(configs) },
        taskTimeEntry: { findMany: vi.fn().mockResolvedValue([{ projectId: "prj-1", userId: "u1", minutes: 60, approvalStatus: "approved", workDate: new Date("2026-10-08T03:00:00.000Z") }]) }
      } as any;
      return { prisma, service: new ResourceControlsService(prisma) };
    };
    const octoberConfig = { periodKey: "2026-10", pool: { total: 5_000, criteria: "Chia đều" }, parameters: [], items: [{ code: "HH", label: "Hoa hồng", category: "sell-marketing", formula: "DOANH_THU_THANG * 10%", active: true }] };

    // 05/10 → 11/10 covers no whole month: only hours, labor cost and entered lines.
    const week = make([], []);
    const partial = await week.service.projectPlSummary({ startDate: "2026-10-05", endDate: "2026-10-11" }, principal as any);
    expect(partial.meta).toMatchObject({ partialPeriod: true, fullMonthKeys: [], locked: false });
    expect(week.prisma.project.findMany.mock.calls[0][0].include.pnlPeriods).toEqual({ where: { periodKey: { in: [] } } });
    expect(week.prisma.pnlConfiguration.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "twk-foundation", periodKey: { in: [] } });
    expect(partial.data[0]).toMatchObject({ revenueBasis: "none", revenueAmount: 0, sharedCostAmount: 0, calculatedCostAmount: 0, calculatedItems: [], actualLaborCostAmount: 3_000, enteredCostAmount: 300, totalCostAmount: 3_300 });

    // 01/10 → 14/11: October is whole (its revenue, pool and formula count), November is not.
    const mixed = make([{ periodKey: "2026-10", revenueAmount: 10_000 }], [octoberConfig]);
    const response = await mixed.service.projectPlSummary({ startDate: "2026-10-01", endDate: "2026-11-14" }, principal as any);
    expect(response.meta).toMatchObject({ partialPeriod: true, fullMonthKeys: ["2026-10"] });
    expect(mixed.prisma.project.findMany.mock.calls[0][0].include.pnlPeriods).toEqual({ where: { periodKey: { in: ["2026-10"] } } });
    expect(response.data[0]).toMatchObject({ revenueAmount: 10_000, revenueBasis: "custom", sharedCostAmount: 5_000, calculatedCostAmount: 1_000, actualLaborCostAmount: 3_000, totalCostAmount: 9_300 });

    // Whole months are not flagged.
    const whole = await make([], []).service.projectPlSummary({ startDate: "2026-10-01", endDate: "2026-11-30" }, principal as any);
    expect(whole.meta.partialPeriod).toBeUndefined();
    expect(whole.meta.fullMonthKeys).toEqual(["2026-10", "2026-11"]);
  });

  it("freezes a month only when its setup calculates cleanly, and writes through the caller's transaction", async () => {
    const lateCost = { id: "late", projectId: "prj-1", costType: "OTHER", category: null, label: "Added after lock", amount: 99_999, currency: "VND", occurredAt: new Date("2026-10-02T03:00:00.000Z") };
    const make = (configs: unknown[]) => new ResourceControlsService({
      project: { findMany: vi.fn().mockResolvedValue([baseProject({ plSnapshots: [{ status: "LOCKED", totalCostAmount: 3_000 }], costs: [lateCost] })]) },
      costRateProfile: { findMany: vi.fn() },
      pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue(configs) }
    } as any);
    const tx = { projectPlSnapshot: { updateMany: vi.fn(), createMany: vi.fn() } } as any;

    // Locking recomputes live (ignoring any old snapshot), supersedes it and stores the new totals.
    const service = make([]);
    const plan = await service.preparePeriodSnapshots("2026-10", principal as any);
    expect(tx.projectPlSnapshot.createMany).not.toHaveBeenCalled();
    const result = await service.writePeriodSnapshots(tx, plan, principal as any);
    expect(result).toEqual({ projectCount: 1, missingRateMinutes: 0 });
    expect(tx.projectPlSnapshot.updateMany).toHaveBeenCalledWith({ where: { workspaceId: "twk-foundation", periodStart: new Date("2026-09-30T17:00:00.000Z"), status: "LOCKED" }, data: { status: "SUPERSEDED" } });
    expect(tx.projectPlSnapshot.createMany.mock.calls[0][0].data[0]).toMatchObject({ projectId: "prj-1", status: "LOCKED", revenueAmount: 0, plannedCostAmount: 4_000, directCostAmount: 99_999, totalCostAmount: 99_999, grossMarginAmount: -99_999, periodStart: new Date("2026-09-30T17:00:00.000Z") });

    // A parameter without a value or a formula that fails blocks the lock and is returned to the caller.
    const broken = make([{ periodKey: "2026-10", pool: {}, parameters: [{ code: "TY_LE", value: "" }], items: [{ code: "HH", label: "Hoa hồng", category: "sell-marketing", formula: "CP_KHAC * 21,5%", active: true }] }]);
    const failure = await broken.preparePeriodSnapshots("2026-10", principal as any).catch((error) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect(failure.getResponse()).toMatchObject({ message: expect.stringContaining("còn 2 lỗi"), formulaErrors: ["2026-10 · tham số TY_LE chưa có giá trị số", expect.stringContaining("2026-10 · Hoa hồng: Số thập phân")] });
    await expect(service.preparePeriodSnapshots("2026-13", principal as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("prefers a workspace's own cost rate over a legacy rate without workspace", async () => {
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([baseProject({ tasks: [{ estimateMinutes: 0, timeEntries: [{ userId: "u1", user: { displayName: "Kha" }, approvalStatus: "approved", minutes: 60, workDate: new Date("2026-10-02T02:00:00.000Z") }, { userId: "u2", user: { displayName: "Mai" }, approvalStatus: "approved", minutes: 60, workDate: new Date("2026-10-02T02:00:00.000Z") }] }] })]) },
      costRateProfile: { findMany: vi.fn().mockResolvedValue([
        { userId: "u1", workspaceId: null, hourlyCostRate: 999, effectiveFrom: new Date("2026-09-30T17:00:00.000Z"), effectiveTo: null },
        { userId: "u1", workspaceId: "twk-foundation", hourlyCostRate: 100, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null },
        { userId: "u2", workspaceId: null, hourlyCostRate: 50, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }
      ]) },
      pnlConfiguration: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;

    const response = await new ResourceControlsService(prisma).projectPlSummary({}, principal as any);

    expect(prisma.costRateProfile.findMany.mock.calls[0][0].where).toEqual({ userId: { in: ["u1", "u2"] }, active: true, OR: [{ workspaceId: "twk-foundation" }, { workspaceId: null }] });
    expect(response.data[0].laborByPerson.map((person) => [person.userId, person.laborCostAmount])).toEqual([["u1", 100], ["u2", 50]]);
  });

  it("stores a project's planned cost for cost editors only", async () => {
    const prisma = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", code: "PRJ-1" }) },
      projectBudget: { findFirst: vi.fn().mockResolvedValue({ id: "bud-1", plannedCostAmount: 100 }), update: vi.fn().mockResolvedValue({ id: "bud-1" }), create: vi.fn().mockResolvedValue({ id: "bud-2" }) },
      auditEvent: { create: vi.fn() }
    } as any;
    const service = new ResourceControlsService(prisma);

    await service.setPlannedCost("prj-1", { plannedCostAmount: 2_500_000 }, { ...principal, roleCodes: ["COST_EDIT"] } as any);
    expect(prisma.projectBudget.update).toHaveBeenCalledWith({ where: { id: "bud-1" }, data: { plannedCostAmount: 2_500_000 } });

    prisma.projectBudget.findFirst.mockResolvedValue(null);
    await service.setPlannedCost("prj-1", { plannedCostAmount: 0 }, principal as any);
    expect(prisma.projectBudget.create.mock.calls[0][0].data).toMatchObject({ projectId: "prj-1", code: "PRJ-1-BUDGET", plannedRevenueAmount: 0, plannedCostAmount: 0 });

    await expect(service.setPlannedCost("prj-1", { plannedCostAmount: -1 }, principal as any)).rejects.toBeInstanceOf(BadRequestException);

    // Edited from a month's statement: an open month passes, a locked month refuses before anything is written.
    prisma.pnlPeriod = { findFirst: vi.fn().mockResolvedValue(null) };
    await expect(service.setPlannedCost("prj-1", { plannedCostAmount: 5, periodKey: "2026-10" }, principal as any)).resolves.toBeDefined();
    const writes = prisma.projectBudget.create.mock.calls.length + prisma.projectBudget.update.mock.calls.length;
    prisma.pnlPeriod.findFirst.mockResolvedValue({ id: "period-1" });
    await expect(service.setPlannedCost("prj-1", { plannedCostAmount: 9, periodKey: "2026-10" }, principal as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.setPlannedCost("prj-1", { plannedCostAmount: 9, periodKey: "10/2026" }, principal as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.projectBudget.create.mock.calls.length + prisma.projectBudget.update.mock.calls.length).toBe(writes);
    await expect(service.setPlannedCost("prj-1", { plannedCostAmount: 1 }, { ...principal, roleCodes: ["COST_VIEW"] } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("cost input", () => {
    const editor = { ...principal, roleCodes: ["COST_EDIT"] };
    const viewer = { ...principal, roleCodes: ["COST_VIEW"] };

    it("lists every member with the rate in force for the month and the labor cost it produces", async () => {
      const prisma = {
        user: { findMany: vi.fn().mockResolvedValue([
          { id: "u1", displayName: "Kha", email: "kha@example.com", avatarUrl: null, resourceProfile: { displayRole: "PM" } },
          { id: "u2", displayName: "Mai", email: "mai@example.com", avatarUrl: null, resourceProfile: null }
        ]) },
        taskTimeEntry: { findMany: vi.fn().mockResolvedValue([
          { userId: "u1", minutes: 120, approvalStatus: "approved", workDate: new Date("2026-10-05T02:00:00.000Z") },
          { userId: "u2", minutes: 60, approvalStatus: "approved", workDate: new Date("2026-10-05T02:00:00.000Z") }
        ]) },
        pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
        costRateProfile: { findMany: vi.fn().mockResolvedValue([
          { userId: "u1", hourlyCostRate: 150_000, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }
        ]) }
      } as any;

      const response = await new ResourceControlsService(prisma).listCostRates({ periodKey: "2026-10" }, viewer as any);

      expect(response.meta).toEqual({ periodKey: "2026-10", locked: false, canEdit: false, currency: "VND", statementFrozen: false });
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual([
        { userId: "u1", displayName: "Kha", avatarUrl: undefined, role: "PM", hourlyCostRate: 150_000, rateFromPeriodKey: "2026-09", approvedMinutes: 120, laborCostAmount: 300_000 },
        { userId: "u2", displayName: "Mai", avatarUrl: undefined, role: undefined, hourlyCostRate: undefined, rateFromPeriodKey: undefined, approvedMinutes: 60, laborCostAmount: 0 }
      ]);
      expect(prisma.taskTimeEntry.findMany.mock.calls[0][0].where.workDate).toEqual({ gte: new Date("2026-09-30T17:00:00.000Z"), lt: new Date("2026-10-31T17:00:00.000Z") });
    });

    it("lists a departed member who has approved hours in the month, and says when the statement is frozen", async () => {
      const prisma = {
        user: { findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "u1", displayName: "Kha", email: "kha@example.com", avatarUrl: null, resourceProfile: null }])
          .mockResolvedValueOnce([{ id: "gone", displayName: "Người đã nghỉ", email: "gone@example.com", avatarUrl: null, resourceProfile: { displayRole: "Dev" } }]) },
        taskTimeEntry: { findMany: vi.fn().mockResolvedValue([
          { userId: "u1", minutes: 60, approvalStatus: "approved", workDate: new Date("2026-10-05T02:00:00.000Z") },
          { userId: "gone", minutes: 180, approvalStatus: "approved", workDate: new Date("2026-10-05T02:00:00.000Z") },
          // Someone inactive with only unapproved time is not listed.
          { userId: "ghost", minutes: 30, approvalStatus: "submitted", workDate: new Date("2026-10-05T02:00:00.000Z") }
        ]) },
        pnlPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
        costRateProfile: { findMany: vi.fn().mockResolvedValue([{ userId: "gone", workspaceId: "twk-foundation", hourlyCostRate: 100_000, effectiveFrom: new Date("2026-08-31T17:00:00.000Z"), effectiveTo: null }]) }
      } as any;

      const response = await new ResourceControlsService(prisma).listCostRates({ periodKey: "2026-10" }, editor as any);

      expect(prisma.user.findMany.mock.calls[1][0].where).toEqual({ id: { in: ["gone"] } });
      expect(response.data.map((row) => [row.userId, row.inactive, row.approvedMinutes, row.laborCostAmount])).toEqual([["u1", undefined, 60, 0], ["gone", true, 180, 300_000]]);
      expect(prisma.costRateProfile.findMany.mock.calls[0][0].where.userId).toEqual({ in: ["u1", "gone"] });
      expect(response.meta).toEqual({ periodKey: "2026-10", locked: true, canEdit: false, currency: "VND", statementFrozen: true });
    });

    function ratePrisma(overrides: Record<string, unknown> = {}) {
      return {
        user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", resourceProfile: { displayRole: "PM" } }) },
        pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
        costRateProfile: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        auditEvent: { create: vi.fn() },
        ...overrides
      } as any;
    }

    it("stores a month's rate from the first day of that month and audits it", async () => {
      const prisma = ratePrisma();
      await new ResourceControlsService(prisma).setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: 180_000 }, editor as any);

      expect(prisma.costRateProfile.create).toHaveBeenCalledWith({ data: { workspaceId: "twk-foundation", userId: "u1", role: "PM", currency: "VND", hourlyCostRate: 180_000, effectiveFrom: new Date("2026-09-30T17:00:00.000Z") } });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "pnl.cost_rate_changed", resourceId: "u1" }) }));
    });

    it("updates or clears an existing month rate", async () => {
      const existing = { id: "rate-1", hourlyCostRate: 100_000 };
      const prisma = ratePrisma({ costRateProfile: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn(), update: vi.fn(), delete: vi.fn() } });
      const service = new ResourceControlsService(prisma);

      await service.setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: 120_000 }, editor as any);
      expect(prisma.costRateProfile.update).toHaveBeenCalledWith({ where: { id: "rate-1" }, data: { hourlyCostRate: 120_000, effectiveTo: null } });

      await service.setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: null }, editor as any);
      expect(prisma.costRateProfile.delete).toHaveBeenCalledWith({ where: { id: "rate-1" } });
      expect(prisma.costRateProfile.create).not.toHaveBeenCalled();
    });

    it("rejects cost edits without COST_EDIT, with invalid values, or in a locked month", async () => {
      const prisma = ratePrisma();
      const service = new ResourceControlsService(prisma);
      await expect(service.setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: 1 }, viewer as any)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: -1 }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setCostRate({ userId: "u1", periodKey: "2026-13", hourlyCostRate: 1 }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: Number.NaN }, editor as any)).rejects.toBeInstanceOf(BadRequestException);

      const locked = ratePrisma({ pnlPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) } });
      await expect(new ResourceControlsService(locked).setCostRate({ userId: "u1", periodKey: "2026-10", hourlyCostRate: 1 }, editor as any)).rejects.toBeInstanceOf(ConflictException);
      expect(locked.pnlPeriod.findFirst).toHaveBeenCalledWith({ where: { workspaceId: "twk-foundation", projectId: null, periodKey: "2026-10", status: "LOCKED" }, select: { id: true } });
      expect(locked.costRateProfile.create).not.toHaveBeenCalled();
      expect(prisma.costRateProfile.create).not.toHaveBeenCalled();
    });

    it("refuses a rate change that a later locked month inherits, unless that month has its own rate", async () => {
      // 2026-12 is locked; the change is made in 2026-10.
      const lockedLater = (nextOwnRate: unknown) => ratePrisma({
        pnlPeriod: { findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.periodKey?.gt ? { periodKey: "2026-12" } : null)) },
        costRateProfile: { findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.effectiveFrom?.gt ? nextOwnRate : null)), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
      });
      const change = { userId: "u1", periodKey: "2026-10", hourlyCostRate: 180_000 };

      const inherits = lockedLater(null);
      await expect(new ResourceControlsService(inherits).setCostRate(change, editor as any)).rejects.toThrow("kỳ 2026-12 đã chốt");
      expect(inherits.pnlPeriod.findFirst).toHaveBeenCalledWith({ where: { workspaceId: "twk-foundation", projectId: null, status: "LOCKED", periodKey: { gt: "2026-10" } }, orderBy: { periodKey: "asc" }, select: { periodKey: true } });
      expect(inherits.costRateProfile.create).not.toHaveBeenCalled();
      // Clearing the month's rate changes what the locked month inherits just the same.
      await expect(new ResourceControlsService(inherits).setCostRate({ ...change, hourlyCostRate: null }, editor as any)).rejects.toBeInstanceOf(ConflictException);

      // The person's next own rate starts after the locked month: December still inherits October's.
      const tooLate = lockedLater({ effectiveFrom: new Date("2026-12-31T17:00:00.000Z") });
      await expect(new ResourceControlsService(tooLate).setCostRate(change, editor as any)).rejects.toBeInstanceOf(ConflictException);

      // Own rate from November, or for December itself: the locked month does not depend on October.
      for (const effectiveFrom of [new Date("2026-10-31T17:00:00.000Z"), new Date("2026-11-30T17:00:00.000Z")]) {
        const shielded = lockedLater({ effectiveFrom });
        await new ResourceControlsService(shielded).setCostRate(change, editor as any);
        expect(shielded.costRateProfile.create).toHaveBeenCalledTimes(1);
      }
    });

    function costPrisma(overrides: Record<string, unknown> = {}) {
      return {
        project: { findFirst: vi.fn().mockResolvedValue({ id: "prj-1", accountId: "acc-1", name: "AMOBEAR - HRM" }) },
        pnlPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
        projectCost: {
          create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "cost-1", currency: "VND", note: null, ...data })),
          findFirst: vi.fn(), update: vi.fn(), delete: vi.fn()
        },
        auditEvent: { create: vi.fn() },
        ...overrides
      } as any;
    }

    it("creates a project cost line dated in the reporting timezone", async () => {
      const prisma = costPrisma();
      const response = await new ResourceControlsService(prisma).createProjectCost({ projectId: "prj-1", category: "functional-operation", costType: "SOFTWARE", label: "  Lark license ", amount: 1_500_000, occurredOn: "2026-10-01" }, editor as any);

      expect(prisma.projectCost.create).toHaveBeenCalledWith({ data: { workspaceId: "twk-foundation", accountId: "acc-1", projectId: "prj-1", costType: "SOFTWARE", category: "functional-operation", label: "Lark license", amount: 1_500_000, occurredAt: new Date("2026-09-30T17:00:00.000Z"), note: undefined, createdByUserId: "usr-founder" } });
      expect(response.data).toMatchObject({ id: "cost-1", projectId: "prj-1", projectName: "AMOBEAR - HRM", costType: "SOFTWARE", category: "functional-operation", amount: 1_500_000, occurredOn: "2026-10-01" });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "pnl.project_cost_created", resourceId: "cost-1" }) }));
    });

    it("validates cost lines and never lets labor be entered or edited by hand", async () => {
      const prisma = costPrisma();
      const service = new ResourceControlsService(prisma);
      const base = { projectId: "prj-1", category: "basic-activities", costType: "OTHER", label: "x", amount: 100, occurredOn: "2026-10-01" } as const;
      await expect(service.createProjectCost({ ...base }, viewer as any)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.createProjectCost({ ...base, costType: "LABOR" as any }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createProjectCost({ ...base, category: "salaries-related" as any }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createProjectCost({ ...base, amount: 0 }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createProjectCost({ ...base, label: "  " }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createProjectCost({ ...base, occurredOn: "2026-02-30" }, editor as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectCost.create).not.toHaveBeenCalled();

      prisma.projectCost.findFirst.mockResolvedValue({ id: "cost-9", projectId: "prj-1", costType: "LABOR", label: "seed", amount: 1, occurredAt: new Date("2026-10-01T03:00:00.000Z"), project: { name: "P" } });
      await expect(service.deleteProjectCost("cost-9", editor as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectCost.delete).not.toHaveBeenCalled();
    });

    it("tells the screen it cannot edit other costs of a locked month", async () => {
      const prisma = { projectCost: { findMany: vi.fn().mockResolvedValue([]) }, pnlPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) } } as any;
      const service = new ResourceControlsService(prisma);
      await expect(service.listProjectCosts({ startDate: "2026-10-01", endDate: "2026-10-31" }, editor as any)).resolves.toMatchObject({ meta: { canEdit: false, locked: true } });
      prisma.pnlPeriod.findFirst.mockResolvedValue(null);
      await expect(service.listProjectCosts({ startDate: "2026-10-01", endDate: "2026-10-31" }, editor as any)).resolves.toMatchObject({ meta: { canEdit: true, locked: false } });
      await expect(service.listProjectCosts({ startDate: "2026-10-01", endDate: "2026-10-31" }, viewer as any)).resolves.toMatchObject({ meta: { canEdit: false, locked: false } });
    });

    it("blocks changing a cost line that sits in a locked month", async () => {
      const prisma = costPrisma({ pnlPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) } });
      prisma.projectCost.findFirst.mockResolvedValue({ id: "cost-2", projectId: "prj-1", costType: "OTHER", label: "x", amount: 1, occurredAt: new Date("2026-10-01T03:00:00.000Z"), project: { name: "P" } });
      const service = new ResourceControlsService(prisma);
      await expect(service.deleteProjectCost("cost-2", editor as any)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.createProjectCost({ projectId: "prj-1", category: "basic-activities", costType: "OTHER", label: "x", amount: 5, occurredOn: "2026-10-01" }, editor as any)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.projectCost.delete).not.toHaveBeenCalled();
      expect(prisma.projectCost.create).not.toHaveBeenCalled();
    });
  });
});
