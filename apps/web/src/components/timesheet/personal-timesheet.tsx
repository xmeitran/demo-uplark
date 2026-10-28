"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  ListTodo,
  RefreshCw
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DateRangeFilter, FilterBar, FilterField, MonthFilter, MultiSelectFilter, SearchFilter, fromCsvParam, standardDatePresets } from "@/components/filters";
import { HeaderButton, PageHeader } from "@/components/page-header";
import { emptyTimesheetDataset, loadTimesheetDataset } from "./timesheet-live-data";
import { eachDate, isWorkingDay, monthBounds } from "./timesheet-dates";
import { isClosedNodeStatus, isTaskOverdue } from "./timesheet-status";
import { projectStatusLabel } from "@/lib/project-status";
import { useRememberedQuery } from "@/lib/persisted-filters";
import {
  buildPersonDayMatrix,
  buildPersonProjectRows,
  filterLogs,
  periodParamsForRange,
  leaveFraction,
  standardMinutesFor,
  sum,
  type TimesheetFilters
} from "./timesheet-selectors";
import {
  formatDate,
  formatDateShort,
  formatFilterPeriod,
  formatHours,
  formatMonth,
  formatPercent,
  nodeStatusTone,
  projectStatusTone
} from "./timesheet-format";
import {
  NODE_STATUS_LABELS,
  type Person,
  type ProjectNode,
  type TaskNode,
  type TimesheetDataset
} from "./timesheet-types";
import { Avatar, EmptyState, KpiCard, Pill, SectionCard } from "./timesheet-ui";
import { LogDrawer, type LogDrawerRequest } from "./timesheet-log-drawer";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

type PersonalTask = {
  task: TaskNode;
  project: ProjectNode;
  milestoneName: string;
  stageName: string;
};

function isoWeekday(iso: string) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function currentTaskTone(task: TaskNode, overdue: boolean) {
  if (task.status === "completed") return "success" as const;
  if (task.status === "waiting") return "warning" as const;
  if (task.status === "blocked") return "danger" as const;
  if (overdue) return "danger" as const;
  if (task.status === "in_progress") return "info" as const;
  return "neutral" as const;
}

function personalTasks(dataset: TimesheetDataset, personId: string): PersonalTask[] {
  return dataset.projects.flatMap((project) => project.milestones.flatMap((milestone) => milestone.stages.flatMap((stage) =>
    stage.tasks
      .filter((task) => task.assigneeId === personId)
      .map((task) => ({ task, project, milestoneName: milestone.name, stageName: stage.name }))
  )));
}

function resolvePerson(dataset: TimesheetDataset, user: { id?: string; name?: string; email?: string } | null): Person | null {
  if (!user) return null;
  return dataset.people.find((person) => person.id === user.id)
    ?? dataset.people.find((person) => person.name === user.name)
    ?? dataset.people.find((person) => user.email && person.name.toLowerCase().includes(user.email.split("@")[0].toLowerCase()))
    ?? null;
}

function LoadingPersonalTimesheet() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải Timesheet của tôi">
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => <div key={index} className="h-[112px] animate-pulse rounded-xl bg-muted" />)}
      </div>
      <div className="h-[390px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function CalendarCard({
  month,
  today,
  matrix,
  person,
  onDayClick
}: {
  month: string;
  today: string;
  matrix: ReturnType<typeof buildPersonDayMatrix>;
  person: Person;
  onDayClick: (date: string) => void;
}) {
  // The grid always shows the whole month, also when a day range starts mid-month.
  const leading = isoWeekday(monthBounds(month).start);
  const byDate = new Map(matrix.rows[0]?.cells.map((cell) => [cell.date, cell]) ?? []);
  const days = eachDate(monthBounds(month).start, monthBounds(month).end);
  return (
    <SectionCard
      title={`Lịch ghi giờ của tôi — ${formatMonth(month)}`}
      description="Bấm một ngày đã ghi giờ để xem các dòng Time Log nguồn."
      actions={<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Avatar person={person} />{person.name}</span>}
      id="personal-calendar"
    >
      <div className="grid grid-cols-7 gap-1 border-b border-border px-3 py-2">
        {WEEKDAYS.map((day) => <span key={day} className="text-center text-[10px] font-semibold uppercase text-muted-foreground">{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1 p-3">
        {Array.from({ length: leading }, (_, index) => <span key={`empty-${index}`} aria-hidden />)}
        {days.map((date) => {
          const cell = byDate.get(date);
          const isFuture = date > today;
          const hasLogs = Boolean(cell?.minutes);
          const missing = Boolean(cell?.isWorkingDay && !hasLogs && !isFuture);
          const tone = hasLogs ? "border-success/30 bg-success/[0.06]" : missing ? "border-warning/40 bg-warning/[0.08]" : "border-border bg-muted/20";
          return (
            <button
              key={date}
              type="button"
              disabled={!hasLogs}
              onClick={() => onDayClick(date)}
              className={`min-h-[54px] rounded-lg border p-1.5 text-left transition-colors ${tone} ${hasLogs ? "hover:border-primary hover:bg-primary/[0.06]" : "disabled:cursor-default"} ${date === today ? "ring-2 ring-primary/60" : ""}`}
              aria-label={`${formatDate(date)}: ${hasLogs ? formatHours(cell?.minutes) : missing ? "chưa ghi giờ" : "không có giờ"}`}
            >
              <span className={`block text-[10px] ${date === today ? "font-bold text-primary" : "text-muted-foreground"}`}>{date.slice(-2)}{date === today ? " · hôm nay" : ""}</span>
              <span className={`mt-1 block text-[12px] font-bold tabular-nums ${hasLogs ? "text-foreground" : missing ? "text-warning" : "text-muted-foreground/70"}`}>{hasLogs ? formatHours(cell?.minutes) : "—"}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-success" />Đã ghi giờ</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warning" />Ngày làm việc còn trống</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />Cuối tuần / chưa tới</span>
      </div>
    </SectionCard>
  );
}

function TodayTasksCard({ tasks, today, onLog }: { tasks: PersonalTask[]; today: string; onLog: (task: PersonalTask) => void }) {
  const visible = tasks
    .filter(({ task }) => !isClosedNodeStatus(task.status))
    .sort((a, b) => Number(isTaskOverdue(b.task, b.project.status, today)) - Number(isTaskOverdue(a.task, a.project.status, today)) || (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999"))
    .slice(0, 6);
  return (
    <SectionCard title="Task của tôi hôm nay" description="Theo kế hoạch đã duyệt · ưu tiên task quá hạn và đến hạn." actions={<ListTodo className="h-4 w-4 text-primary" />} id="personal-tasks">
      {visible.length === 0 ? <EmptyState message="Bạn không có task mở cần xử lý." /> : (
        <ul className="divide-y divide-border">
          {visible.map(({ task, project, milestoneName }) => {
            const overdue = isTaskOverdue(task, project.status, today);
            return (
              <li key={`${project.id}:${task.id}`} className="flex items-center gap-2.5 px-4 py-3">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${overdue ? "bg-destructive" : task.status === "in_progress" ? "bg-info" : task.status === "waiting" ? "bg-warning" : "bg-muted-foreground/40"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={currentTaskTone(task, overdue)}>{overdue ? "Quá hạn" : NODE_STATUS_LABELS[task.status]}</Pill>
                    <span className="truncate text-[12.5px] font-semibold text-foreground">{task.name}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{project.code} · {milestoneName}{task.dueDate ? ` · hạn ${formatDateShort(task.dueDate)}` : ""}</p>
                </div>
                <button type="button" onClick={() => onLog({ task, project, milestoneName, stageName: "" })} className="shrink-0 rounded-md border border-primary/30 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/5">Ghi giờ</button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">{visible.length} task đang mở hiển thị</span>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">Xem tất cả <ArrowRight className="h-3 w-3" /></Link>
      </div>
    </SectionCard>
  );
}

export function PersonalProjectTree({ dataset, logs }: { dataset: TimesheetDataset; logs: TimesheetDataset["logs"] }) {
  const rows = buildPersonProjectRows(dataset, logs);
  return (
    <SectionCard title="Giờ của tôi theo dự án" description="Nhóm theo milestone; số giờ lấy từ các dòng Time Log nguồn." id="personal-projects">
      {rows.length === 0 ? <EmptyState message="Chưa có dòng ghi giờ theo dự án trong kỳ này." /> : (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <details key={row.project.id} open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-bold">{row.project.code} — {row.project.name}</p><p className="text-[10.5px] text-muted-foreground">{projectStatusLabel(row.project.status)} · {row.taskCount} task có log</p></div>
                <span className="font-mono text-[12px] font-bold tabular-nums">{formatHours(row.actualMinutes)}</span>
                <Pill tone={projectStatusTone(row.project.status)}>{projectStatusLabel(row.project.status)}</Pill>
              </summary>
              <div className="space-y-1 border-t border-border bg-muted/[0.12] px-4 py-3 pl-10">
                {row.milestones.map((milestone) => (
                  <div key={milestone.milestone.id}>
                    <div className="flex items-center gap-2 py-1"><span className="text-[11.5px] font-semibold">{milestone.milestone.name}</span><Pill tone={nodeStatusTone(milestone.milestone.status)}>{NODE_STATUS_LABELS[milestone.milestone.status]}</Pill><span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{formatHours(milestone.actualMinutes)}</span></div>
                    {milestone.stages.map((stage) => <div key={stage.stage.id} className="ml-3 border-l border-border pl-3">
                      <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">{stage.stage.name}</span><span className="ml-auto font-mono tabular-nums">{formatHours(stage.actualMinutes)}</span></div>
                      {stage.tasks.map(({ task, actualMinutes }) => <Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-primary/[0.05]"><span className="min-w-0 flex-1 truncate">{task.name}</span><Pill tone={nodeStatusTone(task.status)}>{NODE_STATUS_LABELS[task.status]}</Pill><span className="font-mono font-semibold tabular-nums">{formatHours(actualMinutes)}</span><ExternalLink className="h-3 w-3 text-muted-foreground" /></Link>)}
                    </div>)}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function PersonalTimesheet() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  useRememberedQuery("timesheet-me");
  const [dataset, setDataset] = useState(() => emptyTimesheetDataset());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [drawer, setDrawer] = useState<LogDrawerRequest | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadTimesheetDataset(controller.signal)
      .then(setDataset)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu Timesheet."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadToken]);

  const person = useMemo(() => resolvePerson(dataset, user), [dataset, user]);
  const pathname = usePathname();
  const today = dataset.generatedAt.slice(0, 10);
  const windowStart = dataset.windowStart ?? "";
  const defaultMonth = dataset.months.at(-1) ?? today.slice(0, 7);
  // Same rule as /timesheet: the day range decides the period and the month follows its last day.
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const month = to ? to.slice(0, 7) : searchParams.get("month") ?? defaultMonth;
  const projectKey = searchParams.get("project") ?? "";
  const search = searchParams.get("q") ?? "";
  const periodFilters = useMemo<TimesheetFilters>(() => ({
    month,
    dateFrom: from || undefined,
    dateTo: to || undefined,
    departmentId: "all",
    personId: person?.id ?? "all",
    personIds: person ? [person.id] : [],
    projectId: "all",
    workGroup: "all"
  }), [from, month, person, to]);
  const filters = useMemo<TimesheetFilters>(() => ({ ...periodFilters, projectIds: fromCsvParam(projectKey), search }), [periodFilters, projectKey, search]);
  const period = { start: from || monthBounds(month).start, end: to || monthBounds(month).end };
  const commit = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Everything of this person in the period; the project and text filters narrow what the cards list.
  const periodLogs = useMemo(() => person ? filterLogs(dataset, periodFilters) : [], [dataset, periodFilters, person]);
  const personalLogs = useMemo(() => person ? filterLogs(dataset, filters) : [], [dataset, filters, person]);
  const personalProjects = useMemo(() => person ? dataset.projects.filter((project) => project.picId === person.id || project.members.some((member) => member.personId === person.id)) : [], [dataset.projects, person]);
  const personalDataset = useMemo(() => ({ ...dataset, people: person ? [person] : [], projects: personalProjects, logs: personalLogs }), [dataset, person, personalLogs, personalProjects]);
  const matrix = useMemo(() => buildPersonDayMatrix(personalDataset, filters, personalLogs), [filters, personalDataset, personalLogs]);
  // "Ngày còn trống" ignores the project and text filters: a day with hours on another project is not empty.
  const periodMatrix = useMemo(() => buildPersonDayMatrix(personalDataset, periodFilters, periodLogs), [periodFilters, periodLogs, personalDataset]);
  const workingDays = period.start <= today ? eachDate(period.start, period.end < today ? period.end : today).filter((date) => isWorkingDay(date, dataset.holidays)) : [];
  const standardMinutes = person ? standardMinutesFor(person, workingDays.length - sum(workingDays.map((date) => leaveFraction(dataset, person.id, date)))) : 0;
  const actualMinutes = sum(personalLogs.map((log) => log.minutes));
  const missingDays = periodMatrix.rows[0]?.cells.filter((cell) => cell.isWorkingDay && cell.date <= today && cell.minutes === 0 && !(person && leaveFraction(dataset, person.id, cell.date) >= 1)) ?? [];
  const periodLabel = formatFilterPeriod(filters);
  const activeFilterCount = (filters.projectIds?.length ? 1 : 0) + (search ? 1 : 0) + (from || to || month !== defaultMonth ? 1 : 0);
  const datePresets = [
    ...standardDatePresets(today)
      .filter((preset) => ["today", "last-7-days", "last-30-days", "this-month", "last-month", "this-quarter"].includes(preset.id))
      .map((preset) => ({ ...preset, from: preset.from < windowStart ? windowStart : preset.from })),
    { id: "month", label: `Cả ${formatMonth(month).toLowerCase()}`, from: monthBounds(month).start, to: monthBounds(month).end }
  ];
  const allTasks = useMemo(() => person ? personalTasks(personalDataset, person.id) : [], [person, personalDataset]);
  const openTasks = allTasks.filter(({ task }) => !isClosedNodeStatus(task.status));
  const overdueTasks = openTasks.filter(({ task, project }) => isTaskOverdue(task, project.status, today));

  const openDay = (date: string) => {
    const logs = personalLogs.filter((log) => log.date === date);
    if (!logs.length || !person) return;
    setDrawer({ title: `Time Log của ${person.name} · ${formatDate(date)}`, description: "Các dòng ghi nhận trong ngày.", logs });
  };
  const openTask = (item: PersonalTask) => {
    router.push(`/tasks/${item.task.id}`);
  };

  const header = (
    <PageHeader
      back={{ href: "/timesheet", label: "Timesheet" }}
      title="Timesheet của tôi"
      subtitle={person ? `Giờ, task và kế hoạch của ${person.name}.` : "Giờ, task và kế hoạch của bạn."}
      actions={<HeaderButton icon={<RefreshCw className="h-4 w-4" aria-hidden />} onClick={() => setReloadToken((value) => value + 1)} aria-label="Tải lại dữ liệu">Tải lại</HeaderButton>}
    />
  );
  const shell = (body: React.ReactNode) => <div className="mx-auto w-full max-w-[1500px] space-y-4 pb-8">{header}{body}</div>;

  if (authLoading || loading) return shell(<LoadingPersonalTimesheet />);
  if (error) return shell(<div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"><p className="font-semibold text-destructive">Không tải được dữ liệu Timesheet của tôi</p><p className="mt-1 text-[12px] text-muted-foreground">{error}</p></div>);
  if (!person) return shell(<div role="alert" className="rounded-xl border border-warning/30 bg-warning/5 p-5"><p className="font-semibold text-foreground">Chưa tìm thấy hồ sơ nhân sự của tài khoản hiện tại.</p><p className="mt-1 text-[12px] text-muted-foreground">Kiểm tra User ID trong danh bạ workspace, sau đó tải lại trang.</p></div>);

  return shell(
    <>
      <section aria-label="Bộ lọc Timesheet của tôi" className="rounded-xl border border-border bg-card p-3">
        <FilterBar onReset={activeFilterCount > 0 ? () => commit({ month: "", from: "", to: "", project: "", q: "" }) : undefined} activeCount={activeFilterCount}>
          <FilterField label="Tìm kiếm" className="min-w-[200px] flex-1">
            <SearchFilter className="" ariaLabel="Tìm theo công việc, dự án hoặc ghi chú" placeholder="Tìm công việc, dự án, ghi chú..." value={search} onChange={(value) => commit({ q: value })} />
          </FilterField>
          <FilterField label="Kỳ báo cáo" className="shrink-0">
            <MonthFilter ariaLabel="Chọn tháng" months={[...new Set([...dataset.months, month])]} value={month} onChange={(value) => commit({ month: value, from: "", to: "" })} />
          </FilterField>
          <FilterField label="Khoảng ngày ghi nhận" className="min-w-[15rem] flex-[1.2]">
            <DateRangeFilter ariaLabel="Lọc theo khoảng ngày ghi nhận" value={{ from: period.start, to: period.end }} presets={datePresets} maxDays={366} clearable={false} onChange={(range) => commit(periodParamsForRange(range, windowStart))} />
          </FilterField>
          <MultiSelectFilter label="Dự án" allLabel="Tất cả dự án" options={personalProjects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))} values={filters.projectIds ?? []} onChange={(values) => commit({ project: values.join(",") })} />
        </FilterBar>
      </section>
      {(missingDays.length > 0 || openTasks.length > 0) ? <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /><div className="min-w-0 flex-1"><p className="text-[12.5px] font-bold text-foreground">Cần bổ sung dữ liệu hôm nay</p><p className="text-[11.5px] text-muted-foreground">{missingDays.length > 0 ? `${missingDays.length} ngày làm việc chưa ghi giờ` : "Bạn vẫn còn task đang mở cần theo dõi."}{overdueTasks.length > 0 ? ` · ${overdueTasks.length} task quá hạn` : ""}</p></div><Link href={openTasks[0] ? `/tasks/${openTasks[0].task.id}` : "/tasks"} className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-2 text-[12px] font-bold text-warning-foreground hover:opacity-90">Ghi giờ ngay <ArrowRight className="h-3.5 w-3.5" /></Link></div> : <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3 text-[12px] text-success"><CheckCircle2 className="h-4 w-4" /> Dữ liệu ghi giờ của bạn đang đầy đủ trong kỳ đã chọn.</div>}
      {personalLogs.length === 0 && (search || filters.projectIds?.length) ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <span>Không có kết quả phù hợp bộ lọc.</span>
          <button type="button" onClick={() => commit({ month: "", from: "", to: "", project: "", q: "" })} className="!text-[12px] !font-semibold text-primary hover:underline">Đặt lại bộ lọc</button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><KpiCard label={`Giờ thực tế của tôi — ${periodLabel}`} value={formatHours(actualMinutes)} hint={`so với ${formatHours(standardMinutes)} giờ chuẩn`} badge={standardMinutes > 0 ? formatPercent((actualMinutes / standardMinutes) * 100) : "Chưa có chuẩn"} tone={actualMinutes >= standardMinutes ? "success" : "warning"} /><KpiCard label="Ngày còn trống" value={`${missingDays.length}`} hint={missingDays.length ? missingDays.slice(0, 3).map((cell) => formatDateShort(cell.date)).join(" · ") : "Không còn ngày trống"} badge={missingDays.length ? "Cần ghi bổ sung" : "Đã đủ"} tone={missingDays.length ? "warning" : "success"} /><KpiCard label="Task của tôi đang mở" value={`${openTasks.length}`} hint={`${overdueTasks.length} quá hạn · ${openTasks.filter(({ task }) => task.status === "in_progress").length} đang làm`} badge={openTasks.length ? "Theo dõi" : "Đã hoàn thành"} tone={openTasks.length ? "info" : "success"} /></div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]"><CalendarCard month={month} today={today} matrix={matrix} person={person} onDayClick={openDay} /><TodayTasksCard tasks={allTasks} today={today} onLog={openTask} /></div>
      <PersonalProjectTree dataset={personalDataset} logs={personalLogs} />
      <LogDrawer dataset={personalDataset} request={drawer} onClose={() => setDrawer(null)} currentUserId={person.id} />
    </>
  );
}
