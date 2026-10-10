"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ProjectCostCategory, ProjectCostItem, ProjectCostItemInput, ProjectCostItemsResponse, ProjectSummary, ResourceListResponse } from "@b2b-crm/contracts";
import { EXPENSE_GROUPS } from "./pnl-data";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { FilterBar, FilterField, MonthFilter } from "@/components/filters/filter-controls";
import { currentPeriodKey, formatMoneyInput, inputClass, labelClass, moneyFormat, monthDateRange, parseMoneyInput, periodLabel, primaryButton, readApi, secondaryButton, thClass, todayKey } from "./pnl-cost-shared";

// Salaries are computed from hours × cost rate, so only the five other BRD groups can be entered.
const CATEGORY_GROUPS = EXPENSE_GROUPS.filter((group) => group.key !== "salaries-related");
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_GROUPS.map((group) => [group.key, group.label])) as Record<ProjectCostCategory, string>;
const CATEGORY_OPTIONS = CATEGORY_GROUPS.map((group) => ({ value: group.key, label: group.label, subtext: group.hint }));

type Draft = { projectId: string; category: ProjectCostCategory; label: string; amount: string; occurredOn: string; note: string };

function emptyDraft(projectId: string, periodKey?: string): Draft {
  // A cost counts in the month of its date: when entering for another month, default inside that month.
  const occurredOn = periodKey && !todayKey().startsWith(periodKey) ? monthDateRange(periodKey).endDate : todayKey();
  return { projectId, category: "functional-operation", label: "", amount: "", occurredOn, note: "" };
}

/** Returns the API payload, or the first problem the user has to fix. */
function validate(draft: Draft): { input: ProjectCostItemInput } | { problem: string } {
  if (!draft.projectId) return { problem: "Chọn dự án phát sinh chi phí." };
  if (!draft.label.trim()) return { problem: "Nhập nội dung chi phí (ví dụ: License Lark tháng 10)." };
  const amount = parseMoneyInput(draft.amount);
  if (!amount) return { problem: "Nhập số tiền lớn hơn 0." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) return { problem: "Chọn ngày phát sinh." };
  return { input: { projectId: draft.projectId, category: draft.category, label: draft.label.trim(), amount, occurredOn: draft.occurredOn, note: draft.note.trim() || undefined } };
}

async function loadProjects() {
  const projects: ProjectSummary[] = [];
  for (let offset = 0; ; offset += 100) {
    const payload = await readApi<ResourceListResponse<ProjectSummary>>(await fetch(`/api/projects?limit=100&offset=${offset}`, { cache: "no-store" }), "Không tải được danh sách dự án.");
    projects.push(...payload.data);
    if (!payload.meta?.pagination?.hasNextPage || !payload.data.length) return projects;
  }
}

function CostFields({ draft, onChange, projects, lockProject, hideProject, idPrefix }: Readonly<{ draft: Draft; onChange: (draft: Draft) => void; projects: ProjectSummary[]; lockProject?: boolean; hideProject?: boolean; idPrefix: string }>) {
  const projectOptions = useMemo(() => projects.map((project) => ({ value: project.id, label: project.name, subtext: project.code })), [projects]);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      {hideProject ? null : <div className="xl:col-span-2"><span className={labelClass}>Dự án</span><CrmSelect ariaLabel="Dự án" searchable disabled={lockProject} options={[{ value: "", label: "Chọn dự án" }, ...projectOptions]} value={draft.projectId} onChange={(projectId) => onChange({ ...draft, projectId })} /></div>}
      <div className="xl:col-span-2"><span className={labelClass}>Nhóm chi phí</span><CrmSelect ariaLabel="Nhóm chi phí" options={CATEGORY_OPTIONS} value={draft.category} onChange={(category) => onChange({ ...draft, category: category as ProjectCostCategory })} /></div>
      <div><label className={labelClass} htmlFor={`${idPrefix}-date`}>Ngày phát sinh</label><input id={`${idPrefix}-date`} type="date" value={draft.occurredOn} onChange={(event) => onChange({ ...draft, occurredOn: event.target.value })} className={inputClass} /></div>
      <div><label className={labelClass} htmlFor={`${idPrefix}-amount`}>Số tiền (₫)</label><input id={`${idPrefix}-amount`} inputMode="numeric" autoComplete="off" value={draft.amount} placeholder="0" onChange={(event) => onChange({ ...draft, amount: formatMoneyInput(event.target.value) })} className={`${inputClass} text-right font-mono tabular-nums`} /></div>
      <div className="md:col-span-2 xl:col-span-3"><label className={labelClass} htmlFor={`${idPrefix}-label`}>Nội dung</label><input id={`${idPrefix}-label`} value={draft.label} maxLength={200} placeholder="Ví dụ: License Lark tháng 10" onChange={(event) => onChange({ ...draft, label: event.target.value })} className={inputClass} /></div>
      <div className="md:col-span-2 xl:col-span-3"><label className={labelClass} htmlFor={`${idPrefix}-note`}>Ghi chú (không bắt buộc)</label><input id={`${idPrefix}-note`} value={draft.note} maxLength={1000} placeholder="Số hóa đơn, nhà cung cấp…" onChange={(event) => onChange({ ...draft, note: event.target.value })} className={inputClass} /></div>
    </div>
  );
}

/**
 * `embedded` is the in-place editor on a project's P&L: the project is fixed, the month comes
 * from the page, and `onChanged` lets the page recalculate after every save.
 */
export function PnlOtherCosts({ periodKey, projectId, onProjectChange, onPeriodChange, embedded = false, onChanged }: Readonly<{ periodKey: string; projectId: string; onProjectChange: (projectId: string) => void; onPeriodChange: (periodKey: string) => void; embedded?: boolean; onChanged?: () => void }>) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [items, setItems] = useState<ProjectCostItem[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [locked, setLocked] = useState(false);
  const [allMonths, setAllMonths] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(projectId, periodKey));
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => { if (embedded) return; loadProjects().then(setProjects).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Không tải được danh sách dự án.")); }, [embedded]);
  useEffect(() => { setDraft((current) => ({ ...current, projectId })); }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (!allMonths) { const range = monthDateRange(periodKey); params.set("startDate", range.startDate); params.set("endDate", range.endDate); }
    try {
      const payload = await readApi<ProjectCostItemsResponse>(await fetch(`/api/project-costs?${params.toString()}`, { cache: "no-store" }), "Không tải được chi phí.");
      setItems(payload.data); setCanEdit(payload.meta.canEdit); setLocked(Boolean(payload.meta.locked));
    } catch (reason) {
      setItems([]); setError(reason instanceof Error ? reason.message : "Không tải được chi phí.");
    } finally { setLoading(false); }
  }, [projectId, periodKey, allMonths]);
  useEffect(() => { void load(); }, [load]);

  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const projectFilterOptions = useMemo(() => [{ value: "", label: "Tất cả dự án" }, ...projects.map((project) => ({ value: project.id, label: project.name, subtext: project.code }))], [projects]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validate(draft);
    if ("problem" in result) { setFormProblem(result.problem); return; }
    setBusy(true); setFormProblem(null); setMessage(null);
    try {
      await readApi(await fetch("/api/project-costs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result.input) }), "Không lưu được chi phí.");
      setMessage(`Đã thêm ${moneyFormat.format(result.input.amount)} ₫ — ${result.input.label}. EBIT của dự án đã được tính lại.`);
      setDraft({ ...emptyDraft(draft.projectId), category: draft.category, occurredOn: draft.occurredOn });
      await load(); onChanged?.();
    } catch (reason) { setFormProblem(reason instanceof Error ? reason.message : "Không lưu được chi phí."); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    const result = validate(editing.draft);
    if ("problem" in result) { setError(result.problem); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await readApi(await fetch(`/api/project-costs/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(result.input) }), "Không cập nhật được chi phí.");
      setEditing(null); setMessage("Đã cập nhật khoản chi phí.");
      await load(); onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không cập nhật được chi phí."); }
    finally { setBusy(false); }
  }

  async function remove(item: ProjectCostItem) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await readApi(await fetch(`/api/project-costs/${encodeURIComponent(item.id)}`, { method: "DELETE" }), "Không xóa được chi phí.");
      setConfirmDeleteId(null); setMessage(`Đã xóa ${moneyFormat.format(item.amount)} ₫ — ${item.label}.`);
      await load(); onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không xóa được chi phí."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {embedded ? null : <p className="text-sm text-foreground">Ghi các khoản chi <strong>ngoài lương</strong> của từng dự án và xếp vào một trong 5 nhóm chi phí. Mỗi khoản được cộng vào chi phí của dự án theo ngày phát sinh.</p>}

      {canEdit ? (
        <form onSubmit={submit} aria-labelledby="add-cost-title" className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 id="add-cost-title" className="!text-sm font-bold text-foreground">Thêm khoản chi phí</h2>
          <div className="mt-3"><CostFields draft={draft} onChange={setDraft} projects={projects} hideProject={embedded} idPrefix="new-cost" /></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {formProblem ? <p role="alert" className="text-xs font-semibold text-destructive">{formProblem}</p> : <span className="text-xs text-muted-foreground">Chi phí nhân sự không nhập ở đây — hệ thống tự tính từ giờ đã duyệt × cost rate.</span>}
            <button type="submit" disabled={busy} className={primaryButton}><Plus className="h-4 w-4" /> {busy ? "Đang lưu…" : "Thêm chi phí"}</button>
          </div>
        </form>
      ) : !loading && !error ? <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{locked ? <>{periodLabel(periodKey)} đã chốt kỳ nên không thêm, sửa hay xoá được chi phí. Mở lại kỳ ở Thiết lập P&amp;L nếu cần.</> : <>Bạn đang ở chế độ chỉ xem. Cần quyền <strong>Sửa</strong> chi phí hoặc Founder/GM để thêm chi phí.</>}</p> : null}

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</p> : null}

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4">
          <h2 className="!text-sm font-bold text-foreground sm:mr-2">Chi phí đã nhập</h2>
          {embedded
            // Inside a project's P&L the month comes from the page; only "every month" is left to toggle.
            ? <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><input type="checkbox" checked={allMonths} onChange={(event) => setAllMonths(event.target.checked)} className="h-4 w-4 rounded border-input" /> Xem mọi tháng</label>
            : <FilterBar className="min-w-0 flex-1" onReset={projectId || allMonths || periodKey !== currentPeriodKey() ? () => { setAllMonths(false); onProjectChange(""); onPeriodChange(currentPeriodKey()); } : undefined}>
                <FilterField className="w-full sm:w-72"><CrmSelect ariaLabel="Lọc theo dự án" searchable options={projectFilterOptions} value={projectId} onChange={onProjectChange} /></FilterField>
                <MonthFilter ariaLabel="Tháng phát sinh" allowAll value={allMonths ? "" : periodKey} onChange={(next) => { setAllMonths(!next); if (next) onPeriodChange(next); }} />
              </FilterBar>}
        </div>
        <div className="overflow-x-auto">
          <table className={embedded ? "w-full min-w-[640px]" : "w-full min-w-[860px]"}>
            <thead><tr className="border-b border-border bg-muted/30"><th className={thClass}>Ngày</th>{embedded ? null : <th className={thClass}>Dự án</th>}<th className={thClass}>Nhóm</th><th className={thClass}>Nội dung</th><th className={`${thClass} text-right`}>Số tiền</th>{canEdit ? <th className={`${thClass} text-right`}><span className="sr-only">Thao tác</span></th> : null}</tr></thead>
            <tbody>
              {items.map((item) => editing?.id === item.id ? (
                <tr key={item.id} className="border-b border-border/50 bg-primary/5"><td colSpan={(canEdit ? 6 : 5) - (embedded ? 1 : 0)} className="px-4 py-4"><CostFields draft={editing.draft} onChange={(next) => setEditing({ id: item.id, draft: next })} projects={projects} lockProject hideProject={embedded} idPrefix={`edit-${item.id}`} /><div className="mt-3 flex justify-end gap-2"><button type="button" className={secondaryButton} disabled={busy} onClick={() => setEditing(null)}>Hủy</button><button type="button" className={primaryButton} disabled={busy} onClick={() => void saveEdit()}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button></div></td></tr>
              ) : (
                <tr key={item.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums text-foreground">{item.occurredOn.split("-").reverse().join("/")}</td>
                  {embedded ? null : <td className="px-4 py-3"><Link href={`/pnl/${encodeURIComponent(item.projectId)}?scope=all`} className="text-sm font-semibold text-foreground hover:text-primary">{item.projectName ?? item.projectId}</Link></td>}
                  <td className="px-4 py-3"><span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-foreground">{CATEGORY_LABELS[item.category] ?? item.category}</span></td>
                  <td className="px-4 py-3 text-sm text-foreground">{item.label}{item.note ? <span className="block text-[11px] text-muted-foreground">{item.note}</span> : null}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{moneyFormat.format(item.amount)} ₫</td>
                  {canEdit ? <td className="whitespace-nowrap px-4 py-3 text-right">{confirmDeleteId === item.id ? <span className="inline-flex items-center gap-2 text-xs"><span className="font-semibold text-destructive">Xóa khoản này?</span><button type="button" disabled={busy} className="rounded-lg bg-destructive px-2.5 py-1.5 font-semibold text-destructive-foreground" onClick={() => void remove(item)}>Xóa</button><button type="button" className="rounded-lg px-2 py-1.5 font-semibold text-muted-foreground hover:bg-muted" onClick={() => setConfirmDeleteId(null)}>Hủy</button></span> : <span className="inline-flex gap-1"><button type="button" aria-label={`Sửa ${item.label}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setEditing({ id: item.id, draft: { projectId: item.projectId, category: item.category, label: item.label, amount: moneyFormat.format(item.amount), occurredOn: item.occurredOn, note: item.note ?? "" } })}><Pencil className="h-4 w-4" /></button><button type="button" aria-label={`Xóa ${item.label}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDeleteId(item.id)}><Trash2 className="h-4 w-4" /></button></span>}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length ? <div className="px-5 py-10 text-center"><p className="text-sm font-semibold text-foreground">{loading ? "Đang tải chi phí…" : "Chưa có khoản chi phí nào"}</p>{!loading ? <p className="mt-1 text-xs text-muted-foreground">{allMonths ? "Chưa nhập khoản nào cho phạm vi đang chọn." : `Chưa nhập khoản nào trong ${periodLabel(periodKey).toLowerCase()}. Chọn "Tất cả thời gian" để xem các tháng khác.`}</p> : null}</div> : null}
        </div>
        <div className="flex items-center justify-between rounded-b-xl border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground"><span><strong className="text-foreground">{items.length}</strong> khoản</span><span>Tổng: <strong className="font-mono tabular-nums text-foreground">{moneyFormat.format(total)} ₫</strong></span></div>
      </section>
    </div>
  );
}
