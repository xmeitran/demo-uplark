"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import type { PnlMonthMissing, PnlProjectMonthDetail, PnlProjectMonthDetailResponse, PnlProjectResponse } from "@b2b-crm/contracts";
import { formatExactVnd, formatHoursValue, formatMillions, formatMonth, formatDong } from "./pnl-format";
import { fixTargetHref } from "./pnl-query";
import {
  PnlLoadError, Segmented, cardClass, mutedNoteClass, okTextClass, sectionTitleClass, tdClass, tdNumberClass, thClass, thNumberClass, usePnlLoad, warnTextClass
} from "./pnl-ui";

type Months = PnlProjectResponse["data"]["months"];
type DetailView = "people" | "tasks";

const DETAIL_VIEWS = [
  { value: "people", label: "Người × ngày" },
  { value: "tasks", label: "Theo task" }
] as const;

function Hours({ minutes, bold = false, title }: Readonly<{ minutes: number | null; bold?: boolean; title?: string }>) {
  return <td title={title} className={`${tdNumberClass} ${bold ? "font-bold" : ""}`}>{formatHoursValue(minutes)}</td>;
}

/** Two decimals of "triệu đồng" as drawn ("22,60"); the exact đồng is in the tooltip. */
function Money({ amount, bold = false }: Readonly<{ amount: number | null; bold?: boolean }>) {
  return <td title={formatExactVnd(amount)} className={`${tdNumberClass} ${bold ? "font-bold" : ""}`}>{formatMillions(amount, "table")}</td>;
}

function missingHref(projectId: string, missing: PnlMonthMissing) {
  return fixTargetHref(missing.target, {
    projectId,
    periodKey: missing.periodKey,
    group: missing.kind
  });
}

function reasonsTitle(reasons: Array<{ label: string; minutes: number }>) {
  return reasons.length ? reasons.map((reason) => `${reason.label}: ${formatHoursValue(reason.minutes)} giờ`).join(" · ") : undefined;
}

/** Bảng người × ngày của một tháng: ngày lễ tô xám, ngày nghỉ cá nhân có đánh dấu. */
function PeopleByDay({ detail, moneyVisible }: Readonly<{ detail: PnlProjectMonthDetail; moneyVisible: boolean }>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-muted/30">
            <th scope="col" className={`${thClass} sticky left-0 z-10 bg-muted`}>Nhân sự</th>
            {moneyVisible ? <th scope="col" className={thNumberClass}>Cost rate</th> : null}
            {detail.days.map((day) => (
              <th
                key={day.dateKey}
                scope="col"
                title={day.holiday ? `Ngày lễ${day.holidayName ? `: ${day.holidayName}` : ""}` : day.weekend ? "Cuối tuần" : undefined}
                className={`border-b border-border px-1 py-3 text-center text-[10px] font-bold text-muted-foreground ${day.holiday ? "bg-muted" : day.weekend ? "bg-muted/50" : ""}`}
              >
                {day.dateKey.slice(8, 10)}
              </th>
            ))}
            <th scope="col" className={thNumberClass}>Đã ghi</th>
            <th scope="col" className={thNumberClass}>Tính P&amp;L</th>
            {moneyVisible ? <th scope="col" className={thNumberClass}>Chi phí</th> : null}
            <th scope="col" className={thClass}>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {detail.people.map((person) => {
            const byDay = new Map(person.byDay.map((day) => [day.dateKey, day]));
            return (
              <tr key={person.userId}>
                <th scope="row" className={`${tdClass} sticky left-0 z-10 whitespace-nowrap bg-card text-left font-semibold`}>
                  {person.displayName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{person.roleGroupLabel}</span>
                </th>
                {moneyVisible ? <td title="đồng mỗi giờ" className={tdNumberClass}>{formatDong(person.hourlyCostRate)}</td> : null}
                {detail.days.map((day) => {
                  const cell = byDay.get(day.dateKey);
                  const onLeave = person.leaveDays.includes(day.dateKey);
                  const title = [
                    onLeave ? "Nghỉ cá nhân" : null,
                    cell ? `Đã ghi ${formatHoursValue(cell.loggedMinutes)} · tính P&L ${formatHoursValue(cell.includedMinutes)} · chờ ${formatHoursValue(cell.pendingMinutes)} · bị loại ${formatHoursValue(cell.excludedMinutes)}` : null
                  ].filter(Boolean).join(" · ");
                  return (
                    <td
                      key={day.dateKey}
                      title={title || undefined}
                      className={`min-w-8 border-b border-border/70 px-1 py-3 text-center font-mono text-xs tabular-nums ${day.holiday ? "bg-muted" : day.weekend ? "bg-muted/50" : ""} ${cell?.pendingMinutes ? "font-semibold text-amber-700" : "text-foreground"}`}
                    >
                      {cell?.loggedMinutes ? formatHoursValue(cell.loggedMinutes) : null}
                      {onLeave ? <span aria-label="Nghỉ cá nhân" className="block text-[9px] font-bold text-sky-700">N</span> : null}
                    </td>
                  );
                })}
                <Hours minutes={person.loggedMinutes} />
                <Hours minutes={person.includedMinutes} />
                {moneyVisible ? <Money amount={person.laborCostAmount} /> : null}
                <td className={`${tdClass} whitespace-nowrap ${person.status.ok ? okTextClass : warnTextClass}`}>{person.status.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TasksOfMonth({ detail, moneyVisible }: Readonly<{ detail: PnlProjectMonthDetail; moneyVisible: boolean }>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-muted/30">
            <th scope="col" className={thClass}>Task</th>
            <th scope="col" className={thClass}>Hạng mục</th>
            <th scope="col" className={thNumberClass}>Đã ghi</th>
            <th scope="col" className={thNumberClass}>Tính P&amp;L</th>
            <th scope="col" className={thNumberClass}>Chờ</th>
            <th scope="col" className={thNumberClass}>Bị loại</th>
            {moneyVisible ? <th scope="col" className={thNumberClass}>Chi phí</th> : null}
            <th scope="col" className={thClass}>Lý do</th>
          </tr>
        </thead>
        <tbody>
          {detail.tasks.map((task) => (
            <tr key={task.taskId}>
              <td className={tdClass}>
                <Link href={`/tasks/${encodeURIComponent(task.taskId)}`} className="!text-foreground hover:!text-primary">{task.taskTitle}</Link>
              </td>
              <td className={tdClass}>{task.contractItemCode ?? <span className={warnTextClass}>Chưa có hạng mục</span>}</td>
              <Hours minutes={task.loggedMinutes} />
              <Hours minutes={task.includedMinutes} />
              <Hours minutes={task.pendingMinutes} />
              <Hours minutes={task.excludedMinutes} />
              {moneyVisible ? <Money amount={task.laborCostAmount} /> : null}
              <td className={`${tdClass} text-xs text-muted-foreground`}>{task.reasons.map((reason) => reason.label).join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Nội dung mở ra của một tháng: người × ngày hoặc theo task, cuối là đối soát của tháng. */
function MonthDetail({ projectId, periodKey, preloaded, moneyVisible }: Readonly<{
  projectId: string;
  periodKey: string;
  preloaded?: PnlProjectMonthDetail;
  moneyVisible: boolean;
}>) {
  const [view, setView] = useState<DetailView>("people");
  const url = `/api/pnl/projects/${encodeURIComponent(projectId)}/months/${periodKey}`;
  const { data, error, reload } = usePnlLoad<PnlProjectMonthDetailResponse>(preloaded ? null : url);
  const detail = preloaded ?? data?.data[0];
  if (error) return <PnlLoadError error={error} onRetry={reload} />;
  if (!detail) return <p role="status" className={mutedNoteClass}>Đang tải chi tiết tháng {formatMonth(periodKey)}…</p>;
  const check = detail.reconciliation;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">
          Tháng {formatMonth(periodKey)} · giờ chuẩn {formatHoursValue(detail.standardMinutes)} giờ
        </p>
        <Segmented ariaLabel={`Cách xem tháng ${formatMonth(periodKey)}`} value={view} options={DETAIL_VIEWS} onChange={setView} />
      </div>
      {view === "people" ? <PeopleByDay detail={detail} moneyVisible={moneyVisible} /> : <TasksOfMonth detail={detail} moneyVisible={moneyVisible} />}
      <p className={mutedNoteClass}>
        Đối soát tháng: giờ đã ghi {formatHoursValue(check.loggedMinutes)} = tính P&amp;L {formatHoursValue(check.includedMinutes)} + chờ {formatHoursValue(check.pendingMinutes)} + bị loại {formatHoursValue(check.excludedMinutes)}
        {check.balanced ? " · khớp" : <span className="font-semibold text-rose-700"> · lệch {formatHoursValue(check.differenceMinutes)} giờ</span>}
        {" · "}
        <Link href={fixTargetHref("pending_hours", { projectId, periodKey })} className="font-semibold !text-primary hover:underline">Giờ log nguồn ›</Link>
      </p>
    </div>
  );
}

/** Khối 4 — giờ và chi phí theo tháng; bấm một tháng mở bảng người × ngày. */
export function ProjectMonths({ projectId, months, moneyVisible }: Readonly<{ projectId: string; months: Months; moneyVisible: boolean }>) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const [wantAll, setWantAll] = useState(false);
  const all = usePnlLoad<PnlProjectMonthDetailResponse>(wantAll ? `/api/pnl/projects/${encodeURIComponent(projectId)}/months/all` : null);
  const allDetails = all.data?.data;
  const keys = months.rows.map((row) => row.periodKey);
  const allOpen = keys.length > 0 && keys.every((key) => open.has(key));
  const columnCount = moneyVisible ? 10 : 7;

  // "Mở hết các tháng": the rows open once the one request for every month has answered.
  useEffect(() => {
    if (allDetails) setOpen(new Set(allDetails.map((detail) => detail.periodKey)));
  }, [allDetails]);

  const toggle = (periodKey: string) => setOpen((current) => {
    const next = new Set(current);
    if (!next.delete(periodKey)) next.add(periodKey);
    return next;
  });
  const toggleAll = () => {
    if (allOpen) return setOpen(new Set());
    if (allDetails) return setOpen(new Set(keys));
    setWantAll(true);
  };

  const whole = months.whole;
  const after = months.afterClose;
  return (
    <section aria-labelledby="pnl-months-title" className={cardClass}>
      <h2 id="pnl-months-title" className={`${sectionTitleClass} px-4 pb-3 pt-4`}>Giờ và chi phí theo tháng</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-muted/30">
              <th scope="col" className={thClass}>Tháng</th>
              <th scope="col" className={thClass}>Kỳ</th>
              <th scope="col" className={thNumberClass}>Đã ghi</th>
              <th scope="col" className={thNumberClass}>Tính P&amp;L</th>
              <th scope="col" className={thNumberClass}>Chờ</th>
              <th scope="col" className={thNumberClass}>Bị loại</th>
              {moneyVisible ? <th scope="col" className={thNumberClass}>CP NS</th> : null}
              {moneyVisible ? <th scope="col" className={thNumberClass}>CP khác</th> : null}
              {moneyVisible ? <th scope="col" className={thNumberClass}>Tổng CP</th> : null}
              <th scope="col" className={thClass}>Dữ liệu</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-primary/5">
              <th scope="row" colSpan={2} className={`${tdClass} text-left font-bold`}>Toàn dự án</th>
              <Hours bold minutes={whole.loggedMinutes} />
              <Hours bold minutes={whole.includedMinutes} />
              <Hours bold minutes={whole.pendingMinutes} title={reasonsTitle(whole.pendingByReason)} />
              <Hours bold minutes={whole.excludedMinutes} title={reasonsTitle(whole.excludedByReason)} />
              {moneyVisible ? <Money bold amount={whole.laborCostAmount} /> : null}
              {moneyVisible ? <Money bold amount={whole.otherCostAmount} /> : null}
              {moneyVisible ? <Money bold amount={whole.totalCostAmount} /> : null}
              <td className={`${tdClass} whitespace-nowrap`}>
                {whole.missing.length ? (
                  <button type="button" aria-expanded={missingOpen} aria-controls="pnl-months-missing" onClick={() => setMissingOpen(!missingOpen)} className={`${warnTextClass} hover:underline`}>
                    Thiếu {whole.missing.length} việc ›
                  </button>
                ) : <span className={okTextClass}>Đủ</span>}
              </td>
            </tr>
            {missingOpen && whole.missing.length ? (
              <tr id="pnl-months-missing">
                <td colSpan={columnCount} className="border-b border-border/70 bg-amber-50/60 px-4 py-3">
                  <ul className="space-y-1 text-sm">
                    {whole.missing.map((missing, index) => (
                      <li key={`${missing.kind}-${missing.periodKey}-${index}`}>
                        <Link href={missingHref(projectId, missing)} className="font-semibold !text-amber-800 hover:underline">
                          {missing.label} · tháng {formatMonth(missing.periodKey)} ›
                        </Link>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ) : null}

            {months.rows.map((row) => {
              const expanded = open.has(row.periodKey);
              const panelId = `pnl-month-${row.periodKey}`;
              return (
                <Fragment key={row.periodKey}>
                  <tr className="transition-colors hover:bg-muted/25">
                    <th scope="row" className={`${tdClass} whitespace-nowrap text-left font-normal`}>
                      <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggle(row.periodKey)} className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums hover:text-primary">
                        <span aria-hidden className="text-xs">{expanded ? "▾" : "▸"}</span>
                        {formatMonth(row.periodKey)}
                      </button>
                    </th>
                    <td title={row.fromSnapshot ? "Số lấy từ ảnh chụp khi khóa kỳ" : "Tính theo dữ liệu hiện tại"} className={`${tdClass} whitespace-nowrap`}>{row.periodStateLabel}</td>
                    <Hours minutes={row.loggedMinutes} />
                    <Hours minutes={row.includedMinutes} />
                    <Hours minutes={row.pendingMinutes} title={reasonsTitle(row.pendingByReason)} />
                    <Hours minutes={row.excludedMinutes} title={reasonsTitle(row.excludedByReason)} />
                    {moneyVisible ? <Money amount={row.laborCostAmount} /> : null}
                    {moneyVisible ? <Money amount={row.otherCostAmount} /> : null}
                    {moneyVisible ? <Money amount={row.totalCostAmount} /> : null}
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {row.missing.length ? (
                        <Link href={missingHref(projectId, row.missing[0])} title={row.missing.map((missing) => missing.label).join(" · ")} className={`${warnTextClass} !text-amber-700 hover:underline`}>
                          {row.missing[0].label} ›
                        </Link>
                      ) : <span className={okTextClass}>Đủ</span>}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr id={panelId}>
                      <td colSpan={columnCount} className="border-b border-border/70 bg-muted/20 px-4 py-4">
                        <MonthDetail projectId={projectId} periodKey={row.periodKey} moneyVisible={moneyVisible} preloaded={allDetails?.find((detail) => detail.periodKey === row.periodKey)} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}

            {months.wholeProjectItems.map((item) => (
              <tr key={item.code}>
                <th scope="row" colSpan={moneyVisible ? 7 : 6} className={`${tdClass} text-left font-normal`}>
                  Khoản cả dự án
                  {months.wholeProjectItems.length > 1 ? <span className="text-muted-foreground"> · {item.label}</span> : null}
                </th>
                {moneyVisible ? <Money amount={item.amount} /> : null}
                {moneyVisible ? <Money amount={item.amount} /> : null}
                <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{item.note}</td>
              </tr>
            ))}

            <tr>
              <th scope="row" className={`${tdClass} whitespace-nowrap text-left font-normal text-muted-foreground`}>Sau nghiệm thu</th>
              <td colSpan={columnCount - 1} className={`${tdClass} text-muted-foreground`}>
                {after.note}
                {after.visible ? (
                  <span className="ml-2 font-mono tabular-nums text-foreground">
                    {formatHoursValue(after.minutes)} giờ{moneyVisible ? ` · ${formatMillions(after.amount, "table")}` : ""}
                  </span>
                ) : null}
                {after.visible && after.uncostedMinutes > 0 ? <span className={`ml-2 ${warnTextClass}`}>còn {formatHoursValue(after.uncostedMinutes)} giờ chưa có cost rate</span> : null}
              </td>
            </tr>
            {after.visible ? after.rows.map((row) => (
              <tr key={`after-${row.periodKey}`} className="text-muted-foreground">
                <td colSpan={2} className={`${tdClass} pl-8 font-mono tabular-nums text-muted-foreground`}>{formatMonth(row.periodKey)}</td>
                <Hours minutes={row.minutes} />
                <td colSpan={moneyVisible ? 5 : 3} className={tdClass} />
                {moneyVisible ? <Money amount={row.amount} /> : null}
                <td className={tdClass} />
              </tr>
            )) : null}
          </tbody>
        </table>
      </div>
      {all.error ? <div className="px-4 pt-3"><PnlLoadError error={all.error} onRetry={all.reload} /></div> : null}
      <p className={`${mutedNoteClass} px-4 py-3`}>
        Bấm một tháng: bảng người × ngày (ngày lễ tô xám), đổi sang xem theo task, cuối bảng có đối soát ·{" "}
        <button type="button" disabled={keys.length === 0 || (all.loading && wantAll)} onClick={toggleAll} className="font-semibold text-primary hover:underline disabled:opacity-50">
          {allOpen ? "Thu gọn các tháng ›" : all.loading && wantAll ? "Đang mở…" : "Mở hết các tháng ›"}
        </button>
      </p>
    </section>
  );
}
