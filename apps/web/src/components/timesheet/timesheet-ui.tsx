"use client";

import React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toneClasses } from "./timesheet-format";

/** Shared presentation primitives for the Timesheet screens. */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClasses(tone)}`}>
      {children}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone,
  badge
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  badge?: string;
}) {
  return (
    <div className="relative min-h-[104px] rounded-xl border border-border bg-card p-4" aria-label={`${label}: ${value}`}>
      <p className="text-[12px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-foreground">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {badge ? <Pill tone={tone ?? "neutral"}>{badge}</Pill> : null}
        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  id
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  const headingId = `ts-${(id ?? title).replaceAll(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h3 id={headingId} className="text-[14px] font-bold text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function ChartCard({
  title,
  description,
  children,
  footnote,
  minHeight = 300,
  actions
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footnote?: string;
  minHeight?: number;
  actions?: React.ReactNode;
}) {
  const headingId = `ts-chart-${title.replaceAll(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-[14px] font-bold text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {/*
        `flex-1` + `minHeight` instead of a fixed height: cards sit in grids that
        stretch every item to the tallest row, and a fixed-height chart body left
        the surplus as dead space under the bars. Growing into it keeps the chart
        centred in its card whatever the neighbour's height is.

        The inner `absolute inset-0` matters: Recharts' ResponsiveContainer
        measures its parent on mount, and a flex child whose height is still
        being resolved measures as 0×0 — the chart then renders nothing and
        never re-measures. Absolute positioning gives it a definite box from the
        first layout pass.
      */}
      <div style={{ minHeight }} className="relative w-full flex-1">
        <div className="absolute inset-0">{children}</div>
      </div>
      {footnote ? <p className="mt-2 shrink-0 text-[11px] leading-snug text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-[13px] text-muted-foreground">{message}</p>
    </div>
  );
}

/** Horizontally scrollable table wrapper — the page body never scrolls sideways. */
export function TableScroll({ children }: { children: React.ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}

export function Th({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children = null, align = "left", className = "" }: { children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <td className={`px-3 py-2 text-[12.5px] text-foreground ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

export function Avatar({ initials, name }: { initials: string; name: string }) {
  return (
    <span
      title={name}
      aria-hidden
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary"
    >
      {initials}
    </span>
  );
}

/** A thin proportion bar used inside table cells. */
export function MiniBar({ percent, tone = "info", width = "w-16" }: { percent: number; tone?: Tone; width?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const fill =
    tone === "success" ? "var(--color-success)"
      : tone === "warning" ? "var(--color-warning)"
        : tone === "danger" ? "var(--color-destructive)"
          : "var(--color-chart-1)";
  return (
    <span className={`inline-flex h-1.5 ${width} overflow-hidden rounded-full bg-muted align-middle`} aria-hidden>
      <span className="h-full rounded-full" style={{ width: `${clamped}%`, backgroundColor: fill }} />
    </span>
  );
}

/**
 * Bar + value in one cell, with the value on a fixed-width track so the numbers
 * form a straight column and the bars all start from the same x position.
 * Without the fixed track a "100%" and a "97,2%" push their bars out of line.
 */
export function BarValue({ percent, value, tone = "info" }: { percent: number; value: string; tone?: Tone }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <MiniBar percent={percent} tone={tone} />
      <span className="w-[52px] shrink-0 text-right font-mono font-semibold tabular-nums">{value}</span>
    </span>
  );
}

/* ── Pagination ─────────────────────────────────────────────────────────── */

export interface PaginationState<T> {
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  items: T[];
  setPage: (page: number) => void;
}

/**
 * Client-side pagination for the Timesheet tables. Resets to page 1 whenever
 * the underlying list changes length (filter change, month change) so a user
 * never lands on an empty page.
 */
export function usePagination<T>(items: T[], pageSize: number): PaginationState<T> {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  React.useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    page: safePage,
    totalPages,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, items.length),
    items: items.slice(start, start + pageSize),
    setPage
  };
}

export function Pagination({
  state,
  unit = "dòng",
  className = ""
}: {
  state: Pick<PaginationState<unknown>, "page" | "totalPages" | "total" | "from" | "to" | "setPage">;
  unit?: string;
  className?: string;
}) {
  if (state.total === 0) return null;

  const { page, totalPages } = state;
  const pages: Array<number | "gap"> = [];
  if (totalPages <= 7) {
    for (let index = 1; index <= totalPages; index += 1) pages.push(index);
  } else {
    pages.push(1);
    if (page > 3) pages.push("gap");
    for (let index = Math.max(2, page - 1); index <= Math.min(totalPages - 1, page + 1); index += 1) pages.push(index);
    if (page < totalPages - 2) pages.push("gap");
    pages.push(totalPages);
  }

  return (
    <nav
      aria-label="Phân trang"
      className={`flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 ${className}`}
    >
      <p className="text-[11.5px] text-muted-foreground">
        Hiển thị <span className="font-semibold text-foreground">{state.from}–{state.to}</span> trên{" "}
        <span className="font-semibold text-foreground">{state.total}</span> {unit}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Trang trước"
            disabled={page === 1}
            onClick={() => state.setPage(page - 1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          {pages.map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-[11.5px] text-muted-foreground" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-label={`Trang ${entry}`}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => state.setPage(entry)}
                className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11.5px] font-semibold transition-colors ${
                  entry === page
                    ? "bg-primary/10 text-primary"
                    : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {entry}
              </button>
            )
          )}
          <button
            type="button"
            aria-label="Trang sau"
            disabled={page === totalPages}
            onClick={() => state.setPage(page + 1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

/** Drill-down surface: a right-side drawer over the underlying log rows. */
export function Drawer({
  open,
  title,
  description,
  icon: Icon,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-overlay" />
      <div className="relative flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon ? (
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                <Icon className="h-4 w-4" />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
              {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng chi tiết"
            className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
