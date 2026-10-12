"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import type { PnlResult, PnlResultLabelCode } from "@b2b-crm/contracts";

/*
 * Shared look and plumbing of every P&L screen: the Projects page's cards and buttons, the one API client and the one
 * load hook. Report-only pieces (tiles, table classes, result badge) follow; setup-only pieces are in pnl-setup-ui.tsx.
 */
export const cardClass = "rounded-xl border border-border bg-card shadow-sm";
export const thClass = "border-b border-border px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
export const thNumberClass = `${thClass} !text-right`;
export const tdClass = "border-b border-border/70 px-4 py-3 text-sm text-foreground";
export const tdNumberClass = `${tdClass} text-right font-mono tabular-nums whitespace-nowrap`;
export const sectionTitleClass = "!text-base font-bold text-foreground";
export const mutedNoteClass = "text-xs text-muted-foreground";
export const secondaryButtonClass = "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButtonClass = "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const okTextClass = "font-semibold text-emerald-700";
export const warnTextClass = "font-semibold text-amber-700";

export class PnlApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Calls the P&L BFF. A failed call throws PnlApiError carrying the status and the API's own Vietnamese message;
 * `fallback` names the action when the API sent none.
 */
export async function pnlRequest<T>(url: string, init?: { method?: string; body?: unknown }, fallback?: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (response.status === 401) {
    window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new PnlApiError(401, "Phiên đăng nhập đã hết hạn.");
  }
  const payload = (await response.json().catch(() => ({}))) as { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(payload.message) ? payload.message.join("; ") : payload.message;
    throw new PnlApiError(response.status, message || (response.status === 403 ? "Tài khoản của bạn không có quyền thực hiện việc này." : fallback ?? `Không tải được dữ liệu (lỗi ${response.status}).`));
  }
  return payload as T;
}

export interface PnlLoad<T> {
  data: T | null;
  error: PnlApiError | null;
  /** True while a request is in flight; `data` keeps the previous answer meanwhile so the screen does not blank. */
  loading: boolean;
  /** Resolves once the re-read has landed, so a save can wait for the screen to show its result. */
  reload: () => Promise<void>;
}

/** GET `url` whenever it changes (null = do not load). */
export function usePnlLoad<T>(url: string | null, fallback?: string): PnlLoad<T> {
  const [state, setState] = useState<{ data: T | null; error: PnlApiError | null; loading: boolean }>({ data: null, error: null, loading: Boolean(url) });
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const request = ++latest.current;
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await pnlRequest<T>(url, undefined, fallback);
      if (request === latest.current) setState({ data, error: null, loading: false });
    } catch (reason) {
      if (request === latest.current) setState((current) => ({ data: current.data, error: reason instanceof PnlApiError ? reason : new PnlApiError(0, "Không kết nối được máy chủ."), loading: false }));
    }
  }, [url, fallback]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

const RESULT_CLASS: Record<PnlResultLabelCode, string> = {
  official: "border-emerald-300 bg-emerald-50 text-emerald-700",
  provisional: "border-amber-300 bg-amber-50 text-amber-800",
  not_computable: "border-border bg-muted/50 text-muted-foreground"
};

export const RESULT_TEXT_CLASS: Record<PnlResultLabelCode, string> = {
  official: "text-emerald-700",
  provisional: "text-amber-700",
  not_computable: "text-muted-foreground"
};

const RESULT_NAME: Record<PnlResultLabelCode, string> = { official: "Chính thức", provisional: "Tạm tính", not_computable: "Không tính được" };

/** Chính thức / Tạm tính / Không tính được. Hovering (or focusing) lists the reasons. */
export function ResultBadge({ result, large = false }: Readonly<{ result: PnlResult; large?: boolean }>) {
  const reasons = result.reasons.map((reason) => reason.label).join(" · ");
  return (
    <span
      title={reasons || undefined}
      tabIndex={reasons ? 0 : undefined}
      aria-label={reasons ? `${RESULT_NAME[result.label]}: ${reasons}` : undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-full border font-semibold ${large ? "min-w-[7.5rem] px-4 py-1.5 text-xs" : "min-w-[6.5rem] px-3 py-1 text-[11px]"} ${RESULT_CLASS[result.label]}`}
    >
      {RESULT_NAME[result.label]}
    </span>
  );
}

/** KPI tile as on the Projects page: 11px uppercase label, mono value, one sub-note. */
export function Tile({ label, value, unit, note, noteClass = "text-muted-foreground", title }: Readonly<{
  label: string;
  value: ReactNode;
  /** Shown small after the value ("giờ"), so five tiles still fit a 1024px screen. */
  unit?: string;
  note?: ReactNode;
  noteClass?: string;
  title?: string;
}>) {
  return (
    <div className={`${cardClass} min-w-0 p-4`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p title={title} className="mt-2 break-words font-mono text-xl font-bold tabular-nums text-foreground xl:text-2xl">
        {value}
        {unit ? <span className="ml-1 font-sans text-sm font-semibold">{unit}</span> : null}
      </p>
      {note ? <p className={`mt-1 text-xs ${noteClass}`}>{note}</p> : null}
    </div>
  );
}

/** Small grey tile of khối 4 and 6; a button when `onClick` is given. */
export function MiniTile({ label, value, note, pressed, expanded, onClick, title }: Readonly<{
  label: string;
  value: ReactNode;
  note?: ReactNode;
  pressed?: boolean;
  expanded?: boolean;
  onClick?: () => void;
  title?: string;
}>) {
  const body = (
    <>
      <span className="block truncate text-xs text-muted-foreground">{label}</span>
      <span className="mt-0.5 block font-mono text-sm font-bold tabular-nums text-foreground">{value}</span>
      {note ? <span className="mt-0.5 block text-[11px] font-medium text-amber-700">{note}</span> : null}
    </>
  );
  const active = pressed || expanded;
  const className = `min-w-0 rounded-lg border px-3 py-2 text-left ${active ? "border-primary bg-primary/10" : "border-border bg-muted/40"}`;
  if (!onClick) return <div title={title} className={className}>{body}</div>;
  return (
    <button type="button" title={title} aria-pressed={pressed} aria-expanded={expanded} onClick={onClick} className={`${className} transition-colors hover:border-primary/50`}>
      {body}
    </button>
  );
}

/** Joined two-or-more-way switch (Năm | H1/H2 | Quý | Tháng; Nhóm hạch toán | Vai trò). */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: Readonly<{
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}>) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex h-10 shrink-0 items-stretch rounded-lg border border-border bg-card p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 text-[13px] font-semibold transition-colors ${selected ? "bg-primary/10 text-primary ring-1 ring-primary/40" : "text-muted-foreground hover:text-foreground"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs with arrow-key navigation (WAI-ARIA tabs). Panel id = `${idPrefix}-panel`. */
export function Tabs<T extends string>({ value, tabs, onChange, ariaLabel, idPrefix }: Readonly<{
  value: T;
  tabs: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  idPrefix: string;
}>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const position = tabs.findIndex((tab) => tab.value === value);
    const next = tabs[(position + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-tab-${next.value}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className="flex flex-wrap gap-x-6 border-b border-border px-4">
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            id={`${idPrefix}-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`-mb-px border-b-2 py-3 text-sm ${selected ? "border-primary font-bold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** Amber strip with a "… ›" action on the right (khối 3 of Tổng quan). */
export function WarningStrip({ children, action }: Readonly<{ children: ReactNode; action?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="min-w-0">{children}</p>
      {action}
    </div>
  );
}

export const warningActionClass = "inline-flex shrink-0 items-center rounded-lg border border-amber-400 bg-card px-3 py-1.5 text-xs font-semibold !text-amber-800 transition-colors hover:bg-amber-100";

export function PnlSkeleton({ rows = 3 }: Readonly<{ rows?: number }>) {
  return (
    <div role="status" aria-label="Đang tải số liệu P&L" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className={`${cardClass} h-[104px] animate-pulse bg-muted/40`} />)}
      </div>
      {Array.from({ length: rows }, (_, index) => <div key={index} className={`${cardClass} h-40 animate-pulse bg-muted/40`} />)}
    </div>
  );
}

/**
 * Error with the API's message and a retry. 403 is the no-permission state (User accounts do not enter the P&L tab);
 * a screen with a narrower rule says so in `forbiddenText` ("Chỉ nhóm quyền chi phí mở được màn này.").
 */
export function PnlLoadError({ error, onRetry, forbiddenText }: Readonly<{ error: PnlApiError; onRetry: () => unknown; forbiddenText?: string }>) {
  if (error.status === 403) {
    return (
      <div role="status" className={`${cardClass} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
        <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-bold text-foreground">{forbiddenText ?? "Bạn chưa có quyền xem tab P&L"}</p>
        {forbiddenText ? null : <p className="max-w-xl text-sm text-muted-foreground">Tab P&amp;L chỉ mở cho tài khoản Admin; doanh thu, chi phí, cost rate chỉ hiện với nhóm quyền chi phí. Liên hệ Admin nếu bạn cần quyền này.</p>}
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
      <span className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{error.message}</span>
      <button type="button" onClick={() => void onRetry()} className="rounded-lg border border-red-300 bg-card px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">Thử lại</button>
    </div>
  );
}

/** Admin outside the cost permission group: every money field is null, so say why the cells read "—". */
export function MoneyHiddenNote() {
  return (
    <p role="note" className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      Bạn không thuộc nhóm quyền chi phí: doanh thu, chi phí, cost rate và biên không hiển thị (ghi “—”). Giờ và trạng thái dữ liệu vẫn xem được.
    </p>
  );
}

export function EmptyRow({ colSpan, children }: Readonly<{ colSpan: number; children: ReactNode }>) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</td>
    </tr>
  );
}

/** "P&L › …" bar of both wireframes: title on the left, the unit note on the right. */
export function PnlPageHeader({ crumb, unitNote, action }: Readonly<{ crumb?: string; unitNote: string; action?: ReactNode }>) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="!text-xl font-bold text-foreground">
        {crumb ? <Link href="/pnl" className="!text-foreground hover:!text-primary">P&amp;L</Link> : "P&L"}
        <span className="mx-1.5 text-muted-foreground">›</span>
        {crumb ?? "Tổng quan"}
      </h1>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{unitNote}</span>
        {action}
      </div>
    </header>
  );
}
