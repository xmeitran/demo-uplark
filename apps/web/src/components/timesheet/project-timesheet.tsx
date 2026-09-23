"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, AlertTriangle, Check, ChevronDown, ChevronRight, FileSearch, X } from "lucide-react";
import {
  buildControlChart,
  buildCumulativeFlow,
  CONTROL_CHART_MIN_SAMPLE,
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
  PROJECT_STATUS_LABELS,
  WORK_GROUP_LABELS,
  type MemberState,
  type NodeStatus,
  type ProjectStatus,
  type TimeLog,
  type TimesheetDataset
} from "./timesheet-types";
import {
  Avatar,
  BarValue,
  ChartCard,
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
const EstimateVsActualChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.EstimateVsActualChart })), { ssr: false, loading: chartFallback });
const ConsumptionChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.ConsumptionChart })), { ssr: false, loading: chartFallback });
const ReadinessChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.ReadinessChart })), { ssr: false, loading: chartFallback });
const CumulativeFlowChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.CumulativeFlowChart })), { ssr: false, loading: chartFallback });
const CycleTimeControlChart = dynamic(() => import("./timesheet-charts").then((m) => ({ default: m.CycleTimeControlChart })), { ssr: false, loading: chartFallback });

const PROJECT_PAGE_SIZE = 8;
const MILESTONE_PAGE_SIZE = 3;
const MEMBER_PAGE_SIZE = 8;
// 3 keeps the checklist card close in height to the readiness chart beside it;
// a taller neighbour stretches the chart and spreads its bars uncomfortably thin.
const READINESS_PAGE_SIZE = 3;

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
  logs
}: {
  dataset: TimesheetDataset;
  filters: TimesheetFilters;
  logs: TimeLog[];
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [drawerRequest, setDrawerRequest] = useState<LogDrawerRequest | null>(null);

  const today = dataset.generatedAt;
  const allSummaries = useMemo(() => buildProjectSummaries(dataset, logs, today), [dataset, logs, today]);
  const summaries = useMemo(
    () => (filters.projectId === "all" ? allSummaries : allSummaries.filter((row) => row.project.id === filters.projectId)),
    [allSummaries, filters.projectId]
  );
  const withEffort = useMemo(() => summaries.filter((row) => row.actualMinutes > 0 || row.estimateMinutes > 0), [summaries]);
  const readiness = useMemo(
    () => buildProjectReadiness(dataset, logs, today).filter((row) => filters.projectId === "all" || row.project.id === filters.projectId),
    [dataset, logs, today, filters.projectId]
  );

  // Keep a project selected so the breakdown and member tables always have
  // something to show.
  useEffect(() => {
    if (summaries.length === 0) {
      setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId || !summaries.some((row) => row.project.id === selectedProjectId)) {
      setSelectedProjectId(summaries[0].project.id);
    }
  }, [summaries, selectedProjectId]);

  const selected = summaries.find((row) => row.project.id === selectedProjectId) ?? null;
  const monthLabel = formatMonth(filters.month);

  const totals = useMemo(() => {
    const estimate = sum(summaries.map((row) => row.estimateMinutes));
    const actual = sum(summaries.map((row) => row.actualMinutes));
    return {
      estimate,
      actual,
      consumption: estimate > 0 ? (actual / estimate) * 100 : 0,
      overCount: summaries.filter((row) => row.risk === "over").length,
      watchCount: summaries.filter((row) => row.risk === "watch").length,
      overdueTasks: sum(summaries.map((row) => row.overdueTaskCount)),
      blockedTasks: sum(summaries.map((row) => row.blockedTaskCount)),
      lowReadiness: readiness.filter((row) => row.score < 70).length
    };
  }, [summaries, readiness]);
  const hasPlanData = totals.estimate > 0;

  const totalTasks = useMemo(() => sum(summaries.map((row) => row.taskCount)), [summaries]);
  const totalEstimateCoverage = useMemo(() => {
    if (totalTasks === 0) return 0;
    const covered = sum(summaries.map((row) => (row.estimateCoveragePercent / 100) * row.taskCount));
    return (covered / totalTasks) * 100;
  }, [summaries, totalTasks]);
  const totalActiveMembers = useMemo(() => sum(summaries.map((row) => row.activeMemberCount)), [summaries]);

  const flow = useMemo(() => buildCumulativeFlow(dataset, filters), [dataset, filters]);
  const control = useMemo(() => buildControlChart(dataset, filters), [dataset, filters]);

  const pagedProjects = usePagination(summaries, PROJECT_PAGE_SIZE);
  const pagedReadiness = usePagination(readiness, READINESS_PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* ── Headline totals ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Giờ kế hoạch đã nhập"
          value={hasPlanData ? formatHours(totals.estimate) : "—"}
          badge={hasPlanData ? `${summaries.length} dự án` : "Chưa có dữ liệu"}
          tone={hasPlanData ? "neutral" : "warning"}
          hint={hasPlanData ? "Cộng dồn từ kế hoạch của từng công việc" : "Task estimate chưa được đồng bộ"}
        />
        <KpiCard
          label={`Giờ thực tế — ${monthLabel}`}
          value={formatHours(totals.actual)}
          badge={hasPlanData ? formatPercent(totals.consumption) : "Chưa đối chiếu"}
          tone={!hasPlanData ? "neutral" : totals.consumption > 100 ? "danger" : totals.consumption > 85 ? "warning" : "info"}
          hint={hasPlanData ? "Đã dùng so với kế hoạch" : "Chỉ hiển thị giờ đã ghi nhận"}
        />
        <KpiCard
          label="Dự án vượt / sát ngưỡng giờ"
          value={hasPlanData ? `${totals.overCount} / ${totals.watchCount}` : "—"}
          badge={!hasPlanData ? "Chưa có kế hoạch" : totals.overCount > 0 ? "Có dự án vượt" : "Trong ngưỡng"}
          tone={!hasPlanData ? "neutral" : totals.overCount > 0 ? "danger" : "success"}
          hint={hasPlanData ? "Vượt 100% / trên 85% kế hoạch" : "Cần estimate để tính ngưỡng"}
        />
        <KpiCard
          label="Công việc quá hạn / đang chặn"
          value={`${totals.overdueTasks} / ${totals.blockedTasks}`}
          badge={`${totals.lowReadiness} dự án dữ liệu yếu`}
          tone={totals.lowReadiness > 0 ? "warning" : "success"}
          hint="Dự án có điểm sẵn sàng dưới 70%"
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
            <table className="w-full min-w-[1180px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>Dự án</Th>
                  <Th align="center">Trạng thái</Th>
                  <Th align="right">Milestone</Th>
                  <Th align="right">Kế hoạch</Th>
                  <Th align="right">Thực tế</Th>
                  <Th align="right">Chênh lệch</Th>
                  <Th align="right">Đã dùng</Th>
                  <Th align="right">Có kế hoạch</Th>
                  <Th align="right">Nhân sự</Th>
                  <Th>Hạn hoàn thành</Th>
                  <Th align="center">Chi tiết</Th>
                </tr>
              </thead>
              <tbody>
                {pagedProjects.items.map((row) => {
                  const active = row.project.id === selectedProjectId;
                  return (
                    <React.Fragment key={row.project.id}>
                    <tr
                      className={`cursor-pointer border-b border-border transition-colors hover:bg-muted/30 ${active ? "bg-primary/5" : ""}`}
                      onClick={() => setSelectedProjectId(row.project.id)}
                    >
                      <Td>
                        <span className="flex min-w-0 items-center gap-2">
                          {active ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: WORK_GROUP_COLORS[row.project.workGroup] }} aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold" title={`${row.project.code} — ${row.project.name}`}>
                              {row.project.code} — {row.project.name}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {row.project.accountName} · {WORK_GROUP_LABELS[row.project.workGroup]}
                            </span>
                          </span>
                        </span>
                      </Td>
                      <Td align="center">
                        <Pill tone={projectStatusTone(row.project.status)}>{PROJECT_STATUS_LABELS[row.project.status as ProjectStatus]}</Pill>
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">{row.milestoneCount}</Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">{hasPlanData ? formatHours(row.estimateMinutes) : <span title="Task estimate chưa được đồng bộ">—</span>}</Td>
                      <Td align="right" className="font-mono font-semibold tabular-nums">{formatHours(row.actualMinutes)}</Td>
                      <Td align="right" className={`font-mono tabular-nums ${hasPlanData && row.varianceMinutes > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {hasPlanData ? formatSignedHours(row.varianceMinutes) : <span title="Chưa có estimate để tính chênh lệch">—</span>}
                      </Td>
                      <Td align="right">
                        {hasPlanData ? <BarValue percent={row.consumptionPercent} value={formatPercent(row.consumptionPercent)} tone={riskTone(row.risk)} /> : <span title="Chưa có estimate để tính mức sử dụng">—</span>}
                      </Td>
                      <Td align="right">
                        <span className={`font-mono tabular-nums ${row.estimateCoveragePercent < 80 ? "font-semibold text-warning" : "text-muted-foreground"}`}>
                          {hasPlanData ? formatPercent(row.estimateCoveragePercent) : <span title="Task estimate chưa được đồng bộ">—</span>}
                        </span>
                      </Td>
                      <Td align="right" className="font-mono tabular-nums text-muted-foreground">
                        <span title={`${row.activeMemberCount} đang tham gia${row.onHoldMemberCount > 0 ? `, ${row.onHoldMemberCount} tạm dừng` : ""}`}>
                          {row.activeMemberCount}
                          {row.onHoldMemberCount > 0 ? <span className="text-warning"> +{row.onHoldMemberCount}</span> : null}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {row.deadline ? formatDate(row.deadline) : <span className="text-warning">Chưa đặt</span>}
                      </Td>
                      <Td align="center">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedProjectId(row.project.id);
                            setDrawerRequest({
                              title: `Chi tiết giờ — ${row.project.code}`,
                              description: `${row.project.name} · ${monthLabel}`,
                              logs: logs.filter((log) => log.projectId === row.project.id)
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <FileSearch className="h-3 w-3" aria-hidden /> Xem
                        </button>
                      </Td>
                    </tr>
                    {active ? (
                      <tr className="border-b border-primary/20 bg-primary/[0.025]">
                        <td colSpan={11} className="p-0">
                          <div className="border-y border-primary/15 px-3 py-3 sm:px-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-[12.5px] font-bold text-foreground">Chi tiết milestone, giai đoạn và công việc</p>
                                <p className="text-[11px] text-muted-foreground">{row.project.code} · {row.project.name} · Bấm mũi tên để thu gọn từng cấp</p>
                              </div>
                              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">Đang mở</span>
                            </div>
                            <ProjectBreakdownTable dataset={dataset} projectId={row.project.id} logs={logs} />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/40">
                <tr>
                  <Td className="font-bold">Tổng cộng {summaries.length} dự án</Td>
                  <Td />
                  <Td align="right" className="font-mono font-bold tabular-nums">{sum(summaries.map((row) => row.milestoneCount))}</Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{hasPlanData ? formatHours(totals.estimate) : "—"}</Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(totals.actual)}</Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{hasPlanData ? formatSignedHours(totals.actual - totals.estimate) : "—"}</Td>
                  <Td align="right">
                    {hasPlanData ? <BarValue
                      percent={totals.consumption}
                      value={formatPercent(totals.consumption)}
                      tone={totals.consumption > 100 ? "danger" : totals.consumption > 85 ? "warning" : "success"}
                    /> : "—"}
                  </Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{hasPlanData ? formatPercent(totalEstimateCoverage) : "—"}</Td>
                  <Td align="right" className="font-mono font-bold tabular-nums">{totalActiveMembers}</Td>
                  <Td />
                  <Td />
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
        <Pagination state={pagedProjects} unit="dự án" />
      </SectionCard>

      {/* ── Planned vs actual ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard
          title="Giờ kế hoạch so với giờ thực tế"
          description={hasPlanData ? "Cột đỏ là dự án có giờ thực tế đã vượt kế hoạch." : "Chưa có task estimate; biểu đồ chỉ hiển thị giờ thực tế đã ghi nhận."}
          minHeight={320}
        >
          {withEffort.length === 0 ? <EmptyState message="Không có dự án nào có kế hoạch hoặc giờ ghi nhận." /> : <EstimateVsActualChart data={withEffort} />}
        </ChartCard>
        <ChartCard
          title="Tỷ lệ giờ đã dùng"
          description="Đường đứt là ngưỡng 100% giờ kế hoạch."
          minHeight={Math.max(280, withEffort.length * 32 + 60)}
        >
          {withEffort.length === 0 ? <EmptyState message="Không có dữ liệu." /> : <ConsumptionChart data={withEffort} />}
        </ChartCard>
      </div>

      {/* ── Members for the selected project ────────────────────────────── */}
      {selected ? (
        <>
          <SectionCard
            id="pts-members"
            title={`Nhân sự tham gia — ${selected.project.code}`}
            description="Trạng thái tham gia, công việc đang mở và giờ ghi nhận trong kỳ."
          >
            <ProjectMemberTable dataset={dataset} projectId={selected.project.id} logs={logs} onOpenLogs={setDrawerRequest} />
          </SectionCard>
        </>
      ) : null}

      {/* ── Flow: cumulative flow + cycle-time control chart ───────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Công việc đang làm dở (WIP)"
          value={`${Math.round(flow.averageWip)}`}
          badge={`Cao nhất ${flow.peakBlocked} việc bị chặn`}
          tone={flow.peakBlocked > 0 ? "warning" : "success"}
          hint="Trung bình trong kỳ"
        />
        <KpiCard
          label="Việc hoàn thành trong kỳ"
          value={`${flow.throughput}`}
          badge={`${Math.round(flow.throughputPerWeek * 10) / 10} việc/tuần`}
          tone="info"
          hint="Tốc độ hoàn thành"
        />
        <KpiCard
          label="Thời gian hoàn thành trung bình"
          value={control.points.length > 0 ? `${control.mean} ngày` : "—"}
          badge={control.points.length > 0 ? `Trung vị ${control.median} ngày` : "Chưa có việc hoàn thành"}
          tone="neutral"
          hint={`Độ lệch chuẩn ${control.standardDeviation} ngày`}
        />
        <KpiCard
          label="Việc vượt giới hạn kiểm soát"
          value={`${control.outliers}`}
          badge={control.outliers === 0 ? "Quy trình ổn định" : "Cần xem lại"}
          tone={control.outliers === 0 ? "success" : "warning"}
          hint={control.points.length > 0 ? `Ngưỡng ${control.upperLimit} ngày` : undefined}
        />
      </div>

      <ChartCard
        title="Dòng chảy công việc tích luỹ"
        description="Số công việc nằm ở mỗi trạng thái theo từng ngày."
        footnote={
          "Tổng chiều cao là toàn bộ công việc đã tạo tính đến ngày đó. Độ dày mỗi dải là lượng việc đang nằm ở trạng thái ấy; "
          + "độ dốc của dải “Hoàn thành” là tốc độ hoàn thành. Dải nào dày mãi không mỏng đi thì đó là nút thắt. "
          + `Trong kỳ có ${flow.blockedGrowthDays} ngày lượng việc bị chặn tăng lên.`
        }
        minHeight={320}
      >
        {flow.points.length === 0 ? (
          <EmptyState message="Chưa có lịch sử chuyển trạng thái trong kỳ này." />
        ) : (
          <CumulativeFlowChart data={flow.points} />
        )}
      </ChartCard>

      <ChartCard
        title="Thời gian hoàn thành mỗi công việc"
        description="Mỗi chấm là một công việc đã xong: trục ngang là ngày hoàn thành, trục dọc là số ngày làm."
        footnote={
          "Tính từ lúc việc chuyển sang “Đang làm” đến lúc “Hoàn thành” — thời gian nằm chờ trong backlog không được tính vào, "
          + "vì gộp hai loại lại sẽ làm quy trình trông đẹp hơn thực tế. Chấm đỏ là việc vượt giới hạn trên (trung bình + 2 độ lệch chuẩn) — "
          + "đó mới là những việc đáng mổ xẻ, không phải con số trung bình. Chấm bám sát nhau và nằm dưới ngưỡng nghĩa là quy trình đủ ổn định để dự báo. "
          + (control.sampleAdequate
            ? ""
            : `Kỳ này mới có ${control.points.length} việc hoàn thành — cần khoảng ${CONTROL_CHART_MIN_SAMPLE} việc trở lên thì giới hạn kiểm soát mới đủ tin cậy để ra quyết định.`)
        }
        minHeight={320}
        actions={
          <span className="flex flex-wrap items-center gap-2 text-[11px]">
            <Pill tone={control.outliers === 0 ? "success" : control.outliers > 3 ? "danger" : "warning"}>
              {control.points.length} việc hoàn thành · {control.outliers} vượt ngưỡng
            </Pill>
            {control.points.length > 0 && !control.sampleAdequate ? (
              <Pill tone="warning">Mẫu nhỏ — giới hạn chỉ mang tính tham khảo</Pill>
            ) : null}
          </span>
        }
      >
        {control.points.length === 0 ? (
          <EmptyState message="Chưa có công việc nào hoàn thành trong kỳ này." />
        ) : (
          <CycleTimeControlChart data={control.points} mean={control.mean} upperLimit={control.upperLimit} startDate={control.days[0] ?? filters.month + "-01"} />
        )}
      </ChartCard>

      {/* ── Data readiness ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard
          title="Điểm sẵn sàng dữ liệu theo dự án"
          description="Điểm càng thấp thì số liệu chấm công của dự án đó càng kém tin cậy."
          minHeight={Math.max(280, readiness.length * 32 + 60)}
        >
          {readiness.length === 0 ? (
            <EmptyState message="Không có dự án nào." />
          ) : (
            <ReadinessChart data={readiness.map((row) => ({ code: row.project.code, name: row.project.name, score: row.score }))} />
          )}
        </ChartCard>

        <SectionCard
          id="pts-readiness"
          title="Checklist dữ liệu thiếu"
          description="Những thông tin còn thiếu khiến số liệu chấm công chưa phản ánh đúng."
        >
          {readiness.length === 0 ? (
            <EmptyState message="Không có dự án nào." />
          ) : (
            <div className="space-y-3 p-4">
              {pagedReadiness.items.map((row) => (
                <div key={row.project.id} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-bold text-foreground">
                      {row.project.code} — {row.project.name}
                    </span>
                    <Pill tone={row.score >= 80 ? "success" : row.score >= 55 ? "warning" : "danger"}>{row.score}% sẵn sàng</Pill>
                  </div>
                  <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {row.checks.map((check) => (
                      <li key={check.key} className="flex items-start gap-1.5 text-[11.5px]">
                        {check.passed ? (
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" aria-hidden />
                        ) : (
                          <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" aria-hidden />
                        )}
                        <span className={check.passed ? "text-muted-foreground" : "text-foreground"}>
                          {check.label} <span className="text-muted-foreground">({check.detail})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <Pagination state={pagedReadiness} unit="dự án" />
        </SectionCard>
      </div>

      <LogDrawer dataset={dataset} request={drawerRequest} onClose={() => setDrawerRequest(null)} />
    </div>
  );
}

/* ── Milestone → giai đoạn → công việc breakdown ─────────────────────────── */

function ProjectBreakdownTable({
  dataset,
  projectId,
  logs
}: {
  dataset: TimesheetDataset;
  projectId: string;
  logs: TimeLog[];
}) {
  const project = dataset.projects.find((item) => item.id === projectId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes = useMemo(
    () => (project ? buildProjectBreakdown(project, logs, dataset.people) : []),
    [project, logs, dataset.people]
  );

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

  return (
    <>
    <TableScroll>
      <table className="w-full min-w-[960px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[31%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
          <col className="w-[20%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <Th>Milestone / Giai đoạn / Công việc</Th>
            <Th>Phụ trách</Th>
            <Th align="center">Trạng thái</Th>
            <Th>Thời gian</Th>
            <Th align="right">Kế hoạch</Th>
            <Th align="right">Thực tế</Th>
            <Th align="right">Chênh lệch</Th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((milestone) => (
            <React.Fragment key={milestone.id}>
              <BreakdownRow node={milestone} depth={0} collapsed={collapsed.has(milestone.id)} onToggle={toggle} />
              {!collapsed.has(milestone.id)
                ? milestone.children?.map((stage) => (
                    <React.Fragment key={stage.id}>
                      <BreakdownRow node={stage} depth={1} collapsed={collapsed.has(stage.id)} onToggle={toggle} />
                      {!collapsed.has(stage.id)
                        ? stage.children?.map((task) => <BreakdownRow key={task.id} node={task} depth={2} collapsed={false} onToggle={toggle} />)
                        : null}
                    </React.Fragment>
                  ))
                : null}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/40">
          <tr>
            <Td className="font-bold">Tổng toàn dự án ({nodes.length} milestone)</Td>
            <Td />
            <Td />
            <Td />
            <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(sum(nodes.map((node) => node.estimateMinutes)))}</Td>
            <Td align="right" className="font-mono font-bold tabular-nums">{formatHours(sum(nodes.map((node) => node.actualMinutes)))}</Td>
            <Td align="right" className="font-mono font-bold tabular-nums">
              {formatSignedHours(sum(nodes.map((node) => node.actualMinutes)) - sum(nodes.map((node) => node.estimateMinutes)))}
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
  onToggle
}: {
  node: ProjectBreakdownNode;
  depth: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const overrun = node.variancePercent !== null && node.variancePercent > 0;
  const rowClass =
    depth === 0 ? "bg-muted/30 font-bold" : depth === 1 ? "font-semibold" : "";

  return (
    <tr className={`border-b border-border ${rowClass}`}>
      <Td className={depth === 1 ? "pl-6" : depth === 2 ? "pl-12" : ""}>
        <span className="flex min-w-0 items-center gap-1.5">
          {hasChildren ? (
            <button type="button" onClick={() => onToggle(node.id)} aria-expanded={!collapsed} aria-label={collapsed ? "Mở rộng" : "Thu gọn"} className="shrink-0 text-muted-foreground">
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate" title={node.name}>
            {depth === 0 ? "◆ " : depth === 1 ? "▸ " : ""}
            {node.name}
          </span>
        </span>
      </Td>
      <Td className="truncate text-muted-foreground">
        {node.ownerName ?? <span className="text-warning">Chưa gán</span>}
      </Td>
      <Td align="center">
        <Pill tone={nodeStatusTone(node.status)}>{NODE_STATUS_LABELS[node.status as NodeStatus] ?? node.status}</Pill>
      </Td>
      <Td className="text-[11.5px] leading-snug text-muted-foreground">
        {node.startDate || node.dueDate ? <>{formatDate(node.startDate, "—")} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {formatDate(node.dueDate, "—")}</> : "—"}
      </Td>
      <Td align="right" className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">
        {node.estimateMinutes > 0 ? formatHours(node.estimateMinutes) : <span className="text-warning">Chưa có</span>}
      </Td>
      <Td align="right" className="whitespace-nowrap font-mono tabular-nums">{formatHours(node.actualMinutes)}</Td>
      <Td align="right" className={`whitespace-nowrap font-mono tabular-nums ${overrun ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
        {node.variancePercent === null ? "—" : formatSignedPercent(node.variancePercent)}
      </Td>
    </tr>
  );
}

/* ── Members of the selected project ─────────────────────────────────────── */

function ProjectMemberTable({
  dataset,
  projectId,
  logs,
  onOpenLogs
}: {
  dataset: TimesheetDataset;
  projectId: string;
  logs: TimeLog[];
  onOpenLogs: (request: LogDrawerRequest) => void;
}) {
  const project = dataset.projects.find((item) => item.id === projectId);
  const rows = useMemo(
    () => (project ? buildProjectMemberRows(project, dataset, logs) : []),
    [project, dataset, logs]
  );

  const paged = usePagination(rows, MEMBER_PAGE_SIZE);

  if (!project || rows.length === 0) {
    return <EmptyState message="Dự án này chưa có thành viên nào." />;
  }

  return (
    <>
    <TableScroll>
      <table className="w-full min-w-[860px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[15%]" />
          <col className="w-[14%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <Th>Nhân sự</Th>
            <Th>Vai trò</Th>
            <Th align="center">Trạng thái tham gia</Th>
            <Th>Tham gia từ</Th>
            <Th align="right">Việc đang mở</Th>
            <Th align="right">Giờ trong kỳ</Th>
            <Th>Ghi nhận gần nhất</Th>
            <Th align="center">Chi tiết</Th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((row) => (
            <tr key={row.person.id} className="border-b border-border transition-colors hover:bg-muted/30">
              <Td>
                <span className="flex items-center gap-2">
                  <Avatar initials={row.person.initials} name={row.person.name} />
                  <span className="font-semibold">{row.person.name}</span>
                </span>
              </Td>
              <Td className="text-muted-foreground">{row.role}</Td>
              <Td align="center">
                <Pill tone={row.state === "active" ? "success" : row.state === "on_hold" ? "warning" : "neutral"}>
                  {MEMBER_STATE_LABELS[row.state as MemberState] ?? row.state}
                </Pill>
              </Td>
              <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(row.joinedAt)}</Td>
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
