"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ExternalLink, FileSearch, XCircle } from "lucide-react";
import {
  buildMonthlyKpis,
  buildPersonDayMatrix,
  buildPersonMonthSummaries,
  buildPersonProjectRows,
  buildDailySeries,
  buildWorkGroupSplit,
  sum,
  type PersonDayRow,
  type TimesheetFilters
} from "./timesheet-selectors";
import {
  formatDate,
  formatHours,
  formatMonth,
  formatPercent,
  formatSignedPercent,
  nodeStatusTone,
  projectStatusTone,
  qualityTone,
  WORK_GROUP_COLORS
} from "./timesheet-format";
import {
  NODE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  type NodeStatus,
  type ProjectStatus,
  type TimeLog,
  type TimesheetDataset
} from "./timesheet-types";
import {
  Avatar,
  BarValue,
  ChartCard,
  Drawer,
  EmptyState,
  KpiCard,
  Pagination,
  Pill,
  SectionCard,
  TableScroll,
  Td,
  Th,
  usePagination
} from "./timesheet-ui";
import { LogDrawer, type LogDrawerRequest } from "./timesheet-log-drawer";

const chartFallback = () => <div className="h-full w-full animate-pulse rounded-lg bg-muted" aria-hidden />;
const WorkGroupDonut = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.WorkGroupDonut })), { ssr: false, loading: chartFallback });
const DailyEffortChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.DailyEffortChart })), { ssr: false, loading: chartFallback });

const PEOPLE_PAGE_SIZE = 8;
const MISSING_DAYS_PAGE_SIZE = 6;

/**
 * Monthly Timesheet — the person-centric view.
 *
 * Covers: headline totals + daily effort against the 8h/day standard, the
 * per-person Project → Milestone → Stage → Task drill-down, the work-group
 * split, and the monthly log-completeness check. Filters live in the workbench;
 * the drill-down to underlying log rows lives here.
 */
export function MonthlyTimesheet({
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
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [dayDetailPersonId, setDayDetailPersonId] = useState<string | null>(null);
  const [drawerRequest, setDrawerRequest] = useState<LogDrawerRequest | null>(null);

  const summaries = useMemo(() => buildPersonMonthSummaries(dataset, filters, logs), [dataset, filters, logs]);
  const kpis = useMemo(() => buildMonthlyKpis(dataset, filters, logs, summaries), [dataset, filters, logs, summaries]);
  const personDayMatrix = useMemo(() => buildPersonDayMatrix(dataset, filters, logs), [dataset, filters, logs]);
  const dailySeries = useMemo(() => buildDailySeries(dataset, filters, logs, summaries), [dataset, filters, logs, summaries]);
  const workGroupSplit = useMemo(() => buildWorkGroupSplit(logs), [logs]);

  const peopleMissingDays = useMemo(() => summaries.filter((row) => row.missingDays.length > 0), [summaries]);
  const totalDaysLogged = useMemo(() => sum(summaries.map((row) => row.daysLogged)), [summaries]);
  const totalPossibleDays = useMemo(() => sum(summaries.map((row) => row.workingDays)), [summaries]);

  const pagedPeople = usePagination(summaries, PEOPLE_PAGE_SIZE);
  const pagedMissingDays = usePagination(peopleMissingDays, MISSING_DAYS_PAGE_SIZE);

  const monthLabel = formatMonth(filters.month);
  const dayDetailRow = personDayMatrix.rows.find((row) => row.person.id === dayDetailPersonId) ?? null;

  const openPersonLogs = (row: PersonDayRow) => {
    setDayDetailPersonId(null);
    setDrawerRequest({
      title: `Chi tiết log — ${row.person.name}`,
      description: `${monthLabel} · ${formatHours(row.totalMinutes)} trong ${row.daysLogged} ngày`,
      logs: logs.filter((log) => log.personId === row.person.id)
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Headline totals ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Giờ thực tế đã ghi nhận"
          value={formatHours(kpis.actualMinutes)}
          badge={`${kpis.peopleCount} nhân sự`}
          tone="info"
          hint={`${monthLabel}`}
        />
        <KpiCard
          label="Giờ tiêu chuẩn (8h/ngày)"
          value={formatHours(kpis.standardMinutes)}
          badge={`${kpis.workingDays} ngày công`}
          tone="neutral"
          hint="Đã trừ T7/CN và ngày lễ"
        />
        <KpiCard
          label="Giờ còn thiếu"
          value={formatHours(kpis.missingMinutes)}
          badge={kpis.completionPercent >= 90 ? "Đầy đủ" : kpis.completionPercent >= 70 ? "Thiếu một phần" : "Không đủ căn cứ"}
          tone={kpis.completionPercent >= 90 ? "success" : kpis.completionPercent >= 70 ? "warning" : "danger"}
          hint={`${formatPercent(kpis.completionPercent)} giờ chuẩn đã ghi nhận`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Phân loại giờ theo nhóm công việc"
          description="Tách riêng dự án khách hàng, dự án nội bộ và ticket bảo trì."
          minHeight={260}
        >
          {workGroupSplit.length === 0 ? <EmptyState message="Không có giờ nào trong phạm vi lọc." /> : <WorkGroupDonut data={workGroupSplit} />}
        </ChartCard>
        <ChartCard
          title="Giờ ghi nhận theo ngày"
          description="So sánh giờ thực tế với giờ tiêu chuẩn trong kỳ."
          minHeight={260}
        >
          {dailySeries.length === 0 ? <EmptyState message="Không có ngày nào trong phạm vi lọc." /> : <DailyEffortChart data={dailySeries} />}
        </ChartCard>
      </div>

      {/* ── Person table: totals, drill-down and completeness in one ───── */}
      <SectionCard
        id="mts-people"
        title={`Tổng quan nhân sự — ${monthLabel}`}
        description="Bấm vào một dòng để xem chi tiết dự án, giai đoạn và công việc của nhân sự đó."
        actions={<span className="text-[11px] text-muted-foreground">{summaries.length} nhân sự</span>}
      >
        {summaries.length === 0 ? (
          <EmptyState message="Không có nhân sự nào khớp bộ lọc hiện tại." />
        ) : (
          <TableScroll>
            <table className="w-full min-w-[940px] table-fixed border-separate border-spacing-0">
              <colgroup>
                <col className="w-[25%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[13%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted/60">
                <tr>
                  <Th>Nhân sự</Th>
                  <Th align="right">Giờ thực tế</Th>
                  <Th align="right">Giờ chuẩn</Th>
                  <Th align="right">Hoàn thành</Th>
                  <Th align="right">Giờ thiếu</Th>
                  <Th align="right">Ngày ghi nhận</Th>
                  <Th align="right">Dự án</Th>
                  <Th align="center">Đánh giá</Th>
                  <Th align="center">Chi tiết</Th>
                </tr>
              </thead>
              <tbody>
                {pagedPeople.items.map((row) => {
                  const expanded = expandedPersonId === row.person.id;
                  return (
                    <React.Fragment key={row.person.id}>
                      <tr className={`border-b border-border align-middle transition-colors hover:bg-primary/[0.04] ${expanded ? "bg-primary/[0.07]" : ""}`}>
                        <Td className={expanded ? "border-l-2 border-primary" : "border-l-2 border-transparent"}>
                          <button
                            type="button"
                            onClick={() => setExpandedPersonId(expanded ? null : row.person.id)}
                            aria-expanded={expanded}
                            className="flex items-center gap-2 text-left"
                          >
                            {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                            <Avatar initials={row.person.initials} name={row.person.name} />
                            <span className="min-w-0">
                              <span className={`block truncate ${row.person.id === currentUserId ? "font-bold text-primary" : "font-semibold"}`} title={row.person.name}>
                                {row.person.name}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {row.person.role} · {row.person.teamName}
                                {row.person.contractRatio < 1 ? ` · ${Math.round(row.person.contractRatio * 100)}% hợp đồng` : ""}
                              </span>
                            </span>
                          </button>
                        </Td>
                        <Td align="right" className="font-mono font-semibold tabular-nums">{formatHours(row.actualMinutes)}</Td>
                        <Td align="right" className="font-mono tabular-nums text-muted-foreground">{formatHours(row.standardMinutes)}</Td>
                        <Td align="right">
                          <BarValue percent={row.completionPercent} value={formatPercent(row.completionPercent)} tone={qualityTone(row.quality)} />
                        </Td>
                        <Td align="right" className={`font-mono tabular-nums ${row.missingMinutes > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {row.missingMinutes > 0 ? formatHours(row.missingMinutes) : "—"}
                        </Td>
                        <Td align="right" className="font-mono tabular-nums text-muted-foreground">
                          {row.daysLogged}/{row.workingDays}
                        </Td>
                        <Td align="right" className="font-mono tabular-nums text-muted-foreground">{row.projectCount}</Td>
                        <Td align="center">
                          <Pill tone={qualityTone(row.quality)}>
                            {row.quality === "good" ? "Đầy đủ" : row.quality === "warning" ? "Thiếu một phần" : "Không đủ căn cứ"}
                          </Pill>
                        </Td>
                        <Td align="center">
                          <button
                            type="button"
                            onClick={() =>
                              setDrawerRequest({
                                title: `Chi tiết giờ — ${row.person.name}`,
                                description: `${monthLabel} · ${formatHours(row.actualMinutes)} trên ${row.daysLogged} ngày`,
                                logs: logs.filter((log) => log.personId === row.person.id)
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <FileSearch className="h-3 w-3" aria-hidden /> Xem
                          </button>
                        </Td>
                      </tr>
                      {expanded ? (
                        <tr className="border-b border-primary/20 bg-background">
                          <td colSpan={9} className="p-0">
                            <PersonProjectDetail
                              dataset={dataset}
                              logs={logs.filter((log) => log.personId === row.person.id)}
                              missingDays={row.missingDays}
                              onOpenLogs={setDrawerRequest}
                              personName={row.person.name}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/60">
                <tr>
                  <Td className="font-bold">Tổng cộng {summaries.length} nhân sự</Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(kpis.actualMinutes)}</Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(kpis.standardMinutes)}</Td>
                  <Td align="right">
                    <BarValue
                      percent={kpis.completionPercent}
                      value={formatPercent(kpis.completionPercent)}
                      tone={kpis.completionPercent >= 90 ? "success" : kpis.completionPercent >= 70 ? "warning" : "danger"}
                    />
                  </Td>
                  <Td align="right" className="font-mono font-bold tabular-nums text-destructive">{formatHours(kpis.missingMinutes)}</Td>
                  {/* Same "logged / possible" shape as the rows above, not a bare percentage. */}
                  <Td align="right" className="font-mono font-bold tabular-nums">
                    {totalDaysLogged}/{totalPossibleDays}
                  </Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{kpis.projectCount}</Td>
                  <Td align="center" className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
                    {formatPercent(kpis.dayCoveragePercent)}
                  </Td>
                  <Td />
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
        <Pagination state={pagedPeople} unit="nhân sự" />
      </SectionCard>

      <SectionCard
        id="mts-missing"
        title="Ngày công chưa có log"
        description="Danh sách ngày công mà nhân sự chưa ghi nhận giờ nào."
        actions={<span className="text-[11px] text-muted-foreground">{peopleMissingDays.length} nhân sự</span>}
      >
        {peopleMissingDays.length === 0 ? (
          <EmptyState message="Mọi nhân sự đều đã ghi nhận đủ số ngày công trong kỳ." />
        ) : (
          <>
            {/* Fixed-height cards keep the grid rows level regardless of how
                many date chips each person has. */}
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {pagedMissingDays.items.map((row) => (
                <button
                  key={row.person.id}
                  type="button"
                  onClick={() => setDayDetailPersonId(row.person.id)}
                  aria-label={`Xem tất cả ngày công của ${row.person.name}`}
                  className="group flex min-h-[128px] flex-col rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar initials={row.person.initials} name={row.person.name} />
                      <span className={`truncate text-[12.5px] ${row.person.id === currentUserId ? "font-bold text-primary" : "font-semibold text-foreground"}`}>
                        {row.person.name}
                      </span>
                    </span>
                    <Pill tone={row.missingDays.length > 5 ? "danger" : "warning"}>{row.missingDays.length} ngày</Pill>
                  </div>
                  <div className="mt-2 flex flex-1 flex-wrap content-start gap-1">
                    {row.missingDays.slice(0, 12).map((iso) => (
                      <span key={iso} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                        {iso.slice(8, 10)}/{iso.slice(5, 7)}
                      </span>
                    ))}
                    {row.missingDays.length > 12 ? (
                      <span className="px-1 py-0.5 text-[10.5px] text-muted-foreground">+{row.missingDays.length - 12} ngày nữa</span>
                    ) : null}
                  </div>
                  <span className="mt-auto pt-2 text-[10.5px] font-semibold text-primary/80 transition-colors group-hover:text-primary group-focus-visible:text-primary">
                    Xem chi tiết tất cả ngày →
                  </span>
                </button>
              ))}
            </div>
            <Pagination state={pagedMissingDays} unit="nhân sự" />
          </>
        )}
      </SectionCard>

      <PersonDayDetailDrawer
        row={dayDetailRow}
        holidays={dataset.holidays}
        logs={logs}
        monthLabel={monthLabel}
        onClose={() => setDayDetailPersonId(null)}
        onOpenLogs={openPersonLogs}
      />
      <LogDrawer dataset={dataset} request={drawerRequest} onClose={() => setDrawerRequest(null)} currentUserId={currentUserId} />
    </div>
  );
}

function PersonDayDetailDrawer({
  row,
  holidays,
  logs,
  monthLabel,
  onClose,
  onOpenLogs
}: {
  row: PersonDayRow | null;
  holidays: string[];
  logs: TimeLog[];
  monthLabel: string;
  onClose: () => void;
  onOpenLogs: (row: PersonDayRow) => void;
}) {
  const logsByDate = useMemo(() => {
    const grouped = new Map<string, TimeLog[]>();
    for (const log of logs) {
      if (log.personId !== row?.person.id) continue;
      grouped.set(log.date, [...(grouped.get(log.date) ?? []), log]);
    }
    return grouped;
  }, [logs, row?.person.id]);

  const offDays = row?.cells.filter((cell) => !cell.isWorkingDay).length ?? 0;
  const missingDays = row?.cells.filter((cell) => cell.isWorkingDay && cell.minutes === 0).length ?? 0;
  const loggedDays = row?.cells.filter((cell) => cell.minutes > 0).length ?? 0;

  return (
    <Drawer
      open={row !== null}
      title={row ? `Chi tiết ngày công — ${row.person.name}` : "Chi tiết ngày công"}
      description={row ? `${monthLabel} · Toàn bộ ngày trong kỳ, bao gồm ngày nghỉ và ngày chưa ghi nhận` : undefined}
      icon={CalendarDays}
      onClose={onClose}
    >
      {row ? (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DayMetric label="Tổng giờ" value={formatHours(row.totalMinutes)} tone="primary" />
            <DayMetric label="Đã ghi nhận" value={`${loggedDays} ngày`} />
            <DayMetric label="Thiếu log" value={`${missingDays} ngày`} tone={missingDays > 0 ? "warning" : "success"} />
            <DayMetric label="Ngày nghỉ / off" value={`${offDays} ngày`} />
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2.5 text-[11.5px] leading-5 text-muted-foreground">
            Danh sách dưới đây hiển thị cả ngày làm việc, cuối tuần và ngày lễ. Ngày làm việc không có log được đánh dấu để dễ nhắc bổ sung.
          </div>

          <div className="space-y-2">
            {row.cells.map((cell) => {
              const dayLogs = logsByDate.get(cell.date) ?? [];
              const holiday = holidays.includes(cell.date);
              const offDay = !cell.isWorkingDay;
              const logged = cell.minutes > 0;
              return (
                <article key={cell.date} className={`rounded-xl border p-3 ${offDay ? "border-border bg-muted/25" : logged ? "border-success/20 bg-success/[0.025]" : "border-warning/30 bg-warning/[0.035]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${offDay ? "bg-muted text-muted-foreground" : logged ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {offDay ? <CalendarDays className="h-4 w-4" aria-hidden /> : logged ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-bold text-foreground">{formatDate(cell.date)}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{holiday ? "Ngày lễ / ngày off" : offDay ? "Cuối tuần" : logged ? `${dayLogs.length} dòng ghi nhận` : "Ngày làm việc chưa có log"}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-[13px] font-bold tabular-nums text-foreground">{logged ? formatHours(cell.minutes) : "—"}</p>
                      {!offDay && <p className={`mt-0.5 text-[10.5px] font-semibold ${logged ? "text-success" : "text-warning"}`}>{logged ? "Đã ghi nhận" : "Cần bổ sung"}</p>}
                    </div>
                  </div>

                  {dayLogs.length > 0 ? (
                    <div className="mt-2 space-y-1.5 border-t border-border/70 pt-2">
                      {dayLogs.slice(0, 3).map((log) => (
                        <div key={log.id} className="flex items-center justify-between gap-3 text-[11px]">
                          <span className="min-w-0 truncate text-muted-foreground" title={log.taskId}>{log.note || log.taskId}</span>
                          <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">{formatHours(log.minutes)}</span>
                        </div>
                      ))}
                      {dayLogs.length > 3 ? <p className="text-[10.5px] text-muted-foreground">+{dayLogs.length - 3} dòng khác</p> : null}
                      <button type="button" onClick={() => onOpenLogs(row)} className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline">
                        <FileSearch className="h-3 w-3" aria-hidden /> Mở toàn bộ log của nhân sự
                      </button>
                    </div>
                  ) : null}

                  {offDay && !holiday ? <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><XCircle className="h-3 w-3" aria-hidden /> Không tính vào ngày công chuẩn</p> : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function DayMetric({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "primary" | "warning" | "success" }) {
  const classes = tone === "primary" ? "border-primary/20 bg-primary/[0.04] text-primary" : tone === "warning" ? "border-warning/30 bg-warning/[0.04] text-warning" : tone === "success" ? "border-success/20 bg-success/[0.04] text-success" : "border-border bg-muted/20 text-foreground";
  return <div className={`rounded-lg border px-3 py-2 ${classes}`}><p className="text-[10.5px] font-semibold uppercase tracking-wide opacity-80">{label}</p><p className="mt-0.5 font-mono text-[13px] font-bold tabular-nums">{value}</p></div>;
}

/* ── Per-person breakdown: dự án → milestone → giai đoạn → công việc ───── */

function PersonProjectDetail({
  dataset,
  logs,
  missingDays,
  onOpenLogs,
  personName
}: {
  dataset: TimesheetDataset;
  logs: TimeLog[];
  missingDays: string[];
  onOpenLogs: (request: LogDrawerRequest) => void;
  personName: string;
}) {
  const rows = useMemo(() => buildPersonProjectRows(dataset, logs), [dataset, logs]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (rows.length === 0) {
    return <EmptyState message={`${personName} chưa ghi nhận giờ nào trong kỳ này (${missingDays.length} ngày công trống).`} />;
  }

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <p className="text-[13px] font-bold text-foreground">Giờ của {personName} theo dự án</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Gộp theo Project → Milestone → Stage → Task; số giờ lấy từ các dòng Time Log nguồn.</p>
      </div>
      <TableScroll>
        <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-[31%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[20%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="border-b border-border bg-muted/60">
            <tr>
              <Th>Milestone / Stage / Task</Th>
              <Th>Phụ trách</Th>
              <Th align="center">Trạng thái</Th>
              <Th>Thời gian</Th>
              <Th align="right">Kế hoạch</Th>
              <Th align="right">Thực tế</Th>
              <Th align="right">Chênh lệch</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const loggedTaskCount = sum(row.milestones.flatMap((milestoneRow) => milestoneRow.stages.flatMap((stageRow) => stageRow.tasks.filter((taskRow) => taskRow.actualMinutes > 0).map(() => 1))));
              return (
                <React.Fragment key={row.project.id}>
                  <tr className="border-b border-border bg-primary/[0.035]">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: WORK_GROUP_COLORS[row.project.workGroup] }} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-bold text-foreground">{row.project.code} — {row.project.name}</p>
                          <p className="mt-0.5 text-[10.5px] text-muted-foreground">{PROJECT_STATUS_LABELS[row.project.status as ProjectStatus]} · {loggedTaskCount} task có log</p>
                        </div>
                        <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-foreground">{formatHours(row.actualMinutes)}</span>
                        <Pill tone={projectStatusTone(row.project.status)}>{PROJECT_STATUS_LABELS[row.project.status as ProjectStatus]}</Pill>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenLogs({
                              title: `Chi tiết giờ — ${row.project.code}`,
                              description: `${personName} · ${formatHours(row.actualMinutes)}`,
                              logs: logs.filter((log) => log.projectId === row.project.id)
                            })
                          }
                          aria-label={`Mở log ${row.project.code}`}
                          title="Mở log"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <FileSearch className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {row.milestones.map((milestoneRow) => (
                    <React.Fragment key={milestoneRow.milestone.id}>
                      <PersonProjectNodeRow
                        node={milestoneRow.milestone}
                        depth={0}
                        ownerName={personName}
                        actualMinutes={milestoneRow.actualMinutes}
                        today={dataset.generatedAt}
                        collapsed={collapsed.has(milestoneRow.milestone.id)}
                        hasChildren={milestoneRow.stages.length > 0}
                        onToggle={toggle}
                      />
                      {!collapsed.has(milestoneRow.milestone.id)
                        ? milestoneRow.stages.map((stageRow) => (
                            <React.Fragment key={stageRow.stage.id}>
                              <PersonProjectNodeRow
                                node={stageRow.stage}
                                depth={1}
                                ownerName={personName}
                                actualMinutes={stageRow.actualMinutes}
                                today={dataset.generatedAt}
                                collapsed={collapsed.has(stageRow.stage.id)}
                                hasChildren={stageRow.tasks.length > 0}
                                onToggle={toggle}
                              />
                              {!collapsed.has(stageRow.stage.id)
                                ? stageRow.tasks.map((taskRow) => (
                                    <PersonProjectNodeRow
                                      key={taskRow.task.id}
                                      node={taskRow.task}
                                      depth={2}
                                      ownerName={personName}
                                      actualMinutes={taskRow.actualMinutes}
                                      today={dataset.generatedAt}
                                      onToggle={toggle}
                                      taskId={taskRow.task.id}
                                    />
                                  ))
                                : null}
                            </React.Fragment>
                          ))
                        : null}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/60">
            <tr>
              <Td className="font-bold">Tổng cộng {rows.length} dự án</Td>
              <Td />
              <Td />
              <Td />
              <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(sum(rows.map((row) => row.estimateMinutes)))}</Td>
              <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(sum(rows.map((row) => row.actualMinutes)))}</Td>
              <Td align="right" className="font-mono font-bold tabular-nums">{formatSignedPercent(sum(rows.map((row) => row.estimateMinutes)) > 0 ? ((sum(rows.map((row) => row.actualMinutes)) - sum(rows.map((row) => row.estimateMinutes))) / sum(rows.map((row) => row.estimateMinutes))) * 100 : 0)}</Td>
            </tr>
          </tfoot>
        </table>
      </TableScroll>
    </div>
  );
}

type PersonProjectNode = {
  id: string;
  name: string;
  status: NodeStatus;
  startDate?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number;
};

function PersonProjectNodeRow({
  node,
  depth,
  ownerName,
  actualMinutes,
  today,
  collapsed = false,
  hasChildren = false,
  onToggle,
  taskId
}: {
  node: PersonProjectNode;
  depth: 0 | 1 | 2;
  ownerName: string;
  actualMinutes: number;
  today: string;
  collapsed?: boolean;
  hasChildren?: boolean;
  onToggle: (id: string) => void;
  taskId?: string;
}) {
  const estimateMinutes = node.estimateMinutes ?? 0;
  const variancePercent = estimateMinutes > 0 ? ((actualMinutes - estimateMinutes) / estimateMinutes) * 100 : null;
  const overdue = Boolean(taskId && node.status !== "completed" && node.dueDate && node.dueDate < today);
  const rowClass = depth === 0 ? "bg-primary/[0.035] font-bold" : depth === 1 ? "bg-muted/[0.12] font-semibold" : "";

  return (
    <tr className={`border-b border-border transition-colors hover:bg-muted/30 ${rowClass}`}>
      <Td className={depth === 1 ? "pl-6" : depth === 2 ? "pl-12" : ""}>
        <span className="flex min-w-0 items-center gap-1.5">
          {hasChildren ? (
            <button type="button" onClick={() => onToggle(node.id)} aria-expanded={!collapsed} aria-label={collapsed ? "Mở rộng" : "Thu gọn"} className="shrink-0 text-muted-foreground">
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : <span className="w-3.5 shrink-0" aria-hidden />}
          <span className="min-w-0 truncate" title={node.name}>{depth === 0 ? "◆ " : depth === 1 ? "▸ " : ""}{node.name}</span>
          {taskId ? (
            <a href={`/tasks/${encodeURIComponent(taskId)}`} aria-label={`Mở task ${node.name}`} title="Mở task" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </span>
      </Td>
      <Td className="truncate"><span className="font-semibold text-primary">{ownerName}</span></Td>
      <Td align="center"><Pill tone={overdue ? "danger" : nodeStatusTone(node.status)}>{overdue ? "Quá hạn" : NODE_STATUS_LABELS[node.status]}</Pill></Td>
      <Td className="text-[11.5px] leading-snug text-muted-foreground">
        {node.startDate || node.dueDate ? <>{formatDate(node.startDate, "—")} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {formatDate(node.dueDate, "—")}</> : "—"}
      </Td>
      <Td align="right" className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">{estimateMinutes > 0 ? formatHours(estimateMinutes) : <span className="text-warning">Chưa có</span>}</Td>
      <Td align="right" className="whitespace-nowrap font-mono font-semibold tabular-nums">{formatHours(actualMinutes)}</Td>
      <Td align="right" className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">{variancePercent === null ? "—" : formatSignedPercent(variancePercent)}</Td>
    </tr>
  );
}
