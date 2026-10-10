"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { periodLabel, shiftPeriod } from "@/components/pnl/pnl-cost-shared";
import { toVietnamDateKey } from "@/lib/vietnam-time";
import { buildMonthList, formatDay, formatRangeLabel, type DateRange, type DateRangePreset } from "./filter-dates";

// Every filter control borrows CrmSelect's trigger (40px high, same border, radius, background, type).
const TRIGGER = "task-select-trigger";
const ALL_TIME = "Tất cả thời gian";

/** One wrapping row of filters; `onReset` is passed only while a filter differs from its default. */
export function FilterBar({ children, actions, onReset, className = "" }: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  onReset?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      {children}
      {onReset ? <button type="button" onClick={onReset} className="h-10 shrink-0 rounded-lg px-1.5 text-[12px] font-semibold text-primary hover:underline">Đặt lại</button> : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Sizes one control inside a FilterBar and puts the optional label above it. */
export function FilterField({ label, children, className = "min-w-[170px] flex-1" }: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {label ? <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{label}</span> : null}
      {children}
    </div>
  );
}

/**
 * "‹ Tháng mm/yyyy ›" on one line. `months` is the explicit list (YYYY-MM); without it the list
 * runs from 24 months back to 12 months ahead. `value` "" means all time (needs `allowAll`).
 */
export function MonthFilter({ value, onChange, months, allowAll = false, ariaLabel = "Chọn tháng" }: {
  value: string;
  onChange: (month: string) => void;
  months?: string[];
  allowAll?: boolean;
  ariaLabel?: string;
}) {
  const list = useMemo(() => {
    if (months) return [...months].sort((a, b) => b.localeCompare(a));
    const current = toVietnamDateKey(new Date()).slice(0, 7);
    return buildMonthList({ min: shiftPeriod(current, -24), max: shiftPeriod(current, 12), include: [value] });
  }, [months, value]);
  const index = list.indexOf(value);
  const older = index >= 0 ? list[index + 1] : undefined;
  const newer = index > 0 ? list[index - 1] : undefined;
  const step = (target: string | undefined, label: string, icon: React.ReactNode) => (
    <button type="button" aria-label={label} disabled={!target} onClick={() => { if (target) onChange(target); }} className={`${TRIGGER} !w-9 shrink-0 !justify-center !px-0 disabled:!cursor-not-allowed disabled:opacity-40`}>{icon}</button>
  );

  return (
    <div className="inline-flex shrink-0 flex-nowrap items-center gap-1">
      {step(older, "Tháng trước", <ChevronLeft className="h-4 w-4" aria-hidden />)}
      <div className="w-[9.5rem] shrink-0">
        <CrmSelect
          ariaLabel={ariaLabel}
          value={value}
          onChange={onChange}
          options={[...(allowAll ? [{ value: "", label: ALL_TIME }] : []), ...list.map((month) => ({ value: month, label: periodLabel(month) }))]}
        />
      </div>
      {step(newer, "Tháng sau", <ChevronRight className="h-4 w-4" aria-hidden />)}
    </div>
  );
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const dayTime = (day: string) => new Date(`${day}T00:00:00Z`).getTime();

function monthStart(day: string): Date {
  const source = new Date(`${day || toVietnamDateKey(new Date())}T00:00:00Z`);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), 1));
}

function monthDays(month: Date): string[] {
  const start = month.getTime() - ((month.getUTCDay() + 6) % 7) * DAY_MS;
  return Array.from({ length: 42 }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

/**
 * One trigger showing the preset name or "dd/mm/yyyy – dd/mm/yyyy". The popover lists the
 * screen's presets (applied on click) and a calendar for a custom From/To (applied with "Áp dụng").
 */
export function DateRangeFilter({ value, onChange, presets, maxDays, ariaLabel = "Khoảng thời gian" }: {
  value: DateRange;
  onChange: (range: DateRange, presetId?: string) => void;
  presets: DateRangePreset[];
  /** Longest custom range allowed, in days. */
  maxDays?: number;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const [month, setMonth] = useState(() => monthStart(value.from));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const label = formatRangeLabel(value, presets);

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
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
  const apply = (range: DateRange, presetId?: string) => { onChange(range, presetId); close(); };
  const shiftMonth = (delta: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));
  const tooLong = Boolean(maxDays && draft.from && draft.to && (dayTime(draft.to) - dayTime(draft.from)) / DAY_MS >= maxDays);
  const valid = Boolean(draft.from && draft.to && draft.from <= draft.to) && !tooLong;

  return (
    <div ref={rootRef} className="relative min-w-[15rem]">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${ariaLabel}: ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-open={open ? "true" : "false"}
        className={TRIGGER}
        onClick={() => {
          if (!open) { setDraft(value); setMonth(monthStart(value.from)); }
          setOpen(!open);
        }}
      >
        <span className="task-select-current min-w-0"><CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><span className="task-select-value">{label}</span></span>
        <ChevronDown className="task-select-chevron h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div ref={popoverRef} role="dialog" aria-modal="false" aria-label={ariaLabel} className="absolute left-0 top-full z-[1200] mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 shadow-lg">
          <div className="max-h-40 overflow-y-auto border-b border-border pb-2">
            {presets.map((preset) => {
              const selected = preset.from === value.from && preset.to === value.to;
              return <button key={preset.id} type="button" aria-pressed={selected} data-selected={selected ? "true" : "false"} className="task-select-option" onClick={() => apply({ from: preset.from, to: preset.to }, preset.id)}><span className="task-select-option-label block">{preset.label}</span></button>;
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" aria-label="Tháng trước" onClick={() => shiftMonth(-1)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <p id={headingId} className="text-sm font-bold text-foreground">{periodLabel(month.toISOString().slice(0, 7))}</p>
            <button type="button" aria-label="Tháng sau" onClick={() => shiftMonth(1)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div aria-hidden className="mt-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
            {WEEKDAYS.map((day) => <span key={day} className="py-1">{day}</span>)}
          </div>
          <div role="group" aria-labelledby={headingId} className="grid grid-cols-7 gap-1">
            {monthDays(month).map((day) => {
              const inMonth = day.slice(0, 7) === month.toISOString().slice(0, 7);
              const selected = day === draft.from || day === draft.to;
              const inRange = Boolean(draft.from && draft.to && day > draft.from && day < draft.to);
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={formatDay(day)}
                  aria-pressed={selected}
                  onClick={() => setDraft(!draft.from || draft.to ? { from: day, to: "" } : day < draft.from ? { from: day, to: "" } : { from: draft.from, to: day })}
                  className={`h-9 rounded-lg text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? "bg-primary font-bold text-primary-foreground" : inRange ? "bg-primary/10 text-primary" : inMonth ? "text-foreground hover:bg-muted" : "text-muted-foreground/50 hover:bg-muted"}`}
                >
                  {Number(day.slice(-2))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Từ {draft.from ? formatDay(draft.from) : "…"} đến hết ngày {draft.to ? formatDay(draft.to) : "…"}</p>
          {tooLong ? <p role="alert" className="mt-1 text-[11px] text-destructive">Khoảng ngày tối đa là {maxDays} ngày.</p> : null}
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2">
            <button type="button" onClick={close} className="min-h-9 rounded-lg px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
            <button type="button" disabled={!valid} onClick={() => apply(draft)} className="min-h-9 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-40">Áp dụng</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Bộ lọc nâng cao (n)" toggle for a FilterBar: the extra filters open as a full-width row
 * under the bar, so their dropdowns are never clipped by a popover.
 */
export function AdvancedFilters({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(count > 0);
  const panelId = useId();
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={panelId} data-open={open ? "true" : "false"} onClick={() => setOpen(!open)} className={`${TRIGGER} !w-auto shrink-0`}>
        <span className="task-select-current"><SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><span className="task-select-value">Bộ lọc nâng cao{count > 0 ? ` (${count})` : ""}</span></span>
      </button>
      {open ? <div id={panelId} role="group" aria-label="Bộ lọc nâng cao" className="order-last flex w-full flex-wrap items-end gap-2 border-t border-border pt-2">{children}</div> : null}
    </>
  );
}
