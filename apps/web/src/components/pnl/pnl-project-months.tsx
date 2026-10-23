"use client";

import { UserAvatar } from "@/components/user-avatar";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PnlMonthMissing, PnlProjectMonthDetail, PnlProjectMonthDetailResponse, PnlProjectResponse } from "@b2b-crm/contracts";
import { formatDong, formatExactVnd, formatHoursValue, formatMonth, formatVndAmount } from "./pnl-format";
import { STAFF_COST_PHRASE, plainGateReason, plainMissing, plainPersonStatus } from "./pnl-plain";
import { fixTargetHref } from "./pnl-query";
import {
  Chip, HelpToggle, NoValue, PnlLoadError, Segmented, cardClass, mutedNoteClass, sectionTitleClass, tdClass, tdNumberClass, thClass, thNumberClass, usePnlLoad
} from "./pnl-ui";

type Months = PnlProjectResponse["data"]["months"];
type DetailView = "people" | "days" | "tasks";

const DETAIL_VIEWS = [
  { value: "people", label: "Theo người" },
  { value: "days", label: "Xem theo ngày" },
  { value: "tasks", label: "Theo task" }
] as const;

const NO_RATE = `Chưa có ${STAFF_COST_PHRASE} của tháng này`;
const PERIOD_TONE = { locked: "ok", awaiting_lock: "warn" } as Record<string, "ok" | "warn">;

function Hours({ minutes, bold = false, title }: Readonly<{ minutes: number | null; bold?: boolean; title?: string }>) {
  return <td title={title} className={`${tdNumberClass} ${bold ? "font-bold" : ""} ${title ? "cursor-help" : ""}`}>{formatHoursValue(minutes)}</td>;
}

/** Exact VND amount for the P&L; no hidden million coefficient. */
function Money({ amount, bold = false, why = "Chưa có số liệu", title }: Readonly<{ amount: number | null; bold?: boolean; why?: string; title?: string }>) {
  return <td title={title ?? formatExactVnd(amount)} className={`${tdNumberClass} ${bold ? "font-bold" : ""}`}>{amount === null ? <NoValue why={why} /> : formatVndAmount(amount)}</td>;
}

function missingHref(projectId: string, missing: PnlMonthMissing) {
  return fixTargetHref(missing.target, { projectId, periodKey: missing.periodKey, group: missing.kind });
}

function reasonsTitle(reasons: Array<{ reason: string; label: string; minutes: number }>) {
  return reasons.length ? reasons.map((reason) => `${plainGateReason(reason.reason, reason.label)}: ${formatHoursValue(reason.minutes)} giờ`).join(" · ") : undefined;
}

/** "Chi phí" of a row with what it is made of in the tooltip. */
function costTitle(row: { laborCostAmount: number | null; otherCostAmount: number | null }) {
  return `Chi phí nhân sự ${formatVndAmount(row.laborCostAmount)} · chi phí khác ${formatVndAmount(row.otherCostAmount)}`;
}

/** Mặc định của một tháng: mỗi người một dòng — giờ đã ghi, đã tính, chi phí, và còn thiếu gì. */
function PeopleOfMonth({ detail, moneyVisible }: Readonly<{ detail: PnlProjectMonthDetail; moneyVisible: boolean }>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-muted/30">
            <th scope="col" className={thClass}>Nhân sự</th>
            <th scope="col" className={thNumberClass}>Giờ đã ghi</th>
            <th scope="col" title="Phần giờ đủ điều kiện để quy ra chi phí của dự án" className={thNumberClass}>Giờ đã tính</th>
            {moneyVisible ? <th scope="col" title="Đơn giá giờ đã nhập/được duyệt (đồng mỗi giờ)" className={thNumberClass}>Đơn giá giờ</th> : null}
            {moneyVisible ? <th scope="col" title="Giờ đã tính vào P&L × đơn giá giờ (đồng)" className={thNumberClass}>Chi phí</th> : null}
            <th scope="col" className={`${thClass} !text-center`}>Dữ liệu</th>
          </tr>
        </thead>
        <tbody>
          {detail.people.map((person) => {
            const missing = plainPersonStatus(person.status.missing ?? [], false);
            return (
              <tr key={person.userId}>
                <th scope="row" className={`${tdClass} text-left font-semibold`}>
                  {person.displayName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{person.roleGroupLabel}</span>
                </th>
                <Hours minutes={person.loggedMinutes} />
                <Hours minutes={person.includedMinutes} />
                {moneyVisible ? <td title="đồng mỗi giờ" className={tdNumberClass}>{person.hourlyCostRate === null ? <NoValue why={NO_RATE} /> : formatDong(person.hourlyCostRate)}</td> : null}
                {moneyVisible ? <Money amount={person.laborCostAmount} why={NO_RATE} /> : null}
                <td className={`${tdClass} text-center`}>{person.status.ok ? <Chip tone="ok">Đủ</Chip> : <Chip tone="warn" title={missing ?? person.status.label}>Thiếu</Chip>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Xem theo ngày": lưới người × ngày, cuộn trong khung riêng, cột tên đứng yên. Ngày lễ tô xám, ngày nghỉ cá nhân có dấu "N". */
function PeopleByDay({ detail }: Readonly<{ detail: PnlProjectMonthDetail }>) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card">
      <table className="border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-muted/30">
            <th scope="col" className={`${thClass} sticky left-0 z-10 bg-muted`}>Nhân sự</th>
            {detail.days.map((day) => (
              <th
                key={day.dateKey}
                scope="col"
                title={day.holiday ? `Ngày lễ${day.holidayName ? `: ${day.holidayName}` : ""}` : day.weekend ? "Cuối tuần" : undefined}
                className={`border-b border-border px-1 py-3 text-center text-[11px] font-bold text-muted-foreground ${day.holiday ? "bg-muted" : day.weekend ? "bg-muted/50" : ""}`}
              >
                {day.dateKey.slice(8, 10)}
              </th>
            ))}
            <th scope="col" className={thNumberClass}>Tổng giờ</th>
          </tr>
        </thead>
        <tbody>
          {detail.people.map((person) => {
            const byDay = new Map(person.byDay.map((day) => [day.dateKey, day]));
            return (
              <tr key={person.userId}>
                <th scope="row" className={`${tdClass} sticky left-0 z-10 whitespace-nowrap bg-card text-left font-semibold`}><span className="inline-flex items-center gap-1.5"><UserAvatar id={person.userId} name={person.displayName} size="xs" />{person.displayName}</span></th>
                {detail.days.map((day) => {
                  const cell = byDay.get(day.dateKey);
                  const onLeave = person.leaveDays.includes(day.dateKey);
                  const title = [
                    onLeave ? "Nghỉ cá nhân" : null,
                    cell ? `Đã ghi ${formatHoursValue(cell.loggedMinutes)} giờ · đã tính vào P&L ${formatHoursValue(cell.includedMinutes)} · chờ xử lý ${formatHoursValue(cell.pendingMinutes)} · không tính ${formatHoursValue(cell.excludedMinutes)}` : null
                  ].filter(Boolean).join(" · ");
                  return (
                    <td
                      key={day.dateKey}
                      title={title || undefined}
                      className={`min-w-9 border-b border-border/70 px-1 py-3 text-center font-mono text-xs tabular-nums ${day.holiday ? "bg-muted" : day.weekend ? "bg-muted/50" : ""} ${cell?.pendingMinutes ? "font-semibold text-amber-700" : "text-foreground"}`}
                    >
                      {cell?.loggedMinutes ? formatHoursValue(cell.loggedMinutes) : null}
                      {onLeave ? <span aria-label="Nghỉ cá nhân" className="block text-[10px] font-bold text-sky-700">N</span> : null}
                    </td>
                  );
                })}
                <Hours minutes={person.loggedMinutes} />
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
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-muted/30">
            <th scope="col" className={thClass}>Task</th>
            <th scope="col" className={thNumberClass}>Giờ đã ghi</th>
            <th scope="col" title="Phần giờ đủ điều kiện để quy ra chi phí của dự án" className={thNumberClass}>Giờ đã tính</th>
            <th scope="col" title="Giờ còn thiếu một thông tin nên chưa tính được" className={thNumberClass}>Chờ xử lý</th>
            {moneyVisible ? <th scope="col" className={thNumberClass}>Chi phí</th> : null}
            <th scope="col" className={`${thClass} !text-center`}>Dữ liệu</th>
          </tr>
        </thead>
        <tbody>
          {detail.tasks.map((task) => {
            const reasons = task.reasons.map((reason) => `${plainGateReason(reason.reason, reason.label)}: ${formatHoursValue(reason.minutes)} giờ`).join(" · ");
            return (
              <tr key={task.taskId}>
                <td className={tdClass}>
                  <Link href={`/tasks/${encodeURIComponent(task.taskId)}`} className="font-semibold !text-foreground hover:!text-primary">{task.taskTitle}</Link>
                  {task.excludedMinutes ? <span className="block text-xs text-muted-foreground">{formatHoursValue(task.excludedMinutes)} giờ không tính</span> : null}
                </td>
                <Hours minutes={task.loggedMinutes} />
                <Hours minutes={task.includedMinutes} />
                <Hours minutes={task.pendingMinutes} />
                {moneyVisible ? <Money amount={task.laborCostAmount} why={NO_RATE} /> : null}
                <td className={`${tdClass} text-center`}>{reasons ? <Chip tone="warn" title={reasons}>Thiếu</Chip> : <Chip tone="ok">Đủ</Chip>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Nội dung mở ra dưới một tháng: danh sách theo người (mặc định), lưới theo ngày hoặc theo task; cuối là kiểm tra giờ. */
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
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          Tháng {formatMonth(periodKey)} <span className="font-normal text-muted-foreground">· giờ chuẩn {formatHoursValue(detail.standardMinutes)} giờ</span>
        </p>
        <Segmented ariaLabel={`Cách xem tháng ${formatMonth(periodKey)}`} value={view} options={DETAIL_VIEWS} onChange={setView} />
      </div>
      {view === "people" ? <PeopleOfMonth detail={detail} moneyVisible={moneyVisible} /> : view === "days" ? <PeopleByDay detail={detail} /> : <TasksOfMonth detail={detail} moneyVisible={moneyVisible} />}
      <p className={mutedNoteClass}>
        Kiểm tra giờ của tháng: {formatHoursValue(check.loggedMinutes)} giờ đã ghi = {formatHoursValue(check.includedMinutes)} đã tính vào P&amp;L + {formatHoursValue(check.pendingMinutes)} chờ xử lý + {formatHoursValue(check.excludedMinutes)} không tính
        {check.balanced ? " · khớp" : <span className="font-semibold text-rose-700"> · lệch {formatHoursValue(check.differenceMinutes)} giờ</span>}
        {" · "}
        <Link href={`${fixTargetHref("pending_hours", { projectId, periodKey })}&status=all`} className="font-semibold !text-primary hover:underline">Xem từng dòng giờ đã ghi ›</Link>
      </p>
    </div>
  );
}

/** One "còn thiếu" chip of a month: the first thing to fix as a link, everything missing in the tooltip. */
function MissingChip({ projectId, missing }: Readonly<{ projectId: string; missing: PnlMonthMissing[] }>) {
  if (!missing.length) return <Chip tone="ok">Đủ</Chip>;
  return (
    <Link href={missingHref(projectId, missing[0])} title={`${missing.map((row) => plainMissing(row, false)).join(" · ")}. Bấm để mở nơi bổ sung.`} className="inline-flex">
      <Chip tone="warn">Thiếu{missing.length > 1 ? ` ${missing.length}` : ""} ›</Chip>
    </Link>
  );
}

/** Khối 5 — giờ và chi phí theo tháng, bảy cột; bấm một tháng mở chi tiết ngay bên dưới dòng đó. */
export function ProjectMonths({ projectId, months, moneyVisible }: Readonly<{ projectId: string; months: Months; moneyVisible: boolean }>) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const [wantAll, setWantAll] = useState(false);
  const all = usePnlLoad<PnlProjectMonthDetailResponse>(wantAll ? `/api/pnl/projects/${encodeURIComponent(projectId)}/months/all` : null);
  const allDetails = all.data?.data;
  const keys = months.rows.map((row) => row.periodKey);
  const allOpen = keys.length > 0 && keys.every((key) => open.has(key));
  const columnCount = moneyVisible ? 7 : 6;

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
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pb-3 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 id="pnl-months-title" className={sectionTitleClass}>Giờ và chi phí theo tháng</h2>
          <p className={`!mt-0.5 ${mutedNoteClass}`}>
            Bấm một tháng để xem từng người, từng ngày hoặc từng task ·{" "}
            <button type="button" disabled={keys.length === 0 || (all.loading && wantAll)} onClick={toggleAll} className="font-semibold text-primary hover:underline disabled:opacity-50">
              {allOpen ? "Thu gọn các tháng ›" : all.loading && wantAll ? "Đang mở…" : "Mở hết các tháng ›"}
            </button>
          </p>
        </div>
        <HelpToggle label="Cách đọc bảng này" storageKey="pnl-help-project-months">
          <li>Mỗi dòng là một tháng. Giờ đã ghi = đã tính vào P&amp;L + chờ xử lý + không tính. Chỉ giờ “đã tính” mới thành chi phí nhân sự.</li>
          <li>Chờ xử lý: giờ còn thiếu một thông tin (chưa có {STAFF_COST_PHRASE}, chưa phân loại…). Cột “Dữ liệu” báo còn thiếu và dẫn tới nơi bổ sung.</li>
          <li>Không tính: giờ không thuộc P&amp;L dự án (việc nội bộ, ghi sau nghiệm thu, pre-sale của deal thua) — rê chuột vào “Giờ đã ghi” để xem.</li>
          <li>Trạng thái kỳ: tháng “Đã khóa” lấy số đã chốt khi khóa sổ; tháng chưa khóa tính theo dữ liệu hiện tại nên còn có thể đổi.</li>
          <li>Chi phí = chi phí nhân sự + chi phí khác của tháng; rê chuột vào số để xem từng phần.</li>
        </HelpToggle>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-0 text-left">
          <colgroup><col /><col className="w-[128px]" /><col className="w-[112px]" /><col className="w-[104px]" /><col className="w-[104px]" />{moneyVisible ? <col className="w-[120px]" /> : null}<col className="w-[112px]" /></colgroup>
          <thead>
            <tr className="bg-muted/30">
              <th scope="col" className={thClass}>Tháng</th>
              <th scope="col" title="Tháng đang mở, chờ khóa sổ hay đã khóa sổ" className={thClass}>Trạng thái kỳ</th>
              <th scope="col" title="Tổng giờ mọi người đã ghi cho dự án trong tháng (gồm cả giờ không tính)" className={thNumberClass}>Giờ đã ghi</th>
              <th scope="col" title="Phần giờ đủ điều kiện để quy ra chi phí của dự án (giờ đã tính vào P&L)" className={thNumberClass}>Đã tính</th>
              <th scope="col" title="Giờ còn thiếu một thông tin nên chưa tính được — rê chuột vào số để xem lý do" className={thNumberClass}>Chờ xử lý</th>
              {moneyVisible ? <th scope="col" title="Chi phí nhân sự + chi phí khác của tháng (đồng) — rê chuột vào số để xem từng phần" className={thNumberClass}>Chi phí</th> : null}
              <th scope="col" title="Đủ, hoặc còn thiếu dữ liệu — bấm để mở nơi bổ sung" className={`${thClass} !text-center`}>Dữ liệu</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-primary/5">
              <th scope="row" colSpan={2} className={`${tdClass} text-left font-bold`}>Toàn dự án</th>
              <Hours bold minutes={whole.loggedMinutes} title={whole.excludedMinutes ? `Trong đó ${formatHoursValue(whole.excludedMinutes)} giờ không tính: ${reasonsTitle(whole.excludedByReason) ?? ""}` : undefined} />
              <Hours bold minutes={whole.includedMinutes} />
              <Hours bold minutes={whole.pendingMinutes} title={reasonsTitle(whole.pendingByReason)} />
              {moneyVisible ? <Money bold amount={whole.totalCostAmount} title={costTitle(whole)} /> : null}
              <td className={`${tdClass} text-center`}>
                {whole.missing.length ? (
                  <button type="button" aria-expanded={missingOpen} aria-controls="pnl-months-missing" onClick={() => setMissingOpen(!missingOpen)}>
                    <Chip tone="warn">Thiếu {whole.missing.length} ›</Chip>
                  </button>
                ) : <Chip tone="ok">Đủ</Chip>}
              </td>
            </tr>
            {missingOpen && whole.missing.length ? (
              <tr id="pnl-months-missing">
                <td colSpan={columnCount} className="border-b border-border/70 bg-amber-50/60 px-4 py-3 sm:px-5">
                  <p className="text-sm font-bold text-amber-900">Còn {whole.missing.length} việc cần bổ sung</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                    {whole.missing.map((missing, index) => (
                      <li key={`${missing.kind}-${missing.periodKey}-${index}`}>
                        <Link href={missingHref(projectId, missing)} className="font-semibold !text-amber-800 hover:underline">{plainMissing(missing)} ›</Link>
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
                      <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggle(row.periodKey)} className="inline-flex items-center gap-1.5 font-mono !font-semibold tabular-nums hover:text-primary">
                        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
                        {formatMonth(row.periodKey)}
                      </button>
                    </th>
                    <td className={tdClass}><Chip tone={PERIOD_TONE[row.periodState] ?? "muted"} title={row.fromSnapshot ? "Số lấy từ ảnh chụp khi khóa sổ" : "Tính theo dữ liệu hiện tại"}>{row.periodStateLabel}</Chip></td>
                    <Hours minutes={row.loggedMinutes} title={row.excludedMinutes ? `Trong đó ${formatHoursValue(row.excludedMinutes)} giờ không tính: ${reasonsTitle(row.excludedByReason) ?? ""}` : undefined} />
                    <Hours minutes={row.includedMinutes} />
                    <Hours minutes={row.pendingMinutes} title={reasonsTitle(row.pendingByReason)} />
                    {moneyVisible ? <Money amount={row.totalCostAmount} title={costTitle(row)} /> : null}
                    <td className={`${tdClass} text-center`}><MissingChip projectId={projectId} missing={row.missing} /></td>
                  </tr>
                  {expanded ? (
                    <tr id={panelId}>
                      <td colSpan={columnCount} className="border-b border-border/70 bg-muted/20 px-4 py-4 sm:px-5">
                        <MonthDetail projectId={projectId} periodKey={row.periodKey} moneyVisible={moneyVisible} preloaded={allDetails?.find((detail) => detail.periodKey === row.periodKey)} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}

            {months.wholeProjectItems.map((item) => (
              <tr key={item.code}>
                <th scope="row" colSpan={5} className={`${tdClass} text-left font-normal`}>
                  Khoản tính một lần cho cả dự án
                  <span className="text-muted-foreground"> · {item.label}</span>
                </th>
                {moneyVisible ? <Money amount={item.amount} why={item.note} /> : null}
                <td className={`${tdClass} text-center`}><Chip tone="muted" title={item.note}>{item.expected ? "Dự kiến" : "Một lần"}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.error ? <div className="px-4 pt-3"><PnlLoadError error={all.error} onRetry={all.reload} /></div> : null}

      <div aria-label="Sau nghiệm thu" role="group" className="border-t border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="!text-sm font-bold text-foreground">Sau nghiệm thu</h3>
          {after.visible ? (
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatHoursValue(after.minutes)} giờ{moneyVisible ? <span title={formatExactVnd(after.amount)}> · {formatVndAmount(after.amount)}</span> : null}
            </p>
          ) : null}
        </div>
        <p className={`!mt-0.5 ${mutedNoteClass}`}>{after.note}</p>
        {after.visible && after.uncostedMinutes > 0 ? <p className="!mt-1 text-xs font-semibold text-amber-700">Còn {formatHoursValue(after.uncostedMinutes)} giờ chưa có {STAFF_COST_PHRASE}.</p> : null}
        {after.visible && after.rows.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {after.rows.map((row) => (
              <li key={row.periodKey} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground">
                <span className="font-mono tabular-nums text-muted-foreground">{formatMonth(row.periodKey)}</span> · {formatHoursValue(row.minutes)} giờ{moneyVisible ? ` · ${formatVndAmount(row.amount)}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
