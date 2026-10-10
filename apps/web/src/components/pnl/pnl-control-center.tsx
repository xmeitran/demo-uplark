"use client";

import { PersonLink } from "@/components/person-link";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Download, Pencil, Search } from "lucide-react";
import type { ProjectMilestoneSummary, ProjectPlSummaryItem, ProjectStageSummary, ProjectSummary, ProjectTaskSummary, ResourceListResponse, TaskTimeEntrySummary } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { WorkspaceTabBar } from "@/components/workspace-tab-bar";
import { adaptLivePnlProjects, EXPENSE_GROUPS, formatHours, formatMoney, type PnlDailyPoint, type PnlProject, type PnlProjectStatus } from "./pnl-data";
import { exportPnlWorkbook } from "./pnl-export";
import { monthDateRange } from "./pnl-cost-shared";
import { PnlStatement } from "./pnl-statement";

type Props = { projectId?: string };
type Range = { startDate: string; endDate: string };
type Tab = "overview" | "logwork" | "delivery";
/** What the API says about the viewed range (pl-summary meta). */
type PlMeta = { partialPeriod?: boolean; formulaErrors?: string[]; canEdit?: boolean; locked?: boolean };
const DETAIL_TABS: Array<{ id: Tab; label: string }> = [{ id: "overview", label: "Tổng quan" }, { id: "logwork", label: "Giờ & logwork" }, { id: "delivery", label: "Delivery" }];
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
  return <div className="min-w-0 rounded-xl border border-border/80 bg-card px-3 py-3 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className={"mt-1 truncate text-lg font-bold tracking-tight " + color}>{value}</p>{note ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{note}</p> : null}</div>;
}

function Filters({ period, startDate, endDate, projects, onPeriodChange, onRangeChange }: { period: string; startDate: string; endDate: string; projects: PnlProject[]; onPeriodChange: (value: string) => void; onRangeChange: (range: Range) => void }) {
  const periods = new Set(projects.flatMap((project) => project.daily.map((point) => point.date.slice(0, 7))));
  periods.add(currentPeriod());
  if (period) periods.add(period);
  const options = [...periods].sort((a, b) => b.localeCompare(a)).map((value) => ({ value, label: periodLabel(value) }));
  return <div className="flex flex-wrap items-end gap-2"><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Kỳ nhanh</span><CrmSelect ariaLabel="Kỳ nhanh" value={period || "all"} onChange={onPeriodChange} options={[{ value: "all", label: "Tất cả thời gian" }, ...options]} /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Từ ngày</span><input aria-label="Từ ngày" type="date" value={startDate} onChange={(event) => onRangeChange({ startDate: event.target.value, endDate })} className="h-10 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Đến ngày</span><input aria-label="Đến ngày" type="date" min={startDate || undefined} value={endDate} onChange={(event) => onRangeChange({ startDate, endDate: event.target.value })} className="h-10 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" /></label></div>;
}

function formatMarginPercent(value?: number) {
  return value === undefined ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value) + "%";
}

function actionFor(project: PnlProject) {
  if (project.revenueBasis === "none" || (project.revenueBasis !== "custom" && project.plannedRevenue <= 0)) return "Bổ sung doanh thu";
  if (project.missingRateMinutes > 0) return "Nhập cost rate";
  if (project.pendingMinutes > 0) return "Duyệt hoặc phân loại giờ";
  if (project.logworkMinutes > project.planMinutes) return "Rà soát vượt kế hoạch";
  if (project.status === "Thiếu dữ liệu") return "Bổ sung baseline";
  return "Không cần xử lý";
}

function OverviewMetrics({ filtered, exceptions, onToggleExceptions }: { filtered: PnlProject[]; exceptions: boolean; onToggleExceptions: () => void }) {
  const totals = filtered.reduce((acc, project) => ({ plan: acc.plan + project.planMinutes, logwork: acc.logwork + project.logworkMinutes, pnl: acc.pnl + project.pnlMinutes, pending: acc.pending + project.pendingMinutes, revenue: acc.revenue + project.revenue, cost: acc.cost + (project.costAvailable ? project.totalCost : 0), costCount: acc.costCount + (project.costAvailable ? 1 : 0), exceptions: acc.exceptions + (actionFor(project) === "Không cần xử lý" ? 0 : 1) }), { plan: 0, logwork: 0, pnl: 0, pending: 0, revenue: 0, cost: 0, costCount: 0, exceptions: 0 });
  const currency = filtered[0]?.currency || "VND";
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tóm tắt P&L"><Metric label="Doanh thu" value={totals.revenue ? formatMoney(totals.revenue, currency) : "Chưa có dữ liệu"} tone="green" /><Metric label="Giờ đã duyệt" value={formatHours(totals.pnl)} tone="blue" note={formatHours(totals.pending) + " chờ xử lý"} /><Metric label="Lệch kế hoạch" value={formatHours(totals.logwork - totals.plan)} tone={totals.logwork > totals.plan ? "amber" : "plain"} note="Logwork − Plan" /><button type="button" aria-pressed={exceptions} onClick={onToggleExceptions} className={"min-w-0 rounded-xl border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 " + (exceptions ? "border-amber-300 bg-amber-50" : "border-border/80 bg-card shadow-sm hover:border-primary/40")}><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Cần xử lý</p><p className={"mt-1 truncate text-lg font-bold tracking-tight " + (totals.exceptions ? "text-amber-800" : "text-emerald-700")}>{totals.exceptions}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{exceptions ? "Đang xem ngoại lệ" : "Chỉ xem ngoại lệ"}</p></button></section>;
}

function PortfolioTable({ projects, query, toolbar }: { projects: PnlProject[]; query: string; toolbar: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex flex-col items-stretch gap-3 border-b border-border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4"><h2 className="text-lg font-bold sm:mr-2">Danh sách project</h2>{toolbar}</div><div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Project / owner</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3 text-right">Doanh thu</th><th className="px-3 py-3 text-right" title="Chi phí chỉ hiển thị khi mọi giờ đã duyệt đều có cost rate. Không suy ra chi phí hay EBIT từ số 0 khi thiếu dữ liệu."><span className="cursor-help underline decoration-dotted underline-offset-2">Chi phí</span></th><th className="px-3 py-3 text-right">EBIT</th><th className="px-3 py-3 text-right">Plan h</th><th className="px-3 py-3 text-right">Giờ đã duyệt</th><th className="px-3 py-3 text-right">Lệch h</th><th className="px-5 py-3">Hành động tiếp theo</th></tr></thead><tbody className="divide-y divide-border/70">{projects.map((project) => { const cost = project.costAvailable ? project.totalCost : undefined; const variance = project.logworkMinutes - project.planMinutes; return <tr key={project.id} className="hover:bg-blue-50/30"><td className="px-5 py-4"><div className="flex items-center gap-1"><Link href={"/pnl/" + encodeURIComponent(project.id) + "?" + query} className="block min-w-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><span className="block max-w-[300px] truncate font-semibold hover:text-primary">{project.name}</span></Link><Link href={"/projects/" + encodeURIComponent(project.id)} aria-label={"Mở project " + project.name} title="Mở project" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-blue-50 hover:text-primary"><ArrowUpRight className="h-3.5 w-3.5" /></Link></div><span className="mt-1 block text-xs text-muted-foreground">{project.code} · {project.client} · {project.ownerDisplayName || "Chưa phân công"}</span></td><td className="px-3 py-4"><span className={"inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold " + statusClass(project.status)}>{project.status}</span></td><td className="px-3 py-4 text-right font-mono tabular-nums">{project.revenue ? formatMoney(project.revenue, project.currency) : "—"}</td><td className="px-3 py-4 text-right font-mono tabular-nums">{cost === undefined ? <span className="text-amber-700">Chưa có</span> : formatMoney(cost, project.currency)}</td><td className="px-3 py-4 text-right font-mono font-semibold tabular-nums">{project.costAvailable && project.revenueBasis !== "none" ? formatMoney(project.grossMargin, project.currency) : "—"}</td><td className="px-3 py-4 text-right font-mono">{formatHours(project.planMinutes)}</td><td className="px-3 py-4 text-right font-mono font-semibold text-blue-700">{formatHours(project.pnlMinutes)}</td><td className={"px-3 py-4 text-right font-mono " + (variance > 0 ? "text-rose-700" : "text-emerald-700")}>{variance > 0 ? "+" : ""}{formatHours(variance)}</td><td className="px-5 py-4 text-xs font-semibold text-muted-foreground">{actionFor(project)}</td></tr>; })}</tbody></table></div>{projects.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Không có project phù hợp.</div> : null}<div className="border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">{projects.length} project</div></section>;
}

/** Warnings the API attaches to the viewed range: a broken-month range, and setup that could not be calculated. */
function PlNotices({ meta }: { meta: PlMeta }) {
  const errors = meta.formulaErrors ?? [];
  return <>{meta.partialPeriod ? <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900">Khoảng ngày lẻ: chỉ gồm giờ, chi phí nhân sự và chi phí nhập tay; doanh thu, quỹ và khoản tính theo công thức tính theo tháng tròn.</p> : null}{errors.length ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p className="font-semibold">Có {errors.length} tham số hoặc công thức chưa tính được. Các khoản này đang bị bỏ ra khỏi chi phí và EBIT cho tới khi sửa (tháng · khoản: lý do):</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{errors.slice(0, 12).map((message) => <li key={message}>{message}</li>)}</ul>{errors.length > 12 ? <p className="mt-1 text-xs">… và {errors.length - 12} lỗi khác.</p> : null}<Link href="/pnl/config" className="mt-2 inline-block text-xs font-bold underline underline-offset-2">Mở Thiết lập P&amp;L để sửa</Link></div> : null}</>;
}

function Overview({ projects, meta, period, startDate, endDate, onPeriodChange, onRangeChange }: { projects: PnlProject[]; meta: PlMeta; period: string; startDate: string; endDate: string; onPeriodChange: (value: string) => void; onRangeChange: (range: Range) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [exceptions, setExceptions] = useState(false);
  const filtered = useMemo(() => projects.filter((project) => { const needle = query.trim().toLowerCase(); const match = !needle || (project.name + " " + project.code + " " + project.client + " " + (project.ownerDisplayName || "")).toLowerCase().includes(needle); return match && (status === "all" || project.status === status) && (!exceptions || actionFor(project) !== "Không cần xử lý"); }), [exceptions, projects, query, status]);
  const queryString = startDate && endDate ? "startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate) : "scope=all";
  return <div className="space-y-5"><header className="flex flex-col items-start justify-between gap-3 xl:flex-row xl:items-end"><div><h1 className="!text-xl font-bold text-foreground">Tổng quan P&L</h1><p className="mt-0.5 text-sm text-muted-foreground">Theo dõi doanh thu, giờ và project cần xử lý trong phạm vi đã chọn.</p></div><div className="flex flex-wrap items-end gap-2"><Filters period={period} startDate={startDate} endDate={endDate} projects={projects} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} /><button type="button" onClick={() => void exportPnlWorkbook({ projects: filtered, period: startDate && endDate ? startDate + "_" + endDate : "all" })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:border-primary/40 hover:text-primary"><Download className="h-4 w-4" /> Xuất Excel</button><Link href="/pnl/costs" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"><Pencil className="h-4 w-4" /> Nhập chi phí</Link></div></header><PlNotices meta={meta} /><OverviewMetrics filtered={filtered} exceptions={exceptions} onToggleExceptions={() => setExceptions((value) => !value)} /><PortfolioTable projects={filtered} query={queryString} toolbar={<><label className="relative min-w-[260px] flex-1"><span className="sr-only">Tìm project</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm project, client hoặc owner" className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary" /></label><CrmSelect ariaLabel="Lọc trạng thái" value={status} onChange={setStatus} options={STATUS.map((value) => ({ value, label: value === "all" ? "Tất cả trạng thái" : value }))} /></>} /></div>;
}

function DailyTable({ daily }: { daily: PnlDailyPoint[] }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const visible = showEmpty ? daily : daily.filter((point) => point.minutes > 0);
  const totals = daily.reduce((acc, point) => ({ logwork: acc.logwork + point.minutes, pnl: acc.pnl + (point.pnlMinutes || 0), pending: acc.pending + (point.pendingMinutes || 0), excluded: acc.excluded + Math.max(point.minutes - (point.pnlMinutes || 0) - (point.pendingMinutes || 0), 0), entries: acc.entries + (point.entryCount || 0) }), { logwork: 0, pnl: 0, pending: 0, excluded: 0, entries: 0 });
  const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value + "T12:00:00+07:00"));
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Time control</p><h2 className="mt-1 text-lg font-bold">Logwork theo ngày</h2><p className="mt-1 text-xs text-muted-foreground">Mặc định chỉ hiện ngày có phát sinh; tổng số vẫn tính trên toàn bộ phạm vi.</p></div><div className="flex items-center gap-2"><Badge>{daily.filter((point) => point.minutes > 0).length + "/" + daily.length + " ngày có log"}</Badge><button type="button" onClick={() => setShowEmpty((value) => !value)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary/40 hover:text-primary">{showEmpty ? "Ẩn ngày trống" : "Hiện ngày trống"}</button></div></div><div className="max-h-[480px] overflow-auto"><table className="w-full min-w-[820px] text-left text-sm"><caption className="sr-only">Logwork chi tiết theo từng ngày</caption><thead className="sticky top-0 z-10 bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Ngày</th><th className="px-3 py-3 text-right">Logwork</th><th className="px-3 py-3 text-right">Giờ đã duyệt</th><th className="px-3 py-3 text-right">Chờ</th><th className="px-3 py-3 text-right">Loại</th><th className="px-3 py-3 text-right">Entry</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-border/70">{visible.map((point) => { const pnl = point.pnlMinutes || 0; const pending = point.pendingMinutes || 0; const excluded = Math.max(point.minutes - pnl - pending, 0); const status = point.minutes === 0 ? "Không có log" : pending ? "Chờ xử lý" : excluded ? "Có giờ loại" : "Đã duyệt"; return <tr key={point.date} className="hover:bg-muted/20"><td className="px-5 py-3 font-semibold">{dateLabel(point.date)}</td><td className="px-3 py-3 text-right font-mono">{formatHours(point.minutes)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(pnl)}</td><td className="px-3 py-3 text-right font-mono text-amber-700">{formatHours(pending)}</td><td className="px-3 py-3 text-right font-mono text-rose-700">{formatHours(excluded)}</td><td className="px-3 py-3 text-right">{point.entryCount || 0}</td><td className="px-5 py-3"><Badge tone={status === "Đã duyệt" ? "good" : status === "Không có log" ? "neutral" : "warn"}>{status}</Badge></td></tr>; })}</tbody><tfoot className="border-t border-border bg-muted/25 font-bold"><tr><td className="px-5 py-3">Tổng cộng</td><td className="px-3 py-3 text-right font-mono">{formatHours(totals.logwork)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(totals.pnl)}</td><td className="px-3 py-3 text-right font-mono text-amber-700">{formatHours(totals.pending)}</td><td className="px-3 py-3 text-right font-mono text-rose-700">{formatHours(totals.excluded)}</td><td className="px-3 py-3 text-right">{totals.entries}</td><td className="px-5 py-3">{visible.length + "/" + daily.length + " dòng"}</td></tr></tfoot></table></div></section>;
}

function PeopleTable({ project }: { project: PnlProject }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Resource control</p><h2 className="mt-1 text-lg font-bold">Nhân sự tham gia</h2>{project.locked ? <p className="mt-1 text-xs font-medium text-amber-800">Kỳ đã chốt: giờ, cost rate và chi phí theo người ở bảng này là dữ liệu hiện tại, có thể khác chi phí nhân sự đã chốt ({formatMoney(project.laborCost, project.currency)}).</p> : null}</div><Badge>{project.people.length + " người"}</Badge></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Nhân sự</th><th className="px-3 py-3 text-right">Plan h</th><th className="px-3 py-3 text-right">Logwork h</th><th className="px-3 py-3 text-right">Giờ đã duyệt</th><th className="px-3 py-3 text-right">Cost rate</th><th className="px-3 py-3 text-right">Chi phí</th><th className="px-5 py-3">Kiểm soát</th></tr></thead><tbody className="divide-y divide-border/70">{project.people.map((person) => <tr key={person.id} className="hover:bg-muted/20"><td className="px-5 py-3"><PersonLink userId={person.id} className="font-semibold hover:text-primary">{person.name}</PersonLink><span className="mt-1 block text-xs text-muted-foreground">{person.role}</span></td><td className="px-3 py-3 text-right font-mono">{formatHours(person.planMinutes)}</td><td className="px-3 py-3 text-right font-mono">{formatHours(person.logworkMinutes)}</td><td className="px-3 py-3 text-right font-mono text-blue-700">{formatHours(person.pnlMinutes)}</td><td className="px-3 py-3 text-right font-mono">{person.hourlyCostRate === undefined ? (person.missingRateMinutes ? <Link href="/pnl/costs" className="font-sans text-xs font-semibold text-amber-700 underline decoration-dotted underline-offset-2 hover:decoration-solid">Chưa có</Link> : "—") : formatMoney(person.hourlyCostRate, project.currency)}</td><td className="px-3 py-3 text-right font-mono font-semibold">{person.laborCost === undefined ? "—" : formatMoney(person.laborCost, project.currency)}{person.missingRateMinutes ? <span className="block font-sans text-[11px] font-normal text-amber-700">thiếu {formatHours(person.missingRateMinutes)}</span> : null}</td><td className="px-5 py-3"><Badge tone={person.pnlMinutes === person.logworkMinutes ? "good" : "warn"}>{person.pnlMinutes === person.logworkMinutes ? "Đã duyệt đủ" : "Còn giờ chờ"}</Badge></td></tr>)}</tbody></table></div></section>;
}

function DeliveryTree({ tasks, stages, milestones, loading, error }: { tasks: ProjectTaskSummary[]; stages: ProjectStageSummary[]; milestones: ProjectMilestoneSummary[]; loading: boolean; error?: string | null }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  if (loading) return <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-16 animate-pulse rounded bg-muted" /><div className="h-16 animate-pulse rounded bg-muted" /></div>;
  if (error) return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{error}</div>;

  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const milestoneMap = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const groups = new Map<string, { name: string; stages: Map<string, ProjectTaskSummary[]> }>();
  milestones.forEach((milestone) => groups.set(milestone.id, { name: milestone.name, stages: new Map() }));
  stages.forEach((stage) => {
    const current = groups.get(stage.milestoneId) || { name: stage.milestoneName || "Chưa gán milestone", stages: new Map<string, ProjectTaskSummary[]>() };
    current.stages.set(stage.id, []);
    groups.set(stage.milestoneId, current);
  });
  tasks.forEach((task) => {
    const stage = task.stageId ? stageMap.get(task.stageId) : undefined;
    const milestoneId = stage?.milestoneId || task.milestoneId || "unassigned";
    const current = groups.get(milestoneId) || { name: stage?.milestoneName || task.milestoneName || milestoneMap.get(milestoneId)?.name || "Chưa gán milestone", stages: new Map<string, ProjectTaskSummary[]>() };
    const stageId = task.stageId || "unassigned-stage";
    current.stages.set(stageId, [...(current.stages.get(stageId) || []), task]);
    groups.set(milestoneId, current);
  });

  const subtasks = tasks.flatMap((task) => task.subtasks || []);
  const toggle = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleTask = (key: string) => setExpandedTasks((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const statusLabel = (status: string) => {
    const value = status.toLowerCase();
    if (value.includes("done") || value.includes("complete")) return "Hoàn tất";
    if (value.includes("progress") || value.includes("doing")) return "Đang làm";
    if (value.includes("block") || value.includes("risk")) return "Cần xử lý";
    return "Chưa bắt đầu";
  };
  const statusTone = (status: string): "good" | "warn" | "neutral" => statusLabel(status) === "Hoàn tất" ? "good" : statusLabel(status) === "Cần xử lý" ? "warn" : "neutral";
  const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(value)) : "Chưa đặt hạn";
  const variance = (task: ProjectTaskSummary) => task.estimateMinutes > 0 ? task.loggedMinutes - task.estimateMinutes : 0;
  const renderTask = (task: ProjectTaskSummary, level = 0) => {
    const children = task.subtasks || [];
    const taskKey = "t:" + task.id;
    const open = expandedTasks.has(taskKey);
    const delta = variance(task);
    const assigneeName = task.assigneeDisplayName || task.ownerDisplayName;
    const assigneeId = task.assigneeDisplayName ? task.assigneeUserId : task.ownerUserId;
    return <div key={task.id} className="border-t border-border/60 first:border-t-0">
      <div className={(level ? "bg-slate-50/70" : "bg-background") + " flex items-center gap-3 px-4 py-3 " + (level ? "pl-14" : "pl-16")}>
        {children.length ? <button type="button" aria-label={open ? "Thu gọn subtask" : "Mở subtask"} onClick={() => toggleTask(taskKey)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"><span className="sr-only">{open ? "Thu gọn" : "Mở"}</span>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="w-5 shrink-0" />}
        <span className={(level ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700") + " rounded px-1.5 py-1 text-[10px] font-bold"}>{level ? "ST" : "T"}</span>
        <div className="min-w-0 flex-1"><Link href={"/tasks/" + encodeURIComponent(task.id)} className="block truncate text-sm font-medium hover:text-primary">{task.title}</Link><span className="mt-1 block truncate text-[11px] text-muted-foreground">{assigneeName && assigneeId ? <PersonLink userId={assigneeId} className="hover:text-primary">{assigneeName}</PersonLink> : assigneeName || "Chưa phân công"} · Hạn {dateLabel(task.dueAt)}</span></div>
        <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
        <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block"><span className="block font-mono tabular-nums">{formatHours(task.loggedMinutes)} / {formatHours(task.estimateMinutes)}</span><span className={delta > 0 ? "text-amber-700" : "text-muted-foreground"}>{delta > 0 ? "+" : ""}{formatHours(delta)} lệch</span></span>
      </div>
      {open ? <div className="border-l-2 border-violet-100">{children.map((child) => renderTask(child, level + 1))}</div> : null}
    </div>;
  };

  return <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <div className="border-b border-border px-5 py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Delivery scope</p><h2 className="mt-1 text-xl font-bold">Phạm vi triển khai</h2><p className="mt-1 text-sm text-muted-foreground">Theo dõi đầy đủ cây Milestone → Stage → Task → Subtask.</p></div><Badge>{groups.size + " milestone · " + new Set([...groups.values()].flatMap((group) => [...group.stages.keys()])).size + " stage · " + tasks.length + " task · " + subtasks.length + " subtask"}</Badge></div></div>
    {groups.size === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Project chưa có task trong phạm vi này.</div> : <div className="divide-y divide-border/70">{[...groups.entries()].map(([milestoneId, group]) => { const mKey = "m:" + milestoneId; const mClosed = collapsed.has(mKey); const milestoneTasks = [...group.stages.values()].flat(); return <div key={milestoneId}><button type="button" onClick={() => toggle(mKey)} className="flex w-full items-center justify-between bg-muted/25 px-5 py-3 text-left hover:bg-muted/40"><span className="flex min-w-0 items-center gap-3"><span className="rounded bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">M</span><span className="min-w-0"><span className="block truncate font-semibold">{group.name}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{group.stages.size} stage · {milestoneTasks.length} task</span></span></span><span className="flex items-center gap-2 text-xs text-muted-foreground">{mClosed ? "Mở nhánh" : "Thu gọn"}{mClosed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></button>{!mClosed ? <div>{[...group.stages.entries()].map(([stageId, stageTasks]) => { const stage = stageMap.get(stageId); const sKey = mKey + ":s:" + stageId; const sClosed = collapsed.has(sKey); return <div key={stageId} className="border-t border-border/60"><button type="button" onClick={() => toggle(sKey)} className="flex w-full items-center justify-between px-5 py-3 pl-10 text-left hover:bg-muted/30"><span className="flex min-w-0 items-center gap-3"><span className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">S</span><span className="min-w-0"><span className="block truncate font-semibold">{stage?.activity || "Chưa gán stage"}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{stage?.ownerDisplayName || "Chưa phân công"} · {stage?.progressPercent ?? 0}% tiến độ</span></span></span><span className="flex items-center gap-3 text-xs text-muted-foreground">{stageTasks.length} task {sClosed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></button>{!sClosed ? <div>{stageTasks.map((task) => renderTask(task))}</div> : null}</div>; })}</div> : null}</div>; })}</div>}
  </section>;
}

function FinancePanels({ project }: { project: PnlProject }) {
  const cost = project.costAvailable ? project.totalCost : undefined;
  const resultReady = project.pnlResultStatus === "Sẵn sàng";
  const revenueBasisLabel = project.revenueBasis === "custom" ? "Nhập tay theo tháng" : project.revenueBasis === "paid" ? "Đã thanh toán" : project.revenueBasis === "none" ? "Chưa nhập cho kỳ" : "Theo kế hoạch";
  const hasRevenue = project.revenueBasis !== "none";
  const lineItems = [
    { label: "Doanh thu", group: "Doanh thu", value: project.revenue ? formatMoney(project.revenue, project.currency) : "Chưa có dữ liệu", status: project.revenue ? revenueBasisLabel : "Thiếu dữ liệu" },
    ...project.expenses.map((expense) => ({ label: expense.label, group: "Chi phí", value: expense.amount ? formatMoney(expense.amount, project.currency) : "Chưa cung cấp", status: expense.status || "Chưa cung cấp" })),
    { label: "Tổng chi phí", group: "Kết quả", value: cost === undefined ? "Chưa có dữ liệu" : formatMoney(cost, project.currency), status: cost === undefined ? "Chưa tính" : resultReady ? "Đủ dữ liệu" : "Tạm tính" },
    { label: "% Chi phí / Doanh thu", group: "Kết quả", value: project.costAvailable ? formatMarginPercent(project.expenseRatioPercent) : "—", status: hasRevenue && project.costAvailable ? resultReady ? "Đủ dữ liệu" : "Tạm tính" : "Chưa tính" },
    { label: "EBIT", group: "Kết quả", value: !hasRevenue ? "Chưa có doanh thu kỳ" : project.costAvailable ? formatMoney(project.grossMargin, project.currency) : "Chưa đủ dữ liệu", status: hasRevenue && project.costAvailable ? resultReady ? "Đủ dữ liệu" : "Tạm tính" : "Chưa tính" },
    { label: "Biên EBIT", group: "Kết quả", value: project.revenue && project.costAvailable ? formatMarginPercent(project.grossMarginPercent) : "—", status: project.revenue && project.costAvailable ? resultReady ? "Đủ dữ liệu" : "Tạm tính" : "Chưa tính" }
  ];
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="border-b border-border px-5 py-4"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">P&L theo khoản mục</p><h2 className="mt-1 text-lg font-bold">Cây khoản mục của project</h2><p className="mt-1 text-xs text-muted-foreground">Doanh thu: {revenueBasisLabel} · Phạm vi: {project.revenueScope}. Ô “Chưa cung cấp” không được hiểu là bằng 0.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-muted/25 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Khoản mục</th><th className="px-3 py-3">Nhóm</th><th className="px-3 py-3 text-right">Giá trị</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-border/70">{lineItems.map((item) => <tr key={item.label} className="hover:bg-muted/20"><td className="px-5 py-3 font-semibold">{item.label}</td><td className="px-3 py-3 text-xs text-muted-foreground">{item.group}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{item.value}</td><td className="px-5 py-3"><Badge tone={item.status === "Đủ dữ liệu" || item.status === "Nhập tay theo tháng" || item.status === "Đã thanh toán" || item.status === "Theo kế hoạch" ? "good" : "warn"}>{item.status}</Badge></td></tr>)}</tbody></table></div></section>
  </div>;
}

function Detail({ project, projects, meta, period, startDate, endDate, onPeriodChange, onRangeChange, tasks, stages, milestones, workLoading, workError, onRevenueSaved }: { project: PnlProject; projects: PnlProject[]; meta: PlMeta; period: string; startDate: string; endDate: string; onPeriodChange: (value: string) => void; onRangeChange: (range: Range) => void; tasks: ProjectTaskSummary[]; stages: ProjectStageSummary[]; milestones: ProjectMilestoneSummary[]; workLoading: boolean; workError?: string | null; onRevenueSaved?: (amount: number) => void }) {
  const cost = project.costAvailable ? project.totalCost : undefined;
  const margin = project.revenue && project.costAvailable ? formatMarginPercent(project.grossMarginPercent) : "—";
  const action = actionFor(project);
  const backQuery = startDate && endDate ? "startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate) : "scope=all";
  const excludedMinutes = Math.max(project.logworkMinutes - project.pnlMinutes - project.pendingMinutes, 0);
  // Figures are entered per month, so the statement is editable only when the range is exactly one month.
  const monthKey = period && startDate === monthDateRange(period).startDate && endDate === monthDateRange(period).endDate ? period : null;
  const requestedTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(DETAIL_TABS.find((item) => item.id === requestedTab)?.id ?? "overview");
  const selectTab = (next: Tab) => {
    setTab(next);
    if (Boolean(startDate) !== Boolean(endDate) || (startDate && endDate && startDate > endDate)) return;
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab"); else url.searchParams.set("tab", next);
    // Next re-emits search params after replaceState and PnlControlCenter re-reads the range from them, so carry the range on screen to keep the filter when switching tabs.
    if (startDate && endDate && startDate <= endDate) { url.searchParams.set("startDate", startDate); url.searchParams.set("endDate", endDate); url.searchParams.delete("scope"); url.searchParams.delete("period"); }
    else if (!startDate && !endDate) { url.searchParams.delete("startDate"); url.searchParams.delete("endDate"); url.searchParams.delete("period"); }
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  };
  return <div className="space-y-5"><header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div className="min-w-0"><Link href={"/pnl?" + backQuery} className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại tổng quan</Link><div className="mt-3 flex flex-wrap items-center gap-2"><h1 className="!text-xl min-w-0 truncate font-bold text-foreground">{project.name}</h1><span title={action} className={"rounded-full border px-2.5 py-1 text-[11px] font-semibold " + statusClass(project.status)}>{project.status}</span></div><p className="mt-0.5 text-sm text-muted-foreground">{project.code} · {project.client} · {rangeLabel(startDate, endDate)}</p></div><div className="flex flex-wrap items-end gap-2"><Filters period={period} startDate={startDate} endDate={endDate} projects={projects} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} /><Link href={"/projects/" + encodeURIComponent(project.id)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted">Mở project <ArrowUpRight className="h-4 w-4" /></Link></div></header>
    <PlNotices meta={meta} />
    {project.dataSource === "project" ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Kỳ này chưa có time entry riêng. Giờ đang lấy từ tổng hợp project; khi có log trong kỳ, hệ thống sẽ tự chuyển sang dữ liệu theo kỳ.</p> : null}
    {project.locked ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Kỳ này đã chốt: doanh thu, chi phí và EBIT là số đã khóa tại thời điểm chốt, không đổi khi dữ liệu thay đổi sau đó. Giờ, chi phí theo người và danh sách khoản chi là dữ liệu hiện tại nên có thể khác số đã chốt.</p> : null}
    <div className="overflow-x-auto"><WorkspaceTabBar items={DETAIL_TABS} value={tab} onChange={selectTab} ariaLabel="Project P&L" idPrefix="pnl-detail" onKeyDown={(event, value) => { const item = DETAIL_TABS[DETAIL_TABS.findIndex((entry) => entry.id === value) + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : NaN)]; if (!item) return; event.preventDefault(); selectTab(item.id); document.getElementById("pnl-detail-tab-" + item.id)?.focus(); }} /></div>
    <div role="tabpanel" aria-labelledby={"pnl-detail-tab-" + tab} className="space-y-4">
      {tab === "overview" ? <><PnlStatement project={project} periodKey={monthKey} scopeLabel={startDate && endDate ? rangeLabel(startDate, endDate) : "cả dự án"} partialRange={Boolean(startDate && endDate) && !monthKey} canEditInputs={Boolean(meta.canEdit)} onChanged={() => onRevenueSaved?.(project.revenue)} onPickMonth={onPeriodChange} /><FinancePanels project={project} /></> : null}
      {tab === "logwork" ? <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><Metric label="Plan hour" value={formatHours(project.planMinutes)} note={"= " + new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(project.planMinutes / 480) + " manday (8h/manday)"} /><Metric label="Logwork" value={formatHours(project.logworkMinutes)} /><Metric label="Giờ đã duyệt" value={formatHours(project.pnlMinutes)} tone="blue" /><Metric label="Chờ xử lý" value={formatHours(project.pendingMinutes)} tone="amber" /><Metric label="Lệch kế hoạch" value={formatHours(project.logworkMinutes - project.planMinutes)} tone={project.logworkMinutes > project.planMinutes ? "amber" : "plain"} /><Metric label="Bị loại" value={formatHours(excludedMinutes)} /></div><p className="text-xs text-muted-foreground">Tổng kiểm tra: {formatHours(project.pnlMinutes)} + {formatHours(project.pendingMinutes)} + {formatHours(excludedMinutes)} = {formatHours(project.logworkMinutes)}.</p><PeopleTable project={project} /><DailyTable daily={project.daily} /></> : null}
      {tab === "delivery" ? <DeliveryTree tasks={tasks} stages={stages} milestones={milestones} loading={workLoading} error={workError} /> : null}
    </div>
  </div>;
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
  // Days are days of the reporting timezone (Asia/Ho_Chi_Minh, UTC+7), the same boundaries the API uses.
  // These entries only feed logwork (logged / pending / rejected); approved hours come from the API.
  const cursor = new Date(from + "T00:00:00+07:00");
  const last = new Date(to + "T00:00:00+07:00");
  const entries = new Map<string, TaskTimeEntrySummary>();
  while (cursor <= last) { const chunkEnd = new Date(cursor); chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 89); const inclusiveEnd = new Date(Math.min(chunkEnd.getTime(), last.getTime())); inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() + 1); const chunk = await fetchPaged<TaskTimeEntrySummary>("/api/tasks/time-entries?limit=100&offset=0&startAt=" + encodeURIComponent(cursor.toISOString()) + "&endAt=" + encodeURIComponent(inclusiveEnd.toISOString())); chunk.forEach((entry) => entries.set(entry.id, entry)); cursor.setTime(inclusiveEnd.getTime()); }
  return [...entries.values()];
}

async function fetchPnl(startDate: string, endDate: string) {
  const projects = await fetchPaged<ProjectSummary>("/api/projects?limit=100&offset=0");
  const query = startDate && endDate ? "?startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate) : "";
  const [summaryResponse, entries] = await Promise.all([fetch("/api/project-controls/pl-summary" + query, { cache: "no-store", credentials: "same-origin" }), fetchEntries(projects, startDate, endDate)]);
  if (summaryResponse.status === 403) throw new Error("Bạn chưa được cấp quyền chi phí nên không xem được P&L. Liên hệ Admin để được cấp quyền.");
  if (!summaryResponse.ok) throw new Error("Không tải được dữ liệu P&L.");
  const payload = await summaryResponse.json() as { data: ProjectPlSummaryItem[]; meta?: PlMeta };
  return { projects: adaptLivePnlProjects(payload.data, projects, entries, startDate ? startDate.slice(0, 7) : undefined, startDate && endDate ? { startDate, endDate } : undefined), meta: payload.meta ?? {} };
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
  const [plMeta, setPlMeta] = useState<PlMeta>({});
  const [tasks, setTasks] = useState<ProjectTaskSummary[]>([]);
  const [stages, setStages] = useState<ProjectStageSummary[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { const requestedPeriod = searchParams.get("period"); const requestedStart = searchParams.get("startDate"); const requestedEnd = searchParams.get("endDate"); if (requestedStart && requestedEnd && requestedStart <= requestedEnd) { setStartDate(requestedStart); setEndDate(requestedEnd); setPeriod(requestedStart.slice(0, 7)); } else if (requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod)) { const range = monthRange(requestedPeriod); setPeriod(requestedPeriod); setStartDate(range.startDate); setEndDate(range.endDate); } else if (searchParams.get("scope") === "all") { setPeriod(""); setStartDate(""); setEndDate(""); } }, [searchParams]);
  useEffect(() => { let cancelled = false; setLoading(true); setError(null); fetchPnl(startDate, endDate).then((data) => { if (!cancelled) { setProjects(data.projects); setPlMeta(data.meta); } }).catch((reason: unknown) => { if (!cancelled) { setProjects([]); setPlMeta({}); setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu P&L."); } }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [startDate, endDate, reloadKey]);
  useEffect(() => { if (!projectId) { setTasks([]); setStages([]); setMilestones([]); return; } let cancelled = false; setWorkLoading(true); setWorkError(null); fetchWork(decodeURIComponent(projectId)).then((data) => { if (!cancelled) { setTasks(data.tasks); setStages(data.stages); setMilestones(data.milestones); } }).catch((reason: unknown) => { if (!cancelled) { setTasks([]); setStages([]); setMilestones([]); setWorkError(reason instanceof Error ? reason.message : "Không tải được delivery."); } }).finally(() => { if (!cancelled) setWorkLoading(false); }); return () => { cancelled = true; }; }, [projectId]);
  const selected = projectId ? projects.find((project) => project.id === decodeURIComponent(projectId)) : undefined;
  const onPeriodChange = (value: string) => { if (value === "all") { setPeriod(""); setStartDate(""); setEndDate(""); return; } const range = monthRange(value); setPeriod(value); setStartDate(range.startDate); setEndDate(range.endDate); };
  const onRangeChange = (range: Range) => { setStartDate(range.startDate); setEndDate(range.endDate); setPeriod(/^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate) && range.startDate <= range.endDate ? range.startDate.slice(0, 7) : ""); };
  // Revenue, cost and EBIT are computed by the API: reload instead of patching figures locally.
  const updateRevenue = (_amount: number) => setReloadKey((value) => value + 1);
  return <AppShell activeRoute="/pnl" shellTestId="pnl-shell" desktopSidebarTestId="pnl-desktop-sidebar" mobileHeaderTestId="pnl-mobile-shell" title="P&L"><main data-testid="pnl-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background p-4 sm:p-6">{error ? <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}{loading && !projects.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div> : projectId && !selected ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900"><h1 className="!text-xl font-bold">Không tìm thấy project</h1><p className="mt-1">Project không nằm trong phạm vi dữ liệu hiện tại.</p><Link href="/pnl?scope=all" className="mt-4 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Quay lại portfolio</Link></div> : selected ? <Detail project={selected} projects={projects} meta={plMeta} period={period} startDate={startDate} endDate={endDate} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} tasks={tasks} stages={stages} milestones={milestones} workLoading={workLoading} workError={workError} onRevenueSaved={updateRevenue} /> : <Overview projects={projects} meta={plMeta} period={period} startDate={startDate} endDate={endDate} onPeriodChange={onPeriodChange} onRangeChange={onRangeChange} />}</main></AppShell>;
}
