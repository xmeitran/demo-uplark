"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { PnlGateStatusCode, PnlSourceEntriesResponse, PnlSourceEntryRow } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { PersonLink } from "@/components/person-link";
import { formatDay, formatHoursValue, formatMonth, formatDong } from "./pnl-format";
import { FIX_TARGET_LABELS, entriesApiQuery, fixTargetHref } from "./pnl-query";
import { EmptyRow, PnlLoadError, cardClass, mutedNoteClass, tdClass, tdNumberClass, thClass, thNumberClass, usePnlLoad, warnTextClass } from "./pnl-ui";

const PAGE_SIZE = 100;

const STATUS_CLASS: Record<PnlGateStatusCode, string> = {
  included: "bg-emerald-50 text-emerald-700",
  excluded: "bg-muted text-muted-foreground",
  pending: "bg-amber-50 text-amber-800"
};

const TITLES: Record<PnlGateStatusCode, { title: string; hint: string }> = {
  pending: {
    title: "Giờ log Chờ xử lý",
    hint: "Giờ còn thiếu điều kiện để vào P&L dự án: cost rate của tháng, phân loại, hạng mục, Lớp 2 không khớp hoặc ghi bù vào tháng đã khóa. Bổ sung xong, giờ tự chuyển sang Được tính."
  },
  included: { title: "Giờ log Được tính", hint: "Giờ đã vào chi phí của P&L dự án." },
  excluded: { title: "Giờ log Bị loại", hint: "Giờ không thuộc P&L dự án: nội bộ, sau mốc đóng P&L hoặc Pre-sale của deal thua. Vẫn được quy ra tiền ở dòng cấp công ty." }
};

/** Theo dự án và người, rồi theo ngày. */
function byProjectAndPerson(left: PnlSourceEntryRow, right: PnlSourceEntryRow) {
  return (left.projectName ?? "").localeCompare(right.projectName ?? "", "vi")
    || left.userDisplayName.localeCompare(right.userDisplayName, "vi")
    || left.workDate.localeCompare(right.workDate);
}

/** Link to the one screen where this hour gets fixed. */
function FixLink({ entry }: Readonly<{ entry: PnlSourceEntryRow }>) {
  if (!entry.target) return <span className="text-muted-foreground">—</span>;
  const href = entry.target === "pending_hours" && entry.taskId
    ? `/tasks/${encodeURIComponent(entry.taskId)}`
    : fixTargetHref(entry.target, { projectId: entry.projectId, periodKey: entry.periodKey });
  return <Link href={href} className="whitespace-nowrap text-xs font-semibold !text-primary hover:underline">{FIX_TARGET_LABELS[entry.target]} ›</Link>;
}

function EntryTable({ entries, moneyVisible, showDeadline }: Readonly<{ entries: PnlSourceEntryRow[]; moneyVisible: boolean; showDeadline: boolean }>) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [entries]);
  const columnCount = 7 + (moneyVisible ? 1 : 0) + (showDeadline ? 2 : 0);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-muted/30">
              <th scope="col" className={thClass}>Dự án</th>
              <th scope="col" className={thClass}>Nhân sự</th>
              <th scope="col" className={thClass}>Ngày</th>
              <th scope="col" className={thClass}>Task · Hạng mục</th>
              <th scope="col" className={thNumberClass}>Giờ</th>
              <th scope="col" className={thClass}>Kết quả cổng lọc</th>
              {moneyVisible ? <th scope="col" className={thNumberClass}>Cost rate</th> : null}
              {showDeadline ? <th scope="col" className={thClass}>Hạn xử lý</th> : null}
              {showDeadline ? <th scope="col" className={thClass}>Người xử lý</th> : null}
              <th scope="col" className={thClass}>Nơi sửa</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? <EmptyRow colSpan={columnCount}>Không có giờ log nào trong phạm vi này.</EmptyRow> : null}
            {entries.slice(0, limit).map((entry) => (
              <tr key={entry.id} className="align-top transition-colors hover:bg-muted/25">
                <td className={tdClass}>
                  {entry.projectId
                    ? <Link href={`/pnl/${encodeURIComponent(entry.projectId)}`} className="font-semibold !text-foreground hover:!text-primary">{entry.projectName ?? entry.projectCode ?? entry.projectId}</Link>
                    : "—"}
                </td>
                <td className={tdClass}>
                  <PersonLink userId={entry.userId} className="!text-foreground hover:!text-primary">{entry.userDisplayName}</PersonLink>
                </td>
                <td className={`${tdClass} whitespace-nowrap font-mono tabular-nums`}>{formatDay(entry.workDate)}</td>
                <td className={tdClass}>
                  {entry.taskId
                    ? <Link href={`/tasks/${encodeURIComponent(entry.taskId)}`} className="!text-foreground hover:!text-primary">{entry.taskTitle ?? entry.taskId}</Link>
                    : "—"}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{entry.contractItemName ?? "Chưa có hạng mục"}</span>
                </td>
                <td className={tdNumberClass}>{formatHoursValue(entry.minutes)}</td>
                <td className={tdClass}>
                  <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASS[entry.status]}`}>{entry.statusLabel}</span>
                  {entry.reasonLabels.length ? <span className="mt-1 block text-[11px] text-muted-foreground">{entry.reasonLabels.join(" · ")}</span> : null}
                  {entry.blocksG7 ? <span className={`mt-1 block text-[11px] ${warnTextClass}`}>Chặn duyệt G7</span> : null}
                  {entry.awaitingContract ? <span className="mt-1 block text-[11px] text-muted-foreground">Pre-sale chờ ký hợp đồng</span> : null}
                </td>
                {moneyVisible ? <td title="đồng mỗi giờ" className={tdNumberClass}>{formatDong(entry.hourlyCostRate)}</td> : null}
                {showDeadline ? (
                  <td className={`${tdClass} whitespace-nowrap text-xs ${entry.overdue ? "font-bold text-rose-700" : ""}`}>
                    {entry.deadline ? `${formatDay(entry.deadline)}${entry.overdue ? " · quá hạn" : ""}` : "—"}
                  </td>
                ) : null}
                {showDeadline ? (
                  <td className={`${tdClass} text-xs`}>
                    {entry.ownerUserId
                      ? <PersonLink userId={entry.ownerUserId} className="!text-foreground hover:!text-primary">{entry.ownerDisplayName}</PersonLink>
                      : <span className={warnTextClass}>Chưa có PIC</span>}
                  </td>
                ) : null}
                <td className={tdClass}><FixLink entry={entry} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > limit ? (
        <div className="px-4 py-3 text-center">
          <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="text-xs font-semibold text-primary hover:underline">
            Hiện thêm {Math.min(PAGE_SIZE, entries.length - limit)} dòng (còn {entries.length - limit})
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Danh sách giờ log nguồn (GET /pnl/entries) — mặc định là danh sách "Chờ xử lý" mà dải cam ở Tổng quan và các
 * liên kết "Thiếu … ›" ở P&L dự án mở tới. Phạm vi lấy từ URL: `projectId`, `periodKey` hoặc `from`+`to`, `group`, `status`…
 */
export function PnlHoursPage() {
  const searchParams = useSearchParams();
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const { data: payload, error, reload } = usePnlLoad<PnlSourceEntriesResponse>(`/api/pnl/entries?${entriesApiQuery(params)}`);
  const status = (["included", "excluded"] as const).find((value) => value === params.get("status")) ?? "pending";
  const projectId = params.get("projectId");
  const entries = useMemo(() => [...(payload?.data ?? [])].sort(byProjectAndPerson), [payload]);
  const projectName = projectId ? entries.find((entry) => entry.projectId === projectId)?.projectName : undefined;
  const range = params.get("periodKey")
    ? `tháng ${formatMonth(params.get("periodKey"))}`
    : params.get("from") && params.get("to") ? `từ ${formatMonth(params.get("from"))} đến ${formatMonth(params.get("to"))}` : null;
  const scopeText = [projectId ? `dự án ${projectName ?? projectId}` : null, range].filter(Boolean).join(" · ");

  return (
    <AppShell activeRoute="/pnl" title={TITLES[status].title}>
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4 xl:p-6">
        <header>
          <Link
            href={projectId ? `/pnl/${encodeURIComponent(projectId)}` : "/pnl"}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold !text-foreground shadow-sm transition-colors hover:border-primary/40 hover:!text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {projectId ? "Quay lại P&L dự án" : "Quay lại Tổng quan P&L"}
          </Link>
          <h1 className="mt-3 !text-xl font-bold text-foreground">{TITLES[status].title}</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            {TITLES[status].hint}
            {scopeText ? ` Phạm vi: ${scopeText}.` : ""}
          </p>
        </header>
        {error ? <PnlLoadError error={error} onRetry={reload} /> : null}
        {payload ? (
          <p role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${payload.meta.overdueCount ? "border-rose-200 bg-rose-50 text-rose-800" : "border-border bg-card text-muted-foreground"}`}>
            {payload.meta.entryCount} giờ log · {formatHoursValue(payload.meta.totalMinutes)} giờ
            {status === "pending"
              ? ` · hạn xử lý ${payload.meta.pendingDeadlineWorkingDays} ngày làm việc · ${payload.meta.overdueCount ? `${payload.meta.overdueCount} giờ log đã quá hạn` : "chưa có giờ log nào quá hạn"}`
              : ""}
          </p>
        ) : null}
        {payload ? (
          <section aria-label="Danh sách giờ log, theo dự án và người" className={cardClass}>
            <EntryTable entries={entries} moneyVisible={payload.meta.moneyVisible} showDeadline={status === "pending"} />
          </section>
        ) : error ? null : (
          <p role="status" className={`${cardClass} ${mutedNoteClass} px-4 py-8 text-center`}>Đang tải giờ log…</p>
        )}
      </main>
    </AppShell>
  );
}
