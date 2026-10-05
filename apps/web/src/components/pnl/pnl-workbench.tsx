"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Layers3,
  Search,
  ShieldCheck,
  TriangleAlert,
  UsersRound
} from "lucide-react";
import type { ProjectMilestoneSummary, ProjectPlSummaryItem, ProjectStageSummary, ProjectSummary, ProjectTaskSummary, ResourceListResponse, TaskTimeEntrySummary } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import {
  adaptLivePnlProjects,
  formatCompactVnd,
  formatHours,
  formatMoney,
  formatVnd,
  hours,
  type PnlExpense,
  type PnlPerson,
  type PnlProject,
  type PnlProjectStatus
} from "./pnl-data";
import { exportPnlWorkbook } from "./pnl-export";

type PnlWorkbenchProps = { projectId?: string };
type TaskLedgerProps = { tasks: ProjectTaskSummary[]; stages: ProjectStageSummary[]; milestones: ProjectMilestoneSummary[]; loading: boolean; error?: string | null };

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
    <CrmSelect ariaLabel={label} options={options} value={value} onChange={onChange} disabled={disabled} />
  );
}

function ExpenseGroups({ expenses, currency = "VND" }: { expenses: PnlExpense[]; currency?: string }) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-label="Expenses theo sáu nhóm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">PROJECT P&amp;L</p>
          <h2 className="mt-1 text-lg font-bold text-foreground">Expenses theo 6 nhóm</h2>
          <p className="mt-1 text-xs text-muted-foreground">Phân bổ chi phí theo nhóm để soi nhanh cơ cấu giá vốn.</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{formatMoney(total, currency)}</span>
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
              <p className="mt-2 text-sm font-bold tabular-nums text-foreground">{formatMoney(expense.amount, currency)}</p>
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
  const [exporting, setExporting] = useState(false);
  const exportWorkbook = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportPnlWorkbook({ projects, period });
    } finally {
      setExporting(false);
    }
  };
  return <button type="button" onClick={exportWorkbook} disabled={exporting} className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-primary/30 hover:bg-primary/5 disabled:cursor-wait disabled:opacity-60"><Download className="h-4 w-4" /> {exporting ? "Đang tạo Excel…" : "Xuất Excel"}</button>;
}

function Reconciliation({ project }: { project: PnlProject }) {
  const calculated = project.pnlMinutes + project.pendingMinutes + project.excludedMinutes;
  const matches = calculated === project.logworkMinutes;
  return <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-label="Đối soát giờ P&L">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Đối soát giờ</p><h2 className="mt-1 text-lg font-bold">Logwork = P&amp;L + chờ xử lý + bị loại</h2><p className="mt-1 text-xs text-muted-foreground">Mọi giờ ghi nhận phải rơi vào đúng một trong ba trạng thái trước khi chốt kỳ.</p></div><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${matches ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{matches ? "Đã khớp" : "Lệch dữ liệu"}</span></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-4"><div className="rounded-lg bg-muted/30 p-3"><p className="text-[11px] text-muted-foreground">Logwork</p><p className="mt-1 font-mono font-bold">{formatHours(project.logworkMinutes)}</p></div><div className="rounded-lg bg-blue-50 p-3"><p className="text-[11px] text-blue-700">P&amp;L hợp lệ</p><p className="mt-1 font-mono font-bold text-blue-800">{formatHours(project.pnlMinutes)}</p></div><div className="rounded-lg bg-amber-50 p-3"><p className="text-[11px] text-amber-700">Chờ xử lý</p><p className="mt-1 font-mono font-bold text-amber-800">{formatHours(project.pendingMinutes)}</p></div><div className="rounded-lg bg-slate-100 p-3"><p className="text-[11px] text-slate-600">Bị loại</p><p className="mt-1 font-mono font-bold text-slate-700">{formatHours(project.excludedMinutes)}</p></div></div>
  </section>;
}

function LaborCostTable({ project }: { project: PnlProject }) {
  const laborTotal = project.expenses.find((expense) => expense.key === "delivery-dx")?.amount ?? 0;
  const totalPnl = Math.max(project.pnlMinutes, 1);
  return <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Chi phí nhân sự</p><h2 className="mt-1 text-lg font-bold">Cost theo giờ P&amp;L</h2><p className="mt-1 text-xs text-muted-foreground">Phân bổ theo P&amp;L Hour; giờ thiếu Cost Rate được giữ là thiếu dữ liệu, không quy về 0.</p></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">{laborTotal ? formatMoney(laborTotal, project.currency) : "Chưa có cost"}</span></div>{project.people.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Chưa có time entry theo người trong kỳ để phân bổ chi phí.</div> : <div className="mt-4 overflow-x-auto rounded-lg border border-border/80"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Nhân sự / vai trò</th><th className="px-3 py-3 text-right">P&amp;L Hour</th><th className="px-3 py-3 text-right">Tỷ trọng</th><th className="px-3 py-3 text-right">Chi phí phân bổ</th><th className="px-4 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-border/70">{project.people.map((person) => { const share = person.pnlMinutes / totalPnl; const amount = laborTotal * share; return <tr key={person.id}><td className="px-4 py-3"><span className="block font-semibold">{person.name}</span><span className="text-[10px] text-muted-foreground">{person.role}</span></td><td className="px-3 py-3 text-right font-mono font-semibold">{formatHours(person.pnlMinutes)}</td><td className="px-3 py-3 text-right font-mono">{(share * 100).toFixed(1)}%</td><td className="px-3 py-3 text-right font-mono font-semibold">{laborTotal ? formatMoney(amount, project.currency) : "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${laborTotal ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{laborTotal ? "Chính thức" : "Thiếu Cost Rate"}</span></td></tr>; })}</tbody></table></div>}</section>;
}

function PnlItemTable({ project }: { project: PnlProject }) {
  const totalExpenses = project.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const labor = project.expenses.find((expense) => expense.key === "delivery-dx")?.amount ?? 0;
  const rows = [
    ["DOANHTHU.LIC", "Doanh thu ghi nhận kỳ", project.revenue],
    ["CP.LUONG", "Chi phí nhân sự", labor],
    ["CP.VANHANH", "Chi phí vận hành và quỹ chung", Math.max(totalExpenses - labor, 0)],
    ["CP", "Tổng chi phí", totalExpenses],
    ["EBIT", "EBIT", project.revenue - totalExpenses]
  ] as const;
  const provisional = project.pendingMinutes > 0;
  return <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Bảng khoản mục</p><h2 className="mt-1 text-lg font-bold">P&amp;L theo kỳ</h2><p className="mt-1 text-xs text-muted-foreground">Hiển thị output đã tính; công thức chỉ thay đổi tại màn Thiết lập P&amp;L.</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${provisional ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{provisional ? "Tạm tính" : "Chính thức"}</span></div><div className="mt-4 overflow-x-auto rounded-lg border border-border/80"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Mã khoản mục</th><th className="px-4 py-3">Tên</th><th className="px-4 py-3 text-right">Giá trị</th><th className="px-4 py-3">Nguồn</th></tr></thead><tbody className="divide-y divide-border/70">{rows.map(([code, label, value]) => <tr key={code} className={code === "EBIT" ? "bg-emerald-50/50 font-bold" : ""}><td className="px-4 py-3 font-mono text-xs text-primary">{code}</td><td className="px-4 py-3">{label}</td><td className="px-4 py-3 text-right font-mono font-semibold">{formatMoney(value, project.currency)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{code === "EBIT" || code === "CP" ? "Công thức / Tổng nhóm" : "Nguồn hệ thống"}</td></tr>)}</tbody></table></div></section>;
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
        <div className="mt-6 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(150px,180px)_minmax(150px,180px)_minmax(150px,180px)_auto]">
          <label className="relative block">
            <span className="sr-only">Tìm project</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm project, client..." className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </label>
          <FilterSelect label="Kỳ báo cáo" value={period} onChange={onPeriodChange} options={[{ value: period, label: periodLabel(period) }, { value: previousPeriod(period), label: periodLabel(previousPeriod(period)) }]} />
          <FilterSelect label="Trạng thái project" value={status} onChange={setStatus} options={STATUS_OPTIONS.map((value) => ({ value, label: value === "all" ? "Tất cả trạng thái" : value }))} />
          <FilterSelect label="Lọc theo project" value={projectFilter} onChange={setProjectFilter} options={[{ value: "all", label: "Tất cả project" }, ...projects.map((project) => ({ value: project.id, label: project.code }))]} />
          <DownloadButton projects={filteredProjects} period={period} />
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
  if (project.daily.length === 0) {
    return <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">Chưa có time entry trong kỳ để dựng biểu đồ ngày.</div>;
  }
  const recordedDays = project.daily.filter((point) => point.minutes > 0).length;
  const missingWorkingDays = project.daily.filter((point) => point.isWorkingDay && point.minutes === 0).length;
  const max = Math.max(...project.daily.map((point) => point.minutes), 1);
  const weekly = useMemo(() => {
    const buckets = new Map<string, { label: string; minutes: number; pnlMinutes: number; recordedDays: number }>();
    project.daily.forEach((point) => {
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(point.date) ? point.date : point.date.split("/").reverse().join("-");
      const date = new Date(`${normalizedDate}T12:00:00+07:00`);
      if (Number.isNaN(date.getTime())) return;
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      const current = buckets.get(key) ?? { label: `${String(monday.getDate()).padStart(2, "0")}/${String(monday.getMonth() + 1).padStart(2, "0")}`, minutes: 0, pnlMinutes: 0, recordedDays: 0 };
      current.minutes += point.minutes;
      current.pnlMinutes += point.pnlMinutes ?? point.minutes;
      if (point.minutes > 0) current.recordedDays += 1;
      buckets.set(key, current);
    });
    return Array.from(buckets.values());
  }, [project.daily]);
  const weeklyMax = Math.max(...weekly.map((point) => point.minutes), 1);
  return (
    <div className="mt-5 rounded-xl border border-border/80 bg-muted/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground"><span><strong className="text-foreground">{project.daily.length}</strong> ngày trong kỳ · <strong className="text-foreground">{recordedDays}</strong> ngày có ghi nhận · <strong className="text-foreground">{missingWorkingDays}</strong> ngày làm việc chưa ghi nhận</span><span className="font-mono font-semibold text-foreground">Tổng Logwork {formatHours(project.logworkMinutes)}</span></div>
      <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground" aria-label="Chú thích biểu đồ"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> Logwork</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> P&amp;L hợp lệ</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" /> Ngày chưa ghi nhận</span></div>
      <div className="mt-3 overflow-x-auto pb-1" role="img" aria-label={`Logwork theo ${project.daily.length} ngày trong kỳ báo cáo`}>
        <div className="flex h-40 min-w-[720px] items-end gap-1 border-b border-border/80 pb-5">
          {project.daily.map((point) => {
            const logworkHeight = point.minutes > 0 ? Math.max(4, (point.minutes / max) * 100) : 0;
            const pnlHeight = point.pnlMinutes && point.pnlMinutes > 0 ? Math.max(4, (point.pnlMinutes / max) * 100) : 0;
            return <div key={point.date} className={`group relative flex h-full min-w-[18px] flex-1 flex-col items-center justify-end gap-1 ${point.isWorkingDay === false ? "opacity-60" : ""}`} title={`${point.label}: Logwork ${hours(point.minutes)}h · P&L ${hours(point.pnlMinutes ?? point.minutes)}h`}><div className="pointer-events-none absolute bottom-6 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-sm transition group-hover:opacity-100">Logwork {hours(point.minutes)}h · P&amp;L {hours(point.pnlMinutes ?? point.minutes)}h</div><div className="flex h-full w-full items-end justify-center gap-px rounded-t-md bg-slate-100/70"><div className="w-[45%] rounded-t-sm bg-blue-500 transition group-hover:bg-blue-600" style={{ height: `${logworkHeight}%` }} /><div className="w-[45%] rounded-t-sm bg-emerald-500 transition group-hover:bg-emerald-600" style={{ height: `${pnlHeight}%` }} /></div><span className="text-[9px] text-muted-foreground">{point.label}</span></div>;
          })}
        </div>
      </div>
      <div className="mt-4 border-t border-border/70 pt-4"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-foreground">Tổng hợp theo tuần</span><span className="text-muted-foreground">{weekly.length} tuần trong kỳ</span></div><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{weekly.map((point) => <div key={point.label} className="min-w-[124px] flex-1 rounded-lg border border-border/70 bg-card px-3 py-2"><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Tuần từ {point.label}</span><span>{point.recordedDays} ngày</span></div><div className="mt-2 space-y-1.5 text-[10px]"><div className="flex items-center gap-2"><span className="w-12 text-muted-foreground">Logwork</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-500" style={{ width: `${(point.minutes / weeklyMax) * 100}%` }} /></div><strong>{hours(point.minutes)}h</strong></div><div className="flex items-center gap-2"><span className="w-12 text-muted-foreground">P&amp;L</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(point.pnlMinutes / weeklyMax) * 100}%` }} /></div><strong>{hours(point.pnlMinutes)}h</strong></div></div></div>)}</div></div>
    </div>
  );
}

function PersonMatrix({ people }: { people: PnlPerson[] }) {
  if (people.length === 0) {
    return <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center text-sm text-muted-foreground">Chưa có time entry theo người trong kỳ báo cáo.</div>;
  }
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
  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center text-sm text-muted-foreground">Chưa có dữ liệu Delivery / DX trong kỳ báo cáo.</div>;
  }
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

function taskStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["done", "completed", "complete"].includes(normalized)) return "Đã hoàn thành";
  if (["in_progress", "in-progress", "doing"].includes(normalized)) return "Đang thực hiện";
  if (["blocked", "on_hold"].includes(normalized)) return "Bị chặn";
  if (["cancelled", "canceled"].includes(normalized)) return "Đã hủy";
  return "Chưa bắt đầu";
}

function taskStatusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["done", "completed", "complete"].includes(normalized)) return "bg-emerald-50 text-emerald-700";
  if (["in_progress", "in-progress", "doing"].includes(normalized)) return "bg-blue-50 text-blue-700";
  if (["blocked", "on_hold"].includes(normalized)) return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

function shortDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}

function dateRange(start?: string, end?: string) {
  const from = shortDate(start);
  const to = shortDate(end);
  if (!from && !to) return "—";
  if (!to || from === to) return from || to;
  return `${from || "—"} → ${to}`;
}

function scopeVariance(estimateMinutes: number, loggedMinutes: number) {
  if (estimateMinutes <= 0) return "—";
  const percent = ((loggedMinutes - estimateMinutes) / estimateMinutes) * 100;
  return `${percent > 0 ? "+" : ""}${Math.round(percent)}%`;
}

function projectStatusLabel(status?: string) {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "completed" || normalized === "done") return "Đã hoàn thành";
  if (["in_progress", "in-progress", "active"].includes(normalized ?? "")) return "Đang thực hiện";
  if (["on_hold", "on-hold", "paused"].includes(normalized ?? "")) return "Tạm dừng";
  if (["cancelled", "canceled"].includes(normalized ?? "")) return "Đã hủy";
  if (["planned", "not_started"].includes(normalized ?? "")) return "Chưa bắt đầu";
  return status || "Chưa có";
}

function TaskLedger({ tasks, stages, milestones, loading, error }: TaskLedgerProps) {
  const stageById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    type ScopeStage = { key: string; name: string; stage?: ProjectStageSummary; tasks: ProjectTaskSummary[] };
    type ScopeMilestone = { key: string; name: string; sortOrder: number; stages: ScopeStage[] };
    const milestoneMap = new Map<string, ScopeMilestone>();
    const ensureMilestone = (key: string, name: string, sortOrder: number) => {
      const existing = milestoneMap.get(key);
      if (existing) return existing;
      const created = { key, name, sortOrder, stages: [] } satisfies ScopeMilestone;
      milestoneMap.set(key, created);
      return created;
    };
    const ensureStage = (milestone: ScopeMilestone, key: string, name: string, stage?: ProjectStageSummary) => {
      const existing = milestone.stages.find((row) => row.key === key);
      if (existing) return existing;
      const created = { key, name, stage, tasks: [] } satisfies ScopeStage;
      milestone.stages.push(created);
      return created;
    };

    // Milestones are the canonical source for names and ordering. Stages are
    // linked through milestoneId; tasks are linked through stageId.
    milestones.forEach((milestone) => ensureMilestone(milestone.id, milestone.name, milestone.sortOrder));
    stages.forEach((stage) => {
      const milestone = ensureMilestone(stage.milestoneId, stage.milestoneName, stage.milestoneSortOrder);
      ensureStage(milestone, stage.id, stage.activity, stage);
    });
    tasks.forEach((task) => {
      const stage = task.stageId ? stageById.get(task.stageId) : undefined;
      const milestoneKey = stage?.milestoneId ?? "unassigned-milestone";
      const milestone = ensureMilestone(milestoneKey, stage?.milestoneName ?? "Chưa gán milestone", stage?.milestoneSortOrder ?? Number.MAX_SAFE_INTEGER);
      const stageKey = stage?.id ?? task.stageId ?? "unassigned-stage";
      ensureStage(milestone, stageKey, stage?.activity ?? task.stageActivity ?? "Chưa gán stage", stage).tasks.push(task);
    });
    return [...milestoneMap.values()]
      .map((milestone) => ({
        ...milestone,
        stages: milestone.stages
          .map((stage) => ({ ...stage, tasks: [...stage.tasks].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "vi")) }))
          .sort((left, right) => (left.stage?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.stage?.sortOrder ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name, "vi"))
      }))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "vi"));
  }, [stageById, tasks]);
  const totalEstimate = tasks.reduce((sum, task) => sum + task.estimateMinutes, 0);
  const totalLogged = tasks.reduce((sum, task) => sum + task.loggedMinutes, 0);

  const toggle = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const stageTotals = (stageTasks: ProjectTaskSummary[]) => ({
    estimate: stageTasks.reduce((sum, task) => sum + task.estimateMinutes, 0),
    logged: stageTasks.reduce((sum, task) => sum + task.loggedMinutes, 0)
  });

  const groupStatus = (groupTasks: ProjectTaskSummary[]) => {
    if (groupTasks.length > 0 && groupTasks.every((task) => ["done", "completed", "complete"].includes(task.status.trim().toLowerCase()))) return "Đã hoàn thành";
    if (groupTasks.some((task) => ["in_progress", "in-progress", "doing"].includes(task.status.trim().toLowerCase()))) return "Đang thực hiện";
    return "Chưa bắt đầu";
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Danh sách task trong project">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Delivery scope</p>
          <h2 className="mt-1 text-lg font-bold">Công việc &amp; tiến độ</h2>
          <p className="mt-1 text-xs text-muted-foreground">Theo đúng cấp Milestone → Stage → Task, giống bảng Delivery scope trong Timesheet.</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">{tasks.length} task</span>
      </div>
      {loading ? <div className="space-y-2 p-5" aria-busy="true"><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-10 animate-pulse rounded-lg bg-muted" /></div> : null}
      {error ? <div role="alert" className="m-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div> : null}
      {!loading && !error && groups.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Project chưa có task để hiển thị.</div> : null}
      {!loading && !error && groups.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Milestone / Stage / Task</th><th className="px-3 py-3">Phụ trách</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3">Thời gian</th><th className="px-3 py-3 text-right">Kế hoạch</th><th className="px-3 py-3 text-right">Thực tế</th><th className="px-3 py-3 text-right">Chênh lệch</th><th className="px-5 py-3 text-right">Chi tiết</th></tr></thead><tbody className="divide-y divide-border/70">
        {groups.map((milestone) => {
          const milestoneTasks = milestone.stages.flatMap((stage) => stage.tasks);
          const milestoneTotals = stageTotals(milestoneTasks);
          const milestoneCollapsed = collapsed.has(`milestone:${milestone.key}`);
          return <Fragment key={`milestone-group:${milestone.key}`}>
            <tr key={`milestone:${milestone.key}`} className="border-t border-border bg-primary/[0.035]"><td className="px-5 py-3 font-bold text-foreground"><button type="button" onClick={() => toggle(`milestone:${milestone.key}`)} className="mr-2 inline-flex items-center rounded p-0.5 hover:bg-primary/10" aria-label={`${milestoneCollapsed ? "Mở" : "Thu gọn"} milestone ${milestone.name}`}>{milestoneCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-primary align-middle" />{milestone.name}</td><td className="px-3 py-3 text-xs text-muted-foreground">—</td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${taskStatusTone(groupStatus(milestoneTasks))}`}>{groupStatus(milestoneTasks)}</span></td><td className="px-3 py-3 text-xs text-muted-foreground">{milestoneTasks.length} task</td><td className="px-3 py-3 text-right font-mono tabular-nums">{formatHours(milestoneTotals.estimate)}</td><td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{formatHours(milestoneTotals.logged)}</td><td className={`px-3 py-3 text-right font-mono tabular-nums ${milestoneTotals.logged > milestoneTotals.estimate ? "text-rose-700" : "text-muted-foreground"}`}>{scopeVariance(milestoneTotals.estimate, milestoneTotals.logged)}</td><td className="px-5 py-3 text-right text-xs text-muted-foreground">{milestoneCollapsed ? "Mở" : ""}</td></tr>
            {!milestoneCollapsed ? milestone.stages.map((stageGroup) => {
              const stageTotalsValue = stageTotals(stageGroup.tasks);
              const stageCollapsed = collapsed.has(`stage:${milestone.key}:${stageGroup.key}`);
              const stageStatus = stageGroup.stage?.status ?? groupStatus(stageGroup.tasks);
              return <Fragment key={`stage-group:${milestone.key}:${stageGroup.key}`}>
                <tr key={`stage:${milestone.key}:${stageGroup.key}`} className="bg-muted/20"><td className="px-5 py-3 pl-10 font-semibold text-foreground"><button type="button" onClick={() => toggle(`stage:${milestone.key}:${stageGroup.key}`)} className="mr-2 inline-flex items-center rounded p-0.5 hover:bg-primary/10" aria-label={`${stageCollapsed ? "Mở" : "Thu gọn"} stage ${stageGroup.name}`}>{stageCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>{stageGroup.name}</td><td className="px-3 py-3 text-xs font-semibold text-primary">{stageGroup.stage?.ownerDisplayName ?? "Chưa gán"}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${taskStatusTone(stageStatus)}`}>{taskStatusLabel(stageStatus)}</span></td><td className="px-3 py-3 text-xs text-muted-foreground">{dateRange(stageGroup.stage?.plannedStartAt, stageGroup.stage?.plannedEndAt)}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{formatHours(stageTotalsValue.estimate)}</td><td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{formatHours(stageTotalsValue.logged)}</td><td className={`px-3 py-3 text-right font-mono tabular-nums ${stageTotalsValue.logged > stageTotalsValue.estimate ? "text-rose-700" : "text-muted-foreground"}`}>{scopeVariance(stageTotalsValue.estimate, stageTotalsValue.logged)}</td><td className="px-5 py-3 text-right text-xs text-muted-foreground">{stageCollapsed ? "Mở" : ""}</td></tr>
                {!stageCollapsed ? stageGroup.tasks.map((task) => { const variance = task.loggedMinutes - task.estimateMinutes; return <tr key={task.id} className="transition-colors hover:bg-muted/15"><td className="max-w-[420px] px-5 py-3 pl-20"><span className="flex items-center gap-2"><span className="truncate font-medium text-foreground" title={task.title}>{task.title}</span><Link href={`/tasks/${encodeURIComponent(task.id)}`} aria-label={`Mở task ${task.title}`} title="Mở task" className="inline-flex shrink-0 text-muted-foreground transition hover:text-primary"><ArrowUpRight className="h-3.5 w-3.5" /></Link></span></td><td className="px-3 py-3 text-xs font-semibold text-primary">{task.assigneeDisplayName ?? task.ownerDisplayName ?? "Chưa gán"}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${taskStatusTone(task.status)}`}>{taskStatusLabel(task.status)}</span></td><td className="px-3 py-3 text-xs text-muted-foreground">{dateRange(task.plannedStartAt, task.dueAt)}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{formatHours(task.estimateMinutes)}</td><td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{formatHours(task.loggedMinutes)}</td><td className={`px-3 py-3 text-right font-mono tabular-nums ${variance > 0 ? "text-rose-700" : "text-muted-foreground"}`}>{scopeVariance(task.estimateMinutes, task.loggedMinutes)}</td><td className="px-5 py-3 text-right"><Link href={`/tasks/${encodeURIComponent(task.id)}`} aria-label={`Xem chi tiết task ${task.title}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:text-primary">Xem</Link></td></tr>; }) : null}
              </Fragment>;
            }) : null}
          </Fragment>;
        })}
        <tr className="bg-muted/30 font-bold"><td colSpan={4} className="px-5 py-3">Tổng cộng ({tasks.length} task)</td><td className="px-3 py-3 text-right font-mono">{formatHours(totalEstimate)}</td><td className="px-3 py-3 text-right font-mono">{formatHours(totalLogged)}</td><td className="px-3 py-3 text-right font-mono">{scopeVariance(totalEstimate, totalLogged)}</td><td className="px-5 py-3" /></tr>
      </tbody></table></div> : null}
    </section>
  );
}

function ProjectContext({ project }: { project: PnlProject }) {
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value)) : "Chưa có";
  const progress = Math.max(0, Math.min(100, project.progressPercent ?? 0));
  return <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" aria-label="Thông tin project"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Project context</p><h2 className="mt-1 text-lg font-bold">Phạm vi &amp; thông tin vận hành</h2></div><span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">Nguồn: {project.dataSource === "period" ? "time entry trong kỳ" : "tổng hợp project"}</span></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs text-muted-foreground">Phụ trách</p><p className="mt-1 font-semibold">{project.ownerDisplayName ?? "Chưa gán"}</p></div><div><p className="text-xs text-muted-foreground">Trạng thái project</p><p className="mt-1 font-semibold">{projectStatusLabel(project.projectStatus)}</p></div><div><p className="text-xs text-muted-foreground">Thời gian kế hoạch</p><p className="mt-1 font-semibold">{formatDate(project.plannedStartAt)} → {formatDate(project.plannedEndAt)}</p></div><div><p className="text-xs text-muted-foreground">Task hoàn thành</p><p className="mt-1 font-semibold">{project.completedTaskCount ?? 0}/{project.taskCount ?? 0}</p></div></div><div className="mt-5"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-foreground">Tiến độ project</span><span className="font-mono font-semibold text-muted-foreground">{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div></div></section>;
}

function Results({ project }: { project: PnlProject }) {
  const totalExpenses = project.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const revenue = project.revenue;
  const ebit = project.grossMargin || revenue - totalExpenses;
  const expensePercent = revenue > 0 ? (totalExpenses / revenue) * 100 : 0;
  const margin = revenue > 0 ? (ebit / revenue) * 100 : 0;
  return <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-emerald-600" /><h2 className="text-lg font-bold">Kết quả P&amp;L theo kỳ</h2></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">Đơn vị: {project.currency}</span></div><dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><div className="rounded-xl bg-muted/25 p-4"><dt className="text-xs text-muted-foreground">Doanh thu kế hoạch</dt><dd className="mt-2 text-xl font-bold tabular-nums">{formatMoney(project.plannedRevenue, project.currency)}</dd></div><div className="rounded-xl bg-muted/25 p-4"><dt className="text-xs text-muted-foreground">Đã thu / ghi nhận</dt><dd className="mt-2 text-xl font-bold tabular-nums">{formatMoney(project.paidRevenue, project.currency)}</dd></div><div className="rounded-xl bg-muted/25 p-4"><dt className="text-xs text-muted-foreground">Tổng chi phí</dt><dd className="mt-2 text-xl font-bold tabular-nums">{formatMoney(totalExpenses, project.currency)}</dd><p className="mt-1 text-[11px] text-muted-foreground">{expensePercent.toFixed(1)}% doanh thu</p></div><div className="rounded-xl bg-emerald-50 p-4"><dt className="text-xs text-emerald-700">Gross margin / EBIT</dt><dd className="mt-2 text-xl font-bold tabular-nums text-emerald-800">{formatMoney(ebit, project.currency)}</dd></div><div className="rounded-xl bg-blue-50 p-4"><dt className="text-xs text-blue-700">Biên lợi nhuận</dt><dd className="mt-2 text-xl font-bold tabular-nums text-blue-800">{margin.toFixed(1)}%</dd><p className="mt-1 text-[11px] text-blue-700">Giá trị do hệ thống tính từ doanh thu − chi phí</p></div><div className="rounded-xl bg-amber-50 p-4"><dt className="text-xs text-amber-700">Chi phí kế hoạch</dt><dd className="mt-2 text-xl font-bold tabular-nums text-amber-800">{formatMoney(project.plannedCost, project.currency)}</dd></div></dl></section>;
}

function Detail({ project, period, onPeriodChange, tasks, stages, milestones, tasksLoading, tasksError }: { project: PnlProject; period: string; onPeriodChange: (period: string) => void; tasks: ProjectTaskSummary[]; stages: ProjectStageSummary[]; milestones: ProjectMilestoneSummary[]; tasksLoading: boolean; tasksError?: string | null }) {
  const totalPeople = project.people.length;
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <Link href={`/pnl?period=${encodeURIComponent(period)}`} className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại tổng quan</Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Project detail · P&amp;L</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight">{project.name}</h1><p className="mt-2 text-sm text-muted-foreground">{project.code} · {project.client} · Kỳ báo cáo {periodLabel(period)}</p></div><div className="flex flex-wrap items-center gap-2"><FilterSelect label="Kỳ báo cáo" value={period} onChange={onPeriodChange} options={[{ value: period, label: periodLabel(period) }, { value: previousPeriod(period), label: periodLabel(previousPeriod(period)) }]} /><span className={`inline-flex w-fit rounded-full border px-3 py-1.5 text-xs font-bold ${statusTone(project.status)}`}>{project.status}{project.pendingMinutes > 0 ? " · còn giờ chờ" : ""}</span></div></div>
      </section>
      {project.dataSource === "project" ? <div role="status" className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs text-blue-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>Kỳ này chưa có time entry riêng. Các chỉ số giờ đang lấy từ tổng hợp project để không hiển thị số 0 gây hiểu nhầm; khi có log trong kỳ, hệ thống sẽ tự chuyển sang dữ liệu theo kỳ.</span></div> : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Plan Hour" value={formatHours(project.planMinutes)} icon={<CalendarDays className="h-4 w-4" />} /><KpiCard label="Logwork Hour" value={formatHours(project.logworkMinutes)} icon={<Clock3 className="h-4 w-4" />} /><KpiCard label="P&L Hour" value={formatHours(project.pnlMinutes)} icon={<Check className="h-4 w-4" />} tone="green" /><KpiCard label="Chờ xử lý" value={formatHours(project.pendingMinutes)} icon={<TriangleAlert className="h-4 w-4" />} tone="amber" note="Thiếu duyệt hoặc Cost Rate hiệu lực" /></section>
      <ProjectContext project={project} />
      <Reconciliation project={project} />
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Daily reconciliation</p><h2 className="mt-1 text-lg font-bold">Tổng quan Logwork theo ngày</h2><p className="mt-1 text-xs text-muted-foreground">Tổng giờ của tất cả nhân sự trong từng ngày thuộc kỳ báo cáo.</p></div><span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground"><UsersRound className="h-4 w-4" /> {totalPeople} nhân sự</span></div><MiniDailyChart project={project} /></section>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Logwork Daily</p><h2 className="mt-1 text-lg font-bold">Ma trận theo người và ngày</h2><p className="mt-1 text-xs text-muted-foreground">Mỗi ô là số giờ thực tế đã ghi nhận. Bảng chỉ mở các ngày có log; biểu đồ phía trên vẫn hiển thị đủ toàn bộ ngày trong kỳ.</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">Tổng {formatHours(project.logworkMinutes)}</span></div><div className="mt-5"><PersonMatrix people={project.people} /></div></section>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Delivery / DX · phân bổ theo nhân sự</h2><p className="mt-1 text-xs text-muted-foreground">Đối soát 3 lớp giờ cho từng thành viên: P = baseline ngày, L = giờ ghi nhận, P&amp;L = giờ hợp lệ. Cột ngày chỉ hiện ngày có phát sinh.</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">{Math.min(3, project.people.length)} nhân sự</span></div><div className="mt-5"><DeliveryMatrix project={project} /></div></section>
      <LaborCostTable project={project} />
      <PnlItemTable project={project} />
      <TaskLedger tasks={tasks} stages={stages} milestones={milestones} loading={tasksLoading} error={tasksError} />
      <Results project={project} />
      <ExpenseGroups expenses={project.expenses} currency={project.currency} />
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-950"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><p><strong>Quy tắc dữ liệu:</strong> Plan là baseline, Logwork là giờ thực tế, P&amp;L Hour chỉ gồm Logwork đã được duyệt và có Cost Rate hiệu lực. Nếu còn giờ chờ xử lý, kết quả EBIT được xem là tạm tính.</p></div></div>
    </div>
  );
}

async function fetchPnlData(period: string) {
  const { start, end } = periodBounds(period);
  const [summaryResponse, projectsResponse, entriesResponse] = await Promise.all([
    fetch("/api/project-controls/pl-summary", { cache: "no-store", credentials: "same-origin" }),
    fetchPagedResource<ProjectSummary>(`/api/projects?limit=100&offset=0`),
    fetchPagedResource<TaskTimeEntrySummary>(`/api/tasks/time-entries?limit=100&offset=0&startAt=${encodeURIComponent(start)}&endAt=${encodeURIComponent(end)}`)
  ]);
  if (!summaryResponse.ok) throw new Error("P&L API chưa sẵn sàng");
  const summary = await summaryResponse.json() as { data: ProjectPlSummaryItem[] };
  const mapped = adaptLivePnlProjects(summary.data, projectsResponse, entriesResponse, period);
  return mapped;
}

type PagedResourcePayload<T> = { data?: T[]; meta?: { pagination?: { hasNextPage?: boolean; offset?: number; limit?: number; returned?: number; total?: number } } };

async function fetchPagedResource<T>(path: string): Promise<T[]> {
  const base = new URL(path, window.location.origin);
  const rows: T[] = [];
  let offset = Number(base.searchParams.get("offset") ?? 0);
  const limit = Math.max(1, Math.min(100, Number(base.searchParams.get("limit") ?? 100) || 100));
  base.searchParams.set("limit", String(limit));
  base.searchParams.set("offset", String(offset));

  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(base.toString(), { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`P&L API chưa sẵn sàng (${response.status})`);
    const payload = await response.json() as PagedResourcePayload<T>;
    const pageRows = payload.data ?? [];
    rows.push(...pageRows);
    const pagination = payload.meta?.pagination;
    if (!pagination?.hasNextPage || pageRows.length === 0) break;
    const nextOffset = (pagination.offset ?? offset) + (pagination.returned ?? pageRows.length);
    if (nextOffset <= offset) break;
    offset = nextOffset;
    base.searchParams.set("offset", String(offset));
  }
  return rows;
}

async function fetchProjectWorkItems(projectId: string) {
  const [tasksResponse, stagesResponse, milestonesResponse] = await Promise.all([
    fetchPagedResource<ProjectTaskSummary>(`/api/tasks?projectId=${encodeURIComponent(projectId)}&limit=100&offset=0`),
    fetch(`/api/projects/${encodeURIComponent(projectId)}/stages`, { cache: "no-store", credentials: "same-origin" }),
    fetch(`/api/projects/${encodeURIComponent(projectId)}/milestones`, { cache: "no-store", credentials: "same-origin" })
  ]);
  if (!stagesResponse.ok || !milestonesResponse.ok) throw new Error("Không tải được cấu trúc công việc của project.");
  const stages = await stagesResponse.json() as ResourceListResponse<ProjectStageSummary>;
  const milestonesPayload = await milestonesResponse.json() as { data?: ProjectMilestoneSummary[]; milestones?: ProjectMilestoneSummary[] };
  return { tasks: tasksResponse, stages: stages.data, milestones: milestonesPayload.data ?? milestonesPayload.milestones ?? [] };
}

export function PnlWorkbench({ projectId }: PnlWorkbenchProps) {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState(currentPeriod);
  const [projects, setProjects] = useState<PnlProject[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTaskSummary[]>([]);
  const [projectStages, setProjectStages] = useState<ProjectStageSummary[]>([]);
  const [projectMilestones, setProjectMilestones] = useState<ProjectMilestoneSummary[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const requestedPeriod = searchParams.get("period");
    if (requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod)) setPeriod(requestedPeriod);
  }, [searchParams]);

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

  useEffect(() => {
    if (!projectId) {
      setProjectTasks([]);
      setProjectStages([]);
      setProjectMilestones([]);
      setTasksError(null);
      return;
    }
    const requestedProjectId = decodeURIComponent(projectId);
    let cancelled = false;
    setTasksLoading(true);
    setTasksError(null);
    fetchProjectWorkItems(requestedProjectId).then(({ tasks, stages, milestones }) => {
      if (!cancelled) {
        setProjectTasks(tasks);
        setProjectStages(stages);
        setProjectMilestones(milestones);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setProjectTasks([]);
        setProjectStages([]);
        setProjectMilestones([]);
        setTasksError(reason instanceof Error ? reason.message : "Không tải được danh sách task của project.");
      }
    }).finally(() => { if (!cancelled) setTasksLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, reloadToken]);

  const requestedProjectId = projectId ? decodeURIComponent(projectId) : undefined;
  const selectedProject = requestedProjectId ? projects.find((project) => project.id === requestedProjectId) : undefined;
  return (
    <AppShell activeRoute="/pnl" shellTestId="pnl-shell" desktopSidebarTestId="pnl-desktop-sidebar" mobileHeaderTestId="pnl-mobile-shell" title="P&L">
      <main data-testid="pnl-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-none bg-background p-4 sm:p-6">
        {loadError ? <section role="alert" className="mb-4 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"><span>{loadError} Dữ liệu demo đã được tắt để tránh hiển thị sai số.</span><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="rounded-lg border border-rose-300 bg-white px-3 py-2 font-semibold text-rose-700 hover:bg-rose-100">Thử lại</button></section> : null}
        {loading ? <section aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></section> : requestedProjectId && !selectedProject ? <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900"><h1 className="text-lg font-bold">Không tìm thấy project</h1><p className="mt-2">Project này không nằm trong phạm vi dữ liệu hoặc đã bị xoá.</p><Link href={`/pnl?period=${encodeURIComponent(period)}`} className="mt-4 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold text-amber-800 hover:bg-amber-100">Quay lại tổng quan</Link></section> : selectedProject ? <Detail project={selectedProject} period={period} onPeriodChange={setPeriod} tasks={projectTasks} stages={projectStages} milestones={projectMilestones} tasksLoading={tasksLoading} tasksError={tasksError} /> : <Overview projects={projects} period={period} onPeriodChange={setPeriod} />}
      </main>
    </AppShell>
  );
}
