/**
 * Display formatting for the whole P&L tab — report screens (mục 4, 5) and setup / data-entry screens (mục 6.1–6.7).
 * The one set: a figure reads the same wherever it is shown. The API returns exact đồng, minutes and unrounded
 * percentages; these helpers only format (round once, when shown). A missing figure (`null`) is always "—", never 0 (PL-25).
 * Reading what a user typed is not formatting: parseMoneyInput / parseDecimalInput are in pnl-cost-shared.ts.
 */

export const NO_VALUE = "—";

const numberFormat = (minimumFractionDigits: number, maximumFractionDigits: number) =>
  new Intl.NumberFormat("vi-VN", { minimumFractionDigits, maximumFractionDigits });

type Amount = number | null | undefined;

/** Exact đồng for tooltips: "67.200.000 đ". */
export function formatExactVnd(amount: Amount): string | undefined {
  if (amount === null || amount === undefined) return undefined;
  return `${numberFormat(0, 0).format(amount)} đ`;
}

/** Exact VND amount for visible P&L figures; never hides the million conversion behind a coefficient. */
export function formatVndAmount(amount: Amount): string {
  return formatExactVnd(amount) ?? NO_VALUE;
}

/** Whole đồng without the unit — cost rate and sell rate per hour, period totals: "162.381". */
export function formatDong(amount: Amount): string {
  if (amount === null || amount === undefined) return NO_VALUE;
  return numberFormat(0, 0).format(amount);
}

/** Minutes → hours, no unit: 6330 → "105,5". */
export function formatHoursValue(minutes: Amount): string {
  if (minutes === null || minutes === undefined) return NO_VALUE;
  return numberFormat(0, 2).format(minutes / 60);
}

/** A computed ratio (margin, share, used-of-cap): "34,0%", "3,3%" — one rounding, at display. */
export function formatPercent(value: Amount, digits = 1): string {
  if (value === null || value === undefined) return NO_VALUE;
  return `${numberFormat(digits, digits).format(value)}%`;
}

/** A rate somebody entered, shown as entered: "70%", "33,33%" (instalments, warning thresholds). */
export function formatEnteredPercent(value: Amount): string {
  if (value === null || value === undefined) return NO_VALUE;
  return `${numberFormat(0, 4).format(value)}%`;
}

/** "+5%" / "−3%" for the logged-vs-plan note. */
export function formatSignedPercent(value: Amount): string {
  if (value === null || value === undefined) return NO_VALUE;
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}%`;
}

/** "2026-03" or "2026-03-15" → "03/2026". */
export function formatMonth(key: string | null | undefined): string {
  return key ? `${key.slice(5, 7)}/${key.slice(0, 4)}` : NO_VALUE;
}

/** The label of the month-range control (mục 5 khối 1): "Từ 03/2026 đến 07/2026". */
export function monthRangeLabel(from: string, to: string): string {
  return `Từ ${formatMonth(from)} đến ${formatMonth(to)}`;
}

/** "2026-03-15" → "03/26" (the "Bắt đầu → NT" column). */
export function formatMonthShort(key: string | null | undefined): string {
  return key ? `${key.slice(5, 7)}/${key.slice(2, 4)}` : NO_VALUE;
}

/** "2026-03-15" or an ISO timestamp (read in Vietnam time) → "15/03/2026"; `withYear: false` → "15/03". */
export function formatDay(value: string | null | undefined, withYear = true): string {
  if (!value) return NO_VALUE;
  const key = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : vietnamDayKey.format(new Date(value));
  return `${key.slice(8, 10)}/${key.slice(5, 7)}${withYear ? `/${key.slice(0, 4)}` : ""}`;
}

const vietnamDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });

const vietnamParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
});

function vietnamTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const part = Object.fromEntries(vietnamParts.formatToParts(date).map((item) => [item.type, item.value]));
  return { day: part.day, month: part.month, year: part.year, time: `${part.hour}:${part.minute}` };
}

/** "số liệu cập nhật 08:30 ngày 12/10" — Vietnam time. */
export function formatUpdatedAt(iso: string): string {
  const at = vietnamTime(iso);
  return at ? `${at.time} ngày ${at.day}/${at.month}` : NO_VALUE;
}

/** "12/10/2026 08:30" — Vietnam time, for the change history. */
export function formatDateTime(iso: string): string {
  const at = vietnamTime(iso);
  return at ? `${at.day}/${at.month}/${at.year} ${at.time}` : NO_VALUE;
}

/** Every month from `from` to `to` inclusive (YYYY-MM). */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  // ponytail: capped at 240 months so a malformed key cannot loop forever.
  while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 240) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}
