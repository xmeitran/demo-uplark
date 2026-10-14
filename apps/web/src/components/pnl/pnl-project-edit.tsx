"use client";

import { useState, type FormEvent } from "react";
import type { PnlProjectResponse, PnlProjectTemplate, PnlProjectValueInput, PnlTemplateOverrideInput, PnlTemplatesResponse } from "@b2b-crm/contracts";
import { formatMoneyInput, inputClass } from "./pnl-cost-shared";
import { formatExactVnd } from "./pnl-format";
import { TemplateItemChecklist } from "./pnl-setup-templates";
import { Field, ModalActions, PnlModal, SaveFeedback, useSave } from "./pnl-setup-ui";
import { PnlLoadError, pnlRequest, primaryButtonClass, usePnlLoad } from "./pnl-ui";
import { projectValueSubmitDisabled } from "./pnl-project-edit-logic";

type Revenue = PnlProjectResponse["data"]["totals"]["revenue"];

/** "67.200.000" as typed → 67200000; anything that is not a whole positive amount → null. */
export function parseVndAmount(text: string): number | null {
  const digits = text.replace(/[\s.,đ₫]/gi, "");
  if (!/^\d{1,15}$/.test(digits)) return null;
  const amount = Number(digits);
  return amount > 0 ? amount : null;
}

/**
 * PL-13 / D-22 — "Sửa" trên ô Doanh thu: PM nhập doanh thu dự án (VND) theo số liệu BD. Sau G1, đổi một giá trị đã có
 * phải ghi lý do; mỗi lần lưu vào "Lịch sử thay đổi số liệu". The API enforces every rule; this form only mirrors them.
 */
export function ProjectValueModal({ projectId, revenue, reload, onClose }: Readonly<{ projectId: string; revenue: Revenue; reload: () => Promise<void>; onClose: () => void }>) {
  const save = useSave(reload);
  const current = revenue.projectValueAmount;
  const [amountText, setAmountText] = useState(current === null ? "" : current.toLocaleString("vi-VN"));
  const [reason, setReason] = useState("");
  const amount = parseVndAmount(amountText);
  async function submit() {
    if (projectValueSubmitDisabled(amount, current, revenue.reasonRequired, reason)) return;
    const body: PnlProjectValueInput = { amount, reason: reason.trim() || undefined };
    if (await save.run(() => pnlRequest(`/api/pnl/projects/${encodeURIComponent(projectId)}/project-value`, { method: "PUT", body }))) onClose();
  }
  return (
    <PnlModal title={current === null ? "Nhập doanh thu dự án" : "Sửa doanh thu dự án"} onClose={onClose} onSubmit={() => void submit()} footer={<ModalActions onCancel={onClose} busy={save.busy} disabled={projectValueSubmitDisabled(amount, current, revenue.reasonRequired, reason)} submitLabel="Lưu" />}>
      <Field label="Doanh thu dự án (đồng)" htmlFor="pnl-project-value" hint={amount === null ? "Nhập số tiền VND trực tiếp cho dự án, ví dụ 67.200.000." : `= ${formatExactVnd(amount)}`}>
        <input id="pnl-project-value" inputMode="numeric" autoComplete="off" value={amountText} onChange={(event) => setAmountText(event.target.value)} className={inputClass} placeholder="67.200.000" />
      </Field>
      <Field label={revenue.reasonRequired ? "Lý do điều chỉnh (bắt buộc — dự án đã qua G1)" : "Lý do (không bắt buộc)"} htmlFor="pnl-project-value-reason">
        <input id="pnl-project-value-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} placeholder="Ví dụ: Phụ lục 02" />
      </Field>
      <p className="text-xs text-muted-foreground">Đây là nguồn doanh thu duy nhất của dự án trong P&amp;L và được nhập trực tiếp tại đây. G7 chỉ quyết định nhãn dự kiến/chính thức; không tự lấy số từ hệ thống và không khóa giá trị đã nhập.</p>
      <SaveFeedback error={save.error} message={null} />
    </PnlModal>
  );
}

/** Inline editor used by the Doanh thu dự án line in the P&L item tree. */
export function ProjectValueInlineForm({ projectId, revenue, reload, canEdit }: Readonly<{ projectId: string; revenue: Revenue; reload: () => Promise<void>; canEdit: boolean }>) {
  const save = useSave(reload);
  const current = revenue.projectValueAmount;
  const [amountText, setAmountText] = useState(current === null ? "" : formatMoneyInput(String(current)));
  const [reason, setReason] = useState("");
  const amount = parseVndAmount(amountText);
  const disabled = projectValueSubmitDisabled(amount, current, revenue.reasonRequired, reason);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const body: PnlProjectValueInput = { amount, reason: reason.trim() || undefined };
    await save.run(() => pnlRequest(`/api/pnl/projects/${encodeURIComponent(projectId)}/project-value`, { method: "PUT", body }));
  }

  if (!canEdit || !revenue.canEdit) return <p className="text-xs text-muted-foreground">Bạn chỉ có quyền xem doanh thu dự án.</p>;
  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-xl border border-primary/20 bg-background p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Field label="Doanh thu dự án (đồng)" htmlFor="pnl-project-value-inline" hint={amount === null ? "Nhập số tiền VND, ví dụ 67.200.000." : `= ${formatExactVnd(amount)}`}>
        <input id="pnl-project-value-inline" inputMode="numeric" autoComplete="off" value={amountText} onChange={(event) => setAmountText(formatMoneyInput(event.target.value))} className={inputClass} placeholder="67.200.000" />
      </Field>
      <Field label={revenue.reasonRequired ? "Lý do điều chỉnh (bắt buộc)" : "Lý do (không bắt buộc)"} htmlFor="pnl-project-value-inline-reason">
        <input id="pnl-project-value-inline-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} placeholder={revenue.reasonRequired ? "Ví dụ: Phụ lục 02" : "Có thể để trống"} />
      </Field>
      <button type="submit" disabled={disabled || save.busy} className={primaryButtonClass}>{save.busy ? "Đang lưu…" : current === null ? "Lưu doanh thu" : "Cập nhật"}</button>
      <div className="space-y-2 sm:col-span-3">
        <p className="text-xs text-muted-foreground">Doanh thu này được lưu trực tiếp cho project và dùng để tính EBIT. Không lấy tự động từ hệ thống.</p>
        <SaveFeedback error={save.error} message={save.message} />
      </div>
    </form>
  );
}

/** PL-22 — "Ghi đè mẫu": bật, tắt khoản mục của mẫu cho riêng dự án này, bắt buộc lý do. */
export function TemplateOverrideModal({ projectId, template, reload, onClose }: Readonly<{ projectId: string; template: PnlProjectTemplate; reload: () => Promise<void>; onClose: () => void }>) {
  const templates = usePnlLoad<PnlTemplatesResponse>("/api/pnl/config/templates", "Không tải được danh sách khoản mục.");
  const save = useSave(reload);
  const [disabledCodes, setDisabledCodes] = useState<string[]>(template.disabledCodes);
  const [reason, setReason] = useState(template.override?.reason ?? "");
  const templateOff = templates.data?.data.templates.find((entry) => entry.key === template.key)?.disabledCodes ?? [];
  async function submit() {
    if (!reason.trim()) return;
    // Against the template of the project type: what this project switches off, and what it switches back on.
    const body: PnlTemplateOverrideInput = { disabledCodes: disabledCodes.filter((code) => !templateOff.includes(code)), enabledCodes: templateOff.filter((code) => !disabledCodes.includes(code)), reason: reason.trim() };
    if (await save.run(() => pnlRequest(`/api/pnl/projects/${encodeURIComponent(projectId)}/template-override`, { method: "PUT", body }))) onClose();
  }
  return (
    <PnlModal title={`Ghi đè mẫu ${template.name} cho dự án này`} onClose={onClose} onSubmit={() => void submit()} footer={<ModalActions onCancel={onClose} busy={save.busy} disabled={!reason.trim() || !templates.data} submitLabel="Lưu ghi đè" />}>
      <Field label="Lý do (bắt buộc)" htmlFor="pnl-override-reason"><input id="pnl-override-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} placeholder="Ví dụ: hợp đồng không bán license" /></Field>
      {templates.data ? <TemplateItemChecklist items={templates.data.data.items} disabledCodes={disabledCodes} onChange={setDisabledCodes} />
        : templates.loading ? <p className="text-sm text-muted-foreground">Đang tải danh sách khoản mục…</p> : (templates.error ? <PnlLoadError error={templates.error} onRetry={templates.reload} /> : null)}
      <p className="text-xs text-muted-foreground">Ghi đè chỉ ảnh hưởng dự án này và hiện ở Thiết lập P&amp;L › Mẫu khoản mục. Dự án đã qua G7 giữ mẫu tại thời điểm nghiệm thu.</p>
      <SaveFeedback error={save.error} message={null} />
    </PnlModal>
  );
}
