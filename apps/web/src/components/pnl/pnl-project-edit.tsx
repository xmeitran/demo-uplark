"use client";

import { useState } from "react";
import type { PnlProjectResponse, PnlProjectTemplate, PnlProjectValueInput, PnlTemplateOverrideInput, PnlTemplatesResponse } from "@b2b-crm/contracts";
import { inputClass } from "./pnl-cost-shared";
import { formatExactVnd } from "./pnl-format";
import { TemplateItemChecklist } from "./pnl-setup-templates";
import { Field, ModalActions, PnlModal, SaveFeedback, useSave } from "./pnl-setup-ui";
import { PnlLoadError, pnlRequest, usePnlLoad } from "./pnl-ui";

type Revenue = PnlProjectResponse["data"]["totals"]["revenue"];

/** "67.200.000" as typed → 67200000; anything that is not a whole positive amount → null. */
export function parseVndAmount(text: string): number | null {
  const digits = text.replace(/[\s.,đ₫]/gi, "");
  if (!/^\d{1,15}$/.test(digits)) return null;
  const amount = Number(digits);
  return amount > 0 ? amount : null;
}

/**
 * PL-13 / D-22 — "Sửa" trên ô Doanh thu: PM nhập Giá trị dự án (VND) theo số liệu BD. Sau G1, đổi một giá trị đã có
 * phải ghi lý do; mỗi lần lưu vào "Lịch sử thay đổi số liệu". The API enforces every rule; this form only mirrors them.
 */
export function ProjectValueModal({ projectId, revenue, reload, onClose }: Readonly<{ projectId: string; revenue: Revenue; reload: () => Promise<void>; onClose: () => void }>) {
  const save = useSave(reload);
  const current = revenue.projectValueAmount;
  const [amountText, setAmountText] = useState(current === null ? "" : current.toLocaleString("vi-VN"));
  const [reason, setReason] = useState("");
  const amount = parseVndAmount(amountText);
  const missingReason = revenue.reasonRequired && !reason.trim();
  async function submit() {
    if (amount === null || missingReason) return;
    const body: PnlProjectValueInput = { amount, reason: reason.trim() || undefined };
    if (await save.run(() => pnlRequest(`/api/pnl/projects/${encodeURIComponent(projectId)}/project-value`, { method: "PUT", body }))) onClose();
  }
  return (
    <PnlModal title={current === null ? "Nhập Giá trị dự án" : "Sửa Giá trị dự án"} onClose={onClose} onSubmit={() => void submit()} footer={<ModalActions onCancel={onClose} busy={save.busy} disabled={amount === null || amount === current || missingReason} submitLabel="Lưu" />}>
      <Field label="Giá trị dự án (đồng)" htmlFor="pnl-project-value" hint={amount === null ? "Nhập số tiền VND theo số liệu BD, ví dụ 67.200.000." : `= ${formatExactVnd(amount)}`}>
        <input id="pnl-project-value" inputMode="numeric" autoComplete="off" value={amountText} onChange={(event) => setAmountText(event.target.value)} className={inputClass} placeholder="67.200.000" />
      </Field>
      <Field label={revenue.reasonRequired ? "Lý do (bắt buộc — dự án đã qua G1)" : "Lý do (không bắt buộc)"} htmlFor="pnl-project-value-reason">
        <input id="pnl-project-value-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} placeholder="Ví dụ: Phụ lục 02" />
      </Field>
      <p className="text-xs text-muted-foreground">Trước G7 đây là doanh thu dự kiến (EBIT dự kiến); khi G7 được duyệt, số này được ghi nhận một lần thành doanh thu và khóa lại. Hợp đồng, phụ lục theo dõi ngoài hệ thống.</p>
      <SaveFeedback error={save.error} message={null} />
    </PnlModal>
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
