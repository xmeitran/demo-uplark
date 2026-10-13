"use client";

import Link from "next/link";
import { useState } from "react";
import type { PnlFundAmountInput, PnlFundInput, PnlFundsResponse, PnlFundSummary } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { MonthFilter } from "@/components/filters";
import { inputClass, parseDecimalInput } from "./pnl-cost-shared";
import { formatDay, formatHoursValue, formatMillions, formatMonth, formatPercent } from "./pnl-format";
import { fixTargetHref } from "./pnl-query";
import { Field, linkClass, LoadingBlock, ModalActions, numberCellClass, PnlModal, ReadOnlyNote, SaveFeedback, smallButton, Strip, tableCellClass, tableHeadClass, toneClass, useSave } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, primaryButtonClass, secondaryButtonClass, usePnlLoad } from "./pnl-ui";

const FORBIDDEN = "Chỉ tài khoản Admin vào được Thiết lập P&L. Tài khoản User không xem được quỹ chi phí chung.";

/** "5,26 tr · Chưa chia" of a fund card; a month without an amount says so instead of showing 0. */
function fundLine(fund: PnlFundSummary, moneyVisible: boolean) {
  if (!fund.period) return { text: "Chưa nhập số tiền", tone: toneClass.warn };
  const amount = moneyVisible ? `${formatMillions(fund.period.amount)} tr` : "—";
  return { text: `${amount} · ${fund.period.statusLabel}`, tone: fund.period.status === "allocated" && !fund.period.stale ? toneClass.ok : toneClass.warn };
}

/** Mục 6.4 — tab Quỹ chi phí chung: ① danh sách quỹ | ② thông tin quỹ, ④ cảnh báo trước khi chia, ③ xem trước phân bổ. */
export function PnlSetupFunds({ periodKey, onPeriodChange }: Readonly<{ periodKey: string; onPeriodChange: (periodKey: string) => void }>) {
  const api = usePnlLoad<PnlFundsResponse>(`/api/pnl/funds${periodKey ? `?periodKey=${periodKey}` : ""}`, "Không tải được quỹ chi phí chung.");
  const save = useSave(api.reload);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fundForm, setFundForm] = useState<PnlFundSummary | "new" | null>(null);
  const [amountForm, setAmountForm] = useState(false);
  const data = api.data?.data;
  const meta = api.data?.meta;
  if (!data || !meta || api.error) return api.loading ? <LoadingBlock rows={6} label="Đang tải quỹ chi phí chung…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);

  const period = data.periodKey;
  const fund = data.funds.find((entry) => entry.fundId === selectedId) ?? data.funds[0] ?? null;
  const locked = data.periodState === "locked" || Boolean(fund?.period?.locked);
  const periodOptions = [...new Set([period, ...data.periodOptions])];
  const fundUrl = (suffix: string) => `/api/pnl/funds/${encodeURIComponent(fund?.fundId ?? "")}/periods/${period}${suffix}`;
  const unequal = Boolean(fund?.period && fund.period.status === "allocated" && fund.period.allocatedAmount !== fund.period.amount);

  return (
    <>
      {locked ? <Strip tone="muted">Kỳ {formatMonth(period)} đã khóa: số chia quỹ lấy từ ảnh chụp, không nhập lại và không chia lại. Muốn đổi thì mở lại kỳ ở tab Kỳ và khóa kỳ.</Strip> : null}
      {!meta.moneyVisible ? <ReadOnlyNote>Bạn ở ngoài nhóm quyền chi phí: số tiền quỹ và số chia không hiển thị.</ReadOnlyNote>
        : !meta.canEdit && !meta.canApprove ? <ReadOnlyNote>Chế độ chỉ xem. Nhập số tiền quỹ cần quyền Sửa chi phí; chạy lại và xác nhận phân bổ cần quyền Duyệt chi phí.</ReadOnlyNote> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* ① Danh sách quỹ */}
        <section aria-label="Danh sách quỹ" className={`${cardClass} min-h-[16rem] p-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonthFilter ariaLabel="Kỳ" value={period} months={periodOptions} onChange={(next) => { setAmountForm(false); onPeriodChange(next); }} />
            {meta.canEdit ? <button type="button" className={`${linkClass} rounded px-1 py-1 text-sm`} onClick={() => setFundForm("new")}>+ Thêm quỹ</button> : null}
          </div>
          <ul className="mt-3 space-y-2">
            {data.funds.map((entry) => {
              const active = entry.fundId === fund?.fundId;
              const line = fundLine(entry, meta.moneyVisible);
              return (
                <li key={entry.fundId}>
                  <button type="button" aria-pressed={active} className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`} onClick={() => { setAmountForm(false); setSelectedId(entry.fundId); }}>
                    <span className="block text-sm font-bold text-foreground">{entry.name}{entry.active ? "" : " (ngừng dùng)"}</span>
                    <span className="block text-[11px] text-muted-foreground">{entry.code}</span>
                    <span className={`mt-0.5 block text-sm ${line.tone}`}>{line.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!data.funds.length ? <p className="mt-4 text-sm text-muted-foreground">Chưa khai báo quỹ nào.{meta.canEdit ? " Bấm “+ Thêm quỹ” để khai báo quỹ đầu tiên (ví dụ Công cụ AI)." : ""}</p> : null}
        </section>

        <div className="min-w-0 space-y-3">
          {!fund ? <div className={`${cardClass} p-5 text-sm text-muted-foreground`}>Chọn hoặc thêm một quỹ để nhập số tiền theo hóa đơn tháng và xem trước phân bổ.</div> : (
            <>
              {/* ② Thông tin quỹ */}
              <section aria-label="Thông tin quỹ" className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-foreground sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="!text-base font-bold text-foreground">Quỹ {fund.name} · tháng {formatMonth(period)}</h2>
                  {meta.canEdit ? <button type="button" className={smallButton} onClick={() => setFundForm(fund)}>Sửa khai báo quỹ</button> : null}
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Số tiền: {!fund.period ? <span className={toneClass.warn}>chưa nhập cho tháng này</span> : meta.moneyVisible ? fund.period.amountText ?? "—" : "—"}</span>
                  {meta.canEdit && !locked ? <button type="button" aria-expanded={amountForm} className={linkClass} onClick={() => { save.clear(); setAmountForm((value) => !value); }}>{fund.period ? "Sửa số tiền" : "Nhập số tiền"}</button> : null}
                </p>
                {fund.period?.invoiceRef ? <p className="text-muted-foreground">Hóa đơn: {fund.period.invoiceRef}</p> : null}
                {amountForm && !locked ? <AmountForm key={fund.fundId} fund={fund} busy={save.busy} onCancel={() => setAmountForm(false)} onSubmit={async (body) => { if (await save.run(() => pnlRequest(fundUrl(""), { method: "PUT", body }), "Đã lưu số tiền quỹ.")) setAmountForm(false); }} /> : null}
                <p className="mt-1.5">Khoản mục đích: {fund.targetItemName} · tiêu chí: {fund.criterionLabel}</p>
                <p className="mt-1.5">Nhận chia: {fund.eligibilityLabel}</p>
                {fund.period?.confirmedAt ? <p className="mt-1.5 text-muted-foreground">Đã xác nhận {formatDay(fund.period.confirmedAt)} · {fund.period.confirmedByName ?? "—"}{fund.period.stale ? " · giờ tính P&L đã đổi sau lần xác nhận, cần chạy lại" : ""}</p> : null}
              </section>

              {/* ④ Cảnh báo trước khi chia */}
              {data.warnings.map((warning) => {
                const href = fixTargetHref(warning.target, { periodKey: period, group: warning.kind });
                return <Strip key={warning.kind} tone="warn">{href ? <Link href={href} className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">{warning.label} ›</Link> : warning.label}</Strip>;
              })}
              <SaveFeedback error={save.error} message={save.message} />

              {/* ③ Xem trước phân bổ */}
              <section aria-label="Xem trước phân bổ" className={`${cardClass} overflow-x-auto`}>
                <table className="w-full min-w-[460px] text-sm">
                  <caption className="sr-only">{fund.preview.confirmed ? "Phân bổ đã xác nhận" : "Xem trước phân bổ"}</caption>
                  <thead><tr><th scope="col" className={tableHeadClass}>Dự án</th><th scope="col" className={`${tableHeadClass} !text-right`}>Giờ tính P&amp;L</th><th scope="col" className={`${tableHeadClass} !text-right`}>Tỷ trọng</th><th scope="col" className={`${tableHeadClass} !text-right`}>Số tiền (tr)</th></tr></thead>
                  <tbody>
                    {fund.preview.rows.map((row) => (
                      <tr key={row.projectId}>
                        <td className={tableCellClass}>{row.projectName}{row.takesRemainder ? " (nhận phần lẻ)" : ""}</td>
                        <td className={numberCellClass}>{formatHoursValue(row.includedMinutes)}</td>
                        <td className={numberCellClass}>{formatPercent(row.sharePercent)}</td>
                        <td className={numberCellClass}>{formatMillions(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {fund.preview.rows.length ? <tfoot><tr className="font-bold"><td className={tableCellClass}>Tổng = tổng quỹ</td><td className={numberCellClass}>{formatHoursValue(fund.preview.totalMinutes)}</td><td className={numberCellClass}>100%</td><td className={numberCellClass}>{formatMillions(fund.preview.totalAmount)}</td></tr></tfoot> : null}
                </table>
                {!fund.preview.rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{fund.period ? "Chưa có dự án tính phí nào có giờ tính P&L trong tháng để nhận chia." : "Nhập số tiền quỹ của tháng để hệ thống tính bảng chia."}</p> : null}
              </section>
              {fund.preview.confirmed ? <p className="text-xs text-muted-foreground">Đang xem số chia đã xác nhận; số đã ghi vào khoản mục đích của từng dự án ở tháng này.</p> : null}
              {unequal ? <Strip tone="warn">Tổng đã chia {formatMillions(fund.period?.allocatedAmount)} tr khác tổng quỹ {formatMillions(fund.period?.amount)} tr: chạy lại và xác nhận, nếu không kỳ không khóa được.</Strip> : null}

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={`${secondaryButtonClass} ${fund.period?.stale ? "!border-amber-400 !text-amber-800" : ""}`} disabled={save.busy || locked || !meta.canApprove || !fund.period} onClick={() => void save.run(() => pnlRequest(fundUrl("/rerun"), { method: "POST", body: {} }), "Đã chạy lại phân bổ theo giờ tính P&L hiện tại.")}>Chạy lại</button>
                <button type="button" className={primaryButtonClass} disabled={save.busy || locked || !meta.canApprove || !fund.preview.canConfirm} onClick={() => void save.run(() => pnlRequest(fundUrl("/confirm"), { method: "POST", body: {} }), "Đã xác nhận phân bổ: số chia đã ghi vào khoản mục đích của từng dự án.")}>Xác nhận phân bổ</button>
                <p className="min-w-0 flex-1 text-right text-sm text-muted-foreground">Tổng đã chia khác tổng quỹ thì chặn khóa kỳ</p>
              </div>
              {!fund.preview.canConfirm && fund.preview.blockedReason && !fund.preview.confirmed ? <p className="text-xs font-semibold text-amber-700">Chưa xác nhận được: {fund.preview.blockedReason}</p> : null}
            </>
          )}
        </div>
      </div>

      {fundForm ? <FundModal fund={fundForm === "new" ? null : fundForm} targetItems={data.targetItemOptions} onClose={() => setFundForm(null)} reload={api.reload} onSaved={(id) => { if (id) setSelectedId(id); }} /> : null}
    </>
  );
}

function AmountForm({ fund, busy, onCancel, onSubmit }: Readonly<{ fund: PnlFundSummary; busy: boolean; onCancel: () => void; onSubmit: (body: PnlFundAmountInput) => void }>) {
  const [currency, setCurrency] = useState<"VND" | "USD">(fund.period?.sourceCurrency ?? "VND");
  const [amount, setAmount] = useState(fund.period?.sourceAmount != null ? String(fund.period.sourceAmount) : "");
  const [invoiceRef, setInvoiceRef] = useState(fund.period?.invoiceRef ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="my-2 space-y-3 rounded-lg border border-border bg-card p-3" onSubmit={(event) => {
      event.preventDefault();
      const sourceAmount = parseDecimalInput(amount);
      if (sourceAmount === undefined || sourceAmount < 0) { setError("Nhập số tiền theo hóa đơn tháng."); return; }
      setError(null);
      onSubmit({ sourceCurrency: currency, sourceAmount, invoiceRef: invoiceRef.trim() || null });
    }}>
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Loại tiền"><CrmSelect ariaLabel="Loại tiền" value={currency} onChange={(value) => setCurrency(value === "USD" ? "USD" : "VND")} options={[{ value: "VND", label: "VND" }, { value: "USD", label: "USD" }]} /></Field>
        <Field label={`Số tiền theo hóa đơn (${currency === "USD" ? "USD" : "đồng"})`} htmlFor="pnl-fund-amount"><input id="pnl-fund-amount" autoFocus inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} className={`${inputClass} text-right font-mono tabular-nums`} /></Field>
        <Field label="Số hóa đơn (không bắt buộc)" htmlFor="pnl-fund-invoice"><input id="pnl-fund-invoice" value={invoiceRef} maxLength={120} onChange={(event) => setInvoiceRef(event.target.value)} className={inputClass} /></Field>
      </div>
      {currency === "USD" ? <p className="text-[11px] text-muted-foreground">Hệ thống quy đổi bằng Tỷ giá USD của tháng ở tab Tham số; thiếu tỷ giá thì không lưu được.</p> : null}
      {error ? <p role="alert" className="text-xs font-semibold text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2"><button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>Hủy</button><button type="submit" className={primaryButtonClass} disabled={busy}>{busy ? "Đang lưu…" : "Lưu số tiền"}</button></div>
    </form>
  );
}

function FundModal({ fund, targetItems, onClose, reload, onSaved }: Readonly<{ fund: PnlFundSummary | null; targetItems: Array<{ code: string; name: string }>; onClose: () => void; reload: () => Promise<void>; onSaved: (fundId: string | null) => void }>) {
  const save = useSave(reload);
  const [code, setCode] = useState(fund?.code ?? "");
  const [name, setName] = useState(fund?.name ?? "");
  const [targetItemCode, setTargetItemCode] = useState(fund?.targetItemCode ?? targetItems[0]?.code ?? "");
  const [active, setActive] = useState(fund?.active ?? true);

  async function submit() {
    if (!name.trim() || !targetItemCode) return;
    const body: PnlFundInput = { ...(code.trim() ? { code: code.trim() } : {}), name: name.trim(), targetItemCode, active };
    let createdId: string | null = fund?.fundId ?? null;
    const ok = await save.run(async () => {
      const result = await pnlRequest<{ data?: { fundId?: string } }>(fund ? `/api/pnl/funds/${encodeURIComponent(fund.fundId)}` : "/api/pnl/funds", { method: fund ? "PATCH" : "POST", body });
      createdId = result.data?.fundId ?? createdId;
    });
    if (ok) { onSaved(createdId); onClose(); }
  }

  return (
    <PnlModal title={fund ? `Sửa khai báo quỹ ${fund.name}` : "Thêm quỹ"} onClose={onClose} onSubmit={() => void submit()} footer={<ModalActions onCancel={onClose} busy={save.busy} disabled={!name.trim() || !targetItemCode} submitLabel={fund ? "Lưu khai báo" : "Thêm quỹ"} />}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Tên quỹ" htmlFor="pnl-fund-name"><input id="pnl-fund-name" required value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Ví dụ: Công cụ AI" /></Field>
        <Field label="Mã" htmlFor="pnl-fund-code" hint={fund ? undefined : "Để trống: hệ thống tự sinh."}><input id="pnl-fund-code" value={code} maxLength={40} onChange={(event) => setCode(event.target.value)} className={inputClass} /></Field>
      </div>
      <Field label="Khoản mục đích" hint="Chỉ khoản mục có cách lấy số Phân bổ quỹ (tab Khoản mục)."><CrmSelect ariaLabel="Khoản mục đích" value={targetItemCode} onChange={setTargetItemCode} searchable placeholder="Chọn khoản mục…" options={targetItems.map((item) => ({ value: item.code, label: item.name }))} /></Field>
      <p className="text-xs text-muted-foreground">Tiêu chí chia: giờ tính P&amp;L của tháng. Nhận chia: dự án tính phí có giờ trong tháng; dự án thử nghiệm luôn bị loại.</p>
      {fund ? <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Quỹ đang dùng</label> : null}
      <SaveFeedback error={save.error} message={null} />
    </PnlModal>
  );
}
