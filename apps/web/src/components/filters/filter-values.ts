import { toVietnamDateKey } from "@/lib/vietnam-time";
import type { DateRange } from "./filter-dates";

/** Multi-select values as one query parameter; nothing selected sends no parameter at all. */
export function toCsvParam(values: readonly string[]): string | undefined {
  const list = fromCsvParam([...values]);
  return list.length ? list.join(",") : undefined;
}

/** Reads `a,b` or a repeated parameter back into trimmed, unique, non-empty values. */
export function fromCsvParam(value: string | readonly string[] | null | undefined): string[] {
  const parts = (typeof value === "string" ? [value] : value ?? []).flatMap((item) => item.split(","));
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
}

/** Multi-select match: nothing selected means "all"; a row with several values needs one of them selected. */
export function matchesAny(selected: readonly string[], value: string | readonly string[] | null | undefined): boolean {
  if (!selected.length) return true;
  if (value == null) return false;
  return typeof value === "string" ? selected.includes(value) : value.some((item) => selected.includes(item));
}

/** `day` (YYYY-MM-DD) inside an inclusive range; an empty bound is open-ended, an empty day only passes "all time". */
export function isWithinRange(day: string | null | undefined, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!day) return false;
  return (!range.from || day >= range.from) && (!range.to || day <= range.to);
}

/** A start–end span (inclusive days, either may be empty = open) touching the range on at least one day. */
export function rangesOverlap(startDay: string | null | undefined, endDay: string | null | undefined, range: DateRange): boolean {
  return (!range.to || !startDay || startDay <= range.to) && (!range.from || !endDay || endDay >= range.from);
}

/** The Asia/Ho_Chi_Minh calendar day of a timestamp, "" when missing or unparseable. */
export function dayOf(isoDateTime: string | Date | null | undefined): string {
  return isoDateTime ? toVietnamDateKey(isoDateTime) : "";
}
