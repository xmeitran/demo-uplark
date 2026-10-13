"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Download } from "lucide-react";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { AdvancedFilters, DateRangeFilter, FilterBar, FilterField, MonthFilter, MultiSelectFilter, PersonFilter, SearchFilter, fromCsvParam, standardDatePresets, type DateRange } from "@/components/filters";
import { HeaderButton, PageHeader } from "@/components/page-header";
import { emptyTimesheetDataset, loadTimesheetDataset } from "./timesheet-live-data";
import { filterLogs, periodParamsForRange, type TimesheetFilters } from "./timesheet-selectors";
import { formatMonth } from "./timesheet-format";
import {
  VIEWER_SCOPE_LABELS,
  WORK_GROUP_LABELS,
  WORK_GROUPS,
  type Person,
  type ViewerScope
} from "./timesheet-types";
import { Drawer } from "./timesheet-ui";
import { MonthlyTimesheet } from "./monthly-timesheet";
import { ProjectTimesheet } from "./project-timesheet";
import { useAuth } from "@/lib/auth";
import { fetchWorkspaceUserOptions } from "@/lib/workspace-users";
import { exportTimesheetWorkbook } from "./timesheet-export";
import { canViewTimesheetGroup } from "./timesheet-access";
import { buildTimesheetAlerts } from "./timesheet-alerts";
import { TimesheetViewNav } from "./timesheet-view-nav";
import { monthBounds } from "./timesheet-dates";

/**
 * /timesheet workbench — the shell that owns filters, permission scope and the
 * switch between the monthly and project views.
 *
 * Data is loaded from the BFF endpoints. A failed request stays visibly empty
 * instead of silently replacing production values with demo records.
 */

type TimesheetView = "monthly" | "project";

function mapDirectoryPerson(user: Awaited<ReturnType<typeof fetchWorkspaceUserOptions>>[number]): Person {
  return {
    id: user.id,
    name: user.name,
    initials: user.initials,
    avatarUrl: user.avatarUrl,
    avatarColor: user.color,
    role: user.role,
    departmentId: "unassigned",
    teamName: user.role,
    standardMinutesPerDay: 480,
    contractRatio: 1,
    active: user.status === "active"
  };
}

/** The viewer's role decides which people and projects they may see. */
export function TimesheetWorkbench() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { user } = useAuth();
  const [dataset, setDataset] = useState(() => emptyTimesheetDataset());
  const [directoryPeople, setDirectoryPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
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

  // Keep the personnel picker usable even when logs/projects/holidays are
  // temporarily unavailable. The workspace directory is an independent source.
  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaceUserOptions(controller.signal)
      .then((users) => setDirectoryPeople(users.map(mapDirectoryPerson)))
      .catch(() => {
        if (!controller.signal.aborted) setDirectoryPeople([]);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const availablePeople = useMemo(() => {
    const byId = new Map(directoryPeople.map((person) => [person.id, person]));
    for (const person of dataset.people) byId.set(person.id, { ...byId.get(person.id), ...person });
    return [...byId.values()];
  }, [dataset.people, directoryPeople]);

  // Anything else (including the retired `daily` view) falls back to the month view.
  const view: TimesheetView = searchParams.get("view") === "project" ? "project" : "monthly";
  const requestedScope = (searchParams.get("scope") as ViewerScope | null) ?? "workspace";
  const canViewWorkspace = canViewTimesheetGroup(user?.roleCodes);
  const scope: ViewerScope = canViewWorkspace ? requestedScope : "self";

  const defaultMonth = dataset.months[dataset.months.length - 1];
  const filters = useMemo<TimesheetFilters>(() => {
    // Comma-joined values; a link saved with one value (the old single dropdowns) reads the same way.
    const csv = (key: string) => fromCsvParam(searchParams.get(key)).filter((value) => value !== "all");
    const personIds = csv("person");
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    // The day range decides the period: an old link whose range ends in another month moves the month.
    const month = to ? to.slice(0, 7) : searchParams.get("month") ?? defaultMonth;
    const monthRange = monthBounds(month);
    return {
      month,
      dateFrom: from || monthRange.start,
      dateTo: to || monthRange.end,
      departmentId: "all",
      departmentIds: csv("dept"),
      personId: personIds.length === 1 ? personIds[0] : personIds.length > 1 ? "multiple" : "all",
      personIds,
      projectId: "all",
      projectIds: csv("project"),
      workGroup: "all",
      // A link saved with a removed group ("Họp", "Khác"…) falls back to all groups.
      workGroups: WORK_GROUPS.filter((group) => csv("group").includes(group)),
      search: searchParams.get("q") ?? ""
    };
  }, [searchParams, defaultMonth]);

  /** Permission narrowing applied before any screen sees the data. */
  const scopedDataset = useMemo(() => {
    const datasetWithDirectoryPeople = { ...dataset, people: availablePeople };
    if (scope === "workspace") return datasetWithDirectoryPeople;
    if (scope === "self") {
      const selfId = user?.id;
      return {
        ...datasetWithDirectoryPeople,
        people: selfId ? availablePeople.filter((person) => person.id === selfId) : [],
        projects: datasetWithDirectoryPeople.projects.filter((project) => selfId ? project.members.some((member) => member.personId === selfId) : false),
        logs: selfId ? datasetWithDirectoryPeople.logs.filter((log) => log.personId === selfId) : []
      };
    }
    return {
      ...datasetWithDirectoryPeople,
      projects: datasetWithDirectoryPeople.projects.filter((project) => user?.id && (project.picId === user.id || project.members.some((member) => member.personId === user.id))),
      logs: datasetWithDirectoryPeople.logs.filter((log) => datasetWithDirectoryPeople.projects.some((project) => project.id === log.projectId && user?.id && (project.picId === user.id || project.members.some((member) => member.personId === user.id))))
    };
  }, [availablePeople, dataset, scope, user?.id]);

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

  /* ── Filter options ───────────────────────────────────────────────── */

  const scopeOptions = (Object.keys(VIEWER_SCOPE_LABELS) as ViewerScope[]).filter((key) => canViewWorkspace || key === "self").map((key) => ({ value: key, label: VIEWER_SCOPE_LABELS[key] }));
  const departmentOptions = dataset.departments.length > 0
    ? dataset.departments.map((department) => ({ value: department.id, label: department.name }))
    : [...new Set(availablePeople.map((person) => person.departmentId).filter((id) => id !== "unassigned"))].map((id) => ({ value: id, label: id }));
  const departmentIds = filters.departmentIds ?? [];
  const peopleOptions = scopedDataset.people
    .filter((person) => departmentIds.length === 0 || departmentIds.includes(person.departmentId))
    .map((person) => ({ id: person.id, name: person.name, avatarUrl: person.avatarUrl, subtitle: `${person.role} · ${person.teamName}` }));
  const projectOptions = scopedDataset.projects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }));
  const groupOptions = WORK_GROUPS.map((group) => ({ value: group, label: WORK_GROUP_LABELS[group] }));

  const monthRange = monthBounds(filters.month);
  const dateRange: DateRange = { from: filters.dateFrom ?? monthRange.start, to: filters.dateTo ?? monthRange.end };
  const today = dataset.generatedAt.slice(0, 10);
  const windowStart = dataset.windowStart ?? "";
  // Standard presets that fit the loaded 365-day window, plus the whole selected month.
  const dateRangePresets = useMemo(() => [
    ...standardDatePresets(today)
      .filter((preset) => ["today", "last-7-days", "last-30-days", "this-month", "last-month", "this-quarter"].includes(preset.id))
      .map((preset) => ({ ...preset, from: preset.from < windowStart ? windowStart : preset.from })),
    { id: "month", label: `Cả ${formatMonth(filters.month).toLowerCase()}`, from: monthRange.start, to: monthRange.end }
  ], [filters.month, monthRange.end, monthRange.start, today, windowStart]);

  // The search box types freely; the URL (and the tables) follow after a short pause.
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");
  useEffect(() => { setSearchDraft(filters.search ?? ""); }, [filters.search]);
  useEffect(() => {
    if (searchDraft === (filters.search ?? "")) return;
    const timer = window.setTimeout(() => commit({ q: searchDraft.trim() }), 300);
    return () => window.clearTimeout(timer);
  }, [commit, filters.search, searchDraft]);

  // "Đặt lại" keeps the permission scope, so scope only counts towards the advanced badge.
  const customDateRange = dateRange.from !== monthRange.start || dateRange.to !== monthRange.end;
  const activeFilterCount = [departmentIds, filters.personIds, filters.projectIds, filters.workGroups].filter((values) => values?.length).length
    + (filters.search ? 1 : 0)
    + (customDateRange || filters.month !== defaultMonth ? 1 : 0);
  const advancedFilterCount = (filters.workGroups?.length ? 1 : 0) + (canViewWorkspace && scope !== "workspace" ? 1 : 0);

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
      <PageHeader
        title={viewCopy.title}
        subtitle={viewCopy.description}
        actions={<HeaderButton icon={<Download className="h-4 w-4" aria-hidden />} onClick={exportExcel} disabled={loading || exporting}>{exporting ? "Đang tạo Excel…" : "Xuất Excel"}</HeaderButton>}
      />
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

      {/* ── Filters ─── */}
      <section aria-label="Bộ lọc và phạm vi xem Timesheet" className="rounded-xl border border-border bg-card p-3">
        <FilterBar onReset={activeFilterCount > 0 ? resetFilters : undefined} activeCount={activeFilterCount}>
          <FilterField label="Tìm kiếm" className="min-w-[200px] flex-1">
            <SearchFilter className="" ariaLabel="Tìm theo công việc, dự án hoặc ghi chú" placeholder="Tìm công việc, dự án, ghi chú..." value={searchDraft} onChange={setSearchDraft} />
          </FilterField>
          <FilterField label="Kỳ báo cáo" className="shrink-0">
            <MonthFilter ariaLabel="Chọn tháng" months={[...new Set([...dataset.months, filters.month])]} value={filters.month} onChange={(value) => commit({ month: value, from: "", to: "" })} />
          </FilterField>
          <FilterField label="Khoảng ngày ghi nhận" className="min-w-[15rem] flex-[1.2]">
            <DateRangeFilter
              ariaLabel="Lọc theo khoảng ngày ghi nhận"
              value={dateRange}
              presets={dateRangePresets}
              maxDays={366}
              clearable={false}
              onChange={(range) => commit(periodParamsForRange(range, windowStart))}
            />
          </FilterField>
          <PersonFilter people={peopleOptions} values={filters.personIds ?? []} onChange={(values) => commit({ person: values.join(",") })} />
          <MultiSelectFilter label="Phòng ban" options={departmentOptions} values={departmentIds} onChange={(values) => commit({ dept: values.join(","), person: "" })} hideWhenSingle={departmentIds.length === 0} />
          <MultiSelectFilter label="Dự án" options={projectOptions} values={filters.projectIds ?? []} onChange={(values) => commit({ project: values.join(",") })} allLabel="Tất cả dự án" />
          <AdvancedFilters count={advancedFilterCount}>
            <MultiSelectFilter label="Nhóm công việc" options={groupOptions} values={filters.workGroups ?? []} onChange={(values) => commit({ group: values.join(",") })} searchable={false} />
            {scopeOptions.length > 1 ? (
              <FilterField label="Phạm vi quyền xem">
                <CrmSelect ariaLabel="Chọn phạm vi quyền xem" options={scopeOptions} value={scope} onChange={(value) => commit({ scope: value })} menuPortal />
              </FilterField>
            ) : null}
          </AdvancedFilters>
        </FilterBar>
      </section>

      {loadError ? <section role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"><span>{loadError}</span><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-rose-300 bg-white px-3 font-semibold text-rose-700 hover:bg-rose-100">Thử lại</button></section> : null}
      {loading ? <section aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></section> : null}

      {!loading && !loadError && logs.length === 0 && activeFilterCount > 0 ? (
        <section role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <span>Không có kết quả phù hợp bộ lọc.</span>
          <button type="button" onClick={resetFilters} className="!text-[12px] !font-semibold text-primary hover:underline">Đặt lại bộ lọc</button>
        </section>
      ) : null}

      {/* ── Active view ────────────────────────────────────────────────── */}
      {!loading && (view === "monthly" ? (
        <MonthlyTimesheet dataset={scopedDataset} filters={filters} logs={logs} currentUserId={user?.id} />
      ) : (
        <ProjectTimesheet dataset={scopedDataset} filters={filters} logs={logs} currentUserId={user?.id} />
      ))}

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
