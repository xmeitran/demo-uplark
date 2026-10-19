"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Info,
  LayoutDashboard,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  TimerReset,
  TriangleAlert
} from "lucide-react";
import type {
  AdminAlertDetailRow,
  AdminAlertType,
  AdminAlertsResponse,
  AdminApprovalsResponse,
  AdminHistoryResponse,
  AdminOverviewResponse,
  SendWorkspaceReminderInput,
  WorkspaceReminderRecipientsResponse,
  UpdateWorkspaceReminderPolicyInput,
  WorkspaceReminderPolicy,
  WorkspaceReminderSlot,
  WorkspaceReminderSlotCode
} from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { WorkspaceDayOffSettings } from "@/components/settings/workspace-day-off-settings";
import { PersonalLeavePanel } from "@/components/settings/personal-leave-panel";
import { CustomDropdown, type TaskSelectOption } from "@/components/crm-workspace/tasks-workbench";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { DateRangeFilter, FilterBar, FilterField, MultiSelectFilter, PersonFilter, SearchFilter, dayOf, isWithinRange, matchesAny, toCsvParam, type DateRange, type FilterPerson } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";
import { isAdminView } from "@/lib/auth-role";
import { WorkspaceTabBar } from "@/components/workspace-tab-bar";
import { businessRoleFromMember, systemRoleFromCodes, systemRoleLabel } from "@/lib/people-roles";
import { SystemParametersPanel, WarningRecordsPanel } from "./alert-admin-panels";
import { PnlSetupPage } from "@/components/pnl/pnl-setup-page";
import { adminSectionFromHash, type AdminSection } from "./admin-sections";

type HistoryEntries = AdminHistoryResponse["data"];

const ALL_TIME: DateRange = { from: "", to: "" };
const HISTORY_PAGE_SIZE = 50; // the API's cap for /admin/history

function FilterEmpty({ onReset }: { onReset: () => void }) {
  return <div className="p-10 text-center"><p className="text-sm font-bold text-slate-900">Không có kết quả phù hợp bộ lọc</p><button type="button" onClick={onReset} className="mt-3 rounded-lg border border-border px-3 py-1.5 !text-xs !font-semibold text-primary hover:bg-slate-50">Đặt lại bộ lọc</button></div>;
}

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && "message" in message && typeof (message as { message?: unknown }).message === "string") {
    return (message as { message: string }).message;
  }
  return fallback;
}

function formatUpdatedAt(value?: string) {
  if (!value) return "Đang dùng cấu hình mặc định · chưa lưu";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Đã lưu" : `Cập nhật ${date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}`;
}

function alertTone(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return { box: "border-rose-200 bg-rose-50/80", icon: "bg-rose-100 text-rose-700", title: "text-rose-900" };
  if (severity === "warning") return { box: "border-amber-200 bg-amber-50/80", icon: "bg-amber-100 text-amber-700", title: "text-amber-950" };
  return { box: "border-sky-200 bg-sky-50/80", icon: "bg-sky-100 text-sky-700", title: "text-sky-950" };
}

function slotLabel(slot: WorkspaceReminderSlot) {
  return slot.label || ({ morning_plan: "Kế hoạch đầu ngày", pm_follow_up: "Nhắc lại cho PM", evening_actual: "Giờ thực tế cuối ngày" } as Record<WorkspaceReminderSlotCode, string>)[slot.slot];
}

function reminderRecipientOptions(users: WorkspaceReminderRecipientsResponse["data"]["users"]): TaskSelectOption[] {
  return users.map((user) => {
    const parts = user.displayName.trim().split(/\s+/).filter(Boolean);
    const initials = parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase()
      : (parts[0]?.slice(0, 2) || "U").toUpperCase();
    const role = user.roleCodes?.some((roleCode) => roleCode === "FOUNDER_GM" || roleCode === "WORKSPACE_ADMIN")
      ? systemRoleLabel(systemRoleFromCodes(user.roleCodes))
      : businessRoleFromMember(user);
    return {
      value: user.id,
      label: user.displayName,
      subtext: `${role}${user.email ? ` · ${user.email}` : ""}`,
      avatarUrl: user.avatarUrl,
      initials,
      color: "#2563eb"
    };
  });
}

export function WorkspaceAdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = isAdminView(user);
  const [overview, setOverview] = useState<AdminOverviewResponse["data"] | null>(null);
  const [policy, setPolicy] = useState<WorkspaceReminderPolicy | null>(null);
  const [reminderRecipients, setReminderRecipients] = useState<WorkspaceReminderRecipientsResponse["data"]>({ users: [], teams: [] });
  const [alertDetails, setAlertDetails] = useState<AdminAlertDetailRow[]>([]);
  const [approvalHistoryEntries, setApprovalHistoryEntries] = useState<AdminHistoryResponse["data"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<AdminSection>("overview");

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, policyResponse, alertsResponse, recipientsResponse, approvalHistoryResponse] = await Promise.all([
        fetch("/api/admin/overview", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/reminders", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/alerts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/reminders/recipients", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/history?limit=12&scope=mine", { cache: "no-store", credentials: "same-origin" })
      ]);
      const overviewBody = await overviewResponse.json().catch(() => null);
      const policyBody = await policyResponse.json().catch(() => null);
      const alertsBody = await alertsResponse.json().catch(() => null);
      const recipientsBody = await recipientsResponse.json().catch(() => null);
      const approvalHistoryBody = await approvalHistoryResponse.json().catch(() => null);
      if (!overviewResponse.ok) throw new Error(errorMessage(overviewBody, "Không tải được tổng quan admin."));
      if (!policyResponse.ok) throw new Error(errorMessage(policyBody, "Không tải được lịch nhắc Lark."));
      if (!alertsResponse.ok) throw new Error(errorMessage(alertsBody, "Không tải được chi tiết cảnh báo."));
      if (!recipientsResponse.ok) throw new Error(errorMessage(recipientsBody, "Không tải được danh sách người nhận nhắc Lark."));
      if (!approvalHistoryResponse.ok) throw new Error(errorMessage(approvalHistoryBody, "Không tải được lịch sử duyệt của bạn."));
      setOverview((overviewBody as AdminOverviewResponse).data);
      setPolicy((policyBody as { data: WorkspaceReminderPolicy }).data);
      setAlertDetails((alertsBody as AdminAlertsResponse).data);
      setReminderRecipients((recipientsBody as WorkspaceReminderRecipientsResponse).data);
      setApprovalHistoryEntries((approvalHistoryBody as AdminHistoryResponse).data ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu admin.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const syncHash = () => {
      setSection(adminSectionFromHash(window.location.hash));
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const selectSection = (next: AdminSection) => {
    setSection(next);
    window.history.replaceState(window.history.state, "", next === "overview" ? "/admin" : `/admin#${next}`);
    window.requestAnimationFrame(() => document.getElementById("admin-content")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const sendManualReminder = async (input: SendWorkspaceReminderInput) => {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const response = await fetch("/api/admin/reminders/send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const body = await response.json().catch(() => null) as { data?: { recipientCount?: number; recipientNames?: string[] }; message?: string } | null;
      if (!response.ok) throw new Error(errorMessage(body, "Không gửi được nhắc Lark."));
      setNotice(`Đã gửi nhắc Lark thủ công cho ${body?.data?.recipientCount ?? 0} người: ${(body?.data?.recipientNames ?? []).join(", ")}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không gửi được nhắc Lark.");
    } finally {
      setSending(false);
    }
  };

  const updateSlot = (code: WorkspaceReminderSlotCode, patch: Partial<WorkspaceReminderSlot>) => {
    setPolicy((current) => current ? { ...current, slots: current.slots.map((slot) => slot.slot === code ? { ...slot, ...patch } : slot) } : current);
  };

  const savePolicy = async () => {
    if (!policy) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload: UpdateWorkspaceReminderPolicyInput = {
      enabled: policy.enabled,
      weekdaysOnly: policy.weekdaysOnly,
      slots: policy.slots.map(({ slot, time, enabled }) => ({ slot, time, enabled }))
    };
    try {
      const response = await fetch("/api/admin/reminders", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Không lưu được lịch nhắc Lark."));
      setPolicy((body as { data: WorkspaceReminderPolicy }).data);
      setNotice("Đã lưu lịch nhắc cho workspace. Worker sẽ áp dụng ở lần kiểm tra kế tiếp.");
      setOverview((current) => current ? { ...current, reminderPolicy: (body as { data: WorkspaceReminderPolicy }).data } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được lịch nhắc Lark.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Đang kiểm tra quyền truy cập…</div>;

  if (!isAdmin) {
    return (
      <AppShell activeRoute="/admin" title="Điều hành workspace">
        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 xl:p-6">
          <PageHeader title="Điều hành workspace" subtitle="Khu vực dành cho Admin" />
          <section className="mx-auto mt-10 w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><ShieldAlert className="h-7 w-7" /></div>
            <p className="mt-5 text-base font-bold text-foreground">Khu vực dành cho Admin</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Bạn cần tài khoản Admin ở chế độ quản trị để xem cảnh báo, khóa ngày nghỉ và cấu hình nhắc Lark.</p>
          </section>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeRoute="/admin" title="Điều hành workspace">
      <main className="admin-workspace-page min-h-0 flex-1 overflow-y-auto bg-background p-3 sm:p-4 xl:p-6">
        <div className="mx-auto grid max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-4">
          <PageHeader
            className="border-b border-border pb-4"
            title="Điều hành workspace"
            subtitle="Quản lý quy trình, quyền duyệt và các chính sách vận hành của workspace."
            meta={<span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-semibold"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {overview?.workspace.name ?? "Workspace"}<span className="text-border">·</span>{overview?.workspace.timezone ?? "Asia/Ho_Chi_Minh"}</span>}
          />

          <div className="admin-workspace-tabbar sticky top-0 z-30 self-start -mx-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 xl:-mx-6 xl:px-6">
            <nav aria-label="Admin sections" className="overflow-x-auto">
              <WorkspaceTabBar
                items={[
                  { id: "overview" as AdminSection, label: "Tổng quan", description: "Sức khỏe workspace", icon: <LayoutDashboard className="h-4 w-4" /> },
                  { id: "alerts" as AdminSection, label: "Cảnh báo", description: "Bản ghi cảnh báo dự án", icon: <TriangleAlert className="h-4 w-4" /> },
                  { id: "parameters" as AdminSection, label: "Tham số", description: "Ngưỡng & điểm kích hoạt", icon: <SlidersHorizontal className="h-4 w-4" /> },
                  { id: "day-offs" as AdminSection, label: "Ngày nghỉ", description: "Khóa ngày & loại phí", icon: <CalendarDays className="h-4 w-4" /> },
                  { id: "reminders" as AdminSection, label: "Nhắc Lark", description: "Lịch gửi & người nhận", icon: <BellRing className="h-4 w-4" /> },
                  { id: "approval" as AdminSection, label: "Phê duyệt", description: "Hồ sơ chờ duyệt", icon: <ShieldCheck className="h-4 w-4" /> },
                  { id: "pnl-config" as AdminSection, label: "Thiết lập P&L", description: "Khoản mục & tham số", icon: <Settings2 className="h-4 w-4" /> },
                  { id: "history" as AdminSection, label: "Lịch sử", description: "Audit hoạt động admin", icon: <Clock3 className="h-4 w-4" /> }
                ]}
                value={section}
                onChange={selectSection}
                ariaLabel="Admin sections"
                idPrefix="admin"
                className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none"
              />
            </nav>
          </div>

          {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
          {notice ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}

          <div id="admin-content" className="scroll-mt-24">
            {section === "overview" ? <OverviewPanel overview={overview} loading={loading} onRefresh={() => void load()} /> : null}
            {section === "alerts" ? <WarningRecordsPanel legacy={<AlertsPanel rows={alertDetails} loading={loading} onRefresh={() => void load()} />} /> : null}
            {section === "parameters" ? <SystemParametersPanel /> : null}
            {section === "day-offs" ? <section aria-label="Quản lý ngày nghỉ"><WorkspaceDayOffSettings /><PersonalLeavePanel /></section> : null}
            {section === "reminders" ? <ReminderPolicyPanel policy={policy} saving={saving} sending={sending} recipients={reminderRecipients} onSave={() => void savePolicy()} onSendManual={(input) => void sendManualReminder(input)} onUpdateSlot={updateSlot} onSetPolicy={setPolicy} /> : null}
            {section === "approval" ? <ApprovalPanel approvalHistory={approvalHistoryEntries} historyLoading={loading} onRefreshHistory={() => void load()} onApproved={() => void load()} /> : null}
            {section === "pnl-config" ? <PnlSetupPage embedded /> : null}
            {section === "history" ? <AdminHistoryLog people={reminderRecipients.users.map((person) => ({ id: person.id, name: person.displayName, email: person.email, avatarUrl: person.avatarUrl }))} /> : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function historyIcon(category: AdminHistoryResponse["data"][number]["category"]) {
  if (category === "approval") return <ShieldCheck className="h-4 w-4" />;
  if (category === "day_off") return <CalendarDays className="h-4 w-4" />;
  if (category === "pnl") return <Settings2 className="h-4 w-4" />;
  return <LockKeyhole className="h-4 w-4" />;
}

function historyIconTone(category: AdminHistoryResponse["data"][number]["category"]) {
  if (category === "approval") return "bg-emerald-50 text-emerald-700";
  if (category === "day_off") return "bg-amber-50 text-amber-700";
  if (category === "pnl") return "bg-sky-50 text-sky-700";
  return "bg-violet-50 text-violet-700";
}

/**
 * Admin › Lịch sử: the audit log, filtered and paged by the API (`from`/`to`, `actorUserId`, `action`, `q`, `offset`).
 * "Tải thêm" appends the next 50 rows of the same filter.
 */
function AdminHistoryLog({ people }: { people: FilterPerson[] }) {
  const [entries, setEntries] = useState<HistoryEntries>([]);
  const [total, setTotal] = useState(0);
  const [actionOptions, setActionOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [actors, setActors] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const requestRef = useRef(0);

  // Typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadPage = useCallback(async (offset: number) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope: "all", limit: String(HISTORY_PAGE_SIZE), offset: String(offset) });
    const filters = { from: range.from, to: range.to, actorUserId: toCsvParam(actors), action: toCsvParam(actions), q: query };
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    try {
      const response = await fetch(`/api/admin/history?${params}`, { cache: "no-store", credentials: "same-origin" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Không tải được lịch sử thao tác admin."));
      if (request !== requestRef.current) return;
      const result = body as AdminHistoryResponse;
      setEntries((current) => offset ? [...current, ...result.data.filter((entry) => !current.some((loaded) => loaded.id === entry.id))] : result.data);
      setTotal(result.meta.total);
      if (result.meta.actions) setActionOptions(result.meta.actions);
    } catch (reason) {
      if (request === requestRef.current) setError(reason instanceof Error ? reason.message : "Không tải được lịch sử thao tác admin.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [range, actors, actions, query]);

  useEffect(() => { void loadPage(0); }, [loadPage]);

  // People who acted but are no longer active recipients stay selectable.
  const actorPeople = useMemo(() => {
    const known = new Map(people.map((person) => [person.id, person]));
    for (const entry of entries) if (entry.actorUserId && !known.has(entry.actorUserId)) known.set(entry.actorUserId, { id: entry.actorUserId, name: entry.actorDisplayName ?? entry.actorUserId });
    return [...known.values()];
  }, [people, entries]);
  const activeCount = [Boolean(search.trim()), Boolean(range.from || range.to), actors.length > 0, actions.length > 0].filter(Boolean).length;
  const reset = () => { setSearch(""); setQuery(""); setRange(ALL_TIME); setActors([]); setActions([]); };

  return <AdminHistoryPanel
    entries={entries}
    total={total}
    loading={loading}
    onRefresh={() => void loadPage(0)}
    scope="all"
    onResetFilters={activeCount ? reset : undefined}
    filters={<>
      <FilterBar onReset={activeCount ? reset : undefined} activeCount={activeCount}>
        <FilterField label="Tìm kiếm" className="min-w-[220px] flex-1"><SearchFilter className="" value={search} onChange={setSearch} placeholder="Thao tác, người thực hiện, project, milestone..." ariaLabel="Tìm trong lịch sử" /></FilterField>
        <FilterField label="Thời điểm"><DateRangeFilter value={range} onChange={(next) => setRange(next)} ariaLabel="Lọc theo thời điểm thao tác" /></FilterField>
        <PersonFilter label="Người thực hiện" people={actorPeople} values={actors} onChange={setActors} allLabel="Tất cả mọi người" />
        <MultiSelectFilter label="Loại thao tác" options={actionOptions} values={actions} onChange={setActions} allLabel="Tất cả thao tác" />
      </FilterBar>
      {error ? <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">{error}</p> : null}
    </>}
    footer={entries.length < total ? <div className="border-t border-border px-5 py-4 text-center"><button type="button" disabled={loading} onClick={() => void loadPage(entries.length)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loading ? "Đang tải…" : `Tải thêm (${entries.length}/${total})`}</button></div> : null}
  />;
}

function AdminHistoryPanel({ entries, loading, onRefresh, scope, filters, total, footer, onResetFilters }: { entries: HistoryEntries; loading: boolean; onRefresh: () => void; scope: "all" | "mine"; filters?: ReactNode; total?: number; footer?: ReactNode; onResetFilters?: () => void }) {
  const isMine = scope === "mine";
  return <section aria-labelledby={isMine ? "admin-approval-history-title" : "admin-history-title"} className="grid gap-5">
    <section className="rounded-3xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 rounded-t-3xl border-b border-border bg-slate-50/70 px-5 py-4">
        <div><h2 id={isMine ? "admin-approval-history-title" : "admin-history-title"} className="!text-base !font-bold text-slate-950">{isMine ? "Các milestone tôi đã duyệt" : "Các hoạt động gần đây"}</h2><p className="mt-1 text-xs text-slate-500">{isMine ? "Log này không bao gồm các thao tác cấu hình khác." : "Chỉ hiển thị các sự kiện quản trị quan trọng, không lưu thao tác xem hoặc lọc dữ liệu."}</p></div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">{total !== undefined && total > entries.length ? `${entries.length}/${total}` : entries.length} bản ghi</span>
          <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</button>
        </div>
      </div>
      {filters ? <div className="border-b border-border px-5 py-4">{filters}</div> : null}
      {loading && !entries.length ? <div className="p-10 text-center text-sm text-slate-500">Đang tải lịch sử…</div> : null}
      {!loading && !entries.length && onResetFilters ? <FilterEmpty onReset={onResetFilters} /> : null}
      {!loading && !entries.length && !onResetFilters ? <div className="p-12 text-center"><Clock3 className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-900">Chưa có lịch sử</p><p className="mt-1 text-xs text-slate-500">Các thao tác phù hợp sẽ xuất hiện tại đây.</p></div> : null}
      {entries.length ? <ol className="divide-y divide-border">{entries.map((entry) => <li key={entry.id} className="flex gap-3 px-5 py-4 sm:px-6">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${historyIconTone(entry.category)}`}>{historyIcon(entry.category)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold text-slate-900">{entry.title}</p><time dateTime={entry.createdAt} className="text-[11px] font-medium text-slate-400">{new Date(entry.createdAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</time></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600"><span className="font-semibold text-slate-800">{entry.actorDisplayName ?? "Hệ thống"}</span> · {entry.detail}</p>
          {entry.href ? <a href={entry.href} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Mở chi tiết</a> : null}
        </div>
      </li>)}</ol> : null}
      {footer}
    </section>
  </section>;
}

function ApprovalPanel({ approvalHistory, historyLoading, onRefreshHistory, onApproved }: { approvalHistory: AdminHistoryResponse["data"]; historyLoading: boolean; onRefreshHistory: () => void; onApproved?: () => void }) {
  const [rows, setRows] = useState<AdminApprovalsResponse["data"]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingForMe = rows.filter((row) => row.canApprove).length;
  const waitingForOtherReviewer = rows.length - pendingForMe;
  const [search, setSearch] = useState("");
  const [sentRange, setSentRange] = useState<DateRange>(ALL_TIME);
  const [requesters, setRequesters] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [rights, setRights] = useState<string[]>([]);
  // The queue carries the requester as a label only, so the label is the person's key.
  const requesterPeople = useMemo(() => [...new Set(rows.map((row) => row.requesterLabel))].sort((a, b) => a.localeCompare(b, "vi")).map((name) => ({ id: name, name })), [rows]);
  const projectOptions = useMemo(() => [...new Map(rows.map((row) => [row.project.id, `${row.project.code} · ${row.project.name}`]))].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "vi")), [rows]);
  const visibleRows = rows.filter((row) => matchesSearch(search, row.project.name, row.project.code, row.milestone.name, row.requesterLabel, row.reviewerLabel)
    && isWithinRange(dayOf(row.pendingSince), sentRange)
    && matchesAny(requesters, row.requesterLabel)
    && matchesAny(projectIds, row.project.id)
    && matchesAny(rights, row.canApprove ? "mine" : "other"));
  const activeFilterCount = [Boolean(search.trim()), Boolean(sentRange.from || sentRange.to), requesters.length > 0, projectIds.length > 0, rights.length > 0].filter(Boolean).length;
  const resetFilters = () => { setSearch(""); setSentRange(ALL_TIME); setRequesters([]); setProjectIds([]); setRights([]); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/approvals", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json().catch(() => null) as AdminApprovalsResponse | { message?: string } | null;
      if (!response.ok) throw new Error((body as { message?: string } | null)?.message || "Không tải được hàng chờ approval.");
      setRows((body as AdminApprovalsResponse).data ?? []);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được hàng chờ approval.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = async (row: AdminApprovalsResponse["data"][number]) => {
    setActionId(row.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(row.project.id)}/milestones/${encodeURIComponent(row.milestone.id)}/approve`, { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Không thể duyệt milestone."));
      setNotice(`Đã duyệt ${row.milestone.name} của ${row.project.name}.`);
      await load();
      onApproved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể duyệt milestone.");
    } finally {
      setActionId(null);
    }
  };

  return (
    <section aria-label="Hồ sơ chờ duyệt" className="grid gap-5">
      <section aria-label="Approval summary" className="grid gap-px overflow-hidden rounded-3xl border border-border bg-border shadow-sm sm:grid-cols-2">
        <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="Bạn có thể duyệt" value={pendingForMe} tone="sky" />
        <Metric icon={<ShieldAlert className="h-4 w-4" />} label="Chờ người khác" value={waitingForOtherReviewer} tone="indigo" />
      </section>

      {error ? <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
      {notice ? <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}

      <section aria-labelledby="admin-approval-queue-title" className="rounded-3xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-2 rounded-t-3xl border-b border-border bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 id="admin-approval-queue-title" className="!text-base !font-bold text-slate-950">Danh sách yêu cầu</h2>
            <p className="mt-1 text-xs text-slate-500">Mỗi hồ sơ cho biết project, milestone, người gửi, người duyệt và quyền xử lý hiện tại.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{visibleRows.length < rows.length ? `${visibleRows.length}/${rows.length}` : rows.length} đang chờ</span>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</button>
          </div>
        </div>

        {rows.length ? <FilterBar className="border-b border-border px-5 py-4 sm:px-6" onReset={activeFilterCount ? resetFilters : undefined} activeCount={activeFilterCount}>
          <FilterField label="Tìm kiếm" className="min-w-[220px] flex-1"><SearchFilter className="" value={search} onChange={setSearch} placeholder="Project, milestone, người gửi, người duyệt..." ariaLabel="Tìm hồ sơ chờ duyệt" /></FilterField>
          <FilterField label="Ngày gửi yêu cầu"><DateRangeFilter value={sentRange} onChange={(next) => setSentRange(next)} ariaLabel="Lọc theo ngày gửi yêu cầu" /></FilterField>
          <PersonFilter label="Người yêu cầu" people={requesterPeople} values={requesters} onChange={setRequesters} allLabel="Tất cả người yêu cầu" searchPlaceholder="Tìm theo tên..." />
          <MultiSelectFilter label="Dự án" options={projectOptions} values={projectIds} onChange={setProjectIds} allLabel="Tất cả dự án" />
          <MultiSelectFilter label="Trạng thái" options={[{ value: "mine", label: "Bạn có thể duyệt" }, { value: "other", label: "Chờ người khác duyệt" }]} values={rights} onChange={setRights} allLabel="Tất cả trạng thái" searchable={false} />
        </FilterBar> : null}
        {rows.length && !visibleRows.length ? <FilterEmpty onReset={resetFilters} /> : null}
        {loading && !rows.length ? <div className="space-y-3 p-5" aria-busy="true" aria-label="Đang tải hàng chờ duyệt"><div className="h-24 animate-pulse rounded-2xl bg-slate-100" /><div className="h-24 animate-pulse rounded-2xl bg-slate-100" /></div> : null}
        {!loading && !rows.length ? <div className="p-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></span><p className="mt-4 text-sm font-bold text-slate-900">Không còn hồ sơ chờ duyệt</p><p className="mt-1 text-xs text-slate-500">Khi user gửi yêu cầu, hồ sơ sẽ xuất hiện tại đây.</p></div> : null}
        {visibleRows.length ? <div className="divide-y divide-border">
          {visibleRows.map((row) => <article key={row.id} className="grid min-w-0 gap-5 p-5 transition-colors hover:bg-slate-50/60 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.8fr)_auto] lg:items-center lg:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Clock3 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Chờ duyệt</span><span className="text-xs font-semibold text-slate-500">{row.project.code}</span></div>
                <h4 className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-slate-950">{row.project.name} <span className="font-medium text-slate-500">· {row.milestone.name}</span></h4>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span><strong className="font-semibold text-slate-700">Gửi bởi:</strong> {row.requesterLabel}</span><span><Clock3 className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]" />{new Date(row.pendingSince).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</span></div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-slate-50/70 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Người duyệt</p>
              <p className="mt-1 truncate text-sm font-bold text-slate-900" title={row.reviewerLabel}>{row.reviewerLabel}</p>
              <span className={`mt-2 inline-flex items-center rounded-full px-2 py-1 text-[10px] font-bold ${row.canApprove ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{row.canApprove ? "Bạn có thể duyệt" : "Chờ người được chỉ định"}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <a href={row.project.href} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><ExternalLink className="h-3.5 w-3.5" /> Mở project</a>
              <button type="button" disabled={!row.canApprove || actionId === row.id} onClick={() => void approve(row)} title={row.canApprove ? "Duyệt milestone và mở bước kế tiếp" : "Bạn không phải người duyệt hồ sơ này"} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{actionId === row.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{row.canApprove ? "Duyệt & chuyển" : "Không thuộc quyền"}</button>
            </div>
          </article>)}
        </div> : null}
      </section>
      <AdminHistoryPanel entries={approvalHistory} loading={historyLoading} onRefresh={onRefreshHistory} scope="mine" />
    </section>
  );
}

function OverviewPanel({ overview, loading, onRefresh }: { overview: AdminOverviewResponse["data"] | null; loading: boolean; onRefresh: () => void }) {
  const alerts = overview?.alerts ?? [];
  const actionAlerts = alerts.filter((alert) => alert.severity !== "info");
  return <section aria-label="Tổng quan vận hành" className="grid gap-4">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
      <section aria-labelledby="admin-alerts-title" className="rounded-xl border border-border bg-card"><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5"><div><h2 id="admin-alerts-title" className="!text-sm !font-bold text-slate-950">Cảnh báo cần xử lý</h2><p className="mt-1 text-xs text-slate-500">Chỉ hiện các vấn đề cần admin xem lại.</p></div><div className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${actionAlerts.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{actionAlerts.length ? `${actionAlerts.length} cần xử lý` : "Đang ổn định"}</span><button type="button" onClick={onRefresh} className="inline-flex min-h-9 items-center justify-center gap-2 self-start rounded-lg border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Làm mới</button></div></div><div className="divide-y divide-border">{alerts.map((alert) => { const tone = alertTone(alert.severity); return <a key={alert.id} href={alert.href ?? "#"} className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>{alert.severity === "info" ? <Info className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className={`block text-sm font-bold ${tone.title}`}>{alert.title}</span><span className="mt-1 block text-xs leading-relaxed text-slate-600">{alert.detail}</span></span><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" /></a>; })}{loading && !overview ? <div className="px-4 py-8 text-sm text-muted-foreground">Đang tải cảnh báo…</div> : null}{!loading && !alerts.length ? <div className="px-4 py-8 text-sm text-slate-500">Không có cảnh báo mới.</div> : null}</div></section>
      <section aria-label="Admin metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border"><Metric icon={<LockKeyhole className="h-4 w-4" />} label="Ngày off đã khóa" value={overview?.metrics.activeDayOffs} tone="amber" /><Metric icon={<CalendarClock className="h-4 w-4" />} label="Ngày off sắp tới" value={overview?.metrics.upcomingDayOffs} tone="sky" /><Metric icon={<TriangleAlert className="h-4 w-4" />} label="Task quá hạn" value={overview?.metrics.overdueTasks} tone="rose" /><Metric icon={<TimerReset className="h-4 w-4" />} label="Task đang mở" value={overview?.metrics.openTasks} tone="indigo" /></section>
    </div>
  </section>;
}

const ALERT_TYPE_LABELS: Record<AdminAlertType, string> = {
  delay_risk: "Có nguy cơ chậm tiến độ",
  over_estimate: "Vượt giờ kế hoạch",
  waiting_task: "Task đang chờ",
  missing_estimate: "Thiếu giờ kế hoạch",
  missing_actual: "Thiếu giờ thực tế",
  missing_deadline: "Thiếu Deadline",
  missing_mapping: "Thiếu người phụ trách"
};

function formatAlertHours(minutes: number) {
  return `${(minutes / 60).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}

function alertBadgeClass(row: AdminAlertDetailRow) {
  if (row.type === "over_estimate") return "bg-rose-50 text-rose-700";
  if (row.type === "delay_risk" || row.type === "waiting_task") return "bg-amber-50 text-amber-700";
  return "bg-sky-50 text-sky-700";
}

function AlertsPanel({ rows, loading, onRefresh }: { rows: AdminAlertDetailRow[]; loading: boolean; onRefresh: () => void }) {
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const filtered = rows.filter((row) => matchesAny(typeFilter, row.type) && matchesAny(severityFilter, row.severity) && matchesSearch(search, row.project.name, row.project.code, row.detail));
  const activeFilterCount = [Boolean(search.trim()), typeFilter.length > 0, severityFilter.length > 0].filter(Boolean).length;
  const resetFilters = () => { setSearch(""); setTypeFilter([]); setSeverityFilter([]); };
  const critical = rows.filter((row) => row.severity === "critical").length;
  const warning = rows.filter((row) => row.severity === "warning").length;
  const affectedTasks = rows.reduce((sum, row) => sum + row.affectedTaskCount, 0);
  return <section aria-label="Chi tiết cảnh báo" className="grid gap-5">
    <section aria-label="Alert summary" className="grid gap-3 sm:grid-cols-2"><Metric icon={<ShieldAlert className="h-4 w-4" />} label="Cần xử lý ngay" value={critical + warning} tone="rose" /><Metric icon={<TimerReset className="h-4 w-4" />} label="Task liên quan" value={affectedTasks} tone="indigo" /></section>
    <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"><FilterBar onReset={activeFilterCount ? resetFilters : undefined} activeCount={activeFilterCount} actions={<button type="button" onClick={onRefresh} className="inline-flex h-10 items-center justify-center gap-2 shrink-0 rounded-[10px] border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Làm mới dữ liệu</button>}><FilterField label="Tìm kiếm" className="min-w-[220px] flex-1"><SearchFilter className="" value={search} onChange={setSearch} placeholder="Project, mã project hoặc nguyên nhân..." ariaLabel="Tìm cảnh báo chất lượng dữ liệu" /></FilterField><MultiSelectFilter label="Loại cảnh báo" options={Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} values={typeFilter} onChange={setTypeFilter} allLabel="Tất cả loại cảnh báo" /><MultiSelectFilter label="Mức độ" options={[{ value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} values={severityFilter} onChange={setSeverityFilter} allLabel="Tất cả mức độ" searchable={false} /></FilterBar><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Hiển thị {filtered.length}/{rows.length} cảnh báo</span><span>{new Date().toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</span></div></section>
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="flex flex-col gap-1 border-b border-border bg-gradient-to-r from-amber-50 via-white to-sky-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h3 className="text-base font-bold text-slate-950">Giờ kế hoạch và giờ thực tế</h3><p className="mt-1 text-xs text-slate-500">Mỗi dòng là một nguyên nhân cảnh báo độc lập; một project có thể xuất hiện nhiều dòng.</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-bold">Project</th><th className="px-4 py-3 text-right font-bold">Giờ kế hoạch</th><th className="px-4 py-3 text-right font-bold">Giờ thực tế</th><th className="px-4 py-3 text-right font-bold">Chênh lệch</th><th className="px-4 py-3 font-bold">Cảnh báo</th><th className="px-5 py-3 font-bold">Chi tiết cần xử lý</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{filtered.map((row) => <tr key={row.id} className="align-top transition hover:bg-slate-50/80"><td className="px-5 py-4"><a href={row.href} className="group block min-w-[220px]"><span className="block font-bold text-slate-900 group-hover:text-primary">{row.project.name}</span><span className="mt-1 block text-xs font-medium text-slate-500">{row.project.code}</span></a></td><td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">{formatAlertHours(row.estimateMinutes)}</td><td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">{formatAlertHours(row.actualMinutes)}</td><td className={`px-4 py-4 text-right font-bold tabular-nums ${row.varianceMinutes > 0 ? "text-rose-600" : "text-slate-500"}`}>{row.varianceMinutes > 0 ? "+" : ""}{formatAlertHours(row.varianceMinutes)}</td><td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${alertBadgeClass(row)}`}>{ALERT_TYPE_LABELS[row.type]}</span><span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.severity}</span></td><td className="max-w-[390px] px-5 py-4 text-xs leading-relaxed text-slate-600">{row.detail}<span className="mt-1 block font-semibold text-slate-400">{row.affectedTaskCount} task liên quan</span></td><td className="px-4 py-4"><a aria-label={`Mở project ${row.project.name}`} href={row.href} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ExternalLink className="h-3.5 w-3.5" /></a></td></tr>)}{loading && !rows.length ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">Đang tổng hợp cảnh báo từ task và time entry…</td></tr> : null}{!loading && !filtered.length ? <tr><td colSpan={7}>{activeFilterCount ? <FilterEmpty onReset={resetFilters} /> : <p className="px-5 py-12 text-center text-sm text-slate-500">Không có cảnh báo.</p>}</td></tr> : null}</tbody></table></div></section>
    <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs leading-relaxed text-sky-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> “Thiếu dữ liệu” chỉ là tín hiệu cần bổ sung record; hệ thống không tự kết luận hiệu suất khi chưa đủ giờ kế hoạch, giờ thực tế hoặc deadline.</div>
  </section>;
}

function LegacyReminderPolicyPanel({ policy, saving, onSave, onUpdateSlot, onSetPolicy }: { policy: WorkspaceReminderPolicy | null; saving: boolean; onSave: () => void; onUpdateSlot: (code: WorkspaceReminderSlotCode, patch: Partial<WorkspaceReminderSlot>) => void; onSetPolicy: React.Dispatch<React.SetStateAction<WorkspaceReminderPolicy | null>> }) {
  return <section aria-labelledby="reminder-policy-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-gradient-to-r from-violet-50 via-white to-sky-50 px-5 py-5 sm:px-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><BellRing className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">LARK NOTIFICATIONS</p><h2 id="reminder-policy-title" className="mt-1 text-xl font-bold text-slate-950">Lịch nhắc vận hành</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Chỉ gửi khi phát hiện thiếu kế hoạch hoặc giờ thực tế. Ngày off được bỏ qua tự động.</p></div></div>{policy ? <button disabled={saving} type="button" onClick={onSave} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : "Lưu thay đổi"}</button> : null}</div></div>{policy ? <div className="p-5 sm:p-7"><div className="flex flex-col gap-3 rounded-2xl border border-border bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${policy.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}><BellRing className="h-4 w-4" /></div><div><p className="text-sm font-bold text-slate-900">Kích hoạt nhắc Lark</p><p className="mt-0.5 text-xs text-slate-500">{formatUpdatedAt(policy.updatedAt)} · múi giờ {policy.timezone}</p></div></div><Toggle checked={policy.enabled} onChange={(checked) => onSetPolicy((current) => current ? { ...current, enabled: checked } : current)} label={policy.enabled ? "Đang bật" : "Đang tắt"} /></div><div className="mt-4 grid gap-3 md:grid-cols-3">{policy.slots.map((slot) => <div key={slot.slot} className={`rounded-2xl border p-4 transition ${slot.enabled && policy.enabled ? "border-violet-200 bg-violet-50/40" : "border-border bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">{slotLabel(slot)}</p><p className="mt-1 text-xs leading-relaxed text-slate-500">{slot.slot === "morning_plan" ? "Kiểm tra kế hoạch và trường dữ liệu task." : slot.slot === "pm_follow_up" ? "Nhắc lại các việc chưa được cập nhật." : "Đối soát giờ thực tế cuối ngày."}</p></div><Toggle checked={slot.enabled} onChange={(checked) => onUpdateSlot(slot.slot, { enabled: checked })} label={slot.enabled ? "Bật" : "Tắt"} compact /></div><label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-500"><Clock3 className="h-4 w-4" /> Giờ gửi<input type="time" value={slot.time} onChange={(event) => onUpdateSlot(slot.slot, { time: event.target.value })} className="ml-auto h-9 rounded-lg border border-border bg-white px-2 text-sm font-bold text-slate-900" /></label></div>)}</div><label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={policy.weekdaysOnly} onChange={(event) => onSetPolicy((current) => current ? { ...current, weekdaysOnly: event.target.checked } : current)} className="h-4 w-4 rounded border-border text-primary" /> Chỉ gửi vào ngày làm việc (Thứ 2–Thứ 6, bỏ qua ngày off)</label><div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-xs leading-relaxed text-sky-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Secret webhook chỉ nằm ở worker/server. Mốc mặc định: 08:30, 14:00 và 17:00.</div></div> : <div className="p-7 text-sm text-muted-foreground">Đang tải cấu hình lịch nhắc…</div>}</section>;
}

function ReminderPolicyPanel({
  policy,
  saving,
  sending,
  recipients,
  onSave,
  onSendManual,
  onUpdateSlot,
  onSetPolicy
}: {
  policy: WorkspaceReminderPolicy | null;
  saving: boolean;
  sending: boolean;
  recipients: WorkspaceReminderRecipientsResponse["data"];
  onSave: () => void;
  onSendManual: (input: SendWorkspaceReminderInput) => void;
  onUpdateSlot: (code: WorkspaceReminderSlotCode, patch: Partial<WorkspaceReminderSlot>) => void;
  onSetPolicy: React.Dispatch<React.SetStateAction<WorkspaceReminderPolicy | null>>;
}) {
  const [scope, setScope] = useState<"all" | "user" | "team">("all");
  const [userId, setUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [localDate, setLocalDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }));
  const [slot, setSlot] = useState<WorkspaceReminderSlotCode>("morning_plan");
  const selectedSlot = policy?.slots.find((candidate) => candidate.slot === slot);
  const recipientOptions = reminderRecipientOptions(recipients.users);

  const submitManual = () => {
    onSendManual({ localDate, slot, ...(scope === "user" && userId ? { userId } : {}), ...(scope === "team" && teamId ? { teamId } : {}) });
  };

  return <>
    <LegacyReminderPolicyPanel policy={policy} saving={saving} onSave={onSave} onUpdateSlot={onUpdateSlot} onSetPolicy={onSetPolicy} />
    <section aria-labelledby="manual-reminder-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-gradient-to-r from-slate-50 via-white to-violet-50 px-5 py-5 sm:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">MANUAL DELIVERY</p><h2 id="manual-reminder-title" className="mt-1 text-xl font-bold text-slate-950">Gửi nhắc Lark thủ công</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Chọn người nhận, team, ngày và mốc giờ. Secret webhook chỉ được gọi từ server.</p></div>
          <span className="inline-flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700"><Send className="h-4 w-4" /> Admin only</span>
        </div>
      </div>
      <div className="p-5 sm:p-7">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <CrmSelect label={<span className="mb-1.5 block text-xs font-semibold text-slate-600">Phạm vi người nhận</span>} options={[{ value: "all", label: "Tất cả người đang active" }, { value: "user", label: "Một người" }, { value: "team", label: "Một team" }]} value={scope} onChange={(value) => { const next = value as typeof scope; setScope(next); setUserId(""); setTeamId(""); }} />
          {scope === "user" ? <div><span className="mb-1.5 block text-xs font-semibold text-slate-600">Người nhận</span><CustomDropdown label={null} value={userId} onChange={setUserId} options={[{ value: "", label: "Chọn người nhận…" }, ...recipientOptions]} /></div> : null}
          {scope === "team" ? <div><span className="mb-1.5 block text-xs font-semibold text-slate-600">Team nhận</span><CrmSelect options={[{ value: "", label: "Chọn team…" }, ...recipients.teams.map((team) => ({ value: team.id, label: `${team.name} (${team.memberCount})` }))]} value={teamId} onChange={setTeamId} /></div> : null}
          <label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Ngày gửi</span><input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700" /></label>
          <div><span className="mb-1.5 block text-xs font-semibold text-slate-600">Mốc giờ</span><CrmSelect options={(policy?.slots ?? []).map((candidate) => ({ value: candidate.slot, label: `${slotLabel(candidate)} · ${candidate.time}` }))} value={slot} onChange={(value) => setSlot(value as WorkspaceReminderSlotCode)} /></div>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,430px)] xl:items-start">
          <div className="flex flex-col gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs leading-relaxed text-violet-900"><strong>{selectedSlot?.label ?? "Mốc nhắc"}</strong><span className="mx-1.5">·</span>{localDate || "Chưa chọn ngày"}<span className="mx-1.5">·</span>{scope === "all" ? `${recipients.users.length} người active` : scope === "user" ? (recipients.users.find((user) => user.id === userId)?.displayName || "Chưa chọn người") : (recipients.teams.find((team) => team.id === teamId)?.name || "Chưa chọn team")}</div><button type="button" disabled={sending || !localDate || (scope === "user" && !userId) || (scope === "team" && !teamId)} onClick={submitManual} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />{sending ? "Đang gửi…" : "Gửi ngay"}</button></div>
          <LarkReminderCardPreview slot={slot} localDate={localDate} time={selectedSlot?.time ?? "08:30"} recipientLabel={scope === "all" ? `${recipients.users.length} người active` : scope === "user" ? (recipients.users.find((user) => user.id === userId)?.displayName || "người nhận đã chọn") : (recipients.teams.find((team) => team.id === teamId)?.name || "team đã chọn")} />
        </div>
      </div>
    </section>
  </>;
}

function LarkReminderCardPreview({ slot, localDate, time, recipientLabel }: { slot: WorkspaceReminderSlotCode; localDate: string; time: string; recipientLabel: string }) {
  const content = slot === "morning_plan"
    ? { tone: "border-sky-400", wash: "bg-sky-50", title: "Nhắc nhở hoàn tất kế hoạch Task trước 09:00", action: "Cập nhật kế hoạch Task" }
    : slot === "pm_follow_up"
      ? { tone: "border-amber-400", wash: "bg-amber-50", title: "Danh sách nhân sự chưa hoàn tất kế hoạch Task", action: "Xem Timesheet" }
      : { tone: "border-rose-400", wash: "bg-rose-50", title: "Cập nhật giờ thực tế hôm nay", action: "Mở Timesheet hôm nay" };

  return <aside aria-label="Bản xem trước card Lark" className="rounded-2xl border border-border bg-slate-50/70 p-3">
    <div className="flex items-center justify-between gap-3 px-1 pb-2"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">LARK CARD PREVIEW</p><p className="mt-1 text-xs text-slate-500">Nội dung theo EV-060, thay dữ liệu thật khi gửi</p></div><span className="rounded-full border border-border bg-white px-2 py-1 text-[10px] font-bold text-slate-500">{time}</span></div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`border-l-4 ${content.tone} ${content.wash} px-4 py-3`}><p className="text-sm font-bold text-slate-950">{content.title}</p><p className="mt-1 text-[11px] text-slate-500">Ngày {localDate || "chưa chọn"} · gửi tới {recipientLabel}</p></div>
      <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-slate-700">
        {slot === "morning_plan" ? <><p>Chào <strong>{"{{employee_name}}"}</strong>,</p><p>Đến 08:30 ngày <strong>{"{{work_date}}"}</strong>, kế hoạch Task của các Project <strong>{"{{active_projects}}"}</strong> hôm nay của bạn chưa đầy đủ.</p><p>Nội dung cần bổ sung:</p><div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">• Nếu chưa có Task: “Bạn chưa lập Task cho ngày hôm nay.”<br />• Nếu Task thiếu dữ liệu: “{"{{task_name}}"} — còn thiếu: {"{{missing_fields}}"}.”</div><p>Vui lòng hoàn tất kế hoạch Task trước 09:00 hôm nay để bảo đảm dữ liệu kế hoạch được ghi nhận đầy đủ.</p></> : null}
        {slot === "pm_follow_up" ? <><p>Chào <strong>{"{{pm_name}}"}</strong>,</p><p>Đến 14:00 ngày <strong>{"{{work_date}}"}</strong>, có <strong>{"{{incomplete_employee_count}}"}</strong> nhân sự thuộc phạm vi phụ trách của bạn chưa hoàn tất kế hoạch Task.</p><p>Danh sách cần theo dõi:</p><div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2"><div><strong>1. {"{{employee_name}}"}</strong><br /><span className="text-[11px] text-slate-500">• Trạng thái: {"{{missing_status}}"}<br />• Task liên quan: {"{{task_name_or_no_tasks}}"}<br />• Nội dung còn thiếu: {"{{missing_fields}}"}<br />• Lần nhắc tự động: 08:30</span></div><span className="flex gap-1"><button type="button" disabled className="rounded-md border border-violet-200 px-2 py-1 text-[10px] font-bold text-violet-700">Gửi nhắc</button><button type="button" disabled className="rounded-md border border-border px-2 py-1 text-[10px] font-bold text-slate-600">Xem Timesheet</button></span></div><p>Vui lòng kiểm tra và nhắc nhân sự hoàn tất dữ liệu trong ngày.</p></> : null}
        {slot === "evening_actual" ? <><p>Chào <strong>{"{{employee_name}}"}</strong>,</p><p>Đến 17:00 ngày <strong>{"{{work_date}}"}</strong>, dữ liệu giờ thực tế của bạn chưa đầy đủ.</p><p>Tổng giờ trong ngày:</p><div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">• Đã ghi nhận: <strong>{"{{actual_hour_total}}"} giờ</strong><br />• Giờ tiêu chuẩn: <strong>8 giờ</strong><br />• Còn thiếu: <strong>{"{{remaining_hour}}"} giờ</strong></div><p>Task chưa có giờ thực tế:</p><div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">1. {"{{task_name_1}}"}<br />— Giờ kế hoạch: {"{{estimate_hour_1}}"} giờ<br />2. {"{{task_name_2}}"}<br />— Giờ kế hoạch: {"{{estimate_hour_2}}"} giờ<br />{"{{repeat_for_each_missing_task}}"}</div><p>Vui lòng ghi giờ thực tế đã làm trong ngày. Không tự động dùng giờ kế hoạch thay cho giờ thực tế; chuyển Task sang Hoàn tất cũng không thay thế việc ghi giờ. Trường hợp có OT, số giờ vượt 8 giờ chỉ được ghi nhận theo quy tắc đã được phê duyệt.</p></> : null}
        {slot !== "pm_follow_up" ? <button type="button" disabled className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white opacity-90"><Send className="h-3.5 w-3.5" />{content.action}</button> : null}
        <p className="flex items-start gap-1.5 text-[10px] text-slate-400"><Info className="mt-0.5 h-3 w-3 shrink-0" />Bản xem trước không gửi tin nhắn. Worker sẽ loại trừ Day-off/ngày lễ và ghi nhật ký gửi.</p>
      </div>
    </div>
  </aside>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value?: number; tone: "amber" | "sky" | "rose" | "indigo" }) {
  const colors = { amber: "bg-amber-100 text-amber-700", sky: "bg-sky-100 text-sky-700", rose: "bg-rose-100 text-rose-700", indigo: "bg-indigo-100 text-indigo-700" };
  return <div className="bg-card p-4"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[tone]}`}>{icon}</span><div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 text-2xl font-black tabular-nums text-slate-950">{typeof value === "number" ? value : "—"}</p></div></div></div>;
}

function Toggle({ checked, onChange, label, compact = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; compact?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`inline-flex items-center gap-2 ${compact ? "text-xs" : "text-sm"} font-semibold ${checked ? "text-emerald-700" : "text-slate-500"}`}><span className={`relative inline-flex ${compact ? "h-5 w-9" : "h-6 w-11"} items-center rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`}><span className={`absolute ${compact ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} rounded-full bg-white shadow transition ${checked ? (compact ? "translate-x-4" : "translate-x-6") : "translate-x-1"}`} /></span>{label}</button>;
}
