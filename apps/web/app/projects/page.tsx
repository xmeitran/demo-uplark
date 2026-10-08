"use client";
import { postProject, type ProjectCreateAttempt } from "@/lib/project-create-request";
import { MoneyAmount } from "@/components/money-amount";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";


import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Plus, Download, Sparkles, FileUp, MessageSquare,
  ChevronDown,
  Briefcase, Calendar, TrendingUp, AlertCircle,
  CheckCircle2, Clock, ArrowRight, Wallet, BarChart2, Layers, X, Pin, Pencil, Trash2, Check
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CustomDropdown, CustomDatePicker } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import { CrmMultiSelect, CrmSelect } from "@/components/crm-workspace/crm-select";
import { useAuth } from "@/lib/auth";
import {
  getPushedProjectsOwnerKey,
  readPushedProjectIds,
  writePushedProjectIds,
} from "@/lib/frontend-data-store";
import {
  fetchAccountOptions,
  fetchLiveProjects,
  isUnauthorizedLiveProjectsError,
  mapProjectSummaryToUiProject,
  PROJECT_PAGE_SIZE,
  formatProjectStatusLabel,
  toBackendProjectStatus,
  type LiveProjectAccountOption
} from "./live-projects";
import {
  fetchWorkspaceUserOptions,
  isUnauthorizedWorkspaceUsersError,
  type WorkspaceUserOption
} from "@/lib/workspace-users";
import { downloadCsv } from "@/lib/csv-export";
import { uiProjectDateToIso } from "@/lib/project-date";
import { systemRoleLabel } from "@/lib/people-roles";
import { loadExcelWorkbook } from "@/lib/excel-import";
import { WorkspaceTabBar, type WorkspaceTabItem } from "@/components/workspace-tab-bar";
import {
  ProjectSheet,
  type ProjectSheetSortDir,
  type ProjectSheetSortKey
} from "@/features/project-sheet/project-sheet";
import {
  buildProjectListUrl,
  readProjectListState,
  type ProjectListUrlState,
  type ProjectListView as UrlProjectListView
} from "@/lib/project-list-state";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = ProjectSheetSortKey;
type SortDir = ProjectSheetSortDir;

type ProjectListView = UrlProjectListView;
const PROJECT_LIST_VIEW_TABS: WorkspaceTabItem<ProjectListView>[] = [
  { id: "grid", label: "Tổng quan", description: "Cards dự án & trạng thái" },
  { id: "sheet", label: "Project Sheet", ariaLabel: "Project Sheet View", description: "Bảng dữ liệu & chi phí" },
  { id: "timeline", label: "Timeline", description: "Lịch thực hiện dự án" }
];

import { Project, PROJECTS, type Member } from "./data";
import type { ProjectMilestoneTemplateSummary, ProjectTaskTemplateInput, ResourceListPaginationMeta } from "@b2b-crm/contracts";

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  "Active":    { color:"#16a34a", bg:"#dcfce7", icon:CheckCircle2 },
  "In Review": { color:"#2563eb", bg:"#eff6ff", icon:BarChart2 },
  "Planning":  { color:"#0891b2", bg:"#e0f2fe", icon:Clock },
  "On Hold":   { color:"#64748b", bg:"#f1f5f9", icon:Clock },
  "Completed": { color:"#16a34a", bg:"#f0fdf4", icon:CheckCircle2 },
  "At Risk":   { color:"#dc2626", bg:"#fee2e2", icon:AlertCircle },
};

const PRIORITY_CFG = {
  Critical: { color:"#dc2626", bg:"#fee2e2" },
  High:     { color:"#d97706", bg:"#fef3c7" },
  Medium:   { color:"#2563eb", bg:"#eff6ff" },
  Low:      { color:"#16a34a", bg:"#f0fdf4" },
};

const LOCAL_AUTO_AUTH_ENABLED = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_LOCAL_AUTO_AUTH === "true";

function redirectToLogin(returnTo = "/projects") {
  if (LOCAL_AUTO_AUTH_ENABLED) return;
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

type DraftMilestone = {
  name: string;
  stages: { name: string; tasks?: ProjectTaskTemplateInput[] }[];
};

function countTemplateTasks(tasks: ProjectTaskTemplateInput[]): number {
  return tasks.reduce((total, task) => total + 1 + countTemplateTasks(task.subtasks ?? []), 0);
}

function countTemplateSubtasks(tasks: ProjectTaskTemplateInput[]): number {
  return tasks.reduce((total, task) => total + (task.subtasks?.length ?? 0) + countTemplateSubtasks(task.subtasks ?? []), 0);
}

function DraftHierarchyTree({ milestones }: { milestones: DraftMilestone[] }) {
  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-1" aria-label="Cấu trúc bản nháp project">
      {milestones.map((milestone, milestoneIndex) => {
        const stageCount = milestone.stages.length;
        const taskCount = milestone.stages.reduce((total, stage) => total + countTemplateTasks(stage.tasks ?? []), 0);
        return (
          <section key={`${milestone.name}-${milestoneIndex}`} className="rounded-xl border border-border bg-background p-2.5">
            <div className="flex items-start gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[10px] font-bold text-primary">M{milestoneIndex + 1}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{milestone.name}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{stageCount} stage · {taskCount} task</p></div>
            </div>
            <div className="mt-2 space-y-2 border-l-2 border-primary/15 pl-3">
              {milestone.stages.length ? milestone.stages.map((stage, stageIndex) => {
                const tasks = stage.tasks ?? [];
                return (
                  <div key={`${stage.name}-${stageIndex}`} className="rounded-lg border border-indigo-100 bg-indigo-50/35 p-2">
                    <div className="flex items-center gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-[9px] font-bold text-indigo-700">S{stageIndex + 1}</span><span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-indigo-950">{stage.name}</span><span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[9px] text-indigo-700">{tasks.length} task</span></div>
                    <div className="mt-1.5 space-y-1 border-l-2 border-indigo-200 pl-2">
                      {tasks.length ? tasks.map((task, taskIndex) => <div key={`${task.title}-${taskIndex}`} className="rounded-md border border-border/70 bg-background px-2 py-1.5"><div className="flex items-start gap-1.5"><span className="mt-0.5 text-[9px] font-bold text-primary">T{taskIndex + 1}</span><p className="min-w-0 flex-1 text-[10px] font-medium leading-relaxed">{task.title}</p>{task.subtasks?.length ? <span className="shrink-0 text-[9px] text-muted-foreground">{task.subtasks.length} sub</span> : null}</div>{task.subtasks?.length ? <div className="mt-1 space-y-1 border-l-2 border-primary/15 pl-2">{task.subtasks.map((subtask, subtaskIndex) => <div key={`${subtask.title}-${subtaskIndex}`} className="flex gap-1.5 text-[9px] leading-relaxed text-muted-foreground"><span className="font-semibold text-primary/70">ST{subtaskIndex + 1}</span><span>{subtask.title}</span></div>)}</div> : null}</div>) : <p className="px-1 py-1 text-[10px] italic text-muted-foreground">Chưa có task</p>}
                    </div>
                  </div>
                );
              }) : <p className="px-1 py-1 text-[10px] italic text-muted-foreground">Chưa có stage</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function projectPageRangeLabel(meta: ResourceListPaginationMeta) {
  if (meta.total === 0 || meta.returned === 0) return "0 / 0 projects";
  const start = meta.offset + 1;
  const end = meta.offset + meta.returned;
  return `${start}-${end} / ${meta.total} projects`;
}

function getProjectCode(project: Project) {
  return project.tags[0] ?? "";
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function formatUiDateFromDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function defaultProjectStartDate() {
  return formatUiDateFromDate(new Date());
}

function defaultProjectDueDate() {
  return formatUiDateFromDate(addDays(new Date(), 90));
}

function ProjectPaginationControls({
  pagination,
  onPageChange
}: {
  pagination: ResourceListPaginationMeta;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return (
    <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto sm:min-w-[15rem]" aria-label="Projects pagination">
      <button
        type="button"
        disabled={pagination.total <= 0 || !pagination.hasPreviousPage}
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
        disabled={pagination.total <= 0 || !pagination.hasNextPage}
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
      >
        Next
      </button>
    </div>
  );
}

function ProjectMemberAvatar({ member, size = "sm" }: { member: Member; size?: "sm" | "md" }) {
  const sizeClass = size === "md" ? "w-8 h-8 text-[10px]" : "w-6 h-6 text-[9px]";
  const label = member.name || member.email || member.initials;

  return (
    <div
      className={`${sizeClass} overflow-hidden rounded-full border-2 border-card flex items-center justify-center font-bold text-white shadow-sm`}
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

function ProjectMemberAvatarStack({ members, limit = 4 }: { members: Member[]; limit?: number }) {
  const visibleMembers = members.slice(0, limit);

  return (
    <div className="flex -space-x-1.5" aria-label={`${members.length} project members`}>
      {visibleMembers.map((member, index) => (
        <ProjectMemberAvatar key={member.id ?? member.email ?? `${member.initials}-${index}`} member={member} />
      ))}
      {members.length > limit && (
        <div className="w-6 h-6 rounded-full border-2 border-card bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground shadow-sm">
          +{members.length - limit}
        </div>
      )}
    </div>
  );
}

// ─── Card Component ────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  returnTo,
  isPushed,
  onTogglePush,
  onEdit,
  onDelete
}: {
  project: Project;
  returnTo: string;
  isPushed: boolean;
  onTogglePush: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sc = STATUS_CFG[project.status];
  const pc = PRIORITY_CFG[project.priority];
  const budgetPct = project.budget > 0 ? Math.round((project.spent / project.budget) * 100) : 0;

  return (
    <Link href={`/projects/${encodeURIComponent(project.id)}?returnTo=${encodeURIComponent(returnTo)}`} className="block h-full group">
      <motion.div layout initial={{ opacity:0, scale:0.96 }} animate={{ opacity:1, scale:1 }} whileHover={{ y:-3 }}
        className="min-w-0 bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer flex h-full flex-col gap-4">
        {/* Top */}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0" style={{ backgroundColor:`${project.color}20` }}>
              <Layers className="w-5 h-5" style={{ color:project.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p title={project.name} className="line-clamp-2 break-words text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-primary">{project.name}</p>
              <p title={`${project.category} · ${project.client}`} className="mt-0.5 truncate text-[10px] text-muted-foreground">{project.category} · {project.client}</p>
            </div>
          </div>
          <span title={project.priority} className="max-w-[5rem] shrink-0 truncate rounded-lg px-2 py-0.5 text-[9px] font-bold" style={{ backgroundColor:pc.bg, color:pc.color }}>
            {project.priority}
          </span>
        </div>

        {/* Description */}
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{project.description}</p>

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground">Progress</span>
            <span className="text-[10px] font-bold font-mono" style={{ color:project.color }}>{project.progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width:0 }} animate={{ width:`${project.progress}%` }} transition={{ duration:0.7, ease:"easeOut" }}
              className="h-full rounded-full" style={{ backgroundColor:project.color }} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-sm font-bold font-mono text-foreground">{project.tasks.done}/{project.tasks.total}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Tasks</p>
          </div>
          <div className="text-center border-x border-border">
            <p className="text-sm font-bold font-mono text-foreground"><MoneyAmount value={project.budget} /></p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Budget</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold font-mono" style={{ color: budgetPct > 90 ? "#dc2626" : "var(--color-foreground)" }}>{budgetPct}%</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Spent</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <ProjectMemberAvatarStack members={project.members} />
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor:sc.bg, color:sc.color }}>
              <sc.icon className="w-3 h-3" />{formatProjectStatusLabel(project.status)}
            </span>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit();
              }}
              title="Edit project"
              className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              title="Delete project"
              className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTogglePush();
              }}
              title={isPushed ? "Unpush from Sidebar Menu" : "Push to Sidebar Menu"}
              className={`p-1.5 rounded-lg transition-colors ${
                isPushed
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              <Pin className="w-3.5 h-3.5" style={{ transform: isPushed ? "none" : "rotate(45deg)" }} />
            </button>
            <div className="p-1.5 rounded-lg bg-muted group-hover:bg-primary/10 text-muted-foreground group-hover:text-primary transition-all">
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "Active", label: "Đang triển khai", color: "#16a34a" },
  { value: "In Review", label: "Đang rà soát", color: "#2563eb" },
  { value: "Planning", label: "Lập kế hoạch", color: "#0891b2" },
  { value: "On Hold", label: "Tạm dừng", color: "#64748b" },
  { value: "At Risk", label: "Có rủi ro", color: "#dc2626" },
  { value: "Completed", label: "Đã hoàn thành", color: "#16a34a" },
];

const PRIORITY_OPTIONS = [
  { value: "Critical", label: "Critical", color: "#dc2626" },
  { value: "High", label: "High", color: "#d97706" },
  { value: "Medium", label: "Medium", color: "#2563eb" },
  { value: "Low", label: "Low", color: "#16a34a" },
];

const CATEGORY_OPTIONS = [
  { value: "Delivery", label: "Delivery" },
  { value: "Implementation", label: "Implementation" },
  { value: "Proposal", label: "Proposal" },
  { value: "Qualified", label: "Qualified" },
  { value: "Won", label: "Won" }
];

const PROJECT_CATEGORY_FILTER_OPTIONS = [
  { value: "Delivery", label: "Delivery" },
  { value: "Implementation", label: "Implementation" },
  { value: "Proposal", label: "Proposal" },
  { value: "Qualified", label: "Qualified" },
  { value: "Won", label: "Won" }
];

function UserAvatar({ user, size = "md" }: { user: WorkspaceUserOption; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const className = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white`}
      style={{ backgroundColor: user.color }}
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
        user.initials
      )}
    </span>
  );
}

function ProjectUserDropdown({
  users,
  value,
  onChange,
  placeholder = "Select PIC"
}: {
  users: WorkspaceUserOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <CrmSelect
      ariaLabel="PIC dự án"
      disabled={users.length === 0}
      options={[
        { value: "none", label: users.length === 0 ? "No synced users" : "Unassigned" },
        ...users.map((user) => ({
          value: user.id,
          label: user.name,
          meta: `${user.role || "Chưa gán"} · ${systemRoleLabel(user.systemRole)}${user.email ? ` · ${user.email}` : ""}`,
          avatarUrl: user.avatarUrl,
          initials: user.initials,
          color: user.color
        }))
      ]}
      searchable
      searchPlaceholder="Tìm tên, email hoặc vai trò..."
      value={value || "none"}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

function ProjectMemberMultiSelect({ users, selectedIds, onChange, placeholder = "Select project members" }: { users: WorkspaceUserOption[]; selectedIds: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  return (
    <CrmMultiSelect
      ariaLabel="Thành viên dự án"
      disabled={users.length === 0}
      options={users.map((user) => ({
        value: user.id,
        label: user.name,
        meta: `${user.role || "Chưa gán"} · ${systemRoleLabel(user.systemRole)} · ${user.email}`,
        avatarUrl: user.avatarUrl,
        initials: user.initials,
        color: user.color
      }))}
      placeholder={users.length === 0 ? "No synced users" : placeholder}
      selectedCountLabel={(count) => `${count} đã chọn`}
      values={selectedIds}
      onChange={onChange}
    />
  );
}

interface ProjectEditValues {
  name: string;
  code: string;
  client: string;
  status: Project["status"];
  projectType: string;
  scopeSummary: string;
  ownerUserId: string;
  memberUserIds: string[];
  budgetAmount: string;
  plannedStartAt: string;
  plannedEndAt: string;
}

type ProjectClientOption = { value: string; label: string; accountId?: string };

function ProjectEditModal({
  project,
  clientOptions,
  workspaceUsers,
  loadingWorkspaceUsers,
  workspaceUsersError,
  isSaving,
  error,
  onClose,
  onSave
}: {
  project: Project;
  clientOptions: ProjectClientOption[];
  workspaceUsers: WorkspaceUserOption[];
  loadingWorkspaceUsers: boolean;
  workspaceUsersError: string | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: ProjectEditValues) => void;
}) {
  const editDialogRef = useDialogAccessibility(true, () => { if (!isSaving) onClose(); });
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(getProjectCode(project));
  const [client, setClient] = useState(project.client);
  const [status, setStatus] = useState<Project["status"]>(project.status);
  const [projectType, setProjectType] = useState(project.category || "Delivery");
  const [scopeSummary, setScopeSummary] = useState(project.scopeSummary ?? "");
  const initialMemberIds = project.memberUserIds ?? project.members.map((member) => member.id).filter((id): id is string => Boolean(id));
  const [ownerUserId, setOwnerUserId] = useState(project.ownerUserId ?? initialMemberIds[0] ?? "none");
  const [memberUserIds, setMemberUserIds] = useState<string[]>(initialMemberIds);
  const [budgetAmount, setBudgetAmount] = useState(project.budget > 0 ? String(project.budget) : "");
  const [plannedStartAt, setPlannedStartAt] = useState(project.startDate);
  const [plannedEndAt, setPlannedEndAt] = useState(project.dueDate);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isSaving) return;
    onSave({
      name: name.trim(),
      code: code.trim(),
      client,
      status,
      projectType,
      scopeSummary: scopeSummary.trim(),
      ownerUserId,
      memberUserIds,
      budgetAmount,
      plannedStartAt,
      plannedEndAt
    });
  };

  return (
    <ModalLayer onClose={onClose}>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        ref={editDialogRef} role="dialog" aria-modal="true" aria-label="Edit Project" tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90dvh] overflow-visible shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div>
            <h3 className="text-base font-bold text-foreground">Edit Project</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Update persisted CRM fields for this workspace project.</p>
          </div>
          <button
            aria-label="Close edit project dialog"
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Project Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                aria-label="Project Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-project-code" className="text-xs font-semibold text-muted-foreground">Project Code</label>
              <input id="edit-project-code"
                type="text"
                aria-label="Project Code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Status</label>
              <CustomDropdown
                ariaLabel="Status"
                options={STATUS_OPTIONS}
                value={status}
                onChange={(value) => setStatus(value as Project["status"])}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Project Type</label>
              <CustomDropdown
                ariaLabel="Project Type"
                options={CATEGORY_OPTIONS}
                value={projectType}
                onChange={setProjectType}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Client Account</label>
              <CustomDropdown
                ariaLabel="Client Account"
                options={clientOptions}
                value={client}
                onChange={setClient}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">PIC</label>
              <ProjectUserDropdown
                users={workspaceUsers}
                value={ownerUserId}
                onChange={(value) => {
                  setOwnerUserId(value);
                  if (value !== "none" && !memberUserIds.includes(value)) {
                    setMemberUserIds((current) => [...current, value]);
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-project-budget" className="text-xs font-semibold text-muted-foreground">Budget (đ)</label>
              <input id="edit-project-budget"
                type="number"
                min="0"
                step="1"
                aria-label="Budget"
                value={budgetAmount}
                onChange={(event) => setBudgetAmount(event.target.value)}
                className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Planned Start</label>
              <CustomDatePicker ariaLabel="Planned Start Date" value={plannedStartAt} onChange={setPlannedStartAt} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Planned End</label>
              <CustomDatePicker ariaLabel="Planned End Date" value={plannedEndAt} onChange={setPlannedEndAt} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-project-scope" className="text-xs font-semibold text-muted-foreground">Project Scope</label>
            <textarea id="edit-project-scope"
              rows={3}
              value={scopeSummary}
              onChange={(event) => setScopeSummary(event.target.value)}
              placeholder="Describe scope, objectives, deliverables, and key boundaries..."
              className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Project Members ({memberUserIds.length} selected)</span>
              <span className="text-[10px] text-muted-foreground">
                {loadingWorkspaceUsers ? "Loading synced users..." : "Synced workspace users"}
              </span>
            </label>
            <ProjectMemberMultiSelect
              users={workspaceUsers}
              selectedIds={memberUserIds}
              onChange={setMemberUserIds}
            />
            {!loadingWorkspaceUsers && workspaceUsers.length === 0 && (
              <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                {workspaceUsersError ?? "No synced active users are available for assignment."}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

function ProjectDeleteConfirmModal({
  project,
  isDeleting,
  error,
  onCancel,
  onConfirm
}: {
  project: Project;
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const deleteDialogRef = useDialogAccessibility(true, () => { if (!isDeleting) onCancel(); });
  return (
    <ModalLayer closeOnEscape={!isDeleting} onClose={onCancel}>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        ref={deleteDialogRef} role="alertdialog" aria-modal="true" aria-label="Delete Project" tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-border bg-red-50">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Delete Project</h3>
              <p className="text-xs text-muted-foreground mt-1">
                This removes the project only if production rules allow it.
              </p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-semibold text-foreground">{project.name}</span>? Projects with tasks are protected and the API will block deletion.
          </p>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={onConfirm}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 shadow-md hover:bg-red-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isDeleting ? "Deleting..." : "Delete Project"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

const COLOR_OPTIONS = [
  "#2563eb", // blue
  "#7c3aed", // purple
  "#059669", // emerald
  "#db2777", // pink
  "#d97706", // amber
  "#dc2626", // red
  "#64748b", // slate
];

const PILOT_PROJECT_MILESTONES = [
  "Nhận brief & kick-off dự án",
  "Xây dựng hệ thống",
  "Pilot, Onboarding, Nghiệm thu hệ thống",
  "Bảo trì"
];

function parseProjectTimelineDate(value: string) {
  if (!value || value === "TBD") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getYearTimelineBounds(today: Date) {
  const start = new Date(today.getFullYear(), 0, 1);
  const end = new Date(today.getFullYear() + 1, 0, 1);
  return { start, end };
}

function timelinePercent(date: Date, start: Date, end: Date) {
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return 0;
  return Math.min(100, Math.max(0, ((date.getTime() - start.getTime()) / totalMs) * 100));
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectListSearch = searchParams.toString();
  const urlState = useMemo(
    () => readProjectListState(new URLSearchParams(projectListSearch)),
    [projectListSearch]
  );
  const pushedProjectOwnerKey = getPushedProjectsOwnerKey(user);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [accountOptions, setAccountOptions] = useState<LiveProjectAccountOption[]>([]);
  const [projectPage, setProjectPage] = useState(urlState.page);
  const [projectPagination, setProjectPagination] = useState<ResourceListPaginationMeta>(EMPTY_PROJECT_PAGINATION);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [usingLocalProjectFallback, setUsingLocalProjectFallback] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const createSubmittingRef = useRef(false);
  const createAttempt = useRef<ProjectCreateAttempt>({});
  const [accountLoadRevision, setAccountLoadRevision] = useState(0);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUserOption[]>([]);
  const [loadingWorkspaceUsers, setLoadingWorkspaceUsers] = useState(true);
  const [workspaceUsersError, setWorkspaceUsersError] = useState<string | null>(null);
  const [pushedIds, setPushedIds] = useState<string[]>([]);
  const [view, setView]         = useState<ProjectListView>(urlState.view);
  const [query, setQuery]       = useState(urlState.query);
  const [statusFilter, setStatusFilter]   = useState(urlState.statusFilter);
  const [categoryFilter, setCategoryFilter] = useState(urlState.categoryFilter);
  const [clientFilter, setClientFilter] = useState(urlState.clientFilter);
  const [ownerFilter, setOwnerFilter] = useState(urlState.ownerFilter);
  const [sortKey, setSortKey]   = useState<SortKey>(urlState.sortKey);
  const [sortDir, setSortDir]   = useState<SortDir>(urlState.sortDir);
  const resultsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProjectPage(urlState.page);
    setView(urlState.view);
    setQuery(urlState.query);
    setStatusFilter(urlState.statusFilter);
    setCategoryFilter(urlState.categoryFilter);
    setClientFilter(urlState.clientFilter);
    setOwnerFilter(urlState.ownerFilter);
    setSortKey(urlState.sortKey);
    setSortDir(urlState.sortDir);
  }, [projectListSearch, urlState]);

  const updateProjectListUrl = (overrides: Partial<ProjectListUrlState>) => {
    router.replace(buildProjectListUrl({ ...urlState, ...overrides }), { scroll: false });
  };

  const currentProjectListUrl = useMemo(
    () => buildProjectListUrl({
      query,
      statusFilter,
      categoryFilter,
      clientFilter,
      ownerFilter,
      page: projectPage,
      view,
      sortKey,
      sortDir
    }),
    [query, statusFilter, categoryFilter, clientFilter, ownerFilter, projectPage, view, sortKey, sortDir]
  );

  const resetProjectsFrameScroll = () => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      resultsScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  };

  // Load real projects from the CRM API. Static seeds are dev-only fallback so
  // production never masks a failed Lark/Base migration with mock records.
  useEffect(() => {
    const controller = new AbortController();

    async function loadProjects() {
      try {
        setLoadingProjects(true);
        setProjectsError(null);
        const live = await fetchLiveProjects({
          limit: PROJECT_PAGE_SIZE,
          offset: (projectPage - 1) * PROJECT_PAGE_SIZE,
          q: query,
          status: statusFilter as Project["status"] | "all",
          category: categoryFilter,
          accountId: clientFilter,
          ownerUserId: ownerFilter,
          signal: controller.signal
        });
        setProjectsList(live.projects);
        setProjectPagination(live.pagination);
        setUsingLocalProjectFallback(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedLiveProjectsError(error)) {
          redirectToLogin("/projects");
          return;
        }
        const localDevelopment = process.env.NODE_ENV !== "production";
        const normalizedQuery = query.trim().toLowerCase();
        const fallbackProjects = PROJECTS.filter((project) => {
          const matchesQuery = !normalizedQuery || `${project.name} ${project.client} ${project.description}`.toLowerCase().includes(normalizedQuery);
          const matchesStatus = statusFilter === "all" || project.status === statusFilter;
          const matchesCategory = categoryFilter === "all" || project.category === categoryFilter;
          const matchesClient = clientFilter === "all" || project.accountId === clientFilter;
          const matchesOwner = ownerFilter === "all" || project.ownerUserId === ownerFilter;
          return matchesQuery && matchesStatus && matchesCategory && matchesClient && matchesOwner;
        });
        setUsingLocalProjectFallback(localDevelopment);
        setProjectsError(localDevelopment ? null : error instanceof Error ? error.message : "Could not load live projects");
        setProjectsList(localDevelopment ? fallbackProjects : []);
        setProjectPagination(localDevelopment ? {
          limit: PROJECT_PAGE_SIZE,
          offset: 0,
          returned: fallbackProjects.length,
          total: fallbackProjects.length,
          hasNextPage: false,
          hasPreviousPage: false
        } : EMPTY_PROJECT_PAGINATION);
      } finally {
        if (!controller.signal.aborted) {
          setLoadingProjects(false);
        }
      }
    }

    loadProjects();
    if (typeof window !== "undefined") {
      setPushedIds(readPushedProjectIds(pushedProjectOwnerKey));
    }

    return () => controller.abort();
  }, [projectPage, query, statusFilter, categoryFilter, clientFilter, ownerFilter, pushedProjectOwnerKey]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccountOptions() {
      setLoadingAccounts(true);
      try {
        const accounts = await fetchAccountOptions(controller.signal);
        if (controller.signal.aborted) return;
        setAccountOptions(accounts);
        setProjectsError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedLiveProjectsError(error)) {
          redirectToLogin("/projects");
          return;
        }
        setAccountOptions([]);
        if (process.env.NODE_ENV === "production") {
          setProjectsError(error instanceof Error ? error.message : "Could not load CRM accounts");
        }
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
          redirectToLogin("/projects");
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

  const handleTogglePush = (id: string) => {
    const next = pushedIds.includes(id)
      ? pushedIds.filter(x => x !== id)
      : [...pushedIds, id];
    setPushedIds(next);
    writePushedProjectIds(next, pushedProjectOwnerKey);
  };

  // Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const createDialogRef = useDialogAccessibility(isCreateOpen, () => setIsCreateOpen(false));
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [projectMutationError, setProjectMutationError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState("");
  const [status, setStatus] = useState<Project["status"]>("Active");
  const [priority, setPriority] = useState<Project["priority"]>("Medium");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState(defaultProjectStartDate);
  const [dueDate, setDueDate] = useState(defaultProjectDueDate);
  const [color, setColor] = useState("#2563eb");
  const [tags, setTags] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [milestoneMode, setMilestoneMode] = useState<"auto" | "manual">("auto");
  const [milestoneTemplateKey, setMilestoneTemplateKey] = useState("pilot-v1");
  const [milestoneTemplates, setMilestoneTemplates] = useState<ProjectMilestoneTemplateSummary[]>([]);
  const [projectMilestones, setProjectMilestones] = useState<string[]>(PILOT_PROJECT_MILESTONES);
  const [projectMilestoneStages, setProjectMilestoneStages] = useState<string[][]>(PILOT_PROJECT_MILESTONES.map((milestone) => [`${milestone} - Stage 1`]));
  const [projectMilestoneStageTasks, setProjectMilestoneStageTasks] = useState<ProjectTaskTemplateInput[][][]>(PILOT_PROJECT_MILESTONES.map(() => [[]]));
  const [aiImportBusy, setAiImportBusy] = useState(false);
  const [aiImportError, setAiImportError] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<{ sourceFileName: string; projectName: string; description: string; milestones: DraftMilestone[]; warnings: string[] } | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const aiImportInputRef = useRef<HTMLInputElement | null>(null);

  const handleSort = (k: SortKey, direction?: SortDir) => {
    const nextDir = direction ?? (sortKey === k ? (sortDir === "asc" ? "desc" : "asc") : "asc");
    setSortKey(k);
    setSortDir(nextDir);
    updateProjectListUrl({ sortKey: k, sortDir: nextDir });
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setProjectPage(1);
    updateProjectListUrl({ query: value, page: 1 });
    resetProjectsFrameScroll();
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setProjectPage(1);
    updateProjectListUrl({ statusFilter: value, page: 1 });
    resetProjectsFrameScroll();
  };

  const handleCategoryFilterChange = (value: string) => {
    setCategoryFilter(value);
    setProjectPage(1);
    updateProjectListUrl({ categoryFilter: value, page: 1 });
    resetProjectsFrameScroll();
  };

  const handleClientFilterChange = (value: string) => {
    setClientFilter(value);
    setProjectPage(1);
    updateProjectListUrl({ clientFilter: value, page: 1 });
    resetProjectsFrameScroll();
  };

  const handleOwnerFilterChange = (value: string) => {
    setOwnerFilter(value);
    setProjectPage(1);
    updateProjectListUrl({ ownerFilter: value, page: 1 });
    resetProjectsFrameScroll();
  };

  const handleProjectPageChange = (page: number) => {
    setProjectPage(page);
    updateProjectListUrl({ page });
    resetProjectsFrameScroll();
  };

  const filterStatusOptions = useMemo(() => [
    { value: "all", label: "Tất cả trạng thái" },
    ...STATUS_OPTIONS
  ], []);

  const filterCategoryOptions = useMemo(() => [
    { value: "all", label: "All Categories" },
    ...PROJECT_CATEGORY_FILTER_OPTIONS
  ], []);

  const filterClientOptions = useMemo(() => [
    { value: "all", label: "Tất cả Client" },
    ...accountOptions.map((account) => ({ value: account.accountId, label: account.label })),
  ], [accountOptions]);

  const filterOwnerOptions = useMemo(() => [
    { value: "all", label: "Tất cả PIC" },
    ...workspaceUsers.map((member) => ({ value: member.id, label: member.name, avatarUrl: member.avatarUrl, initials: member.initials, color: member.color })),
  ], [workspaceUsers]);

  const filtered = useMemo(() => {
    let list = projectsList;
    list = [...list].sort((a, b) => {
      const map: Record<SortKey, number | string> = { name:a.name, status:a.status, progress:a.progress, budget:a.budget, dueDate:a.dueDate, priority: ["Critical","High","Medium","Low"].indexOf(a.priority) };
      const mapB: Record<SortKey, number | string> = { name:b.name, status:b.status, progress:b.progress, budget:b.budget, dueDate:b.dueDate, priority: ["Critical","High","Medium","Low"].indexOf(b.priority) };
      const va = map[sortKey], vb = mapB[sortKey];
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return list;
  }, [projectsList, sortKey, sortDir]);

  // KPI stats
  const totalBudget = useMemo(() => projectsList.reduce((s, p) => s + p.budget, 0), [projectsList]);
  const totalSpent  = useMemo(() => projectsList.reduce((s, p) => s + p.spent, 0), [projectsList]);
  const active      = useMemo(() => projectsList.filter(p => p.status === "Active").length, [projectsList]);
  const atRisk      = useMemo(() => projectsList.filter(p => p.status === "At Risk").length, [projectsList]);

  const clientOptions: ProjectClientOption[] = accountOptions;

  useEffect(() => {
    if (accountOptions.length > 0 && !accountOptions.some(option => option.value === client)) {
      setClient(accountOptions[0].value);
    }
  }, [accountOptions, client]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/milestone-templates?principal=founder", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => null) as { data?: ProjectMilestoneTemplateSummary[] } | null;
        const templates = body?.data ?? [];
        if (controller.signal.aborted) return;
        setMilestoneTemplates(templates);
        const preferred = templates.find((template) => template.key === "pilot-v1") ?? templates[0];
        if (preferred) {
          setMilestoneTemplateKey(preferred.key);
          setProjectMilestones(preferred.milestones.map((milestone) => milestone.name));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const handleAiImport = async (file: File) => {
    setAiImportBusy(true);
    setAiImportError(null);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("File tối đa 8 MB.");
      const isImage = file.type.startsWith("image/");
      let body: { fileName: string; text?: string; imageDataUrl?: string } = { fileName: file.name };
      if (isImage) {
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("Không đọc được hình ảnh."));
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(file);
        });
        body.imageDataUrl = imageDataUrl;
      } else {
        if (file.name.toLowerCase().endsWith(".csv")) {
          body.text = await file.text();
        } else if (file.name.toLowerCase().endsWith(".xls")) {
          throw new Error("Vui lòng lưu file XLS thành XLSX trước khi import.");
        } else {
        const workbook = await loadExcelWorkbook(await file.arrayBuffer());
        const rows: string[] = [];
        workbook.eachSheet((sheet) => {
          rows.push(`SHEET: ${sheet.name}`);
          sheet.eachRow((row) => {
            const values = Array.isArray(row.values) ? row.values.slice(1) : [];
            if (values.some((value) => String(value ?? "").trim())) rows.push(values.map((value) => String(value ?? "").replace(/\t/g, " ")).join("\t"));
          });
        });
        body.text = rows.join("\n");
        }
      }
      const response = await fetch("/api/projects/ai-template-draft", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "Không tạo được template tạm từ file.");
      const draft = payload?.data;
      if (!draft?.milestones?.length) throw new Error("Không tìm thấy milestone trong file.");
      setAiDraft(draft);
    } catch (error) {
      setAiImportError(error instanceof Error ? error.message : "Không thể đọc file.");
    } finally {
      setAiImportBusy(false);
      if (aiImportInputRef.current) aiImportInputRef.current.value = "";
    }
  };

  const applyAiDraft = () => {
    if (!aiDraft) return;
    if (aiDraft.projectName) setName(aiDraft.projectName);
    if (aiDraft.description) setDescription(aiDraft.description);
    setProjectMilestones(aiDraft.milestones.map((milestone) => milestone.name));
    setProjectMilestoneStages(aiDraft.milestones.map((milestone) => milestone.stages.length ? milestone.stages.map((stage) => stage.name) : [`${milestone.name} - Stage 1`]));
    setProjectMilestoneStageTasks(aiDraft.milestones.map((milestone) => milestone.stages.length ? milestone.stages.map((stage) => stage.tasks ?? []) : [[]]));
    setMilestoneMode("manual");
    setAiDraft(null);
  };

  const applySavedMilestoneTemplate = (milestones: ProjectMilestoneTemplateSummary["milestones"]) => {
    setProjectMilestones(milestones.map((milestone) => milestone.name));
    setProjectMilestoneStages(milestones.map((milestone) => milestone.stages.length ? milestone.stages.map((stage) => stage.activity) : [`${milestone.name} - Stage 1`]));
    setProjectMilestoneStageTasks(milestones.map((milestone) => milestone.stages.length ? milestone.stages.map((stage) => stage.tasks ?? []) : [[]]));
  };

  useEffect(() => {
    if (milestoneMode !== "auto") return;
    const selected = milestoneTemplates.find((template) => template.key === milestoneTemplateKey) ?? milestoneTemplates.find((template) => template.key === "pilot-v1");
    if (selected) applySavedMilestoneTemplate(selected.milestones);
  }, [milestoneMode, milestoneTemplateKey, milestoneTemplates]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || createSubmittingRef.current) return;

    const selectedAccount = accountOptions.find(option => option.value === client);
    if (!selectedAccount) {
      setProjectsError("Select an existing CRM account before creating a production project.");
      return;
    }

    createSubmittingRef.current = true;
    setSavingProject(true);
    setProjectsError(null);

    try {
      const ownerUserId = selectedMembers[0];
      const parsedBudget = budget.trim() === "" ? 0 : Number(budget);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) {
        throw new Error("Budget must be a valid positive number.");
      }
      const response = await postProject(createAttempt.current, {
          accountId: selectedAccount.accountId,
          name: name.trim(),
          status: toBackendProjectStatus(status),
          ownerUserId: ownerUserId || undefined,
          memberUserIds: selectedMembers,
          budgetAmount: parsedBudget,
          scopeSummary: description.trim() || undefined,
          plannedStartAt: uiProjectDateToIso(startDate),
          plannedEndAt: uiProjectDateToIso(dueDate),
          priority: priority.toLowerCase(),
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          color,
          createStageTemplate: true,
          milestoneMode,
          milestoneTemplateKey: milestoneMode === "auto" ? milestoneTemplateKey : undefined,
          manualMilestones: projectMilestones.map((milestone, index) => ({
            name: milestone.trim(),
            sortOrder: (index + 1) * 10,
            requiredDocumentCount: 0,
            stages: (projectMilestoneStages[index] ?? [`${milestone.trim()} - Stage 1`]).filter(Boolean).map((stage, stageIndex) => ({ activity: stage.trim(), phase: milestone.trim(), sortOrder: (stageIndex + 1) * 10, tasks: projectMilestoneStageTasks[index]?.[stageIndex] ?? [] }))
          }))
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.message === "string" ? body.message : Array.isArray(body.message) ? body.message.join("; ") : `Could not create project: ${response.status}`);
      }

      const created = await response.json();
      createAttempt.current = {};
      setProjectsList(current => [mapProjectSummaryToUiProject(created), ...current].slice(0, PROJECT_PAGE_SIZE));
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
      setStartDate(defaultProjectStartDate());
      setDueDate(defaultProjectDueDate());
      setColor("#2563eb");
      setTags("");
      setSelectedMembers([]);
      setMilestoneMode("auto");
      setMilestoneTemplateKey("pilot-v1");
      setProjectMilestones(PILOT_PROJECT_MILESTONES);
      setProjectMilestoneStages(PILOT_PROJECT_MILESTONES.map((milestone) => [`${milestone} - Stage 1`]));
      setProjectMilestoneStageTasks(PILOT_PROJECT_MILESTONES.map(() => [[]]));
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Could not create project");
    } finally {
      createSubmittingRef.current = false;
      setSavingProject(false);
    }
  };

  const handleUpdateProject = async (project: Project, values: ProjectEditValues) => {
    if (savingProjectEdit) return;

    const selectedAccount = clientOptions.find(option => option.value === values.client || option.label === values.client);
    if (!selectedAccount?.accountId) {
      setProjectMutationError("Select an existing CRM account before saving this production project.");
      return;
    }

    setSavingProjectEdit(true);
    setProjectMutationError(null);
    setProjectsError(null);

    try {
      const parsedBudget = values.budgetAmount.trim() === "" ? 0 : Number(values.budgetAmount);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) {
        throw new Error("Budget must be a valid positive number.");
      }
      const ownerUserId = values.ownerUserId === "none" ? null : values.ownerUserId;
      const memberUserIds = Array.from(new Set([
        ...values.memberUserIds,
        ...(ownerUserId ? [ownerUserId] : [])
      ]));
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccount.accountId,
          name: values.name,
          code: values.code || undefined,
          status: toBackendProjectStatus(values.status),
          projectType: values.projectType,
          scopeSummary: values.scopeSummary || null,
          ownerUserId,
          memberUserIds,
          budgetAmount: parsedBudget,
          plannedStartAt: uiProjectDateToIso(values.plannedStartAt),
          plannedEndAt: uiProjectDateToIso(values.plannedEndAt)
        })
      });

      if (response.status === 401) {
        redirectToLogin("/projects");
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.message === "string" ? body.message : `Could not update project: ${response.status}`);
      }

      const updated = mapProjectSummaryToUiProject(await response.json());
      setProjectsList(current => current.map(item => item.id === project.id ? updated : item));
      setEditingProject(null);
    } catch (error) {
      setProjectMutationError(error instanceof Error ? error.message : "Could not update project");
    } finally {
      setSavingProjectEdit(false);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (deletingProjectId) return;

    setDeletingProjectId(project.id);
    setProjectMutationError(null);
    setProjectsError(null);

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        redirectToLogin("/projects");
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.message === "string" ? body.message : `Could not delete project: ${response.status}`);
      }

      setProjectsList(current => current.filter(item => item.id !== project.id));
      setProjectPagination(current => {
        const total = Math.max(0, current.total - 1);
        const returned = Math.max(0, current.returned - 1);
        return {
          ...current,
          total,
          returned,
          hasNextPage: current.offset + returned < total
        };
      });
      if (pushedIds.includes(project.id)) {
        const nextPushedIds = pushedIds.filter(id => id !== project.id);
        setPushedIds(nextPushedIds);
        writePushedProjectIds(nextPushedIds, pushedProjectOwnerKey);
      }
      setDeletingProject(null);
    } catch (error) {
      setProjectMutationError(error instanceof Error ? error.message : "Could not delete project");
    } finally {
      setDeletingProjectId(null);
    }
  };

  return (
    <AppShell activeRoute="/projects" onCreateProjectClick={() => setIsCreateOpen(true)} title="Projects">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 xl:p-6">
          {/* Page Header */}
          <div className="mb-4 flex shrink-0 flex-col items-start justify-between gap-3 sm:mb-6 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-xl font-bold text-foreground">All Projects</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {projectPagination.total} projects · {projectsList.length} loaded · {active} active loaded
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
                onClick={() => downloadCsv("uplark-projects-loaded.csv", ["Name", "Status", "Priority", "Client", "Budget", "Spent", "Due date"], filtered.map((project) => [project.name, project.status, project.priority, project.client, project.budget, project.spent, project.dueDate]))}
                aria-label={`Export ${filtered.length} loaded projects as CSV`}
                title="Export the currently loaded project result set"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                <Download className="w-4 h-4" /> Export loaded CSV
              </motion.button>
              <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
                onClick={() => setIsCreateOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
                style={{ backgroundColor:"var(--color-primary)" }}>
                <Plus className="w-4 h-4" /> New Project
              </motion.button>
            </div>
          </div>

          {usingLocalProjectFallback && (
            <div className="mb-4 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              API project chưa khởi động; đang hiển thị dữ liệu local để bạn kiểm tra giao diện. Khi backend hoạt động, danh sách sẽ tự chuyển sang dữ liệu live.
            </div>
          )}

          {projectsError && (
            <div className="mb-4 shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {projectsError}
            </div>
          )}

          {/* KPI row */}
          <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 sm:mb-6 sm:gap-4 xl:grid-cols-4">
            {[
              { label:"Total Budget",  value:<MoneyAmount value={totalBudget} />, icon:Wallet,  color:"#2563eb" },
              { label:"Total Spent",   value:<MoneyAmount value={totalSpent} />,  icon:TrendingUp,  color:"#7c3aed" },
              { label:"Active Loaded", value:active,                               icon:CheckCircle2,color:"#16a34a" },
              { label:"At Risk Loaded",value:atRisk,                               icon:AlertCircle, color:"#dc2626" },
            ].map(s => (
              <motion.div key={s.label} whileHover={{ y:-2 }} className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor:`${s.color}15` }}>
                    <s.icon className="w-3.5 h-3.5" style={{ color:s.color }} />
                  </div>
                </div>
                <p className="text-2xl font-bold font-mono tabular-nums text-foreground">{s.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="mb-4 shrink-0 sm:mb-5">
            <WorkspaceTabBar
              items={PROJECT_LIST_VIEW_TABS}
              value={view}
              onChange={(nextView) => {
                setView(nextView);
                updateProjectListUrl({ view: nextView });
              }}
              ariaLabel="Chế độ xem danh sách Project"
              idPrefix="projects-view"
              className="w-full"
            />
          </div>

          {/* Filters */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="projects-stable-shell">
            <div className="flex min-h-[4.25rem] shrink-0 flex-col items-stretch gap-3 border-b border-border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4 xl:flex-nowrap" data-testid="projects-control-bar">
              <div className="flex min-w-0 items-center gap-2.5 flex-1 bg-background border border-input rounded-xl px-3.5 py-2">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input value={query} onChange={e => handleQueryChange(e.target.value)} placeholder="Search by name, client, description..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none" />
              </div>

              <CustomDropdown
                options={filterStatusOptions}
                value={statusFilter}
                onChange={handleStatusFilterChange}
                ariaLabel="All Status"
                className="w-full shrink-0 sm:w-40"
              />

              <CustomDropdown
                options={filterCategoryOptions}
                value={categoryFilter}
                onChange={handleCategoryFilterChange}
                className="w-full shrink-0 sm:w-44"
              />

              <CrmSelect
                ariaLabel="Lọc theo Client"
                options={filterClientOptions}
                value={clientFilter}
                onChange={handleClientFilterChange}
                searchable
                className="w-full shrink-0 sm:w-48"
              />

              <CrmSelect
                ariaLabel="Lọc theo PIC"
                options={filterOwnerOptions}
                value={ownerFilter}
                onChange={handleOwnerFilterChange}
                searchable
                className="w-full shrink-0 sm:w-48"
              />

            </div>

            <AnimatePresence>
              {loadingProjects && (
                <motion.div
                  role="status"
                  aria-live="polite"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="pointer-events-none absolute right-3 top-[4.75rem] z-30 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur"
                >
                  Updating projects...
                </motion.div>
              )}
            </AnimatePresence>

            {/* Grid */}
            {view === "grid" && (
              <div ref={resultsScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="projects-results-frame">
                <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <AnimatePresence mode="popLayout">
                    {filtered.map(p => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        returnTo={currentProjectListUrl}
                        isPushed={pushedIds.includes(p.id)}
                        onTogglePush={() => handleTogglePush(p.id)}
                        onEdit={() => {
                          setProjectMutationError(null);
                          setEditingProject(p);
                        }}
                        onDelete={() => {
                          setProjectMutationError(null);
                          setDeletingProject(p);
                        }}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                {filtered.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                    <Briefcase className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-foreground">No projects found</p>
                    <p className="text-xs text-muted-foreground mt-1">Adjust your filters to see more</p>
                  </div>
                )}
              </div>
            )}

            {/* Project Sheet */}
            {view === "sheet" && (
              <div ref={resultsScrollRef} className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="projects-results-frame">
                <ProjectSheet
                  projects={filtered}
                  returnTo={currentProjectListUrl}
                  pushedIds={pushedIds}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  storageKey={`project_sheet_preferences:${pushedProjectOwnerKey}`}
                  onSort={handleSort}
                  onTogglePush={handleTogglePush}
                  onEdit={(project) => {
                    setProjectMutationError(null);
                    setEditingProject(project);
                  }}
                  onDelete={(project) => {
                    setProjectMutationError(null);
                    setDeletingProject(project);
                  }}
                />
              </div>
            )}
            {/* Timeline View */}
            {view === "timeline" && (
              <div ref={resultsScrollRef} className="min-h-0 flex-1 overflow-auto p-4" data-testid="projects-results-frame">
                {(() => {
                  const today = new Date();
                  const { start: yearStart, end: yearEnd } = getYearTimelineBounds(today);
                  const todayLeft = timelinePercent(today, yearStart, yearEnd);
                  const currentYear = today.getFullYear();

                  return (
                <div className="min-w-[950px]">
                  {/* Calendar Grid Header */}
                  <div className="flex border-b border-border pb-3 mb-4">
                    <div className="w-72 shrink-0 font-bold text-xs uppercase tracking-wider text-muted-foreground">Project Detail</div>
                    <div className="flex-1 grid grid-cols-12 gap-1 text-center font-bold text-xs text-muted-foreground">
                      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => (
                        <div key={m} className="py-1 bg-muted/30 rounded-lg">{m}</div>
                      ))}
                    </div>
                  </div>

                  {/* Timeline Rows */}
                  <div className="relative space-y-4">
                    <div className="absolute top-0 bottom-0 left-72 right-0 z-20 pointer-events-none">
                      <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/80 transition-all duration-300" style={{ left: `${todayLeft}%` }}>
                        <div className="absolute top-0 -translate-x-1/2 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">
                          TODAY
                        </div>
                      </div>
                    </div>

                    {filtered.map(p => {
                      const parsedStart = parseProjectTimelineDate(p.startDate);
                      const parsedDue = parseProjectTimelineDate(p.dueDate);
                      const rawStart = parsedStart ?? parsedDue ?? yearStart;
                      const rawEnd = parsedDue ?? parsedStart ?? yearEnd;
                      const rangeStart = rawStart <= rawEnd ? rawStart : rawEnd;
                      const rangeEnd = rawStart <= rawEnd ? rawEnd : rawStart;
                      const visibleStart = rangeStart < yearStart ? yearStart : rangeStart;
                      const visibleEnd = rangeEnd > yearEnd ? yearEnd : rangeEnd;
                      const isInCurrentYear = rangeEnd >= yearStart && rangeStart <= yearEnd;
                      const pillLeft = timelinePercent(visibleStart, yearStart, yearEnd);
                      const pillWidth = isInCurrentYear
                        ? Math.max(1.5, timelinePercent(visibleEnd, yearStart, yearEnd) - pillLeft)
                        : 0;
                      const sc = STATUS_CFG[p.status];

                      return (
                        <div key={p.id} className="flex items-center group">
                          {/* Left Column: Project Summary info */}
                          <div className="w-72 shrink-0 pr-4 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${p.color}15` }}>
                              <Layers className="w-4 h-4" style={{ color: p.color }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <Link href={`/projects/${encodeURIComponent(p.id)}?returnTo=${encodeURIComponent(currentProjectListUrl)}`} className="text-xs font-bold text-foreground hover:text-primary truncate block transition-colors">{p.name}</Link>
                              <span className="text-[10px] text-muted-foreground block truncate">{p.client} · {p.category}</span>
                            </div>
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg shrink-0" style={{ backgroundColor: sc.bg, color: sc.color }}>{formatProjectStatusLabel(p.status)}</span>
                          </div>

                          {/* Right Column: Month grid with the Gantt pill */}
                          <div className="flex-1 grid grid-cols-12 gap-1 relative h-10 items-center">
                            {/* Grid vertical grid lines */}
                            {Array.from({ length: 12 }).map((_, idx) => (
                              <div key={idx} className="h-full border-l border-dashed border-border/40 first:border-l-0" />
                            ))}

                            {isInCurrentYear ? (
                              <Link href={`/projects/${encodeURIComponent(p.id)}?returnTo=${encodeURIComponent(currentProjectListUrl)}`} className="absolute h-8 rounded-xl flex items-center px-3 border text-[10px] font-bold shadow-sm transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer select-none truncate"
                                style={{
                                  left: `${pillLeft}%`,
                                  width: `${pillWidth}%`,
                                  minWidth: "7rem",
                                  maxWidth: `calc(100% - ${pillLeft}%)`,
                                  backgroundColor: `${p.color}15`,
                                  borderColor: `${p.color}40`,
                                  color: p.color
                                }}>
                                <span className="truncate flex-1 font-semibold">{p.name} ({p.progress}%)</span>
                                <span className="text-[9px] opacity-90 shrink-0 font-mono hidden sm:inline">{p.startDate.split(",")[0]} - {p.dueDate.split(",")[0]}</span>
                              </Link>
                            ) : (
                              <Link href={`/projects/${encodeURIComponent(p.id)}?returnTo=${encodeURIComponent(currentProjectListUrl)}`} className="absolute left-0 h-8 rounded-xl flex items-center px-3 border border-dashed border-border bg-muted/30 text-[10px] font-bold text-muted-foreground">
                                Outside {currentYear}
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {filtered.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Briefcase className="w-10 h-10 text-muted-foreground/30 mb-3" />
                        <p className="text-sm font-medium text-foreground">No projects found</p>
                      </div>
                    )}
                  </div>
                </div>
                  );
                })()}
              </div>
            )}

            {/* Footer */}
            <div className="flex min-h-[3.75rem] shrink-0 items-center justify-between border-t border-border bg-muted/20 px-4 py-3" data-testid="projects-pagination-footer">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{projectPageRangeLabel(projectPagination)}</span>
              </p>
              <ProjectPaginationControls pagination={projectPagination} onPageChange={handleProjectPageChange} />
            </div>
          </div>
        </main>

        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>

        <AnimatePresence>
          {isCreateOpen && (
            <ModalLayer onClose={() => setIsCreateOpen(false)}>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div
                ref={createDialogRef} tabIndex={-1}
                aria-labelledby="create-project-title"
                aria-modal="true"
                role="dialog"
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                className={`bg-card border border-border rounded-2xl w-full ${aiPanelOpen ? "max-w-6xl" : "max-w-2xl"} overflow-visible shadow-2xl flex flex-col max-h-[90dvh]`}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
                  <div>
                    <h3 id="create-project-title" className="text-base font-bold text-foreground">Create New Project</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Define core properties, schedules, budget, and assign team members.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAiPanelOpen((open) => !open)} aria-pressed={aiPanelOpen} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${aiPanelOpen ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                      <Sparkles className="h-3.5 w-3.5" /> AI đọc file
                    </button>
                    <button
                      aria-label="Close create project dialog"
                      type="button"
                      onClick={() => setIsCreateOpen(false)}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Modal Body */}
                <div className="flex min-h-0 flex-1">
                <form onSubmit={handleSubmit} className="min-w-0 flex-1 overflow-y-auto p-6 space-y-4">
                  {projectsError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{projectsError}{accountOptions.length === 0 && <button type="button" className="ml-2 underline" onClick={() => setAccountLoadRevision(value => value + 1)}>Retry loading clients</button>}</div>}
                  {loadingAccounts && <p role="status">Loading clients…</p>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Project Name */}
                    <div className="space-y-1.5">
                      <label htmlFor="create-project-name" className="text-xs font-semibold text-muted-foreground">Project Name <span className="text-destructive">*</span></label>
                      <input
                        id="create-project-name"
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
                      <span className="text-xs font-semibold text-muted-foreground">Client</span>
                      <CustomDropdown
                        ariaLabel="Client"
                        options={clientOptions}
                        value={client}
                        onChange={setClient}
                      />
                    </div>

                    {/* Budget */}
                    <div className="space-y-1.5">
                      <label htmlFor="create-project-budget" className="text-xs font-semibold text-muted-foreground">Budget (đ)</label>
                      <input
                        id="create-project-budget"
                        type="number"
                        placeholder="e.g. 50000"
                        value={budget}
                        onChange={e => setBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>

                    {/* Status */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Trạng thái</span>
                      <CustomDropdown
                        ariaLabel="Status"
                        options={STATUS_OPTIONS}
                        value={status}
                        onChange={val => setStatus(val as Project["status"])}
                      />
                    </div>

                    {/* Priority */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Priority</span>
                      <CustomDropdown
                        ariaLabel="Priority"
                        options={PRIORITY_OPTIONS}
                        value={priority}
                        onChange={val => setPriority(val as Project["priority"])}
                      />
                    </div>

                    {/* Start Date */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Start Date</span>
                      <CustomDatePicker
                        ariaLabel="Start Date"
                        value={startDate}
                        onChange={setStartDate}
                      />
                    </div>

                    {/* Due Date */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Due Date</span>
                      <CustomDatePicker
                        ariaLabel="Due Date"
                        value={dueDate}
                        onChange={setDueDate}
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label htmlFor="create-project-description" className="text-xs font-semibold text-muted-foreground">Description</label>
                    <textarea
                      id="create-project-description"
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe the scope, objectives, and deliverables of this project..."
                      className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors resize-none"
                    />
                  </div>

                  <section className="rounded-2xl border border-border bg-muted/15 p-4 space-y-3" aria-labelledby="create-project-milestone-title">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                      <h4 id="create-project-milestone-title" className="text-sm font-bold text-foreground">Milestone format & điều kiện chuyển tiếp</h4>
                      <p className="mt-1 text-xs text-muted-foreground">Chọn mẫu pilot chuẩn hoặc tự đặt milestone. Admin có thể bổ sung số hồ sơ và điều kiện duyệt trong Project Sheet.</p>
                      </div>
                      <div className="shrink-0">
                        <input ref={aiImportInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleAiImport(file); }} />
                        <button type="button" disabled={aiImportBusy} onClick={() => aiImportInputRef.current?.click()} className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
                          {aiImportBusy ? "Đang đọc…" : "Import Excel"}
                        </button>
                      </div>
                    </div>
                    {aiImportError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{aiImportError}</div> : null}
                    {aiDraft ? <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs text-indigo-950">
                      <div className="flex items-center justify-between gap-2"><strong>Template tạm từ {aiDraft.sourceFileName}</strong><button type="button" className="font-semibold text-primary hover:underline" onClick={applyAiDraft}>Dùng template này</button></div>
                      <p className="mt-1">{aiDraft.projectName || "Chưa nhận diện tên project"} · {aiDraft.milestones.length} milestone</p>
                      <ul className="mt-2 list-disc pl-4 space-y-0.5">{aiDraft.milestones.slice(0, 8).map((milestone) => <li key={milestone.name}><span className="font-semibold">{milestone.name}</span>{milestone.stages.length ? <span className="text-indigo-800"> · {milestone.stages.map((stage) => `${stage.name}${stage.tasks?.length ? ` (${stage.tasks.length} task)` : ""}`).join(" · ")}</span> : ""}</li>)}</ul>
                      {aiDraft.warnings.length ? <p className="mt-2 text-amber-700">Lưu ý: {aiDraft.warnings.join("; ")}</p> : null}
                    </div> : null}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className={`flex gap-2 rounded-xl border p-3 cursor-pointer ${milestoneMode === "auto" ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                        <input type="radio" name="projects-milestone-mode" checked={milestoneMode === "auto"} onChange={() => { setMilestoneMode("auto"); const selected = milestoneTemplates.find((template) => template.key === milestoneTemplateKey) ?? milestoneTemplates.find((template) => template.key === "pilot-v1"); setProjectMilestones(selected?.milestones.map((milestone) => milestone.name) ?? PILOT_PROJECT_MILESTONES); }} />
                        <span className="min-w-0 flex-1"><strong className="block text-xs">Theo template đã lưu</strong><small className="text-[11px] text-muted-foreground">Chọn format milestone admin đã setup</small>{milestoneMode === "auto" ? <div className="mt-2"><CustomDropdown ariaLabel="Template milestone" options={[{ value: "pilot-v1", label: "Pilot UpLark chuẩn" }, ...milestoneTemplates.filter((template) => template.key !== "pilot-v1").map((template) => ({ value: template.key, label: `${template.name} · ${template.milestoneCount} milestone` }))]} value={milestoneTemplateKey} onChange={(key) => { setMilestoneTemplateKey(key); const selected = milestoneTemplates.find((template) => template.key === key); if (selected) setProjectMilestones(selected.milestones.map((milestone) => milestone.name)); }} /></div> : null}</span>
                      </label>
                      <label className={`flex gap-2 rounded-xl border p-3 cursor-pointer ${milestoneMode === "manual" ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                        <input type="radio" name="projects-milestone-mode" checked={milestoneMode === "manual"} onChange={() => setMilestoneMode("manual")} />
                        <span><strong className="block text-xs">Tự chọn milestone</strong><small className="text-[11px] text-muted-foreground">Tự thêm, đổi tên và sắp thứ tự</small></span>
                      </label>
                    </div>
                    <div className="space-y-2">
                      {projectMilestones.map((milestone, index) => (
                        <div className="rounded-xl border border-border bg-background p-2 space-y-2" key={`${index}-${milestone}`}>
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary text-[11px] font-bold inline-flex items-center justify-center">M{index + 1}</span>
                            <input aria-label={`Milestone ${index + 1}`} disabled={milestoneMode === "auto"} value={milestone} onChange={(event) => setProjectMilestones((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="flex-1 px-3 py-2 bg-background border border-input rounded-xl text-xs" />
                            {milestoneMode === "manual" && projectMilestones.length > 1 ? <button type="button" onClick={() => { setProjectMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index)); setProjectMilestoneStages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setProjectMilestoneStageTasks((current) => current.filter((_, itemIndex) => itemIndex !== index)); }} className="text-xs text-destructive">Xóa</button> : null}
                          </div>
                          {milestoneMode === "manual" ? <div className="ml-9 space-y-2 border-l-2 border-primary/15 pl-3">
                            {(projectMilestoneStages[index] ?? [`${milestone} - Stage 1`]).map((stage, stageIndex) => {
                              const stageTasks = projectMilestoneStageTasks[index]?.[stageIndex] ?? [];
                              return <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-2.5" key={`${index}-${stageIndex}`}>
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-[10px] font-bold text-indigo-700">S{stageIndex + 1}</span>
                                  <input aria-label={`Milestone ${index + 1} stage ${stageIndex + 1}`} value={stage} onChange={(event) => setProjectMilestoneStages((current) => current.map((stages, milestoneIndex) => milestoneIndex === index ? stages.map((value, currentStageIndex) => currentStageIndex === stageIndex ? event.target.value : value) : stages))} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[11px] font-semibold" />
                                  <span className="shrink-0 rounded-full bg-background px-2 py-1 text-[9px] text-muted-foreground">{stageTasks.length} task</span>
                                  {(projectMilestoneStages[index]?.length ?? 1) > 1 ? <button type="button" onClick={() => { setProjectMilestoneStages((current) => current.map((stages, milestoneIndex) => milestoneIndex === index ? stages.filter((_, currentStageIndex) => currentStageIndex !== stageIndex) : stages)); setProjectMilestoneStageTasks((current) => current.map((tasks, milestoneIndex) => milestoneIndex === index ? tasks.filter((_, currentStageIndex) => currentStageIndex !== stageIndex) : tasks)); }} className="text-[10px] text-destructive">Xóa</button> : null}
                                </div>
                                <div className="mt-2 space-y-1.5 border-l-2 border-indigo-200 pl-3">
                                  {stageTasks.map((task, taskIndex) => <div key={`${index}-${stageIndex}-${taskIndex}`} className="rounded-lg border border-border/80 bg-background px-2 py-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-bold text-primary">T{taskIndex + 1}</span>
                                      <input aria-label={`Milestone ${index + 1} stage ${stageIndex + 1} task ${taskIndex + 1}`} value={task.title} onChange={(event) => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? stageTasks.map((item, currentTaskIndex) => currentTaskIndex === taskIndex ? { ...item, title: event.target.value } : item) : stageTasks) : milestoneTasks))} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1 text-[10px]" />
                                      {task.subtasks?.length ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{task.subtasks.length} subtask</span> : null}
                                      <button type="button" onClick={() => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? stageTasks.filter((_, currentTaskIndex) => currentTaskIndex !== taskIndex) : stageTasks) : milestoneTasks))} className="text-[10px] text-destructive">Xóa</button>
                                    </div>
                                    {task.subtasks?.length ? <div className="mt-2 space-y-1 border-l-2 border-primary/15 pl-3">
                                      {(task.subtasks ?? []).map((subtask, subtaskIndex) => <div className="flex items-center gap-1.5" key={`${index}-${stageIndex}-${taskIndex}-${subtaskIndex}`}><span className="text-[9px] font-semibold text-primary/70">ST{subtaskIndex + 1}</span><input aria-label={`Task ${taskIndex + 1} subtask ${subtaskIndex + 1}`} value={subtask.title} onChange={(event) => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? stageTasks.map((item, currentTaskIndex) => currentTaskIndex === taskIndex ? { ...item, subtasks: (item.subtasks ?? []).map((child, childIndex) => childIndex === subtaskIndex ? { ...child, title: event.target.value } : child) } : item) : stageTasks) : milestoneTasks))} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[10px]" /><button type="button" onClick={() => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? stageTasks.map((item, currentTaskIndex) => currentTaskIndex === taskIndex ? { ...item, subtasks: (item.subtasks ?? []).filter((_, childIndex) => childIndex !== subtaskIndex) } : item) : stageTasks) : milestoneTasks))} className="text-[9px] text-destructive">Xóa</button></div>)}
                                      <button type="button" onClick={() => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? stageTasks.map((item, currentTaskIndex) => currentTaskIndex === taskIndex ? { ...item, subtasks: [...(item.subtasks ?? []), { title: "Subtask mới", subtasks: [] }] } : item) : stageTasks) : milestoneTasks))} className="text-[10px] font-semibold text-primary hover:underline">+ Thêm subtask</button>
                                    </div> : <button type="button" onClick={() => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? stageTasks.map((item, currentTaskIndex) => currentTaskIndex === taskIndex ? { ...item, subtasks: [{ title: "Subtask mới", subtasks: [] }] } : item) : stageTasks) : milestoneTasks))} className="mt-2 text-[10px] font-semibold text-primary hover:underline">+ Thêm subtask</button>}
                                  </div>)}
                                  <button type="button" onClick={() => setProjectMilestoneStageTasks((current) => current.map((milestoneTasks, milestoneIndex) => milestoneIndex === index ? milestoneTasks.map((stageTasks, currentStageIndex) => currentStageIndex === stageIndex ? [...stageTasks, { title: "Task mới", subtasks: [] }] : stageTasks) : milestoneTasks))} className="text-[10px] font-semibold text-primary hover:underline">+ Thêm task</button>
                                </div>
                              </div>;
                            })}
                            <button type="button" onClick={() => { setProjectMilestoneStages((current) => current.map((stages, milestoneIndex) => milestoneIndex === index ? [...(stages.length ? stages : [`${milestone} - Stage 1`]), `${milestone} - Stage ${(stages.length || 0) + 1}`] : stages)); setProjectMilestoneStageTasks((current) => current.map((tasks, milestoneIndex) => milestoneIndex === index ? [...tasks, []] : tasks)); }} className="text-[10px] font-semibold text-primary hover:underline">+ Thêm stage</button>
                          </div> : null}
                        </div>
                      ))}
                    </div>
                    {milestoneMode === "manual" ? <button type="button" onClick={() => { setProjectMilestones((current) => [...current, "Milestone mới"]); setProjectMilestoneStages((current) => [...current, ["Milestone mới - Stage 1"]]); setProjectMilestoneStageTasks((current) => [...current, [[]]]); }} className="text-xs font-semibold text-primary hover:underline">+ Thêm milestone</button> : null}
                  </section>

                  {/* Highlight Color & Tags */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Tags */}
                    <div className="space-y-1.5">
                      <label htmlFor="create-project-tags" className="text-xs font-semibold text-muted-foreground">Tags (comma-separated)</label>
                      <input
                        id="create-project-tags"
                        type="text"
                        value={tags}
                        onChange={e => setTags(e.target.value)}
                        placeholder="e.g. Core, Design, Marketing"
                        className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>

                    {/* Highlight Color */}
                    <div aria-labelledby="create-project-color-label" className="space-y-1.5" role="group">
                      <span id="create-project-color-label" className="text-xs font-semibold text-muted-foreground">Highlight Color</span>
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
                  <div aria-labelledby="create-project-members-label" className="space-y-1.5 pt-2" role="group">
                    <div id="create-project-members-label" className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Assign Team Members ({selectedMembers.length} selected)</span>
                      <span className="text-[10px] text-muted-foreground">
                        {loadingWorkspaceUsers ? "Loading synced users..." : "Click to select/deselect"}
                      </span>
                    </div>
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
                            <UserAvatar user={m} size="sm" />
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
                      disabled={savingProject}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all"
                      style={{ backgroundColor: "var(--color-primary)" }}
                    >
                      {savingProject ? "Creating..." : "Create Project"}
                    </button>
                  </div>
                </form>
                {aiPanelOpen ? <aside aria-label="AI project import" className="flex w-[320px] shrink-0 flex-col border-l border-border bg-muted/10">
                  <div className="flex items-start justify-between border-b border-border px-4 py-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" /> AI Project Builder</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Đưa file dự án đang làm vào, hệ thống sẽ dựng bản nháp theo cây Milestone → Stage → Task → Subtask.</p>
                    </div>
                    <button type="button" aria-label="Đóng AI Project Builder" onClick={() => setAiPanelOpen(false)} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    <div className="flex gap-2 rounded-xl border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p>File không cần đúng template. Có thể là roadmap, task list, bảng nhiều sheet hoặc file tiếng Việt/Anh.</p>
                    </div>
                    <button type="button" disabled={aiImportBusy} onClick={() => aiImportInputRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-center text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
                      <FileUp className="h-6 w-6" />
                      {aiImportBusy ? "Đang đọc file…" : "Chọn file dự án để AI đọc"}
                      <span className="text-[10px] font-normal text-muted-foreground">XLSX hoặc CSV · tối đa 8 MB</span>
                    </button>
                    {aiImportError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">{aiImportError}</div> : null}
                    {aiDraft ? <div className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background text-xs text-foreground shadow-sm">
                      <div className="border-b border-primary/10 px-3.5 py-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="flex items-center gap-1.5 font-bold"><Sparkles className="h-3.5 w-3.5 text-primary" /> Bản nháp project</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{aiDraft.sourceFileName}</p></div><span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">Đã đọc</span></div></div>
                      <div className="space-y-3 p-3.5"><div className="rounded-xl border border-border bg-background px-3 py-2.5"><p className="truncate font-bold">{aiDraft.projectName || "Chưa nhận diện tên project"}</p><div className="mt-2 grid grid-cols-4 gap-1.5 text-center"><span className="rounded-lg bg-primary/5 px-1 py-1.5"><strong className="block text-[11px] text-primary">{aiDraft.milestones.length}</strong><small className="text-[9px] text-muted-foreground">Milestone</small></span><span className="rounded-lg bg-indigo-50 px-1 py-1.5"><strong className="block text-[11px] text-indigo-700">{aiDraft.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0)}</strong><small className="text-[9px] text-muted-foreground">Stage</small></span><span className="rounded-lg bg-emerald-50 px-1 py-1.5"><strong className="block text-[11px] text-emerald-700">{aiDraft.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageTotal, stage) => stageTotal + (stage.tasks?.length ?? 0), 0), 0)}</strong><small className="text-[9px] text-muted-foreground">Task</small></span><span className="rounded-lg bg-amber-50 px-1 py-1.5"><strong className="block text-[11px] text-amber-700">{aiDraft.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageTotal, stage) => stageTotal + countTemplateSubtasks(stage.tasks ?? []), 0), 0)}</strong><small className="text-[9px] text-muted-foreground">Subtask</small></span></div></div>
                        <DraftHierarchyTree milestones={aiDraft.milestones} />
                        {aiDraft.warnings.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-800"><span className="font-bold">Cần rà soát:</span> {aiDraft.warnings.join("; ")}</div> : null}
                        <button type="button" onClick={() => { applyAiDraft(); setAiPanelOpen(false); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90"><Check className="h-3.5 w-3.5" /> Đưa bản nháp vào popup</button>
                      </div>
                    </div> : <div className="rounded-xl border border-border bg-background p-3 text-[11px] leading-relaxed text-muted-foreground">Sau khi đọc xong, bản nháp sẽ xuất hiện ở đây. Bạn vẫn chỉnh sửa được toàn bộ nội dung trong popup trước khi bấm Create Project.</div>}
                  </div>
                </aside> : null}
                </div>
              </motion.div>
            </div>
            </ModalLayer>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {editingProject && (
            <ProjectEditModal
              project={editingProject}
              clientOptions={clientOptions}
              workspaceUsers={workspaceUsers}
              loadingWorkspaceUsers={loadingWorkspaceUsers}
              workspaceUsersError={workspaceUsersError}
              isSaving={savingProjectEdit}
              error={projectMutationError}
              onClose={() => {
                setProjectMutationError(null);
                setEditingProject(null);
              }}
              onSave={(values) => handleUpdateProject(editingProject, values)}
            />
          )}
          {deletingProject && (
            <ProjectDeleteConfirmModal
              project={deletingProject}
              isDeleting={deletingProjectId === deletingProject.id}
              error={projectMutationError}
              onCancel={() => {
                setProjectMutationError(null);
                setDeletingProject(null);
              }}
              onConfirm={() => handleDeleteProject(deletingProject)}
            />
          )}
        </AnimatePresence>
    </AppShell>
  );
}
