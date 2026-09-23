"use client";

import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { TS_COLORS, WORK_GROUP_COLORS, formatHours, formatPercent } from "./timesheet-format";
import { WORK_GROUP_LABELS, type WorkGroup } from "./timesheet-types";
import type {
  CycleTimePoint,
  DayBucket,
  FlowDayPoint,
  PersonMonthSummary,
  ProjectSummaryRow,
  WeekBucket,
  WeeklyEffortPerTaskPoint,
  WorkGroupSlice
} from "./timesheet-selectors";

/**
 * Chart layer for /timesheet. Same rules the /analytics charts follow (spec 33
 * §3.10): direct labels carry the critical values, bars start at zero, colors
 * come from semantic CSS tokens, and animations are off so reduced-motion
 * preferences are always respected.
 */

const AXIS_TICK = { fontSize: 11, fill: "var(--color-muted-foreground)" } as const;
const GRID_STROKE = "var(--color-border)";

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-popover-foreground)"
};

const LEGEND_STYLE: React.CSSProperties = { fontSize: 11, paddingTop: 4 };

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const tooltipHours = (value: unknown, name: unknown): [string, string] => [formatHours(toFiniteNumber(value)), String(name ?? "")];
const tooltipPercent = (value: unknown, name: unknown): [string, string] => [formatPercent(toFiniteNumber(value)), String(name ?? "")];

function hoursTick(value: number): string {
  return `${Math.round(value / 60)}h`;
}

/* ── MTS-01 / DTS-01: actual per day vs the 8h/day standard ─────────────── */

export function DailyEffortChart({ data }: { data: DayBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={hoursTick} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipHours} labelFormatter={(label) => `Ngày ${label}`} cursor={{ fill: "var(--color-muted)" }} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar dataKey="actualMinutes" name="Giờ thực tế" fill={TS_COLORS.actual} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={26}>
          {data.map((entry) => (
            <Cell
              key={entry.date}
              fill={!entry.isWorkingDay ? "var(--color-gray-300)" : entry.actualMinutes === 0 ? "var(--color-destructive)" : TS_COLORS.actual}
            />
          ))}
        </Bar>
        <Line
          type="stepAfter"
          dataKey="standardMinutes"
          name="Giờ tiêu chuẩn (8h/ngày)"
          stroke={TS_COLORS.standard}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── MTS-03: hours split by work group ──────────────────────────────────── */

export function WorkGroupDonut({ data }: { data: WorkGroupSlice[] }) {
  const chartData = data.map((slice) => ({
    name: WORK_GROUP_LABELS[slice.workGroup],
    value: slice.minutes,
    percent: slice.percent,
    color: WORK_GROUP_COLORS[slice.workGroup]
  }));
  const total = chartData.reduce((acc, item) => acc + item.value, 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={2}
          isAnimationActive={false}
          stroke="var(--color-card)"
          strokeWidth={2}
        >
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
          <Label
            position="center"
            content={({ viewBox }) => {
              const box = viewBox as { cx?: number; cy?: number } | undefined;
              if (!box?.cx || !box?.cy) return null;
              return (
                <g>
                  <text x={box.cx} y={box.cy - 6} textAnchor="middle" fill="var(--color-foreground)" fontSize={18} fontWeight={700}>
                    {formatHours(total)}
                  </text>
                  <text x={box.cx} y={box.cy + 12} textAnchor="middle" fill="var(--color-muted-foreground)" fontSize={11}>
                    Tổng giờ
                  </text>
                </g>
              );
            }}
          />
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipHours} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ── MTS-04: actual vs standard per person ──────────────────────────────── */

export function ComplianceChart({ data }: { data: PersonMonthSummary[] }) {
  const chartData = data.map((row) => ({
    name: row.person.name,
    actualMinutes: row.actualMinutes,
    standardMinutes: row.standardMinutes,
    completionPercent: row.completionPercent
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} layout="vertical" margin={{ top: 8, right: 44, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={hoursTick} />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={140} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipHours} cursor={{ fill: "var(--color-muted)" }} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar dataKey="standardMinutes" name="Giờ tiêu chuẩn" fill="var(--color-gray-300)" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={16} />
        <Bar dataKey="actualMinutes" name="Giờ thực tế" fill={TS_COLORS.actual} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={16}>
          {chartData.map((entry) => (
            <Cell
              key={entry.name}
              fill={entry.completionPercent >= 90 ? TS_COLORS.billable : entry.completionPercent >= 70 ? TS_COLORS.pending : TS_COLORS.over}
            />
          ))}
          <LabelList
            dataKey="completionPercent"
            position="right"
            formatter={(value: unknown) => formatPercent(toFiniteNumber(value))}
            style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontWeight: 600 }}
          />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── PTS-04: estimate vs actual per project ─────────────────────────────── */

export function EstimateVsActualChart({ data }: { data: ProjectSummaryRow[] }) {
  const chartData = data.map((row) => ({
    name: row.project.code,
    fullName: row.project.name,
    estimateMinutes: row.estimateMinutes,
    actualMinutes: row.actualMinutes,
    consumptionPercent: row.consumptionPercent
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={hoursTick} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipHours}
          labelFormatter={(label) => chartData.find((row) => row.name === label)?.fullName ?? String(label)}
          cursor={{ fill: "var(--color-muted)" }}
        />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar dataKey="estimateMinutes" name="Estimate đã nhập" fill={TS_COLORS.estimate} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={28} />
        {/* `fill` also drives the legend swatch; per-bar overrides come from Cell. */}
        <Bar dataKey="actualMinutes" name="Giờ thực tế" fill={TS_COLORS.actual} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={28}>
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={entry.consumptionPercent > 100 ? TS_COLORS.over : TS_COLORS.actual} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── PTS-04: consumption % with the 100% overrun threshold ──────────────── */

export function ConsumptionChart({ data }: { data: ProjectSummaryRow[] }) {
  const chartData = data.map((row) => ({
    name: row.project.code,
    fullName: row.project.name,
    consumptionPercent: Math.round(row.consumptionPercent * 10) / 10,
    coverage: row.estimateCoveragePercent
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 52, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}%`} />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={78} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipPercent}
          labelFormatter={(label) => chartData.find((row) => row.name === label)?.fullName ?? String(label)}
          cursor={{ fill: "var(--color-muted)" }}
        />
        <ReferenceLine x={100} stroke={TS_COLORS.over} strokeDasharray="4 4" ifOverflow="extendDomain" />
        <Bar dataKey="consumptionPercent" name="Đã dùng / Estimate" fill={TS_COLORS.actual} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}>
          {chartData.map((entry) => (
            <Cell
              key={entry.name}
              fill={entry.consumptionPercent > 100 ? TS_COLORS.over : entry.consumptionPercent > 85 ? TS_COLORS.pending : TS_COLORS.actual}
            />
          ))}
          <LabelList
            dataKey="consumptionPercent"
            position="right"
            formatter={(value: unknown) => formatPercent(toFiniteNumber(value))}
            style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── WTS-01: weekly rollup vs standard ──────────────────────────────────── */

export function WeeklyComplianceChart({ data }: { data: WeekBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={hoursTick} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipHours} cursor={{ fill: "var(--color-muted)" }} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar dataKey="actualMinutes" name="Giờ thực tế" fill={TS_COLORS.actual} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={44}>
          <LabelList
            dataKey="compliancePercent"
            position="top"
            formatter={(value: unknown) => formatPercent(toFiniteNumber(value))}
            style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontWeight: 600 }}
          />
        </Bar>
        <Line
          type="monotone"
          dataKey="standardMinutes"
          name="Giờ tiêu chuẩn"
          stroke={TS_COLORS.standard}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── Weekly planned vs actual effort per task (resource matching) ────────── */

/**
 * Two lines on the same denominator — the tasks worked on that week that carry
 * an estimate — so "kế hoạch / công việc" and "thực tế / công việc" are directly
 * comparable. The bar behind them is the task count, shown because an average
 * over 3 tasks and an average over 40 tasks must not read the same.
 *
 * The gap between the lines IS the resource-matching signal: lines converging
 * means effort per task matches the plan; the actual line pulling above means
 * each task is eating more people-hours than budgeted.
 */
export function PlannedVsActualPerTaskChart({ data }: { data: WeeklyEffortPerTaskPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 20, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
        <YAxis
          yAxisId="hours"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={hoursTick}
          width={44}
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={36}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "var(--color-muted)" }}
          formatter={(value: unknown, name: unknown) =>
            String(name).startsWith("Số công việc")
              ? [`${toFiniteNumber(value) ?? 0}`, String(name)]
              : [formatHours(toFiniteNumber(value)), String(name)]
          }
        />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar
          yAxisId="count"
          dataKey="taskCount"
          name="Số công việc có kế hoạch"
          fill="var(--color-gray-200)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
          maxBarSize={40}
        />
        <Line
          yAxisId="hours"
          type="monotone"
          dataKey="plannedMinutesPerTask"
          name="Giờ kế hoạch / công việc"
          stroke={TS_COLORS.standard}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          yAxisId="hours"
          type="monotone"
          dataKey="actualMinutesPerTask"
          name="Giờ thực tế / công việc"
          stroke={TS_COLORS.actual}
          strokeWidth={2.5}
          dot={{ r: 3.5 }}
          connectNulls
          isAnimationActive={false}
        >
          <LabelList
            dataKey="matchPercent"
            position="top"
            formatter={(value: unknown) => {
              const parsed = toFiniteNumber(value);
              return parsed === null ? "" : formatPercent(parsed);
            }}
            style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontWeight: 600 }}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── MTS-02: hours per project for the selected scope ───────────────────── */

export function ProjectHoursChart({ data }: { data: Array<{ code: string; name: string; actualMinutes: number; workGroup: WorkGroup }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 56, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={hoursTick} />
        <YAxis type="category" dataKey="code" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={78} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipHours}
          labelFormatter={(label) => data.find((row) => row.code === label)?.name ?? String(label)}
          cursor={{ fill: "var(--color-muted)" }}
        />
        <Bar dataKey="actualMinutes" name="Giờ thực tế" fill={TS_COLORS.actual} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}>
          {data.map((entry) => (
            <Cell key={entry.code} fill={WORK_GROUP_COLORS[entry.workGroup]} />
          ))}
          <LabelList
            dataKey="actualMinutes"
            position="right"
            formatter={(value: unknown) => formatHours(toFiniteNumber(value))}
            style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Cumulative flow diagram ────────────────────────────────────────────── */

const FLOW_BANDS = [
  { key: "completed", name: "Hoàn thành", color: "var(--color-success)" },
  { key: "blocked", name: "Đang chặn", color: "var(--color-destructive)" },
  { key: "in_progress", name: "Đang làm", color: "var(--color-chart-1)" },
  { key: "not_started", name: "Chưa bắt đầu", color: "var(--color-gray-300)" }
] as const;

/**
 * Stacked areas, done at the bottom: total height = everything created so far,
 * each band's thickness = the work sitting in that state, and the slope of the
 * `completed` band = throughput. A band that stays thick across the month is
 * the bottleneck.
 */
export function CumulativeFlowChart({ data }: { data: FlowDayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: "var(--color-border)" }}
          formatter={(value: unknown, name: unknown) => [`${toFiniteNumber(value) ?? 0} công việc`, String(name ?? "")]}
          labelFormatter={(label) => `Ngày ${label}`}
        />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {FLOW_BANDS.map((band) => (
          <Area
            key={band.key}
            type="monotone"
            dataKey={band.key}
            name={band.name}
            stackId="flow"
            stroke={band.color}
            fill={band.color}
            fillOpacity={0.75}
            strokeWidth={1}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Cycle-time control chart ───────────────────────────────────────────── */

/**
 * One dot per completed item: x = completion day, y = cycle time in days.
 * Solid line = rolling average of the last 5 completions; dashed lines = mean
 * and the upper control limit at mean + 2σ. Dots above the limit are the ones
 * worth investigating — the average never is.
 */
export function CycleTimeControlChart({
  data,
  mean,
  upperLimit,
  startDate
}: {
  data: CycleTimePoint[];
  mean: number;
  upperLimit: number;
  /** First day of the range — `x` is the day offset from it. */
  startDate: string;
}) {
  // A numeric time axis, not a category axis: several items finish on the same
  // day, and a category axis repeats that date once per item while also spacing
  // the dots evenly instead of by when they actually happened.
  const dayLabel = (offset: number) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          type="number"
          dataKey="x"
          domain={["dataMin - 1", "dataMax + 1"]}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
          minTickGap={28}
          tickFormatter={(value: number) => dayLabel(value)}
        />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(value: number) => `${value}n`} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: "var(--color-border)" }}
          formatter={(value: unknown, name: unknown) => [`${toFiniteNumber(value) ?? 0} ngày`, String(name ?? "")]}
          labelFormatter={(label) => `Hoàn thành ngày ${dayLabel(Number(label))}`}
        />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <ReferenceLine
          y={upperLimit}
          stroke={TS_COLORS.over}
          strokeDasharray="5 4"
          ifOverflow="extendDomain"
          label={{ value: `Giới hạn trên ${upperLimit}n`, position: "insideTopRight", fontSize: 10, fill: "var(--color-destructive)" }}
        />
        <ReferenceLine
          y={mean}
          stroke={TS_COLORS.standard}
          strokeDasharray="4 4"
          label={{ value: `TB ${mean}n`, position: "insideBottomRight", fontSize: 10, fill: "var(--color-muted-foreground)" }}
        />
        <Scatter dataKey="cycleDays" name="Thời gian hoàn thành mỗi việc" isAnimationActive={false}>
          {data.map((point) => (
            <Cell key={point.taskId} fill={point.outlier ? TS_COLORS.over : TS_COLORS.actual} />
          ))}
        </Scatter>
        <Line
          type="monotone"
          dataKey="rollingAverage"
          name="Trung bình trượt (5 việc)"
          stroke={TS_COLORS.accent}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── PTS-05: readiness score per project ────────────────────────────────── */

export function ReadinessChart({ data }: { data: Array<{ code: string; name: string; score: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}%`} />
        <YAxis type="category" dataKey="code" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={78} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipPercent}
          labelFormatter={(label) => data.find((row) => row.code === label)?.name ?? String(label)}
          cursor={{ fill: "var(--color-muted)" }}
        />
        <Bar dataKey="score" name="Điểm sẵn sàng dữ liệu" fill={TS_COLORS.actual} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}>
          {data.map((entry) => (
            <Cell
              key={entry.code}
              fill={entry.score >= 80 ? TS_COLORS.billable : entry.score >= 55 ? TS_COLORS.pending : TS_COLORS.over}
            />
          ))}
          <LabelList
            dataKey="score"
            position="right"
            formatter={(value: unknown) => `${toFiniteNumber(value) ?? 0}%`}
            style={{ fontSize: 10.5, fill: "var(--color-muted-foreground)", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
