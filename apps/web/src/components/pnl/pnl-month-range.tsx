"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { inputClass, labelClass } from "./pnl-cost-shared";
import { formatMonth, monthRangeLabel } from "./pnl-format";

/**
 * "Từ mm/yyyy đến mm/yyyy ▾" — one control for a month range (mục 5 khối 1), built like DateRangeFilter in
 * filters/filter-controls.tsx: one trigger, a popover with the two months, applied with "Áp dụng".
 * Escape and "Hủy" close it and give the focus back to the trigger.
 */
export function MonthRangePicker({ months, from, to, active = false, onApply, ariaLabel = "Thu hẹp theo tháng" }: Readonly<{
  /** The months that can be picked (YYYY-MM), oldest first. */
  months: string[];
  from: string;
  to: string;
  /** The range is the scope in force (drawn like a pressed toggle). */
  active?: boolean;
  onApply: (from: string, to: string) => void;
  ariaLabel?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLSelectElement>(null);
  const fromId = useId();
  const toId = useId();

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const valid = draft.from <= draft.to;
  const label = monthRangeLabel(from, to);
  const option = (month: string) => <option key={month} value={month}>{formatMonth(month)}</option>;

  return (
    <div ref={rootRef} className="relative w-[15.5rem] max-w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${ariaLabel}: ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-open={open ? "true" : "false"}
        className={`task-select-trigger ${active ? "!border-primary/50 !bg-primary/10 !text-primary" : ""}`}
        onClick={() => { if (!open) setDraft({ from, to }); setOpen(!open); }}
      >
        <span className="task-select-current min-w-0"><CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><span className="task-select-value">{label}</span></span>
        <ChevronDown className="task-select-chevron h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <form
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-[1200] mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 shadow-lg"
          onSubmit={(event) => { event.preventDefault(); if (!valid) return; onApply(draft.from, draft.to); close(); }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={fromId} className={labelClass}>Từ tháng</label>
              <select ref={firstRef} id={fromId} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} className={inputClass}>{months.map(option)}</select>
            </div>
            <div>
              <label htmlFor={toId} className={labelClass}>Đến tháng</label>
              <select id={toId} value={draft.to} aria-invalid={!valid} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className={inputClass}>{months.map(option)}</select>
            </div>
          </div>
          {valid ? null : <p role="alert" className="mt-2 text-[11px] text-destructive">Đến tháng phải từ {formatMonth(draft.from)} trở đi.</p>}
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2">
            <button type="button" onClick={close} className="min-h-9 rounded-lg px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
            <button type="submit" disabled={!valid} className="min-h-9 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-40">Áp dụng</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
