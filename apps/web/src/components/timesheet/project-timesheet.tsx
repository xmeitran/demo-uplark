"use client";

import { PersonLink } from "@/components/person-link";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, AlertTriangle, ChevronDown, ChevronRight, ExternalLink, FileSearch } from "lucide-react";
import {
  buildProjectBreakdown,
  buildProjectMemberRows,
  buildProjectReadiness,
  buildProjectSummaries,
  sum,
  type ProjectBreakdownNode,
  type TimesheetFilters
} from "./timesheet-selectors";
import {
  formatDate,
  formatHours,
  formatMonth,
  formatPercent,
  formatSignedHours,
  formatSignedPercent,
  nodeStatusTone,
  projectStatusTone,
  riskTone,
  WORK_GROUP_COLORS
} from "./timesheet-format";
import {
  MEMBER_STATE_LABELS,
  NODE_STATUS_LABELS,
  WORK_GROUP_LABELS,
  type MemberState,
  type NodeStatus,
  type TimeLog,
  type TimesheetDataset
} from "./timesheet-types";
import {
  Avatar,
  BarValue,
  MiniBar,
  EmptyState,
  KpiCard,
  Pagination,
  Pill,
  SectionCard,
  SegmentedSwitch,
  TableScroll,
  Td,
  Th,
  usePagination
} from "./timesheet-ui";
import { LogDrawer, type LogDrawerRequest } from "./timesheet-log-drawer";
import { fetchProjectMemberParticipation } from "./timesheet-live-data";
import { PARTICIPATION_STATE } from "@/lib/member-participation";
import { projectStatusLabel } from "@/lib/project-status";
import type { ProjectMemberParticipationItem } from "@b2b-crm/contracts";

const PROJECT_PAGE_SIZE = 8;
const MILESTONE_PAGE_SIZE = 3;
const MEMBER_PAGE_SIZE = 8;
const LOG_LINK_CLASS = "underline decoration-dotted underline-offset-2 hover:decoration-solid";

function taskIdsOf(node: ProjectBreakdownNode): string[] {
  return node.level === "task" ? [node.id] : (node.children ?? []).flatMap(taskIdsOf);
}

/**
 * Project Timesheet — the project-centric view.
 *
 * Covers: effort overview per project, the Milestone → Stage → Task breakdown,
 * member participation state, planned-vs-actual with the overrun signal, and a
 * per-project data-readiness score. Filters live in the workbench; the
 * drill-down to underlying log rows lives here.
 */
export function ProjectTimesheet({
  dataset,
  filters,
  logs,
  currentUserId
}: {
  dataset: TimesheetDataset;
  filters: TimesheetFilters;
  logs: TimeLog[];
  currentUserId?: string;
}) {
  // `undefined` = untouched: the first project starts expanded. `null` = collapsed by the user.
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [drawerRequest, setDrawerRequest] = useState<LogDrawerRequest | null>(null);
  const [detailTab, setDetailTab] = useState<"tasks" | "members" | "checks">("tasks");

  const today = dataset.generatedAt;
  const allSummaries = useMemo(() => buildProjectSummaries(dataset, logs, today), [dataset, logs, today]);
  const summaries = useMemo(
    () => (filters.projectId === "all" ? allSummaries : allSummaries.filter((row) => row.project.id === filters.projectId)),
    [allSummaries, filters.projectId]
  );
  const readinessByProject = useMemo(
    () => new Map(buildProjectReadiness(dataset, logs, today).map((row) => [row.project.id, row])),
    [dataset, logs, today]
  );

  const selectedProjectId = selected === undefined ? summaries[0]?.project.id ?? null : selected;

  const monthLabel = formatMonth(filters.month);
  const periodShort = `T${Number(filters.month.slice(5))}/${filters.month.slice(0, 4)}`;

  // Usage and risk compare ALL-TIME hours with the all-time estimate; the period's hours are a separate figure.
  const totals = useMemo(() => {
    const estimate = sum(summaries.map((row) => row.estimateMinutes));
    const allTime = sum(summaries.map((row) => row.allTimeActualMinutes));
    return {
      estimate,
      period: sum(summaries.map((row) => row.actualMinutes)),
      allTime,
      consumption: estimate > 0 ? (allTime / estimate) * 100 : 0,
      // False when some project may have started before the loaded window: the all-time figure is then partial.
      complete: summaries.every((row) => row.coversWholeProject)
    };
  }, [summaries]);
  const hasPlanData = totals.estimate > 0;
  const loadedNote = totals.complete ? "" : " trong dữ liệu đã tải";

  const pagedProjects = usePagination(summaries, PROJECT_PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* ── Headline totals ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Giờ kế hoạch (Estimate)"
          value={hasPlanData ? formatHours(totals.estimate) : "—"}
          badge={hasPlanData ? `${summaries.length} dự án` : "Chưa có dữ liệu"}
          tone={hasPlanData ? "neutral" : "warning"}
          hint={hasPlanData ? "Tổng Estimate của các công việc" : "Thiếu Estimate ở các công việc"}
        />
        <KpiCard
          label={`Giờ thực tế — ${monthLabel}`}
          value={formatHours(totals.period)}
          hint={`Lũy kế${loadedNote}: ${formatHours(totals.allTime)}`}
        />
        <KpiCard
          label="Tỷ lệ sử dụng Estimate"
          value={hasPlanData ? formatPercent(totals.consumption) : "—"}
          badge={!hasPlanData ? "Thiếu Estimate" : totals.consumption > 100 ? "Vượt ngưỡng" : totals.consumption > 85 ? "Cần theo dõi" : "Trong ngưỡng"}
          tone={!hasPlanData ? "neutral" : totals.consumption > 100 ? "danger" : totals.consumption > 85 ? "warning" : "success"}
          hint={`Giờ lũy kế${loadedNote} / giờ kế hoạch`}
        />
      </div>

      {/* ── Project overview table ─────────────────────────────────────── */}
      <SectionCard
        id="pts-overview"
        title="Tổng quan giờ theo dự án"
        description="Bấm một dòng để mở chi tiết milestone, giai đoạn, công việc và nhân sự tham gia."
        actions={<span className="text-[11px] text-muted-foreground">{summaries.length} dự án</span>}
      >
        {summaries.length === 0 ? (
          <EmptyState message="Không có dự án nào khớp bộ lọc." />
        ) : (
          <TableScroll>
            <table className="w-full min-w-[1240px] table-fixed border-separate border-spacing-0">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[7%]" />
                <col className="w-[7%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[7%]" />
                <col className="w-[5%]" />
                <col className="w-[7%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted/60">
                <tr>
                  <Th>Dự án</Th>
                  <Th align="center">Trạng thái</Th>
                  <Th align="right">Milestone</Th>
                  <Th align="right">Kế hoạch</Th>
                  <Th align="right">Giờ {periodShort}</Th>
                  <Th align="right">Lũy kế</Th>
                  <Th align="right">Chênh lệch</Th>
                  <Th align="right">Đã dùng</Th>
                  <Th align="right">Có kế hoạch</Th>
                  <Th align="right">Nhân sự</Th>
                  <Th>Hạn hoàn thành</Th>
                  <Th align="center">Sẵn sàng</Th>
                </tr>
              </thead>
              <tbody>
                {pagedProjects.items.map((row) => {
                  const active = row.project.id === selectedProjectId;
                  const ready = readinessByProject.get(row.project.id);
                  const hasEstimate = row.estimateMinutes > 0;
                  const usageBasis = `Lũy kế ${formatHours(row.allTimeActualMinutes)} / Estimate ${formatHours(row.estimateMinutes)}${row.coversWholeProject ? "" : ` — chỉ tính dữ liệu đã tải${dataset.windowStart ? ` từ ${formatDate(dataset.windowStart)}` : ""}`}`;
                  return (
                    <React.Fragment key={row.project.id}>
                    <tr
                      className={`cursor-pointer border-b border-border align-middle transition-colors hover:bg-primary/[0.04] ${active ? "bg-primary/[0.07]" : ""}`}
                      onClick={(event) => {
                        // Links and buttons inside the row keep their own action.
                        if ((event.target as HTMLElement).closest("a, button")) return;
                        setSelected(active ? null : row.project.id);
                      }}
                    >
                      <Td className={active ? "border-l-2 border-primary" : "border-l-2 border-transparent"}>
                        <span className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelected(active ? null : row.project.id)}
                            aria-expanded={active}
                            aria-label={`${active ? "Thu gọn" : "Mở rộng"} ${row.project.code}`}
                            className="flex shrink-0 items-center"
                          >
                            {active ? <ChevronDown className="h-3.5 w-3.5 text-primary" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                          </button>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: WORK_GROUP_COLORS[row.project.workGroup] }} aria-hidden />
                          <span className="min-w-0">
                            <Link
                              href={`/projects/${encodeURIComponent(row.project.id)}`}
                              className="block truncate font-semibold hover:underline"
                              title={`${row.project.code} — ${row.project.name}`}
                            >
                              {row.project.code} — {row.project.name}
                            </Link>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {row.project.accountName} · {WORK_GROUP_LABELS[row.project.workGroup]}
                            </span>
                          </span>
                        </span>
                      </Td>
                      <Td align="center">
                        <Pill tone={projectStatusTone(row.project.status)}>{projectStatusLabel(row.project.status)}</Pill>
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">{row.milestoneCount}</Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">{hasEstimate ? formatHours(row.estimateMinutes) : <span title="Chưa công việc nào có Estimate">—</span>}</Td>
                      <Td align="right" className="font-mono font-semibold tabular-nums">
                        <button
                          type="button"
                          onClick={() =>
                            setDrawerRequest({
                              title: `Chi tiết giờ — ${row.project.code}`,
                              description: `${row.project.name} · ${monthLabel}`,
                              logs: logs.filter((log) => log.projectId === row.project.id)
                            })
                          }
                          aria-label={`Mở Time Log nguồn của ${row.project.code}`}
                          title="Mở Time Log nguồn"
                          className={LOG_LINK_CLASS}
                        >
                          {formatHours(row.actualMinutes)}
                        </button>
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">
                        <span title={row.coversWholeProject ? "Toàn bộ giờ đã ghi của dự án" : usageBasis}>{formatHours(row.allTimeActualMinutes)}</span>
                      </Td>
                      <Td align="right" className={`font-mono tabular-nums ${hasEstimate && row.varianceMinutes > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {hasEstimate ? <span title={usageBasis}>{formatSignedHours(row.varianceMinutes)}</span> : <span title="Thiếu Estimate để tính chênh lệch">—</span>}
                      </Td>
                      <Td align="right">
                        {hasEstimate ? (
                          <span title={usageBasis}>
                            <BarValue percent={row.consumptionPercent} value={formatPercent(row.consumptionPercent)} tone={riskTone(row.risk)} />
                            {row.coversWholeProject ? null : <span className="block text-[10.5px] text-muted-foreground">trong dữ liệu đã tải</span>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-end gap-2" title="Chưa công việc nào có Estimate nên không tính được mức sử dụng">
                            <MiniBar percent={0} tone="neutral" width="w-8" />
                            <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">Thiếu Estimate</span>
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <span className={`font-mono tabular-nums ${row.estimateCoveragePercent < 80 ? "font-semibold text-warning" : "text-muted-foreground"}`}>
                          {row.taskCount > 0 ? formatPercent(row.estimateCoveragePercent) : "—"}
                        </span>
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">
                        <span title={`${row.activeMemberCount} đang làm việc${row.onLeaveMemberCount > 0 ? `, ${row.onLeaveMemberCount} đang nghỉ` : ""}`}>
                          {row.activeMemberCount}
                          {row.onLeaveMemberCount > 0 ? <span className="text-warning"> +{row.onLeaveMemberCount}</span> : null}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {row.deadline ? formatDate(row.deadline) : <span className="text-warning">Chưa đặt</span>}
                      </Td>
                      <Td align="center">
                        {ready ? (
                          <span title={ready.checks.map((check) => `${check.passed ? "✓" : "✗"} ${check.label} (${check.detail})`).join("\n")}>
                            <Pill tone={ready.score >= 80 ? "success" : ready.score >= 55 ? "warning" : "danger"}>{ready.score}%</Pill>
                          </span>
                        ) : "—"}
                      </Td>
                    </tr>
                    {active ? (
                      <tr className="border-b border-primary/20 bg-background">
                        <td colSpan={12} className="p-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/[0.035] px-4 py-3">
                            <div>
                              <p className="text-[12.5px] font-bold text-foreground">Chi tiết milestone, giai đoạn và công việc</p>
                              <p className="text-[11px] text-muted-foreground">{row.project.code} · {row.project.name} · Bấm mũi tên để thu gọn từng cấp</p>
                            </div>
                            <SegmentedSwitch
                              label="Chi tiết dự án"
                              options={[{ value: "tasks", label: "Công việc" }, { value: "members", label: "Nhân sự" }, { value: "checks", label: "Dữ liệu" }]}
                              value={detailTab}
                              onChange={setDetailTab}
                            />
                          </div>
                          {detailTab === "tasks" ? (
                            <ProjectBreakdownTable dataset={dataset} projectId={row.project.id} logs={logs} periodShort={periodShort} onOpenLogs={setDrawerRequest} currentUserId={currentUserId} />
                          ) : detailTab === "members" ? (
                            <ProjectMemberTable dataset={dataset} projectId={row.project.id} month={filters.month} logs={logs} onOpenLogs={setDrawerRequest} currentUserId={currentUserId} />
                          ) : (
                            <ul className="grid gap-2 sm:grid-cols-2">
                              {(ready?.checks ?? []).map((check) => (
                                <li key={check.label} className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12px]">
                                  <span className={`font-bold ${check.passed ? "text-success" : "text-destructive"}`}>{check.passed ? "Đạt" : "Thiếu"}</span>
                                  <span><span className="font-semibold text-foreground">{check.label}</span><span className="block text-muted-foreground">{check.detail}</span></span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        <Pagination state={pagedProjects} unit="dự án" />
      </SectionCard>

      <LogDrawer dataset={dataset} request={drawerRequest} onClose={() => setDrawerRequest(null)} currentUserId={currentUserId} />
    </div>
  );
}

/* ── Milestone → giai đoạn → công việc breakdown ─────────────────────────── */

function ProjectBreakdownTable({
  dataset,
  projectId,
  logs,
  periodShort,
  onOpenLogs,
  currentUserId
}: {
  dataset: TimesheetDataset;
  projectId: string;
  logs: TimeLog[];
  periodShort: string;
  onOpenLogs: (request: LogDrawerRequest) => void;
  currentUserId?: string;
}) {
  const project = dataset.projects.find((item) => item.id === projectId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes = useMemo(
    () => (project ? buildProjectBreakdown(project, logs, dataset.people, dataset.generatedAt, dataset.logs) : []),
    [project, logs, dataset.people, dataset.generatedAt, dataset.logs]
  );

  const defaultCollapsed = useMemo(() => {
    const next = new Set<string>();
    const activeMilestone = nodes.find((node) => node.status === "in_progress") ?? nodes[0];
    for (const milestone of nodes) {
      if (milestone.id !== activeMilestone?.id) {
        next.add(milestone.id);
        continue;
      }
      for (const stage of milestone.children ?? []) {
        if (stage.status !== "in_progress") next.add(stage.id);
      }
    }
    return next;
  }, [nodes]);

  useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  // Paginate at the milestone level so a page break never splits a milestone
  // away from its own stages and tasks.
  const paged = usePagination(nodes, MILESTONE_PAGE_SIZE);

  if (!project || nodes.length === 0) {
    return <EmptyState message="Dự án này chưa được phân rã milestone nào." />;
  }

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openNodeLogs = (node: ProjectBreakdownNode) => {
    const taskIds = taskIdsOf(node);
    onOpenLogs({
      title: `Time Log nguồn — ${node.name}`,
      description: `${project.code} · ${formatHours(node.actualMinutes)}`,
      logs: logs.filter((log) => log.projectId === project.id && taskIds.includes(log.taskId))
    });
  };

  return (
    <>
    <TableScroll>
      <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[27%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
          <col className="w-[20%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead className="border-b border-border bg-muted/60">
          <tr>
            <Th>Milestone / Stage / Task</Th>
            <Th>Phụ trách</Th>
            <Th align="center">Trạng thái</Th>
            <Th>Thời gian</Th>
            <Th align="right">Kế hoạch</Th>
            <Th align="right">Giờ {periodShort}</Th>
            <Th align="right">Chênh lệch lũy kế</Th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((milestone) => (
            <React.Fragment key={milestone.id}>
              <BreakdownRow node={milestone} depth={0} collapsed={collapsed.has(milestone.id)} onToggle={toggle} onOpenLogs={openNodeLogs} currentUserId={currentUserId} />
              {!collapsed.has(milestone.id)
                ? milestone.children?.map((stage) => (
                    <React.Fragment key={stage.id}>
                      <BreakdownRow node={stage} depth={1} collapsed={collapsed.has(stage.id)} onToggle={toggle} onOpenLogs={openNodeLogs} currentUserId={currentUserId} />
                      {!collapsed.has(stage.id)
                        ? stage.children?.map((task) => <BreakdownRow key={task.id} node={task} depth={2} collapsed={false} onToggle={toggle} onOpenLogs={openNodeLogs} currentUserId={currentUserId} />)
                        : null}
                    </React.Fragment>
                  ))
                : null}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/60">
          <tr>
            <Td className="font-bold">Tổng toàn dự án ({nodes.length} milestone)</Td>
            <Td />
            <Td />
            <Td />
            <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(sum(nodes.map((node) => node.estimateMinutes)))}</Td>
            <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(sum(nodes.map((node) => node.actualMinutes)))}</Td>
            <Td align="right" className="font-mono font-bold tabular-nums">
              <span title={`Lũy kế ${formatHours(sum(nodes.map((node) => node.allTimeActualMinutes)))} so với Estimate`}>
                {formatSignedHours(sum(nodes.map((node) => node.allTimeActualMinutes)) - sum(nodes.map((node) => node.estimateMinutes)))}
              </span>
            </Td>
          </tr>
        </tfoot>
      </table>
    </TableScroll>
    <Pagination state={paged} unit="milestone" />
    </>
  );
}

function BreakdownRow({
  node,
  depth,
  collapsed,
  onToggle,
  onOpenLogs,
  currentUserId
}: {
  node: ProjectBreakdownNode;
  depth: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
  onOpenLogs: (node: ProjectBreakdownNode) => void;
  currentUserId?: string;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const overrun = node.variancePercent !== null && node.variancePercent > 0;
  const overdue = node.overdue === true;
  const rowClass =
    depth === 0 ? "bg-primary/[0.035] font-bold" : depth === 1 ? "bg-muted/[0.12] font-semibold" : "";

  return (
    <tr className={`border-b border-border transition-colors hover:bg-muted/30 ${rowClass}`}>
      <Td className={depth === 1 ? "pl-6" : depth === 2 ? "pl-12" : ""}>
        <span className="flex min-w-0 items-center gap-1.5">
          {hasChildren ? (
            <button type="button" onClick={() => onToggle(node.id)} aria-expanded={!collapsed} aria-label={collapsed ? "Mở rộng" : "Thu gọn"} className="shrink-0 text-muted-foreground">
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 truncate" title={node.name}>
            {depth === 0 ? "◆ " : depth === 1 ? "▸ " : ""}
            {node.name}
          </span>
          {node.level === "task" ? (
            <a
              href={`/tasks/${encodeURIComponent(node.id)}`}
              aria-label={`Mở task ${node.name}`}
              title="Mở task"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </span>
      </Td>
      <Td className="truncate text-muted-foreground">
        {node.ownerName ? <span className={node.ownerId === currentUserId ? "font-bold text-primary" : undefined}>{node.ownerName}</span> : <span className="text-warning">Chưa gán</span>}
      </Td>
      <Td align="center">
        <Pill tone={overdue ? "danger" : nodeStatusTone(node.status)}>{overdue ? "Quá hạn" : NODE_STATUS_LABELS[node.status as NodeStatus] ?? node.status}</Pill>
      </Td>
      <Td className="text-[11.5px] leading-snug text-muted-foreground">
        {node.startDate || node.dueDate ? <>{formatDate(node.startDate, "—")} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {formatDate(node.dueDate, "—")}</> : "—"}
      </Td>
      <Td align="right" className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">
        {node.estimateMinutes > 0 ? formatHours(node.estimateMinutes) : <span className="text-warning">Chưa có</span>}
      </Td>
      <Td align="right" className={`whitespace-nowrap font-mono tabular-nums ${overrun ? "font-semibold text-destructive" : ""}`}>
        <button type="button" onClick={() => onOpenLogs(node)} aria-label={`Mở Time Log nguồn — ${node.name}`} title="Mở Time Log nguồn" className={LOG_LINK_CLASS}>
          {formatHours(node.actualMinutes)}
        </button>
      </Td>
      <Td align="right" className={`whitespace-nowrap font-mono tabular-nums ${overrun ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
        {node.variancePercent === null ? "—" : <span title={`Lũy kế ${formatHours(node.allTimeActualMinutes)} / Estimate ${formatHours(node.estimateMinutes)}`}>{formatSignedPercent(node.variancePercent)}</span>}
      </Td>
    </tr>
  );
}

/* ── Members of the selected project ─────────────────────────────────────── */

function ProjectMemberTable({
  dataset,
  projectId,
  month,
  logs,
  onOpenLogs,
  currentUserId
}: {
  dataset: TimesheetDataset;
  projectId: string;
  month: string;
  logs: TimeLog[];
  onOpenLogs: (request: LogDrawerRequest) => void;
  currentUserId?: string;
}) {
  const project = dataset.projects.find((item) => item.id === projectId);
  const rows = useMemo(
    () => (project ? buildProjectMemberRows(project, dataset, logs) : []),
    [project, dataset, logs]
  );
  // EV-035: participation comes from the API for the viewed month; null while loading or on error.
  const [participation, setParticipation] = useState<Map<string, ProjectMemberParticipationItem> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setParticipation(null);
    fetchProjectMemberParticipation(projectId, month)
      .then((items) => { if (!cancelled) setParticipation(items); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectId, month]);

  const paged = usePagination(rows, MEMBER_PAGE_SIZE);
  // Project role / join date are shown only when the member payload carries them — never a column of "Chưa đặt".
  const showRole = rows.some((row) => row.role);
  const showJoinedAt = rows.some((row) => row.joinedAt);

  if (!project || rows.length === 0) {
    return <EmptyState message="Dự án này chưa có thành viên nào." />;
  }

  return (
    <>
    <TableScroll>
      <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[22%]" />
          {showRole ? <col className="w-[15%]" /> : null}
          <col className="w-[14%]" />
          {showJoinedAt ? <col className="w-[11%]" /> : null}
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead className="border-b border-border bg-muted/60">
          <tr>
            <Th>Nhân sự</Th>
            {showRole ? <Th>Vai trò</Th> : null}
            <Th align="center">Trạng thái tham gia</Th>
            {showJoinedAt ? <Th>Tham gia từ</Th> : null}
            <Th align="right">Việc đang mở</Th>
            <Th align="right">Giờ trong kỳ</Th>
            <Th>Ghi nhận gần nhất</Th>
            <Th align="center">Chi tiết</Th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((row) => (
            <tr key={row.person.id} className="border-b border-border transition-colors hover:bg-primary/[0.04]">
              <Td>
                <span className="flex items-center gap-2">
                  <Avatar initials={row.person.initials} name={row.person.name} />
                  <PersonLink userId={row.person.id} className={`hover:underline ${row.person.id === currentUserId ? "font-bold text-primary" : "font-semibold"}`}>{row.person.name}</PersonLink>
                </span>
              </Td>
              {showRole ? <Td className="text-muted-foreground">{row.role ?? "—"}</Td> : null}
              <Td align="center">
                {(() => {
                  const item = participation?.get(row.person.id);
                  return item ? (
                    <span title={item.participationReason} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PARTICIPATION_STATE[item.participationState].className}`}>
                      {PARTICIPATION_STATE[item.participationState].label}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>;
                })()}
                {row.state !== "active" ? <span className="block text-[11px] text-muted-foreground">HR: {MEMBER_STATE_LABELS[row.state as MemberState] ?? row.state}</span> : null}
              </Td>
              {showJoinedAt ? <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(row.joinedAt, "—")}</Td> : null}
              <Td align="right" className="font-mono tabular-nums text-muted-foreground">{row.openTaskCount}</Td>
              <Td align="right" className="font-mono font-semibold tabular-nums">{formatHours(row.actualMinutes)}</Td>
              <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                {row.lastLoggedDate ? (
                  formatDate(row.lastLoggedDate)
                ) : (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> Chưa log
                  </span>
                )}
              </Td>
              <Td align="center">
                <button
                  type="button"
                  onClick={() =>
                    onOpenLogs({
                      title: `Chi tiết giờ — ${row.person.name}`,
                      description: `${project.code} ${project.name}`,
                      logs: logs.filter((log) => log.projectId === project.id && log.personId === row.person.id)
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <FileSearch className="h-3 w-3" aria-hidden /> Xem
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
    <Pagination state={paged} unit="nhân sự" />
    </>
  );
}
