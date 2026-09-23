import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  buildAnalyticsBuckets,
  countHcmWeekdays,
  hcmDateKey,
  hcmDateToUtc,
  overlapFraction,
  parseAnalyticsRange,
  previousEqualRange,
  prorateCapacityPeriod,
  prorateWeeklyCapacity,
  startOfHcmDay,
  startOfHcmIsoWeek,
  startOfHcmMonth,
  startOfHcmQuarter
} from "./analytics-range";

describe("parseAnalyticsRange", () => {
  it("interprets date-only inputs as HCM local midnight (UTC-7h)", () => {
    const range = parseAnalyticsRange({ from: "2026-07-01", to: "2026-08-01" });
    expect(range.from.toISOString()).toBe("2026-06-30T17:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-07-31T17:00:00.000Z");
  });

  it("accepts full ISO instants unchanged", () => {
    const range = parseAnalyticsRange({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" });
    expect(range.from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rejects to <= from", () => {
    expect(() => parseAnalyticsRange({ from: "2026-07-02", to: "2026-07-02" })).toThrow(BadRequestException);
    expect(() => parseAnalyticsRange({ from: "2026-07-03", to: "2026-07-02" })).toThrow(BadRequestException);
  });

  it("rejects ranges above 366 days", () => {
    expect(() => parseAnalyticsRange({ from: "2025-01-01", to: "2026-01-03" })).toThrow(BadRequestException);
    // Leap-year-spanning 366-day range is allowed.
    expect(() => parseAnalyticsRange({ from: "2024-01-01", to: "2025-01-01" })).not.toThrow();
  });

  it("rejects non-HCM timezones and unknown grains/compare", () => {
    expect(() => parseAnalyticsRange({ timezone: "UTC" })).toThrow(BadRequestException);
    expect(() => parseAnalyticsRange({ grain: "hour" })).toThrow(BadRequestException);
    expect(() => parseAnalyticsRange({ compare: "yoy" })).toThrow(BadRequestException);
  });

  it("rejects malformed instants", () => {
    expect(() => parseAnalyticsRange({ from: "not-a-date", to: "2026-07-02" })).toThrow(BadRequestException);
  });

  it("defaults to a 30-day window ending tomorrow HCM midnight", () => {
    const now = new Date("2026-07-15T04:00:00.000Z");
    const range = parseAnalyticsRange({}, now);
    expect(range.to.toISOString()).toBe("2026-07-15T17:00:00.000Z");
    expect((range.to.getTime() - range.from.getTime()) / 86_400_000).toBe(30);
  });
});

describe("HCM boundary helpers", () => {
  it("startOfHcmDay handles the UTC/HCM date shift", () => {
    // 2026-07-01T16:59Z is still 2026-07-01 23:59 HCM
    expect(startOfHcmDay(new Date("2026-07-01T16:59:00.000Z")).toISOString()).toBe("2026-06-30T17:00:00.000Z");
    // 2026-07-01T17:00Z is 2026-07-02 00:00 HCM
    expect(startOfHcmDay(new Date("2026-07-01T17:00:00.000Z")).toISOString()).toBe("2026-07-01T17:00:00.000Z");
  });

  it("startOfHcmIsoWeek returns Monday HCM midnight", () => {
    // 2026-07-15 is a Wednesday in HCM
    const weekStart = startOfHcmIsoWeek(new Date("2026-07-15T04:00:00.000Z"));
    expect(hcmDateKey(weekStart)).toBe("2026-07-13");
  });

  it("startOfHcmMonth and quarter handle year boundaries", () => {
    // 2026-01-01 00:30 HCM = 2025-12-31T17:30Z
    const janStart = startOfHcmMonth(new Date("2025-12-31T17:30:00.000Z"));
    expect(hcmDateKey(janStart)).toBe("2026-01-01");
    const quarterStart = startOfHcmQuarter(new Date("2026-05-20T00:00:00.000Z"));
    expect(hcmDateKey(quarterStart)).toBe("2026-04-01");
  });

  it("handles the leap day", () => {
    const leap = startOfHcmDay(new Date("2024-02-29T05:00:00.000Z"));
    expect(hcmDateKey(leap)).toBe("2024-02-29");
    expect(hcmDateToUtc(2024, 2, 29).toISOString()).toBe("2024-02-28T17:00:00.000Z");
  });
});

describe("buildAnalyticsBuckets", () => {
  it("tiles [from,to) exactly with day buckets", () => {
    const from = hcmDateToUtc(2026, 7, 1);
    const to = hcmDateToUtc(2026, 7, 4);
    const buckets = buildAnalyticsBuckets(from, to, "day");
    expect(buckets).toHaveLength(3);
    expect(buckets[0].start.toISOString()).toBe(from.toISOString());
    expect(buckets[2].end.toISOString()).toBe(to.toISOString());
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i].start.toISOString()).toBe(buckets[i - 1].end.toISOString());
    }
  });

  it("aligns interior week boundaries to HCM Mondays", () => {
    // 2026-07-01 is a Wednesday; first bucket is partial (Wed..Mon)
    const from = hcmDateToUtc(2026, 7, 1);
    const to = hcmDateToUtc(2026, 7, 20);
    const buckets = buildAnalyticsBuckets(from, to, "week");
    expect(buckets[0].label).toBe("2026-07-01");
    expect(buckets[1].label).toBe("2026-07-06");
    expect(buckets[2].label).toBe("2026-07-13");
    expect(buckets[buckets.length - 1].end.toISOString()).toBe(to.toISOString());
  });

  it("aligns month buckets across a leap February", () => {
    const from = hcmDateToUtc(2024, 1, 15);
    const to = hcmDateToUtc(2024, 4, 1);
    const buckets = buildAnalyticsBuckets(from, to, "month");
    expect(buckets.map((bucket) => bucket.label)).toEqual(["2024-01-15", "2024-02-01", "2024-03-01"]);
  });
});

describe("overlap proration", () => {
  it("computes clamped overlap fractions", () => {
    const rangeStart = new Date("2026-07-01T00:00:00.000Z");
    const rangeEnd = new Date("2026-07-08T00:00:00.000Z");
    expect(overlapFraction(rangeStart, rangeEnd, new Date("2026-07-02T00:00:00.000Z"), new Date("2026-07-04T00:00:00.000Z"))).toBe(1);
    expect(overlapFraction(rangeStart, rangeEnd, new Date("2026-06-29T00:00:00.000Z"), new Date("2026-07-03T00:00:00.000Z"))).toBeCloseTo(0.5);
    expect(overlapFraction(rangeStart, rangeEnd, new Date("2026-07-10T00:00:00.000Z"), new Date("2026-07-12T00:00:00.000Z"))).toBe(0);
    expect(overlapFraction(rangeStart, rangeEnd, rangeStart, rangeStart)).toBe(0);
  });

  it("counts HCM weekdays over a known week", () => {
    // 2026-07-06 (Mon) .. 2026-07-13 (Mon, exclusive) = Mon-Fri = 5 weekdays
    expect(countHcmWeekdays(hcmDateToUtc(2026, 7, 6), hcmDateToUtc(2026, 7, 13))).toBe(5);
    expect(countHcmWeekdays(hcmDateToUtc(2026, 7, 11), hcmDateToUtc(2026, 7, 13))).toBe(0);
  });

  it("prorates capacity periods by business-day overlap", () => {
    // Period Mon 2026-07-06 .. Mon 2026-07-20 (10 weekdays), 4800 minutes
    const periodStart = hcmDateToUtc(2026, 7, 6);
    const periodEnd = hcmDateToUtc(2026, 7, 20);
    const full = prorateCapacityPeriod({
      rangeFrom: periodStart,
      rangeTo: periodEnd,
      periodStart,
      periodEnd,
      availableMinutes: 4800
    });
    expect(full).toBe(4800);
    const halfWeek = prorateCapacityPeriod({
      rangeFrom: hcmDateToUtc(2026, 7, 6),
      rangeTo: hcmDateToUtc(2026, 7, 13),
      periodStart,
      periodEnd,
      availableMinutes: 4800
    });
    expect(halfWeek).toBe(2400);
    const outside = prorateCapacityPeriod({
      rangeFrom: hcmDateToUtc(2026, 8, 1),
      rangeTo: hcmDateToUtc(2026, 8, 8),
      periodStart,
      periodEnd,
      availableMinutes: 4800
    });
    expect(outside).toBe(0);
  });

  it("scales weekly capacity by weekdays / 5", () => {
    expect(prorateWeeklyCapacity(2400, hcmDateToUtc(2026, 7, 6), hcmDateToUtc(2026, 7, 13))).toBe(2400);
    expect(prorateWeeklyCapacity(2400, hcmDateToUtc(2026, 7, 6), hcmDateToUtc(2026, 7, 9))).toBe(1440);
  });
});

describe("previousEqualRange", () => {
  it("returns the immediately preceding equal-length window", () => {
    const range = parseAnalyticsRange({ from: "2026-07-01", to: "2026-07-15" });
    const previous = previousEqualRange(range);
    expect(previous.to.toISOString()).toBe(range.from.toISOString());
    expect(previous.from.toISOString()).toBe("2026-06-16T17:00:00.000Z");
  });
});
