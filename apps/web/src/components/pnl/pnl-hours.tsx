"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PnlGateStatusCode, PnlSourceEntriesResponse, PnlSourceEntryRow } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { DateRangeFilter, FilterBar, FilterField, MultiSelectFilter, PersonFilter, SearchFilter, matchesAny } from "@/components/filters";
import { PageHeader, pageMainClassName } from "@/components/page-header";
import { PersonLink } from "@/components/person-link";
import { formatDay, formatDong, formatHoursValue, formatMonth } from "./pnl-format";
import { ENTRY_GROUP_NAME, ENTRY_GROUP_TODO, ENTRY_STATUS_MEANING, ENTRY_STATUS_NAME, FIX_ACTION_LABELS, STAFF_COST_PHRASE, plainGateReason } from "./pnl-plain";
import { PNL_ENTRY_STATUSES, entriesApiQuery, fixTargetHref, hoursFilterCount, hoursSearch, parseHoursState, type PnlHoursState } from "./pnl-query";
import { EmptyRow, HelpToggle, NoValue, PnlLoadError, cardClass, mutedNoteClass, tdClass, tdNumberClass, thClass, thNumberClass, useDebouncedText, usePnlLoad, warnTextClass } from "./pnl-ui";

const PAGE_SIZE = 100;

const STATUS_CLASS: Record<PnlGateStatusCode, string> = {
  included: "bg-emerald-50 text-emerald-700",
  excluded: "bg-muted text-muted-foreground",
  pending: "bg-amber-50 text-amber-800"
};

const TITLES: Record<PnlGateStatusCode, string> = { pending: "Giờ chờ xử lý", included: "Giờ đã tính vào P&L", excluded: "Giờ không tính vào P&L dự án" };

/** Theo dự án và người, rồi theo ngày. */
function byProjectAndPerson(left: PnlSourceEntryRow, right: PnlSourceEntryRow) {
  return (left.projectName ?? "").localeCompare(right.projectName ?? "", "vi")
    || left.userDisplayName.localeCompare(right.userDisplayName, "vi")
    || left.workDate.localeCompare(right.workDate);
}

/** The one action that fixes this hour, as a link to the screen where it is done. */
function FixLink({ entry }: Readonly<{ entry: PnlSourceEntryRow }>) {
  if (!entry.target) return <NoValue why="Giờ này không cần xử lý" />;
  const href = entry.target === "pending_hours" && entry.taskId
    ? `/tasks/${encodeURIComponent(entry.taskId)}`
    : fixTargetHref(entry.target, { projectId: entry.projectId, periodKey: entry.periodKey });
  return <Link href={href} className="text-xs font-semibold !text-primary hover:underline">{FIX_ACTION_LABELS[entry.target]} ›</Link>;
}

function EntryTable({ entries, moneyVisible, showDeadline, onReset }: Readonly<{ entries: PnlSourceEntryRow[]; moneyVisible: boolean; showDeadline: boolean; onReset?: () => void }>) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [entries]);
  const columnCount = 5 + (showDeadline ? 1 : 0);
  return (
    <>
      <div className="overflow-x-auto">
        {/* Six columns at most, so the table fits its card at 1280px: related facts share a cell on two lines. */}
        <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-left">
          <colgroup>
            <col className="w-[30%]" /><col className="w-[16%]" /><col className="w-[9%]" /><col className="w-[21%]" />
            {showDeadline ? <col className="w-[12%]" /> : null}<col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="bg-muted/30">
              <th scope="col" title="Dự án và task của dòng giờ" className={thClass}>Dự án · Task</th>
              <th scope="col" className={thClass}>Nhân sự · Ngày ghi</th>
              <th scope="col" title={moneyVisible ? "Số giờ được tính; chi phí P&L = đơn giá giờ đã duyệt × số giờ" : "Số giờ đã ghi"} className={thNumberClass}>Giờ</th>
              <th scope="col" title="Giờ đã tính vào P&L, đang chờ xử lý hay không tính — kèm lý do" className={thClass}>Trạng thái · Lý do</th>
              {showDeadline ? <th scope="col" title="Hạn xử lý giờ này và PIC chịu trách nhiệm" className={thClass}>Hạn · Người xử lý</th> : null}
              <th scope="col" title="Việc cần làm để giờ này được tính, và nơi làm" className={thClass}>Việc cần làm</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <EmptyRow colSpan={columnCount}>
                {onReset ? <>Không có kết quả phù hợp bộ lọc. <button type="button" onClick={onReset} className="font-semibold text-primary hover:underline">Đặt lại bộ lọc</button></> : showDeadline ? "Không có giờ nào đang chờ xử lý trong phạm vi này." : "Không có giờ nào trong phạm vi này."}
              </EmptyRow>
            ) : null}
            {entries.slice(0, limit).map((entry) => (
              <tr key={entry.id} className="align-top transition-colors hover:bg-muted/25">
                <td className={`${tdClass} break-words`}>
                  {entry.projectId
                    ? <Link href={`/pnl/${encodeURIComponent(entry.projectId)}`} title="Mở P&L của dự án" className="font-semibold !text-foreground hover:!text-primary">{entry.projectName ?? entry.projectCode ?? entry.projectId}</Link>
                    : <NoValue why="Giờ này chưa gắn với dự án nào" />}
                  <span className="mt-0.5 block text-xs">
                    {entry.taskId
                      ? <Link href={`/tasks/${encodeURIComponent(entry.taskId)}`} className="!text-foreground hover:!text-primary">{entry.taskTitle ?? entry.taskId}</Link>
                      : <NoValue why="Giờ này không gắn với task nào" />}
                  </span>
                </td>
                <td className={`${tdClass} break-words`}>
                  <PersonLink userId={entry.userId} avatar className="!text-foreground hover:!text-primary">{entry.userDisplayName}</PersonLink>
                  <span className="mt-0.5 block whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{formatDay(entry.workDate)}</span>
                </td>
                <td className={tdNumberClass}>
                  {formatHoursValue(entry.minutes)}
                  {moneyVisible ? (
                    <span title="Đơn giá giờ (đồng mỗi giờ)" className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      {entry.hourlyCostRate === null ? <NoValue why={`Chưa có ${STAFF_COST_PHRASE} của tháng ${formatMonth(entry.periodKey)}`} /> : `${formatDong(entry.hourlyCostRate)}/giờ`}
                    </span>
                  ) : null}
                </td>
                <td className={`${tdClass} break-words`}>
                  <span title={ENTRY_STATUS_MEANING[entry.status]} className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASS[entry.status]}`}>{ENTRY_STATUS_NAME[entry.status]}</span>
                  {entry.reasons.length ? <span className="mt-1 block text-[11px] text-muted-foreground">{entry.reasons.map((code, index) => plainGateReason(code, entry.reasonLabels[index])).join(" · ")}</span> : null}
                  {entry.blocksG7 ? <span className={`mt-1 block text-[11px] ${warnTextClass}`}>Chặn duyệt nghiệm thu G7</span> : null}
                </td>
                {showDeadline ? (
                  <td className={`${tdClass} break-words text-xs`}>
                    <span className={`block whitespace-nowrap ${entry.overdue ? "font-bold text-rose-700" : ""}`}>
                      {entry.deadline ? `${formatDay(entry.deadline)}${entry.overdue ? " · quá hạn" : ""}` : <NoValue why="Giờ này không có hạn xử lý (dự án thử nghiệm hoặc pre-sale chờ ký hợp đồng)" />}
                    </span>
                    <span className="mt-0.5 block">
                      {entry.ownerUserId
                        ? <PersonLink userId={entry.ownerUserId} avatar className="!text-foreground hover:!text-primary">{entry.ownerDisplayName}</PersonLink>
                        : <span className={warnTextClass}>Dự án chưa có PIC</span>}
                    </span>
                  </td>
                ) : null}
                <td className={`${tdClass} break-words`}><FixLink entry={entry} /></td>
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

/** One option per distinct value of the loaded rows, sorted by label. */
function optionsOf(rows: readonly PnlSourceEntryRow[], pick: (row: PnlSourceEntryRow) => Array<[string, string]>) {
  const found = new Map(rows.flatMap(pick));
  return [...found].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label, "vi"));
}

/**
 * Danh sách giờ đã ghi (GET /pnl/entries) — mặc định là các giờ "Chờ xử lý" mà Tổng quan và P&L dự án dẫn tới.
 * Bộ lọc nằm trên URL (`fromDay`, `toDay`, `userId`, `projectId`, `status`, `reason`, `group`, `q`; liên kết cũ dùng
 * `periodKey` hoặc `from`+`to` theo tháng vẫn mở đúng). API lọc theo trạng thái, ngày và nhóm; phần còn lại lọc tại chỗ.
 */
export function PnlHoursPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const state = useMemo(() => parseHoursState(params), [params]);
  const { data: payload, error, loading, reload } = usePnlLoad<PnlSourceEntriesResponse>(`/api/pnl/entries?${entriesApiQuery(params)}`);

  const go = (next: PnlHoursState) => {
    const query = hoursSearch(next, params);
    const returnTo = params.get("returnTo");
    const search = [query, returnTo ? `returnTo=${encodeURIComponent(returnTo)}` : ""].filter(Boolean).join("&");
    router.replace(search ? `/pnl/hours?${search}` : "/pnl/hours", { scroll: false });
  };
  const change = (patch: Partial<PnlHoursState>) => go({ ...state, ...patch });
  const reset = () => go({ q: "", from: "", to: "", userIds: [], projectIds: [], statuses: ["pending"], reasons: [], groups: [] });
  const [search, setSearch] = useDebouncedText(state.q, (q) => change({ q }));

  const loaded = useMemo(() => [...(payload?.data ?? [])].sort(byProjectAndPerson), [payload]);
  const entries = useMemo(() => loaded.filter((entry) =>
    matchesAny(state.projectIds, entry.projectId)
    && matchesAny(state.userIds, entry.userId)
    && matchesAny(state.reasons, entry.reasons)
    && matchesSearch(state.q, entry.projectName, entry.projectCode, entry.userDisplayName, entry.taskTitle)
  ), [loaded, state]);
  const projects = useMemo(() => optionsOf(loaded, (row) => (row.projectId ? [[row.projectId, row.projectName ?? row.projectCode ?? row.projectId]] : [])), [loaded]);
  const people = useMemo(() => optionsOf(loaded, (row) => [[row.userId, row.userDisplayName]]).map((option) => ({ id: option.value, name: option.label })), [loaded]);
  const reasons = useMemo(() => optionsOf(loaded, (row) => row.reasons.map((code, index): [string, string] => [code, plainGateReason(code, row.reasonLabels[index])])), [loaded]);

  const status = state.statuses.length === 1 ? state.statuses[0] : null;
  const onlyPending = status === "pending";
  const title = status ? TITLES[status] : "Giờ đã ghi theo trạng thái P&L";
  const projectId = state.projectIds.length === 1 ? state.projectIds[0] : null;
  const projectName = projectId ? projects.find((project) => project.value === projectId)?.label : undefined;
  const activeCount = hoursFilterCount(state);
  const minutes = entries.reduce((total, entry) => total + entry.minutes, 0);
  const overdue = entries.filter((entry) => entry.overdue).length;

  return (
    <AppShell activeRoute="/pnl" title={title}>
      <main className={pageMainClassName}>
        <PageHeader
          back={projectId ? { href: `/pnl/${encodeURIComponent(projectId)}`, label: projectName ? `P&L của ${projectName}` : "P&L của dự án" } : { href: "/pnl", label: "P&L dự án" }}
          title={title}
          subtitle={status ? ENTRY_STATUS_MEANING[status] : "Mọi giờ đã ghi và việc chúng đã được tính vào P&L dự án hay chưa."}
        />
        {state.statuses.length === 0 || state.statuses.includes("pending") ? (
          <HelpToggle label="Cần làm gì với giờ chờ xử lý?" storageKey="pnl-help-hours">
            {Object.keys(ENTRY_GROUP_NAME).map((group) => <li key={group}><span className="font-semibold text-foreground">{ENTRY_GROUP_NAME[group]}:</span> {ENTRY_GROUP_TODO[group]}</li>)}
            <li>Cột “Việc cần làm” ở mỗi dòng dẫn thẳng tới nơi xử lý giờ đó. Xử lý xong, giờ tự chuyển sang “Đã tính vào P&amp;L”.</li>
          </HelpToggle>
        ) : null}
        <section aria-label="Bộ lọc">
          <FilterBar onReset={activeCount ? reset : undefined} activeCount={activeCount}>
            <FilterField label="Tìm kiếm" className="min-w-[200px] flex-1">
              <SearchFilter value={search} onChange={setSearch} placeholder="Dự án, nhân sự hoặc task..." ariaLabel="Tìm trong danh sách giờ" className="" />
            </FilterField>
            <FilterField label="Ngày ghi giờ" className="shrink-0">
              <DateRangeFilter ariaLabel="Ngày ghi giờ" value={{ from: state.from, to: state.to }} onChange={(range) => change({ from: range.from, to: range.to })} />
            </FilterField>
            <PersonFilter label="Nhân sự" people={people} values={state.userIds} onChange={(userIds) => change({ userIds })} />
            <MultiSelectFilter label="Dự án" options={projects} values={state.projectIds} onChange={(projectIds) => change({ projectIds })} allLabel="Tất cả dự án" searchPlaceholder="Tìm dự án..." />
            <MultiSelectFilter label="Trạng thái" options={PNL_ENTRY_STATUSES.map((value) => ({ value, label: ENTRY_STATUS_NAME[value] }))} values={state.statuses} onChange={(statuses) => change({ statuses: statuses as PnlGateStatusCode[] })} allLabel="Tất cả trạng thái" searchable={false} />
            <MultiSelectFilter label="Lý do chờ" options={reasons} values={state.reasons} onChange={(next) => change({ reasons: next })} allLabel="Tất cả lý do" />
            <MultiSelectFilter label="Nhóm việc cần làm" options={Object.entries(ENTRY_GROUP_NAME).map(([value, label]) => ({ value, label }))} values={state.groups} onChange={(groups) => change({ groups })} allLabel="Tất cả nhóm" searchable={false} />
          </FilterBar>
        </section>
        {error ? <PnlLoadError error={error} onRetry={reload} /> : null}
        {payload ? (
          <p role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${onlyPending && overdue ? "border-rose-200 bg-rose-50 text-rose-800" : "border-border bg-card text-muted-foreground"}`}>
            {entries.length} dòng giờ · {formatHoursValue(minutes)} giờ
            {onlyPending ? ` · hạn xử lý ${payload.meta.pendingDeadlineWorkingDays} ngày làm việc kể từ khi ghi · ${overdue ? `${overdue} dòng đã quá hạn` : "chưa có dòng nào quá hạn"}` : ""}
          </p>
        ) : null}
        {payload ? (
          <section aria-label="Danh sách giờ, theo dự án và người" aria-busy={loading} className={`${cardClass} ${loading ? "opacity-70" : ""}`}>
            <EntryTable entries={entries} moneyVisible={payload.meta.moneyVisible} showDeadline={onlyPending} onReset={activeCount ? reset : undefined} />
          </section>
        ) : error ? null : (
          <p role="status" className={`${cardClass} ${mutedNoteClass} px-4 py-8 text-center`}>Đang tải danh sách giờ…</p>
        )}
      </main>
    </AppShell>
  );
}
