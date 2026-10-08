"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleDollarSign, Clock3, Download, Filter, Layers3, Pencil, Save, Search, ShieldCheck, X } from "lucide-react";
import type { ProjectMilestoneSummary, ProjectPlSummaryItem, ProjectStageSummary, ProjectSummary, ProjectTaskSummary, ResourceListResponse, TaskTimeEntrySummary } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { adaptLivePnlProjects, formatHours, formatMoney, type PnlDailyPoint, type PnlProject, type PnlProjectStatus } from "./pnl-data";
import { exportPnlWorkbook } from "./pnl-export";

type Props = { projectId?: string };
type Range = { startDate: string; endDate: string };
type Tab = "overview" | "logwork" | "delivery" | "finance";
const STATUS: Array<"all" | PnlProjectStatus> = ["all", "Chờ xử lý", "Đã đối soát", "Thiếu dữ liệu"];

function monthRange(period: string): Range {
  const parts = period.split("-").map(Number);
  const last = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  return { startDate: period + "-01", endDate: period + "-" + String(last).padStart(2, "0") };
}

function currentPeriod() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
}

function periodLabel(period: string) {
  const parts = period.split("-");
  return "Tháng " + parts[1] + "/" + parts[0];
}

function rangeLabel(start: string, end: string) {
  if (!start || !end) return "Tất cả thời gian";
  return start.split("-").reverse().join("/") + " → " + end.split("-").reverse().join("/");
}

function statusClass(status: PnlProjectStatus) {
  if (status === "Đã đối soát") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Thiếu dữ liệu") return "border-slate-200 bg-muted/40 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const classes = tone === "good" ? "bg-emerald-50 text-emerald-700" : tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-muted/40 text-slate-600";
  return <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold " + classes}>{children}</span>;
}

function Metric({ label, value, note, tone = "plain" }: { label: string; value: string; note?: string; tone?: "plain" | "blue" | "green" | "amber" }) {
  const color = tone === "blue" ? "text-blue-700" : tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-800" : "text-foreground";
  return <div className="min-w-0 rounded-xl border border-border/80 bg-muted/20 px-3 py-3"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className={"mt-1 truncate text-lg font-bold tracking-tight " + color}>{value}</p>{note ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{note}</p> : null}</div>;
}

function Filters({ period, startDate, endDate, projects, onPeriodChange, onRangeChange }: { period: string; startDate: string; endDate: string; projects: PnlProject[]; onPeriodChange: (value: string) => void; onRangeChange: (range: Range) => void }) {
  const periods = new Set(projects.flatMap((project) => project.daily.map((point) => point.date.slice(0, 7))));
  periods.add(currentPeriod());
  if (period) periods.add(period);
  const options = [...periods].sort((a, b) => b.localeCompare(a)).map((value) => ({ value, label: periodLabel(value) }));
  return <div className="flex flex-wrap items-end gap-2"><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Kỳ nhanh</span><CrmSelect ariaLabel="Kỳ nhanh" value={period || "all"} onChange={onPeriodChange} options={[{ value: "all", label: "Tất cả thời gian" }, ...options]} /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Từ ngày</span><input aria-label="Từ ngày" type="date" value={startDate} onChange={(event) => onRangeChange({ startDate: event.target.value, endDate })} className="h-10 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Đến ngày</span><input aria-label="Đến ngày" type="date" min={startDate || undefined} value={endDate} onChange={(event) => onRangeChange({ startDate, endDate: event.target.value })} className="h-10 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" /></label></div>;
}

function actionFor(project: PnlProject) {
  if (!project.costAvailable) return "Bổ sung cost rate / NC2";
  if (project.pendingMinutes > 0) return "Duyệt hoặc phân loại giờ";
  if (project.logworkMinutes > project.planMinutes) return "Rà soát vượt kế hoạch";
  if (project.status === "Thiếu dữ liệu") return "Bổ sung baseline";
  return "Không cần xử lý";
}

function OverviewMetrics({ projects, filtered }: { projects: PnlProject[]; filtered: PnlProject[] }) {
  const totals = filtered.reduce((acc, project) => ({ plan: acc.plan + project.planMinutes, logwork: acc.logwork + project.logworkMinutes, pnl: acc.pnl + project.pnlMinutes, pending: acc.pending + project.pendingMinutes, revenue: acc.revenue + project.revenue, cost: acc.cost + (project.costAvailable ? Math.max(project.revenue - project.grossMargin, 0) : 0), costCount: acc.costCount + (project.costAvailable ? 1 : 0), exceptions: acc.exceptions + (actionFor(project) === "Không cần xử lý" ? 0 : 1) }), { plan: 0, logwork: 0, pnl: 0, pending: 0, revenue: 0, cost: 0, costCount: 0, exceptions: 0 });
  const currency = filtered[0]?.currency || "VND";
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tóm tắt P&L"><Metric label="Doanh thu" value={totals.revenue ? formatMoney(totals.revenue, currency) : "Chưa có dữ liệu"} tone="green" note={filtered.length + "/" + projects.length + " project đang xem"} /><Metric label="P&L hour" value={formatHours(totals.pnl)} tone="blue" note={formatHours(totals.pending) + " chờ xử lý"} /><Metric label="Lệch kế hoạch" value={formatHours(totals.logwork - totals.plan)} tone={totals.logwork > totals.plan ? "amber" : "plain"} note="Logwork − Plan" /><Metric label="Cần xử lý" value={String(totals.exceptions)} tone={totals.exceptions ? "amber" : "green"} note={totals.costCount + "/" + filtered.length + " project có nguồn cost"} /></section>;
}

function PortfolioTable({ projects, query }: { projects: PnlProject[]; query: string }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="text-lg font-bold">Danh sách project</h2><p className="mt-1 text-xs text-muted-foreground">Mở một dòng để xem nguyên nhân và nguồn dữ liệu.</p></div><span className="text-xs font-semibold text-muted-foreground">{projects.length} project</span></div><div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Project / owner</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3 text-right">Revenue</th><th className="px-3 py-3 text-right">Cost</th><th className="px-3 py-3 text-right">Margin</th><th className="px-3 py-3 text-right">Plan h</th><th className="px-3 py-3 text-right">P&L h</th><th className="px-3 py-3 text-right">Lệch h</th><th className="px-5 py-3">Hành động tiếp theo</th></tr></thead><tbody className="divide-y divide-border/70">{projects.map((project) => { const cost = project.costAvailable ? Math.max(project.revenue - project.grossMargin, 0) : undefined; const variance = project.logworkMinutes - project.planMinutes; return <tr key={project.id} className="hover:bg-blue-50/30"><td className="px-5 py-4"><Link href={"/pnl/" + encodeURIComponent(project.id) + "?" + query} className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><span className="block max-w-[300px] truncate font-semibold hover:text-primary">{project.name}</span><span className="mt-1 block text-xs text-muted-foreground">{project.code} · {project.client} · {project.ownerDisplayName || "Chưa phân công"}</span></Link></td><td className="px-3 py-4"><span className={"inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold " + statusClass(project.status)}>{project.status}</span></td><td className="px-3 py-4 text-right font-mono tabular-nums">{project.revenue ? formatMoney(project.revenue, project.currency) : "—"}</td><td className="px-3 py-4 text-right font-mono tabular-nums">{cost === undefined ? <span className="text-amber-700">Chưa có</span> : formatMoney(cost, project.currency)}</td><td className="px-3 py-4 text-right font-mono font-semibold tabular-nums">{project.costAvailable ? formatMoney(project.grossMargin, project.currency) : "—"}</td><td className="px-3 py-4 text-right font-mono">{formatHours(project.planMinutes)}</td><td className="px-3 py-4 text-right font-mono font-semibold text-blue-700">{formatHours(project.pnlMinutes)}</td><td className={"px-3 py-4 text-right font-mono " + (variance > 0 ? "text-rose-700" : "text-emerald-700")}>{variance > 0 ? "+" : ""}{formatHours(variance)}</td><td className="px-5 py-4 text-xs font-semibold text-muted-foreground">{actionFor(project)}</td></tr>; })}</tbody></table></div>{projects.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Không có project phù hợp.</div> : null}</section>;
}

function Overview({ projects, period, startDate, endDate, onPeriodChange, onRangeChange }: { projects: PnlProject[]; period: string; startDate: string; endDate: string; onPeriodChange: (value: string) => void; onRangeChange: (range: Range) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [exceptions, setExceptions] = useState(false);
  const filtered = useMemo(() => projects.filter((project) => { const needle = query.trim().toLowerCase(); const match = !needle || (project.name + " " + project.code + " " + project.client + " " + (project.ownerDisplayName || "")).toLowerCase().includes(needle); return match && (status === "all" || project.status === status) && (!exceptions || actionFor(project) !== "Không cần xử lý"); }), [exceptions, projects, query, status]);
  const queryString = startDate && endDate ? "startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate) : "scope=all";
  const queue = filtered.filter((project) => actionFor(project) !== "Không cần xử lý").slice(0, 6);
  return <div className="space-y-4"><header className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">P&L · tổng quan</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Tổng quan P&L</h1><p className="mt-2 text-sm text-muted-foreground">Theo dõi doanh thu, giờ và project cần xử lý trong phạm vi đã chọn.</p></div><div className="flex flex-wrap items-end gap-2"><Filters period={period} startDate={startDate} endDate={endDate} projects={projects} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} /><button type="button" onClick={() => void exportPnlWorkbook({ projects: filtered, period: startDate && endDate ? startDate + "_" + endDate : "all" })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:border-primary/40 hover:text-primary"><Download className="h-4 w-4" /> Xuất Excel</button></div></div><div className="mt-5 flex flex-wrap items-center gap-2"><label className="relative min-w-[260px] flex-1"><span className="sr-only">Tìm project</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm project, client hoặc owner" className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary" /></label><CrmSelect ariaLabel="Lọc trạng thái" value={status} onChange={setStatus} options={STATUS.map((value) => ({ value, label: value === "all" ? "Tất cả trạng thái" : value }))} /><button type="button" onClick={() => setExceptions((value) => !value)} className={"inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold " + (exceptions ? "border-amber-300 bg-amber-50 text-amber-800" : "border-border bg-card text-muted-foreground")}><Filter className="h-4 w-4" /> {exceptions ? "Đang xem ngoại lệ" : "Chỉ xem ngoại lệ"}</button><span className="text-xs text-muted-foreground">Phạm vi: {rangeLabel(startDate, endDate)}</span></div></header><OverviewMetrics projects={projects} filtered={filtered} /><section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Cần xử lý"><div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Ưu tiên xử lý</p><h2 className="mt-1 text-lg font-bold">Cần xử lý trước</h2><p className="mt-1 text-xs text-muted-foreground">Ngoại lệ có thể ảnh hưởng đến kỳ P&L.</p></div><Badge tone={queue.length ? "warn" : "good"}>{queue.length ? queue.length + " việc" : "Đã sạch"}</Badge></div>{queue.length ? <div className="divide-y divide-border/70">{queue.map((project) => <Link key={project.id} href={"/pnl/" + encodeURIComponent(project.id) + "?" + queryString} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-muted/20"><div className="min-w-0"><p className="truncate text-sm font-semibold">{project.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{project.code} · {project.ownerDisplayName || "Chưa phân công"}</p></div><div className="flex shrink-0 items-center gap-3"><Badge tone="warn">{actionFor(project)}</Badge><ChevronRight className="h-4 w-4 text-muted-foreground" /></div></Link>)}</div> : <div className="p-8 text-sm text-muted-foreground">Không có ngoại lệ trong phạm vi hiện tại.</div>}</section><PortfolioTable projects={filtered} query={queryString} /><div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-950"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>Chi phí chỉ hiển thị khi API có nguồn cost/snapshot. Không suy ra cost hoặc margin từ số 0 khi thiếu dữ liệu.</span></div></div>;
}

function DailyTable({ daily }: { daily: PnlDailyPoint[] }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const visible = showEmpty ? daily : daily.filter((point) => point.minutes > 0);
  const totals = daily.reduce((acc, point) => ({ logwork: acc.logwork + point.minutes, pnl: acc.pnl + (point.pnlMinutes || 0), pending: acc.pending + (point.pendingMinutes || 0), excluded: acc.excluded + Math.max(point.minutes - (point.pnlMinutes || 0) - (point.pendingMinutes || 0), 0), entries: acc.entries + (point.entryCount || 0) }), { logwork: 0, pnl: 0, pending: 0, excluded: 0, entries: 0 });
  const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value + "T12:00:00+07:00"));
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Time control</p><h2 className="mt-1 text-lg font-bold">Logwork theo ngày</h2><p className="mt-1 text-xs text-muted-foreground">Mặc định chỉ hiện ngày có phát sinh; tổng số vẫn tính trên toàn bộ phạm vi.</p></div><div className="flex items-center gap-2"><Badge>{daily.filter((point) => point.minutes > 0).length + "/" + daily.length + " ngày có log"}</Badge><button type="button" onClick={() => setShowEmpty((value) => !value)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary/40 hover:text-primary">{showEmpty ? "Ẩn ngày trống" : "Hiện ngày trống"}</button></div></div><div className="grid gap-3 border-b border-border p-4 sm:grid-cols-4"><Metric label="Logwork" value={formatHours(totals.logwork)} /><Metric label="P&L hợp lệ" value={formatHours(totals.pnl)} tone="blue" /><Metric label="Chờ xử lý" value={formatHours(totals.pending)} tone="amber" /><Metric label="Bị loại" value={formatHours(totals.excluded)} /></div><div className="max-h-[480px] overflow-auto"><table className="w-full min-w-[820px] text-left text-sm"><caption className="sr-only">Logwork chi tiết theo từng ngày</caption><thead className="sticky top-0 z-10 bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Ngày</th><th className="px-3 py-3 text-right">Logwork</th><th className="px-3 py-3 text-right">P&L</th><th className="px-3 py-3 text-right">Chờ</th><th className="px-3 py-3 text-right">Loại</th><th className="px-3 py-3 text-right">Entry</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-border/70">{visible.map((point) => { const pnl = point.pnlMinutes || 0; const pending = point.pendingMinutes || 0; const excluded = Math.max(point.minutes - pnl - pending, 0); const status = point.minutes === 0 ? "Không có log" : pending ? "Chờ xử lý" : excluded ? "Có giờ loại" : "Đã duyệt"; return <tr key={point.date} className="hover:bg-muted/20"><td className="px-5 py-3 font-semibold">{dateLabel(point.date)}</td><td className="px-3 py-3 text-right font-mono">{formatHours(point.minutes)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(pnl)}</td><td className="px-3 py-3 text-right font-mono text-amber-700">{formatHours(pending)}</td><td className="px-3 py-3 text-right font-mono text-rose-700">{formatHours(excluded)}</td><td className="px-3 py-3 text-right">{point.entryCount || 0}</td><td className="px-5 py-3"><Badge tone={status === "Đã duyệt" ? "good" : status === "Không có log" ? "neutral" : "warn"}>{status}</Badge></td></tr>; })}</tbody><tfoot className="border-t border-border bg-muted/25 font-bold"><tr><td className="px-5 py-3">Tổng cộng</td><td className="px-3 py-3 text-right font-mono">{formatHours(totals.logwork)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(totals.pnl)}</td><td className="px-3 py-3 text-right font-mono text-amber-700">{formatHours(totals.pending)}</td><td className="px-3 py-3 text-right font-mono text-rose-700">{formatHours(totals.excluded)}</td><td className="px-3 py-3 text-right">{totals.entries}</td><td className="px-5 py-3">{visible.length + "/" + daily.length + " dòng"}</td></tr></tfoot></table></div></section>;
}

function PeopleTable({ project }: { project: PnlProject }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Resource control</p><h2 className="mt-1 text-lg font-bold">Nhân sự tham gia</h2></div><Badge>{project.people.length + " người"}</Badge></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Nhân sự</th><th className="px-3 py-3 text-right">Plan h</th><th className="px-3 py-3 text-right">Logwork h</th><th className="px-3 py-3 text-right">P&L h</th><th className="px-5 py-3">Kiểm soát</th></tr></thead><tbody className="divide-y divide-border/70">{project.people.map((person) => <tr key={person.id} className="hover:bg-muted/20"><td className="px-5 py-3"><span className="font-semibold">{person.name}</span><span className="mt-1 block text-xs text-muted-foreground">{person.role}</span></td><td className="px-3 py-3 text-right font-mono">{formatHours(person.planMinutes)}</td><td className="px-3 py-3 text-right font-mono">{formatHours(person.logworkMinutes)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(person.pnlMinutes)}</td><td className="px-5 py-3"><Badge tone={person.pnlMinutes === person.logworkMinutes ? "good" : "warn"}>{person.pnlMinutes === person.logworkMinutes ? "Đã duyệt đủ" : "Còn giờ chờ"}</Badge></td></tr>)}</tbody></table></div></section>;
}

function DeliveryTree({ tasks, stages, milestones, loading, error }: { tasks: ProjectTaskSummary[]; stages: ProjectStageSummary[]; milestones: ProjectMilestoneSummary[]; loading: boolean; error?: string | null }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (loading) return <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-10 animate-pulse rounded bg-muted" /></div>;
  if (error) return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{error}</div>;
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const milestoneMap = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const groups = new Map<string, { name: string; stages: Map<string, ProjectTaskSummary[]> }>();
  tasks.forEach((task) => { const stage = task.stageId ? stageMap.get(task.stageId) : undefined; const milestoneId = stage?.milestoneId || "unassigned"; const current = groups.get(milestoneId) || { name: stage?.milestoneName || milestoneMap.get(milestoneId)?.name || "Chưa gán milestone", stages: new Map<string, ProjectTaskSummary[]>() }; const stageId = task.stageId || "unassigned-stage"; current.stages.set(stageId, [...(current.stages.get(stageId) || []), task]); groups.set(milestoneId, current); });
  const toggle = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Delivery scope</p><h2 className="mt-1 text-lg font-bold">Milestone → Stage → Task</h2><p className="mt-1 text-xs text-muted-foreground">Mở đúng nhánh cần kiểm tra.</p></div><Badge>{tasks.length + " task"}</Badge></div>{groups.size === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Project chưa có task.</div> : <div className="divide-y divide-border/70">{[...groups.entries()].map(([milestoneId, group]) => { const mKey = "m:" + milestoneId; const mClosed = collapsed.has(mKey); return <div key={milestoneId}><button type="button" onClick={() => toggle(mKey)} className="flex w-full items-center justify-between bg-muted/25 px-5 py-3 text-left hover:bg-muted/40"><span className="flex min-w-0 items-center gap-2"><span className="rounded bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">M</span><span className="truncate font-semibold">{group.name}</span></span>{mClosed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>{!mClosed ? <div className="divide-y divide-border/50">{[...group.stages.entries()].map(([stageId, stageTasks]) => { const stage = stageMap.get(stageId); const sKey = mKey + ":s:" + stageId; const sClosed = collapsed.has(sKey); return <div key={stageId}><button type="button" onClick={() => toggle(sKey)} className="flex w-full items-center justify-between px-5 py-3 pl-12 text-left hover:bg-muted/30"><span className="flex min-w-0 items-center gap-2"><span className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">S</span><span className="truncate font-semibold">{stage?.activity || "Chưa gán stage"}</span></span><span className="flex items-center gap-3 text-xs text-muted-foreground">{stageTasks.length} task {sClosed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></button>{!sClosed ? <div className="divide-y divide-border/50">{stageTasks.map((task) => <Link key={task.id} href={"/tasks/" + encodeURIComponent(task.id)} className="flex items-center justify-between gap-4 px-5 py-3 pl-20 text-sm hover:bg-blue-50/40"><span className="min-w-0 truncate">{task.title}</span><span className="shrink-0 text-xs text-muted-foreground">{formatHours(task.loggedMinutes)} / {formatHours(task.estimateMinutes)} <ArrowUpRight className="ml-2 inline h-3.5 w-3.5" /></span></Link>)}</div> : null}</div>; })}</div> : null}</div>; })}</div>}</section>;
}

type PnlFormulaConfig = {
  periodKey: string;
  items: Array<{ code: string; label: string; source: string; round: number; formula?: string }>;
  parameters: unknown[];
  pool: unknown;
  templates: unknown[];
};

const FALLBACK_FORMULAS = [
  { code: "DOANHTHU.LIC", label: "Doanh thu ghi nhận kỳ", source: "Hệ thống", round: 2, formula: "DOANH_THU_GHI_NHẬN_KỲ" },
  { code: "CP.LUONG", label: "Chi phí nhân sự", source: "Tổng nhóm", round: 5, formula: "TỔNG_THEO(khoản_mục, con_trực_tiếp)" },
  { code: "CP.VANHANH.AI", label: "Chi phí công cụ AI", source: "Phân bổ quỹ", round: 4, formula: "PHÂN_BỔ(QUY.AI, theo_giờ_P&L)" },
  { code: "CP", label: "Tổng chi phí", source: "Tổng nhóm", round: 5, formula: "TỔNG_THEO(khoản_mục, con_trực_tiếp)" },
  { code: "EBIT", label: "EBIT", source: "Công thức", round: 6, formula: "LN.GOP − CP" },
  { code: "TL.EBIT", label: "Biên EBIT", source: "Công thức", round: 6, formula: "TỶ_LỆ(EBIT; DOANHTHU)" }
];

function FormulaInspector({ period }: { period: string }) {
  const periodKey = /^\d{4}-\d{2}$/.test(period) ? period : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
  const [config, setConfig] = useState<PnlFormulaConfig | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/pnl-configurations?periodKey=${encodeURIComponent(periodKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "Không tải được công thức P&L.");
        if (!cancelled && payload?.data) {
          const next = payload.data as PnlFormulaConfig;
          setConfig(next);
          setDrafts(Object.fromEntries((next.items ?? []).map((item) => [item.code, item.formula ?? ""])));
        }
      })
      .catch(() => { if (!cancelled) setConfig(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [periodKey]);

  const formulas = FALLBACK_FORMULAS.map((fallback) => ({ ...fallback, ...(config?.items.find((item) => item.code === fallback.code) ?? {}) }));
  const saveFormula = async (code: string) => {
    if (!config) return;
    setSaving(code); setMessage(null);
    try {
      const items = config.items.map((item) => item.code === code ? { ...item, formula: drafts[code] } : item);
      const response = await fetch("/api/pnl-configurations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey, items, parameters: config.parameters, pool: config.pool, templates: config.templates }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Không thể lưu công thức.");
      setConfig((current) => current ? { ...current, items } : current);
      setMessage(`Đã lưu công thức ${code} cho kỳ ${periodKey}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu công thức.");
    } finally { setSaving(null); }
  };

  const [isExpanded, setIsExpanded] = useState(false);
  return <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Governance</p><h2 className="mt-1 text-lg font-bold">Công thức &amp; nguồn số</h2><p className="mt-1 text-xs text-muted-foreground">Chỉ mở khi cần kiểm tra cách tính hoặc điều chỉnh cấu hình.</p></div><div className="flex items-center gap-2"><Link href={`/pnl/config?periodKey=${encodeURIComponent(periodKey)}`} className="hidden items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-primary/40 hover:text-primary sm:inline-flex"><Pencil className="h-3.5 w-3.5" /> Mở cấu hình</Link><button type="button" onClick={() => setIsExpanded((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs font-semibold hover:bg-muted/60">{isExpanded ? "Thu gọn" : "Xem công thức"}{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></div></div>{isExpanded ? <>{loading ? <div className="border-t border-border p-5 text-sm text-muted-foreground">Đang tải công thức…</div> : <div className="divide-y divide-border/70 border-t border-border">{formulas.map((item) => { const isOpen = expanded === item.code; const draft = drafts[item.code] ?? item.formula ?? ""; const canEdit = Boolean(config?.items.some((configured) => configured.code === item.code)); return <div key={item.code}><button type="button" onClick={() => setExpanded(isOpen ? null : item.code)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/25"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.code} · {item.source} · Vòng {item.round}</span></span><span className="flex items-center gap-2 text-xs text-muted-foreground">{isOpen ? "Thu lại" : "Xem công thức"}{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span></button>{isOpen ? <div className="border-t border-border bg-muted/15 px-5 py-4"><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]"><label className="text-xs font-semibold text-muted-foreground">Công thức / quy tắc<textarea value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [item.code]: event.target.value }))} readOnly={!canEdit} rows={3} className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary read-only:bg-muted/30" /></label><div className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs"><p><strong>Nguồn số:</strong> {item.source}</p><p><strong>Vòng tính:</strong> {item.round}</p><p><strong>Trạng thái:</strong> {canEdit ? "Có thể chỉnh sửa" : "Chỉ xem — chưa có cấu hình kỳ"}</p></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2">{message ? <span className="text-xs text-muted-foreground">{message}</span> : <span className="text-xs text-muted-foreground">Thay đổi chỉ áp dụng sau khi lưu cấu hình kỳ.</span>}{canEdit ? <div className="flex items-center gap-2"><button type="button" onClick={() => setDrafts((current) => ({ ...current, [item.code]: item.formula ?? "" }))} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-background"><X className="h-3.5 w-3.5" /> Hủy</button><button type="button" disabled={saving === item.code} onClick={() => void saveFormula(item.code)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-3.5 w-3.5" /> {saving === item.code ? "Đang lưu…" : "Lưu công thức"}</button></div> : null}</div></div> : null}</div>; })}</div>}</> : <div className="border-t border-border bg-muted/15 px-5 py-3 text-xs text-muted-foreground">{loading ? "Đang kiểm tra cấu hình kỳ…" : config ? "Đã có cấu hình kỳ. Mở để xem và chỉnh sửa." : "Chưa có cấu hình kỳ. Mở cấu hình đầy đủ để thiết lập."}</div>}</section>;
}

function FinancePanels({ project, period = "" }: { project: PnlProject; period?: string }) {
  const cost = project.costAvailable ? Math.max(project.revenue - project.grossMargin, 0) : undefined;
  const excludedMinutes = Math.max(project.logworkMinutes - project.pnlMinutes - project.pendingMinutes, 0);
  const action = actionFor(project);
  const hasPendingHours = project.pendingMinutes > 0;
  const overPlan = project.logworkMinutes > project.planMinutes;
  const lineItems = [
    { label: "Doanh thu ghi nhận kỳ", group: "Doanh thu", value: project.revenue ? formatMoney(project.revenue, project.currency) : "Chưa có dữ liệu", status: project.revenue ? "Đủ dữ liệu" : "Thiếu dữ liệu" },
    { label: "Chi phí nhân sự", group: "Chi phí", value: "Chưa cấu hình NC2", status: "Chưa tính" },
    { label: "Chi phí dùng chung", group: "Chi phí", value: "Chưa có dữ liệu", status: "Chưa tính" },
    { label: "Tổng chi phí", group: "Chi phí", value: cost === undefined ? "Chưa có dữ liệu" : formatMoney(cost, project.currency), status: cost === undefined ? "Chưa tính" : "Đủ dữ liệu" },
    { label: "EBIT", group: "Kết quả", value: project.costAvailable ? formatMoney(project.grossMargin, project.currency) : "Chưa đủ dữ liệu", status: project.costAvailable ? "Đủ dữ liệu" : "Chưa tính" },
    { label: "Biên EBIT", group: "Chỉ số", value: project.revenue && project.costAvailable ? Math.round((project.grossMargin / project.revenue) * 100) + "%" : "—", status: project.revenue && project.costAvailable ? "Đủ dữ liệu" : "Chưa tính" }
  ];
  return <div className="space-y-4">
    <section className="grid gap-3 lg:grid-cols-3">
      <article className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Chi phí nhân sự</p><p className="mt-2 text-lg font-bold">Chưa cấu hình</p><p className="mt-1 text-xs text-muted-foreground">Cần cost rate hiệu lực theo ngày log.</p></article>
      <article className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Chi phí dùng chung</p><p className="mt-2 text-lg font-bold">Chưa phân bổ</p><p className="mt-1 text-xs text-muted-foreground">Quỹ phải khớp trước khi khóa kỳ.</p></article>
      <article className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Nguồn tiền tệ</p><p className="mt-2 text-lg font-bold">{project.currency}</p><p className="mt-1 text-xs text-muted-foreground">Không tự quy đổi khi chưa có tỷ giá chốt.</p></article>
    </section>
    <section className={"rounded-xl border p-4 " + (action === "Không cần xử lý" ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/70")} aria-label="Quyết định quản lý"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Quyết định quản lý</p><h2 className="mt-1 text-base font-bold">{action === "Không cần xử lý" ? "Kỳ đang ổn" : action}</h2><p className="mt-1 text-xs text-muted-foreground">{action === "Không cần xử lý" ? "Các nguồn chính đã đủ để tiếp tục theo dõi kỳ này." : "Xử lý mục này trước khi chốt số liệu P&amp;L của kỳ."}</p></div><div className="flex flex-wrap gap-2 text-xs"><Badge tone={project.costAvailable ? "good" : "warn"}>{project.costAvailable ? "Có cost" : "Thiếu cost"}</Badge><Badge tone={hasPendingHours ? "warn" : "good"}>{hasPendingHours ? "Có giờ chờ" : "Không có giờ chờ"}</Badge><Badge tone={overPlan ? "warn" : "good"}>{overPlan ? "Vượt plan" : "Trong plan"}</Badge></div></div></section>
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="border-b border-border px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">P&L theo khoản mục</p><h2 className="mt-1 text-lg font-bold">Cây khoản mục của project</h2><p className="mt-1 text-xs text-muted-foreground">Số liệu chỉ xuất hiện khi nguồn và công thức của kỳ đã đủ điều kiện.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Khoản mục</th><th className="px-3 py-3">Nhóm</th><th className="px-3 py-3 text-right">Giá trị</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-border/70">{lineItems.map((item) => <tr key={item.label} className="hover:bg-muted/20"><td className="px-5 py-3 font-semibold">{item.label}</td><td className="px-3 py-3 text-xs text-muted-foreground">{item.group}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{item.value}</td><td className="px-5 py-3"><Badge tone={item.status === "Đủ dữ liệu" ? "good" : "warn"}>{item.status}</Badge></td></tr>)}</tbody></table></div></section>
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="border-b border-border px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Đối soát giờ</p><h2 className="mt-1 text-lg font-bold">Logwork = P&L + chờ xử lý + bị loại</h2></div><div className="grid gap-3 p-4 sm:grid-cols-4"><Metric label="Logwork" value={formatHours(project.logworkMinutes)} /><Metric label="P&L hợp lệ" value={formatHours(project.pnlMinutes)} tone="blue" /><Metric label="Chờ xử lý" value={formatHours(project.pendingMinutes)} tone="amber" /><Metric label="Bị loại" value={formatHours(excludedMinutes)} /></div><div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Tổng kiểm tra: {formatHours(project.pnlMinutes)} + {formatHours(project.pendingMinutes)} + {formatHours(excludedMinutes)} = {formatHours(project.logworkMinutes)}.</div></section>
    <FormulaInspector period={period} />
    <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-950"><CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>Currency nguồn: <strong>{project.currency}</strong>. P&L hiện đang hiển thị đúng trạng thái nguồn, không suy ra chi phí từ số 0.</span></div>
  </div>;
}

function Detail({ project, projects, period, startDate, endDate, onPeriodChange, onRangeChange, tasks, stages, milestones, workLoading, workError }: { project: PnlProject; projects: PnlProject[]; period: string; startDate: string; endDate: string; onPeriodChange: (value: string) => void; onRangeChange: (range: Range) => void; tasks: ProjectTaskSummary[]; stages: ProjectStageSummary[]; milestones: ProjectMilestoneSummary[]; workLoading: boolean; workError?: string | null }) {
  const [tab, setTab] = useState<Tab>("overview");
  const cost = project.costAvailable ? Math.max(project.revenue - project.grossMargin, 0) : undefined;
  const margin = project.revenue && project.costAvailable ? Math.round((project.grossMargin / project.revenue) * 100) + "%" : "—";
  const backQuery = startDate && endDate ? "startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate) : "scope=all";
  const tabs: Array<{ value: Tab; label: string; icon: ReactNode }> = [{ value: "overview", label: "Tổng quan", icon: <Layers3 className="h-4 w-4" /> }, { value: "logwork", label: "Logwork", icon: <Clock3 className="h-4 w-4" /> }, { value: "delivery", label: "Delivery", icon: <Check className="h-4 w-4" /> }, { value: "finance", label: "Tài chính", icon: <CircleDollarSign className="h-4 w-4" /> }];
  return <div className="space-y-4"><section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><Link href={"/pnl?" + backQuery} className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại portfolio</Link><div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Project P&L</p><span className={"rounded-full border px-2.5 py-1 text-[11px] font-semibold " + statusClass(project.status)}>{project.status}</span></div><h1 className="mt-2 truncate text-2xl font-bold tracking-tight">{project.name}</h1><p className="mt-1 text-sm text-muted-foreground">{project.code} · {project.client} · {rangeLabel(startDate, endDate)}</p></div><Filters period={period} startDate={startDate} endDate={endDate} projects={projects} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} /></div><div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Revenue" value={project.revenue ? formatMoney(project.revenue, project.currency) : "Chưa có"} tone="green" /><Metric label="Chi phí thực tế" value={cost === undefined ? "Chưa có" : formatMoney(cost, project.currency)} /><Metric label="Gross margin" value={project.costAvailable ? formatMoney(project.grossMargin, project.currency) : "Chưa đủ"} tone="green" /><Metric label="Margin %" value={margin} tone="green" /><Metric label="Cần xử lý" value={actionFor(project) === "Không cần xử lý" ? "Không" : actionFor(project)} tone={actionFor(project) === "Không cần xử lý" ? "green" : "amber"} /></div></section><section className="rounded-xl border border-border bg-card p-1"><div className="grid grid-cols-2 gap-1 sm:grid-cols-4">{tabs.map((item) => <button key={item.value} type="button" onClick={() => setTab(item.value)} className={"flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold " + (tab === item.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>{item.icon}{item.label}</button>)}</div></section><section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Plan hour" value={formatHours(project.planMinutes)} /><Metric label="Logwork" value={formatHours(project.logworkMinutes)} /><Metric label="P&L hợp lệ" value={formatHours(project.pnlMinutes)} tone="blue" /><Metric label="Chờ xử lý" value={formatHours(project.pendingMinutes)} tone="amber" /><Metric label="Lệch kế hoạch" value={formatHours(project.logworkMinutes - project.planMinutes)} tone={project.logworkMinutes > project.planMinutes ? "amber" : "plain"} /></section>{project.dataSource === "project" ? <div role="status" className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-950"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>Kỳ này chưa có time entry riêng. Giờ đang lấy từ tổng hợp project; khi có log trong kỳ, hệ thống sẽ chuyển sang dữ liệu theo kỳ.</span></div> : null}{tab === "overview" ? <div className="space-y-4"><PeopleTable project={project} /><section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Delivery health</p><h2 className="mt-1 text-lg font-bold">Tiến độ cần chú ý</h2><p className="mt-1 text-xs text-muted-foreground">Mở tab Delivery để xem toàn bộ cây công việc.</p></div><Badge tone={tasks.length ? "neutral" : "warn"}>{tasks.length + " task"}</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Milestone</p><p className="mt-1 text-lg font-bold">{milestones.length}</p></div><div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Stage</p><p className="mt-1 text-lg font-bold">{stages.length}</p></div><div className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-amber-800">Pending giờ</p><p className="mt-1 text-lg font-bold text-amber-800">{formatHours(project.pendingMinutes)}</p></div></div></section></div> : null}{tab === "logwork" ? <DailyTable daily={project.daily} /> : null}{tab === "delivery" ? <DeliveryTree tasks={tasks} stages={stages} milestones={milestones} loading={workLoading} error={workError} /> : null}{tab === "finance" ? <FinancePanels project={project} /> : null}</div>;
}

type Paged<T> = { data?: T[]; meta?: { pagination?: { hasNextPage?: boolean; offset?: number; returned?: number } } };
async function fetchPaged<T>(path: string) {
  const url = new URL(path, window.location.origin);
  const rows: T[] = [];
  let offset = Number(url.searchParams.get("offset") || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  for (let page = 0; page < 100; page += 1) { url.searchParams.set("limit", String(limit)); url.searchParams.set("offset", String(offset)); const response = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" }); if (!response.ok) throw new Error("P&L API chưa sẵn sàng (" + response.status + ")"); const payload = await response.json() as Paged<T>; const pageRows = payload.data || []; rows.push(...pageRows); const pagination = payload.meta?.pagination; if (!pagination?.hasNextPage || !pageRows.length) break; const next = (pagination.offset || offset) + (pagination.returned || pageRows.length); if (next <= offset) break; offset = next; }
  return rows;
}

async function fetchEntries(projects: ProjectSummary[], startDate: string, endDate: string) {
  const starts = projects.map((project) => project.plannedStartAt?.slice(0, 10)).filter((value): value is string => Boolean(value));
  const ends = projects.map((project) => project.plannedEndAt?.slice(0, 10)).filter((value): value is string => Boolean(value));
  const from = startDate || starts.sort()[0] || "2020-01-01";
  const to = endDate || ends.sort().at(-1) || new Date().toISOString().slice(0, 10);
  const cursor = new Date(from + "T00:00:00.000Z");
  const last = new Date(to + "T00:00:00.000Z");
  const entries = new Map<string, TaskTimeEntrySummary>();
  while (cursor <= last) { const chunkEnd = new Date(cursor); chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 89); const inclusiveEnd = new Date(Math.min(chunkEnd.getTime(), last.getTime())); inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() + 1); const chunk = await fetchPaged<TaskTimeEntrySummary>("/api/tasks/time-entries?limit=100&offset=0&startAt=" + encodeURIComponent(cursor.toISOString()) + "&endAt=" + encodeURIComponent(inclusiveEnd.toISOString())); chunk.forEach((entry) => entries.set(entry.id, entry)); cursor.setTime(inclusiveEnd.getTime()); }
  return [...entries.values()];
}

async function fetchPnl(startDate: string, endDate: string) {
  const projects = await fetchPaged<ProjectSummary>("/api/projects?limit=100&offset=0");
  const query = startDate && endDate ? "?startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate) : "";
  const [summaryResponse, entries] = await Promise.all([fetch("/api/project-controls/pl-summary" + query, { cache: "no-store", credentials: "same-origin" }), fetchEntries(projects, startDate, endDate)]);
  if (!summaryResponse.ok) throw new Error("P&L API chưa sẵn sàng");
  const payload = await summaryResponse.json() as { data: ProjectPlSummaryItem[] };
  return adaptLivePnlProjects(payload.data, projects, entries, startDate ? startDate.slice(0, 7) : undefined, startDate && endDate ? { startDate, endDate } : undefined);
}

async function fetchWork(projectId: string) {
  const [tasks, stages, milestones] = await Promise.all([fetchPaged<ProjectTaskSummary>("/api/tasks?projectId=" + encodeURIComponent(projectId) + "&limit=100&offset=0"), fetch("/api/projects/" + encodeURIComponent(projectId) + "/stages", { cache: "no-store", credentials: "same-origin" }), fetch("/api/projects/" + encodeURIComponent(projectId) + "/milestones", { cache: "no-store", credentials: "same-origin" })]);
  if (!stages.ok || !milestones.ok) throw new Error("Không tải được cấu trúc công việc của project.");
  const stagePayload = await stages.json() as ResourceListResponse<ProjectStageSummary>;
  const milestonePayload = await milestones.json() as { data?: ProjectMilestoneSummary[]; milestones?: ProjectMilestoneSummary[] };
  return { tasks, stages: stagePayload.data, milestones: milestonePayload.data || milestonePayload.milestones || [] };
}

export function PnlControlCenter({ projectId }: Props) {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projects, setProjects] = useState<PnlProject[]>([]);
  const [tasks, setTasks] = useState<ProjectTaskSummary[]>([]);
  const [stages, setStages] = useState<ProjectStageSummary[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  useEffect(() => { const requestedPeriod = searchParams.get("period"); const requestedStart = searchParams.get("startDate"); const requestedEnd = searchParams.get("endDate"); if (requestedStart && requestedEnd && requestedStart <= requestedEnd) { setStartDate(requestedStart); setEndDate(requestedEnd); setPeriod(requestedStart.slice(0, 7)); } else if (requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod)) { const range = monthRange(requestedPeriod); setPeriod(requestedPeriod); setStartDate(range.startDate); setEndDate(range.endDate); } else if (searchParams.get("scope") === "all") { setPeriod(""); setStartDate(""); setEndDate(""); } }, [searchParams]);
  useEffect(() => { let cancelled = false; setLoading(true); setError(null); fetchPnl(startDate, endDate).then((data) => { if (!cancelled) setProjects(data); }).catch((reason: unknown) => { if (!cancelled) { setProjects([]); setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu P&L."); } }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [startDate, endDate]);
  useEffect(() => { if (!projectId) { setTasks([]); setStages([]); setMilestones([]); return; } let cancelled = false; setWorkLoading(true); setWorkError(null); fetchWork(decodeURIComponent(projectId)).then((data) => { if (!cancelled) { setTasks(data.tasks); setStages(data.stages); setMilestones(data.milestones); } }).catch((reason: unknown) => { if (!cancelled) { setTasks([]); setStages([]); setMilestones([]); setWorkError(reason instanceof Error ? reason.message : "Không tải được delivery."); } }).finally(() => { if (!cancelled) setWorkLoading(false); }); return () => { cancelled = true; }; }, [projectId]);
  const selected = projectId ? projects.find((project) => project.id === decodeURIComponent(projectId)) : undefined;
  const onPeriodChange = (value: string) => { if (value === "all") { setPeriod(""); setStartDate(""); setEndDate(""); return; } const range = monthRange(value); setPeriod(value); setStartDate(range.startDate); setEndDate(range.endDate); };
  const onRangeChange = (range: Range) => { setStartDate(range.startDate); setEndDate(range.endDate); setPeriod(/^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate) && range.startDate <= range.endDate ? range.startDate.slice(0, 7) : ""); };
  return <AppShell activeRoute="/pnl" shellTestId="pnl-shell" desktopSidebarTestId="pnl-desktop-sidebar" mobileHeaderTestId="pnl-mobile-shell" title="P&L"><main data-testid="pnl-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background p-4 sm:p-6">{error ? <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}{loading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div> : projectId && !selected ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900"><h1 className="font-bold">Không tìm thấy project</h1><p className="mt-1">Project không nằm trong phạm vi dữ liệu hiện tại.</p><Link href="/pnl?scope=all" className="mt-4 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Quay lại portfolio</Link></div> : selected ? <Detail project={selected} projects={projects} period={period} startDate={startDate} endDate={endDate} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} tasks={tasks} stages={stages} milestones={milestones} workLoading={workLoading} workError={workError} /> : <Overview projects={projects} period={period} startDate={startDate} endDate={endDate} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} />}</main></AppShell>;
}
