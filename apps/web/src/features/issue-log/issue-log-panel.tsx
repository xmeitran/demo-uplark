"use client";

/**
 * "Sổ vấn đề": the body of the project's Issues tab (rules 5.4, V-23…V-26, V-31).
 * Blocker / Risk / Issue share one list; the API decides which transitions are allowed.
 */
import { avatarInitialsFor } from "@/lib/workspace-users";
import { UserAvatar } from "@/components/user-avatar";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Download, Pencil, Plus, X } from "lucide-react";
import {
  ISSUE_LOG_ACTION_FIELDS,
  ISSUE_LOG_DUE_STATE_LABELS,
  ISSUE_LOG_ESCALATION_LABELS,
  ISSUE_LOG_EXTENSION_FIELDS,
  ISSUE_LOG_IMPACT_AREA_LABELS,
  ISSUE_LOG_SEVERITIES,
  ISSUE_LOG_SEVERITY_LABELS,
  ISSUE_LOG_STATUS_LABELS,
  ISSUE_LOG_TYPES,
  ISSUE_LOG_TYPE_LABELS,
  issueLogFieldDef,
  type IssueLogAllowedAction,
  type IssueLogFieldDef,
  type IssueLogSeverity,
  type IssueLogStatus,
  type IssueLogType,
  type ProjectRiskSummary
} from "@b2b-crm/contracts";
import { CustomDatePicker, CustomDropdown } from "@/components/constructor-x/custom-controls";
import { DateRangeFilter, FilterBar, FilterField, MultiSelectFilter, PersonFilter, SearchFilter } from "@/components/filters";
import { ModalLayer } from "@/components/modal-layer";
import { KpiTile, TABLE_HEAD_CLASS } from "@/components/ui/kpi-tile";
import { readApiError } from "@/lib/api-error";
import { fetchAllPages } from "@/lib/api-pages";
import { downloadCsv } from "@/lib/csv-export";
import { formatVietnamDate, formatVietnamTime } from "@/lib/vietnam-time";
import { EMPTY_ISSUE_LOG_FILTERS, ISSUE_LOG_CSV_HEADERS, OPEN_ISSUE_STATUS, UNASSIGNED_ISSUE_OWNER, activeIssueLogFilterCount, dateLabel, fieldDisplay, filterIssueLog, isoDay, issueLogCsvRows, locationLabel, type IssueLogFilters } from "./issue-log-view";

type Member = { id: string; name: string; email?: string; avatarUrl?: string };
type LocationMilestone = { id: string; name: string };
type LocationGroup = { milestoneId: string; stages: Array<{ id: string; name: string; tasks: Array<{ id: string; title: string }> }> };
type Values = Record<string, string>;

const TYPE_TONE: Record<IssueLogType, string> = {
  blocker: "bg-rose-50 text-rose-700",
  risk: "bg-amber-50 text-amber-700",
  issue: "bg-violet-50 text-violet-700"
};
const SEVERITY_TONE: Record<IssueLogSeverity, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-amber-100 text-amber-800",
  critical: "bg-rose-100 text-rose-700"
};
const TYPE_HINT: Record<IssueLogType, string> = { blocker: "Blocker — đang chặn", risk: "Risk — nguy cơ", issue: "Issue — đã phát sinh" };

function statusTone(status: IssueLogStatus) {
  if (status === "resolved") return "bg-emerald-50 text-emerald-700";
  if (status === "accepted" || status === "cancelled") return "bg-slate-100 text-slate-600";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  return "bg-sky-50 text-sky-700";
}

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const labelClass = "mb-1.5 block text-xs font-semibold text-muted-foreground";
const pillClass = "rounded-full px-2 py-1 text-[10px] font-bold";
const isReal = (id: string) => Boolean(id) && !id.startsWith("__");

function FieldInput({ def, value, onChange, members, required }: { def: IssueLogFieldDef; value: string; onChange: (value: string) => void; members: Member[]; required?: boolean }) {
  const label = <span className={labelClass}>{def.label}{required ? " *" : ""}</span>;
  if (def.kind === "select" || def.kind === "user") {
    const options = def.kind === "user" ? members.map((member) => ({ value: member.id, label: member.name, avatarUrl: member.avatarUrl, initials: avatarInitialsFor(member.name) })) : [...(def.options ?? [])];
    return <div>{label}<CustomDropdown ariaLabel={def.label} options={required ? options : [{ value: "", label: "— Chưa chọn —" }, ...options]} value={value} onChange={onChange} placeholder="Chọn" menuPortal /></div>;
  }
  if (def.kind === "date") return <div>{label}<CustomDatePicker ariaLabel={def.label} value={value} onChange={onChange} placeholder="Chưa đặt" /></div>;
  if (def.kind === "textarea") return <label className="md:col-span-2">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} className={`${inputClass} resize-none`} /></label>;
  return <label>{label}<input type={def.kind === "number" ? "number" : "text"} step="any" value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} /></label>;
}

function Dialog({ title, subtitle, onClose, onSubmit, submitLabel, saving, error, children }: { title: string; subtitle?: string; onClose: () => void; onSubmit: () => void; submitLabel: string; saving: boolean; error: string | null; children: React.ReactNode }) {
  return (
    <ModalLayer onClose={onClose}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
        <form role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div><h3 className="text-sm font-bold text-foreground">{title}</h3>{subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}</div>
            <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          {/* min height: a dropdown menu opens inside this scroll area and needs room in a one-field dialog */}
          <div className="grid min-h-[20rem] content-start gap-3 overflow-y-auto px-5 py-4 md:grid-cols-2">{children}</div>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="alert" className="text-xs text-rose-600">{error}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Đóng</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">{saving ? "Đang lưu…" : submitLabel}</button>
            </div>
          </div>
        </form>
      </div>
    </ModalLayer>
  );
}

function recordValues(record: ProjectRiskSummary): Values {
  const values: Values = { description: record.description, severity: record.severity, ownerUserId: record.ownerUserId ?? "", dueAt: record.dueAt?.slice(0, 10) ?? "", milestoneId: record.milestoneId ?? "", stageId: record.stageId ?? "", taskId: record.taskId ?? "", evidence: record.evidence ?? "", nextStep: record.nextStep ?? "", impactArea: record.impactArea ?? "", resolutionEvidence: record.resolutionEvidence ?? "" };
  for (const [key, value] of Object.entries(record.extension)) values[key] = value === null || value === undefined ? "" : String(value);
  return values;
}

function extensionPayload(type: IssueLogType, values: Values, keys?: (key: string) => boolean) {
  const extension: Record<string, string | null> = {};
  for (const def of ISSUE_LOG_EXTENSION_FIELDS[type]) {
    if (def.auto || !(def.key in values) || (keys && !keys(def.key))) continue;
    extension[def.key] = values[def.key] === "" ? null : def.kind === "date" ? isoDay(values[def.key]) : values[def.key];
  }
  return extension;
}

export function IssueLogPanel({ projectId, teamMembers, milestones, milestoneGroups, initialRiskId, initialReportTaskId, onRecordsChange, onChanged }: {
  projectId: string;
  teamMembers: Member[];
  milestones: LocationMilestone[];
  milestoneGroups: LocationGroup[];
  initialRiskId?: string;
  /** "Báo vấn đề cho task này" on the Task Board: opens the report dialog already placed on that task. */
  initialReportTaskId?: string;
  /** Lets the page keep its own summaries (tab badge, overview) in step with the log. */
  onRecordsChange?: (records: ProjectRiskSummary[]) => void;
  /** A step of the log can change the project server-side (status proposal, warnings): lets the page reload it. */
  onChanged?: () => void | Promise<void>;
}) {
  const [records, setRecords] = useState<ProjectRiskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_ISSUE_LOG_FILTERS);
  const setFilter = <K extends keyof IssueLogFilters>(key: K) => (value: IssueLogFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const activeFilterCount = activeIssueLogFilterCount(filters);
  const [expandedId, setExpandedId] = useState<string | null>(initialRiskId ?? null);
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; record: ProjectRiskSummary } | { mode: "action"; record: ProjectRiskSummary; action: IssueLogAllowedAction } | null>(null);
  const [values, setValues] = useState<Values>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/risks`;
  const memberName = useCallback((id: string) => teamMembers.find((member) => member.id === id)?.name, [teamMembers]);

  const publish = useCallback((next: ProjectRiskSummary[]) => { setRecords(next); onRecordsChange?.(next); }, [onRecordsChange]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      publish(await fetchAllPages<ProjectRiskSummary>(base, { signal, errorLabel: "Không tải được sổ vấn đề" }));
      setLoadError(null);
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : "Không tải được sổ vấn đề.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [base, publish]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
    // Reload only when the project changes; `publish` follows a parent callback that may be re-created each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => {
    if (!initialRiskId || loading) return;
    window.requestAnimationFrame(() => document.getElementById(`issue-${initialRiskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [initialRiskId, loading]);

  const visible = useMemo(() => filterIssueLog(records, filters), [records, filters]);
  // Owners offered are the people who own a record, with the project member's avatar when there is one.
  const ownerPeople = useMemo(() => [
    { id: UNASSIGNED_ISSUE_OWNER, name: "Chưa phân công" },
    ...Array.from(new Map(records.filter((record) => record.ownerUserId).map((record) => [record.ownerUserId!, record.ownerDisplayName ?? record.ownerUserId!]))).map(([id, name]) => {
      const member = teamMembers.find((candidate) => candidate.id === id);
      return { id, name: member?.name ?? name, email: member?.email, avatarUrl: member?.avatarUrl };
    })
  ], [records, teamMembers]);
  const open = records.filter((record) => record.isOpen);
  const count = (type: IssueLogType) => open.filter((record) => record.type === type).length;
  const set = (key: string) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const openCreate = (location: Values = {}) => { setValues({ type: "issue", severity: "medium", ...location }); setFormError(null); setForm({ mode: "create" }); };
  useEffect(() => {
    if (!initialReportTaskId) return;
    const group = milestoneGroups.find((candidate) => candidate.stages.some((stage) => stage.tasks.some((task) => task.id === initialReportTaskId)));
    const stage = group?.stages.find((candidate) => candidate.tasks.some((task) => task.id === initialReportTaskId));
    openCreate({ milestoneId: group && isReal(group.milestoneId) ? group.milestoneId : "", stageId: stage && isReal(stage.id) ? stage.id : "", taskId: initialReportTaskId });
    // Once per link: drop the parameter so coming back to the tab does not reopen the dialog.
    const url = new URL(window.location.href);
    url.searchParams.delete("reportTask");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReportTaskId]);
  const openEdit = (record: ProjectRiskSummary) => { setValues(recordValues(record)); setFormError(null); setForm({ mode: "edit", record }); };
  const openAction = (record: ProjectRiskSummary, action: IssueLogAllowedAction) => { setValues({ ...recordValues(record), note: "", targetType: "" }); setFormError(null); setForm({ mode: "action", record, action }); };

  const send = async (url: string, method: string, body: unknown) => {
    const response = await fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401) { window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Issues`)}`); throw new Error("Phiên đăng nhập đã hết hạn."); }
    if (!response.ok) throw await readApiError(response);
    return response.json() as Promise<ProjectRiskSummary>;
  };

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const core = { description: values.description?.trim(), severity: values.severity, ownerUserId: values.ownerUserId || null, dueAt: values.dueAt ? isoDay(values.dueAt) : null, milestoneId: values.milestoneId || null, stageId: values.stageId || null, taskId: values.taskId || null, evidence: values.evidence || null, nextStep: values.nextStep || null, impactArea: values.impactArea || null };
      if (form.mode === "create") {
        const type = values.type as IssueLogType;
        if (!core.description) throw new Error("Hãy mô tả vấn đề cần ghi nhận.");
        const created = await send(base, "POST", { ...core, ownerUserId: core.ownerUserId ?? undefined, dueAt: core.dueAt ?? undefined, type, extension: extensionPayload(type, values) });
        setExpandedId(created.id);
      } else if (form.mode === "edit") {
        await send(`${base}/${encodeURIComponent(form.record.id)}`, "PATCH", { ...core, extension: extensionPayload(form.record.type, values) });
      } else {
        const { record, action } = form;
        const asked = new Set([...action.requires, ...(action.optional ?? [])]);
        const extensionType = action.action === "reclassify" && values.targetType ? (values.targetType as IssueLogType) : record.type;
        const wanted = action.action === "reclassify" ? (key: string) => Boolean(ISSUE_LOG_EXTENSION_FIELDS[extensionType].find((def) => def.key === key)?.requiredOnCreate) : (key: string) => asked.has(key);
        const body: Record<string, unknown> = { action: action.action, extension: extensionPayload(extensionType, values, wanted) };
        for (const def of ISSUE_LOG_ACTION_FIELDS) if (asked.has(def.key) && values[def.key]) body[def.key] = def.kind === "date" ? isoDay(values[def.key]) : values[def.key];
        await send(`${base}/${encodeURIComponent(record.id)}/transition`, "POST", body);
      }
      setForm(null);
      await reload();
      await onChanged?.();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Không thể lưu.");
    } finally {
      setSaving(false);
    }
  };

  const stages = milestoneGroups.filter((group) => !values.milestoneId || group.milestoneId === values.milestoneId).flatMap((group) => group.stages).filter((stage) => isReal(stage.id));
  const tasks = stages.filter((stage) => !values.stageId || stage.id === values.stageId).flatMap((stage) => stage.tasks);
  const formType = form?.mode === "create" ? (values.type as IssueLogType) : form ? form.record.type : "issue";
  const extensionDefs = ISSUE_LOG_EXTENSION_FIELDS[formType].filter((def) => !def.auto);
  const actionDefs = form?.mode === "action"
    ? [
        ...[...form.action.requires, ...(form.action.optional ?? [])].map((key) => ({ def: issueLogFieldDef(form.record.type, key), required: form.action.requires.includes(key) })),
        ...(form.action.action === "reclassify" && values.targetType ? ISSUE_LOG_EXTENSION_FIELDS[values.targetType as IssueLogType].filter((def) => def.requiredOnCreate).map((def) => ({ def, required: true })) : [])
      ].filter((entry): entry is { def: IssueLogFieldDef; required: boolean } => Boolean(entry.def))
    : [];
  const actionButtonTone = (tone?: string) => tone === "primary" ? "bg-primary text-primary-foreground" : tone === "danger" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-border bg-background text-foreground";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">SỔ VẤN ĐỀ</p><h2 className="mt-1 !text-base font-black tracking-tight text-foreground">Sổ vấn đề</h2><p className="mt-1 text-xs text-muted-foreground">Blocker, Risk và Issue của dự án. Bình luận và chat không thay cho sổ.</p></div>
        <button type="button" onClick={() => openCreate()} className="inline-flex min-h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"><Plus className="mr-1.5 h-3.5 w-3.5" /> Báo vấn đề</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Đang mở", value: open.length, detail: `${count("blocker")} blocker · ${count("risk")} risk · ${count("issue")} issue`, tone: "text-foreground" },
          { label: "Mức Cao trở lên", value: open.filter((record) => record.severity === "high" || record.severity === "critical").length, detail: "Cao hoặc Nghiêm trọng, đang mở", tone: "text-rose-600" },
          { label: "Quá hạn", value: open.filter((record) => record.dueState === "overdue").length, detail: "Quá hạn xử lý", tone: "text-amber-600" },
          { label: "Chưa có người phụ trách", value: open.filter((record) => !record.ownerUserId).length, detail: "Cần phân công", tone: "text-violet-600" },
          { label: "Đã chuyển cấp", value: open.filter((record) => record.escalationLevel !== "none").length, detail: "Lên Dx Director hoặc BD Lead", tone: "text-rose-600" }
        ].map((card) => <KpiTile key={card.label} label={card.label} value={card.value} detail={card.detail} valueClassName={card.tone} />)}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="text-sm font-bold text-foreground">Danh sách theo dõi</h3><p className="mt-1 text-xs text-muted-foreground">Bấm một dòng để xem chi tiết, lịch sử và các bước được phép.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">{records.length} bản ghi</span></div>
        <div className="border-b border-border px-5 py-3">
          <FilterBar
            onReset={activeFilterCount ? () => setFilters(EMPTY_ISSUE_LOG_FILTERS) : undefined}
            activeCount={activeFilterCount}
            actions={<>
              <span className="text-xs font-semibold text-muted-foreground">{visible.length} / {records.length} bản ghi</span>
              <button type="button" onClick={() => downloadCsv("so-van-de.csv", ISSUE_LOG_CSV_HEADERS, issueLogCsvRows(visible))} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"><Download className="h-3.5 w-3.5" /> Xuất Excel</button>
            </>}
          >
            <FilterField label="Tìm kiếm" className="min-w-[200px] flex-1"><SearchFilter className="" value={filters.query} onChange={setFilter("query")} placeholder="Mã, nội dung, vị trí..." ariaLabel="Tìm trong sổ vấn đề" /></FilterField>
            <FilterField label="Hạn xử lý"><DateRangeFilter value={filters.due} onChange={(range) => setFilter("due")(range)} ariaLabel="Lọc theo hạn xử lý" /></FilterField>
            <PersonFilter label="Người phụ trách" people={ownerPeople} values={filters.owners} onChange={setFilter("owners")} allLabel="Tất cả" />
            <MultiSelectFilter label="Loại bản ghi" options={ISSUE_LOG_TYPES.map((type) => ({ value: type, label: ISSUE_LOG_TYPE_LABELS[type] }))} values={filters.types} onChange={setFilter("types")} searchable={false} />
            <MultiSelectFilter label="Mức ảnh hưởng" options={ISSUE_LOG_SEVERITIES.map((severity) => ({ value: severity, label: ISSUE_LOG_SEVERITY_LABELS[severity] }))} values={filters.severities} onChange={setFilter("severities")} searchable={false} />
            <MultiSelectFilter label="Trạng thái" options={[{ value: OPEN_ISSUE_STATUS, label: "Đang mở" }, ...Array.from(new Set(records.map((record) => record.status))).map((status) => ({ value: status, label: ISSUE_LOG_STATUS_LABELS[status] }))]} values={filters.statuses} onChange={setFilter("statuses")} />
          </FilterBar>
        </div>
        {loadError ? <p role="alert" className="px-5 py-8 text-center text-sm text-rose-600">{loadError}</p> : loading ? <p className="px-5 py-12 text-center text-sm text-muted-foreground">Đang tải sổ vấn đề…</p> : visible.length === 0 ? <div className="px-5 py-12 text-center"><AlertCircle className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-semibold text-foreground">{records.length === 0 ? "Sổ chưa có bản ghi nào" : "Không có kết quả phù hợp bộ lọc"}</p>{records.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Mọi thành viên dự án đều có thể báo Blocker, Risk hoặc Issue.</p> : <button type="button" onClick={() => setFilters(EMPTY_ISSUE_LOG_FILTERS)} className="mt-2 text-xs font-semibold text-primary hover:underline">Đặt lại bộ lọc</button>}</div> : (
          <div className="overflow-x-auto rounded-b-2xl">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className={`bg-muted/25 ${TABLE_HEAD_CLASS}`}><tr><th className="px-4 py-3">Mã / Loại</th><th className="px-4 py-3">Nội dung</th><th className="px-4 py-3">Vị trí</th><th className="px-4 py-3">Mức ảnh hưởng</th><th className="px-4 py-3">Người phụ trách</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Hạn</th></tr></thead>
              <tbody className="divide-y divide-border">
                {visible.map((record) => {
                  const expanded = expandedId === record.id;
                  const due = record.dueAt;
                  return <React.Fragment key={record.id}>
                    <tr id={`issue-${record.id}`} className="cursor-pointer align-top transition hover:bg-muted/15" onClick={() => setExpandedId(expanded ? null : record.id)}>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="whitespace-nowrap text-xs font-black text-foreground">{record.code}</span><span className={`whitespace-nowrap ${pillClass} ${TYPE_TONE[record.type]}`}>{ISSUE_LOG_TYPE_LABELS[record.type]}</span></div></td>
                      <td className="max-w-[340px] px-4 py-3"><p className="line-clamp-2 font-semibold text-foreground">{record.description}</p><p className="mt-1 text-[11px] text-muted-foreground">{record.nextStep ? `Bước tiếp theo: ${record.nextStep}` : "Chưa có bước tiếp theo"}</p></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{locationLabel(record)}</td>
                      <td className="px-4 py-3"><span className={`${pillClass} ${SEVERITY_TONE[record.severity]}`}>{ISSUE_LOG_SEVERITY_LABELS[record.severity]}</span></td>
                      <td className="px-4 py-3 text-xs font-semibold text-foreground"><span className="inline-flex items-center gap-1.5">{record.ownerDisplayName ? <UserAvatar id={record.ownerUserId} name={record.ownerDisplayName} size="xs" /> : null}{record.ownerDisplayName ?? "Chưa phân công"}</span></td>
                      <td className="px-4 py-3"><span className={`whitespace-nowrap ${pillClass} ${statusTone(record.status)}`}>{ISSUE_LOG_STATUS_LABELS[record.status]}</span>{record.resolutionProposedAt && record.isOpen && <p className="mt-1.5 text-[10px] font-semibold text-amber-700">Chờ PM xác nhận</p>}{record.escalationLevel !== "none" && <p className="mt-1.5"><span className={`whitespace-nowrap ${pillClass} bg-rose-50 text-rose-700`}>Chuyển cấp: {ISSUE_LOG_ESCALATION_LABELS[record.escalationLevel]}</span></p>}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground"><p>{due ? dateLabel(due) : "—"}</p><p className={`mt-1 text-[10px] font-bold ${record.dueState === "overdue" ? "text-rose-600" : "text-muted-foreground"}`}>{ISSUE_LOG_DUE_STATE_LABELS[record.dueState]} · {record.ageDays} ngày <span className="ml-1">{expanded ? "▲" : "▼"}</span></p></td>
                    </tr>
                    {expanded && <tr className="bg-muted/10"><td colSpan={7} className="px-6 py-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-border bg-background p-3">
                          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 text-xs">
                            {([
                              ["Người báo", `${record.createdByDisplayName ?? "—"} · ${formatVietnamDate(record.createdAt)}`],
                              ["Bằng chứng", record.evidence],
                              ["Loại ảnh hưởng", record.impactArea ? ISSUE_LOG_IMPACT_AREA_LABELS[record.impactArea] : ""],
                              ["Hạn xử lý", dateLabel(record.dueAt)],
                              ["Bằng chứng xử lý", record.resolutionEvidence],
                              ["Lý do huỷ", record.cancelReason],
                              ...ISSUE_LOG_EXTENSION_FIELDS[record.type].map((def) => [def.label, fieldDisplay(def, record.extension[def.key], memberName)] as [string, string])
                            ] as Array<[string, string | undefined]>).filter(([, value]) => value).map(([label, value]) => <React.Fragment key={label}><dt className="font-bold text-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words leading-5 text-muted-foreground">{value}</dd></React.Fragment>)}
                          </dl>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {record.allowedActions.map((action) => <button key={action.action} type="button" onClick={() => openAction(record, action)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${actionButtonTone(action.tone)}`}>{action.label}</button>)}
                            {record.canEdit && <button type="button" onClick={() => openEdit(record)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground"><Pencil className="h-3.5 w-3.5" /> Sửa thông tin</button>}
                            {!record.allowedActions.length && !record.canEdit && <p className="text-[11px] text-muted-foreground">{record.isOpen ? "Bạn không có bước nào cần thực hiện ở bản ghi này." : "Bản ghi đã kết thúc."}</p>}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-background p-3">
                          <p className="text-xs font-bold text-foreground">Lịch sử</p>
                          <ol className="mt-2 space-y-2">
                            {[...record.history].reverse().map((entry) => <li key={entry.id} className="border-l-2 border-border pl-3 text-xs leading-5">
                              <p className="font-semibold text-foreground">{entry.label}{entry.toStatus && entry.toStatus !== entry.fromStatus ? ` → ${ISSUE_LOG_STATUS_LABELS[entry.toStatus as IssueLogStatus] ?? entry.toStatus}` : ""}</p>
                              {entry.note && <p className="whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}
                              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">{entry.actorDisplayName ? <UserAvatar id={entry.actorUserId} name={entry.actorDisplayName} size="xs" /> : null}{entry.actorDisplayName ?? "Hệ thống"} · {formatVietnamDate(entry.at)} {formatVietnamTime(entry.at)}</p>
                            </li>)}
                          </ol>
                        </div>
                      </div>
                    </td></tr>}
                  </React.Fragment>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && form.mode !== "action" && (
        <Dialog title={form.mode === "create" ? "Báo vấn đề" : `Sửa ${form.record.code}`} subtitle={form.mode === "create" ? "PM sẽ phân loại trong 1 ngày làm việc. Trạng thái đổi qua các bước của sổ, không sửa tay." : ISSUE_LOG_TYPE_LABELS[form.record.type]} onClose={() => setForm(null)} onSubmit={() => void submit()} submitLabel={form.mode === "create" ? "Ghi vào sổ" : "Lưu thay đổi"} saving={saving} error={formError}>
          {form.mode === "create" && <div><span className={labelClass}>Loại bản ghi *</span><CustomDropdown ariaLabel="Loại bản ghi" options={ISSUE_LOG_TYPES.map((type) => ({ value: type, label: TYPE_HINT[type] }))} value={values.type ?? "issue"} onChange={set("type")} /></div>}
          <div><span className={labelClass}>Mức ảnh hưởng *</span><CustomDropdown ariaLabel="Mức ảnh hưởng" options={ISSUE_LOG_SEVERITIES.map((severity) => ({ value: severity, label: ISSUE_LOG_SEVERITY_LABELS[severity] }))} value={values.severity ?? "medium"} onChange={set("severity")} /></div>
          <label className="md:col-span-2"><span className={labelClass}>Mô tả *</span><textarea value={values.description ?? ""} onChange={(event) => set("description")(event.target.value)} rows={3} placeholder="Ví dụ: Chờ dữ liệu đầu vào từ khách hàng để hoàn thành stage…" className={`${inputClass} resize-none`} /></label>
          <div><span className={labelClass}>Người chịu trách nhiệm</span><CustomDropdown ariaLabel="Người chịu trách nhiệm" options={[{ value: "", label: "Chưa phân công" }, ...teamMembers.map((member) => ({ value: member.id, label: member.name, avatarUrl: member.avatarUrl, initials: avatarInitialsFor(member.name) }))]} value={values.ownerUserId ?? ""} onChange={set("ownerUserId")} /></div>
          <div><span className={labelClass}>Hạn xử lý</span><CustomDatePicker ariaLabel="Hạn xử lý" value={values.dueAt ?? ""} onChange={set("dueAt")} placeholder="Chưa đặt hạn" /></div>
          <div><span className={labelClass}>Milestone</span><CustomDropdown ariaLabel="Milestone" options={[{ value: "", label: "Không gắn" }, ...milestones.filter((milestone) => isReal(milestone.id)).map((milestone) => ({ value: milestone.id, label: milestone.name }))]} value={values.milestoneId ?? ""} onChange={(milestoneId) => setValues((current) => ({ ...current, milestoneId, stageId: "", taskId: "" }))} /></div>
          <div><span className={labelClass}>Stage</span><CustomDropdown ariaLabel="Stage" options={[{ value: "", label: "Không gắn" }, ...stages.map((stage) => ({ value: stage.id, label: stage.name }))]} value={values.stageId ?? ""} onChange={(stageId) => setValues((current) => ({ ...current, stageId, taskId: "" }))} /></div>
          <div className="md:col-span-2"><span className={labelClass}>Task</span><CustomDropdown ariaLabel="Task" options={[{ value: "", label: "Không gắn" }, ...tasks.map((task) => ({ value: task.id, label: task.title }))]} value={values.taskId ?? ""} onChange={set("taskId")} /></div>
          <label className="md:col-span-2"><span className={labelClass}>Bằng chứng hoặc đường dẫn</span><input value={values.evidence ?? ""} onChange={(event) => set("evidence")(event.target.value)} className={inputClass} /></label>
          <label className="md:col-span-2"><span className={labelClass}>Bước tiếp theo</span><input value={values.nextStep ?? ""} onChange={(event) => set("nextStep")(event.target.value)} className={inputClass} /></label>
          <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground md:col-span-2">Thông tin riêng của {ISSUE_LOG_TYPE_LABELS[formType]}</p>
          {extensionDefs.map((def) => <FieldInput key={def.key} def={def} value={values[def.key] ?? ""} onChange={set(def.key)} members={teamMembers} required={def.requiredOnCreate} />)}
        </Dialog>
      )}
      {form?.mode === "action" && (
        <Dialog title={form.action.label} subtitle={`${form.record.code} · ${ISSUE_LOG_STATUS_LABELS[form.record.status]}`} onClose={() => setForm(null)} onSubmit={() => void submit()} submitLabel="Xác nhận" saving={saving} error={formError}>
          {actionDefs.length === 0 && <p className="text-xs text-muted-foreground md:col-span-2">Bước này không cần thêm thông tin. Thao tác sẽ được ghi vào lịch sử.</p>}
          {actionDefs.map(({ def, required }) => <FieldInput key={def.key} def={def} value={values[def.key] ?? ""} onChange={set(def.key)} members={teamMembers} required={required} />)}
        </Dialog>
      )}
    </div>
  );
}
