"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PnlDashboardProjectRow, PnlDashboardResponse, PnlHourReconciliation } from "@b2b-crm/contracts";
import { formatExactVnd, formatHoursValue, formatMonthShort, formatPercent, formatVndAmount } from "./pnl-format";
import { RESULT_MEANING, notComputableWhy, whyNoValue } from "./pnl-plain";
import type { PnlDashboardSort, PnlDashboardState } from "./pnl-query";
import { EmptyRow, HelpToggle, NoValue, ResultBadge, Tabs, cardClass, mutedNoteClass, sectionTitleClass, tdClass, tdNumberClass, thClass, thNumberClass } from "./pnl-ui";

type Dashboard = PnlDashboardResponse["data"];
type Column = { label: string; title: string; sort?: PnlDashboardSort; numeric?: boolean; center?: boolean; width?: string };

const PROJECT: Column = { label: "Dự án", title: "Tên dự án (bấm để mở P&L chi tiết), khách hàng và PIC", sort: "name" };
const LABOR: Column = { label: "Chi phí nhân sự", title: "Giờ được tính vào P&L × đơn giá giờ của từng người trong tháng (đồng)", sort: "laborCost", numeric: true, width: "w-[148px]" };
const OTHER: Column = { label: "Chi phí khác", title: "Quỹ chi phí chung được chia, chi phí riêng của dự án, hoa hồng… (đồng)", sort: "otherCost", numeric: true, width: "w-[140px]" };
const RESULT: Column = { label: "Kết quả", title: "Chính thức, Tạm tính hay Không tính được — di chuột vào nhãn để xem lý do", center: true, width: "w-[136px]" };

// Seven columns at most, fixed widths: the table fits its card from 1280px up without scrolling sideways.
const ACCEPTED_COLUMNS: Column[] = [
  PROJECT,
  { label: "Bắt đầu → Nghiệm thu", title: "Tháng bắt đầu và tháng nghiệm thu (mốc G7)", sort: "start", width: "w-[128px]" },
  { label: "Doanh thu dự án", title: "Doanh thu nhập tay theo từng dự án (đồng)", sort: "revenue", numeric: true, width: "w-[148px]" },
  LABOR,
  OTHER,
  { label: "EBIT · Biên", title: "EBIT = doanh thu dự án − chi phí nhân sự − chi phí khác (đồng); dòng dưới là biên EBIT = EBIT ÷ doanh thu dự án", sort: "ebit", numeric: true, width: "w-[148px]" },
  RESULT
];

const IN_PROGRESS_COLUMNS: Column[] = [
  PROJECT,
  { label: "Bắt đầu", title: "Tháng bắt đầu dự án", sort: "start", width: "w-[128px]" },
  { label: "Doanh thu dự án", title: "Doanh thu nhập tay theo từng dự án (đồng)", sort: "revenue", numeric: true, width: "w-[148px]" },
  LABOR,
  OTHER,
  { label: "Tổng chi phí đến nay", title: "Chi phí nhân sự + chi phí khác đã phát sinh; dự án chưa nghiệm thu nên chưa có EBIT", numeric: true, width: "w-[148px]" },
  RESULT
];

const ALL_COLUMNS: Column[] = [
  PROJECT,
  { label: "Trạng thái P&L", title: "Dự án đã nghiệm thu hoặc đang triển khai", center: true, width: "w-[132px]" },
  { label: "Bắt đầu → Nghiệm thu", title: "Tháng bắt đầu và tháng nghiệm thu (mốc G7), nếu đã có", sort: "start", width: "w-[148px]" },
  { label: "Doanh thu dự án", title: "Doanh thu nhập tay theo từng dự án (đồng)", sort: "revenue", numeric: true, width: "w-[148px]" },
  { label: "Tổng chi phí", title: "Chi phí nhân sự + chi phí khác (đồng)", sort: "laborCost", numeric: true, width: "w-[148px]" },
  { label: "EBIT", title: "EBIT của dự án đã nghiệm thu; dự án đang triển khai chưa có EBIT", sort: "ebit", numeric: true, width: "w-[148px]" },
  RESULT
];

/** P&L money is shown as the exact VND amount; no hidden million coefficient. */
function Money({ amount, bold = false, why, percent }: Readonly<{ amount: number | null; bold?: boolean; why: string; percent?: number | null }>) {
  return (
    <td title={formatExactVnd(amount)} className={`${tdNumberClass} !px-3 ${bold ? "font-bold" : ""}`}>
      {amount === null ? <NoValue why={why} /> : formatVndAmount(amount)}
      {percent === undefined || percent === null ? null : <span title="Biên EBIT = EBIT ÷ doanh thu dự án" className="block text-xs font-medium text-muted-foreground">{formatPercent(percent)}</span>}
    </td>
  );
}

function HeaderRow({ columns, state, onSort }: Readonly<{
  columns: Column[];
  state: PnlDashboardState;
  onSort: (sort: PnlDashboardSort) => void;
}>) {
  return (
    <tr className="bg-muted/30">
      {columns.map((column) => {
        const sorted = column.sort !== undefined && column.sort === state.sort;
        const className = `${column.numeric ? thNumberClass : column.center ? `${thClass} !text-center` : thClass} !whitespace-normal !px-3 align-bottom`;
        return (
          <th key={column.label} scope="col" title={column.title} aria-sort={sorted ? (state.direction === "asc" ? "ascending" : "descending") : undefined} className={className}>
            {column.sort ? (
              <button type="button" onClick={() => onSort(column.sort!)} title={`${column.title}. Bấm để sắp xếp trên toàn danh sách.`} className="uppercase tracking-wider hover:text-foreground">
                {column.label}
                {sorted ? <span aria-hidden> {state.direction === "asc" ? "↑" : "↓"}</span> : null}
              </button>
            ) : column.label}
          </th>
        );
      })}
    </tr>
  );
}

function ProjectCell({ row, href }: Readonly<{ row: PnlDashboardProjectRow; href: string }>) {
  const why = notComputableWhy(row.result);
  return (
    <td className={`${tdClass} !px-3`}>
      <Link href={href} title="Mở P&L chi tiết của dự án" onClick={(event) => event.stopPropagation()} className="block truncate font-semibold !text-primary hover:underline">
        {row.projectName}
      </Link>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.accountName}{row.picName ? ` · PIC ${row.picName}` : " · chưa có PIC"}</span>
      {row.adjustedAfterClose ? (
        <span title="Dự án nghiệm thu sau khi mọi tháng của kỳ lọc đã khóa sổ" className="mt-1 inline-flex rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          nghiệm thu sau khi khóa sổ
        </span>
      ) : null}
      {/* A "Không tính được" row says why right here, on one line; the whole sentence is in the tooltip. */}
      {why ? <span title={why} className="mt-0.5 block truncate text-xs font-medium text-amber-700">{why}</span> : null}
    </td>
  );
}

function reconciliationText(check: PnlHourReconciliation) {
  return `${formatHoursValue(check.loggedMinutes)} giờ đã ghi = ${formatHoursValue(check.includedMinutes)} giờ đã tính vào P&L + ${formatHoursValue(check.pendingMinutes)} giờ chờ xử lý + ${formatHoursValue(check.excludedMinutes)} giờ không tính vào P&L dự án`;
}

/** Khối 5 — hai tab, bảng dự án, dòng tổng, dòng kiểm tra giờ, phân trang. */
export function DashboardProjectTable({ data, state, moneyVisible, returnTo, onChange, onReset }: Readonly<{
  data: Dashboard;
  state: PnlDashboardState;
  moneyVisible: boolean;
  /** This screen with its filters, so "Quay lại" on the project screen restores them. */
  returnTo: string;
  onChange: (patch: Partial<PnlDashboardState>) => void;
  /** Given while a filter narrows the list: the empty state offers it. */
  onReset?: () => void;
}>) {
  const router = useRouter();
  const all = state.tab === "all";
  const accepted = state.tab === "accepted";
  const list = all ? data.all : accepted ? data.accepted : data.inProgress;
  const columns = all ? ALL_COLUMNS : accepted ? ACCEPTED_COLUMNS : IN_PROGRESS_COLUMNS;
  const pageCount = Math.max(1, Math.ceil(list.total / Math.max(1, list.pageSize)));
  const check = data.accepted.reconciliation;
  const total = data.accepted.totalRow;
  const hrefOf = (row: PnlDashboardProjectRow) => `/pnl/${encodeURIComponent(row.projectId)}?returnTo=${encodeURIComponent(returnTo)}`;
  const sortBy = (sort: PnlDashboardSort) => onChange({ sort, direction: state.sort === sort && state.direction === "asc" ? "desc" : "asc" });
  const totalWhy = whyNoValue(moneyVisible, total.result);

  return (
    <section id="pnl-projects" aria-labelledby="pnl-projects-title" className={`${cardClass} overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
        <div>
          <h2 id="pnl-projects-title" className={sectionTitleClass}>Danh sách dự án</h2>
          <p className={`!mt-0.5 ${mutedNoteClass}`}>Bấm vào một dòng để xem chi tiết P&amp;L của dự án.</p>
        </div>
        <HelpToggle label="Cách đọc bảng này" storageKey="pnl-help-dashboard-table">
          <li>Mỗi dòng là một dự án. Số tiền (đồng) là số của cả vòng đời dự án, không riêng kỳ đang lọc. Bấm tên dự án để xem chi tiết theo tháng.</li>
          <li>Doanh thu dự án do Admin/PM nhập tay theo từng dự án. Dự án đang triển khai vẫn hiện trong bảng; EBIT chỉ tính khi đủ dữ liệu theo kỳ.</li>
          <li>EBIT = doanh thu dự án − chi phí nhân sự − chi phí khác. Dòng nhỏ dưới EBIT là biên EBIT = EBIT ÷ doanh thu dự án.</li>
          <li>{RESULT_MEANING.official} {RESULT_MEANING.provisional}</li>
          <li>{RESULT_MEANING.not_computable} Lý do ghi ngay dưới tên dự án; di chuột vào nhãn ở cột Kết quả để xem đủ.</li>
        </HelpToggle>
      </div>
      <Tabs
        ariaLabel="Nhóm dự án"
        idPrefix="pnl-projects"
        value={state.tab}
        onChange={(tab) => onChange({ tab })}
        tabs={[
          { value: "all", label: <span className="inline-flex items-center gap-2">Tất cả dự án <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{data.all.total}</span></span> },
          { value: "accepted", label: <span className="inline-flex items-center gap-2">Đã nghiệm thu <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{data.accepted.total}</span></span> },
          { value: "in_progress", label: <span className="inline-flex items-center gap-2">Đang triển khai <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{data.inProgress.total}</span></span> }
        ]}
      />
      <div id="pnl-projects-panel" role="tabpanel" aria-labelledby={`pnl-projects-tab-${state.tab}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] table-fixed border-separate border-spacing-0 text-left">
            <colgroup>{columns.map((column) => <col key={column.label} className={column.width} />)}</colgroup>
            <thead>
              <HeaderRow columns={columns} state={state} onSort={sortBy} />
            </thead>
            <tbody>
              {list.rows.length === 0 ? (
                <EmptyRow colSpan={columns.length}>
                  {onReset ? (
                    <>Không có kết quả phù hợp bộ lọc. <button type="button" onClick={onReset} className="font-semibold text-primary hover:underline">Đặt lại bộ lọc</button></>
                  ) : all ? "Chưa có dự án nào phù hợp bộ lọc." : accepted ? "Chưa có dự án đã nghiệm thu nào trong kỳ. Thử xem kỳ dài hơn hoặc đổi “Dự án được tính”." : "Không có dự án đang triển khai nào bắt đầu trong kỳ."}
                </EmptyRow>
              ) : null}
              {list.rows.map((row) => {
                const why = whyNoValue(moneyVisible, row.result);
                return (
                  <tr key={row.projectId} onClick={() => router.push(hrefOf(row))} className="cursor-pointer align-top transition-colors hover:bg-muted/25">
                    <ProjectCell row={row} href={hrefOf(row)} />
                    {all ? (
                      <>
                        <td className={`${tdClass} !px-3 text-center`}><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${row.acceptedOn ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{row.acceptedOn ? "Đã nghiệm thu" : "Đang triển khai"}</span></td>
                        <td className={`${tdClass} !px-3 whitespace-nowrap font-mono tabular-nums`}>
                          {formatMonthShort(row.startedOn)}{row.acceptedOn ? ` → ${formatMonthShort(row.acceptedOn)}` : " → chưa nghiệm thu"}
                          {row.acceptedOnEstimated ? <span title="Dự án chưa có ngày nghiệm thu G7: tháng nghiệm thu chỉ là ước lượng từ giờ ghi cuối và ngày kết thúc kế hoạch" className="block font-sans text-[11px] font-medium text-amber-700">ngày nghiệm thu chưa xác định</span> : null}
                        </td>
                        <Money amount={row.revenueAmount} why={why} />
                        <Money amount={row.totalCostAmount} why={why} />
                        <Money amount={row.ebitAmount} why={why} percent={row.marginPercent} />
                      </>
                    ) : (
                      <>
                        <td className={`${tdClass} !px-3 whitespace-nowrap font-mono tabular-nums`}>
                          {formatMonthShort(row.startedOn)}
                          {accepted ? ` → ${formatMonthShort(row.acceptedOn)}` : ""}
                          {accepted && row.acceptedOnEstimated ? <span title="Dự án chưa có ngày nghiệm thu G7: tháng nghiệm thu chỉ là ước lượng từ giờ ghi cuối và ngày kết thúc kế hoạch" className="block font-sans text-[11px] font-medium text-amber-700">ngày nghiệm thu chưa xác định</span> : null}
                        </td>
                        {accepted ? <Money amount={row.revenueAmount} why={why} /> : null}
                        {!accepted ? <Money amount={row.revenueAmount} why={why} /> : null}
                        <Money amount={row.laborCostAmount} why={why} />
                        <Money amount={row.otherCostAmount} why={why} />
                        {accepted ? <Money amount={row.ebitAmount} why={why} percent={row.marginPercent} /> : <Money amount={row.totalCostAmount} why={why} />}
                      </>
                    )}
                    <td className={`${tdClass} !px-3 text-center`}><ResultBadge result={row.result} /></td>
                  </tr>
                );
              })}
              {accepted && data.accepted.total > 0 ? (
                <tr className="bg-muted/20">
                  <td colSpan={2} className={`${tdClass} !px-3 font-bold`}>Tổng {data.accepted.total} dự án</td>
                  <Money bold amount={total.revenueAmount} why={totalWhy} />
                  <Money bold amount={total.laborCostAmount} why={totalWhy} />
                  <Money bold amount={total.otherCostAmount} why={totalWhy} />
                  <Money bold amount={total.ebitAmount} why={totalWhy} percent={total.marginPercent} />
                  <td className={`${tdClass} !px-3 text-center`}><ResultBadge result={total.result} /></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {accepted ? (
          <p className={`${mutedNoteClass} border-b border-border/70 px-4 py-3`}>
            Kiểm tra giờ: {reconciliationText(check)}
            {check.balanced ? " · khớp" : <span className="font-semibold text-rose-700"> · lệch {formatHoursValue(check.differenceMinutes)} giờ</span>}
            . Dòng tổng bằng các ô tổng phía trên.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          {pageCount > 1 ? (
            <span className="flex items-center gap-1.5">
              <button type="button" disabled={list.page <= 1} onClick={() => onChange({ page: list.page - 1 })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40">‹ Trước</button>
              <button type="button" disabled={list.page >= pageCount} onClick={() => onChange({ page: list.page + 1 })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40">Sau ›</button>
            </span>
          ) : null}
          <p className={mutedNoteClass}>
            Trang {list.page}/{pageCount} · {all ? "hiển thị mọi dự án; các ô tổng chỉ tính dự án đủ điều kiện P&L" : accepted ? "các ô tổng và thứ tự sắp xếp tính trên toàn bộ danh sách, không riêng trang này" : "sắp xếp trên toàn bộ danh sách; không cộng vào các ô tổng"}
          </p>
        </div>
      </div>
    </section>
  );
}
