/**
 * Formatting helpers and semantic series colors for /analytics. Kept separate
 * from the chart module so the main route bundle does not pull Recharts in.
 */

export const SERIES_COLORS = {
  reviewed: "var(--color-chart-1)",
  scheduled: "var(--color-info)",
  allocation: "var(--color-warning)",
  estimate: "var(--color-gray-400)",
  capacity: "var(--color-gray-500)",
  billable: "var(--color-success)",
  negative: "var(--color-destructive)"
} as const;

export function formatHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "Chưa có dữ liệu";
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Chưa có dữ liệu";
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}
