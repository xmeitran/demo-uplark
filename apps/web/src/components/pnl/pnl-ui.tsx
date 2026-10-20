"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Check, CircleHelp, Lock, type LucideIcon } from "lucide-react";
import type { PnlResult, PnlResultLabelCode } from "@b2b-crm/contracts";
import { NO_VALUE } from "./pnl-format";
import { RESULT_NAME, resultExplanation } from "./pnl-plain";

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
  const [state, setState] = useState<{ data: T | null; dataUrl: string | null; error: PnlApiError | null; loading: boolean }>({ data: null, dataUrl: null, error: null, loading: Boolean(url) });
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const request = ++latest.current;
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await pnlRequest<T>(url, undefined, fallback);
      if (request === latest.current) setState({ data, dataUrl: url, error: null, loading: false });
    } catch (reason) {
      // A failed re-read of the SAME view keeps its figures next to the error; a failed read of another view (another
      // period, scope or filter) drops them, so the controls never sit above numbers of a different selection.
      if (request === latest.current) setState((current) => ({ data: current.dataUrl === url ? current.data : null, dataUrl: current.dataUrl === url ? url : null, error: reason instanceof PnlApiError ? reason : new PnlApiError(0, "Không kết nối được máy chủ."), loading: false }));
    }
  }, [url, fallback]);
  useEffect(() => { void reload(); }, [reload]);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/**
 * A search box whose text lives in the URL: typing is local, `commit` runs once the viewer pauses, and a value that
 * changes from elsewhere (Đặt lại, back/forward) replaces what is shown — but never text still being typed.
 */
export function useDebouncedText(value: string, commit: (text: string) => void, delayMs = 350): [string, (text: string) => void] {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(value); } }, [value]);
  useEffect(() => {
    const next = text.trim();
    if (next === sent.current) return;
    const timer = window.setTimeout(() => { sent.current = next; latestCommit.current(next); }, delayMs);
    return () => window.clearTimeout(timer);
  }, [text, delayMs]);
  return [text, setText];
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

/** Chính thức / Tạm tính / Không tính được. Hovering (or focusing) says what the label means and lists this row's reasons. */
export function ResultBadge({ result, large = false }: Readonly<{ result: PnlResult; large?: boolean }>) {
  const explanation = resultExplanation(result);
  return (
    <span
      title={explanation}
      tabIndex={0}
      aria-label={`${RESULT_NAME[result.label]}. ${explanation}`}
      className={`inline-flex cursor-help items-center justify-center whitespace-nowrap rounded-full border font-semibold ${large ? "min-w-[7.5rem] px-4 py-1.5 text-xs" : "min-w-[6.5rem] px-3 py-1 text-[11px]"} ${RESULT_CLASS[result.label]}`}
    >
      {RESULT_NAME[result.label]}
    </span>
  );
}

/**
 * KPI tile as on the Projects page: 11px uppercase label, one line saying what the figure is (`hint`), mono value,
 * one sub-note. A tile without a figure shows "—" and says why (`whyEmpty`) instead of a bare dash.
 */
export function Tile({ label, hint, value, unit, note, noteClass = "text-muted-foreground", title, whyEmpty, icon: Icon, color = "#2563eb", action }: Readonly<{
  /** A small control next to the label (the "Sửa" of the Doanh thu tile); it takes the icon's place. */
  action?: ReactNode;
  /** Icon chip on the right of the label, tinted with `color` (the Projects-page tile). */
  icon?: LucideIcon;
  color?: string;
  label: string;
  hint?: string;
  value: ReactNode;
  /** Shown small after the value ("giờ"), so five tiles still fit a 1024px screen. */
  unit?: string;
  note?: ReactNode;
  noteClass?: string;
  title?: string;
  whyEmpty?: string;
}>) {
  const empty = value === NO_VALUE;
  return (
    <div className={`${cardClass} min-w-0 p-4`}>
      <div className="flex items-start justify-between gap-2">
        <p title={hint} className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {action ?? null}
        {Icon && !action ? <div aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}15` }}><Icon className="h-3.5 w-3.5" style={{ color }} /></div> : null}
      </div>
      <p title={empty ? whyEmpty : title} className="!mt-2 break-words font-mono text-2xl font-bold tabular-nums text-foreground">
        {value}
        {unit ? <span className="ml-1 font-sans text-sm font-semibold">{unit}</span> : null}
      </p>
      {/* One caption line: why the value is missing, else the note, else what the figure is; the rest is in tooltips. */}
      {empty && whyEmpty
        ? <p title={whyEmpty} className="!mt-1 truncate text-xs font-medium text-amber-700">{whyEmpty}</p>
        : note ? <p title={typeof note === "string" ? note : undefined} className={`!mt-1 truncate text-xs ${noteClass}`}>{note}</p>
        : hint ? <p title={hint} className="!mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const CHIP_TONE = { ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", muted: "bg-muted text-muted-foreground" };

/** Small status pill ("Đủ", "Thiếu 2", "Chờ khóa"). The full sentence goes in `title`, never in the cell. */
export function Chip({ tone, title, children }: Readonly<{ tone: keyof typeof CHIP_TONE; title?: string; children: ReactNode }>) {
  return (
    <span title={title} aria-label={title ? `${typeof children === "string" ? children : ""}: ${title}` : undefined} tabIndex={title ? 0 : undefined} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${title ? "cursor-help" : ""} ${CHIP_TONE[tone]}`}>
      {tone === "ok" ? <Check className="h-3 w-3" aria-hidden /> : tone === "warn" ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** "—" that says why there is no figure (hover or focus). */
export function NoValue({ why }: Readonly<{ why: string }>) {
  return <span title={why} aria-label={`Chưa có số: ${why}`} tabIndex={0} className="cursor-help text-muted-foreground">{NO_VALUE}</span>;
}

/**
 * "Cách đọc …" toggle with a short bullet list. Closed by default; the viewer's choice is remembered in this
 * browser under `storageKey` (the page works the same when storage is unavailable).
 */
export function HelpToggle({ label, storageKey, children }: Readonly<{ label: string; storageKey: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useEffect(() => {
    try { setOpen(window.localStorage.getItem(storageKey) === "1"); } catch { /* private window or blocked storage: stay closed */ }
  }, [storageKey]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* nothing to remember with */ }
  };
  return (
    <div className="min-w-0">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle} className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 !text-xs !font-semibold text-primary hover:underline">
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />{label}
      </button>
      {open ? <ul id={panelId} className="mt-2 list-disc space-y-1 rounded-xl border border-border bg-muted/40 py-3 pl-8 pr-4 text-xs leading-relaxed text-muted-foreground">{children}</ul> : null}
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
        {forbiddenText ? null : <p className="max-w-xl text-sm text-muted-foreground">Tab P&amp;L chỉ mở cho tài khoản Admin; doanh thu, chi phí và đơn giá giờ của nhân sự chỉ hiện với nhóm quyền chi phí. Liên hệ Admin nếu bạn cần quyền này.</p>}
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
      Bạn không thuộc nhóm quyền chi phí: doanh thu, chi phí, đơn giá giờ của nhân sự và biên lợi nhuận không hiển thị (ghi “—”). Giờ và trạng thái dữ liệu vẫn xem được.
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
