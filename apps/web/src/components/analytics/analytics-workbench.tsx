"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Download,
  Filter,
  RefreshCw,
  X
} from "lucide-react";
import type {
  AnalyticsBreakdownBy,
  AnalyticsBreakdownRow,
  AnalyticsFilterOption,
  AnalyticsMetricKey,
  AnalyticsMetricValue,
  WorkforceProjectsBreakdownResponse,
  WorkforceProjectsSummaryResponse
} from "@b2b-crm/contracts";
import { ANALYTICS_METRIC_DEFINITIONS } from "@b2b-crm/contracts";
import { ModalLayer } from "../modal-layer";
import {
  ANALYTICS_DEFAULT_STATE,
  buildAnalyticsApiQuery,
  buildBreakdownApiQuery,
  countActiveFilters,
  defaultBreakdownByForView,
  exclusiveEndDateToInclusiveEndDate,
  parseAnalyticsSearchParams,
  resolvePresetRange,
  serializeAnalyticsState,
  withFilterChange,
  type AnalyticsUiState,
  type AnalyticsView
} from "@/lib/analytics-url-state";
import { downloadCsv } from "@/lib/csv-export";
import { formatHours, formatPercent, SERIES_COLORS } from "./analytics-format";
import { AnalyticsFilterControls } from "./analytics-filter-controls";
import { WorkspaceTabBar, type WorkspaceTabItem } from "@/components/workspace-tab-bar";
import {
  ANALYTICS_BREAKDOWN_LABELS,
  ANALYTICS_METRIC_LABELS,
  analyticsUnavailableLabel,
  businessStatusLabel,
  businessWarningLabel
} from "./analytics-copy";

/* Recharts widgets are lazy-loaded so the analytics route bundle stays lean. */
const chartLoading = () => <div className="h-[280px] animate-pulse rounded-lg bg-muted" aria-hidden />;
const TrendComposedChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.TrendComposedChart })), { ssr: false, loading: chartLoading });
const EffortGroupedChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.EffortGroupedChart })), { ssr: false, loading: chartLoading });
const CapacityStackedChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.CapacityStackedChart })), { ssr: false, loading: chartLoading });
const VarianceChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.VarianceChart })), { ssr: false, loading: chartLoading });
const ResourceComparisonChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.ResourceComparisonChart })), { ssr: false, loading: chartLoading });
const StatusDistributionChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.StatusDistributionChart })), { ssr: false, loading: chartLoading });
const WorkMixBar = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.WorkMixBar })), { ssr: false, loading: () => <div className="h-14 animate-pulse rounded-lg bg-muted" aria-hidden /> });

const VIEW_TABS: WorkspaceTabItem<AnalyticsView>[] = [
  { id: "overview", label: "Tổng quan", description: "KPI toàn workspace" },
  { id: "workforce", label: "Nhân lực", description: "Giờ & mức độ đầy đủ" },
  { id: "projects", label: "Dự án", description: "So sánh theo project" },
  { id: "resources", label: "Phân bổ nguồn lực", description: "Capacity & allocation" }
];

type WidgetStatus = "loading" | "ready" | "updating" | "empty" | "error" | "forbidden" | "stale";

interface FetchSlot<T> {
  data?: T;
  status: "loading" | "ready" | "updating" | "error" | "forbidden";
  errorMessage?: string;
  /** true when the shown data came from an earlier successful request */
  isStale?: boolean;
}

async function fetchAnalyticsJson<T>(url: string, signal: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const response = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.message === "string") message = body.message;
    } catch {
      /* keep HTTP status message */
    }
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: (await response.json()) as T };
}

export function AnalyticsWorkbench() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseAnalyticsSearchParams(new URLSearchParams(searchParams.toString())), [searchParams]);

  const summaryQuery = useMemo(() => buildAnalyticsApiQuery(state), [state]);
  const breakdownQuery = useMemo(() => buildBreakdownApiQuery(state), [state]);

  const [summarySlot, setSummarySlot] = useState<FetchSlot<WorkforceProjectsSummaryResponse>>({ status: "loading" });
  const [breakdownSlot, setBreakdownSlot] = useState<FetchSlot<WorkforceProjectsBreakdownResponse>>({ status: "loading" });
  const [summaryRetryToken, setSummaryRetryToken] = useState(0);
  const [breakdownRetryToken, setBreakdownRetryToken] = useState(0);
  const [copied, setCopied] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileFilterDraft, setMobileFilterDraft] = useState<AnalyticsUiState | null>(null);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const cursorStack = useRef<string[]>([]);

  const closeMobileFilters = useCallback(() => {
    setMobileFiltersOpen(false);
    window.requestAnimationFrame(() => mobileFilterTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSummarySlot((current) => (current.data ? { ...current, status: "updating" } : { status: "loading" }));
    fetchAnalyticsJson<WorkforceProjectsSummaryResponse>(`/api/analytics/workforce-projects/summary?${summaryQuery}`, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setSummarySlot({ status: "ready", data: result.data, isStale: false });
        } else if (result.status === 401 || result.status === 403) {
          setSummarySlot({ status: "forbidden", errorMessage: result.message });
        } else {
          setSummarySlot((current) => ({
            status: current.data ? "ready" : "error",
            data: current.data,
            errorMessage: result.message,
            isStale: Boolean(current.data)
          }));
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSummarySlot((current) => ({
          status: current.data ? "ready" : "error",
          data: current.data,
          errorMessage: error instanceof Error ? error.message : "Network error",
          isStale: Boolean(current.data)
        }));
      });
    return () => controller.abort();
  }, [summaryQuery, summaryRetryToken]);

  useEffect(() => {
    const controller = new AbortController();
    setBreakdownSlot((current) => (current.data ? { ...current, status: "updating" } : { status: "loading" }));
    fetchAnalyticsJson<WorkforceProjectsBreakdownResponse>(`/api/analytics/workforce-projects/breakdown?${breakdownQuery}`, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setBreakdownSlot({ status: "ready", data: result.data, isStale: false });
        } else if (result.status === 401 || result.status === 403) {
          setBreakdownSlot({ status: "forbidden", errorMessage: result.message });
        } else {
          setBreakdownSlot((current) => ({
            status: current.data ? "ready" : "error",
            data: current.data,
            errorMessage: result.message,
            isStale: Boolean(current.data)
          }));
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBreakdownSlot((current) => ({
          status: current.data ? "ready" : "error",
          data: current.data,
          errorMessage: error instanceof Error ? error.message : "Network error",
          isStale: Boolean(current.data)
        }));
      });
    return () => controller.abort();
  }, [breakdownQuery, breakdownRetryToken]);

  const commit = useCallback(
    (next: AnalyticsUiState, options: { replace?: boolean } = {}) => {
      const query = serializeAnalyticsState(next);
      const href = query.length > 0 ? `${pathname}?${query}` : pathname;
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router]
  );

  const applyFilterChange = useCallback(
    (change: Partial<AnalyticsUiState>) => {
      cursorStack.current = [];
      commit(withFilterChange(state, change));
    },
    [commit, state]
  );

  const setView = useCallback(
    (view: AnalyticsView) => {
      cursorStack.current = [];
      commit(withFilterChange(state, { view, by: defaultBreakdownByForView(view) }));
    },
    [commit, state]
  );

  const resetFilters = useCallback(() => {
    cursorStack.current = [];
    commit({ ...ANALYTICS_DEFAULT_STATE, view: state.view, by: defaultBreakdownByForView(state.view) });
  }, [commit, state.view]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const summary = summarySlot.data;
  const breakdown = breakdownSlot.data;
  const range = resolvePresetRange(state);
  const activeFilterCount = countActiveFilters(state);

  const exportCsv = useCallback(() => {
    if (!breakdown) return;
    const metricKeys: AnalyticsMetricKey[] = [
      "reviewedApprovedMinutes",
      "legacyApprovedMinutes",
      "submittedMinutes",
      "scheduledMinutes",
      "allocationMinutes",
      "estimateMinutes",
      "capacityMinutes",
      "actualUtilization",
      "taskCompletionRate",
      "onTimeCompletionRate",
      "overdueTasks"
    ];
    const headers = ["Mã", "Tên", "Phân loại", ...metricKeys.map((key) => ANALYTICS_METRIC_LABELS[key])];
    const rows = [
      ...breakdown.rows.map((row) => [
        row.id,
        row.label,
        ANALYTICS_BREAKDOWN_LABELS[row.kind] ?? row.kind,
        ...metricKeys.map((key) => row.metrics[key] ?? null)
      ]),
      [
        "tong-cong",
        "Tổng toàn bộ dữ liệu đã lọc",
        ANALYTICS_BREAKDOWN_LABELS[breakdown.meta.by] ?? breakdown.meta.by,
        ...metricKeys.map((key) => breakdown.totals[key] ?? null)
      ]
    ];
    const inclusiveTo = exclusiveEndDateToInclusiveEndDate(range.to) ?? range.to;
    downloadCsv(`phan-tich-${breakdown.meta.by}-${range.from}-${inclusiveTo}.csv`, headers, rows);
  }, [breakdown, range.from, range.to]);

  const goNextPage = useCallback(() => {
    if (!breakdown?.nextCursor) return;
    cursorStack.current = [...cursorStack.current, state.cursor ?? ""];
    commit({ ...state, cursor: breakdown.nextCursor });
  }, [breakdown, commit, state]);

  const goPreviousPage = useCallback(() => {
    const previous = cursorStack.current.pop();
    commit({ ...state, cursor: previous === "" || previous === undefined ? undefined : previous });
  }, [commit, state]);

  if (summarySlot.status === "forbidden") {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center" role="alert">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
        <h2 className="mt-3 text-base font-bold text-foreground">Không có quyền xem phân tích vận hành</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tài khoản của bạn không được phép xem phân tích nhân lực nội bộ. Hãy liên hệ quản trị viên nếu bạn cần quyền truy cập.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* View tabs */}
      <div className="space-y-2">
        <WorkspaceTabBar
          items={VIEW_TABS}
          value={state.view}
          onChange={setView}
          ariaLabel="Chế độ xem phân tích"
          idPrefix="analytics"
          className="w-full"
        />
        <div className="flex min-h-5 items-center justify-end px-1 text-[11px] text-muted-foreground">
          {summary ? (
            <span>
              {summary.meta.range.from.slice(0, 10)} → {exclusiveEndDateToInclusiveEndDate(summary.meta.range.to.slice(0, 10)) ?? summary.meta.range.to.slice(0, 10)} · Giờ Việt Nam · cập nhật {new Date(summary.meta.generatedAt).toLocaleTimeString("vi-VN")}
            </span>
          ) : null}
        </div>
      </div>

      {/* Desktop filter bar */}
      <div className="hidden lg:block">
        <AnalyticsFilterControls
          state={state}
          summary={summary}
          onChange={applyFilterChange}
          onReset={resetFilters}
          onCopyLink={copyLink}
          onExportCsv={exportCsv}
          copied={copied}
          csvReady={Boolean(breakdown && breakdown.rows.length > 0)}
        />
      </div>

      {/* Mobile filter trigger + sheet */}
      <div className="lg:hidden">
        <button
          ref={mobileFilterTriggerRef}
          type="button"
          onClick={() => {
            setMobileFilterDraft(state);
            setMobileFiltersOpen(true);
          }}
          aria-expanded={mobileFiltersOpen}
          aria-controls="analytics-mobile-filter-dialog"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground"
        >
          <Filter className="h-4 w-4" aria-hidden /> Bộ lọc
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{activeFilterCount}</span>
          ) : null}
        </button>
        {mobileFiltersOpen && mobileFilterDraft ? (
          <ModalLayer onClose={closeMobileFilters}>
          <div className="fixed inset-0 z-50 flex items-end bg-overlay" aria-hidden="false">
            <div
              id="analytics-mobile-filter-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="analytics-mobile-filter-title"
              className="flex max-h-[90vh] w-full flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h2 id="analytics-mobile-filter-title" className="text-base font-bold text-foreground">Bộ lọc phân tích</h2>
                  <p className="text-[11px] text-muted-foreground">Các thay đổi chỉ áp dụng khi bạn xác nhận.</p>
                </div>
                <button type="button" onClick={closeMobileFilters} aria-label="Đóng bộ lọc" className="min-h-11 min-w-11 rounded-lg p-2 text-muted-foreground hover:bg-muted">
                  <X className="mx-auto h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <AnalyticsFilterControls
                  mode="mobile"
                  state={mobileFilterDraft}
                  summary={summary}
                  onChange={(change) => setMobileFilterDraft((current) => current ? { ...current, ...change, cursor: undefined } : current)}
                  onReset={() => setMobileFilterDraft({ ...ANALYTICS_DEFAULT_STATE, view: state.view, by: defaultBreakdownByForView(state.view) })}
                  onCopyLink={copyLink}
                  onExportCsv={exportCsv}
                  copied={copied}
                  csvReady={Boolean(breakdown && breakdown.rows.length > 0)}
                />
              </div>
              <div className="sticky bottom-0 flex shrink-0 gap-2 border-t border-border bg-card p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
                <button type="button" onClick={() => setMobileFilterDraft({ ...ANALYTICS_DEFAULT_STATE, view: state.view, by: defaultBreakdownByForView(state.view) })} className="min-h-11 flex-1 rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted">Đặt lại</button>
                <button
                  type="button"
                  onClick={() => {
                    cursorStack.current = [];
                    commit(withFilterChange(state, mobileFilterDraft));
                    closeMobileFilters();
                  }}
                  className="min-h-11 flex-[2] rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
                >
                  Áp dụng bộ lọc
                </button>
              </div>
            </div>
          </div>
          </ModalLayer>
        ) : null}
      </div>

      <ActiveFilterChips state={state} summary={summary} onChange={applyFilterChange} />

      {/* Stale / error banners keep last-good evidence visible */}
      {summarySlot.isStale ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-foreground" role="status">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            Chưa tải được dữ liệu mới. Đang hiển thị kết quả gần nhất đã tải thành công.
          </span>
          <button type="button" onClick={() => setSummaryRetryToken((token) => token + 1)} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-semibold text-foreground">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Thử lại
          </button>
        </div>
      ) : null}

      {summarySlot.status === "error" ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center" role="alert">
          <p className="text-sm font-semibold text-foreground">Không tải được dữ liệu phân tích</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Hệ thống chưa thể tải dữ liệu. Không có số liệu thay thế hoặc số 0 giả được hiển thị.</p>
          <button
            type="button"
            onClick={() => setSummaryRetryToken((token) => token + 1)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-foreground hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Thử lại
          </button>
        </div>
      ) : (
        <>
          <KpiStrip view={state.view} summary={summary} loading={summarySlot.status === "loading"} updating={summarySlot.status === "updating"} compare={state.compare === "previous"} />

          {state.view === "overview" ? <TaskTypeMixPanel summary={summary} /> : null}

          {state.view === "overview" ? (
            <OverviewView summary={summary} slot={summarySlot} onRetry={() => setSummaryRetryToken((token) => token + 1)} compare={state.compare === "previous"} />
          ) : null}
          {state.view === "workforce" ? (
            <WorkforceView summary={summary} slot={summarySlot} onRetry={() => setSummaryRetryToken((token) => token + 1)} />
          ) : null}
          {state.view === "projects" ? (
            <ProjectsView summary={summary} slot={summarySlot} onRetry={() => setSummaryRetryToken((token) => token + 1)} onSelectProject={(id) => router.push(`/projects/${id}?tab=Dashboard`)} />
          ) : null}
          {state.view === "resources" ? (
            <ResourcesView summary={summary} slot={summarySlot} onRetry={() => setSummaryRetryToken((token) => token + 1)} />
          ) : null}

          <DataQualityPanel summary={summary} />

          <BreakdownTable
            state={state}
            slot={breakdownSlot}
            onChangeBy={(by) => applyFilterChange({ by })}
            onChangeSort={(sort, direction) => applyFilterChange({ sort, direction })}
            onNextPage={goNextPage}
            onPreviousPage={goPreviousPage}
            hasPrevious={Boolean(state.cursor)}
            onRetry={() => setBreakdownRetryToken((token) => token + 1)}
            onExportCsv={exportCsv}
          />
        </>
      )}
    </div>
  );
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

function ActiveFilterChips({ state, summary, onChange }: {
  state: AnalyticsUiState;
  summary?: WorkforceProjectsSummaryResponse;
  onChange: (change: Partial<AnalyticsUiState>) => void;
}) {
  const options = summary?.filterOptions;
  const labelFor = (list: AnalyticsFilterOption[] | undefined, id: string) => list?.find((option) => option.id === id)?.label ?? id;
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  for (const id of state.departmentIds) chips.push({ key: `dept-${id}`, label: `Phòng ban: ${labelFor(options?.departments, id)}`, onRemove: () => onChange({ departmentIds: state.departmentIds.filter((value) => value !== id) }) });
  for (const id of state.teamIds) chips.push({ key: `team-${id}`, label: `Nhóm: ${labelFor(options?.teams, id)}`, onRemove: () => onChange({ teamIds: state.teamIds.filter((value) => value !== id) }) });
  for (const id of state.userIds) chips.push({ key: `user-${id}`, label: `Nhân sự: ${labelFor(options?.users, id)}`, onRemove: () => onChange({ userIds: state.userIds.filter((value) => value !== id) }) });
  for (const id of state.accountIds) chips.push({ key: `acc-${id}`, label: `Khách hàng: ${labelFor(options?.accounts, id)}`, onRemove: () => onChange({ accountIds: state.accountIds.filter((value) => value !== id) }) });
  for (const id of state.projectIds) chips.push({ key: `prj-${id}`, label: `Dự án: ${labelFor(options?.projects, id)}`, onRemove: () => onChange({ projectIds: state.projectIds.filter((value) => value !== id) }) });
  for (const id of state.projectStatuses) chips.push({ key: `ps-${id}`, label: `Trạng thái dự án: ${businessStatusLabel(labelFor(options?.projectStatuses, id))}`, onRemove: () => onChange({ projectStatuses: state.projectStatuses.filter((value) => value !== id) }) });
  for (const id of state.taskStatuses) chips.push({ key: `ts-${id}`, label: `Trạng thái công việc: ${businessStatusLabel(labelFor(options?.taskStatuses, id))}`, onRemove: () => onChange({ taskStatuses: state.taskStatuses.filter((value) => value !== id) }) });
  for (const id of state.workTypes) chips.push({ key: `wt-${id}`, label: `Loại công việc: ${businessStatusLabel(labelFor(options?.workTypes, id))}`, onRemove: () => onChange({ workTypes: state.workTypes.filter((value) => value !== id) }) });
  for (const id of state.taskTypeLayer1Ids) chips.push({ key: `tt1-${id}`, label: `Task Type: ${labelFor(options?.taskTypeLayer1, id)}`, onRemove: () => onChange({ taskTypeLayer1Ids: state.taskTypeLayer1Ids.filter((value) => value !== id) }) });
  for (const id of state.taskTypeLayer2Ids) chips.push({ key: `tt2-${id}`, label: `Bối cảnh: ${labelFor(options?.taskTypeLayer2, id)}`, onRemove: () => onChange({ taskTypeLayer2Ids: state.taskTypeLayer2Ids.filter((value) => value !== id) }) });
  if (state.billable !== "all") chips.push({ key: "billable", label: state.billable === "billable" ? "Chỉ giờ có tính phí" : "Chỉ giờ không tính phí", onRemove: () => onChange({ billable: "all" }) });

  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Bộ lọc đang áp dụng">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11.5px] font-medium text-primary">
          {chip.label}
          <button type="button" onClick={chip.onRemove} aria-label={`Bỏ lọc ${chip.label}`} className="rounded-full p-0.5 hover:bg-primary/10">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}

/* ── KPI strip ───────────────────────────────────────────────────────────── */

const KPI_KEYS_BY_VIEW: Record<AnalyticsView, AnalyticsMetricKey[]> = {
  overview: ["reviewedApprovedMinutes", "projectsTouched", "actualUtilization", "onTimeCompletionRate"],
  workforce: ["reviewedApprovedMinutes", "billableRatio", "actualUtilization", "overbookedPeople"],
  projects: ["estimateMinutes", "reviewedApprovedMinutes", "taskCompletionRate", "medianCycleTimeDays"],
  resources: ["capacityMinutes", "allocationMinutes", "plannedUtilization", "overbookedPeople"]
};

function formatMetric(metric: AnalyticsMetricValue): string {
  if (metric.value === null) return analyticsUnavailableLabel(metric.key);
  const unit = ANALYTICS_METRIC_DEFINITIONS[metric.key]?.unit;
  if (unit === "minutes") return formatHours(metric.value);
  if (unit === "percent") return formatPercent(metric.value);
  if (unit === "days") return `${metric.value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} ngày`;
  return metric.value.toLocaleString("vi-VN");
}

function stateBadge(metric: AnalyticsMetricValue): { label: string; className: string } {
  if (metric.state === "available") return { label: "Đã đối soát", className: "bg-success/10 text-success" };
  if (metric.state === "partial") return { label: "Cần bổ sung dữ liệu", className: "bg-warning/10 text-warning" };
  return { label: "Chưa đủ dữ liệu", className: "bg-muted text-muted-foreground" };
}

function KpiStrip({ view, summary, loading, updating, compare }: {
  view: AnalyticsView;
  summary?: WorkforceProjectsSummaryResponse;
  loading: boolean;
  updating: boolean;
  compare: boolean;
}) {
  const keys = KPI_KEYS_BY_VIEW[view];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loading || updating}>
      {keys.map((key) => {
        const metric = summary?.totals.find((item) => item.key === key);
        if (loading || !summary) {
          return <div key={key} className="h-[104px] animate-pulse rounded-xl border border-border bg-card" aria-hidden />;
        }
        if (!metric) return null;
        const dueDateCoverage = summary.totals.find((item) => item.key === "dueDateCoverage");
        const requiresDueDateContext = key === "onTimeCompletionRate";
        const dueDateIncomplete = requiresDueDateContext && (dueDateCoverage?.value === null || dueDateCoverage?.value === undefined || dueDateCoverage.value < 100);
        const displayState = dueDateIncomplete && metric.state === "available" ? { ...metric, state: "partial" as const } : metric;
        const badge = stateBadge(displayState);
        const label = ANALYTICS_METRIC_LABELS[key];
        const value = formatMetric(metric);
        return (
          <div key={key} className="relative min-h-[104px] rounded-xl border border-border bg-card p-4" aria-label={`${label}: ${value}. ${badge.label}`}>
            {updating ? <span className="absolute right-3 top-3 text-[10px] font-semibold text-muted-foreground">Đang cập nhật…</span> : null}
            <p className="text-[12px] font-semibold text-muted-foreground">{label}</p>
            <p className={`mt-1 font-mono font-bold text-foreground ${metric.value === null ? "text-base" : "text-2xl"}`}>{value}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.className}`}>{badge.label}</span>
              {compare && metric.deltaPercent !== null && metric.deltaPercent !== undefined ? (
                <span className={`font-semibold ${metric.deltaPercent >= 0 ? "text-success" : "text-destructive"}`}>
                  {metric.deltaPercent >= 0 ? "▲" : "▼"} {Math.abs(metric.deltaPercent).toLocaleString("vi-VN")}% so kỳ trước
                </span>
              ) : null}
              {metric.coverage ? (
                <span className="text-muted-foreground">
                  Có dữ liệu cho {metric.coverage.covered}/{metric.coverage.total} nhân sự
                </span>
              ) : null}
            </div>
            {requiresDueDateContext ? (
              <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                {dueDateCoverage?.value === null || dueDateCoverage?.value === undefined
                  ? "Chưa xác định được mức đầy đủ ngày hạn."
                  : `${formatPercent(dueDateCoverage.value)} công việc hoàn thành có ngày hạn để đối chiếu.`}
              </p>
            ) : null}
            {metric.warnings && metric.warnings.length > 0 ? (
              <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">{metric.warnings[0]}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── Chart card wrapper: honest widget states + companion table ─────────── */

function ChartCard({ title, description, status, onRetry, table, children, minHeight = 320, footnote }: {
  title: string;
  description: string;
  status: WidgetStatus;
  onRetry?: () => void;
  table?: React.ReactNode;
  children: React.ReactNode;
  minHeight?: number;
  footnote?: string;
}) {
  const headingId = `chart-${title.replaceAll(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <h3 id={headingId} className="text-[14px] font-bold text-foreground">{title}</h3>
          <p className="text-[12px] text-muted-foreground">{description}</p>
        </div>
        {status === "updating" ? <span className="shrink-0 text-[10.5px] font-semibold text-muted-foreground" role="status">Đang cập nhật…</span> : null}
        {status === "stale" && onRetry ? (
          <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">
            <RefreshCw className="h-3 w-3" aria-hidden /> Dữ liệu cũ — thử lại
          </button>
        ) : null}
      </div>
      <div style={{ minHeight }} className="relative flex-1">
        {status === "loading" ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-muted" style={{ minHeight: minHeight - 24 }} aria-hidden />
        ) : status === "empty" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center" style={{ minHeight: minHeight - 24 }}>
            <BarChart3 className="h-6 w-6 text-muted-foreground/60" aria-hidden />
            <p className="text-[13px] text-muted-foreground">Không có dữ liệu trong phạm vi lọc hiện tại.</p>
          </div>
        ) : status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center" style={{ minHeight: minHeight - 24 }} role="alert">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <p className="text-[13px] text-muted-foreground">Widget này không tải được. Không hiển thị số 0 thay thế.</p>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Thử lại
              </button>
            ) : null}
          </div>
        ) : (
          children
        )}
      </div>
      {footnote ? <p className="mt-2 text-[10.5px] text-muted-foreground">{footnote}</p> : null}
      {table && (status === "ready" || status === "updating" || status === "stale") ? (
        <details className="mt-2 border-t border-border pt-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-muted-foreground hover:text-foreground">Xem bảng dữ liệu</summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      ) : null}
    </section>
  );
}

function widgetStatus(slot: FetchSlot<WorkforceProjectsSummaryResponse>, isEmpty: boolean): WidgetStatus {
  if (slot.status === "loading") return "loading";
  if (slot.status === "error") return "error";
  if (slot.isStale) return "stale";
  if (slot.status === "updating") return "updating";
  if (isEmpty) return "empty";
  return "ready";
}

function CompanionTable({ head, rows }: { head: string[]; rows: Array<Array<string | number | React.ReactNode>> }) {
  return (
    <table className="w-full min-w-[420px] border-collapse text-[12px]">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {head.map((label) => <th key={label} scope="col" className="py-1.5 pr-3 font-semibold">{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, index) => (
          <tr key={index} className="border-b border-border/60 text-foreground">
            {cells.map((cell, cellIndex) => <td key={cellIndex} className="py-1.5 pr-3">{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Views ───────────────────────────────────────────────────────────────── */

function OverviewView({ summary, slot, onRetry, compare }: {
  summary?: WorkforceProjectsSummaryResponse;
  slot: FetchSlot<WorkforceProjectsSummaryResponse>;
  onRetry: () => void;
  compare: boolean;
}) {
  const series = summary?.series ?? [];
  const hasSeriesData = series.some(
    (bucket) =>
      bucket.reviewedApprovedMinutes > 0 ||
      bucket.submittedMinutes > 0 ||
      bucket.legacyApprovedMinutes > 0 ||
      bucket.allocationMinutes > 0 ||
      (bucket.capacityMinutes ?? 0) > 0
  );
  const statusRows = (summary?.filterOptions.projectStatuses ?? []).map((option) => ({ status: businessStatusLabel(option.label), count: option.count ?? 0 })).filter((row) => row.count > 0).slice(0, 8);
  const exceptions = (summary?.breakdowns.projects ?? []).filter((row) => (row.metrics.overdueTasks ?? 0) > 0 || (row.metrics.blockedTasks ?? 0) > 0);
  const overdueTotal = summary?.totals.find((metric) => metric.key === "overdueTasks");
  const blockedTotal = summary?.totals.find((metric) => metric.key === "blockedTasks");

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <ChartCard
          title="Năng lực, kế hoạch phân bổ và giờ làm theo thời gian"
          description="Giờ đã duyệt, giờ chờ duyệt và dữ liệu cũ chưa đối soát được tách riêng. Hai đường thể hiện năng lực khả dụng và kế hoạch phân bổ."
          status={widgetStatus(slot, !hasSeriesData)}
          onRetry={onRetry}
          footnote={summary && summary.quality.usersMissingCapacity > 0 ? `${summary.quality.usersMissingCapacity} nhân sự chưa có dữ liệu năng lực khả dụng.` : undefined}
          table={
            <CompanionTable
              head={["Khoảng thời gian", "Giờ đã duyệt", "Chờ duyệt", "Chưa đối soát", "Năng lực khả dụng", "Kế hoạch phân bổ", "Đã lên lịch", "Việc hoàn thành"]}
              rows={series.map((bucket) => [
                bucket.bucketLabel,
                formatHours(bucket.reviewedApprovedMinutes),
                formatHours(bucket.submittedMinutes),
                formatHours(bucket.legacyApprovedMinutes),
                bucket.capacityMinutes === null ? "Chưa có dữ liệu" : formatHours(bucket.capacityMinutes),
                formatHours(bucket.allocationMinutes),
                formatHours(bucket.scheduledMinutes),
                bucket.tasksCompleted
              ])}
            />
          }
        >
          <TrendComposedChart series={series} compareSeries={compare ? summary?.compareSeries : undefined} />
        </ChartCard>
      </div>

      <ChartCard
        title="Phân bố trạng thái dự án"
        description="Số dự án theo trạng thái trong phạm vi truy cập của bạn."
        status={widgetStatus(slot, statusRows.length === 0)}
        onRetry={onRetry}
        minHeight={280}
        table={<CompanionTable head={["Trạng thái", "Số dự án"]} rows={statusRows.map((row) => [row.status, row.count])} />}
      >
        <StatusDistributionChart rows={statusRows} />
      </ChartCard>

      <div className="xl:col-span-3">
        <ChartCard
          title="Ngoại lệ cần chú ý"
          description="Công việc quá hạn, công việc bị chặn và dự án có rủi ro tiến độ trong phạm vi lọc."
          status={widgetStatus(slot, exceptions.length === 0 && (overdueTotal?.value ?? 0) === 0 && (blockedTotal?.value ?? 0) === 0)}
          onRetry={onRetry}
          minHeight={160}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[13px] font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
                {overdueTotal?.value ?? 0} công việc quá hạn ({formatHours(summary?.totals.find((metric) => metric.key === "overdueEstimateMinutes")?.value ?? 0)} dự kiến)
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-1.5 text-[13px] font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                {blockedTotal?.value ?? 0} công việc đang bị chặn
              </span>
            </div>
            {exceptions.length > 0 ? (
              <CompanionTable
                head={["Dự án", "Khách hàng", "Quá hạn", "Bị chặn", "Giờ đã duyệt"]}
                rows={exceptions.map((row) => [
                  row.href ? <Link key={row.id} href={row.href as any} className="font-semibold text-primary hover:underline">{row.label}</Link> : row.label,
                  row.accountLabel ?? "—",
                  row.metrics.overdueTasks ?? 0,
                  row.metrics.blockedTasks ?? 0,
                  formatHours(row.metrics.reviewedApprovedMinutes ?? 0)
                ])}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">Không có dự án nào vượt ngưỡng ngoại lệ trong phạm vi lọc.</p>
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

function WorkforceView({ summary, slot, onRetry }: {
  summary?: WorkforceProjectsSummaryResponse;
  slot: FetchSlot<WorkforceProjectsSummaryResponse>;
  onRetry: () => void;
}) {
  const users = summary?.breakdowns.users ?? [];
  const withCapacity = users.filter((row) => typeof row.metrics.capacityMinutes === "number" && (row.metrics.capacityMinutes as number) > 0);
  const capacityRows = withCapacity.slice(0, 8).map((row) => {
    const capacity = row.metrics.capacityMinutes as number;
    const reviewed = (row.metrics.reviewedApprovedMinutes as number) ?? 0;
    return {
      id: row.id,
      label: row.label,
      reviewedMinutes: reviewed,
      remainingMinutes: Math.max(capacity - reviewed, 0),
      capacityMinutes: capacity,
      utilizationPercent: (row.metrics.actualUtilization as number | null) ?? null
    };
  });
  const missingCapacityCount = users.length - withCapacity.length;

  const reviewedTotal = summary?.totals.find((metric) => metric.key === "reviewedApprovedMinutes")?.value ?? 0;
  const billableMinutes = summary?.totals.find((metric) => metric.key === "billableRatio");
  const reworkMetric = summary?.totals.find((metric) => metric.key === "reworkShare");
  const billableValue = billableMinutes?.numerator ?? null;
  const reworkValue = reworkMetric?.state === "unavailable" ? null : reworkMetric?.numerator ?? 0;
  const nonBillable = billableValue === null ? null : Math.max((reviewedTotal ?? 0) - billableValue - (reworkValue ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <ChartCard
          title="Mức sử dụng nguồn lực theo nhân sự"
          description="So sánh giờ làm đã duyệt với năng lực khả dụng đã khai báo. Nhân sự thiếu dữ liệu năng lực được thống kê riêng."
          status={widgetStatus(slot, capacityRows.length === 0)}
          onRetry={onRetry}
          footnote={missingCapacityCount > 0 ? `${missingCapacityCount} nhân sự chưa có dữ liệu năng lực; hệ thống không quy đổi thành 0%.` : undefined}
          table={
            <CompanionTable
              head={["Nhân sự", "Giờ đã duyệt", "Năng lực khả dụng", "Mức sử dụng"]}
              rows={users.map((row) => [
                row.href ? <Link key={row.id} href={row.href as any} className="font-semibold text-primary hover:underline">{row.label}</Link> : row.label,
                formatHours(row.metrics.reviewedApprovedMinutes ?? 0),
                row.metrics.capacityMinutes === null || row.metrics.capacityMinutes === undefined ? "Chưa có dữ liệu" : formatHours(row.metrics.capacityMinutes),
                row.metrics.actualUtilization === null || row.metrics.actualUtilization === undefined ? "Chưa có dữ liệu" : formatPercent(row.metrics.actualUtilization)
              ])}
            />
          }
        >
          <CapacityStackedChart rows={capacityRows} />
        </ChartCard>
      </div>

      <ChartCard
        title="Cơ cấu giờ đã duyệt"
        description="Phân tách giờ có tính phí, không tính phí và công việc làm lại trên cùng phạm vi dữ liệu."
        status={widgetStatus(slot, (reviewedTotal ?? 0) === 0)}
        onRetry={onRetry}
        minHeight={200}
        footnote={reworkMetric?.state === "unavailable" ? reworkMetric.warnings?.[0] : undefined}
      >
        <WorkMixBar
          totalLabel={`Tổng: ${formatHours(reviewedTotal)}`}
          segments={[
            { label: "Có tính phí", minutes: billableValue ?? 0, color: SERIES_COLORS.billable },
            { label: "Không tính phí", minutes: nonBillable ?? 0, color: "var(--color-gray-400)" },
            ...(reworkValue !== null && reworkValue > 0 ? [{ label: "Công việc làm lại", minutes: reworkValue, color: SERIES_COLORS.allocation }] : [])
          ]}
        />
      </ChartCard>
    </div>
  );
}

function ProjectsView({ summary, slot, onRetry, onSelectProject }: {
  summary?: WorkforceProjectsSummaryResponse;
  slot: FetchSlot<WorkforceProjectsSummaryResponse>;
  onRetry: () => void;
  onSelectProject: (id: string) => void;
}) {
  const projects = summary?.breakdowns.projects ?? [];
  const byReviewed = [...projects].sort((a, b) => ((b.metrics.reviewedApprovedMinutes as number) ?? 0) - ((a.metrics.reviewedApprovedMinutes as number) ?? 0));
  const top = byReviewed.slice(0, 7);
  const rest = byReviewed.slice(7);
  const effortRows = [
    ...top.map((row) => ({
      id: row.id,
      label: row.label,
      estimateMinutes: (row.metrics.estimateMinutes as number) ?? 0,
      scheduledMinutes: (row.metrics.scheduledMinutes as number) ?? 0,
      reviewedMinutes: (row.metrics.reviewedApprovedMinutes as number) ?? 0,
      href: row.href
    })),
    ...(rest.length > 0
      ? [{
          id: "__other__",
          label: `Khác (${rest.length})`,
          estimateMinutes: rest.reduce((sum, row) => sum + ((row.metrics.estimateMinutes as number) ?? 0), 0),
          scheduledMinutes: rest.reduce((sum, row) => sum + ((row.metrics.scheduledMinutes as number) ?? 0), 0),
          reviewedMinutes: rest.reduce((sum, row) => sum + ((row.metrics.reviewedApprovedMinutes as number) ?? 0), 0)
        }]
      : [])
  ];

  const varianceRows = projects
    .filter((row) => row.metrics.estimateVarianceMinutes !== null && row.metrics.estimateVarianceMinutes !== undefined)
    .sort((a, b) => Math.abs((b.metrics.estimateVarianceMinutes as number) ?? 0) - Math.abs((a.metrics.estimateVarianceMinutes as number) ?? 0))
    .slice(0, 8)
    .map((row) => ({ id: row.id, label: row.label, varianceMinutes: (row.metrics.estimateVarianceMinutes as number) ?? 0 }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard
        title="Giờ dự kiến, đã lên lịch và đã duyệt theo dự án"
        description="Ba nguồn giờ được tách riêng để kế hoạch và kết quả thực tế không bị cộng gộp."
        status={widgetStatus(slot, effortRows.length === 0)}
        onRetry={onRetry}
        table={
          <CompanionTable
            head={["Dự án", "Giờ dự kiến", "Đã lên lịch", "Giờ đã duyệt"]}
            rows={effortRows.map((row) => [row.label, formatHours(row.estimateMinutes), formatHours(row.scheduledMinutes), formatHours(row.reviewedMinutes)])}
          />
        }
      >
        <EffortGroupedChart rows={effortRows} onSelect={(id) => id !== "__other__" && onSelectProject(id)} />
      </ChartCard>

      <ChartCard
        title="Chênh lệch so với giờ dự kiến theo dự án"
        description="Lấy giờ đã duyệt trừ giờ dự kiến. Giá trị dương nghĩa là dự án dùng nhiều giờ hơn kế hoạch."
        status={widgetStatus(slot, varianceRows.length === 0)}
        onRetry={onRetry}
        footnote="Chỉ tính chênh lệch khi dự án có giờ dự kiến; trường hợp thiếu dữ liệu được ghi rõ trong bảng chi tiết."
        table={
          <CompanionTable
            head={["Dự án", "Chênh lệch"]}
            rows={varianceRows.map((row) => [row.label, `${row.varianceMinutes > 0 ? "+" : ""}${formatHours(row.varianceMinutes)}`])}
          />
        }
      >
        <VarianceChart rows={varianceRows} onSelect={onSelectProject} />
      </ChartCard>
    </div>
  );
}

function ResourcesView({ summary, slot, onRetry }: {
  summary?: WorkforceProjectsSummaryResponse;
  slot: FetchSlot<WorkforceProjectsSummaryResponse>;
  onRetry: () => void;
}) {
  const users = summary?.breakdowns.users ?? [];
  const rows = users.slice(0, 8).map((row) => {
    const capacity = (row.metrics.capacityMinutes as number | null) ?? null;
    const allocation = (row.metrics.allocationMinutes as number) ?? 0;
    return {
      id: row.id,
      label: row.label,
      capacityMinutes: capacity,
      allocationMinutes: allocation,
      scheduledMinutes: (row.metrics.scheduledMinutes as number) ?? 0,
      reviewedMinutes: (row.metrics.reviewedApprovedMinutes as number) ?? 0,
      overbooked: capacity !== null && allocation > capacity
    };
  });
  const overbooked = rows.filter((row) => row.overbooked);
  const quality = summary?.quality;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <ChartCard
          title="Năng lực, kế hoạch phân bổ, lịch và thực tế theo nhân sự"
          description="Bốn nguồn giờ được tách riêng cho từng người trong khoảng thời gian đã chọn."
          status={widgetStatus(slot, rows.length === 0)}
          onRetry={onRetry}
          table={
            <CompanionTable
              head={["Nhân sự", "Năng lực khả dụng", "Kế hoạch phân bổ", "Đã lên lịch", "Giờ đã duyệt"]}
              rows={users.map((row) => [
                row.href ? <Link key={row.id} href={row.href as any} className="font-semibold text-primary hover:underline">{row.label}</Link> : row.label,
                row.metrics.capacityMinutes === null || row.metrics.capacityMinutes === undefined ? "Chưa có dữ liệu" : formatHours(row.metrics.capacityMinutes),
                formatHours(row.metrics.allocationMinutes ?? 0),
                formatHours(row.metrics.scheduledMinutes ?? 0),
                formatHours(row.metrics.reviewedApprovedMinutes ?? 0)
              ])}
            />
          }
        >
          <ResourceComparisonChart rows={rows} />
        </ChartCard>
      </div>

      <div className="flex flex-col gap-4">
        <ChartCard
          title="Quá tải và dữ liệu còn thiếu"
          description="Nhân sự có kế hoạch phân bổ vượt năng lực khả dụng và những phần dữ liệu cần bổ sung."
          status={widgetStatus(slot, false)}
          onRetry={onRetry}
          minHeight={200}
        >
          <div className="flex flex-col gap-2 text-[13px]">
            {overbooked.length > 0 ? (
              overbooked.map((row) => (
                <p key={row.id} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 font-semibold text-foreground">
                  <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-destructive" aria-hidden />
                  {row.label}: phân bổ {formatHours(row.allocationMinutes)} &gt; năng lực {formatHours(row.capacityMinutes)}
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">Không phát hiện nhân sự quá tải trong nhóm hiển thị.</p>
            )}
            {quality ? (
              <ul className="mt-1 space-y-1 text-[12px] text-muted-foreground">
                <li>• {quality.usersMissingCapacity} người chưa có dữ liệu năng lực khả dụng.</li>
                <li>• Hồ sơ thành viên hiệu lực: {quality.membershipCoverage.covered}/{quality.membershipCoverage.total}.</li>
              </ul>
            ) : null}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

function DataQualityPanel({ summary }: { summary?: WorkforceProjectsSummaryResponse }) {
  if (!summary) return null;
  const quality = summary.quality;
  const items: string[] = [];
  if (quality.legacyApprovedMinutes > 0) items.push(`${formatHours(quality.legacyApprovedMinutes)} dữ liệu giờ cũ chưa được đối soát theo quy trình mới.`);
  if (quality.usersMissingCapacity > 0) items.push(`${quality.usersMissingCapacity} người chưa khai báo năng lực khả dụng.`);
  if (quality.usersMissingDepartment > 0) items.push(`${quality.usersMissingDepartment} người chưa được gán phòng ban.`);
  if (quality.usersMissingTeam > 0) items.push(`${quality.usersMissingTeam} người chưa thuộc nhóm nào.`);
  if (quality.unassignedActualMinutes > 0) items.push(`${formatHours(quality.unassignedActualMinutes)} giờ đã duyệt chưa gán dự án.`);
  const unclassified = summary.taskTypeBreakdowns.find((row) => row.layer1Id === "UNCLASSIFIED" || row.layer2Id === "UNCLASSIFIED");
  if (unclassified) items.push(`${formatHours(unclassified.actualMinutes)} giờ chưa có đủ 2 lớp Task Type; cần PM/BD Lead rà soát, hệ thống không tự xếp nhóm.`);
  if (quality.suppressedGroups > 0) items.push(`${quality.suppressedGroups} nhóm nhỏ được ẩn để bảo vệ danh tính.`);
  for (const warning of summary.meta.warnings) items.push(businessWarningLabel(warning));
  if (items.length === 0) return null;

  return (
    <section aria-label="Chất lượng dữ liệu" className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-[13px] font-bold text-foreground">Chất lượng &amp; độ phủ dữ liệu</h3>
      <ul className="mt-2 grid grid-cols-1 gap-1 text-[12.5px] text-muted-foreground md:grid-cols-2">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
      <p className="mt-2 text-[10.5px] text-muted-foreground">Biểu đồ, chỉ số và bảng chi tiết sử dụng cùng phạm vi lọc và quy tắc tính.</p>
    </section>
  );
}

function TaskTypeMixPanel({ summary }: { summary?: WorkforceProjectsSummaryResponse }) {
  const rows = summary?.taskTypeBreakdowns ?? [];
  if (!summary || rows.length === 0) return null;
  return (
    <section aria-label="Phân bổ giờ theo Task Type" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-bold text-foreground">Phân bổ giờ theo Task Type</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Đối soát giờ đã duyệt theo 2 lớp nghiệp vụ; dùng bộ lọc để xem riêng BD / Pre-sale.</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">{rows.length} nhóm</span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {rows.map((row) => (
          <div key={`${row.layer1Id}-${row.layer2Id}`} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{row.layer1Label}</p>
                <p className="truncate text-muted-foreground">{row.layer2Label}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold text-foreground">{formatHours(row.actualMinutes)}</p>
                <p className="text-[11px] text-muted-foreground">{row.percentage.toLocaleString("vi-VN")} %</p>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(Math.max(row.percentage, 0), 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Breakdown detail table ──────────────────────────────────────────────── */

const BREAKDOWN_COLUMNS: Array<{ key: AnalyticsMetricKey; label: string; sortable: boolean }> = [
  { key: "reviewedApprovedMinutes", label: "Giờ đã duyệt", sortable: true },
  { key: "scheduledMinutes", label: "Đã xếp lịch", sortable: true },
  { key: "allocationMinutes", label: "Kế hoạch phân bổ", sortable: true },
  { key: "estimateMinutes", label: "Giờ dự kiến", sortable: true },
  { key: "capacityMinutes", label: "Năng lực khả dụng", sortable: true },
  { key: "actualUtilization", label: "Mức sử dụng", sortable: true },
  { key: "taskCompletionRate", label: "Hoàn thành", sortable: true },
  { key: "onTimeCompletionRate", label: "Đúng hạn", sortable: true },
  { key: "overdueTasks", label: "Quá hạn", sortable: true }
];

function formatCell(key: AnalyticsMetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined) return analyticsUnavailableLabel(key);
  const unit = ANALYTICS_METRIC_DEFINITIONS[key]?.unit;
  if (unit === "minutes") return formatHours(value);
  if (unit === "percent") return formatPercent(value);
  return value.toLocaleString("vi-VN");
}

function BreakdownTable({ state, slot, onChangeBy, onChangeSort, onNextPage, onPreviousPage, hasPrevious, onRetry, onExportCsv }: {
  state: AnalyticsUiState;
  slot: FetchSlot<WorkforceProjectsBreakdownResponse>;
  onChangeBy: (by: AnalyticsBreakdownBy) => void;
  onChangeSort: (sort: AnalyticsUiState["sort"], direction: "asc" | "desc") => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  hasPrevious: boolean;
  onRetry: () => void;
  onExportCsv: () => void;
}) {
  const data = slot.data;
  const rows = data?.rows ?? [];

  return (
    <section aria-label="Bảng chi tiết" className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h3 className="text-[14px] font-bold text-foreground">Bảng chi tiết</h3>
        <div role="group" aria-label="Nhóm theo" className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {([
            ["user", "Nhân sự"],
            ["project", "Dự án"],
            ["department", "Phòng ban"],
            ["team", "Nhóm"]
          ] as Array<[AnalyticsBreakdownBy, string]>).map(([by, label]) => (
            <button
              key={by}
              type="button"
              onClick={() => onChangeBy(by)}
              aria-pressed={state.by === by}
              className={`rounded-md px-2 py-1 text-[12px] font-semibold ${state.by === by ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {slot.status === "updating" ? <span className="text-[11px] font-semibold text-muted-foreground" role="status">Đang cập nhật…</span> : null}
        {slot.isStale ? (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">
            <RefreshCw className="h-3 w-3" aria-hidden /> Dữ liệu cũ — thử lại
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
          {data ? `${data.meta.totalRows} dòng · trang ${rows.length} dòng` : null}
          <button type="button" onClick={onExportCsv} disabled={rows.length === 0} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
            <Download className="h-3.5 w-3.5" aria-hidden /> Xuất dữ liệu
          </button>
        </span>
      </div>

      <div className="overflow-x-auto">
        {slot.status === "loading" ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {[0, 1, 2, 3, 4].map((index) => <div key={index} className="h-8 animate-pulse rounded bg-muted" aria-hidden />)}
          </div>
        ) : slot.status === "forbidden" ? (
          <p className="p-4 text-[13px] text-muted-foreground" role="alert">Bạn không có quyền xem phần chi tiết này. Hãy liên hệ quản trị viên nếu cần thêm quyền truy cập.</p>
        ) : slot.status === "error" ? (
          <div className="p-4 text-center" role="alert">
            <p className="text-[13px] text-muted-foreground">Không tải được bảng chi tiết. Không hiển thị dữ liệu thay thế.</p>
            <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Thử lại
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">Không có dòng dữ liệu nào trong phạm vi lọc hiện tại.</p>
        ) : (
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
            <caption className="sr-only">Bảng chi tiết theo {ANALYTICS_BREAKDOWN_LABELS[state.by].toLocaleLowerCase("vi")}, cùng bộ lọc và quy tắc tính với biểu đồ.</caption>
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-semibold">
                  <button
                    type="button"
                    onClick={() => onChangeSort("label", state.sort === "label" && state.direction === "asc" ? "desc" : "asc")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Tên {state.sort === "label" ? (state.direction === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                {BREAKDOWN_COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-2 text-right font-semibold">
                    <button
                      type="button"
                      onClick={() => onChangeSort(column.key as AnalyticsUiState["sort"], state.sort === column.key && state.direction === "desc" ? "asc" : "desc")}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {column.label} {state.sort === column.key ? (state.direction === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    {row.href ? (
                      <Link href={row.href as any} className="font-semibold text-primary hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        {row.label}
                      </Link>
                    ) : (
                      <span className="font-semibold text-foreground">
                        {row.label}
                        {row.pseudonymized ? <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">ẩn danh</span> : null}
                      </span>
                    )}
                    {row.accountLabel ? <span className="ml-2 text-[11px] text-muted-foreground">{row.accountLabel}</span> : null}
                    {row.memberCount !== undefined ? <span className="ml-2 text-[11px] text-muted-foreground">({row.memberCount} người)</span> : null}
                  </td>
                  {BREAKDOWN_COLUMNS.map((column) => (
                    <td key={column.key} className="px-3 py-2 text-right font-mono text-foreground">
                      {formatCell(column.key, row.metrics[column.key] as number | null | undefined)}
                    </td>
                  ))}
                </tr>
              ))}
              {data ? (
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-3 py-2 text-foreground">Tổng (toàn bộ dữ liệu đã lọc)</td>
                  {BREAKDOWN_COLUMNS.map((column) => (
                    <td key={column.key} className="px-3 py-2 text-right font-mono text-foreground">
                      {column.key in data.totals ? formatCell(column.key, data.totals[column.key]) : "—"}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border p-3">
        <p className="text-[11px] text-muted-foreground">
          {data ? `Dữ liệu từ ${data.meta.range.from.slice(0, 10)} đến ${exclusiveEndDateToInclusiveEndDate(data.meta.range.to.slice(0, 10)) ?? data.meta.range.to.slice(0, 10)}` : null}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPreviousPage}
            disabled={!hasPrevious}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            ← Trang trước
          </button>
          <button
            type="button"
            onClick={onNextPage}
            disabled={!data?.nextCursor}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            Trang sau →
          </button>
        </div>
      </div>
    </section>
  );
}
