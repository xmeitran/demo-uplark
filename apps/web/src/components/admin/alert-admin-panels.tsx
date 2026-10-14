"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Info, Play, RefreshCw, RotateCcw, Save } from "lucide-react";
import {
  ALERT_SEVERITY_LABELS,
  ALERT_TIERS,
  ALERT_TIER_LABELS,
  ALERT_TRIGGERS,
  type AdminWarningItem,
  type AlertScanResult,
  type AlertSeverity,
  type AlertTier,
  type AlertTriggerDef,
  type SystemParameterItem
} from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { DateRangeFilter, FilterBar, FilterField, MultiSelectFilter, PersonFilter, SearchFilter, matchesAny, type DateRange, type FilterPerson } from "@/components/filters";
import { fetchAllPages } from "@/lib/api-pages";
import { TABLE_HEAD_CLASS } from "@/components/ui/kpi-tile";

const buttonClass = "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50";
const inputClass = "h-9 rounded-[10px] border border-border bg-white px-2.5 text-sm outline-none ring-primary/30 focus:ring-2 disabled:bg-slate-50";
const cardClass = "overflow-hidden rounded-3xl border border-border bg-card shadow-sm";
const headClass = `bg-slate-50 ${TABLE_HEAD_CLASS}`;

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body ? (body as { message: unknown }).message : undefined;
    throw new Error(Array.isArray(message) ? message.join(", ") : typeof message === "string" ? message : fallback);
  }
  return body as T;
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

function severityClass(severity: string) {
  if (severity === "critical") return "bg-rose-100 text-rose-800";
  if (severity === "high") return "bg-rose-50 text-rose-700";
  if (severity === "medium") return "bg-amber-50 text-amber-700";
  return "bg-sky-50 text-sky-700";
}

const severityLabel = (severity: string) => ALERT_SEVERITY_LABELS[severity as AlertSeverity] ?? severity;

function Notice({ tone, children }: { tone: "error" | "ok" | "info"; children: ReactNode }) {
  const tones = { error: "border-rose-200 bg-rose-50 text-rose-800", ok: "border-emerald-200 bg-emerald-50 text-emerald-800", info: "border-sky-100 bg-sky-50/70 text-sky-800" };
  return <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs leading-relaxed ${tones[tone]}`}><Info className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}

function countsText(counts: Record<string, number>) {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([code, count]) => `${code}: ${count}`).join(", ") : "0";
}

// ---------------------------------------------------------------------------
// Admin › Cảnh báo: the stored warning records (V-33, V-34)
// ---------------------------------------------------------------------------

type WarningsResponse = { data: AdminWarningItem[]; meta: { total: number; open: number; byCode: Record<string, number> } };

const ALL_TIME: DateRange = { from: "", to: "" };
const OPEN_ONLY = ["open"];
const NO_OWNER = "__none__";

/**
 * Status and the "Ngày mở" range are sent to the API and every page of the answer is loaded (no row cap);
 * the other filters narrow the loaded rows, so their option lists always show the whole result.
 */
export function WarningRecordsPanel({ legacy }: { legacy: ReactNode }) {
  const [rows, setRows] = useState<AdminWarningItem[]>([]);
  const [meta, setMeta] = useState<WarningsResponse["meta"]>({ total: 0, open: 0, byCode: {} });
  const [statuses, setStatuses] = useState<string[]>(OPEN_ONLY);
  const [opened, setOpened] = useState<DateRange>(ALL_TIME);
  const [typeCodes, setTypeCodes] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<AlertScanResult | null>(null);
  // Keep the previous detailed warning view visible by default. The stored
  // warning records add lifecycle/filtering, but they must not hide the
  // Estimate/Actual breakdown that Admin uses to understand the issue.
  const [showLegacy, setShowLegacy] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: statuses.length ? statuses.join(",") : "all" });
      if (opened.from) params.set("from", opened.from);
      if (opened.to) params.set("to", opened.to);
      const fallback = "Không tải được danh sách cảnh báo.";
      const [data, summary] = await Promise.all([
        fetchAllPages<AdminWarningItem>(`/api/admin/warnings?${params}`, { errorLabel: "Không tải được danh sách cảnh báo" }),
        // The workspace-wide open counts come with any page; one row is enough.
        fetch("/api/admin/warnings?limit=1", { cache: "no-store", credentials: "same-origin" }).then((response) => readJson<WarningsResponse>(response, fallback))
      ]);
      setRows(data);
      setMeta(summary.meta);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được danh sách cảnh báo.");
    } finally {
      setLoading(false);
    }
  }, [statuses, opened]);

  useEffect(() => { void load(); }, [load]);

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      const body = await readJson<{ data: AlertScanResult }>(await fetch("/api/admin/alert-scan", { method: "POST", credentials: "same-origin" }), "Không chạy được lượt quét.");
      setScan(body.data);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không chạy được lượt quét.");
    } finally {
      setScanning(false);
    }
  }

  const projects = useMemo(() => [...new Map(rows.map((row) => [row.projectId, row.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "vi")).map(([value, label]) => ({ value, label })), [rows]);
  const owners = useMemo(() => {
    const people = new Map<string, FilterPerson>();
    for (const row of rows) if (row.ownerUserId) people.set(row.ownerUserId, { id: row.ownerUserId, name: row.ownerName ?? row.ownerUserId });
    const sorted = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return rows.some((row) => !row.ownerUserId) ? [...sorted, { id: NO_OWNER, name: "Chưa có người phụ trách" }] : sorted;
  }, [rows]);
  const filtered = rows.filter((row) => matchesAny(typeCodes, row.typeCode)
    && matchesAny(severities, row.severity)
    && matchesAny(projectIds, row.projectId)
    && matchesAny(ownerIds, row.ownerUserId ?? NO_OWNER)
    && matchesSearch(search, row.projectName, row.projectCode, row.title, row.detail, row.ownerName));
  const statusChanged = statuses.length !== 1 || statuses[0] !== "open";
  const activeCount = [Boolean(search.trim()), Boolean(opened.from || opened.to), ownerIds.length > 0, statusChanged, typeCodes.length > 0, severities.length > 0, projectIds.length > 0].filter(Boolean).length;
  const reset = () => { setSearch(""); setOpened(ALL_TIME); setOwnerIds([]); setStatuses(OPEN_ONLY); setTypeCodes([]); setSeverities([]); setProjectIds([]); };

  return <section aria-label="Bản ghi cảnh báo" className="grid gap-5">
    {error ? <Notice tone="error">{error}</Notice> : null}
    {scan ? <Notice tone="ok">Đã quét {scan.projects} dự án lúc {formatDateTime(scan.scannedAt)}. Mở mới: {countsText(scan.opened)}. Làm mới: {countsText(scan.refreshed)}. Đóng: {countsText(scan.closed)}. Thông báo trong ứng dụng: {scan.notifications.inApp}; Lark: {scan.notifications.lark}.</Notice> : null}
    <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <FilterBar
        onReset={activeCount ? reset : undefined}
        activeCount={activeCount}
        actions={<>
          <button type="button" onClick={() => void load()} disabled={loading} className={buttonClass}><RefreshCw className="h-4 w-4" /> Làm mới</button>
          <button type="button" onClick={() => void runScan()} disabled={scanning} className={buttonClass}><Play className="h-4 w-4" /> {scanning ? "Đang quét…" : "Quét ngay"}</button>
        </>}
      >
        <FilterField label="Tìm kiếm" className="min-w-[220px] flex-1"><SearchFilter className="" value={search} onChange={setSearch} placeholder="Dự án, nội dung, người phụ trách..." ariaLabel="Tìm cảnh báo" /></FilterField>
        <FilterField label="Ngày mở"><DateRangeFilter value={opened} onChange={(range) => setOpened(range)} ariaLabel="Lọc theo ngày mở cảnh báo" /></FilterField>
        <PersonFilter label="Người phụ trách" people={owners} values={ownerIds} onChange={setOwnerIds} allLabel="Tất cả người phụ trách" searchPlaceholder="Tìm theo tên..." />
        <MultiSelectFilter label="Trạng thái" values={statuses} onChange={setStatuses} options={[{ value: "open", label: "Đang mở" }, { value: "closed", label: "Đã đóng" }]} allLabel="Tất cả trạng thái" searchable={false} />
        <MultiSelectFilter label="Điểm kích hoạt" values={typeCodes} onChange={setTypeCodes} options={ALERT_TRIGGERS.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}${meta.byCode[item.code] ? ` (${meta.byCode[item.code]})` : ""}` }))} allLabel="Tất cả điểm kích hoạt" />
        <MultiSelectFilter label="Mức" values={severities} onChange={setSeverities} options={Object.entries(ALERT_SEVERITY_LABELS).map(([value, label]) => ({ value, label }))} allLabel="Tất cả mức" searchable={false} />
        <MultiSelectFilter label="Dự án" values={projectIds} onChange={setProjectIds} options={projects} allLabel="Tất cả dự án" />
      </FilterBar>
    </section>
    <section className={cardClass}>
      <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div><h3 className="text-base font-bold text-slate-950">Bản ghi cảnh báo</h3><p className="mt-1 text-xs text-slate-500">{meta.open} cảnh báo đang mở trong workspace · đang hiển thị {filtered.length}/{rows.length}</p></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm">
        <thead className={headClass}><tr><th className="px-5 py-3 font-bold">Mã</th><th className="px-4 py-3 font-bold">Dự án</th><th className="px-4 py-3 font-bold">Cảnh báo</th><th className="px-4 py-3 font-bold">Mức</th><th className="px-4 py-3 font-bold">Người chịu trách nhiệm</th><th className="px-4 py-3 font-bold">Hạn xử lý</th><th className="px-4 py-3 font-bold">Mở lúc</th><th className="px-4 py-3 font-bold">Trạng thái</th></tr></thead>
        <tbody className="divide-y divide-border">
          {filtered.map((row) => <tr key={row.id} className="align-top transition hover:bg-slate-50/80">
            <td className="px-5 py-4"><span className="font-bold text-slate-900">{row.typeCode}</span><span className="mt-1 block text-xs text-slate-500">{row.triggerName}</span></td>
            <td className="px-4 py-4"><a href={`/projects/${encodeURIComponent(row.projectId)}`} className="group inline-flex min-w-[180px] items-start gap-1 font-bold text-slate-900 hover:text-primary">{row.projectName}<ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-primary" /></a>{row.projectCode ? <span className="mt-1 block text-xs font-medium text-slate-500">{row.projectCode}</span> : null}</td>
            <td className="max-w-[420px] px-4 py-4"><span className="font-semibold text-slate-900">{row.title}</span>{row.detail ? <span className="mt-1 block text-xs leading-relaxed text-slate-600">{row.detail}</span> : null}{row.closeReason ? <span className="mt-1 block text-xs text-slate-500">Đóng: {row.closeReason}</span> : null}</td>
            <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${severityClass(row.severity)}`}>{severityLabel(row.severity)}</span></td>
            <td className="px-4 py-4 text-slate-700">{row.ownerName ?? "—"}</td>
            <td className={`whitespace-nowrap px-4 py-4 ${row.overdue ? "font-bold text-rose-700" : "text-slate-700"}`}>{formatDate(row.dueAt)}{row.overdue ? <span className="block text-xs font-semibold">Quá hạn</span> : null}</td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDateTime(row.openedAt)}</td>
            <td className="whitespace-nowrap px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${row.status === "open" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{row.status === "open" ? "Đang mở" : "Đã đóng"}</span>{row.closedAt ? <span className="mt-1 block text-xs text-slate-500">{formatDateTime(row.closedAt)}</span> : null}</td>
          </tr>)}
          {!filtered.length ? <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-500">{loading ? "Đang tải…" : activeCount ? <>Không có kết quả phù hợp bộ lọc. <button type="button" onClick={reset} className="!font-semibold text-primary hover:underline">Đặt lại bộ lọc</button></> : "Chưa có bản ghi cảnh báo. Bấm “Quét ngay” để chạy lượt quét đầu ngày."}</td></tr> : null}
        </tbody>
      </table></div>
    </section>
    <Notice tone="info">Cảnh báo tự đóng khi điều kiện kết thúc của điểm kích hoạt đã thỏa; đóng tay kèm lý do thực hiện ở trang chi tiết dự án. Ngưỡng và tầng thông báo cấu hình ở tab Tham số.</Notice>
    <div><button type="button" onClick={() => setShowLegacy((value) => !value)} aria-expanded={showLegacy} className={buttonClass}>{showLegacy ? "Ẩn" : "Xem"} danh sách chất lượng dữ liệu (tính tức thời)</button></div>
    {showLegacy ? legacy : null}
  </section>;
}

// ---------------------------------------------------------------------------
// Admin › Tham số: 7.6 parameters and the trigger catalogue (V-38)
// ---------------------------------------------------------------------------

function displayValue(item: Pick<SystemParameterItem, "kind" | "options" | "entries" | "unit">, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Chưa đặt";
  if (item.kind === "select") return item.options?.find((option) => option.value === value)?.label ?? String(value);
  if (item.kind === "times") return (value as string[]).join(", ");
  if (item.kind === "number_map") return (item.entries ?? []).map((entry) => `${entry.key}: ${(value as Record<string, number>)[entry.key]}`).join(" · ");
  if (item.kind === "date") return formatDate(`${String(value)}T00:00:00+07:00`);
  return `${String(value)} ${item.unit}`.trim();
}

// The table scrolls sideways, so a menu cannot overflow it: the last rows open upwards instead of being cut off.
const opensUp = (index: number, total: number) => total > 5 && index >= total - 3;

function ParameterInput({ item, value, onChange, openUp }: { item: SystemParameterItem; value: unknown; onChange: (value: unknown) => void; openUp?: boolean }) {
  if (item.kind === "select") {
    return <CrmSelect ariaLabel={item.label} value={String(value ?? "")} onChange={onChange} options={[...(item.options ?? [])]} openDirection={openUp ? "up" : "down"} className="w-full max-w-[320px]" />;
  }
  if (item.kind === "times") {
    const times = Array.isArray(value) ? value as string[] : [];
    return <div className="flex flex-wrap items-center gap-2">{times.map((time, index) => <input key={index} type="time" aria-label={`${item.label} ${index + 1}`} value={time} onChange={(event) => onChange(times.map((current, position) => (position === index ? event.target.value : current)))} className={`${inputClass} w-[110px]`} />)}</div>;
  }
  if (item.kind === "date") {
    return <input type="date" aria-label={item.label} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || null)} className={`${inputClass} w-[170px]`} />;
  }
  if (item.kind === "number_map") {
    const map = (value ?? {}) as Record<string, unknown>;
    return <div className="grid gap-1.5">{(item.entries ?? []).map((entry) => <label key={entry.key} className="flex items-center gap-2 text-xs text-slate-600"><input type="number" min={item.min} max={item.max} step={item.integer ? 1 : "any"} aria-label={`${item.label}: ${entry.label}`} value={String(map[entry.key] ?? "")} onChange={(event) => onChange({ ...map, [entry.key]: event.target.value })} className={`${inputClass} w-[72px]`} />{entry.label}</label>)}<span className="text-xs text-slate-500">{item.unit}</span></div>;
  }
  return <div className="flex items-center gap-2"><input type="number" min={item.min} max={item.max} step={item.integer ? 1 : "any"} aria-label={item.label} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={`${inputClass} w-[110px]`} /><span className="text-xs text-slate-500">{item.unit}</span></div>;
}

export function SystemParametersPanel() {
  const [items, setItems] = useState<SystemParameterItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [triggers, setTriggers] = useState<AlertTriggerDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [parameters, catalogue] = await Promise.all([
        fetch("/api/admin/parameters", { cache: "no-store", credentials: "same-origin" }).then((response) => readJson<{ data: SystemParameterItem[] }>(response, "Không tải được tham số.")),
        fetch("/api/admin/alert-triggers", { cache: "no-store", credentials: "same-origin" }).then((response) => readJson<{ data: AlertTriggerDef[] }>(response, "Không tải được danh mục điểm kích hoạt."))
      ]);
      setItems(parameters.data);
      setDrafts({});
      setTriggers(catalogue.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được tham số.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveParameter(item: SystemParameterItem, body: { value?: unknown; reset?: boolean }) {
    setBusy(item.key);
    setError(null);
    setNotice(null);
    try {
      const saved = await readJson<{ data: SystemParameterItem }>(await fetch(`/api/admin/parameters/${encodeURIComponent(item.key)}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "Không lưu được tham số.");
      setItems((current) => current.map((candidate) => (candidate.key === item.key ? saved.data : candidate)));
      setDrafts((current) => { const next = { ...current }; delete next[item.key]; return next; });
      setNotice(body.reset ? `Đã đưa “${item.label}” về mặc định.` : `Đã lưu “${item.label}”.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được tham số.");
    } finally {
      setBusy(null);
    }
  }

  async function saveTrigger(trigger: AlertTriggerDef, body: { enabled?: boolean; tier?: AlertTier }) {
    setBusy(trigger.code);
    setError(null);
    setNotice(null);
    try {
      const saved = await readJson<{ data: AlertTriggerDef }>(await fetch(`/api/admin/alert-triggers/${encodeURIComponent(trigger.code)}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "Không lưu được điểm kích hoạt.");
      setTriggers((current) => current.map((candidate) => (candidate.code === trigger.code ? saved.data : candidate)));
      setNotice(`Đã cập nhật ${trigger.code}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được điểm kích hoạt.");
    } finally {
      setBusy(null);
    }
  }

  return <section aria-label="Tham số cấu hình" className="grid gap-5">
    {error ? <Notice tone="error">{error}</Notice> : null}
    {notice ? <Notice tone="ok">{notice}</Notice> : null}
    <section className={cardClass}>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div><h3 className="text-base font-bold text-slate-950">Tham số cấu hình</h3><p className="mt-1 text-xs text-slate-500">Mục 7.6. Giá trị áp dụng cho cả workspace; mỗi lần đổi được lưu lịch sử và ghi audit.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className={buttonClass}><RefreshCw className="h-4 w-4" /> Làm mới</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm">
        <thead className={headClass}><tr><th className="px-5 py-3 font-bold">Tham số</th><th className="px-4 py-3 font-bold">Giá trị</th><th className="px-4 py-3 font-bold">Mặc định</th><th className="px-4 py-3 font-bold">Thay đổi lần cuối</th><th className="px-4 py-3" /></tr></thead>
        <tbody className="divide-y divide-border">
          {items.map((item, index) => {
            const dirty = Object.prototype.hasOwnProperty.call(drafts, item.key);
            const value = dirty ? drafts[item.key] : item.value;
            return <tr key={item.key} className="align-top">
              <td className="max-w-[340px] px-5 py-4"><span className="font-bold text-slate-900">{item.label}</span><span className="mt-1 block text-xs text-slate-500">Dùng cho: {item.usedBy} · Người chốt: {item.decidedBy}{item.templateOverridable ? " · Template có thể ghi đè" : ""}</span>{item.hint ? <span className="mt-1 block text-xs text-slate-500">{item.hint}</span> : null}</td>
              <td className="px-4 py-4"><ParameterInput item={item} value={value} openUp={opensUp(index, items.length)} onChange={(next) => setDrafts((current) => ({ ...current, [item.key]: next }))} /></td>
              <td className="max-w-[240px] px-4 py-4 text-xs text-slate-600">{displayValue(item, item.defaultValue)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-600">{item.updatedAt ? <>{item.updatedByName ?? "—"}<span className="block text-slate-500">{formatDateTime(item.updatedAt)}</span></> : "Chưa đổi"}</td>
              <td className="px-4 py-4"><div className="flex justify-end gap-2">
                <button type="button" disabled={!dirty || busy === item.key} onClick={() => void saveParameter(item, { value })} className={buttonClass}><Save className="h-4 w-4" /> Lưu</button>
                <button type="button" disabled={(item.isDefault && !dirty) || busy === item.key} onClick={() => void saveParameter(item, { reset: true })} title="Về mặc định" aria-label={`Đưa ${item.label} về mặc định`} className={buttonClass}><RotateCcw className="h-4 w-4" /> Mặc định</button>
              </div></td>
            </tr>;
          })}
          {!items.length ? <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">{loading ? "Đang tải…" : "Không có tham số."}</td></tr> : null}
        </tbody>
      </table></div>
    </section>

    <section className={cardClass}>
      <div className="border-b border-border px-5 py-4 sm:px-6"><h3 className="text-base font-bold text-slate-950">Danh mục điểm kích hoạt</h3><p className="mt-1 text-xs text-slate-500">Mục 7.5. Tầng thông báo: đẩy ngay (mặc định), bản tin trong ngày, hoặc chỉ hiện trên màn hình.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm">
        <thead className={headClass}><tr><th className="px-5 py-3 font-bold">Mã</th><th className="px-4 py-3 font-bold">Kích hoạt khi</th><th className="px-4 py-3 font-bold">Kết thúc khi</th><th className="px-4 py-3 font-bold">Đọc từ</th><th className="px-4 py-3 font-bold">Mức</th><th className="px-4 py-3 font-bold">Bật</th><th className="px-4 py-3 font-bold">Tầng thông báo</th></tr></thead>
        <tbody className="divide-y divide-border">
          {triggers.map((trigger, index) => <tr key={trigger.code} className="align-top">
            <td className="whitespace-nowrap px-5 py-4"><span className="font-bold text-slate-900">{trigger.code}</span><span className="mt-1 block text-xs text-slate-500">{trigger.name}</span></td>
            <td className="max-w-[300px] px-4 py-4 text-xs leading-relaxed text-slate-700">{trigger.condition}{trigger.disabledReason ? <span className="mt-1 block font-semibold text-amber-700">Chưa bật được: {trigger.disabledReason}</span> : null}</td>
            <td className="max-w-[220px] px-4 py-4 text-xs leading-relaxed text-slate-700">{trigger.closesWhen}</td>
            <td className="px-4 py-4 text-xs text-slate-600">{trigger.readsFrom}<span className="mt-1 block text-slate-500">{trigger.mode === "event" ? "Theo sự kiện" : trigger.mode === "scan" ? "Quét đầu ngày" : "Sự kiện + quét"}</span></td>
            <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${severityClass(trigger.severity)}`}>{severityLabel(trigger.severity)}</span></td>
            <td className="px-4 py-4"><input type="checkbox" aria-label={`Bật ${trigger.code}`} checked={trigger.enabled} disabled={Boolean(trigger.disabledReason) || busy === trigger.code} onChange={(event) => void saveTrigger(trigger, { enabled: event.target.checked })} className="h-4 w-4 accent-emerald-600" /></td>
            <td className="px-4 py-4"><CrmSelect ariaLabel={`Tầng thông báo ${trigger.code}`} value={trigger.tier} disabled={busy === trigger.code} onChange={(tier) => void saveTrigger(trigger, { tier: tier as AlertTier })} options={ALERT_TIERS.map((tier) => ({ value: tier, label: ALERT_TIER_LABELS[tier] }))} openDirection={opensUp(index, triggers.length) ? "up" : "down"} className="w-[190px]" /></td>
          </tr>)}
          {!triggers.length ? <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">{loading ? "Đang tải…" : "Không có điểm kích hoạt."}</td></tr> : null}
        </tbody>
      </table></div>
    </section>
    <Notice tone="info">Template milestone chưa ghi đè được tham số; các tham số có nhãn “Template có thể ghi đè” hiện dùng giá trị workspace cho mọi dự án.</Notice>
  </section>;
}
