"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Lock, Search } from "lucide-react";
import type { CostRateRow, CostRatesResponse } from "@b2b-crm/contracts";
import { FilterBar, MonthFilter } from "@/components/filters/filter-controls";
import { PersonLink } from "@/components/person-link";
import { hoursFormat, currentPeriodKey, inputClass, matchPastedRates, moneyFormat, formatMoneyInput, parseMoneyInput, periodLabel, primaryButton, readApi, secondaryButton, thClass } from "./pnl-cost-shared";

type Drafts = Record<string, string>;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

/** What saving a row will do, or null when the draft does not change anything. */
function changeFor(row: CostRateRow, draft: string | undefined, periodKey: string): { hourlyCostRate: number | null } | null {
  if (draft === undefined) return null;
  const amount = parseMoneyInput(draft);
  const ownRate = row.rateFromPeriodKey === periodKey;
  if (amount === undefined) return ownRate ? { hourlyCostRate: null } : null;
  if (amount === row.hourlyCostRate && ownRate) return null;
  return { hourlyCostRate: amount };
}

export function PnlCostRates({ periodKey, onPeriodChange }: Readonly<{ periodKey: string; onPeriodChange: (periodKey: string) => void }>) {
  const [rows, setRows] = useState<CostRateRow[]>([]);
  const [meta, setMeta] = useState<CostRatesResponse["meta"] | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const payload = await readApi<CostRatesResponse>(await fetch(`/api/cost-rates?periodKey=${periodKey}`, { cache: "no-store" }), "Không tải được cost rate.");
      setRows(payload.data); setMeta(payload.meta); setDrafts({});
    } catch (reason) {
      setRows([]); setMeta(null); setError(reason instanceof Error ? reason.message : "Không tải được cost rate.");
    } finally { setLoading(false); }
  }, [periodKey]);
  useEffect(() => { void load(); }, [load]);

  const changes = useMemo(() => rows.flatMap((row) => { const change = changeFor(row, drafts[row.userId], periodKey); return change ? [{ row, ...change }] : []; }), [rows, drafts, periodKey]);
  const canEdit = Boolean(meta?.canEdit);
  const filtered = rows.filter((row) => (!onlyMissing || row.hourlyCostRate === undefined) && (!query.trim() || `${row.displayName} ${row.role ?? ""}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"))));
  const missingRows = rows.filter((row) => row.hourlyCostRate === undefined);
  const missingMinutes = missingRows.reduce((total, row) => total + row.approvedMinutes, 0);
  const totalCost = rows.reduce((total, row) => total + row.laborCostAmount, 0);

  // Leaving the page with unsaved rates would silently drop them.
  useEffect(() => {
    if (!changes.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);

  function changePeriod(next: string) {
    if (changes.length && !window.confirm("Bạn có thay đổi chưa lưu. Chuyển tháng sẽ bỏ các thay đổi này?")) return;
    onPeriodChange(next);
  }

  /** Fills the table from pasted rows; nothing is saved until "Lưu cost rate". */
  function applyPaste() {
    const { matched, unmatched } = matchPastedRates(pasteText, rows);
    const count = Object.keys(matched).length;
    if (!count && !unmatched.length) { setError("Không đọc được dòng nào. Mỗi dòng cần tên và đơn giá, ví dụ: Nguyễn Văn An <tab> 150.000"); return; }
    setDrafts((current) => ({ ...current, ...Object.fromEntries(Object.entries(matched).map(([userId, amount]) => [userId, moneyFormat.format(amount)])) }));
    setError(unmatched.length ? `Không khớp tên (chưa điền): ${unmatched.join(", ")}` : null);
    setMessage(count ? `Đã điền ${count} người vào bảng. Kiểm tra rồi bấm Lưu cost rate.` : null);
    if (count) { setPasteOpen(false); setPasteText(""); setQuery(""); setOnlyMissing(false); }
  }

  async function save() {
    setSaving(true); setMessage(null); setError(null);
    const failed: string[] = [];
    for (const change of changes) {
      try {
        await readApi(await fetch("/api/cost-rates", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: change.row.userId, periodKey, hourlyCostRate: change.hourlyCostRate }) }), "Không lưu được cost rate.");
      } catch (reason) {
        failed.push(`${change.row.displayName}: ${reason instanceof Error ? reason.message : "lỗi không xác định"}`);
      }
    }
    setSaving(false);
    await load();
    if (failed.length) setError(`Chưa lưu được ${failed.length} dòng — ${failed.join(" · ")}`);
    else setMessage(`Đã lưu cost rate ${periodLabel(periodKey).toLowerCase()} cho ${changes.length} người. Chi phí nhân sự của các dự án đã được tính lại.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-foreground">Nhập <strong>đơn giá một giờ</strong> của từng người. Chi phí nhân sự của dự án = giờ đã duyệt × đơn giá này.</p>
          <p className="mt-1 text-xs text-muted-foreground">Đơn giá áp dụng từ tháng đang chọn và giữ nguyên cho các tháng sau, tới khi bạn nhập đơn giá mới.</p>
        </div>
        <FilterBar className="shrink-0 md:flex-nowrap" onReset={periodKey !== currentPeriodKey() ? () => changePeriod(currentPeriodKey()) : undefined} actions={canEdit ? <button type="button" aria-expanded={pasteOpen} className={`${secondaryButton} shrink-0 whitespace-nowrap`} onClick={() => setPasteOpen((value) => !value)}><ClipboardPaste className="h-4 w-4" /> Dán từ Excel</button> : undefined}>
          <MonthFilter ariaLabel="Tháng áp dụng" value={periodKey} onChange={changePeriod} />
        </FilterBar>
      </div>

      {meta?.locked ? <p role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"><Lock className="h-4 w-4 shrink-0" /> {periodLabel(periodKey)} đã chốt kỳ. Mở lại kỳ ở Thiết lập P&amp;L nếu cần sửa cost rate.{meta.statementFrozen ? " P&L của tháng dùng số đã chốt; giờ và chi phí ở bảng này là dữ liệu hiện tại nên có thể khác số đã chốt." : ""}</p> : null}
      {meta && !meta.locked && !meta.canEdit ? <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Bạn đang ở chế độ chỉ xem. Cần quyền <strong>Sửa</strong> chi phí hoặc Founder/GM để nhập cost rate.</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</p> : null}

      {pasteOpen && canEdit ? (
        <section aria-label="Dán cost rate từ Excel" className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <label className="block text-sm font-semibold text-foreground" htmlFor="cost-rate-paste">Dán 2 cột từ Excel / Google Sheets: Tên nhân sự và Đơn giá một giờ</label>
          <textarea id="cost-rate-paste" autoFocus rows={6} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"Nguyễn Văn An\t150.000\nTrần Thị Bình\t180.000"} className="w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none" />
          <p className="text-xs text-muted-foreground">Tên khớp không phân biệt hoa thường và dấu. Dòng không khớp sẽ được báo lại, không tự đoán. Dán xong vẫn phải bấm Lưu cost rate.</p>
          <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={() => setPasteOpen(false)}>Hủy</button><button type="button" className={primaryButton} disabled={!pasteText.trim()} onClick={applyPaste}>Điền vào bảng</button></div>
        </section>
      ) : null}

      {meta ? (
        <section aria-label="Tóm tắt cost rate" className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đã có cost rate</p><p className="mt-2 font-mono text-2xl font-bold tabular-nums text-foreground">{rows.length - missingRows.length}/{rows.length}</p><p className="mt-0.5 text-xs text-muted-foreground">người trong workspace (gồm người đã nghỉ còn giờ đã duyệt trong tháng)</p></div>
          <button type="button" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((value) => !value)} className={`rounded-xl border p-4 text-left shadow-sm transition-colors ${onlyMissing ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chưa có cost rate</p><p className={`mt-2 font-mono text-2xl font-bold tabular-nums ${missingRows.length ? "text-amber-700" : "text-foreground"}`}>{missingRows.length} người</p><p className="mt-0.5 text-xs text-muted-foreground">{missingMinutes > 0 ? `${hoursFormat.format(missingMinutes / 60)}h đã duyệt chưa tính được chi phí` : "Bấm để chỉ xem những người này"}</p></button>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chi phí nhân sự {periodLabel(periodKey).toLowerCase()}</p><p className="mt-2 font-mono text-2xl font-bold tabular-nums text-foreground">{moneyFormat.format(totalCost)} ₫</p><p className="mt-0.5 text-xs text-muted-foreground">tính trên giờ đã duyệt, theo số đã lưu</p></div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:px-4">
          <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-input bg-background px-3.5 py-2"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm nhân sự" placeholder="Tìm theo tên hoặc vai trò" className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none" /></label>
          {onlyMissing ? <button type="button" className="rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10" onClick={() => setOnlyMissing(false)}>Xem tất cả</button> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead><tr className="border-b border-border bg-muted/30"><th className={thClass}>Nhân sự</th><th className={`${thClass} w-56`}>Cost rate (₫/giờ)</th><th className={thClass}>Áp dụng từ</th><th className={`${thClass} text-right`}>Giờ đã duyệt</th><th className={`${thClass} text-right`}>Chi phí tháng</th></tr></thead>
            <tbody>
              {filtered.map((row) => {
                const draft = drafts[row.userId];
                const change = changeFor(row, draft, periodKey);
                const ownRate = row.rateFromPeriodKey === periodKey;
                return (
                  <tr key={row.userId} className={`border-b border-border/50 transition-colors ${change ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground">{row.avatarUrl ? <img src={row.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : initials(row.displayName)}</span><span className="min-w-0"><span className="flex min-w-0 items-center gap-2"><PersonLink userId={row.userId} className="block truncate text-sm font-semibold text-foreground hover:text-primary">{row.displayName}</PersonLink>{row.inactive ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600" title="Không còn là thành viên đang hoạt động, nhưng có giờ đã duyệt trong tháng này">Đã nghỉ</span> : null}</span><span className="block truncate text-[11px] text-muted-foreground">{row.role ?? "Chưa gán vai trò"}</span></span></div></td>
                    <td className="px-4 py-3"><input inputMode="numeric" autoComplete="off" aria-label={`Cost rate của ${row.displayName}`} disabled={!canEdit || saving} value={draft ?? (row.hourlyCostRate === undefined ? "" : moneyFormat.format(row.hourlyCostRate))} placeholder={canEdit ? "Nhập đơn giá" : "Chưa có"} onChange={(event) => setDrafts((current) => ({ ...current, [row.userId]: formatMoneyInput(event.target.value) }))} className={`${inputClass} text-right font-mono tabular-nums`} /></td>
                    <td className="px-4 py-3 text-xs">{change ? <span className="font-semibold text-primary">{change.hourlyCostRate === null ? "Sẽ bỏ đơn giá riêng của tháng này" : `Sẽ áp dụng từ ${periodLabel(periodKey).toLowerCase()}`}</span> : row.hourlyCostRate === undefined ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">Chưa có</span> : ownRate ? <span className="text-foreground">{periodLabel(periodKey)}</span> : <span className="text-muted-foreground">Giữ từ {periodLabel(row.rateFromPeriodKey ?? periodKey).toLowerCase()}</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-foreground">{hoursFormat.format(row.approvedMinutes / 60)}h</td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{change ? (change.hourlyCostRate === null ? <span className="font-normal text-muted-foreground">Tính lại sau khi lưu</span> : <>{moneyFormat.format(Math.round((row.approvedMinutes * change.hourlyCostRate) / 60))} ₫<span className="block font-sans text-[11px] font-semibold text-primary">xem trước · chưa lưu</span></>) : row.hourlyCostRate === undefined ? <span className="font-normal text-muted-foreground">{row.approvedMinutes > 0 ? "Thiếu cost rate" : "—"}</span> : `${moneyFormat.format(row.laborCostAmount)} ₫`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length ? <div className="px-5 py-10 text-center"><p className="text-sm font-semibold text-foreground">{loading ? "Đang tải cost rate…" : error ? "Không có dữ liệu để hiển thị" : "Không có nhân sự khớp bộ lọc"}</p></div> : null}
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground"><span>Hiển thị <strong className="text-foreground">{filtered.length}</strong> / {rows.length} người</span><span>Để trống ô = không đặt đơn giá riêng cho tháng này.</span></div>
      </section>

      {changes.length ? (
        <div role="region" aria-label="Thay đổi chưa lưu" className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-xl border border-primary/30 bg-card px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-foreground">{changes.length} thay đổi chưa lưu cho {periodLabel(periodKey).toLowerCase()}</p>
          <div className="flex gap-2"><button type="button" className={secondaryButton} disabled={saving} onClick={() => setDrafts({})}>Bỏ thay đổi</button><button type="button" className={primaryButton} disabled={saving} onClick={() => void save()}>{saving ? "Đang lưu…" : "Lưu cost rate"}</button></div>
        </div>
      ) : null}
    </div>
  );
}
