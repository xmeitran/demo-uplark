import { describe, expect, it } from "vitest";
import {
  dashboardApiQuery, dashboardSearch, entriesApiQuery, fixTargetHref, isSafePnlApiPath, parseDashboardState, parseProjectScope, patchDashboardState, pendingHoursHref, projectScopeOf,
  periodIndexOptions
} from "./pnl-query";

const parse = (query: string) => parseDashboardState(new URLSearchParams(query), 2026);

describe("dashboard URL state", () => {
  it("defaults to the year view with the default selection rule", () => {
    const state = parse("");
    expect(state).toMatchObject({ year: 2026, unit: "year", index: 1, rule: "started_and_accepted", tab: "accepted", view: "accounting", page: 1, sort: "start", direction: "asc" });
    expect(dashboardSearch(state, 2026)).toBe("");
    expect(dashboardApiQuery(state)).toBe("year=2026");
  });

  it("round-trips every filter through the URL", () => {
    const query = "year=2025&unit=quarter&index=3&rule=accepted_in_period&projectType=customer&accountId=acc-1&picUserId=u-1&tab=in_progress&groupKey=PM&page=2&sort=ebit&direction=desc&view=role";
    const state = parse(query);
    expect(state).toMatchObject({ year: 2025, unit: "quarter", index: 3, rule: "accepted_in_period", projectType: "customer", accountId: "acc-1", picUserId: "u-1", tab: "in_progress", view: "role", groupKey: "PM", page: 2, sort: "ebit", direction: "desc" });
    expect(parse(dashboardSearch(state, 2026))).toEqual(state);
  });

  it("does not send the screen-only grouping choice to the API", () => {
    expect(dashboardApiQuery(parse("view=role&unit=half&index=2"))).toBe("year=2026&unit=half&index=2");
  });

  it("falls back on invalid values instead of passing them on", () => {
    const state = parse("year=abc&unit=week&index=9&rule=x&tab=y&view=z&page=-1&sort=drop&direction=up");
    expect(state).toMatchObject({ year: 2026, unit: "year", index: 1, rule: "started_and_accepted", tab: "accepted", view: "accounting", page: 1, sort: "start", direction: "asc" });
    expect(parse("unit=quarter&index=5").index).toBe(1);
    expect(parse("unit=month&index=12").index).toBe(12);
  });

  it("resets what a change invalidates", () => {
    const state = parse("unit=quarter&index=3&page=4&view=role&groupKey=PM");
    expect(patchDashboardState(state, { unit: "month" })).toMatchObject({ unit: "month", index: 1, page: 1 });
    expect(patchDashboardState(state, { accountId: "acc-2" })).toMatchObject({ accountId: "acc-2", index: 3, page: 1, groupKey: "PM" });
    expect(patchDashboardState(state, { view: "accounting" })).toMatchObject({ view: "accounting", groupKey: "" });
    expect(patchDashboardState(state, { page: 5 }).page).toBe(5);
  });

  it("offers the right period values per unit", () => {
    expect(periodIndexOptions("year")).toEqual([]);
    expect(periodIndexOptions("half").map((option) => option.label)).toEqual(["H1", "H2"]);
    expect(periodIndexOptions("quarter")).toHaveLength(4);
    expect(periodIndexOptions("month")[8]).toEqual({ value: "9", label: "Tháng 09" });
  });
});

describe("project scope", () => {
  it("is Toàn dự án unless both months are valid and ordered", () => {
    expect(parseProjectScope(new URLSearchParams(""))).toBeNull();
    expect(parseProjectScope(new URLSearchParams("fromMonth=2026-08"))).toBeNull();
    expect(parseProjectScope(new URLSearchParams("fromMonth=2026-09&toMonth=2026-08"))).toBeNull();
    expect(parseProjectScope(new URLSearchParams("fromMonth=2026-13&toMonth=2026-14"))).toBeNull();
    expect(parseProjectScope(new URLSearchParams("fromMonth=2026-08&toMonth=2026-09"))).toEqual({ fromMonth: "2026-08", toMonth: "2026-09" });
  });

  it("the month-range control: the whole span is “Toàn dự án”, anything narrower is a scope", () => {
    const range = { minPeriodKey: "2026-03", maxPeriodKey: "2026-07" };
    expect(projectScopeOf("2026-03", "2026-07", range)).toBeNull();
    expect(projectScopeOf("2026-04", "2026-07", range)).toEqual({ fromMonth: "2026-04", toMonth: "2026-07" });
    expect(projectScopeOf("2026-05", "2026-05", range)).toEqual({ fromMonth: "2026-05", toMonth: "2026-05" });
    expect(projectScopeOf("2026-06", "2026-04", range)).toEqual({ fromMonth: "2026-06", toMonth: "2026-06" });
  });
});

describe("links to the place that fixes missing data", () => {
  it("scopes the Chờ xử lý worklist", () => {
    expect(pendingHoursHref()).toBe("/pnl/hours");
    expect(pendingHoursHref({ from: "2026-01", to: "2026-12" })).toBe("/pnl/hours?from=2026-01&to=2026-12");
    expect(pendingHoursHref({ projectId: "p-a", periodKey: "2026-09", group: "cost_rate" })).toBe("/pnl/hours?projectId=p-a&periodKey=2026-09&group=cost_rate");
    // fund_unallocated is not a group of GET /pnl/entries
    expect(pendingHoursHref({ projectId: "p-a", group: "fund_unallocated" })).toBe("/pnl/hours?projectId=p-a");
  });

  it("maps every fix target to a screen", () => {
    expect(fixTargetHref("pending_hours", { projectId: "p-a" })).toBe("/pnl/hours?projectId=p-a");
    expect(fixTargetHref("project_setup", { projectId: "p-a" })).toBe("/projects/p-a");
    expect(fixTargetHref("staff_costs", { periodKey: "2026-09" })).toBe("/users/costs?periodKey=2026-09");
    expect(fixTargetHref("funds", { periodKey: "2026-09" })).toBe("/pnl/costs?tab=funds&periodKey=2026-09");
    expect(fixTargetHref("periods")).toBe("/pnl/costs?tab=periods");
    expect(fixTargetHref("parameters")).toBe("/pnl/costs?tab=parameters");
    expect(fixTargetHref("approval")).toBe("/admin#approval");
  });

  it("passes only known parameters to GET /pnl/entries, pending by default", () => {
    expect(entriesApiQuery(new URLSearchParams("projectId=p-a&periodKey=2026-09&startDate=2026-09-01&tab=x"))).toBe("status=pending&projectId=p-a&periodKey=2026-09");
    expect(entriesApiQuery(new URLSearchParams("status=excluded&line=after_close"))).toBe("status=excluded&line=after_close");
  });
});

describe("BFF /api/pnl/[...path]", () => {
  it("forwards the paths the screens call", () => {
    for (const path of [["dashboard"], ["projects", "cmg1a2b3c0000xyz"], ["projects", "p-a", "months", "2026-09"], ["projects", "p-a", "setup", "installments", "default:hm-01:1"], ["config", "items", "CP.FUNCOP.AI"], ["funds", "fund_1", "periods", "2026-09", "confirm"], ["staff-costs", "employee-code"]]) {
      expect(isSafePnlApiPath(path)).toBe(true);
    }
  });

  it("refuses anything that could leave /pnl or is not an identifier", () => {
    for (const path of [[], [".."], ["..", "auth", "session"], ["projects", "..", "..", "admin"], ["."], ["projects", ""], ["projects", "a/b"], ["projects", "a%2Fb"], ["projects", "..%2F"], ["projects", ".hidden"], ["entries?x=1"], ["a b"], ["a\\b"]]) {
      expect(isSafePnlApiPath(path)).toBe(false);
    }
  });
});
