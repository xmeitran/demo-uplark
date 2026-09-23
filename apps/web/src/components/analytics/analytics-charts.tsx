"use client";

import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { AnalyticsSeriesBucket } from "@b2b-crm/contracts";
import { formatHours, formatPercent, SERIES_COLORS } from "./analytics-format";

/**
 * Chart layer for /analytics. Semantics follow spec 33: direct labels carry the
 * critical values (tooltip only enriches), bars start at zero, colors come from
 * semantic CSS tokens and never carry status alone. Animations stay off so
 * reduced-motion preferences are always respected.
 */

export { formatHours, formatPercent, SERIES_COLORS };

const AXIS_TICK = { fontSize: 11, fill: "var(--color-muted-foreground)" } as const;
const GRID_STROKE = "var(--color-border)";

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-popover-foreground)"
};


function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const tooltipHours = (value: unknown, name: unknown): [string, string] => [formatHours(toFiniteNumber(value)), String(name ?? "")];
const labelHoursIfPositive = (value: unknown): string => {
  const parsed = toFiniteNumber(value);
  return parsed !== null && parsed > 0 ? formatHours(parsed) : "";
};
const labelHoursOrNA = (value: unknown): string => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? "Chưa có dữ liệu" : formatHours(parsed);
};

function hoursTick(value: number): string {
  return `${Math.round(value / 60)}h`;
}

/* ── 1. Capacity / allocation / reviewed-actual trend ────────────────────── */

export function TrendComposedChart({ series, compareSeries }: {
  series: AnalyticsSeriesBucket[];
  compareSeries?: AnalyticsSeriesBucket[];
}) {
  const data = series.map((bucket, index) => ({
    ...bucket,
    compareReviewed: compareSeries?.[index]?.reviewedApprovedMinutes ?? null
  }));
  const lastIndex = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 20, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucketLabel" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickFormatter={hoursTick} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipHours}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* Approval states stay separate series in one stack: reviewed vs
            submitted vs legacy are never silently merged into one number. */}
        <Bar
          dataKey="reviewedApprovedMinutes"
          name="Giờ đã duyệt"
          stackId="actual"
          fill={SERIES_COLORS.reviewed}
          maxBarSize={28}
          isAnimationActive={false}
        />
        <Bar
          dataKey="submittedMinutes"
          name="Giờ đang chờ duyệt"
          stackId="actual"
          fill="var(--color-gray-300)"
          maxBarSize={28}
          isAnimationActive={false}
        />
        <Bar
          dataKey="legacyApprovedMinutes"
          name="Giờ cũ chưa đối soát"
          stackId="actual"
          fill="var(--color-chart-4)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        >
          <LabelList
            position="top"
            valueAccessor={(entry: { payload?: AnalyticsSeriesBucket } | undefined) => {
              const bucket = entry?.payload;
              if (!bucket) return "";
              const total = bucket.reviewedApprovedMinutes + bucket.submittedMinutes + bucket.legacyApprovedMinutes;
              const maxTotal = Math.max(...data.map((row) => row.reviewedApprovedMinutes + row.submittedMinutes + row.legacyApprovedMinutes), 0);
              const index = data.findIndex((row) => row.bucketStart === bucket.bucketStart);
              if (total <= 0) return "";
              return data.length <= 8 || total === maxTotal || index === lastIndex ? formatHours(total) : "";
            }}
            style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
          />
        </Bar>
        <Line
          type="monotone"
          dataKey="capacityMinutes"
          name="Năng lực khả dụng"
          stroke={SERIES_COLORS.capacity}
          strokeDasharray="6 4"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="allocationMinutes"
          name="Kế hoạch phân bổ"
          stroke={SERIES_COLORS.allocation}
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
        {compareSeries ? (
          <Line
            type="monotone"
            dataKey="compareReviewed"
            name="Giờ đã duyệt (kỳ trước)"
            stroke={SERIES_COLORS.reviewed}
            strokeOpacity={0.45}
            strokeDasharray="2 4"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── 2. Grouped project effort: estimate vs scheduled vs reviewed actual ─── */

export interface EffortChartRow {
  id: string;
  label: string;
  estimateMinutes: number;
  scheduledMinutes: number;
  reviewedMinutes: number;
  href?: string;
}

export function EffortGroupedChart({ rows, onSelect }: { rows: EffortChartRow[]; onSelect?: (id: string) => void }) {
  const height = Math.max(rows.length * 76 + 40, 180);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }} barCategoryGap="24%">
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={hoursTick} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={132} tick={{ ...AXIS_TICK, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipHours} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="estimateMinutes" name="Giờ dự kiến" fill={SERIES_COLORS.estimate} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="estimateMinutes" position="right" formatter={labelHoursIfPositive} style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} />
        </Bar>
        <Bar dataKey="scheduledMinutes" name="Đã xếp lịch" fill={SERIES_COLORS.scheduled} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="scheduledMinutes" position="right" formatter={labelHoursIfPositive} style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} />
        </Bar>
        <Bar dataKey="reviewedMinutes" name="Giờ đã duyệt" fill={SERIES_COLORS.reviewed} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="reviewedMinutes" position="right" formatter={labelHoursIfPositive} style={{ fontSize: 10, fill: "var(--color-foreground)", fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── 3. Horizontal stacked capacity usage per person ─────────────────────── */

export interface CapacityUsageRow {
  id: string;
  label: string;
  reviewedMinutes: number;
  remainingMinutes: number;
  capacityMinutes: number;
  utilizationPercent: number | null;
}

export function CapacityStackedChart({ rows, onSelect }: { rows: CapacityUsageRow[]; onSelect?: (id: string) => void }) {
  const height = Math.max(rows.length * 44 + 40, 160);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 84, bottom: 4, left: 8 }} barCategoryGap="30%">
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={hoursTick} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={132} tick={{ ...AXIS_TICK, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipHours}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="reviewedMinutes" name="Giờ đã duyệt" stackId="capacity" fill={SERIES_COLORS.reviewed} maxBarSize={18} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)} />
        <Bar dataKey="remainingMinutes" name="Năng lực còn lại" stackId="capacity" fill="var(--color-gray-200)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList
            dataKey="utilizationPercent"
            position="right"
            formatter={(value: unknown) => { const parsed = toFiniteNumber(value); return parsed === null ? "Chưa có dữ liệu" : formatPercent(parsed); }}
            style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── 4. Estimate-variance ranking (bars anchored at zero) ────────────────── */

export interface VarianceChartRow {
  id: string;
  label: string;
  varianceMinutes: number;
}

export function VarianceChart({ rows, onSelect }: { rows: VarianceChartRow[]; onSelect?: (id: string) => void }) {
  const height = Math.max(rows.length * 40 + 40, 160);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 8 }} barCategoryGap="35%">
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={hoursTick} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={132} tick={{ ...AXIS_TICK, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: unknown): [string, string] => [labelHoursOrNA(value), "Chênh lệch (thực tế − dự kiến)"]} />
        <ReferenceLine x={0} stroke="var(--color-border-strong)" />
        <Bar dataKey="varianceMinutes" name="Chênh lệch" maxBarSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          {rows.map((row) => (
            <Cell key={row.id} fill={row.varianceMinutes > 0 ? SERIES_COLORS.allocation : SERIES_COLORS.reviewed} />
          ))}
          <LabelList
            dataKey="varianceMinutes"
            position="right"
            formatter={(value: unknown) => {
              const parsed = toFiniteNumber(value);
              return parsed === null ? "" : `${parsed > 0 ? "+" : ""}${formatHours(parsed)}`;
            }}
            style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── 5. Resources: capacity vs allocation vs scheduled vs reviewed ───────── */

export interface ResourceComparisonRow {
  id: string;
  label: string;
  capacityMinutes: number | null;
  allocationMinutes: number;
  scheduledMinutes: number;
  reviewedMinutes: number;
  overbooked: boolean;
}

export function ResourceComparisonChart({ rows, onSelect }: { rows: ResourceComparisonRow[]; onSelect?: (id: string) => void }) {
  const height = Math.max(rows.length * 96 + 48, 200);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }} barCategoryGap="20%">
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={hoursTick} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={132} tick={{ ...AXIS_TICK, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: unknown, name: unknown): [string, string] => [labelHoursOrNA(value), String(name ?? "")]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="capacityMinutes" name="Năng lực khả dụng" fill={SERIES_COLORS.capacity} maxBarSize={10} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="capacityMinutes" position="right" formatter={labelHoursOrNA} style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} />
        </Bar>
        <Bar dataKey="allocationMinutes" name="Kế hoạch phân bổ" fill={SERIES_COLORS.allocation} maxBarSize={10} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="allocationMinutes" position="right" formatter={labelHoursIfPositive} style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} />
        </Bar>
        <Bar dataKey="scheduledMinutes" name="Đã xếp lịch" fill={SERIES_COLORS.scheduled} maxBarSize={10} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="scheduledMinutes" position="right" formatter={labelHoursIfPositive} style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} />
        </Bar>
        <Bar dataKey="reviewedMinutes" name="Giờ đã duyệt" fill={SERIES_COLORS.reviewed} maxBarSize={10} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(entry: any) => entry?.id && onSelect?.(entry.id)}>
          <LabelList dataKey="reviewedMinutes" position="right" formatter={labelHoursIfPositive} style={{ fontSize: 10, fill: "var(--color-foreground)", fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── 6. Project status distribution ──────────────────────────────────────── */

export interface StatusDistributionRow {
  status: string;
  count: number;
}

export function StatusDistributionChart({ rows }: { rows: StatusDistributionRow[] }) {
  const height = Math.max(rows.length * 40 + 24, 140);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }} barCategoryGap="35%">
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
        <YAxis type="category" dataKey="status" width={120} tick={{ ...AXIS_TICK, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: unknown): [string, string] => [`${toFiniteNumber(value) ?? 0} dự án`, "Số lượng"]} />
        <Bar dataKey="count" name="Số dự án" fill={SERIES_COLORS.reviewed} maxBarSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── 7. 100% work-mix bar (billable / non-billable / rework) ─────────────── */

export interface WorkMixSegment {
  label: string;
  minutes: number;
  color: string;
}

export function WorkMixBar({ segments, totalLabel }: { segments: WorkMixSegment[]; totalLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  if (total <= 0) {
    return <p className="text-sm text-muted-foreground">Chưa có giờ đã duyệt trong phạm vi lọc để phân tách loại giờ.</p>;
  }
  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded-lg" role="img" aria-label={`Cơ cấu giờ đã duyệt: ${segments.map((segment) => `${segment.label} ${formatHours(segment.minutes)}`).join(", ")}`}>
        {segments.filter((segment) => segment.minutes > 0).map((segment) => (
          <div
            key={segment.label}
            className="flex items-center justify-center border-r-2 border-card last:border-r-0"
            style={{ width: `${(segment.minutes / total) * 100}%`, backgroundColor: segment.color, minWidth: segment.minutes > 0 ? 8 : 0 }}
          >
            {(segment.minutes / total) >= 0.12 ? (
              <span className="truncate px-1 text-[11px] font-semibold text-white">
                {Math.round((segment.minutes / total) * 100)}%
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} />
            {segment.label}: <strong className="text-foreground">{formatHours(segment.minutes)}</strong>
            {total > 0 ? ` (${Math.round((segment.minutes / total) * 100)}%)` : null}
          </span>
        ))}
        <span className="ml-auto">{totalLabel}</span>
      </div>
    </div>
  );
}
