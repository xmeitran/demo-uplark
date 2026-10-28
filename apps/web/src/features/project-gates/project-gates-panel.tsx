"use client";

/**
 * "Điểm chốt G1–G8": the gate part of the project's "Điểm chốt & Tài liệu" tab (rules 7.2, 8.1).
 * Renders what GET /projects/:id/gates returns; every action goes to the API, which decides what is allowed.
 * Renders nothing for a project on a hand-built framework (it keeps its milestone gates).
 */
import { avatarInitialsFor } from "@/lib/workspace-users";
import { UserAvatar } from "@/components/user-avatar";
import React, { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Circle, Clock, Lock, X } from "lucide-react";
import { gateActionLabel, gatePaymentText, type ProjectGateAction, type ProjectGateListResponse, type ProjectGateSummary } from "@b2b-crm/contracts";
import { CustomDropdown } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import { apiErrorMessage, readApiError } from "@/lib/api-error";
import { formatVietnamDate, formatVietnamTime } from "@/lib/vietnam-time";
import { StageExtensions } from "./stage-extensions";
import { customerConfirmationLabel, gateActionFields, gateActionInput, gateDocumentTypeOptions, gateStatusTone, gatesPassedCount, missingGateActionFields, type GateActionFieldKey } from "./project-gates-view";

type Member = { id: string; name: string };

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const labelClass = "mb-1.5 block text-xs font-semibold text-muted-foreground";
const headClass = "text-[10px] font-bold uppercase tracking-wide text-muted-foreground";
const ACTION_TONE: Record<ProjectGateAction, string> = {
  submit: "bg-primary text-primary-foreground",
  approve: "bg-emerald-600 text-white",
  approve_conditional: "border border-emerald-300 bg-emerald-50 text-emerald-800",
  reject: "border border-rose-200 bg-rose-50 text-rose-700",
  confirm_payment: "border border-border bg-background text-foreground",
  confirm_customer: "bg-amber-600 text-white",
  exception: "border border-violet-200 bg-violet-50 text-violet-700"
};
const ACTION_HINT: Partial<Record<ProjectGateAction, string>> = {
  approve_conditional: "Phần tồn đọng được tạo thành một Issue trong sổ vấn đề, có người chịu trách nhiệm và hạn.",
  confirm_customer: "Ghi nhận sau khi PM đã duyệt nội bộ. Dự án rời Tạm dừng khi đề xuất trạng thái được xác nhận.",
  exception: "Chỉ Dx Director (Admin). Lý do được lưu vết và hiển thị trên điểm chốt.",
  confirm_payment: "PM xác nhận theo thông tin từ BD. Chỉ là một dấu xác nhận: không nhập số tiền, không vào EBIT."
};

function withPrincipal(path: string) {
  const principal = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("principal")?.trim();
  return principal ? `${path}?principal=${encodeURIComponent(principal)}` : path;
}

const dateTime = (value?: string) => (value ? `${formatVietnamDate(value)} ${formatVietnamTime(value)}` : "");

function ActionDialog({ gate, action, members, saving, error, onClose, onSubmit }: {
  gate: ProjectGateSummary; action: ProjectGateAction; members: Member[]; saving: boolean; error: string | null;
  onClose: () => void; onSubmit: (values: Partial<Record<GateActionFieldKey, string>>) => void;
}) {
  const fields = gateActionFields(action, gate.definition, gate);
  const [values, setValues] = useState<Partial<Record<GateActionFieldKey, string>>>({ goLiveDate: gate.goLiveDate ?? "" });
  const missing = missingGateActionFields(fields, values);
  const title = `${gate.code} · ${gateActionLabel(action, gate.code)}`;
  const set = (key: GateActionFieldKey) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <ModalLayer onClose={onClose}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
        <form role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!missing.length) onSubmit(values); }} className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div><h3 className="text-sm font-bold text-foreground">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{gate.definition.name} · cuối {gate.stageName}</p></div>
            <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid min-h-[12rem] content-start gap-3 overflow-y-auto px-5 py-4">
            {ACTION_HINT[action] ? <p className="rounded-lg bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">{ACTION_HINT[action]}</p> : null}
            {fields.length === 0 ? <p className="text-sm text-foreground">Xác nhận {gateActionLabel(action, gate.code).toLowerCase()} hồ sơ {gate.code}?</p> : null}
            {fields.map((field) => {
              const label = <span className={labelClass}>{field.label}{field.required ? " *" : ""}</span>;
              const value = values[field.key] ?? "";
              if (field.kind === "member") return <div key={field.key}>{label}<CustomDropdown ariaLabel={field.label} options={members.map((member) => ({ value: member.id, label: member.name, initials: avatarInitialsFor(member.name) }))} value={value} onChange={set(field.key)} placeholder="Chọn thành viên" menuPortal /></div>;
              if (field.kind === "date") return <label key={field.key}>{label}<input type="date" value={value} onChange={(event) => set(field.key)(event.target.value)} className={inputClass} /></label>;
              if (field.kind === "textarea") return <label key={field.key}>{label}<textarea value={value} onChange={(event) => set(field.key)(event.target.value)} rows={3} placeholder={field.placeholder} className={`${inputClass} resize-none`} /></label>;
              return <label key={field.key}>{label}<input type="text" value={value} onChange={(event) => set(field.key)(event.target.value)} placeholder={field.placeholder} className={inputClass} /></label>;
            })}
          </div>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="alert" className="text-xs text-rose-600">{error ?? (missing.length ? `Bắt buộc: ${missing.join(", ")}` : "")}</p>
            <div className="flex shrink-0 justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Đóng</button>
              <button type="submit" disabled={saving || missing.length > 0} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">{saving ? "Đang lưu…" : gateActionLabel(action, gate.code)}</button>
            </div>
          </div>
        </form>
      </div>
    </ModalLayer>
  );
}

function GateCard({ gate, onAction, extend }: { gate: ProjectGateSummary; onAction: (gate: ProjectGateSummary, action: ProjectGateAction) => void; extend?: (list: ProjectGateListResponse) => void | Promise<void> }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { definition, sla } = gate;
  const passed = gate.status === "approved" || gate.status === "exception";
  // The G7 hours condition gets its own block (counts by reason + link), so its sentence is not repeated in the list.
  // Matches the API's message (gates.ts g7PendingHoursMessage): a key, not display text — keep in step with the API.
  const otherRequirements = gate.missingRequirements.filter((item) => !(gate.pnlPendingCheck?.blocked && item.startsWith("Còn giờ log Chờ xử lý")));
  return (
    <article aria-label={`Điểm chốt ${gate.code}`} className={`rounded-xl border border-border bg-card p-4 shadow-sm ${gate.reachable || passed ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-foreground px-2 py-1 text-[11px] font-black text-background">{gate.code}</span>
        <h3 className="text-sm font-bold text-foreground">{definition.name}</h3>
        <span className="text-xs text-muted-foreground">Cuối {gate.stageName} · {gate.milestoneName}</span>
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${gateStatusTone(gate.status)}`}>{gate.statusLabel}{gate.decision === "conditional" ? " · có điều kiện" : ""}</span>
        {!gate.reachable && !passed ? <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600"><Lock aria-hidden="true" className="h-3 w-3" /> Chờ điểm chốt trước</span> : null}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <div>
          <p className={headClass}>Tài liệu bắt buộc</p>
          <ul className="mt-1.5 space-y-1">
            {gate.documents.map((document) => (
              <li key={document.type} className="flex items-start gap-1.5 text-xs">
                {document.present ? <Check aria-label="Đã có" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Circle aria-label="Chưa có" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />}
                <span className={document.present ? "text-foreground" : "text-muted-foreground"}>{document.type}{document.documentName ? <span className="text-muted-foreground"> · {document.documentName}</span> : null}</span>
              </li>
            ))}
          </ul>
          {definition.dataConditions.length ? <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Điều kiện dữ liệu: {definition.dataConditions.join("; ")}.</p> : null}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p className={headClass}>Chuẩn bị · Duyệt</p>
          <p className="mt-1.5">Chuẩn bị: <span className="font-semibold text-foreground">{definition.preparedBy}</span>{gate.submittedAt ? ` · ${gate.submittedByName ?? "—"} nộp ${dateTime(gate.submittedAt)}` : ""}</p>
          <p>Duyệt: <span className="font-semibold text-foreground">{definition.approvedBy}</span>{gate.decidedAt ? <> · {gate.decidedByName ? <UserAvatar id={gate.decidedByUserId} name={gate.decidedByName} size="xs" className="mx-0.5 align-middle" /> : null}{`${gate.decidedByName ?? "Hệ thống"} ${gate.decision === "rejected" ? "từ chối" : "duyệt"} ${dateTime(gate.decidedAt)}`}</> : ""}</p>
          {gate.decisionReason ? <p>{gate.decision === "rejected" ? "Lý do từ chối" : "Tồn đọng"}: <span className="text-foreground">{gate.decisionReason}</span>{gate.conditionIssueCode ? ` (${gate.conditionIssueCode} trong sổ vấn đề)` : ""}</p> : null}
          {gate.paymentConfirmationRequired ? <p>Thu tiền ({gatePaymentText(gate.code)}): {gate.paymentConfirmedAt ? <span className="text-foreground">{gate.paymentConfirmedByName ?? "PM"} xác nhận {dateTime(gate.paymentConfirmedAt)}{gate.paymentNote ? ` · ${gate.paymentNote}` : ""}</span> : "PM chưa xác nhận"}</p> : null}
          {definition.goLiveDate ? <p>Ngày Go-live: <span className="text-foreground">{gate.goLiveDate ? formatVietnamDate(gate.goLiveDate) : "Chưa có"}</span></p> : null}
          {gate.exceptionAt ? <p className="text-violet-700">Ngoại lệ: {gate.exceptionByName ?? "Dx Director"} · {dateTime(gate.exceptionAt)} · {gate.exceptionReason}</p> : null}
          <p>Sau khi duyệt: {definition.opensNext}</p>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p className={headClass}>Khách xác nhận · SLA</p>
          <p className={`mt-1.5 font-semibold ${gate.customerOverdue ? "text-rose-600" : "text-foreground"}`}>{customerConfirmationLabel(gate)}</p>
          {gate.customerRequestedAt && !gate.customerConfirmedAt && gate.status === "awaiting_customer" ? <p>Gửi khách {dateTime(gate.customerRequestedAt)} · hạn phản hồi <span className={gate.customerOverdue ? "font-semibold text-rose-600" : "text-foreground"}>{formatVietnamDate(gate.customerDueAt)}</span></p> : null}
          {gate.customerConfirmedAt ? <p><span className="text-foreground">{gate.customerConfirmedBy ?? "—"}</span> · {formatVietnamDate(gate.customerConfirmedAt)}{gate.customerRecordedByName ? ` · ghi nhận bởi ${gate.customerRecordedByName}` : ""}</p> : null}
          {gate.customerEvidence ? <p className="break-words">Bằng chứng: {/^https?:\/\//.test(gate.customerEvidence) ? <a href={gate.customerEvidence} target="_blank" rel="noreferrer" className="!text-primary underline">{gate.customerEvidence}</a> : <span className="text-foreground">{gate.customerEvidence}</span>}</p> : null}
          {sla && sla.slaDays !== null ? (
            <p className="inline-flex flex-wrap items-center gap-1">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" /> SLA stage {sla.slaDays} ngày làm việc
              {sla.dueAt ? <> · hạn gợi ý <span className={sla.overrun ? "font-semibold text-rose-600" : "text-foreground"}>{formatVietnamDate(sla.dueAt)}</span></> : " · chưa bắt đầu"}
              {sla.overrun ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">Quá SLA {sla.overrunDays} ngày</span> : null}
              {sla.paused ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Đồng hồ đang dừng</span> : null}
              {sla.customerWaitDays > 0 ? <span>· chờ khách {sla.customerWaitDays} ngày (không tính chậm)</span> : null}
            </p>
          ) : null}
        </div>
      </div>

      {sla && extend ? <StageExtensions projectId={gate.projectId} sla={sla} onExtended={extend} /> : null}

      {otherRequirements.length > 0 && gate.reachable ? (
        <ul className="mt-3 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{otherRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}

      {/* P&L spec 12/10 point 6: the data condition of G7, shown before the approve action. */}
      {gate.pnlPendingCheck?.blocked ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" aria-label={`Giờ Chờ xử lý chặn duyệt ${gate.code}`}>
          <p className="font-semibold">Chưa duyệt được {gate.code}: còn giờ đã ghi ở trạng thái Chờ xử lý do thiếu hoặc sai phân loại</p>
          <ul className="mt-1 space-y-0.5">
            {gate.pnlPendingCheck.reasons.map((item) => <li key={item.reason}>{item.label}: {item.entryCount} giờ log · {(Math.round(item.minutes / 6) / 10).toLocaleString("vi-VN")} giờ</li>)}
          </ul>
          <p className="mt-1"><a href={gate.pnlPendingCheck.worklistHref} className="font-semibold underline">Mở danh sách giờ chờ</a> · Giờ chỉ chờ đơn giá giờ thì không chặn {gate.code} (P&amp;L để Tạm tính).</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gate.allowedActions.map((action) => (
          <button key={action} type="button" onClick={() => onAction(gate, action)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition hover:opacity-90 ${ACTION_TONE[action]}`}>{gateActionLabel(action, gate.code)}</button>
        ))}
        <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:underline">
          {historyOpen ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />} Lịch sử hồ sơ ({gate.history.length})
        </button>
      </div>
      {historyOpen ? (
        gate.history.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Chưa có thao tác nào.</p> : (
          <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
            {gate.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{entry.label}</span> · {entry.byName ?? "Hệ thống"} · {dateTime(entry.at)}{entry.note ? ` · ${entry.note}` : ""}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </article>
  );
}

export function ProjectGatesPanel({ projectId, members, onChanged, onDocumentTypes, refreshKey }: {
  projectId: string;
  members: Member[];
  /** Called after an action: the project status, its proposal and the milestone locks may have changed. */
  onChanged?: () => void | Promise<void>;
  /** The document types the gates ask for, so the upload dialog can offer them. */
  onDocumentTypes?: (types: string[]) => void;
  /** Change it to reload (a document was added or removed). */
  refreshKey?: unknown;
}) {
  const [list, setList] = useState<ProjectGateListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ gate: ProjectGateSummary; action: ProjectGateAction } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/gates`;

  const apply = useCallback((next: ProjectGateListResponse) => {
    setList(next);
    onDocumentTypes?.(gateDocumentTypeOptions(next.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(withPrincipal(base), { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw await readApiError(response); return response.json() as Promise<ProjectGateListResponse>; })
      .then((body) => { setLoadError(null); apply(body); })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(apiErrorMessage(error, "Không tải được điểm chốt")); });
    return () => controller.abort();
  }, [base, apply, refreshKey]);

  const submit = async (values: Partial<Record<GateActionFieldKey, string>>) => {
    if (!dialog) return;
    setSaving(true);
    setDialogError(null);
    try {
      const fields = gateActionFields(dialog.action, dialog.gate.definition, dialog.gate);
      const response = await fetch(withPrincipal(`${base}/${encodeURIComponent(dialog.gate.id)}/actions`), {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(gateActionInput(dialog.action, fields, values))
      });
      if (!response.ok) throw await readApiError(response);
      apply((await response.json()) as ProjectGateListResponse);
      setDialog(null);
      await onChanged?.();
    } catch (error) {
      setDialogError(apiErrorMessage(error, "Không lưu được thao tác. Vui lòng thử lại."));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{loadError}</div>;
  if (!list || !list.usesStageGates) return null;
  return (
    <section aria-label="Điểm chốt G1–G8" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Điểm chốt chuyển tiếp G1–G8</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{list.milestoneApprovalRequired === false
            ? "Dự án không yêu cầu duyệt milestone: mọi stage đều mở; điểm chốt tự thông qua theo thứ tự khi stage hoàn thành hết task, không cần nộp hoặc duyệt hồ sơ."
            : "Stage hoặc milestone kế tiếp chỉ mở khi hồ sơ đủ tài liệu bắt buộc và được duyệt. G1, G2, G4, G7 chờ khách xác nhận sau khi PM duyệt nội bộ."}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">{gatesPassedCount(list.data)}/{list.data.length} điểm chốt đã mở</span>
      </div>
      {list.data.map((gate) => <GateCard key={gate.id} gate={gate} extend={async (next) => { apply(next); await onChanged?.(); }} onAction={(target, action) => { setDialogError(null); setDialog({ gate: target, action }); }} />)}
      {dialog ? <ActionDialog gate={dialog.gate} action={dialog.action} members={members} saving={saving} error={dialogError} onClose={() => setDialog(null)} onSubmit={(values) => void submit(values)} /> : null}
    </section>
  );
}
