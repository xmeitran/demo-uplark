"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Download, Info, Users, Clock3 } from "lucide-react";
import { CustomDropdown, type DropdownOption } from "@/components/constructor-x/custom-controls";
import { CrmMultiSelect } from "@/components/crm-workspace/crm-select";
import { AdvancedFilters, FilterBar, FilterField, MonthFilter } from "@/components/filters/filter-controls";
import { hasChoice } from "@/components/filters/filter-dates";
import { emptyTimesheetDataset, loadTimesheetDataset } from "./timesheet-live-data";
import { filterLogs, type TimesheetFilters } from "./timesheet-selectors";
import { formatDate, formatHours } from "./timesheet-format";
import {
  VIEWER_SCOPE_LABELS,
  WORK_GROUP_LABELS,
  WORK_GROUPS,
  type ViewerScope,
  type WorkGroup
} from "./timesheet-types";
import { Drawer } from "./timesheet-ui";
import { MonthlyTimesheet } from "./monthly-timesheet";
import { ProjectTimesheet } from "./project-timesheet";
import { useAuth } from "@/lib/auth";
import { exportTimesheetWorkbook } from "./timesheet-export";
import { canViewTimesheetGroup } from "./timesheet-access";
import { buildTimesheetAlerts } from "./timesheet-alerts";
import { TimesheetViewNav } from "./timesheet-view-nav";

/**
 * /timesheet workbench — the shell that owns filters, permission scope and the
 * switch between the monthly and project views.
 *
 * Data is loaded from the BFF endpoints. A failed request stays visibly empty
 * instead of silently replacing production values with demo records.
 */

type TimesheetView = "monthly" | "project";

type FilterKind = "month" | "department" | "person" | "project" | "workGroup" | "scope";

interface FilterDetailLog {
  id: string;
  date: string;
  person: string;
  project: string;
  task: string;
  hours: string;
}
interface FilterDetail {
  kind: FilterKind;
  title: string;
  description: string;
  metrics: Array<{ label: string; value: string }>;
  relatedLogs: FilterDetailLog[];
}

function buildFilterDetail(
  kind: FilterKind,
  option: DropdownOption,
  scopedDataset: ReturnType<typeof emptyTimesheetDataset>,
  filters: TimesheetFilters,
  scope: ViewerScope
): FilterDetail {
  const peopleById = new Map(scopedDataset.people.map((person) => [person.id, person]));
  const projectsById = new Map(scopedDataset.projects.map((project) => [project.id, project]));
  const taskNames = new Map<string, string>();
  for (const project of scopedDataset.projects) {
    for (const milestone of project.milestones) {
      for (const stage of milestone.stages) {
        for (const task of stage.tasks) taskNames.set(`${project.id}:${task.id}`, `${stage.name} › ${task.name}`);
      }
    }
  }

  const contextFilters: TimesheetFilters = {
    ...filters,
    month: kind === "month" ? option.value : filters.month,
    departmentId: kind === "department" ? option.value : filters.departmentId,
    personId: kind === "person" ? option.value : filters.personId,
    personIds: kind === "person" ? [option.value] : filters.personIds,
    projectId: kind === "project" ? option.value : filters.projectId,
    workGroup: kind === "workGroup" ? (option.value as TimesheetFilters["workGroup"]) : filters.workGroup
  };
  const detailLogs = kind === "scope" ? filterLogs(scopedDataset, filters) : filterLogs(scopedDataset, contextFilters);
  const minutes = detailLogs.reduce((sum, log) => sum + log.minutes, 0);
  const billableMinutes = detailLogs.filter((log) => log.billable).reduce((sum, log) => sum + log.minutes, 0);
  const peopleCount = new Set(detailLogs.map((log) => log.personId)).size;
  const projectCount = new Set(detailLogs.map((log) => log.projectId)).size;
  const dates = new Set(detailLogs.map((log) => log.date));
  const relatedLogs = detailLogs
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.minutes - a.minutes)
    .slice(0, 10)
    .map((log) => ({
      id: log.id,
      date: log.date,
      person: peopleById.get(log.personId)?.name ?? log.personId,
      project: projectsById.get(log.projectId)?.code ?? log.projectId,
      task: taskNames.get(`${log.projectId}:${log.taskId}`) ?? log.taskId,
      hours: formatHours(log.minutes)
    }));

  const title = kind === "scope" ? `Chi tiết phạm vi: ${option.label}` : `Chi tiết ${option.label}`;
  const description = kind === "scope"
    ? `Số liệu hiển thị trong phạm vi ${VIEWER_SCOPE_LABELS[scope]}, theo đúng bộ lọc hiện tại.`
    : `Số liệu live theo bộ lọc hiện tại · ${option.label}.`;

  return {
    kind,
    title,
    description,
    metrics: [
      { label: "Dòng ghi nhận", value: `${detailLogs.length}` },
      { label: "Tổng giờ", value: formatHours(minutes) },
      { label: "Nhân sự", value: `${peopleCount}` },
      { label: "Dự án", value: `${projectCount}` },
      { label: "Ngày có log", value: `${dates.size}` },
      { label: "Giờ tính phí", value: formatHours(billableMinutes) }
    ],
    relatedLogs
  };
}

function decorateOptions(
  kind: FilterKind,
  options: DropdownOption[],
  scopedDataset: ReturnType<typeof emptyTimesheetDataset>,
  filters: TimesheetFilters,
  scope: ViewerScope
) {
  return options.map((option) => {
    const detail = buildFilterDetail(kind, option, scopedDataset, filters, scope);
    const lines = detail.metrics.slice(0, 2).map((metric) => `${metric.value} ${metric.label.toLowerCase()}`);
    return { ...option, description: lines.join(" · ") };
  });
}

/** The viewer's role decides which people and projects they may see. */
export function TimesheetWorkbench() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { user } = useAuth();
  const [dataset, setDataset] = useState(() => emptyTimesheetDataset());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [filterDetail, setFilterDetail] = useState<FilterDetail | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    loadTimesheetDataset(controller.signal).then((next) => setDataset(next)).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Không tải được dữ liệu Timesheet.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadToken]);

  // Anything else (including the retired `daily` view) falls back to the month view.
  const view: TimesheetView = searchParams.get("view") === "project" ? "project" : "monthly";
  const requestedScope = (searchParams.get("scope") as ViewerScope | null) ?? "workspace";
  const canViewWorkspace = canViewTimesheetGroup(user?.roleCodes);
  const scope: ViewerScope = canViewWorkspace ? requestedScope : "self";

  const filters = useMemo<TimesheetFilters>(
    () => {
      const personIds = (searchParams.get("person") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      return {
      month: searchParams.get("month") ?? dataset.months[dataset.months.length - 1],
      departmentId: searchParams.get("dept") ?? "all",
      personId: personIds.length === 1 ? personIds[0] : personIds.length > 1 ? "multiple" : "all",
      personIds,
      projectId: searchParams.get("project") ?? "all",
      workGroup: (searchParams.get("group") as WorkGroup | null) ?? "all"
      };
    },
    [searchParams, dataset.months]
  );

  /** Permission narrowing applied before any screen sees the data. */
  const scopedDataset = useMemo(() => {
    if (scope === "workspace") return dataset;
    if (scope === "self") {
      const selfId = user?.id;
      return {
        ...dataset,
        people: selfId ? dataset.people.filter((person) => person.id === selfId) : [],
        projects: dataset.projects.filter((project) => selfId ? project.members.some((member) => member.personId === selfId) : false),
        logs: selfId ? dataset.logs.filter((log) => log.personId === selfId) : []
      };
    }
    return {
      ...dataset,
      projects: dataset.projects.filter((project) => user?.id && (project.picId === user.id || project.members.some((member) => member.personId === user.id))),
      logs: dataset.logs.filter((log) => dataset.projects.some((project) => project.id === log.projectId && user?.id && (project.picId === user.id || project.members.some((member) => member.personId === user.id))))
    };
  }, [dataset, scope, user?.id]);

  const logs = useMemo(() => filterLogs(scopedDataset, filters), [scopedDataset, filters]);

  const commit = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (!value || value === "all") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const resetFilters = useCallback(() => {
    const next = new URLSearchParams({ view });
    if (canViewWorkspace && scope !== "workspace") next.set("scope", scope);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [canViewWorkspace, pathname, router, scope, view]);

  const exportExcel = useCallback(async () => {
    if (exporting || loading) return;
    setExporting(true);
    setExportMessage(null);
    setExportError(null);
    try {
      const result = await exportTimesheetWorkbook({
        dataset: scopedDataset,
        filters,
        logs,
        scopeLabel: VIEWER_SCOPE_LABELS[scope],
        view: view === "project" ? "Theo dự án" : "Theo tháng"
      });
      setExportMessage(`Đã xuất ${result.logCount} dòng raw · 2 sheet`);
      window.setTimeout(() => setExportMessage(null), 5000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Không thể tạo file Excel.");
    } finally {
      setExporting(false);
    }
  }, [exporting, loading, scopedDataset, filters, logs, scope, view]);

  /* ── Dropdown option lists ────────────────────────────────────────── */

  const scopeOptions: DropdownOption[] = decorateOptions("scope", (Object.keys(VIEWER_SCOPE_LABELS) as ViewerScope[]).filter((key) => canViewWorkspace || key === "self").map((key) => ({
    value: key,
    label: VIEWER_SCOPE_LABELS[key]
  })), scopedDataset, filters, scope);
  const departmentOptions: DropdownOption[] = decorateOptions("department", [
    { value: "all", label: "Tất cả phòng ban" },
    ...dataset.departments.map((department) => ({ value: department.id, label: department.name }))
  ], scopedDataset, filters, scope);
  const personOptions: DropdownOption[] = decorateOptions("person", [
    { value: "all", label: "Tất cả nhân sự" },
    ...scopedDataset.people
      .filter((person) => filters.departmentId === "all" || person.departmentId === filters.departmentId)
      .map((person) => ({
        value: person.id,
        label: person.name,
        meta: `${person.role} · ${person.teamName}`,
        avatarUrl: person.avatarUrl,
        initials: person.initials,
        avatarColor: person.avatarColor
      }))
  ], scopedDataset, filters, scope);
  const projectOptions: DropdownOption[] = decorateOptions("project", [
    { value: "all", label: "Tất cả dự án" },
    ...scopedDataset.projects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))
  ], scopedDataset, filters, scope);
  const groupOptions: DropdownOption[] = decorateOptions("workGroup", [
    { value: "all", label: "Tất cả nhóm công việc" },
    ...WORK_GROUPS.map((group) => ({ value: group, label: WORK_GROUP_LABELS[group] }))
  ], scopedDataset, filters, scope);

  const openFilterDetail = useCallback((kind: FilterKind, option: DropdownOption) => {
    setFilterDetail(buildFilterDetail(kind, option, scopedDataset, filters, scope));
  }, [scopedDataset, filters, scope]);

  // "Đặt lại" keeps the permission scope, so scope only counts towards the advanced badge.
  const activeFilterCount = [filters.departmentId, filters.projectId, filters.workGroup].filter(
    (value) => value !== "all"
  ).length + (filters.personIds?.length ? 1 : 0) + (searchParams.get("month") && filters.month !== dataset.months[dataset.months.length - 1] ? 1 : 0);
  const advancedFilterCount = [filters.projectId, filters.workGroup].filter((value) => value !== "all").length
    + (canViewWorkspace && scope !== "workspace" ? 1 : 0);

  const viewCopy = view === "project"
    ? {
        title: "Bảng giờ theo dự án",
        description: "Theo dõi giờ kế hoạch, giờ thực tế và công việc theo từng dự án."
      }
    : {
        title: "Bảng giờ theo tháng",
        description: "Tổng hợp giờ đã ghi nhận theo nhân sự trong kỳ báo cáo."
      };

  const alerts = useMemo(() => buildTimesheetAlerts(scopedDataset, logs, scopedDataset.generatedAt, filters), [scopedDataset, logs, filters]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="!text-xl font-bold text-foreground">{viewCopy.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{viewCopy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportExcel}
            disabled={loading || exporting}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden /> {exporting ? "Đang tạo Excel…" : "Xuất Excel"}
          </button>
        </div>
      </header>
      {exportMessage ? <p role="status" className="text-[11px] font-medium text-success">{exportMessage}</p> : null}
      {exportError ? <p role="alert" className="text-[11px] font-medium text-rose-700">{exportError}</p> : null}

      {/* ── Alerts: first three, one line each; hidden when there are none ─ */}
      {!loading && alerts.length > 0 ? (
        <section aria-label="Cảnh báo Timesheet" className="rounded-xl border border-warning/30 bg-warning/[0.04] px-3 py-2">
          <ul className="space-y-1">
            {alerts.slice(0, 3).map((alert) => (
              <li key={alert.id} className="flex min-w-0 items-center gap-2 text-[12px]">
                <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${alert.tone === "danger" ? "text-destructive" : alert.tone === "warning" ? "text-warning" : "text-info"}`} aria-hidden />
                <span className="min-w-0 truncate text-foreground">
                  <span className="font-semibold">{alert.count} {alert.label}</span>
                  <span className="text-muted-foreground"> — {alert.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setAlertsOpen(true)} className="mt-1 text-[11.5px] font-semibold text-primary hover:underline">
            Xem tất cả ({alerts.length})
          </button>
        </section>
      ) : null}

      <TimesheetViewNav
        groupScope={canViewWorkspace ? scope : "self"}
      />

      {/* ── Filters: three main ones on a row, the rest behind a toggle ─── */}
      <section aria-label="Bộ lọc và phạm vi xem Timesheet" className="rounded-xl border border-border bg-card p-3">
        <FilterBar onReset={activeFilterCount > 0 ? resetFilters : undefined}>
          <FilterField label="Kỳ báo cáo" className="shrink-0">
            <MonthFilter ariaLabel="Chọn tháng" months={dataset.months} value={filters.month} onChange={(value) => commit({ month: value })} />
          </FilterField>
          {hasChoice(departmentOptions) || filters.departmentId !== "all" ? (
            <FilterField label="Phòng ban">
              <CustomDropdown
                ariaLabel="Chọn phòng ban"
                options={departmentOptions}
                value={filters.departmentId}
                onChange={(value) => commit({ dept: value, person: "all" })}
                onOptionInfo={(option) => openFilterDetail("department", option)}
              />
            </FilterField>
          ) : null}
          <FilterField label="Nhân sự">
            <CrmMultiSelect
              ariaLabel="Chọn một hoặc nhiều nhân sự"
              options={personOptions.filter((option) => option.value !== "all")}
              values={filters.personIds ?? []}
              onChange={(values) => commit({ person: values.join(",") })}
              selectedCountLabel={(count) => `${count} nhân sự đã chọn`}
              placeholder="Tất cả nhân sự"
              searchPlaceholder="Tìm nhân sự..."
            />
          </FilterField>
          <AdvancedFilters count={advancedFilterCount}>
            {hasChoice(projectOptions) || filters.projectId !== "all" ? (
              <FilterField label="Dự án">
                <CustomDropdown ariaLabel="Chọn dự án" options={projectOptions} value={filters.projectId} onChange={(value) => commit({ project: value })} onOptionInfo={(option) => openFilterDetail("project", option)} />
              </FilterField>
            ) : null}
            <FilterField label="Nhóm công việc">
              <CustomDropdown ariaLabel="Chọn nhóm công việc" options={groupOptions} value={filters.workGroup} onChange={(value) => commit({ group: value })} onOptionInfo={(option) => openFilterDetail("workGroup", option)} />
            </FilterField>
            {scopeOptions.length > 1 ? (
              <FilterField label="Phạm vi quyền xem">
                <CustomDropdown ariaLabel="Chọn phạm vi quyền xem" options={scopeOptions} value={scope} onChange={(value) => commit({ scope: value })} onOptionInfo={(option) => openFilterDetail("scope", option)} />
              </FilterField>
            ) : null}
          </AdvancedFilters>
        </FilterBar>
      </section>

      {loadError ? <section role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"><span>{loadError}</span><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-rose-300 bg-white px-3 font-semibold text-rose-700 hover:bg-rose-100">Thử lại</button></section> : null}
      {loading ? <section aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></section> : null}

      {/* ── Active view ────────────────────────────────────────────────── */}
      {!loading && (view === "monthly" ? (
        <MonthlyTimesheet dataset={scopedDataset} filters={filters} logs={logs} currentUserId={user?.id} />
      ) : (
        <ProjectTimesheet dataset={scopedDataset} filters={filters} logs={logs} currentUserId={user?.id} />
      ))}

      <FilterOptionDetailDrawer detail={filterDetail} onClose={() => setFilterDetail(null)} />
      <Drawer
        open={alertsOpen}
        title="Cảnh báo Timesheet"
        description="Các cảnh báo được tính trực tiếp từ dữ liệu live trong phạm vi đang xem."
        icon={AlertTriangle}
        onClose={() => setAlertsOpen(false)}
      >
        <div className="divide-y divide-border">
          {alerts.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Không có cảnh báo cần xử lý trong phạm vi hiện tại.</p>
          ) : alerts.map((alert) => (
            <div key={alert.id} className="flex items-start gap-3 p-4">
              <span className={`mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[11px] font-bold ${alert.tone === "danger" ? "bg-destructive/10 text-destructive" : alert.tone === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info"}`}>
                {alert.count}
              </span>
              <div>
                <p className="text-[12.5px] font-semibold text-foreground">{alert.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{alert.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}

function FilterOptionDetailDrawer({ detail, onClose }: { detail: FilterDetail | null; onClose: () => void }) {
  return (
    <Drawer open={detail !== null} title={detail?.title ?? "Chi tiết bộ lọc"} description={detail?.description} icon={Info} onClose={onClose}>
      {detail ? (
        <>
          <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/20 p-4 sm:grid-cols-3">
            {detail.metrics.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-border bg-card p-2.5">
                <p className="text-[10px] text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-[14px] font-bold tabular-nums text-foreground">{metric.value}</p>
              </div>
            ))}
          </div>

          <section className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-bold text-foreground">Một số dòng log gần nhất</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Mở từ chính dữ liệu live sau khi áp dụng bộ lọc.</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary">
                <Clock3 className="h-3 w-3" aria-hidden /> {detail.relatedLogs.length} dòng
              </span>
            </div>

            {detail.relatedLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center text-[12px] text-muted-foreground">Không có dòng log trong phạm vi này.</div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border">
                {detail.relatedLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                      {log.person.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[12px] font-semibold text-foreground">{log.person}</p>
                        <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-primary">{log.hours}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{log.project} · {log.task}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{formatDate(log.date)} · {log.id}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 inline-flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              <Users className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              Số liệu được tính lại từ các dòng time log hiện có, không lấy từ số liệu demo hoặc tổng hợp cũ.
            </p>
          </section>
        </>
      ) : null}
    </Drawer>
  );
}
