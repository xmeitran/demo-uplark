"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  Ellipsis,
  FileText,
  GraduationCap,
  Hash,
  LifeBuoy,
  X,
  Users
} from "lucide-react";
import { formatDate, formatHours } from "./timesheet-format";
import {
  WORK_GROUP_LABELS,
  NODE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  type TimeLog,
  type TimesheetDataset,
  type WorkGroup
} from "./timesheet-types";
import { Avatar, Drawer, EmptyState, Pagination, usePagination } from "./timesheet-ui";

export interface LogDrawerRequest {
  title: string;
  description?: string;
  logs: TimeLog[];
}

const LOG_PAGE_SIZE = 12;

type IconType = React.ComponentType<{ className?: string }>;

const WORK_GROUP_ICONS: Record<WorkGroup, IconType> = {
  customer_project: Briefcase,
  internal_project: Building2,
  ticket_maintenance: LifeBuoy,
  meeting: Users,
  training: GraduationCap,
  other: Ellipsis
};

/**
 * Drill-down surface: the individual time-log rows behind any aggregate on
 * screen. Every number in the Timesheet must be traceable back to these rows.
 *
 * Laid out as a grouped card list rather than a table: the drawer is ~768px
 * wide and each entry carries six fields, which a table can only fit by
 * truncating names into uselessness. Entries are grouped under a date header
 * carrying that date's subtotal, so a whole-month drill-down still reads.
 */
export function LogDrawer({
  dataset,
  request,
  onClose
}: {
  dataset: TimesheetDataset;
  request: LogDrawerRequest | null;
  onClose: () => void;
}) {
  const [selectedLog, setSelectedLog] = useState<TimeLog | null>(null);
  useEffect(() => {
    if (!request) setSelectedLog(null);
  }, [request]);
  const peopleById = useMemo(() => new Map(dataset.people.map((person) => [person.id, person])), [dataset.people]);
  const projectsById = useMemo(() => new Map(dataset.projects.map((project) => [project.id, project])), [dataset.projects]);
  const taskDetails = useMemo(() => {
    const map = new Map<string, { milestoneName: string; stageName: string; taskName: string; taskCode: string; status: keyof typeof NODE_STATUS_LABELS; estimateMinutes: number; assigneeId: string | null }>();
    for (const project of dataset.projects) {
      for (const milestone of project.milestones) {
        for (const stage of milestone.stages) {
          for (const task of stage.tasks) {
            // Task IDs can be reused by Lark across projects. Always qualify
            // the lookup with the project ID so the detail card is accurate.
            map.set(`${project.id}:${task.id}`, {
              milestoneName: milestone.name,
              stageName: stage.name,
              taskName: task.name,
              taskCode: task.code,
              status: task.status,
              estimateMinutes: task.estimateMinutes,
              assigneeId: task.assigneeId
            });
          }
        }
      }
    }
    return map;
  }, [dataset.projects]);

  const rows = useMemo(
    () => (request?.logs ?? []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.minutes - a.minutes),
    [request]
  );
  const paged = usePagination(rows, LOG_PAGE_SIZE);

  const totals = useMemo(
    () => ({
      minutes: rows.reduce((acc, log) => acc + log.minutes, 0),
      people: new Set(rows.map((log) => log.personId)).size,
      projects: new Set(rows.map((log) => log.projectId)).size
    }),
    [rows]
  );

  /** Consecutive entries on the same date, so each page renders date headers. */
  const groups = useMemo(() => {
    const out: Array<{ date: string; entries: TimeLog[]; minutes: number }> = [];
    for (const log of paged.items) {
      const last = out[out.length - 1];
      if (last && last.date === log.date) {
        last.entries.push(log);
        last.minutes += log.minutes;
      } else {
        out.push({ date: log.date, entries: [log], minutes: log.minutes });
      }
    }
    return out;
  }, [paged.items]);

  return (
    <Drawer open={request !== null} title={request?.title ?? ""} description={request?.description} icon={Clock} onClose={onClose}>
      {rows.length === 0 ? (
        <EmptyState message="Không có dòng ghi nhận nào khớp." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
            <SummaryChip icon={FileText} label="dòng ghi nhận" value={`${rows.length}`} />
            <SummaryChip icon={Clock} label="tổng giờ" value={formatHours(totals.minutes)} tone="primary" />
            <SummaryChip icon={Users} label="nhân sự" value={`${totals.people}`} />
            <SummaryChip icon={Briefcase} label="dự án" value={`${totals.projects}`} />
          </div>

          <div className="divide-y divide-border">
            {groups.map((group) => (
              <section key={group.date}>
                <header className="flex items-center justify-between gap-2 bg-muted/20 px-4 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    {formatDate(group.date)}
                  </span>
                  <span className="font-mono text-[11.5px] font-bold tabular-nums text-muted-foreground">
                    {formatHours(group.minutes)}
                  </span>
                </header>

                <ul>
                  {group.entries.map((entry) => {
                    const person = peopleById.get(entry.personId);
                    const project = projectsById.get(entry.projectId);
                    const GroupIcon = WORK_GROUP_ICONS[entry.workGroup];
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedLog(entry)}
                          className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary/[0.04] focus-visible:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                          aria-label={`Xem chi tiết log ${entry.id}`}
                        >
                          {person ? <Avatar initials={person.initials} name={person.name} /> : null}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[12.5px] font-semibold" title={person?.name}>
                                {person?.name ?? entry.personId}
                              </span>
                              <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums">
                                {formatHours(entry.minutes)}
                              </span>
                            </div>

                            <div className="mt-0.5 flex min-w-0 items-start gap-1.5">
                              {/* Code stays compact; the full project name is on hover. */}
                              <span
                                className="mt-px shrink-0 cursor-help rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground"
                                title={project ? `${project.code} — ${project.name} · ${project.accountName}` : entry.projectId}
                              >
                                {project?.code ?? entry.projectId}
                              </span>
                              <span className="min-w-0 text-[11.5px] leading-snug text-muted-foreground">
                                {taskDetails.get(`${entry.projectId}:${entry.taskId}`)?.stageName ?? "Task chưa đồng bộ"} › {taskDetails.get(`${entry.projectId}:${entry.taskId}`)?.taskName ?? entry.taskId}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px]">
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <GroupIcon className="h-3 w-3" aria-hidden />
                                {WORK_GROUP_LABELS[entry.workGroup]}
                              </span>
                              {entry.billable ? (
                                <span className="inline-flex items-center gap-1 text-success">
                                  <Banknote className="h-3 w-3" aria-hidden />
                                  Tính phí
                                </span>
                              ) : null}
                              <span className="ml-auto text-[10px] font-semibold text-primary">Xem chi tiết →</span>
                            </div>

                            {entry.note ? (
                              <p className="mt-1 truncate text-[10.5px] italic text-muted-foreground" title={entry.note}>
                                {entry.note}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <Pagination state={paged} unit="dòng" className="sticky bottom-0 z-10 bg-card" />
        </>
      )}

      <TimeLogDetailModal
        log={selectedLog}
        person={selectedLog ? peopleById.get(selectedLog.personId) : undefined}
        project={selectedLog ? projectsById.get(selectedLog.projectId) : undefined}
        task={selectedLog ? taskDetails.get(`${selectedLog.projectId}:${selectedLog.taskId}`) : undefined}
        onClose={() => setSelectedLog(null)}
      />
    </Drawer>
  );
}

function TimeLogDetailModal({
  log,
  person,
  project,
  task,
  onClose
}: {
  log: TimeLog | null;
  person?: TimesheetDataset["people"][number];
  project?: TimesheetDataset["projects"][number];
  task?: { milestoneName: string; stageName: string; taskName: string; taskCode: string; status: keyof typeof NODE_STATUS_LABELS; estimateMinutes: number; assigneeId: string | null };
  onClose: () => void;
}) {
  if (!log) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label="Chi tiết time log">
      <button type="button" aria-label="Đóng chi tiết time log" onClick={onClose} className="absolute inset-0 bg-overlay/70" />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <Clock className="h-4 w-4" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Time log detail</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-foreground">{person?.name ?? log.personId}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{log.id} · {formatDate(log.date)}</p>
          </div>
          <button type="button" aria-label="Đóng bảng chi tiết" onClick={onClose} className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DetailMetric label="Thời lượng" value={formatHours(log.minutes)} tone="primary" />
            <DetailMetric label="Nhóm việc" value={WORK_GROUP_LABELS[log.workGroup]} />
            <DetailMetric label="Tính phí" value={log.billable ? "Có" : "Không"} />
            <DetailMetric label="Ngày ghi nhận" value={formatDate(log.date)} />
          </div>

          <DetailSection title="Nhân sự">
            <DetailRow label="Họ tên" value={person?.name ?? "Chưa mapping"} />
            <DetailRow label="Lark user ID" value={log.personId} mono />
            <DetailRow label="Phòng ban" value={person?.departmentId ?? "Chưa có dữ liệu"} />
            <DetailRow label="Vai trò" value={person?.role ?? "Chưa có dữ liệu"} />
          </DetailSection>

          <DetailSection title="Dự án">
            <DetailRow label="Dự án" value={project ? `${project.code} — ${project.name}` : "Chưa mapping"} />
            <DetailRow label="Project ID" value={log.projectId} mono />
            <DetailRow label="Khách hàng / account" value={project?.accountName ?? "Chưa có dữ liệu"} />
            <DetailRow label="Trạng thái" value={project ? PROJECT_STATUS_LABELS[project.status] : "Chưa có dữ liệu"} />
          </DetailSection>

          <DetailSection title="Công việc">
            <DetailRow label="Milestone" value={task?.milestoneName ?? log.milestoneId} />
            <DetailRow label="Stage" value={task?.stageName ?? log.stageId} />
            <DetailRow label="Task" value={task ? `${task.taskCode} — ${task.taskName}` : log.taskId} />
            <DetailRow label="Trạng thái task" value={task ? NODE_STATUS_LABELS[task.status] : "Chưa mapping"} />
            <DetailRow label="Estimate" value={task && task.estimateMinutes > 0 ? formatHours(task.estimateMinutes) : "Chưa có estimate"} />
          </DetailSection>

          <DetailSection title="Ghi chú">
            <p className="rounded-xl border border-border bg-muted/25 p-3 text-[12px] leading-relaxed text-foreground">
              {log.note || "Không có ghi chú cho dòng log này."}
            </p>
          </DetailSection>

          <p className="mt-4 inline-flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            <Hash className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Chi tiết này được mở trực tiếp từ dòng log live <span className="font-mono">{log.id}</span>; không suy diễn từ tổng hợp.
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5 text-[12px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right font-semibold text-foreground ${mono ? "font-mono text-[10.5px]" : ""}`}>{value}</span>
    </div>
  );
}

function DetailMetric({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "primary" }) {
  return (
    <div className={`rounded-xl border p-2.5 ${tone === "primary" ? "border-primary/25 bg-primary/5" : "border-border bg-muted/20"}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-[12px] font-bold ${tone === "primary" ? "text-primary" : "text-foreground"}`} title={value}>{value}</p>
    </div>
  );
}

function SummaryChip({
  icon: Icon,
  label,
  value,
  tone = "muted"
}: {
  icon: IconType;
  label: string;
  value: string;
  tone?: "muted" | "primary";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] ${
        tone === "primary" ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-mono font-bold tabular-nums">{value}</span>
      <span>{label}</span>
    </span>
  );
}
