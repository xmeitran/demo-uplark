"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { ModalLayer } from "@/components/modal-layer";
import { cardClass, primaryButtonClass, secondaryButtonClass } from "./pnl-ui";

/**
 * What the P&L setup / data-entry screens (mục 6.1–6.7) add to pnl-ui.tsx: the save flow, dialogs, strips and the
 * denser table of the settings tabs. Cards, buttons, the API client and the load hook are pnl-ui's.
 */

export const tableHeadClass = "border-b border-border bg-muted/30 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
export const tableCellClass = "border-b border-border/70 px-4 py-3 text-sm text-foreground";
export const numberCellClass = `${tableCellClass} text-right font-mono tabular-nums`;
export const smallButton = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50";
export const linkClass = "font-semibold !text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
export const toneClass = { ok: "text-emerald-700", warn: "text-amber-700", info: "text-sky-700", muted: "text-muted-foreground" } as const;

/** Runs one write, then re-reads the screen from the API; the API's message is shown on failure. */
export function useSave(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await action();
      await reload();
      if (done) setMessage(done);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được.");
      return false;
    } finally { setBusy(false); }
  }, [reload]);
  return { busy, error, message, run, clear: () => { setError(null); setMessage(null); } };
}

export function LoadingBlock({ rows = 4, label = "Đang tải…" }: Readonly<{ rows?: number; label?: string }>) {
  return (
    <div role="status" aria-label={label} className={`${cardClass} space-y-3 p-4`}>
      {Array.from({ length: rows }, (_, index) => <div key={index} className="h-9 animate-pulse rounded-lg bg-muted" style={{ width: `${100 - index * 9}%` }} />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SaveFeedback({ error, message }: Readonly<{ error: string | null; message: string | null }>) {
  return (
    <>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{message}</p> : null}
    </>
  );
}

/** The wireframes' full-width bars: amber = cảnh báo / việc còn thiếu, muted = ghi chú cố định. */
export function Strip({ tone = "muted", children, action }: Readonly<{ tone?: "warn" | "muted" | "ok"; children: ReactNode; action?: ReactNode }>) {
  const tones = { warn: "border-amber-300 bg-amber-50 text-amber-900", muted: "border-border bg-muted/50 text-foreground", ok: "border-emerald-200 bg-emerald-50 text-emerald-900" };
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-4 py-2.5 text-sm ${tones[tone]}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function ReadOnlyNote({ children }: Readonly<{ children: ReactNode }>) {
  return <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

/** ✓ (xanh lá) / ✕ (cam) of the checklists and comparison tables, with a text alternative. */
export function Mark({ ok, okLabel = "Đạt", failLabel = "Chưa đạt" }: Readonly<{ ok: boolean; okLabel?: string; failLabel?: string }>) {
  return ok
    ? <span className="inline-flex text-emerald-600"><Check className="h-4 w-4" aria-hidden /><span className="sr-only">{okLabel}</span></span>
    : <span className="inline-flex text-amber-600"><X className="h-4 w-4" aria-hidden /><span className="sr-only">{failLabel}</span></span>;
}

export function Field({ label, htmlFor, children, hint }: Readonly<{ label: string; htmlFor?: string; children: ReactNode; hint?: string }>) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Dialog on the app's ModalLayer: focus goes to the first field, Escape and the backdrop close it, Enter submits.
 * The body does not scroll (a select's menu must be able to overflow it); long lists scroll inside their own box.
 */
export function PnlModal({ title, onClose, onSubmit, children, footer, wide = false }: Readonly<{ title: string; onClose: () => void; onSubmit?: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }>) {
  return (
    <ModalLayer initialFocusSelector="form input:not([disabled]), form textarea:not([disabled]), form button[aria-haspopup]" onClose={onClose}>
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-2xl border border-border bg-card shadow-2xl`} onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between rounded-t-2xl border-b border-border bg-muted/20 px-5 py-3.5">
            <h2 className="!text-base font-bold text-foreground">{title}</h2>
            <button type="button" aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onClose}><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
            <div className="space-y-4 p-5">{children}</div>
            {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div> : null}
          </form>
        </div>
      </div>
    </ModalLayer>
  );
}

export function ModalActions({ onCancel, busy, disabled, submitLabel }: Readonly<{ onCancel: () => void; busy: boolean; disabled?: boolean; submitLabel: string }>) {
  return (
    <>
      <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>Hủy</button>
      <button type="submit" className={primaryButtonClass} disabled={busy || disabled}>{busy ? "Đang lưu…" : submitLabel}</button>
    </>
  );
}
