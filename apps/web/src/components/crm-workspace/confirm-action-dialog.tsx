"use client";

import { useId, type ReactNode } from "react";
import { ShopifyIcon, type ShopifyIconName } from "../shopify-ui";
import { ModalLayer } from "../modal-layer";

export type ConfirmActionTone = "danger" | "info" | "warning";

function iconForTone(tone: ConfirmActionTone): ShopifyIconName {
  if (tone === "danger" || tone === "warning") return "alert";
  return "info";
}

export function ConfirmActionDialog({
  cancelLabel = "Hủy",
  children,
  confirmLabel = "Xác nhận",
  loading = false,
  onCancel,
  onConfirm,
  title,
  tone = "info"
}: Readonly<{
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  tone?: ConfirmActionTone;
}>) {
  const titleId = useId();

  return (
    <ModalLayer closeOnEscape={!loading} onClose={onCancel}>
    <div className="crm-confirm-backdrop" onMouseDown={() => !loading && onCancel()} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`crm-confirm-dialog tone-${tone}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="crm-confirm-icon" aria-hidden="true">
          <ShopifyIcon name={iconForTone(tone)} size={18} />
        </div>
        <div className="crm-confirm-body">
          <h3 id={titleId}>{title}</h3>
          {typeof children === "string" ? <p>{children}</p> : children}
        </div>
        <div className="crm-confirm-actions">
          <button className="task-button secondary" disabled={loading} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className={`task-button ${tone === "danger" ? "danger" : "primary"}`} disabled={loading} onClick={() => void onConfirm()} type="button">
            {loading ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
    </ModalLayer>
  );
}
