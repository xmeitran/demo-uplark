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
  LockKeyhole,
  RefreshCw,
  Save,
  Send,
  Search,
  ShieldAlert,
  ShieldCheck,
  Settings2,
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
  CreateProjectMilestoneInput,
  CreateProjectMilestoneTemplateInput,
  ProjectTaskTemplateInput,
  ProjectMilestoneTemplateSummary,
  ProjectMilestoneSummary,
  ProjectMilestoneEvidenceMode,
  ProjectSummary,
  WorkspaceReminderTeamOption,
  WorkspaceReminderRecipientOption,
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
import { CustomDropdown, type TaskSelectOption } from "@/components/crm-workspace/tasks-workbench";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { FilterBar, FilterField } from "@/components/filters/filter-controls";
import { useAuth } from "@/lib/auth";
import { WorkspaceTabBar, type WorkspaceTabItem } from "@/components/workspace-tab-bar";
import { businessRoleFromMember, systemRoleFromCodes, systemRoleLabel } from "@/lib/people-roles";
import { milestoneReviewerOptions, WORKSPACE_ADMIN_REVIEWER_VALUE } from "./milestone-reviewer-options";

const ADMIN_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);
type AdminSection = "overview" | "alerts" | "day-offs" | "reminders" | "milestones" | "approval" | "history" | "pnl-config";
type MilestoneView = "templates" | "project-gates";

const MILESTONE_TAB_ITEMS: WorkspaceTabItem<MilestoneView>[] = [
  { id: "templates", label: "Thư viện template", description: "Format dùng cho project mới" },
  { id: "project-gates", label: "Cấu hình theo Project", description: "Gate & điều kiện mở khóa" }
];

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
  const isAdmin = Boolean(user?.roleCodes?.some((role) => ADMIN_ROLES.has(role)));
  const [overview, setOverview] = useState<AdminOverviewResponse["data"] | null>(null);
  const [policy, setPolicy] = useState<WorkspaceReminderPolicy | null>(null);
  const [reminderRecipients, setReminderRecipients] = useState<WorkspaceReminderRecipientsResponse["data"]>({ users: [], teams: [] });
  const [alertDetails, setAlertDetails] = useState<AdminAlertDetailRow[]>([]);
  const [historyEntries, setHistoryEntries] = useState<AdminHistoryResponse["data"]>([]);
  const [approvalHistoryEntries, setApprovalHistoryEntries] = useState<AdminHistoryResponse["data"]>([]);
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
  const [milestoneView, setMilestoneView] = useState<MilestoneView>("templates");

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setMilestoneTemplatesLoading(true);
    setError(null);
    try {
      const [overviewResponse, policyResponse, alertsResponse, recipientsResponse, projectsResponse, templatesResponse, historyResponse, approvalHistoryResponse] = await Promise.all([
        fetch("/api/admin/overview", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/reminders", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/alerts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/reminders/recipients", { cache: "no-store", credentials: "same-origin" }),
        // Keep the local admin screen usable before an auth session is created.
        // The BFF ignores this fallback when a real Lark session is present.
        fetch("/api/projects?limit=100&offset=0&principal=founder", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/milestone-templates?principal=founder", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/history?limit=50&scope=all", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/history?limit=12&scope=mine", { cache: "no-store", credentials: "same-origin" })
      ]);
      const overviewBody = await overviewResponse.json().catch(() => null);
      const policyBody = await policyResponse.json().catch(() => null);
      const alertsBody = await alertsResponse.json().catch(() => null);
      const recipientsBody = await recipientsResponse.json().catch(() => null);
      const templatesBody = await templatesResponse.json().catch(() => null);
      const projectsBody = await projectsResponse.json().catch(() => null);
      const historyBody = await historyResponse.json().catch(() => null);
      const approvalHistoryBody = await approvalHistoryResponse.json().catch(() => null);
      if (!overviewResponse.ok) throw new Error(errorMessage(overviewBody, "Không tải được tổng quan admin."));
      if (!policyResponse.ok) throw new Error(errorMessage(policyBody, "Không tải được lịch nhắc Lark."));
      if (!alertsResponse.ok) throw new Error(errorMessage(alertsBody, "Không tải được chi tiết cảnh báo."));
      if (!recipientsResponse.ok) throw new Error(errorMessage(recipientsBody, "Không tải được danh sách người nhận nhắc Lark."));
      if (!templatesResponse.ok) throw new Error(errorMessage(templatesBody, "Không tải được danh sách template milestone."));
      if (!historyResponse.ok) throw new Error(errorMessage(historyBody, "Không tải được lịch sử thao tác admin."));
      if (!approvalHistoryResponse.ok) throw new Error(errorMessage(approvalHistoryBody, "Không tải được lịch sử duyệt của bạn."));
      setOverview((overviewBody as AdminOverviewResponse).data);
      setPolicy((policyBody as { data: WorkspaceReminderPolicy }).data);
      setAlertDetails((alertsBody as AdminAlertsResponse).data);
      setReminderRecipients((recipientsBody as WorkspaceReminderRecipientsResponse).data);
      setMilestoneTemplates((templatesBody as { data?: ProjectMilestoneTemplateSummary[] }).data ?? []);
      setHistoryEntries((historyBody as AdminHistoryResponse).data ?? []);
      setApprovalHistoryEntries((approvalHistoryBody as AdminHistoryResponse).data ?? []);
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
      if (hash === "alerts" || hash === "day-offs" || hash === "reminders" || hash === "milestones" || hash === "approval" || hash === "history") setSection(hash);
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
    if (next === "pnl-config") {
      window.location.assign("/pnl/config");
      return;
    }
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

  const createWorkspaceTeam = async (input: { name: string; code?: string }): Promise<WorkspaceReminderTeamOption | void> => {
    setError(null);
    const response = await fetch("/api/admin/teams", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json().catch(() => null) as { data?: WorkspaceReminderTeamOption; message?: string } | null;
    if (!response.ok) {
      const message = errorMessage(body, "Không tạo được team.");
      setError(message);
      throw new Error(message);
    }
    const created = body?.data;
    if (created) {
      setReminderRecipients((current) => ({ ...current, teams: [...current.teams, created].sort((a, b) => a.name.localeCompare(b.name)) }));
      setNotice(`Đã tạo team “${created.name}”.`);
    }
    return created;
  };

  if (authLoading) return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Đang kiểm tra quyền truy cập…</div>;

  if (!isAdmin) {
    return (
      <AppShell activeRoute="/admin" title="Admin">
        <main className="flex flex-1 items-center justify-center p-6">
          <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><ShieldAlert className="h-7 w-7" /></div>
            <h1 className="!text-xl mt-5 font-bold text-foreground">Khu vực dành cho Admin</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Bạn cần role Founder/GM hoặc Workspace Admin để xem cảnh báo, khóa ngày nghỉ và cấu hình nhắc Lark.</p>
          </section>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeRoute="/admin" title="Admin workspace">
      <main className="admin-workspace-page min-h-0 flex-1 overflow-y-auto bg-background p-3 sm:p-4 xl:p-6">
        <div className="mx-auto grid max-w-[1480px] gap-4">
          <header className="flex shrink-0 flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div>
                <h1 className="!text-xl font-bold tracking-tight text-foreground">Điều hành workspace</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Quản lý quy trình, quyền duyệt và các chính sách vận hành của workspace.</p>
              </div>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {overview?.workspace.name ?? "Workspace"}<span className="text-border">·</span>{overview?.workspace.timezone ?? "Asia/Ho_Chi_Minh"}</div>
          </header>

          <div className="sticky top-0 z-10 -mx-3 bg-background/95 px-3 py-1 backdrop-blur sm:-mx-4 sm:px-4 xl:-mx-6 xl:px-6">
            <nav aria-label="Admin sections">
              <WorkspaceTabBar
                items={[
                  { id: "overview" as AdminSection, label: "Tổng quan", description: "Sức khỏe workspace", icon: <LayoutDashboard className="h-4 w-4" /> },
                  { id: "alerts" as AdminSection, label: "Cảnh báo", description: "Estimate & Actual", badge: alertDetails.length || undefined, icon: <TriangleAlert className="h-4 w-4" /> },
                  { id: "day-offs" as AdminSection, label: "Ngày nghỉ", description: "Khóa ngày & loại phí", icon: <CalendarDays className="h-4 w-4" /> },
                  { id: "reminders" as AdminSection, label: "Nhắc Lark", description: "Lịch gửi & người nhận", icon: <BellRing className="h-4 w-4" /> },
                  { id: "milestones" as AdminSection, label: "Milestone", description: "Template & gate", icon: <LockKeyhole className="h-4 w-4" /> },
                  { id: "approval" as AdminSection, label: "Approval", description: "Hồ sơ chờ duyệt", icon: <ShieldCheck className="h-4 w-4" /> },
                  { id: "pnl-config" as AdminSection, label: "Thiết lập P&L", description: "Khoản mục & kỳ khóa", icon: <Settings2 className="h-4 w-4" /> },
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
            {section === "alerts" ? <AlertsPanel rows={alertDetails} loading={loading} onRefresh={() => void load()} /> : null}
            {section === "day-offs" ? <section aria-label="Quản lý ngày nghỉ"><WorkspaceDayOffSettings /></section> : null}
            {section === "reminders" ? <ReminderPolicyPanel policy={policy} saving={saving} sending={sending} recipients={reminderRecipients} onSave={() => void savePolicy()} onSendManual={(input) => void sendManualReminder(input)} onUpdateSlot={updateSlot} onSetPolicy={setPolicy} /> : null}
            {section === "milestones" ? <>
              <WorkspaceTabBar items={MILESTONE_TAB_ITEMS} value={milestoneView} onChange={setMilestoneView} ariaLabel="Quản lý milestone" idPrefix="milestone" className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none" />
              {milestoneView === "templates" ? <MilestoneTemplateManagerV4 templates={milestoneTemplates} loading={milestoneTemplatesLoading} saving={milestoneTemplatesSaving} teams={reminderRecipients.teams} users={reminderRecipients.users} onCreateTeam={createWorkspaceTeam} onCreate={async (input) => {
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
              }} /> : <MilestoneGatePanel projects={projectOptions} projectId={selectedProjectId} gates={milestoneGates} users={reminderRecipients.users} loading={milestonesLoading} saving={milestonesSaving} onProjectChange={setSelectedProjectId} onSave={async (milestoneId, input) => {
              setMilestonesSaving(true); setError(null); setNotice(null);
              try {
                const { gateStatus: _gateStatus, ...configuration } = input;
                const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones/${encodeURIComponent(milestoneId)}/gate`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(configuration) });
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
                const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones/${encodeURIComponent(milestoneId)}/request-approval`, { method: "POST", credentials: "same-origin" });
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(errorMessage(body, "Không thể đánh giá gate milestone."));
                const refreshed = await fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/milestones`, { cache: "no-store", credentials: "same-origin" });
                const refreshedBody = await refreshed.json().catch(() => null) as { data?: ProjectMilestoneSummary[] } | null;
                setMilestoneGates(refreshedBody?.data ?? []);
                setNotice("Đã đánh giá điều kiện và gửi hồ sơ sang hàng chờ người duyệt.");
              } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đánh giá gate milestone."); }
              finally { setMilestonesSaving(false); }
            }} />}
            </> : null}
            {section === "approval" ? <ApprovalPanel approvalHistory={approvalHistoryEntries} historyLoading={loading} onRefreshHistory={() => void load()} onApproved={() => void load()} /> : null}
            {section === "history" ? <AdminHistoryPanel entries={historyEntries} loading={loading} onRefresh={() => void load()} scope="all" /> : null}
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

function AdminHistoryPanel({ entries, loading, onRefresh, scope }: { entries: AdminHistoryResponse["data"]; loading: boolean; onRefresh: () => void; scope: "all" | "mine" }) {
  const isMine = scope === "mine";
  return <section aria-labelledby={isMine ? "admin-approval-history-title" : "admin-history-title"} className="grid gap-5">
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-slate-50/70 px-5 py-4">
        <div><h2 id={isMine ? "admin-approval-history-title" : "admin-history-title"} className="!text-base !font-bold text-slate-950">{isMine ? "Các milestone tôi đã duyệt" : "Các hoạt động gần đây"}</h2><p className="mt-1 text-xs text-slate-500">{isMine ? "Log này không bao gồm các thao tác cấu hình khác." : "Chỉ hiển thị các sự kiện quản trị quan trọng, không lưu thao tác xem hoặc lọc dữ liệu."}</p></div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">{entries.length} bản ghi</span>
          <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</button>
        </div>
      </div>
      {loading && !entries.length ? <div className="p-10 text-center text-sm text-slate-500">Đang tải lịch sử…</div> : null}
      {!loading && !entries.length ? <div className="p-12 text-center"><Clock3 className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-900">Chưa có lịch sử</p><p className="mt-1 text-xs text-slate-500">Các thao tác phù hợp sẽ xuất hiện tại đây.</p></div> : null}
      {entries.length ? <ol className="divide-y divide-border">{entries.map((entry) => <li key={entry.id} className="flex gap-3 px-5 py-4 sm:px-6">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${historyIconTone(entry.category)}`}>{historyIcon(entry.category)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold text-slate-900">{entry.title}</p><time dateTime={entry.createdAt} className="text-[11px] font-medium text-slate-400">{new Date(entry.createdAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</time></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600"><span className="font-semibold text-slate-800">{entry.actorDisplayName ?? "Hệ thống"}</span> · {entry.detail}</p>
          {entry.href ? <a href={entry.href} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Mở chi tiết</a> : null}
        </div>
      </li>)}</ol> : null}
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

      <section aria-labelledby="admin-approval-queue-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 id="admin-approval-queue-title" className="!text-base !font-bold text-slate-950">Danh sách yêu cầu</h2>
            <p className="mt-1 text-xs text-slate-500">Mỗi hồ sơ cho biết project, milestone, người gửi, người duyệt và quyền xử lý hiện tại.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{rows.length} đang chờ</span>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</button>
          </div>
        </div>

        {loading && !rows.length ? <div className="space-y-3 p-5" aria-busy="true" aria-label="Đang tải hàng chờ duyệt"><div className="h-24 animate-pulse rounded-2xl bg-slate-100" /><div className="h-24 animate-pulse rounded-2xl bg-slate-100" /></div> : null}
        {!loading && !rows.length ? <div className="p-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></span><p className="mt-4 text-sm font-bold text-slate-900">Không còn hồ sơ chờ duyệt</p><p className="mt-1 text-xs text-slate-500">Khi user gửi yêu cầu, hồ sơ sẽ xuất hiện tại đây.</p></div> : null}
        {rows.length ? <div className="divide-y divide-border">
          {rows.map((row) => <article key={row.id} className="grid min-w-0 gap-5 p-5 transition-colors hover:bg-slate-50/60 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.8fr)_auto] lg:items-center lg:px-6">
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
  return <section aria-label="Chi tiết cảnh báo" className="grid gap-5">
    <section aria-label="Alert summary" className="grid gap-3 sm:grid-cols-2"><Metric icon={<ShieldAlert className="h-4 w-4" />} label="Cần xử lý ngay" value={critical + warning} tone="rose" /><Metric icon={<TimerReset className="h-4 w-4" />} label="Task liên quan" value={affectedTasks} tone="indigo" /></section>
    <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5"><FilterBar onReset={search || typeFilter !== "all" || severityFilter !== "all" ? () => { setSearch(""); setTypeFilter("all"); setSeverityFilter("all"); } : undefined} actions={<button type="button" onClick={onRefresh} className="inline-flex h-10 items-center justify-center gap-2 shrink-0 rounded-[10px] border border-border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Làm mới dữ liệu</button>}><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo project, mã project hoặc nguyên nhân…" className="h-10 w-full rounded-[10px] border border-border bg-white pl-9 pr-3 text-sm outline-none ring-primary/30 focus:ring-2" /></div><FilterField className="w-full sm:w-56"><CrmSelect ariaLabel="Loại cảnh báo" options={[{ value: "all", label: "Tất cả loại cảnh báo" }, ...Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => ({ value, label }))]} value={typeFilter} onChange={(value) => setTypeFilter(value as typeof typeFilter)} /></FilterField><FilterField className="w-full sm:w-40"><CrmSelect ariaLabel="Mức độ" options={[{ value: "all", label: "Tất cả mức độ" }, { value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} value={severityFilter} onChange={(value) => setSeverityFilter(value as typeof severityFilter)} /></FilterField></FilterBar><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Hiển thị {filtered.length}/{rows.length} cảnh báo</span><span>{new Date().toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</span></div></section>
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="flex flex-col gap-1 border-b border-border bg-gradient-to-r from-amber-50 via-white to-sky-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h3 className="text-base font-bold text-slate-950">Estimate Hour và Actual Hour</h3><p className="mt-1 text-xs text-slate-500">Mỗi dòng là một nguyên nhân cảnh báo độc lập; một project có thể xuất hiện nhiều dòng.</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-bold">Project</th><th className="px-4 py-3 text-right font-bold">Estimate</th><th className="px-4 py-3 text-right font-bold">Actual</th><th className="px-4 py-3 text-right font-bold">Chênh lệch</th><th className="px-4 py-3 font-bold">Cảnh báo</th><th className="px-5 py-3 font-bold">Chi tiết cần xử lý</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{filtered.map((row) => <tr key={row.id} className="align-top transition hover:bg-slate-50/80"><td className="px-5 py-4"><a href={row.href} className="group block min-w-[220px]"><span className="block font-bold text-slate-900 group-hover:text-primary">{row.project.name}</span><span className="mt-1 block text-xs font-medium text-slate-500">{row.project.code}</span></a></td><td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">{formatAlertHours(row.estimateMinutes)}</td><td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">{formatAlertHours(row.actualMinutes)}</td><td className={`px-4 py-4 text-right font-bold tabular-nums ${row.varianceMinutes > 0 ? "text-rose-600" : "text-slate-500"}`}>{row.varianceMinutes > 0 ? "+" : ""}{formatAlertHours(row.varianceMinutes)}</td><td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${alertBadgeClass(row)}`}>{ALERT_TYPE_LABELS[row.type]}</span><span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.severity}</span></td><td className="max-w-[390px] px-5 py-4 text-xs leading-relaxed text-slate-600">{row.detail}<span className="mt-1 block font-semibold text-slate-400">{row.affectedTaskCount} task liên quan</span></td><td className="px-4 py-4"><a aria-label={`Mở project ${row.project.name}`} href={row.href} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ExternalLink className="h-3.5 w-3.5" /></a></td></tr>)}{loading && !rows.length ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">Đang tổng hợp cảnh báo từ task và time entry…</td></tr> : null}{!loading && !filtered.length ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">Không có cảnh báo phù hợp bộ lọc hiện tại.</td></tr> : null}</tbody></table></div></section>
    <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs leading-relaxed text-sky-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> “Thiếu dữ liệu” chỉ là tín hiệu cần bổ sung record; hệ thống không tự kết luận hiệu suất khi chưa đủ estimate, actual hoặc deadline.</div>
  </section>;
}

type TemplateStageDraft = { id: string; stageKey?: string; activity: string; phase?: string; criteria?: string; slaDays?: number; upbaseRole?: string; customerRole?: string; tasks?: ProjectTaskTemplateInput[] };
type TemplateMilestoneDraft = Omit<CreateProjectMilestoneInput, "stages" | "requiredDocumentTypes"> & { id: string; requiredDocumentTypes: string; stages: TemplateStageDraft[] };
type TemplateDraft = { id?: string; key: string; name: string; description: string; readOnly?: boolean; milestones: TemplateMilestoneDraft[] };

function parseRequiredDocumentTypes(value: string | readonly string[]) {
  const values = typeof value === "string" ? value.split(",") : value;
  const seen = new Set<string>();
  return values.reduce<string[]>((types, item) => {
    const label = String(item ?? "").trim();
    const key = label.toLocaleLowerCase("en-US");
    if (key && !seen.has(key)) {
      seen.add(key);
      types.push(label);
    }
    return types;
  }, []);
}

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
      requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
      requiredDocumentTypes: parseRequiredDocumentTypes(milestone.requiredDocumentTypes ?? []).join(", "),
      evidenceMode: milestone.evidenceMode ?? "file_or_link",
      ownerTeamId: milestone.ownerTeamId ?? "",
      unlockCriteria: milestone.unlockCriteria ?? "",
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerMode: milestone.reviewerMode ?? "workspace_admin",
      reviewerUserId: milestone.reviewerUserId ?? "",
      stages: milestone.stages.map((stage, stageIndex) => ({ id: `stage-${milestoneIndex}-${stageIndex}-${template.id}`, ...stage, tasks: stage.tasks ?? [] }))
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
      evidenceMode: "file_or_link",
      ownerTeamId: "",
      unlockCriteria: "",
      customerConfirmationRequired: false,
      reviewerMode: "workspace_admin",
      reviewerUserId: "",
      stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage", tasks: [] }]
    }]
  };
}

function TemplateStageEditor({
  stage,
  index,
  readOnly,
  canDelete,
  onChange,
  onDelete
}: {
  stage: TemplateStageDraft;
  index: number;
  readOnly?: boolean;
  canDelete: boolean;
  onChange: (patch: Partial<TemplateStageDraft>) => void;
  onDelete: () => void;
}) {
  const tasks = stage.tasks ?? [];
  const updateTask = (taskIndex: number, patch: Partial<ProjectTaskTemplateInput>) => onChange({ tasks: tasks.map((task, currentIndex) => currentIndex === taskIndex ? { ...task, ...patch } : task) });
  const deleteTask = (taskIndex: number) => onChange({ tasks: tasks.filter((_, currentIndex) => currentIndex !== taskIndex) });
  return <div className="rounded-xl border border-indigo-100 bg-indigo-50/35 p-3">
    <div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-[10px] font-bold text-indigo-700">S{index + 1}</span><input disabled={readOnly} value={stage.activity} onChange={(event) => onChange({ activity: event.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 text-sm font-semibold disabled:bg-slate-100" placeholder="Tên stage" />{canDelete && !readOnly ? <button type="button" onClick={onDelete} className="text-xs font-semibold text-rose-600">Xóa</button> : null}</div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2"><input disabled={readOnly} value={stage.criteria ?? ""} onChange={(event) => onChange({ criteria: event.target.value })} className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" placeholder="Tiêu chí hoàn thành stage" /><input disabled={readOnly} type="number" min="0" value={stage.slaDays ?? ""} onChange={(event) => onChange({ slaDays: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) })} className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" placeholder="SLA (ngày)" /></div>
    <div className="mt-3 border-l-2 border-indigo-200 pl-3"><div className="flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">TASK TRONG STAGE</p><p className="text-[10px] text-slate-500">Các việc cần làm để hoàn tất stage</p></div>{!readOnly ? <button type="button" onClick={() => onChange({ tasks: [...tasks, { title: `Task ${tasks.length + 1}`, subtasks: [] }] })} className="text-xs font-bold text-primary hover:underline">+ Thêm task</button> : null}</div><div className="mt-2 space-y-2">{tasks.map((task, taskIndex) => <div key={`${stage.id}-task-${taskIndex}`} className="rounded-lg border border-border bg-white p-2.5"><div className="flex items-center gap-2"><span className="text-[10px] font-bold text-primary">T{taskIndex + 1}</span><input disabled={readOnly} value={task.title} onChange={(event) => updateTask(taskIndex, { title: event.target.value })} className="h-8 min-w-0 flex-1 rounded-lg border border-border px-2 text-xs font-medium disabled:bg-slate-100" placeholder="Tên task" />{!readOnly ? <button type="button" onClick={() => deleteTask(taskIndex)} className="text-[10px] font-semibold text-rose-600">Xóa</button> : null}</div><div className="mt-2 flex flex-wrap items-center gap-2"><input disabled={readOnly} type="number" min="0" value={task.estimateMinutes ?? ""} onChange={(event) => updateTask(taskIndex, { estimateMinutes: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) })} className="h-7 w-28 rounded-md border border-border px-2 text-[10px] disabled:bg-slate-100" placeholder="Estimate (phút)" /><span className="text-[10px] text-slate-400">Task mặc định: Todo · Medium</span></div>{(task.subtasks ?? []).length ? <div className="mt-2 space-y-1 border-l-2 border-primary/15 pl-3">{(task.subtasks ?? []).map((subtask, subtaskIndex) => <div key={`${stage.id}-task-${taskIndex}-subtask-${subtaskIndex}`} className="flex items-center gap-1.5"><span className="text-[9px] font-semibold text-primary/70">ST{subtaskIndex + 1}</span><input disabled={readOnly} value={subtask.title} onChange={(event) => updateTask(taskIndex, { subtasks: (task.subtasks ?? []).map((child, currentIndex) => currentIndex === subtaskIndex ? { ...child, title: event.target.value } : child) })} className="h-7 min-w-0 flex-1 rounded-md border border-border px-2 text-[10px] disabled:bg-slate-100" placeholder="Tên subtask" />{!readOnly ? <button type="button" onClick={() => updateTask(taskIndex, { subtasks: (task.subtasks ?? []).filter((_, currentIndex) => currentIndex !== subtaskIndex) })} className="text-[9px] text-rose-600">Xóa</button> : null}</div>)}</div> : null}{!readOnly ? <button type="button" onClick={() => updateTask(taskIndex, { subtasks: [...(task.subtasks ?? []), { title: `Subtask ${(task.subtasks?.length ?? 0) + 1}`, subtasks: [] }] })} className="mt-2 text-[10px] font-semibold text-primary hover:underline">+ Thêm subtask</button> : null}</div>)}{!tasks.length ? <p className="rounded-lg border border-dashed border-indigo-200 bg-white/60 px-3 py-2 text-[10px] italic text-slate-500">Stage này chưa có task. Thêm task để template trở thành checklist thực thi.</p> : null}</div></div>
  </div>;
}

function TemplateTaskTreeEditor({
  draft,
  onUpdateStage
}: {
  draft: TemplateDraft | null;
  onUpdateStage: (milestoneId: string, stageId: string, patch: Partial<TemplateStageDraft>) => void;
}) {
  if (!draft) return null;
  const taskCount = draft.milestones.reduce((total, milestone) => total + milestone.stages.reduce((stageTotal, stage) => stageTotal + (stage.tasks?.length ?? 0), 0), 0);
  return <section aria-labelledby="template-task-tree-title" className="rounded-3xl border border-indigo-100 bg-indigo-50/30 p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">PROJECT CHECKLIST</p><h3 id="template-task-tree-title" className="mt-1 text-lg font-bold tracking-tight text-slate-950">Task & Subtask theo từng Stage</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">Template không chỉ tạo khung milestone/stage mà còn tạo sẵn checklist để team bắt tay vào làm project.</p></div><span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-bold text-indigo-700">{taskCount} task</span></div><div className="mt-4 space-y-3">{draft.milestones.map((milestone, milestoneIndex) => <article key={milestone.id} className="rounded-2xl border border-border bg-white p-3 sm:p-4"><div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[11px] font-black text-violet-700">M{milestoneIndex + 1}</span><div><h4 className="text-sm font-bold text-slate-900">{milestone.name}</h4><p className="text-[11px] text-slate-500">{milestone.stages.length} stage · {milestone.stages.reduce((total, stage) => total + (stage.tasks?.length ?? 0), 0)} task</p></div></div><div className="mt-3 space-y-2 border-l-2 border-indigo-200 pl-3">{milestone.stages.map((stage, stageIndex) => <TemplateStageEditor key={stage.id} stage={stage} index={stageIndex} readOnly={draft.readOnly} canDelete={false} onChange={(patch) => onUpdateStage(milestone.id, stage.id, patch)} onDelete={() => undefined} />)}</div></article>)}</div></section>;
}

function MilestoneTemplateManagerV2({
  templates,
  loading,
  saving,
  onCreate,
  onUpdate
}: {
  templates: ProjectMilestoneTemplateSummary[];
  loading: boolean;
  saving: boolean;
  teams: WorkspaceReminderTeamOption[];
  users: WorkspaceReminderRecipientOption[];
  onCreateTeam: (input: { name: string; code?: string }) => Promise<WorkspaceReminderTeamOption | void>;
  onCreate: (input: CreateProjectMilestoneTemplateInput) => Promise<ProjectMilestoneTemplateSummary | void>;
  onUpdate: (templateId: string, input: UpdateProjectMilestoneTemplateInput) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedMilestoneIndex, setSelectedMilestoneIndex] = useState(0);

  useEffect(() => {
    if (isCreating) return;
    const active = templates.find((template) => template.id === activeId) ?? templates[0];
    setActiveId(active?.id ?? "");
    setDraft(active ? templateToDraft(active) : null);
    setSelectedMilestoneIndex(0);
  }, [activeId, isCreating, templates]);

  const updateDraft = (patch: Partial<TemplateDraft>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const updateMilestone = (id: string, patch: Partial<TemplateMilestoneDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone) } : current);
  const updateStage = (milestoneId: string, stageId: string, patch: Partial<TemplateStageDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, stages: milestone.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage) } : milestone) } : current);

  const save = async () => {
    if (!draft || draft.readOnly || !draft.name.trim() || saving) return;
    const milestones: CreateProjectMilestoneInput[] = draft.milestones.map((milestone, milestoneIndex) => ({
      name: milestone.name.trim(),
      sortOrder: (milestoneIndex + 1) * 10,
      requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
      requiredDocumentTypes: parseRequiredDocumentTypes(milestone.requiredDocumentTypes),
      evidenceMode: milestone.evidenceMode,
      unlockCriteria: milestone.unlockCriteria?.trim() || undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerMode: milestone.reviewerMode ?? "workspace_admin",
      reviewerUserId: milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId || undefined : undefined,
      stages: milestone.stages.map((stage, stageIndex) => ({
        stageKey: stage.stageKey || `${milestone.id}-${stageIndex + 1}`,
        activity: stage.activity.trim(),
        phase: stage.phase?.trim() || stage.activity.trim(),
        criteria: stage.criteria?.trim() || undefined,
        slaDays: stage.slaDays,
        upbaseRole: stage.upbaseRole?.trim() || undefined,
        customerRole: stage.customerRole?.trim() || undefined,
        tasks: stage.tasks ?? []
      }))
    }));
    if (isCreating) {
      const created = await onCreate({ key: draft.key.trim() || undefined, name: draft.name.trim(), description: draft.description.trim() || undefined, milestones });
      if (created) { setActiveId(created.id); setDraft(templateToDraft(created)); setIsCreating(false); setSelectedMilestoneIndex(0); }
    } else if (draft.id) {
      await onUpdate(draft.id, { name: draft.name.trim(), description: draft.description.trim(), milestones });
    }
  };

  const startCreate = () => { setDraft(emptyTemplateDraft()); setActiveId(""); setIsCreating(true); setSelectedMilestoneIndex(0); };
  const duplicate = () => { if (!draft) return; setDraft({ ...draft, id: undefined, key: `${draft.key}-custom`, name: `${draft.name} · bản tuỳ chỉnh`, readOnly: false }); setIsCreating(true); setActiveId(""); };
  const selectedMilestone = draft?.milestones[selectedMilestoneIndex];
  const totalStages = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0) ?? 0;
  const totalTasks = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageSum, stage) => stageSum + (stage.tasks?.length ?? 0), 0), 0) ?? 0;

  return <section aria-labelledby="milestone-template-v2-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
    <div className="border-b border-border bg-gradient-to-r from-indigo-50 via-white to-sky-50 px-5 py-5 sm:px-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">PROJECT TEMPLATE BUILDER</p><h2 id="milestone-template-v2-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Cấu hình quy trình Project</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Tạo checklist thực thi theo cây Milestone → Stage → Task → Subtask. Chọn một milestone ở cột trái để chỉnh nội dung ở cột phải.</p></div><div className="flex gap-2">{draft?.readOnly ? <button type="button" onClick={duplicate} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-indigo-200 bg-white px-4 text-sm font-bold text-indigo-700 hover:bg-indigo-50">Tạo bản sao để chỉnh sửa</button> : <button type="button" disabled={!draft || saving} onClick={() => void save()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : isCreating ? "Lưu template" : "Lưu thay đổi"}</button>}<button type="button" onClick={startCreate} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 text-sm font-bold text-primary hover:bg-primary/10">+ Template mới</button></div></div></div>
    {loading ? <div className="p-8 text-center text-sm text-slate-500">Đang tải template…</div> : !draft ? <div className="p-10 text-center text-sm text-slate-500">Chưa có template. Bấm “Template mới” để bắt đầu.</div> : <div className="grid min-w-0 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-slate-50/70 p-4 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">TEMPLATE</p><p className="mt-1 text-xs text-slate-500">Chọn quy trình cần chỉnh</p></div><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-500">{templates.length}</span></div><div className="mt-3 space-y-2">{templates.map((template) => <button type="button" key={template.id} onClick={() => { setIsCreating(false); setActiveId(template.id); setDraft(templateToDraft(template)); setSelectedMilestoneIndex(0); }} className={`w-full rounded-xl border p-3 text-left transition ${template.id === activeId && !isCreating ? "border-indigo-300 bg-white shadow-sm" : "border-transparent bg-white/60 hover:border-border hover:bg-white"}`}><div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-sm font-bold text-slate-900">{template.name}</span>{template.readOnly ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Mặc định</span> : null}</div><p className="mt-1 text-[11px] text-slate-500">{template.milestoneCount} milestone · {template.stageCount} stage</p></button>)}</div><div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">CẤU TRÚC</p><span className="text-[10px] text-slate-500">{draft.milestones.length}M · {totalStages}S · {totalTasks}T</span></div><div className="mt-2 space-y-1">{draft.milestones.map((milestone, index) => <button type="button" key={milestone.id} onClick={() => setSelectedMilestoneIndex(index)} className={`w-full rounded-lg px-2.5 py-2 text-left ${selectedMilestoneIndex === index ? "bg-indigo-100 text-indigo-950" : "hover:bg-white"}`}><span className="flex items-center gap-2"><span className="font-bold text-[10px] text-indigo-700">M{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold">{milestone.name}</span><span className="text-[10px] text-slate-500">{milestone.stages.length}S</span></span></button>)}</div>{!draft.readOnly ? <button type="button" onClick={() => { const nextIndex = draft.milestones.length; updateDraft({ milestones: [...draft.milestones, { id: `milestone-${Date.now()}`, name: `Milestone ${nextIndex + 1}`, sortOrder: (nextIndex + 1) * 10, requiredDocumentCount: 0, requiredDocumentTypes: "", unlockCriteria: "", customerConfirmationRequired: false, reviewerMode: "workspace_admin", reviewerUserId: "", stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage", tasks: [] }] }] }); setSelectedMilestoneIndex(nextIndex); }} className="mt-2 w-full rounded-lg border border-dashed border-indigo-200 px-2.5 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">+ Thêm milestone</button> : null}</div></aside>
      <main className="min-w-0 p-4 sm:p-6"><div className="grid gap-3 sm:grid-cols-3"><label><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Tên template</span><input disabled={draft.readOnly} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold disabled:bg-slate-50" /></label><label><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Mã template</span><input disabled={draft.readOnly || !isCreating} value={draft.key} onChange={(event) => updateDraft({ key: event.target.value })} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm disabled:bg-slate-50" /></label><div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2.5"><p className="text-[11px] font-bold text-indigo-700">TỔNG QUAN</p><p className="mt-1 text-xs text-indigo-950">{draft.milestones.length} milestone · {totalStages} stage · {totalTasks} task</p></div></div><label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Mô tả sử dụng</span><textarea disabled={draft.readOnly} rows={2} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-sm disabled:bg-slate-50" /></label>{selectedMilestone ? <div className="mt-5 rounded-2xl border border-border bg-slate-50/60 p-4"><div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-black text-violet-700">M{selectedMilestoneIndex + 1}</span><div className="min-w-0 flex-1"><input disabled={draft.readOnly} value={selectedMilestone.name} onChange={(event) => updateMilestone(selectedMilestone.id, { name: event.target.value })} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-base font-bold disabled:bg-slate-100" /><p className="mt-1 text-xs text-slate-500">Cấu hình gate và checklist cho milestone này</p></div>{!draft.readOnly && draft.milestones.length > 1 ? <button type="button" onClick={() => { updateDraft({ milestones: draft.milestones.filter((item) => item.id !== selectedMilestone.id) }); setSelectedMilestoneIndex(Math.max(0, selectedMilestoneIndex - 1)); }} className="text-xs font-semibold text-rose-600">Xóa</button> : null}</div><div className="mt-4 grid gap-3 rounded-xl border border-border bg-white p-3 sm:grid-cols-3"><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Hồ sơ tối thiểu</span><input disabled={draft.readOnly} type="number" min="0" value={selectedMilestone.requiredDocumentCount || 0} onChange={(event) => updateMilestone(selectedMilestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-9 w-full rounded-lg border border-border px-2.5 text-sm disabled:bg-slate-50" /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Loại hồ sơ</span><input disabled={draft.readOnly} value={selectedMilestone.requiredDocumentTypes} onChange={(event) => updateMilestone(selectedMilestone.id, { requiredDocumentTypes: event.target.value })} placeholder="BRD, FRD, SRS" className="h-9 w-full rounded-lg border border-border px-2.5 text-sm disabled:bg-slate-50" /></label><label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600"><input disabled={draft.readOnly} type="checkbox" checked={Boolean(selectedMilestone.customerConfirmationRequired)} onChange={(event) => updateMilestone(selectedMilestone.id, { customerConfirmationRequired: event.target.checked })} className="h-4 w-4 rounded border-border text-primary" /> Khách hàng xác nhận</label><label className="sm:col-span-3"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Điều kiện mở milestone tiếp theo</span><textarea disabled={draft.readOnly} rows={2} value={selectedMilestone.unlockCriteria ?? ""} onChange={(event) => updateMilestone(selectedMilestone.id, { unlockCriteria: event.target.value })} className="w-full resize-none rounded-lg border border-border px-2.5 py-2 text-sm disabled:bg-slate-50" /></label></div><div className="mt-5 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-950">Các Stage & checklist</h3><p className="mt-0.5 text-xs text-slate-500">Mỗi Stage có thể chứa nhiều Task và Subtask.</p></div>{!draft.readOnly ? <button type="button" onClick={() => updateMilestone(selectedMilestone.id, { stages: [...selectedMilestone.stages, { id: `stage-${Date.now()}`, activity: `Stage ${selectedMilestone.stages.length + 1}`, phase: "stage", tasks: [] }] })} className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10">+ Thêm stage</button> : null}</div><div className="mt-3 space-y-3">{selectedMilestone.stages.map((stage, stageIndex) => <TemplateStageEditor key={stage.id} stage={stage} index={stageIndex} readOnly={draft.readOnly} canDelete={selectedMilestone.stages.length > 1} onChange={(patch) => updateStage(selectedMilestone.id, stage.id, patch)} onDelete={() => updateMilestone(selectedMilestone.id, { stages: selectedMilestone.stages.filter((item) => item.id !== stage.id) })} />)}</div></div> : null}</main>
    </div>}
  </section>;
}

function MilestoneTemplateManagerV4({
  templates,
  loading,
  saving,
  onCreate,
  onUpdate
}: {
  templates: ProjectMilestoneTemplateSummary[];
  loading: boolean;
  saving: boolean;
  teams: WorkspaceReminderTeamOption[];
  users: WorkspaceReminderRecipientOption[];
  onCreateTeam: (input: { name: string; code?: string }) => Promise<WorkspaceReminderTeamOption | void>;
  onCreate: (input: CreateProjectMilestoneTemplateInput) => Promise<ProjectMilestoneTemplateSummary | void>;
  onUpdate: (templateId: string, input: UpdateProjectMilestoneTemplateInput) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [openMilestone, setOpenMilestone] = useState(0);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  useEffect(() => {
    if (isCreating) return;
    const active = templates.find((template) => template.id === activeId) ?? templates[0];
    setActiveId(active?.id ?? "");
    setDraft(active ? templateToDraft(active) : null);
    setOpenMilestone(0);
  }, [activeId, isCreating, templates]);

  const updateDraft = (patch: Partial<TemplateDraft>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const updateMilestone = (id: string, patch: Partial<TemplateMilestoneDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
  const updateStage = (milestoneId: string, stageId: string, patch: Partial<TemplateStageDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, stages: milestone.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage) } : milestone) } : current);

  const totalStages = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0) ?? 0;
  const totalTasks = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageSum, stage) => stageSum + (stage.tasks?.length ?? 0), 0), 0) ?? 0;

  const save = async () => {
    if (!draft || draft.readOnly || !draft.name.trim() || saving) return;
    const milestones: CreateProjectMilestoneInput[] = draft.milestones.map((milestone, milestoneIndex) => ({
      name: milestone.name.trim(), sortOrder: (milestoneIndex + 1) * 10,
      requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
      requiredDocumentTypes: parseRequiredDocumentTypes(milestone.requiredDocumentTypes),
      evidenceMode: milestone.evidenceMode, unlockCriteria: milestone.unlockCriteria?.trim() || undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired), reviewerMode: milestone.reviewerMode ?? "workspace_admin",
      reviewerUserId: milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId || undefined : undefined,
      stages: milestone.stages.map((stage, stageIndex) => ({
        stageKey: stage.stageKey || `${milestone.id}-${stageIndex + 1}`, activity: stage.activity.trim(), phase: stage.phase?.trim() || stage.activity.trim(),
        criteria: stage.criteria?.trim() || undefined, slaDays: stage.slaDays, upbaseRole: stage.upbaseRole?.trim() || undefined,
        customerRole: stage.customerRole?.trim() || undefined, tasks: stage.tasks ?? []
      }))
    }));
    if (isCreating) {
      const created = await onCreate({ key: draft.key.trim() || undefined, name: draft.name.trim(), description: draft.description.trim() || undefined, milestones });
      if (created) { setActiveId(created.id); setDraft(templateToDraft(created)); setIsCreating(false); setOpenMilestone(0); }
    } else if (draft.id) await onUpdate(draft.id, { name: draft.name.trim(), description: draft.description.trim(), milestones });
  };

  const startCreate = () => { setDraft(emptyTemplateDraft()); setActiveId(""); setIsCreating(true); setOpenMilestone(0); };
  const duplicate = () => { if (!draft) return; setDraft({ ...draft, id: undefined, key: `${draft.key}-custom`, name: `${draft.name} · bản tuỳ chỉnh`, readOnly: false }); setActiveId(""); setIsCreating(true); };
  const addMilestone = () => {
    if (!draft) return;
    const index = draft.milestones.length;
    updateDraft({ milestones: [...draft.milestones, { id: `milestone-${Date.now()}`, name: `Milestone ${index + 1}`, sortOrder: (index + 1) * 10, requiredDocumentCount: 0, requiredDocumentTypes: "", evidenceMode: "file_or_link", unlockCriteria: "", customerConfirmationRequired: false, reviewerMode: "workspace_admin", reviewerUserId: "", stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage", tasks: [] }] }] });
    setOpenMilestone(index);
  };

  if (loading) return <section className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Đang tải template…</section>;
  if (!draft) return <section className="rounded-2xl border border-border bg-card p-10 text-center"><p className="text-sm text-muted-foreground">Chưa có template.</p><button type="button" onClick={startCreate} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">+ Tạo template</button></section>;

  return <section aria-labelledby="milestone-template-v4-title" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <header className="border-b border-border px-5 py-5 sm:px-7"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">TEMPLATE WORKFLOW</p><h2 id="milestone-template-v4-title" className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Quy trình Project</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Thiết lập theo đúng thứ tự thực hiện. Mở một Milestone để chỉnh Stage và checklist công việc.</p></div><div className="flex flex-wrap gap-2">{draft.readOnly ? <button type="button" onClick={duplicate} className="min-h-10 rounded-lg border border-primary/25 bg-primary/5 px-3 text-sm font-bold text-primary">Tạo bản sao để sửa</button> : <button type="button" disabled={saving} onClick={() => void save()} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{saving ? "Đang lưu…" : isCreating ? "Lưu template" : "Lưu thay đổi"}</button>}<button type="button" onClick={startCreate} className="min-h-10 rounded-lg border border-border bg-white px-3 text-sm font-bold hover:bg-muted">+ Template mới</button></div></div></header>
    <div className="border-b border-border bg-slate-50/70 px-5 py-4 sm:px-7"><div className="grid gap-3 lg:grid-cols-[minmax(260px,1.1fr)_minmax(220px,1fr)_auto] lg:items-end"><div className="relative"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Template đang chỉnh</span><button type="button" onClick={() => setTemplatePickerOpen((open) => !open)} aria-expanded={templatePickerOpen} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-primary/50 bg-white px-3 text-left shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-black text-primary-foreground">{isCreating ? "+" : (draft.name.trim().charAt(0).toUpperCase() || "T")}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{isCreating ? "Template mới" : draft.name}</span><span className="block truncate text-[10px] text-slate-500">{isCreating ? "Đang tạo bản mới" : `${draft.milestones.length} milestone · ${totalStages} stage`}</span></span><span className="text-xs text-slate-400">{templatePickerOpen ? "▲" : "▼"}</span></button>{templatePickerOpen ? <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-border bg-white p-1.5 shadow-xl"><p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Chọn quy trình</p>{templates.map((template) => <button type="button" key={template.id} onClick={() => { setIsCreating(false); setActiveId(template.id); setDraft(templateToDraft(template)); setOpenMilestone(0); setTemplatePickerOpen(false); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${template.id === activeId && !isCreating ? "bg-primary/10" : "hover:bg-slate-50"}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-black text-slate-600">{template.name.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-900">{template.name}</span><span className="block text-[10px] text-slate-500">{template.milestoneCount} milestone · {template.stageCount} stage</span></span>{template.readOnly ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">Mặc định</span> : null}</button>)}</div> : null}</div><label className="min-w-0"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tên template</span><input disabled={draft.readOnly} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold disabled:bg-slate-100" /></label><div className="flex gap-2"><div className="min-w-[70px] rounded-xl bg-violet-100 px-3 py-2 text-center"><strong className="block text-lg leading-5 text-violet-900">{draft.milestones.length}</strong><span className="text-[9px] font-bold uppercase tracking-wide text-violet-700">Milestone</span></div><div className="min-w-[70px] rounded-xl bg-sky-100 px-3 py-2 text-center"><strong className="block text-lg leading-5 text-sky-900">{totalStages}</strong><span className="text-[9px] font-bold uppercase tracking-wide text-sky-700">Stage</span></div><div className="min-w-[70px] rounded-xl bg-emerald-100 px-3 py-2 text-center"><strong className="block text-lg leading-5 text-emerald-900">{totalTasks}</strong><span className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Task</span></div></div></div><label className="mt-3 block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Mô tả</span><textarea disabled={draft.readOnly} rows={2} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm disabled:bg-slate-100" placeholder="Template này dùng cho loại project nào?" /></label></div>
    <div className="space-y-3 p-4 sm:p-6">{draft.milestones.map((milestone, index) => { const isOpen = openMilestone === index; const taskCount = milestone.stages.reduce((sum, stage) => sum + (stage.tasks?.length ?? 0), 0); return <article key={milestone.id} className={`overflow-hidden rounded-xl border ${isOpen ? "border-primary/40" : "border-border"}`}><button type="button" onClick={() => setOpenMilestone(isOpen ? -1 : index)} aria-expanded={isOpen} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${isOpen ? "bg-primary/[0.04]" : "bg-white hover:bg-slate-50"}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black ${isOpen ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-500"}`}>M{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-950">{milestone.name || "Chưa đặt tên milestone"}</span><span className="mt-0.5 block text-[11px] text-slate-500">{milestone.stages.length} stage · {taskCount} task</span></span><span className="text-lg text-slate-400">{isOpen ? "−" : "+"}</span></button>{isOpen ? <div className="border-t border-border bg-white p-4 sm:p-5"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]"><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tên milestone</span><input disabled={draft.readOnly} value={milestone.name} onChange={(event) => updateMilestone(milestone.id, { name: event.target.value })} className="h-10 w-full rounded-lg border border-border px-3 text-sm font-bold disabled:bg-slate-100" /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Hồ sơ tối thiểu</span><input disabled={draft.readOnly} type="number" min="0" value={milestone.requiredDocumentCount || 0} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-10 w-full rounded-lg border border-border px-3 text-sm disabled:bg-slate-100" /></label></div><div className="mt-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Điều kiện chuyển tiếp</label><textarea disabled={draft.readOnly} rows={2} value={milestone.unlockCriteria ?? ""} onChange={(event) => updateMilestone(milestone.id, { unlockCriteria: event.target.value })} className="mt-1 w-full resize-none rounded-lg border border-border px-3 py-2 text-sm disabled:bg-slate-100" placeholder="Điều kiện để mở milestone tiếp theo" /></div><div className="mt-5 flex items-center justify-between border-t border-border pt-4"><div><h3 className="text-sm font-bold text-slate-950">Các stage trong milestone</h3><p className="mt-0.5 text-xs text-slate-500">Mỗi stage có thể chứa nhiều task và subtask.</p></div>{!draft.readOnly ? <button type="button" onClick={() => updateMilestone(milestone.id, { stages: [...milestone.stages, { id: `stage-${Date.now()}`, activity: `Stage ${milestone.stages.length + 1}`, phase: "stage", tasks: [] }] })} className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs font-bold text-primary">+ Thêm stage</button> : null}</div><div className="mt-3 space-y-3">{milestone.stages.map((stage, stageIndex) => <TemplateStageEditor key={stage.id} stage={stage} index={stageIndex} readOnly={draft.readOnly} canDelete={!draft.readOnly && milestone.stages.length > 1} onChange={(patch) => updateStage(milestone.id, stage.id, patch)} onDelete={() => updateMilestone(milestone.id, { stages: milestone.stages.filter((item) => item.id !== stage.id) })} />)}</div>{!draft.readOnly && draft.milestones.length > 1 ? <button type="button" onClick={() => { updateDraft({ milestones: draft.milestones.filter((_, currentIndex) => currentIndex !== index) }); setOpenMilestone(Math.max(0, index - 1)); }} className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Xóa milestone này</button> : null}</div> : null}</article>; })}{!draft.readOnly ? <button type="button" onClick={addMilestone} className="w-full rounded-xl border border-dashed border-primary/35 bg-primary/[0.03] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/[0.07]">+ Thêm milestone</button> : null}</div>
  </section>;
}

function MilestoneTemplateManagerV3({
  templates,
  loading,
  saving,
  onCreate,
  onUpdate
}: {
  templates: ProjectMilestoneTemplateSummary[];
  loading: boolean;
  saving: boolean;
  teams: WorkspaceReminderTeamOption[];
  users: WorkspaceReminderRecipientOption[];
  onCreateTeam: (input: { name: string; code?: string }) => Promise<WorkspaceReminderTeamOption | void>;
  onCreate: (input: CreateProjectMilestoneTemplateInput) => Promise<ProjectMilestoneTemplateSummary | void>;
  onUpdate: (templateId: string, input: UpdateProjectMilestoneTemplateInput) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [milestoneIndex, setMilestoneIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (isCreating) return;
    const active = templates.find((template) => template.id === activeId) ?? templates[0];
    setActiveId(active?.id ?? "");
    setDraft(active ? templateToDraft(active) : null);
    setMilestoneIndex(0);
    setStageIndex(0);
  }, [activeId, isCreating, templates]);

  const updateDraft = (patch: Partial<TemplateDraft>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const updateMilestone = (id: string, patch: Partial<TemplateMilestoneDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone) } : current);
  const updateStage = (milestoneId: string, stageId: string, patch: Partial<TemplateStageDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, stages: milestone.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage) } : milestone) } : current);

  const selectedMilestone = draft?.milestones[milestoneIndex];
  const selectedStage = selectedMilestone?.stages[stageIndex];
  const totalStages = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0) ?? 0;
  const totalTasks = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageSum, stage) => stageSum + (stage.tasks?.length ?? 0), 0), 0) ?? 0;
  const totalSubtasks = draft?.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageSum, stage) => stageSum + (stage.tasks ?? []).reduce((taskSum, task) => taskSum + (task.subtasks?.length ?? 0), 0), 0), 0) ?? 0;

  useEffect(() => {
    if (!draft) return;
    const nextMilestone = draft.milestones[milestoneIndex];
    if (!nextMilestone) setMilestoneIndex(Math.max(0, draft.milestones.length - 1));
    if (nextMilestone && !nextMilestone.stages[stageIndex]) setStageIndex(Math.max(0, nextMilestone.stages.length - 1));
  }, [draft, milestoneIndex, stageIndex]);

  const save = async () => {
    if (!draft || draft.readOnly || !draft.name.trim() || saving) return;
    const milestones: CreateProjectMilestoneInput[] = draft.milestones.map((milestone, currentMilestoneIndex) => ({
      name: milestone.name.trim(),
      sortOrder: (currentMilestoneIndex + 1) * 10,
      requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
      requiredDocumentTypes: parseRequiredDocumentTypes(milestone.requiredDocumentTypes),
      evidenceMode: milestone.evidenceMode,
      unlockCriteria: milestone.unlockCriteria?.trim() || undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerMode: milestone.reviewerMode ?? "workspace_admin",
      reviewerUserId: milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId || undefined : undefined,
      stages: milestone.stages.map((stage, currentStageIndex) => ({
        stageKey: stage.stageKey || `${milestone.id}-${currentStageIndex + 1}`,
        activity: stage.activity.trim(),
        phase: stage.phase?.trim() || stage.activity.trim(),
        criteria: stage.criteria?.trim() || undefined,
        slaDays: stage.slaDays,
        upbaseRole: stage.upbaseRole?.trim() || undefined,
        customerRole: stage.customerRole?.trim() || undefined,
        tasks: stage.tasks ?? []
      }))
    }));
    if (isCreating) {
      const created = await onCreate({ key: draft.key.trim() || undefined, name: draft.name.trim(), description: draft.description.trim() || undefined, milestones });
      if (created) { setActiveId(created.id); setDraft(templateToDraft(created)); setIsCreating(false); setMilestoneIndex(0); setStageIndex(0); }
    } else if (draft.id) {
      await onUpdate(draft.id, { name: draft.name.trim(), description: draft.description.trim(), milestones });
    }
  };

  const selectTemplate = (template: ProjectMilestoneTemplateSummary) => {
    setIsCreating(false);
    setActiveId(template.id);
    setDraft(templateToDraft(template));
    setMilestoneIndex(0);
    setStageIndex(0);
  };
  const startCreate = () => { setDraft(emptyTemplateDraft()); setActiveId(""); setIsCreating(true); setMilestoneIndex(0); setStageIndex(0); };
  const duplicate = () => { if (!draft) return; setDraft({ ...draft, id: undefined, key: `${draft.key}-custom`, name: `${draft.name} · bản tuỳ chỉnh`, readOnly: false }); setIsCreating(true); setActiveId(""); };

  if (loading) return <section className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Đang tải thư viện template…</section>;
  if (!draft) return <section className="rounded-2xl border border-border bg-card p-10 text-center"><p className="text-sm text-muted-foreground">Chưa có template để cấu hình.</p><button type="button" onClick={startCreate} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">+ Tạo template đầu tiên</button></section>;

  const addMilestone = () => {
    const nextIndex = draft.milestones.length;
    updateDraft({ milestones: [...draft.milestones, { id: `milestone-${Date.now()}`, name: `Milestone ${nextIndex + 1}`, sortOrder: (nextIndex + 1) * 10, requiredDocumentCount: 0, requiredDocumentTypes: "", evidenceMode: "file_or_link", unlockCriteria: "", customerConfirmationRequired: false, reviewerMode: "workspace_admin", reviewerUserId: "", stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage", tasks: [] }] }] });
    setMilestoneIndex(nextIndex);
    setStageIndex(0);
  };
  const addStage = () => {
    if (!selectedMilestone) return;
    updateMilestone(selectedMilestone.id, { stages: [...selectedMilestone.stages, { id: `stage-${Date.now()}`, activity: `Stage ${selectedMilestone.stages.length + 1}`, phase: "stage", tasks: [] }] });
    setStageIndex(selectedMilestone.stages.length);
  };
  const updateTask = (taskIndex: number, patch: Partial<ProjectTaskTemplateInput>) => {
    if (!selectedMilestone || !selectedStage) return;
    const tasks = selectedStage.tasks ?? [];
    updateStage(selectedMilestone.id, selectedStage.id, { tasks: tasks.map((task, index) => index === taskIndex ? { ...task, ...patch } : task) });
  };
  const addTask = () => {
    if (!selectedMilestone || !selectedStage) return;
    const tasks = selectedStage.tasks ?? [];
    updateStage(selectedMilestone.id, selectedStage.id, { tasks: [...tasks, { title: `Task ${tasks.length + 1}`, subtasks: [] }] });
  };

  return <section aria-labelledby="milestone-template-v3-title" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <header className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">WORKFLOW STUDIO</p><h2 id="milestone-template-v3-title" className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Thiết kế quy trình Project</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Một màn hình để tạo checklist hoàn chỉnh: Milestone → Stage → Task → Subtask.</p></div>
      <div className="flex flex-wrap gap-2">{draft.readOnly ? <button type="button" onClick={duplicate} className="min-h-10 rounded-lg border border-primary/25 bg-primary/5 px-3 text-sm font-bold text-primary">Tạo bản sao</button> : <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : isCreating ? "Lưu template" : "Lưu thay đổi"}</button>}<button type="button" onClick={startCreate} className="min-h-10 rounded-lg border border-border bg-white px-3 text-sm font-bold text-foreground hover:bg-muted">+ Template mới</button></div>
    </header>
    <div className="grid min-w-0 lg:grid-cols-[230px_minmax(0,1fr)_290px]">
      <aside className="border-b border-border bg-slate-50/70 p-3 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Templates</p><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500">{templates.length}</span></div><div className="mt-2 space-y-1.5">{templates.map((template) => <button type="button" key={template.id} onClick={() => selectTemplate(template)} className={`w-full rounded-lg border px-3 py-2.5 text-left ${template.id === activeId && !isCreating ? "border-primary/40 bg-white shadow-sm" : "border-transparent hover:border-border hover:bg-white"}`}><span className="block truncate text-xs font-bold text-slate-900">{template.name}</span><span className="mt-1 block text-[10px] text-slate-500">{template.milestoneCount}M · {template.stageCount}S</span></button>)}</div><div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Milestones</p><span className="text-[10px] text-slate-500">{draft.milestones.length}</span></div><div className="mt-2 space-y-1">{draft.milestones.map((milestone, index) => <button type="button" key={milestone.id} onClick={() => { setMilestoneIndex(index); setStageIndex(0); }} className={`w-full rounded-lg px-2.5 py-2 text-left ${index === milestoneIndex ? "bg-primary/10 text-primary" : "hover:bg-white"}`}><span className="block truncate text-xs font-bold">M{index + 1} · {milestone.name}</span><span className="mt-0.5 block text-[10px] text-slate-500">{milestone.stages.length} stage</span></button>)}</div>{!draft.readOnly ? <button type="button" onClick={addMilestone} className="mt-2 w-full rounded-lg border border-dashed border-primary/30 px-2 py-2 text-xs font-bold text-primary hover:bg-primary/5">+ Thêm milestone</button> : null}</div></aside>
      <main className="min-w-0 border-b border-border p-4 sm:p-5 lg:border-b-0 lg:border-r"><div className="flex flex-wrap items-center gap-2 border-b border-border pb-4"><input disabled={draft.readOnly} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className="min-w-[220px] flex-1 rounded-lg border border-border bg-white px-3 py-2 text-base font-bold disabled:bg-slate-50" aria-label="Tên template" /><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">{draft.readOnly ? "Mặc định" : "Bản chỉnh sửa"}</span></div><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-lg bg-violet-50 px-3 py-2"><span className="block text-[10px] font-bold text-violet-600">MILESTONE</span><strong className="text-lg text-violet-950">{draft.milestones.length}</strong></div><div className="rounded-lg bg-sky-50 px-3 py-2"><span className="block text-[10px] font-bold text-sky-600">STAGE</span><strong className="text-lg text-sky-950">{totalStages}</strong></div><div className="rounded-lg bg-emerald-50 px-3 py-2"><span className="block text-[10px] font-bold text-emerald-600">CHECKLIST</span><strong className="text-lg text-emerald-950">{totalTasks + totalSubtasks}</strong></div></div>{selectedMilestone ? <div className="mt-5"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-primary">MILESTONE {milestoneIndex + 1}</p><h3 className="mt-1 text-lg font-bold text-slate-950">{selectedMilestone.name}</h3></div>{!draft.readOnly ? <button type="button" onClick={addStage} className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs font-bold text-primary">+ Stage</button> : null}</div><div className="mt-3 space-y-1.5">{selectedMilestone.stages.map((stage, index) => { const taskCount = stage.tasks?.length ?? 0; return <button type="button" key={stage.id} onClick={() => setStageIndex(index)} className={`w-full rounded-lg border px-3 py-3 text-left transition ${index === stageIndex ? "border-primary bg-primary/[0.04]" : "border-border bg-white hover:border-primary/30"}`}><div className="flex items-center gap-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-black ${index === stageIndex ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-500"}`}>S{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{stage.activity || "Chưa đặt tên stage"}</span><span className="mt-0.5 block text-[10px] text-slate-500">{taskCount} task · {stage.slaDays ? `${stage.slaDays} ngày SLA` : "Chưa đặt SLA"}</span></span><span className="text-slate-400">›</span></div></button>; })}</div>{selectedStage ? <div className="mt-5 rounded-xl border border-border bg-slate-50/60 p-3"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">CHECKLIST CỦA STAGE</p><p className="mt-1 text-xs text-slate-500">Chỉnh task trực tiếp tại đây</p></div>{!draft.readOnly ? <button type="button" onClick={addTask} className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-primary shadow-sm ring-1 ring-border">+ Task</button> : null}</div><div className="mt-3 space-y-2">{(selectedStage.tasks ?? []).map((task, taskIndex) => <div key={`${selectedStage.id}-${taskIndex}`} className="rounded-lg border border-border bg-white p-2.5"><div className="flex items-center gap-2"><span className="text-[10px] font-black text-primary">T{taskIndex + 1}</span><input disabled={draft.readOnly} value={task.title} onChange={(event) => updateTask(taskIndex, { title: event.target.value })} className="min-w-0 flex-1 border-0 bg-transparent px-0 text-xs font-semibold outline-none focus:ring-0 disabled:text-slate-700" placeholder="Tên task" /><input disabled={draft.readOnly} type="number" min="0" value={task.estimateMinutes ?? ""} onChange={(event) => updateTask(taskIndex, { estimateMinutes: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) })} className="w-20 rounded-md border border-border px-2 py-1 text-[10px]" placeholder="phút" /></div><div className="mt-2 ml-5 space-y-1 border-l-2 border-primary/15 pl-2">{(task.subtasks ?? []).map((subtask, subtaskIndex) => <div key={`${selectedStage.id}-${taskIndex}-${subtaskIndex}`} className="flex items-center gap-1.5"><span className="text-[9px] text-slate-400">ST{subtaskIndex + 1}</span><input disabled={draft.readOnly} value={subtask.title} onChange={(event) => updateTask(taskIndex, { subtasks: (task.subtasks ?? []).map((item, index) => index === subtaskIndex ? { ...item, title: event.target.value } : item) })} className="min-w-0 flex-1 border-0 bg-transparent px-0 text-[11px] outline-none focus:ring-0" /></div>)}{!draft.readOnly ? <button type="button" onClick={() => updateTask(taskIndex, { subtasks: [...(task.subtasks ?? []), { title: `Subtask ${(task.subtasks?.length ?? 0) + 1}`, subtasks: [] }] })} className="text-[10px] font-semibold text-primary">+ Subtask</button> : null}</div></div>)}{!(selectedStage.tasks ?? []).length ? <p className="rounded-lg border border-dashed border-border bg-white px-3 py-4 text-center text-xs text-slate-500">Stage này chưa có task. Thêm task để tạo checklist thực thi.</p> : null}</div></div> : null}</div> : null}</main>
      <aside className="bg-slate-50/60 p-4 sm:p-5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">INSPECTOR</p><h3 className="mt-1 text-sm font-bold text-slate-950">Thông tin đang chọn</h3>{selectedStage && selectedMilestone ? <div className="mt-4 space-y-4"><section><label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Stage name</label><input disabled={draft.readOnly} value={selectedStage.activity} onChange={(event) => updateStage(selectedMilestone.id, selectedStage.id, { activity: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm font-semibold disabled:bg-slate-100" /></section><section><label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">SLA (ngày)</label><input disabled={draft.readOnly} type="number" min="0" value={selectedStage.slaDays ?? ""} onChange={(event) => updateStage(selectedMilestone.id, selectedStage.id, { slaDays: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) })} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" /></section><section><label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Tiêu chí hoàn thành</label><textarea disabled={draft.readOnly} rows={3} value={selectedStage.criteria ?? ""} onChange={(event) => updateStage(selectedMilestone.id, selectedStage.id, { criteria: event.target.value })} className="mt-1 w-full resize-none rounded-lg border border-border bg-white px-2.5 py-2 text-xs disabled:bg-slate-100" placeholder="Khi nào stage được xem là hoàn tất?" /></section><div className="border-t border-border pt-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Milestone gate</p><label className="mt-2 block text-xs font-semibold text-slate-700">Hồ sơ tối thiểu<input disabled={draft.readOnly} type="number" min="0" value={selectedMilestone.requiredDocumentCount || 0} onChange={(event) => updateMilestone(selectedMilestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm font-normal disabled:bg-slate-100" /></label><label className="mt-3 flex items-start gap-2 text-xs font-semibold text-slate-700"><input disabled={draft.readOnly} type="checkbox" checked={Boolean(selectedMilestone.customerConfirmationRequired)} onChange={(event) => updateMilestone(selectedMilestone.id, { customerConfirmationRequired: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-border text-primary" />Khách hàng xác nhận trước khi chuyển milestone</label><label className="mt-3 block text-xs font-semibold text-slate-700">Điều kiện mở tiếp theo<textarea disabled={draft.readOnly} rows={3} value={selectedMilestone.unlockCriteria ?? ""} onChange={(event) => updateMilestone(selectedMilestone.id, { unlockCriteria: event.target.value })} className="mt-1 w-full resize-none rounded-lg border border-border bg-white px-2.5 py-2 text-xs font-normal disabled:bg-slate-100" /></label></div>{!draft.readOnly && draft.milestones.length > 1 ? <button type="button" onClick={() => { updateDraft({ milestones: draft.milestones.filter((_, index) => index !== milestoneIndex) }); setMilestoneIndex(Math.max(0, milestoneIndex - 1)); setStageIndex(0); }} className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Xóa milestone</button> : null}</div> : <p className="mt-4 rounded-lg border border-dashed border-border bg-white p-3 text-xs leading-relaxed text-slate-500">Chọn một stage ở giữa để chỉnh chi tiết.</p>}</aside>
    </div>
  </section>;
}

function MilestoneTemplateManager({
  templates,
  loading,
  saving,
  teams,
  users,
  onCreateTeam,
  onCreate,
  onUpdate
}: {
  templates: ProjectMilestoneTemplateSummary[];
  loading: boolean;
  saving: boolean;
  teams: WorkspaceReminderTeamOption[];
  users: WorkspaceReminderRecipientOption[];
  onCreateTeam: (input: { name: string; code?: string }) => Promise<WorkspaceReminderTeamOption | void>;
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
  const duplicateTemplate = () => {
    if (!draft) return;
    setIsCreating(true);
    setActiveId("");
    setDraft({
      ...draft,
      id: undefined,
      key: `${draft.key}-custom`,
      name: `${draft.name} · bản tuỳ chỉnh`,
      readOnly: false
    });
  };
  const updateDraft = (patch: Partial<TemplateDraft>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const updateMilestone = (id: string, patch: Partial<TemplateMilestoneDraft>) => setDraft((current) => current ? { ...current, milestones: current.milestones.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone) } : current);
  const updateStage = (milestoneId: string, stageId: string, patch: Partial<TemplateStageDraft>) => setDraft((current) => current ? {
    ...current,
    milestones: current.milestones.map((milestone) => milestone.id === milestoneId ? {
      ...milestone,
      stages: milestone.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage)
    } : milestone)
  } : current);
  const save = async () => {
    if (!draft || draft.readOnly || !draft.name.trim() || draft.milestones.length === 0) return;
    const milestones: CreateProjectMilestoneInput[] = draft.milestones.map((milestone, milestoneIndex) => ({
      name: milestone.name.trim(),
      sortOrder: (milestoneIndex + 1) * 10,
      requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
      requiredDocumentTypes: parseRequiredDocumentTypes(milestone.requiredDocumentTypes),
      evidenceMode: milestone.evidenceMode,
      ownerTeamId: milestone.ownerTeamId || undefined,
      unlockCriteria: milestone.unlockCriteria?.trim() || undefined,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      reviewerMode: milestone.reviewerMode ?? "workspace_admin",
      reviewerUserId: milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId || undefined : undefined,
      stages: milestone.stages.map((stage, stageIndex) => ({
        stageKey: stage.stageKey || `${milestone.id}-${stageIndex + 1}`,
        activity: stage.activity.trim(),
        phase: stage.phase?.trim() || stage.activity.trim(),
        criteria: stage.criteria?.trim() || undefined,
        slaDays: stage.slaDays,
        upbaseRole: stage.upbaseRole?.trim() || undefined,
        customerRole: stage.customerRole?.trim() || undefined,
        tasks: stage.tasks ?? []
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

  return <>
  {draft?.readOnly ? <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-indigo-950">Muốn dùng team và rule riêng?</p><p className="mt-0.5 text-xs text-indigo-800">Tạo một bản tuỳ chỉnh từ template mặc định để gán team và cấu hình số file/link mở khóa.</p></div><button type="button" onClick={duplicateTemplate} className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700">Tạo bản sao để chỉnh sửa</button></div> : null}
  <section aria-labelledby="milestone-template-title" className="grid gap-4 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">MILESTONE LIBRARY</p><h2 id="milestone-template-title" className="mt-1 text-xl font-bold tracking-tight text-slate-950">Mẫu milestone dùng khi tạo Project</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Admin tạo một lần, sau đó người tạo Project chỉ cần chọn mẫu. Điều kiện hồ sơ và bước chuyển tiếp sẽ được copy sang Project mới.</p></div><button type="button" onClick={startCreate} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"><span className="text-lg leading-none">+</span> Tạo template</button></div>
    {loading ? <div className="rounded-2xl border border-border bg-slate-50 p-6 text-center text-sm text-slate-500">Đang tải thư viện template…</div> : null}
    {!loading ? <div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)] lg:items-start"><aside className="rounded-2xl border border-border bg-slate-50/70 p-2"><div className="flex items-center justify-between px-2 pb-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">TEMPLATE ĐÃ LƯU</span><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">{templates.length}</span></div><div className="space-y-1">{templates.map((template) => <button type="button" key={template.id} onClick={() => selectTemplate(template)} className={`w-full rounded-xl px-3 py-3 text-left transition ${template.id === activeId && !isCreating ? "bg-white ring-1 ring-violet-200 shadow-sm" : "hover:bg-white"}`}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-900">{template.name}</span>{template.readOnly ? <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Mặc định</span> : null}</span><span className="mt-1 block text-[11px] text-slate-500">{template.milestoneCount} milestone · {template.stageCount} stage</span></button>)}</div>{templates.length === 0 ? <p className="px-2 py-4 text-xs leading-relaxed text-slate-500">Chưa có template riêng. Bấm “Tạo template” để bắt đầu.</p> : null}</aside><div className="min-w-0 rounded-2xl border border-border bg-white">{draft ? <><div className="border-b border-border bg-gradient-to-r from-violet-50 via-white to-sky-50 px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">{isCreating ? "TEMPLATE MỚI" : draft.readOnly ? "SYSTEM TEMPLATE" : "TEMPLATE ĐÃ LƯU"}</p><h3 className="mt-1 text-lg font-bold text-slate-950">{isCreating ? "Thiết lập format milestone" : draft.name}</h3><p className="mt-1 text-xs text-slate-500">{draft.milestones.length} milestone · {draft.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0)} stage</p></div>{draft.readOnly ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">Chỉ xem</span> : <button type="button" disabled={saving || !draft.name.trim()} onClick={() => void save()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : isCreating ? "Lưu template" : "Cập nhật template"}</button>}</div></div><div className="space-y-4 p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Tên template</span><input disabled={draft.readOnly} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="VD: CRM triển khai chuẩn" className="h-10 w-full rounded-xl border border-border px-3 text-sm font-semibold disabled:bg-slate-50" /></label><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Mã template <span className="font-normal text-slate-400">(tự sinh nếu bỏ trống)</span></span><input disabled={draft.readOnly || !isCreating} value={draft.key} onChange={(event) => updateDraft({ key: event.target.value })} placeholder="crm-standard-v1" className="h-10 w-full rounded-xl border border-border px-3 text-sm disabled:bg-slate-50" /></label></div><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Mô tả sử dụng</span><textarea disabled={draft.readOnly} rows={2} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Template này dùng cho loại dự án nào?" className="w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm disabled:bg-slate-50" /></label><div className="flex items-center justify-between border-t border-border pt-4"><div><p className="text-sm font-bold text-slate-900">Chuỗi milestone</p><p className="mt-0.5 text-xs text-slate-500">Mỗi milestone cần ít nhất một stage để project mới tạo được hierarchy.</p></div>{!draft.readOnly ? <button type="button" onClick={() => updateDraft({ milestones: [...draft.milestones, { id: `milestone-${Date.now()}`, name: `Milestone ${draft.milestones.length + 1}`, sortOrder: (draft.milestones.length + 1) * 10, requiredDocumentCount: 0, requiredDocumentTypes: "", unlockCriteria: "", customerConfirmationRequired: false, reviewerMode: "workspace_admin", reviewerUserId: "", reviewerRole: "", stages: [{ id: `stage-${Date.now()}`, activity: "Stage 1", phase: "stage" }] }] })} className="text-xs font-bold text-primary hover:underline">+ Thêm milestone</button> : null}</div><div className="space-y-3">{draft.milestones.map((milestone, index) => <article key={milestone.id} className="rounded-2xl border border-border bg-slate-50/70 p-3 sm:p-4"><div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[11px] font-black text-violet-700">M{index + 1}</span><input disabled={draft.readOnly} value={milestone.name} onChange={(event) => updateMilestone(milestone.id, { name: event.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 text-sm font-bold disabled:bg-slate-100" />{!draft.readOnly && draft.milestones.length > 1 ? <button type="button" onClick={() => updateDraft({ milestones: draft.milestones.filter((item) => item.id !== milestone.id) })} className="text-xs font-semibold text-rose-600">Xóa</button> : null}</div><div className="mt-3 grid gap-2 sm:grid-cols-3"><label><span className="mb-1 block text-[11px] font-semibold text-slate-500">Số hồ sơ tối thiểu</span><input disabled={draft.readOnly} type="number" min="0" value={milestone.requiredDocumentCount || 0} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" /></label><label className="sm:col-span-2"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Loại hồ sơ (chỉ để phân loại, không bắt buộc)</span><input disabled={draft.readOnly} value={milestone.requiredDocumentTypes} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentTypes: event.target.value })} placeholder="Không cần nhập nếu chỉ kiểm tra số lượng" className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" /></label></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><div><CustomDropdown label="Người duyệt" value={milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId ?? "" : WORKSPACE_ADMIN_REVIEWER_VALUE} options={milestoneReviewerOptions(users, milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId : undefined)} disabled={draft.readOnly} searchable onChange={(value) => updateMilestone(milestone.id, value === WORKSPACE_ADMIN_REVIEWER_VALUE ? { reviewerMode: "workspace_admin", reviewerUserId: "" } : { reviewerMode: "specific_user", reviewerUserId: value })} /></div><label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600"><input disabled={draft.readOnly} type="checkbox" checked={Boolean(milestone.customerConfirmationRequired)} onChange={(event) => updateMilestone(milestone.id, { customerConfirmationRequired: event.target.checked })} className="h-4 w-4 rounded border-border text-primary" /> Cần khách hàng xác nhận</label></div><label className="mt-2 block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Điều kiện mở milestone kế tiếp</span><textarea disabled={draft.readOnly} rows={2} value={milestone.unlockCriteria ?? ""} onChange={(event) => updateMilestone(milestone.id, { unlockCriteria: event.target.value })} placeholder="Ví dụ: đủ hồ sơ và Admin workspace duyệt" className="w-full resize-none rounded-lg border border-border bg-white px-2.5 py-2 text-sm disabled:bg-slate-100" /></label><div className="mt-3 border-t border-border pt-3"><div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">STAGE TRONG MILESTONE</span>{!draft.readOnly ? <button type="button" onClick={() => updateMilestone(milestone.id, { stages: [...milestone.stages, { id: `stage-${Date.now()}`, activity: `Stage ${milestone.stages.length + 1}`, phase: "stage" }] })} className="text-xs font-bold text-primary hover:underline">+ Thêm stage</button> : null}</div><div className="mt-2 space-y-2">{milestone.stages.map((stage, stageIndex) => <div key={stage.id} className="grid gap-2 sm:grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"><span className="text-[11px] font-bold text-slate-400">{stageIndex + 1}</span><input disabled={draft.readOnly} value={stage.activity} onChange={(event) => updateMilestone(milestone.id, { stages: milestone.stages.map((item) => item.id === stage.id ? { ...item, activity: event.target.value } : item) })} className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" placeholder="Tên stage" /><input disabled={draft.readOnly} value={stage.criteria ?? ""} onChange={(event) => updateMilestone(milestone.id, { stages: milestone.stages.map((item) => item.id === stage.id ? { ...item, criteria: event.target.value } : item) })} className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm disabled:bg-slate-100" placeholder="Tiêu chí hoàn thành" />{!draft.readOnly && milestone.stages.length > 1 ? <button type="button" onClick={() => updateMilestone(milestone.id, { stages: milestone.stages.filter((item) => item.id !== stage.id) })} className="text-xs font-semibold text-rose-600">Xóa</button> : null}</div>)}</div></div></article>)}</div></div></> : <div className="p-8 text-center text-sm text-slate-500">Bấm “Tạo template” để tạo format milestone đầu tiên.</div>}</div></div> : null}
  </section>
  <TemplateTaskTreeEditor draft={draft} onUpdateStage={updateStage} />
  <MilestoneRulePanel templates={templates} teams={teams} onCreateTeam={onCreateTeam} onUpdate={onUpdate} />
  </>;
}

type MilestoneGatePatch = {
  requiredDocumentCount: number;
  requiredDocumentTypes: string[];
  evidenceMode: ProjectMilestoneEvidenceMode;
  ownerTeamId: string;
  unlockCriteria: string;
  customerConfirmationRequired: boolean;
  reviewerMode: "workspace_admin" | "specific_user";
  reviewerUserId: string;
  gateStatus: string;
};

function MilestoneRulePanel({
  templates,
  teams,
  onCreateTeam,
  onUpdate
}: {
  templates: ProjectMilestoneTemplateSummary[];
  teams: WorkspaceReminderTeamOption[];
  onCreateTeam: (input: { name: string; code?: string }) => Promise<WorkspaceReminderTeamOption | void>;
  onUpdate: (templateId: string, input: UpdateProjectMilestoneTemplateInput) => Promise<void>;
}) {
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamCode, setTeamCode] = useState("");

  useEffect(() => {
    const template = templates.find((item) => item.id === activeTemplateId) ?? templates[0];
    if (template) {
      setActiveTemplateId(template.id);
      setDraft(templateToDraft(template));
    } else {
      setDraft(null);
    }
  }, [activeTemplateId, templates]);

  const readOnly = Boolean(draft?.readOnly);

  const updateMilestone = (id: string, patch: Partial<TemplateMilestoneDraft>) => {
    setDraft((current) => current ? {
      ...current,
      milestones: current.milestones.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone)
    } : current);
  };

  const save = async () => {
    if (!draft?.id || draft.readOnly || saving) return;
    setSaving(true);
    try {
      const milestones: CreateProjectMilestoneInput[] = draft.milestones.map((milestone, index) => ({
        name: milestone.name.trim(),
        sortOrder: (index + 1) * 10,
        requiredDocumentCount: Math.max(0, Number(milestone.requiredDocumentCount) || 0),
        requiredDocumentTypes: milestone.requiredDocumentTypes.split(",").map((value) => value.trim()).filter(Boolean),
        evidenceMode: milestone.evidenceMode,
        ownerTeamId: milestone.ownerTeamId || undefined,
        unlockCriteria: milestone.unlockCriteria?.trim() || undefined,
        customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
        reviewerMode: milestone.reviewerMode ?? "workspace_admin",
        reviewerUserId: milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId || undefined : undefined,
        stages: milestone.stages.map((stage, stageIndex) => ({
          stageKey: stage.stageKey || `${milestone.id}-${stageIndex + 1}`,
          activity: stage.activity.trim(),
          phase: stage.phase?.trim() || stage.activity.trim(),
          criteria: stage.criteria?.trim() || undefined,
          slaDays: stage.slaDays,
          upbaseRole: stage.upbaseRole?.trim() || undefined,
          customerRole: stage.customerRole?.trim() || undefined,
          tasks: stage.tasks ?? []
        }))
      }));
      await onUpdate(draft.id, { milestones });
    } finally {
      setSaving(false);
    }
  };

  const createTeam = async () => {
    if (!teamName.trim()) return;
    const created = await onCreateTeam({ name: teamName.trim(), code: teamCode.trim() || undefined });
    if (created) {
      setTeamName("");
      setTeamCode("");
      setShowTeamForm(false);
      if (draft?.milestones[0]) updateMilestone(draft.milestones[0].id, { ownerTeamId: created.id });
    }
  };

  return <section aria-labelledby="milestone-rule-title" className="grid gap-4 rounded-3xl border border-indigo-100 bg-indigo-50/30 p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">WORKFLOW RULES</p>
        <h3 id="milestone-rule-title" className="mt-1 text-lg font-bold tracking-tight text-slate-950">Team & checklist mở milestone</h3>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">Gate tự động kiểm tra hồ sơ, task trong các stage và xác nhận khách hàng. Đủ điều kiện sẽ chuyển sang chờ đúng người duyệt; chỉ sau khi duyệt mới mở milestone kế tiếp.</p>
      </div>
      <div className="flex items-center gap-2">
        <CrmSelect ariaLabel="Template milestone" className="min-w-[220px]" options={templates.map((template) => ({ value: template.id, label: template.name }))} value={activeTemplateId} onChange={setActiveTemplateId} />
        {!readOnly && draft ? <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? "Đang lưu…" : "Lưu rule"}</button> : null}
      </div>
    </div>
    {draft ? <>
      <div className="flex flex-col gap-2 rounded-2xl border border-indigo-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-bold text-slate-900">Team phụ trách</p><p className="mt-0.5 text-xs text-slate-500">Team được copy sang từng milestone khi tạo Project.</p></div>
        {!readOnly ? <button type="button" onClick={() => setShowTeamForm((current) => !current)} className="text-xs font-bold text-indigo-700 hover:underline">+ Tạo team mới</button> : null}
      </div>
      {showTeamForm && !readOnly ? <div className="grid gap-2 rounded-2xl border border-indigo-100 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Tên team, VD: Delivery Services" className="h-10 rounded-xl border border-border px-3 text-sm" />
        <input value={teamCode} onChange={(event) => setTeamCode(event.target.value)} placeholder="Mã tự sinh" className="h-10 rounded-xl border border-border px-3 text-sm" />
        <button type="button" disabled={!teamName.trim()} onClick={() => void createTeam()} className="h-10 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50">Tạo team</button>
      </div> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {draft.milestones.map((milestone, index) => <article key={milestone.id} className="rounded-2xl border border-border bg-white p-4">
          <div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-[11px] font-black text-indigo-700">M{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{milestone.name}</p><p className="mt-0.5 text-[11px] text-slate-500">Rule chuyển tiếp</p></div></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
<label><span className="mb-1 block text-[11px] font-semibold text-slate-500">Số hồ sơ tối thiểu</span><input disabled={readOnly} type="number" min="0" value={milestone.requiredDocumentCount || 0} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-10 w-full rounded-xl border border-border px-3 text-sm font-semibold disabled:bg-slate-50" /></label>
            <div><span className="mb-1 block text-[11px] font-semibold text-slate-500">Loại bằng chứng</span><CrmSelect disabled={readOnly} options={[{ value: "file_or_link", label: "File hoặc link" }, { value: "file", label: "Chỉ file tải lên" }, { value: "link", label: "Chỉ link" }]} value={milestone.evidenceMode ?? "file_or_link"} onChange={(value) => updateMilestone(milestone.id, { evidenceMode: value as ProjectMilestoneEvidenceMode })} /></div>
          </div>
          <div className="mt-2"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Team phụ trách</span><CrmSelect disabled={readOnly} options={[{ value: "", label: "Chưa gán team" }, ...teams.map((team) => ({ value: team.id, label: `${team.name}${team.code ? ` · ${team.code}` : ""}` }))]} value={milestone.ownerTeamId ?? ""} onChange={(value) => updateMilestone(milestone.id, { ownerTeamId: value })} /></div>
<label className="mt-2 block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Loại hồ sơ (chỉ để phân loại, không bắt buộc)</span><input disabled={readOnly} value={milestone.requiredDocumentTypes} onChange={(event) => updateMilestone(milestone.id, { requiredDocumentTypes: event.target.value })} placeholder="Không cần nhập nếu chỉ kiểm tra số lượng" className="h-10 w-full rounded-xl border border-border px-3 py-2.5 text-sm disabled:bg-slate-50" /></label>
          <label className="mt-2 block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Mô tả điều kiện bổ sung</span><textarea disabled={readOnly} rows={2} value={milestone.unlockCriteria ?? ""} onChange={(event) => updateMilestone(milestone.id, { unlockCriteria: event.target.value })} placeholder="VD: Admin workspace duyệt và khách hàng xác nhận" className="w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm disabled:bg-slate-50" /></label>
<p className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">{`Cần ${milestone.requiredDocumentCount ?? 0} ${milestone.evidenceMode === "file" ? "file" : milestone.evidenceMode === "link" ? "link" : "file/link"} để mở milestone kế tiếp.`}</p>
        </article>)}
      </div>
    </> : <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm text-slate-500">Chưa có template để cấu hình rule.</div>}
  </section>;
}

function MilestoneGatePanel({
  projects,
  projectId,
  gates,
  users,
  loading,
  saving,
  onProjectChange,
  onSave,
  onEvaluate
}: {
  projects: ProjectSummary[];
  projectId: string;
  gates: ProjectMilestoneSummary[];
  users: WorkspaceReminderRecipientOption[];
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
      evidenceMode: gate.evidenceMode ?? "file_or_link",
      ownerTeamId: gate.ownerTeamId ?? "",
      unlockCriteria: gate.unlockCriteria ?? "",
      customerConfirmationRequired: Boolean(gate.customerConfirmationRequired),
      reviewerMode: gate.reviewerMode ?? "workspace_admin",
      reviewerUserId: gate.reviewerUserId ?? "",
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
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">PROJECT GOVERNANCE</p><h2 id="milestone-gate-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Milestone & điều kiện chuyển tiếp</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Chọn một Project, chọn một milestone ở cột trái, rồi chỉnh điều kiện ở một nơi duy nhất.</p></div><div className="min-w-[280px]"><CrmSelect label={<span className="mb-1.5 block text-xs font-semibold text-slate-600">Project cần cấu hình</span>} options={[{ value: "", label: "Chọn Project…" }, ...projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))]} value={projectId} onChange={onProjectChange} /></div></div>
    {selectedProject ? <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900"><span className="font-bold">{selectedProject.name}</span><span>·</span><span>{selectedProject.milestoneMode === "manual" ? "Tự chọn milestone" : "Mẫu pilot"}</span><span>·</span><span>{gates.length} bước chuyển tiếp</span></div> : null}
    {loading ? <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-slate-500">Đang tải cấu hình milestone…</div> : null}
    {!loading && !projectId ? <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-slate-500">Chọn một Project để bắt đầu cấu hình.</div> : null}
    {!loading && projectId && gates.length === 0 ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Project này chưa có milestone. Hãy tạo lại Project với template tự động hoặc thêm milestone trong Project Sheet.</div> : null}
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <aside className="rounded-3xl border border-border bg-card p-3 shadow-sm lg:sticky lg:top-24"><div className="flex items-center justify-between px-2 pb-2"><div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">WORKFLOW</p><p className="mt-1 text-sm font-bold text-slate-900">Các bước milestone</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">{gates.length}</span></div><div className="space-y-1">{gates.map((gate, index) => { const draft = drafts[gate.id]; const active = gate.id === activeGate?.id; return <button type="button" key={gate.id} onClick={() => setActiveGateId(gate.id)} className={`relative flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"}`}><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-black ${active ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700"}`}>M{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{gate.name}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${draft?.gateStatus === "approved" ? "bg-emerald-500" : draft?.gateStatus === "pending_review" ? "bg-amber-500" : draft?.gateStatus === "locked" ? "bg-slate-400" : "bg-sky-500"}`} />{statusLabel[draft?.gateStatus ?? "locked"]}</span></span><span className="text-[11px] font-semibold text-slate-400">{draft?.requiredDocumentCount || 0} hồ sơ</span></button>; })}</div></aside>
      <section className="min-w-0 rounded-3xl border border-border bg-card shadow-sm">{activeGate && activeDraft ? <><div className="border-b border-border bg-gradient-to-r from-indigo-50 via-white to-sky-50 px-5 py-5 sm:px-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white">M{gates.findIndex((gate) => gate.id === activeGate.id) + 1}</span><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">HỒ SƠ CHUYỂN TIẾP</p><h3 className="mt-1 text-xl font-bold tracking-tight text-slate-950">{activeGate.name}</h3><p className="mt-1 text-xs text-slate-500">{activeGate.submittedDocumentCount ?? 0}/{activeDraft.requiredDocumentCount} hồ sơ đã ghi nhận · {activeDraft.customerConfirmationRequired ? "Cần khách hàng xác nhận" : "Không cần khách hàng xác nhận"}</p></div></div><span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusClass[activeDraft.gateStatus] ?? statusClass.locked}`}>{statusLabel[activeDraft.gateStatus] ?? activeDraft.gateStatus}</span></div></div><div className="space-y-5 p-5 sm:p-7"><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Số hồ sơ bắt buộc</span><input type="number" min="0"  value={activeDraft.requiredDocumentCount} onChange={(event) => updateDraft(activeGate.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-semibold" /></label><label><span className="mb-1.5 block text-xs font-semibold text-slate-600">Loại hồ sơ (chỉ để phân loại, không bắt buộc)</span><input value={activeDraft.requiredDocumentTypes.join(", ")} onChange={(event) => updateDraft(activeGate.id, { requiredDocumentTypes: parseRequiredDocumentTypes(event.target.value) })} placeholder="Không cần nhập nếu chỉ kiểm tra số lượng" className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm" /></label></div><div className="grid gap-3 sm:grid-cols-2"><div><CustomDropdown label="Người duyệt" value={activeDraft.reviewerMode === "specific_user" ? activeDraft.reviewerUserId : WORKSPACE_ADMIN_REVIEWER_VALUE} options={milestoneReviewerOptions(users, activeDraft.reviewerMode === "specific_user" ? activeDraft.reviewerUserId : undefined)} searchable onChange={(value) => updateDraft(activeGate.id, value === WORKSPACE_ADMIN_REVIEWER_VALUE ? { reviewerMode: "workspace_admin", reviewerUserId: "" } : { reviewerMode: "specific_user", reviewerUserId: value })} /></div></div><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Điều kiện để mở milestone kế tiếp</span><textarea rows={4} value={activeDraft.unlockCriteria} onChange={(event) => updateDraft(activeGate.id, { unlockCriteria: event.target.value })} className="w-full resize-none rounded-xl border border-border bg-white px-3 py-3 text-sm leading-relaxed" placeholder="Ví dụ: đủ hồ sơ, Admin workspace duyệt, khách hàng xác nhận…" /></label><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={activeDraft.customerConfirmationRequired} onChange={(event) => updateDraft(activeGate.id, { customerConfirmationRequired: event.target.checked })} className="h-4 w-4 rounded border-border text-primary" /> Bắt buộc khách hàng xác nhận</label><div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-slate-900">Hồ sơ hiện tại</p><p className="mt-1 text-xs text-slate-500">{activeGate.submittedDocumentCount ?? 0} hồ sơ đã ghi nhận · cần {activeDraft.requiredDocumentCount} hồ sơ</p></div><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void onEvaluate(activeGate.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Đánh giá hồ sơ</button><button type="button" disabled={saving} onClick={() => void onSave(activeGate.id, activeDraft)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Lưu thay đổi</button></div></div></div></> : <div className="p-10 text-center text-sm text-slate-500">Chọn một milestone để cấu hình.</div>}</section>
    </div>
  </section>;
}

function LegacyReminderPolicyPanel({ policy, saving, onSave, onUpdateSlot, onSetPolicy }: { policy: WorkspaceReminderPolicy | null; saving: boolean; onSave: () => void; onUpdateSlot: (code: WorkspaceReminderSlotCode, patch: Partial<WorkspaceReminderSlot>) => void; onSetPolicy: React.Dispatch<React.SetStateAction<WorkspaceReminderPolicy | null>> }) {
  return <section aria-labelledby="reminder-policy-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="border-b border-border bg-gradient-to-r from-violet-50 via-white to-sky-50 px-5 py-5 sm:px-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><BellRing className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">LARK NOTIFICATIONS</p><h2 id="reminder-policy-title" className="mt-1 text-xl font-bold text-slate-950">Lịch nhắc vận hành</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">Chỉ gửi khi phát hiện thiếu kế hoạch hoặc Actual Hour. Ngày off được bỏ qua tự động.</p></div></div>{policy ? <button disabled={saving} type="button" onClick={onSave} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Đang lưu…" : "Lưu thay đổi"}</button> : null}</div></div>{policy ? <div className="p-5 sm:p-7"><div className="flex flex-col gap-3 rounded-2xl border border-border bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${policy.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}><BellRing className="h-4 w-4" /></div><div><p className="text-sm font-bold text-slate-900">Kích hoạt nhắc Lark</p><p className="mt-0.5 text-xs text-slate-500">{formatUpdatedAt(policy.updatedAt)} · múi giờ {policy.timezone}</p></div></div><Toggle checked={policy.enabled} onChange={(checked) => onSetPolicy((current) => current ? { ...current, enabled: checked } : current)} label={policy.enabled ? "Đang bật" : "Đang tắt"} /></div><div className="mt-4 grid gap-3 md:grid-cols-3">{policy.slots.map((slot) => <div key={slot.slot} className={`rounded-2xl border p-4 transition ${slot.enabled && policy.enabled ? "border-violet-200 bg-violet-50/40" : "border-border bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">{slotLabel(slot)}</p><p className="mt-1 text-xs leading-relaxed text-slate-500">{slot.slot === "morning_plan" ? "Kiểm tra kế hoạch và trường dữ liệu task." : slot.slot === "pm_follow_up" ? "Nhắc lại các việc chưa được cập nhật." : "Đối soát Actual Hour cuối ngày."}</p></div><Toggle checked={slot.enabled} onChange={(checked) => onUpdateSlot(slot.slot, { enabled: checked })} label={slot.enabled ? "Bật" : "Tắt"} compact /></div><label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-500"><Clock3 className="h-4 w-4" /> Giờ gửi<input type="time" value={slot.time} onChange={(event) => onUpdateSlot(slot.slot, { time: event.target.value })} className="ml-auto h-9 rounded-lg border border-border bg-white px-2 text-sm font-bold text-slate-900" /></label></div>)}</div><label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={policy.weekdaysOnly} onChange={(event) => onSetPolicy((current) => current ? { ...current, weekdaysOnly: event.target.checked } : current)} className="h-4 w-4 rounded border-border text-primary" /> Chỉ gửi vào ngày làm việc (Thứ 2–Thứ 6, bỏ qua ngày off)</label><div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-xs leading-relaxed text-sky-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Secret webhook chỉ nằm ở worker/server. Mốc mặc định: 08:30, 14:00 và 17:00.</div></div> : <div className="p-7 text-sm text-muted-foreground">Đang tải cấu hình lịch nhắc…</div>}</section>;
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
      : { tone: "border-rose-400", wash: "bg-rose-50", title: "Cập nhật Actual Hour hôm nay", action: "Mở Timesheet hôm nay" };

  return <aside aria-label="Bản xem trước card Lark" className="rounded-2xl border border-border bg-slate-50/70 p-3">
    <div className="flex items-center justify-between gap-3 px-1 pb-2"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">LARK CARD PREVIEW</p><p className="mt-1 text-xs text-slate-500">Nội dung theo EV-060, thay dữ liệu thật khi gửi</p></div><span className="rounded-full border border-border bg-white px-2 py-1 text-[10px] font-bold text-slate-500">{time}</span></div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`border-l-4 ${content.tone} ${content.wash} px-4 py-3`}><p className="text-sm font-bold text-slate-950">{content.title}</p><p className="mt-1 text-[11px] text-slate-500">Ngày {localDate || "chưa chọn"} · gửi tới {recipientLabel}</p></div>
      <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-slate-700">
        {slot === "morning_plan" ? <><p>Chào <strong>{"{{employee_name}}"}</strong>,</p><p>Đến 08:30 ngày <strong>{"{{work_date}}"}</strong>, kế hoạch Task của các Project <strong>{"{{active_projects}}"}</strong> hôm nay của bạn chưa đầy đủ.</p><p>Nội dung cần bổ sung:</p><div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">• Nếu chưa có Task: “Bạn chưa lập Task cho ngày hôm nay.”<br />• Nếu Task thiếu dữ liệu: “{"{{task_name}}"} — còn thiếu: {"{{missing_fields}}"}.”</div><p>Vui lòng hoàn tất kế hoạch Task trước 09:00 hôm nay để bảo đảm dữ liệu kế hoạch được ghi nhận đầy đủ.</p></> : null}
        {slot === "pm_follow_up" ? <><p>Chào <strong>{"{{pm_name}}"}</strong>,</p><p>Đến 14:00 ngày <strong>{"{{work_date}}"}</strong>, có <strong>{"{{incomplete_employee_count}}"}</strong> nhân sự thuộc phạm vi phụ trách của bạn chưa hoàn tất kế hoạch Task.</p><p>Danh sách cần theo dõi:</p><div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2"><div><strong>1. {"{{employee_name}}"}</strong><br /><span className="text-[11px] text-slate-500">• Trạng thái: {"{{missing_status}}"}<br />• Task liên quan: {"{{task_name_or_no_tasks}}"}<br />• Nội dung còn thiếu: {"{{missing_fields}}"}<br />• Lần nhắc tự động: 08:30</span></div><span className="flex gap-1"><button type="button" disabled className="rounded-md border border-violet-200 px-2 py-1 text-[10px] font-bold text-violet-700">Gửi nhắc</button><button type="button" disabled className="rounded-md border border-border px-2 py-1 text-[10px] font-bold text-slate-600">Xem Timesheet</button></span></div><p>Vui lòng kiểm tra và nhắc nhân sự hoàn tất dữ liệu trong ngày.</p></> : null}
        {slot === "evening_actual" ? <><p>Chào <strong>{"{{employee_name}}"}</strong>,</p><p>Đến 17:00 ngày <strong>{"{{work_date}}"}</strong>, dữ liệu Actual Hour của bạn chưa đầy đủ.</p><p>Tổng giờ trong ngày:</p><div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">• Đã ghi nhận: <strong>{"{{actual_hour_total}}"} giờ</strong><br />• Giờ tiêu chuẩn: <strong>8 giờ</strong><br />• Còn thiếu: <strong>{"{{remaining_hour}}"} giờ</strong></div><p>Task chưa có Actual Hour:</p><div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">1. {"{{task_name_1}}"}<br />— Estimate Hour: {"{{estimate_hour_1}}"} giờ<br />2. {"{{task_name_2}}"}<br />— Estimate Hour: {"{{estimate_hour_2}}"} giờ<br />{"{{repeat_for_each_missing_task}}"}</div><p>Vui lòng ghi Actual Hour thực tế đã làm trong ngày. Không tự động sử dụng Estimate Hour thay cho Actual Hour; chuyển Task sang Hoàn tất cũng không thay thế việc ghi giờ. Trường hợp có OT, số giờ vượt 8 giờ chỉ được ghi nhận theo quy tắc đã được phê duyệt.</p></> : null}
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
