"use client";
import { formatVnd } from "@/lib/currency";
import { MoneyAmount } from "@/components/money-amount";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AccountsResponse,
  CapacitySummaryItem,
  CapacitySummaryResponse,
  LeadSummary,
  OpportunitySummary,
  ProjectPlSummaryItem,
  ProjectPlSummaryResponse,
  ProcessMetricsResponse,
  ResourceAllocationStatus,
  ResourceListResponse,
  SalesOwnerSummary,
  SalesTargetSummary,
  SalesTargetsResponse,
} from "@b2b-crm/contracts";
import { useOpportunityWorkbench } from "../sales-pipeline/use-opportunity-workbench";
import { OpportunityTable } from "../sales-pipeline/opportunity-table";
import { OpportunityDrawers } from "../sales-pipeline/opportunity-drawers";
import {
  SalesActionPanel,
  ProcessMetricsPanel,
  formatCompactVnd,
  PolicyPanel,
  FinancePanel
} from "./panels";
import { stageOptions } from "../sales-pipeline/constants";
import { formatStageLabel } from "../sales-pipeline/utils";
import { ShopifyModal } from "../shopify-modal";
import { ShopifyBanner, ShopifyDataTable, ShopifyIcon } from "../shopify-ui";

type SalesTimeRange = "all" | "month" | "quarter" | "year";

const salesTimeRangeLabels: Record<SalesTimeRange, string> = {
  all: "Tất cả thời gian",
  month: "Tháng này",
  quarter: "Quý này",
  year: "Năm nay"
};

type SalesStageChartDatum = {
  amount: number;
  count: number;
  fill: string;
  index: number;
  label: string;
  probability: number;
  stage: string;
  weighted: number;
};

type SalesOwnerChartDatum = {
  amount: number;
  count: number;
  fill: string;
  name: string;
  rank: number;
  weighted: number;
};

type ChartTooltipPayload<T> = {
  payload?: T;
};

type ChartTooltipProps<T> = {
  active?: boolean;
  payload?: ChartTooltipPayload<T>[];
};

const salesChartPalette = [
  "#2563eb",
  "#0891b2",
  "#10b981",
  "#f59e0b",
  "#ef4444"
];

// ─── Sales Pipeline Stage Workbench ──────────────────────────────────────────
interface PipelineFunnelChartProps {
  opportunities: OpportunitySummary[];
  isPipelineRestricted: boolean;
  selectedStage: string | null;
  onSelectStage: (stage: string | null) => void;
}

function PipelineFunnelChart({
  opportunities,
  isPipelineRestricted,
  selectedStage,
  onSelectStage,
}: PipelineFunnelChartProps) {
  const maxStageAmount = Math.max(
    1,
    ...stageOptions.map((stage) => (
      opportunities
        .filter((o) => o.stage === stage)
        .reduce((sum, o) => sum + (o.amount ?? 0), 0)
    ))
  );

  const stageStats = stageOptions.map((stage, index) => {
    const stageItems = opportunities.filter((o) => o.stage === stage);
    const count = stageItems.length;
    const amount = stageItems.reduce((s, o) => s + (o.amount ?? 0), 0);
    const probability = count
      ? Math.round(stageItems.reduce((s, o) => s + o.probability, 0) / count)
      : 0;

    return {
      amount,
      count,
      index: index + 1,
      label: formatStageLabel(stage),
      probability,
      stage,
    };
  });

  const selectedStat = selectedStage ? stageStats.find((item) => item.stage === selectedStage) : null;
  const activePipeline = opportunities.filter((item) => item.stage !== "won" && item.stage !== "lost").length;

  return (
    <div className="sales-stage-workbench">
      <div className="sales-stage-grid" aria-label="Phân bổ cơ hội theo giai đoạn">
        {stageStats.map((stat) => {
          const isSelected = selectedStage === stat.stage;
          const hasDeals = stat.count > 0;
          const isTerminal = stat.stage === "won" || stat.stage === "lost";
          const progress = Math.max(3, Math.round((stat.amount / maxStageAmount) * 100));

          return (
            <button
              aria-pressed={isSelected}
              className={`sales-stage-card${isSelected ? " is-selected" : ""}${!hasDeals ? " is-empty" : ""}${isTerminal ? " is-terminal" : ""}`}
              disabled={!hasDeals}
              key={stat.stage}
              onClick={() => onSelectStage(isSelected ? null : stat.stage)}
              type="button"
            >
              <span className="sales-stage-topline">
                <span className="sales-stage-index">{stat.index}</span>
                <span className="sales-stage-label">{stat.label}</span>
              </span>
              <span className="sales-stage-meta">
                <strong>{stat.count}</strong>
                <span>cơ hội</span>
              </span>
              <span className="sales-stage-value">
                {isPipelineRestricted || stat.amount === 0 ? "Chưa có giá trị" : <MoneyAmount value={stat.amount} />}
              </span>
              <span className="sales-stage-bar" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      <aside className="sales-stage-insight" aria-label="Tín hiệu phễu cơ hội">
        <span className="sales-stage-insight-icon">
          <ShopifyIcon name={selectedStat ? "target" : "spark"} size={18} />
        </span>
        <div>
          <p className="dashboard-eyebrow">{selectedStat ? "Đang lọc giai đoạn" : "Tín hiệu bán hàng"}</p>
          <h3>{selectedStat ? selectedStat.label : "Cơ hội có trọng tâm"}</h3>
          <p>
            {selectedStat
              ? <>{selectedStat.count} cơ hội ở giai đoạn này{isPipelineRestricted ? "." : <>, tổng giá trị <MoneyAmount value={selectedStat.amount} />.</>}</>
              : `${activePipeline} cơ hội đang mở. Bấm vào một giai đoạn để lọc danh sách bên dưới.`}
          </p>
          {selectedStat ? (
            <div className="dashboard-chip-row">
              <DashboardChip tone={selectedStat.stage === "lost" ? "danger" : selectedStat.stage === "won" ? "success" : "info"}>
                Xác suất trung bình {selectedStat.probability}%
              </DashboardChip>
              <button className="sales-clear-filter" onClick={() => onSelectStage(null)} type="button">
                Bỏ lọc
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function getSalesStageChartData(opportunities: OpportunitySummary[]) {
  return stageOptions.map((stage, index) => {
    const stageItems = opportunities.filter((opportunity) => opportunity.stage === stage);
    const amount = stageItems.reduce((sum, opportunity) => sum + (opportunity.amount ?? 0), 0);
    const weighted = stageItems.reduce(
      (sum, opportunity) => sum + (opportunity.weightedForecast ?? Math.round(((opportunity.amount ?? 0) * opportunity.probability) / 100)),
      0
    );
    const probability = stageItems.length
      ? Math.round(stageItems.reduce((sum, opportunity) => sum + opportunity.probability, 0) / stageItems.length)
      : 0;

    return {
      amount,
      count: stageItems.length,
      fill: stage === "lost" ? "#ef4444" : stage === "won" ? "#10b981" : salesChartPalette[index % 4],
      index: index + 1,
      label: formatStageLabel(stage),
      probability,
      stage,
      weighted,
    };
  });
}

function StageChartTooltip({ active, payload }: ChartTooltipProps<SalesStageChartDatum>) {
  if (!active || !payload?.[0]?.payload) {
    return null;
  }

  const item = payload[0].payload;

  return (
    <div className="sales-chart-tooltip">
      <span>Giai đoạn {item.index}</span>
      <strong>{item.label}</strong>
      <dl>
        <div>
          <dt>Cơ hội</dt>
          <dd>{item.count}</dd>
        </div>
        <div>
          <dt>Giá trị</dt>
          <dd>{formatVnd(item.amount)}</dd>
        </div>
        <div>
          <dt>Dự báo</dt>
          <dd>{formatVnd(item.weighted)}</dd>
        </div>
        <div>
          <dt>Xác suất TB</dt>
          <dd>{item.probability}%</dd>
        </div>
      </dl>
    </div>
  );
}

function OwnerChartTooltip({ active, payload }: ChartTooltipProps<SalesOwnerChartDatum>) {
  if (!active || !payload?.[0]?.payload) {
    return null;
  }

  const item = payload[0].payload;

  return (
    <div className="sales-chart-tooltip">
      <span>Owner #{item.rank}</span>
      <strong>{item.name}</strong>
      <dl>
        <div>
          <dt>Deal</dt>
          <dd>{item.count}</dd>
        </div>
        <div>
          <dt>Giá trị</dt>
          <dd>{formatVnd(item.amount)}</dd>
        </div>
        <div>
          <dt>Dự báo</dt>
          <dd>{formatVnd(item.weighted)}</dd>
        </div>
      </dl>
    </div>
  );
}

function SalesStageDistributionChart({
  opportunities,
  isPipelineRestricted,
  selectedStage,
  onSelectStage,
}: PipelineFunnelChartProps) {
  const stageStats = getSalesStageChartData(opportunities);
  const hasValue = stageStats.some((item) => item.amount > 0);
  const dataKey = hasValue && !isPipelineRestricted ? "amount" : "count";

  return (
    <div className="sales-stage-chart-shell" aria-label="Biểu đồ phân bổ cơ hội theo giai đoạn">
      <ResponsiveContainer height={420} width="100%">
        <BarChart
          data={stageStats}
          layout="vertical"
          margin={{ top: 8, right: 22, bottom: 8, left: 18 }}
        >
          <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis
            axisLine={false}
            dataKey={dataKey}
            tickFormatter={(value: number) => (dataKey === "amount" ? formatCompactVnd(value) : `${value}`)}
            tickLine={false}
            type="number"
          />
          <YAxis
            axisLine={false}
            dataKey="label"
            tickLine={false}
            tickMargin={10}
            type="category"
            width={132}
          />
          <Tooltip content={<StageChartTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.08)", radius: 8 }} />
          <Bar
            dataKey={dataKey}
            minPointSize={4}
            onClick={(entry) => {
              const item = (entry as { payload?: SalesStageChartDatum }).payload;
              if (!item || item.count === 0) {
                return;
              }
              onSelectStage(selectedStage === item.stage ? null : item.stage);
            }}
            radius={[0, 9, 9, 0]}
          >
            {stageStats.map((entry) => (
              <Cell
                cursor={entry.count > 0 ? "pointer" : "not-allowed"}
                fill={selectedStage && selectedStage !== entry.stage ? "rgba(148, 163, 184, 0.32)" : entry.count > 0 ? entry.fill : "#cbd5e1"}
                key={entry.stage}
                stroke={selectedStage === entry.stage ? "#0f172a" : "transparent"}
                strokeWidth={selectedStage === entry.stage ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="sales-stage-chart-footer">
        <span>{dataKey === "amount" ? "Độ dài thanh theo giá trị deal" : "Độ dài thanh theo số cơ hội"}</span>
        {selectedStage ? (
          <button className="sales-clear-filter" onClick={() => onSelectStage(null)} type="button">
            Bỏ lọc {formatStageLabel(selectedStage)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SalesTargetPanel({
  target,
  targetMeta,
  weighted,
  visible,
  openCount,
}: {
  target: number;
  targetMeta: SalesTargetSummary;
  weighted: number;
  visible: number;
  openCount: number;
}) {
  const targetHealth = getTargetHealth(weighted, target);
  const targetChartMax = Math.ceil(Math.max(target, visible, weighted, 1) * 1.08);
  const targetBarColor = targetHealth.tone === "success" ? "#10b981" : targetHealth.tone === "warning" ? "#f59e0b" : "#ef4444";
  const targetChartData = [
    { fill: targetBarColor, label: "Dự báo", value: weighted },
    { fill: "rgba(37, 99, 235, 0.24)", label: "Giá trị thô", value: visible },
  ];

  return (
    <article className={`sales-target-card tone-${targetHealth.tone}`}>
      <header className="sales-target-header">
        <div className="sales-target-copy">
          <p className="dashboard-eyebrow">So với target</p>
          <h3>{targetHealth.percent}%</h3>
        </div>
        <DashboardChip tone={targetHealth.tone}>{targetHealth.label}</DashboardChip>
      </header>
      <div className="sales-target-meter" aria-label={`Đạt ${targetHealth.percent}% target`}>
        <div className="sales-target-rechart">
          <ResponsiveContainer height={64} width="100%">
            <BarChart
              barCategoryGap={10}
              data={targetChartData}
              layout="vertical"
              margin={{ top: 6, right: 12, bottom: 6, left: 12 }}
            >
              <XAxis axisLine={false} domain={[0, targetChartMax]} hide tick={false} tickLine={false} type="number" />
              <YAxis axisLine={false} dataKey="label" hide tick={false} tickLine={false} type="category" />
              <Bar dataKey="value" isAnimationActive={false} radius={[0, 8, 8, 0]} barSize={14}>
                {targetChartData.map((entry) => (
                  <Cell fill={entry.fill} key={entry.label} />
                ))}
              </Bar>
              <ReferenceLine ifOverflow="extendDomain" stroke="rgba(15, 23, 42, 0.4)" strokeDasharray="3 3" x={target} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="sales-target-readout">
          <span>
            <b>Dự báo</b>
            <strong><MoneyAmount value={weighted} /></strong>
          </span>
          <span>
            <b>Giá trị thô</b>
            <strong><MoneyAmount value={visible} /></strong>
          </span>
        </div>
        <div className="sales-target-footer">
          <div className="dashboard-chip-row">
            <DashboardChip tone="info">{openCount} cơ hội mở</DashboardChip>
            <DashboardChip tone="success">{formatSalesTargetScope(targetMeta)}</DashboardChip>
          </div>
        </div>
      </div>
    </article>
  );
}

function SalesOwnerLeaderboard({
  owners,
}: {
  owners: ReturnType<typeof getOwnerAnalytics>["owners"];
}) {
  const data: SalesOwnerChartDatum[] = owners.slice(0, 5).map((owner, index) => ({
    amount: owner.amount,
    count: owner.count,
    fill: salesChartPalette[index % salesChartPalette.length],
    name: owner.name,
    rank: index + 1,
    weighted: owner.weighted,
  }));

  return (
    <div className="sales-owner-chart" aria-label="Xếp hạng người giữ deal">
      {data.length > 0 ? (
        <ResponsiveContainer height={230} width="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 6, right: 18, bottom: 6, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis axisLine={false} tickFormatter={(value: number) => formatCompactVnd(value)} tickLine={false} type="number" />
            <YAxis axisLine={false} dataKey="name" tickLine={false} tickMargin={8} type="category" width={112} />
            <Tooltip content={<OwnerChartTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.08)", radius: 8 }} />
            <Bar dataKey="amount" radius={[0, 9, 9, 0]}>
              {data.map((entry) => (
                <Cell fill={entry.fill} key={entry.name} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="sales-chart-empty">Chưa có owner giữ deal trong kỳ xem.</div>
      )}
    </div>
  );
}

// ─── Interfaces for interactive states backed by production summaries ─────────
type AllocationStatus = ResourceAllocationStatus | "blocked" | "completed";

interface Consultant {
  avatarUrl?: string;
  capacityMinutesByWeek: Record<string, number>;
  departmentCode?: string;
  email?: string;
  id: string;
  larkOpenId?: string;
  larkTenantKey?: string;
  name: string;
  role: string;
  skills: string[];
  allocations: {
    week: string;
    project: string;
    days: number;
    status: AllocationStatus;
  }[];
}

interface TimeEntry {
  id: string;
  consultant: string;
  project: string;
  stage: string;
  hours: number;
  workType: string;
  billable: boolean;
  note: string;
  status: "draft" | "submitted" | "approved" | "rejected";
}

interface ProjectPL {
  accountName?: string;
  id: string;
  name: string;
  revenueBasis: number;
  plannedHours: number;
  actualHours: number;
  costRate: number;
  externalCost: number;
  targetMargin: number;
  state: "On Plan" | "Margin Watch" | "Margin Risk" | "Over Budget" | "Needs Reforecast";
}

type OverviewActionModalMode = "command" | "lead" | "allocation" | "timesheet" | "pipeline" | "capacity" | "approval" | "pl";

type OverviewAllocationChartDatum = {
  allocated: number;
  available: number;
  capacity: number;
  dateLabel: string;
  fill: string;
  label: string;
  loadPct: number;
  status: string;
  tone: "info" | "success" | "warning" | "danger";
  weekCode: string;
};

function DashboardChip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return <span className={`dashboard-chip tone-${tone}`}>{children}</span>;
}

function DashboardMetricCard({
  icon,
  tone,
  label,
  value,
  detail,
  chips
}: {
  icon: React.ComponentProps<typeof ShopifyIcon>["name"];
  tone: "sales" | "delivery" | "finance" | "warning";
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  chips?: React.ReactNode;
}) {
  return (
    <article className={`dashboard-metric-card tone-${tone}`}>
      <div className="dashboard-metric-heading">
        <span className="dashboard-metric-icon">
          <ShopifyIcon name={icon} size={17} />
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
      {chips ? <div className="dashboard-chip-row">{chips}</div> : null}
    </article>
  );
}

interface DashboardWeekWindow {
  end: string;
  label: string;
  start: string;
}

const minutesPerDay = 480;
const financeMarginTarget = 50;

function createDashboardWeekWindows(now = new Date()): DashboardWeekWindow[] {
  const start = startOfDashboardWeek(now);

  return Array.from({ length: 4 }, (_, index) => {
    const weekStart = addDashboardDays(start, index * 7);
    const weekEnd = addDashboardDays(weekStart, 7);
    return {
      start: toDashboardDateParam(weekStart),
      end: toDashboardDateParam(weekEnd),
      label: `W${dashboardWeekNumber(weekStart)} (${String(weekStart.getDate()).padStart(2, "0")}/${String(weekStart.getMonth() + 1).padStart(2, "0")})`
    };
  });
}

function startOfDashboardWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return date;
}

function addDashboardDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function toDashboardDateParam(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dashboardWeekNumber(value: Date) {
  const firstDay = new Date(value.getFullYear(), 0, 1);
  const days = Math.floor((value.getTime() - firstDay.getTime()) / 86_400_000);
  return Math.max(1, Math.ceil((days + firstDay.getDay() + 1) / 7));
}

function getSalesRangeStart(range: SalesTimeRange, now = new Date()) {
  if (range === "all") {
    return null;
  }

  if (range === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  if (range === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return new Date(now.getFullYear(), quarterStartMonth, 1);
  }

  return new Date(now.getFullYear(), 0, 1);
}

function parseDateSafe(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getOpportunityTimelineDate(opportunity: OpportunitySummary) {
  return parseDateSafe(opportunity.closedAt ?? opportunity.stageEnteredAt);
}

function filterOpportunitiesByRange(opportunities: OpportunitySummary[], range: SalesTimeRange) {
  const start = getSalesRangeStart(range);
  if (!start) {
    return opportunities;
  }

  return opportunities.filter((opportunity) => {
    const date = getOpportunityTimelineDate(opportunity);
    return !date || date >= start;
  });
}

function getOwnerName(opportunity: OpportunitySummary) {
  return opportunity.ownerDisplayName?.trim() || "Chưa phân công";
}

function getOwnerAnalytics(opportunities: OpportunitySummary[]) {
  const ownerMap = new Map<string, { name: string; count: number; amount: number; weighted: number }>();

  opportunities.forEach((opportunity) => {
    const name = getOwnerName(opportunity);
    const current = ownerMap.get(name) ?? { name, count: 0, amount: 0, weighted: 0 };
    current.count += 1;
    current.amount += opportunity.amount ?? 0;
    current.weighted += opportunity.weightedForecast ?? Math.round(((opportunity.amount ?? 0) * opportunity.probability) / 100);
    ownerMap.set(name, current);
  });

  const owners = [...ownerMap.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);

  return {
    owners,
    topByValue: owners[0],
    topByCount: [...ownerMap.values()].sort((a, b) => b.count - a.count || b.amount - a.amount)[0],
  };
}

function getTargetHealth(weightedForecast: number, target: number) {
  if (target <= 0) {
    return { percent: 0, tone: "warning" as const, label: "Chưa có target", detail: "Cần đặt target để so sánh pipeline." };
  }

  const percent = Math.round((weightedForecast / target) * 100);

  if (percent >= 100) {
    return { percent, tone: "success" as const, label: "Đủ target", detail: "Dự báo có trọng số đang đáp ứng target kỳ này." };
  }

  if (percent >= 75) {
    return { percent, tone: "warning" as const, label: "Gần đạt", detail: "Cần chốt thêm hoặc tăng xác suất thắng để chắc target." };
  }

  return { percent, tone: "danger" as const, label: "Thiếu phễu", detail: "Phễu hiện tại chưa đủ chắc để đáp ứng target." };
}

function getSalesTargetForRange(targets: SalesTargetsResponse, range: SalesTimeRange) {
  const companyTargets = targets.data.filter((target) => target.scopeType === "company");
  return (
    companyTargets.find((target) => target.period === range) ??
    companyTargets.find((target) => target.period === "quarter") ??
    companyTargets[0] ??
    {
      id: "sales-target-empty",
      period: range,
      scopeType: "company",
      amount: 0,
      currency: "VND",
      source: "config"
    }
  );
}

function formatSalesTargetScope(target: SalesTargetSummary) {
  if (target.scopeType === "owner") {
    return target.ownerDisplayName ? `Theo owner: ${target.ownerDisplayName}` : "Theo owner";
  }

  if (target.scopeType === "team") {
    return target.ownerTeamName ? `Theo team: ${target.ownerTeamName}` : "Theo team";
  }

  return "Target công ty";
}

function formatDateRangeLabel(range: SalesTimeRange) {
  const start = getSalesRangeStart(range);
  if (!start) {
    return "Không giới hạn thời gian";
  }

  return `Từ ${start.toLocaleDateString("vi-VN")}`;
}

function DashboardQuickAction({
  icon,
  label,
  detail,
  primary,
  onClick
}: {
  icon: React.ComponentProps<typeof ShopifyIcon>["name"];
  label: string;
  detail: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`dashboard-quick-action${primary ? " primary" : ""}`} onClick={onClick} type="button">
      <span className="dashboard-quick-icon">
        <ShopifyIcon name={icon} size={16} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <ShopifyIcon name="chevron-right" size={15} />
    </button>
  );
}

function getAllocationTone(loadPct: number): OverviewAllocationChartDatum["tone"] {
  if (loadPct > 100) {
    return "danger";
  }

  if (loadPct >= 85) {
    return "warning";
  }

  if (loadPct >= 65) {
    return "success";
  }

  return "info";
}

function getAllocationStatus(loadPct: number) {
  if (loadPct > 100) {
    return "Quá tải";
  }

  if (loadPct >= 85) {
    return "Cần rà soát";
  }

  if (loadPct >= 65) {
    return "Đúng tải";
  }

  return "Còn tải";
}

function getAllocationFill(tone: OverviewAllocationChartDatum["tone"]) {
  if (tone === "danger") {
    return "#ef4444";
  }

  if (tone === "warning") {
    return "#f59e0b";
  }

  if (tone === "success") {
    return "#10b981";
  }

  return "#2563eb";
}

function parseAllocationWeekLabel(label: string) {
  const match = label.match(/^([^(]+)\s*\(([^)]+)\)$/);
  return {
    dateLabel: match?.[2] ?? "",
    weekCode: (match?.[1] ?? label).trim()
  };
}

function getWeeklyAllocationChartData(consultants: Consultant[]): OverviewAllocationChartDatum[] {
  const weekMap = new Map<string, number>();
  const capacityMap = new Map<string, number>();

  consultants.forEach((consultant) => {
    Object.entries(consultant.capacityMinutesByWeek).forEach(([week, minutes]) => {
      capacityMap.set(week, (capacityMap.get(week) ?? 0) + minutes / minutesPerDay);
    });

    consultant.allocations.forEach((allocation) => {
      if (["released", "completed", "cancelled"].includes(allocation.status)) {
        return;
      }

      weekMap.set(allocation.week, (weekMap.get(allocation.week) ?? 0) + allocation.days);
    });
  });

  const weeks = new Set([...capacityMap.keys(), ...weekMap.keys()]);
  const bars = [...weeks]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ label, value: weekMap.get(label) ?? 0, capacity: capacityMap.get(label) ?? consultants.length * 5 }));

  return bars.map((bar) => {
    const loadPct = bar.capacity > 0 ? Math.round((bar.value / bar.capacity) * 100) : 0;
    const tone = getAllocationTone(loadPct);

    return {
      allocated: bar.value,
      available: Math.max(bar.capacity - bar.value, 0),
      capacity: bar.capacity,
      fill: getAllocationFill(tone),
      label: bar.label,
      loadPct,
      status: getAllocationStatus(loadPct),
      tone,
      ...parseAllocationWeekLabel(bar.label)
    };
  });
}

function OverviewAllocationTooltip({ active, payload }: ChartTooltipProps<OverviewAllocationChartDatum>) {
  if (!active || !payload?.[0]?.payload) {
    return null;
  }

  const item = payload[0].payload;

  return (
    <div className="sales-chart-tooltip overview-chart-tooltip">
      <span>{item.weekCode} {item.dateLabel ? `(${item.dateLabel})` : ""}</span>
      <strong>{item.allocated}d đã giữ</strong>
      <dl>
        <div>
          <dt>Năng lực</dt>
          <dd>{item.capacity}d</dd>
        </div>
        <div>
          <dt>Còn lại</dt>
          <dd>{item.available}d</dd>
        </div>
        <div>
          <dt>Tải</dt>
          <dd>{item.loadPct}%</dd>
        </div>
        <div>
          <dt>Trạng thái</dt>
          <dd>{item.status}</dd>
        </div>
      </dl>
    </div>
  );
}

function OverviewActivityItem({
  icon,
  title,
  detail,
  tone,
  time
}: {
  icon: React.ComponentProps<typeof ShopifyIcon>["name"];
  title: string;
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
  time: string;
}) {
  return (
    <li className={`dashboard-activity-item tone-${tone}`}>
      <span className="dashboard-activity-icon">
        <ShopifyIcon name={icon} size={14} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <time>{time}</time>
    </li>
  );
}

function OverviewStatusRow({
  area,
  metric,
  owner,
  tone,
  status,
  action,
  onClick
}: {
  area: string;
  metric: string;
  owner: string;
  tone: "success" | "warning" | "danger" | "info";
  status: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <tr>
      <td>
        <strong>{area}</strong>
        <span>{owner}</span>
      </td>
      <td>{metric}</td>
      <td>
        <DashboardChip tone={tone}>{status}</DashboardChip>
      </td>
      <td>
        <button className="dashboard-table-action" onClick={onClick} type="button">
          {action}
        </button>
      </td>
    </tr>
  );
}

function OverviewActionModal({
  consultants,
  isPipelineRestricted,
  mode,
  onClose,
  onPrimaryAction,
  open,
  openCount,
  projects,
  staleCount,
  timeEntries,
  visiblePipeline
}: {
  consultants: Consultant[];
  isPipelineRestricted: boolean;
  mode: OverviewActionModalMode | null;
  onClose: () => void;
  onPrimaryAction: (mode: OverviewActionModalMode) => void;
  open: boolean;
  openCount: number;
  projects: ProjectPL[];
  staleCount: number;
  timeEntries: TimeEntry[];
  visiblePipeline: number;
}) {
  const activeMode = mode ?? "command";
  const chartData = getWeeklyAllocationChartData(consultants);
  const currentWeekLabel = chartData[0]?.label ?? "";
  const weeklyCapacity = chartData[0]?.capacity ?? 0;
  const currentWeekLoad = chartData[0]?.allocated ?? 0;
  const currentWeekLoadPct = weeklyCapacity > 0 ? Math.round((currentWeekLoad / weeklyCapacity) * 100) : 0;
  const pendingTimesheets = timeEntries.filter((entry) => entry.status === "submitted");
  const marginProjects = projects.filter((project) => project.state !== "On Plan");
  const topCapacityRisks = consultants
    .map((consultant) => {
      const days = consultant.allocations
        .filter((allocation) => allocation.week === currentWeekLabel && !["released", "completed", "cancelled"].includes(allocation.status))
        .reduce((sum, allocation) => sum + allocation.days, 0);
      const capacityDays = (consultant.capacityMinutesByWeek[currentWeekLabel] ?? 5 * minutesPerDay) / minutesPerDay;
      return { ...consultant, days, loadPct: capacityDays > 0 ? Math.round((days / capacityDays) * 100) : 0 };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);

  const modalMeta: Record<OverviewActionModalMode, { icon: React.ComponentProps<typeof ShopifyIcon>["name"]; primary: string; title: string; subtitle: string }> = {
    allocation: {
      icon: "users",
      primary: "Mở bảng phân bổ",
      subtitle: "Chọn nhanh tuần, người phụ trách và guardrail tải trước khi giữ lịch.",
      title: "Phân bổ nguồn lực"
    },
    approval: {
      icon: "clock",
      primary: "Mở hàng chờ duyệt",
      subtitle: "Kiểm tra bảng giờ submitted và tác động chi phí trước khi approve.",
      title: "Duyệt bảng giờ"
    },
    capacity: {
      icon: "users",
      primary: "Mở tab triển khai",
      subtitle: "Xem các điểm vượt tải và đề xuất cân bằng năng lực trong tuần.",
      title: "Cân tải nguồn lực"
    },
    command: {
      icon: "search",
      primary: "Tạo lead mới",
      subtitle: "Tìm nhanh cơ hội, khách hàng, dự án hoặc mở thẳng luồng thao tác.",
      title: "Command center"
    },
    lead: {
      icon: "plus",
      primary: "Tạo lead trong pipeline",
      subtitle: "Ghi nhận nhu cầu mới với đủ thông tin để sales owner có thể chăm sóc ngay.",
      title: "Tạo lead"
    },
    pipeline: {
      icon: "target",
      primary: "Mở pipeline",
      subtitle: "Tập trung vào các cơ hội chưa có cập nhật mới hoặc cần next step rõ hơn.",
      title: "Rà soát pipeline"
    },
    pl: {
      icon: "cash",
      primary: "Mở P&L",
      subtitle: "Nhìn nhanh doanh thu, giờ thực tế và dự án cần reforecast.",
      title: "Theo dõi P&L"
    },
    timesheet: {
      icon: "clock",
      primary: "Mở form ghi giờ",
      subtitle: "Gửi bảng giờ theo dự án, stage và loại công việc để finance duyệt.",
      title: "Gửi bảng giờ"
    }
  };

  const meta = modalMeta[activeMode];

  function renderModalBody() {
    if (activeMode === "command") {
      return (
        <>
          <div className="overview-modal-command">
            <ShopifyIcon name="search" size={17} />
            <input aria-label="Tìm nội dung CRM" defaultValue="Pipeline cần chăm sóc" />
            <kbd>⌘ K</kbd>
          </div>
          <div className="overview-modal-grid">
            {[
              { label: "Cơ hội mở", value: `${openCount}`, tone: "info" as const },
              { label: "Pipeline cần chăm sóc", value: `${staleCount}`, tone: staleCount > 0 ? "warning" as const : "success" as const },
              { label: "Tải tuần", value: `${currentWeekLoadPct}%`, tone: currentWeekLoadPct > 100 ? "danger" as const : "success" as const },
              { label: "Bảng giờ chờ", value: `${pendingTimesheets.length}`, tone: pendingTimesheets.length > 0 ? "warning" as const : "success" as const }
            ].map((item) => (
              <div className="overview-modal-summary-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <DashboardChip tone={item.tone}>{item.tone === "success" ? "Ổn" : "Cần xem"}</DashboardChip>
              </div>
            ))}
          </div>
          <div className="overview-modal-list">
            <button onClick={() => onPrimaryAction("lead")} type="button">
              <ShopifyIcon name="plus" size={15} />
              <span>
                <strong>Tạo lead mới</strong>
                <small>Đưa nhu cầu mới vào pipeline.</small>
              </span>
            </button>
            <button onClick={() => onPrimaryAction("capacity")} type="button">
              <ShopifyIcon name="users" size={15} />
              <span>
                <strong>Cân tải tuần này</strong>
                <small>{currentWeekLoad}d đã giữ trên {weeklyCapacity}d năng lực.</small>
              </span>
            </button>
          </div>
        </>
      );
    }

    if (activeMode === "lead") {
      return (
        <div className="overview-modal-split">
          <div className="overview-modal-section">
            <label>
              Khách hàng
              <input defaultValue="Công ty ABC Manufacturing" />
            </label>
            <label>
              Nhu cầu
              <input defaultValue="Triển khai B2B CRM + approval chi phí" />
            </label>
            <div className="overview-modal-form-grid">
              <label>
                Giá trị dự kiến
                <input defaultValue="180.000.000 đ" />
              </label>
              <label>
                Owner
                <select defaultValue="founder">
                  <option value="founder">Founder</option>
                  <option value="sales">Sales owner</option>
                  <option value="delivery">Delivery lead</option>
                </select>
              </label>
            </div>
            <label>
              Next step
              <textarea defaultValue="Xác nhận scope, gom tài liệu hiện trạng và hẹn discovery call." />
            </label>
          </div>
          <aside className="overview-modal-section tone-info">
            <span className="overview-modal-pill">Lead quality</span>
            <strong>{isPipelineRestricted ? "Ẩn giá trị theo vai trò" : <MoneyAmount value={visiblePipeline} />} pipeline đang theo dõi</strong>
            <p>Lead mới nên có budget, deadline và người quyết định trước khi chuyển sang proposal.</p>
            <ul className="overview-modal-checklist">
              <li>Đã có pain point vận hành</li>
              <li>Có owner chăm sóc trong 24h</li>
              <li>Đủ dữ liệu để estimate sơ bộ</li>
            </ul>
          </aside>
        </div>
      );
    }

    if (activeMode === "allocation" || activeMode === "capacity") {
      return (
        <div className="overview-modal-split">
          <div className="overview-modal-section">
            <div className="overview-modal-grid compact">
              <div className="overview-modal-summary-card">
                <span>Tuần hiện tại</span>
                <strong>{currentWeekLoad}d</strong>
                <DashboardChip tone={currentWeekLoadPct > 100 ? "danger" : currentWeekLoadPct >= 85 ? "warning" : "success"}>{currentWeekLoadPct}% tải</DashboardChip>
              </div>
              <div className="overview-modal-summary-card">
                <span>Năng lực chuẩn</span>
                <strong>{weeklyCapacity}d</strong>
                <DashboardChip tone="info">{consultants.length} người</DashboardChip>
              </div>
            </div>
            <label>
              Dự án ưu tiên
              <select defaultValue={projects[0]?.name}>
                {projects.map((project) => (
                  <option key={project.id} value={project.name}>{project.name}</option>
                ))}
              </select>
            </label>
            <label>
              Ghi chú điều phối
              <textarea defaultValue="Ưu tiên giảm tải consultant vượt 100%, không nhận thêm scope mới nếu chưa có approval." />
            </label>
          </div>
          <aside className="overview-modal-section">
            <span className="overview-modal-pill">Capacity watch</span>
            <div className="overview-modal-mini-list">
              {topCapacityRisks.map((consultant) => (
                <div key={consultant.id}>
                  <span>
                    <strong>{consultant.name}</strong>
                    <small>{consultant.role}</small>
                  </span>
                  <DashboardChip tone={consultant.loadPct > 100 ? "danger" : consultant.loadPct >= 85 ? "warning" : "success"}>
                    {consultant.days}d
                  </DashboardChip>
                </div>
              ))}
            </div>
          </aside>
        </div>
      );
    }

    if (activeMode === "timesheet" || activeMode === "approval") {
      return (
        <div className="overview-modal-split">
          <div className="overview-modal-section">
            <div className="overview-modal-form-grid">
              <label>
                Dự án
                <div className="finance-choice-grid compact" role="radiogroup" aria-label="Chọn dự án trong modal">
                  {projects.map((project, index) => (
                    <button
                      aria-checked={index === 0}
                      className="finance-choice-button"
                      data-selected={index === 0}
                      key={project.id}
                      role="radio"
                      type="button"
                    >
                      <span>{project.name}</span>
                      <small><MoneyAmount value={project.revenueBasis} /></small>
                    </button>
                  ))}
                </div>
              </label>
              <label>
                Số giờ
                <input defaultValue="8" inputMode="decimal" />
              </label>
            </div>
            <label>
              Loại công việc
              <div className="finance-worktype-row compact" role="radiogroup" aria-label="Chọn loại công việc trong modal">
                {["Billable Delivery", "Rework", "Internal/Admin"].map((workType, index) => (
                  <button
                    aria-checked={index === 0}
                    className="finance-worktype-button"
                    data-selected={index === 0}
                    key={workType}
                    role="radio"
                    type="button"
                  >
                    {getWorkTypeLabel(workType)}
                  </button>
                ))}
              </div>
            </label>
            <label>
              Ghi chú
              <textarea defaultValue="Hoàn thiện cấu hình, kiểm thử và bàn giao checklist cho khách hàng." />
            </label>
          </div>
          <aside className="overview-modal-section tone-warning">
            <span className="overview-modal-pill">Approval queue</span>
            <strong>{pendingTimesheets.length} bảng giờ đang chờ</strong>
            <div className="overview-modal-mini-list">
              {pendingTimesheets.length ? pendingTimesheets.map((entry) => (
                <div key={entry.id}>
                  <span>
                    <strong>{entry.consultant}</strong>
                    <small>{entry.project} · {getWorkTypeLabel(entry.workType)}</small>
                  </span>
                  <DashboardChip tone="warning">{entry.hours}h</DashboardChip>
                </div>
              )) : (
                <p>Không có bảng giờ submitted đang treo.</p>
              )}
            </div>
          </aside>
        </div>
      );
    }

    if (activeMode === "pipeline") {
      return (
        <div className="overview-modal-section">
          <div className="overview-modal-grid">
            <div className="overview-modal-summary-card">
              <span>Cơ hội mở</span>
              <strong>{openCount}</strong>
              <DashboardChip tone="info">Pipeline</DashboardChip>
            </div>
            <div className="overview-modal-summary-card">
              <span>Cần chăm sóc</span>
              <strong>{staleCount}</strong>
              <DashboardChip tone={staleCount > 0 ? "warning" : "success"}>{staleCount > 0 ? "Follow-up" : "Sạch"}</DashboardChip>
            </div>
            <div className="overview-modal-summary-card">
              <span>Giá trị nhìn thấy</span>
              <strong>{isPipelineRestricted ? "Ẩn" : <MoneyAmount value={visiblePipeline} />}</strong>
              <DashboardChip tone="success">Forecast</DashboardChip>
            </div>
          </div>
          <ul className="overview-modal-checklist">
            <li>Ưu tiên cơ hội chưa có cập nhật trong 14 ngày.</li>
            <li>Deal có proposal nhưng thiếu next step phải có owner mới.</li>
            <li>Lead mới được tạo từ dashboard sẽ mở trong pipeline drawer.</li>
          </ul>
        </div>
      );
    }

    return (
      <div className="overview-modal-split">
        <div className="overview-modal-section">
          <div className="overview-modal-grid compact">
            {projects.map((project) => {
              const gross = project.revenueBasis - project.actualHours * project.costRate - project.externalCost;
              const margin = project.revenueBasis > 0 ? Math.round((gross / project.revenueBasis) * 100) : 0;
              return (
                <div className="overview-modal-summary-card" key={project.id}>
                  <span>{project.name}</span>
                  <strong>{margin}%</strong>
                  <DashboardChip tone={getProjectStateTone(project.state)}>{getProjectStateLabel(project.state)}</DashboardChip>
                </div>
              );
            })}
          </div>
        </div>
        <aside className="overview-modal-section tone-warning">
          <span className="overview-modal-pill">Margin watch</span>
          <strong>{marginProjects.length} dự án cần xem</strong>
          <p>Dự án vượt giờ hoặc lệch biên nên được reforecast trước khi ghi nhận thêm chi phí.</p>
        </aside>
      </div>
    );
  }

  return (
    <ShopifyModal open={open} onClose={onClose} size="large" title={meta.title}>
      <div className="overview-action-modal">
        <header className="overview-modal-header">
          <span className="overview-modal-icon">
            <ShopifyIcon name={meta.icon} size={18} />
          </span>
          <div>
            <p className="dashboard-eyebrow">Tổng quan vận hành</p>
            <h3>{meta.title}</h3>
            <p>{meta.subtitle}</p>
          </div>
        </header>
        {renderModalBody()}
        <footer className="overview-modal-actions">
          <button className="dashboard-table-action" onClick={onClose} type="button">
            Đóng
          </button>
          <button className="dashboard-table-action primary" onClick={() => onPrimaryAction(activeMode)} type="button">
            {meta.primary}
          </button>
        </footer>
      </div>
    </ShopifyModal>
  );
}

// ─── Overview Tab Content ────────────────────────────────────────────────────
function OverviewTabContent({
  visiblePipeline,
  weightedForecast,
  winRate,
  openCount,
  staleCount,
  consultants,
  overbookedW24,
  projects,
  timeEntries,
  roleMode,
  openOverviewModal,
  isPipelineRestricted,
}: {
  visiblePipeline: number;
  weightedForecast: number;
  winRate: number;
  openCount: number;
  staleCount: number;
  consultants: Consultant[];
  overbookedW24: number;
  projects: ProjectPL[];
  timeEntries: TimeEntry[];
  roleMode: string;
  openOverviewModal: (mode: OverviewActionModalMode) => void;
  isPipelineRestricted: boolean;
}) {
  const pendingTimesheets = timeEntries.filter((te) => te.status === "submitted").length;
  const totalRevenue = projects.reduce((s, p) => s + p.revenueBasis, 0);
  const marginWatchCount = projects.filter((project) => project.state !== "On Plan").length;
  const openReviewCount = staleCount + overbookedW24 + pendingTimesheets;
  const allocationChartData = getWeeklyAllocationChartData(consultants);
  const currentWeekLoad = allocationChartData[0]?.allocated ?? 0;
  const weeklyCapacity = allocationChartData[0]?.capacity ?? 0;
  const currentWeekLoadPct = weeklyCapacity > 0 ? Math.round((currentWeekLoad / weeklyCapacity) * 100) : 0;
  const activityItems = [
    staleCount > 0
      ? {
          icon: "alert" as const,
          title: "Pipeline cần chăm sóc",
          detail: `${staleCount} cơ hội chưa có cập nhật mới.`,
          tone: "warning" as const,
          time: "Hôm nay"
        }
      : {
          icon: "check" as const,
          title: "Pipeline đang sạch",
          detail: "Không có cơ hội quá hạn chăm sóc.",
          tone: "success" as const,
          time: "Hôm nay"
        },
    overbookedW24 > 0
      ? {
          icon: "users" as const,
          title: "Nguồn lực vượt tải",
          detail: `${overbookedW24} người cần cân bằng trong tuần.`,
          tone: "danger" as const,
          time: "Tuần này"
        }
      : {
          icon: "users" as const,
          title: "Nguồn lực ổn định",
          detail: "Tải triển khai nằm trong ngưỡng vận hành.",
          tone: "success" as const,
          time: "Tuần này"
        },
    pendingTimesheets > 0
      ? {
          icon: "clock" as const,
          title: "Bảng giờ chờ duyệt",
          detail: `${pendingTimesheets} bản ghi cần kiểm tra chi phí.`,
          tone: "warning" as const,
          time: "Tài chính"
        }
      : {
          icon: "clock" as const,
          title: "Bảng giờ đã rõ",
          detail: "Không có bản ghi submitted đang treo.",
          tone: "success" as const,
          time: "Tài chính"
        },
    {
      icon: marginWatchCount > 0 ? "cash" as const : "shield" as const,
      title: marginWatchCount > 0 ? "Biên dự án cần rà soát" : "Biên dự án trong kế hoạch",
      detail: marginWatchCount > 0 ? `${marginWatchCount} dự án lệch baseline.` : "Danh mục đang giữ đúng baseline.",
      tone: marginWatchCount > 0 ? "warning" as const : "info" as const,
      time: "P&L"
    }
  ];

  return (
    <div className="dashboard-overview">
      <section className="dashboard-command-bar" aria-label="Tìm kiếm nhanh dashboard">
        <button
          className="dashboard-command-search"
          onClick={() => openOverviewModal("command")}
          type="button"
        >
          <ShopifyIcon name="search" size={16} />
          <span>Tìm cơ hội, khách hàng, dự án, hóa đơn...</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="dashboard-command-scopes" aria-label="Phạm vi theo dõi">
          <DashboardChip tone="info">{openCount} cơ hội mở</DashboardChip>
          <DashboardChip tone={overbookedW24 > 0 ? "danger" : "success"}>{currentWeekLoadPct}% tải tuần</DashboardChip>
          <DashboardChip tone={pendingTimesheets > 0 ? "warning" : "success"}>{pendingTimesheets} bảng giờ chờ duyệt</DashboardChip>
        </div>
      </section>

      <section className="dashboard-hero" aria-label="Tình hình vận hành">
        <div className="dashboard-hero-copy">
          <span className="dashboard-hero-icon">
            <ShopifyIcon name="spark" size={18} />
          </span>
          <div>
            <p className="dashboard-eyebrow">Tổng quan hôm nay</p>
            <h2>{openReviewCount > 0 ? "Có vài điểm cần xử lý" : "Vận hành đang ổn"}</h2>
            <p>
              Theo dõi nhanh cơ hội bán hàng, tải triển khai và dòng tiền trong một màn hình gọn.
            </p>
          </div>
        </div>
        <div className="dashboard-hero-status">
          <strong>{openReviewCount}</strong>
          <span>việc cần rà soát</span>
        </div>
      </section>

      <section className="dashboard-metric-grid" aria-label="Chỉ số vận hành chính">
        <DashboardMetricCard
          icon="target"
          label="Cơ hội bán hàng"
          tone="sales"
          value={isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={visiblePipeline} />}
          detail={<>{openCount} cơ hội đang mở, dự báo {isPipelineRestricted ? "đang ẩn" : <MoneyAmount value={weightedForecast} />}</>}
          chips={
            <>
              <DashboardChip tone="info">Tỷ lệ thắng {winRate}%</DashboardChip>
              {staleCount > 0 ? <DashboardChip tone="warning">{staleCount} cần rà soát</DashboardChip> : <DashboardChip tone="success">Đang ổn</DashboardChip>}
            </>
          }
        />
        <DashboardMetricCard
          icon="users"
          label="Nguồn lực triển khai"
          tone="delivery"
          value={`${consultants.length} người`}
          detail="Nhóm triển khai đang được phân bổ theo tuần."
          chips={
            overbookedW24 > 0
              ? <DashboardChip tone="danger">{overbookedW24} quá tải tuần này</DashboardChip>
              : <DashboardChip tone="success">Tải đội ổn định</DashboardChip>
          }
        />
        <DashboardMetricCard
          icon="cash"
          label="Tài chính dự án"
          tone="finance"
          value={roleMode === "consultant" ? "Đang ẩn" : <MoneyAmount value={totalRevenue} />}
          detail="Giá trị hợp đồng đang theo dõi trong danh mục triển khai."
          chips={
            <>
              <DashboardChip tone="success">Biên dự kiến 53%</DashboardChip>
              {pendingTimesheets > 0 ? <DashboardChip tone="warning">{pendingTimesheets} bảng giờ chờ duyệt</DashboardChip> : null}
            </>
          }
        />
      </section>

      <section className="dashboard-reference-grid" aria-label="Bảng điều hành tổng quan">
        <div className="dashboard-reference-main">
          <article className="dashboard-panel dashboard-volume-panel" aria-label="Dòng việc triển khai">
            <div className="dashboard-panel-titlebar">
              <div className="dashboard-panel-header">
                <span className="dashboard-panel-icon">
                  <ShopifyIcon name="trend" size={15} />
                </span>
                <div>
                  <h3>Dòng việc triển khai</h3>
                  <p>Ngày công đã giữ theo tuần, dùng để phát hiện tải tăng trước khi quá hạn.</p>
                </div>
              </div>
              <DashboardChip tone={currentWeekLoadPct > 100 ? "danger" : currentWeekLoadPct > 80 ? "warning" : "success"}>
                {currentWeekLoadPct}% tuần này
              </DashboardChip>
            </div>
            <div className="dashboard-volume-summary">
              <strong>{currentWeekLoad}d</strong>
              <span>đã giữ / {weeklyCapacity}d năng lực tuần chuẩn</span>
            </div>
            <div className="dashboard-volume-chart dashboard-recharts-panel" aria-label="Biểu đồ ngày công theo tuần">
              {allocationChartData.length ? (
                <ResponsiveContainer height={236} width="100%">
                  <BarChart data={allocationChartData} margin={{ bottom: 8, left: -12, right: 12, top: 14 }}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.22)" strokeDasharray="3 4" vertical={false} />
                    <XAxis
                      axisLine={false}
                      dataKey="weekCode"
                      tick={{ fill: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}
                      tickLine={false}
                      tickMargin={10}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: "var(--text-subtle)", fontSize: 10, fontWeight: 700 }}
                      tickFormatter={(value) => `${value}d`}
                      tickLine={false}
                      width={42}
                    />
                    <Tooltip content={<OverviewAllocationTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.07)", radius: 8 }} />
                    <ReferenceLine
                      ifOverflow="extendDomain"
                      label={{ fill: "#10b981", fontSize: 10, fontWeight: 800, position: "insideTopRight", value: `${weeklyCapacity}d safe limit` }}
                      stroke="#10b981"
                      strokeDasharray="5 5"
                      y={weeklyCapacity}
                    />
                    <Bar dataKey="allocated" maxBarSize={54} radius={[9, 9, 4, 4]}>
                      {allocationChartData.map((entry) => (
                        <Cell fill={entry.fill} key={entry.label} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="dashboard-empty-state">
                  <strong>Chưa có lịch phân bổ</strong>
                  <span>Thêm phân bổ để chart hiển thị tải theo tuần.</span>
                </div>
              )}
              <div className="dashboard-volume-legend" aria-label="Chú giải tải nguồn lực">
                <span><i className="tone-info" /> Còn tải</span>
                <span><i className="tone-success" /> Đúng tải</span>
                <span><i className="tone-warning" /> Cần rà soát</span>
                <span><i className="tone-danger" /> Quá tải</span>
              </div>
            </div>
          </article>

          <article className="dashboard-panel dashboard-status-panel" aria-label="Monitoring vận hành">
            <div className="dashboard-panel-titlebar">
              <div className="dashboard-panel-header">
                <span className="dashboard-panel-icon">
                  <ShopifyIcon name="shield" size={15} />
                </span>
                <div>
                  <h3>Monitoring vận hành</h3>
                  <p>Bảng kiểm soát các luồng cần Founder hoặc team lead nhìn mỗi ngày.</p>
                </div>
              </div>
            </div>
            <div className="dashboard-status-table-wrap">
              <table className="dashboard-status-table">
                <thead>
                  <tr>
                    <th>Luồng</th>
                    <th>Chỉ số</th>
                    <th>Trạng thái</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  <OverviewStatusRow
                    action="Mở pipeline"
                    area="Follow-up cơ hội"
                    metric={`${staleCount}/${openCount} cần chăm sóc`}
                    onClick={() => openOverviewModal("pipeline")}
                    owner="Sales owner"
                    status={staleCount > 0 ? "Cần rà soát" : "Đang ổn"}
                    tone={staleCount > 0 ? "warning" : "success"}
                  />
                  <OverviewStatusRow
                    action="Cân tải"
                    area="Nguồn lực tuần"
                    metric={`${currentWeekLoad}d / ${weeklyCapacity}d`}
                    onClick={() => openOverviewModal("capacity")}
                    owner="Delivery lead"
                    status={overbookedW24 > 0 ? "Quá tải" : "Khả dụng"}
                    tone={overbookedW24 > 0 ? "danger" : "success"}
                  />
                  <OverviewStatusRow
                    action="Duyệt giờ"
                    area="Bảng giờ"
                    metric={`${pendingTimesheets} submitted`}
                    onClick={() => openOverviewModal("approval")}
                    owner="Finance ops"
                    status={pendingTimesheets > 0 ? "Chờ duyệt" : "Sạch"}
                    tone={pendingTimesheets > 0 ? "warning" : "success"}
                  />
                  <OverviewStatusRow
                    action="Xem P&L"
                    area="Biên dự án"
                    metric={`${marginWatchCount}/${projects.length} cần theo dõi`}
                    onClick={() => openOverviewModal("pl")}
                    owner="Founder"
                    status={marginWatchCount > 0 ? "Margin watch" : "On plan"}
                    tone={marginWatchCount > 0 ? "warning" : "info"}
                  />
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <aside className="dashboard-reference-rail">
          <article className="dashboard-panel dashboard-activity-rail" aria-label="Cập nhật gần đây">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-icon">
                <ShopifyIcon name="spark" size={15} />
              </span>
              <div>
                <h3>Cập nhật gần đây</h3>
                <p>Tín hiệu mới nhất từ pipeline, delivery và finance.</p>
              </div>
            </div>
            <ul className="dashboard-activity-list">
              {activityItems.map((item) => (
                <OverviewActivityItem
                  detail={item.detail}
                  icon={item.icon}
                  key={`${item.title}-${item.time}`}
                  time={item.time}
                  title={item.title}
                  tone={item.tone}
                />
              ))}
            </ul>
          </article>

          <article className="dashboard-panel" aria-label="Hành động nhanh">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-icon">
                <ShopifyIcon name="plus" size={15} />
              </span>
              <div>
                <h3>Hành động nhanh</h3>
                <p>Mở đúng luồng để xử lý ngay từ dashboard.</p>
              </div>
            </div>
            <div className="dashboard-quick-list">
              <DashboardQuickAction
                detail="Thêm nhu cầu mới vào pipeline"
                icon="plus"
                label="Tạo lead"
                onClick={() => openOverviewModal("lead")}
                primary
              />
              <DashboardQuickAction
                detail="Điều phối người triển khai theo tuần"
                icon="users"
                label="Phân bổ nguồn lực"
                onClick={() => openOverviewModal("allocation")}
              />
              <DashboardQuickAction
                detail="Ghi nhận giờ làm và gửi duyệt"
                icon="clock"
                label="Gửi bảng giờ"
                onClick={() => openOverviewModal("timesheet")}
              />
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

interface CapacityTrendChartProps {
  consultants: Consultant[];
  weeksList: string[];
}

function getCapacityTrendData(consultants: Consultant[], weeksList: string[]): OverviewAllocationChartDatum[] {
  return weeksList.map((label) => {
    const capacity = consultants.reduce((sum, consultant) => {
      return sum + ((consultant.capacityMinutesByWeek[label] ?? 5 * minutesPerDay) / minutesPerDay);
    }, 0);
    const allocated = consultants.reduce((sum, consultant) => {
      const days = consultant.allocations
        .filter((allocation) => allocation.week === label && !["released", "completed", "cancelled"].includes(allocation.status))
        .reduce((total, allocation) => total + allocation.days, 0);

      return sum + days;
    }, 0);
    const loadPct = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
    const tone = getAllocationTone(loadPct);

    return {
      allocated,
      available: Math.max(capacity - allocated, 0),
      capacity,
      fill: getAllocationFill(tone),
      label,
      loadPct,
      status: getAllocationStatus(loadPct),
      tone,
      ...parseAllocationWeekLabel(label)
    };
  });
}

function CapacityTrendChart({ consultants, weeksList }: CapacityTrendChartProps) {
  const stats = getCapacityTrendData(consultants, weeksList);
  const weeklyCapacity = stats[0]?.capacity ?? 0;
  const currentWeekLoad = stats[0]?.allocated ?? 0;
  const currentWeekLoadPct = weeklyCapacity > 0 ? Math.round((currentWeekLoad / weeklyCapacity) * 100) : 0;
  const chartMax = Math.ceil(Math.max(weeklyCapacity, ...stats.map((stat) => stat.allocated), 1) * 1.16);

  return (
    <article className="dashboard-panel dashboard-volume-panel" aria-label="Xu hướng tải nguồn lực">
      <div className="dashboard-panel-titlebar">
        <div className="dashboard-panel-header">
          <span className="dashboard-panel-icon">
            <ShopifyIcon name="trend" size={15} />
          </span>
          <div>
            <h3>Xu hướng tải nguồn lực</h3>
            <p>Ngày công đã giữ theo tuần so với ngưỡng năng lực.</p>
          </div>
        </div>
        <DashboardChip tone={currentWeekLoadPct > 100 ? "danger" : currentWeekLoadPct >= 85 ? "warning" : "success"}>
          {currentWeekLoadPct}% tuần này
        </DashboardChip>
      </div>
      <div className="dashboard-volume-summary">
        <strong>{currentWeekLoad}d</strong>
        <span>đã giữ / {weeklyCapacity}d năng lực tuần chuẩn</span>
      </div>
      <div className="dashboard-volume-chart dashboard-recharts-panel" aria-label="Biểu đồ xu hướng tải nguồn lực">
        {stats.length ? (
          <ResponsiveContainer height={236} width="100%">
            <AreaChart data={stats} margin={{ bottom: 8, left: -12, right: 18, top: 14 }}>
              <defs>
                <linearGradient id="deliveryCapacityFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.22)" strokeDasharray="3 4" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="weekCode"
                tick={{ fill: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}
                tickLine={false}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                domain={[0, chartMax]}
                tick={{ fill: "var(--text-subtle)", fontSize: 10, fontWeight: 700 }}
                tickFormatter={(value) => `${value}d`}
                tickLine={false}
                width={42}
              />
              <Tooltip content={<OverviewAllocationTooltip />} cursor={{ stroke: "rgba(37, 99, 235, 0.18)", strokeWidth: 1 }} />
              <ReferenceLine
                ifOverflow="extendDomain"
                label={{ fill: "#10b981", fontSize: 10, fontWeight: 800, position: "insideTopRight", value: `${weeklyCapacity}d ngưỡng năng lực` }}
                stroke="#10b981"
                strokeDasharray="5 5"
                y={weeklyCapacity}
              />
              <Area
                activeDot={{ fill: "#2563eb", r: 5, stroke: "#ffffff", strokeWidth: 2 }}
                dataKey="allocated"
                dot={{ fill: "#ffffff", r: 3.5, stroke: "#2563eb", strokeWidth: 2 }}
                fill="url(#deliveryCapacityFill)"
                isAnimationActive={false}
                name="Đã giữ"
                stroke="#2563eb"
                strokeWidth={2.5}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="dashboard-empty-state">
            <strong>Chưa có lịch phân bổ</strong>
            <span>Thêm phân bổ để chart hiển thị tải theo tuần.</span>
          </div>
        )}
        <div className="dashboard-volume-legend" aria-label="Chú giải tải nguồn lực">
          <span><i className="tone-info" /> Còn tải</span>
          <span><i className="tone-success" /> Đúng tải</span>
          <span><i className="tone-warning" /> Cần rà soát</span>
          <span><i className="tone-danger" /> Quá tải</span>
        </div>
      </div>
    </article>
  );
}

function adaptDashboardCapacitySnapshots(snapshots: Array<{ response: CapacitySummaryResponse; week: DashboardWeekWindow }>): Consultant[] {
  const byUser = new Map<string, Consultant>();

  snapshots.forEach(({ response, week }) => {
    response.data.forEach((item) => {
      const consultant = byUser.get(item.userId) ?? createDashboardConsultant(item);
      consultant.capacityMinutesByWeek[week.label] = item.availableMinutes;
      consultant.allocations = [
        ...consultant.allocations.filter((allocation) => allocation.week !== week.label),
        ...item.allocations.map((allocation) => ({
          week: week.label,
          project: allocation.projectName ?? allocation.accountName ?? allocation.projectId ?? allocation.accountId,
          days: allocation.plannedMinutes / minutesPerDay,
          status: allocation.status
        }))
      ];
      byUser.set(item.userId, consultant);
    });
  });

  return Array.from(byUser.values());
}

function createDashboardConsultant(item: CapacitySummaryItem): Consultant {
  return {
    avatarUrl: item.userAvatarUrl,
    capacityMinutesByWeek: {},
    departmentCode: item.departmentCode,
    email: item.userEmail,
    id: item.userId,
    larkOpenId: item.larkOpenId,
    larkTenantKey: item.larkTenantKey,
    name: item.userDisplayName,
    role: item.displayRole ? formatDashboardResourceRole(item.displayRole) : "Nguồn lực triển khai",
    skills: item.skills.length > 0 ? item.skills.map(formatDashboardResourceSkill) : ["Triển khai"],
    allocations: []
  };
}

function formatDashboardResourceRole(role: string) {
  const labels: Record<string, string> = {
    consultant: "Consultant",
    delivery_lead: "Delivery Lead",
    project_manager: "Project Manager",
    solution_architect: "Solution Architect",
    technical_lead: "Technical Lead"
  };
  return labels[role] ?? role;
}

function formatDashboardResourceSkill(skill: string) {
  return skill
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function adaptDashboardProjectPlSummary(item: ProjectPlSummaryItem): ProjectPL {
  const actualHours = Math.round(item.approvedLaborMinutes / 60);
  const plannedHours = Math.round(item.plannedCostAmount > 0 && item.approvedLaborMinutes > 0
    ? Math.max(item.approvedLaborMinutes, minutesPerDay) / 60
    : 0);
  const costRate = actualHours > 0 && item.actualLaborCostAmount > 0
    ? item.actualLaborCostAmount / actualHours
    : 0;
  const revenueBasis = item.paidRevenueAmount || item.plannedRevenueAmount;

  return {
    accountName: item.accountName,
    actualHours,
    costRate,
    externalCost: item.directCostAmount + item.writeOffAmount,
    id: item.projectId,
    name: item.projectName,
    plannedHours,
    revenueBasis,
    state: deriveDashboardPlState(item.grossMarginPercent, financeMarginTarget, item.totalCostAmount, item.plannedCostAmount),
    targetMargin: financeMarginTarget
  };
}

function deriveDashboardPlState(
  grossMarginPercent: number | undefined,
  targetMargin: number,
  totalCostAmount: number,
  plannedCostAmount: number
): ProjectPL["state"] {
  if (plannedCostAmount > 0 && totalCostAmount > plannedCostAmount * 1.1) return "Over Budget";
  if (grossMarginPercent === undefined) return "Needs Reforecast";
  if (grossMarginPercent < targetMargin - 15) return "Margin Risk";
  if (grossMarginPercent < targetMargin) return "Margin Watch";
  return "On Plan";
}

// ─── Project Profitability Chart ──────────────────────────────────────────────
interface ProjectProfitabilityChartProps {
  projects: ProjectPL[];
}

type ProjectProfitabilityDatum = {
  actualCost: number;
  costBurnPct: number;
  forecastCost: number;
  margin: number;
  marginGap: number;
  name: string;
  plannedCost: number;
  revenue: number;
  stateLabel: string;
  stateTone: "success" | "warning" | "danger" | "neutral";
  targetMargin: number;
  varianceHours: number;
  variancePct: number;
};

function getProjectStateLabel(state: ProjectPL["state"]) {
  if (state === "On Plan") return "Đúng kế hoạch";
  if (state === "Margin Watch") return "Theo dõi biên";
  if (state === "Over Budget") return "Vượt ngân sách";
  if (state === "Needs Reforecast") return "Cần dự báo lại";
  return "Rủi ro biên";
}

function getProjectStateTone(state: ProjectPL["state"]): ProjectProfitabilityDatum["stateTone"] {
  if (state === "On Plan") return "success";
  if (state === "Margin Watch") return "warning";
  return "danger";
}

function getWorkTypeLabel(workType: string) {
  const labels: Record<string, string> = {
    "Billable Delivery": "Delivery tính phí",
    "Non-billable Delivery": "Delivery không tính phí",
    Rework: "Làm lại",
    "Internal/Admin": "Nội bộ / admin"
  };
  return labels[workType] ?? workType;
}

function getProjectProfitabilityDatum(project: ProjectPL): ProjectProfitabilityDatum {
  const plannedLabor = project.plannedHours * project.costRate;
  const plannedCost = plannedLabor + project.externalCost;
  const actualLabor = project.actualHours * project.costRate;
  const actualCost = actualLabor + project.externalCost;
  const etcLabor = Math.max(0, project.plannedHours - project.actualHours) * project.costRate;
  const forecastCost = actualCost + etcLabor;
  const margin = project.revenueBasis > 0
    ? Math.round(((project.revenueBasis - forecastCost) / project.revenueBasis) * 100)
    : 0;
  const varianceHours = project.actualHours - project.plannedHours;
  const variancePct = project.plannedHours > 0 ? Math.round((varianceHours / project.plannedHours) * 100) : 0;
  const costBurnPct = plannedCost > 0 ? Math.round((actualCost / plannedCost) * 100) : 0;

  return {
    actualCost,
    costBurnPct,
    forecastCost,
    margin,
    marginGap: margin - project.targetMargin,
    name: project.name,
    plannedCost,
    revenue: project.revenueBasis,
    stateLabel: getProjectStateLabel(project.state),
    stateTone: getProjectStateTone(project.state),
    targetMargin: project.targetMargin,
    varianceHours,
    variancePct
  };
}

function formatFinanceChartMoneyLabel(value: unknown) {
  return formatCompactVnd(Number(value));
}

function formatFinanceChartPercentLabel(value: unknown) {
  return `${Math.round(Number(value))}%`;
}

function ProjectProfitabilityTooltip({ active, payload }: ChartTooltipProps<ProjectProfitabilityDatum>) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const item = payload[0].payload;

  return (
    <div className="sales-chart-tooltip finance-pl-tooltip">
      <span>{item.name}</span>
      <strong>{item.margin}% biên dự báo</strong>
      <dl>
        <div>
          <dt>Doanh thu</dt>
          <dd>{formatVnd(item.revenue)}</dd>
        </div>
        <div>
          <dt>Chi phí dự báo</dt>
          <dd>{formatVnd(item.forecastCost)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{item.targetMargin}%</dd>
        </div>
        <div>
          <dt>Trạng thái</dt>
          <dd>{item.stateLabel}</dd>
        </div>
      </dl>
    </div>
  );
}

function ProjectProfitabilityChart({ projects }: ProjectProfitabilityChartProps) {
  const stats = projects.map(getProjectProfitabilityDatum);
  const marginAtRisk = stats.filter((item) => item.margin < item.targetMargin).length;
  const averageMargin = stats.length
    ? Math.round(stats.reduce((total, item) => total + item.margin, 0) / stats.length)
    : 0;
  const marginValues = stats.flatMap((item) => [item.margin, item.targetMargin]);
  const marginDomainMin = Math.floor(Math.min(0, financeMarginTarget, ...marginValues) / 10) * 10;
  const marginDomainMax = Math.ceil(Math.max(80, financeMarginTarget, ...marginValues) / 10) * 10;

  return (
    <article className="dashboard-panel dashboard-volume-panel finance-pl-chart-card" aria-label="Dự báo biên và hiệu quả dự án">
      <div className="dashboard-panel-titlebar">
        <div className="dashboard-panel-header">
          <span className="dashboard-panel-icon finance">
            <ShopifyIcon name="cash" size={15} />
          </span>
          <div>
            <h3>Dự báo biên dự án</h3>
            <p>So sánh doanh thu, chi phí dự báo và biên trực tiếp.</p>
          </div>
        </div>
        <div className="dashboard-volume-summary">
          <strong>{averageMargin}%</strong>
          <span>biên TB</span>
        </div>
      </div>

      <div className="finance-pl-readout" aria-label="Finance chart readable labels" data-testid="finance-pl-readout">
        <span>Target biên: {financeMarginTarget}%</span>
        <span>Biên TB: {averageMargin}%</span>
        <span>{marginAtRisk} dự án dưới target</span>
      </div>

      <div className="dashboard-volume-chart dashboard-recharts-panel finance-pl-chart" data-testid="finance-pl-chart">
        {stats.length > 0 ? (
        <ResponsiveContainer width="100%" height={272}>
          <ComposedChart data={stats} margin={{ bottom: 12, left: -8, right: 28, top: 28 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.24)" strokeDasharray="3 5" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
              tickFormatter={(value) => formatCompactVnd(Number(value))}
              tickLine={false}
              width={110}
              yAxisId="money"
            />
            <YAxis
              axisLine={false}
              domain={[marginDomainMin, marginDomainMax]}
              orientation="right"
              tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
              tickFormatter={(value) => `${value}%`}
              tickLine={false}
              yAxisId="margin"
            />
            <ReferenceLine
              ifOverflow="extendDomain"
              stroke="rgba(245, 158, 11, 0.5)"
              strokeDasharray="4 4"
              label={{ fill: "#92400e", fontSize: 11, fontWeight: 800, position: "right", value: `Target ${financeMarginTarget}%` }}
              y={financeMarginTarget}
              yAxisId="margin"
            />
            <Tooltip content={<ProjectProfitabilityTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.08)", radius: 8 }} />
            <Bar dataKey="revenue" fill="#2563eb" isAnimationActive={false} name="Doanh thu" radius={[6, 6, 0, 0]} yAxisId="money">
              <LabelList dataKey="revenue" fill="#1e3a8a" fontSize={10} fontWeight={800} formatter={formatFinanceChartMoneyLabel} position="top" />
            </Bar>
            <Bar dataKey="forecastCost" fill="#0ea5e9" isAnimationActive={false} name="Chi phí dự báo" radius={[6, 6, 0, 0]} yAxisId="money">
              <LabelList dataKey="forecastCost" fill="#075985" fontSize={10} fontWeight={800} formatter={formatFinanceChartMoneyLabel} position="top" />
            </Bar>
            <Line
              dataKey="margin"
              dot={{ fill: "#f59e0b", r: 4, stroke: "#ffffff", strokeWidth: 2 }}
              isAnimationActive={false}
              name="Biên dự báo"
              stroke="#f59e0b"
              strokeWidth={2}
              type="monotone"
              yAxisId="margin"
            >
              <LabelList dataKey="margin" fill="#92400e" fontSize={10} fontWeight={800} formatter={formatFinanceChartPercentLabel} position="top" />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
        ) : (
          <div className="dashboard-empty-state finance-chart-empty">
            <strong>Chưa có dữ liệu P&L</strong>
            <span>Dữ liệu sẽ hiển thị sau khi route Project Controls đồng bộ P&L từ backend.</span>
          </div>
        )}
        <div className="dashboard-volume-legend">
          <span><i className="tone-info" />Doanh thu</span>
          <span><i className="tone-cyan" />Chi phí dự báo</span>
          <span><i className="tone-warning" />Biên dự báo</span>
          <span><i className="tone-warning" />Target {financeMarginTarget}%</span>
        </div>
      </div>

      <div className="finance-pl-summary">
        <DashboardChip tone={marginAtRisk > 0 ? "warning" : "success"}>
          {marginAtRisk > 0 ? `${marginAtRisk} dự án cần xem biên` : "Biên đang ổn"}
        </DashboardChip>
        <DashboardChip tone="info">Target biên {financeMarginTarget}%</DashboardChip>
      </div>
    </article>
  );
}

export type DashboardWorkbenchProps = {
  accounts: AccountsResponse;
  initialOpportunities: ResourceListResponse<OpportunitySummary>;
  processMetrics: ProcessMetricsResponse;
  principal: string;
  salesTargets: SalesTargetsResponse;
};

// ─── Main Workbench ───────────────────────────────────────────────────────────
export function DashboardWorkbench({
  accounts,
  initialOpportunities,
  processMetrics,
  principal,
  salesTargets,
}: DashboardWorkbenchProps) {
  const salesOwners: ResourceListResponse<SalesOwnerSummary> = {
    data: getSalesOwnersFromOpportunities(initialOpportunities.data),
    meta: initialOpportunities.meta
  };
  const initialLeads: ResourceListResponse<LeadSummary> = {
    data: [],
    meta: initialOpportunities.meta
  };
  const workbench = useOpportunityWorkbench({ initialLeads, initialOpportunities, salesOwners, principal });
  const { message, opportunities, pipelineStats } = workbench.state;

  // Tabs state
  const [activeTab, setActiveTab] = useState<"overview" | "sales" | "delivery" | "finance">("overview");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [salesTimeRange, setSalesTimeRange] = useState<SalesTimeRange>("all");
  const [overviewModal, setOverviewModal] = useState<OverviewActionModalMode | null>(null);
  const weekWindows = useMemo(() => createDashboardWeekWindows(), []);
  const weeksList = useMemo(() => weekWindows.map((week) => week.label), [weekWindows]);

  // ─── Shared data variables ───
  const isPipelineRestricted = opportunities.length > 0 && opportunities.some((o) => o.amount === undefined);
  const visiblePipeline = opportunities.reduce((s, o) => s + (o.amount ?? 0), 0);
  const weightedForecast = pipelineStats.weighted;
  const annualAcv = accounts.data.reduce((s, a) => s + (a.annualValue ?? 0), 0);
  const wonCount = opportunities.filter((o) => o.stage === "won").length;
  const winRate = opportunities.length ? Math.round((wonCount / opportunities.length) * 100) : 0;
  const staleCount = pipelineStats.staleCount;
  const staleRate = opportunities.length ? Math.round((staleCount / opportunities.length) * 100) : 0;
  const salesOpportunitiesInRange = filterOpportunitiesByRange(opportunities, salesTimeRange);
  const activeSalesOpportunities = salesOpportunitiesInRange.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const rangeVisiblePipeline = salesOpportunitiesInRange.reduce((s, o) => s + (o.amount ?? 0), 0);
  const rangeWeightedForecast = salesOpportunitiesInRange.reduce((s, o) => s + (o.weightedForecast ?? Math.round(((o.amount ?? 0) * o.probability) / 100)), 0);
  const rangeWonCount = salesOpportunitiesInRange.filter((o) => o.stage === "won").length;
  const rangeWinRate = salesOpportunitiesInRange.length ? Math.round((rangeWonCount / salesOpportunitiesInRange.length) * 100) : 0;
  const rangeStaleCount = salesOpportunitiesInRange.filter((o) => o.stale).length;
  const rangeStaleRate = salesOpportunitiesInRange.length ? Math.round((rangeStaleCount / salesOpportunitiesInRange.length) * 100) : 0;
  const visibleDealCount = salesOpportunitiesInRange.filter((o) => o.amount !== undefined).length;
  const averageDealSize = visibleDealCount ? Math.round(rangeVisiblePipeline / visibleDealCount) : 0;
  const ownerAnalytics = getOwnerAnalytics(activeSalesOpportunities);
  const salesTarget = getSalesTargetForRange(salesTargets, salesTimeRange);
  const targetHealth = getTargetHealth(rangeWeightedForecast, salesTarget.amount);

  const oppResponse: ResourceListResponse<OpportunitySummary> = {
    data: opportunities,
    meta: initialOpportunities.meta,
  };

  // ─── Delivery/Capacity Tab Local States ───
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [isAllocModalOpen, setIsAllocModalOpen] = useState(false);
  const [selectedConsultant, setSelectedConsultant] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(weeksList[0] ?? "");
  const [inputDays, setInputDays] = useState("2.5");
  const [inputAllocStatus, setInputAllocStatus] = useState<"tentative" | "reserved" | "confirmed">("confirmed");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const availableProjects = accounts.data.map((account) => account.name);
  const currentWeekLabel = weeksList[0] ?? selectedWeek;

  const overbookedW24 = consultants.filter(c => {
    const totalDays = c.allocations
      .filter(a => a.week === currentWeekLabel && !["released", "completed", "cancelled"].includes(a.status))
      .reduce((sum, a) => sum + a.days, 0);
    const capacityDays = (c.capacityMinutesByWeek[currentWeekLabel] ?? 5 * minutesPerDay) / minutesPerDay;
    return totalDays > capacityDays;
  }).length;

  function getUtilizationData(consultant: Consultant, week: string) {
    const allocated = consultant.allocations
      .filter(a => a.week === week && !["released", "completed", "cancelled"].includes(a.status))
      .reduce((sum, a) => sum + a.days, 0);
    const available = (consultant.capacityMinutesByWeek[week] ?? 5 * minutesPerDay) / minutesPerDay;
    const percentage = available > 0 ? Math.round((allocated / available) * 100) : 0;

    let tone: "info" | "success" | "warning" | "critical" | "neutral" = "success";
    let statusText = "Đúng tải";

    if (percentage === 0) {
      tone = "neutral";
      statusText = "Trống lịch";
    } else if (percentage <= 80) {
      tone = "info";
      statusText = "Còn tải";
    } else if (percentage <= 100) {
      tone = "success";
      statusText = "Đúng tải";
    } else if (percentage <= 110) {
      tone = "warning";
      statusText = "Cần rà soát";
    } else {
      tone = "critical";
      statusText = percentage > 120 ? "Chặn >120%" : "Quá tải";
    }

    return { allocated, percentage, tone, statusText };
  }

  function handleCreateAllocation() {
    const days = parseFloat(inputDays);
    if (isNaN(days) || days <= 0 || days > 7) {
      setToastMessage("Số ngày phân bổ không hợp lệ. Vui lòng nhập từ 0.5 đến 7 ngày mỗi tuần.");
      return;
    }

    const consultant = consultants.find(c => c.id === selectedConsultant);
    if (!consultant || !selectedProject) {
      setToastMessage("Cần có nhân sự và dự án thật trước khi phân bổ nguồn lực.");
      return;
    }

    const currentDays = consultant.allocations
      .filter(a => a.week === selectedWeek && !["released", "completed", "cancelled"].includes(a.status))
      .reduce((sum, a) => sum + a.days, 0);

    const capacityDays = (consultant.capacityMinutesByWeek[selectedWeek] ?? 5 * minutesPerDay) / minutesPerDay;
    const nextDays = currentDays + days;
    const nextPercentage = capacityDays > 0 ? (nextDays / capacityDays) * 100 : 0;

    if (nextPercentage > 120) {
      setToastMessage(`Không thể phân bổ: tải tuần của ${consultant.name} sẽ lên ${nextPercentage}% và vượt ngưỡng chặn 120%.`);
      return;
    }

    if (nextPercentage > 110) {
      setToastMessage(`Đã ghi nhận yêu cầu ngoại lệ: ${consultant.name} sẽ đạt ${nextPercentage}% tải tuần và cần Founder/GM duyệt.`);
    }

    setConsultants(prev => prev.map(c => {
      if (c.id === selectedConsultant) {
        return {
          ...c,
          allocations: [
            ...c.allocations,
            { week: selectedWeek, project: selectedProject, days, status: inputAllocStatus }
          ]
        };
      }
      return c;
    }));

    setIsAllocModalOpen(false);
    setToastMessage(`Đã phân bổ thành công ${days} ngày cho ${consultant.name} vào dự án ${selectedProject}.`);
    setTimeout(() => setToastMessage(null), 4000);
  }

  // ─── Finance/Project Controls Tab Local States ───
  const [roleMode, setRoleMode] = useState<"founder" | "delivery_lead" | "consultant">("founder");
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<ProjectPL[]>([]);

  const [inputTimeProject, setInputTimeProject] = useState("");
  const [inputTimeStage, setInputTimeStage] = useState("Build & Config");
  const [inputTimeHours, setInputTimeHours] = useState("8");
  const [inputTimeWorkType, setInputTimeWorkType] = useState("Billable Delivery");
  const [inputTimeNote, setInputTimeNote] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCapacitySummary() {
      try {
        const summaries = await Promise.all(
          weekWindows.map(async (week) => {
            const url = new URL("/api/capacity/summary", window.location.origin);
            url.searchParams.set("principal", "founder");
            url.searchParams.set("periodStart", week.start);
            url.searchParams.set("periodEnd", week.end);
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) throw new Error("capacity summary unavailable");
            return { response: (await response.json()) as CapacitySummaryResponse, week };
          })
        );
        if (cancelled) return;
        const nextConsultants = adaptDashboardCapacitySnapshots(summaries);
        setConsultants(nextConsultants);
        setSelectedConsultant((current) => nextConsultants.some((consultant) => consultant.id === current) ? current : nextConsultants[0]?.id ?? "");
      } catch {
        if (!cancelled) {
          setConsultants([]);
          setSelectedConsultant("");
        }
      }
    }

    loadCapacitySummary();
    return () => {
      cancelled = true;
    };
  }, [weekWindows]);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectPlSummary() {
      try {
        const response = await fetch("/api/project-controls/pl-summary?principal=finance-admin", { cache: "no-store" });
        if (!response.ok) throw new Error("project P&L summary unavailable");
        const payload = (await response.json()) as ProjectPlSummaryResponse;
        if (cancelled) return;
        const nextProjects = payload.data.map(adaptDashboardProjectPlSummary);
        setProjects(nextProjects);
        setInputTimeProject((current) => nextProjects.some((project) => project.name === current) ? current : nextProjects[0]?.name ?? "");
      } catch {
        if (!cancelled) {
          setProjects([]);
          setInputTimeProject("");
        }
      }
    }

    loadProjectPlSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCreateTimeEntry(e: React.FormEvent) {
    e.preventDefault();
    const hours = parseFloat(inputTimeHours);
    if (isNaN(hours) || hours <= 0) {
      setToastMessage("Số giờ không hợp lệ. Vui lòng nhập số giờ lớn hơn 0.");
      return;
    }
    if (!inputTimeProject) {
      setToastMessage("Cần có dự án thật trước khi ghi nhận bảng giờ.");
      return;
    }

    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      consultant: "Nguyễn Văn A",
      project: inputTimeProject,
      stage: inputTimeStage,
      hours,
      workType: inputTimeWorkType,
      billable: inputTimeWorkType !== "Rework" && inputTimeWorkType !== "Internal/Admin",
      note: inputTimeNote,
      status: "submitted"
    };

    setTimeEntries(prev => [newEntry, ...prev]);
    setInputTimeNote("");
    setToastMessage("Đã gửi bảng giờ để phê duyệt.");
    setTimeout(() => setToastMessage(null), 4000);
  }

  function handleApproveEntry(id: string) {
    setTimeEntries(prev => prev.map(te => {
      if (te.id === id) {
        if (te.status !== "approved") {
          setProjects(prevProjs => prevProjs.map(p => {
            if (p.name === te.project) {
              return { ...p, actualHours: p.actualHours + te.hours };
            }
            return p;
          }));
        }
        return { ...te, status: "approved" };
      }
      return te;
    }));
  }

  function handleOverviewModalPrimaryAction(mode: OverviewActionModalMode) {
    setOverviewModal(null);

    if (mode === "command" || mode === "lead") {
      window.dispatchEvent(new Event("lcrm:open-create-opportunity"));
      return;
    }

    if (mode === "allocation") {
      setIsAllocModalOpen(true);
      return;
    }

    if (mode === "pipeline") {
      setSelectedStage(null);
      setActiveTab("sales");
      return;
    }

    if (mode === "capacity") {
      setActiveTab("delivery");
      return;
    }

    if (mode === "timesheet") {
      setRoleMode("consultant");
      setActiveTab("finance");
      return;
    }

    if (mode === "approval") {
      setRoleMode("delivery_lead");
      setActiveTab("finance");
      return;
    }

    setRoleMode("founder");
    setActiveTab("finance");
  }

  const pendingTimesheetCount = timeEntries.filter((entry) => entry.status === "submitted").length;
  const overviewReviewCount = staleCount + overbookedW24 + pendingTimesheetCount;
  const totalProjectRevenue = projects.reduce((s, p) => s + p.revenueBasis, 0);
  const totalProjectHours = projects.reduce((s, p) => s + p.actualHours, 0);

  return (
    <>
      <div className="dashboard-tabbar" aria-label="Khu vực dashboard" role="tablist">
        {[
          { id: "overview", label: "Tổng quan", shortLabel: "Tổng quan", icon: "target", meta: `${overviewReviewCount} việc` },
          { id: "sales", label: "Cơ hội & bán hàng", shortLabel: "Cơ hội", icon: "trend", meta: `${staleCount} stale` },
          { id: "delivery", label: "Triển khai & nguồn lực", shortLabel: "Triển khai", icon: "users", meta: `${overbookedW24} quá tải` },
          { id: "finance", label: "Tài chính & kiểm soát", shortLabel: "Tài chính", icon: "cash", meta: `${pendingTimesheetCount} chờ` }
        ].map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className="dashboard-tab"
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            role="tab"
            type="button"
          >
            <ShopifyIcon name={tab.icon as React.ComponentProps<typeof ShopifyIcon>["name"]} size={14} />
            <span className="dashboard-tab-label-full">{tab.label}</span>
            <span className="dashboard-tab-label-short">{tab.shortLabel}</span>
            <span className="dashboard-tab-meta">{tab.meta}</span>
          </button>
        ))}
      </div>

      {toastMessage && (
        <div style={{ margin: "16px 0" }}>
          <ShopifyBanner heading="Thông báo hệ thống" tone="success">
            <s-paragraph>{toastMessage}</s-paragraph>
          </ShopifyBanner>
        </div>
      )}

      {/* ── Overview Tab: Cockpit ── */}
      {activeTab === "overview" && (
        <OverviewTabContent
          visiblePipeline={visiblePipeline}
          weightedForecast={weightedForecast}
          winRate={winRate}
          openCount={pipelineStats.openCount}
          staleCount={staleCount}
          consultants={consultants}
          overbookedW24={overbookedW24}
          projects={projects}
          timeEntries={timeEntries}
          roleMode={roleMode}
          openOverviewModal={setOverviewModal}
          isPipelineRestricted={isPipelineRestricted}
        />
      )}

      {/* ── 3. Tab: Sales & Pipeline ── */}
      {activeTab === "sales" && (
        <div className="dashboard-sales">
          <section className="sales-hero" aria-label="Tình hình cơ hội bán hàng">
            <div>
              <p className="dashboard-eyebrow">Cơ hội & bán hàng</p>
              <h2>{rangeStaleCount > 0 ? "Cần chăm sóc cơ hội" : "Cơ hội đang ổn"}</h2>
              <p>
                Theo dõi phễu bán hàng, target kỳ này, deal size và người đang giữ nhiều cơ hội nhất.
              </p>
            </div>
            <div className="sales-hero-controls" aria-label="Lọc thời gian">
              {(Object.keys(salesTimeRangeLabels) as SalesTimeRange[]).map((range) => (
                <button
                  aria-pressed={salesTimeRange === range}
                  className={salesTimeRange === range ? "sales-range-button is-active" : "sales-range-button"}
                  key={range}
                  onClick={() => setSalesTimeRange(range)}
                  type="button"
                >
                  {salesTimeRangeLabels[range]}
                </button>
              ))}
              <span>{formatDateRangeLabel(salesTimeRange)}</span>
            </div>
          </section>

          <section className="dashboard-metric-grid sales-metric-grid" aria-label="Chỉ số cơ hội bán hàng">
            <DashboardMetricCard
              icon="cash"
              label="Cơ hội đang mở"
              tone="sales"
              value={isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={rangeVisiblePipeline} />}
              detail={
                `${activeSalesOpportunities.length} cơ hội đang mở trong kỳ xem.`
              }
              chips={<DashboardChip tone="info">Đang theo dõi</DashboardChip>}
            />
            <DashboardMetricCard
              icon="target"
              label="Dự báo có trọng số"
              tone="delivery"
              value={isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={rangeWeightedForecast} />}
              detail="Tính theo xác suất thắng hiện tại của từng cơ hội."
              chips={<DashboardChip tone={targetHealth.tone}>{targetHealth.percent}% target</DashboardChip>}
            />
            <DashboardMetricCard
              icon="trend"
              label="Tỷ lệ thắng"
              tone="finance"
              value={`${rangeWinRate}%`}
              detail={`${rangeWonCount} cơ hội thắng trên ${salesOpportunitiesInRange.length} cơ hội.`}
              chips={<DashboardChip tone="success">{rangeWonCount} thắng / {salesOpportunitiesInRange.length} tổng</DashboardChip>}
            />
            <DashboardMetricCard
              icon="cash"
              label="Deal size trung bình"
              tone="sales"
              value={isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={averageDealSize} />}
              detail="Tính trên các cơ hội có giá trị trong kỳ đang xem."
              chips={<DashboardChip tone="info">{visibleDealCount} deal có giá trị</DashboardChip>}
            />
            <DashboardMetricCard
              icon={rangeStaleCount > 0 ? "alert" : "check"}
              label="Cơ hội cần rà soát"
              tone="warning"
              value={rangeStaleCount}
              detail={`${rangeStaleRate}% cơ hội cần được cập nhật hoặc chốt việc tiếp theo.`}
              chips={<DashboardChip tone={rangeStaleCount > 0 ? "warning" : "success"}>{rangeStaleCount > 0 ? "Cần chăm sóc" : "Đang ổn"}</DashboardChip>}
            />
          </section>

          <section className="sales-analytics-grid" aria-label="Phân tích mục tiêu và người phụ trách">
            <SalesTargetPanel
              target={salesTarget.amount}
              targetMeta={salesTarget}
              weighted={rangeWeightedForecast}
              visible={rangeVisiblePipeline}
              openCount={activeSalesOpportunities.length}
            />
            <article className="sales-owner-card">
              <div className="dashboard-panel-header">
                <span className="dashboard-panel-icon">
                  <ShopifyIcon name="users" size={15} />
                </span>
                <div>
                  <h3>Người giữ deal</h3>
                  <p>
                    {ownerAnalytics.topByValue
                      ? `${ownerAnalytics.topByValue.name} đang giữ giá trị lớn nhất; ${ownerAnalytics.topByCount?.name ?? ownerAnalytics.topByValue.name} giữ nhiều deal nhất.`
                      : "Chưa có cơ hội đang mở trong kỳ xem."}
                  </p>
                </div>
              </div>
              <div className="dashboard-chip-row">
                <DashboardChip tone="info">
                  Giá trị cao nhất: {ownerAnalytics.topByValue ? <MoneyAmount value={ownerAnalytics.topByValue.amount} /> : "—"}
                </DashboardChip>
                <DashboardChip tone="success">
                  Nhiều deal nhất: {ownerAnalytics.topByCount ? `${ownerAnalytics.topByCount.count} deal` : "—"}
                </DashboardChip>
              </div>
              <SalesOwnerLeaderboard owners={ownerAnalytics.owners} />
            </article>
          </section>

          <section className="dashboard-panel sales-panel" aria-label="Phân tích phễu cơ hội">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-icon">
                <ShopifyIcon name="target" size={15} />
              </span>
              <div>
                <h3>Phân bổ pipeline</h3>
                <p>Hover để xem giá trị, dự báo và xác suất; bấm vào một giai đoạn có dữ liệu để lọc danh sách cơ hội.</p>
              </div>
            </div>
            <SalesStageDistributionChart
              opportunities={salesOpportunitiesInRange}
              isPipelineRestricted={isPipelineRestricted}
              selectedStage={selectedStage}
              onSelectStage={setSelectedStage}
            />
            <PipelineFunnelChart
              opportunities={salesOpportunitiesInRange}
              isPipelineRestricted={isPipelineRestricted}
              selectedStage={selectedStage}
              onSelectStage={setSelectedStage}
            />
          </section>

          <section className="dashboard-panel sales-panel" aria-label="Danh sách cơ hội bán hàng">
            <div className="sales-list-header">
              <div className="dashboard-panel-header">
                <span className="dashboard-panel-icon">
                  <ShopifyIcon name="list" size={15} />
                </span>
                <div>
                  <h3>Danh sách cơ hội</h3>
                  <p>{selectedStage ? `Đang lọc: ${formatStageLabel(selectedStage)} trong ${salesTimeRangeLabels[salesTimeRange]}.` : `Theo dõi từng deal trong ${salesTimeRangeLabels[salesTimeRange].toLowerCase()}.`}</p>
                </div>
              </div>
              {selectedStage ? (
                <button className="sales-clear-filter" onClick={() => setSelectedStage(null)} type="button">
                  Bỏ lọc
                </button>
              ) : null}
            </div>
            <OpportunityTable workbench={workbench} stageFilter={selectedStage} recordsOverride={salesOpportunitiesInRange} />
          </section>
        </div>
      )}

      {/* ── 4. Tab: Delivery & Capacity ── */}
      {activeTab === "delivery" && (
        <div className="dashboard-sales dashboard-detail-workbench">
          <section className="sales-hero" aria-label="Tình hình triển khai và nguồn lực">
            <div>
              <p className="dashboard-eyebrow">Triển khai & nguồn lực</p>
              <h2>{overbookedW24 > 0 ? "Cần cân tải tuần này" : "Tải triển khai đang ổn"}</h2>
              <p>
                Theo dõi năng lực từng consultant, lịch giữ ngày công và ngưỡng ngoại lệ trước khi cam kết bàn giao.
              </p>
            </div>
            <div className="sales-hero-controls" aria-label="Hành động triển khai">
              <button className="sales-hero-action" onClick={() => setIsAllocModalOpen(true)} type="button">
                <ShopifyIcon name="plus" size={14} />
                Phân bổ nguồn lực
              </button>
              <span>{overbookedW24 > 0 ? `${overbookedW24} người đang vượt tải tuần này` : "Không có overbooking tuần hiện tại"}</span>
            </div>
          </section>

          <section className="dashboard-metric-grid dashboard-detail-metric-grid" aria-label="Chỉ số nguồn lực">
            <DashboardMetricCard
              icon="users"
              label="Nguồn lực khả dụng"
              tone="delivery"
              value={`${consultants.length} người`}
              detail="Danh sách consultant đang sẵn sàng phân bổ vào dự án."
              chips={<DashboardChip tone="info">Đội triển khai</DashboardChip>}
            />
            <DashboardMetricCard
              icon={overbookedW24 > 0 ? "alert" : "check"}
              label="Quá tải tuần này"
              tone="warning"
              value={overbookedW24}
              detail="Số người vượt năng lực khả dụng trong tuần đang xem."
              chips={<DashboardChip tone={overbookedW24 > 0 ? "danger" : "success"}>{overbookedW24 > 0 ? "Cần cân tải" : "Đang ổn"}</DashboardChip>}
            />
            <DashboardMetricCard
              icon="shield"
              label="Ngưỡng ngoại lệ"
              tone="warning"
              value="120%"
              detail="Vượt 110% cần GM phê duyệt; 120% là ngưỡng chặn."
              chips={<DashboardChip tone="warning">Ngưỡng chặn</DashboardChip>}
            />
            <DashboardMetricCard
              icon="clock"
              label="Đơn vị tải chuẩn"
              tone="sales"
              value="Theo API"
              detail="Chuẩn đo năng lực theo tuần lấy từ capacity summary."
              chips={<DashboardChip tone="neutral">Chuẩn/tuần</DashboardChip>}
            />
          </section>

          <CapacityTrendChart consultants={consultants} weeksList={weeksList} />

          <article className="dashboard-panel dashboard-resource-table-card" aria-label="Phân bổ nguồn lực theo tuần">
            <div className="dashboard-panel-titlebar">
              <div className="dashboard-panel-header">
                <span className="dashboard-panel-icon">
                  <ShopifyIcon name="users" size={15} />
                </span>
                <div>
                  <h3>Phân bổ nguồn lực theo tuần</h3>
                  <p>Theo dõi tải từng consultant và năng lực chính đang giữ lịch.</p>
                </div>
              </div>
              <button className="dashboard-table-action primary" onClick={() => setIsAllocModalOpen(true)} type="button">
                <ShopifyIcon name="plus" size={14} />
                Phân bổ nguồn lực
              </button>
            </div>

            <div className="dashboard-status-table-wrap dashboard-resource-table-wrap">
              <ShopifyDataTable
                ariaLabel="Phân bổ nguồn lực theo tuần"
                columns={[
                  { key: "consultant", header: "Nhân sự / Vai trò", width: "22%" },
                  ...weeksList.map((week) => ({ key: week, header: week, width: "11%" })),
                  { key: "skills", header: "Năng lực chính", width: "34%" }
                ]}
                minWidth={1040}
                rows={consultants.map((c) => ({
                  key: c.id,
                  cells: [
                    (
                      <div className="dashboard-util-person">
                        <div className="dashboard-util-avatar">
                          {c.name.split(" ").map(n => n[0]).join("")}
                        </div>
                        <div className="dashboard-util-name">
                          <strong>{c.name}</strong>
                          <span>{c.role}</span>
                        </div>
                      </div>
                    ),
                    ...weeksList.map((w) => {
                      const { allocated, percentage, tone, statusText } = getUtilizationData(c, w);
                      const normalizedTone = tone === "critical" ? "danger" : tone;

                      return (
                        <div className="dashboard-util-cell">
                          <div className="dashboard-util-meta">
                            <strong>{allocated}d</strong>
                            <span>{percentage}%</span>
                          </div>
                          <div className="dashboard-util-bar-track">
                            {percentage > 0 ? (
                              <div
                                className={`dashboard-util-bar-fill tone-${normalizedTone}`}
                                style={{ width: `${Math.min(percentage, 120)}%` }}
                              />
                            ) : null}
                          </div>
                          <DashboardChip tone={normalizedTone}>{statusText}</DashboardChip>
                        </div>
                      );
                    }),
                    (
                      <div className="dashboard-skill-list">
                        {c.skills.map(s => (
                          <span className="dashboard-skill-pill" key={s}>
                            {s}
                          </span>
                        ))}
                      </div>
                    )
                  ]
                }))}
              />
            </div>
          </article>

          {/* Allocation Modal */}
          <ShopifyModal open={isAllocModalOpen} onClose={() => setIsAllocModalOpen(false)} title="Phân bổ nguồn lực cho dự án">
            <div className="shopify-form-stack" style={{ padding: "8px" }}>
              <s-paragraph>
                Gán năng lực consultant cho dự án trong tuần cụ thể. Hệ thống sẽ tự động đối chiếu với ngưỡng overbooking.
              </s-paragraph>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Chọn nhân sự</label>
                <select
                  value={selectedConsultant}
                  onChange={e => setSelectedConsultant(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
                >
                  {consultants.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Dự án</label>
                <select
                  value={selectedProject}
                  onChange={e => setSelectedProject(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
                >
                  {availableProjects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Tuần làm việc</label>
                  <select
                    value={selectedWeek}
                    onChange={e => setSelectedWeek(e.target.value)}
                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
                  >
                    {weeksList.map(w => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Số ngày phân bổ (PD)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="7"
                    value={inputDays}
                    onChange={e => setInputDays(e.target.value)}
                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Trạng thái</label>
                <div style={{ display: "flex", gap: "16px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="radio"
                      name="allocStatus"
                      checked={inputAllocStatus === "confirmed"}
                      onChange={() => setInputAllocStatus("confirmed")}
                    />
                    Đã xác nhận
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="radio"
                      name="allocStatus"
                      checked={inputAllocStatus === "reserved"}
                      onChange={() => setInputAllocStatus("reserved")}
                    />
                    Giữ lịch
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="radio"
                      name="allocStatus"
                      checked={inputAllocStatus === "tentative"}
                      onChange={() => setInputAllocStatus("tentative")}
                    />
                    Tạm giữ
                  </label>
                </div>
              </div>
              <div className="shopify-action-row end" style={{ marginTop: "16px" }}>
                <s-button onClick={() => setIsAllocModalOpen(false)}>Hủy</s-button>
                <s-button onClick={handleCreateAllocation} variant="primary">Lưu phân bổ</s-button>
              </div>
            </div>
          </ShopifyModal>
        </div>
      )}

      {/* ── 5. Tab: Finance & Controls ── */}
      {activeTab === "finance" && (
        <div className="dashboard-sales dashboard-detail-workbench">
          <section className="sales-hero" aria-label="Tình hình tài chính và kiểm soát">
            <div>
              <p className="dashboard-eyebrow">Tài chính & kiểm soát</p>
              <h2>{roleMode === "consultant" ? "Ẩn dữ liệu nhạy cảm theo vai trò" : "Theo dõi biên và chi phí dự án"}</h2>
              <p>
                Kiểm tra doanh thu hợp đồng, giờ trực tiếp, margin và các khoản cần xử lý trước khi ghi nhận chi phí.
              </p>
            </div>
            <div className="dashboard-role-switcher" aria-label="Góc nhìn dữ liệu">
              <span>Góc nhìn dữ liệu</span>
              <s-button onClick={() => setRoleMode("founder")} variant={roleMode === "founder" ? "primary" : undefined}>Founder / Finance</s-button>
              <s-button onClick={() => setRoleMode("delivery_lead")} variant={roleMode === "delivery_lead" ? "primary" : undefined}>Delivery Lead</s-button>
              <s-button onClick={() => setRoleMode("consultant")} variant={roleMode === "consultant" ? "primary" : undefined}>Consultant</s-button>
            </div>
          </section>

          <section className="dashboard-metric-grid dashboard-detail-metric-grid" aria-label="Chỉ số tài chính dự án">
            <DashboardMetricCard
              icon="cash"
              label="Doanh thu hợp đồng"
              tone="finance"
              value={roleMode === "consultant" ? "Đang ẩn" : <MoneyAmount value={totalProjectRevenue} />}
              detail="Tổng giá trị hợp đồng trong danh mục dự án đang theo dõi."
              chips={<DashboardChip tone={roleMode === "consultant" ? "neutral" : "success"}>{roleMode === "consultant" ? "Ẩn theo vai trò" : "Giá trị hợp đồng"}</DashboardChip>}
            />
            <DashboardMetricCard
              icon="clock"
              label="Giờ trực tiếp"
              tone="delivery"
              value={`${totalProjectHours}h`}
              detail="Tổng effort đã ghi nhận vào các dự án trong danh mục."
              chips={<DashboardChip tone="info">Accumulated effort</DashboardChip>}
            />
            <DashboardMetricCard
              icon="trend"
              label="Biên trung bình"
              tone="finance"
              value={roleMode === "founder" ? "53%" : "Đang ẩn"}
              detail="So sánh với target biên trực tiếp 50%."
              chips={<DashboardChip tone={roleMode === "founder" ? "success" : "neutral"}>{roleMode === "founder" ? "Trên target" : "Ẩn theo vai trò"}</DashboardChip>}
            />
            <DashboardMetricCard
              icon="alert"
              label="Công nợ quá hạn"
              tone="warning"
              value="1 khoản"
              detail="Khoản cần theo dõi trước khi cập nhật dòng tiền."
              chips={<DashboardChip tone="warning">Hóa đơn kickoff</DashboardChip>}
            />
          </section>

          {roleMode === "founder" && <ProjectProfitabilityChart projects={projects} />}

          <div className="finance-dashboard-stack">
            {roleMode === "consultant" ? (
              <article className="dashboard-panel finance-timesheet-panel" aria-label="Gửi bảng giờ tuần">
                <div className="dashboard-panel-titlebar">
                  <div className="dashboard-panel-header">
                    <span className="dashboard-panel-icon">
                      <ShopifyIcon name="clock" size={15} />
                    </span>
                    <div>
                      <h3>Gửi bảng giờ tuần</h3>
                      <p>Ghi nhận effort theo dự án để delivery lead duyệt.</p>
                    </div>
                  </div>
                  <DashboardChip tone="neutral">Ẩn số liệu nhạy cảm</DashboardChip>
                </div>

                <form onSubmit={handleCreateTimeEntry} className="finance-timesheet-form">
                  <div className="finance-field">
                    <label>Dự án</label>
                    <div className="finance-choice-grid" role="radiogroup" aria-label="Chọn dự án">
                      {projects.map((project) => (
                        <button
                          aria-checked={inputTimeProject === project.name}
                          className="finance-choice-button"
                          data-selected={inputTimeProject === project.name}
                          key={project.id}
                          onClick={() => setInputTimeProject(project.name)}
                          role="radio"
                          type="button"
                        >
                          <span>{project.name}</span>
                          <small><MoneyAmount value={project.revenueBasis} /></small>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="finance-form-grid">
                    <div className="finance-field">
                      <label htmlFor="finance-time-stage">Giai đoạn</label>
                      <input
                        id="finance-time-stage"
                        onChange={e => setInputTimeStage(e.target.value)}
                        type="text"
                        value={inputTimeStage}
                      />
                    </div>
                    <div className="finance-field">
                      <label htmlFor="finance-time-hours">Số giờ</label>
                      <input
                        id="finance-time-hours"
                        max="24"
                        min="1"
                        onChange={e => setInputTimeHours(e.target.value)}
                        type="number"
                        value={inputTimeHours}
                      />
                    </div>
                  </div>

                  <div className="finance-field">
                    <label>Loại công việc</label>
                    <div className="finance-worktype-row" role="radiogroup" aria-label="Chọn loại công việc">
                      {["Billable Delivery", "Non-billable Delivery", "Rework", "Internal/Admin"].map((workType) => (
                        <button
                          aria-checked={inputTimeWorkType === workType}
                          className="finance-worktype-button"
                          data-selected={inputTimeWorkType === workType}
                          key={workType}
                          onClick={() => setInputTimeWorkType(workType)}
                          role="radio"
                          type="button"
                        >
                          {getWorkTypeLabel(workType)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="finance-field">
                    <label htmlFor="finance-time-note">Ghi chú</label>
                    <textarea
                      id="finance-time-note"
                      onChange={e => setInputTimeNote(e.target.value)}
                      placeholder="Mô tả đầu việc đã xử lý..."
                      required
                      value={inputTimeNote}
                    />
                  </div>

                  <div className="shopify-action-row end">
                    <s-button type="submit" variant="primary">Gửi giờ</s-button>
                  </div>
                </form>
              </article>
            ) : (
              <div className="finance-dashboard-stack">
                <article className="dashboard-panel dashboard-resource-table-card finance-pl-table-card" aria-label="Tổng hợp P&L dự án">
                  <div className="dashboard-panel-titlebar">
                    <div className="dashboard-panel-header">
                      <span className="dashboard-panel-icon finance">
                        <ShopifyIcon name="cash" size={15} />
                      </span>
                      <div>
                        <h3>Tổng hợp P&L dự án</h3>
                        <p>{roleMode === "founder" ? "Theo dõi doanh thu, burn chi phí và biên dự báo." : "Ẩn chi phí nhạy cảm, giữ tín hiệu effort và trạng thái."}</p>
                      </div>
                    </div>
                    <DashboardChip tone={roleMode === "founder" ? "success" : "neutral"}>
                      {roleMode === "founder" ? "Đủ dữ liệu tài chính" : "Ẩn chi phí"}
                    </DashboardChip>
                  </div>
                  {(() => {
                    const isFounder = roleMode === "founder";
                    const columns = [
                      { key: "project", header: "Dự án", width: isFounder ? "20%" : "30%" },
                      { key: "revenue", header: "Doanh thu hợp đồng", width: isFounder ? "12%" : "18%" },
                      { key: "effort", header: "Giờ kế hoạch / thực tế", width: isFounder ? "14%" : "18%" },
                      { key: "variance", header: "Chênh lệch", width: isFounder ? "14%" : "18%" },
                      ...(isFounder ? [
                        { key: "cost", header: "Chi phí trực tiếp", width: "18%" },
                        { key: "margin", header: "Biên dự báo", width: "12%" }
                      ] : []),
                      { key: "state", header: "Trạng thái P&L", width: isFounder ? "10%" : "16%" }
                    ];

                    return (
                      <div className="dashboard-status-table-wrap finance-pl-table-wrap">
                        <ShopifyDataTable
                          ariaLabel="Tổng hợp lời lỗ trực tiếp theo dự án"
                          columns={columns}
                          minWidth={isFounder ? 1120 : 860}
                          rows={projects.map(p => {
                              const financials = getProjectProfitabilityDatum(p);
                              const varianceTone = financials.varianceHours > 0 ? "danger" : "success";
                              const costTone = financials.costBurnPct > 100 ? "danger" : financials.costBurnPct >= 90 ? "success" : "info";
                              const effortBurnPct = p.plannedHours > 0 ? Math.min(Math.round((p.actualHours / p.plannedHours) * 100), 120) : 0;

                              return {
                                key: p.id,
                                cells: [
                                  (
                                    <div className="dashboard-util-person">
                                      <span className="dashboard-util-avatar finance-avatar">
                                        <ShopifyIcon name="cash" size={14} />
                                      </span>
                                      <span className="dashboard-util-name">
                                        <strong>{p.name}</strong>
                                        <span>Target biên {p.targetMargin}%</span>
                                      </span>
                                    </div>
                                  ),
                                  <strong className="finance-table-money"><MoneyAmount value={p.revenueBasis} /></strong>,
                                  (
                                    <div className="dashboard-util-cell finance-effort-cell">
                                      <div className="dashboard-util-meta">
                                        <strong>{p.actualHours}h</strong>
                                        <span>/ {p.plannedHours}h</span>
                                      </div>
                                      <span className="dashboard-util-bar-track">
                                        <span
                                          className={`dashboard-util-bar-fill tone-${p.actualHours > p.plannedHours ? "danger" : "success"}`}
                                          style={{ width: `${effortBurnPct}%` }}
                                        />
                                      </span>
                                    </div>
                                  ),
                                  (
                                    <span className={`finance-variance-pill tone-${varianceTone}`}>
                                      {financials.varianceHours > 0 ? "+" : ""}{financials.varianceHours}h ({financials.variancePct > 0 ? "+" : ""}{financials.variancePct}%)
                                    </span>
                                  ),
                                  ...(isFounder ? [
                                    (
                                      <div className="dashboard-util-cell finance-cost-cell">
                                        <div className="dashboard-util-meta">
                                          <strong><MoneyAmount value={financials.actualCost} /></strong>
                                          <span>kế hoạch <MoneyAmount value={financials.plannedCost} /></span>
                                        </div>
                                        <span className="dashboard-util-bar-track">
                                          <span
                                            className={`dashboard-util-bar-fill tone-${costTone}`}
                                            style={{ width: `${Math.min(financials.costBurnPct, 120)}%` }}
                                          />
                                        </span>
                                      </div>
                                    ),
                                    (
                                      <div className="finance-margin-cell">
                                        <strong className={financials.margin < financials.targetMargin ? "tone-danger" : "tone-success"}>
                                          {financials.margin}%
                                        </strong>
                                        <span>{financials.marginGap >= 0 ? "+" : ""}{financials.marginGap}% so với target</span>
                                      </div>
                                    )
                                  ] : []),
                                  <DashboardChip tone={financials.stateTone}>{financials.stateLabel}</DashboardChip>
                                ]
                              };
                            })}
                        />
                      </div>
                    );
                  })()}
                </article>

                {roleMode === "delivery_lead" && (
                  <p className="finance-privacy-note">
                    <ShopifyIcon name="info" size={14} /> <strong>Bảo mật phân quyền:</strong> Chi phí nhân sự, tổng chi phí thực tế và biên lợi nhuận được ẩn đối với Delivery Lead.
                  </p>
                )}

                {roleMode === "delivery_lead" && (
                  <article className="dashboard-panel finance-timesheet-review-card" aria-label="Bảng giờ chờ duyệt">
                    <div className="dashboard-panel-titlebar">
                      <div className="dashboard-panel-header">
                        <span className="dashboard-panel-icon">
                          <ShopifyIcon name="clock" size={15} />
                        </span>
                        <div>
                          <h3>Bảng giờ chờ duyệt</h3>
                          <p>Chỉ hiển thị các bản ghi cần quyết định trong tuần.</p>
                        </div>
                      </div>
                      <DashboardChip tone="warning">{timeEntries.filter(te => te.status === "submitted").length} chờ</DashboardChip>
                    </div>

                    <div className="finance-timesheet-list">
                      {timeEntries.filter(te => te.status === "submitted").length ? (
                        timeEntries.filter(te => te.status === "submitted").map(te => (
                          <div
                            className="finance-timesheet-card"
                            key={te.id}
                          >
                            <div className="finance-timesheet-head">
                              <div className="dashboard-util-person">
                                <span className="dashboard-util-avatar">
                                  {te.consultant.split(" ").map(n => n[0]).join("")}
                                </span>
                                <span className="dashboard-util-name">
                                  <strong>{te.consultant}</strong>
                                  <span>{te.project}</span>
                                </span>
                              </div>

                              <DashboardChip tone="warning">{te.hours}h</DashboardChip>
                            </div>

                            <DashboardChip tone={te.billable ? "success" : "neutral"}>{getWorkTypeLabel(te.workType)}</DashboardChip>

                            <p className="finance-timesheet-note">{te.note}</p>

                            <div className="finance-timesheet-actions">
                              <s-button onClick={() => handleApproveEntry(te.id)} variant="primary">Duyệt</s-button>
                              <s-button onClick={() => setToastMessage("Đã đánh dấu từ chối bảng giờ.")}>Từ chối</s-button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="shopify-muted">Tất cả bảng giờ đã duyệt.</p>
                      )}
                    </div>
                  </article>
                )}
              </div>
            )}
          </div>
        </div>
      )}



      <OverviewActionModal
        consultants={consultants}
        isPipelineRestricted={isPipelineRestricted}
        mode={overviewModal}
        onClose={() => setOverviewModal(null)}
        onPrimaryAction={handleOverviewModalPrimaryAction}
        open={overviewModal !== null}
        openCount={pipelineStats.openCount}
        projects={projects}
        staleCount={staleCount}
        timeEntries={timeEntries}
        visiblePipeline={visiblePipeline}
      />
      <OpportunityDrawers workbench={workbench} />
    </>
  );
}

function getSalesOwnersFromOpportunities(opportunities: OpportunitySummary[]): SalesOwnerSummary[] {
  const owners = new Map<string, SalesOwnerSummary>();
  opportunities.forEach((opportunity) => {
    if (!opportunity.ownerUserId || !opportunity.ownerDisplayName) {
      return;
    }

    owners.set(opportunity.ownerUserId, {
      id: opportunity.ownerUserId,
      displayName: opportunity.ownerDisplayName,
      email: "",
      roleCodes: []
    });
  });

  return [...owners.values()];
}
