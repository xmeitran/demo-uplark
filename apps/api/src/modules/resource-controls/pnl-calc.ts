/**
 * Pure P&L arithmetic. Kept free of Prisma/Nest so every figure shown in the
 * P&L screens can be unit-tested from plain values.
 */

// Reporting months follow Asia/Ho_Chi_Minh, which is UTC+7 all year (no DST).
const REPORT_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

/** YYYY-MM of an instant in the reporting timezone. */
export function reportMonthKey(date: Date) {
  return new Date(date.getTime() + REPORT_TZ_OFFSET_MS).toISOString().slice(0, 7);
}

/** Instant at which a YYYY-MM-DD day starts in the reporting timezone. */
export function reportDayStart(dateKey: string) {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() - REPORT_TZ_OFFSET_MS);
}

/** Instant at which a YYYY-MM month starts in the reporting timezone. */
export function reportMonthStart(periodKey: string) {
  return reportDayStart(`${periodKey}-01`);
}

export function nextMonthKey(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** BRD 2.1 expense groups a non-labor cost line (khoản mục) can belong to. Labor is always "salaries-related" and is computed. */
export const COST_CATEGORIES = ["welfare-related", "basic-activities", "business-location", "sell-marketing", "functional-operation"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const DEFAULT_COST_CATEGORY: CostCategory = "functional-operation";

export function normalizeCostCategory(value: unknown): CostCategory {
  return (COST_CATEGORIES as readonly string[]).includes(String(value)) ? (value as CostCategory) : DEFAULT_COST_CATEGORY;
}

/** Every YYYY-MM from `from` to `to` inclusive. */
export function monthKeysBetween(from: string, to: string) {
  const keys: string[] = [];
  for (let key = from; key <= to && keys.length < 600; key = nextMonthKey(key)) keys.push(key);
  return keys;
}
