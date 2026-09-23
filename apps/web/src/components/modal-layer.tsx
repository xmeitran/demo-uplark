"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const modalStack: symbol[] = [];
let scrollLockCount = 0;
let overflowBeforeFirstLock = "";

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    overflowBeforeFirstLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = overflowBeforeFirstLock;
  }
}

function isVisible(element: HTMLElement) {
  return !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.getClientRects().length > 0;
}

export function ModalLayer({
  children,
  closeOnEscape = true,
  initialFocusSelector,
  lockScroll = true,
  onClose
}: Readonly<{
  children: ReactNode;
  closeOnEscape?: boolean;
  initialFocusSelector?: string;
  lockScroll?: boolean;
  onClose: () => void;
}>) {
  const layerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const layerTokenRef = useRef(Symbol("modal-layer"));
  // Capture before commit: a child's autoFocus runs before this layer's effects.
  const openerRef = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);


  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const layerToken = layerTokenRef.current;
    const previouslyFocused = openerRef.current;
    modalStack.push(layerToken);
    if (lockScroll) lockBodyScroll();
    // Keep portalled layers above application content while preventing background focus.
    const background = new Map<HTMLElement, boolean>();
    const layer = layerRef.current;
    for (const sibling of Array.from(document.body.children)) {
      if (sibling !== layer && sibling instanceof HTMLElement && !["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) {
        background.set(sibling, sibling.inert); sibling.inert = true;
      }
    }


    const getDialog = () => layerRef.current?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
    const ownedPopovers = () => Array.from(getDialog()?.querySelectorAll<HTMLElement>("[aria-controls]") ?? [])
      .map(control => document.getElementById(control.getAttribute("aria-controls") ?? ""))
      .filter((popup): popup is HTMLElement => Boolean(popup));
    const containsOwnedTarget = (target: EventTarget | null) => target instanceof Node && ownedPopovers().some(popup => popup.contains(target));
    const getFocusable = () => Array.from(
      getDialog()?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
    ).filter(isVisible);
    const getManagedFocusable = () => {
      const dialogFocusable = getFocusable();
      const popoverFocusable = Array.from(
        document.querySelectorAll<HTMLElement>('[data-date-picker-popover="true"]')
      ).flatMap((popover) => Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)))
        .filter(isVisible);
      const ownedFocusable = ownedPopovers().flatMap(popup => Array.from(popup.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))).filter(isVisible);
      return Array.from(new Set([...dialogFocusable, ...popoverFocusable, ...ownedFocusable]));
    };

    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = getDialog();
      const preferred = initialFocusSelector
        ? dialog?.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      (preferred ?? dialog?.querySelector<HTMLElement>("[autofocus]") ?? getFocusable()[0] ?? dialog)?.focus();
    });
    let escapeTimer: number | undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== layerToken) return;
      if (event.key === "Escape" && closeOnEscape) {
        if (document.querySelector('[data-date-picker-popover="true"]')) return;
        window.clearTimeout(escapeTimer);
        escapeTimer = window.setTimeout(() => {
          if (!event.defaultPrevented && modalStack.at(-1) === layerToken) {
            onCloseRef.current();
          }
        }, 0);
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = getDialog();
      if (!dialog) return;
      const focusable = getManagedFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElementIsManaged = document.activeElement instanceof HTMLElement
        && focusable.includes(document.activeElement);
      if (!activeElementIsManaged) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const containFocus = (event: FocusEvent) => {
      if (modalStack.at(-1) !== layerToken || containsOwnedTarget(event.target)) return;
      const dialog = getDialog();
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) (getFocusable()[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(escapeTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", containFocus);
      for (const [element, wasInert] of background) element.inert = wasInert;
      const stackIndex = modalStack.lastIndexOf(layerToken);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      if (lockScroll) unlockBodyScroll();
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")) previouslyFocused.focus({ preventScroll: true });
      });
    };
  }, [closeOnEscape, initialFocusSelector, lockScroll]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] isolate" data-modal-layer="true" ref={layerRef}>
      {children}
    </div>,
    document.body
  );
}
