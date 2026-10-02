import { describe, expect, it } from "vitest";
import { adaptLivePnlProjects } from "./pnl-data";

describe("P&L project adapter — EV-007", () => {
  it("reconciles approved and excluded hours instead of showing false pending work", () => {
    const [project] = adaptLivePnlProjects(
      [{
        projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND",
        plannedRevenueAmount: 1000, paidRevenueAmount: 1000, plannedCostAmount: 500,
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
      status: "Đã đối soát"
    });
    expect(project.daily).toHaveLength(30);
    expect(project.daily.find((point) => point.date === "2026-09-03")).toMatchObject({ minutes: 120, pnlMinutes: 60, pendingMinutes: 0, entryCount: 2, peopleLogged: 1 });
  });

  it("keeps pending status and zero-fills every day in the selected period", () => {
    const [project] = adaptLivePnlProjects(
      [{ projectId: "project-1", projectName: "CRM", accountName: "Client", currency: "VND", plannedRevenueAmount: 1000, paidRevenueAmount: 0, plannedCostAmount: 500, approvedLaborMinutes: 0, actualLaborCostAmount: 0, directCostAmount: 0, writeOffAmount: 0, totalCostAmount: 0, grossMarginAmount: 1000 } as any],
      [{ id: "project-1", code: "PRJ-1", name: "CRM", plannedMinutes: 120 } as any],
      [{ projectId: "project-1", userId: "user-1", minutes: 60, approvalStatus: "submitted", workDate: "2026-09-30T04:00:00.000Z" }] as any,
      "2026-09"
    );

    expect(project.status).toBe("Chờ xử lý");
    expect(project.pendingMinutes).toBe(60);
    expect(project.daily[0]).toMatchObject({ date: "2026-09-01", minutes: 0, pnlMinutes: 0, pendingMinutes: 0 });
    expect(project.daily.at(-1)).toMatchObject({ date: "2026-09-30", minutes: 60, pnlMinutes: 0, pendingMinutes: 60 });
  });
});
