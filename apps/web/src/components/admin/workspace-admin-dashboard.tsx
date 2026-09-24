"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  Filter,
  LockKeyhole,
  RefreshCw,
  Save,
  Send,
  Search,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  TriangleAlert
} from "lucide-react";
import type {
  AdminAlertDetailRow,
  AdminAlertType,
  AdminAlertsResponse,
  AdminOverviewResponse,
  CreateProjectMilestoneInput,
  CreateProjectMilestoneTemplateInput,
  ProjectMilestoneTemplateSummary,
  ProjectMilestoneSummary,
  ProjectSummary,
  SendWorkspaceReminderInput,
  WorkspaceReminderRecipientsResponse,
  UpdateWorkspaceReminderPolicyInput,
  UpdateProjectMilestoneTemplateInput,
  WorkspaceReminderPolicy,
  WorkspaceReminderSlot,
  WorkspaceReminderSlotCode
} from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { WorkspaceDayOffSettings } from "@/components/settings/workspace-day-off-settings";
import { useAuth } from "@/lib/auth";

const ADMIN_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);
type AdminSection = "overview" | "alerts" | "day-offs" | "reminders" | "milestones";

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
  return slot.label || ({ morning_plan: "Kế hoạch đầu ngày", pm_follow_up: "Nhắc lại cho PM", evening_actual: "Actual Hour cuối ngày" } as Record<WorkspaceReminderSlotCode, string>)[slot.slot];
}

export function WorkspaceAdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = Boolean(user?.roleCodes?.some((role) => ADMIN_ROLES.has(role)));
  const [overview, setOverview] = useState<AdminOverviewResponse["data"] | null>(null);
  const [policy, setPolicy] = useState<WorkspaceReminderPolicy | null>(null);
  const [reminderRecipients, setReminderRecipients] = useState<WorkspaceReminderRecipientsResponse["data"]>({ users: [], teams: [] });
  const [alertDetails, setAlertDetails] = useState<AdminAlertDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<AdminSection>("overview");
  const [projectOptions, setProjectOptions] = useState<ProjectSummary[]>([]);
  const [milestoneGates, setMilestoneGates] = useState<ProjectMilestoneSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestonesSaving, setMilestonesSaving] = useState(false);
  const [milestoneTemplates, setMilestoneTemplates] = useState<ProjectMilestoneTemplateSummary[]>([]);
  const [milestoneTemplatesLoading, setMilestoneTemplatesLoading] = useState(false);
  const [milestoneTemplatesSaving, setMilestoneTemplatesSaving] = useState(false);
  const [milestoneView, setMilestoneView] = useState<"templates" | "project-gates">("templates");

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setMilestoneTemplatesLoading(true);
    setError(null);
    try {
      const [overviewResponse, policyResponse, alertsResponse, recipientsResponse, projectsResponse, templatesResponse] = await Promise.all([
        fetch("/api/admin/overview", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/reminders", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/alerts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/reminders/recipients", { cache: "no-store", credentials: "same-origin" }),
        // Keep the local admin screen usable before an auth session is created.
        // The BFF ignores this fallback when a real Lark session is present.
        fetch("/api/projects?limit=100&offset=0&principal=founder", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/milestone-templates?principal=founder", { cache: "no-store", credentials: "same-origin" })
      ]);
      const overviewBody = await overviewResponse.json().catch(() => null);
      const policyBody = await policyResponse.json().catch(() => null);
      const alertsBody = await alertsResponse.json().catch(() => null);
      const recipientsBody = await recipientsResponse.json().catch(() => null);
      const templatesBody = await templatesResponse.json().catch(() => null);
      const projectsBody = await projectsResponse.json().catch(() => null);
      if (!overviewResponse.ok) throw new Error(errorMessage(overviewBody, "Không tải được tổng quan admin."));
      if (!policyResponse.ok) throw new Error(errorMessage(policyBody, "Không tải được lịch nhắc Lark."));
      if (!alertsResponse.ok) throw new Error(errorMessage(alertsBody, "Không tải được chi tiết cảnh báo."));
      if (!recipientsResponse.ok) throw new Error(errorMessage(recipientsBody, "Không tải được danh sách người nhận nhắc Lark."));
      if (!templatesResponse.ok) throw new Error(errorMessage(templatesBody, "Không tải được danh sách template milestone."));
      setOverview((overviewBody as AdminOverviewResponse).data);
      setPolicy((policyBody as { data: WorkspaceReminderPolicy }).data);
      setAlertDetails((alertsBody as AdminAlertsResponse).data);
      setReminderRecipients((recipientsBody as WorkspaceReminderRecipientsResponse).data);
      setMilestoneTemplates((templatesBody as { data?: ProjectMilestoneTemplateSummary[] }).data ?? []);
      if (projectsResponse.ok) {
        const projects = (projectsBody as { data?: ProjectSummary[] } | null)?.data ?? [];
        setProjectOptions(projects);
        setSelectedProjectId((current) => current || projects[0]?.id || "");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu admin.");
    } finally {
      setLoading(false);
      setMilestoneTemplatesLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "alerts" || hash === "day-offs" || hash === "reminders" || hash === "milestones") setSection(hash);
      else setSection("overview");
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    if (!isAdmin || !selectedProjectId) return;
    let cancelled = false;
    setMilestonesLoading(true);
    fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { data?: ProjectMilestoneSummary[] } | null;
        if (!response.ok) throw new Error(errorMessage(body, "Không tải được cấu hình milestone."));
        if (!cancelled) setMilestoneGates(body?.data ?? []);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Không tải được cấu hình milestone."); })
      .finally(() => { if (!cancelled) setMilestonesLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, selectedProjectId]);

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
      <AppShell activeRoute="/admin" title="Admin">
        <main className="flex flex-1 items-center justify-center p-6">
          <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><ShieldAlert className="h-7 w-7" /></div>
            <h1 className="mt-5 text-xl font-bold text-foreground">Khu vực dành cho Admin</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Bạn cần role Founder/GM hoặc Workspace Admin để xem cảnh báo, khóa ngày nghỉ và cấu hình nhắc Lark.</p>
          </section>
        </main>
      </AppShell>
    );
  }

  const alertCount = alertDetails.filter((alert) => alert.severity !== "info").length;

  return (
    <AppShell activeRoute="/admin" title="Admin workspace">
      <main className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6">
        <div className="mx-auto grid max-w-[1480px] gap-5">
          <header className="rounded-xl border border-border bg-card px-5 py-5 shadow-sm sm:px-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold text-primary">ADMIN · WORKSPACE CONTROL</p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Điều hành workspace</h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Một nơi duy nhất để xử lý cảnh báo, khóa ngày nghỉ và điều phối nhắc Lark.</p>
              </div>
              <div className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground lg:self-auto"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {overview?.workspace.name ?? "Workspace"} · {overview?.workspace.timezone ?? "Asia/Ho_Chi_Minh"}</div>
            </div>
          </header>

          <div className="sticky top-0 z-40 -mx-4 bg-background/95 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
            <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card/95 p-1 shadow-sm">
              <AdminSectionButton active={section === "overview"} icon={<LayoutDashboard className="h-4 w-4" />} label="Tổng quan" onClick={() => selectSection("overview")} />
              <AdminSectionButton active={section === "alerts"} icon={<TriangleAlert className="h-4 w-4" />} label="Cảnh báo" badge={alertDetails.length || undefined} onClick={() => selectSection("alerts")} />
              <AdminSectionButton active={section === "day-offs"} icon={<CalendarDays className="h-4 w-4" />} label="Ngày nghỉ" onClick={() => selectSection("day-offs")} />
              <AdminSectionButton active={section === "reminders"} icon={<BellRing className="h-4 w-4" />} label="Nhắc Lark" onClick={() => selectSection("reminders")} />
              <AdminSectionButton active={section === "milestones"} icon={<LockKeyhole className="h-4 w-4" />} label="Milestone" onClick={() => selectSection("milestones")} />
              {alertCount > 0 ? <span className="ml-auto hidden items-center gap-1.5 px-3 text-xs font-semibold text-amber-700 sm:inline-flex"><TriangleAlert className="h-3.5 w-3.5" /> {alertCount} cần xử lý</span> : null}
            </nav>
          </div>

          {error ? <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
          {notice ? <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}

          <div id="admin-content" className="scroll-mt-24">
            {section === "overview" ? <OverviewPanel overview={overview} loading={loading} onRefresh={() => void load()} onOpen={selectSection} /> : null}
            {section === "alerts" ? <AlertsPanel rows={alertDetails} loading={loading} onRefresh={() => void load()} /> : null}
            {section === "day-offs" ? <section aria-label="Quản lý ngày nghỉ"><WorkspaceDayOffSettings /></section> : null}
            {section === "reminders" ? <ReminderPolicyPanel policy={policy} saving={saving} sending={sending} recipients={reminderRecipients} onSave={() => void savePolicy()} onSendManual={(input) => void sendManualReminder(input)} onUpdateSlot={updateSlot} onSetPolicy={setPolicy} /> : null}
            {section === "milestones" ? <>
              <div role="tablist" aria-label="Quản lý milestone" className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1">
                <button type="button" role="tab" aria-selected={milestoneView === "templates"} onClick={() => setMilestoneView("templates")} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${milestoneView === "templates" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  Thư viện template
                </button>
                <button type="button" role="tab" aria-selected={milestoneView === "project-gates"} onClick={() => setMilestoneView("project-gates")} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${milestoneView === "project-gates" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  Cấu hình theo Project
                </button>
              </div>
              {milestoneView === "templates" ? <MilestoneTemplateManager templates={milestoneTemplates} loading={milestoneTemplatesLoading} saving={milestoneTemplatesSaving} onCreate={async (input) => {
                setMilestoneTemplatesSaving(true); setError(null);
                try {
                  const response = await fetch("/api/milestone-templates?principal=founder", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
                  const body = await response.json().catch(() => null);
                  if (!response.ok) throw new Error(errorMessage(body, "Không tạo được template milestone."));
                  const created = (body as { data: ProjectMilestoneTemplateSummary }).data;
                  setMilestoneTemplates((current) => [created, ...current]);
                  setNotice(`Đã lưu template “${created.name}”. Template này sẽ xuất hiện khi tạo Project mới.`);
                  return created;
                } catch (reason) { setError(reason instanceof Error ? reason.message : "Không tạo được template milestone."); throw reason; }
                finally { setMilestoneTemplatesSaving(false); }
              }} onUpdate={async (templateId, input) => {
                setMilestoneTemplatesSaving(true); setError(null);
                try {
                  const response = await fetch(`/api/milestone-templates/${encodeURIComponent(templateId)}?principal=founder`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
                  const body = await response.json().catch(() => null);
                  if (!response.ok) throw new Error(errorMessage(body, "Không cập nhật được template milestone."));
                  const updated = (body as { data: ProjectMilestoneTemplateSummary }).data;
                  setMilestoneTemplates((current) => current.map((template) => template.id === updated.id ? updated : template));
                  setNotice(`Đã cập nhật template “${updated.name}”.`);
                } catch (reason) { setError(reason instanceof Error ? reason.message : "Không cập nhật được template milestone."); throw reason; }
                finally { setMilestoneTemplatesSaving(false); }
              }} /> : <MilestoneGatePanel projects={projectOptions} projectId={selectedProjectId} gates={milestoneGates} loading={milestonesLoading} saving={milestonesSaving} onProjectChange={setSelectedProjectId} onSave={async (milestoneId, input) => {
              setMilestonesSaving(true); setError(null); setNotice(null);
              try {
                const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones/${encodeURIComponent(milestoneId)}/gate`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(errorMessage(body, "Không lưu được điều kiện milestone."));
                setNotice("Đã cập nhật điều kiện milestone.");
                const refreshed = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones`, { cache: "no-store", credentials: "same-origin" });
                const refreshedBody = await refreshed.json().catch(() => null) as { data?: ProjectMilestoneSummary[] } | null;
                setMilestoneGates(refreshedBody?.data ?? []);
              } catch (reason) { setError(reason instanceof Error ? reason.message : "Không lưu được điều kiện milestone."); }
              finally { setMilestonesSaving(false); }
            }} onEvaluate={async (milestoneId) => {
              setMilestonesSaving(true); setError(null); setNotice(null);
              try {
                const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones/${encodeURIComponent(milestoneId)}/evaluate`, { method: "POST", credentials: "same-origin" });
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(errorMessage(body, "Không thể đánh giá gate milestone."));
                const refreshed = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones`, { cache: "no-store", credentials: "same-origin" });
                const refreshedBody = await refreshed.json().catch(() => null) as { data?: ProjectMilestoneSummary[] } | null;
                setMilestoneGates(refreshedBody?.data ?? []);
                setNotice("Đã đánh giá gate và cập nhật trạng thái mở khóa.");
              } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đánh giá gate milestone."); }
              finally { setMilestonesSaving(false); }
            }} />}
            </> : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function AdminSectionButton({ active, icon, label, badge, onClick }: { active: boolean; icon: ReactNode; label: string; badge?: number; onClick: () => void }) {
  return <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{icon}{label}{typeof badge === "number" ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${active ? "bg-primary/15 text-primary" : "bg-amber-100 text-amber-800"}`}>{badge}</span> : null}</button>;
}

function OverviewPanel({ overview, loading, onRefresh, onOpen }: { overview: AdminOverviewResponse["data"] | null; loading: boolean; onRefresh: () => void; onOpen: (section: AdminSection) => void }) {
  const alerts = overview?.alerts ?? [];
  const actionAlerts = alerts.filter((alert) => alert.severity !== "info");
  return <section aria-labelledby="admin-overview-title" className="grid gap-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">CONTROL ROOM</p><h2 id="admin-overview-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Tổng quan vận hành</h2><p className="mt-1 text-sm text-slate-600">Chỉ hiển thị các vấn đề admin cần biết hoặc cần xử lý.</p></div><button type="button" onClick={onRefresh} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Làm mới</button></div>
    <section aria-labelledby="admin-alerts-title" className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="flex items-center justify-between gap-3"><div><h3 id="admin-alerts-title" className="text-base font-bold text-slate-950">Cảnh báo cần xử lý</h3><p className="mt-1 text-xs text-slate-500">Cảnh báo thông tin chỉ hiện khi cần admin xem lại.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${actionAlerts.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{actionAlerts.length ? `${actionAlerts.length} cần xử lý` : "Đang ổn định"}</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{alerts.map((alert) => { const tone = alertTone(alert.severity); return <a key={alert.id} href={alert.href ?? "#"} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${tone.box}`}><div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>{alert.severity === "info" ? <Info className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}</span><div><p className={`text-sm font-bold ${tone.title}`}>{alert.title}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{alert.detail}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-slate-700">Xem chi tiết <ArrowRight className="h-3.5 w-3.5" /></span></div></div></a>; })}{loading && !overview ? <div className="rounded-2xl border border-border bg-slate-50 p-5 text-sm text-muted-foreground lg:col-span-2">Đang tải cảnh báo…</div> : null}</div></section>
    <section aria-label="Admin metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<LockKeyhole className="h-4 w-4" />} label="Ngày off đã khóa" value={overview?.metrics.activeDayOffs} tone="amber" /><Metric icon={<CalendarClock className="h-4 w-4" />} label="Ngày off sắp tới" value={overview?.metrics.upcomingDayOffs} tone="sky" /><Metric icon={<TriangleAlert className="h-4 w-4" />} label="Task quá hạn" value={overview?.metrics.overdueTasks} tone="rose" /><Metric icon={<TimerReset className="h-4 w-4" />} label="Task đang mở" value={overview?.metrics.openTasks} tone="indigo" /></section>
    <section aria-labelledby="quick-actions-title" className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><CheckCircle2 className="h-5 w-5" /></span><div><h3 id="quick-actions-title" className="text-base font-bold text-slate-950">Quản trị nhanh</h3><p className="mt-1 text-xs text-slate-500">Các chính sách vận hành được quản lý tập trung ở đây.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2"><button type="button" onClick={() => onOpen("day-offs")} className="group flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-left transition hover:border-amber-300 hover:bg-amber-50"><span><span className="block text-sm font-bold text-amber-950">Đăng ký ngày nghỉ</span><span className="mt-1 block text-xs text-amber-900/70">Khóa ngày lễ và loại khỏi billable.</span></span><ArrowRight className="h-4 w-4 text-amber-700 transition group-hover:translate-x-1" /></button><button type="button" onClick={() => onOpen("reminders")} className="group flex items-center justify-between rounded-2xl border border-violet-200 bg-violet-50/60 p-4 text-left transition hover:border-violet-300 hover:bg-violet-50"><span><span className="block text-sm font-bold text-violet-950">Cấu hình nhắc Lark</span><span className="mt-1 block text-xs text-violet-900/70">08:30 · 14:00 · 17:30 và ngày chạy.</span></span><ArrowRight className="h-4 w-4 text-violet-700 transition group-hover:translate-x-1" /></button></div></section>
  </section>;
}

const ALERT_TYPE_LABELS: Record<AdminAlertType, string> = {
  delay_risk: "Có nguy cơ chậm tiến độ",
  over_estimate: "Vượt Estimate",
  waiting_task: "Task đang chờ",
  missing_estimate: "Thiếu Estimate Hour",
  missing_actual: "Thiếu Actual Hour",
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
  const [typeFilter, setTypeFilter] = useState<"all" | AdminAlertType>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | AdminAlertDetailRow["severity"]>("all");
  const [search, setSearch] = useState("");
  const filtered = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    return (typeFilter === "all" || row.type === typeFilter) && (severityFilter === "all" || row.severity === severityFilter) && (!query || `${row.project.name} ${row.project.code} ${row.detail}`.toLowerCase().includes(query));
  });
  const critical = rows.filter((row) => row.severity === "critical").length;
  const warning = rows.filter((row) => row.severity === "warning").length;
  const affectedTasks = rows.reduce((sum, row) => sum + row.affectedTaskCount, 0);
  return <section aria-labelledby="admin-alert-detail-title" className="grid gap-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">OPERATIONS · ALERT CENTER</p><h2 id="admin-alert-detail-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Chi tiết cảnh báo</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">Tổng hợp theo project để đối soát Estimate Hour, Actual Hour, deadline và nguyên nhân cần xử lý. Chỉ dữ liệu đã ghi nhận mới được dùng để kết luận.</p></div><button type="button" onClick={onRefresh} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Làm mới dữ liệu</button></div>
    <section aria-label="Alert summary" className="grid gap-3 sm:grid-cols-3"><Metric icon={<TriangleAlert className="h-4 w-4" />} label="Tổng cảnh báo" value={rows.length} tone="amber" /><Metric icon={<ShieldAlert className="h-4 w-4" />} label="Cần xử lý ngay" value={critical + warning} tone="rose" /><Metric icon={<TimerReset className="h-4 w-4" />} label="Task liên quan" value={affectedTasks} tone="indigo" /></section>
    <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo project, mã project hoặc nguyên nhân…" className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm outline-none ring-primary/30 focus:ring-2" /></div><label className="inline-flex items-center gap-2 text-sm text-slate-600"><Filter className="h-4 w-4" /><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700"><option value="all">Tất cả loại cảnh báo</option>{Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><select aria-label="Mức độ" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700"><option value="all">Tất cả mức độ</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></div><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Hiển thị {filtered.length}/{rows.length} cảnh báo</span><span>{new Date().toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</span></div></section>
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="flex flex-col gap-1 border-b border-border bg-gradient-to-r from-amber-50 via-white to-sky-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h3 className="text-base font-bold text-slate-950">Estimate Hour và Actual Hour</h3><p className="mt-1 text-xs text-slate-500">Mỗi dòng là một nguyên nhân cảnh báo độc lập; một project có thể xuất hiện nhiều dòng.</p></div><span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{rows.length} cảnh báo</span></div><div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-bold">Project</th><th className="px-4 py-3 text-right font-bold">Estimate</th><th className="px-4 py-3 text-right font-bold">Actual</th><th className="px-4 py-3 text-right font-bold">Chênh lệch</th><th className="px-4 py-3 font-bold">Cảnh báo</th><th className="px-5 py-3 font-bold">Chi tiết cần xử lý</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{filtered.map((row) => <tr key={row.id} className="align-top transition hover:bg-slate-50/80"><td className="px-5 py-4"><a href={row.href} className="group block min-w-[220px]"><span className="block font-bold text-slate-900 group-hover:text-primary">{row.project.name}</span><span className="mt-1 block text-xs font-medium text-slate-500">{row.project.code}</span></a></td><td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">{formatAlertHours(row.estimateMinutes)}</td><td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">{formatAlertHours(row.actualMinutes)}</td><td className={`px-4 py-4 text-right font-bold tabular-nums ${row.varianceMinutes > 0 ? "text-rose-600" : "text-slate-500"}`}>{row.varianceMinutes > 0 ? "+" : ""}{formatAlertHours(row.varianceMinutes)}</td><td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${alertBadgeClass(row)}`}>{ALERT_TYPE_LABELS[row.type]}</span><span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.severity}</span></td><td className="max-w-[390px] px-5 py-4 text-xs leading-relaxed text-slate-600">{row.detail}<span className="mt-1 block font-semibold text-slate-400">{row.affectedTaskCount} task liên quan</span></td><td className="px-4 py-4"><a aria-label={`Mở project ${row.project.name}`} href={row.href} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ExternalLink className="h-3.5 w-3.5" /></a></td></tr>)}{loading && !rows.length ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">Đang tổng hợp cảnh báo từ task và time entry…</td></tr> : null}{!loading && !filtered.length ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">Không có cảnh báo phù hợp bộ lọc hiện tại.</td></tr> : null}</tbody></table></div></section>
    <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs leading-relaxed text-sky-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> “Thiếu dữ liệu” chỉ là tín hiệu cần bổ sung record; hệ thống không tự kết luận hiệu suất khi chưa đủ estimate, actual hoặc deadline.</div>
  </section>;
}

type TemplateStageDraft = { id: string; stageKey?: string; activity: string; phase?: string; criteria?: string; slaDays?: number; upbaseRole?: string; customerRole?: string };
type TemplateMilestoneDraft = Omit<CreateProjectMilestoneInput, "stages" | "requiredDocumentTypes"> & { id: string; requiredDocumentTypes: string; stages: TemplateStageDraft[] };
type TemplateDraft = { id?: string; key: string; name: string; description: string; readOnly?: boolean; milestones: TemplateMilestoneDraft[] };

function templateToDraft(template: ProjectMilestoneTemplateSummary): TemplateDraft {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    description: template.description ?? "",
    readOnly: template.readOnly,
    milestones: template.milestones.map((milestone, milestoneIndex) => ({
      id: `milestone-${milestoneIndex}-${template.id}`,
      name: milestone.name,
      sortOrder: milestone.sortOrder,
      requiredDocumentCount: milestone.requiredDocumentCount ?? 0,
      requiredDocumentTypes: (milestone.requiredDocumentTypes ?? []).join(", "),
      unlockCriteria: milestone.unlockCriteria ?? "",
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerRole: milestone.reviewerRole ?? "PM",
      stages: milestone.stages.map((stage, stageIndex) => ({ id: `stage-${milestoneIndex}-${stageIndex}-${template.id}`, ...stage }))
    }))
  };
}

function emptyTemplateDraft(): TemplateDraft {
  return {
    key: "",
    name: "",
    description: "",
    milestones: [{
      id: `milestone-${Date.now()}`,
      name: "Milestone 1",
      sortOrder: 10,
      requiredDocumentCount: 0,
      requiredDocumentTypes: "",
      unlockCriteria: "",
      customerConfirmationRequired: false,
      reviewerRole: "PM",
      stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage" }]
    }]
  };
}

function MilestoneTemplateManager({
  templates,
  loading,
  saving,
  onCreate,
  onUpdate
}: {
  templates: ProjectMilestoneTemplateSummary[];
  loading: boolean;
  saving: boolean;
  onCreate: (input: CreateProjectMilestoneTemplateInput) => Promise<ProjectMilestoneTemplateSummary | void>;
  onUpdate: (templateId: string, input: UpdateProjectMilestoneTemplateInput) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isCreating) {
      const active = templates.find((template) => template.id === activeId) ?? templates[0];
      setActiveId(active?.id ?? "");
      setDraft(active ? templateToDraft(active) : null);
    }
  }, [activeId, isCreating, templates]);

  const selectTemplate = (template: ProjectMilestoneTemplateSummary) => {
    setIsCreating(false);
    setActiveId(template.id);
    setDraft(templateToDraft(template));
  };
  const startCreate = () => {
    setIsCreating(true);
    setActiveId("");
    setDraft(emptyTemplateDraft());
  };
  const updateDraft = (patch: Partial<TemplateDraft>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const updateMilestone = (id: string, patch: Partial<TemplateMilestoneDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone) } : current);
  const save = async () => {
    if (!draft || draft.readOnly || !draft.name.trim() || draft.milestones.length === 0) return;
    const milestones: CreateProjectMilestoneInput[] = draft.milestones.map((milestone, milestoneIndex) => ({
      name: milestone.name.trim(),
      sortOrder: (milestoneIndex + 1) * 10,
      requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
      requiredDocumentTypes: milestone.requiredDocumentTypes.split(",").map((value) => value.trim()).filter(Boolean),
      unlockCriteria: milestone.unlockCriteria?.trim() || undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerRole: milestone.reviewerRole?.trim() || undefined,
      stages: milestone.stages.map((stage, stageIndex) => ({
        stageKey: stage.stageKey || `${milestone.id}-${stageIndex + 1}`,
        activity: stage.activity.trim(),
        phase: stage.phase?.trim() || stage.activity.trim(),
        criteria: stage.criteria?.trim() || undefined,
        slaDays: stage.slaDays,
        upbaseRole: stage.upbaseRole?.trim() || undefined,
        customerRole: stage.customerRole?.trim() || undefined
      }))
    }));
    try {
      if (isCreating) {
        const created = await onCreate({ key: draft.key.trim() || undefined, name: draft.name.trim(), description: draft.description.trim() || undefined, milestones });
        if (created) {
          setActiveId(created.id);
          setDraft(templateToDraft(created));
        }
        setIsCreating(false);
      } else if (draft.id) {
        await onUpdate(draft.id, { name: draft.name.trim(), description: draft.description.trim(), milestones });
      }
    } catch {
      // The parent surfaces the API error; keep the draft open so it can be corrected.
    }
  };

  return <section aria-labelledby="milestone-template-title" className="grid gap-4 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">MILESTONE LIBRARY</p><h2 id="milestone-template-title" className="mt-1 text-xl font-bold tracking-tight text-slate-950">Mẫu milestone dùng khi tạo Project</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Admin tạo một lần, sau đó người tạo Project chỉ cần chọn mẫu. Điều kiện hồ sơ và bước chuyển tiếp sẽ được copy sang Project mới.</p></div><button type="button" onClick={startCreate} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"><span className="text-lg leading-none">+</span> Tạo template</button></div>
    {loading ? <div className="rounded-2xl border border-border bg-slate-50 p-6 text-center text-sm text-slate-500">Đang tải thư viện template…</div> : null}
    {!loading ? <div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)] lg:items-start"><aside className="rounded-2xl border border-border bg-slate-50/70 p-2"><div className="flex items-center justify-between px-2 pb-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">TEMPLATE ĐÃ LƯU</span><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">{templates.length}</span></div><div className="space-y-1">{templates.map((template) => <button type="button" key={template.id} onClick={() => selectTemplate(template)} className={`w-full rounded-xl px-3 py-3 text-left transition ${template.id === activeId && !isCreating ? "bg-white ring-1 ring-violet-200 shadow-sm" : "hover:bg-white"}`}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-900">{template.name}</span>{template.readOnly ? <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Mặc định</span> : null}</span><span className="mt-1 block text-[11px] text-slate-500">{template.milestoneCount} milestone · {template.stageCount} stage</span></button>)}</div>{templates.length === 0 ? <p className="px-2 py-4 text-xs leading-relaxed text-slate-500">Chưa có template riêng. Bấm “Tạo template” để bắt đầu.</p> : null}</aside><div className="min-w-0 rounded-2xl border border-border bg-white">{draft ? <><div className="border-b border-border bg-gradient-to-r from-violet-50 via-white to-sky-50 px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">{isCreating ? "TEMPLATE MỚI" : draft.readOnly ? "SYSTEM TEMPLATE" : "TEMPLATE ĐÃ LƯU"}</p><h3 className="mt-1 text-lg font-bold text-slate-950">{isCreating ? "Thiết lập format milestone" : draft.name}</h3><p className="mt-1 text-xs text-slate-500">{draft.milestones.length} milestone · {draft.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0)} stage</p></div>{draft.readOnly ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">Chỉ xem</span> : <button type="button" disabled={saving || !draft.name.trim()} onClick={() => void save()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : isCreating ? "Lưu template" : "Cập nhật template"}</button>}</div></div><div className="space-y-4 p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Tên template</span><input disabled={draft.readOnly} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="VD: CRM triển khai chuẩn" className="h-10 w-full rounded-xl border border-border px-3 text-sm font-semibold disabled:bg-slate-50" /></label><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Mã template <span className="font-normal text-slate-400">(tự sinh nếu bỏ trống)</span></span><input disabled={draft.readOnly || !isCreating} value={draft.key} onChange={(event) => updateDraft({ key: event.target.value })} placeholder="crm-standard-v1" className="h-10 w-full rounded-xl border border-border px-3 text-sm disabled:bg-slate-50" /></label></div><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Mô tả sử dụng</span><textarea disabled={draft.readOnly} rows={2} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Template này dùng cho loại dự án nào?" className="w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm disabled:bg-slate-50" /></label><div className="flex items-center justify-between border-t border-border pt-4"><div><p className="text-sm font-bold text-slate-900">Chuỗi milestone</p><p className="mt-0.5 text-xs text-slate-500">Mỗi milestone cần ít nhất một stage để project mới tạo được hierarchy.</p></div>{!draft.readOnly ? <button type="button" onClick={() => updateDraft({ milestones: [...draft.milestones, { id: `milestone-${Date.now()}`, name: `Milestone ${draft.milestones.length + 1}`, sortOrder: (draft.milestones.length + 1) * 10, requiredDocumentCount: 0, requiredDocumentTypes: "", unlockCriteria: "", customerConfirmationRequired: false, reviewerRole: "PM", stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage" }] }] })} className="text-xs font-bold text-primary hover:underline">+ Thêm milestone</button> : null}</div><div className="space-y-3">{draft.milestones.map((milestone, index) => <article key={milestone.id} className="rounded-2xl border border-border bg-slate-50/70 p-3 sm:p-4"><div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[11px] font-black text-violet-700">M{index + 1}</span><input disabled={draft.readOnly} value={milestone.name} onChange={(event) => updateMilestone(milestone.id, { name: event.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 text-sm font-bold disabled:bg-slate-100" />{!draft.readOnly && draft.milestones.length > 1 ? <button type="button" onClick={() => updateDraft({ milestones: draft.milestones.filter((item) => item.id !== milestone.id) })} className="text-xs font-semibold text-rose-600">Xóa</button> : null}</div><div className="mt-3 grid gap-2 sm:grid-cols-3"><label><span className="mb-1 block text-[11px] font-semibold text-slate-500">Số hồ sơ</span><input disabled={draft.readOnly} type="number" min="0" value={milestone.requiredDocumentCount ?? 0} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" /></label><label className="sm:col-span-2"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Loại hồ sơ</span><input disabled={draft.readOnly} value={milestone.requiredDocumentTypes} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentTypes: event.target.value })} placeholder="BRD, FRD, SRS" className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" /></label></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><label><span className="mb-1 block text-[11px] font-semibold text-slate-500">Vai trò duyệt</span><input disabled={draft.readOnly} value={milestone.reviewerRole ?? ""} onChange={(event) => updateMilestone(milestone.id, { reviewerRole: event.target.value })} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" /></label><label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600"><input disabled={draft.readOnly} type="checkbox" checked={Boolean(milestone.customerConfirmationRequired)} onChange={(event) => updateMilestone(milestone.id, { customerConfirmationRequired: event.target.checked })} className="h-4 w-4 rounded border-border text-primary" /> Cần khách hàng xác nhận</label></div><label className="mt-2 block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Điều kiện mở milestone kế tiếp</span><textarea disabled={draft.readOnly} rows={2} value={milestone.unlockCriteria ?? ""} onChange={(event) => updateMilestone(milestone.id, { unlockCriteria: event.target.value })} placeholder="Ví dụ: đủ hồ sơ và PM duyệt" className="w-full resize-none rounded-lg border border-border bg-white px-2.5 py-2 text-sm disabled:bg-slate-100" /></label><div className="mt-3 border-t border-border pt-3"><div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">STAGE TRONG MILESTONE</span>{!draft.readOnly ? <button type="button" onClick={() => updateMilestone(milestone.id, { stages: [...milestone.stages, { id: `stage-${Date.now()}`, activity: `Stage ${milestone.stages.length + 1}`, phase: "stage" }] })} className="text-xs font-bold text-primary hover:underline">+ Thêm stage</button> : null}</div><div className="mt-2 space-y-2">{milestone.stages.map((stage, stageIndex) => <div key={stage.id} className="grid gap-2 sm:grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"><span className="text-[11px] font-bold text-slate-400">{stageIndex + 1}</span><input disabled={draft.readOnly} value={stage.activity} onChange={(event) => updateMilestone(milestone.id, { stages: milestone.stages.map((item) => item.id === stage.id ? { ...item, activity: event.target.value } : item) })} className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" placeholder="Tên stage" /><input disabled={draft.readOnly} value={stage.criteria ?? ""} onChange={(event) => updateMilestone(milestone.id, { stages: milestone.stages.map((item) => item.id === stage.id ? { ...item, criteria: event.target.value } : item) })} className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" placeholder="Tiêu chí hoàn thành" />{!draft.readOnly && milestone.stages.length > 1 ? <button type="button" onClick={() => updateMilestone(milestone.id, { stages: milestone.stages.filter((item) => item.id !== stage.id) })} className="text-xs font-semibold text-rose-600">Xóa</button> : null}</div>)}</div></div></article>)}</div></div></> : <div className="p-8 text-center text-sm text-slate-500">Bấm “Tạo template” để tạo format milestone đầu tiên.</div>}</div></div> : null}
  </section>;
}

type MilestoneGatePatch = {
  requiredDocumentCount: number;
  requiredDocumentTypes: string[];
  unlockCriteria: string;
  customerConfirmationRequired: boolean;
  reviewerRole: string;
  gateStatus: string;
};

function MilestoneGatePanel({
  projects,
  projectId,
  gates,
  loading,
  saving,
  onProjectChange,
  onSave,
  onEvaluate
}: {
  projects: ProjectSummary[];
  projectId: string;
  gates: ProjectMilestoneSummary[];
  loading: boolean;
  saving: boolean;
  onProjectChange: (projectId: string) => void;
  onSave: (milestoneId: string, input: MilestoneGatePatch) => Promise<void>;
  onEvaluate: (milestoneId: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, MilestoneGatePatch>>({});
  const [activeGateId, setActiveGateId] = useState("");
  useEffect(() => {
    setDrafts(Object.fromEntries(gates.map((gate) => [gate.id, {
      requiredDocumentCount: gate.requiredDocumentCount ?? 0,
      requiredDocumentTypes: gate.requiredDocumentTypes ?? [],
      unlockCriteria: gate.unlockCriteria ?? "",
      customerConfirmationRequired: Boolean(gate.customerConfirmationRequired),
      reviewerRole: gate.reviewerRole ?? "PM",
      gateStatus: gate.gateStatus ?? "locked"
    }])));
    setActiveGateId((current) => current && gates.some((gate) => gate.id === current) ? current : gates[0]?.id ?? "");
  }, [gates]);

  const updateDraft = (id: string, patch: Partial<MilestoneGatePatch>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const selectedProject = projects.find((project) => project.id === projectId);
  const activeGate = gates.find((gate) => gate.id === activeGateId) ?? gates[0];
  const activeDraft = activeGate ? drafts[activeGate.id] : undefined;
  const statusLabel: Record<string, string> = { open: "Đang mở", locked: "Đang khóa", pending_review: "Chờ duyệt", approved: "Đã duyệt", rejected: "Cần làm lại", conditional: "Duyệt có điều kiện" };
  const statusClass: Record<string, string> = { open: "bg-sky-100 text-sky-800", locked: "bg-slate-100 text-slate-600", pending_review: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-800", conditional: "bg-violet-100 text-violet-800" };

  return <section aria-labelledby="milestone-gate-title" className="grid gap-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">PROJECT GOVERNANCE</p><h2 id="milestone-gate-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Milestone & điều kiện chuyển tiếp</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Chọn một Project, chọn một milestone ở cột trái, rồi chỉnh điều kiện ở một nơi duy nhất.</p></div><label className="min-w-[280px]"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Project cần cấu hình</span><select value={projectId} onChange={(event) => onProjectChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700"><option value="">Chọn Project…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label></div>
    {selectedProject ? <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900"><span className="font-bold">{selectedProject.name}</span><span>·</span><span>{selectedProject.milestoneMode === "manual" ? "Tự chọn milestone" : "Mẫu pilot"}</span><span>·</span><span>{gates.length} bước chuyển tiếp</span></div> : null}
    {loading ? <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-slate-500">Đang tải cấu hình milestone…</div> : null}
    {!loading && !projectId ? <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-slate-500">Chọn một Project để bắt đầu cấu hình.</div> : null}
    {!loading && projectId && gates.length === 0 ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Project này chưa có milestone. Hãy tạo lại Project với template tự động hoặc thêm milestone trong Project Sheet.</div> : null}
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <aside className="rounded-3xl border border-border bg-card p-3 shadow-sm lg:sticky lg:top-24"><div className="flex items-center justify-between px-2 pb-2"><div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">WORKFLOW</p><p className="mt-1 text-sm font-bold text-slate-900">Các bước milestone</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">{gates.length}</span></div><div className="space-y-1">{gates.map((gate, index) => { const draft = drafts[gate.id]; const active = gate.id === activeGate?.id; return <button type="button" key={gate.id} onClick={() => setActiveGateId(gate.id)} className={`relative flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"}`}><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-black ${active ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700"}`}>M{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{gate.name}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${draft?.gateStatus === "approved" ? "bg-emerald-500" : draft?.gateStatus === "pending_review" ? "bg-amber-500" : draft?.gateStatus === "locked" ? "bg-slate-400" : "bg-sky-500"}`} />{statusLabel[draft?.gateStatus ?? "locked"]}</span></span><span className="text-[11px] font-semibold text-slate-400">{draft?.requiredDocumentCount ?? 0} hồ sơ</span></button>; })}</div></aside>
      <section className="min-w-0 rounded-3xl border border-border bg-card shadow-sm">{activeGate && activeDraft ? <><div className="border-b border-border bg-gradient-to-r from-indigo-50 via-white to-sky-50 px-5 py-5 sm:px-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white">M{gates.findIndex((gate) => gate.id === activeGate.id) + 1}</span><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">HỒ SƠ CHUYỂN TIẾP</p><h3 className="mt-1 text-xl font-bold tracking-tight text-slate-950">{activeGate.name}</h3><p className="mt-1 text-xs text-slate-500">{activeGate.submittedDocumentCount ?? 0}/{activeDraft.requiredDocumentCount} hồ sơ đã ghi nhận · {activeDraft.customerConfirmationRequired ? "Cần khách hàng xác nhận" : "Không cần khách hàng xác nhận"}</p></div></div><span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusClass[activeDraft.gateStatus] ?? statusClass.locked}`}>{statusLabel[activeDraft.gateStatus] ?? activeDraft.gateStatus}</span></div></div><div className="space-y-5 p-5 sm:p-7"><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Số hồ sơ bắt buộc</span><input type="number" min="0" value={activeDraft.requiredDocumentCount} onChange={(event) => updateDraft(activeGate.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold" /></label><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Loại hồ sơ</span><input value={activeDraft.requiredDocumentTypes.join(", ")} onChange={(event) => updateDraft(activeGate.id, { requiredDocumentTypes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="BRD, FRD, SRS" className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm" /></label></div><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Vai trò duyệt</span><input value={activeDraft.reviewerRole} onChange={(event) => updateDraft(activeGate.id, { reviewerRole: event.target.value })} className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm" /></label><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Trạng thái gate</span><select value={activeDraft.gateStatus} onChange={(event) => updateDraft(activeGate.id, { gateStatus: event.target.value })} className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold"><option value="open">Đang mở</option><option value="locked">Đang khóa</option><option value="pending_review">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Cần làm lại</option><option value="conditional">Duyệt có điều kiện</option></select></label></div><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Điều kiện để mở milestone kế tiếp</span><textarea rows={4} value={activeDraft.unlockCriteria} onChange={(event) => updateDraft(activeGate.id, { unlockCriteria: event.target.value })} className="w-full resize-none rounded-xl border border-border bg-white px-3 py-3 text-sm leading-relaxed" placeholder="Ví dụ: đủ hồ sơ, PM duyệt, khách hàng xác nhận…" /></label><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={activeDraft.customerConfirmationRequired} onChange={(event) => updateDraft(activeGate.id, { customerConfirmationRequired: event.target.checked })} className="h-4 w-4 rounded border-border text-primary" /> Bắt buộc khách hàng xác nhận</label><div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-slate-900">Hồ sơ hiện tại</p><p className="mt-1 text-xs text-slate-500">{activeGate.submittedDocumentCount ?? 0} hồ sơ đã ghi nhận · cần {activeDraft.requiredDocumentCount} hồ sơ</p></div><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void onEvaluate(activeGate.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Đánh giá hồ sơ</button><button type="button" disabled={saving} onClick={() => void onSave(activeGate.id, activeDraft)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Lưu thay đổi</button></div></div></div></> : <div className="p-10 text-center text-sm text-slate-500">Chọn một milestone để cấu hình.</div>}</section>
    </div>
  </section>;
}

function LegacyReminderPolicyPanel({ policy, saving, onSave, onUpdateSlot, onSetPolicy }: { policy: WorkspaceReminderPolicy | null; saving: boolean; onSave: () => void; onUpdateSlot: (code: WorkspaceReminderSlotCode, patch: Partial<WorkspaceReminderSlot>) => void; onSetPolicy: React.Dispatch<React.SetStateAction<WorkspaceReminderPolicy | null>> }) {
  return <section aria-labelledby="reminder-policy-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-gradient-to-r from-violet-50 via-white to-sky-50 px-5 py-5 sm:px-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><BellRing className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">LARK NOTIFICATIONS</p><h2 id="reminder-policy-title" className="mt-1 text-xl font-bold text-slate-950">Lịch nhắc vận hành</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Chỉ gửi khi phát hiện thiếu kế hoạch hoặc Actual Hour. Ngày off được bỏ qua tự động.</p></div></div>{policy ? <button disabled={saving} type="button" onClick={onSave} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : "Lưu thay đổi"}</button> : null}</div></div>{policy ? <div className="p-5 sm:p-7"><div className="flex flex-col gap-3 rounded-2xl border border-border bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${policy.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}><BellRing className="h-4 w-4" /></div><div><p className="text-sm font-bold text-slate-900">Kích hoạt nhắc Lark</p><p className="mt-0.5 text-xs text-slate-500">{formatUpdatedAt(policy.updatedAt)} · múi giờ {policy.timezone}</p></div></div><Toggle checked={policy.enabled} onChange={(checked) => onSetPolicy((current) => current ? { ...current, enabled: checked } : current)} label={policy.enabled ? "Đang bật" : "Đang tắt"} /></div><div className="mt-4 grid gap-3 md:grid-cols-3">{policy.slots.map((slot) => <div key={slot.slot} className={`rounded-2xl border p-4 transition ${slot.enabled && policy.enabled ? "border-violet-200 bg-violet-50/40" : "border-border bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">{slotLabel(slot)}</p><p className="mt-1 text-xs leading-relaxed text-slate-500">{slot.slot === "morning_plan" ? "Kiểm tra kế hoạch và trường dữ liệu task." : slot.slot === "pm_follow_up" ? "Nhắc lại các việc chưa được cập nhật." : "Đối soát Actual Hour cuối ngày."}</p></div><Toggle checked={slot.enabled} onChange={(checked) => onUpdateSlot(slot.slot, { enabled: checked })} label={slot.enabled ? "Bật" : "Tắt"} compact /></div><label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-500"><Clock3 className="h-4 w-4" /> Giờ gửi<input type="time" value={slot.time} onChange={(event) => onUpdateSlot(slot.slot, { time: event.target.value })} className="ml-auto h-9 rounded-lg border border-border bg-white px-2 text-sm font-bold text-slate-900" /></label></div>)}</div><label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={policy.weekdaysOnly} onChange={(event) => onSetPolicy((current) => current ? { ...current, weekdaysOnly: event.target.checked } : current)} className="h-4 w-4 rounded border-border text-primary" /> Chỉ gửi vào ngày làm việc (Thứ 2–Thứ 6, bỏ qua ngày off)</label><div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-xs leading-relaxed text-sky-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Secret webhook chỉ nằm ở worker/server. Mốc mặc định: 08:30, 14:00 và 17:30.</div></div> : <div className="p-7 text-sm text-muted-foreground">Đang tải cấu hình lịch nhắc…</div>}</section>;
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
          <label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Phạm vi người nhận</span><select value={scope} onChange={(event) => { const next = event.target.value as typeof scope; setScope(next); setUserId(""); setTeamId(""); }} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700"><option value="all">Tất cả người đang active</option><option value="user">Một người</option><option value="team">Một team</option></select></label>
          {scope === "user" ? <label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Người nhận</span><select value={userId} onChange={(event) => setUserId(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700"><option value="">Chọn người nhận…</option>{recipients.users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label> : null}
          {scope === "team" ? <label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Team nhận</span><select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700"><option value="">Chọn team…</option>{recipients.teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.memberCount})</option>)}</select></label> : null}
          <label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Ngày gửi</span><input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700" /></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Mốc giờ</span><select value={slot} onChange={(event) => setSlot(event.target.value as WorkspaceReminderSlotCode)} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-700">{(policy?.slots ?? []).map((candidate) => <option key={candidate.slot} value={candidate.slot}>{slotLabel(candidate)} · {candidate.time}</option>)}</select></label>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs leading-relaxed text-violet-900"><strong>{selectedSlot?.label ?? "Mốc nhắc"}</strong><span className="mx-1.5">·</span>{localDate || "Chưa chọn ngày"}<span className="mx-1.5">·</span>{scope === "all" ? `${recipients.users.length} người active` : scope === "user" ? (recipients.users.find((user) => user.id === userId)?.displayName || "Chưa chọn người") : (recipients.teams.find((team) => team.id === teamId)?.name || "Chưa chọn team")}</div><button type="button" disabled={sending || !localDate || (scope === "user" && !userId) || (scope === "team" && !teamId)} onClick={submitManual} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />{sending ? "Đang gửi…" : "Gửi ngay"}</button></div>
      </div>
    </section>
  </>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value?: number; tone: "amber" | "sky" | "rose" | "indigo" }) {
  const colors = { amber: "bg-amber-100 text-amber-700", sky: "bg-sky-100 text-sky-700", rose: "bg-rose-100 text-rose-700", indigo: "bg-indigo-100 text-indigo-700" };
  return <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${colors[tone]}`}>{icon}</span><div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 text-2xl font-black tabular-nums text-slate-950">{typeof value === "number" ? value : "—"}</p></div></div></div>;
}

function Toggle({ checked, onChange, label, compact = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; compact?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`inline-flex items-center gap-2 ${compact ? "text-xs" : "text-sm"} font-semibold ${checked ? "text-emerald-700" : "text-slate-500"}`}><span className={`relative inline-flex ${compact ? "h-5 w-9" : "h-6 w-11"} items-center rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`}><span className={`absolute ${compact ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} rounded-full bg-white shadow transition ${checked ? (compact ? "translate-x-4" : "translate-x-6") : "translate-x-1"}`} /></span>{label}</button>;
}
