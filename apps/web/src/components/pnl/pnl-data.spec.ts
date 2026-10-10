import { describe, expect, it } from "vitest";
import { adaptLivePnlProjects } from "./pnl-data";

describe("P&L project adapter — EV-007", () => {
  it("reconciles approved and excluded hours instead of showing false pending work", () => {
    const [project] = adaptLivePnlProjects(
      [{
        projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND",
        plannedRevenueAmount: 1000, revenueAmount: 1000, revenueBasis: "planned", missingRateMinutes: 0, paidRevenueAmount: 1000, plannedCostAmount: 500,
        approvedLaborMinutes: 60, actualLaborCostAmount: 100, directCostAmount: 0, writeOffAmount: 0,
        totalCostAmount: 100, grossMarginAmount: 900, grossMarginPercent: 90
      } as any],
      [{ id: "project-1", code: "PRJ-1", name: "CRM", status: "in_progress", plannedMinutes: 120 } as any],
      [
        { projectId: "project-1", userId: "user-1", userDisplayName: "A", minutes: 60, approvalStatus: "approved", workDate: "2026-09-03T02:00:00.000Z" },
        { projectId: "project-1", userId: "user-1", userDisplayName: "A", minutes: 60, approvalStatus: "rejected", workDate: "2026-09-03T03:00:00.000Z" }
      ] as any,
      "2026-09"
    );

    expect(project).toMatchObject({
      logworkMinutes: 120,
      pnlMinutes: 60,
      excludedMinutes: 60,
      pendingMinutes: 0,
      status: "Đã đối soát",
      revenueBasis: "planned",
      revenue: 1000,
      totalCost: 100,
      costAvailable: true,
      revenueScope: "Toàn project",
      pnlResultStatus: "Tạm tính"
    });
    expect(project.daily).toHaveLength(30);
    expect(project.daily.find((point) => point.date === "2026-09-03")).toMatchObject({ minutes: 120, pnlMinutes: 60, pendingMinutes: 0, entryCount: 2, peopleLogged: 1 });
  });

  it("keeps pending status and zero-fills every day in the selected period", () => {
    const [project] = adaptLivePnlProjects(
      [{ projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND", plannedRevenueAmount: 1000, revenueAmount: 1000, revenueBasis: "planned", missingRateMinutes: 0, paidRevenueAmount: 0, plannedCostAmount: 500, approvedLaborMinutes: 0, actualLaborCostAmount: 0, directCostAmount: 0, writeOffAmount: 0, totalCostAmount: 0, grossMarginAmount: 1000 } as any],
      [{ id: "project-1", code: "PRJ-1", name: "CRM", plannedMinutes: 120 } as any],
      [{ projectId: "project-1", userId: "user-1", minutes: 60, approvalStatus: "submitted", workDate: "2026-09-30T04:00:00.000Z" }] as any,
      "2026-09"
    );

    expect(project.status).toBe("Chờ xử lý");
    expect(project.pendingMinutes).toBe(60);
    expect(project.daily[0]).toMatchObject({ date: "2026-09-01", minutes: 0, pnlMinutes: 0, pendingMinutes: 0 });
    expect(project.daily.at(-1)).toMatchObject({ date: "2026-09-30", minutes: 60, pnlMinutes: 0, pendingMinutes: 60 });
  });

  it("does not fall back to lifetime project hours when a scoped range has no entries", () => {
    const [project] = adaptLivePnlProjects(
      [{ projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND", plannedRevenueAmount: 1000, revenueAmount: 1000, revenueBasis: "planned", missingRateMinutes: 0, paidRevenueAmount: 1000, plannedCostAmount: 500, approvedLaborMinutes: 0, actualLaborCostAmount: 0, directCostAmount: 0, writeOffAmount: 0, totalCostAmount: 0, grossMarginAmount: 1000 } as any],
      [{ id: "project-1", code: "PRJ-1", name: "CRM", plannedMinutes: 480, loggedMinutes: 480, approvedMinutes: 480 } as any],
      [],
      "2026-10",
      { startDate: "2026-10-01", endDate: "2026-10-07" }
    );

    expect(project).toMatchObject({ logworkMinutes: 0, pnlMinutes: 0, pendingMinutes: 0, status: "Thiếu dữ liệu", dataSource: "period" });
    expect(project.revenueBasis).toBe("planned");
    expect(project.revenueScope).toBe("Toàn project");
    expect(project.pnlResultStatus).toBe("Thiếu dữ liệu");
    expect(project.daily).toHaveLength(7);
  });

  it("derives planned hours per person from distinct task estimates", () => {
    const [project] = adaptLivePnlProjects(
      [{ projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND", plannedRevenueAmount: 0, revenueAmount: 0, revenueBasis: "none", missingRateMinutes: 0, paidRevenueAmount: 0, plannedCostAmount: 0, approvedLaborMinutes: 0, actualLaborCostAmount: 0, directCostAmount: 0, writeOffAmount: 0, totalCostAmount: 0, grossMarginAmount: 0 } as any],
      [{ id: "project-1", code: "PRJ-1", name: "CRM", plannedMinutes: 180 } as any],
      [
        { projectId: "project-1", taskId: "task-1", taskEstimateMinutes: 120, userId: "user-1", userDisplayName: "A", minutes: 30, approvalStatus: "approved", workDate: "2026-09-03T02:00:00.000Z" },
        { projectId: "project-1", taskId: "task-1", taskEstimateMinutes: 120, userId: "user-1", userDisplayName: "A", minutes: 30, approvalStatus: "approved", workDate: "2026-09-04T02:00:00.000Z" },
        { projectId: "project-1", taskId: "task-2", taskEstimateMinutes: 60, userId: "user-1", userDisplayName: "A", minutes: 30, approvalStatus: "approved", workDate: "2026-09-05T02:00:00.000Z" }
      ] as any,
      "2026-09"
    );

    expect(project.people[0]).toMatchObject({ planMinutes: 180, logworkMinutes: 90 });
  });

  it("takes revenue, cost and per-person labor cost from the API instead of deriving them", () => {
    const [project] = adaptLivePnlProjects(
      [{
        projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND",
        plannedRevenueAmount: 1000, paidRevenueAmount: 400, customRevenueAmount: 800, revenueAmount: 800, revenueBasis: "custom",
        plannedCostAmount: 0, approvedLaborMinutes: 180, missingRateMinutes: 60,
        actualLaborCostAmount: 200, directCostAmount: 50, writeOffAmount: 10, totalCostAmount: 260,
        grossMarginAmount: 540, grossMarginPercent: 67.5,
        laborByPerson: [
          { userId: "user-1", displayName: "A", approvedMinutes: 120, laborCostAmount: 200, missingRateMinutes: 0, hourlyCostRate: 100 },
          { userId: "user-2", displayName: "B", approvedMinutes: 60, laborCostAmount: 0, missingRateMinutes: 60 }
        ],
        costItems: [{ id: "c1", projectId: "project-1", costType: "SOFTWARE", label: "Lark", amount: 50, currency: "VND", occurredOn: "2026-09-03" }]
      } as any],
      [{ id: "project-1", code: "PRJ-1", name: "CRM", plannedMinutes: 120 } as any],
      [{ projectId: "project-1", userId: "user-1", userDisplayName: "A", minutes: 120, approvalStatus: "approved", workDate: "2026-09-03T02:00:00.000Z" }] as any,
      "2026-09"
    );

    expect(project).toMatchObject({ revenue: 800, revenueBasis: "custom", totalCost: 260, laborCost: 200, directCost: 50, writeOff: 10, grossMargin: 540, grossMarginPercent: 67.5, missingRateMinutes: 60, costAvailable: false });
    expect(project.costItems).toHaveLength(1);
    expect(project.people.find((person) => person.id === "user-1")).toMatchObject({ hourlyCostRate: 100, laborCost: 200, missingRateMinutes: 0, pnlMinutes: 120 });
    // A person the API costed but who has no entry in the loaded page still appears.
    expect(project.people.find((person) => person.id === "user-2")).toMatchObject({ name: "B", laborCost: 0, missingRateMinutes: 60 });
  });

  const summary = (overrides: Record<string, unknown>) => ({
    projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND",
    plannedRevenueAmount: 1000, revenueAmount: 1000, revenueBasis: "custom", missingRateMinutes: 0, paidRevenueAmount: 0, plannedCostAmount: 500,
    approvedLaborMinutes: 60, actualLaborCostAmount: 100, directCostAmount: 20, writeOffAmount: 0, enteredCostAmount: 20, otherCostAmount: 20,
    sharedCostAmount: 0, calculatedCostAmount: 0, calculatedItems: [], locked: false,
    costByCategory: { "welfare-related": 0, "basic-activities": 20, "business-location": 0, "sell-marketing": 0, "functional-operation": 0 },
    totalCostAmount: 120, grossMarginAmount: 880, ...overrides
  }) as any;
  const projectRow = [{ id: "project-1", code: "PRJ-1", name: "CRM", plannedMinutes: 120 } as any];
  const sumOf = (project: { expenses: Array<{ amount: number }> }) => project.expenses.reduce((total, expense) => total + expense.amount, 0);

  it("keeps the six BRD expense groups for an open month, and they add up to the API total", () => {
    const [project] = adaptLivePnlProjects([summary({ sharedCostAmount: 30, calculatedCostAmount: 50, otherCostAmount: 100, totalCostAmount: 200, costByCategory: { "welfare-related": 50, "basic-activities": 20, "business-location": 0, "sell-marketing": 0, "functional-operation": 0 } })], projectRow, [] as any, "2026-09");
    expect(project.expenses.map((expense) => expense.label)).toEqual(["Salaries Related", "Welfare Related", "Basic Activities", "Business Location", "Sell & MKT Expenses", "Functional Operation"]);
    expect(sumOf(project)).toBe(project.totalCost);
    expect(project).toMatchObject({ otherCost: 100, enteredCost: 20, lockedOtherCost: undefined });
  });

  it("shows a locked month as three frozen rows that add up, with no pool or formula rows", () => {
    const [project] = adaptLivePnlProjects([summary({ locked: true, lockedOtherCostAmount: 80, otherCostAmount: 100, totalCostAmount: 200, costByCategory: { "welfare-related": 0, "basic-activities": 0, "business-location": 0, "sell-marketing": 0, "functional-operation": 0 } })], projectRow, [] as any, "2026-09");
    expect(project.pnlResultStatus).toBe("Sẵn sàng");
    expect(project.expenses.map((expense) => [expense.label, expense.amount])).toEqual([
      ["Salaries Related", 100],
      ["Chi phí nhập tay đã chốt", 20],
      ["Chi phí khác đã chốt (quỹ dùng chung + khoản tính theo công thức)", 80]
    ]);
    expect(sumOf(project)).toBe(200);
    expect(project).toMatchObject({ locked: true, lockedOtherCost: 80, sharedCost: 0, calculatedItems: [] });
  });

  it("never calls an open month ready because another month is locked", () => {
    const [project] = adaptLivePnlProjects([summary({ latestSnapshot: { status: "locked" } })], projectRow, [{ projectId: "project-1", userId: "user-1", minutes: 60, approvalStatus: "approved", workDate: "2026-09-03T02:00:00.000Z" }] as any, "2026-09");
    expect(project.pnlResultStatus).toBe("Tạm tính");
  });

  it("takes approved hours from the API, not from the entries loaded in the browser", () => {
    // 22:00 UTC on 30 Sep is 1 Oct in Vietnam: the API counted it in October, a UTC cut would not.
    const [project] = adaptLivePnlProjects(
      [summary({ approvedLaborMinutes: 180, laborByPerson: [{ userId: "user-1", displayName: "A", approvedMinutes: 180, laborCostAmount: 100, missingRateMinutes: 0, hourlyCostRate: 33 }] })],
      projectRow,
      [
        { projectId: "project-1", userId: "user-1", userDisplayName: "A", minutes: 60, approvalStatus: "approved", workDate: "2026-10-03T02:00:00.000Z" },
        { projectId: "project-1", userId: "user-2", userDisplayName: "B", minutes: 30, approvalStatus: "approved", workDate: "2026-10-03T02:00:00.000Z" }
      ] as any,
      "2026-10"
    );
    expect(project.pnlMinutes).toBe(180);
    expect(project.logworkMinutes).toBe(180);
    expect(project.people.find((person) => person.id === "user-1")).toMatchObject({ pnlMinutes: 180, laborCost: 100 });
    // Someone the API did not cost has no approved hours next to the money.
    expect(project.people.find((person) => person.id === "user-2")).toMatchObject({ pnlMinutes: 0, logworkMinutes: 30 });
  });
});
