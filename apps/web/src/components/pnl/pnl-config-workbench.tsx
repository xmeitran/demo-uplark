"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleAlert, LockKeyhole, Plus, Save, Settings2, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";

type ConfigTab = "items" | "parameters" | "pool" | "period" | "templates";
type Source = "Thủ công" | "Hệ thống" | "Công thức" | "Phân bổ quỹ" | "Tổng nhóm";

type PnlItem = {
  code: string;
  label: string;
  group: "Doanh thu" | "Chi phí" | "Kết quả" | "Chỉ số";
  source: Source;
  round: number;
  parent?: string;
  active: boolean;
  children?: boolean;
};

type Parameter = { code: string; label: string; type: string; value: string; scope: string };
type PoolCriteria = "Theo giờ tính P&L" | "Theo doanh thu" | "Theo số nhân sự" | "Chia đều" | "Nhập tay từng dự án";

function currentPnlPeriodKey() {
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

const TABS: Array<{ id: ConfigTab; label: string; description: string }> = [
  { id: "items", label: "Khoản mục P&L", description: "Cây khoản mục và nguồn số" },
  { id: "parameters", label: "Tham số", description: "Giá trị theo phạm vi, hiệu lực" },
  { id: "pool", label: "Quỹ chi phí chung", description: "Phân bổ và đối soát" },
  { id: "period", label: "Kỳ và khoá kỳ", description: "Trạng thái và snapshot" },
  { id: "templates", label: "Mẫu khoản mục", description: "Theo loại dự án" }
];

const DEFAULT_ITEMS: PnlItem[] = [
  { code: "DOANHTHU", label: "Doanh thu", group: "Doanh thu", source: "Tổng nhóm", round: 5, children: true, active: true },
  { code: "DOANHTHU.LIC", label: "Doanh thu ghi nhận kỳ", group: "Doanh thu", source: "Hệ thống", round: 2, parent: "DOANHTHU", active: true },
  { code: "CP", label: "Chi phí", group: "Chi phí", source: "Tổng nhóm", round: 5, children: true, active: true },
  { code: "CP.LUONG", label: "Chi phí nhân sự", group: "Chi phí", source: "Tổng nhóm", round: 5, parent: "CP", children: true, active: true },
  { code: "CP.LUONG.BD", label: "Chi phí BD", group: "Chi phí", source: "Công thức", round: 3, parent: "CP.LUONG", active: true },
  { code: "CP.LUONG.PM", label: "Chi phí PM", group: "Chi phí", source: "Công thức", round: 3, parent: "CP.LUONG", active: true },
  { code: "CP.LUONG.DX", label: "Chi phí Delivery / DX", group: "Chi phí", source: "Công thức", round: 3, parent: "CP.LUONG", active: true },
  { code: "CP.VANHANH.AI", label: "Chi phí công cụ AI", group: "Chi phí", source: "Phân bổ quỹ", round: 4, parent: "CP", active: true },
  { code: "LN.GOP", label: "Lợi nhuận gộp", group: "Kết quả", source: "Công thức", round: 6, active: true },
  { code: "EBIT", label: "EBIT", group: "Kết quả", source: "Công thức", round: 6, active: true },
  { code: "TL.EBIT", label: "Biên EBIT", group: "Chỉ số", source: "Công thức", round: 6, active: true }
];

const DEFAULT_PARAMETERS: Parameter[] = [
  { code: "TY_LE_HOA_HONG_BD", label: "Tỷ lệ hoa hồng bán hàng", type: "Tỷ lệ", value: "5%", scope: "Theo khách hàng" },
  { code: "LUONG_THANG_CHUAN", label: "Lương tháng quy đổi đơn giá giờ", type: "Tiền", value: "10.000.000 ₫", scope: "Theo nhân sự" },
  { code: "GIO_CONG_CHUAN_THANG", label: "Giờ công chuẩn tháng", type: "Số", value: "176 giờ", scope: "Toàn công ty" },
  { code: "TY_GIA_USD", label: "Tỷ giá USD sang VNĐ", type: "Tỷ giá", value: "26.300 ₫", scope: "Toàn công ty · Theo tháng" },
  { code: "PHI_CONG_CU_AI_THANG", label: "Phí công cụ AI mỗi tháng", type: "Tiền", value: "200 USD", scope: "Toàn công ty · Theo tháng" },
  { code: "GIO_BD_DINH_MUC", label: "Giờ BD định mức / dự án", type: "Số", value: "3 giờ", scope: "Theo loại dự án" },
  { code: "GIO_PM_DINH_MUC", label: "Giờ PM định mức / dự án", type: "Số", value: "16 giờ", scope: "Theo loại dự án" }
];

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "slate" | "rose" }) {
  const colors = { blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-600", rose: "bg-rose-50 text-rose-700" };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${colors[tone]}`}>{children}</span>;
}

function ItemsTab({ items, selectedCode, periodKey, onSelect, onAdd, onSourceChange }: { items: PnlItem[]; selectedCode: string; periodKey: string; onSelect: (code: string) => void; onAdd: () => void; onSourceChange: (code: string, source: Source) => void }) {
  const selected = items.find((item) => item.code === selectedCode) ?? items[0];
  const blockers = items.filter((item) => item.children && item.source !== "Tổng nhóm");
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="font-semibold">Cây khoản mục</h2><p className="mt-0.5 text-xs text-muted-foreground">Mã giữ ổn định sau khi đã có dữ liệu kỳ khoá.</p></div><button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/5"><Plus className="h-3.5 w-3.5" /> Thêm khoản mục</button></div>
      <div className="divide-y divide-border/70">{items.map((item) => <button key={item.code} type="button" onClick={() => onSelect(item.code)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40 ${selectedCode === item.code ? "bg-blue-50/70" : ""}`}><ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground ${item.parent ? "ml-5" : ""}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{item.label}</span><Badge tone={item.active ? "green" : "slate"}>{item.active ? "Đang dùng" : "Ngừng dùng"}</Badge></div><p className="mt-0.5 text-[11px] text-muted-foreground">{item.code} · {item.group} · Vòng {item.round}</p></div><Badge tone="blue">{item.source}</Badge></button>)}</div>
      {blockers.length > 0 && <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-900"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>Quy tắc kiểm tra đã bật: khoản mục có con phải dùng <strong>Tổng nhóm</strong>. Hiện có {blockers.length} dòng cần rà soát.</span></div>}
    </section>
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Chi tiết khoản mục</p><h2 className="mt-1 text-lg font-bold">{selected?.label}</h2></div><Badge tone="blue">{selected?.code}</Badge></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-muted-foreground">Tên hiển thị<input value={selected?.label ?? ""} readOnly className="mt-1 h-10 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground" /></label><label className="text-xs font-semibold text-muted-foreground">Nhóm báo cáo<input value={selected?.group ?? ""} readOnly className="mt-1 h-10 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground" /></label><div><span className="text-xs font-semibold text-muted-foreground">Nguồn số</span><CrmSelect className="mt-1" options={["Thủ công", "Hệ thống", "Công thức", "Phân bổ quỹ", "Tổng nhóm"].map((source) => ({ value: source, label: source }))} value={selected?.source ?? ""} onChange={(value) => onSourceChange(selected?.code ?? "", value as Source)} /></div><label className="text-xs font-semibold text-muted-foreground">Vòng tính<input value={`Vòng ${selected?.round ?? 1}`} readOnly className="mt-1 h-10 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground" /></label></div>
      <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3"><p className="text-xs font-semibold text-muted-foreground">Công thức / quy tắc</p><code className="mt-2 block text-sm text-foreground">{selected?.source === "Tổng nhóm" ? "TỔNG_THEO(khoản_mục, con_trực_tiếp)" : selected?.source === "Phân bổ quỹ" ? "PHÂN_BỔ(QUY.AI, theo_giờ_P&L)" : selected?.source === "Hệ thống" ? "DOANH_THU_GHI_NHẬN_KỲ" : "GIỜ_TÍNH_PL × ĐƠN_GIÁ_GIỜ"}</code></div>
      <div className="mt-4 flex flex-wrap gap-2"><Badge tone="slate">Đơn vị: Tiền</Badge><Badge tone="slate">Hiệu lực: {periodLabel(periodKey)}</Badge><Badge tone="slate">Nguồn: cấu hình P&amp;L</Badge></div>
    </section>
  </div>;
}

function ParametersTab({ parameters, periodKey, onChange }: { parameters: Parameter[]; periodKey: string; onChange: (code: string, value: string) => void }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center gap-2 border-b border-border px-4 py-3"><SlidersHorizontal className="h-4 w-4 text-primary" /><div><h2 className="font-semibold">Tham số có hiệu lực</h2><p className="mt-0.5 text-xs text-muted-foreground">Không hardcode số trong công thức; phạm vi hẹp hơn được ưu tiên.</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Mã</th><th className="px-4 py-3">Tên</th><th className="px-4 py-3">Kiểu</th><th className="px-4 py-3">Giá trị</th><th className="px-4 py-3">Phạm vi</th><th className="px-4 py-3">Hiệu lực</th></tr></thead><tbody className="divide-y divide-border/70">{parameters.map((parameter) => <tr key={parameter.code}><td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{parameter.code}</td><td className="px-4 py-3 font-medium">{parameter.label}</td><td className="px-4 py-3"><Badge tone="slate">{parameter.type}</Badge></td><td className="px-4 py-3"><input aria-label={parameter.code} value={parameter.value} onChange={(event) => onChange(parameter.code, event.target.value)} className="h-9 w-36 rounded-lg border border-border bg-background px-2.5 text-sm font-semibold" /></td><td className="px-4 py-3 text-xs text-muted-foreground">{parameter.scope}</td><td className="px-4 py-3 text-xs text-muted-foreground">{periodLabel(periodKey)}</td></tr>)}</tbody></table></div></section>;
}

function PoolTab({ allocated, total, periodKey, criteria, setAllocated, setCriteria }: { allocated: number; total: number; periodKey: string; criteria: PoolCriteria; setAllocated: (value: number) => void; setCriteria: (value: PoolCriteria) => void }) {
  const remaining = total - allocated;
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><section className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">QUY.AI · Tháng {periodLabel(periodKey)}</p><h2 className="mt-1 text-lg font-bold">Phí công cụ AI</h2><p className="mt-1 text-xs text-muted-foreground">Khoản mục đích: CP.VANHANH.AI · Tiêu chí: {criteria.toLowerCase()}.</p></div><Badge tone={remaining === 0 ? "green" : "amber"}>{remaining === 0 ? "Đã chia" : "Nháp"}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Tổng quỹ</p><p className="mt-1 font-bold">{new Intl.NumberFormat("vi-VN").format(total)} ₫</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Đã phân bổ</p><p className="mt-1 font-bold text-emerald-700">{new Intl.NumberFormat("vi-VN").format(allocated)} ₫</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Còn lại</p><p className={`mt-1 font-bold ${remaining ? "text-amber-700" : "text-emerald-700"}`}>{new Intl.NumberFormat("vi-VN").format(remaining)} ₫</p></div></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, total > 0 ? (allocated / total) * 100 : 0)}%` }} /></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-muted-foreground">Đã phân bổ quỹ dùng chung<input type="number" min={0} max={total} value={allocated} onChange={(event) => setAllocated(Math.min(total, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label><div><span className="text-xs font-semibold text-muted-foreground">Tiêu chí</span><CrmSelect className="mt-1" options={["Theo giờ tính P&L", "Theo doanh thu", "Theo số nhân sự", "Chia đều", "Nhập tay từng dự án"].map((value) => ({ value, label: value }))} value={criteria} onChange={(value) => setCriteria(value as PoolCriteria)} /></div></div></section><aside className="rounded-xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-950"><div className="flex items-center gap-2 font-semibold"><CircleAlert className="h-4 w-4 text-amber-600" /> Chặn chốt kỳ</div><p className="mt-2 text-xs leading-5">Tổng tiền đã chia phải bằng đúng tổng quỹ. Còn thiếu <strong>{new Intl.NumberFormat("vi-VN").format(Math.max(remaining, 0))} ₫</strong> nên nút chốt kỳ vẫn bị khóa.</p></aside></div>;
}

function PnlConfigPage() {
  const [periodKey] = useState(currentPnlPeriodKey);
  const [tab, setTab] = useState<ConfigTab>("items");
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [selectedCode, setSelectedCode] = useState(DEFAULT_ITEMS[0].code);
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS);
  const [allocated, setAllocated] = useState(0);
  const [poolTotal, setPoolTotal] = useState(5260000);
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
      if (data) {
        if (Array.isArray(data.items)) {
          setItems(data.items);
          setSelectedCode(data.items[0]?.code ?? "");
        }
        if (Array.isArray(data.parameters)) setParameters(data.parameters);
        if (data.pool && typeof data.pool.allocated === "number") setAllocated(Math.max(0, data.pool.allocated));
        if (data.pool && typeof data.pool.total === "number" && data.pool.total > 0) setPoolTotal(data.pool.total);
        if (data.pool && typeof data.pool.criteria === "string") setPoolCriteria(data.pool.criteria as PoolCriteria);
      }
      const period = periodPayload?.data;
      setPeriodId(period?.id ?? null);
      setPeriodStatus(period?.status ?? null);
    }).catch((error) => {
      if (active) setSaveError(error instanceof Error ? error.message : "Không tải được cấu hình P&L.");
    });
    return () => { active = false; };
  }, [periodKey]);
  const selectedTab = TABS.find((item) => item.id === tab) ?? TABS[0];
  const canLock = allocated === poolTotal;
  const itemCount = useMemo(() => items.filter((item) => item.active).length, [items]);
  const addItem = () => { const code = `CP.MOI.${items.length + 1}`; setItems((current) => [...current, { code, label: "Khoản mục mới", group: "Chi phí", source: "Thủ công", round: 1, parent: "CP", active: true }]); setSelectedCode(code); setTab("items"); };
  const changeSource = (code: string, source: Source) => setItems((current) => current.map((item) => item.code === code ? { ...item, source } : item));
  const save = async () => {
    if (periodStatus === "LOCKED") {
      setSaveError("Kỳ P&L đã khóa, không thể sửa cấu hình. Hãy mở lại kỳ trước khi thay đổi.");
      return;
    }
    const invalidItems = items.filter((item) => item.children && item.source !== "Tổng nhóm");
    if (invalidItems.length) {
      setSaveError(`Không thể lưu: ${invalidItems.map((item) => item.code).join(", ")} có khoản mục con nhưng chưa dùng nguồn “Tổng nhóm”.`);
      return;
    }
    setSaving(true); setSaveError(null);
    try {
      const configResponse = await fetch("/api/pnl-configurations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey, items, parameters, pool: { total: poolTotal, allocated, criteria: poolCriteria }, templates: ["Dự án khách hàng", "Dự án nội bộ", "Đào tạo"] }) });
      if (!configResponse.ok) { const payload = await configResponse.json().catch(() => ({})); throw new Error(payload?.message ?? "Không thể lưu cấu hình P&L"); }
      const response = await fetch("/api/pnl-periods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey, periodStart: `${periodKey}-01`, periodEnd: periodEnd(periodKey), currency: "VND", revenueAmount: 0 }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message ?? "Không thể lưu kỳ P&L");
      setPeriodId(payload?.data?.id ?? null); setPeriodStatus(payload?.data?.status ?? "OPEN"); setSaved(true); window.setTimeout(() => setSaved(false), 2400);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể lưu kỳ P&L"); }
    finally { setSaving(false); }
  };
  const lockPeriod = async () => {
    if (!periodId) return;
    setSaving(true); setSaveError(null);
      try { const response = await fetch(`/api/pnl-periods/${encodeURIComponent(periodId)}/lock`, { method: "POST" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.message ?? "Không thể chốt kỳ"); setPeriodStatus(payload?.data?.status ?? "LOCKED"); setSaved(true); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể chốt kỳ"); }
    finally { setSaving(false); }
  };
  return <AppShell activeRoute="/admin" title="Thiết lập P&L"><main data-testid="pnl-config" className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6"><div className="mx-auto max-w-[1500px] space-y-5"><header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/admin" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại Admin</Link><p className="mt-4 text-[11px] font-bold uppercase tracking-[.16em] text-primary">Admin · Finance Governance</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Thiết lập P&amp;L</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Quản lý khoản mục, nguồn số, tham số, quỹ dùng chung và kỳ khóa. Báo cáo chỉ đọc dữ liệu đã được cấu hình và đối soát.</p></div><div className="flex items-center gap-2"><Badge tone="green">{itemCount} khoản mục đang dùng</Badge><button type="button" onClick={() => void save()} disabled={saving || periodStatus === "LOCKED"} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? "Đang lưu…" : saved ? "Đã lưu" : periodStatus === "LOCKED" ? "Kỳ đã khóa" : "Lưu bản nháp"}</button></div></div></header>{saveError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</div> : null}<nav aria-label="Thiết lập P&L" className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-2 lg:grid-cols-5">{TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-lg px-3 py-3 text-left transition ${tab === item.id ? "bg-blue-50 text-primary" : "hover:bg-muted/50"}`}><span className="block text-sm font-semibold">{item.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{item.description}</span></button>)}</nav><div className="flex items-center gap-2 text-xs text-muted-foreground"><Settings2 className="h-4 w-4" /> {selectedTab.label} · Kỳ hiệu lực {periodLabel(periodKey)}</div>{tab === "items" && <ItemsTab items={items} selectedCode={selectedCode} periodKey={periodKey} onSelect={setSelectedCode} onAdd={addItem} onSourceChange={changeSource} />}{tab === "parameters" && <ParametersTab parameters={parameters} periodKey={periodKey} onChange={(code, value) => setParameters((current) => current.map((item) => item.code === code ? { ...item, value } : item))} />}{tab === "pool" && <PoolTab allocated={allocated} total={poolTotal} periodKey={periodKey} criteria={poolCriteria} setAllocated={setAllocated} setCriteria={setPoolCriteria} />}{tab === "period" && <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Check className="h-5 w-5" /></span><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Kỳ {periodLabel(periodKey)}</p><h2 className="mt-1 text-lg font-bold">{periodStatus ?? "Chưa tạo"}</h2><p className="mt-1 text-xs text-muted-foreground">{periodStatus === "LOCKED" ? "Kỳ đã khóa; cần mở lại trước khi chỉnh sửa." : "Có thể ghi giờ, nhập chi phí và chỉnh tham số."}</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Kỳ tiếp theo</p><p className="mt-1 font-semibold">Sắp tới</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Snapshot</p><p className="mt-1 font-semibold">{periodStatus === "LOCKED" ? "Đã chốt" : "Chưa chốt"}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Quỹ dùng chung</p><p className="mt-1 font-semibold">{canLock ? "Đã khớp" : "Còn lệch"}</p></div></div></div><aside className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Chốt kỳ</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Hệ thống lưu cứng tham số, đơn giá giờ và cách chia quỹ tại thời điểm chốt.</p><button type="button" disabled={!canLock || !periodId || saving || periodStatus === "LOCKED"} onClick={() => void lockPeriod()} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><LockKeyhole className="h-4 w-4" /> {periodStatus === "LOCKED" ? "Đã chốt kỳ" : canLock ? `Chốt kỳ ${periodLabel(periodKey)}` : "Cần khớp quỹ trước"}</button></aside></section>}{tab === "templates" && <section className="grid gap-4 md:grid-cols-3">{["Dự án khách hàng", "Dự án nội bộ", "Đào tạo"].map((template) => <article key={template} className="rounded-xl border border-border bg-card p-5"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Mẫu mặc định</p><h2 className="mt-2 text-lg font-bold">{template}</h2><p className="mt-2 text-sm text-muted-foreground">Áp dụng cây Doanh thu → Chi phí → Kết quả và giữ nguồn số theo loại dự án.</p><div className="mt-4 flex flex-wrap gap-2"><Badge tone="blue">11 khoản mục</Badge><Badge tone="green">Đang dùng</Badge></div><button type="button" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted/50">Xem mẫu <ChevronRight className="h-3.5 w-3.5" /></button></article>)}</section>}</div></main></AppShell>;
}

export { PnlConfigPage };
