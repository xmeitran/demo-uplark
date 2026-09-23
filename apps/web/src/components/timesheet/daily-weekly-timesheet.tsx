"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { FileSearch } from "lucide-react";
import {
  buildDailySeries,
  buildPersonMonthSummaries,
  buildWeeklyEffortPerTask,
  buildWeeklySeries,
  peopleInScope,
  sum,
  workingDaysInMonth,
  type TimesheetFilters
} from "./timesheet-selectors";
import { isoWeekKey, monthBounds } from "./timesheet-mock-data";
import { formatDate, formatHours, formatMonth, formatPercent } from "./timesheet-format";
import type { TimeLog, TimesheetDataset } from "./timesheet-types";
import {
  Avatar,
  BarValue,
  ChartCard,
  EmptyState,
  KpiCard,
  MiniBar,
  Pagination,
  Pill,
  SectionCard,
  TableScroll,
  Td,
  Th,
  usePagination
} from "./timesheet-ui";
import { LogDrawer, type LogDrawerRequest } from "./timesheet-log-drawer";
import { PersonDayLoad } from "./person-day-load";

const chartFallback = () => <div className="h-full w-full animate-pulse rounded-lg bg-muted" aria-hidden />;
const DailyEffortChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.DailyEffortChart })), { ssr: false, loading: chartFallback });
const WeeklyComplianceChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.WeeklyComplianceChart })), { ssr: false, loading: chartFallback });
const PlannedVsActualPerTaskChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.PlannedVsActualPerTaskChart })), { ssr: false, loading: chartFallback });

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const DAY_PAGE_SIZE = 10;
const WEEK_MATRIX_PAGE_SIZE = 8;

/**
 * Daily + Weekly Timesheet.
 *
 * Day-by-day tracking against the 8h/day standard (with a month heat grid so
 * missing days are obvious at a glance) plus a weekly rollup per person.
 *
 * NOTE: production time-log rows store only a work date, no start/end time, so
 * a real intra-day timeline is impossible today. This screen therefore works at
 * daily-total granularity only — the mock data mirrors that constraint on
 * purpose rather than promising a time-blocked day view we cannot back.
 */
export function DailyWeeklyTimesheet({
  dataset,
  filters,
  logs
}: {
  dataset: TimesheetDataset;
  filters: TimesheetFilters;
  logs: TimeLog[];
}) {
  const [drawerRequest, setDrawerRequest] = useState<LogDrawerRequest | null>(null);

  const summaries = useMemo(() => buildPersonMonthSummaries(dataset, filters, logs), [dataset, filters, logs]);
  const dailySeries = useMemo(() => buildDailySeries(dataset, filters, logs, summaries), [dataset, filters, logs, summaries]);
  const weeklySeries = useMemo(() => buildWeeklySeries(dataset, filters, dailySeries), [dataset, filters, dailySeries]);
  const people = useMemo(() => peopleInScope(dataset, filters), [dataset, filters]);
  const workingDays = useMemo(() => workingDaysInMonth(filters.month, dataset.holidays, dataset.generatedAt), [filters.month, dataset.holidays, dataset.generatedAt]);

  const grid = useMemo(() => buildMonthGrid(filters.month, dailySeries), [filters.month, dailySeries]);
  const monthLabel = formatMonth(filters.month);

  const totals = useMemo(() => {
    const actual = sum(dailySeries.map((day) => day.actualMinutes));
    const standard = sum(dailySeries.map((day) => day.standardMinutes));
    const workedDays = dailySeries.filter((day) => day.isWorkingDay && day.actualMinutes > 0).length;
    const emptyWorkingDays = dailySeries.filter((day) => day.isWorkingDay && day.actualMinutes === 0).length;
    const best = dailySeries.reduce((acc, day) => (day.actualMinutes > (acc?.actualMinutes ?? -1) ? day : acc), dailySeries[0]);
    return { actual, standard, workedDays, emptyWorkingDays, best };
  }, [dailySeries]);

  // Per-person weekly matrix.
  const weeklyMatrix = useMemo(() => {
    const byPersonWeek = new Map<string, Map<string, number>>();
    for (const log of logs) {
      const key = isoWeekKey(log.date);
      const bucket = byPersonWeek.get(log.personId) ?? new Map<string, number>();
      bucket.set(key, (bucket.get(key) ?? 0) + log.minutes);
      byPersonWeek.set(log.personId, bucket);
    }
    return people.map((person) => ({
      person,
      cells: weeklySeries.map((week) => {
        const minutes = byPersonWeek.get(person.id)?.get(week.weekKey) ?? 0;
        const standard = Math.round(person.standardMinutesPerDay * person.contractRatio * week.workingDays);
        return {
          weekKey: week.weekKey,
          minutes,
          standard,
          percent: standard > 0 ? (minutes / standard) * 100 : 0
        };
      })
    }));
  }, [logs, people, weeklySeries]);

  const effortPerTask = useMemo(() => buildWeeklyEffortPerTask(dataset, logs, weeklySeries), [dataset, logs, weeklySeries]);

  /** Weeks where effort per task overshoots the plan by more than 10%. */
  const overshootWeeks = useMemo(
    () => effortPerTask.filter((point) => point.matchPercent !== null && point.matchPercent > 110),
    [effortPerTask]
  );
  const worstCoverage = useMemo(
    () => effortPerTask.reduce((acc, point) => Math.min(acc, point.estimateCoveragePercent || 100), 100),
    [effortPerTask]
  );

  const pagedDays = usePagination(dailySeries, DAY_PAGE_SIZE);
  const pagedMatrix = usePagination(weeklyMatrix, WEEK_MATRIX_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={`Giờ thực tế — ${monthLabel}`}
          value={formatHours(totals.actual)}
          badge={`${totals.workedDays}/${workingDays.length} ngày công có ghi nhận`}
          tone={totals.emptyWorkingDays === 0 ? "success" : "warning"}
          hint={`${people.length} nhân sự trong phạm vi`}
        />
        <KpiCard
          label="Ngày công chưa ghi nhận"
          value={`${totals.emptyWorkingDays}`}
          badge={totals.emptyWorkingDays === 0 ? "Đủ" : "Cần nhắc ghi nhận"}
          tone={totals.emptyWorkingDays === 0 ? "success" : "danger"}
          hint="Tính trên toàn phạm vi lọc"
        />
        <KpiCard
          label="Ngày ghi nhận cao nhất"
          value={totals.best ? formatHours(totals.best.actualMinutes) : "—"}
          badge={totals.best ? formatDate(totals.best.date) : "—"}
          tone="info"
          hint={totals.best ? `${totals.best.peopleLogged} người ghi nhận` : undefined}
        />
        <KpiCard
          label="Số tuần trong kỳ"
          value={`${weeklySeries.length}`}
          badge={`${formatPercent(totals.standard > 0 ? (totals.actual / totals.standard) * 100 : 0)} so với chuẩn`}
          tone="neutral"
          hint="Dùng cho tổng hợp theo tuần"
        />
      </div>

      <ChartCard
        title="Giờ ghi nhận theo ngày"
        description="Giờ thực tế mỗi ngày đối chiếu với giờ tiêu chuẩn 8h/ngày."
        footnote="Hệ thống hiện chỉ lưu ngày làm việc, chưa lưu giờ bắt đầu và kết thúc, nên màn hình này tổng hợp theo ngày thay vì dựng dòng thời gian trong ngày."
        minHeight={300}
      >
        <DailyEffortChart data={dailySeries} />
      </ChartCard>

      <SectionCard
        id="dts-grid"
        title={`Lịch ghi nhận tháng — ${monthLabel}`}
        description="Ô đỏ là ngày công chưa có giờ ghi nhận. Bấm vào ô để xem chi tiết của ngày đó."
      >
        <div className="p-4">
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="pb-1 text-center text-[11px] font-semibold text-muted-foreground">
                {label}
              </div>
            ))}
            {grid.map((cell, index) => {
              if (!cell) return <div key={`pad-${index}`} aria-hidden />;
              const ratio = cell.standardMinutes > 0 ? cell.actualMinutes / cell.standardMinutes : 0;
              const tone = !cell.isWorkingDay
                ? "border-border bg-muted/40 text-muted-foreground"
                : cell.actualMinutes === 0
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : ratio >= 0.9
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-warning/40 bg-warning/10 text-warning";
              return (
                <button
                  key={cell.date}
                  type="button"
                  disabled={cell.entryCount === 0}
                  onClick={() =>
                    setDrawerRequest({
                      title: `Chi tiết ngày ${formatDate(cell.date)}`,
                      description: `${formatHours(cell.actualMinutes)} · ${cell.peopleLogged} nhân sự · ${cell.entryCount} dòng`,
                      logs: logs.filter((log) => log.date === cell.date)
                    })
                  }
                  className={`flex min-h-[62px] flex-col items-start justify-between rounded-lg border p-1.5 text-left transition-colors disabled:cursor-default ${tone} ${cell.entryCount > 0 ? "hover:brightness-95" : ""}`}
                >
                  <span className="text-[11px] font-bold">{Number(cell.date.slice(8, 10))}</span>
                  <span className="font-mono text-[11.5px] font-semibold">
                    {cell.isWorkingDay ? formatHours(cell.actualMinutes, "0h") : "—"}
                  </span>
                  {cell.isWorkingDay && cell.peopleLogged > 0 ? (
                    <span className="text-[9.5px] opacity-80">{cell.peopleLogged} người</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <PersonDayLoad dataset={dataset} filters={filters} logs={logs} onOpenLogs={setDrawerRequest} />

      <ChartCard
        title="Tổng hợp theo tuần"
        description="Giờ thực tế mỗi tuần và tỷ lệ so với giờ tiêu chuẩn."
        minHeight={300}
      >
        {weeklySeries.length === 0 ? <EmptyState message="Không có tuần nào trong phạm vi." /> : <WeeklyComplianceChart data={weeklySeries} />}
      </ChartCard>

      {/* ── Resource matching: planned vs actual effort per task, by week ── */}
      <ChartCard
        title="Giờ kế hoạch và giờ thực tế trên mỗi công việc"
        description="Hai đường cùng mẫu số — các công việc được làm trong tuần và có nhập kế hoạch — nên so sánh trực tiếp được."
        footnote="Đường liền là giờ thực tế đã ghi nhận; đường đứt là giờ kế hoạch. Cột nền thể hiện số công việc trong từng tuần."
        minHeight={320}
        actions={
          <span className="flex flex-wrap items-center gap-2 text-[11px]">
            <Pill tone={overshootWeeks.length === 0 ? "success" : overshootWeeks.length > 2 ? "danger" : "warning"}>
              {overshootWeeks.length === 0 ? "Bám kế hoạch" : `${overshootWeeks.length} tuần vượt >10%`}
            </Pill>
            <Pill tone={worstCoverage < 80 ? "warning" : "success"}>
              Thấp nhất {formatPercent(worstCoverage)} công việc có kế hoạch
            </Pill>
          </span>
        }
      >
        {effortPerTask.every((point) => point.taskCount === 0) ? (
          <EmptyState message="Chưa có công việc nào vừa được ghi nhận giờ vừa có kế hoạch trong kỳ này." />
        ) : (
          <PlannedVsActualPerTaskChart data={effortPerTask} />
        )}
      </ChartCard>

      <SectionCard
        id="wts-effort-per-task"
        title="Đối chiếu kế hoạch và thực tế theo tuần"
        description="Bảng số liệu đi kèm biểu đồ trên, để đọc chính xác từng tuần."
      >
        {effortPerTask.length === 0 ? (
          <EmptyState message="Không có tuần nào trong phạm vi." />
        ) : (
          <TableScroll>
            <table className="w-full min-w-[820px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
                <col className="w-[18%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>Tuần</Th>
                  <Th align="right">Số công việc</Th>
                  <Th align="right">Kế hoạch / việc</Th>
                  <Th align="right">Thực tế / việc</Th>
                  <Th align="right">Mức khớp</Th>
                  <Th align="right">Việc có kế hoạch</Th>
                </tr>
              </thead>
              <tbody>
                {effortPerTask.map((point) => {
                  const match = point.matchPercent;
                  const tone = match === null ? "neutral" : match > 110 ? "danger" : match >= 90 ? "success" : "warning";
                  return (
                    <tr key={point.weekKey} className="border-b border-border transition-colors hover:bg-muted/30">
                      <Td>
                        <span className="block font-semibold">{point.label}</span>
                        <span className="block text-[10.5px] tabular-nums text-muted-foreground">từ {formatDate(point.startDate)}</span>
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">
                        {point.taskCount}
                        {point.excludedTaskCount > 0 ? (
                          <span className="text-warning" title={`${point.excludedTaskCount} công việc bị loại vì chưa nhập kế hoạch`}>
                            {" "}(−{point.excludedTaskCount})
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">{formatHours(point.plannedMinutesPerTask)}</Td>
                      <Td align="right" className="font-mono font-semibold tabular-nums">{formatHours(point.actualMinutesPerTask)}</Td>
                      <Td align="right">
                        {match === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <BarValue percent={Math.min(match, 200) / 2} value={formatPercent(match)} tone={tone} />
                        )}
                      </Td>
                      <Td align="right">
                        <span className={`font-mono tabular-nums ${point.estimateCoveragePercent < 80 ? "font-semibold text-warning" : "text-muted-foreground"}`}>
                          {formatPercent(point.estimateCoveragePercent)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </SectionCard>

      <SectionCard
        id="wts-matrix"
        title="Tỷ lệ ghi nhận theo tuần của từng nhân sự"
        description="Mỗi ô là giờ thực tế của tuần đó, thanh màu thể hiện tỷ lệ so với giờ tiêu chuẩn."
      >
        {weeklyMatrix.length === 0 ? (
          <EmptyState message="Không có nhân sự nào khớp bộ lọc." />
        ) : (
          <TableScroll>
            <table className="w-full min-w-[820px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[22%]" />
                {weeklySeries.map((week) => (
                  <col key={week.weekKey} style={{ width: `${64 / Math.max(1, weeklySeries.length)}%` }} />
                ))}
                <col className="w-[14%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>Nhân sự</Th>
                  {weeklySeries.map((week) => (
                    <Th key={week.weekKey} align="center">
                      {week.label}
                      <span className="block text-[10px] font-normal normal-case text-muted-foreground">
                        từ {formatDate(week.startDate).slice(0, 5)}
                      </span>
                    </Th>
                  ))}
                  <Th align="right">Tổng</Th>
                </tr>
              </thead>
              <tbody>
                {pagedMatrix.items.map((row) => (
                  <tr key={row.person.id} className="border-b border-border transition-colors hover:bg-muted/30">
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar initials={row.person.initials} name={row.person.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{row.person.name}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{row.person.teamName}</span>
                        </span>
                      </span>
                    </Td>
                    {row.cells.map((cell) => (
                      <Td key={cell.weekKey} align="center">
                        <span className="flex flex-col items-center gap-1">
                          <span className={`font-mono text-[12px] font-semibold tabular-nums ${cell.percent >= 90 ? "text-success" : cell.percent >= 70 ? "text-warning" : cell.minutes === 0 ? "text-muted-foreground" : "text-destructive"}`}>
                            {cell.minutes > 0 ? formatHours(cell.minutes) : "—"}
                          </span>
                          <MiniBar percent={cell.percent} width="w-14" tone={cell.percent >= 90 ? "success" : cell.percent >= 70 ? "warning" : "danger"} />
                        </span>
                      </Td>
                    ))}
                    <Td align="right" className="font-mono font-bold tabular-nums">
                      {formatHours(sum(row.cells.map((cell) => cell.minutes)))}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/40">
                <tr>
                  <Td className="font-bold">Tổng theo tuần</Td>
                  {weeklySeries.map((week) => (
                    <Td key={week.weekKey} align="center" className="font-mono font-bold tabular-nums">
                      <span className="block">{formatHours(week.actualMinutes)}</span>
                      <Pill tone={week.compliancePercent >= 90 ? "success" : week.compliancePercent >= 70 ? "warning" : "danger"}>
                        {formatPercent(week.compliancePercent)}
                      </Pill>
                    </Td>
                  ))}
                  <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(totals.actual)}</Td>
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
        <Pagination state={pagedMatrix} unit="nhân sự" />
      </SectionCard>

      <SectionCard
        id="dts-days"
        title="Chi tiết từng ngày"
        description="Mỗi ngày công với số dòng ghi nhận, số người và tỷ lệ so với giờ tiêu chuẩn."
      >
        <TableScroll>
          <table className="w-full min-w-[760px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <Th>Ngày</Th>
                <Th align="center">Loại ngày</Th>
                <Th align="right">Giờ thực tế</Th>
                <Th align="right">Giờ chuẩn</Th>
                <Th align="right">% đạt</Th>
                <Th align="right">Số người</Th>
                <Th align="right">Số dòng</Th>
                <Th align="center">Chi tiết</Th>
              </tr>
            </thead>
            <tbody>
              {pagedDays.items.map((day) => {
                const percent = day.standardMinutes > 0 ? (day.actualMinutes / day.standardMinutes) * 100 : 0;
                return (
                  <tr key={day.date} className="border-b border-border transition-colors hover:bg-muted/30">
                    <Td className="whitespace-nowrap font-mono tabular-nums">{formatDate(day.date)}</Td>
                    <Td align="center">
                      <Pill tone={day.isWorkingDay ? "info" : "neutral"}>{day.isWorkingDay ? "Ngày công" : "Nghỉ"}</Pill>
                    </Td>
                    <Td align="right" className="font-mono font-semibold tabular-nums">{formatHours(day.actualMinutes, "0h")}</Td>
                    <Td align="right" className="font-mono tabular-nums text-muted-foreground">{day.isWorkingDay ? formatHours(day.standardMinutes) : "—"}</Td>
                    <Td align="right">
                      {day.isWorkingDay ? (
                        <BarValue percent={percent} value={formatPercent(percent)} tone={percent >= 90 ? "success" : percent >= 70 ? "warning" : "danger"} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td align="right" className="font-mono tabular-nums text-muted-foreground">{day.peopleLogged}</Td>
                    <Td align="right" className="font-mono tabular-nums text-muted-foreground">{day.entryCount}</Td>
                    <Td align="center">
                      {day.entryCount > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDrawerRequest({
                              title: `Chi tiết ngày ${formatDate(day.date)}`,
                              description: `${formatHours(day.actualMinutes)} · ${day.peopleLogged} nhân sự`,
                              logs: logs.filter((log) => log.date === day.date)
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <FileSearch className="h-3 w-3" aria-hidden /> Xem
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
        <Pagination state={pagedDays} unit="ngày" />
      </SectionCard>

      <LogDrawer dataset={dataset} request={drawerRequest} onClose={() => setDrawerRequest(null)} />
    </div>
  );
}

/** Pads the month into Monday-first calendar rows. `null` = leading blank cell. */
function buildMonthGrid<T extends { date: string }>(month: string, days: T[]): Array<T | null> {
  const { start } = monthBounds(month);
  const firstWeekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const { end } = monthBounds(month);
  const cells: Array<T | null> = Array.from({ length: firstWeekday }, () => null);

  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    cells.push(byDate.get(iso) ?? null);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
}
