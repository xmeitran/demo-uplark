import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { scenario, WS } from "./pnl-scenario.testing";
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

  it("pendingHoursBlockingG7 answers from the P&L gate: only missing or wrong classification / line item blocks", async () => {
    const s = scenario();
    const service = new ResourceControlsService(s.db as any, s.pnl);
    await expect(service.pendingHoursBlockingG7(WS, "p-a")).resolves.toEqual({ projectId: "p-a", blockingMinutes: 0, entryCount: 0, byReason: [], waitingCostRateMinutes: 105.5 * 60 });
    s.log({ userId: "u-a", taskId: "t-build-a", dateKey: "2026-09-28", hours: 2, selected: "INTERNAL_PROJECT" });
    await expect(service.pendingHoursBlockingG7(WS, "p-a")).resolves.toMatchObject({ blockingMinutes: 0, entryCount: 0, byReason: [] });
    // Also without the injected PnlService (the service builds one over the same database).
    await expect(new ResourceControlsService(s.db as any).pendingHoursBlockingG7(WS, "p-a")).resolves.toMatchObject({ blockingMinutes: 0 });
  });
});
