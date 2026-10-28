"use client";
import { postProject, type ProjectCreateAttempt } from "@/lib/project-create-request";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";


import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Download, Sparkles, FileUp, MessageSquare,
  Briefcase, Calendar, AlertCircle,
  CheckCircle2, ArrowRight, Layers, X, Pin, Pencil, Trash2, Check,
  Wallet, TrendingUp, LayoutGrid, List, Bell
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CustomDropdown, CustomDatePicker } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import { HeaderButton, PageHeader } from "@/components/page-header";
import { DateRangeFilter, FilterBar, FilterField, MultiSelectFilter, PersonFilter, SearchFilter, dayOf, matchesAny, rangesOverlap, type DateRange } from "@/components/filters";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { useAuth } from "@/lib/auth";
import { canEditProjectSetup, canViewCostFigures } from "@/lib/auth-role";
import { MoneyAmount } from "@/components/money-amount";
import { pnlRequest } from "@/components/pnl/pnl-ui";
import { parseVndAmount } from "@/components/pnl/pnl-project-edit";
import { formatMoneyInput } from "@/components/pnl/pnl-cost-shared";
import { formatVnd } from "@/lib/currency";
import {
  getPushedProjectsOwnerKey,
  readPushedProjectIds,
  writePushedProjectIds,
} from "@/lib/frontend-data-store";
import {
  fetchAccountOptions,
  fetchLiveProjectById,
  fetchLiveProjects,
  isUnauthorizedLiveProjectsError,
  mapProjectSummaryToUiProject,
  mergeProjectUpdate,
  PROJECT_PAGE_SIZE,
  formatProjectStatusLabel,
  type LiveProjectAccountOption
} from "./live-projects";
import {
  fetchWorkspaceUserOptions,
  isUnauthorizedWorkspaceUsersError,
  type WorkspaceUserOption
} from "@/lib/workspace-users";
import { downloadCsv } from "@/lib/csv-export";
import { projectDueSortValue, uiProjectDateToIso } from "@/lib/project-date";
import { loadExcelWorkbook } from "@/lib/excel-import";
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
import { buildCreateProjectHref, buildProjectsHrefWithoutCreate } from "@/lib/project-create-navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = ProjectSheetSortKey;
type SortDir = ProjectSheetSortDir;

type ProjectListView = UrlProjectListView;
const PROJECT_LIST_VIEWS: { id: ProjectListView; label: string; icon: typeof LayoutGrid }[] = [
  { id: "grid", label: "Grid View", icon: LayoutGrid },
  { id: "sheet", label: "Project Sheet View", icon: List },
  { id: "timeline", label: "Timeline View", icon: Calendar }
];
const MONEY_HIDDEN_TITLE = "Chỉ nhóm quyền chi phí xem được số tiền";

import { Project, PROJECTS, type Member } from "./data";
import { MilestoneApprovalField, ProjectActionDialogs, ProjectMemberMultiSelect, ProjectUserDropdown, STATUS_CFG, UserAvatar, getProjectCode, type ProjectAction, type ProjectClientOption } from "./project-dialogs";
import { PROJECT_CLOSE_REASONS, PROJECT_STATUS_LABELS, PROJECT_STATUS_OPTIONS, projectStatusOrder, projectStatusStyleMap, quickProjectStatusOptions, type ProjectCloseReasonCode } from "@/lib/project-status";
import { readApiError } from "@/lib/api-error";
import { usePersistedFilter, useRememberedQuery } from "@/lib/persisted-filters";
import { INTERNAL_WORKLOG_PROJECT_TYPE, PROJECT_TYPE_OPTIONS, projectKindOf, type ProjectMilestoneTemplateSummary, type ProjectTaskTemplateInput, type ResourceListPaginationMeta } from "@b2b-crm/contracts";

// ─── Config ───────────────────────────────────────────────────────────────────

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

type DraftStats = {
  sheetCount: number;
  rowCount: number;
  milestoneCount: number;
  stageCount: number;
  taskCount: number;
  subtaskCount: number;
  detectedColumns: string[];
  reviewRequired: boolean;
};

const EMPTY_MANUAL_MILESTONES = [""];
const EMPTY_MANUAL_STAGES = [[""]];
const EMPTY_MANUAL_STAGE_TASKS: ProjectTaskTemplateInput[][][] = [[[]]];

function countTemplateTasks(tasks: ProjectTaskTemplateInput[]): number {
  return tasks.length;
}

function countTemplateSubtasks(tasks: ProjectTaskTemplateInput[]): number {
  return tasks.reduce((total, task) => total + (task.subtasks?.length ?? 0) + countTemplateSubtasks(task.subtasks ?? []), 0);
}

function SavedMilestoneHierarchy({ template }: { template?: ProjectMilestoneTemplateSummary }) {
  if (!template) return <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center text-xs text-muted-foreground">Chưa có template Admin khả dụng.</div>;
  const stageCount = template.milestones.reduce((total, milestone) => total + milestone.stages.length, 0);
  const taskCount = template.milestones.reduce((total, milestone) => total + milestone.stages.reduce((stageTotal, stage) => stageTotal + (stage.tasks?.length ?? 0), 0), 0);
  const subtaskCount = template.milestones.reduce((total, milestone) => total + milestone.stages.reduce((stageTotal, stage) => stageTotal + (stage.tasks ?? []).reduce((taskTotal, task) => taskTotal + countTemplateSubtasks(task.subtasks ?? []), 0), 0), 0);
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={`Cấu trúc template ${template.name}`}>
    <div className="border-b border-slate-200 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Template đã chọn</p><h5 className="mt-1 truncate text-sm font-bold text-slate-900">{template.name}</h5><p className="mt-0.5 text-[11px] text-slate-500">Cấu trúc này sẽ được sao chép sang dự án mới.</p></div><span className="shrink-0 text-[10px] font-semibold text-primary">Đã lưu</span></div><div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">{[`${template.milestones.length} milestone`, `${stageCount} stage`, `${taskCount} task`, `${subtaskCount} subtask`].map((label) => <span key={label}>{label}</span>)}</div></div>
    <div className="max-h-[29rem] overflow-y-auto px-4 py-2" role="list" aria-label="Cây milestone template">{template.milestones.map((milestone, milestoneIndex) => <article key={`${template.key}-${milestone.name}-${milestoneIndex}`} className="border-b border-slate-100 py-3 last:border-b-0" role="listitem"><div className="flex items-start gap-2"><span className="mt-0.5 w-7 shrink-0 text-[10px] font-bold text-primary">M{milestoneIndex + 1}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-3"><h6 className="text-xs font-bold text-slate-900">{milestone.name}</h6><span className="shrink-0 text-[10px] text-slate-400">{milestone.stages.length} stage</span></div><div className="mt-2 border-l border-slate-200 pl-3">{milestone.stages.map((stage, stageIndex) => <div key={`${milestone.name}-${stage.activity}-${stageIndex}`} className="pb-2 last:pb-0"><div className="flex items-baseline justify-between gap-3"><p className="text-[11px] font-semibold text-slate-700"><span className="mr-1.5 font-bold text-indigo-500">S{stageIndex + 1}</span>{stage.activity}</p><span className="shrink-0 text-[10px] text-slate-400">{stage.tasks?.length ?? 0} task</span></div>{stage.tasks?.length ? <div className="mt-1 space-y-0.5 pl-7">{stage.tasks.map((task, taskIndex) => <div key={`${stage.activity}-${task.title}-${taskIndex}`} className="text-[10px] leading-relaxed text-slate-600"><span className="mr-1 font-semibold text-slate-400">T{taskIndex + 1}</span>{task.title}{task.subtasks?.length ? <div className="pl-5 text-[9px] text-slate-400">{task.subtasks.map((subtask, subtaskIndex) => <div key={`${task.title}-${subtask.title}-${subtaskIndex}`}><span className="mr-1 text-indigo-400">ST{subtaskIndex + 1}</span>{subtask.title}</div>)}</div> : null}</div>)}</div> : null}</div>)}</div></div></div></article>)}</div>
  </div>;
}

function DraftHierarchyTree({ milestones }: { milestones: DraftMilestone[] }) {
  return (
    <div className="min-h-0 space-y-3 pr-1" aria-label="Cấu trúc bản nháp project">
      {milestones.map((milestone, milestoneIndex) => {
        const stageCount = milestone.stages.length;
        const taskCount = milestone.stages.reduce((total, stage) => total + countTemplateTasks(stage.tasks ?? []), 0);
        return (
          <section key={`${milestone.name}-${milestoneIndex}`} className="rounded-xl border border-slate-200 bg-white p-2.5">
            <div className="flex items-start gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[10px] font-bold text-primary">M{milestoneIndex + 1}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{milestone.name}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{stageCount} stage · {taskCount} task</p></div>
            </div>
            <div className="mt-2 space-y-2 border-l-2 border-primary/15 pl-3">
              {milestone.stages.length ? milestone.stages.map((stage, stageIndex) => {
                const tasks = stage.tasks ?? [];
                return (
                  <div key={`${stage.name}-${stageIndex}`} className="rounded-lg border border-slate-200 bg-slate-50/80 p-2">
                    <div className="flex items-center gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-100 text-[9px] font-bold text-blue-700">S{stageIndex + 1}</span><span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-900">{stage.name}</span><span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[9px] text-slate-500">{tasks.length} task</span></div>
                    <div className="mt-1.5 space-y-1 border-l-2 border-blue-100 pl-2">
                      {tasks.length ? tasks.map((task, taskIndex) => <div key={`${task.title}-${taskIndex}`} className="rounded-md border border-slate-200 bg-white px-2 py-1.5"><div className="flex items-start gap-1.5"><span className="mt-0.5 text-[9px] font-bold text-primary">T{taskIndex + 1}</span><p className="min-w-0 flex-1 text-[10px] font-medium leading-relaxed text-slate-800">{task.title}</p>{task.subtasks?.length ? <span className="shrink-0 text-[9px] text-slate-400">{task.subtasks.length} sub</span> : null}</div>{task.subtasks?.length ? <div className="mt-1 space-y-1 border-l-2 border-blue-100 pl-2">{task.subtasks.map((subtask, subtaskIndex) => <div key={`${subtask.title}-${subtaskIndex}`} className="flex gap-1.5 text-[9px] leading-relaxed text-slate-500"><span className="font-semibold text-blue-600">ST{subtaskIndex + 1}</span><span>{subtask.title}</span></div>)}</div> : null}</div>) : <p className="px-1 py-1 text-[10px] italic text-slate-400">Chưa có task</p>}
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
  showMoney,
  isPushed,
  onTogglePush,
  onEdit,
  onDelete
}: {
  project: Project;
  returnTo: string;
  showMoney: boolean;
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
        className={`min-w-0 bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer flex h-full flex-col gap-4`}>
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
            <p className="text-sm font-bold font-mono text-foreground" title={showMoney ? undefined : MONEY_HIDDEN_TITLE}>{showMoney ? <MoneyAmount value={project.budget} /> : "—"}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Budget</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold font-mono" title={showMoney ? undefined : MONEY_HIDDEN_TITLE} style={{ color: showMoney && budgetPct > 90 ? "#dc2626" : "var(--color-foreground)" }}>{showMoney ? `${budgetPct}%` : "—"}</p>
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
            
            {project.hasPendingStatusProposal ? <span title="Có đề xuất trạng thái chờ xác nhận" className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">Có đề xuất trạng thái</span> : null}
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

const STATUS_OPTIONS = PROJECT_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label, color: STATUS_CFG[option.value].color }));

const PRIORITY_OPTIONS = [
  { value: "Critical", label: "Critical", color: "#dc2626" },
  { value: "High", label: "High", color: "#d97706" },
  { value: "Medium", label: "Medium", color: "#2563eb" },
  { value: "Low", label: "Low", color: "#16a34a" },
];

/** Loại dự án of a list row as one of the three filter values; the fixed worklog project counts as Nội bộ. */
function projectTypeCodeOf(project: Project) {
  const kind = projectKindOf(project.projectType) ?? "delivery";
  return kind === INTERNAL_WORKLOG_PROJECT_TYPE ? "internal" : kind;
}

/** The filters of the list applied to already-loaded projects (local fallback data, the "warning only" list). */
function matchesProjectFilters(project: Project, filters: Pick<ProjectListUrlState, "query" | "statusFilter" | "categoryFilter" | "clientFilter" | "ownerFilter" | "from" | "to">) {
  return matchesSearch(filters.query, project.name, project.client, getProjectCode(project))
    && matchesAny(filters.statusFilter, project.status)
    && matchesAny(filters.categoryFilter, projectTypeCodeOf(project))
    && matchesAny(filters.clientFilter, project.accountId)
    && matchesAny(filters.ownerFilter, project.ownerUserId)
    && rangesOverlap(dayOf(uiProjectDateToIso(project.startDate)), dayOf(project.dueAt ?? uiProjectDateToIso(project.dueDate)), filters);
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
  useRememberedQuery("projects", ["returnTo", "create", "edit", "delete", "page"]);
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
  // Kept apart from projectsError: the client list loads in parallel, and its success must not hide a failed project load.
  const [accountsError, setAccountsError] = useState<string | null>(null);
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
  const [warningOnly, setWarningOnly] = usePersistedFilter("projects:warning-only", false);
  const [warningCounts, setWarningCounts] = useState<Record<string, number> | null>(null);
  const [warnedProjects, setWarnedProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/project-warnings/counts", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ data?: Record<string, number> }> : Promise.reject(new Error(String(response.status))))
      .then(body => setWarningCounts(body.data ?? {}))
      .catch(() => { if (!controller.signal.aborted) setWarningCounts(null); });
    return () => controller.abort();
  }, []);
  const [query, setQuery]       = useState(urlState.query);
  const [statusFilter, setStatusFilter]   = useState(urlState.statusFilter);
  const [categoryFilter, setCategoryFilter] = useState(urlState.categoryFilter);
  const [clientFilter, setClientFilter] = useState(urlState.clientFilter);
  const [ownerFilter, setOwnerFilter] = useState(urlState.ownerFilter);
  const [periodFilter, setPeriodFilter] = useState<DateRange>({ from: urlState.from, to: urlState.to });
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
    setPeriodFilter({ from: urlState.from, to: urlState.to });
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
      from: periodFilter.from,
      to: periodFilter.to,
      page: projectPage,
      view,
      sortKey,
      sortDir
    }),
    [query, statusFilter, categoryFilter, clientFilter, ownerFilter, periodFilter, projectPage, view, sortKey, sortDir]
  );
  const activeFilters = useMemo(
    () => ({ query, statusFilter, categoryFilter, clientFilter, ownerFilter, from: periodFilter.from, to: periodFilter.to }),
    [query, statusFilter, categoryFilter, clientFilter, ownerFilter, periodFilter]
  );
  // The arrays get a new identity whenever the URL is re-read; the list reloads only when their content changes.
  const filterKey = JSON.stringify(activeFilters);

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
          status: statusFilter as Project["status"][],
          category: categoryFilter,
          accountId: clientFilter,
          ownerUserId: ownerFilter,
          from: periodFilter.from,
          to: periodFilter.to,
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
        const fallbackProjects = PROJECTS.filter((project) => matchesProjectFilters(project, activeFilters));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey stands for every filter value
  }, [projectPage, filterKey, pushedProjectOwnerKey]);

  useEffect(() => {
    const action = searchParams.get("edit") ? "edit" : searchParams.get("delete") ? "delete" : null;
    const projectId = action === "edit" ? searchParams.get("edit")?.trim() : searchParams.get("delete")?.trim();
    if (!action || !projectId || loadingProjects) return;
    const targetProjectId = projectId;
    const kind = action;

    let cancelled = false;
    const clearAction = () => {
      const next = new URLSearchParams(projectListSearch);
      next.delete("edit");
      next.delete("delete");
      const query = next.toString();
      router.replace(query ? `/projects?${query}` : "/projects", { scroll: false });
    };

    async function openProjectAction() {
      const listed = projectsList.find((project) => project.id === targetProjectId);
      const target = listed ?? await fetchLiveProjectById(targetProjectId).catch(() => null);
      if (cancelled) return;
      clearAction();
      if (!target) {
        setProjectsError("Không tìm thấy dự án để thực hiện thao tác.");
        return;
      }
      setProjectAction({ kind, project: target });
    }

    void openProjectAction();
    return () => { cancelled = true; };
  }, [loadingProjects, projectListSearch, projectsList, router, searchParams]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccountOptions() {
      setLoadingAccounts(true);
      try {
        const accounts = await fetchAccountOptions(controller.signal);
        if (controller.signal.aborted) return;
        setAccountOptions(accounts);
        setAccountsError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedLiveProjectsError(error)) {
          redirectToLogin("/projects");
          return;
        }
        setAccountOptions([]);
        if (process.env.NODE_ENV === "production") {
          setAccountsError(error instanceof Error ? error.message : "Could not load CRM accounts");
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
  const openCreateProject = () => {
    setIsCreateOpen(true);
    if (searchParams.get("create") !== "1") {
      router.replace(buildCreateProjectHref(projectListSearch), { scroll: false });
    }
  };
  const closeCreateProject = () => {
    setIsCreateOpen(false);
    if (searchParams.get("create") === "1") {
      router.replace(buildProjectsHrefWithoutCreate(projectListSearch), { scroll: false });
    }
  };
  useEffect(() => {
    if (searchParams.get("create") === "1") setIsCreateOpen(true);
  }, [projectListSearch, searchParams]);
  const createDialogRef = useDialogAccessibility(isCreateOpen, closeCreateProject);
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState("");
  const [priority, setPriority] = useState<Project["priority"]>("Medium");
  const [isTestProject, setIsTestProject] = useState(false);
  const [milestoneApprovalRequired, setMilestoneApprovalRequired] = useState(true);
  const [projectValueText, setProjectValueText] = useState("");
  const createErrorRef = useRef<HTMLDivElement | null>(null);
  const [createProjectType, setCreateProjectType] = useState("");
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
  const [aiDraft, setAiDraft] = useState<{ sourceFileName: string; projectName: string; description: string; milestones: DraftMilestone[]; warnings: string[]; stats?: DraftStats } | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const aiImportInputRef = useRef<HTMLInputElement | null>(null);

  const handleSort = (k: SortKey, direction?: SortDir) => {
    const nextDir = direction ?? (sortKey === k ? (sortDir === "asc" ? "desc" : "asc") : "asc");
    setSortKey(k);
    setSortDir(nextDir);
    updateProjectListUrl({ sortKey: k, sortDir: nextDir });
  };

  // Every filter change goes back to page 1 and into the URL, so the list can be restored from a detail page.
  const applyFilters = (changes: Partial<ProjectListUrlState>) => {
    if (changes.query !== undefined) setQuery(changes.query);
    if (changes.statusFilter) setStatusFilter(changes.statusFilter);
    if (changes.categoryFilter) setCategoryFilter(changes.categoryFilter);
    if (changes.clientFilter) setClientFilter(changes.clientFilter);
    if (changes.ownerFilter) setOwnerFilter(changes.ownerFilter);
    if (changes.from !== undefined || changes.to !== undefined) setPeriodFilter({ from: changes.from ?? "", to: changes.to ?? "" });
    setProjectPage(1);
    updateProjectListUrl({ ...changes, page: 1 });
    resetProjectsFrameScroll();
  };
  const resetFilters = () => {
    setWarningOnly(false);
    applyFilters({ query: "", statusFilter: [], categoryFilter: [], clientFilter: [], ownerFilter: [], from: "", to: "" });
  };

  const handleProjectPageChange = (page: number) => {
    setProjectPage(page);
    updateProjectListUrl({ page });
    resetProjectsFrameScroll();
  };

  // Client and PIC choices come from the whole account list and the workspace directory, never from the loaded page.
  const filterClientOptions = useMemo(() => accountOptions.map((account) => ({ value: account.accountId, label: account.label })), [accountOptions]);
  const filterPeople = useMemo(() => workspaceUsers.map((member) => ({ id: member.id, name: member.name, email: member.email, avatarUrl: member.avatarUrl })), [workspaceUsers]);

  // EV-065: the warning line and filter are workspace-wide. Counts come from /api/project-warnings/counts
  // ({ projectId: openCount }); only if that call fails do they fall back to the loaded page (and say so).
  const warnedProjectIds = useMemo(
    () => warningCounts
      ? Object.keys(warningCounts).filter(id => warningCounts[id] > 0)
      : projectsList.filter(p => (p.openWarningCount ?? 0) > 0).map(p => p.id),
    [warningCounts, projectsList]
  );
  const warningProjectCount = warnedProjectIds.length;
  const warningOnlyActive = warningOnly && warningProjectCount > 0;
  // With the filter on, the warned projects are loaded by id — not picked out of the current page of 10.
  // ponytail: one request per warned project; switch to an ids= list query if the API grows one.
  useEffect(() => {
    if (!warningOnlyActive || !warningCounts) { setWarnedProjects(null); return; }
    const controller = new AbortController();
    Promise.all(warnedProjectIds.map(id => fetchLiveProjectById(id, { signal: controller.signal })))
      .then(projects => setWarnedProjects(projects.flatMap(project => project ? [{ ...project, openWarningCount: warningCounts[project.id] }] : [])))
      .catch(() => { if (!controller.signal.aborted) setWarnedProjects(null); });
    return () => controller.abort();
  }, [warningOnlyActive, warningCounts, warnedProjectIds]);
  const filtered = useMemo(() => {
    // The warned projects are loaded by id, outside the filtered API list, so the filters are applied to them here.
    let list = warningOnlyActive ? (warnedProjects ?? projectsList.filter(p => (p.openWarningCount ?? 0) > 0)).filter(p => matchesProjectFilters(p, activeFilters)) : projectsList;
    list = [...list].sort((a, b) => {
      const map: Record<SortKey, number | string> = { name:a.name, status:projectStatusOrder(a.status), progress:a.progress, dueDate:projectDueSortValue(a), priority: ["Critical","High","Medium","Low"].indexOf(a.priority) };
      const mapB: Record<SortKey, number | string> = { name:b.name, status:projectStatusOrder(b.status), progress:b.progress, dueDate:projectDueSortValue(b), priority: ["Critical","High","Medium","Low"].indexOf(b.priority) };
      const va = map[sortKey], vb = mapB[sortKey];
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return list;
  }, [projectsList, sortKey, sortDir, warningOnlyActive, warnedProjects, activeFilters]);
  const activeFilterCount = [query.trim(), periodFilter.from || periodFilter.to, ownerFilter.length, statusFilter.length, categoryFilter.length, clientFilter.length, warningOnlyActive].filter(Boolean).length;
  const emptyState = activeFilterCount > 0 ? (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <Briefcase className="w-10 h-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm font-medium text-foreground">Không có kết quả phù hợp bộ lọc</p>
      <button type="button" onClick={resetFilters} className="mt-2 !text-xs !font-semibold text-primary hover:underline">Đặt lại bộ lọc</button>
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <Briefcase className="w-10 h-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm font-medium text-foreground">No projects found</p>
      <p className="text-xs text-muted-foreground mt-1">Chưa có dự án nào để hiển thị</p>
    </div>
  );

  // KPI stats
  const active      = useMemo(() => projectsList.filter(p => p.status === PROJECT_STATUS_LABELS.active).length, [projectsList]);
  const atRisk      = useMemo(() => projectsList.filter(p => p.status === PROJECT_STATUS_LABELS.at_risk).length, [projectsList]);
  // Budget/spent are for the cost permission group; the API strips the figures for everyone else.
  const showMoney   = canViewCostFigures(user);
  const totalBudget = useMemo(() => projectsList.reduce((sum, p) => sum + p.budget, 0), [projectsList]);
  const totalSpent  = useMemo(() => projectsList.reduce((sum, p) => sum + p.spent, 0), [projectsList]);
  const moneyTile = (value: number) => showMoney ? <MoneyAmount value={value} /> : <span title={MONEY_HIDDEN_TITLE}>—</span>;

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
            if (values.some((value) => String(value ?? "").trim())) rows.push(values.map((value) => String(value ?? "").replace(/[\t\r\n]+/g, " • ")).join("\t"));
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
  };

  const applySavedMilestoneTemplate = (milestones: ProjectMilestoneTemplateSummary["milestones"]) => {
    setProjectMilestones(milestones.map((milestone) => milestone.name));
    setProjectMilestoneStages(milestones.map((milestone) => milestone.stages.length ? milestone.stages.map((stage) => stage.activity) : [`${milestone.name} - Stage 1`]));
    setProjectMilestoneStageTasks(milestones.map((milestone) => milestone.stages.length ? milestone.stages.map((stage) => stage.tasks ?? []) : [[]]));
  };

  const switchToManualMilestones = () => {
    setMilestoneMode("manual");
    setProjectMilestones([...EMPTY_MANUAL_MILESTONES]);
    setProjectMilestoneStages(EMPTY_MANUAL_STAGES.map((stages) => [...stages]));
    setProjectMilestoneStageTasks(EMPTY_MANUAL_STAGE_TASKS.map((milestoneTasks) => milestoneTasks.map((stageTasks) => [...stageTasks])));
  };

  useEffect(() => {
    if (milestoneMode !== "auto") return;
    const selected = milestoneTemplates.find((template) => template.key === milestoneTemplateKey) ?? milestoneTemplates.find((template) => template.key === "pilot-v1");
    if (selected) applySavedMilestoneTemplate(selected.milestones);
  }, [milestoneMode, milestoneTemplateKey, milestoneTemplates]);

  const selectedMilestoneTemplate = milestoneTemplates.find((template) => template.key === milestoneTemplateKey) ?? milestoneTemplates.find((template) => template.key === "pilot-v1");

  // The alert sits at the top of a long modal; without this a failed Create looks like nothing happened.
  useEffect(() => { if (projectsError && isCreateOpen) createErrorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [projectsError, isCreateOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || createSubmittingRef.current) return;

    const selectedAccount = accountOptions.find(option => option.value === client);
    if (!selectedAccount) {
      setProjectsError("Select an existing CRM account before creating a production project.");
      return;
    }
    if (!createProjectType) {
      setProjectsError("Chọn Loại dự án: Khách hàng, Nội bộ hoặc Đào tạo.");
      return;
    }
    const projectValueAmount = parseVndAmount(projectValueText);
    if (projectValueText.trim() && projectValueAmount === null) {
      setProjectsError("Doanh thu dự kiến là số tiền VND nguyên, lớn hơn 0 (ví dụ 67.200.000).");
      return;
    }

    createSubmittingRef.current = true;
    setSavingProject(true);
    setProjectsError(null);

    try {
      const ownerUserId = selectedMembers[0];
      if (milestoneMode === "manual" && !projectMilestones.some((milestone) => milestone.trim())) {
        throw new Error("Thêm ít nhất một milestone hoặc chọn template đã lưu.");
      }
      if (!projectMilestones.some((milestone) => milestone.trim())) {
        throw new Error("Thêm ít nhất một milestone hoặc chọn template đã lưu.");
      }
      const response = await postProject(createAttempt.current, {
          accountId: selectedAccount.accountId,
          name: name.trim(),
          ownerUserId: ownerUserId || undefined,
          memberUserIds: selectedMembers,
          projectType: createProjectType,
          isTestProject,
          milestoneApprovalRequired,
          scopeSummary: description.trim() || undefined,
          plannedStartAt: uiProjectDateToIso(startDate),
          plannedEndAt: uiProjectDateToIso(dueDate),
          priority: priority.toLowerCase(),
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          color,
          createStageTemplate: true,
          milestoneMode,
          milestoneTemplateKey: milestoneMode === "auto" ? milestoneTemplateKey : undefined,
          manualMilestones: projectMilestones.flatMap((milestone, index) => {
            const name = milestone.trim();
            if (!name) return [];
            const stages = (projectMilestoneStages[index] ?? []).flatMap((stage, stageIndex) => {
              const activity = stage.trim();
              return activity ? [{ activity, phase: name, sortOrder: (stageIndex + 1) * 10, tasks: projectMilestoneStageTasks[index]?.[stageIndex] ?? [] }] : [];
            });
            return [{ name, sortOrder: (index + 1) * 10, requiredDocumentCount: 0, stages }];
          })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.message === "string" ? body.message : Array.isArray(body.message) ? body.message.join("; ") : `Could not create project: ${response.status}`);
      }

      const created = await response.json();
      createAttempt.current = {};
      // PL-13: doanh thu dự kiến is the project's "Giá trị dự án", saved through the P&L endpoint (same rules and audit trail).
      let projectValueError: string | null = null;
      if (projectValueAmount !== null) {
        await pnlRequest(`/api/pnl/projects/${encodeURIComponent(created.id)}/project-value`, { method: "PUT", body: { amount: projectValueAmount } })
          .catch((error) => { projectValueError = `Đã tạo dự án nhưng chưa lưu được doanh thu dự kiến: ${error instanceof Error ? error.message : "lỗi không rõ"}. Nhập lại ở trang P&L của dự án.`; });
      }
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
      closeCreateProject();

      if (projectValueError) setProjectsError(projectValueError);

      // Reset Form
      setName("");
      setProjectValueText("");
      setCreateProjectType("");
      setDescription("");
      setClient(accountOptions[0]?.value ?? "");
      setPriority("Medium");
      setIsTestProject(false);
      setMilestoneApprovalRequired(true);
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
      setAiDraft(null);
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Could not create project");
    } finally {
      createSubmittingRef.current = false;
      setSavingProject(false);
    }
  };

  const handleProjectUpdated = (projectId: string, updated: Project) => {
    setProjectsError(null);
    setProjectsList(current => current.map(item => item.id === projectId ? mergeProjectUpdate(item, updated) : item));
  };

  const handleProjectDeleted = (project: Project) => {
    setProjectsError(null);
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
  };

  return (
    <AppShell activeRoute="/projects" onCreateProjectClick={openCreateProject} title="Projects">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 xl:p-6">
          <PageHeader
            className="mb-4 sm:mb-6"
            title="All Projects"
            subtitle={<>{projectPagination.total} projects · {projectsList.length} loaded · {active} active loaded</>}
            actions={<>
              <HeaderButton
                icon={<Download className="w-4 h-4" />}
                onClick={() => downloadCsv("uplark-projects-loaded.csv", ["Name", "Status", "Priority", "Client", "Due date"], filtered.map((project) => [project.name, project.status, project.priority, project.client, project.dueDate]))}
                aria-label={`Export ${filtered.length} loaded projects as CSV`}
                title="Export the currently loaded project result set"
              >
                Export loaded CSV
              </HeaderButton>
              <HeaderButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreateProject}>New Project</HeaderButton>
            </>}
          />

          {usingLocalProjectFallback && (
            <div className="mb-4 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              API dự án chưa sẵn sàng; đang hiển thị dữ liệu mẫu để kiểm tra giao diện. Danh sách sẽ tự chuyển sang dữ liệu thật khi backend hoạt động.
            </div>
          )}

          {projectsError && (
            <div className="mb-4 shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {projectsError}
            </div>
          )}

          {/* KPI row */}
          <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 sm:mb-6 sm:gap-4 xl:grid-cols-4" data-testid="projects-kpi-row">
            {[
              { label:"Total Budget",  value:moneyTile(totalBudget), icon:Wallet,      color:"#2563eb" },
              { label:"Total Spent",   value:moneyTile(totalSpent),  icon:TrendingUp,  color:"#7c3aed" },
              { label:"Active Loaded", value:active,                 icon:CheckCircle2,color:"#16a34a" },
              { label:"At Risk Loaded",value:atRisk,                 icon:AlertCircle, color:"#dc2626" },
            ].map(s => (
              <motion.div key={s.label} whileHover={{ y:-2 }} className="min-w-0 bg-card border border-border rounded-xl p-4 shadow-sm">
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

          {/* Filters */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="projects-stable-shell">
            <div className="shrink-0 border-b border-border px-3 py-3 sm:px-4" data-testid="projects-control-bar">
              <FilterBar onReset={activeFilterCount > 0 ? resetFilters : undefined} activeCount={activeFilterCount} actions={
                <div role="group" aria-label="Chế độ xem danh sách Project" className="flex items-center rounded-xl bg-muted p-0.5" data-testid="projects-view-switch">
                  {PROJECT_LIST_VIEWS.map(item => (
                    <button key={item.id} type="button" id={`projects-view-${item.id}`} aria-label={item.label} title={item.label} aria-pressed={view === item.id}
                      onClick={() => { setView(item.id); updateProjectListUrl({ view: item.id }); }}
                      className={`inline-flex items-center rounded-lg px-2.5 py-2 transition-all ${view === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                      <item.icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              }>
                <FilterField label="Tìm kiếm" className="min-w-[120px] flex-[3_1_120px]">
                  <SearchFilter value={query} onChange={(value) => applyFilters({ query: value })} placeholder="Tìm theo tên, mã dự án, khách hàng..." ariaLabel="Tìm dự án" className="" />
                </FilterField>
                <FilterField label="Thời gian dự án" className="w-full sm:w-[11.5rem] sm:flex-none">
                  <DateRangeFilter value={periodFilter} onChange={(range) => applyFilters({ from: range.from, to: range.to })} ariaLabel="Thời gian dự án" />
                </FilterField>
                <PersonFilter label="PIC" people={filterPeople} values={ownerFilter} onChange={(values) => applyFilters({ ownerFilter: values })} allLabel="Tất cả PIC" className="min-w-[120px] flex-[1_1_120px]" />
                <MultiSelectFilter label="Trạng thái" options={STATUS_OPTIONS} values={statusFilter} onChange={(values) => applyFilters({ statusFilter: values })} allLabel="Tất cả trạng thái" searchable={false} className="min-w-[138px] flex-[2_1_138px]" />
                <MultiSelectFilter label="Loại dự án" options={PROJECT_TYPE_OPTIONS} values={categoryFilter} onChange={(values) => applyFilters({ categoryFilter: values })} allLabel="Tất cả loại" searchable={false} className="min-w-[120px] flex-[1_1_120px]" />
                <MultiSelectFilter label="Khách hàng" options={filterClientOptions} values={clientFilter} onChange={(values) => applyFilters({ clientFilter: values })} allLabel="Tất cả khách hàng" searchPlaceholder="Tìm khách hàng..." className="min-w-[138px] flex-[2_1_138px]" />
                {warningProjectCount > 0 && (
                  <button type="button" aria-pressed={warningOnlyActive} onClick={() => setWarningOnly(value => !value)} data-testid="projects-warning-chip"
                    title={`${warningProjectCount} dự án có cảnh báo`}
                    className={`relative inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 !text-[12px] font-semibold transition-colors ${warningOnlyActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/50"}`}>
                    <Bell className="h-3.5 w-3.5" />Cảnh báo
                    <span data-testid="projects-warning-badge" className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{warningProjectCount}</span>
                  </button>
                )}
              </FilterBar>
            </div>

            {/* The loading pill sits just under the filter bar, whatever height the bar wraps to. */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <AnimatePresence>
              {loadingProjects && (
                <motion.div
                  role="status"
                  aria-live="polite"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="pointer-events-none absolute right-3 top-2 z-30 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur"
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
                        showMoney={showMoney}
                        isPushed={pushedIds.includes(p.id)}
                        onTogglePush={() => handleTogglePush(p.id)}
                        onEdit={() => setProjectAction({ kind: "edit", project: p })}
                        onDelete={() => setProjectAction({ kind: "delete", project: p })}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                {filtered.length === 0 && !loadingProjects && emptyState}
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
                  onSort={handleSort}
                  onTogglePush={handleTogglePush}
                  onEdit={(project) => setProjectAction({ kind: "edit", project })}
                  onDelete={(project) => setProjectAction({ kind: "delete", project })}
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
                            
                            {p.hasPendingStatusProposal ? <span title="Có đề xuất trạng thái chờ xác nhận" className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">Có đề xuất trạng thái</span> : null}
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

                    {filtered.length === 0 && !loadingProjects && emptyState}
                  </div>
                </div>
                  );
                })()}
              </div>
            )}
            </div>

            {/* Footer */}
            <div className="flex min-h-[3.75rem] shrink-0 items-center justify-between border-t border-border bg-muted/20 px-4 py-3" data-testid="projects-pagination-footer">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{warningOnlyActive && warnedProjects ? `${filtered.length} Project có cảnh báo (toàn workspace)` : projectPageRangeLabel(projectPagination)}</span>
              </p>
              {warningOnlyActive && warnedProjects ? null : <ProjectPaginationControls pagination={projectPagination} onPageChange={handleProjectPageChange} />}
            </div>
          </div>
        </main>

        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>

        <AnimatePresence>
          {isCreateOpen && (
            <ModalLayer onClose={closeCreateProject}>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div
                ref={createDialogRef} tabIndex={-1}
                aria-labelledby="create-project-title"
                aria-modal="true"
                role="dialog"
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                className={`bg-card border border-border rounded-2xl w-full ${aiPanelOpen ? "max-w-7xl" : "max-w-2xl"} overflow-visible shadow-2xl flex flex-col max-h-[90dvh]`}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
                  <div>
                    <h3 id="create-project-title" className="text-base font-bold text-foreground">Create New Project</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Define core properties, schedules, and assign team members.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAiPanelOpen((open) => !open)} aria-pressed={aiPanelOpen} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${aiPanelOpen ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                      <Sparkles className="h-3.5 w-3.5" /> AI đọc file
                    </button>
                    <button
                      aria-label="Close create project dialog"
                      type="button"
                      onClick={closeCreateProject}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Modal Body */}
                <div className="flex min-h-0 flex-1">
                <form onSubmit={handleSubmit} className="min-w-0 flex-1 overflow-y-auto p-6 space-y-4">
                  <input ref={aiImportInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleAiImport(file); }} />
                  {(projectsError || accountsError) && <div ref={createErrorRef} role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{projectsError ?? accountsError}{accountOptions.length === 0 && <button type="button" className="ml-2 underline" onClick={() => setAccountLoadRevision(value => value + 1)}>Retry loading clients</button>}</div>}
                  {loadingAccounts && <p role="status">Loading clients…</p>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Project Name */}
                    <div className="space-y-1.5">
                      <label htmlFor="create-project-name" className="text-xs font-semibold text-muted-foreground">Project Name <span className="text-destructive">*</span></label>
                      <input
                        id="create-project-name"
                        type="text"
                        required
                        autoComplete="off"
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

                    {/* V-01: Loại dự án is required — it decides Lớp 2 of every task and the project's P&L template. */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Loại dự án <span className="text-destructive">*</span></span>
                      <CustomDropdown
                        ariaLabel="Loại dự án"
                        options={PROJECT_TYPE_OPTIONS}
                        value={createProjectType}
                        onChange={setCreateProjectType}
                        placeholder="Chọn loại dự án"
                      />
                    </div>

                    {/* PL-02: trial project flag (one of the four fields of the form that decide P&L) */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Dự án thử nghiệm</span>
                      <label htmlFor="create-project-test-flag" className="flex w-full items-center gap-2 px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground">
                        <input id="create-project-test-flag" type="checkbox" checked={isTestProject} onChange={e => setIsTestProject(e.target.checked)} />
                        Không tính vào số tổng P&amp;L
                      </label>
                    </div>

                    <MilestoneApprovalField value={milestoneApprovalRequired} onChange={setMilestoneApprovalRequired} />

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

                    {/* PL-13: doanh thu dự kiến = "Giá trị dự án" of the P&L; cost viewers only, optional here (required before G1). */}
                    {showMoney && canEditProjectSetup(user) && (
                      <div className="space-y-1.5">
                        <label htmlFor="create-project-value" className="text-xs font-semibold text-muted-foreground">Doanh thu dự kiến (VND)</label>
                        <input
                          id="create-project-value"
                          inputMode="numeric"
                          autoComplete="off"
                          value={projectValueText}
                          onChange={e => setProjectValueText(formatMoneyInput(e.target.value))}
                          placeholder="67.200.000"
                          className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                        {parseVndAmount(projectValueText) !== null && <p className="text-[11px] text-muted-foreground">= {formatVnd(parseVndAmount(projectValueText))}</p>}
                      </div>
                    )}
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
                    <div className="flex items-start justify-between gap-3"><div><h4 id="create-project-milestone-title" className="text-sm font-bold text-foreground">Milestone format & điều kiện chuyển tiếp</h4><p className="mt-1 text-xs text-muted-foreground">Chọn template do Admin thiết lập hoặc tự tạo milestone. Nhập từ file chỉ thực hiện trong AI Project Builder.</p></div></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className={`flex gap-2 rounded-xl border p-3 cursor-pointer ${milestoneMode === "auto" ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="radio" name="projects-milestone-mode" checked={milestoneMode === "auto"} onChange={() => { setMilestoneMode("auto"); const selected = milestoneTemplates.find((template) => template.key === milestoneTemplateKey) ?? milestoneTemplates.find((template) => template.key === "pilot-v1"); if (selected) applySavedMilestoneTemplate(selected.milestones); }} /><span className="min-w-0 flex-1"><strong className="block text-xs">Theo template đã lưu</strong><small className="text-[11px] text-muted-foreground">Chọn format milestone admin đã setup</small>{milestoneMode === "auto" ? <div className="mt-2"><CustomDropdown ariaLabel="Template milestone" options={[{ value: "pilot-v1", label: "Pilot UpLark chuẩn" }, ...milestoneTemplates.filter((template) => template.key !== "pilot-v1").map((template) => ({ value: template.key, label: `${template.name} · ${template.milestoneCount} milestone` }))]} value={milestoneTemplateKey} onChange={(key) => { setMilestoneTemplateKey(key); const selected = milestoneTemplates.find((template) => template.key === key); if (selected) applySavedMilestoneTemplate(selected.milestones); }} /></div> : null}</span></label>
                      <label className={`flex gap-2 rounded-xl border p-3 cursor-pointer ${milestoneMode === "manual" ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="radio" name="projects-milestone-mode" checked={milestoneMode === "manual"} onChange={switchToManualMilestones} /><span><strong className="block text-xs">Tự chọn milestone</strong><small className="text-[11px] text-muted-foreground">Tự thêm, đổi tên và sắp thứ tự</small></span></label>
                    </div>
                    {milestoneMode === "auto" ? <SavedMilestoneHierarchy template={selectedMilestoneTemplate} /> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Tự tạo cấu trúc</p><h5 className="mt-1 text-sm font-bold text-slate-900">Milestone của project</h5><p className="mt-0.5 text-[11px] text-slate-500">Thêm milestone, stage và task theo nhu cầu thực tế.</p></div>
                          <span className="shrink-0 text-[10px] font-semibold text-slate-400">Đang chỉnh sửa</span>
                        </div>
                      </div>
                      <div className="space-y-2 px-4 py-2">
                      {projectMilestones.map((milestone, index) => (
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2" key={index}>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">M{index + 1}</span>
                            <input aria-label={`Milestone ${index + 1}`} value={milestone} onChange={(event) => setProjectMilestones((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder="Tên milestone" className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium" />
                            {milestoneMode === "manual" && projectMilestones.length > 1 ? <button type="button" onClick={() => { setProjectMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index)); setProjectMilestoneStages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setProjectMilestoneStageTasks((current) => current.filter((_, itemIndex) => itemIndex !== index)); }} className="text-xs text-destructive">Xóa</button> : null}
                          </div>
                          {milestoneMode === "manual" ? <div className="ml-4 space-y-2 border-l border-slate-200 pl-3">
                            {(projectMilestoneStages[index] ?? [`${milestone} - Stage 1`]).map((stage, stageIndex) => {
                              const stageTasks = projectMilestoneStageTasks[index]?.[stageIndex] ?? [];
                              return <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5" key={`${index}-${stageIndex}`}>
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">S{stageIndex + 1}</span>
                                  <input aria-label={`Milestone ${index + 1} stage ${stageIndex + 1}`} value={stage} onChange={(event) => setProjectMilestoneStages((current) => current.map((stages, milestoneIndex) => milestoneIndex === index ? stages.map((value, currentStageIndex) => currentStageIndex === stageIndex ? event.target.value : value) : stages))} placeholder="Tên stage" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold" />
                                  <span className="shrink-0 rounded-full bg-background px-2 py-1 text-[9px] text-muted-foreground">{stageTasks.length} task</span>
                                  {(projectMilestoneStages[index]?.length ?? 1) > 1 ? <button type="button" onClick={() => { setProjectMilestoneStages((current) => current.map((stages, milestoneIndex) => milestoneIndex === index ? stages.filter((_, currentStageIndex) => currentStageIndex !== stageIndex) : stages)); setProjectMilestoneStageTasks((current) => current.map((tasks, milestoneIndex) => milestoneIndex === index ? tasks.filter((_, currentStageIndex) => currentStageIndex !== stageIndex) : tasks)); }} className="text-[10px] text-destructive">Xóa</button> : null}
                                </div>
                                <div className="mt-2 space-y-1 border-l border-indigo-200 pl-3">
                                  {stageTasks.map((task, taskIndex) => <div key={`${index}-${stageIndex}-${taskIndex}`} className="py-1">
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
                    <button type="button" onClick={() => { setProjectMilestones((current) => [...current, "Milestone mới"]); setProjectMilestoneStages((current) => [...current, ["Milestone mới - Stage 1"]]); setProjectMilestoneStageTasks((current) => [...current, [[]]]); }} className="text-xs font-semibold text-primary hover:underline">+ Thêm milestone</button>
                      </div>
                    </div>}
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
                      onClick={closeCreateProject}
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
                {aiPanelOpen ? <aside aria-label="Project file reader" className="flex w-[400px] max-w-[42vw] min-h-0 shrink-0 flex-col border-l border-slate-200 bg-slate-50/60">
                  <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
                    <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" /> Project file reader</div><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Hệ thống tự đọc file, không cần API key. Kiểm tra cây công việc trước khi tạo dự án.</p></div>
                    <button type="button" aria-label="Đóng Project file reader" onClick={() => setAiPanelOpen(false)} className="ml-3 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                    <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-slate-500"><MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Hỗ trợ roadmap, danh sách task, file nhiều sheet, tiếng Việt hoặc tiếng Anh; không bắt buộc theo template.</p>
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 text-center text-[10px] font-semibold text-slate-500" aria-label="Các bước đọc file"><span className="rounded-lg bg-blue-50 px-2 py-1.5 text-blue-700">1. Đọc file</span><span className="px-2 py-1.5">2. Rà soát</span><span className="px-2 py-1.5">3. Tạo project</span></div>
                    <button type="button" disabled={aiImportBusy} onClick={() => aiImportInputRef.current?.click()} className="flex w-full shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 px-4 py-5 text-center text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><FileUp className="h-5 w-5" />{aiImportBusy ? "Đang đọc file…" : "Chọn file Excel hoặc CSV"}<span className="text-[10px] font-normal text-slate-500">XLSX hoặc CSV · tối đa 8 MB · hỗ trợ nhiều sheet</span></button>
                    {aiImportError ? <div role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">{aiImportError}</div> : null}
                    {aiDraft ? <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs text-foreground">
                      <div className="shrink-0 border-b border-slate-200 px-3.5 py-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="flex items-center gap-1.5 font-bold"><Sparkles className="h-3.5 w-3.5 text-primary" /> Bản nháp project</p><p className="mt-1 truncate text-[10px] text-slate-500">{aiDraft.sourceFileName}</p></div><span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">Đã đọc</span></div><p className="mt-2 truncate font-semibold text-slate-900">{aiDraft.projectName || "Chưa nhận diện tên project"}</p><div className="mt-2 grid grid-cols-4 gap-1.5 text-center"><span className="rounded-md bg-blue-50 px-1 py-1.5"><strong className="block text-[11px] text-blue-700">{aiDraft.stats?.milestoneCount ?? aiDraft.milestones.length}</strong><small className="text-[9px] text-slate-500">Milestone</small></span><span className="rounded-md bg-slate-50 px-1 py-1.5"><strong className="block text-[11px] text-slate-700">{aiDraft.stats?.stageCount ?? aiDraft.milestones.reduce((sum, milestone) => sum + milestone.stages.length, 0)}</strong><small className="text-[9px] text-slate-500">Stage</small></span><span className="rounded-md bg-emerald-50 px-1 py-1.5"><strong className="block text-[11px] text-emerald-700">{aiDraft.stats?.taskCount ?? aiDraft.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageTotal, stage) => stageTotal + (stage.tasks?.length ?? 0), 0), 0)}</strong><small className="text-[9px] text-slate-500">Task</small></span><span className="rounded-md bg-amber-50 px-1 py-1.5"><strong className="block text-[11px] text-amber-700">{aiDraft.stats?.subtaskCount ?? aiDraft.milestones.reduce((sum, milestone) => sum + milestone.stages.reduce((stageTotal, stage) => stageTotal + countTemplateSubtasks(stage.tasks ?? []), 0), 0)}</strong><small className="text-[9px] text-slate-500">Subtask</small></span></div><p className="mt-2 text-[10px] text-slate-500">{aiDraft.stats ? `${aiDraft.stats.sheetCount} sheet · ${aiDraft.stats.rowCount} dòng · ${aiDraft.stats.detectedColumns.join(", ") || "chưa rõ cột"}` : "Đã tạo bản nháp từ dữ liệu file"}</p></div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-3"><DraftHierarchyTree milestones={aiDraft.milestones} />{aiDraft.warnings.length ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-800"><span className="font-bold">Cần rà soát:</span> {aiDraft.warnings.join("; ")}</div> : null}</div>
                      <div className="shrink-0 border-t border-slate-200 bg-white p-3"><button type="button" onClick={applyAiDraft} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90"><Check className="h-3.5 w-3.5" /> Đưa bản nháp vào tự chọn</button></div>
                    </section> : <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">Bản nháp sẽ hiển thị tại đây sau khi đọc file. Có thể chỉnh sửa toàn bộ milestone, stage, task và subtask trước khi tạo dự án.</div>}
                  </div>
                </aside> : null}
                </div>
              </motion.div>
            </div>
            </ModalLayer>
          )}
        </AnimatePresence>

        <ProjectActionDialogs
          action={projectAction}
          onDone={() => setProjectAction(null)}
          onUpdated={handleProjectUpdated}
          onDeleted={handleProjectDeleted}
          onUnauthorized={() => redirectToLogin("/projects")}
          clientOptions={clientOptions}
          workspaceUsers={workspaceUsers}
          loadingWorkspaceUsers={loadingWorkspaceUsers}
          workspaceUsersError={workspaceUsersError}
        />
    </AppShell>
  );
}
