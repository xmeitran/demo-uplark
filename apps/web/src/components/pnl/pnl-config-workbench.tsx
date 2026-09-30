"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleAlert, LockKeyhole, Plus, Save, Settings2, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";

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

function ItemsTab({ items, selectedCode, onSelect, onAdd, onSourceChange }: { items: PnlItem[]; selectedCode: string; onSelect: (code: string) => void; onAdd: () => void; onSourceChange: (code: string, source: Source) => void }) {
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
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-muted-foreground">Tên hiển thị<input value={selected?.label ?? ""} readOnly className="mt-1 h-10 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground" /></label><label className="text-xs font-semibold text-muted-foreground">Nhóm báo cáo<input value={selected?.group ?? ""} readOnly className="mt-1 h-10 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground" /></label><label className="text-xs font-semibold text-muted-foreground">Nguồn số<select value={selected?.source ?? ""} onChange={(event) => onSourceChange(selected?.code ?? "", event.target.value as Source)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"><option>Thủ công</option><option>Hệ thống</option><option>Công thức</option><option>Phân bổ quỹ</option><option>Tổng nhóm</option></select></label><label className="text-xs font-semibold text-muted-foreground">Vòng tính<input value={`Vòng ${selected?.round ?? 1}`} readOnly className="mt-1 h-10 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground" /></label></div>
      <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3"><p className="text-xs font-semibold text-muted-foreground">Công thức / quy tắc</p><code className="mt-2 block text-sm text-foreground">{selected?.source === "Tổng nhóm" ? "TỔNG_THEO(khoản_mục, con_trực_tiếp)" : selected?.source === "Phân bổ quỹ" ? "PHÂN_BỔ(QUY.AI, theo_giờ_P&L)" : selected?.source === "Hệ thống" ? "DOANH_THU_GHI_NHẬN_KỲ" : "GIỜ_TÍNH_PL × ĐƠN_GIÁ_GIỜ"}</code></div>
      <div className="mt-4 flex flex-wrap gap-2"><Badge tone="slate">Đơn vị: Tiền</Badge><Badge tone="slate">Hiệu lực: 09/2026</Badge><Badge tone="slate">Nguồn: cấu hình P&amp;L</Badge></div>
    </section>
  </div>;
}

function ParametersTab({ parameters, onChange }: { parameters: Parameter[]; onChange: (code: string, value: string) => void }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center gap-2 border-b border-border px-4 py-3"><SlidersHorizontal className="h-4 w-4 text-primary" /><div><h2 className="font-semibold">Tham số có hiệu lực</h2><p className="mt-0.5 text-xs text-muted-foreground">Không hardcode số trong công thức; phạm vi hẹp hơn được ưu tiên.</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Mã</th><th className="px-4 py-3">Tên</th><th className="px-4 py-3">Kiểu</th><th className="px-4 py-3">Giá trị</th><th className="px-4 py-3">Phạm vi</th><th className="px-4 py-3">Hiệu lực</th></tr></thead><tbody className="divide-y divide-border/70">{parameters.map((parameter) => <tr key={parameter.code}><td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{parameter.code}</td><td className="px-4 py-3 font-medium">{parameter.label}</td><td className="px-4 py-3"><Badge tone="slate">{parameter.type}</Badge></td><td className="px-4 py-3"><input aria-label={parameter.code} value={parameter.value} onChange={(event) => onChange(parameter.code, event.target.value)} className="h-9 w-36 rounded-lg border border-border bg-background px-2.5 text-sm font-semibold" /></td><td className="px-4 py-3 text-xs text-muted-foreground">{parameter.scope}</td><td className="px-4 py-3 text-xs text-muted-foreground">09/2026</td></tr>)}</tbody></table></div></section>;
}

function PoolTab({ allocated, setAllocated }: { allocated: number; setAllocated: (value: number) => void }) {
  const total = 5260000;
  const remaining = total - allocated;
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><section className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">QUY.AI · Tháng 09/2026</p><h2 className="mt-1 text-lg font-bold">Phí công cụ AI</h2><p className="mt-1 text-xs text-muted-foreground">Khoản mục đích: CP.VANHANH.AI · Tiêu chí: theo giờ tính P&amp;L.</p></div><Badge tone={remaining === 0 ? "green" : "amber"}>{remaining === 0 ? "Đã chia" : "Nháp"}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Tổng quỹ</p><p className="mt-1 font-bold">5.260.000 ₫</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Đã phân bổ</p><p className="mt-1 font-bold text-emerald-700">{new Intl.NumberFormat("vi-VN").format(allocated)} ₫</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Còn lại</p><p className={`mt-1 font-bold ${remaining ? "text-amber-700" : "text-emerald-700"}`}>{new Intl.NumberFormat("vi-VN").format(remaining)} ₫</p></div></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (allocated / total) * 100)}%` }} /></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-muted-foreground">Phân bổ cho project A<input type="number" min={0} max={total} value={allocated} onChange={(event) => setAllocated(Math.min(total, Math.max(0, Number(event.target.value) || 0)))} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label><label className="text-xs font-semibold text-muted-foreground">Tiêu chí<select className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option>Theo giờ tính P&amp;L</option><option>Theo doanh thu</option><option>Theo số nhân sự</option><option>Chia đều</option><option>Nhập tay từng dự án</option></select></label></div></section><aside className="rounded-xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-950"><div className="flex items-center gap-2 font-semibold"><CircleAlert className="h-4 w-4 text-amber-600" /> Chặn chốt kỳ</div><p className="mt-2 text-xs leading-5">Tổng tiền đã chia phải bằng đúng tổng quỹ. Còn thiếu <strong>{new Intl.NumberFormat("vi-VN").format(Math.max(remaining, 0))} ₫</strong> nên nút chốt kỳ vẫn bị khóa.</p></aside></div>;
}

function PnlConfigPage() {
  const [tab, setTab] = useState<ConfigTab>("items");
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [selectedCode, setSelectedCode] = useState(DEFAULT_ITEMS[0].code);
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS);
  const [allocated, setAllocated] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/pnl-configurations?periodKey=2026-09", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => {
      const data = payload?.data;
      if (!active || !data) return;
      if (Array.isArray(data.items)) setItems(data.items);
      if (Array.isArray(data.parameters)) setParameters(data.parameters);
      if (data.pool && typeof data.pool.allocated === "number") setAllocated(data.pool.allocated);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const selectedTab = TABS.find((item) => item.id === tab) ?? TABS[0];
  const canLock = allocated === 5260000;
  const itemCount = useMemo(() => items.filter((item) => item.active).length, [items]);
  const addItem = () => { const code = `CP.MOI.${items.length + 1}`; setItems((current) => [...current, { code, label: "Khoản mục mới", group: "Chi phí", source: "Thủ công", round: 1, parent: "CP", active: true }]); setSelectedCode(code); setTab("items"); };
  const changeSource = (code: string, source: Source) => setItems((current) => current.map((item) => item.code === code ? { ...item, source } : item));
  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const configResponse = await fetch("/api/pnl-configurations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey: "2026-09", items, parameters, pool: { allocated }, templates: ["Dự án khách hàng", "Dự án nội bộ", "Đào tạo"] }) });
      if (!configResponse.ok) { const payload = await configResponse.json().catch(() => ({})); throw new Error(payload?.message ?? "Không thể lưu cấu hình P&L"); }
      const response = await fetch("/api/pnl-periods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKey: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "VND", revenueAmount: 0 }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message ?? "Không thể lưu kỳ P&L");
      setPeriodId(payload?.data?.id ?? null); setSaved(true); window.setTimeout(() => setSaved(false), 2400);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể lưu kỳ P&L"); }
    finally { setSaving(false); }
  };
  const lockPeriod = async () => {
    if (!periodId) return;
    setSaving(true); setSaveError(null);
    try { const response = await fetch(`/api/pnl-periods/${encodeURIComponent(periodId)}/lock`, { method: "POST" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.message ?? "Không thể chốt kỳ"); setSaved(true); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể chốt kỳ"); }
    finally { setSaving(false); }
  };
  return <AppShell activeRoute="/admin" title="Thiết lập P&L"><main data-testid="pnl-config" className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6"><div className="mx-auto max-w-[1500px] space-y-5"><header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/admin" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Quay lại Admin</Link><p className="mt-4 text-[11px] font-bold uppercase tracking-[.16em] text-primary">Admin · Finance Governance</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Thiết lập P&amp;L</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Quản lý khoản mục, nguồn số, tham số, quỹ dùng chung và kỳ khóa. Báo cáo chỉ đọc dữ liệu đã được cấu hình và đối soát.</p></div><div className="flex items-center gap-2"><Badge tone="green">{itemCount} khoản mục đang dùng</Badge><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? "Đang lưu…" : saved ? "Đã lưu" : "Lưu bản nháp"}</button></div></div></header><nav aria-label="Thiết lập P&L" className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-2 lg:grid-cols-5">{TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-lg px-3 py-3 text-left transition ${tab === item.id ? "bg-blue-50 text-primary" : "hover:bg-muted/50"}`}><span className="block text-sm font-semibold">{item.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{item.description}</span></button>)}</nav><div className="flex items-center gap-2 text-xs text-muted-foreground"><Settings2 className="h-4 w-4" /> {selectedTab.label} · Kỳ hiệu lực 09/2026</div>{tab === "items" && <ItemsTab items={items} selectedCode={selectedCode} onSelect={setSelectedCode} onAdd={addItem} onSourceChange={changeSource} />}{tab === "parameters" && <ParametersTab parameters={parameters} onChange={(code, value) => setParameters((current) => current.map((item) => item.code === code ? { ...item, value } : item))} />}{tab === "pool" && <PoolTab allocated={allocated} setAllocated={setAllocated} />}{tab === "period" && <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Check className="h-5 w-5" /></span><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Kỳ 09/2026</p><h2 className="mt-1 text-lg font-bold">Đang mở</h2><p className="mt-1 text-xs text-muted-foreground">Có thể ghi giờ, nhập chi phí và chỉnh tham số.</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Kỳ tiếp theo</p><p className="mt-1 font-semibold">Sắp tới · 10/2026</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Snapshot</p><p className="mt-1 font-semibold">Chưa chốt</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Quỹ dùng chung</p><p className="mt-1 font-semibold">{canLock ? "Đã khớp" : "Còn lệch"}</p></div></div></div><aside className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Chốt kỳ</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Hệ thống lưu cứng tham số, đơn giá giờ và cách chia quỹ tại thời điểm chốt.</p><button type="button" disabled={!canLock || !periodId || saving} onClick={() => void lockPeriod()} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><LockKeyhole className="h-4 w-4" /> {canLock ? "Chốt kỳ 09/2026" : "Cần khớp quỹ trước"}</button></aside></section>}{tab === "templates" && <section className="grid gap-4 md:grid-cols-3">{["Dự án khách hàng", "Dự án nội bộ", "Đào tạo"].map((template) => <article key={template} className="rounded-xl border border-border bg-card p-5"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-primary">Mẫu mặc định</p><h2 className="mt-2 text-lg font-bold">{template}</h2><p className="mt-2 text-sm text-muted-foreground">Áp dụng cây Doanh thu → Chi phí → Kết quả và giữ nguồn số theo loại dự án.</p><div className="mt-4 flex flex-wrap gap-2"><Badge tone="blue">11 khoản mục</Badge><Badge tone="green">Đang dùng</Badge></div><button type="button" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted/50">Xem mẫu <ChevronRight className="h-3.5 w-3.5" /></button></article>)}</section>}</div></main></AppShell>;
}

export { PnlConfigPage };
