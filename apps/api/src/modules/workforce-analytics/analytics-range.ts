import { BadRequestException } from "@nestjs/common";
import {
  ANALYTICS_MAX_RANGE_DAYS,
  ANALYTICS_TIMEZONE,
  type AnalyticsCompareMode,
  type AnalyticsGrain
} from "@b2b-crm/contracts";

/**
 * Asia/Ho_Chi_Minh is a fixed UTC+07:00 zone (no DST), so v1 bucketing can use
 * exact offset arithmetic instead of a timezone database. All public inputs
 * and outputs stay canonical UTC instants; only bucket boundaries and labels
 * are derived in HCM local time.
 */
export const HCM_OFFSET_MINUTES = 7 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export interface AnalyticsRange {
  from: Date;
  to: Date;
  grain: AnalyticsGrain;
  timezone: string;
  compare: AnalyticsCompareMode;
}

export interface AnalyticsBucketBoundary {
  start: Date;
  end: Date;
  label: string;
}

export function toHcmParts(instant: Date) {
  const local = new Date(instant.getTime() + HCM_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes()
  };
}

export function hcmDateToUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - HCM_OFFSET_MINUTES * MS_PER_MINUTE);
}

export function startOfHcmDay(instant: Date): Date {
  const parts = toHcmParts(instant);
  return hcmDateToUtc(parts.year, parts.month, parts.day);
}

export function startOfHcmIsoWeek(instant: Date): Date {
  const dayStart = startOfHcmDay(instant);
  const weekday = toHcmParts(dayStart).weekday; // 0=Sun..6=Sat
  const sinceMonday = (weekday + 6) % 7;
  return new Date(dayStart.getTime() - sinceMonday * MS_PER_DAY);
}

export function startOfHcmMonth(instant: Date): Date {
  const parts = toHcmParts(instant);
  return hcmDateToUtc(parts.year, parts.month, 1);
}

export function startOfHcmQuarter(instant: Date): Date {
  const parts = toHcmParts(instant);
  const quarterMonth = Math.floor((parts.month - 1) / 3) * 3 + 1;
  return hcmDateToUtc(parts.year, quarterMonth, 1);
}

export function addHcmMonths(monthStart: Date, months: number): Date {
  const parts = toHcmParts(monthStart);
  const zeroBased = parts.month - 1 + months;
  const year = parts.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return hcmDateToUtc(year, month, 1);
}

export function addHcmDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * MS_PER_DAY);
}

export function hcmDateKey(instant: Date): string {
  const parts = toHcmParts(instant);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseInstant(raw: unknown, field: string): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new BadRequestException(`${field} must be an ISO-8601 string`);
  }
  // Date-only values are interpreted as HCM local midnight of that day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    return hcmDateToUtc(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} is not a valid ISO-8601 instant`);
  }
  return parsed;
}

export function parseAnalyticsRange(query: {
  from?: unknown;
  to?: unknown;
  timezone?: unknown;
  grain?: unknown;
  compare?: unknown;
}, now = new Date()): AnalyticsRange {
  const timezone = typeof query.timezone === "string" && query.timezone.length > 0 ? query.timezone : ANALYTICS_TIMEZONE;
  if (timezone !== ANALYTICS_TIMEZONE) {
    throw new BadRequestException(`timezone must be ${ANALYTICS_TIMEZONE} in v1`);
  }

  const grainRaw = typeof query.grain === "string" && query.grain.length > 0 ? query.grain : "week";
  if (grainRaw !== "day" && grainRaw !== "week" && grainRaw !== "month") {
    throw new BadRequestException("grain must be day, week or month");
  }

  const compareRaw = typeof query.compare === "string" && query.compare.length > 0 ? query.compare : "none";
  if (compareRaw !== "none" && compareRaw !== "previous") {
    throw new BadRequestException("compare must be none or previous");
  }

  const defaultTo = addHcmDays(startOfHcmDay(now), 1);
  const to = parseInstant(query.to, "to") ?? defaultTo;
  const from = parseInstant(query.from, "from") ?? addHcmDays(to, -30);

  if (to.getTime() <= from.getTime()) {
    throw new BadRequestException("to must be after from ([from,to) is half-open)");
  }

  const spanDays = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (spanDays > ANALYTICS_MAX_RANGE_DAYS) {
    throw new BadRequestException(`Range must not exceed ${ANALYTICS_MAX_RANGE_DAYS} days`);
  }

  return { from, to, grain: grainRaw, timezone, compare: compareRaw };
}

export function previousEqualRange(range: AnalyticsRange): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
}

function nextBoundary(current: Date, grain: AnalyticsGrain): Date {
  if (grain === "day") return addHcmDays(startOfHcmDay(current), 1);
  if (grain === "week") return addHcmDays(startOfHcmIsoWeek(current), 7);
  return addHcmMonths(startOfHcmMonth(current), 1);
}

/**
 * Buckets tile [from,to) exactly: the first bucket starts at `from` and the
 * last one ends at `to`, so bucket sums always reconcile with range totals.
 * Interior boundaries align to HCM day/ISO-week/month starts.
 */
export function buildAnalyticsBuckets(from: Date, to: Date, grain: AnalyticsGrain): AnalyticsBucketBoundary[] {
  const buckets: AnalyticsBucketBoundary[] = [];
  let cursor = new Date(from.getTime());
  let guard = 0;
  while (cursor.getTime() < to.getTime() && guard < 1000) {
    guard += 1;
    const boundary = nextBoundary(cursor, grain);
    const end = boundary.getTime() >= to.getTime() || boundary.getTime() <= cursor.getTime()
      ? to
      : boundary;
    buckets.push({ start: cursor, end, label: hcmDateKey(cursor) });
    cursor = end;
  }
  return buckets;
}

/** Fraction of [itemStart,itemEnd) that falls inside [rangeStart,rangeEnd). */
export function overlapFraction(rangeStart: Date, rangeEnd: Date, itemStart: Date, itemEnd: Date): number {
  const start = Math.max(rangeStart.getTime(), itemStart.getTime());
  const end = Math.min(rangeEnd.getTime(), itemEnd.getTime());
  const span = itemEnd.getTime() - itemStart.getTime();
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (end - start) / span));
}

/** Count HCM-local weekdays (Mon-Fri) in the half-open day range [from,to). */
export function countHcmWeekdays(from: Date, to: Date): number {
  let count = 0;
  let cursor = startOfHcmDay(from);
  if (cursor.getTime() < from.getTime()) cursor = addHcmDays(cursor, 1);
  let guard = 0;
  while (cursor.getTime() < to.getTime() && guard < 40_000) {
    guard += 1;
    const weekday = toHcmParts(cursor).weekday;
    if (weekday >= 1 && weekday <= 5) count += 1;
    cursor = addHcmDays(cursor, 1);
  }
  return count;
}

/**
 * Prorate a capacity period to the analytics range using business-day overlap:
 * availableMinutes × (weekdays in overlap / weekdays in the full period).
 * Periods with zero weekdays contribute nothing rather than dividing by zero.
 */
export function prorateCapacityPeriod(input: {
  rangeFrom: Date;
  rangeTo: Date;
  periodStart: Date;
  periodEnd: Date;
  availableMinutes: number;
}): number {
  const overlapStart = new Date(Math.max(input.rangeFrom.getTime(), input.periodStart.getTime()));
  const overlapEnd = new Date(Math.min(input.rangeTo.getTime(), input.periodEnd.getTime()));
  if (overlapEnd.getTime() <= overlapStart.getTime()) return 0;
  const periodWeekdays = countHcmWeekdays(input.periodStart, input.periodEnd);
  if (periodWeekdays <= 0) return 0;
  const overlapWeekdays = countHcmWeekdays(overlapStart, overlapEnd);
  return (input.availableMinutes * overlapWeekdays) / periodWeekdays;
}

/** Weekly capacity scaled by HCM weekdays in range (used only for explicit profiles). */
export function prorateWeeklyCapacity(weeklyMinutes: number, rangeFrom: Date, rangeTo: Date): number {
  const weekdays = countHcmWeekdays(rangeFrom, rangeTo);
  return (weeklyMinutes * weekdays) / 5;
}
