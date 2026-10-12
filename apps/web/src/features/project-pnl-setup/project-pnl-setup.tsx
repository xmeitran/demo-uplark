"use client";

/**
 * Mục 6.1 — "Thiết lập P&L của dự án" in the project detail: Ⓐ thông tin hợp đồng, Ⓑ hạng mục hợp đồng,
 * Ⓒ/Ⓓ/Ⓔ chi tiết Trọn gói / Theo giờ / Nội bộ (cùng một vị trí, theo hạng mục đang mở), Ⓕ khóa hạng mục và
 * Change request, Ⓖ estimate gốc và baseline. Everything shown comes from GET /pnl/projects/:id/setup and every
 * setting is written through the API and read back. Adding / editing an item itself stays with the page's own modal
 * (the existing contract-item endpoints): the page passes onAddItem / onEditItem.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import type { PnlContractStatusInput, PnlInstallment, PnlInstallmentsInput, PnlInstallmentStatus, PnlItemSettingsInput, PnlParameterValueInput, PnlProjectSetupResponse, PnlSetupItem, PnlTemplateOverrideInput, PnlTemplatesResponse } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { MonthFilter } from "@/components/filters/filter-controls";
import { currentPeriodKey, inputClass, parseDecimalInput } from "@/components/pnl/pnl-cost-shared";
import { formatDay, formatDong, formatEnteredPercent, formatHoursValue, formatMillions, formatMonth, formatPercent } from "@/components/pnl/pnl-format";
import { Field, linkClass, LoadingBlock, Mark, ModalActions, PnlModal, ReadOnlyNote, SaveFeedback, smallButton, Strip, toneClass, useSave } from "@/components/pnl/pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, primaryButtonClass, secondaryButtonClass, usePnlLoad } from "@/components/pnl/pnl-ui";
import { TemplateItemChecklist } from "@/components/pnl/pnl-setup-templates";
import { installmentTotalMessage, setupItemValueText } from "./setup-view";

type SetupData = PnlProjectSetupResponse["data"];
type Save = ReturnType<typeof useSave>;
export type SetupFallbackItem = { id: string; code: string; name: string; kindLabel: string; contractTypeLabel: string };

const INSTALLMENT_STATUSES: Array<{ value: PnlInstallmentStatus; label: string }> = [
  { value: "not_due", label: "Chưa đến" }, { value: "accepted", label: "Đã nghiệm thu" }, { value: "invoiced", label: "Đã xuất hóa đơn" }, { value: "paid", label: "Đã thu tiền" }
];
const SCOPE_LABELS = { company: "Bảng chung công ty", project: "Ghi đè cho dự án này", customer: "Theo khách hàng", project_type: "Theo loại dự án" } as const;
const th = "border-b border-border bg-muted/30 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const td = "border-b border-border/70 px-3 py-2.5 text-sm text-foreground";
const subTh = "border-b border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap";
const subTd = "border-b border-border/70 px-3 py-2 text-sm text-foreground";

export function ProjectPnlSetup({ projectId, canManage: allowedByPage, refreshKey, fallbackItems, onAddItem, onEditItem, onOpenChangeRequests }: Readonly<{
  projectId: string;
  /** Admin - PM (or the project's manager) edits; other Admin accounts only view. */
  canManage: boolean;
  /** Changes when the page's item modal saved: the block re-reads the API. */
  refreshKey?: string;
  /** Shown without any value when the API refuses the viewer (a User account, PL-26). */
  fallbackItems: readonly SetupFallbackItem[];
  onAddItem: () => void;
  onEditItem: (itemId: string) => void;
  /** Opens the Blocker/Risk/Issue tab, where a Yêu cầu thay đổi is recorded. */
  onOpenChangeRequests: () => void;
}>) {
  const base = `/api/pnl/projects/${encodeURIComponent(projectId)}`;
  const api = usePnlLoad<PnlProjectSetupResponse>(`${base}/setup`, "Không tải được thiết lập P&L của dự án.");
  // Mục 6.1 "Admin - PM sửa; Admin khác xem": the API decides (meta.canEdit), the page can only narrow it further.
  const canManage = allowedByPage && Boolean(api.data?.meta.canEdit);
  const save = useSave(api.reload);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [statusForm, setStatusForm] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const reload = api.reload;
  const seenKey = useRef(refreshKey);
  useEffect(() => { if (seenKey.current !== refreshKey) { seenKey.current = refreshKey; void reload(); } }, [refreshKey, reload]);

  const data = api.data?.data;
  if (!data || api.error) {
    if (api.loading) return <LoadingBlock rows={5} label="Đang tải thiết lập P&L của dự án…" />;
    if (api.error?.status === 403) return <UserFallback items={fallbackItems} />;
    return (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} /> : null);
  }

  const { contract } = data;
  const openItem = data.items.find((item) => item.id === openItemId) ?? null;
  const lockedItems = data.items.filter((item) => item.lockReasons.some((reason) => reason.kind !== "contract_signed"));
  const rootItem = data.items.find((item) => item.kind === "ROOT") ?? data.items[0] ?? null;

  return (
    <section aria-labelledby="project-pnl-setup-title" className={cardClass}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
        <h3 id="project-pnl-setup-title" className="!text-base font-bold text-foreground">{data.projectName} · {data.accountName} › Thiết lập P&amp;L</h3>
        <p className="text-sm text-muted-foreground">Admin - PM sửa · đơn vị triệu đồng</p>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        {!canManage ? <ReadOnlyNote>Chế độ chỉ xem: Admin - PM (hoặc PM phụ trách dự án) sửa thiết lập P&amp;L; tài khoản Admin khác chỉ xem.</ReadOnlyNote> : null}

        {/* Ⓐ Thông tin hợp đồng */}
        <div className="grid gap-3 md:grid-cols-3">
          <Tile label="Tổng giá trị hợp đồng" value={formatMillions(contract.totalAmount)} note={`Trọn gói ${formatMillions(contract.fixedPriceAmount)} · trần Theo giờ ${formatMillions(contract.hourlyCeilingAmount)}`} />
          <Tile label="Trạng thái hợp đồng" value={contract.statusLabel} note={contract.baseValuesReadOnly ? `giá trị gốc chỉ đọc${contract.signedOn ? ` · ký ${formatDay(contract.signedOn)}` : ""}` : "giá trị gốc còn sửa được"}
            action={canManage ? <button type="button" aria-expanded={statusForm} className={`${linkClass} text-xs`} onClick={() => { save.clear(); setStatusForm((value) => !value); }}>{contract.status === "signed" ? "Chuyển về Nháp" : "Chuyển sang Đã ký"}</button> : null} />
          <Tile label="Đã thu" value={formatMillions(contract.collectedAmount)} note={`đợt ${contract.collectedInstallments}/${contract.installmentCount} · không vào EBIT`} />
        </div>
        {statusForm && canManage ? <ContractStatusForm signed={contract.status === "signed"} busy={save.busy} onCancel={() => setStatusForm(false)}
          onSubmit={async (body) => { if (await save.run(() => pnlRequest(`${base}/setup/contract-status`, { method: "PUT", body }), body.status === "signed" ? "Hợp đồng đã chuyển sang Đã ký: giá trị gốc của mọi hạng mục chỉ đọc." : "Hợp đồng đã về Nháp.")) setStatusForm(false); }} /> : null}
        <SaveFeedback error={save.error} message={save.message} />

        {/* Ⓑ Hạng mục hợp đồng */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="!text-base font-bold text-foreground">Hạng mục hợp đồng</h4>
            {canManage ? <div className="flex flex-wrap gap-2"><button type="button" className={smallButton} onClick={onAddItem}>+ Thêm hạng mục</button><button type="button" className={smallButton} onClick={onOpenChangeRequests}>Tạo yêu cầu thay đổi</button></div> : null}
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead><tr>
                <th scope="col" className={th}>Mã</th><th scope="col" className={th}>Tên hạng mục</th><th scope="col" className={th}>Nguồn</th><th scope="col" className={th}>Loại</th>
                <th scope="col" className={`${th} !text-right`}>Giá trị</th><th scope="col" className={`${th} !text-right`}>Estimate</th><th scope="col" className={th}>Ghi nhận DT</th><th scope="col" className={th}>Khóa</th>
                {canManage ? <th scope="col" className={th}><span className="sr-only">Sửa</span></th> : null}
              </tr></thead>
              <tbody>
                {data.items.map((item) => {
                  const open = item.id === openItem?.id;
                  return (
                    <tr key={item.id} className={open ? "bg-primary/5" : "hover:bg-muted/25"}>
                      <td className={`${td} whitespace-nowrap`}><button type="button" aria-expanded={open} aria-controls="project-pnl-setup-detail" aria-label={`${open ? "Gập" : "Mở"} chi tiết ${item.code}`} className={`inline-flex items-center gap-1 rounded font-mono text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${open ? "!font-bold" : ""}`} onClick={() => setOpenItemId(open ? null : item.id)}>{open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}{item.code}</button></td>
                      <td className={td}>{item.name}</td>
                      <td className={td}>{item.kindLabel}</td>
                      <td className={td}>{item.contractTypeLabel}</td>
                      <td className={`${td} whitespace-nowrap text-right font-mono tabular-nums`}>{setupItemValueText(item)}</td>
                      <td className={`${td} whitespace-nowrap text-right font-mono tabular-nums`}>{item.estimateMinutes === null ? "" : `${formatHoursValue(item.estimateMinutes)} giờ`}</td>
                      <td className={td}>{item.revenueRecognition}</td>
                      <td className={`${td} whitespace-nowrap ${item.locked ? toneClass.warn : toneClass.muted}`}>{item.locked ? "Đã khóa" : "Mở"}</td>
                      {canManage ? <td className={`${td} text-right`}><button type="button" aria-label={`Sửa hạng mục ${item.code}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary" onClick={() => onEditItem(item.id)}><Pencil className="h-3.5 w-3.5" aria-hidden /></button></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data.items.length ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Chưa có hạng mục. {canManage ? "Bấm “+ Thêm hạng mục” để tạo hạng mục HĐ gốc: tên, loại, giá trị hoặc trần, estimate gốc (giờ)." : "Admin - PM tạo hạng mục HĐ gốc theo số liệu BD cung cấp."}</p> : null}
          </div>
        </div>

        {/* Ⓒ Ⓓ Ⓔ Chi tiết của hạng mục đang mở */}
        <div id="project-pnl-setup-detail">
          {openItem ? (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <h4 className="!text-base font-bold text-foreground">{openItem.code} · {openItem.contractTypeLabel} · chi tiết</h4>
              {openItem.hourly ? <HourlyDetail key={openItem.id} item={openItem} hourly={openItem.hourly} projectId={projectId} base={base} canManage={canManage} save={save} />
                : openItem.internal ? <InternalDetail key={openItem.id} item={openItem} internal={openItem.internal} base={base} canManage={canManage} save={save} />
                : openItem.contractType ? <FixedPriceDetail key={openItem.id} item={openItem} readOnlyValue={contract.baseValuesReadOnly} base={base} canManage={canManage} save={save} />
                : <p className="mt-1 text-sm text-muted-foreground">Hạng mục chưa có loại hợp đồng. Chọn Trọn gói, Theo giờ hoặc Nội bộ ở nút sửa của hạng mục để mở phần chi tiết.</p>}
            </div>
          ) : data.items.length ? <p className="text-xs text-muted-foreground">Bấm mã hạng mục để mở chi tiết: Trọn gói (đợt thanh toán), Theo giờ (trần, đơn giá bán) hoặc Nội bộ (trần chi phí).</p> : null}
        </div>

        {/* Ⓕ Khóa hạng mục và Change request */}
        {lockedItems.map((item) => (
          <Strip key={item.id} tone="warn" action={canManage ? <button type="button" className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" onClick={onOpenChangeRequests}>Tạo yêu cầu thay đổi ›</button> : null}>
            {item.code} đã khóa loại và giá trị gốc: {item.lockReasons.filter((reason) => reason.kind !== "contract_signed").map((reason) => reason.label).join(" · ")}
          </Strip>
        ))}

        {/* Ⓖ Estimate gốc và baseline */}
        <div className="rounded-xl border border-border px-4 py-3">
          <h4 className="!text-base font-bold text-foreground">Estimate gốc và baseline</h4>
          <ul className="mt-1.5">
            {[
              { ok: data.baseline.rootItemReady, text: `Hạng mục gốc đã có loại và giá trị${rootItem ? ` · ${rootItem.code}, estimate gốc ${rootItem.estimateMinutes === null ? "chưa nhập" : `${formatHoursValue(rootItem.estimateMinutes)} giờ`}` : ""}` },
              { ok: data.baseline.firstInstallmentPaid, text: "PM xác nhận đã thu đợt 1 (đánh dấu Đã thu tiền ở chi tiết Trọn gói)" },
              { ok: data.baseline.g1Approved, text: data.baseline.g1Approved ? `G1 đã duyệt${data.baseline.g1ApprovedOn ? ` ngày ${formatDay(data.baseline.g1ApprovedOn)}` : ""} · estimate gốc đã khóa thành B0 (phạm vi, giá) và B1 (milestone, timeline, giờ dự kiến)` : "G1 chưa duyệt · estimate gốc khóa thành B0 và B1 khi duyệt G1", link: data.baseline.g1Approved ? null : { href: "/admin#approval", label: "Admin › Approval" } }
            ].map((row) => (
              <li key={row.text} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-border py-2 text-sm first:border-t-0">
                <span className="flex min-w-0 flex-1 items-start gap-2.5"><span className="mt-0.5 shrink-0"><Mark ok={row.ok} /></span><span className="min-w-0 text-foreground">{row.text}</span></span>
                {row.link ? <Link href={row.link.href} className={`${linkClass} shrink-0`}>{row.link.label} ›</Link> : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-muted-foreground">{data.baseline.blockers.length ? `Chưa duyệt được G1: ${data.baseline.blockers.join(" · ")}` : "Giờ dự kiến của task lấy từ estimate gốc; đổi sau khi khóa phải được Admin duyệt và lưu trước – sau (xem khối Baseline của dự án)."}</p>
        </div>

        {/* Mẫu khoản mục của dự án (mục 6.6 khối 3) */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3 text-sm">
          <p className="min-w-0 flex-1 text-foreground">Mẫu khoản mục: <span className="font-semibold">{data.template.name}</span>
            {data.template.override ? <span className="text-muted-foreground"> · dự án ghi đè mẫu · {data.template.override.byName ?? "—"} · {formatDay(data.template.override.at)} · lý do: {data.template.override.reason}</span> : <span className="text-muted-foreground"> · theo Loại dự án, chưa ghi đè</span>}</p>
          {canManage ? <button type="button" className={smallButton} onClick={() => setOverrideOpen(true)}>Ghi đè mẫu cho dự án này</button> : null}
        </div>
      </div>

      {overrideOpen ? <TemplateOverrideModal template={data.template} base={base} reload={api.reload} onClose={() => setOverrideOpen(false)} /> : null}
    </section>
  );
}

function Tile({ label, value, note, action }: Readonly<{ label: string; value: string; note: string; action?: ReactNode }>) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{note}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A User account: the API gives no P&L setup (PL-26). The item list stays visible, without value, price or amount collected. */
function UserFallback({ items }: Readonly<{ items: readonly SetupFallbackItem[] }>) {
  return (
    <section aria-label="Hạng mục hợp đồng" className={cardClass}>
      <div className="border-b border-border px-4 py-3"><h3 className="!text-base font-bold text-foreground">Hạng mục hợp đồng ({items.length})</h3></div>
      <div className="space-y-3 p-4">
        <ReadOnlyNote>Tài khoản User không xem được giá trị, đơn giá và số đã thu của dự án; Thiết lập P&amp;L do Admin - PM quản lý.</ReadOnlyNote>
        {items.length ? (
          <ul className="divide-y divide-border text-sm">{items.map((item) => <li key={item.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2"><span className="font-mono font-semibold">{item.code}</span><span className="min-w-0 flex-1">{item.name}</span><span className="text-muted-foreground">{item.kindLabel}</span><span className="text-muted-foreground">{item.contractTypeLabel}</span></li>)}</ul>
        ) : <p className="text-sm text-muted-foreground">Chưa có hạng mục.</p>}
      </div>
    </section>
  );
}

function ContractStatusForm({ signed, busy, onCancel, onSubmit }: Readonly<{ signed: boolean; busy: boolean; onCancel: () => void; onSubmit: (body: PnlContractStatusInput) => void }>) {
  const [reason, setReason] = useState("");
  return (
    <form className="space-y-3 rounded-lg border border-border p-3" onSubmit={(event) => { event.preventDefault(); if (signed && !reason.trim()) return; onSubmit(signed ? { status: "draft", reason: reason.trim() } : { status: "signed" }); }}>
      {signed
        ? <Field label="Lý do chuyển hợp đồng về Nháp (bắt buộc)" htmlFor="pnl-contract-reason"><input id="pnl-contract-reason" autoFocus value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} /></Field>
        : <p className="text-sm text-foreground">Chuyển hợp đồng sang <strong>Đã ký</strong>: giá trị gốc của mọi hạng mục chuyển sang chỉ đọc; muốn đổi phải qua yêu cầu thay đổi.</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>Hủy</button><button type="submit" className={primaryButtonClass} disabled={busy || (signed && !reason.trim())}>{busy ? "Đang lưu…" : signed ? "Chuyển về Nháp" : "Xác nhận Đã ký"}</button></div>
    </form>
  );
}

type InstallmentDraft = { label: string; gateCode: string | null; percent: string; expectedOn: string };

/** Ⓒ Chi tiết Trọn gói. */
function FixedPriceDetail({ item, readOnlyValue, base, canManage, save }: Readonly<{ item: PnlSetupItem; readOnlyValue: boolean; base: string; canManage: boolean; save: Save }>) {
  const [draft, setDraft] = useState<InstallmentDraft[] | null>(null);
  const unsaved = item.installments.some((installment) => installment.id.startsWith("default:"));
  const total = draft ? draft.reduce((sum, row) => sum + (parseDecimalInput(row.percent) ?? 0), 0) : item.installmentPercentTotal;
  const totalMessage = installmentTotalMessage(total);
  const setRow = (index: number, patch: Partial<InstallmentDraft>) => setDraft((current) => current?.map((row, position) => position === index ? { ...row, ...patch } : row) ?? null);
  const startEdit = () => { save.clear(); setDraft(item.installments.map((installment: PnlInstallment) => ({ label: installment.label, gateCode: installment.gateCode, percent: String(installment.percent), expectedOn: installment.expectedOn ?? "" }))); };

  async function submit() {
    if (!draft || totalMessage) return;
    const body: PnlInstallmentsInput = { installments: draft.map((row) => ({ label: row.label.trim(), gateCode: row.gateCode, percent: parseDecimalInput(row.percent) ?? 0, expectedOn: row.expectedOn || null })) };
    if (await save.run(() => pnlRequest(`${base}/setup/items/${encodeURIComponent(item.id)}/installments`, { method: "PUT", body }), `Đã lưu đợt thanh toán của ${item.code}.`)) setDraft(null);
  }
  const setStatus = (installment: PnlInstallment, status: string) => void save.run(() => pnlRequest(`${base}/setup/installments/${encodeURIComponent(installment.id)}`, { method: "PATCH", body: { status } }), `Đợt ${installment.sequence}: ${INSTALLMENT_STATUSES.find((entry) => entry.value === status)?.label ?? status}.`);

  return (
    <>
      <p className="mt-1 text-sm text-foreground">Giá trị hạng mục: {formatMillions(item.valueAmount)} {readOnlyValue ? "(chỉ đọc vì hợp đồng Đã ký)" : item.locked ? "(đã khóa, đổi qua yêu cầu thay đổi)" : "(nhập ở nút sửa của hạng mục khi hợp đồng còn Nháp)"}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead><tr><th scope="col" className={subTh}>Đợt</th><th scope="col" className={subTh}>Mốc</th><th scope="col" className={`${subTh} !text-right`}>Tỷ lệ</th><th scope="col" className={`${subTh} !text-right`}>Số tiền</th><th scope="col" className={subTh}>Ngày dự kiến</th><th scope="col" className={subTh}>Trạng thái</th>{draft ? <th scope="col" className={subTh}><span className="sr-only">Xóa</span></th> : null}</tr></thead>
          <tbody>
            {draft ? draft.map((row, index) => (
              <tr key={index}>
                <td className={subTd}>{index + 1}</td>
                <td className={subTd}><input aria-label={`Mốc của đợt ${index + 1}`} value={row.label} maxLength={120} onChange={(event) => setRow(index, { label: event.target.value })} className={`${inputClass} !h-9`} /></td>
                <td className={subTd}><input aria-label={`Tỷ lệ % của đợt ${index + 1}`} inputMode="decimal" value={row.percent} onChange={(event) => setRow(index, { percent: event.target.value })} className={`${inputClass} !h-9 !w-20 text-right font-mono tabular-nums`} /></td>
                <td className={`${subTd} text-right text-xs text-muted-foreground`}>tự tính khi lưu</td>
                <td className={subTd}><input type="date" aria-label={`Ngày dự kiến của đợt ${index + 1}`} value={row.expectedOn} onChange={(event) => setRow(index, { expectedOn: event.target.value })} className={`${inputClass} !h-9 !w-40`} /></td>
                <td className={`${subTd} text-xs text-muted-foreground`}>giữ nguyên</td>
                <td className={subTd}><button type="button" className="text-xs font-semibold text-destructive hover:underline" disabled={draft.length <= 1} onClick={() => setDraft(draft.filter((_, position) => position !== index))}>Xóa đợt</button></td>
              </tr>
            )) : item.installments.map((installment) => (
              <tr key={installment.id}>
                <td className={subTd}>{installment.sequence}</td>
                <td className={subTd}>{installment.label}</td>
                <td className={`${subTd} text-right font-mono tabular-nums`}>{formatEnteredPercent(installment.percent)}</td>
                <td className={`${subTd} text-right font-mono tabular-nums`}>{formatMillions(installment.amount)}</td>
                <td className={`${subTd} whitespace-nowrap`}>{installment.expectedOn ? formatDay(installment.expectedOn) : "Chưa có ngày"}</td>
                <td className={subTd}>
                  {canManage && !unsaved
                    ? <div className="w-44"><CrmSelect ariaLabel={`Trạng thái đợt ${installment.sequence}`} value={installment.status} disabled={save.busy} onChange={(status) => { if (status !== installment.status) setStatus(installment, status); }} options={INSTALLMENT_STATUSES} /></div>
                    : <span className={installment.status === "paid" ? toneClass.ok : toneClass.muted}>{installment.statusLabel}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`mt-2 text-sm ${totalMessage ? "font-semibold text-red-700" : "text-muted-foreground"}`} role={totalMessage ? "alert" : undefined}>Tổng tỷ lệ {formatEnteredPercent(total)}{totalMessage ? ` · ${totalMessage}, chưa lưu được` : ""} · đợt chỉ theo dõi dòng tiền; doanh thu ghi nhận một lần tại G7</p>
      {unsaved && !draft ? <p className="mt-1 text-xs text-muted-foreground">Đang hiện kế hoạch mặc định 70% khi ký, 30% khi nghiệm thu, chưa lưu. {canManage ? "Bấm “Sửa đợt thanh toán” để kiểm tra, nhập ngày dự kiến và lưu; sau đó mới đổi được trạng thái từng đợt." : ""}</p> : null}
      {canManage ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {draft ? <>
            <button type="button" className={smallButton} onClick={() => setDraft([...draft, { label: "", gateCode: null, percent: "0", expectedOn: "" }])}>+ Thêm đợt</button>
            <button type="button" className={secondaryButtonClass} disabled={save.busy} onClick={() => setDraft(null)}>Hủy</button>
            <button type="button" className={primaryButtonClass} disabled={save.busy || Boolean(totalMessage) || draft.some((row) => !row.label.trim())} onClick={() => void submit()}>{save.busy ? "Đang lưu…" : "Lưu đợt thanh toán"}</button>
          </> : <button type="button" className={smallButton} onClick={startEdit}>Sửa đợt thanh toán</button>}
        </div>
      ) : null}
    </>
  );
}

function ThresholdRow({ item, percent, over, base, canManage, save, of }: Readonly<{ item: PnlSetupItem; percent: number; over: boolean; base: string; canManage: boolean; save: Save; of: string }>) {
  const [value, setValue] = useState<string | null>(null);
  async function submit() {
    const warnThresholdPercent = parseDecimalInput(value ?? "");
    if (warnThresholdPercent === undefined) return;
    const body: PnlItemSettingsInput = { warnThresholdPercent };
    if (await save.run(() => pnlRequest(`${base}/setup/items/${encodeURIComponent(item.id)}`, { method: "PATCH", body }), `Đã lưu ngưỡng cảnh báo của ${item.code}.`)) setValue(null);
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground">
      <span>Ngưỡng cảnh báo: {formatEnteredPercent(percent)} {of}{over ? <span className="font-semibold text-amber-700"> · đã vượt ngưỡng</span> : null}</span>
      {canManage && value === null ? <button type="button" className={`${linkClass} text-xs`} onClick={() => { save.clear(); setValue(String(percent)); }}>Sửa ngưỡng</button> : null}
      {value !== null ? (
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor={`pnl-threshold-${item.id}`} className="sr-only">Ngưỡng cảnh báo (%)</label>
          <input id={`pnl-threshold-${item.id}`} autoFocus inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} className={`${inputClass} !h-9 !w-20 text-right`} />
          <button type="submit" className={smallButton} disabled={save.busy || parseDecimalInput(value) === undefined}>Lưu</button>
          <button type="button" className={smallButton} onClick={() => setValue(null)}>Hủy</button>
        </form>
      ) : null}
    </div>
  );
}

/** Ⓓ Chi tiết Theo giờ (bảng yêu cầu, wireframe không vẽ). */
function HourlyDetail({ item, hourly, projectId, base, canManage, save }: Readonly<{ item: PnlSetupItem; hourly: NonNullable<PnlSetupItem["hourly"]>; projectId: string; base: string; canManage: boolean; save: Save }>) {
  const [overriding, setOverriding] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(currentPeriodKey);
  const [reason, setReason] = useState("");
  async function submit(roleGroup: string) {
    const amount = parseDecimalInput(value);
    if (amount === undefined || !reason.trim()) return;
    const body: PnlParameterValueInput = { key: "sellRate", subKey: roleGroup, scopeType: "project", scopeId: projectId, value: amount, effectiveFrom, reason: reason.trim() };
    if (await save.run(() => pnlRequest("/api/pnl/config/parameters", { method: "POST", body }), "Đã ghi đè đơn giá bán cho dự án này.")) { setOverriding(null); setValue(""); setReason(""); }
  }
  return (
    <>
      <p className="mt-1 text-sm text-foreground">Mức trần: {formatMillions(hourly.ceilingAmount)} (cộng vào giá trị hợp đồng; nâng trần phải qua yêu cầu thay đổi)</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead><tr><th scope="col" className={subTh}>Vai trò</th><th scope="col" className={`${subTh} !text-right`}>Đơn giá bán (đ/giờ)</th><th scope="col" className={subTh}>Nguồn giá</th><th scope="col" className={subTh}>Hiệu lực từ</th>{canManage ? <th scope="col" className={subTh}><span className="sr-only">Ghi đè</span></th> : null}</tr></thead>
          <tbody>
            {hourly.sellRates.map((rate) => (
              <tr key={rate.roleGroup}>
                <td className={subTd}>{rate.roleGroupLabel}</td>
                <td className={`${subTd} text-right font-mono tabular-nums`}>{rate.amount === null ? <span className={toneClass.warn}>Chưa có đơn giá</span> : formatDong(rate.amount)}</td>
                <td className={subTd}>{rate.scope ? SCOPE_LABELS[rate.scope] : "—"}{rate.scope === "company" ? " (chỉ đọc)" : ""}</td>
                <td className={subTd}>{rate.effectiveFrom ? formatMonth(rate.effectiveFrom) : "—"}</td>
                {canManage ? <td className={`${subTd} text-right`}><button type="button" aria-expanded={overriding === rate.roleGroup} className={`${linkClass} text-xs`} onClick={() => { save.clear(); setOverriding(overriding === rate.roleGroup ? null : rate.roleGroup); setValue(""); }}>Ghi đè cho dự án này</button></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!hourly.sellRates.length ? <p className="py-3 text-sm text-muted-foreground">Chưa có đơn giá bán theo vai trò. Nhập bảng chung ở <Link href="/pnl/costs?tab=parameters" className={linkClass}>Thiết lập P&amp;L › Tham số</Link>.</p> : null}
      </div>
      {overriding && canManage ? (
        <form className="mt-2 space-y-3 rounded-lg border border-border bg-card p-3" onSubmit={(event) => { event.preventDefault(); void submit(overriding); }}>
          <p className="text-sm font-semibold text-foreground">Ghi đè đơn giá bán · {hourly.sellRates.find((rate) => rate.roleGroup === overriding)?.roleGroupLabel}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Đơn giá bán của hợp đồng (đ/giờ)" htmlFor="pnl-sell-rate"><input id="pnl-sell-rate" autoFocus inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} className={`${inputClass} text-right font-mono tabular-nums`} /></Field>
            <Field label="Hiệu lực từ kỳ (chỉ kỳ đang mở)"><MonthFilter ariaLabel="Hiệu lực từ kỳ" value={effectiveFrom} onChange={setEffectiveFrom} /></Field>
          </div>
          <Field label="Lý do (bắt buộc)" htmlFor="pnl-sell-rate-reason"><input id="pnl-sell-rate-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className={secondaryButtonClass} disabled={save.busy} onClick={() => setOverriding(null)}>Hủy</button><button type="submit" className={primaryButtonClass} disabled={save.busy || parseDecimalInput(value) === undefined || !reason.trim()}>{save.busy ? "Đang lưu…" : "Lưu đơn giá riêng"}</button></div>
        </form>
      ) : null}
      <p className="mt-2 text-sm text-foreground">Doanh thu tới nay: {formatMillions(hourly.revenueToDateAmount)} · {formatPercent(hourly.usedPercent)} trần</p>
      <ThresholdRow item={item} percent={hourly.warnThresholdPercent} over={hourly.overThreshold} base={base} canManage={canManage} save={save} of="trần" />
      <p className="mt-2 text-sm text-muted-foreground">Doanh thu = giờ tính P&amp;L × đơn giá bán của vai trò người ghi, dừng ở mức trần; không có điều kiện “đã duyệt”</p>
    </>
  );
}

/** Ⓔ Chi tiết Nội bộ (bảng yêu cầu, wireframe không vẽ). */
function InternalDetail({ item, internal, base, canManage, save }: Readonly<{ item: PnlSetupItem; internal: NonNullable<PnlSetupItem["internal"]>; base: string; canManage: boolean; save: Save }>) {
  return (
    <>
      <p className="mt-1 text-sm text-foreground">Trần chi phí: {internal.costCapAmount === null ? <span className={toneClass.warn}>chưa nhập</span> : formatMillions(internal.costCapAmount)} (PM nhập ở nút sửa của hạng mục)</p>
      <p className="mt-1.5 text-sm text-foreground">Chi phí tới nay: {formatMillions(internal.costToDateAmount)} · {formatPercent(internal.usedPercent)} trần</p>
      <ThresholdRow item={item} percent={internal.warnThresholdPercent} over={internal.overThreshold} base={base} canManage={canManage} save={save} of="trần chi phí" />
      <p className="mt-2 text-sm text-muted-foreground">Không có doanh thu, không có đợt thanh toán, không cộng vào giá trị hợp đồng · giờ ghi vào hạng mục này có Lớp 2 là Nội bộ, bị loại khỏi P&amp;L dự án với lý do Nội bộ và tính vào dòng Chi phí nội bộ</p>
    </>
  );
}

function TemplateOverrideModal({ template, base, reload, onClose }: Readonly<{ template: PnlProjectSetupResponse["data"]["template"]; base: string; reload: () => Promise<void>; onClose: () => void }>) {
  const templates = usePnlLoad<PnlTemplatesResponse>("/api/pnl/config/templates", "Không tải được danh sách khoản mục.");
  const save = useSave(reload);
  const [disabledCodes, setDisabledCodes] = useState<string[]>(template.disabledCodes);
  const [reason, setReason] = useState(template.override?.reason ?? "");
  const templateOff = templates.data?.data.templates.find((entry) => entry.key === template.key)?.disabledCodes ?? [];
  async function submit() {
    if (!reason.trim()) return;
    // Against the template of the project type: what this project switches off, and what it switches back on.
    const body: PnlTemplateOverrideInput = { disabledCodes: disabledCodes.filter((code) => !templateOff.includes(code)), enabledCodes: templateOff.filter((code) => !disabledCodes.includes(code)), reason: reason.trim() };
    if (await save.run(() => pnlRequest(`${base}/template-override`, { method: "PUT", body }))) onClose();
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
