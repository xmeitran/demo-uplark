"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Info, Lock } from "lucide-react";
import type { CostRatesResponse } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { PersonLink } from "@/components/person-link";
import { EXPENSE_GROUPS, formatHours, formatMoney, type PnlProject } from "./pnl-data";
import { formatMoneyInput, inputClass, monthDateRange, moneyFormat, parseMoneyInput, periodLabel, primaryButton, readApi, readParameterValue, secondaryButton } from "./pnl-cost-shared";
import { PnlOtherCosts } from "./pnl-other-costs";

type RowKey = "revenue" | "labor" | "other" | "pool" | "planned" | `calc:${string}`;
type SetupParameter = { code: string; label?: string; value: string };
type SetupItem = { code: string; label?: string; formula?: string; category?: string; active?: boolean };
type Setup = { items: SetupItem[]; parameters: SetupParameter[]; pool: { total: number; criteria: string }; templates: unknown[] };

const POOL_OPTIONS = [
  { value: "Theo giờ tính P&L", label: "Giờ đã duyệt của project" },
  { value: "Theo doanh thu", label: "Doanh thu kế hoạch" },
  { value: "Theo số nhân sự", label: "Số nhân sự có giờ" },
  { value: "Chia đều", label: "Chia đều" },
  { value: "Nhập tay từng dự án", label: "Không tự chia" }
];
const GROUP_LABELS = new Map(EXPENSE_GROUPS.map((group) => [group.key, group.label]));

function toSetup(data: Record<string, unknown> | null | undefined): Setup {
  const pool = (data?.pool ?? {}) as { total?: unknown; criteria?: unknown };
  return {
    items: Array.isArray(data?.items) ? data.items as SetupItem[] : [],
    parameters: (Array.isArray(data?.parameters) ? data.parameters as Array<Record<string, unknown>> : []).map((raw) => ({ ...raw, code: String(raw.code ?? "").toUpperCase(), value: raw.value === undefined || raw.value === null ? "" : String(raw.value) })) as SetupParameter[],
    pool: { total: typeof pool.total === "number" && pool.total > 0 ? pool.total : 0, criteria: typeof pool.criteria === "string" ? pool.criteria : POOL_OPTIONS[0].value },
    templates: Array.isArray(data?.templates) ? data.templates as unknown[] : []
  };
}

/** Says who else a change touches, so editing from one project never surprises another. */
function Scope({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>{children}</span></p>;
}

function EditorActions({ saving, disabled, label, onCancel, onSave }: Readonly<{ saving: boolean; disabled?: boolean; label: string; onCancel: () => void; onSave: () => void }>) {
  return <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} disabled={saving} onClick={onCancel}>Hủy</button><button type="button" className={primaryButton} disabled={saving || disabled} onClick={onSave}>{saving ? "Đang lưu…" : label}</button></div>;
}

function Row({ id, label, hint, amount, tone, open, onToggle, action = "Sửa", editable, children }: Readonly<{ id: string; label: string; hint: ReactNode; amount: ReactNode; tone?: "warning"; open: boolean; onToggle: () => void; action?: string; editable: boolean; children?: ReactNode }>) {
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_170px_150px] sm:px-5">
        <div className="min-w-0"><p className="text-sm font-bold text-foreground">{label}</p><p className={`mt-0.5 text-xs ${tone === "warning" ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>{hint}</p></div>
        <p className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">{amount}</p>
        <button type="button" aria-expanded={open} aria-controls={`${id}-editor`} onClick={onToggle} className="col-span-2 inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:col-span-1">
          {open ? <>Thu lại <ChevronUp className="h-3.5 w-3.5" aria-hidden /></> : <>{editable ? action : "Xem"} <ChevronDown className="h-3.5 w-3.5" aria-hidden /></>}
        </button>
      </div>
      {open ? <div id={`${id}-editor`} className="space-y-3 border-t border-border bg-muted/20 px-4 py-4 sm:px-5">{children}</div> : null}
    </div>
  );
}

/**
 * The project's P&L for one month, editable in place: every figure that comes
 * from an input opens its own editor right under the row. Saving reloads the
 * page's figures from the API — nothing is recalculated in the browser. The only
 * browser arithmetic is the "xem trước" of an unsaved cost rate, labelled as such.
 *
 * periodKey is null when the range is not exactly one month; scopeLabel then names
 * what is shown ("cả dự án" or the date range) and the statement is read-only,
 * except the whole-project planned cost when canEditInputs allows it.
 */
export function PnlStatement({ project, periodKey, scopeLabel, partialRange, canEditInputs, onChanged, onPickMonth }: Readonly<{ project: PnlProject; periodKey: string | null; scopeLabel: string; partialRange: boolean; canEditInputs: boolean; onChanged: () => void; onPickMonth: (periodKey: string) => void }>) {
  const [open, setOpen] = useState<RowKey | null>(null);
  const [setup, setSetup] = useState<Setup>(() => toSetup(null));
  const [access, setAccess] = useState<{ canEdit: boolean; locked: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revenueDraft, setRevenueDraft] = useState("");
  const [plannedDraft, setPlannedDraft] = useState("");
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [poolDraft, setPoolDraft] = useState<{ total: string; criteria: string }>({ total: "", criteria: POOL_OPTIONS[0].value });

  const loadSetup = useCallback(async () => {
    if (!periodKey) return;
    try {
      const [configPayload, ratesPayload] = await Promise.all([
        readApi<{ data: Record<string, unknown> | null }>(await fetch(`/api/pnl-configurations?periodKey=${periodKey}`, { cache: "no-store" }), "Không tải được thiết lập của tháng."),
        readApi<CostRatesResponse>(await fetch(`/api/cost-rates?periodKey=${periodKey}`, { cache: "no-store" }), "Không tải được quyền nhập chi phí.")
      ]);
      setSetup(toSetup(configPayload.data));
      // The API already folds the month lock into canEdit.
      setAccess({ canEdit: ratesPayload.meta.canEdit, locked: ratesPayload.meta.locked });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được thiết lập của tháng.");
    }
  }, [periodKey]);
  useEffect(() => { setOpen(null); setError(null); setNotice(null); void loadSetup(); }, [loadSetup]);

  const editable = Boolean(periodKey) && Boolean(access?.canEdit);
  const people = useMemo(() => project.people.filter((person) => person.pnlMinutes > 0 || person.laborCost !== undefined), [project.people]);
  const missingPeople = people.filter((person) => person.missingRateMinutes);
  // A locked month: totals are frozen; the people and cost lines listed are whatever the data says today.
  const frozen = project.lockedOtherCost !== undefined;
  const LIVE_DETAIL = "Chi tiết bên dưới là dữ liệu hiện tại, có thể khác số đã chốt.";
  const plannedEditable = periodKey ? Boolean(access?.canEdit) : canEditInputs;
  const month = periodKey ? periodLabel(periodKey).toLowerCase() : "";
  const hasRevenue = project.revenueBasis !== "none";
  const percent = (value: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)}%`;

  function toggle(key: RowKey) {
    setError(null); setNotice(null);
    if (open === key) { setOpen(null); return; }
    if (key === "revenue") setRevenueDraft(project.revenueBasis === "custom" ? moneyFormat.format(project.revenue) : "");
    if (key === "planned") setPlannedDraft(project.plannedCost > 0 ? moneyFormat.format(project.plannedCost) : "");
    if (key === "labor") setRateDrafts(Object.fromEntries(people.map((person) => [person.id, person.hourlyCostRate === undefined ? "" : moneyFormat.format(person.hourlyCostRate)])));
    if (key === "pool") setPoolDraft({ total: setup.pool.total ? moneyFormat.format(setup.pool.total) : "", criteria: setup.pool.criteria });
    if (key.startsWith("calc:")) setParameterDrafts(Object.fromEntries(setup.parameters.map((parameter) => [parameter.code, parameter.value])));
    setOpen(key);
  }

  /** Runs one save, then reloads both this month's setup and the page figures. */
  async function run(action: () => Promise<void>, done: string) {
    setSaving(true); setError(null); setNotice(null);
    try {
      await action();
      setNotice(done); setOpen(null);
      await loadSetup();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được.");
    } finally { setSaving(false); }
  }
  const send = async (url: string, method: string, body: unknown, fallback: string) => { await readApi(await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), fallback); };
  const saveSetup = (next: Partial<Setup>, done: string) => run(() => send("/api/pnl-configurations", "PATCH", { periodKey, items: setup.items, parameters: setup.parameters, pool: { ...setup.pool, allocated: 0 }, templates: setup.templates, ...next }, "Không lưu được thiết lập của tháng."), done);

  function saveRevenue() {
    const amount = parseMoneyInput(revenueDraft);
    if (amount === undefined || !periodKey) { setError("Nhập doanh thu ghi nhận của tháng (0 nếu tháng này không ghi nhận)."); return; }
    const range = monthDateRange(periodKey);
    void run(() => send("/api/pnl-periods", "POST", { projectId: project.id, periodKey, periodStart: range.startDate, periodEnd: range.endDate, currency: "VND", revenueAmount: amount }, "Không lưu được doanh thu."), `Đã lưu doanh thu ${month}.`);
  }
  function removeRevenue() {
    if (!periodKey || !window.confirm(`Xoá doanh thu đã nhập của ${month}? Tháng này sẽ trở lại trạng thái chưa nhập doanh thu (khác với nhập 0).`)) return;
    void run(async () => { await readApi(await fetch(`/api/pnl-periods?projectId=${encodeURIComponent(project.id)}&periodKey=${periodKey}`, { method: "DELETE" }), "Không xoá được doanh thu."); }, `Đã xoá doanh thu đã nhập của ${month}.`);
  }
  function saveRates() {
    const changes = people.flatMap((person) => { const amount = parseMoneyInput(rateDrafts[person.id] ?? ""); return amount !== undefined && amount !== person.hourlyCostRate ? [{ person, amount }] : []; });
    if (!changes.length) { setError("Chưa có cost rate nào thay đổi."); return; }
    void run(async () => { for (const change of changes) await send("/api/cost-rates", "PUT", { userId: change.person.id, periodKey, hourlyCostRate: change.amount }, `Không lưu được cost rate của ${change.person.name}.`); }, `Đã lưu cost rate cho ${changes.length} người từ ${month}.`);
  }
  function savePlanned() {
    const amount = parseMoneyInput(plannedDraft);
    if (amount === undefined) { setError("Nhập chi phí kế hoạch (0 nếu chưa có)."); return; }
    void run(() => send(`/api/project-costs/planned/${encodeURIComponent(project.id)}`, "PUT", { plannedCostAmount: amount, ...(periodKey ? { periodKey } : {}) }, "Không lưu được chi phí kế hoạch."), "Đã lưu chi phí kế hoạch.");
  }
  function saveParameters(codes: string[]) {
    const invalid = codes.find((code) => readParameterValue(parameterDrafts[code] ?? "") === undefined);
    if (invalid) { setError(`Tham số ${invalid} cần một giá trị số (ví dụ 5% hoặc 26.300).`); return; }
    void saveSetup({ parameters: setup.parameters.map((parameter) => codes.includes(parameter.code) ? { ...parameter, value: parameterDrafts[parameter.code] ?? parameter.value } : parameter) }, `Đã lưu tham số ${month}.`);
  }
  function savePool() {
    void saveSetup({ pool: { total: parseMoneyInput(poolDraft.total) ?? 0, criteria: poolDraft.criteria } }, `Đã lưu quỹ dùng chung ${month}.`);
  }

  const tag = (ok: boolean, text: string, key?: RowKey) => (
    <button key={text} type="button" disabled={!key} onClick={() => key && open !== key && toggle(key)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>
      {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}{text}
    </button>
  );

  return (
    <section aria-labelledby="pnl-statement-title" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pnl-statement-title" className="!text-base font-bold text-foreground">P&amp;L {periodKey ? month : scopeLabel}</h2>
          {access?.locked ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600"><Lock className="h-3.5 w-3.5" aria-hidden /> Đã chốt kỳ</span> : null}
        </div>
        {periodKey ? (
          <div className="flex flex-wrap gap-2">
            {tag(project.revenueBasis === "custom" || project.revenue > 0, project.revenueBasis === "custom" ? "Doanh thu: đã nhập cho tháng" : project.revenue > 0 ? "Doanh thu: theo kế hoạch" : periodKey ? "Chưa nhập doanh thu tháng" : "Chưa có doanh thu", project.revenueBasis === "custom" || project.revenue > 0 ? undefined : "revenue")}
            {tag(missingPeople.length === 0, missingPeople.length ? `Thiếu cost rate của ${missingPeople.length} người` : "Cost rate đủ", missingPeople.length ? "labor" : undefined)}
            {tag(project.plannedCost > 0, project.plannedCost > 0 ? "Có chi phí kế hoạch" : "Chưa có chi phí kế hoạch", project.plannedCost > 0 ? undefined : "planned")}
          </div>
        ) : (
          <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{partialRange ? "Đang xem một khoảng ngày" : "Đang xem cả dự án"} nên chỉ xem được. Số liệu nhập theo từng tháng: <button type="button" className="font-bold text-primary underline underline-offset-2" onClick={() => onPickMonth(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7))}>chọn tháng này</button> để nhập.</p>
        )}
        {periodKey && access && !access.canEdit && !access.locked ? <p role="status" className="text-xs text-muted-foreground">Bạn đang ở chế độ chỉ xem. Cần quyền Sửa chi phí hoặc Founder/GM để nhập.</p> : null}
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</p> : null}
      </div>

      <Row id="pnl-revenue" label="Doanh thu" editable={editable} open={open === "revenue"} onToggle={() => toggle("revenue")}
        hint={project.revenueBasis === "custom" ? `Nhập tay cho ${month || "kỳ"} · đã thu ${formatMoney(project.paidRevenue, project.currency)}` : project.revenue > 0 ? `Theo kế hoạch của cả project · đã thu ${formatMoney(project.paidRevenue, project.currency)}` : periodKey ? `Chưa nhập doanh thu ghi nhận của ${month} · kế hoạch cả project ${formatMoney(project.plannedRevenue, project.currency)}` : "Chưa có doanh thu"}
        amount={project.revenueBasis === "custom" || project.revenue > 0 ? formatMoney(project.revenue, project.currency) : "—"}>
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="pnl-revenue-input">Doanh thu ghi nhận của project trong {month} (₫)</label>
        <input id="pnl-revenue-input" inputMode="numeric" autoComplete="off" disabled={!editable} value={revenueDraft} placeholder={project.plannedRevenue > 0 ? `Kế hoạch cả project: ${moneyFormat.format(project.plannedRevenue)}` : "0"} onChange={(event) => setRevenueDraft(formatMoneyInput(event.target.value))} className={`${inputClass} !w-64 text-right font-mono tabular-nums`} />
        <Scope>Chỉ áp dụng cho project này, trong {month}. Doanh thu kế hoạch của cả project không được dùng thay: so với chi phí của một tháng là lệch kỳ. Nhập 0 nếu tháng này không ghi nhận doanh thu.</Scope>
        {editable ? <div className="flex flex-wrap items-center justify-between gap-2">{project.revenueBasis === "custom" ? <button type="button" disabled={saving} onClick={removeRevenue} className="inline-flex h-10 items-center rounded-xl border border-destructive/30 px-3.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50">Xoá doanh thu đã nhập</button> : <span />}<EditorActions saving={saving} label="Lưu doanh thu" onCancel={() => setOpen(null)} onSave={saveRevenue} /></div> : null}
      </Row>

      <Row id="pnl-labor" label="Chi phí nhân sự" editable={editable} open={open === "labor"} onToggle={() => toggle("labor")} action="Nhập cost rate"
        tone={missingPeople.length ? "warning" : undefined}
        hint={frozen ? "Số đã chốt · chi tiết theo người là dữ liệu hiện tại" : missingPeople.length ? `Giờ đã duyệt × cost rate · chưa gồm ${formatHours(project.missingRateMinutes)} của ${missingPeople.length} người thiếu cost rate` : "Giờ đã duyệt × cost rate của từng người"}
        amount={formatMoney(project.laborCost, project.currency)}>
        {frozen ? <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{LIVE_DETAIL} Chi phí nhân sự đã chốt của tháng là {formatMoney(project.laborCost, project.currency)}.</p> : null}
        {people.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><th className="py-2 pr-3">Nhân sự</th><th className="px-3 py-2 text-right">Giờ đã duyệt</th><th className="px-3 py-2 text-right">Cost rate (₫/giờ)</th><th className="py-2 pl-3 text-right">Chi phí</th></tr></thead>
              <tbody>{people.map((person) => {
                const rate = parseMoneyInput(rateDrafts[person.id] ?? "");
                // Only a typed, not-yet-saved rate is previewed; a saved figure is always the API's.
                const unsaved = rate !== undefined && rate !== (person.hourlyCostRate === undefined ? undefined : Math.round(person.hourlyCostRate));
                return (
                  <tr key={person.id} className="border-t border-border/60">
                    <td className="py-2 pr-3"><PersonLink userId={person.id} className="font-semibold text-foreground hover:text-primary">{person.name}</PersonLink></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatHours(person.pnlMinutes)}</td>
                    <td className="px-3 py-2 text-right"><input inputMode="numeric" autoComplete="off" aria-label={`Cost rate của ${person.name}`} disabled={!editable || saving} value={rateDrafts[person.id] ?? ""} placeholder={editable ? "Nhập" : "Chưa có"} onChange={(event) => setRateDrafts((current) => ({ ...current, [person.id]: formatMoneyInput(event.target.value) }))} className={`${inputClass} ml-auto !w-36 text-right font-mono tabular-nums`} /></td>
                    <td className="py-2 pl-3 text-right font-mono font-semibold tabular-nums">{unsaved ? <>{formatMoney(Math.round((person.pnlMinutes * rate) / 60), project.currency)}<span className="block font-sans text-[11px] font-semibold text-primary">xem trước · chưa lưu</span></> : person.hourlyCostRate === undefined || person.laborCost === undefined ? <span className="font-sans text-xs font-semibold text-amber-700">Thiếu</span> : formatMoney(person.laborCost, project.currency)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Chưa có giờ đã duyệt nào ở project trong {month || "phạm vi này"}.</p>}
        <Scope>Cost rate là của người, không riêng project: lưu ở đây sẽ áp dụng cho <strong>mọi dự án</strong> của người đó từ {month}, và giữ cho các tháng sau tới khi nhập đơn giá mới. <Link href={`/pnl/costs?periodKey=${periodKey ?? ""}`} className="font-semibold text-primary hover:underline">Nhập cho cả công ty</Link></Scope>
        {editable && people.length ? <EditorActions saving={saving} label="Lưu cost rate" onCancel={() => setOpen(null)} onSave={saveRates} /> : null}
      </Row>

      <Row id="pnl-other" label="Chi phí khác" editable={editable} open={open === "other"} onToggle={() => toggle("other")} action="Thêm / sửa"
        hint={frozen ? "Số đã chốt · danh sách khoản là dữ liệu hiện tại" : project.costItems.length ? `${project.costItems.length} khoản đã nhập cho project` : "Chưa nhập khoản nào: thuê ngoài, phần mềm, đi lại…"}
        amount={formatMoney(project.enteredCost, project.currency)}>
        {frozen ? <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{LIVE_DETAIL}</p> : null}
        {periodKey ? <PnlOtherCosts embedded periodKey={periodKey} projectId={project.id} onProjectChange={() => undefined} onPeriodChange={() => undefined} onChanged={onChanged} /> : null}
        <Scope>Chỉ áp dụng cho project này. Mỗi khoản tính vào tháng theo ngày phát sinh.</Scope>
      </Row>

      {frozen ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-border px-4 py-3 sm:grid-cols-[minmax(0,1fr)_170px_150px] sm:px-5">
          <div className="min-w-0"><p className="text-sm font-bold text-foreground">Chi phí khác đã chốt (quỹ dùng chung + khoản tính theo công thức)</p><p className="mt-0.5 text-xs text-muted-foreground">Một số đã chốt, không tách lại theo từng khoản. Mở lại kỳ ở Thiết lập P&amp;L nếu cần sửa.</p></div>
          <p className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">{formatMoney(project.lockedOtherCost ?? 0, project.currency)}</p>
          <span className="hidden sm:block" />
        </div>
      ) : null}

      {frozen ? null : project.calculatedItems.map((item) => {
        const key: RowKey = `calc:${item.code}`;
        const formula = setup.items.find((candidate) => candidate.code === item.code)?.formula ?? "";
        const used = setup.parameters.filter((parameter) => parameter.code && new RegExp(`(^|[^A-Z0-9_.])${parameter.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9_.]|$)`).test(formula.toUpperCase()));
        return (
          <Row key={item.code} id={`pnl-calc-${item.code}`} label={item.label} editable={editable} open={open === key} onToggle={() => toggle(key)} action="Sửa tham số"
            hint={<><span className="font-mono">{formula || "Tính theo công thức"}</span> · {GROUP_LABELS.get(item.category) ?? item.category}</>}
            amount={formatMoney(item.amount, project.currency)}>
            {used.length ? (
              <div className="grid gap-3 sm:grid-cols-2">{used.map((parameter) => {
                const value = readParameterValue(parameterDrafts[parameter.code] ?? "");
                return (
                  <label key={parameter.code} className="block text-xs font-semibold text-muted-foreground">{parameter.label || parameter.code} <span className="font-mono font-normal">({parameter.code})</span>
                    <input disabled={!editable || saving} value={parameterDrafts[parameter.code] ?? ""} onChange={(event) => setParameterDrafts((current) => ({ ...current, [parameter.code]: event.target.value }))} className={`${inputClass} mt-1 text-right font-mono`} />
                    <span className={`mt-1 block font-normal ${value === undefined ? "text-destructive" : ""}`}>{value === undefined ? "Chưa có giá trị số" : `Hệ thống hiểu là ${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(value)}`}</span>
                  </label>
                );
              })}</div>
            ) : <p className="text-sm text-muted-foreground">Công thức này không dùng tham số nào để sửa ở đây.</p>}
            <Scope>Tham số là của cả workspace trong {month}: sửa ở đây sẽ tính lại khoản này cho <strong>mọi dự án</strong>. <Link href="/pnl/config" className="font-semibold text-primary hover:underline">Sửa công thức</Link></Scope>
            {editable && used.length ? <EditorActions saving={saving} label="Lưu tham số" onCancel={() => setOpen(null)} onSave={() => saveParameters(used.map((parameter) => parameter.code))} /> : null}
          </Row>
        );
      })}

      {frozen ? null : <Row id="pnl-pool" label="Quỹ dùng chung" editable={editable} open={open === "pool"} onToggle={() => toggle("pool")}
        hint={setup.pool.total > 0 ? `Phần của project trong quỹ ${moneyFormat.format(setup.pool.total)} ₫ của ${month}` : "Chưa nhập quỹ cho tháng này"}
        amount={formatMoney(project.sharedCost, project.currency)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor="pnl-pool-total">Tổng quỹ của tháng (₫)<input id="pnl-pool-total" inputMode="numeric" autoComplete="off" disabled={!editable || saving} value={poolDraft.total} placeholder="0" onChange={(event) => setPoolDraft((current) => ({ ...current, total: formatMoneyInput(event.target.value) }))} className={`${inputClass} mt-1 text-right font-mono tabular-nums`} /></label>
          <div><span className="text-xs font-semibold text-muted-foreground">Chia theo</span><CrmSelect className="mt-1" ariaLabel="Chia quỹ theo" disabled={!editable || saving} options={POOL_OPTIONS} value={poolDraft.criteria} onChange={(criteria) => setPoolDraft((current) => ({ ...current, criteria }))} /></div>
        </div>
        <Scope>Quỹ là của cả workspace trong {month}: đổi tổng quỹ hay cách chia sẽ đổi phần được chia của <strong>mọi dự án</strong> có giờ đã duyệt.</Scope>
        {editable ? <EditorActions saving={saving} label="Lưu quỹ" onCancel={() => setOpen(null)} onSave={savePool} /> : null}
      </Row>}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-border bg-muted/20 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_170px_150px] sm:px-5">
        <p className="text-sm font-bold text-foreground">Tổng chi phí</p>
        <p className="text-right font-mono text-sm font-bold tabular-nums text-foreground">{formatMoney(project.totalCost, project.currency)}</p>
        <p className="col-span-2 text-right text-xs text-muted-foreground sm:col-span-1">{project.expenseRatioPercent === undefined ? "" : `${percent(project.expenseRatioPercent)} doanh thu`}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-border bg-muted/40 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_170px_150px] sm:px-5">
        <div><p className="text-base font-bold text-foreground">EBIT</p><p className={`mt-0.5 text-xs ${project.costAvailable && hasRevenue ? "text-muted-foreground" : "font-semibold text-amber-700"}`}>{!hasRevenue ? "Chưa tính được: chưa nhập doanh thu của kỳ" : project.locked ? "Số đã chốt" : project.costAvailable ? "Doanh thu − Tổng chi phí" : "Tạm tính: sẽ giảm khi nhập đủ cost rate"}</p></div>
        <p className="text-right font-mono text-base font-bold tabular-nums text-foreground">{hasRevenue ? formatMoney(project.grossMargin, project.currency) : "—"}</p>
        <p className="col-span-2 text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground sm:col-span-1">{project.grossMarginPercent === undefined || !hasRevenue ? "—" : `Biên EBIT ${percent(project.grossMarginPercent)}`}</p>
      </div>

      <Row id="pnl-planned" label="Chi phí kế hoạch" editable={plannedEditable} open={open === "planned"} onToggle={() => toggle("planned")}
        hint={project.plannedCost > 0 ? (project.totalCost > project.plannedCost ? `Thực tế vượt ${formatMoney(project.totalCost - project.plannedCost, project.currency)}` : `Còn ${formatMoney(project.plannedCost - project.totalCost, project.currency)} so với kế hoạch`) : "Chưa nhập ngân sách chi phí của project"}
        amount={project.plannedCost > 0 ? formatMoney(project.plannedCost, project.currency) : "—"}>
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="pnl-planned-input">Chi phí kế hoạch của cả project (₫)</label>
        <input id="pnl-planned-input" inputMode="numeric" autoComplete="off" disabled={saving || !plannedEditable} value={plannedDraft} placeholder="0" onChange={(event) => setPlannedDraft(formatMoneyInput(event.target.value))} className={`${inputClass} !w-64 text-right font-mono tabular-nums`} />
        <Scope>Chỉ áp dụng cho project này, cho cả dự án (không theo tháng). Dùng để so với chi phí thực tế, không tính vào EBIT.{frozen ? " Tháng đã chốt giữ chi phí kế hoạch tại thời điểm chốt." : ""}</Scope>
        {plannedEditable ? <EditorActions saving={saving} label="Lưu chi phí kế hoạch" onCancel={() => setOpen(null)} onSave={savePlanned} /> : null}
      </Row>
    </section>
  );
}
