"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, BriefcaseBusiness, Pencil, Pin, Trash2, Users } from "lucide-react";
import { MoneyAmount } from "../../components/money-amount";
import type { Project } from "../../../app/projects/data";
import { formatProjectStatusLabel } from "../../../app/projects/live-projects";

export type ProjectSheetSortKey = "name" | "status" | "progress" | "budget" | "dueDate" | "priority";
export type ProjectSheetSortDir = "asc" | "desc";

type ProjectSheetProps = {
  projects: Project[];
  returnTo: string;
  pushedIds: string[];
  sortKey: ProjectSheetSortKey;
  sortDir: ProjectSheetSortDir;
  onSort: (key: ProjectSheetSortKey, direction?: ProjectSheetSortDir) => void;
  onTogglePush: (projectId: string) => void;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
};

const STATUS_STYLES: Record<Project["status"], string> = {
  Active: "bg-emerald-50 text-emerald-700",
  "In Review": "bg-blue-50 text-blue-700",
  Planning: "bg-cyan-50 text-cyan-700",
  "On Hold": "bg-slate-100 text-slate-600",
  Completed: "bg-emerald-50 text-emerald-700",
  "At Risk": "bg-red-50 text-red-700",
  "Chưa xác định": "bg-slate-100 text-slate-600"
};

/** Columns of the sheet; `sortKey` marks the ones that sort the list (same handler and URL state as the page). */
const COLUMNS: Array<{ label: string; sortKey?: ProjectSheetSortKey }> = [
  { label: "Project / Client", sortKey: "name" },
  { label: "Status", sortKey: "status" },
  { label: "Progress", sortKey: "progress" },
  { label: "Tasks" },
  { label: "Plan hour" },
  { label: "Logwork hour" },
  { label: "P&L hour" },
  { label: "Spent" },
  { label: "Members" }
];

const ROW_ACTION_CLASS = "flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

function roundHours(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function projectHours(project: Project) {
  const planned = project.plannedHours ?? project.tasks.total * 8;
  const logged = project.loggedHours ?? roundHours(planned * project.progress / 100);
  const pnl = project.pnlHours ?? logged;
  return { planned, logged, pnl };
}

function formatHours(value: number) {
  return `${roundHours(value).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} h`;
}

function MemberStack({ project }: { project: Project }) {
  if (project.members.length === 0) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Chưa phân công</span>;
  }

  return (
    <div className="flex items-center" aria-label={`${project.members.length} project members`}>
      <div className="flex -space-x-2">
        {project.members.slice(0, 4).map((member, index) => (
          <span
            key={member.id ?? member.email ?? `${member.initials}-${index}`}
            title={member.name || member.email || member.initials}
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-card text-[10px] font-bold text-white shadow-sm"
            style={{ backgroundColor: member.color }}
          >
            {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : member.initials.slice(0, 2)}
          </span>
        ))}
      </div>
      {project.members.length > 4 && <span className="ml-2 text-[11px] font-semibold text-muted-foreground">+{project.members.length - 4}</span>}
    </div>
  );
}

export function ProjectSheet({ projects, returnTo, pushedIds, sortKey, sortDir, onSort, onTogglePush, onEdit, onDelete }: ProjectSheetProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card" data-testid="project-sheet">
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><BriefcaseBusiness className="h-4 w-4" /></span>
            <h2 className="text-lg font-bold text-foreground">Project Sheet</h2>
          </div>
          <p className="text-sm text-muted-foreground">Tổng quan kế hoạch, tiến độ, giờ và chi phí của từng project.</p>
        </div>
        <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{projects.length} project đang hiển thị</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur">
            <tr>
              {COLUMNS.map((column) => {
                const sorted = column.sortKey !== undefined && column.sortKey === sortKey;
                return (
                  <th key={column.label} aria-sort={sorted ? (sortDir === "asc" ? "ascending" : "descending") : undefined} className="border-b border-border px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {column.sortKey ? (
                      <button type="button" onClick={() => onSort(column.sortKey!)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25">
                        {column.label}
                        {sorted ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : null}
                      </button>
                    ) : column.label}
                  </th>
                );
              })}
              <th className="border-b border-border px-3 py-3"><span className="sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const hours = projectHours(project);
              const spentPercent = project.budget > 0 ? Math.round(project.spent / project.budget * 100) : 0;
              const href = `/projects/${encodeURIComponent(project.id)}?tab=Project%20Sheet&returnTo=${encodeURIComponent(returnTo)}`;
              return (
                <tr key={project.id} className={`group transition-colors hover:bg-muted/25${(project.openWarningCount ?? 0) > 0 ? " bg-red-50/50" : ""}`}>
                  <td className="border-b border-border/70 px-4 py-4">
                    <Link href={href} className="flex min-w-[250px] items-center gap-3 rounded-lg outline-none focus:ring-2 focus:ring-primary/25">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black text-white shadow-sm" style={{ backgroundColor: project.color }}>{project.name.slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block max-w-[280px] truncate text-sm font-bold text-foreground group-hover:text-primary">{project.name}</span>
                        <span className="block max-w-[280px] truncate text-[11px] text-muted-foreground">{project.client} · {project.category}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="border-b border-border/70 px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLES[project.status]}`}>{formatProjectStatusLabel(project.status)}</span>{(project.openWarningCount ?? 0) > 0 ? <span title={`${project.openWarningCount} cảnh báo đang mở`} aria-label={`${project.openWarningCount} cảnh báo đang mở`} className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{project.openWarningCount}</span> : null}</td>
                  <td className="border-b border-border/70 px-4 py-4">
                    <div className="min-w-24">
                      <div className="mb-1.5 text-xs font-bold">{project.progress}%</div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${project.progress}%`, backgroundColor: project.color }} /></div>
                    </div>
                  </td>
                  <td className="border-b border-border/70 px-4 py-4 font-mono text-sm font-bold tabular-nums text-foreground">{project.tasks.done} / {project.tasks.total}</td>
                  <td className="border-b border-border/70 px-4 py-4 font-mono text-sm font-semibold tabular-nums text-foreground">{formatHours(hours.planned)}</td>
                  <td className="border-b border-border/70 px-4 py-4 font-mono text-sm font-semibold tabular-nums text-foreground">{formatHours(hours.logged)}</td>
                  <td className="border-b border-border/70 px-4 py-4 font-mono text-sm font-semibold tabular-nums text-foreground">{formatHours(hours.pnl)}</td>
                  <td className="border-b border-border/70 px-4 py-4">
                    <div className="font-mono text-sm font-bold tabular-nums text-foreground"><MoneyAmount value={project.spent} /></div>
                    <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{spentPercent}% ngân sách</div>
                  </td>
                  <td className="border-b border-border/70 px-4 py-4"><MemberStack project={project} /></td>
                  <td className="border-b border-border/70 px-3 py-4">
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => onEdit(project)} title="Edit project" aria-label={`Edit project ${project.name}`} className={ROW_ACTION_CLASS}><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => onDelete(project)} title="Delete project" aria-label={`Delete project ${project.name}`} className={ROW_ACTION_CLASS}><Trash2 className="h-4 w-4" /></button>
                      <button type="button" onClick={() => onTogglePush(project.id)} aria-pressed={pushedIds.includes(project.id)} title={pushedIds.includes(project.id) ? "Unpush from Sidebar Menu" : "Push to Sidebar Menu"} aria-label={`${pushedIds.includes(project.id) ? "Unpush" : "Push"} ${project.name}`} className={`${ROW_ACTION_CLASS}${pushedIds.includes(project.id) ? " border-primary/30 bg-primary/5 text-primary" : ""}`}><Pin className="h-4 w-4" style={{ transform: pushedIds.includes(project.id) ? "none" : "rotate(45deg)" }} /></button>
                      <Link href={href} aria-label={`Open Project Sheet for ${project.name}`} className={ROW_ACTION_CLASS}><ArrowRight className="h-4 w-4" /></Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {projects.length === 0 && (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
            <BriefcaseBusiness className="h-8 w-8 text-muted-foreground/35" />
            <p className="text-sm font-semibold text-foreground">Không có project phù hợp</p>
            <p className="text-xs text-muted-foreground">Thử thay đổi từ khóa hoặc bộ lọc phía trên.</p>
          </div>
        )}
      </div>
    </section>
  );
}
