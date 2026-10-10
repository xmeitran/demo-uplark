"use client";
import { AdminMemberControls } from "@/components/auth/admin-access-controls";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardList, Mail, Sparkles } from "lucide-react";
import type {
  AdminAccessMemberResponse,
  AdminAccessMemberSummary,
  ProjectTaskSummary,
  ResourceListResponse,
  UserProjectParticipationResponse,
  WorkspaceSystemRole,
} from "@b2b-crm/contracts";
import { currentVietnamMonthRange } from "@/lib/member-participation";
import { AppShell } from "@/components/constructor-x/app-shell";
import { businessRoleFromMember, systemRoleLabel } from "@/lib/people-roles";

type ProfileTab = "Tasks" | "Projects";

const TABS: ProfileTab[] = ["Tasks", "Projects"];

function isProfileTab(value: string | null): value is ProfileTab {
  return Boolean(value && TABS.includes(value as ProfileTab));
}

const ROLE_COLORS: Record<string, string> = {
  "Customer success": "#0891b2",
  "Project Manager": "#7c3aed",
  "DX enabler": "#2563eb",
  "Business development": "#16a34a",
  "Marketing B2B": "#db2777",
  "Chưa gán": "#64748b",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  blocked: "Blocked",
  done: "Done",
  completed: "Completed",
  cancelled: "Cancelled",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(-2) : parts).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function statusBadge(user: AdminAccessMemberSummary) {
  if (user.status !== "active") return { label: "Suspended", className: "bg-slate-100 text-slate-600" };
  if (user.employmentStatus === "ON_LEAVE") return { label: "On leave", className: "bg-amber-50 text-amber-700" };
  if (user.employmentStatus === "INACTIVE") return { label: "Inactive", className: "bg-slate-100 text-slate-600" };
  return { label: "Active", className: "bg-emerald-50 text-emerald-700" };
}

function formatDate(value?: string) {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value?: string) {
  if (!value) return "Chưa có dữ liệu";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa có dữ liệu";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** EV-035: the user's Active and On Hold projects for the current month. */
function UserProjectParticipation({ userId }: { userId: string }) {
  const [period] = useState(() => currentVietnamMonthRange());
  const [data, setData] = useState<UserProjectParticipationResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/project-participation?userId=${encodeURIComponent(userId)}&startDate=${period.startDate}&endDate=${period.endDate}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : `Project participation API returned ${response.status}`);
        if (!cancelled) setData((body as UserProjectParticipationResponse).data);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được dữ liệu tham gia Project"); });
    return () => { cancelled = true; };
  }, [userId, period]);

  if (error) return <p role="alert" className="text-xs text-rose-600">{error}</p>;
  if (!data) return <p className="text-xs text-muted-foreground">Đang tải trạng thái tham gia tháng {period.label}…</p>;
  const groups = [
    { title: `Project đang Active (${data.activeProjects.length})`, empty: "Không có Project Active trong kỳ.", items: data.activeProjects.map((project) => ({ ...project, note: `${Math.round(project.actualMinutes / 6) / 10}h trong kỳ` })) },
    { title: `Project On Hold (${data.onHoldProjects.length})`, empty: "Không có Project On Hold.", items: data.onHoldProjects.map((project) => ({ ...project, note: "" })) }
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Trạng thái tham gia tháng {period.label}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="!text-sm font-bold text-foreground">{group.title}</h2>
            {group.items.length ? (
              <ul className="mt-3 space-y-2">
                {group.items.map((project) => (
                  <li key={project.projectId} className="flex items-center justify-between gap-3 text-xs">
                    <Link href={`/projects/${encodeURIComponent(project.projectId)}`} className="min-w-0 truncate font-semibold text-foreground hover:text-primary hover:underline">{project.code} · {project.name}</Link>
                    {project.note ? <span className="shrink-0 font-mono text-muted-foreground">{project.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-xs text-muted-foreground">{group.empty}</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Khả năng nhận việc mới phải xét toàn bộ Project đang Active.</p>
    </div>
  );
}

function uniquePairs(ids: string[], names: string[]) {
  return ids.map((id, index) => ({ id, name: names[index] ?? id })).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const searchParams = useSearchParams();
  const userId = params?.userId;
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<ProfileTab>(isProfileTab(requestedTab) ? requestedTab : "Tasks");
  const [user, setUser] = useState<AdminAccessMemberSummary | null>(null);
  const [tasks, setTasks] = useState<ProjectTaskSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTasksLoading, setIsTasksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      if (!userId) return;
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { cache: "no-store" });
        if (response.status === 401) {
          window.location.assign(`/login?returnTo=${encodeURIComponent(`/users/${userId}`)}`);
          return;
        }
        if (response.status === 404) {
          // Old Hồ sơ nhân sự links may carry a Lark User ID instead of the member id.
          const directory = await fetch("/api/admin/users", { cache: "no-store" });
          const members = directory.ok ? ((await directory.json()) as { data?: AdminAccessMemberSummary[] }).data ?? [] : [];
          const match = members.find((member) => member.larkOpenId === userId);
          if (match && !cancelled) { window.location.replace(`/users/${encodeURIComponent(match.id)}`); return; }
          if (!cancelled) setUser(null);
          return;
        }
        if (response.status === 403) throw new Error("Chỉ Admin của workspace mới xem được hồ sơ thành viên.");
        if (!response.ok) throw new Error(`User detail API returned ${response.status}`);
        const payload = (await response.json()) as AdminAccessMemberResponse;
        if (!cancelled) setUser(payload.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load user profile");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadUser();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      if (!user?.id) return;
      setIsTasksLoading(true);
      setTasksError(null);
      try {
        const response = await fetch(`/api/tasks?assigneeUserId=${encodeURIComponent(user.id)}&limit=20&offset=0`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Tasks API returned ${response.status}`);
        const payload = (await response.json()) as ResourceListResponse<ProjectTaskSummary>;
        if (!cancelled) setTasks(payload.data);
      } catch (err) {
        if (!cancelled) setTasksError(err instanceof Error ? err.message : "Could not load assigned tasks");
      } finally {
        if (!cancelled) setIsTasksLoading(false);
      }
    }

    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const primaryRole = businessRoleFromMember(user ?? {});
  const workspaceRole: WorkspaceSystemRole = user?.systemRole ?? (user?.roleCodes.includes("FOUNDER_GM") ? "FOUNDER_GM" : user?.roleCodes.includes("WORKSPACE_ADMIN") ? "WORKSPACE_ADMIN" : "WORKSPACE_USER");
  const roleColor = ROLE_COLORS[primaryRole] ?? "#64748b";
  const status = user ? statusBadge(user) : null;
  const projects = useMemo(() => uniquePairs(user?.projectIds ?? [], user?.projectNames ?? []), [user?.projectIds, user?.projectNames]);
  const accounts = useMemo(() => uniquePairs(user?.accountIds ?? [], user?.accountNames ?? []), [user?.accountIds, user?.accountNames]);

  useEffect(() => {
    setActiveTab(isProfileTab(requestedTab) ? requestedTab : "Tasks");
  }, [requestedTab]);

  function handleTabChange(tab: ProfileTab) {
    setActiveTab(tab);
    const nextUrl = new URL(window.location.href);
    if (tab === "Tasks") {
      nextUrl.searchParams.delete("tab");
    } else {
      nextUrl.searchParams.set("tab", tab);
    }
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }

  return (
    <AppShell activeRoute="/users" title="User Profile">
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <Link href="/users" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Users
          </Link>

          {isLoading && (
            <div className="mt-6 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
              Loading real user profile...
            </div>
          )}

          {!isLoading && error && (
            <div className="mt-6 rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
              {error}
            </div>
          )}

          {!isLoading && !error && !user && (
            <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
              <h1 className="!text-xl font-bold text-foreground">User not found</h1>
              <p className="mt-1 text-sm text-muted-foreground">This user is not present in the production identity database.</p>
            </div>
          )}

          {!isLoading && !error && user && (
            <div className="mt-4 space-y-5">
              <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-base font-bold text-white" style={{ backgroundColor: roleColor }}>
                        {initials(user.displayName || user.email)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="!text-xl truncate font-bold text-foreground">{user.displayName || user.email}</h1>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status?.className}`}>{status?.label}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/timesheet?person=${encodeURIComponent(user.id)}`} className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"><ClipboardList className="h-4 w-4" /> Timesheet</Link>
                  <a href={`mailto:${user.email}`} className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"><Mail className="h-4 w-4" /> Gửi email</a>
                </div>
              </header>

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-5">
              <div className="overflow-x-auto border-b border-border">
                <nav className="flex min-w-max gap-2">
                  {TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      aria-pressed={activeTab === tab}
                      aria-controls={`${tab.toLowerCase()}-profile-panel`}
                      onClick={() => handleTabChange(tab)}
                      className={`border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                        activeTab === tab
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </nav>
              </div>

              {activeTab === "Projects" && (
                <section id="projects-profile-panel" className="space-y-4">
                  {user ? <UserProjectParticipation userId={user.id} /> : null}
                  {projects.length ? (
                    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                      {projects.map((project) => (
                        <Link key={project.id} href={`/projects/${project.id}`} className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/30">
                          <span className="truncate text-sm font-bold text-foreground">{project.name}</span>
                          <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">{project.id}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <EmptyPanel title="Chưa có project được gán" description="User này đã đồng bộ vào hệ thống nhưng chưa có grant hoặc project membership trong database." />
                  )}

                  {accounts.length ? (
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                      <h2 className="text-sm font-bold text-foreground">Account grants</h2>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {accounts.map((account) => (
                          <Link key={account.id} href={`/clients/${account.id}`} className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                            {account.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              )}

              {activeTab === "Tasks" && (
                <section id="tasks-profile-panel" className="space-y-4">
                  {isTasksLoading && (
                    <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm">Loading assigned tasks...</div>
                  )}
                  {!isTasksLoading && tasksError && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-700 shadow-sm">{tasksError}</div>
                  )}
                  {!isTasksLoading && !tasksError && tasks.length ? (
                    <div className="rounded-xl border border-border bg-card shadow-sm">
                      {tasks.map((task) => {
                        const taskContent = (
                          <>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-foreground">{task.title}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{task.projectName ?? task.accountName}</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">{STATUS_LABELS[task.status] ?? task.status}</span>
                              <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Due {formatDate(task.dueAt)}</span>
                            </div>
                          </>
                        );

                        return (
                          <Link
                            key={task.id}
                            href={`/tasks/${task.id}`}
                            className="flex flex-col gap-3 border-b border-border p-5 transition-colors last:border-b-0 hover:bg-muted/30 md:flex-row md:items-center md:justify-between"
                            aria-label={`Open task ${task.title}`}
                          >
                            {taskContent}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                  {!isTasksLoading && !tasksError && !tasks.length && (
                    <EmptyPanel title="Chưa có task được gán" description="Không có task active nào đang gán cho user này trong bảng ProjectTask." />
                  )}
                </section>
              )}
              </div>

              <aside className="space-y-5 xl:sticky xl:top-4">
                <section className="rounded-2xl border border-border bg-card shadow-sm">
                  <h2 className="border-b border-border px-5 py-4 !text-sm font-bold text-foreground">Thuộc tính</h2>
                  <dl className="divide-y divide-border px-5">
                    <InfoRow label="Role" value={primaryRole} />
                    <InfoRow label="System role" value={systemRoleLabel(workspaceRole)} />
                    <InfoRow label="Lark User ID" value={user.larkOpenId ?? "Chưa liên kết"} mono />
                    <InfoRow label="Lark tenant" value={user.larkTenantKey ?? "Chưa liên kết"} mono />
                    <InfoRow label="User ID" value={user.id} mono />
                    <InfoRow label="Weekly capacity" value={user.resourceWeeklyCapacityMinutes ? `${user.resourceWeeklyCapacityMinutes / 60} h` : "Chưa gán"} />
                    <InfoRow label="Billable target" value={user.resourceBillableTargetPercent ? `${user.resourceBillableTargetPercent}%` : "Chưa gán"} />
                    <InfoRow label="Time entries" value={`${user.timeEntryCount ?? 0}`} />
                    <InfoRow label="Active sessions" value={`${user.activeSessionCount}`} />
                    <InfoRow label="Joined" value={formatDate(user.createdAt)} />
                    <InfoRow label="Last active" value={formatDateTime(user.lastSeenAt)} />
                  </dl>
                  {user.resourceSkills.length ? <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">{user.resourceSkills.map((skill) => <span key={skill} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-foreground">{skill}</span>)}</div> : null}
                </section>
                <AdminMemberControls userId={user.id} status={user.status} currentRole={workspaceRole} employmentStatus={user.employmentStatus} displayRole={primaryRole} costPermissionCodes={user.costPermissionCodes} />
              </aside>
              </div>
            </div>
          )}
        </main>

        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
    </AppShell>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 items-center gap-2 py-3">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd title={value} className={`col-span-2 truncate text-xs font-bold text-foreground ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
