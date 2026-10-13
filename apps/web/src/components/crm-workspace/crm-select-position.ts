import type { CSSProperties } from "react";

const PORTAL_MENU_MAX_HEIGHT = 236; // .task-select-menu max-height
const PORTAL_MENU_GAP = 6;

/** Fixed position of a portalled menu under (or above, when there is no room below) its trigger. */
export function portalMenuStyle(rect: { top: number; bottom: number; left: number; width: number }, viewportHeight: number, preferred: "up" | "down" = "down"): CSSProperties {
  const below = viewportHeight - rect.bottom;
  const up = preferred === "up" ? rect.top >= PORTAL_MENU_MAX_HEIGHT + PORTAL_MENU_GAP || rect.top > below : below < PORTAL_MENU_MAX_HEIGHT + PORTAL_MENU_GAP && rect.top > below;
  // Above the confirm dialog backdrop (z-index 3600).
  const base: CSSProperties = { position: "fixed", left: rect.left, width: rect.width, zIndex: 4000 };
  return up ? { ...base, top: "auto", bottom: viewportHeight - rect.top + PORTAL_MENU_GAP } : { ...base, top: rect.bottom + PORTAL_MENU_GAP, bottom: "auto" };
}

const POPOVER_MARGIN = 8;

/**
 * Fixed position of a portalled popover of a known size: under its trigger, above it when only
 * that side fits, and always shifted back inside the viewport.
 */
export function portalPopoverStyle(rect: { top: number; bottom: number; left: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): CSSProperties {
  const fitsBelow = rect.bottom + PORTAL_MENU_GAP + size.height + POPOVER_MARGIN <= viewport.height;
  const fitsAbove = rect.top - PORTAL_MENU_GAP - size.height >= POPOVER_MARGIN;
  const top = fitsBelow || !fitsAbove ? rect.bottom + PORTAL_MENU_GAP : rect.top - PORTAL_MENU_GAP - size.height;
  const clamp = (value: number, max: number) => Math.max(POPOVER_MARGIN, Math.min(value, max - POPOVER_MARGIN));
  return { position: "fixed", zIndex: 4000, left: clamp(rect.left, viewport.width - size.width), top: clamp(top, viewport.height - size.height) };
}
