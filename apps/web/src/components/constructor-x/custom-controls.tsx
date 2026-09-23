"use client";

import React, { useState, useRef, useEffect, useId, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check, Info } from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional live-data context shown below the option label. */
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  color?: string; // Hex color indicator
  bg?: string;    // Light bg for badges
}

interface CustomDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** Opens a detail surface for an option without changing the selected value. */
  onOptionInfo?: (option: DropdownOption) => void;
}

interface CustomDatePickerProps {
  value: string; // "MMM DD, YYYY" or ISO Date format
  onChange: (formattedDate: string) => void;
  placeholder?: string;
  ariaLabel: string;
}

// ─── CUSTOM DROPDOWN COMPONENT ────────────────────────────────────────────────

export function CustomDropdown({ options, value, onChange, placeholder = "Select option", className = "", ariaLabel, onOptionInfo }: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        aria-label={ariaLabel}
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 text-left transition-all"
        style={{ borderColor: open ? "#2563eb" : "var(--color-input)" }}
      >
        <span className="flex items-center gap-2 truncate">
          {selectedOption ? (
            <>
              {selectedOption.icon && <selectedOption.icon className="w-4 h-4 text-muted-foreground shrink-0" />}
              {selectedOption.color && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedOption.color }} />
              )}
              <span className="truncate">{selectedOption.label}</span>
            </>
          ) : (
            <span className="text-muted-foreground/50">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-250 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 mt-1.5 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden py-1"
            style={{ maxHeight: "240px", overflowY: "auto", boxShadow: "0 8px 30px rgba(0,0,0,0.12)" }}
          >
            {options.map((opt) => (
              <div key={opt.value} className={`flex items-stretch gap-1 px-1 ${value === opt.value ? "bg-primary/5" : ""}`}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors hover:bg-muted ${
                    value === opt.value ? "text-primary" : "text-foreground"
                  }`}
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    {opt.icon && <opt.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    {opt.color && (
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.description ? <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{opt.description}</span> : null}
                    </span>
                    {value === opt.value && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                  </span>
                </button>
                {onOptionInfo ? (
                  <button
                    type="button"
                    aria-label={`Xem chi tiết ${opt.label}`}
                    title={`Xem chi tiết ${opt.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      onOptionInfo(opt);
                    }}
                    className="mt-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── CUSTOM DATE PICKER COMPONENT (Calendar Popover) ─────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function CustomDatePicker({ value, onChange, placeholder = "Select date", ariaLabel }: CustomDatePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [focusedDay, setFocusedDay] = useState(1);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0, width: 288, placement: "bottom" as "top" | "bottom" });

  // Parse initial date
  const initialDate = value && value !== "TBD" ? new Date(value) : new Date();
  const [currentYear, setCurrentYear] = useState(isNaN(initialDate.getTime()) ? new Date().getFullYear() : initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(isNaN(initialDate.getTime()) ? new Date().getMonth() : initialDate.getMonth());

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const viewportPadding = 8;
      const gap = 6;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverWidth = Math.min(288, window.innerWidth - viewportPadding * 2);
      const popoverHeight = popoverRef.current?.offsetHeight ?? 304;
      const modalFooter = trigger.closest('[role="dialog"]')?.querySelector<HTMLElement>('[data-modal-footer="true"]');
      const lowerBoundary = Math.min(
        window.innerHeight - viewportPadding,
        modalFooter?.getBoundingClientRect().top ?? window.innerHeight - viewportPadding
      );
      const spaceBelow = lowerBoundary - triggerRect.bottom;
      const spaceAbove = triggerRect.top - viewportPadding;
      const placement = spaceBelow < popoverHeight + gap && spaceAbove > spaceBelow ? "top" : "bottom";
      const unclampedTop = placement === "top"
        ? triggerRect.top - popoverHeight - gap
        : triggerRect.bottom + gap;
      const top = Math.min(
        Math.max(viewportPadding, unclampedTop),
        Math.max(viewportPadding, window.innerHeight - popoverHeight - viewportPadding)
      );
      const left = Math.min(
        Math.max(viewportPadding, triggerRect.left),
        Math.max(viewportPadding, window.innerWidth - popoverWidth - viewportPadding)
      );

      setPopoverPosition({ top, left, width: popoverWidth, placement });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, currentMonth, currentYear]);

  // Sync calendar position if value changes
  useEffect(() => {
    if (value && value !== "TBD") {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
      }
    }
  }, [value]);

  // Calendar helpers
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sunday
  const calendarCellCount = Math.ceil((firstDayIndex + daysInMonth) / 7) * 7;
  const calendarWeeks = Array.from({ length: calendarCellCount / 7 }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => weekIndex * 7 + dayIndex - firstDayIndex + 1)
  );

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const d = new Date(currentYear, currentMonth, day);
    const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    onChange(formatted);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, day: number) => {
    const dayDelta: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7
    };
    const delta = dayDelta[event.key];
    if (!delta) return;
    event.preventDefault();
    const nextDay = day + delta;
    if (nextDay < 1 || nextDay > daysInMonth) return;
    setFocusedDay(nextDay);
    popoverRef.current?.querySelector<HTMLElement>(`[data-calendar-day="${nextDay}"]`)?.focus();
  };

  // Check if a specific grid day matches currently selected value
  const isSelected = (day: number) => {
    if (!value || value === "TBD") return false;
    const d = new Date(value);
    return (
      d.getDate() === day &&
      d.getMonth() === currentMonth &&
      d.getFullYear() === currentYear
    );
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === currentMonth &&
      today.getFullYear() === currentYear
    );
  };

  useEffect(() => {
    if (!open) return;
    const selectedDate = value && value !== "TBD" ? new Date(value) : null;
    const selectedDay = selectedDate && !isNaN(selectedDate.getTime()) &&
      selectedDate.getMonth() === currentMonth && selectedDate.getFullYear() === currentYear
      ? selectedDate.getDate()
      : null;
    const today = new Date();
    const todayDay = today.getMonth() === currentMonth && today.getFullYear() === currentYear
      ? today.getDate()
      : null;
    setFocusedDay(selectedDay ?? todayDay ?? 1);
  }, [open, currentMonth, currentYear, value]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLElement>(`[data-calendar-day="${focusedDay}"]`)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, currentMonth, currentYear, focusedDay]);

  const formattedDisplay = value || placeholder;

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={ariaLabel}
        className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 text-left transition-all"
        style={{ borderColor: open ? "#2563eb" : "var(--color-input)" }}
      >
        <span className="flex items-center gap-2 truncate">
          <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className={!value ? "text-muted-foreground/50" : ""}>{formattedDisplay}</span>
        </span>
      </button>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
          <motion.div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label={`${ariaLabel} calendar`}
            data-date-picker-popover="true"
            initial={{ opacity: 0, y: popoverPosition.placement === "top" ? -8 : 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: popoverPosition.placement === "top" ? -8 : 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="fixed z-[400] p-4 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
            style={{
              top: popoverPosition.top,
              left: popoverPosition.left,
              width: popoverPosition.width,
              boxShadow: "0 10px 40px rgba(0,0,0,0.15)"
            }}
          >
            {/* Header controls */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-foreground">
                {MONTH_NAMES[currentMonth]} {currentYear}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="Previous month"
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="Next month"
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Weekdays */}
            <div className="grid grid-cols-7 gap-1 text-center mb-2" aria-hidden="true">
              {DAYS_SHORT.map(d => (
                <span key={d} className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {d}
                </span>
              ))}
            </div>

            {/* Monthly Days grid */}
            <div className="flex flex-col gap-1 text-center" role="grid" aria-label={`${MONTH_NAMES[currentMonth]} ${currentYear}`}>
              {calendarWeeks.map((week, weekIndex) => (
                <div key={`week-${weekIndex}`} role="row" className="grid grid-cols-7 gap-1">
                  {week.map((day, cellIndex) => {
                    if (day < 1 || day > daysInMonth) {
                      return <div key={`empty-${weekIndex}-${cellIndex}`} role="gridcell" aria-disabled="true" />;
                    }
                    const active = isSelected(day);
                    const today = isToday(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => handleSelectDay(day)}
                        onKeyDown={(event) => handleDayKeyDown(event, day)}
                        role="gridcell"
                        aria-selected={active}
                        aria-label={`${MONTH_NAMES[currentMonth]} ${day}, ${currentYear}`}
                        tabIndex={day === focusedDay ? 0 : -1}
                        data-calendar-day={day}
                        data-today={today ? "true" : "false"}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold transition-all hover:bg-muted text-foreground"
                        style={{
                          backgroundColor: active ? "#2563eb" : "transparent",
                          color: active ? "#ffffff" : today ? "#e11d48" : "var(--color-foreground)",
                          boxShadow: active
                            ? "0 2px 8px rgba(37,99,235,0.2)"
                            : today
                              ? "inset 0 0 0 1px rgba(225,29,72,0.45)"
                              : "none",
                        }}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
