"use client";
import { postProject, type ProjectCreateAttempt } from "@/lib/project-create-request";
import { MoneyAmount } from "@/components/money-amount";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";



import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  Users,
  FolderOpen,
  FileText,
  LayoutDashboard,
  Clock,
  Plus,
  MessageSquare,
  ArrowRight,
  X
} from "lucide-react";
import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
} from "recharts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CustomDropdown, CustomDatePicker } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import type { Member, Project } from "./projects/data";
import {
  fetchAccountOptions,
  fetchLiveProjects,
  isUnauthorizedLiveProjectsError,
  mapProjectSummaryToUiProject,
  PROJECT_PAGE_SIZE,
  toBackendProjectStatus,
  type LiveProjectAccountOption
} from "./projects/live-projects";
import {
  fetchWorkspaceUserOptions,
  isUnauthorizedWorkspaceUsersError,
  type WorkspaceUserOption
} from "@/lib/workspace-users";
import { uiProjectDateToIso } from "@/lib/project-date";
import type { ResourceListPaginationMeta } from "@b2b-crm/contracts";

// ─── Live Dashboard Data ─────────────────────────────────────────────────────

interface DashboardProject {
  id: string;
  name: string;
  color: string;
  textColor: string;
  initials: string;
  stages: number;
  tasks: number;
  income: number;
  spent: number;
  progress: number;
  deadline: string;
  members: Member[];
  client: string;
  status: Project["status"];
}

const DASHBOARD_COLOR_MAP: Record<string, { bg: string; text: string }> = {
  "#2563eb": { bg: "bg-blue-600", text: "text-blue-600" },
  "#7c3aed": { bg: "bg-purple-600", text: "text-purple-600" },
  "#059669": { bg: "bg-emerald-600", text: "text-emerald-600" },
  "#db2777": { bg: "bg-pink-600", text: "text-pink-600" },
  "#d97706": { bg: "bg-orange-500", text: "text-orange-500" },
  "#dc2626": { bg: "bg-red-500", text: "text-red-500" },
  "#64748b": { bg: "bg-slate-500", text: "text-slate-500" },
  "#0891b2": { bg: "bg-cyan-600", text: "text-cyan-600" },
  "#8b5cf6": { bg: "bg-purple-500", text: "text-purple-500" },
};

function toDashboardProject(project: Project): DashboardProject {
  const mappedColor = DASHBOARD_COLOR_MAP[project.color] ?? DASHBOARD_COLOR_MAP["#2563eb"];
  return {
    id: project.id,
    name: project.name,
    color: mappedColor.bg,
    textColor: mappedColor.text,
    initials: project.name.charAt(0).toUpperCase() || "P",
    stages: parseStageCount(project.description),
    tasks: project.tasks.total,
    income: project.budget,
    spent: project.spent,
    progress: project.progress,
    deadline: project.dueDate.replaceAll("/", "."),
    members: project.members,
    client: project.client,
    status: project.status
  };
}

function parseStageCount(description: string) {
  const match = description.match(/(\d+)\s+stages?/i);
  return match ? Number(match[1]) : 0;
}

function redirectToLogin(returnTo = "/") {
  if (typeof window === "undefined") return;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

const EMPTY_PROJECT_PAGINATION: ResourceListPaginationMeta = {
  limit: PROJECT_PAGE_SIZE,
  offset: 0,
  returned: 0,
  total: 0,
  hasNextPage: false,
  hasPreviousPage: false
};

function projectPageRangeLabel(meta: ResourceListPaginationMeta) {
  if (meta.total === 0 || meta.returned === 0) return "0 / 0 projects";
  const start = meta.offset + 1;
  const end = meta.offset + meta.returned;
  return `${start}-${end} / ${meta.total} projects`;
}

function DashboardProjectPagination({
  pagination,
  onPageChange
}: {
  pagination: ResourceListPaginationMeta;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  if (pagination.total <= pagination.limit) return null;

  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-5 py-3">
      <span className="mr-auto text-xs font-medium text-muted-foreground">
        Showing {projectPageRangeLabel(pagination)}
      </span>
      <button
        type="button"
        disabled={!pagination.hasPreviousPage}
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
      >
        Previous
      </button>
      <span className="min-w-16 text-center text-xs font-semibold text-muted-foreground">
        {currentPage}/{totalPages}
      </span>
      <button
        type="button"
        disabled={!pagination.hasNextPage}
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
      >
        Next
      </button>
    </div>
  );
}

const QUICK_ACTIONS = [
  { icon: FolderOpen, label: "Project", color: "text-rose-500" }
];

// Animated number counter
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1200;
    const step = Math.max(1, Math.round(end / (duration / 16)));
    const timer = setInterval(() => {
      start = Math.min(start + step, end);
      setDisplay(start);
      if (start >= end) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

function DashboardMemberAvatar({ member }: { member: Member }) {
  const label = member.name || member.email || member.initials;

  return (
    <div
      className="w-6 h-6 overflow-hidden rounded-full border-2 border-card flex items-center justify-center text-white text-[8px] font-bold shadow-sm"
      style={{ backgroundColor: member.color }}
      title={label}
      aria-label={label}
    >
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        member.initials.slice(0, 2)
      )}
    </div>
  );
}

function DashboardMemberAvatarStack({ members }: { members: Member[] }) {
  return (
    <div className="flex -space-x-2 shrink-0" aria-label={`${members.length} project members`}>
      {members.slice(0, 4).map((member, index) => (
        <DashboardMemberAvatar key={member.id ?? member.email ?? `${member.initials}-${index}`} member={member} />
      ))}
      {members.length > 4 && (
        <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[8px] font-semibold text-muted-foreground shadow-sm">
          +{members.length - 4}
        </div>
      )}
    </div>
  );
}

function WorkspaceUserAvatar({ user }: { user: WorkspaceUserOption }) {
  const [failed, setFailed] = useState(false);
  const label = user.name || user.email || user.initials;

  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: user.color }}
      title={label}
      aria-label={label}
    >
      {user.avatarUrl && !failed ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        user.initials.slice(0, 2)
      )}
    </span>
  );
}


function financialProjectShare(projects: DashboardProject[], valueForProject: (project: DashboardProject) => number) {
  const maxValue = Math.max(1, ...projects.map(valueForProject));
  return projects
    .map((project) => ({
      id: project.id,
      label: project.name,
      value: valueForProject(project),
      width: Math.max(4, Math.round((valueForProject(project) / maxValue) * 100))
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

// Progress ring SVG
function ProgressRing({ progress }: { progress: number }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const dash = (progress / 100) * circ;
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" className="-rotate-90">
      <circle cx="21" cy="21" r={r} strokeWidth="4" stroke="var(--color-muted)" fill="none" />
      <motion.circle
        cx="21" cy="21" r={r} strokeWidth="4" fill="none"
        stroke="var(--color-chart-3)"
        strokeDasharray={`${circ}`}
        strokeDashoffset={circ - dash}
        strokeLinecap="round"
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - dash }}
        transition={{ duration: 1, ease: "easeOut" }}
      />
      <text
        x="21" y="21" textAnchor="middle" dominantBaseline="central"
        className="fill-foreground text-[8px] font-bold rotate-90"
        style={{ transform: "rotate(90deg)", transformOrigin: "21px 21px", fontSize: 9, fontWeight: 700 }}
      >
        {progress}%
      </text>
    </svg>
  );
}

const STATUS_OPTIONS = [
  { value: "Active", label: "Active", color: "#16a34a" },
  { value: "In Review", label: "In Review", color: "#2563eb" },
  { value: "Planning", label: "Planning", color: "#0891b2" },
  { value: "On Hold", label: "On Hold", color: "#64748b" },
  { value: "At Risk", label: "At Risk", color: "#dc2626" },
  { value: "Completed", label: "Completed", color: "#16a34a" },
];

const PRIORITY_OPTIONS = [
  { value: "Critical", label: "Critical", color: "#dc2626" },
  { value: "High", label: "High", color: "#d97706" },
  { value: "Medium", label: "Medium", color: "#2563eb" },
  { value: "Low", label: "Low", color: "#16a34a" },
];

const COLOR_OPTIONS = [
  "#2563eb", // blue
  "#7c3aed", // purple
  "#059669", // emerald
  "#db2777", // pink
  "#d97706", // amber
  "#dc2626", // red
  "#64748b", // slate
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [projectsList, setProjectsList] = useState<DashboardProject[]>([]);
  const [accountOptions, setAccountOptions] = useState<LiveProjectAccountOption[]>([]);
  const [projectPage, setProjectPage] = useState(1);
  const [projectPagination, setProjectPagination] = useState<ResourceListPaginationMeta>(EMPTY_PROJECT_PAGINATION);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const createSubmittingRef = useRef(false);
  const createAttempt = useRef<ProjectCreateAttempt>({});
  const [accountLoadRevision, setAccountLoadRevision] = useState(0);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUserOption[]>([]);
  const [loadingWorkspaceUsers, setLoadingWorkspaceUsers] = useState(true);
  const [workspaceUsersError, setWorkspaceUsersError] = useState<string | null>(null);
  const [projectTab, setProjectTab] = useState<"last" | "deadline" | "costs">("last");

  // Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const createDialogRef = useDialogAccessibility(isCreateOpen, () => setIsCreateOpen(false));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState("");
  const [status, setStatus] = useState<"Active" | "In Review" | "Planning" | "On Hold" | "Completed" | "At Risk">("Active");
  const [priority, setPriority] = useState<"Critical" | "High" | "Medium" | "Low">("Medium");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  const [color, setColor] = useState("#2563eb");
  const [tags, setTags] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const displayName = user?.name ?? "Workspace";

  useEffect(() => {
    if (accountOptions.length > 0 && !accountOptions.some(option => option.value === client)) {
      setClient(accountOptions[0].value);
    }
  }, [accountOptions, client]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProjects() {
      try {
        setLoadingProjects(true);
        setDashboardError(null);
        const live = await fetchLiveProjects({
          limit: PROJECT_PAGE_SIZE,
          offset: (projectPage - 1) * PROJECT_PAGE_SIZE,
          signal: controller.signal
        });
        setProjectsList(live.projects.map(toDashboardProject));
        setProjectPagination(live.pagination);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedLiveProjectsError(error)) {
          redirectToLogin("/");
          return;
        }
        setProjectsList([]);
        setProjectPagination(EMPTY_PROJECT_PAGINATION);
        setDashboardError(error instanceof Error ? error.message : "Could not load live projects");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingProjects(false);
        }
      }
    }

    loadProjects();
    return () => controller.abort();
  }, [projectPage]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccountOptions() {
      setLoadingAccounts(true);
      try {
        const accounts = await fetchAccountOptions(controller.signal);
        if (controller.signal.aborted) return;
        setAccountOptions(accounts);
        setDashboardError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedLiveProjectsError(error)) {
          redirectToLogin("/");
          return;
        }
        setAccountOptions([]);
        setDashboardError(error instanceof Error ? error.message : "Could not load CRM accounts");
      } finally { if (!controller.signal.aborted) setLoadingAccounts(false); }
    }

    loadAccountOptions();
    return () => controller.abort();
  }, [accountLoadRevision]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkspaceUsers() {
      try {
        setLoadingWorkspaceUsers(true);
        setWorkspaceUsersError(null);
        setWorkspaceUsers(await fetchWorkspaceUserOptions(controller.signal));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedWorkspaceUsersError(error)) {
          redirectToLogin("/");
          return;
        }
        setWorkspaceUsers([]);
        setWorkspaceUsersError(error instanceof Error ? error.message : "Could not load synced workspace users");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingWorkspaceUsers(false);
        }
      }
    }

    loadWorkspaceUsers();
    return () => controller.abort();
  }, []);

  const dashboardStats = useMemo(() => {
    const totalTasks = projectsList.reduce((sum, project) => sum + project.tasks, 0);
    const activeProjects = projectsList.filter((project) => project.status === "Active").length;
    const uniqueAccounts = new Set(projectsList.map((project) => project.client).filter(Boolean)).size;
    return [
      { label: "Projects", value: projectPagination.total, icon: Briefcase, color: "text-primary", bg: "bg-primary/8" },
      { label: "Tasks Loaded", value: totalTasks, icon: FileText, color: "text-success", bg: "bg-success/8" },
      { label: "Active Loaded", value: activeProjects, icon: Users, color: "text-warning", bg: "bg-warning/8" },
      { label: "Accounts Loaded", value: uniqueAccounts, icon: FolderOpen, color: "text-info", bg: "bg-info/8" },
    ];
  }, [projectPagination.total, projectsList]);

  const financialSummary = useMemo(() => {
    const income = projectsList.reduce((sum, project) => sum + project.income, 0);
    const spent = projectsList.reduce((sum, project) => sum + project.spent, 0);
    const profit = Math.max(income - spent, 0);
    const incomeProjects = financialProjectShare(projectsList, (project) => project.income);
    const profitProjects = financialProjectShare(projectsList, (project) => Math.max(project.income - project.spent, 0));
    const radialData = [
      { name: "Cost", value: income > 0 ? Math.round((spent / income) * 100) : 0, fill: "#f97316" },
      { name: "Profit", value: income > 0 ? Math.round((profit / income) * 100) : 0, fill: "#16a34a" },
      { name: "Income", value: income > 0 ? 100 : 0, fill: "#2563eb" },
    ];
    return { income, spent, profit, incomeProjects, profitProjects, radialData };
  }, [projectsList]);

  const projectEvents = useMemo(() => {
    const grouped = projectsList.slice(0, 2).map((project, index) => ({
      id: project.id,
      app: project.name,
      count: Math.max(project.stages + project.tasks, 1),
      color: project.color,
      sub: [
        {
          user: project.client,
          action: `${project.stages} stages · ${project.tasks} tasks`,
          time: project.deadline === "TBD" ? "TBD" : project.deadline,
          tag: project.status,
          tagColor: project.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700",
          avatar: index === 0 ? "bg-emerald-500" : "bg-blue-500"
        }
      ]
    }));
    return grouped;
  }, [projectsList]);

  const visibleDashboardProjects = useMemo(() => {
    const list = [...projectsList];
    if (projectTab === "deadline") {
      return list.sort((a, b) => a.deadline.localeCompare(b.deadline));
    }
    if (projectTab === "costs") {
      return list.sort((a, b) => b.income - a.income);
    }
    return list;
  }, [projectTab, projectsList]);

  const clientOptions = accountOptions;

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06 } }
  };
  const staggerItem = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { type: "spring", damping: 25, stiffness: 300 } }
  } as const;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || createSubmittingRef.current) return;

    const selectedAccount = accountOptions.find(option => option.value === client);
    if (!selectedAccount) {
      setDashboardError("Select an existing CRM account before creating a production project.");
      return;
    }

    createSubmittingRef.current = true;
    setSavingProject(true);
    setDashboardError(null);

    try {
      const ownerUserId = selectedMembers[0];
      const parsedBudget = budget.trim() === "" ? 0 : Number(budget);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) throw new Error("Budget must be a valid positive number.");
      const response = await postProject(createAttempt.current, {
          accountId: selectedAccount.accountId,
          name: name.trim(),
          status: toBackendProjectStatus(status),
          ownerUserId: ownerUserId || undefined,
          memberUserIds: selectedMembers,
          budgetAmount: parsedBudget,
          plannedStartAt: uiProjectDateToIso(startDate),
          plannedEndAt: uiProjectDateToIso(dueDate),
          priority: priority.toLowerCase(),
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          color,
          scopeSummary: description.trim() || undefined,
          createStageTemplate: true
      });

      if (response.status === 401) {
        redirectToLogin("/");
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.message === "string" ? body.message : Array.isArray(body.message) ? body.message.join("; ") : `Could not create project: ${response.status}`);
      }

      const created = await response.json();
      createAttempt.current = {};
      setProjectsList(current => [toDashboardProject(mapProjectSummaryToUiProject(created)), ...current].slice(0, PROJECT_PAGE_SIZE));
      setProjectPagination(current => {
        const total = current.total + 1;
        const returned = Math.min(current.limit, current.returned + 1);
        return {
          ...current,
          total,
          returned,
          hasNextPage: current.offset + returned < total
        };
      });
      setProjectPage(1);
      setIsCreateOpen(false);

      // Reset Form
      setName("");
      setDescription("");
      setClient(accountOptions[0]?.value ?? "");
      setStatus("Active");
      setPriority("Medium");
      setBudget("");
      setStartDate(new Date().toISOString().slice(0, 10));
      setDueDate(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
      setColor("#2563eb");
      setTags("");
      setSelectedMembers([]);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Could not create project");
    } finally {
      createSubmittingRef.current = false;
      setSavingProject(false);
    }
  };

  return (
    <AppShell activeRoute="/" onCreateProjectClick={() => setIsCreateOpen(true)} title="Dashboard">
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">

          {/* Greeting */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👋</span>
              <div>
                <h1 className="text-xl font-bold text-foreground tracking-tight">Hi, {displayName}</h1>
                <p className="text-xs text-muted-foreground">Welcome back to UpLark Partner CRM operations workspace.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCreateOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs font-semibold shadow-sm shadow-primary/15 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Project</span>
              </button>
            </div>
          </div>

          {/* ── MAIN 3-COLUMN GRID ────────────────────────────────────────── */}
          {dashboardError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {dashboardError}
            </div>
          )}

          {loadingProjects && (
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground">
              Loading real CRM projects...
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_296px] gap-5">

            {/* ─ LEFT COLUMN ─────────────────────────────────────────────── */}
            <div className="space-y-4">

              {/* Stat cards 2-up */}
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="grid grid-cols-2 gap-3"
              >
                {dashboardStats.map((stat) => (
                  <motion.div
                    key={stat.label}
                    variants={staggerItem}
                    whileHover={{ y: -2 }}
                    className="bg-card border border-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-default"
                  >
                    <div className={`w-8 h-8 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center mb-3`}>
                      <stat.icon className="w-4 h-4" />
                    </div>
                    <h3 className="text-2xl font-bold font-mono tabular-nums text-foreground">
                      <AnimatedNumber value={stat.value} />
                    </h3>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                      {stat.label}
                    </p>
                  </motion.div>
                ))}
              </motion.div>

              {/* Quick Panel */}
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Quick Panel
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {QUICK_ACTIONS.map((action, i) => (
                    <motion.button
                      key={action.label}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => setIsCreateOpen(true)}
                      aria-label="Create a new project"
                      className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-border hover:bg-muted/70 hover:border-primary/20 transition-all w-full"
                    >
                      <action.icon className={`w-4 h-4 ${action.color}`} />
                      <span className="text-[11px] font-medium text-muted-foreground">{action.label}</span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Incoming Income sparkline */}
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Incoming income
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3 mb-2">
                  <h4 className="min-w-0 max-w-full text-2xl font-bold font-mono tabular-nums text-success"><MoneyAmount value={financialSummary.income} /></h4>
                  <div className="text-[11px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded-lg mb-0.5">
                    <span>{projectPageRangeLabel(projectPagination)}</span>
                  </div>
                </div>
                <div className="space-y-1.5" aria-label="Income by loaded project" data-testid="legacy-finance-income-mix">
                  {financialSummary.incomeProjects.length > 0 ? financialSummary.incomeProjects.map((item) => (
                    <div key={item.id} className="grid gap-1">
                      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{item.label}</span>
                        <strong className="font-mono tabular-nums text-foreground"><MoneyAmount value={item.value} /></strong>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full bg-success" style={{ width: `${item.width}%` }} />
                      </div>
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground">No loaded project income yet.</p>
                  )}
                </div>
              </div>

              {/* Profit from income sparkline */}
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Profit from income
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3 mb-2">
                  <h4 className="min-w-0 max-w-full text-2xl font-bold font-mono tabular-nums text-success"><MoneyAmount value={financialSummary.profit} /></h4>
                  <div className="text-[11px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded-lg mb-0.5">
                    <span>{financialSummary.income > 0 ? `${Math.round((financialSummary.profit / financialSummary.income) * 100)}%` : "0%"}</span>
                  </div>
                </div>
                <div className="space-y-1.5" aria-label="Profit by loaded project" data-testid="legacy-finance-profit-mix">
                  {financialSummary.profitProjects.length > 0 ? financialSummary.profitProjects.map((item) => (
                    <div key={item.id} className="grid gap-1">
                      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{item.label}</span>
                        <strong className="font-mono tabular-nums text-foreground"><MoneyAmount value={item.value} /></strong>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full bg-success" style={{ width: `${item.width}%` }} />
                      </div>
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground">No loaded project profit yet.</p>
                  )}
                </div>
              </div>

              {/* Financial Statistics radial */}
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Financial Statistics
                  </p>
                </div>

                {/* Radial ring chart */}
                <div className="h-48 w-full min-w-0 relative flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={192}>
                    <RadialBarChart
                      cx="50%" cy="50%"
                      innerRadius="25%" outerRadius="90%"
                      barSize={10}
                      data={financialSummary.radialData}
                      startAngle={90} endAngle={-270}
                    >
                      <RadialBar
                        background={{ fill: "var(--color-muted)" }}
                        dataKey="value"
                        cornerRadius={6}
                      />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div className="absolute flex flex-col items-center">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Total</span>
                    <span className="text-base font-bold font-mono tabular-nums text-foreground"><MoneyAmount value={financialSummary.income} /></span>
                  </div>
                </div>

                {/* Legend */}
                <div className="grid grid-cols-3 gap-1 border-t border-border pt-3 mt-2">
                  {[
                    { label: "Income", value: <MoneyAmount value={financialSummary.income} />, color: "bg-primary" },
                    { label: "Profit", value: <MoneyAmount value={financialSummary.profit} />, color: "bg-success" },
                    { label: "Cost", value: <MoneyAmount value={financialSummary.spent} />, color: "bg-warning" },
                  ].map((item) => (
                    <div key={item.label} className="text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <span className={`w-2 h-2 rounded-full ${item.color}`} />
                        <span className="text-[10px] text-muted-foreground">{item.label}</span>
                      </div>
                      <p className="text-xs font-bold font-mono tabular-nums text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ─ MIDDLE COLUMN ────────────────────────────────────────────── */}
            <div className="space-y-4 min-w-0">
              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                {/* Tabs */}
                <div className="flex items-center justify-between px-5 pt-4 pb-0 border-b border-border">
                  <div className="flex gap-1">
                    {(["last", "deadline", "costs"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setProjectTab(tab)}
                        className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all capitalize ${
                          projectTab === tab
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "last" ? "Last Projects" : tab === "deadline" ? "On Deadline" : "Costs"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Project rows */}
                <motion.div
                  key={projectTab}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="divide-y divide-border"
                >
                  {visibleDashboardProjects.map((proj, i) => (
                    <motion.div
                      key={proj.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, type: "spring", damping: 25, stiffness: 300 }}
                      className="px-5 py-4 hover:bg-muted/30 transition-colors"
                    >
                      {/* Title row */}
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-xl ${proj.color} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                            {proj.initials}
                          </div>
                          <div className="min-w-0">
                            <h5 className="text-[13.5px] font-semibold text-foreground truncate">{proj.name}</h5>
                          </div>
                        </div>
                        {/* Member avatars */}
                        <DashboardMemberAvatarStack members={proj.members} />
                      </div>

                      {/* Progress bar */}
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2.5">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${proj.progress}%` }}
                          transition={{ duration: 0.9, ease: "easeOut", delay: i * 0.06 }}
                          className="h-full bg-success rounded-full"
                        />
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center gap-5 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                          <span>{proj.stages} Stages</span>
                        </span>
                        <span className="flex items-center gap-1.5 font-mono tabular-nums">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>Deadline: {proj.deadline}</span>
                        </span>
                        <span className="flex items-center gap-1.5 font-mono tabular-nums ml-auto">
                          Income: <strong className="text-foreground"><MoneyAmount value={proj.income} /></strong>
                        </span>
                        <span className="font-mono tabular-nums">
                          <strong className="text-foreground">{proj.tasks}</strong> tasks
                        </span>
                      </div>
                    </motion.div>
                  ))}
                  {!loadingProjects && visibleDashboardProjects.length === 0 && (
                    <div className="px-5 py-10 text-center">
                      <p className="text-sm font-semibold text-foreground">No live projects available</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Connect a valid session or complete Lark Base migration before using the production dashboard.
                      </p>
                    </div>
                  )}
                </motion.div>
                <DashboardProjectPagination pagination={projectPagination} onPageChange={setProjectPage} />
              </div>
            </div>

            {/* ─ RIGHT COLUMN ─────────────────────────────────────────────── */}
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Latest events
                  </p>
                </div>

                <div className="divide-y divide-border overflow-y-auto max-h-[calc(100vh-180px)]">
                  {projectEvents.map((group) => (
                    <div key={group.id}>
                      {/* App header */}
                      <div className="px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-6 h-6 rounded-md ${group.color} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                            {group.app[0]}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-foreground">{group.app}</p>
                            <p className="text-[10px] text-muted-foreground">{group.count} Events</p>
                          </div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>

                      {/* Event sub-rows */}
                      {group.sub.map((ev, i) => (
                        <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                          {/* Avatar */}
                          <div className={`w-7 h-7 rounded-full ${ev.avatar} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                            {ev.user[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-foreground leading-tight">{ev.user}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{ev.action}</p>
                            {ev.tag && (
                              <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded mt-1 ${ev.tagColor}`}>
                                {ev.tag}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{ev.time}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {!loadingProjects && projectEvents.length === 0 && (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm font-semibold text-foreground">No live project events</p>
                      <p className="mt-1 text-xs text-muted-foreground">Events will appear after live CRM project activity is available.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </main>

        {/* Footer */}
        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>

        <AnimatePresence>
          {isCreateOpen && (
            <ModalLayer onClose={() => setIsCreateOpen(false)}>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div
                ref={createDialogRef} role="dialog" aria-modal="true" aria-labelledby="dashboard-create-title" tabIndex={-1}
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                className="bg-card border border-border rounded-2xl w-full max-w-2xl overflow-visible shadow-2xl flex flex-col max-h-[90dvh]"
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
                  <div>
                    <h3 id="dashboard-create-title" className="text-base font-bold text-foreground">Create New Project</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Define core properties, schedules, budget, and assign team members.</p>
                  </div>
                  <button
                    aria-label="Close create project dialog" type="button"
                    onClick={() => setIsCreateOpen(false)}
                    className="min-h-11 min-w-11 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Modal Body */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                  {dashboardError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{dashboardError}{accountOptions.length === 0 && <button type="button" className="ml-2 underline" onClick={() => setAccountLoadRevision(value => value + 1)}>Retry loading clients</button>}</div>}
                  {loadingAccounts && <p role="status">Loading clients…</p>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Project Name */}
                    <div className="space-y-1.5">
                      <label htmlFor="dashboard-project-name" className="text-xs font-semibold text-muted-foreground">Project Name <span className="text-destructive">*</span></label>
                      <input id="dashboard-project-name"
                        type="text"
                        required
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. Mobile App Redesign"
                        className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>

                    {/* Client */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Client</label>
                      <CustomDropdown
                        ariaLabel="Client"
                        options={clientOptions}
                        value={client}
                        onChange={setClient}
                        placeholder={clientOptions.length > 0 ? "Select CRM account" : "No CRM accounts loaded"}
                      />
                    </div>

                    {/* Budget */}
                    <div className="space-y-1.5">
                      <label htmlFor="dashboard-project-budget" className="text-xs font-semibold text-muted-foreground">Budget (đ)</label>
                      <input id="dashboard-project-budget"
                        type="number"
                        placeholder="e.g. 50000"
                        value={budget}
                        onChange={e => setBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>

                    {/* Status */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Status</label>
                      <CustomDropdown
                        ariaLabel="Status"
                        options={STATUS_OPTIONS}
                        value={status}
                        onChange={val => setStatus(val as any)}
                      />
                    </div>

                    {/* Priority */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Priority</label>
                      <CustomDropdown
                        ariaLabel="Priority"
                        options={PRIORITY_OPTIONS}
                        value={priority}
                        onChange={val => setPriority(val as any)}
                      />
                    </div>

                    {/* Start Date */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Start Date</label>
                      <CustomDatePicker
                        ariaLabel="Start Date"
                        value={startDate}
                        onChange={setStartDate}
                      />
                    </div>

                    {/* Due Date */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Due Date</label>
                      <CustomDatePicker
                        ariaLabel="Due Date"
                        value={dueDate}
                        onChange={setDueDate}
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label htmlFor="dashboard-project-description" className="text-xs font-semibold text-muted-foreground">Description</label>
                    <textarea id="dashboard-project-description"
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe the scope, objectives, and deliverables of this project..."
                      className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors resize-none"
                    />
                  </div>

                  {/* Highlight Color & Tags */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Tags */}
                    <div className="space-y-1.5">
                      <label htmlFor="dashboard-project-tags" className="text-xs font-semibold text-muted-foreground">Tags (comma-separated)</label>
                      <input id="dashboard-project-tags"
                        type="text"
                        value={tags}
                        onChange={e => setTags(e.target.value)}
                        placeholder="e.g. Core, Design, Marketing"
                        className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>

                    {/* Highlight Color */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Highlight Color</label>
                      <div className="flex items-center gap-2 pt-2">
                        {COLOR_OPTIONS.map(c => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Select project color ${c}`}
                            aria-pressed={color === c}
                            onClick={() => setColor(c)}
                            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center shrink-0"
                            style={{
                              backgroundColor: c,
                              borderColor: color === c ? "var(--color-foreground)" : "transparent",
                              boxShadow: color === c ? "0 0 0 2px var(--color-background)" : "none"
                            }}
                          >
                            {color === c && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Team Members Assignment */}
                  <div className="space-y-1.5 pt-2">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Assign Team Members ({selectedMembers.length} selected)</span>
                      <span className="text-[10px] text-muted-foreground">
                        {loadingWorkspaceUsers ? "Loading synced users..." : "Click to select/deselect"}
                      </span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-muted/20 border border-border p-3.5 rounded-xl">
                      {workspaceUsers.map(m => {
                        const isSelected = selectedMembers.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setSelectedMembers(selectedMembers.filter(x => x !== m.id));
                              } else {
                                setSelectedMembers([...selectedMembers, m.id]);
                              }
                            }}
                            className="flex items-center gap-2 p-2 rounded-lg border text-left transition-all hover:bg-card"
                            style={{
                              borderColor: isSelected ? m.color : "var(--color-border)",
                              backgroundColor: isSelected ? `${m.color}10` : "transparent"
                            }}
                          >
                            <WorkspaceUserAvatar user={m} />
                            <span className={`text-[11px] font-semibold truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                              {m.name}
                            </span>
                          </button>
                        );
                      })}
                      {!loadingWorkspaceUsers && workspaceUsers.length === 0 && (
                        <div className="col-span-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                          {workspaceUsersError ?? "No synced active users are available for assignment."}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Modal Action Buttons */}
                  <div className="flex items-center justify-end gap-2 pt-4 border-t border-border mt-6">
                    <button
                      type="button"
                      onClick={() => setIsCreateOpen(false)}
                      className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingProject || clientOptions.length === 0}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ backgroundColor: "var(--color-primary)" }}
                    >
                      {savingProject ? "Creating..." : "Create Project"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
            </ModalLayer>
          )}
        </AnimatePresence>
    </AppShell>
  );
}
