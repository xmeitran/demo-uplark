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
