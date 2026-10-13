"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PnlCostItem, PnlCostItemInput, PnlCostItemMethod, PnlCostItemsResponse, PnlFormulaToken, PnlRoleGroupCode } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { FilterBar, FilterField, SearchFilter } from "@/components/filters";
import { configCheckParts, filterTree, formulaText, nextFormulaStep, visibleTreeRows } from "./pnl-cost-shared";
import { formatMonth } from "./pnl-format";
import { LoadingBlock, SaveFeedback, smallButton, Strip, tableCellClass, tableHeadClass, useSave } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, primaryButtonClass, secondaryButtonClass, usePnlLoad } from "./pnl-ui";

const METHODS: Array<{ value: PnlCostItemMethod; label: string }> = [
  { value: "MANUAL", label: "Nhập tay" }, { value: "SYSTEM", label: "Lấy từ hệ thống" }, { value: "FORMULA", label: "Công thức" },
  { value: "FUND", label: "Phân bổ quỹ" }, { value: "GROUP", label: "Tổng nhóm" }
];
const ROLE_GROUPS: Array<{ value: string; label: string }> = [
  { value: "", label: "Không gán" }, { value: "BD", label: "BD" }, { value: "PM", label: "PM" }, { value: "DELIVERY", label: "Delivery/DX" }, { value: "CS", label: "CS" }
];
const UNIT_LABELS = { VND: "đồng", PERCENT: "%", NONE: "không có đơn vị" } as const;
const OPERATORS: Array<{ op: "+" | "-" | "*" | "/"; sign: string; label: string }> = [
  { op: "+", sign: "+", label: "Cộng" }, { op: "-", sign: "−", label: "Trừ" }, { op: "*", sign: "×", label: "Nhân" }, { op: "/", sign: "÷", label: "Chia" }
];
const FORBIDDEN = "Chỉ tài khoản Admin vào được Thiết lập P&L. Tài khoản User không xem được cấu hình khoản mục.";

/** Mục 6.2 — tab Khoản mục: ① kiểm tra cấu hình, ② cây khoản mục, ③ panel khai báo. Every change is a draft until applied. */
export function PnlSetupItems({ actionSlot }: Readonly<{ actionSlot: HTMLElement | null }>) {
  const api = usePnlLoad<PnlCostItemsResponse>("/api/pnl/config/items", "Không tải được cây khoản mục.");
  const save = useSave(api.reload);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const data = api.data?.data;
  const [search, setSearch] = useState("");
  // A search shows every hit with its parents, whatever is folded.
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const query = search.trim();
    return query ? visibleTreeRows(filterTree(items, (item) => matchesSearch(query, item.name, item.code, item.methodLabel)), new Set()) : visibleTreeRows(items, collapsed);
  }, [data, collapsed, search]);
  const selected = data?.items.find((item) => item.code === selectedCode) ?? null;

  if (!data || api.error) return api.loading ? <LoadingBlock rows={6} label="Đang tải cây khoản mục…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);

  const parts = configCheckParts(data.check);
  const problem = parts.some((part) => !part.ok);
  const toggle = (code: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(code)) next.delete(code); else next.add(code); return next; });
  const post = (path: string, body?: unknown) => pnlRequest(`/api/pnl/config/items/${path}`, { method: "POST", body: body ?? {} });

  return (
    <>
      {actionSlot ? createPortal(
        <ApplyDraftMenu hasDraft={data.hasDraft} canApply={data.check.canApply} hasCycle={data.check.hasCycle} openPeriodKeys={data.openPeriodKeys} busy={save.busy}
          onApply={(periodKey) => void save.run(() => post("apply", { periodKey }), `Đã áp dụng bản nháp từ kỳ ${formatMonth(periodKey)}.`)}
          onDiscard={() => { if (window.confirm("Bỏ toàn bộ thay đổi đang ở bản nháp?")) void save.run(() => post("discard"), "Đã bỏ bản nháp."); }} />,
        actionSlot) : null}

      {/* ① Kiểm tra cấu hình */}
      <Strip tone={problem ? "warn" : "ok"}>
        <p>
          {parts.map((part, index) => <span key={part.text}>{index ? " · " : ""}{part.ok ? "✓ " : ""}{part.text}</span>)}
          {data.check.requiredWithoutValue.length ? <button type="button" aria-expanded={showRequired} aria-label="Xem khoản mục bắt buộc chưa có số" className="ml-1 rounded px-1 font-bold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" onClick={() => setShowRequired((value) => !value)}>›</button> : null}
        </p>
        {showRequired ? <ul className="mt-1.5 flex flex-wrap gap-2">{data.check.requiredWithoutValue.map((item) => <li key={item.code}><button type="button" className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-amber-100" onClick={() => setSelectedCode(item.code)}>{item.name}</button></li>)}</ul> : null}
        {data.check.groupErrors.length ? <p className="mt-1 text-xs">{data.check.groupErrors.join(" · ")}</p> : null}
        {data.check.hasCycle ? <p className="mt-1 text-xs font-semibold">Còn tham chiếu vòng thì không áp dụng được bản nháp.</p> : null}
      </Strip>

      {data.usingDefaultTree ? (
        <Strip action={<button type="button" className={smallButton} disabled={save.busy} onClick={() => void save.run(() => post("defaults"), "Đã nạp bộ khoản mục mặc định.")}>Nạp bộ khoản mục mặc định</button>}>
          Chưa nạp cây khoản mục vào cấu hình: hệ thống đang tính bằng bộ mặc định theo Khung I.10. Nạp để chỉnh được từng khoản mục.
        </Strip>
      ) : null}
      {data.hasDraft ? <p className="text-xs text-muted-foreground">Đang có thay đổi ở bản nháp, chưa dùng để tính. Chọn “Áp dụng bản nháp” và một kỳ đang mở để có hiệu lực.</p> : null}
      <SaveFeedback error={save.error} message={save.message} />

      <FilterBar onReset={search ? () => setSearch("") : undefined} activeCount={search.trim() ? 1 : 0}>
        <FilterField label="Tìm khoản mục" className="min-w-[220px] max-w-md flex-1">
          <SearchFilter value={search} onChange={setSearch} placeholder="Tên khoản mục, mã hoặc cách lấy số..." ariaLabel="Tìm khoản mục" className="" />
        </FilterField>
      </FilterBar>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
        {/* ② Cây khoản mục */}
        <section aria-label="Cây khoản mục" className={`${cardClass} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead><tr><th scope="col" className={tableHeadClass}>Khoản mục</th><th scope="col" className={tableHeadClass}>Cách lấy số</th></tr></thead>
            <tbody>
              {rows.map((item) => {
                const active = item.code === selectedCode;
                return (
                  <tr key={item.code} className={active ? "bg-primary/10" : "hover:bg-muted/25"}>
                    <td className={`${tableCellClass} !py-2`}>
                      <div className="flex items-center gap-1" style={{ paddingLeft: `${Math.max(0, item.level - 1) * 20}px` }}>
                        {item.hasChildren
                          ? <button type="button" aria-expanded={item.expanded} aria-label={`${item.expanded ? "Gập" : "Mở"} nhóm ${item.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => toggle(item.code)}>{item.expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}</button>
                          : <span className="w-[22px]" aria-hidden />}
                        <button type="button" aria-pressed={active} className={`min-w-0 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${item.level === 1 || active ? "!font-bold" : ""} ${item.status === "retired" ? "text-muted-foreground line-through" : "text-foreground"} hover:text-primary`} onClick={() => setSelectedCode(item.code)}>{item.name}</button>
                        {item.status === "draft" || item.draft ? <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">Nháp</span> : null}
                        {item.status === "retired" ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">Sẽ ngừng</span> : null}
                      </div>
                    </td>
                    <td className={`${tableCellClass} !py-2 whitespace-nowrap text-muted-foreground`}>{item.methodLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{search.trim() ? <>Không có kết quả phù hợp bộ lọc. <button type="button" onClick={() => setSearch("")} className="font-semibold text-primary hover:underline">Đặt lại bộ lọc</button></> : "Chưa có khoản mục nào. Bấm “Nạp bộ khoản mục mặc định”."}</p> : null}
        </section>

        {/* ③ Panel khai báo */}
        {selected
          ? <ItemPanel key={`${selected.code}:${api.data?.meta.generatedAt ?? ""}`} item={selected} data={data} busy={save.busy}
              onSave={(input) => void save.run(() => pnlRequest("/api/pnl/config/items", { method: "PUT", body: input }), `Đã lưu “${input.name}” vào bản nháp.`)}
              onRetire={() => { if (window.confirm(`Ngừng dùng khoản mục “${selected.name}”? Thay đổi nằm ở bản nháp cho tới khi áp dụng.`)) void save.run(() => pnlRequest(`/api/pnl/config/items/${encodeURIComponent(selected.code)}`, { method: "DELETE" }), `Đã đánh dấu ngừng dùng “${selected.name}” ở bản nháp.`); }} />
          : <section aria-label="Panel khai báo" className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">Chọn một khoản mục trên cây để xem và sửa khai báo: mã, khoản mục cha, dấu, nhóm vai trò, cách lấy số, công thức và thứ tự tính.</section>}
      </div>
    </>
  );
}

function ApplyDraftMenu({ hasDraft, canApply, hasCycle, openPeriodKeys, busy, onApply, onDiscard }: Readonly<{ hasDraft: boolean; canApply: boolean; hasCycle: boolean; openPeriodKeys: string[]; busy: boolean; onApply: (periodKey: string) => void; onDiscard: () => void }>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const reason = !hasDraft ? "Chưa có thay đổi nào ở bản nháp." : hasCycle ? "Còn tham chiếu vòng: sửa công thức trước khi áp dụng." : !canApply ? "Cấu hình chưa đạt kiểm tra, chưa áp dụng được." : !openPeriodKeys.length ? "Không có kỳ nào đang mở." : "";
  return (
    <>
      <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={busy || !hasDraft} title={reason || undefined} className={smallButton} onClick={() => setOpen((value) => !value)}>Áp dụng bản nháp <ChevronDown className="h-3.5 w-3.5" aria-hidden /></button>
      {open ? (
        <div role="menu" aria-label="Áp dụng bản nháp từ kỳ" className="absolute right-0 top-[calc(100%+6px)] z-30 w-64 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          <p className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground">Áp dụng bản nháp từ kỳ… (chỉ kỳ đang mở)</p>
          {reason ? <p className="px-2.5 py-1.5 text-xs text-amber-700">{reason}</p> : openPeriodKeys.map((periodKey) => (
            <button key={periodKey} type="button" role="menuitem" className="block w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground hover:bg-muted" onClick={() => { setOpen(false); onApply(periodKey); }}>Từ kỳ {formatMonth(periodKey)}</button>
          ))}
          <button type="button" role="menuitem" className="mt-1 block w-full rounded-lg border-t border-border px-2.5 py-2 text-left text-sm font-medium text-destructive hover:bg-muted" onClick={() => { setOpen(false); onDiscard(); }}>Bỏ bản nháp</button>
        </div>
      ) : null}
    </>
  );
}

const rowClass = "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 py-1.5 text-sm";
const rowLabel = "text-muted-foreground";

function ItemPanel({ item, data, busy, onSave, onRetire }: Readonly<{ item: PnlCostItem; data: PnlCostItemsResponse["data"]; busy: boolean; onSave: (input: PnlCostItemInput) => void; onRetire: () => void }>) {
  // The pending draft of an active item is what the panel edits.
  const start = { ...item, ...(item.draft ?? {}) };
  const [name, setName] = useState(start.name);
  const [parentCode, setParentCode] = useState(start.parentCode ?? "");
  const [sign, setSign] = useState<1 | -1>(start.sign ?? 1);
  const [roleGroup, setRoleGroup] = useState<string>(start.roleGroup ?? "");
  const [method, setMethod] = useState<PnlCostItemMethod>(start.method);
  const [formula, setFormula] = useState<PnlFormulaToken[]>(start.formula ?? []);
  const [required, setRequired] = useState(Boolean(start.required));
  const [sourceNote, setSourceNote] = useState(start.sourceNote ?? "");
  const lockedMethod = item.lockedMethods.find((entry) => entry.method === method);
  const parentOptions = [{ value: "", label: "Không có (cấp 1)" }, ...data.items.filter((entry) => entry.code !== item.code).map((entry) => ({ value: entry.code, label: entry.name }))];
  const step = nextFormulaStep(formula);
  const id = `pnl-item-${item.code}`;

  function submit() {
    if (!name.trim() || lockedMethod) return;
    onSave({
      code: item.code, name: name.trim(), parentCode: parentCode || null, sign, roleGroup: (roleGroup || null) as PnlRoleGroupCode | null, unit: item.unit, method,
      systemSource: method === "SYSTEM" ? item.systemSource : null, formula: method === "FORMULA" ? formula : null, required, sourceNote: sourceNote.trim() || null, sortOrder: item.sortOrder
    });
  }

  return (
    <section aria-label={`Khai báo khoản mục ${item.name}`} className="rounded-xl border border-primary bg-card p-4 shadow-sm sm:p-5">
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <h2 className="!text-base font-bold text-foreground">Khoản mục: {item.name}</h2>
        <div className="mt-2">
          <div className={rowClass}><span className={rowLabel}>Mã</span><span className="min-w-0 break-words"><span className="font-mono text-xs">{item.code}</span>{item.codeLocked ? <span className="text-foreground"> · {item.codeLockReason ?? "Khóa: có số ở kỳ đã khóa"}</span> : <span className="text-muted-foreground"> · mã không đổi</span>}</span></div>
          <div className={rowClass}><label className={rowLabel} htmlFor={`${id}-name`}>Tên</label><input id={`${id}-name`} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus:border-primary focus:outline-none" /></div>
          <div className={rowClass}><span className={rowLabel}>Khoản mục cha</span><CrmSelect ariaLabel="Khoản mục cha" value={parentCode} onChange={setParentCode} options={parentOptions} searchable /></div>
          <div className={rowClass}><span className={rowLabel}>Dấu</span><CrmSelect ariaLabel="Dấu" value={String(sign)} onChange={(value) => setSign(value === "-1" ? -1 : 1)} options={[{ value: "1", label: "Cộng (+)" }, { value: "-1", label: "Trừ (−)" }]} /></div>
          <div className={rowClass}><span className={rowLabel}>Nhóm vai trò</span><CrmSelect ariaLabel="Nhóm vai trò" value={roleGroup} onChange={setRoleGroup} options={ROLE_GROUPS} /></div>
          <div className={rowClass}><span className={rowLabel}>Đơn vị</span><span>{UNIT_LABELS[item.unit]}</span></div>
          <div className={rowClass}><span className={rowLabel}>Cách lấy số</span>
            <CrmSelect ariaLabel="Cách lấy số" value={method} onChange={(value) => setMethod(value as PnlCostItemMethod)}
              options={METHODS.map((entry) => { const lock = item.lockedMethods.find((locked) => locked.method === entry.value); return { ...entry, subtext: lock ? `Khóa: ${lock.reason}` : undefined }; })} />
          </div>
          {lockedMethod ? <p role="alert" className="pb-1 text-xs font-semibold text-amber-700">Không chọn được “{METHODS.find((entry) => entry.value === method)?.label}” cho khoản mục này: {lockedMethod.reason}</p> : null}
          {method === "FORMULA" ? (
            <div className="py-1.5">
              <p className={`text-sm ${rowLabel}`}>Công thức (chèn từ danh sách)</p>
              <p aria-live="polite" className="mt-1.5 min-h-10 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">{formula.length ? formulaText(formula, data.formulaOperands) : <span className="text-muted-foreground">Chưa có công thức: chèn một đại lượng.</span>}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="min-w-[12rem] flex-1"><CrmSelect ariaLabel="Chèn đại lượng" placeholder="Chèn đại lượng…" value="" disabled={step !== "operand"} searchable onChange={(value) => { const operand = data.formulaOperands[Number(value)]; if (operand) setFormula((current) => [...current, operand.token]); }} options={data.formulaOperands.map((operand, index) => ({ value: String(index), label: operand.label }))} /></div>
                {OPERATORS.map((entry) => <button key={entry.op} type="button" aria-label={`Chèn phép ${entry.label.toLowerCase()}`} disabled={step !== "operator"} className={`${smallButton} !min-w-9 !px-0`} onClick={() => setFormula((current) => [...current, { op: entry.op }])}>{entry.sign}</button>)}
                <button type="button" className={smallButton} disabled={!formula.length} onClick={() => setFormula((current) => current.slice(0, -1))}>Xóa bước cuối</button>
              </div>
            </div>
          ) : method === "GROUP" ? <p className="py-1 text-xs text-muted-foreground">Dòng tổng do hệ thống tự cộng các dòng con, không có công thức.</p> : null}
          <div className={rowClass}><label className={rowLabel} htmlFor={`${id}-required`}>Bắt buộc có số</label><span className="inline-flex items-center gap-2"><input id={`${id}-required`} type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />{required ? "Có" : "Không"}</span></div>
          <div className={rowClass}><span className={rowLabel}>Hiệu lực từ kỳ</span><span>{item.effectiveFromPeriod ? formatMonth(item.effectiveFromPeriod) : "Chưa áp dụng (chọn kỳ khi áp dụng bản nháp)"}</span></div>
          <div className={rowClass}><label className={rowLabel} htmlFor={`${id}-source`}>Trạng thái · nguồn</label><span className="flex min-w-0 items-center gap-2"><span className="shrink-0">{item.statusLabel} ·</span><input id={`${id}-source`} aria-label="Ghi chú nguồn" value={sourceNote} maxLength={200} placeholder="Ghi chú nguồn" onChange={(event) => setSourceNote(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm focus:border-primary focus:outline-none" /></span></div>
        </div>
        <div className="mt-3 border-t border-border pt-3 text-sm">
          <p className="font-semibold text-muted-foreground">Thứ tự tính (chỉ đọc)</p>
          <p className="mt-1">Dùng số của: {item.dependsOn.length ? item.dependsOn.map((entry) => entry.name).join(", ") : "—"}</p>
          <p>Được dùng bởi: {item.usedBy.length ? item.usedBy.map((entry) => entry.name).join(", ") : "—"}</p>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {item.status !== "retired" ? <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onRetire}>Ngừng dùng</button> : null}
          <button type="submit" className={primaryButtonClass} disabled={busy || !name.trim() || Boolean(lockedMethod)}>{busy ? "Đang lưu…" : "Lưu vào bản nháp"}</button>
        </div>
      </form>
    </section>
  );
}
