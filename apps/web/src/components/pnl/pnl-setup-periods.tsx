"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PnlPeriodCard, PnlPeriodsResponse } from "@b2b-crm/contracts";
import { checklistRow, inputClass } from "./pnl-cost-shared";
import { formatDay, formatDong, formatHoursValue, formatMonth } from "./pnl-format";
import { Field, linkClass, LoadingBlock, Mark, ReadOnlyNote, SaveFeedback, Strip, toneClass } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, primaryButtonClass, secondaryButtonClass, usePnlLoad } from "./pnl-ui";

const STATE_TONE: Record<PnlPeriodCard["state"], string> = { locked: toneClass.ok, awaiting_lock: toneClass.warn, open: toneClass.info, not_open: toneClass.muted };
const FORBIDDEN = "Chỉ tài khoản Admin vào được Thiết lập P&L. Tài khoản User không xem được kỳ và khóa kỳ.";

/** Mục 6.5 — tab Kỳ và khóa kỳ: ① các tháng, ② checklist, ③ nút khóa kỳ, ④ giải thích kỳ; lịch sử khóa – mở lại (PL-23). */
export function PnlSetupPeriods({ periodKey, onPeriodChange }: Readonly<{ periodKey: string; onPeriodChange: (periodKey: string) => void }>) {
  const api = usePnlLoad<PnlPeriodsResponse>(`/api/pnl/periods${periodKey ? `?periodKey=${periodKey}` : ""}`, "Không tải được danh sách kỳ.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { setReopening(false); setReason(""); setError(null); setMessage(null); }, [periodKey]);

  const data = api.data?.data;
  const meta = api.data?.meta;
  if (!data || !meta || api.error) return api.loading ? <LoadingBlock rows={5} label="Đang tải danh sách kỳ…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);

  const selected = data.selected;
  const month = selected ? formatMonth(selected.periodKey) : "";
  // Mở lại một kỳ mở lại luôn các kỳ đã khóa sau nó: liệt kê trước khi xác nhận.
  const reopenMonths = (selected?.reopenPeriodKeys ?? []).map(formatMonth);

  async function act(action: () => Promise<string>) {
    setBusy(true); setError(null); setMessage(null);
    try { const done = await action(); await api.reload(); setMessage(done); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thực hiện được."); }
    finally { setBusy(false); }
  }
  const lock = () => {
    if (!selected || !window.confirm(`Khóa kỳ ${month}? ${selected.snapshotNote}.`)) return;
    void act(async () => { await pnlRequest(`/api/pnl/periods/${selected.periodKey}/lock`, { method: "POST", body: {} }, "Không khóa được kỳ."); return `Đã khóa kỳ ${month}.`; });
  };
  const reopen = () => {
    if (!selected || !reason.trim()) { setError("Nhập lý do mở lại kỳ (bắt buộc)."); return; }
    void act(async () => {
      const result = await pnlRequest<{ meta?: { reopenedPeriodKeys?: string[] } }>(`/api/pnl/periods/${selected.periodKey}/reopen`, { method: "POST", body: { reason: reason.trim() } }, "Không mở lại được kỳ.");
      setReopening(false); setReason("");
      const reopened = result.meta?.reopenedPeriodKeys ?? [];
      return `Đã mở lại kỳ ${month}${reopened.length > 1 ? `; các kỳ mở lại theo: ${reopened.filter((key) => key !== selected.periodKey).map(formatMonth).join(", ")}` : ""}.`;
    });
  };

  return (
    <>
      {/* ① Danh sách các tháng */}
      <ul aria-label="Danh sách các tháng" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {data.periods.map((period) => {
          const active = period.periodKey === selected?.periodKey;
          return (
            <li key={period.periodKey}>
              <button type="button" aria-pressed={active} className={`h-full w-full rounded-xl border px-3.5 py-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"}`} onClick={() => onPeriodChange(period.periodKey)}>
                <span className={`block text-base font-bold ${period.state === "not_open" ? "text-muted-foreground" : "text-foreground"}`}>T{formatMonth(period.periodKey)}</span>
                <span className={`mt-0.5 block text-sm ${STATE_TONE[period.state]}`}>{period.statusText}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!data.periods.length ? <p className={`${cardClass} p-5 text-sm text-muted-foreground`}>Chưa có kỳ nào.</p> : null}

      {selected ? (
        <>
          {!meta.canApprove ? <ReadOnlyNote>Chế độ chỉ xem. Khóa và mở lại kỳ cần quyền Duyệt chi phí (nhóm quyền chi phí) hoặc Founder/GM.</ReadOnlyNote> : null}

          {/* ② Checklist trước khi khóa */}
          <section aria-labelledby="pnl-period-checklist" className={`${cardClass} px-4 py-3 sm:px-5`}>
            <h2 id="pnl-period-checklist" className="!text-base font-bold text-foreground">Checklist khóa kỳ {month}</h2>
            <ul className="mt-2">
              {selected.checklist.map((item) => {
                const row = checklistRow(item, selected.periodKey);
                return (
                  <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-border py-2.5 text-sm">
                    <span className="flex min-w-0 flex-1 items-start gap-2.5"><span className="mt-0.5 shrink-0"><Mark ok={row.ok} /></span><span className="min-w-0 text-foreground">{row.text}</span></span>
                    {row.link ? <Link href={row.link.href} className={`${linkClass} shrink-0`}>{row.link.label} ›</Link> : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ③ Nút khóa kỳ */}
          <section aria-label="Khóa kỳ" className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {selected.state === "locked"
                ? <button type="button" aria-expanded={reopening} className={secondaryButtonClass} disabled={busy || !meta.canApprove} onClick={() => setReopening((value) => !value)}>Mở lại kỳ {month}</button>
                : <button type="button" aria-describedby={selected.lockBlockedReason ? "pnl-lock-blocked" : undefined} className={`${primaryButtonClass} disabled:!bg-muted disabled:!text-muted-foreground disabled:!opacity-100`} disabled={busy || !selected.canLock || !meta.canApprove} onClick={lock}>{busy ? "Đang khóa…" : selected.lockButtonText}</button>}
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">{selected.snapshotNote}</p>
            </div>
            {selected.state !== "locked" && selected.lockBlockedReason && selected.lockBlockedByPeriodKey ? (
              <p id="pnl-lock-blocked" className="text-sm text-amber-700">
                {selected.lockBlockedReason}{" "}
                <button type="button" className={linkClass} onClick={() => onPeriodChange(selected.lockBlockedByPeriodKey as string)}>Mở kỳ {formatMonth(selected.lockBlockedByPeriodKey)} ›</button>
              </p>
            ) : null}
            {reopening && selected.state === "locked" ? (
              <form className={`${cardClass} space-y-3 p-4`} onSubmit={(event) => { event.preventDefault(); reopen(); }}>
                <Field label="Lý do mở lại (bắt buộc, lưu cùng người và thời điểm mở)" htmlFor="pnl-reopen-reason"><input id="pnl-reopen-reason" autoFocus value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} /></Field>
                {reopenMonths.length > 1 ? (
                  <div className="text-xs text-amber-700">
                    <p>Các tháng sau mở lại theo. {reopenMonths.length} kỳ sẽ mở lại cùng lúc, mỗi kỳ ghi một dòng lịch sử với cùng lý do:</p>
                    <ul aria-label="Các kỳ sẽ mở lại" className="mt-1 flex flex-wrap gap-1.5">{reopenMonths.map((label) => <li key={label} className="rounded-md border border-amber-300 px-1.5 py-0.5 font-mono font-semibold tabular-nums">{label}</li>)}</ul>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Chỉ kỳ {month} mở lại: sau kỳ này chưa có kỳ nào đã khóa.</p>}
                <div className="flex justify-end gap-2"><button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setReopening(false)}>Hủy</button><button type="submit" className={primaryButtonClass} disabled={busy || !reason.trim()}>{busy ? "Đang mở…" : reopenMonths.length > 1 ? `Mở lại ${reopenMonths.length} kỳ` : "Mở lại kỳ"}</button></div>
              </form>
            ) : null}
            <p className="text-sm text-muted-foreground">{selected.reopenNote}</p>
            <SaveFeedback error={error} message={message} />
          </section>

          {/* ④ Giải thích kỳ */}
          <Strip tone="muted">{selected.explanation}</Strip>

          {/* PL-23: lịch sử khóa – mở lại (bảng yêu cầu có, wireframe không vẽ) */}
          <section className={cardClass}>
            <button type="button" aria-expanded={showHistory} className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setShowHistory((value) => !value)}>
              <span>{showHistory ? "▾" : "▸"} Lịch sử khóa – mở lại kỳ {month} ({selected.history.length})</span>
            </button>
            {showHistory ? (
              <ul className="border-t border-border px-4 py-1 text-sm">
                {selected.history.map((entry, index) => (
                  <li key={`${entry.lockedAt}:${index}`} className="border-b border-border/60 py-2.5 last:border-b-0">
                    <p className="text-foreground">Khóa {formatDay(entry.lockedAt)} · {entry.lockedByName ?? "—"}{entry.reopenedAt ? ` · mở lại ${formatDay(entry.reopenedAt)} · ${entry.reopenedByName ?? "—"} · lý do: ${entry.reopenReason ?? "—"}` : ""}</p>
                    <p className="text-xs text-muted-foreground">Ảnh chụp: {entry.summary.entryCount} giờ log · đã ghi {formatHoursValue(entry.summary.loggedMinutes)} giờ = tính P&amp;L {formatHoursValue(entry.summary.includedMinutes)} + chờ {formatHoursValue(entry.summary.pendingMinutes)} + bị loại {formatHoursValue(entry.summary.excludedMinutes)} · giờ chuẩn {formatHoursValue(entry.summary.standardMinutes)}{meta.moneyVisible ? ` · chi phí nhân sự ${formatDong(entry.summary.staffCostAmount)} đ · quỹ ${formatDong(entry.summary.fundAmount)} đ` : ""}</p>
                  </li>
                ))}
                {!selected.history.length ? <li className="py-3 text-muted-foreground">Kỳ này chưa từng được khóa.</li> : null}
              </ul>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
