"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Info, Search } from "lucide-react";
import { ShopifyIcon, type ShopifyIconName } from "../shopify-ui";

export type CrmSelectOption = {
  value: string;
  label: string;
  description?: string;
  meta?: string;
  subtext?: string;
  avatarUrl?: string;
  initials?: string;
  color?: string;
  icon?: string | React.ComponentType<{ className?: string }>;
  iconTone?: string;
  pillBg?: string;
  pillColor?: string;
};

export type CrmSelectProps = {
  id?: string;
  label?: React.ReactNode;
  ariaLabel?: string;
  value: string;
  options: CrmSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  openDirection?: "up" | "down";
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  className?: string;
  onOptionInfo?: (option: CrmSelectOption) => void;
  renderOption?: (option: CrmSelectOption, context: "trigger" | "option") => React.ReactNode;
};

export type CrmMultiSelectProps = {
  id?: string;
  label?: React.ReactNode;
  ariaLabel?: string;
  values: string[];
  options: CrmSelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  openDirection?: "up" | "down";
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  selectedCountLabel?: (count: number) => string;
  onClear?: () => void;
  className?: string;
};

const iconAliases: Record<string, ShopifyIconName> = {
  alert: "alert",
  "alert-circle": "alert",
  briefcase: "briefcase",
  box: "briefcase",
  "cash-dollar": "cash",
  calendar: "calendar",
  check: "check",
  checkmark: "check",
  clock: "clock",
  order: "briefcase",
  person: "users",
  search: "search",
  share: "trend",
  settings: "target",
  star: "spark",
  users: "users"
};

function optionText(option: CrmSelectOption) {
  return option.meta ?? option.subtext ?? option.description;
}

function optionIcon(option: CrmSelectOption, size: "trigger" | "option") {
  const dimension = size === "trigger" ? "h-5 w-5 text-[9px]" : "h-8 w-8 text-[10px]";
  const initials = option.initials || option.label.trim().split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join("");

  if (option.avatarUrl) {
    return <img src={option.avatarUrl} alt="" referrerPolicy="no-referrer" className={`${dimension} shrink-0 rounded-full object-cover ring-1 ring-black/5`} />;
  }

  if (option.initials) {
    return <span aria-hidden className={`${dimension} flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-1 ring-black/5`} style={{ backgroundColor: option.color ?? "#64748b" }}>{initials || "U"}</span>;
  }

  if (typeof option.icon === "function") {
    const Icon = option.icon;
    return <Icon className={`task-select-icon h-4 w-4 shrink-0 ${option.iconTone ? `text-${option.iconTone}` : "text-slate-400"}`} />;
  }

  if (typeof option.icon === "string") {
    return <ShopifyIcon className={`task-select-icon h-4 w-4 shrink-0 ${option.iconTone ? `tone-${option.iconTone}` : "text-slate-400"}`} name={iconAliases[option.icon] ?? "clock"} size={size === "trigger" ? 14 : 15} />;
  }

  return null;
}

export function CrmSelect({
  id,
  label,
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  openDirection = "down",
  searchable = false,
  searchPlaceholder = "Tìm kiếm...",
  placeholder = "Chọn một lựa chọn",
  className = "",
  onOptionInfo,
  renderOption
}: CrmSelectProps) {
  const generatedId = useId();
  const controlId = id ?? `crm-select-${generatedId.replace(/:/g, "")}`;
  const listboxId = `${controlId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = searchable && query.trim()
    ? options.filter((option) => `${option.label} ${optionText(option) ?? ""}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")))
    : options;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`task-select-control relative min-w-0 ${className}`}>
      {label ? <span className="task-field-label text-slate-400 text-[10px] font-bold block mb-1" id={`${controlId}-label`}>{label}</span> : null}
      <button
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label ? `${controlId}-label ${controlId}-value` : undefined}
        className={`task-select-trigger ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        data-open={open ? "true" : "false"}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="task-select-current min-w-0" id={`${controlId}-value`}>
          {selectedOption ? renderOption ? renderOption(selectedOption, "trigger") : <>
            {optionIcon(selectedOption, "trigger")}
            <span className="min-w-0">
                <span className="task-select-value block truncate">{selectedOption.label}</span>
                {optionText(selectedOption) ? <span className="block truncate text-[10px] font-normal text-slate-400">{optionText(selectedOption)}</span> : null}
            </span>
          </> : <span className="task-select-value text-slate-400">{placeholder}</span>}
        </span>
        <ShopifyIcon className="task-select-chevron" name="chevron-down" size={14} />
      </button>

      {open ? (
        <div
          aria-labelledby={label ? `${controlId}-label` : undefined}
          className={`task-select-menu ${openDirection === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
          data-direction={openDirection}
          id={listboxId}
          role="listbox"
        >
          {searchable ? (
            <div className="relative mb-1 border-b border-slate-100 px-1 pb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input autoFocus aria-label={searchPlaceholder} className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs outline-none focus:border-blue-500" placeholder={searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          ) : null}
          {filteredOptions.length ? filteredOptions.map((option) => {
            const selected = option.value === value;
            return (
              <div key={option.value} className="flex items-stretch gap-1">
                <button
                  aria-selected={selected}
                  className="task-select-option"
                  data-selected={selected ? "true" : "false"}
                  onClick={() => { onChange(option.value); setOpen(false); }}
                  role="option"
                  type="button"
                >
                  {renderOption ? renderOption(option, "option") : <>
                    {optionIcon(option, "option")}
                    <span className="min-w-0 flex-1">
                      <span className="task-select-option-label block">{option.label}</span>
                      {optionText(option) ? <span className="block truncate text-[10px] font-normal text-slate-400">{optionText(option)}</span> : null}
                    </span>
                  </>}
                  {selected ? <Check className="h-4 w-4 shrink-0 text-blue-600" /> : null}
                </button>
                {onOptionInfo ? <button type="button" aria-label={`Xem chi tiết ${option.label}`} className="mt-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-600" onClick={(event) => { event.stopPropagation(); setOpen(false); onOptionInfo(option); }}><Info className="h-3.5 w-3.5" /></button> : null}
              </div>
            );
          }) : <p className="px-3 py-3 text-center text-xs text-slate-400">Không có lựa chọn</p>}
        </div>
      ) : null}
    </div>
  );
}

export function CrmMultiSelect({
  id,
  label,
  ariaLabel,
  values,
  options,
  onChange,
  disabled = false,
  openDirection = "down",
  searchable = true,
  searchPlaceholder = "Tìm kiếm...",
  placeholder = "Chọn một hoặc nhiều lựa chọn",
  selectedCountLabel = (count) => `${count} đã chọn`,
  onClear,
  className = ""
}: CrmMultiSelectProps) {
  const generatedId = useId();
  const controlId = id ?? `crm-multi-select-${generatedId.replace(/:/g, "")}`;
  const listboxId = `${controlId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOptions = options.filter((option) => values.includes(option.value));
  const filteredOptions = searchable && query.trim()
    ? options.filter((option) => `${option.label} ${optionText(option) ?? ""}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")))
    : options;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((current) => current !== value) : [...values, value]);
  };

  return (
    <div ref={rootRef} className={`task-select-control relative min-w-0 ${className}`}>
      {label ? <span className="task-field-label text-slate-400 text-[10px] font-bold block mb-1" id={`${controlId}-label`}>{label}</span> : null}
      <button
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label ? `${controlId}-label ${controlId}-value` : undefined}
        className={`task-select-trigger ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        data-open={open ? "true" : "false"}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="task-select-current min-w-0" id={`${controlId}-value`}>
          {selectedOptions.slice(0, 3).map((option) => <span key={option.value}>{optionIcon(option, "trigger")}</span>)}
          <span className={`task-select-value truncate ${selectedOptions.length === 0 ? "text-slate-400" : ""}`}>
            {selectedOptions.length === 0 ? placeholder : selectedOptions.length === 1 ? selectedOptions[0]?.label : selectedCountLabel(selectedOptions.length)}
          </span>
        </span>
        <ShopifyIcon className="task-select-chevron" name="chevron-down" size={14} />
      </button>

      {open ? (
        <div
          aria-labelledby={label ? `${controlId}-label` : undefined}
          aria-multiselectable="true"
          className={`task-select-menu ${openDirection === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
          data-direction={openDirection}
          id={listboxId}
          role="listbox"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-2">
            <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{label ?? "Lựa chọn"} · {selectedCountLabel(selectedOptions.length)}</span>
            {selectedOptions.length > 0 ? <button type="button" className="shrink-0 text-[11px] font-semibold text-blue-600 hover:text-blue-700" onClick={() => onClear ? onClear() : onChange([])}>Bỏ chọn</button> : null}
          </div>
          {searchable ? (
            <div className="relative mb-1 border-b border-slate-100 px-1 pb-2 pt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input autoFocus aria-label={searchPlaceholder} className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs outline-none focus:border-blue-500" placeholder={searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          ) : null}
          {filteredOptions.length ? filteredOptions.map((option) => {
            const selected = values.includes(option.value);
            return (
              <button
                key={option.value}
                aria-selected={selected}
                className="task-select-option"
                data-selected={selected ? "true" : "false"}
                onClick={() => toggle(option.value)}
                role="option"
                type="button"
              >
                {optionIcon(option, "option")}
                <span className="min-w-0 flex-1">
                  <span className="task-select-option-label block">{option.label}</span>
                  {optionText(option) ? <span className="block truncate text-[10px] font-normal text-slate-400">{optionText(option)}</span> : null}
                </span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-transparent"}`}><Check className="h-3.5 w-3.5" /></span>
              </button>
            );
          }) : <p className="px-3 py-3 text-center text-xs text-slate-400">Không có lựa chọn</p>}
        </div>
      ) : null}
    </div>
  );
}
