"use client";

import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import type { PnlHistoryEvent, PnlManualCostInput, PnlManualLine, PnlProjectItemRow } from "@b2b-crm/contracts";
import { formatMoneyInput, inputClass, labelClass, parseMoneyInput } from "./pnl-cost-shared";
import { formatDateTime, formatExactVnd, formatMillions, formatMonth, formatPercent } from "./pnl-format";
import {
  PnlApiError, cardClass, mutedNoteClass, pnlRequest, primaryButtonClass, secondaryButtonClass, tdClass, tdNumberClass, thClass, thNumberClass
} from "./pnl-ui";

const PERMISSION_NOTE = "Chỉ nhóm quyền chi phí";

/** Một thanh gập của khối 5. `locked`: người xem ngoài nhóm quyền chi phí — không mở được. */
function Collapsible({ id, title, locked, children }: Readonly<{ id: string; title: string; locked: boolean; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  return (
    <section className={cardClass}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        disabled={locked}
        title={locked ? "Bạn không thuộc nhóm quyền chi phí nên không mở được mục này." : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
      >
        <span className={`flex min-w-0 items-center gap-2 text-sm font-semibold ${locked ? "text-muted-foreground" : "text-foreground"}`}>
          <span aria-hidden className="text-xs">{open ? "▾" : "▸"}</span>
          {title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{PERMISSION_NOTE}</span>
      </button>
      {open && !locked ? <div id={`${id}-panel`} className="border-t border-border">{children}</div> : null}
    </section>
  );
}

function itemAmount(item: PnlProjectItemRow) {
  if (item.unit === "PERCENT") return formatPercent(item.amount);
  if (item.unit === "VND") return formatMillions(item.amount, "table");
  return item.amount === null ? "—" : String(item.amount);
}

type Draft = { id: string | null; periodKey: string; label: string; amount: string; note: string };

/** Nhập / sửa một dòng chi phí riêng theo tháng phát sinh. Số tiền gõ bằng đồng; API giữ nguyên số đồng. */
function ManualCostForm({ projectId, itemCode, months, initial, onSaved, onCancel }: Readonly<{
  projectId: string;
  itemCode: string;
  months: string[];
  initial: Draft;
  onSaved: () => void;
  onCancel: () => void;
}>) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseMoneyInput(draft.amount);
  const valid = Boolean(draft.periodKey && draft.label.trim() && amount !== undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || amount === undefined) return;
    const body: PnlManualCostInput = { itemCode, periodKey: draft.periodKey, label: draft.label.trim(), amount, note: draft.note.trim() || undefined };
    const base = `/api/pnl/projects/${encodeURIComponent(projectId)}/manual-costs`;
    setBusy(true);
    setError(null);
    pnlRequest(draft.id ? `${base}/${encodeURIComponent(draft.id)}` : base, { method: draft.id ? "PATCH" : "POST", body })
      .then(onSaved)
      .catch((reason: unknown) => setError(reason instanceof PnlApiError ? reason.message : "Không lưu được."))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_11rem_1fr_auto] lg:items-end">
      <label>
        <span className={labelClass}>Tháng phát sinh</span>
        <select value={draft.periodKey} onChange={(event) => setDraft({ ...draft, periodKey: event.target.value })} className={inputClass}>
          {months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
        </select>
      </label>
      <label>
        <span className={labelClass}>Nội dung</span>
        <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className={inputClass} maxLength={200} required />
      </label>
      <label>
        <span className={labelClass}>Số tiền (đồng)</span>
        <input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: formatMoneyInput(event.target.value) })} className={`${inputClass} text-right font-mono tabular-nums`} required />
      </label>
      <label>
        <span className={labelClass}>Ghi chú</span>
        <input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className={inputClass} maxLength={500} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!valid || busy} className={primaryButtonClass}>{busy ? "Đang lưu…" : "Lưu"}</button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>Hủy</button>
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-red-700 sm:col-span-2 lg:col-span-5">{error}</p> : null}
    </form>
  );
}

/** Dòng Nhập tay: các khoản đã nhập và nút thêm. Tháng đã khóa thì dòng chỉ đọc. */
function ManualLines({ projectId, item, months, canEdit, onChanged }: Readonly<{
  projectId: string;
  item: PnlProjectItemRow;
  months: string[];
  canEdit: boolean;
  onChanged: () => void;
}>) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = item.manualLines ?? [];
  const saved = () => { setDraft(null); onChanged(); };

  const remove = (line: PnlManualLine) => {
    if (!window.confirm(`Xóa khoản “${line.label}” của tháng ${formatMonth(line.periodKey)}?`)) return;
    setError(null);
    pnlRequest(`/api/pnl/projects/${encodeURIComponent(projectId)}/manual-costs/${encodeURIComponent(line.id)}`, { method: "DELETE" })
      .then(onChanged)
      .catch((reason: unknown) => setError(reason instanceof PnlApiError ? reason.message : "Không xóa được."));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-foreground">Nhập tay · chi phí riêng theo tháng phát sinh</p>
      {lines.length === 0 ? <p className={mutedNoteClass}>Chưa có khoản nào.</p> : null}
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-mono tabular-nums text-muted-foreground">{formatMonth(line.periodKey)}</span>
            <span className="min-w-0 flex-1 text-foreground">
              {line.label}
              {line.note ? <span className="text-muted-foreground"> · {line.note}</span> : null}
            </span>
            <span title={formatExactVnd(line.amount)} className="font-mono font-semibold tabular-nums">{formatMillions(line.amount, "table")}</span>
            {line.locked ? <span className="text-xs text-muted-foreground">Kỳ đã khóa</span> : null}
            {canEdit && !line.locked ? (
              <span className="flex gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setDraft({ id: line.id, periodKey: line.periodKey, label: line.label, amount: line.amount === null ? "" : formatMoneyInput(String(line.amount)), note: line.note ?? "" })}
                  className="text-primary hover:underline"
                >
                  Sửa
                </button>
                <button type="button" onClick={() => remove(line)} className="text-red-700 hover:underline">Xóa</button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
      {draft ? (
        <ManualCostForm key={draft.id ?? "new"} projectId={projectId} itemCode={item.code} months={months} initial={draft} onSaved={saved} onCancel={() => setDraft(null)} />
      ) : canEdit ? (
        <button type="button" onClick={() => setDraft({ id: null, periodKey: months[months.length - 1] ?? "", label: "", amount: "", note: "" })} className={secondaryButtonClass}>
          + Thêm khoản
        </button>
      ) : (
        <p className={mutedNoteClass}>Bạn chỉ có quyền xem; nhập chi phí riêng cần quyền sửa chi phí.</p>
      )}
    </div>
  );
}

/** Cây khoản mục theo mẫu của dự án, lũy kế toàn dự án; bấm một dòng xem nguồn số. */
function ItemTree({ projectId, items, months, canEdit, onChanged }: Readonly<{
  projectId: string;
  items: PnlProjectItemRow[];
  months: string[];
  canEdit: boolean;
  onChanged: () => void;
}>) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  if (items.length === 0) return <p className={`${mutedNoteClass} px-4 py-6`}>Mẫu khoản mục của dự án chưa có khoản mục nào.</p>;
  return (
    <table className="w-full border-separate border-spacing-0 text-left">
      <thead>
        <tr className="bg-muted/30">
          <th scope="col" className={thClass}>Khoản mục</th>
          <th scope="col" className={thClass}>Cách lấy số</th>
          <th scope="col" className={thNumberClass}>Lũy kế toàn dự án</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const open = openCode === item.code;
          const manual = item.method === "MANUAL";
          return (
            <Fragment key={item.code}>
              <tr className={manual ? "bg-primary/5" : undefined}>
                <th scope="row" className={`${tdClass} text-left font-normal`} style={{ paddingLeft: `${1 + Math.max(0, item.level - 1) * 1.25}rem` }}>
                  <button type="button" aria-expanded={open} aria-controls={`pnl-item-${item.code}`} onClick={() => setOpenCode(open ? null : item.code)} className={`inline-flex items-center gap-1.5 text-left hover:text-primary ${item.level <= 1 ? "font-bold" : ""}`}>
                    <span aria-hidden className="text-xs">{open ? "▾" : "▸"}</span>
                    {item.name}
                  </button>
                </th>
                <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{item.methodLabel}</td>
                <td title={item.unit === "VND" ? formatExactVnd(item.amount) : undefined} className={`${tdNumberClass} ${item.level <= 1 ? "font-bold" : ""}`}>
                  {itemAmount(item)}
                  {item.incomplete ? <span title="Có khoản mục con chưa có số" className="ml-1 font-sans text-xs font-semibold text-amber-700">chưa đủ</span> : null}
                </td>
              </tr>
              {open ? (
                <tr id={`pnl-item-${item.code}`}>
                  <td colSpan={3} className="space-y-3 border-b border-border/70 bg-muted/20 px-4 py-3">
                    <p className="text-sm text-foreground">Nguồn số: {item.source.description}</p>
                    {item.source.byMonth.length ? (
                      <p className="text-xs text-muted-foreground">
                        {item.source.byMonth.map((month) => `${formatMonth(month.periodKey)}: ${formatMillions(month.amount, "table")}`).join(" · ")}
                      </p>
                    ) : null}
                    {manual ? <ManualLines projectId={projectId} item={item} months={months} canEdit={canEdit} onChanged={onChanged} /> : null}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function historyValue(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? String(value) : null;
}

function HistoryList({ events }: Readonly<{ events: PnlHistoryEvent[] }>) {
  if (events.length === 0) return <p className={`${mutedNoteClass} px-4 py-6`}>Chưa có thay đổi nào được ghi lại.</p>;
  return (
    <ul className="divide-y divide-border/70">
      {events.map((event) => {
        const before = historyValue(event.before);
        const after = historyValue(event.after);
        return (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(event.at)}</span>
            <span className="font-semibold text-foreground">{event.label}</span>
            {event.periodKey ? <span className="text-muted-foreground">kỳ {formatMonth(event.periodKey)}</span> : null}
            {before !== null || after !== null ? <span className="font-mono text-xs text-muted-foreground">{before ?? "—"} → {after ?? "—"}</span> : null}
            <span className="text-muted-foreground">{event.actorName ?? "Hệ thống"}</span>
            {event.reason ? <span className="text-muted-foreground">lý do: {event.reason}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Khối 5 — hai mục gập, chỉ nhóm quyền chi phí mở được (`items`, `history` là null với người khác). */
export function ProjectDetails({ projectId, items, history, months, canEdit, onChanged }: Readonly<{
  projectId: string;
  items: PnlProjectItemRow[] | null;
  history: PnlHistoryEvent[] | null;
  /** Các tháng nhập được chi phí riêng (phạm vi của dự án). */
  months: string[];
  canEdit: boolean;
  onChanged: () => void;
}>) {
  return (
    <div className="space-y-2">
      <Collapsible id="pnl-items" title="Chi tiết theo khoản mục P&L · nhập chi phí riêng ở dòng Nhập tay" locked={items === null}>
        {items ? <ItemTree projectId={projectId} items={items} months={months} canEdit={canEdit} onChanged={onChanged} /> : null}
      </Collapsible>
      <Collapsible id="pnl-history" title="Lịch sử thay đổi số liệu · gồm khóa và mở lại kỳ" locked={history === null}>
        {history ? <HistoryList events={history} /> : null}
      </Collapsible>
    </div>
  );
}
