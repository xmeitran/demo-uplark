import type { ReactNode } from "react";

/**
 * The one KPI tile and the one table-header text style for screens outside the P&L tab.
 * They match the Projects page KPI tile and the Project Sheet header; add a background on the <thead> where needed.
 */
export const TABLE_HEAD_CLASS = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

export function KpiTile({ label, value, detail, valueClassName = "text-foreground" }: { label: string; value: ReactNode; detail?: string; valueClassName?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-bold tabular-nums ${valueClassName}`}>{value}</p>
      {detail ? <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
