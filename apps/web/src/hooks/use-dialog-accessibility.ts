"use client";
import { useEffect, useRef } from "react";
const focusSelector = "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
const activeDialogs: symbol[] = [];
let scrollLocks = 0;
let savedOverflow = "";

/** Gives existing product dialogs keyboard containment without changing their visual structure. */
export function useDialogAccessibility(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog || dialog.closest("[data-modal-layer]")) return;
    const id = Symbol("dialog");
    activeDialogs.push(id);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (scrollLocks++ === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    // Inert only siblings along the dialog's ancestor chain; never hide the dialog itself.
    const background = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = dialog;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement && sibling.getAttribute("aria-hidden") !== "true" && !["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) {
          background.set(sibling, sibling.inert); sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const isTop = () => activeDialogs[activeDialogs.length - 1] === id;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector)).filter(el => el.getClientRects().length > 0 && !el.closest("[inert]"));
    const frame = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus({ preventScroll: true }));
    const isOwnedPopover = (target: EventTarget | null) => target instanceof Node && Array.from(dialog.querySelectorAll<HTMLElement>("[aria-controls]")).some(control => { const popup = document.getElementById(control.getAttribute("aria-controls") || ""); return popup?.contains(target); });
    const keydown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented || isOwnedPopover(event.target)) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target) && !isOwnedPopover(event.target)) (focusable()[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", containFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", containFocus);
      const index = activeDialogs.indexOf(id); if (index >= 0) activeDialogs.splice(index, 1);
      for (const [element, wasInert] of background) element.inert = wasInert;
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
