"use client";

import React from "react";
import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { WORK_GROUP_COLORS, formatHours } from "./timesheet-format";
import { WORK_GROUP_LABELS } from "./timesheet-types";
import type { WorkGroupSlice } from "./timesheet-selectors";

/**
 * Chart layer for /timesheet. Same rules the /analytics charts follow (spec 33
 * §3.10): direct labels carry the critical values, bars start at zero, colors
 * come from semantic CSS tokens, and animations are off so reduced-motion
 * preferences are always respected.
 */

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

/* ── MTS-03: hours split by work group ──────────────────────────────────── */

export function WorkGroupDonut({ data, compact = false }: { data: WorkGroupSlice[]; compact?: boolean }) {
  const chartData = data.map((slice) => ({
    name: WORK_GROUP_LABELS[slice.workGroup],
    value: slice.minutes,
    percent: slice.percent,
    color: WORK_GROUP_COLORS[slice.workGroup]
  }));
  const total = chartData.reduce((acc, item) => acc + item.value, 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={compact ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 8, right: 8, bottom: 8, left: 8 }}>
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
          {compact ? null : <Label
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
          />}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipHours} />
        {compact
          ? <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
          : <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />}
      </PieChart>
    </ResponsiveContainer>
  );
}
