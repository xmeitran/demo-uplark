"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";
import type { AnalyticsFilterOption, WorkforceProjectsSummaryResponse } from "@b2b-crm/contracts";
import {
  exclusiveEndDateToInclusiveEndDate,
  inclusiveEndDateToExclusiveEndDate,
  resolvePresetRange,
  type AnalyticsUiState
} from "@/lib/analytics-url-state";
import { businessStatusLabel } from "./analytics-copy";

const PRESET_OPTIONS: Array<{ id: AnalyticsUiState["preset"]; label: string }> = [
  { id: "7d", label: "7 ngày gần nhất" },
  { id: "30d", label: "30 ngày gần nhất" },
  { id: "90d", label: "90 ngày gần nhất" },
  { id: "month", label: "Tháng này" },
  { id: "quarter", label: "Quý này" },
  { id: "custom", label: "Chọn khoảng ngày" }
];

const GRAIN_OPTIONS: Array<{ id: AnalyticsUiState["grain"]; label: string }> = [
  { id: "day", label: "Theo ngày" },
  { id: "week", label: "Theo tuần" },
  { id: "month", label: "Theo tháng" }
];

const BILLABLE_OPTIONS: Array<{ id: AnalyticsUiState["billable"]; label: string }> = [
  { id: "all", label: "Tất cả loại giờ" },
  { id: "billable", label: "Có tính phí" },
  { id: "non_billable", label: "Không tính phí" }
];

const DAY_MS = 86_400_000;
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function addDateDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function formatDate(value?: string): string {
  if (!value) return "Chưa chọn";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function monthStart(value?: string): Date {
  const source = value ? new Date(`${value}T00:00:00Z`) : new Date();
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), 1));
}

function monthDays(month: Date): string[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - mondayOffset * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY_MS).toISOString().slice(0, 10));
}

function useDismissable(open: boolean, onDismiss: () => void, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [containerRef, onDismiss, open]);
}

function SingleSelect<T extends string>({ label, value, options, onChange, inline = false }: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const close = () => setOpen(false);
  useDismissable(open, close, containerRef);
  const selectedLabel = options.find((option) => option.id === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${inline ? "w-full" : ""}`}>
      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            window.requestAnimationFrame(() => document.getElementById(listId)?.querySelector<HTMLElement>('[role="option"]')?.focus());
          }
        }}
        className={`inline-flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-left text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${inline ? "w-full" : "min-w-32"}`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <div id={listId} role="listbox" aria-label={label} className={`${inline ? "relative mt-1" : "absolute left-0 top-full z-50 mt-1"} min-w-full overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg`}>
          {options.map((option, optionIndex) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              onKeyDown={(event) => {
                const optionElements = Array.from(document.getElementById(listId)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  optionElements[Math.min(optionIndex + 1, optionElements.length - 1)]?.focus();
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  optionElements[Math.max(optionIndex - 1, 0)]?.focus();
                }
              }}
              className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[13px] text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {option.label}
              {option.id === value ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MultiSelect({ label, options, selected, onApply, provisional, inline = false, mapLabel }: {
  label: string;
  options: AnalyticsFilterOption[];
  selected: string[];
  onApply: (ids: string[]) => void;
  provisional?: boolean;
  inline?: boolean;
  mapLabel?: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const cancel = () => {
    setDraft(selected);
    setSearch("");
    setOpen(false);
  };
  useDismissable(open, cancel, containerRef);

  useEffect(() => {
    if (!open) setDraft(selected);
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => searchRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, selected]);

  const visible = options
    .filter((option) => option.label.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")))
    .slice(0, 50);
  const labelOf = (option: AnalyticsFilterOption) => mapLabel ? mapLabel(option.label) : option.label;

  return (
    <div ref={containerRef} className={`relative ${inline ? "w-full" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex min-h-10 items-center justify-between gap-2 rounded-lg border px-3 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected.length > 0 ? "border-primary/40 bg-primary/5 text-primary" : "border-border bg-card text-foreground hover:bg-muted"} ${inline ? "w-full" : ""}`}
      >
        <span className="truncate">{label}</span>
        <span className="inline-flex items-center gap-1.5">
          {selected.length > 0 ? <span className="rounded-full bg-primary/10 px-1.5 font-mono text-[10px]">{selected.length}</span> : null}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
      {open ? (
        <div className={`${inline ? "relative mt-1" : "absolute left-0 top-full z-50 mt-1"} w-full min-w-72 rounded-xl border border-border bg-popover p-2 shadow-lg`}>
          {provisional ? (
            <p className="mb-2 rounded-lg bg-warning/10 px-2 py-1.5 text-[11px] leading-snug text-warning">
              Danh sách đang được bổ sung; xem mức đầy đủ dữ liệu bên dưới báo cáo.
            </p>
          ) : null}
          <label className="relative block">
            <span className="sr-only">Tìm {label.toLocaleLowerCase("vi")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              aria-label={`Tìm ${label}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  document.getElementById(listId)?.querySelector<HTMLElement>('[role="option"]')?.focus();
                }
              }}
              placeholder={`Tìm ${label.toLocaleLowerCase("vi")}…`}
              className="min-h-10 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            />
          </label>
          <div className="my-1.5 flex items-center gap-1 border-b border-border pb-1.5">
            <button type="button" onClick={() => setDraft(options.map((option) => option.id))} className="rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10">Chọn tất cả</button>
            <button type="button" onClick={() => setDraft([])} className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted">Bỏ chọn</button>
            <span className="ml-auto text-[11px] text-muted-foreground">Đã chọn {draft.length}</span>
          </div>
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-56 space-y-0.5 overflow-y-auto">
            {visible.length === 0 ? <li className="px-2 py-3 text-[12px] text-muted-foreground">Không có lựa chọn phù hợp.</li> : null}
            {visible.map((option) => {
              const checked = draft.includes(option.id);
              return (
                <li key={option.id} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => setDraft((current) => current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id])}
                    className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{labelOf(option)}</span>
                    {option.count !== undefined ? <span className="font-mono text-[10px] text-muted-foreground">{option.count}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
            <button type="button" onClick={() => { cancel(); triggerRef.current?.focus(); }} className="min-h-9 rounded-lg px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
            <button type="button" onClick={() => { onApply(draft); setOpen(false); setSearch(""); triggerRef.current?.focus(); }} className="min-h-9 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground">Áp dụng</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateRangePicker({ from, toExclusive, onApply, inline = false }: {
  from?: string;
  toExclusive?: string;
  onApply: (from: string, toExclusive: string) => void;
  inline?: boolean;
}) {
  const initialEnd = toExclusive ? exclusiveEndDateToInclusiveEndDate(toExclusive) : undefined;
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(initialEnd);
  const [month, setMonth] = useState(() => monthStart(from));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const cancel = () => {
    setDraftFrom(from);
    setDraftTo(toExclusive ? exclusiveEndDateToInclusiveEndDate(toExclusive) : undefined);
    setOpen(false);
  };
  useDismissable(open, cancel, containerRef);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [from, open, toExclusive]);

  const days = useMemo(() => monthDays(month), [month]);
  const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
  const valid = Boolean(draftFrom && draftTo && draftFrom <= draftTo && (new Date(`${draftTo}T00:00:00Z`).getTime() - new Date(`${draftFrom}T00:00:00Z`).getTime()) / DAY_MS < 366);

  return (
    <div ref={containerRef} className={`relative ${inline ? "w-full" : ""}`}>
      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Khoảng ngày</span>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${inline ? "w-full" : "min-w-64"}`}
      >
        <span>{formatDate(from)} – {formatDate(initialEnd)}</span>
        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <div role="dialog" aria-modal="false" aria-labelledby={headingId} className={`${inline ? "relative mt-1" : "absolute left-0 top-full z-50 mt-1"} w-full min-w-[19rem] rounded-xl border border-border bg-popover p-3 shadow-lg`}>
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Tháng trước" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <h3 id={headingId} className="text-sm font-bold capitalize text-foreground">{monthLabel}</h3>
            <button type="button" aria-label="Tháng sau" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
            {WEEKDAYS.map((day) => <span key={day} className="py-1">{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const inMonth = new Date(`${day}T00:00:00Z`).getUTCMonth() === month.getUTCMonth();
              const selected = day === draftFrom || day === draftTo;
              const inRange = Boolean(draftFrom && draftTo && day > draftFrom && day < draftTo);
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={formatDate(day)}
                  aria-pressed={selected}
                  onClick={() => {
                    if (!draftFrom || draftTo) {
                      setDraftFrom(day);
                      setDraftTo(undefined);
                    } else if (day < draftFrom) {
                      setDraftFrom(day);
                    } else {
                      setDraftTo(day);
                    }
                  }}
                  className={`h-9 rounded-lg text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? "bg-primary font-bold text-primary-foreground" : inRange ? "bg-primary/10 text-primary" : inMonth ? "text-foreground hover:bg-muted" : "text-muted-foreground/50 hover:bg-muted"}`}
                >
                  {Number(day.slice(-2))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Từ {formatDate(draftFrom)} đến hết ngày {formatDate(draftTo)}.</p>
          {!valid && draftFrom && draftTo ? <p className="mt-1 text-[11px] text-destructive">Khoảng ngày tối đa là 366 ngày.</p> : null}
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2">
            <button type="button" onClick={() => { cancel(); triggerRef.current?.focus(); }} className="min-h-9 rounded-lg px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
            <button type="button" disabled={!valid} onClick={() => {
              const exclusiveEnd = draftTo ? inclusiveEndDateToExclusiveEndDate(draftTo) : undefined;
              if (draftFrom && exclusiveEnd) onApply(draftFrom, exclusiveEnd);
              setOpen(false);
              triggerRef.current?.focus();
            }} className="min-h-9 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-40">Áp dụng</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdvancedFilters({ children, count }: { children: React.ReactNode; count: number }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useDismissable(open, close, containerRef);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Phạm vi khác</span>
      <button ref={triggerRef} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden /> Thêm bộ lọc
        {count > 0 ? <span className="rounded-full bg-primary/10 px-1.5 font-mono text-[10px] text-primary">{count}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Bộ lọc bổ sung" className="absolute right-0 top-full z-40 mt-1 grid w-[min(44rem,calc(100vw-4rem))] grid-cols-2 gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg xl:grid-cols-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function AnalyticsFilterControls({ state, summary, onChange, onReset, onCopyLink, onExportCsv, copied, csvReady, mode = "desktop" }: {
  state: AnalyticsUiState;
  summary?: WorkforceProjectsSummaryResponse;
  onChange: (change: Partial<AnalyticsUiState>) => void;
  onReset: () => void;
  onCopyLink: () => void;
  onExportCsv: () => void;
  copied: boolean;
  csvReady: boolean;
  mode?: "desktop" | "mobile";
}) {
  const options = summary?.filterOptions;
  const inline = mode === "mobile";
  const projectOptions = (options?.projects ?? []).filter((project) => state.accountIds.length === 0 || Boolean(project.parentId && state.accountIds.includes(project.parentId)));
  const advancedCount = state.departmentIds.length + state.teamIds.length + state.userIds.length + state.projectStatuses.length + state.taskStatuses.length + state.workTypes.length + state.taskTypeLayer1Ids.length + state.taskTypeLayer2Ids.length + (state.billable === "all" ? 0 : 1);
  const advanced = (
    <>
      <MultiSelect inline={inline} label="Phòng ban" options={options?.departments ?? []} selected={state.departmentIds} onApply={(departmentIds) => onChange({ departmentIds })} provisional />
      <MultiSelect inline={inline} label="Nhóm" options={options?.teams ?? []} selected={state.teamIds} onApply={(teamIds) => onChange({ teamIds })} provisional />
      <MultiSelect inline={inline} label="Nhân sự" options={options?.users ?? []} selected={state.userIds} onApply={(userIds) => onChange({ userIds })} />
      <MultiSelect inline={inline} label="Trạng thái dự án" options={options?.projectStatuses ?? []} selected={state.projectStatuses} onApply={(projectStatuses) => onChange({ projectStatuses })} mapLabel={businessStatusLabel} />
      <MultiSelect inline={inline} label="Trạng thái công việc" options={options?.taskStatuses ?? []} selected={state.taskStatuses} onApply={(taskStatuses) => onChange({ taskStatuses })} mapLabel={businessStatusLabel} />
      <MultiSelect inline={inline} label="Loại công việc" options={options?.workTypes ?? []} selected={state.workTypes} onApply={(workTypes) => onChange({ workTypes })} mapLabel={businessStatusLabel} />
      <MultiSelect inline={inline} label="Task Type · Nhóm" options={options?.taskTypeLayer1 ?? []} selected={state.taskTypeLayer1Ids} onApply={(taskTypeLayer1Ids) => onChange({ taskTypeLayer1Ids })} />
      <MultiSelect inline={inline} label="Task Type · Bối cảnh" options={options?.taskTypeLayer2 ?? []} selected={state.taskTypeLayer2Ids} onApply={(taskTypeLayer2Ids) => onChange({ taskTypeLayer2Ids })} />
      <SingleSelect inline={inline} label="Loại giờ" value={state.billable} options={BILLABLE_OPTIONS} onChange={(billable) => onChange({ billable })} />
    </>
  );

  return (
    <div className={`rounded-xl border border-border bg-card p-3 ${inline ? "space-y-3" : "flex flex-wrap items-end gap-2"}`}>
      <div className={inline ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "contents"}>
        <SingleSelect inline={inline} label="Thời gian" value={state.preset} options={PRESET_OPTIONS} onChange={(preset) => {
          if (preset === "custom") {
            const currentRange = resolvePresetRange(state);
            onChange({ preset, from: currentRange.from, to: currentRange.to });
          } else {
            onChange({ preset });
          }
        }} />
        {state.preset === "custom" ? <DateRangePicker inline={inline} from={state.from} toExclusive={state.to} onApply={(from, to) => onChange({ preset: "custom", from, to })} /> : null}
        <SingleSelect inline={inline} label="Mức tổng hợp" value={state.grain} options={GRAIN_OPTIONS} onChange={(grain) => onChange({ grain })} />
        <MultiSelect inline={inline} label="Khách hàng" options={options?.accounts ?? []} selected={state.accountIds} onApply={(accountIds) => {
          const validProjects = state.projectIds.filter((projectId) => {
            const project = (options?.projects ?? []).find((item) => item.id === projectId);
            return accountIds.length === 0 || Boolean(project?.parentId && accountIds.includes(project.parentId));
          });
          onChange({ accountIds, projectIds: validProjects });
        }} />
        <MultiSelect inline={inline} label="Dự án" options={projectOptions} selected={state.projectIds.filter((id) => projectOptions.some((project) => project.id === id))} onApply={(projectIds) => onChange({ projectIds })} />
        <label className={`flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-[12px] font-semibold text-foreground ${inline ? "w-full" : "mb-0"}`}>
          <input type="checkbox" checked={state.compare === "previous"} onChange={(event) => onChange({ compare: event.target.checked ? "previous" : "none" })} className="h-4 w-4 accent-[var(--color-primary)]" />
          So sánh với kỳ trước
        </label>
      </div>

      {inline ? <div className="grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-2">{advanced}</div> : <AdvancedFilters count={advancedCount}>{advanced}</AdvancedFilters>}

      <div className={`flex flex-wrap items-center gap-1.5 ${inline ? "border-t border-border pt-3" : "ml-auto"}`}>
        {!inline ? <button type="button" onClick={onReset} className="min-h-10 rounded-lg border border-border px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Đặt lại</button> : null}
        <button type="button" onClick={onCopyLink} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Đã sao chép" : "Sao chép đường dẫn"}
        </button>
        <button type="button" onClick={onExportCsv} disabled={!csvReady} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
          <Download className="h-3.5 w-3.5" aria-hidden /> Xuất dữ liệu
        </button>
      </div>
    </div>
  );
}
