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
import { emptyTimesheetDataset, loadTimesheetDataset } from "./timesheet-live-data";
import { eachDate, monthBounds } from "./timesheet-mock-data";
import {
  buildPersonDayMatrix,
  buildPersonProjectRows,
  projectTasks,
  standardMinutesFor,
  sum,
  workingDaysInMonth,
  type TimesheetFilters
} from "./timesheet-selectors";
import {
  formatDate,
  formatDateShort,
  formatHours,
  formatMonth,
  formatPercent,
  nodeStatusTone,
  projectStatusTone
} from "./timesheet-format";
import {
  NODE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
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

function currentTaskTone(task: TaskNode, today: string) {
  if (task.status === "completed") return "success" as const;
  if (task.status === "blocked") return "danger" as const;
  if (task.dueDate && task.dueDate < today) return "danger" as const;
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
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải Giờ của tôi">
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => <div key={index} className="h-[112px] animate-pulse rounded-xl bg-muted" />)}
      </div>
      <div className="h-[390px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function PersonalTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectView = searchParams.get("view") === "project";
  const tabs = [
    { href: "/timesheet/me", label: "Giờ của tôi", description: "Tập trung cá nhân" },
    { href: "/timesheet", label: "Bảng giờ theo tháng", description: "Tổng hợp theo nhân sự" },
    { href: "/timesheet?view=project", label: "Bảng giờ theo dự án", description: "Tổng hợp theo dự án" }
  ];
  return (
    <nav aria-label="Các màn hình Timesheet" className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
      {tabs.map((tab) => {
        const active = tab.href === "/timesheet/me"
          ? pathname === "/timesheet/me"
          : pathname === "/timesheet" && (tab.href.includes("view=project") === projectView);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`min-w-[150px] flex-1 rounded-lg px-3 py-2 text-left transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="block text-[12.5px] font-semibold">{tab.label}</span>
            <span className="mt-0.5 block text-[10.5px]">{tab.description}</span>
          </Link>
        );
      })}
    </nav>
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
  const firstDay = matrix.days[0]?.date ?? monthBounds(month).start;
  const leading = isoWeekday(firstDay);
  const byDate = new Map(matrix.rows[0]?.cells.map((cell) => [cell.date, cell]) ?? []);
  const days = eachDate(monthBounds(month).start, monthBounds(month).end);
  return (
    <SectionCard
      title={`Lịch ghi giờ của tôi — ${formatMonth(month)}`}
      description="Bấm một ngày đã ghi giờ để xem các dòng Time Log nguồn."
      actions={<span className="text-[11px] text-muted-foreground">{person.name}</span>}
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
    .filter(({ task }) => task.status !== "completed")
    .sort((a, b) => Number(Boolean(b.task.dueDate && b.task.dueDate < today)) - Number(Boolean(a.task.dueDate && a.task.dueDate < today)) || (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999"))
    .slice(0, 6);
  return (
    <SectionCard title="Task của tôi hôm nay" description="Theo kế hoạch đã duyệt · ưu tiên task quá hạn và đến hạn." actions={<ListTodo className="h-4 w-4 text-primary" />} id="personal-tasks">
      {visible.length === 0 ? <EmptyState message="Bạn không có task mở cần xử lý." /> : (
        <ul className="divide-y divide-border">
          {visible.map(({ task, project, milestoneName }) => {
            const overdue = Boolean(task.dueDate && task.dueDate < today);
            return (
              <li key={`${project.id}:${task.id}`} className="flex items-center gap-2.5 px-4 py-3">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${overdue ? "bg-destructive" : task.status === "in_progress" ? "bg-info" : "bg-muted-foreground/40"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={currentTaskTone(task, today)}>{overdue ? "Quá hạn" : NODE_STATUS_LABELS[task.status]}</Pill>
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

function PersonalProjectTree({ dataset, logs }: { dataset: TimesheetDataset; logs: TimesheetDataset["logs"] }) {
  const rows = buildPersonProjectRows(dataset, logs);
  return (
    <SectionCard title="Giờ của tôi theo dự án" description="Gập theo Milestone; số giờ lấy từ các dòng Time Log nguồn." id="personal-projects">
      {rows.length === 0 ? <EmptyState message="Chưa có dòng ghi giờ theo dự án trong kỳ này." /> : (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <details key={row.project.id} open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-bold">{row.project.code} — {row.project.name}</p><p className="text-[10.5px] text-muted-foreground">{PROJECT_STATUS_LABELS[row.project.status]} · {row.taskCount} task có log</p></div>
                <span className="font-mono text-[12px] font-bold tabular-nums">{formatHours(row.actualMinutes)}</span>
                <Pill tone={projectStatusTone(row.project.status)}>{PROJECT_STATUS_LABELS[row.project.status]}</Pill>
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
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const month = searchParams.get("month") ?? dataset.months.at(-1) ?? new Date().toISOString().slice(0, 7);
  const today = dataset.generatedAt.slice(0, 10);
  const personalLogs = useMemo(() => person ? dataset.logs.filter((log) => log.personId === person.id && log.date.startsWith(month)) : [], [dataset.logs, month, person]);
  const personalProjects = useMemo(() => person ? dataset.projects.filter((project) => project.picId === person.id || project.members.some((member) => member.personId === person.id)) : [], [dataset.projects, person]);
  const personalDataset = useMemo(() => ({ ...dataset, people: person ? [person] : [], projects: personalProjects, logs: personalLogs }), [dataset, person, personalLogs, personalProjects]);
  const filters = useMemo<TimesheetFilters>(() => ({ month, departmentId: "all", personId: person?.id ?? "all", projectId: "all", workGroup: "all" }), [month, person?.id]);
  const matrix = useMemo(() => buildPersonDayMatrix(personalDataset, filters, personalLogs), [filters, personalDataset, personalLogs]);
  const workingDays = useMemo(() => workingDaysInMonth(month, dataset.holidays, month === today.slice(0, 7) ? today : undefined), [dataset.holidays, month, today]);
  const standardMinutes = person ? standardMinutesFor(person, workingDays.length) : 0;
  const actualMinutes = sum(personalLogs.map((log) => log.minutes));
  const missingDays = matrix.rows[0]?.cells.filter((cell) => cell.isWorkingDay && cell.date <= today && cell.minutes === 0) ?? [];
  const allTasks = useMemo(() => person ? personalTasks(personalDataset, person.id) : [], [person, personalDataset]);
  const openTasks = allTasks.filter(({ task }) => task.status !== "completed");
  const overdueTasks = openTasks.filter(({ task }) => Boolean(task.dueDate && task.dueDate < today));

  const openDay = (date: string) => {
    const logs = personalLogs.filter((log) => log.date === date);
    if (!logs.length || !person) return;
    setDrawer({ title: `Time Log của ${person.name} · ${formatDate(date)}`, description: "Các dòng ghi nhận trong ngày.", logs });
  };
  const openTask = (item: PersonalTask) => {
    router.push(`/tasks/${item.task.id}`);
  };

  if (loading) return <LoadingPersonalTimesheet />;
  if (error) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"><p className="font-semibold text-destructive">Không tải được dữ liệu Giờ của tôi</p><p className="mt-1 text-[12px] text-muted-foreground">{error}</p><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-[12px] font-semibold text-destructive"><RefreshCw className="h-3.5 w-3.5" /> Thử lại</button></div>;
  if (!person) return <div role="alert" className="rounded-xl border border-warning/30 bg-warning/5 p-5"><p className="font-semibold text-foreground">Chưa tìm thấy hồ sơ nhân sự của tài khoản hiện tại.</p><p className="mt-1 text-[12px] text-muted-foreground">Kiểm tra User ID trong workspace directory rồi tải lại.</p><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold"><RefreshCw className="h-3.5 w-3.5" /> Tải lại</button></div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">TIMESHEET · GIỜ CỦA TÔI</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Giờ của tôi</h1><p className="mt-1 text-[13px] text-muted-foreground">Tập trung vào giờ, task và kế hoạch của {person.name}.</p></div>
        <div className="flex items-center gap-2"><label className="sr-only" htmlFor="personal-month">Chọn tháng</label><select id="personal-month" value={month} onChange={(event) => router.push(`/timesheet/me?month=${event.target.value}`)} className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-semibold text-foreground">{dataset.months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}</select><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground" aria-label="Tải lại dữ liệu"><RefreshCw className="h-3.5 w-3.5" /> Tải lại</button></div>
      </div>
      <PersonalTabs />
      {(missingDays.length > 0 || openTasks.length > 0) ? <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /><div className="min-w-0 flex-1"><p className="text-[12.5px] font-bold text-foreground">Cần bổ sung dữ liệu hôm nay</p><p className="text-[11.5px] text-muted-foreground">{missingDays.length > 0 ? `${missingDays.length} ngày làm việc chưa ghi giờ` : "Bạn vẫn còn task đang mở cần theo dõi."}{overdueTasks.length > 0 ? ` · ${overdueTasks.length} task quá hạn` : ""}</p></div><Link href={openTasks[0] ? `/tasks/${openTasks[0].task.id}` : "/tasks"} className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-2 text-[12px] font-bold text-warning-foreground hover:opacity-90">Ghi giờ ngay <ArrowRight className="h-3.5 w-3.5" /></Link></div> : <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3 text-[12px] text-success"><CheckCircle2 className="h-4 w-4" /> Dữ liệu ghi giờ của bạn đang đầy đủ trong kỳ đã chọn.</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><KpiCard label={`Giờ tôi đã ghi — ${formatMonth(month)}`} value={formatHours(actualMinutes)} hint={`so với ${formatHours(standardMinutes)} giờ chuẩn`} badge={standardMinutes > 0 ? formatPercent((actualMinutes / standardMinutes) * 100) : "Chưa có chuẩn"} tone={actualMinutes >= standardMinutes ? "success" : "warning"} /><KpiCard label="Ngày còn trống" value={`${missingDays.length}`} hint={missingDays.length ? missingDays.slice(0, 3).map((cell) => formatDateShort(cell.date)).join(" · ") : "Không còn ngày trống"} badge={missingDays.length ? "Cần ghi bổ sung" : "Đã đủ"} tone={missingDays.length ? "warning" : "success"} /><KpiCard label="Task của tôi đang mở" value={`${openTasks.length}`} hint={`${overdueTasks.length} quá hạn · ${openTasks.filter(({ task }) => task.status === "in_progress").length} đang làm`} badge={openTasks.length ? "Theo dõi" : "Đã hoàn tất"} tone={openTasks.length ? "info" : "success"} /></div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]"><CalendarCard month={month} today={today} matrix={matrix} person={person} onDayClick={openDay} /><TodayTasksCard tasks={allTasks} today={today} onLog={openTask} /></div>
      <PersonalProjectTree dataset={personalDataset} logs={personalLogs} />
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground"><span className="font-semibold text-primary">Vì sao có màn này?</span> Nhân sự chỉ cần theo dõi giờ và task của chính mình, không phải cuộn qua bảng 12 người và nhiều biểu đồ quản trị. Bảng tháng và bảng dự án vẫn giữ nguyên cho PM/Founder xem tổng hợp.</div>
      <LogDrawer dataset={personalDataset} request={drawer} onClose={() => setDrawer(null)} currentUserId={person.id} />
    </div>
  );
}
