import { describe, expect, it } from "vitest";
import { countMetric, coverageState, deltaPercent, median, ratioMetric, roundTo } from "./analytics-metrics";

describe("ratioMetric", () => {
  it("returns N/A (null) instead of 0% for zero or missing denominators", () => {
    const zero = ratioMetric("billableRatio", 120, null);
    expect(zero.value).toBeNull();
    expect(zero.state).toBe("partial");

    const missing = ratioMetric("actualUtilization", 120, 0, { missingState: "unavailable" });
    expect(missing.value).toBeNull();
    expect(missing.state).toBe("unavailable");
  });

  it("computes percentages with configured rounding", () => {
    const metric = ratioMetric("billableRatio", 1, 3);
    expect(metric.value).toBe(33.3);
    expect(metric.state).toBe("available");
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(3);
  });

  it("downgrades state when coverage is incomplete", () => {
    const metric = ratioMetric("actualUtilization", 100, 200, { coverage: { covered: 3, total: 5 } });
    expect(metric.state).toBe("partial");
    expect(metric.value).toBe(50);
  });
});

describe("countMetric", () => {
  it("rounds to integers and carries previous comparison", () => {
    const metric = countMetric("reviewedApprovedMinutes", 120.4, { previousValue: 100 });
    expect(metric.value).toBe(120);
    expect(metric.deltaPercent).toBe(20);
  });
});

describe("helpers", () => {
  it("median handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("deltaPercent avoids division by zero", () => {
    expect(deltaPercent(10, 0)).toBeNull();
    expect(deltaPercent(null, 10)).toBeNull();
    expect(deltaPercent(15, 10)).toBe(50);
    expect(deltaPercent(5, -10)).toBe(150);
  });

  it("coverageState maps coverage to metric states", () => {
    expect(coverageState(undefined)).toBeUndefined();
    expect(coverageState({ covered: 0, total: 0 })).toBe("unavailable");
    expect(coverageState({ covered: 0, total: 5 })).toBe("unavailable");
    expect(coverageState({ covered: 3, total: 5 })).toBe("partial");
    expect(coverageState({ covered: 5, total: 5 })).toBe("available");
  });

  it("roundTo applies decimal rounding", () => {
    expect(roundTo(1.005, 2)).toBeCloseTo(1.0, 5);
    expect(roundTo(33.333, 1)).toBe(33.3);
  });
});
