import { describe, expect, it } from "vitest";
import {
  dashboardApiQuery, dashboardFilterCount, dashboardPeriodPresets, dashboardSearch, entriesApiQuery, fixTargetHref, hoursFilterCount, hoursSearch, isSafePnlApiPath, legacyPeriod, monthsToDays,
  parseDashboardState, parseHoursState, parseProjectScope, patchDashboardState, pendingHoursHref, projectPeriodPresets, projectScopeOf, projectScopeOfDays, resetDashboardFilters, snapToMonths
} from "./pnl-query";

const parse = (query: string) => parseDashboardState(new URLSearchParams(query), 2026);

describe("period: days rounded to whole months", () => {
  it("snaps picked days to the months they fall in", () => {
    expect(snapToMonths({ from: "2026-03-17", to: "2026-05-02" })).toEqual({ fromMonth: "2026-03", toMonth: "2026-05" });
    expect(snapToMonths({ from: "2026-02-28", to: "2026-02-28" })).toEqual({ fromMonth: "2026-02", toMonth: "2026-02" });
    expect(monthsToDays({ fromMonth: "2026-02", toMonth: "2026-04" })).toEqual({ from: "2026-02-01", to: "2026-04-30" });
    expect(monthsToDays({ fromMonth: "2028-02", toMonth: "2028-02" })).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("refuses a missing, malformed or reversed range and stops at 60 months", () => {
    for (const range of [{ from: "", to: "" }, { from: "2026-03-01", to: "" }, { from: "2026-3-1", to: "2026-04-01" }, { from: "2026-05-01", to: "2026-04-30" }]) expect(snapToMonths(range)).toBeNull();
    expect(snapToMonths({ from: "2020-01-15", to: "2026-10-13" })).toEqual({ fromMonth: "2020-01", toMonth: "2024-12" });
    expect(snapToMonths({ from: "2021-01-01", to: "2025-12-31" })).toEqual({ fromMonth: "2021-01", toMonth: "2025-12" });
  });

  it("reads the old year / unit / index address as the same months", () => {
    expect(legacyPeriod(2026, null, 1)).toEqual({ fromMonth: "2026-01", toMonth: "2026-12" });
    expect(legacyPeriod(2025, "half", 2)).toEqual({ fromMonth: "2025-07", toMonth: "2025-12" });
    expect(legacyPeriod(2026, "quarter", 3)).toEqual({ fromMonth: "2026-07", toMonth: "2026-09" });
    expect(legacyPeriod(2026, "month", 9)).toEqual({ fromMonth: "2026-09", toMonth: "2026-09" });
    expect(legacyPeriod(2026, "quarter", 9)).toEqual({ fromMonth: "2026-10", toMonth: "2026-12" }); // out of range → the last one
    expect(legacyPeriod(2026, "week", 3)).toEqual({ fromMonth: "2026-01", toMonth: "2026-12" });
  });

  it("offers the P&L quick picks as whole months, Năm nay among them, never “all time”", () => {
    expect(dashboardPeriodPresets("2026-10-13")).toEqual([
      { id: "this-month", label: "Tháng này", from: "2026-10-01", to: "2026-10-31" },
      { id: "last-month", label: "Tháng trước", from: "2026-09-01", to: "2026-09-30" },
      { id: "this-quarter", label: "Quý này", from: "2026-10-01", to: "2026-12-31" },
      { id: "last-quarter", label: "Quý trước", from: "2026-07-01", to: "2026-09-30" },
      { id: "first-half", label: "6 tháng đầu năm", from: "2026-01-01", to: "2026-06-30" },
      { id: "second-half", label: "6 tháng cuối năm", from: "2026-07-01", to: "2026-12-31" },
      { id: "this-year", label: "Năm nay", from: "2026-01-01", to: "2026-12-31" },
      { id: "last-year", label: "Năm trước", from: "2025-01-01", to: "2025-12-31" }
    ]);
    // January: last month and last quarter are in the year before.
    const january = dashboardPeriodPresets("2026-01-05");
    expect(january[1]).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(january[3]).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
  });
});

describe("dashboard URL state", () => {
  it("defaults to the current year with the default selection rule", () => {
    const state = parse("");
    expect(state).toMatchObject({ fromMonth: "2026-01", toMonth: "2026-12", rule: "started_and_accepted", tab: "accepted", view: "accounting", page: 1, sort: "start", direction: "asc" });
    expect(dashboardSearch(state, 2026)).toBe("");
    expect(dashboardApiQuery(state)).toBe("unit=custom&fromMonth=2026-01&toMonth=2026-12");
    expect(dashboardPeriodPresets("2026-10-13")[6]).toMatchObject(monthsToDays(state)); // the control shows "Năm nay"
  });

  it("round-trips every filter through the URL", () => {
    const query = "fromMonth=2025-07&toMonth=2025-09&rule=accepted_in_period&q=base&projectType=customer&accountId=acc-1&picUserId=u-1&tab=in_progress&groupKey=PM&page=2&sort=ebit&direction=desc&view=role";
    const state = parse(query);
    expect(state).toMatchObject({ fromMonth: "2025-07", toMonth: "2025-09", rule: "accepted_in_period", q: "base", projectType: ["customer"], accountId: ["acc-1"], picUserId: ["u-1"], tab: "in_progress", view: "role", groupKey: "PM", page: 2, sort: "ebit", direction: "desc" });
    expect(dashboardSearch(state, 2026)).toBe(query);
    expect(parse(dashboardSearch(state, 2026))).toEqual(state);
  });

  it("opens an address written before the date control on the same months, then writes it as a month range", () => {
    expect(parse("year=2025")).toMatchObject({ fromMonth: "2025-01", toMonth: "2025-12" });
    expect(parse("unit=quarter&index=3")).toMatchObject({ fromMonth: "2026-07", toMonth: "2026-09" });
    expect(parse("year=2025&unit=half&index=2")).toMatchObject({ fromMonth: "2025-07", toMonth: "2025-12" });
    expect(parse("unit=month&index=12")).toMatchObject({ fromMonth: "2026-12", toMonth: "2026-12" });
    expect(parse("unit=custom&fromMonth=2025-11&toMonth=2026-02")).toMatchObject({ fromMonth: "2025-11", toMonth: "2026-02" });
    expect(dashboardSearch(parse("year=2026&unit=quarter&index=3"), 2026)).toBe("fromMonth=2026-07&toMonth=2026-09");
    expect(dashboardSearch(parse("year=2026"), 2026)).toBe("");
    expect(dashboardApiQuery(parse("unit=half&index=2&view=role"))).toBe("unit=custom&fromMonth=2026-07&toMonth=2026-12");
  });

  it("sends several clients, project types and PICs comma-joined, and the search text as q", () => {
    const state = parse("projectType=customer,internal&accountId=acc-1,acc-2,acc-1&picUserId=u-1,u-2&q=%20Khách%20A%20");
    expect(state).toMatchObject({ projectType: ["customer", "internal"], accountId: ["acc-1", "acc-2"], picUserId: ["u-1", "u-2"], q: "Khách A" });
    const api = new URLSearchParams(dashboardApiQuery(state));
    expect([api.get("projectType"), api.get("accountId"), api.get("picUserId"), api.get("q")]).toEqual(["customer,internal", "acc-1,acc-2", "u-1,u-2", "Khách A"]);
    expect(parse(dashboardSearch(state, 2026))).toEqual(state);
  });

  it("falls back on invalid values instead of passing them on", () => {
    const state = parse("year=abc&unit=week&index=9&rule=x&tab=y&view=z&page=-1&sort=drop&direction=up");
    expect(state).toMatchObject({ fromMonth: "2026-01", toMonth: "2026-12", rule: "started_and_accepted", tab: "accepted", view: "accounting", page: 1, sort: "start", direction: "asc" });
    for (const query of ["fromMonth=2026-05", "fromMonth=2026-05&toMonth=2026-04", "fromMonth=2026-13&toMonth=2026-14"]) expect(parse(query)).toMatchObject({ fromMonth: "2026-01", toMonth: "2026-12" });
    expect(parse("fromMonth=2015-01&toMonth=2026-12")).toMatchObject({ fromMonth: "2015-01", toMonth: "2019-12" }); // 60 months at most
  });

  it("resets what a change invalidates", () => {
    const state = parse("fromMonth=2026-07&toMonth=2026-09&page=4&view=role&groupKey=PM");
    expect(patchDashboardState(state, { fromMonth: "2026-03", toMonth: "2026-05" })).toMatchObject({ fromMonth: "2026-03", toMonth: "2026-05", page: 1, groupKey: "PM" });
    expect(patchDashboardState(state, { accountId: ["acc-2"] })).toMatchObject({ accountId: ["acc-2"], fromMonth: "2026-07", page: 1, groupKey: "PM" });
    expect(patchDashboardState(state, { view: "accounting" })).toMatchObject({ view: "accounting", groupKey: "" });
    expect(patchDashboardState(state, { page: 5 }).page).toBe(5);
  });

  it("counts the filters that differ from the default view, and “Đặt lại” clears them but keeps tab, grouping and sort", () => {
    expect(dashboardFilterCount(parse(""), 2026)).toBe(0);
    expect(dashboardFilterCount(parse("tab=in_progress&view=role&sort=ebit&page=3"), 2026)).toBe(0);
    expect(dashboardFilterCount(parse("year=2025"), 2026)).toBe(1);
    const state = parse("fromMonth=2025-04&toMonth=2025-06&rule=accepted_in_period&q=a&projectType=customer&accountId=acc-1&picUserId=u-1&tab=in_progress&view=role&groupKey=PM&sort=ebit&page=3");
    expect(dashboardFilterCount(state, 2026)).toBe(6); // period, rule, search, type, client, PIC
    expect(dashboardSearch(resetDashboardFilters(state, 2026), 2026)).toBe("tab=in_progress&sort=ebit&view=role");
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

  it("the date control: picked days are rounded to months and cut to the project's months", () => {
    const range = { minPeriodKey: "2026-03", maxPeriodKey: "2026-07" };
    expect(projectScopeOfDays({ from: "", to: "" }, range)).toBeNull(); // "Toàn dự án" and the "×"
    expect(projectScopeOfDays({ from: "2026-04-10", to: "2026-05-20" }, range)).toEqual({ fromMonth: "2026-04", toMonth: "2026-05" });
    expect(projectScopeOfDays({ from: "2026-01-01", to: "2026-04-02" }, range)).toEqual({ fromMonth: "2026-03", toMonth: "2026-04" });
    expect(projectScopeOfDays({ from: "2026-01-01", to: "2026-12-31" }, range)).toBeNull(); // covers the whole project
    expect(projectScopeOfDays({ from: "2026-09-01", to: "2026-10-31" }, range)).toBeNull(); // no month of the project
  });

  it("quick picks: Toàn dự án is the empty range; calendar picks are cut to the project and dropped when outside it", () => {
    expect(projectPeriodPresets({ minPeriodKey: "2026-03", maxPeriodKey: "2026-11" }, "2026-10-13")).toEqual([
      { id: "whole", label: "Toàn dự án", from: "", to: "" },
      { id: "this-month", label: "Tháng này", from: "2026-10-01", to: "2026-10-31" },
      { id: "last-month", label: "Tháng trước", from: "2026-09-01", to: "2026-09-30" },
      { id: "this-quarter", label: "Quý này", from: "2026-10-01", to: "2026-11-30" },
      { id: "last-3-months", label: "3 tháng gần nhất", from: "2026-08-01", to: "2026-10-31" },
      { id: "this-year", label: "Năm nay", from: "2026-03-01", to: "2026-11-30" }
    ]);
    // The project ended in 05/2026 and today is 10/2026: only the year still overlaps.
    expect(projectPeriodPresets({ minPeriodKey: "2026-03", maxPeriodKey: "2026-05" }, "2026-10-13").map((pick) => pick.id)).toEqual(["whole", "this-year"]);
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
    expect(fixTargetHref("project_value", { projectId: "p-a" })).toBe("/pnl/p-a");
    expect(fixTargetHref("project_value")).toBe("/pnl");
    expect(fixTargetHref("staff_costs", { periodKey: "2026-09" })).toBe("/users/costs?periodKey=2026-09");
    expect(fixTargetHref("funds", { periodKey: "2026-09" })).toBe("/pnl/costs?tab=funds&periodKey=2026-09");
    expect(fixTargetHref("periods")).toBe("/pnl/costs?tab=periods");
    expect(fixTargetHref("parameters")).toBe("/pnl/costs?tab=parameters");
    expect(fixTargetHref("approval")).toBe("/admin#approval");
  });

});

describe("hours screen URL state", () => {
  const parse = (query: string) => parseHoursState(new URLSearchParams(query));

  it("defaults to every pending hour, with no narrowing", () => {
    const state = parse("");
    expect(state).toEqual({ q: "", from: "", to: "", userIds: [], projectIds: [], statuses: ["pending"], reasons: [], groups: [] });
    expect(hoursSearch(state)).toBe("");
    expect(hoursFilterCount(state)).toBe(0);
    expect(entriesApiQuery(new URLSearchParams(""))).toBe("status=pending");
  });

  it("reads the month links other screens build as the day range of those months", () => {
    expect(parse("projectId=p-a&periodKey=2026-09&group=cost_rate")).toMatchObject({ projectIds: ["p-a"], from: "2026-09-01", to: "2026-09-30", groups: ["cost_rate"], statuses: ["pending"] });
    expect(parse("from=2026-01&to=2026-12")).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(parse("from=2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    // Specific days win over the month parameters; a malformed day is dropped.
    expect(parse("periodKey=2026-09&fromDay=2026-09-10&toDay=2026-09-12")).toMatchObject({ from: "2026-09-10", to: "2026-09-12" });
    expect(parse("fromDay=10/09/2026&toDay=2026-09-12")).toMatchObject({ from: "", to: "2026-09-12" });
  });

  it("round-trips every filter, comma-joined, and keeps the parameters it has no control for", () => {
    const query = "q=base&fromDay=2026-09-01&toDay=2026-09-15&userId=u-1%2Cu-2&projectId=p-a%2Cp-b&status=pending%2Cexcluded&reason=missing_staff_cost&group=cost_rate%2Cclassification&line=after_close";
    const state = parse(query);
    expect(state).toEqual({ q: "base", from: "2026-09-01", to: "2026-09-15", userIds: ["u-1", "u-2"], projectIds: ["p-a", "p-b"], statuses: ["pending", "excluded"], reasons: ["missing_staff_cost"], groups: ["cost_rate", "classification"] });
    expect(hoursSearch(state, new URLSearchParams(query))).toBe(query);
    expect(hoursFilterCount(state)).toBe(7);
    // An old month link is rewritten to days as soon as a filter changes.
    expect(hoursSearch({ ...parse("periodKey=2026-09"), userIds: ["u-1"] })).toBe("fromDay=2026-09-01&toDay=2026-09-30&userId=u-1");
  });

  it("status: missing = pending, “all” = every status, unknown values dropped", () => {
    expect(parse("status=all").statuses).toEqual([]);
    expect(parse("status=included,approved").statuses).toEqual(["included"]);
    expect(hoursSearch(parse("status=all"))).toBe("status=all");
    expect(hoursSearch(parse("status=included"))).toBe("status=included");
    expect(hoursFilterCount(parse("status=all"))).toBe(1);
    expect(parse("group=cost_rate,fund_unallocated").groups).toEqual(["cost_rate"]);
  });

  it("asks GET /pnl/entries for status, days and kind of pending hour; the rest is narrowed on the screen", () => {
    expect(entriesApiQuery(new URLSearchParams("projectId=p-a&periodKey=2026-09&group=cost_rate&userId=u-1&q=x&reason=locked_period&tab=x"))).toBe("status=pending&fromDay=2026-09-01&toDay=2026-09-30&group=cost_rate");
    expect(entriesApiQuery(new URLSearchParams("status=excluded&line=after_close"))).toBe("status=excluded&line=after_close");
    expect(entriesApiQuery(new URLSearchParams("status=all&fromDay=2026-09-10"))).toBe("fromDay=2026-09-10");
    expect(entriesApiQuery(new URLSearchParams("status=pending,included&blocking=true"))).toBe("status=pending%2Cincluded&blocking=true");
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
