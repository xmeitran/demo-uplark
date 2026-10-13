import { describe, expect, it } from "vitest";
import { isLostDealProject, summarizeLostDealPreSale } from "./lost-deal";

describe("lost-deal Pre-sale (D-07, decision 5)", () => {
  const closedLost = [{ toStatus: "closed", closeReasonCode: "lost_deal", changedAt: "2026-09-20T00:00:00Z" }];

  it("a project is a lost deal only while Closed with its latest close reason Thua deal", () => {
    expect(isLostDealProject("closed", closedLost)).toBe(true);
    expect(isLostDealProject("active", closedLost)).toBe(false);
    expect(isLostDealProject("closed", [{ toStatus: "closed", closeReasonCode: "client_stopped", changedAt: "2026-09-20T00:00:00Z" }])).toBe(false);
    expect(isLostDealProject("closed", [...closedLost, { toStatus: "active", changedAt: "2026-09-25T00:00:00Z" }, { toStatus: "closed", closeReasonCode: "internal_cancel", changedAt: "2026-10-01T00:00:00Z" }])).toBe(false);
  });

  it("sums minutes per month and per project under the label Chi phí Pre-sale at company level", () => {
    const a = { projectId: "a", projectCode: "A", projectName: "Deal A" };
    const b = { projectId: "b", projectCode: "B", projectName: "Deal B" };
    expect(summarizeLostDealPreSale([
      { ...a, workDate: "2026-09-03T00:00:00Z", minutes: 60 },
      { ...b, workDate: "2026-08-30T00:00:00Z", minutes: 30 },
      { ...a, workDate: new Date("2026-09-10T00:00:00Z"), minutes: 90 },
      { ...b, workDate: "2026-09-11T00:00:00Z", minutes: 15 }
    ])).toEqual({
      label: "Chi phí Pre-sale",
      level: "company",
      totalMinutes: 195,
      months: [
        { month: "2026-08", minutes: 30, projects: [{ ...b, minutes: 30 }] },
        { month: "2026-09", minutes: 165, projects: [{ ...a, minutes: 150 }, { ...b, minutes: 15 }] }
      ]
    });
  });

  it("no lost deals gives an empty, still labelled summary", () => {
    expect(summarizeLostDealPreSale([])).toEqual({ label: "Chi phí Pre-sale", level: "company", totalMinutes: 0, months: [] });
  });
});
