"use client";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { ModalLayer } from "./modal-layer";

type PolarisModalElement = HTMLElement & {
  hideOverlay?: () => void;
  showOverlay?: () => void;
};

export function ShopifyModal({
  children,
  onClose,
  open,
  size = "base",
  title
}: Readonly<{
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  size?: "small" | "base" | "large" | "large-100";
  title: string;
}>) {
  const modalRef = useRef<PolarisModalElement | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const fallbackRef = useDialogAccessibility(fallbackOpen && open, onClose);

  useEffect(() => {
    let cancelled = false;
    const modal = modalRef.current;
    if (!modal) {
      return;
    }
    const target = modal;
    if (!open) { target.hideOverlay?.(); setFallbackOpen(false); return; }
    const fallbackTimer = window.setTimeout(() => {
      const nativeDialog = target.shadowRoot?.querySelector("dialog") as HTMLDialogElement | null;
      if (!cancelled && !nativeDialog?.open) setFallbackOpen(true);
    }, 200);

    async function syncOverlay() {
      if (typeof customElements !== "undefined") {
        await customElements.whenDefined("s-modal");
      }

      if (cancelled) {
        return;
      }

      if (open) {
        setFallbackOpen(false);
        target.showOverlay?.();
        window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          const dialog = target.shadowRoot?.querySelector("dialog") as HTMLDialogElement | null;
          const nativeOverlayVisible = Boolean(dialog?.open);
          if (!nativeOverlayVisible) {
            setFallbackOpen(true);
          }
        }, 180);
        return;
      }

      target.hideOverlay?.();
      setFallbackOpen(false);
    }

    void syncOverlay();

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [open]);

  return (
    <>
      {createElement(
        "s-modal",
        {
          accessibilityLabel: title,
          heading: title,
          onHide: onClose,
          padding: "base",
          ref: modalRef,
          size
        },
        children
      )}
      {fallbackOpen && open ? (
        <ModalLayer onClose={onClose}>
        <div className="shopify-dialog-backdrop" role="presentation">
          <section ref={fallbackRef} aria-label={title} aria-modal="true" tabIndex={-1} className={`shopify-native-dialog ${size}`} role="dialog">
            <header className="shopify-native-dialog-header">
              <strong>{title}</strong>
              <button aria-label={`Close ${title}`} onClick={onClose} type="button">
                Close
              </button>
            </header>
            <div className="shopify-native-dialog-body">{children}</div>
          </section>
        </div>
        </ModalLayer>
      ) : null}
    </>
  );
}
