"use client";

import { Briefcase, Check, ChevronDown, Search, UserRound } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CalendarFilterOption } from "@/lib/calendar-filters";

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("vi-VN");
}

export function CalendarFilterMultiSelect({
  id,
  label,
  allLabel,
  countLabel,
  icon,
  options,
  selectedIds,
  onChange
}: {
  id: string;
  label: string;
  allLabel: string;
  countLabel: (count: number) => string;
  icon: "project" | "member";
  options: CalendarFilterOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const generatedId = useId();
  const controlId = id || `calendar-filter-${generatedId.replace(/:/g, "")}`;
  const labelId = `${controlId}-label`;
  const valueId = `${controlId}-value`;
  const listboxId = `${controlId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusTargetRef = useRef<"search" | "first">("search");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedOptions = useMemo(
    () => selectedIds
      .map((selectedId) => options.find((option) => option.value === selectedId))
      .filter((option): option is CalendarFilterOption => Boolean(option)),
    [options, selectedIds]
  );
  const normalizedSearch = normalizeSearchText(search);
  const visibleOptions = useMemo(
    () => options.filter((option) => {
      if (!normalizedSearch) return true;
      return normalizeSearchText(`${option.label} ${option.subtext ?? ""}`).includes(normalizedSearch);
    }),
    [normalizedSearch, options]
  );
  const summary = selectedIds.length === 0
    ? allLabel
    : selectedIds.length === 1 && selectedOptions[0]
      ? selectedOptions[0].label
      : countLabel(selectedIds.length);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setSearch("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = (focusTarget: "search" | "first") => {
    focusTargetRef.current = focusTarget;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (focusTargetRef.current === "first") {
        containerRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
      } else {
        searchRef.current?.focus();
      }
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const toggle = (value: string) => {
    if (!value) {
      onChange([]);
      return;
    }
    onChange(
      selectedIds.includes(value)
        ? selectedIds.filter((selectedId) => selectedId !== value)
        : [...selectedIds, value]
    );
  };

  const moveOptionFocus = (event: React.KeyboardEvent<HTMLButtonElement>, direction: "next" | "previous" | "first" | "last") => {
    const optionsInDom = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []
    );
    const currentIndex = optionsInDom.indexOf(event.currentTarget);
    if (currentIndex < 0 || optionsInDom.length === 0) return;
    event.preventDefault();
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
        ? optionsInDom.length - 1
        : direction === "next"
          ? (currentIndex + 1) % optionsInDom.length
          : (currentIndex - 1 + optionsInDom.length) % optionsInDom.length;
    optionsInDom[nextIndex]?.focus();
  };

  const renderOptionIcon = (option?: CalendarFilterOption) => {
    if (icon === "project") {
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <Briefcase className="h-3.5 w-3.5" strokeWidth={1.5} />
        </span>
      );
    }
    if (option?.avatarUrl) {
      return <img src={option.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />;
    }
    if (option?.initials) {
      return (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: option.color ?? "var(--color-muted-foreground)" }}
          aria-hidden="true"
        >
          {option.initials}
        </span>
      );
    }
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
        <UserRound className="h-3.5 w-3.5" strokeWidth={1.5} />
      </span>
    );
  };

  const optionButton = (option: CalendarFilterOption | null) => {
    const value = option?.value ?? "";
    const isSelected = option ? selectedIds.includes(option.value) : selectedIds.length === 0;
    const optionLabel = option?.label ?? allLabel;
    return (
      <button
        key={value || "all"}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => toggle(value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") moveOptionFocus(event, "next");
          else if (event.key === "ArrowUp") moveOptionFocus(event, "previous");
          else if (event.key === "Home") moveOptionFocus(event, "first");
          else if (event.key === "End") moveOptionFocus(event, "last");
        }}
        className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
          isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
        }`}
      >
        {renderOptionIcon(option ?? undefined)}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{optionLabel}</span>
          {option?.subtext ? <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{option.subtext}</span> : null}
        </span>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
            isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent"
          }`}
          aria-hidden="true"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        const nextFocus = event.relatedTarget as Node | null;
        if (!nextFocus || !event.currentTarget.contains(nextFocus)) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }}
    >
      <span id={labelId} className="task-field-label mb-1 block text-[10px] font-bold text-muted-foreground">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => open ? close() : openMenu("search")}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openMenu("first");
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-2.5 rounded-xl border bg-background px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
          open ? "border-primary ring-2 ring-primary/15" : "border-border hover:bg-muted"
        }`}
      >
        <span id={valueId} className="min-w-0 truncate text-xs font-semibold text-foreground">{summary}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {selectedIds.length > 1 ? (
            <span className="rounded-full bg-primary/10 px-1.5 font-mono text-[10px] text-primary" aria-hidden="true">
              {selectedIds.length}
            </span>
          ) : null}
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.5} aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 z-[1300] mt-1.5 w-full min-w-0 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg sm:min-w-72">
          <label className="relative block">
            <span className="sr-only">Tìm {label.toLocaleLowerCase("vi-VN")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              aria-controls={listboxId}
              aria-label={`Tìm ${label}`}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown") return;
                event.preventDefault();
                containerRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
              }}
              placeholder={`Tìm ${label.toLocaleLowerCase("vi-VN")}…`}
              className="min-h-11 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </label>
          <div
            id={listboxId}
            role="listbox"
            aria-label={label}
            aria-multiselectable="true"
            className="mt-1.5 max-h-60 space-y-0.5 overflow-y-auto"
          >
            {optionButton(null)}
            {visibleOptions.map((option) => optionButton(option))}
            {visibleOptions.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">Không có lựa chọn phù hợp.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
