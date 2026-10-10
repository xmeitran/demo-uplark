import { toVietnamDateKey } from "@/lib/vietnam-time";
import { monthDateRange, periodLabel, shiftPeriod } from "@/components/pnl/pnl-cost-shared";

/** Inclusive Asia/Ho_Chi_Minh local days (YYYY-MM-DD). Both empty = all time. */
export type DateRange = { from: string; to: string };
export type DateRangePreset = DateRange & { id: string; label: string };
export type DatePresetId = "this-month" | "last-month" | "this-quarter" | "this-year" | "all";

const PRESET_LABELS: Record<DatePresetId, string> = {
  "this-month": "Tháng này",
  "last-month": "Tháng trước",
  "this-quarter": "Quý này",
  "this-year": "Năm nay",
  all: "Tất cả thời gian"
};

function wholeMonth(periodKey: string): DateRange {
  const range = monthDateRange(periodKey);
  return { from: range.startDate, to: range.endDate };
}

/** Months as YYYY-MM, newest first, from `min` to `max` plus any `include` outside that span. */
export function buildMonthList({ min, max, include = [] }: { min: string; max: string; include?: string[] }): string[] {
  const months = new Set(include.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)));
  for (let month = min; month <= max; month = shiftPeriod(month, 1)) months.add(month);
  return [...months].sort((a, b) => b.localeCompare(a));
}

/** Calendar presets as whole periods: "Tháng này" is the first to the last day of the month. */
export function datePresets(ids: DatePresetId[], today = toVietnamDateKey(new Date())): DateRangePreset[] {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const quarterStart = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  const ranges: Record<DatePresetId, DateRange> = {
    "this-month": wholeMonth(month),
    "last-month": wholeMonth(shiftPeriod(month, -1)),
    "this-quarter": { from: `${year}-${String(quarterStart).padStart(2, "0")}-01`, to: wholeMonth(`${year}-${String(quarterStart + 2).padStart(2, "0")}`).to },
    "this-year": { from: `${year}-01-01`, to: `${year}-12-31` },
    all: { from: "", to: "" }
  };
  return ids.map((id) => ({ id, label: PRESET_LABELS[id], ...ranges[id] }));
}

/** One whole-month preset per YYYY-MM, labelled "Tháng mm/yyyy". */
export function monthPresets(months: string[]): DateRangePreset[] {
  return months.map((month) => ({ id: month, label: periodLabel(month), ...wholeMonth(month) }));
}

export function formatDay(day: string) {
  return day.split("-").reverse().join("/");
}

/** The matching preset's name, otherwise "dd/mm/yyyy – dd/mm/yyyy". */
export function formatRangeLabel(range: DateRange, presets: DateRangePreset[] = []): string {
  const preset = presets.find((item) => item.from === range.from && item.to === range.to);
  if (preset) return preset.label;
  if (!range.from && !range.to) return PRESET_LABELS.all;
  return `${range.from ? formatDay(range.from) : "…"} – ${range.to ? formatDay(range.to) : "…"}`;
}

/** A select offering fewer than two real choices cannot narrow anything. */
export function hasChoice(options: ReadonlyArray<{ value: string }>): boolean {
  return options.filter((option) => option.value && option.value !== "all").length >= 2;
}
