import { describe, expect, it } from "vitest";
import {
  ANALYTICS_DEFAULT_STATE,
  buildAnalyticsApiQuery,
  countActiveFilters,
  defaultBreakdownByForView,
  effectiveGrain,
  exclusiveEndDateToInclusiveEndDate,
  inclusiveEndDateToExclusiveEndDate,
  parseAnalyticsSearchParams,
  resolvePresetRange,
  serializeAnalyticsState,
  withFilterChange
} from "./analytics-url-state";

const NOW = new Date("2026-07-15T04:00:00.000Z"); // 11:00 HCM, Wednesday

describe("parseAnalyticsSearchParams", () => {
  it("returns defaults for an empty query", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams());
    expect(state.view).toBe("overview");
    expect(state.preset).toBe("30d");
    expect(state.grain).toBe("week");
    expect(state.by).toBe("project");
    expect(state.departmentIds).toEqual([]);
  });

  it("rejects invalid enum/id values instead of trusting the URL", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams("view=hack&grain=hour&billable=maybe&user=a,b,<script>"));
    expect(state.view).toBe("overview");
    expect(state.grain).toBe("week");
    expect(state.billable).toBe("all");
    expect(state.userIds).toEqual(["a", "b"]);
  });

  it("falls back when a custom preset has an invalid range", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams("preset=custom&from=2026-07-10&to=2026-07-01"));
    expect(state.preset).toBe("30d");
  });

  it("keeps an incomplete custom range so the date controls remain reachable", () => {
    const emptyDraft = parseAnalyticsSearchParams(new URLSearchParams("preset=custom"));
    expect(emptyDraft.preset).toBe("custom");
    expect(emptyDraft.from).toBeUndefined();
    expect(emptyDraft.to).toBeUndefined();

    const oneBoundary = parseAnalyticsSearchParams(new URLSearchParams("preset=custom&from=2026-07-01"));
    expect(oneBoundary.preset).toBe("custom");
    expect(oneBoundary.from).toBe("2026-07-01");
    expect(oneBoundary.to).toBeUndefined();
  });

  it("rejects normalized but impossible calendar dates", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams("preset=custom&from=2026-02-31&to=2026-13-01"));
    expect(state.preset).toBe("custom");
    expect(state.from).toBeUndefined();
    expect(state.to).toBeUndefined();

    const nonLeapDay = parseAnalyticsSearchParams(new URLSearchParams("preset=custom&from=2026-02-29&to=2026-03-01"));
    expect(nonLeapDay.from).toBeUndefined();
    expect(nonLeapDay.to).toBe("2026-03-01");
  });

  it("keeps a valid custom range", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams("preset=custom&from=2026-06-01&to=2026-07-01"));
    expect(state.preset).toBe("custom");
    expect(state.from).toBe("2026-06-01");
    expect(state.to).toBe("2026-07-01");
  });

  it("derives the default breakdown grouping from the view", () => {
    expect(parseAnalyticsSearchParams(new URLSearchParams("view=workforce")).by).toBe("user");
    expect(parseAnalyticsSearchParams(new URLSearchParams("view=projects")).by).toBe("project");
    expect(defaultBreakdownByForView("resources")).toBe("user");
  });
});

describe("serializeAnalyticsState", () => {
  it("omits defaults so links stay minimal", () => {
    expect(serializeAnalyticsState(ANALYTICS_DEFAULT_STATE)).toBe("");
  });

  it("round-trips non-default state through the URL", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams(
      "view=workforce&preset=90d&grain=day&compare=previous&dept=d1&team=t1,t2&user=u1&billable=billable&sort=capacityMinutes&dir=asc"
    ));
    const roundTripped = parseAnalyticsSearchParams(new URLSearchParams(serializeAnalyticsState(state)));
    expect(roundTripped).toEqual(state);
  });

  it("serializes custom range boundaries only for the custom preset", () => {
    const custom = { ...ANALYTICS_DEFAULT_STATE, preset: "custom" as const, from: "2026-06-01", to: "2026-07-01" };
    expect(serializeAnalyticsState(custom)).toContain("from=2026-06-01");
    const nonCustom = { ...ANALYTICS_DEFAULT_STATE, from: "2026-06-01", to: "2026-07-01" };
    expect(serializeAnalyticsState(nonCustom)).toBe("");
  });
});

describe("withFilterChange", () => {
  it("always resets pagination", () => {
    const state = { ...ANALYTICS_DEFAULT_STATE, cursor: "abc" };
    expect(withFilterChange(state, { userIds: ["u1"] }).cursor).toBeUndefined();
  });
});

describe("resolvePresetRange", () => {
  it("computes HCM-local windows ending tomorrow (exclusive)", () => {
    const week = resolvePresetRange({ ...ANALYTICS_DEFAULT_STATE, preset: "7d" }, NOW);
    expect(week).toEqual({ from: "2026-07-09", to: "2026-07-16" });
    const month = resolvePresetRange({ ...ANALYTICS_DEFAULT_STATE, preset: "month" }, NOW);
    expect(month).toEqual({ from: "2026-07-01", to: "2026-07-16" });
    const quarter = resolvePresetRange({ ...ANALYTICS_DEFAULT_STATE, preset: "quarter" }, NOW);
    expect(quarter).toEqual({ from: "2026-07-01", to: "2026-07-16" });
  });

  it("handles the HCM date shift near UTC midnight", () => {
    // 2026-07-15T18:30Z is already 2026-07-16 in HCM
    const shifted = resolvePresetRange({ ...ANALYTICS_DEFAULT_STATE, preset: "7d" }, new Date("2026-07-15T18:30:00.000Z"));
    expect(shifted).toEqual({ from: "2026-07-10", to: "2026-07-17" });
  });
});

describe("inclusive and exclusive end-date boundaries", () => {
  it("converts an inclusive UI end date to the exclusive API boundary and back", () => {
    expect(inclusiveEndDateToExclusiveEndDate("2026-07-15")).toBe("2026-07-16");
    expect(exclusiveEndDateToInclusiveEndDate("2026-07-16")).toBe("2026-07-15");
  });

  it("handles month, year and leap-day boundaries without timezone drift", () => {
    expect(inclusiveEndDateToExclusiveEndDate("2026-12-31")).toBe("2027-01-01");
    expect(inclusiveEndDateToExclusiveEndDate("2028-02-29")).toBe("2028-03-01");
    expect(exclusiveEndDateToInclusiveEndDate("2028-03-01")).toBe("2028-02-29");
  });

  it("rejects invalid calendar dates instead of normalizing them", () => {
    expect(inclusiveEndDateToExclusiveEndDate("2026-02-31")).toBeUndefined();
    expect(exclusiveEndDateToInclusiveEndDate("not-a-date")).toBeUndefined();
  });
});

describe("effectiveGrain", () => {
  it("falls back to coarser buckets to keep chart marks bounded", () => {
    expect(effectiveGrain({ ...ANALYTICS_DEFAULT_STATE, preset: "30d", grain: "day" }, NOW)).toBe("day");
    expect(effectiveGrain({ ...ANALYTICS_DEFAULT_STATE, preset: "custom", from: "2025-08-01", to: "2026-07-01", grain: "day" }, NOW)).toBe("week");
    expect(effectiveGrain({ ...ANALYTICS_DEFAULT_STATE, preset: "custom", from: "2025-08-01", to: "2026-07-01", grain: "week" }, NOW)).toBe("month");
  });
});

describe("buildAnalyticsApiQuery", () => {
  it("carries validated filters as stable ids", () => {
    const state = parseAnalyticsSearchParams(new URLSearchParams("preset=7d&dept=d1&project=p1,p2&billable=non_billable&compare=previous"));
    const query = new URLSearchParams(buildAnalyticsApiQuery(state, NOW));
    expect(query.get("from")).toBe("2026-07-09");
    expect(query.get("to")).toBe("2026-07-16");
    expect(query.get("departmentId")).toBe("d1");
    expect(query.get("projectId")).toBe("p1,p2");
    expect(query.get("billable")).toBe("non_billable");
    expect(query.get("compare")).toBe("previous");
  });
});

describe("countActiveFilters", () => {
  it("counts non-default filters for the mobile badge", () => {
    expect(countActiveFilters(ANALYTICS_DEFAULT_STATE)).toBe(0);
    expect(countActiveFilters({ ...ANALYTICS_DEFAULT_STATE, preset: "7d", userIds: ["u1"], billable: "billable" })).toBe(3);
  });
});
