"use client";

import type { KeyboardEvent, ReactNode } from "react";

export type WorkspaceTabItem<T extends string> = {
  id: T;
  label: string;
  description?: string;
  badge?: ReactNode;
  icon?: ReactNode;
};

export function WorkspaceTabBar<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  onKeyDown,
  idPrefix = "workspace",
  className = ""
}: {
  items: WorkspaceTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, value: T) => void;
  idPrefix?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={`flex min-w-max items-stretch gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm ${className}`}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown?.(event, item.id)}
            className={`group relative flex min-w-[142px] flex-1 items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
          >
            {item.icon ? <span className={`mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}>{item.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold leading-5">
                <span className="truncate">{item.label}</span>
                {item.badge ? <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{item.badge}</span> : null}
              </span>
              {item.description ? <span className="mt-0.5 block truncate text-[11px] leading-4 opacity-80">{item.description}</span> : null}
            </span>
            {active ? <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
