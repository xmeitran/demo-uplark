"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  Layers3,
  Search,
  ShieldCheck,
  TriangleAlert,
  UsersRound
} from "lucide-react";
import type { ProjectPlSummaryItem, ProjectSummary, ResourceListResponse, TaskTimeEntrySummary } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import {
  adaptLivePnlProjects,
  formatCompactVnd,
  formatHours,
  formatVnd,
  hours,
  type PnlExpense,
  type PnlPerson,
  type PnlProject,
  type PnlProjectStatus
} from "./pnl-data";

type PnlWorkbenchProps = { projectId?: string };

const STATUS_OPTIONS: Array<"all" | PnlProjectStatus> = ["all", "Chờ xử lý", "Đã đối soát", "Thiếu dữ liệu"];

function currentPeriod() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
}

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `Tháng ${String(month).padStart(2, "0")}/${year}`;
}

function previousPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = `${period}-01T00:00:00+07:00`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { start, end: `${nextMonth}-01T00:00:00+07:00` };
}

function statusTone(status: PnlProjectStatus) {
  if (status === "Đã đối soát") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "Thiếu dữ liệu") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function IconBox({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "violet" | "amber" | "slate" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600"
  };
  return <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>{children}</span>;
}

function KpiCard({ label, value, icon, tone = "blue", note }: { label: string; value: string; icon: React.ReactNode; tone?: "blue" | "green" | "violet" | "amber" | "slate"; note?: string }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">{value}</p>
          {note ? <p className="mt-1 text-[11px] text-muted-foreground">{note}</p> : null}
        </div>
        <IconBox tone={tone}>{icon}</IconBox>
      </div>
    </article>
  );
}

function FilterSelect({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; disabled?: boolean }) {
  return (
    <label className="relative block min-w-[150px]">
      <span className="sr-only">{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-border bg-card px-3 pr-9 text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}

function ExpenseGroups({ expenses }: { expenses: PnlExpense[] }) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-label="Expenses theo sáu nhóm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">PROJECT P&amp;L</p>
          <h2 className="mt-1 text-lg font-bold text-foreground">Expenses theo 6 nhóm</h2>
          <p className="mt-1 text-xs text-muted-foreground">Phân bổ chi phí theo nhóm để soi nhanh cơ cấu giá vốn.</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{formatVnd(total)}</span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {expenses.map((expense) => {
          const percent = total > 0 ? Math.round((expense.amount / total) * 100) : 0;
          return (
            <div key={expense.key} className="rounded-xl border border-border/80 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-foreground">{expense.label}</span>
                <span className="font-mono font-bold tabular-nums text-muted-foreground">{percent}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: expense.color }} />
              </div>
              <p className="mt-2 text-sm font-bold tabular-nums text-foreground">{formatVnd(expense.amount)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProjectTable({ projects, period }: { projects: PnlProject[]; period: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label="Đối soát P&L theo project">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Đối soát theo project</p>
          <h2 className="mt-1 text-lg font-bold text-foreground">Plan ≠ Logwork ≠ P&amp;L</h2>
          <p className="mt-1 text-xs text-muted-foreground">Chọn một dòng để mở toàn bộ chi tiết theo người và ngày.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Project / phạm vi</th>
              <th className="px-3 py-3 text-right">Plan hour</th>
              <th className="px-3 py-3 text-right">Logwork hour</th>
              <th className="px-3 py-3 text-right">P&amp;L hour</th>
              <th className="px-3 py-3 text-right">Bị loại</th>
              <th className="px-3 py-3 text-right">Chờ xử lý</th>
              <th className="px-5 py-3">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {projects.map((project) => (
              <tr key={project.id} className="group transition-colors hover:bg-muted/20">
                <td className="px-5 py-4">
                  <Link href={`/pnl/${encodeURIComponent(project.id)}?period=${encodeURIComponent(period)}`} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                    <span className="block font-bold text-foreground group-hover:text-primary">{project.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{project.code} · {project.client}</span>
                  </Link>
                </td>
                <td className="px-3 py-4 text-right font-mono font-semibold tabular-nums">{formatHours(project.planMinutes)}</td>
                <td className="px-3 py-4 text-right font-mono font-semibold tabular-nums">{formatHours(project.logworkMinutes)}</td>
                <td className="px-3 py-4 text-right font-mono font-semibold tabular-nums text-blue-700">{formatHours(project.pnlMinutes)}</td>
                <td className="px-3 py-4 text-right font-mono tabular-nums text-muted-foreground">{formatHours(project.excludedMinutes)}</td>
                <td className="px-3 py-4 text-right font-mono font-semibold tabular-nums text-amber-700">{formatHours(project.pendingMinutes)}</td>
                <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(project.status)}`}>{project.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {projects.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Không có project phù hợp với bộ lọc hiện tại.</div> : null}
    </section>
  );
}

function DownloadButton({ projects, period }: { projects: PnlProject[]; period: string }) {
  const exportCsv = () => {
    const rows = [
      ["Project", "Client", "Plan hour", "Logwork hour", "P&L hour", "Excluded hour", "Pending hour", "Status"],
      ...projects.map((project) => [project.name, project.client, hours(project.planMinutes), hours(project.logworkMinutes), hours(project.pnlMinutes), hours(project.excludedMinutes), hours(project.pendingMinutes), project.status])
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pnl-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-primary/30 hover:bg-primary/5"><Download className="h-4 w-4" /> Xuất báo cáo</button>;
}

function Overview({ projects, period, onPeriodChange }: { projects: PnlProject[]; period: string; onPeriodChange: (period: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const filteredProjects = useMemo(() => projects.filter((project) => {
    const matchesQuery = !query.trim() || `${project.name} ${project.code} ${project.client}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = status === "all" || project.status === status;
    const matchesProject = projectFilter === "all" || project.id === projectFilter;
    return matchesQuery && matchesStatus && matchesProject;
  }), [projects, projectFilter, query, status]);
  const totals = filteredProjects.reduce((acc, project) => ({
    revenue: acc.revenue + project.revenue,
    plan: acc.plan + project.planMinutes,
    logwork: acc.logwork + project.logworkMinutes,
    pnl: acc.pnl + project.pnlMinutes,
    pending: acc.pending + project.pendingMinutes
  }), { revenue: 0, plan: 0, logwork: 0, pnl: 0, pending: 0 });
  const expenses = filteredProjects.reduce((acc, project) => {
    project.expenses.forEach((expense) => {
      const current = acc.get(expense.key) ?? { ...expense, amount: 0 };
      current.amount += expense.amount;
      acc.set(expense.key, current);
    });
    return acc;
  }, new Map<string, PnlExpense>());

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">Finance · Project control</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Project P&amp;L — tổng quan &amp; đối soát</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Theo dõi doanh thu, baseline giờ, logwork thực tế và giờ đủ điều kiện đưa vào P&amp;L theo từng project.</p>
          </div>
          <div className="text-xs font-semibold text-muted-foreground">Theo kỳ báo cáo và phạm vi project</div>
        </div>
        <div className="mt-6 grid gap-2 md:grid-cols-[minmax(230px,1fr)_180px_180px_auto]">
          <label className="relative block">
            <span className="sr-only">Tìm project</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm project, client..." className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </label>
          <FilterSelect label="Kỳ báo cáo" value={period} onChange={onPeriodChange} options={[{ value: period, label: periodLabel(period) }, { value: previousPeriod(period), label: periodLabel(previousPeriod(period)) }]} />
          <FilterSelect label="Trạng thái project" value={status} onChange={setStatus} options={STATUS_OPTIONS.map((value) => ({ value, label: value === "all" ? "Tất cả trạng thái" : value }))} />
          <DownloadButton projects={filteredProjects} period={period} />
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(230px,1fr)_180px_180px_auto]">
          <div className="hidden md:block" />
          <div className="hidden md:block" />
          <FilterSelect label="Lọc theo project" value={projectFilter} onChange={setProjectFilter} options={[{ value: "all", label: "Tất cả project" }, ...projects.map((project) => ({ value: project.id, label: project.code }))]} />
          <div className="hidden md:block" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm">
        <span className="font-semibold text-foreground">Đang hiển thị</span>
        <span className="rounded-full bg-muted px-2.5 py-1 font-bold text-foreground">{filteredProjects.length} / {projects.length} project</span>
        <span>Tất cả dữ liệu trong kỳ báo cáo</span>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Tổng quan P&L">
        <KpiCard label="Projects" value={String(filteredProjects.length)} icon={<Layers3 className="h-4 w-4" />} />
        <KpiCard label="Revenue" value={formatCompactVnd(totals.revenue)} icon={<ArrowUpRight className="h-4 w-4" />} tone="green" />
        <KpiCard label="Plan Hour" value={formatHours(totals.plan)} icon={<CalendarDays className="h-4 w-4" />} tone="violet" />
        <KpiCard label="Logwork Hour" value={formatHours(totals.logwork)} icon={<Clock3 className="h-4 w-4" />} />
        <KpiCard label="P&L Hour" value={formatHours(totals.pnl)} icon={<Check className="h-4 w-4" />} tone="green" note="Logwork đủ điều kiện" />
        <KpiCard label="Chờ xử lý" value={formatHours(totals.pending)} icon={<TriangleAlert className="h-4 w-4" />} tone="amber" note="Thiếu duyệt hoặc cost rate" />
      </section>

      <ProjectTable projects={filteredProjects} period={period} />
      <ExpenseGroups expenses={Array.from(expenses.values())} />
    </div>
  );
}

function MiniDailyChart({ project }: { project: PnlProject }) {
  const max = Math.max(...project.daily.map((point) => point.minutes), 1);
  return (
    <div className="mt-5 rounded-xl border border-border/80 bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{project.daily.length} ngày ghi nhận</span><span className="font-mono font-semibold">Tổng {formatHours(project.logworkMinutes)}</span></div>
      <div className="mt-5 flex h-36 items-end gap-1.5 overflow-x-auto pb-5">
        {project.daily.map((point) => (
          <div key={point.date} className="group flex h-full min-w-5 flex-1 flex-col items-center justify-end gap-1">
            <span className="pointer-events-none rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 transition group-hover:opacity-100">{hours(point.minutes)}h</span>
            <div className="w-full rounded-t-md bg-blue-500/80 transition group-hover:bg-blue-600" style={{ height: `${Math.max(8, (point.minutes / max) * 100)}%` }} />
            <span className="text-[9px] text-muted-foreground">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonMatrix({ people }: { people: PnlPerson[] }) {
  const dates = people[0] ? Object.keys(people[0].daily).slice(0, 10) : [];
  return (
    <div className="overflow-x-auto rounded-xl border border-border/80">
      <table className="w-full min-w-[920px] text-left text-xs">
        <thead className="bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <tr><th className="sticky left-0 z-10 bg-muted/30 px-4 py-3">Nhân sự / vai trò</th><th className="px-3 py-3 text-right">Plan</th><th className="px-3 py-3 text-right">Logwork</th><th className="px-3 py-3 text-right">P&amp;L</th>{dates.map((date) => <th key={date} className="px-3 py-3 text-right">{date}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {people.map((person) => <tr key={person.id} className="hover:bg-muted/15"><td className="sticky left-0 bg-card px-4 py-3"><span className="block font-semibold text-foreground">{person.name}</span><span className="text-[10px] text-muted-foreground">{person.role}</span></td><td className="px-3 py-3 text-right font-mono tabular-nums">{formatHours(person.planMinutes)}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{formatHours(person.logworkMinutes)}</td><td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-blue-700">{formatHours(person.pnlMinutes)}</td>{dates.map((date) => <td key={date} className="px-3 py-3 text-right font-mono tabular-nums">{hours(person.daily[date]?.logwork ?? 0).toFixed(1)}</td>)}</tr>)}
          <tr className="bg-muted/30 font-bold"><td className="sticky left-0 bg-muted/30 px-4 py-3">Tổng theo người</td><td className="px-3 py-3 text-right font-mono">{formatHours(people.reduce((sum, person) => sum + person.planMinutes, 0))}</td><td className="px-3 py-3 text-right font-mono">{formatHours(people.reduce((sum, person) => sum + person.logworkMinutes, 0))}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(people.reduce((sum, person) => sum + person.pnlMinutes, 0))}</td>{dates.map((date) => <td key={date} className="px-3 py-3 text-right font-mono">{hours(people.reduce((sum, person) => sum + (person.daily[date]?.logwork ?? 0), 0)).toFixed(1)}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

function DeliveryMatrix({ project }: { project: PnlProject }) {
  const people = project.people.filter((person) => /delivery|engineering/i.test(person.role)).slice(0, 3);
  const rows = people.length > 0 ? people : project.people.slice(0, 3);
  const dates = rows[0] ? Object.keys(rows[0].daily).slice(0, 10) : [];
  return (
    <div className="overflow-x-auto rounded-xl border border-border/80">
      <table className="w-full min-w-[980px] text-left text-xs">
        <thead className="bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Nhân sự / vai trò</th><th className="px-3 py-3 text-right">Plan</th><th className="px-3 py-3 text-right">Logwork</th><th className="px-3 py-3 text-right">P&amp;L</th>{dates.map((date) => <th key={date} className="px-3 py-3 text-right">{date}</th>)}</tr></thead>
        <tbody className="divide-y divide-border/70">{rows.map((person) => <tr key={person.id}><td className="px-4 py-3"><span className="block font-semibold">{person.name}</span><span className="text-[10px] text-muted-foreground">{person.role}</span></td><td className="px-3 py-3 text-right font-mono">{formatHours(person.planMinutes)}</td><td className="px-3 py-3 text-right font-mono">{formatHours(person.logworkMinutes)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(person.pnlMinutes)}</td>{dates.map((date) => { const value = person.daily[date]; return <td key={date} className="px-3 py-2 text-right font-mono leading-5"><span className="text-slate-400">{hours(value?.plan ?? 0).toFixed(1)}</span><span className="mx-1 text-slate-300">·</span><span>{hours(value?.logwork ?? 0).toFixed(1)}</span><span className="mx-1 text-slate-300">·</span><span className="text-blue-700">{hours(value?.pnl ?? 0).toFixed(1)}</span></td>; })}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Results({ project }: { project: PnlProject }) {
  const totalExpenses = project.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const ebit = project.revenue - totalExpenses;
  const expensePercent = project.revenue > 0 ? (totalExpenses / project.revenue) * 100 : 0;
  const margin = project.revenue > 0 ? (ebit / project.revenue) * 100 : 0;
  return <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-emerald-600" /><h2 className="text-lg font-bold">Kết quả P&amp;L theo kỳ</h2></div><dl className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-muted/25 p-4"><dt className="text-xs text-muted-foreground">Revenue chưa VAT</dt><dd className="mt-2 text-xl font-bold tabular-nums">{formatVnd(project.revenue)}</dd></div><div className="rounded-xl bg-muted/25 p-4"><dt className="text-xs text-muted-foreground">Total Expenses</dt><dd className="mt-2 text-xl font-bold tabular-nums">{formatVnd(totalExpenses)}</dd></div><div className="rounded-xl bg-emerald-50 p-4"><dt className="text-xs text-emerald-700">EBIT</dt><dd className="mt-2 text-xl font-bold tabular-nums text-emerald-800">{formatVnd(ebit)}</dd></div><div className="rounded-xl bg-blue-50 p-4"><dt className="text-xs text-blue-700">Biên EBIT</dt><dd className="mt-2 text-xl font-bold tabular-nums text-blue-800">{margin.toFixed(1)}%</dd><p className="mt-1 text-[11px] text-blue-700">Expenses / Revenue: {expensePercent.toFixed(1)}%</p></div></dl></section>;
}

function Detail({ project, period }: { project: PnlProject; period: string }) {
  const totalPeople = project.people.length;
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <Link href={`/pnl?period=${encodeURIComponent(period)}`} className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại tổng quan</Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Project detail</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight">{project.name}</h1><p className="mt-2 text-sm text-muted-foreground">{project.code} · {project.client} · Kỳ báo cáo {periodLabel(period)}</p></div><span className={`inline-flex w-fit rounded-full border px-3 py-1.5 text-xs font-bold ${statusTone(project.status)}`}>{project.status} · còn giờ chờ</span></div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Plan Hour" value={formatHours(project.planMinutes)} icon={<CalendarDays className="h-4 w-4" />} /><KpiCard label="Logwork Hour" value={formatHours(project.logworkMinutes)} icon={<Clock3 className="h-4 w-4" />} /><KpiCard label="P&L Hour" value={formatHours(project.pnlMinutes)} icon={<Check className="h-4 w-4" />} tone="green" /><KpiCard label="Chờ xử lý" value={formatHours(project.pendingMinutes)} icon={<TriangleAlert className="h-4 w-4" />} tone="amber" note="Thiếu duyệt hoặc Cost Rate hiệu lực" /></section>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Daily reconciliation</p><h2 className="mt-1 text-lg font-bold">Tổng quan Logwork theo ngày</h2><p className="mt-1 text-xs text-muted-foreground">Tổng giờ của tất cả nhân sự trong từng ngày thuộc kỳ báo cáo.</p></div><span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground"><UsersRound className="h-4 w-4" /> {totalPeople} nhân sự</span></div><MiniDailyChart project={project} /></section>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Logwork Daily</p><h2 className="mt-1 text-lg font-bold">Ma trận theo người và ngày</h2><p className="mt-1 text-xs text-muted-foreground">Mỗi ô là số giờ thực tế đã ghi nhận; tổng cuối dòng dùng để đối soát với Logwork Hour.</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">Tổng {formatHours(project.logworkMinutes)}</span></div><div className="mt-5"><PersonMatrix people={project.people} /></div></section>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Delivery / DX · phân bổ theo nhân sự</h2><p className="mt-1 text-xs text-muted-foreground">Đối soát 3 lớp giờ cho từng thành viên: P = baseline ngày, L = giờ ghi nhận, P&amp;L = giờ hợp lệ.</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">{Math.min(3, project.people.length)} nhân sự</span></div><div className="mt-5"><DeliveryMatrix project={project} /></div></section>
      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5 shadow-sm"><div className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-amber-600" /><h2 className="text-lg font-bold">Danh sách chờ xử lý</h2></div><p className="mt-2 text-sm text-amber-900"><strong>{formatHours(project.pendingMinutes)}</strong> Logwork chưa được đưa vào P&amp;L Hour.</p><p className="mt-2 text-xs leading-5 text-amber-800">Cần kiểm tra trạng thái duyệt, mapping project và Cost Rate hiệu lực trước khi chốt kỳ.</p><div className="mt-4 flex flex-wrap gap-2"><button disabled title="Chưa có API drill-down trong phạm vi read-only của tab P&L" type="button" className="cursor-not-allowed rounded-lg border border-amber-200 bg-card px-3 py-2 text-xs font-semibold text-amber-800 opacity-70">Kiểm tra approval</button><button disabled title="Chưa có API drill-down trong phạm vi read-only của tab P&L" type="button" className="cursor-not-allowed rounded-lg border border-amber-200 bg-card px-3 py-2 text-xs font-semibold text-amber-800 opacity-70">Kiểm tra Cost Rate</button><button disabled title="Chưa có API audit reason trong phạm vi read-only của tab P&L" type="button" className="cursor-not-allowed rounded-lg border border-amber-200 bg-card px-3 py-2 text-xs font-semibold text-amber-800 opacity-70">Ghi audit reason</button></div></section><Results project={project} /></section>
      <ExpenseGroups expenses={project.expenses} />
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-950"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><p><strong>Quy tắc dữ liệu:</strong> Plan là baseline, Logwork là giờ thực tế, P&amp;L Hour chỉ gồm Logwork đã được duyệt và có Cost Rate hiệu lực. Nếu còn giờ chờ xử lý, kết quả EBIT được xem là tạm tính.</p></div></div>
    </div>
  );
}

async function fetchPnlData(period: string) {
  const { start, end } = periodBounds(period);
  const [summaryResponse, projectsResponse, entriesResponse] = await Promise.all([
    fetch("/api/project-controls/pl-summary", { cache: "no-store", credentials: "same-origin" }),
    fetch("/api/projects?limit=100&offset=0", { cache: "no-store", credentials: "same-origin" }),
    fetch(`/api/tasks/time-entries?limit=500&offset=0&startAt=${encodeURIComponent(start)}&endAt=${encodeURIComponent(end)}`, { cache: "no-store", credentials: "same-origin" })
  ]);
  if (!summaryResponse.ok || !projectsResponse.ok || !entriesResponse.ok) throw new Error("P&L API chưa sẵn sàng");
  const summary = await summaryResponse.json() as { data: ProjectPlSummaryItem[] };
  const projects = await projectsResponse.json() as ResourceListResponse<ProjectSummary>;
  const entries = await entriesResponse.json() as ResourceListResponse<TaskTimeEntrySummary>;
  const mapped = adaptLivePnlProjects(summary.data, projects.data, entries.data);
  return mapped;
}

export function PnlWorkbench({ projectId }: PnlWorkbenchProps) {
  const [period, setPeriod] = useState(currentPeriod);
  const [projects, setProjects] = useState<PnlProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchPnlData(period).then((nextProjects) => {
      if (cancelled) return;
      setProjects(nextProjects);
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setProjects([]);
        setLoadError(reason instanceof Error ? reason.message : "Không tải được dữ liệu P&L từ API.");
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, reloadToken]);

  const selectedProject = projectId ? projects.find((project) => project.id === decodeURIComponent(projectId)) ?? projects[0] : undefined;
  return (
    <AppShell activeRoute="/pnl" shellTestId="pnl-shell" desktopSidebarTestId="pnl-desktop-sidebar" mobileHeaderTestId="pnl-mobile-shell" title="P&L">
      <main data-testid="pnl-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-none bg-background p-4 sm:p-6">
        {loadError ? <section role="alert" className="mb-4 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"><span>{loadError} Dữ liệu demo đã được tắt để tránh hiển thị sai số.</span><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="rounded-lg border border-rose-300 bg-white px-3 py-2 font-semibold text-rose-700 hover:bg-rose-100">Thử lại</button></section> : null}
        {loading ? <section aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></section> : selectedProject ? <Detail project={selectedProject} period={period} /> : <Overview projects={projects} period={period} onPeriodChange={setPeriod} />}
      </main>
    </AppShell>
  );
}
