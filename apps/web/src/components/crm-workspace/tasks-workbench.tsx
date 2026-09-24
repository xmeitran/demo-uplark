"use client";
import { allowedPerformers } from "@/lib/task-people-policy";
import { defaultWorkLogDate } from "@/lib/work-log-date";
import { useTaskPeople } from "@/hooks/use-task-people";

import { useRouter } from "next/navigation";
import React, { useId, useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  ResourceListResponse,
  AccountsResponse,
  CreateTaskTimeEntryResponse,
  ProjectSummary,
  OpportunitySummary,
  ProjectTaskSummary,
  CreateProjectTaskInput,
  TransitionProjectTaskInput,
  CreateTaskTimeEntryInput
} from "@b2b-crm/contracts";
import { PolarisFallbackText, ShopifyDataTable, ShopifyIcon, ShopifySection, type ShopifyIconName } from "../shopify-ui";
import { ModalLayer } from "../modal-layer";
import {
  buildCreateTaskTimeEntryInput,
  resolveTaskTimeEntryUserId,
  type TaskTimeEntryFormInput
} from "../../features/crm-tasks/task-time-entry-input";
import {
  getDailyActualLogFeedback,
  type DailyActualLogFeedback
} from "../../features/crm-tasks/daily-actual-log-feedback";
import { shouldResetLogWorkModal, type LogWorkModalSession } from "../../features/crm-tasks/log-work-modal-session";
import {
  loadTaskDrafts,
  persistTaskDrafts,
  productionWriteFailureMessage,
  taskDraftsEnabled
} from "../../features/crm-tasks/task-draft-storage";
import {
  deploymentStagePlan,
  formatTaskMinutes,
  formatTaskTitle,
  getDeploymentStageForTask,
  getPriorityLabel,
  getStatusLabel,
  getTaskTypeLabel
} from "./task-display-helpers";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { fetchWorkspaceUserOptions, type WorkspaceUserOption } from "@/lib/workspace-users";
import { toVietnamDateInputValue, toVietnamDateKey, vietnamDateTimeToIso, VIETNAM_TIME_ZONE } from "@/lib/vietnam-time";
export {
  deploymentStagePlan,
  formatDecimalNumber,
  formatTaskMinutes,
  formatTaskTitle,
  getDeploymentStageForTask,
  getPriorityLabel,
  getStatusLabel,
  getTaskTypeIcon,
  getTaskTypeLabel,
  getWorkTypeLabel,
  priorityLabels,
  statusLabels,
  taskTypeLabels,
  type DeploymentStage
} from "./task-display-helpers";

function getTaskTypeShopifyIcon(type: string): ShopifyIconName {
  const t = (type || "").toLowerCase();
  if (t === "implementation") return "target";
  if (t === "blueprint" || t === "kickoff") return "briefcase";
  if (t === "proposal") return "cash";
  if (t === "prototype") return "target";
  if (t === "acceptance" || t === "handover") return "check";
  if (t === "consulting" || t === "customer_action" || t === "customeraction") return "users";
  if (t === "support") return "shield";
  if (t === "discovery") return "search";
  return "clock";
}

function getTaskStatusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "danger";
  if (status === "todo") return "warning";
  return "neutral";
}

function getTaskPriorityTone(priority: string) {
  if (priority === "urgent" || priority === "critical") return "danger";
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  if (priority === "low") return "success";
  return "neutral";
}

// Helpers for Icons & Colors
export type ToastTone = "success" | "danger" | "info" | "warning";

export function ToastIcon({ type }: { type: ToastTone }) {
  if (type === "success") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    );
  }
  if (type === "danger") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    );
  }
  if (type === "warning") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
        <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  );
}

export type TaskSelectOption = {
  value: string;
  label: string;
  icon?: string;
  iconTone?: string;
  subtext?: string;
  avatarUrl?: string;
  initials?: string;
  color?: string;
  /** If set, renders the option as a colored pill badge (bg class + text color string, e.g. "#dc2626") */
  pillBg?: string;
  pillColor?: string;
};

const emptyAssigneeOptions: TaskSelectOption[] = [];

function toTaskAssigneeOption(user: WorkspaceUserOption): TaskSelectOption {
  return {
    value: user.id,
    label: user.name,
    subtext: `${user.role}${user.email ? ` · ${user.email}` : ""}`,
    avatarUrl: user.avatarUrl,
    initials: user.initials,
    color: user.color
  };
}

export type CreateTaskStageOption = {
  activity: string;
  cumulativePercent?: number | null;
  id: string;
  phase?: string | null;
  projectId?: string | null;
  taskType?: string | null;
};

function getDropdownIconName(icon?: string): ShopifyIconName {
  switch (icon) {
    case "alert-circle":
      return "alert";
    case "checkmark":
      return "check";
    case "order":
      return "briefcase";
    case "person":
      return "users";
    case "settings":
      return "target";
    case "star":
      return "spark";
    case "calendar":
      return "calendar";
    case "clock":
    default:
      return "clock";
  }
}

export function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  openDirection = "down"
}: {
  id?: string;
  label: React.ReactNode;
  value: string;
  options: TaskSelectOption[];
  onChange: (val: string) => void;
  openDirection?: "up" | "down";
}) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOpt = options.find((o) => o.value === value) ?? options[0];
  const controlId = id ?? `task-select-${generatedId.replace(/:/g, "")}`;
  const listboxId = `${controlId}-listbox`;
  const isPersonList = options.some((option) => Boolean(option.avatarUrl || option.initials) && Boolean(option.subtext));

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
      setOpen(false);
    }
  };

  return (
    <div
      className="task-select-control relative"
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }}
    >
      {label && (
        <span className="task-field-label text-slate-400 text-[10px] font-bold block mb-1" id={`${controlId}-label`}>
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${controlId}-label ${controlId}-value`}
        className={`w-full min-h-11 flex items-center justify-between gap-2.5 px-3 py-2 border rounded-xl bg-slate-50 hover:bg-white transition text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 ${
          open ? "border-blue-500 ring-2 ring-blue-500/15 bg-white" : "border-slate-200"
        }`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="flex items-center gap-2 min-w-0" id={`${controlId}-value`}>
          {selectedOpt?.pillBg ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{ background: selectedOpt.pillBg, color: selectedOpt.pillColor ?? "#1e293b" }}
            >
              {selectedOpt?.icon && (
                <ShopifyIcon
                  className="shrink-0"
                  name={getDropdownIconName(selectedOpt.icon)}
                  size={11}
                />
              )}
              {selectedOpt?.label ?? "Select option"}
            </span>
          ) : selectedOpt?.avatarUrl ? (
            <img src={selectedOpt.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
          ) : selectedOpt?.initials ? (
            <span
              className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
              style={{ backgroundColor: selectedOpt.color ?? "#64748b" }}
            >
              {selectedOpt.initials}
            </span>
          ) : selectedOpt?.icon ? (
            <ShopifyIcon
              className="text-slate-400 shrink-0"
              name={getDropdownIconName(selectedOpt.icon)}
              size={14}
            />
          ) : null}
          {!selectedOpt?.pillBg && (
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-slate-800">{selectedOpt?.label ?? "Select option"}</span>
              {selectedOpt?.subtext ? <span className="block truncate text-[10px] font-normal text-slate-400">{selectedOpt.subtext}</span> : null}
            </span>
          )}
        </span>
        <ShopifyIcon className={`text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} name="chevron-down" size={14} />
      </button>

      {open && (
        <div
          aria-labelledby={`${controlId}-label`}
          className={`absolute left-0 w-full z-[1200] bg-white border border-slate-100 rounded-2xl p-1.5 shadow-lg max-h-60 overflow-y-auto ${
            openDirection === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
          id={listboxId}
          role="listbox"
        >
          {isPersonList ? (
            <div className="border-b border-slate-100 px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">PROJECT MEMBERS</span>
            </div>
          ) : null}
          {options.map((opt) => {
            const isSelected = opt.value === value;
            const isUnassigned = opt.value === "none" || opt.value === "unassigned" || opt.value === "";
            return (
              <button
                aria-selected={isSelected}
                className={`w-full min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 ${
                  isSelected
                    ? "bg-blue-50/60 text-blue-600 font-semibold"
                    : "hover:bg-slate-50 text-slate-700 font-medium"
                }`}
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                {opt.pillBg ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
                    style={{ background: opt.pillBg, color: opt.pillColor ?? "#1e293b" }}
                  >
                    {opt.icon && (
                      <ShopifyIcon
                        name={getDropdownIconName(opt.icon)}
                        size={11}
                      />
                    )}
                    {opt.label}
                  </span>
                ) : opt.avatarUrl ? (
                  <img src={opt.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                ) : opt.initials ? (
                  <span
                    className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: opt.color ?? "#64748b" }}
                  >
                    {opt.initials}
                  </span>
                ) : opt.icon ? (
                  <div className="h-7 w-7 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                    <ShopifyIcon
                      name={getDropdownIconName(opt.icon)}
                      size={14}
                    />
                  </div>
                ) : null}

                {!opt.pillBg && (
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs ${isUnassigned ? "text-blue-600 font-medium" : "text-slate-800 font-semibold"}`}>
                      {opt.label}
                    </div>
                    {opt.subtext && (
                      <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5">{opt.subtext}</div>
                    )}
                  </div>
                )}

                {isSelected && (
                  <ShopifyIcon className="text-blue-600 shrink-0 ml-auto" name="check" size={14} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const weekdayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function parseIsoDate(value: string) {
  const datePart = value.split("T")[0];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTaskDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return "dd/mm/yyyy";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function buildCalendarDays(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + index);
    return day;
  });
}

function OptionalBodyPortal({
  enabled,
  children
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (enabled && typeof document !== "undefined") {
    return createPortal(children, document.body);
  }
  return children;
}

export function DatePickerField({
  id,
  label,
  value,
  onChange,
  openDirection = "down",
  popoverLayout = "floating",
  required = false
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  openDirection?: "up" | "down";
  popoverLayout?: "floating" | "inline";
  required?: boolean;
}) {
  const generatedId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    placement: "up" | "down";
  } | null>(null);
  const selectedDate = parseIsoDate(value);
  const initialDate = selectedDate ?? new Date();
  const [viewDate, setViewDate] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const controlId = id ?? `task-date-${generatedId.replace(/:/g, "")}`;
  const popoverId = `${controlId}-calendar`;
  const calendarDays = buildCalendarDays(viewDate);
  const todayIso = toIsoDate(new Date());
  const valueIso = selectedDate ? toIsoDate(selectedDate) : "";
  const monthLabel = new Intl.DateTimeFormat("vi-VN", {
    month: "long",
    year: "numeric"
  }).format(viewDate);

  useEffect(() => {
    if (selectedDate) {
      setViewDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [value]);

  useEffect(() => {
    if (!open || popoverLayout !== "inline") {
      return;
    }

    window.requestAnimationFrame(() => {
      controlRef.current?.querySelector(".task-calendar-popover")?.scrollIntoView({
        block: "end",
        inline: "nearest"
      });
    });
  }, [open, popoverLayout]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || popoverLayout !== "floating") {
      setFloatingPosition(null);
      return;
    }

    let frame = 0;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const padding = 8;
      const gap = 6;
      const triggerRect = trigger.getBoundingClientRect();
      const width = Math.min(280, Math.max(0, viewportWidth - padding * 2));
      const maxHeight = Math.max(0, viewportHeight - padding * 2);
      const measuredHeight = Math.min(popoverRef.current?.offsetHeight ?? 336, maxHeight);
      const spaceAbove = triggerRect.top - viewportTop - padding - gap;
      const spaceBelow = viewportBottom - triggerRect.bottom - padding - gap;
      let placement = openDirection;

      if (placement === "down" && measuredHeight > spaceBelow && spaceAbove > spaceBelow) {
        placement = "up";
      } else if (placement === "up" && measuredHeight > spaceAbove && spaceBelow > spaceAbove) {
        placement = "down";
      }

      const desiredTop = placement === "up"
        ? triggerRect.top - measuredHeight - gap
        : triggerRect.bottom + gap;
      const maxTop = Math.max(viewportTop + padding, viewportBottom - measuredHeight - padding);
      const maxLeft = Math.max(viewportLeft + padding, viewportRight - width - padding);

      setFloatingPosition({
        left: Math.min(Math.max(triggerRect.left, viewportLeft + padding), maxLeft),
        top: Math.min(Math.max(desiredTop, viewportTop + padding), maxTop),
        width,
        maxHeight,
        placement
      });
    };
    const schedulePositionUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();
    frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);
    window.visualViewport?.addEventListener("resize", schedulePositionUpdate);
    window.visualViewport?.addEventListener("scroll", schedulePositionUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      window.visualViewport?.removeEventListener("resize", schedulePositionUpdate);
      window.visualViewport?.removeEventListener("scroll", schedulePositionUpdate);
    };
  }, [open, openDirection, popoverLayout, viewDate]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || controlRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [open]);

  const shiftMonth = (offset: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (nextFocus && (event.currentTarget.contains(nextFocus) || popoverRef.current?.contains(nextFocus))) return;
    setOpen(false);
  };

  return (
    <div className="task-date-control" onBlur={handleBlur} ref={controlRef}>
      <span className="task-field-label" id={`${controlId}-label`}>
        {label} {required && <span className="task-required">*</span>}
      </span>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${controlId}-label ${controlId}-value`}
        className={`w-full min-h-[40px] flex items-center justify-between gap-2.5 px-3 py-2 border rounded-xl bg-slate-50 hover:bg-white transition text-left cursor-pointer outline-none ${
          open ? "border-blue-500 ring-2 ring-blue-500/15 bg-white" : "border-slate-200"
        }`}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="text-xs font-semibold text-slate-800" id={`${controlId}-value`}>
          {value ? formatTaskDate(value) : <span className="text-slate-400 font-normal">dd/mm/yyyy</span>}
        </span>
        <ShopifyIcon className="text-slate-400" name="calendar" size={14} />
      </button>

      {open && (
        <OptionalBodyPortal enabled={popoverLayout === "floating"}>
          <div
            aria-label={`${label} calendar`}
            data-date-picker-placement={popoverLayout === "floating" ? floatingPosition?.placement : openDirection}
            data-date-picker-popover="true"
            className={`${popoverLayout === "floating"
              ? "fixed z-[400]"
              : `absolute left-0 z-[1200] ${openDirection === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`
            } bg-white border border-slate-100 rounded-2xl p-4 shadow-lg w-[280px] flex flex-col gap-3`}
            id={popoverId}
            ref={popoverRef}
            role="dialog"
            style={popoverLayout === "floating"
              ? {
                  left: floatingPosition?.left ?? 8,
                  maxHeight: floatingPosition?.maxHeight,
                  overflowY: "auto",
                  top: floatingPosition?.top ?? 8,
                  visibility: floatingPosition ? "visible" : "hidden",
                  width: floatingPosition?.width ?? 280
                }
              : undefined}
          >
          <div className="flex items-center justify-between">
            <button
              aria-label="Previous month"
              className="p-1.5 hover:bg-slate-50 rounded-lg transition text-slate-500 cursor-pointer"
              onClick={() => shiftMonth(-1)}
              type="button"
            >
              <ShopifyIcon name="chevron-left" size={13} />
            </button>
            <strong className="text-xs font-bold text-slate-800">{monthLabel}</strong>
            <button
              aria-label="Next month"
              className="p-1.5 hover:bg-slate-50 rounded-lg transition text-slate-500 cursor-pointer"
              onClick={() => shiftMonth(1)}
              type="button"
            >
              <ShopifyIcon name="chevron-right" size={13} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400" aria-hidden="true">
            {weekdayLabels.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`${label} calendar grid`}>
            {calendarDays.map((day) => {
              const iso = toIsoDate(day);
              const inMonth = day.getMonth() === viewDate.getMonth();
              const isToday = iso === todayIso;
              const isSelected = iso === valueIso;
              return (
                <button
                  aria-label={new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(day)}
                  aria-selected={isSelected}
                  className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs transition-all cursor-pointer font-semibold ${
                    !inMonth
                      ? "text-slate-300 font-normal"
                      : isSelected
                      ? "bg-blue-600 text-white shadow-sm"
                      : isToday
                      ? "bg-slate-100 text-slate-800 border border-slate-200"
                      : "hover:bg-slate-50 text-slate-700"
                  }`}
                  key={iso}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  role="gridcell"
                  type="button"
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <button
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
              onClick={() => {
                onChange(todayIso);
                setOpen(false);
              }}
              type="button"
            >
              Hôm nay
            </button>
            <button
              className="text-[11px] font-semibold text-slate-400 hover:text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              type="button"
            >
              Xóa ngày
            </button>
          </div>
          </div>
        </OptionalBodyPortal>
      )}
    </div>
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  variant = "default",
  children
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  variant?: "default" | "log-work" | "stage-edit" | "create-task";
  children: React.ReactNode;
}) {
  const modalId = useId();

  if (!isOpen || typeof document === "undefined") return null;

  return (
    <ModalLayer onClose={onClose}>
    <div
      className={`task-modal-backdrop ${variant}`}
      onClick={onClose}
    >
      <div
        aria-labelledby={modalId}
        aria-modal="true"
        className={`task-modal-shell ${variant}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="task-modal-header">
          <h3 id={modalId}>{title}</h3>
          <button aria-label="Close modal" className="task-modal-close" onClick={onClose} type="button">
            <ShopifyIcon name="x" size={18} />
          </button>
        </div>

        <div className="task-modal-body">
          {children}
        </div>
      </div>
    </div>
    </ModalLayer>
  );
}

export function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  disabled = false,
  required = false,
  min,
  max,
  step,
  inputMode,
  ariaDescribedBy,
  ariaInvalid
}: {
  label: string;
  value: string;
  onChange: (e: any) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}) {
  return (
    <div className="task-field-control">
      <label className="task-field-label">
        {label} {required && <span className="task-required">*</span>}
      </label>
      <input
        className="task-text-input"
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
      />
    </div>
  );
}

export function FormTextArea({
  label,
  value,
  onChange,
  placeholder = "",
  rows = 3
}: {
  label: string;
  value: string;
  onChange: (e: any) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="task-field-control">
      <label className="task-field-label">
        {label}
      </label>
      <textarea
        className="task-text-input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
      />
    </div>
  );
}

// Modals definitions
export type CreateTaskModalDefaults = {
  accountId?: string;
  projectId?: string;
  stageId?: string;
  taskType?: string;
  taskTypeLayer1?: "PRE_SALE" | "DELIVERY" | "PM";
  taskTypeLayer2?: "CUSTOMER_PROJECT" | "INTERNAL_PROJECT" | "TICKET_MAINTENANCE" | "DAY_OFF_COMPANY";
  title?: string;
  description?: string;
};

function formatCreateTaskStageOption(stage: CreateTaskStageOption) {
  const stageName = stage.phase ? `${stage.phase} · ${stage.activity}` : stage.activity;
  return stage.cumulativePercent != null ? `${stageName} · ${stage.cumulativePercent}%` : stageName;
}

function getTaskTypeForStageActivity(activity: string) {
  switch (activity) {
    case "Analyst":
      return "discovery";
    case "Standard":
      return "blueprint";
    case "Proposal":
      return "proposal";
    case "Transform":
      return "implementation";
    case "Prototype":
      return "prototype";
    case "Pilot":
      return "kickoff";
    case "Onboarding":
      return "customer_action";
    case "Nghiệm thu":
      return "acceptance";
    default:
      return "implementation";
  }
}

export function CreateTaskModal({
  isOpen,
  onClose,
  onSave,
  accounts,
  projects,
  stages = [],
  defaults,
  assigneeOptions
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  accounts: any[];
  projects: any[];
  stages?: CreateTaskStageOption[];
  defaults?: CreateTaskModalDefaults;
  assigneeOptions?: TaskSelectOption[];
}) {
  const assigneeSelectOptions = assigneeOptions?.length ? assigneeOptions : emptyAssigneeOptions;
  const defaultAssigneeUserId = assigneeSelectOptions[0]?.value || "none";
  const [title, setTitle] = useState(defaults?.title || "");
  const [description, setDescription] = useState(defaults?.description || "");
  const [accountId, setAccountId] = useState(defaults?.accountId || accounts[0]?.id || "");
  const [projectId, setProjectId] = useState(defaults?.projectId || "none");
  const [stageId, setStageId] = useState(defaults?.stageId || "none");
  const [priority, setPriority] = useState("medium");
  const [taskType, setTaskType] = useState(defaults?.taskType || "implementation");
  const [taskTypeLayer1, setTaskTypeLayer1] = useState<CreateTaskModalDefaults["taskTypeLayer1"]>(defaults?.taskTypeLayer1 || "DELIVERY");
  const [taskTypeLayer2, setTaskTypeLayer2] = useState<CreateTaskModalDefaults["taskTypeLayer2"]>(defaults?.taskTypeLayer2 || "CUSTOMER_PROJECT");
  const [assigneeUserId, setAssigneeUserId] = useState(defaultAssigneeUserId);
  const [plannedStartAt, setPlannedStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [estimateMinutes, setEstimateMinutes] = useState("");
  const [customerVisible, setCustomerVisible] = useState(false);

  const filteredProjects = projects.filter(p => p.accountId === accountId);
  const filteredStages = stages.filter((stage) => !stage.projectId || stage.projectId === projectId);
  const selectedStageIsValid = stageId !== "none" && filteredStages.some((stage) => stage.id === stageId);
  const selectedStageCanPersist = selectedStageIsValid && !stageId.startsWith("template-") && !stageId.startsWith("plan-");
  const stageOptions: TaskSelectOption[] = [
    { value: "none", label: "Chưa gắn stage", icon: "alert-circle" },
    ...filteredStages.map((stage) => ({
      value: stage.id,
      label: formatCreateTaskStageOption(stage),
      icon: "clock"
    }))
  ];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextAccountId = defaults?.accountId || accounts[0]?.id || "";
    const nextProjects = projects.filter(p => p.accountId === nextAccountId);
    const defaultProjectIsValid = Boolean(defaults?.projectId && nextProjects.some(p => p.id === defaults.projectId));
    const nextProjectId = defaultProjectIsValid ? defaults?.projectId || "none" : nextProjects[0]?.id || "none";
    const defaultStageIsValid = Boolean(
      defaults?.stageId &&
      stages.some((stage) => stage.id === defaults.stageId && (!stage.projectId || stage.projectId === nextProjectId))
    );

    setTitle(defaults?.title || "");
    setDescription(defaults?.description || "");
    setAccountId(nextAccountId);
    setProjectId(nextProjectId);
    setStageId(defaultStageIsValid ? defaults?.stageId || "none" : "none");
    setPriority("medium");
    setTaskType(defaults?.taskType || "implementation");
    setTaskTypeLayer1(defaults?.taskTypeLayer1 || "DELIVERY");
    setTaskTypeLayer2(defaults?.taskTypeLayer2 || "CUSTOMER_PROJECT");
    setAssigneeUserId((current) => {
      if (assigneeSelectOptions.some((option) => option.value === current)) {
        return current;
      }
      return defaultAssigneeUserId;
    });
    setPlannedStartAt("");
    setDueAt("");
    setEstimateMinutes("");
    setCustomerVisible(false);
  }, [isOpen, defaults?.accountId, defaults?.projectId, defaults?.stageId, defaults?.taskType, defaults?.taskTypeLayer1, defaults?.taskTypeLayer2, defaults?.title, defaults?.description, accounts, projects, stages, assigneeSelectOptions, defaultAssigneeUserId]);

  const handleAccountChange = (nextAccountId: string) => {
    setAccountId(nextAccountId);
    const nextProjects = projects.filter(p => p.accountId === nextAccountId);
    setProjectId(nextProjects[0]?.id || "none");
    setStageId("none");
  };

  const handleProjectChange = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    const nextStages = stages.filter((stage) => !stage.projectId || stage.projectId === nextProjectId);
    setStageId((currentStageId) => {
      if (currentStageId !== "none" && nextStages.some((stage) => stage.id === currentStageId)) {
        return currentStageId;
      }
      return "none";
    });
  };

  const handleStageChange = (nextStageId: string) => {
    setStageId(nextStageId);
    if (nextStageId === "none") {
      return;
    }

    const selectedStage = stages.find((stage) => stage.id === nextStageId);
    const nextTaskType = selectedStage?.taskType || (selectedStage ? getTaskTypeForStageActivity(selectedStage.activity) : "");
    if (nextTaskType) {
      setTaskType(nextTaskType);
    }
  };

  const handleSubmit = (e: any) => {
    e.preventDefault();
    if (!title || !accountId || assigneeUserId === "none") {
      alert("Cần nhập tiêu đề, chọn khách hàng và chọn người phụ trách thật trước khi tạo công việc.");
      return;
    }

    const accountObj = accounts.find(a => a.id === accountId);
    const projectObj = projects.find(p => p.id === projectId);
    const assigneeObj = assigneeSelectOptions.find((option) => option.value === assigneeUserId);

    onSave({
      title,
      description,
      accountId,
      accountName: accountObj?.name || "Khách hàng chưa rõ",
      projectId: projectId === "none" ? undefined : projectId,
      projectName: projectId === "none" ? undefined : projectObj?.name,
      stageId: selectedStageCanPersist ? stageId : undefined,
      priority,
      taskType,
      taskTypeLayer1,
      taskTypeLayer2,
      assigneeUserId,
      assigneeDisplayName: assigneeObj?.label || "Chưa giao",
      plannedStartAt: plannedStartAt || undefined,
      dueAt: dueAt || undefined,
      estimateMinutes: estimateMinutes ? Number(estimateMinutes) : 0,
      customerVisible
    });

    setTitle("");
    setDescription("");
    setStageId("none");
    setPlannedStartAt("");
    setDueAt("");
    setEstimateMinutes("");
    setCustomerVisible(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tạo công việc dự án" variant="create-task">
      <form className="task-form-modern task-form-compact" onSubmit={handleSubmit}>
        <FormField label="Tên công việc" value={title} onChange={e => setTitle(e.target.value)} placeholder="VD: Chuẩn bị dữ liệu kickoff" required />
        <FormTextArea label="Mô tả" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ghi rõ đầu việc, người phối hợp và kết quả cần có..." />

        <div className="task-form-grid" style={{ zIndex: 1005 }}>
          <CustomDropdown
            label="Khách hàng"
            value={accountId}
            options={accounts.map(a => ({ value: a.id, label: a.name, icon: "person" }))}
            onChange={handleAccountChange}
          />
          <CustomDropdown
            label="Dự án liên kết"
            value={projectId}
            options={[
              { value: "none", label: "Chưa gắn dự án", icon: "alert-circle" },
              ...filteredProjects.map(p => ({ value: p.id, label: p.name, icon: "order" }))
            ]}
            onChange={handleProjectChange}
          />
        </div>

        <div className="task-form-grid" style={{ zIndex: 1004 }}>
          <CustomDropdown
            label="Stage triển khai"
            value={selectedStageIsValid ? stageId : "none"}
            options={stageOptions}
            onChange={handleStageChange}
          />
          <CustomDropdown
            label="Loại công việc"
            value={taskType}
            openDirection="down"
            options={[
              { value: "discovery", label: "Khảo sát", icon: "search" },
              { value: "blueprint", label: "Thiết kế giải pháp", icon: "order" },
              { value: "proposal", label: "Đề xuất giải pháp", icon: "cash" },
              { value: "implementation", label: "Triển khai", icon: "settings" },
              { value: "prototype", label: "Prototype", icon: "settings" },
              { value: "kickoff", label: "Kickoff", icon: "order" },
              { value: "customer_action", label: "Việc phía khách hàng", icon: "person" },
              { value: "acceptance", label: "Nghiệm thu", icon: "checkmark" },
              { value: "consulting", label: "Tư vấn", icon: "person" },
              { value: "support", label: "Hỗ trợ kỹ thuật", icon: "clock" }
            ]}
            onChange={setTaskType}
          />
        </div>

        <div className="task-form-grid" style={{ zIndex: 1003 }}>
          <CustomDropdown
            label="Task Type · Nhóm"
            value={taskTypeLayer1 || "DELIVERY"}
            options={[
              { value: "PRE_SALE", label: "Pre-sale · Công việc BD", icon: "cash" },
              { value: "DELIVERY", label: "Delivery", icon: "order" },
              { value: "PM", label: "Quản trị nội bộ", icon: "settings" }
            ]}
            onChange={(value) => setTaskTypeLayer1(value as CreateTaskModalDefaults["taskTypeLayer1"])}
          />
          <CustomDropdown
            label="Task Type · Bối cảnh"
            value={taskTypeLayer2 || "CUSTOMER_PROJECT"}
            options={[
              { value: "CUSTOMER_PROJECT", label: "Project khách hàng", icon: "order" },
              { value: "INTERNAL_PROJECT", label: "Nội bộ / Project nội bộ", icon: "settings" },
              { value: "TICKET_MAINTENANCE", label: "Ticket / Bảo trì", icon: "tool" },
              { value: "DAY_OFF_COMPANY", label: "Ngày nghỉ công ty", icon: "calendar" }
            ]}
            onChange={(value) => setTaskTypeLayer2(value as CreateTaskModalDefaults["taskTypeLayer2"])}
          />
        </div>

        <div className="task-form-grid" style={{ zIndex: 1002 }}>
          <CustomDropdown
            label="Ưu tiên"
            value={priority}
            options={[
              { value: "high", label: "Cao", icon: "alert-circle", iconTone: "critical" },
              { value: "medium", label: "Vừa", icon: "star", iconTone: "warning" },
              { value: "low", label: "Thấp", icon: "checkmark", iconTone: "success" }
            ]}
            onChange={setPriority}
          />
          <CustomDropdown
            label="Người phụ trách"
            value={assigneeUserId}
            openDirection="down"
            options={assigneeSelectOptions}
            onChange={setAssigneeUserId}
          />
        </div>

        <div className="task-form-grid task-create-date-grid">
          <DatePickerField label="Ngày bắt đầu" value={plannedStartAt} onChange={setPlannedStartAt} openDirection="up" />
          <DatePickerField label="Hạn hoàn tất" value={dueAt} onChange={setDueAt} openDirection="up" />
        </div>

        <div className="task-form-grid task-form-tail-grid">
          <FormField label="Ước tính phút" value={estimateMinutes} onChange={e => setEstimateMinutes(e.target.value)} type="number" placeholder="VD: 120" />
          <div className="task-checkbox-card">
            <input
              type="checkbox"
              id="visible-cust"
              checked={customerVisible}
              onChange={e => setCustomerVisible(e.target.checked)}
            />
            <label htmlFor="visible-cust">
              Hiển thị cho khách hàng trong portal
            </label>
          </div>
        </div>

        <div className="task-form-actions">
          <button className="task-button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="task-button primary" type="submit">Tạo công việc</button>
        </div>
      </form>
    </Modal>
  );
}

export function EditTaskModal({
  isOpen,
  onClose,
  onSave,
  task,
  accounts,
  projects,
  assigneeOptions
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  task: ProjectTaskSummary;
  accounts: any[];
  projects: any[];
  assigneeOptions?: TaskSelectOption[];
}) {
  const assigneeSelectOptions = assigneeOptions?.length ? assigneeOptions : emptyAssigneeOptions;
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [accountId, setAccountId] = useState(task?.accountId || "");
  const [projectId, setProjectId] = useState(task?.projectId || "none");
  const [priority, setPriority] = useState(task?.priority || "medium");
  const [taskType, setTaskType] = useState(task?.taskType || "implementation");
  const [taskTypeLayer1, setTaskTypeLayer1] = useState(task?.taskTypeLayer1 || "DELIVERY");
  const [taskTypeLayer2, setTaskTypeLayer2] = useState(task?.taskTypeLayer2 || "CUSTOMER_PROJECT");
  const [assigneeUserId, setAssigneeUserId] = useState(task?.assigneeUserId || "none");
  const [plannedStartAt, setPlannedStartAt] = useState(toVietnamDateInputValue(task?.plannedStartAt));
  const [dueAt, setDueAt] = useState(toVietnamDateInputValue(task?.dueAt));
  const [estimateMinutes, setEstimateMinutes] = useState(task?.estimateMinutes?.toString() || "");
  const [customerVisible, setCustomerVisible] = useState(task?.customerVisible ?? false);

  const filteredProjects = projects.filter(p => p.accountId === accountId);

  useEffect(() => {
    if (task && isOpen) {
      setTitle(task.title || "");
      setDescription(task.description || "");
      setAccountId(task.accountId || "");
      setProjectId(task.projectId || "none");
      setPriority(task.priority || "medium");
      setTaskType(task.taskType || "implementation");
      setTaskTypeLayer1(task.taskTypeLayer1 || "DELIVERY");
      setTaskTypeLayer2(task.taskTypeLayer2 || "CUSTOMER_PROJECT");
      setAssigneeUserId(
        task.assigneeUserId && assigneeSelectOptions.some((option) => option.value === task.assigneeUserId)
          ? task.assigneeUserId
          : assigneeSelectOptions[0]?.value || "none"
      );
      setPlannedStartAt(toVietnamDateInputValue(task.plannedStartAt));
      setDueAt(toVietnamDateInputValue(task.dueAt));
      setEstimateMinutes(task.estimateMinutes?.toString() || "");
      setCustomerVisible(task.customerVisible ?? false);
    }
  }, [task, isOpen, assigneeSelectOptions]);

  const handleSubmit = (e: any) => {
    e.preventDefault();
    if (!title || !accountId) {
      alert("Cần nhập tiêu đề và chọn khách hàng trước khi lưu công việc.");
      return;
    }

    const accountObj = accounts.find(a => a.id === accountId);
    const projectObj = projects.find(p => p.id === projectId);
    const assigneeObj = assigneeSelectOptions.find((option) => option.value === assigneeUserId);

    onSave({
      title,
      description,
      accountId,
      accountName: accountObj?.name || "Khách hàng chưa rõ",
      projectId: projectId === "none" ? undefined : projectId,
      projectName: projectId === "none" ? undefined : projectObj?.name,
      priority,
      taskType,
      taskTypeLayer1,
      taskTypeLayer2,
      assigneeUserId,
      assigneeDisplayName: assigneeObj?.label || "Chưa giao",
      plannedStartAt: plannedStartAt || undefined,
      dueAt: dueAt || undefined,
      estimateMinutes: estimateMinutes ? Number(estimateMinutes) : 0,
      customerVisible
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Chỉnh sửa công việc dự án">
      <form className="task-form-modern" onSubmit={handleSubmit}>
        <FormField label="Tên công việc" value={title} onChange={e => setTitle(e.target.value)} placeholder="VD: Chuẩn bị dữ liệu kickoff" required />
        <FormTextArea label="Mô tả" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ghi rõ đầu việc, người phối hợp và kết quả cần có..." />

        <div className="task-form-grid" style={{ zIndex: 1005 }}>
          <CustomDropdown
            label="Khách hàng"
            value={accountId}
            options={accounts.map(a => ({ value: a.id, label: a.name, icon: "person" }))}
            onChange={setAccountId}
          />
          <CustomDropdown
            label="Dự án liên kết"
            value={projectId}
            options={[
              { value: "none", label: "Chưa gắn dự án", icon: "alert-circle" },
              ...filteredProjects.map(p => ({ value: p.id, label: p.name, icon: "order" }))
            ]}
            onChange={setProjectId}
          />
        </div>

        <div className="task-form-grid" style={{ zIndex: 1004 }}>
          <CustomDropdown
            label="Ưu tiên"
            value={priority}
            options={[
              { value: "high", label: "Cao", icon: "alert-circle", iconTone: "critical" },
              { value: "medium", label: "Vừa", icon: "star", iconTone: "warning" },
              { value: "low", label: "Thấp", icon: "checkmark", iconTone: "success" }
            ]}
            onChange={setPriority}
          />
          <CustomDropdown
            label="Loại công việc"
            value={taskType}
            openDirection="up"
            options={[
              { value: "discovery", label: "Khảo sát", icon: "search" },
              { value: "blueprint", label: "Thiết kế giải pháp", icon: "order" },
              { value: "proposal", label: "Đề xuất giải pháp", icon: "cash" },
              { value: "implementation", label: "Triển khai", icon: "settings" },
              { value: "prototype", label: "Prototype", icon: "settings" },
              { value: "kickoff", label: "Kickoff", icon: "order" },
              { value: "customer_action", label: "Việc phía khách hàng", icon: "person" },
              { value: "acceptance", label: "Nghiệm thu", icon: "checkmark" },
              { value: "consulting", label: "Tư vấn", icon: "person" },
              { value: "support", label: "Hỗ trợ kỹ thuật", icon: "clock" }
            ]}
            onChange={setTaskType}
          />
        </div>

        <div className="task-form-grid" style={{ zIndex: 1003 }}>
          <CustomDropdown
            label="Task Type · Nhóm"
            value={taskTypeLayer1}
            options={[
              { value: "PRE_SALE", label: "Pre-sale · Công việc BD", icon: "cash" },
              { value: "DELIVERY", label: "Delivery", icon: "order" },
              { value: "PM", label: "Quản trị nội bộ", icon: "settings" }
            ]}
            onChange={(value) => setTaskTypeLayer1(value as typeof taskTypeLayer1)}
          />
          <CustomDropdown
            label="Task Type · Bối cảnh"
            value={taskTypeLayer2}
            options={[
              { value: "CUSTOMER_PROJECT", label: "Project khách hàng", icon: "order" },
              { value: "INTERNAL_PROJECT", label: "Nội bộ / Project nội bộ", icon: "settings" },
              { value: "TICKET_MAINTENANCE", label: "Ticket / Bảo trì", icon: "tool" },
              { value: "DAY_OFF_COMPANY", label: "Ngày nghỉ công ty", icon: "calendar" }
            ]}
            onChange={(value) => setTaskTypeLayer2(value as typeof taskTypeLayer2)}
          />
        </div>

        <div className="task-form-grid" style={{ zIndex: 1002 }}>
          <CustomDropdown
            label="Người phụ trách"
            value={assigneeUserId}
            openDirection="up"
            options={assigneeSelectOptions}
            onChange={setAssigneeUserId}
          />
          <FormField label="Ước tính phút" value={estimateMinutes} onChange={e => setEstimateMinutes(e.target.value)} type="number" placeholder="VD: 120" />
        </div>

        <div className="task-form-grid task-date-grid">
          <DatePickerField label="Ngày bắt đầu" value={plannedStartAt} onChange={setPlannedStartAt} openDirection="up" />
          <DatePickerField label="Hạn hoàn tất" value={dueAt} onChange={setDueAt} openDirection="up" />
        </div>

        <div className="task-checkbox-row">
          <input
            type="checkbox"
            id="edit-visible-cust"
            checked={customerVisible}
            onChange={e => setCustomerVisible(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <label htmlFor="edit-visible-cust">
            Hiển thị cho khách hàng trong portal
          </label>
        </div>

        <div className="task-form-actions">
          <button className="task-button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="task-button primary" type="submit">Lưu thay đổi</button>
        </div>
      </form>
    </Modal>
  );
}

export function TransitionStatusModal({
  isOpen,
  onClose,
  onTransition,
  currentStatus
}: {
  isOpen: boolean;
  onClose: () => void;
  onTransition: (status: string, reason: string) => void;
  currentStatus: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [reason, setReason] = useState("");

  useEffect(() => {
    setStatus(currentStatus);
    setReason("");
  }, [currentStatus, isOpen]);

  const handleSubmit = (e: any) => {
    e.preventDefault();
    if (!status) return;
    onTransition(status, reason);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Đổi trạng thái công việc">
      <form className="task-form-modern" onSubmit={handleSubmit}>
        <div style={{ position: "relative", zIndex: 1005 }}>
          <CustomDropdown
            label="Trạng thái mới"
            value={status}
            options={[
              { value: "todo", label: "Cần làm / backlog", icon: "clock" },
              { value: "in_progress", label: "Đang xử lý", icon: "star", iconTone: "info" },
              { value: "completed", label: "Hoàn tất", icon: "checkmark", iconTone: "success" },
              { value: "blocked", label: "Đang bị chặn", icon: "alert-circle", iconTone: "critical" },
              { value: "cancelled", label: "Đã hủy", icon: "alert-circle", iconTone: "neutral" }
            ]}
            onChange={setStatus}
          />
        </div>

        <FormField label="Lý do / ghi chú" value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Chờ quyền dữ liệu từ khách hàng" />

        <div className="task-form-actions">
          <button className="task-button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="task-button primary" type="submit">Áp dụng</button>
        </div>
      </form>
    </Modal>
  );
}

export function TimePickerDropdown({
  label,
  value,
  onChange,
  required
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const timeSlots = React.useMemo(() => {
    const slots = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const hh = h.toString().padStart(2, "0");
        const mm = m.toString().padStart(2, "0");
        slots.push(`${hh}:${mm}`);
      }
    }
    return slots;
  }, []);

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-col relative" onBlur={handleBlur} ref={containerRef}>
      <label className="text-[10px] font-bold text-slate-400 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
      <div className="relative">
        <input
          type="text"
          placeholder="hh:mm"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-8 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 focus:bg-white transition"
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition cursor-pointer"
        >
          <ShopifyIcon name="clock" size={13} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] w-full z-[1300] bg-white border border-slate-100 rounded-xl shadow-lg max-h-48 overflow-y-auto p-1">
          {timeSlots.map(time => (
            <button
              key={time}
              type="button"
              onClick={() => {
                onChange(time);
                setOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                time === value
                  ? "bg-blue-50 text-blue-600 font-semibold"
                  : "hover:bg-slate-50 text-slate-700 font-medium"
              }`}
            >
              {time}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LogWorkModal({
  isOpen,
  onClose,
  onLog,
  task,
  assigneeOptions = [],
  selectedWorkDate
}: {
  isOpen: boolean;
  onClose: () => void;
  onLog: (data: any) => void | Promise<void>;
  task: any;
  assigneeOptions?: any[];
  selectedWorkDate?: string;
}) {
  const people = useTaskPeople(task?.projectId, isOpen);
  const performerOptions = allowedPerformers(people.members, people.principalUserId, people.permissions.canLogForOthers).map(toTaskAssigneeOption);
  const [step, setStep] = useState<"choice" | "actual" | "plan">("choice");

  // Shared Form state
  const [minutes, setMinutes] = useState("60");
  const [note, setNote] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [workType, setWorkType] = useState("delivery");
  const [billable, setBillable] = useState(true);
  const [completeTask, setCompleteTask] = useState(false);
  const [userId, setUserId] = useState("none");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const modalSessionRef = useRef<LogWorkModalSession>({ isOpen: false, taskId: task?.id });

  // Time Slot state
  const [useTimeSlot, setUseTimeSlot] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // Pre-fill fields from task details when opening
  useEffect(() => {
    const nextSession = { isOpen, taskId: task?.id };
    const shouldReset = shouldResetLogWorkModal(modalSessionRef.current, nextSession);
    modalSessionRef.current = nextSession;

    if (shouldReset && task) {
      setStep("choice");
      setMinutes(task.estimateMinutes?.toString() || "60");
      setWorkDate(defaultWorkLogDate(selectedWorkDate, task.plannedStartAt));
      setWorkType(task.taskType || "delivery");
      setNote("");
      setBillable(true);
      setCompleteTask(false);
      setUseTimeSlot(true);
      setStartTime("09:00");
      setEndTime("10:00");
      setUserId(task.assigneeUserId || "none");
      setSubmitting(false);
      submittingRef.current = false;
      setSubmitError(null);
    }
  }, [isOpen, task?.id]);

  useEffect(() => {
    if (!isOpen || people.loading || people.error) return;
    setUserId(current => performerOptions.some(option => option.value === current) ? current : (performerOptions.find(option => option.value === people.principalUserId)?.value ?? "none"));
  }, [isOpen, people.members, people.loading, people.error, people.principalUserId]);

  // Dynamic slot duration calculating logic
  useEffect(() => {
    if (useTimeSlot && startTime && endTime) {
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);
      if (!isNaN(startH) && !isNaN(startM) && !isNaN(endH) && !isNaN(endM)) {
        let diff = (endH * 60 + endM) - (startH * 60 + startM);
        if (diff < 0) {
          diff += 24 * 60;
        }
        setMinutes(diff.toString());
      }
    }
  }, [startTime, endTime, useTimeSlot]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (people.loading || people.error || !performerOptions.some(option => option.value === userId)) { setSubmitError("Select an active project member as the performer."); return; }
    if (!minutes || !workDate) return;
    if (useTimeSlot && (!startTime || !endTime)) return;
    const startAt = useTimeSlot ? vietnamDateTimeToIso(workDate, startTime) : undefined;
    let endAt = useTimeSlot ? vietnamDateTimeToIso(workDate, endTime) : undefined;
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
      const adjustedEnd = new Date(endAt);
      adjustedEnd.setUTCDate(adjustedEnd.getUTCDate() + 1);
      endAt = adjustedEnd.toISOString();
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onLog({
        type: step,
        minutes: Number(minutes),
        note,
        workDate,
        workType,
        billable,
        completeTask,
        userId: userId === "none" ? undefined : userId,
        startTime: useTimeSlot ? startTime : undefined,
        endTime: useTimeSlot ? endTime : undefined,
        startAt,
        endAt,
        timeZone: VIETNAM_TIME_ZONE
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Không thể lưu thao tác. Vui lòng thử lại.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const getDurationLabel = (minsStr: string) => {
    const mins = Number(minsStr) || 0;
    if (mins <= 0) return "";
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hrs > 0) {
      return `(${hrs} giờ ${rem > 0 ? `${rem} phút` : ""})`;
    }
    return `(${mins} phút)`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        step === "choice"
          ? "Ghi nhận & Lên kế hoạch"
          : step === "actual"
          ? "Ghi nhận thời gian thực tế"
          : "Lên kế hoạch dự kiến"
      }
      variant="log-work"
    >
      {step === "choice" && (
        <div className="py-4">
          <p className="text-xs text-slate-500 text-center" style={{ marginBottom: "28px", marginTop: "4px" }}>Chọn hình thức bạn muốn thực hiện cho công việc này:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
            {/* Log Actual Card */}
            <button
              type="button"
              onClick={() => setStep("actual")}
              className="flex flex-col items-center text-center p-6 h-full w-full rounded-2xl border border-slate-200 bg-white hover:border-blue-500 hover:bg-blue-50/10 hover:shadow-md transition-all group cursor-pointer min-h-[190px]"
            >
              <div className="flex flex-col items-center justify-center flex-1">
                <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3.5 group-hover:bg-blue-100 transition-colors shrink-0">
                  <ShopifyIcon name="clock" size={20} />
                </div>
                <h3 className="text-sm font-bold text-slate-800 mb-1.5">Ghi giờ thực tế</h3>
                <p className="text-[11px] text-slate-400 font-normal leading-normal max-w-[200px]">
                  Ghi nhận số giờ/khung giờ làm thực tế bạn đã thực hiện để lưu vào lịch sử công việc.
                </p>
              </div>
            </button>

            {/* Plan/Estimate Card */}
            <button
              type="button"
              onClick={() => setStep("plan")}
              className="flex flex-col items-center text-center p-6 h-full w-full rounded-2xl border border-slate-200 bg-white hover:border-indigo-500 hover:bg-indigo-50/10 hover:shadow-md transition-all group cursor-pointer min-h-[190px]"
            >
              <div className="flex flex-col items-center justify-center flex-1">
                <div className="h-12 w-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3.5 group-hover:bg-indigo-100 transition-colors shrink-0">
                  <ShopifyIcon name="target" size={20} />
                </div>
                <h3 className="text-sm font-bold text-slate-800 mb-1.5">Lên kế hoạch dự kiến</h3>
                <p className="text-[11px] text-slate-400 font-normal leading-normal max-w-[200px]">
                  Đặt/Cập nhật thời gian làm dự tính (Estimate) để lập kế hoạch phân bổ thời gian.
                </p>
              </div>
            </button>
          </div>
          <div className="flex justify-end mt-8 border-t border-slate-100 pt-4">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer" type="button" onClick={onClose}>Hủy</button>
          </div>
        </div>
      )}

      {step !== "choice" && (
        <form className="task-form-modern task-log-work-form" onSubmit={handleSubmit}>
          <div className="task-checkbox-row task-checkbox-row-soft mb-3 bg-blue-50/30 p-3 rounded-xl border border-blue-50/50">
            <input
              type="checkbox"
              id="use-time-slot"
              checked={useTimeSlot}
              onChange={e => setUseTimeSlot(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="use-time-slot" className="font-semibold text-blue-700">
              Chọn khung giờ chi tiết (Bắt đầu - Kết thúc)
            </label>
          </div>

          {useTimeSlot ? (
            <div className="grid grid-cols-2 gap-4 mb-4">
              <TimePickerDropdown label="Bắt đầu lúc" value={startTime} onChange={setStartTime} required />
              <TimePickerDropdown label="Kết thúc lúc" value={endTime} onChange={setEndTime} required />
            </div>
          ) : null}

          <div className="task-form-grid task-log-work-grid">
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-slate-400 mb-1.5">
                {step === "actual" ? "Số phút làm" : "Số phút dự kiến"} {getDurationLabel(minutes)}
              </label>
              <input
                type="number"
                required
                disabled={useTimeSlot}
                value={minutes}
                onChange={e => setMinutes(e.target.value)}
                className={`rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 focus:bg-white transition ${useTimeSlot ? "opacity-60 cursor-not-allowed" : ""}`}
              />
            </div>
            <DatePickerField
              label={step === "actual" ? "Ngày làm việc" : "Ngày thực hiện dự kiến"}
              value={workDate}
              onChange={setWorkDate}
              openDirection="down"
              required
            />
          </div>

          {people.loading && <p role="status">Loading project members…</p>}
          {people.error && <div role="alert">{people.error} <button type="button" onClick={people.refresh}>Retry loading project members</button></div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <CustomDropdown
              label="Người thực hiện"
              value={userId}
              options={[
                { value: "none", label: "Chưa giao", icon: "person" },
                ...performerOptions
              ]}
              onChange={setUserId}
            />
            <CustomDropdown
              label="Loại thời gian"
              value={workType}
              options={[
                { value: "delivery",       label: "Triển khai",         icon: "settings", pillBg: "#dbeafe", pillColor: "#1d4ed8" },
                { value: "consulting",     label: "Tư vấn khách hàng",  icon: "person",   pillBg: "#f3e8ff", pillColor: "#7e22ce" },
                { value: "meeting",        label: "Họp",                 icon: "calendar", pillBg: "#e0f2fe", pillColor: "#0369a1" },
                { value: "training",       label: "Đào tạo người dùng",  icon: "star",     pillBg: "#d1fae5", pillColor: "#065f46" },
                { value: "support",        label: "Sửa lỗi / hỗ trợ",   icon: "clock",    pillBg: "#fef3c7", pillColor: "#92400e" },
                { value: "blueprint",      label: "Thiết kế giải pháp",  icon: "order",    pillBg: "#ede9fe", pillColor: "#6d28d9" },
                { value: "rework",         label: "Làm lại",             icon: "clock",    pillBg: "#fee2e2", pillColor: "#b91c1c" },
                { value: "internal_admin", label: "Nội bộ / Hành chính", icon: "settings", pillBg: "#f1f5f9", pillColor: "#475569" },
                { value: "kh_c",           label: "KH C",                icon: "person",   pillBg: "#e0e7ff", pillColor: "#3730a3" },
              ]}
              onChange={setWorkType}
            />
          </div>

          <div className="flex flex-col gap-2.5 my-1 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <div className="task-checkbox-row task-checkbox-row-soft">
              <input
                type="checkbox"
                id="billable-check"
                checked={billable}
                onChange={e => setBillable(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <label htmlFor="billable-check">
                Tính phí
              </label>
            </div>
            {step === "actual" && (
              <div className="task-checkbox-row task-checkbox-row-soft">
                <input
                  type="checkbox"
                  id="complete-task-check"
                  checked={completeTask}
                  onChange={e => setCompleteTask(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor="complete-task-check" className="font-semibold text-blue-600">
                  Đánh dấu hoàn thành công việc này (Done)
                </label>
              </div>
            )}
          </div>

          <FormField
            label={step === "actual" ? "Ghi chú công việc" : "Ghi chú kế hoạch"}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={step === "actual" ? "Bạn đã xử lý phần nào?" : "Kế hoạch thực hiện chi tiết..."}
          />

          {submitError ? <p className="text-xs font-semibold text-red-600" role="alert">{submitError}</p> : null}

          <div className="task-form-actions task-log-actions pt-4 border-t border-slate-100 mt-4">
            <button className="task-button secondary" disabled={submitting} type="button" onClick={() => setStep("choice")}>Quay lại</button>
            <button disabled={submitting} className={`task-button primary ${step === "plan" ? "bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-100" : ""}`} type="submit">
              {submitting ? "Đang lưu..." : step === "actual" ? "Ghi thời gian" : "Lưu kế hoạch"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// MAIN TASK WORKBENCH COMPONENT
export function TasksWorkbench({
  tasks,
  accounts,
  projects,
  principal
}: {
  tasks: ResourceListResponse<ProjectTaskSummary>;
  accounts: AccountsResponse;
  projects: ResourceListResponse<ProjectSummary>;
  opportunities: ResourceListResponse<OpportunitySummary>;
  principal: string;
}) {
  const router = useRouter();
  const [localTasks, setLocalTasks] = useState<ProjectTaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastTone } | null>(null);
  const [dailyCapacityFeedback, setDailyCapacityFeedback] = useState<DailyActualLogFeedback | null>(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [deleteTaskRequest, setDeleteTaskRequest] = useState<ProjectTaskSummary | null>(null);
  const [workspaceAssigneeOptions, setWorkspaceAssigneeOptions] = useState<TaskSelectOption[]>([]);

  useEffect(() => {
    setLocalTasks(loadTaskDrafts(tasks.data));
  }, [tasks.data]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAssignees() {
      try {
        const users = await fetchWorkspaceUserOptions(controller.signal);
        setWorkspaceAssigneeOptions(users.map(toTaskAssigneeOption));
      } catch {
        if (!controller.signal.aborted) {
          setWorkspaceAssigneeOptions([]);
        }
      }
    }

    loadAssignees();
    return () => controller.abort();
  }, []);

  const triggerToast = (message: string, type: ToastTone = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const announceDailyCapacity = (feedback: DailyActualLogFeedback | null) => {
    setDailyCapacityFeedback(feedback);
    if (feedback) setTimeout(() => setDailyCapacityFeedback(null), 6500);
  };

  const syncTasks = (updatedList: ProjectTaskSummary[]) => {
    setLocalTasks(updatedList);
    persistTaskDrafts(updatedList);
  };

  const canUseOfflineDrafts = taskDraftsEnabled();

  // KPI calculations
  const totalCount = localTasks.length;
  const inProgressCount = localTasks.filter(t => t.status === "in_progress").length;
  const completedCount = localTasks.filter(t => t.status === "completed").length;
  const overdueCount = localTasks.filter(t => t.overdue).length;

  // Selected task detail helper
  const selectedTask = localTasks.find(t => t.id === selectedTaskId);

  // Filters application
  const filteredTasks = localTasks.filter(t => {
    const displayTitle = formatTaskTitle(t.title);
    const matchesSearch = displayTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (t.description || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAccount = filterAccount === "all" || t.accountId === filterAccount;
    const matchesProject = filterProject === "all" || t.projectId === filterProject;
    const matchesStatus = filterStatus === "all" || t.status === filterStatus;
    const matchesPriority = filterPriority === "all" || t.priority === filterPriority;
    const matchesStage = filterStage === "all" || getDeploymentStageForTask(t).index === Number(filterStage);

    return matchesSearch && matchesAccount && matchesProject && matchesStatus && matchesPriority && matchesStage;
  });

  // API Call: Edit Task
  const handleEditTask = async (taskInput: any) => {
    if (!selectedTaskId || !selectedTask) return;

    const body = {
      accountId: taskInput.accountId,
      projectId: taskInput.projectId,
      title: taskInput.title,
      description: taskInput.description,
      taskType: taskInput.taskType,
      priority: taskInput.priority,
      ownerUserId: taskInput.assigneeUserId,
      assigneeUserId: taskInput.assigneeUserId,
      plannedStartAt: taskInput.plannedStartAt,
      dueAt: taskInput.dueAt,
      estimateMinutes: taskInput.estimateMinutes,
      customerVisible: taskInput.customerVisible
    };

    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}?principal=${encodeURIComponent(principal)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();
      const savedTask = (await response.json()) as ProjectTaskSummary;

      const editHistoryItem = {
        id: `hist-edit-${Date.now()}`,
        taskId: selectedTaskId,
        accountId: taskInput.accountId,
        toStatus: selectedTask.status,
        changedAt: new Date().toISOString(),
        reason: "Task details updated (Chỉnh sửa thông tin task)."
      };

      const updated = localTasks.map(t => {
        if (t.id === selectedTaskId) {
          return {
            ...t,
            ...savedTask,
            statusHistory: [editHistoryItem, ...(t.statusHistory || [])],
            updatedAt: savedTask.updatedAt ?? new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowEditModal(false);
      triggerToast(`Đã cập nhật công việc "${formatTaskTitle(taskInput.title)}".`, "success");
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Offline fallback
      const editHistoryItem = {
        id: `hist-edit-${Date.now()}`,
        taskId: selectedTaskId,
        accountId: taskInput.accountId,
        toStatus: selectedTask.status,
        changedAt: new Date().toISOString(),
        reason: "Task details updated (Offline Fallback)."
      };

      const updated = localTasks.map(t => {
        if (t.id === selectedTaskId) {
          return {
            ...t,
            ...taskInput,
            statusHistory: [editHistoryItem, ...(t.statusHistory || [])],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowEditModal(false);
      triggerToast("Đã lưu công việc ở chế độ offline.", "info");
    }
  };

  // API Call: Create Task
  const handleCreateTask = async (taskInput: any) => {
    const body: CreateProjectTaskInput = {
      accountId: taskInput.accountId,
      projectId: taskInput.projectId,
      stageId: taskInput.stageId,
      title: taskInput.title,
      description: taskInput.description,
      taskType: taskInput.taskType,
      status: "todo",
      priority: taskInput.priority,
      assigneeUserId: taskInput.assigneeUserId,
      estimateMinutes: taskInput.estimateMinutes,
      customerVisible: taskInput.customerVisible
    };

    try {
      const response = await fetch(`/api/tasks?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();

      const result = (await response.json()) as { id?: string };
      const taskId = result.id;
      if (!taskId) throw new Error();

      const createdTask: ProjectTaskSummary = {
        id: taskId,
        accountId: taskInput.accountId,
        accountName: taskInput.accountName,
        projectId: taskInput.projectId,
        projectName: taskInput.projectName,
        stageId: taskInput.stageId,
        sortOrder: 10,
        title: taskInput.title,
        description: taskInput.description,
        taskType: taskInput.taskType,
        status: "todo",
        priority: taskInput.priority,
        ownerUserId: taskInput.assigneeUserId,
        ownerDisplayName: taskInput.assigneeDisplayName,
        assigneeUserId: taskInput.assigneeUserId,
        assigneeDisplayName: taskInput.assigneeDisplayName,
        plannedStartAt: taskInput.plannedStartAt,
        dueAt: taskInput.dueAt,
        estimateMinutes: taskInput.estimateMinutes,
        loggedMinutes: 0,
        approvedMinutes: 0,
        overdue: false,
        customerVisible: taskInput.customerVisible,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        statusHistory: [
          {
            id: `hist-create-${Date.now()}`,
            taskId,
            accountId: taskInput.accountId,
            toStatus: "todo",
            changedAt: new Date().toISOString(),
            reason: "Task initialized."
          }
        ],
        timeEntries: []
      };

      const updated = [...localTasks, createdTask];
      syncTasks(updated);
      setShowCreateModal(false);
      triggerToast(`Đã tạo công việc "${formatTaskTitle(taskInput.title)}".`, "success");
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Fallback local support
      const fallbackTask: ProjectTaskSummary = {
        id: `task-${Date.now()}`,
        accountId: taskInput.accountId,
        accountName: taskInput.accountName,
        projectId: taskInput.projectId,
        projectName: taskInput.projectName,
        stageId: taskInput.stageId,
        sortOrder: 10,
        title: taskInput.title,
        description: taskInput.description,
        taskType: taskInput.taskType,
        status: "todo",
        priority: taskInput.priority,
        ownerUserId: taskInput.assigneeUserId,
        ownerDisplayName: taskInput.assigneeDisplayName,
        assigneeUserId: taskInput.assigneeUserId,
        assigneeDisplayName: taskInput.assigneeDisplayName,
        plannedStartAt: taskInput.plannedStartAt,
        dueAt: taskInput.dueAt,
        estimateMinutes: taskInput.estimateMinutes,
        loggedMinutes: 0,
        approvedMinutes: 0,
        overdue: false,
        customerVisible: taskInput.customerVisible,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        statusHistory: [
          {
            id: `hist-create-${Date.now()}`,
            taskId: `task-${Date.now()}`,
            accountId: taskInput.accountId,
            toStatus: "todo",
            changedAt: new Date().toISOString(),
            reason: "Task initialized."
          }
        ],
        timeEntries: []
      };
      const updated = [...localTasks, fallbackTask];
      syncTasks(updated);
      setShowCreateModal(false);
      triggerToast(`Đã tạo công việc "${formatTaskTitle(taskInput.title)}" ở chế độ offline.`, "info");
    }
  };

  // API Call: Transition Task
  const handleTransitionTask = async (newStatus: string, reason: string) => {
    if (!selectedTaskId || !selectedTask) return;

    const body: TransitionProjectTaskInput = {
      status: newStatus,
      reason,
      changedAt: new Date().toISOString()
    };

    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}/transitions?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();

      const newHistoryItem = {
        id: `hist-${Date.now()}`,
        taskId: selectedTaskId,
        accountId: selectedTask.accountId,
        fromStatus: selectedTask.status,
        toStatus: newStatus,
        changedAt: new Date().toISOString(),
        reason
      };

      const updated = localTasks.map(t => {
        if (t.id === selectedTaskId) {
          return {
            ...t,
            status: newStatus,
            statusHistory: [newHistoryItem, ...(t.statusHistory || [])],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowTransitionModal(false);
      triggerToast(`Đã chuyển trạng thái sang "${getStatusLabel(newStatus)}".`, "success");
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Offline fallback
      const newHistoryItem = {
        id: `hist-${Date.now()}`,
        taskId: selectedTaskId,
        accountId: selectedTask.accountId,
        fromStatus: selectedTask.status,
        toStatus: newStatus,
        changedAt: new Date().toISOString(),
        reason
      };

      const updated = localTasks.map(t => {
        if (t.id === selectedTaskId) {
          return {
            ...t,
            status: newStatus,
            statusHistory: [newHistoryItem, ...(t.statusHistory || [])],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowTransitionModal(false);
      triggerToast("Đã chuyển trạng thái ở chế độ offline.", "info");
    }
  };

  // API Call: Log Work Effort
  const handleLogWork = async (logInput: TaskTimeEntryFormInput) => {
    if (!selectedTaskId || !selectedTask) return;
    setDailyCapacityFeedback(null);

    const selectedUserId = resolveTaskTimeEntryUserId(logInput, principal);
    const selectedUserOption = workspaceAssigneeOptions.find((option) => option.value === selectedUserId);

    const body: CreateTaskTimeEntryInput = buildCreateTaskTimeEntryInput(logInput, principal);

    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}/time-entries?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();

      const savedEntry = await response.json() as CreateTaskTimeEntryResponse;
      const { dailyActualLog, ...savedTimeEntry } = savedEntry;
      const capacityFeedback = getDailyActualLogFeedback(
        dailyActualLog,
        savedEntry.userDisplayName ?? selectedUserOption?.label
      );

      const newEntry = {
        ...savedTimeEntry,
        id: savedTimeEntry.id ?? `entry-${Date.now()}`,
        taskId: selectedTaskId,
        accountId: selectedTask.accountId,
        userId: savedTimeEntry.userId ?? selectedUserId,
        userDisplayName: savedTimeEntry.userDisplayName ?? selectedUserOption?.label ?? (principal === "founder" ? "Kha Nguyen" : "Deliverer Team"),
        userAvatarUrl: savedTimeEntry.userAvatarUrl,
        workDate: savedTimeEntry.workDate ?? logInput.startAt ?? logInput.workDate,
        startAt: savedTimeEntry.startAt ?? logInput.startAt,
        endAt: savedTimeEntry.endAt ?? logInput.endAt,
        timeZone: savedTimeEntry.timeZone ?? logInput.timeZone,
        minutes: savedTimeEntry.minutes ?? logInput.minutes,
        billable: savedTimeEntry.billable ?? logInput.billable ?? true,
        workType: savedTimeEntry.workType ?? logInput.workType ?? "delivery",
        approvalStatus: savedTimeEntry.approvalStatus ?? "approved",
        note: savedTimeEntry.note ?? logInput.note,
        createdAt: savedTimeEntry.createdAt ?? new Date().toISOString()
      };

      const updated = localTasks.map(t => {
        if (t.id === selectedTaskId) {
          const entries = [...(t.timeEntries || []), newEntry];
          const totalLogged = entries.reduce((acc, curr) => acc + curr.minutes, 0);
          return {
            ...t,
            timeEntries: entries,
            loggedMinutes: totalLogged,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowLogModal(false);
      triggerToast(`Đã ghi nhận ${formatTaskMinutes(logInput.minutes)} làm việc.`, "success");
      announceDailyCapacity(capacityFeedback);
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Offline fallback
      const newEntry = {
        id: `entry-${Date.now()}`,
        taskId: selectedTaskId,
        accountId: selectedTask.accountId,
        userId: selectedUserId,
        userDisplayName: selectedUserOption?.label ?? (principal === "founder" ? "Kha Nguyen" : "Deliverer Team"),
        workDate: logInput.workDate,
        startAt: logInput.startAt,
        endAt: logInput.endAt,
        timeZone: logInput.timeZone,
        minutes: logInput.minutes,
        billable: logInput.billable ?? true,
        workType: logInput.workType ?? "delivery",
        approvalStatus: "approved",
        note: logInput.note,
        createdAt: new Date().toISOString()
      };

      const updated = localTasks.map(t => {
        if (t.id === selectedTaskId) {
          const entries = [...(t.timeEntries || []), newEntry];
          const totalLogged = entries.reduce((acc, curr) => acc + curr.minutes, 0);
          return {
            ...t,
            timeEntries: entries,
            loggedMinutes: totalLogged,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowLogModal(false);
      triggerToast("Đã ghi nhận thời gian ở chế độ offline.", "info");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const task = localTasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${taskId}?principal=${encodeURIComponent(principal)}`, {
        method: "DELETE"
      });

      if (!response.ok) throw new Error();
      const updated = localTasks.filter(t => t.id !== taskId);
      syncTasks(updated);
      setSelectedTaskId(null);
      triggerToast("Đã xóa công việc.", "success");
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      const updated = localTasks.filter(t => t.id !== taskId);
      syncTasks(updated);
      setSelectedTaskId(null);
      triggerToast("Đã xóa công việc ở chế độ offline.", "info");
    }
  };

  return (
    <div className="tasks-workbench">
      <section className="tasks-hero">
        <div className="tasks-hero-main">
          <span className="tasks-hero-icon">
            <ShopifyIcon name="list" size={20} />
          </span>
          <div className="tasks-hero-copy">
            <span className="tasks-hero-kicker">Không gian vận hành</span>
            <h2>Công việc cần xử lý</h2>
            <p>Gom việc triển khai, hỗ trợ khách hàng và thời gian tính phí vào một màn hình gọn để đội vận hành theo dõi mỗi ngày.</p>
            <div className="tasks-hero-pills" aria-label="Tóm tắt trạng thái công việc">
              <span><ShopifyIcon name="clock" size={13} /> {inProgressCount} đang xử lý</span>
              <span><ShopifyIcon name="alert" size={13} /> {overdueCount} quá hạn</span>
              <span><ShopifyIcon name="check" size={13} /> {completedCount} hoàn tất</span>
            </div>
          </div>
        </div>
        <div className="tasks-hero-actions">
          <a className="shopify-secondary-action tasks-delivery-action" href="/delivery">
            <ShopifyIcon name="handoff" />
            Dự án triển khai
          </a>
          <button
            className="shopify-primary-action tasks-primary-action"
            disabled={accounts.data.length === 0}
            onClick={() => {
              if (accounts.data.length === 0) {
                triggerToast("Hãy tạo khách hàng thật trước khi tạo công việc vận hành.", "info");
                return;
              }
              setShowCreateModal(true);
            }}
            title={accounts.data.length === 0 ? "Cần có khách hàng thật trước khi tạo công việc." : undefined}
            type="button"
          >
            <ShopifyIcon name="plus" />
            Tạo công việc
          </button>
        </div>
      </section>

      <section className="tasks-kpi-grid" aria-label="Chỉ số công việc">
        {[
          { label: "Tổng công việc", value: totalCount, note: "Trong phạm vi đang xem", icon: "list" as ShopifyIconName, tone: "neutral" },
          { label: "Đang xử lý", value: inProgressCount, note: "Cần theo dõi trong ngày", icon: "clock" as ShopifyIconName, tone: "info" },
          { label: "Quá hạn", value: overdueCount, note: "Ưu tiên tháo chặn", icon: "alert" as ShopifyIconName, tone: "danger" },
          { label: "Hoàn tất", value: completedCount, note: "Đã đóng trong danh sách", icon: "check" as ShopifyIconName, tone: "success" }
        ].map((metric) => (
          <article className={`tasks-kpi-card tone-${metric.tone}`} key={metric.label}>
            <span className="tasks-kpi-icon">
              <ShopifyIcon name={metric.icon} size={17} />
            </span>
            <span className="tasks-kpi-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <span className="tasks-kpi-note">{metric.note}</span>
          </article>
        ))}
      </section>

      <section className="tasks-filter-card">
        <div className="tasks-section-head">
          <span className="tasks-section-title">
            <ShopifyIcon name="filter" size={15} />
            Bộ lọc công việc
          </span>
          <span className="tasks-section-count">{filteredTasks.length} việc đang hiển thị</span>
        </div>
        <div className="tasks-filter-grid">
          <label className="tasks-search-field">
            <span className="task-field-label">Tìm theo tên / mô tả</span>
            <span className="tasks-search-control">
              <ShopifyIcon name="search" size={15} />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="VD: kickoff, khảo sát, hỗ trợ..."
              />
            </span>
          </label>

          <CustomDropdown
            label="Khách hàng"
            value={filterAccount}
            options={[
              { value: "all", label: "Tất cả khách hàng", icon: "person" },
              ...accounts.data.map(a => ({ value: a.id, label: a.name, icon: "person" }))
            ]}
            onChange={setFilterAccount}
          />

          <CustomDropdown
            label="Dự án"
            value={filterProject}
            options={[
              { value: "all", label: "Tất cả dự án", icon: "order" },
              ...projects.data.map(p => ({ value: p.id, label: p.name, icon: "order" }))
            ]}
            onChange={setFilterProject}
          />

          <CustomDropdown
            label="Trạng thái"
            value={filterStatus}
            options={[
              { value: "all", label: "Tất cả trạng thái", icon: "clock" },
              { value: "todo", label: "Cần làm", icon: "clock" },
              { value: "in_progress", label: "Đang xử lý", icon: "star", iconTone: "info" },
              { value: "completed", label: "Hoàn tất", icon: "checkmark", iconTone: "success" },
              { value: "blocked", label: "Đang bị chặn", icon: "alert-circle", iconTone: "critical" },
              { value: "cancelled", label: "Đã hủy", icon: "alert-circle", iconTone: "neutral" }
            ]}
            onChange={setFilterStatus}
          />

          <CustomDropdown
            label="Ưu tiên"
            value={filterPriority}
            options={[
              { value: "all", label: "Tất cả mức ưu tiên", icon: "star" },
              { value: "high", label: "Cao", icon: "alert-circle", iconTone: "critical" },
              { value: "medium", label: "Vừa", icon: "star", iconTone: "warning" },
              { value: "low", label: "Thấp", icon: "checkmark", iconTone: "success" }
            ]}
            onChange={setFilterPriority}
          />

          <CustomDropdown
            label="Stage triển khai"
            value={filterStage}
            options={[
              { value: "all", label: "Tất cả stage", icon: "target" },
              ...deploymentStagePlan.map((stage, index) => ({
                value: String(index),
                label: `${stage.activity} · ${stage.cumulativePercent}%`,
                icon: stage.criteria === "Số hóa" ? "settings" : "target",
                iconTone: stage.criteria === "Số hóa" ? "warning" : index >= 5 ? "success" : "info"
              }))
            ]}
            onChange={setFilterStage}
          />
        </div>
      </section>

      <section className="tasks-list-card">
        <div className="tasks-section-head">
          <span className="tasks-section-title">
            <ShopifyIcon name="briefcase" size={15} />
            Danh sách công việc
          </span>
          <span className="tasks-section-count">{filteredTasks.length}/{totalCount} việc</span>
        </div>

          {filteredTasks.length ? (
            <ShopifyDataTable
              ariaLabel="Danh sách công việc vận hành"
              columns={[
                {
                  key: "task",
                  width: "22%",
                  mobileLabel: "Công việc",
                  mobilePriority: "title",
                  header: (
                    <span className="tasks-table-heading">
                      <ShopifyIcon name="info" size={14} />
                      Công việc
                    </span>
                  )
                },
                {
                  key: "account",
                  width: "22%",
                  mobileLabel: "Khách hàng / dự án",
                  header: (
                    <span className="tasks-table-heading">
                      <ShopifyIcon name="users" size={14} />
                      Khách hàng / dự án
                    </span>
                  )
                },
                {
                  key: "priority",
                  width: "14%",
                  mobileLabel: "Ưu tiên",
                  header: (
                    <span className="tasks-table-heading">
                      <ShopifyIcon name="spark" size={14} />
                      Ưu tiên
                    </span>
                  )
                },
                {
                  key: "type",
                  width: "18%",
                  mobileLabel: "Loại",
                  header: (
                    <span className="tasks-table-heading">
                      <ShopifyIcon name="target" size={14} />
                      Loại
                    </span>
                  )
                },
                {
                  key: "status",
                  width: "14%",
                  mobileLabel: "Trạng thái",
                  mobilePriority: "hidden",
                  header: (
                    <span className="tasks-table-heading">
                      <ShopifyIcon name="info" size={14} />
                      Trạng thái
                    </span>
                  )
                },
                {
                  key: "time",
                  width: "10%",
                  mobileLabel: "Thời gian",
                  header: (
                    <span className="tasks-table-heading">
                      <ShopifyIcon name="clock" size={14} />
                      Thời gian
                    </span>
                  )
                },
                {
                  key: "actions",
                  width: "12%",
                  mobileLabel: "Hành động",
                  header: (
                    <span className="tasks-table-heading">
                      Hành động
                    </span>
                  )
                }
              ]}
              minWidth={980}
              rows={filteredTasks.map(t => {
                  const isSelected = t.id === selectedTaskId;
                  const displayTitle = formatTaskTitle(t.title);
                  const statusTone = getTaskStatusTone(t.status);
                  const priorityTone = getTaskPriorityTone(t.priority);
                  const deploymentStage = getDeploymentStageForTask(t);
                  const estimateMinutes = Number(t.estimateMinutes || 0);
                  const loggedMinutes = Number(t.loggedMinutes || 0);
                  const timePercent = estimateMinutes > 0 ? Math.min(100, Math.round((loggedMinutes / estimateMinutes) * 100)) : 0;

                  return {
                    key: t.id,
                    onClick: () => {
                      const url = `/tasks/${t.id}` + (principal ? `?principal=${encodeURIComponent(principal)}` : "");
                      router.push(url);
                    },
                    selected: isSelected,
                    mobileTitle: displayTitle,
                    mobileSubtitle: [t.accountName, t.projectName].filter(Boolean).join(" · "),
                    mobileMeta: (
                      <s-badge tone={statusTone === "danger" ? "critical" : statusTone}>
                        {getStatusLabel(t.status)}
                      </s-badge>
                    ),
                    cells: [
                      (
                        <div className="tasks-task-cell">
                          <span className={`tasks-task-icon tone-${statusTone}`}>
                            <ShopifyIcon name={getTaskTypeShopifyIcon(t.taskType)} size={15} />
                          </span>
                          <span className="tasks-task-text">
                            <span className="tasks-task-title">{displayTitle}</span>
                            <span className="tasks-task-meta">{t.dueAt ? `Hạn ${formatTaskDate(t.dueAt)}` : "Chưa đặt hạn"}</span>
                            <span className="tasks-task-meta">Stage {deploymentStage.label}</span>
                          </span>
                        </div>
                      ),
                      (
                        <div className="tasks-relation-cell">
                          <span className="tasks-relation-title">{t.accountName}</span>
                          <span className="tasks-relation-meta">{t.projectName || "Chưa gắn dự án"}</span>
                        </div>
                      ),
                      (
                        <span className={`tasks-chip tone-${priorityTone}`}>
                          {getPriorityLabel(t.priority)}
                        </span>
                      ),
                      (
                        <span className="tasks-type-pill">
                          <ShopifyIcon name={getTaskTypeShopifyIcon(t.taskType)} size={14} />
                          {getTaskTypeLabel(t.taskType)}
                        </span>
                      ),
                      <span className={`tasks-chip tone-${statusTone}`}>{getStatusLabel(t.status)}</span>,
                      (
                        <div className="tasks-time-cell">
                          <span>{formatTaskMinutes(loggedMinutes)} / {formatTaskMinutes(estimateMinutes)}</span>
                          <span className="tasks-time-track" aria-hidden="true">
                            <span style={{ width: `${timePercent}%` }} />
                          </span>
                        </div>
                      ),
                      (
                        <div className="delivery-project-row-actions">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedTaskId(t.id);
                              setShowEditModal(true);
                            }}
                            type="button"
                          >
                            Sửa
                          </button>
                          <button
                            data-tone="danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTaskRequest(t);
                            }}
                            type="button"
                          >
                            Xóa
                          </button>
                        </div>
                      )
                    ]
                  };
                })}
            />
          ) : (
            <div className="tasks-empty-state">
              <PolarisFallbackText>
                {totalCount === 0
                  ? "Chưa có công việc thật. Hãy tạo khách hàng và dự án trước khi bắt đầu vận hành."
                  : "Chưa có công việc phù hợp với bộ lọc hiện tại."}
              </PolarisFallbackText>
            </div>
          )}
      </section>

      {deleteTaskRequest ? (
        <ConfirmActionDialog
          confirmLabel="Xóa công việc"
          onCancel={() => setDeleteTaskRequest(null)}
          onConfirm={async () => {
            const taskId = deleteTaskRequest.id;
            setDeleteTaskRequest(null);
            await handleDeleteTask(taskId);
          }}
          title="Xóa công việc này?"
          tone="danger"
        >
          Công việc "{formatTaskTitle(deleteTaskRequest.title)}" sẽ bị xóa khỏi danh sách vận hành. Thao tác này không nên dùng để archive dữ liệu khách hàng thật.
        </ConfirmActionDialog>
      ) : null}

      {/* CREATE TASK MODAL */}
      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateTask}
        accounts={accounts.data}
        projects={projects.data}
        stages={deploymentStagePlan.map((stage, index) => ({
          activity: stage.activity,
          cumulativePercent: stage.cumulativePercent,
          id: `plan-stage-${index}`,
          phase: stage.phase,
          taskType: getTaskTypeForStageActivity(stage.activity)
        }))}
        assigneeOptions={workspaceAssigneeOptions}
      />



      {showEditModal && selectedTask ? (
        <EditTaskModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSave={handleEditTask}
          task={selectedTask}
          accounts={accounts.data}
          projects={projects.data}
          assigneeOptions={workspaceAssigneeOptions}
        />
      ) : null}

      {/* TOAST OVERLAY BANNER */}
      {dailyCapacityFeedback && (
        <div
          aria-live="polite"
          role="status"
          style={{
            position: "fixed",
            bottom: "84px",
            right: "24px",
            zIndex: 9999,
            maxWidth: "min(420px, calc(100vw - 32px))",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: dailyCapacityFeedback.tone === "warning" ? "rgba(180, 83, 9, 0.96)" : "rgba(59, 73, 223, 0.96)",
            color: "#fff",
            boxShadow: "var(--shadow-panel)",
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-2)",
            fontSize: "13.5px",
            fontWeight: 500
          }}
        >
          <ToastIcon type={dailyCapacityFeedback.tone} />
          <span><strong>{dailyCapacityFeedback.heading}.</strong> {dailyCapacityFeedback.message}</span>
        </div>
      )}
      {toast && (
        <div aria-live="polite" role="status" style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-md)",
          background: toast.type === "success"
            ? "rgba(0, 128, 96, 0.9)"
            : toast.type === "danger"
              ? "rgba(224, 0, 0, 0.9)"
              : toast.type === "warning"
                ? "rgba(180, 83, 9, 0.96)"
                : "rgba(92, 106, 196, 0.9)",
          color: "#fff",
          boxShadow: "var(--shadow-panel)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          fontSize: "13.5px",
          fontWeight: 500,
          animation: "shopify-section-enter 250ms ease-out"
        }}>
          <ToastIcon type={toast.type} />
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
