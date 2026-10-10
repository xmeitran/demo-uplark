"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, CircleAlert, LockKeyhole, Save, Settings2 } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { FormulaItemsEditor, ParametersEditor, type CalcItem, type CalcParameter } from "./pnl-calculator-setup";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { MonthFilter } from "@/components/filters/filter-controls";

type ConfigTab = "items" | "parameters" | "pool" | "period";
type PoolCriteria = "Theo giờ tính P&L" | "Theo doanh thu" | "Theo số nhân sự" | "Chia đều" | "Nhập tay từng dự án";

function currentPnlPeriodKey() {
  const requestedPeriod = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("periodKey") : null;
  if (requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod)) return requestedPeriod;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function periodLabel(periodKey: string) {
  const [year, month] = periodKey.split("-");
  return `${month}/${year}`;
}

function periodEnd(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

// The system only calculates: every number and formula on this screen is entered by the user.
const TABS: Array<{ id: ConfigTab; label: string; description: string }> = [
  { id: "parameters", label: "1. Tham số", description: "Số bạn tự nhập cho tháng" },
  { id: "items", label: "2. Khoản tính theo công thức", description: "Chi phí tính từ tham số" },
  { id: "pool", label: "3. Quỹ dùng chung", description: "Chi phí chung chia cho project" },
  { id: "period", label: "4. Chốt kỳ", description: "Khóa số của tháng" }
];

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "slate" | "rose" }) {
  const colors = { blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-600", rose: "bg-rose-50 text-rose-700" };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${colors[tone]}`}>{children}</span>;
}

type PoolShare = { projectId: string; projectName: string; amount: number };

function PoolTab({ total, periodKey, criteria, shares, disabled, setTotal, setCriteria }: { total: number; periodKey: string; criteria: PoolCriteria; shares: PoolShare[]; disabled: boolean; setTotal: (value: number) => void; setCriteria: (value: PoolCriteria) => void }) {
  const money = new Intl.NumberFormat("vi-VN");
  const allocated = shares.reduce((sum, share) => sum + share.amount, 0);
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><section className="rounded-xl border border-border bg-card p-4"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">{periodLabel(periodKey)}</p><h2 className="mt-1 !text-lg font-bold">Quỹ chi phí dùng chung</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Chi phí không thuộc riêng project nào (ví dụ công cụ AI, phần mềm dùng chung). Hệ thống chia tổng quỹ của tháng cho các project có giờ đã duyệt trong tháng và cộng vào chi phí của từng project.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-muted-foreground" htmlFor="pool-total">Tổng quỹ của tháng (₫)<input id="pool-total" inputMode="numeric" autoComplete="off" disabled={disabled} value={total ? money.format(total) : ""} placeholder="0" onChange={(event) => setTotal(Number(event.target.value.replace(/[^\d]/g, "")) || 0)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-right font-mono text-sm disabled:opacity-60" /></label><div><span className="text-xs font-semibold text-muted-foreground">Chia theo</span><CrmSelect className="mt-1" disabled={disabled} options={[{ value: "Theo giờ tính P&L", label: "Giờ đã duyệt của project" }, { value: "Theo doanh thu", label: "Doanh thu kế hoạch" }, { value: "Theo số nhân sự", label: "Số nhân sự có giờ" }, { value: "Chia đều", label: "Chia đều" }, { value: "Nhập tay từng dự án", label: "Không tự chia" }]} value={criteria} onChange={(value) => setCriteria(value as PoolCriteria)} /></div></div><p className="mt-4 text-xs text-muted-foreground">{criteria === "Nhập tay từng dự án" ? "Quỹ sẽ không được cộng vào project nào. Nhập từng khoản ở Nhập chi phí → Chi phí khác nếu muốn tự chia." : "Bấm Lưu thiết lập để áp dụng; bảng bên cạnh cho thấy kết quả theo số đã lưu."}</p></section><section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 className="!text-sm font-bold">Phân bổ đang áp dụng</h2><Badge tone={allocated > 0 ? "green" : "slate"}>{allocated > 0 ? money.format(allocated) + " ₫" : "Chưa phân bổ"}</Badge></div>{shares.length ? <div className="max-h-80 overflow-y-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Project</th><th className="px-4 py-3 text-right">Được chia</th></tr></thead><tbody className="divide-y divide-border/70">{shares.map((share) => <tr key={share.projectId}><td className="px-4 py-3"><Link href={"/pnl/" + encodeURIComponent(share.projectId) + "?period=" + periodKey} className="font-semibold hover:text-primary">{share.projectName}</Link></td><td className="px-4 py-3 text-right font-mono font-semibold">{money.format(share.amount)} ₫</td></tr>)}</tbody></table></div> : disabled ? <p className="px-4 py-6 text-sm text-muted-foreground">Tháng đã chốt: phần quỹ của từng project đã nằm trong số “Chi phí khác đã chốt” và không tách lại được. Mở lại kỳ để xem phân bổ theo dữ liệu hiện tại.</p> : <p className="px-4 py-6 text-sm text-muted-foreground">Chưa có project nào được chia quỹ trong {"tháng " + periodLabel(periodKey)}. Quỹ chỉ được chia khi đã lưu tổng quỹ lớn hơn 0 và có project có giờ đã duyệt trong tháng.</p>}</section></div>;
}

function PnlConfigPage() {
  const [periodKey, setPeriodKey] = useState(currentPnlPeriodKey);
  const [tab, setTab] = useState<ConfigTab>("parameters");
  const [parameters, setParameters] = useState<CalcParameter[]>([]);
  const [calcItems, setCalcItems] = useState<CalcItem[]>([]);
  // Items saved by the earlier item-tree screen: kept untouched in the saved setup, never calculated.
  const [legacyItems, setLegacyItems] = useState<unknown[]>([]);
  const [results, setResults] = useState<Record<string, number>>({});
  const [formulaErrors, setFormulaErrors] = useState<string[]>([]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [shares, setShares] = useState<PoolShare[]>([]);
  const [missingRateMinutes, setMissingRateMinutes] = useState(0);
  const [missingRevenueCount, setMissingRevenueCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [reopenReason, setReopenReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [poolCriteria, setPoolCriteria] = useState<PoolCriteria>("Theo giờ tính P&L");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [periodStatus, setPeriodStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSaveError(null);
    Promise.all([
      fetch(`/api/pnl-configurations?periodKey=${encodeURIComponent(periodKey)}`, { cache: "no-store" }),
      fetch(`/api/pnl-periods?periodKey=${encodeURIComponent(periodKey)}`, { cache: "no-store" })
    ]).then(async ([configurationResponse, periodResponse]) => {
      const configurationPayload = await configurationResponse.json().catch(() => null);
      const periodPayload = await periodResponse.json().catch(() => null);
      if (!configurationResponse.ok) throw new Error(configurationPayload?.message ?? "Không tải được cấu hình P&L.");
      if (!periodResponse.ok) throw new Error(periodPayload?.message ?? "Không tải được trạng thái kỳ P&L.");
      if (!active) return;
      const data = configurationPayload?.data;
      applySetup(data);
      if (data) {
        setPoolTotal(data.pool && typeof data.pool.total === "number" && data.pool.total > 0 ? data.pool.total : 0);
        if (data.pool && typeof data.pool.criteria === "string") setPoolCriteria(data.pool.criteria as PoolCriteria);
      }
      else setPoolTotal(0);
      const period = periodPayload?.data;
      setPeriodId(period?.id ?? null);
      setPeriodStatus(period?.status ?? null);
    }).catch((error) => {
      if (active) setSaveError(error instanceof Error ? error.message : "Không tải được cấu hình P&L.");
    });
    return () => { active = false; };
  }, [periodKey, reloadKey]);
  // What the saved settings produce for the month: the pool shares and any hours still missing a cost rate.
  useEffect(() => {
    let active = true;
    fetch(`/api/project-controls/pl-summary?period=${encodeURIComponent(periodKey)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { data?: Array<{ projectId: string; projectName: string; sharedCostAmount?: number; missingRateMinutes?: number; revenueBasis?: string; totalCostAmount?: number; calculatedItems?: Array<{ code: string; amount: number }> }>; meta?: { formulaErrors?: string[] } } : { data: [] })
      .then((payload) => { if (!active) return; const rows = payload.data ?? []; const totals: Record<string, number> = {}; for (const row of rows) for (const item of row.calculatedItems ?? []) totals[item.code] = (totals[item.code] ?? 0) + item.amount; setResults(totals); setFormulaErrors(payload.meta?.formulaErrors ?? []); setShares(rows.filter((row) => (row.sharedCostAmount ?? 0) > 0).map((row) => ({ projectId: row.projectId, projectName: row.projectName, amount: row.sharedCostAmount ?? 0 })).sort((left, right) => right.amount - left.amount)); setMissingRateMinutes(rows.reduce((sum, row) => sum + (row.missingRateMinutes ?? 0), 0)); setMissingRevenueCount(rows.filter((row) => row.revenueBasis === "none" && (row.totalCostAmount ?? 0) > 0).length); })
      .catch(() => { if (active) { setShares([]); setMissingRateMinutes(0); setMissingRevenueCount(0); setResults({}); setFormulaErrors([]); } });
    return () => { active = false; };
  }, [periodKey, reloadKey]);
  function applySetup(data: { items?: unknown; parameters?: unknown } | null | undefined) {
    const savedItems = Array.isArray(data?.items) ? data.items as Array<Record<string, unknown>> : [];
    const isCalcItem = (item: Record<string, unknown>) => typeof item?.formula === "string" && typeof item.category === "string" && typeof item.code === "string";
    setCalcItems(savedItems.filter(isCalcItem).map((item) => ({ code: String(item.code), label: typeof item.label === "string" ? item.label : "", category: item.category as CalcItem["category"], formula: String(item.formula), active: item.active !== false })));
    setLegacyItems(savedItems.filter((item) => !isCalcItem(item)));
    setParameters((Array.isArray(data?.parameters) ? data.parameters as Array<Record<string, unknown>> : []).map((parameter) => ({ code: typeof parameter?.code === "string" ? parameter.code.toUpperCase() : "", label: typeof parameter?.label === "string" ? parameter.label : "", value: typeof parameter?.value === "string" ? parameter.value : parameter?.value === undefined ? "" : String(parameter.value) })));
  }
  const copyPreviousMonth = async () => {
    const [year, month] = periodKey.split("-").map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    setSaveError(null); setNotice(null);
    try {
      const response = await fetch(`/api/pnl-configurations?periodKey=${previous}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Không tải được thiết lập tháng trước.");
      if (!payload?.data) { setSaveError(`Tháng ${periodLabel(previous)} chưa có thiết lập để chép.`); return; }
      applySetup(payload.data);
      if (payload.data.pool && typeof payload.data.pool.total === "number") setPoolTotal(Math.max(0, payload.data.pool.total));
      if (payload.data.pool && typeof payload.data.pool.criteria === "string") setPoolCriteria(payload.data.pool.criteria as PoolCriteria);
      setNotice(`Đã chép tham số, công thức và quỹ từ tháng ${periodLabel(previous)}. Kiểm tra lại rồi bấm Lưu thiết lập để áp dụng.`);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Không tải được thiết lập tháng trước."); }
  };
  const selectedTab = TABS.find((item) => item.id === tab) ?? TABS[0];
  const isLocked = periodStatus === "LOCKED";
  const save = async () => {
    if (periodStatus === "LOCKED") {
      setSaveError("Kỳ P&L đã khóa, không thể sửa cấu hình. Hãy mở lại kỳ trước khi thay đổi.");
      return;
    }
    const unnamed = calcItems.find((item) => !item.label.trim());
    if (unnamed) { setTab("items"); setSaveError("Đặt tên cho mọi khoản tính theo công thức trước khi lưu."); return; }
    setSaving(true); setSaveError(null);
    try {
      const configResponse = await fetch("/api/pnl-configurations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey, items: [...legacyItems, ...calcItems.map((item) => ({ ...item, label: item.label.trim(), source: "Công thức" }))], parameters: parameters.filter((parameter) => parameter.code || parameter.label || parameter.value), pool: { total: poolTotal, allocated: 0, criteria: poolCriteria }, templates: ["Dự án khách hàng", "Dự án nội bộ", "Đào tạo"] }) });
      if (!configResponse.ok) { const payload = await configResponse.json().catch(() => ({})); throw new Error(payload?.message ?? "Không thể lưu cấu hình P&L"); }
      const response = await fetch("/api/pnl-periods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey, periodStart: `${periodKey}-01`, periodEnd: periodEnd(periodKey), currency: "VND" }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message ?? "Không thể lưu kỳ P&L");
      setPeriodId(payload?.data?.id ?? null); setPeriodStatus(payload?.data?.status ?? "OPEN"); setSaved(true); setReloadKey((value) => value + 1); window.setTimeout(() => setSaved(false), 2400);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể lưu kỳ P&L"); }
    finally { setSaving(false); }
  };
  const lockPeriod = async () => {
    if (!window.confirm(`Chốt tháng ${periodLabel(periodKey)}? Sau khi chốt, cost rate, chi phí, doanh thu nhập tay và thiết lập của tháng này bị khóa cho tới khi mở lại kỳ.`)) return;
    setSaving(true); setSaveError(null); setNotice(null);
    try {
      // Without a saved setup there is no period row yet: lock by month key and the API creates it.
      const response = await fetch(`/api/pnl-periods/${encodeURIComponent(periodId ?? periodKey)}/lock`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The API refuses to lock while parameters or formulas fail, and returns the list.
        if (Array.isArray(payload?.formulaErrors)) setFormulaErrors(payload.formulaErrors);
        throw new Error(response.status === 403 ? "Cần quyền Duyệt chi phí hoặc Founder/GM để chốt kỳ." : payload?.message ?? "Không thể chốt kỳ");
      }
      setPeriodId(payload?.data?.id ?? periodId); setPeriodStatus(payload?.data?.status ?? "LOCKED"); setNotice(`Đã chốt tháng ${periodLabel(periodKey)}: lưu số của ${payload?.meta?.snapshotProjects ?? 0} project.`); setReloadKey((value) => value + 1);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể chốt kỳ"); }
    finally { setSaving(false); }
  };
  const reopenPeriod = async () => {
    if (!periodId) return;
    if (!reopenReason.trim()) { setSaveError("Nhập lý do mở lại kỳ."); return; }
    setSaving(true); setSaveError(null); setNotice(null);
    try {
      const response = await fetch(`/api/pnl-periods/${encodeURIComponent(periodId)}/reopen`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: reopenReason.trim() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 403 ? "Cần quyền Duyệt chi phí hoặc Founder/GM để mở lại kỳ." : payload?.message ?? "Không thể mở lại kỳ");
      setPeriodStatus(payload?.data?.status ?? "REOPENED"); setReopenReason(""); setNotice(`Đã mở lại tháng ${periodLabel(periodKey)}. Số liệu của tháng được tính lại theo dữ liệu hiện tại.`); setReloadKey((value) => value + 1);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể mở lại kỳ"); }
    finally { setSaving(false); }
  };
  return <AppShell activeRoute="/admin" title="Thiết lập P&L"><main data-testid="pnl-config" className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6"><div className="mx-auto max-w-[1500px] space-y-5"><header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/admin" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại Admin</Link><p className="mt-4 text-[11px] font-bold uppercase tracking-[.16em] text-primary">Admin · Finance Governance</p><h1 className="!text-xl mt-1 font-extrabold tracking-tight">Thiết lập P&amp;L</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Bạn nhập tham số và công thức của từng tháng; hệ thống chỉ tính. Giờ, cost rate và chi phí nhập tay được lấy tự động.</p></div><div className="flex flex-wrap items-center gap-2"><MonthFilter ariaLabel="Tháng thiết lập" value={periodKey} onChange={(next) => { setPeriodKey(next); setNotice(null); setSaveError(null); }} /><button type="button" disabled={isLocked} onClick={() => void copyPreviousMonth()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">Chép từ tháng trước</button><Link href="/pnl/costs" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted">Nhập chi phí</Link><Link href="/pnl" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted">Xem P&amp;L</Link><button type="button" onClick={() => void save()} disabled={saving || periodStatus === "LOCKED"} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? "Đang lưu…" : saved ? "Đã lưu" : periodStatus === "LOCKED" ? "Kỳ đã chốt" : "Lưu thiết lập"}</button></div></div></header>{saveError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</div> : null}{notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p> : null}{formulaErrors.length ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p className="font-semibold">Có {formulaErrors.length} chỗ trong thiết lập đã lưu chưa tính được. Các khoản này đang bị bỏ ra khỏi P&amp;L cho tới khi sửa, và tháng chưa chốt được:</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{formulaErrors.slice(0, 8).map((message) => <li key={message}>{message}</li>)}</ul></div> : null}<nav aria-label="Thiết lập P&L" className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-2 lg:grid-cols-4">{TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-lg px-3 py-3 text-left transition ${tab === item.id ? "bg-blue-50 text-primary" : "hover:bg-muted/50"}`}><span className="block text-sm font-semibold">{item.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{item.description}</span></button>)}</nav><div className="flex items-center gap-2 text-xs text-muted-foreground"><Settings2 className="h-4 w-4" /> {selectedTab.label} · Kỳ hiệu lực {periodLabel(periodKey)}</div>{tab === "parameters" && <ParametersEditor parameters={parameters} disabled={isLocked} onChange={setParameters} />}{tab === "items" && <FormulaItemsEditor items={calcItems} parameters={parameters} results={results} disabled={isLocked} onChange={setCalcItems} />}{tab === "pool" && <PoolTab total={poolTotal} periodKey={periodKey} criteria={poolCriteria} shares={shares} disabled={isLocked} setTotal={setPoolTotal} setCriteria={setPoolCriteria} />}{tab === "period" && <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isLocked ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{isLocked ? <LockKeyhole className="h-5 w-5" /> : <Check className="h-5 w-5" />}</span><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">{periodLabel(periodKey)}</p><h2 className="mt-1 !text-lg font-bold">{isLocked ? "Đã chốt" : periodStatus === "REOPENED" ? "Đã mở lại" : "Đang mở"}</h2><p className="mt-1 text-xs text-muted-foreground">{isLocked ? "P&L của tháng dùng số đã lưu lúc chốt. Cost rate, chi phí, doanh thu nhập tay và thiết lập của tháng đang bị khóa." : "Số liệu của tháng đang được tính trực tiếp từ dữ liệu hiện tại và còn có thể thay đổi."}</p></div></div>{!isLocked && missingRateMinutes > 0 ? <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Còn {new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(missingRateMinutes / 60)}h đã duyệt chưa có cost rate trong tháng này. Nếu chốt bây giờ, chi phí của số giờ đó sẽ không nằm trong số đã chốt. <Link href={"/pnl/costs?periodKey=" + periodKey} className="font-bold underline underline-offset-2">Nhập cost rate</Link></p> : null}{!isLocked && missingRevenueCount > 0 ? <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{missingRevenueCount} project có chi phí trong tháng nhưng chưa nhập doanh thu của tháng. Nếu chốt bây giờ, doanh thu của các project đó được chốt là 0. <Link href={"/pnl?period=" + periodKey} className="font-bold underline underline-offset-2">Mở P&amp;L tháng này</Link></p> : null}<ul className="mt-5 space-y-2 text-sm text-muted-foreground"><li>Khi chốt, hệ thống lưu doanh thu, chi phí nhân sự, chi phí nhập tay, tổng chi phí và EBIT của từng project. Quỹ được chia và các khoản tính theo công thức được chốt chung thành một số “Chi phí khác đã chốt”, không tách lại từng khoản.</li><li>Sau khi chốt, giờ được duyệt thêm hay chi phí nhập muộn không làm đổi số của tháng.</li><li>Mở lại kỳ cần ghi lý do và được lưu vào nhật ký.</li></ul></div><aside className="rounded-xl border border-border bg-card p-5">{isLocked ? <><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Mở lại kỳ</div><label className="mt-3 block text-xs font-semibold text-muted-foreground" htmlFor="reopen-reason">Lý do mở lại<textarea id="reopen-reason" rows={3} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Ví dụ: bổ sung hóa đơn phần mềm tháng này" className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground" /></label><button type="button" disabled={saving || !periodId} onClick={() => void reopenPeriod()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">Mở lại {"tháng " + periodLabel(periodKey)}</button></> : <><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Chốt kỳ</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Chốt để khóa số của tháng. Cần quyền Duyệt chi phí hoặc Founder/GM. Không chốt được khi còn tham số hoặc công thức báo lỗi.</p><button type="button" disabled={saving || formulaErrors.length > 0} onClick={() => void lockPeriod()} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><LockKeyhole className="h-4 w-4" /> Chốt {"tháng " + periodLabel(periodKey)}</button></>}</aside></section>}</div></main></AppShell>;
}

export { PnlConfigPage };
