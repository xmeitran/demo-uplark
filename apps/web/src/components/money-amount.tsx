"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCompactVnd, formatVnd } from "@/lib/currency";

/** Presentation only: preserve the numeric value and disclose its full formatted amount. */
export function MoneyAmount({ value, className }: { value: number | null | undefined; className?: string }) {
  const exact = formatVnd(value);
  const compact = formatCompactVnd(value);
  const expandable = exact !== compact;
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const touchNextOpen = useRef<boolean | null>(null);
  const hoveringTooltip = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const cancelClose = () => { clearTimeout(closeTimer.current); };
  const show = () => { cancelClose(); setOpen(true); };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      const parent = trigger.current?.parentElement?.closest("button,a[href],[role='button']");
      if (!hoveringTooltip.current && !trigger.current?.contains(document.activeElement) && parent !== document.activeElement) setOpen(false);
    }, 150);
  };
  useEffect(() => {
    const parent = trigger.current?.parentElement?.closest<HTMLElement>("button,a[href],[role='button']");
    setNested(Boolean(parent));
    if (!parent) return;
    const focus = () => setOpen(true);
    const blur = scheduleClose;
    parent.addEventListener("focus", focus); parent.addEventListener("blur", blur);
    return () => { parent.removeEventListener("focus", focus); parent.removeEventListener("blur", blur); };
  }, [expandable]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) hoveringTooltip.current = false;
    if (!expandable) setOpen(false);
  }, [open, expandable]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const box = tooltip.current?.getBoundingClientRect();
      if (!rect || !box) return;
      const top = rect.bottom + box.height + 20 <= window.innerHeight ? rect.bottom + 8 : rect.top - box.height - 8;
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12)), top: Math.max(12, Math.min(top, window.innerHeight - box.height - 12)) });
    };
    update();
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelClose(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => {
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true);
    };
  }, [open, exact]);
  if (!expandable) return <span className={className}>{compact}</span>;
  return <>
    <span ref={trigger} className={`money-amount ${className ?? ""}`} tabIndex={nested ? undefined : 0}
      aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={show} onBlur={scheduleClose}
      onPointerDown={event => { touchNextOpen.current = event.pointerType === "touch" || event.pointerType === "pen" ? !open : null; }}
      onClick={event => { if (touchNextOpen.current !== null) { event.preventDefault(); event.stopPropagation(); cancelClose(); setOpen(touchNextOpen.current); touchNextOpen.current = null; } }}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); cancelClose(); setOpen(current => !current); }
        if (open && ["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          tooltip.current?.scrollBy({ top: (event.key.endsWith("Down") ? 1 : -1) * (event.key.startsWith("Page") ? 120 : 32) });
        }
      }}>
      <span aria-hidden="true">{compact}</span><span className="sr-only">{exact}</span>
    </span>
    {open && createPortal(<span ref={tooltip} id={id} role="tooltip" className="money-amount-tooltip" style={position}
      onMouseEnter={() => { hoveringTooltip.current = true; cancelClose(); }}
      onMouseLeave={() => { hoveringTooltip.current = false; scheduleClose(); }}
      onPointerDown={event => { hoveringTooltip.current = true; event.stopPropagation(); }} onClick={event => event.stopPropagation()}>{exact}</span>, document.body)}
  </>;
}
