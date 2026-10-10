"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, ArrowUpRight, ChevronRight, Clock3, Download, Plus, Receipt, Search, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { FilterBar, FilterField } from "@/components/filters/filter-controls";
import { formatHours, type PnlProject, type PnlProjectStatus } from "./pnl-data";
import { moneyFormat } from "./pnl-cost-shared";
import { exportPnlWorkbook } from "./pnl-export";

const STATUS: Array<"all" | PnlProjectStatus> = ["all", "Chờ xử lý", "Đã đối soát", "Thiếu dữ liệu"];
const NO_ACTION = "Không cần xử lý";
const percentFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** The one thing a finance user should do next for a project, in priority order. */
export function actionFor(project: PnlProject) {
  if (project.revenueBasis === "none" || (project.revenueBasis !== "custom" && project.plannedRevenue <= 0)) return "Bổ sung doanh thu";
  if (project.missingRateMinutes > 0) return "Nhập cost rate";
  if (project.pendingMinutes > 0) return "Duyệt hoặc phân loại giờ";
  if (project.logworkMinutes > project.planMinutes) return "Rà soát vượt kế hoạch";
  if (project.status === "Thiếu dữ liệu") return "Bổ sung baseline";
  return NO_ACTION;
}

function statusClass(status: PnlProjectStatus) {
  if (status === "Đã đối soát") return "bg-emerald-50 text-emerald-700";
  if (status === "Thiếu dữ liệu") return "bg-muted text-muted-foreground";
  return "bg-amber-50 text-amber-800";
}

const hasEbit = (project: PnlProject) => project.costAvailable && project.revenueBasis !== "none";

/** Same card as the KPI row on the Projects page: label, tinted icon chip, mono value. */
function TileHead({ label, icon: Icon, color }: Readonly<{ label: string; icon: LucideIcon; color: string }>) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}15` }}><Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden /></div>
    </div>
  );
}

function Tile({ label, icon, color, value, note, warning }: Readonly<{ label: string; icon: LucideIcon; color: string; value: string; note?: ReactNode; warning?: boolean }>) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <TileHead label={label} icon={icon} color={color} />
      <p className="truncate font-mono text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {note ? <p className={`mt-1 truncate text-xs ${warning ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>{note}</p> : null}
    </div>
  );
}

/**
 * P&L of every project in the viewed range: money first (revenue, cost, EBIT),
 * hours as supporting figures, and one next action per project. All figures are
 * the API's; totals here are plain sums of the rows shown.
 */
export function PnlOverview({ projects, rangeText, exportPeriod, detailQuery, costsHref, filters, notices }: Readonly<{
  projects: PnlProject[];
  rangeText: string;
  exportPeriod: string;
  detailQuery: string;
  costsHref: string;
  filters: ReactNode;
  notices?: ReactNode;
}>) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [onlyActions, setOnlyActions] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return projects.filter((project) =>
      (!needle || `${project.name} ${project.code} ${project.client} ${project.ownerDisplayName ?? ""}`.toLocaleLowerCase("vi").includes(needle))
      && (status === "all" || project.status === status)
      && (!onlyActions || actionFor(project) !== NO_ACTION));
  }, [onlyActions, projects, query, status]);

  const totals = useMemo(() => {
    const withEbit = rows.filter(hasEbit);
    const revenue = rows.reduce((sum, project) => sum + project.revenue, 0);
    const ebitRevenue = withEbit.reduce((sum, project) => sum + project.revenue, 0);
    const ebit = withEbit.reduce((sum, project) => sum + project.grossMargin, 0);
    return {
      revenue,
      revenueCount: rows.filter((project) => project.revenue > 0).length,
      cost: rows.reduce((sum, project) => sum + project.totalCost, 0),
      missingRate: rows.filter((project) => !project.costAvailable).length,
      ebit,
      ebitCount: withEbit.length,
      margin: ebitRevenue > 0 ? (ebit / ebitRevenue) * 100 : undefined,
      approved: rows.reduce((sum, project) => sum + project.pnlMinutes, 0),
      plan: rows.reduce((sum, project) => sum + project.planMinutes, 0),
      actions: rows.filter((project) => actionFor(project) !== NO_ACTION).length
    };
  }, [rows]);
  const currency = projects[0]?.currency || "VND";
  const money = (value: number) => moneyFormat.format(value);
  const filtered = Boolean(query) || status !== "all" || onlyActions;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="!text-xl font-bold text-foreground">Project P&amp;L</h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">Doanh thu, chi phí và EBIT theo dự án · {rangeText}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters}
          <button type="button" onClick={() => void exportPnlWorkbook({ projects: rows, period: exportPeriod })} className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            <Download className="h-4 w-4" aria-hidden /> Xuất Excel
          </button>
          <Link href={costsHref} className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold !text-white shadow-sm outline-none transition hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.97]">
            <Plus className="h-4 w-4" aria-hidden /> Nhập chi phí
          </Link>
        </div>
      </header>

      {notices}

      <section aria-label="Tóm tắt P&L" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Tile icon={Wallet} color="#2563eb" label={`Doanh thu (${currency})`} value={totals.revenue ? money(totals.revenue) : "—"} note={`${totals.revenueCount}/${rows.length} dự án có doanh thu`} />
        <Tile icon={Receipt} color="#7c3aed" label={`Chi phí (${currency})`} value={money(totals.cost)} warning={totals.missingRate > 0} note={totals.missingRate > 0 ? `Chưa đủ: ${totals.missingRate} dự án thiếu cost rate` : "Nhân sự + chi phí khác"} />
        <Tile icon={TrendingUp} color="#16a34a" label={`EBIT (${currency})`} value={totals.ebitCount ? money(totals.ebit) : "—"}
          note={totals.ebitCount ? `Biên ${totals.margin === undefined ? "—" : `${percentFormat.format(totals.margin)}%`} · tính trên ${totals.ebitCount}/${rows.length} dự án đủ số` : "Chưa dự án nào đủ doanh thu và chi phí"} />
        <Tile icon={Clock3} color="#0891b2" label="Giờ đã duyệt" value={formatHours(totals.approved)} note={`Kế hoạch ${formatHours(totals.plan)}`} />
        <button type="button" aria-pressed={onlyActions} onClick={() => setOnlyActions((value) => !value)}
          className={`min-w-0 rounded-xl border p-4 text-left shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 ${onlyActions ? "border-amber-300 bg-amber-50" : "border-border bg-card hover:border-primary/40"}`}>
          <TileHead label="Cần xử lý" icon={AlertCircle} color="#dc2626" />
          <p className="truncate font-mono text-2xl font-bold tabular-nums text-foreground">{totals.actions}</p>
          <p className="mt-1 truncate text-xs font-semibold text-primary">{onlyActions ? "Đang lọc · bấm để bỏ lọc" : "Bấm để chỉ xem các dự án này"}</p>
        </button>
      </section>

      <section aria-labelledby="pnl-list-title" className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center">
          <h2 id="pnl-list-title" className="!text-sm shrink-0 font-bold text-foreground">Dự án <span className="font-normal text-muted-foreground">({rows.length})</span></h2>
          <FilterBar className="min-w-0 flex-1 lg:justify-end" onReset={filtered ? () => { setQuery(""); setStatus("all"); setOnlyActions(false); } : undefined}>
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Tìm dự án</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm dự án, khách hàng, phụ trách" className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary" />
            </label>
            <FilterField className="w-full sm:w-48">
              <CrmSelect ariaLabel="Lọc trạng thái dữ liệu" value={status} onChange={setStatus} options={STATUS.map((value) => ({ value, label: value === "all" ? "Tất cả trạng thái" : value }))} />
            </FilterField>
          </FilterBar>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
            <colgroup><col /><col className="w-[116px]" /><col className="w-[120px]" /><col className="w-[120px]" /><col className="w-[124px]" /><col className="w-[140px]" /><col className="w-[184px]" /></colgroup>
            <thead className="bg-card text-[10px] font-bold uppercase tracking-wider text-muted-foreground [&_th]:border-b [&_th]:border-border [&_th]:py-3">
              <tr>
                <th scope="col" className="px-4">Dự án</th>
                <th scope="col" className="px-3">Dữ liệu</th>
                <th scope="col" className="px-3 text-right">Doanh thu</th>
                <th scope="col" className="px-3 text-right" title="Chi phí nhân sự (giờ đã duyệt × cost rate) + chi phí khác. Đánh dấu “thiếu” khi còn giờ chưa có cost rate.">Chi phí</th>
                <th scope="col" className="px-3 text-right">EBIT</th>
                <th scope="col" className="px-3 text-right" title="Giờ đã duyệt so với giờ kế hoạch">Giờ duyệt / KH</th>
                <th scope="col" className="px-4">Việc cần làm</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-b [&_td]:border-border/70 [&_td]:py-4">
              {rows.map((project) => {
                const action = actionFor(project);
                const detailHref = `/pnl/${encodeURIComponent(project.id)}?${detailQuery}`;
                const over = project.logworkMinutes > project.planMinutes && project.planMinutes > 0;
                return (
                  <tr key={project.id} className="group transition-colors hover:bg-muted/30">
                    <td className="px-4">
                      <div className="flex min-w-0 items-center gap-1">
                        <Link href={detailHref} title={`${project.name} · ${project.code}`} className="min-w-0 truncate font-semibold text-foreground outline-none hover:text-primary focus-visible:underline">{project.name}</Link>
                        <Link href={`/projects/${encodeURIComponent(project.id)}`} aria-label={`Mở trang dự án ${project.name}`} title="Mở trang dự án" className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"><ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{project.client} · {project.ownerDisplayName || "Chưa phân công"}</p>
                    </td>
                    <td className="px-3"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass(project.status)}`}>{project.status}</span></td>
                    <td className="whitespace-nowrap px-3 text-right font-mono tabular-nums">{project.revenueBasis !== "none" && project.revenue ? money(project.revenue) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-3 text-right font-mono tabular-nums">
                      {project.costAvailable || project.totalCost > 0 ? money(project.totalCost) : null}
                      {project.costAvailable ? null : <span className="flex items-center justify-end gap-1 font-sans text-[11px] font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" aria-hidden /> thiếu cost rate</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 text-right font-mono tabular-nums">
                      {hasEbit(project) ? (
                        <>
                          <span className={`font-semibold ${project.grossMargin < 0 ? "text-rose-700" : "text-foreground"}`}>{money(project.grossMargin)}</span>
                          <span className="mt-0.5 block font-sans text-[11px] text-muted-foreground">{project.grossMarginPercent === undefined ? "—" : `Biên ${percentFormat.format(project.grossMarginPercent)}%`}</span>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 text-right font-mono tabular-nums">
                      <span className="font-semibold text-foreground">{formatHours(project.pnlMinutes)}</span><span className="text-muted-foreground"> / {formatHours(project.planMinutes)}</span>
                      {over ? <span className="mt-0.5 block font-sans text-[11px] font-semibold text-rose-700">Logwork vượt {formatHours(project.logworkMinutes - project.planMinutes)}</span> : null}
                    </td>
                    <td className="px-4">
                      {action === NO_ACTION ? <span className="text-xs text-muted-foreground">—</span> : (
                        <Link href={action === "Nhập cost rate" ? costsHref : detailHref} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100">
                          <span className="truncate">{action}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 ? (
              <tfoot className="bg-muted/20 text-sm font-bold">
                <tr>
                  <td className="px-4 py-3" colSpan={2}>Tổng {rows.length} dự án</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{money(totals.revenue)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{money(totals.cost)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{totals.ebitCount ? money(totals.ebit) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{formatHours(totals.approved)} / {formatHours(totals.plan)}</td>
                  <td className="px-4 py-3 text-xs font-normal text-muted-foreground">{totals.ebitCount < rows.length ? `EBIT tính trên ${totals.ebitCount} dự án đủ số` : ""}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {rows.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">Không có dự án phù hợp với bộ lọc.</p> : null}
        <p className="rounded-b-xl border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">Số tiền theo {currency}. Bấm tên dự án để xem và nhập số liệu P&amp;L của dự án đó.</p>
      </section>
    </div>
  );
}
