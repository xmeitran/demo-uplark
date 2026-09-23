/**
 * Formatting + semantic colors for the Timesheet screens.
 *
 * Kept free of Recharts so the route bundle does not pull the chart library
 * in — same split the /analytics module already uses.
 */

import type { WorkGroup } from "./timesheet-types";

/** Every color is a design token; no raw hex anywhere in the Timesheet UI. */
export const TS_COLORS = {
  actual: "var(--color-chart-1)",
  standard: "var(--color-gray-500)",
  estimate: "var(--color-gray-400)",
  billable: "var(--color-success)",
  pending: "var(--color-warning)",
  over: "var(--color-destructive)",
  info: "var(--color-info)",
  accent: "var(--color-chart-2)"
} as const;

export const WORK_GROUP_COLORS: Record<WorkGroup, string> = {
  customer_project: "var(--color-chart-1)",
  internal_project: "var(--color-chart-2)",
  ticket_maintenance: "var(--color-chart-5)",
  meeting: "var(--color-chart-6)",
  training: "var(--color-chart-3)",
  other: "var(--color-gray-400)"
};

export function formatHours(minutes: number | null | undefined, fallback = "—"): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return fallback;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}

export function formatHoursShort(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  return `${Math.round(minutes / 60)}h`;
}

export function formatPercent(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return `${Math.round(value * 10) / 10}%`;
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

export function formatSignedHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours >= 0 ? "+" : ""}${hours.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}

const MONTH_LABELS = [
  "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
  "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"
];

export function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return `${MONTH_LABELS[mon - 1]}/${year}`;
}

export function formatDate(iso: string | null | undefined, fallback = "Chưa đặt"): string {
  if (!iso) return fallback;
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/** Tailwind classes for a status pill, keyed by semantic tone. */
export function toneClasses(tone: "success" | "warning" | "danger" | "info" | "neutral"): string {
  switch (tone) {
    case "success":
      return "bg-success/10 text-success";
    case "warning":
      return "bg-warning/10 text-warning";
    case "danger":
      return "bg-destructive/10 text-destructive";
    case "info":
      return "bg-info/10 text-info";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function qualityTone(quality: "good" | "warning" | "critical"): "success" | "warning" | "danger" {
  return quality === "good" ? "success" : quality === "warning" ? "warning" : "danger";
}

export function riskTone(risk: "ok" | "watch" | "over"): "success" | "warning" | "danger" {
  return risk === "ok" ? "success" : risk === "watch" ? "warning" : "danger";
}

export function nodeStatusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "in_progress":
      return "info";
    case "blocked":
      return "danger";
    default:
      return "neutral";
  }
}

export function projectStatusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "in_progress":
    case "onboarding":
      return "info";
    case "acceptance":
      return "warning";
    case "paused":
      return "danger";
    default:
      return "neutral";
  }
}
