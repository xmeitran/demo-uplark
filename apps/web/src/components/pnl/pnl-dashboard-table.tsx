"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PnlDashboardProjectRow, PnlDashboardResponse, PnlHourReconciliation } from "@b2b-crm/contracts";
import { formatExactVnd, formatHoursValue, formatMillions, formatMonthShort, formatPercent } from "./pnl-format";
import type { PnlDashboardSort, PnlDashboardState } from "./pnl-query";
import { EmptyRow, ResultBadge, Tabs, cardClass, mutedNoteClass, tdClass, tdNumberClass, thClass, thNumberClass } from "./pnl-ui";

type Dashboard = PnlDashboardResponse["data"];
type Column = { label: string; sort?: PnlDashboardSort; numeric?: boolean; center?: boolean };

const ACCEPTED_COLUMNS: Column[] = [
  { label: "Dự án / Khách hàng", sort: "name" },
  { label: "PIC" },
  { label: "Bắt đầu → NT", sort: "start" },
  { label: "DT ghi nhận", sort: "revenue", numeric: true },
  { label: "CP nhân sự", sort: "laborCost", numeric: true },
  { label: "CP khác", sort: "otherCost", numeric: true },
  { label: "EBIT", sort: "ebit", numeric: true },
  { label: "Biên", sort: "margin", numeric: true },
  { label: "Kết quả", center: true }
];

const IN_PROGRESS_COLUMNS: Column[] = [
  { label: "Dự án / Khách hàng", sort: "name" },
  { label: "PIC" },
  { label: "Bắt đầu", sort: "start" },
  { label: "CP nhân sự", sort: "laborCost", numeric: true },
  { label: "CP khác", sort: "otherCost", numeric: true },
  { label: "Tổng chi phí tới nay", numeric: true },
  { label: "Kết quả", center: true }
];

/** Whole "triệu đồng" as drawn, one decimal kept when the figure has one; the exact đồng is in the tooltip. */
function Money({ amount, bold = false }: Readonly<{ amount: number | null; bold?: boolean }>) {
  return <td title={formatExactVnd(amount)} className={`${tdNumberClass} ${bold ? "font-bold" : ""}`}>{formatMillions(amount, "overview")}</td>;
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
        const className = column.numeric ? thNumberClass : column.center ? `${thClass} !text-center` : thClass;
        return (
          <th key={column.label} scope="col" aria-sort={sorted ? (state.direction === "asc" ? "ascending" : "descending") : undefined} className={className}>
            {column.sort ? (
              <button type="button" onClick={() => onSort(column.sort!)} title="Sắp xếp trên toàn danh sách" className="uppercase tracking-wider hover:text-foreground">
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

function ProjectCell({ row }: Readonly<{ row: PnlDashboardProjectRow }>) {
  return (
    <td className={tdClass}>
      <Link href={`/pnl/${encodeURIComponent(row.projectId)}`} onClick={(event) => event.stopPropagation()} className="font-semibold !text-foreground hover:!text-primary">
        {row.projectName} · {row.accountName}
      </Link>
      {row.adjustedAfterClose ? (
        <span title="Dự án nghiệm thu sau khi mọi tháng của kỳ lọc đã khóa" className="ml-2 inline-flex rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          điều chỉnh sau chốt
        </span>
      ) : null}
    </td>
  );
}

function reconciliationText(check: PnlHourReconciliation) {
  return `giờ đã ghi ${formatHoursValue(check.loggedMinutes)} = tính P&L ${formatHoursValue(check.includedMinutes)} + chờ ${formatHoursValue(check.pendingMinutes)} + bị loại ${formatHoursValue(check.excludedMinutes)}`;
}

/** Khối 5 — hai tab, bảng dự án, dòng tổng, dòng đối soát, phân trang. */
export function DashboardProjectTable({ data, state, onChange }: Readonly<{
  data: Dashboard;
  state: PnlDashboardState;
  onChange: (patch: Partial<PnlDashboardState>) => void;
}>) {
  const router = useRouter();
  const accepted = state.tab === "accepted";
  const list = accepted ? data.accepted : data.inProgress;
  const columns = accepted ? ACCEPTED_COLUMNS : IN_PROGRESS_COLUMNS;
  const pageCount = Math.max(1, Math.ceil(list.total / Math.max(1, list.pageSize)));
  const check = data.accepted.reconciliation;
  const total = data.accepted.totalRow;
  const open = (row: PnlDashboardProjectRow) => router.push(`/pnl/${encodeURIComponent(row.projectId)}`);
  const sortBy = (sort: PnlDashboardSort) => onChange({ sort, direction: state.sort === sort && state.direction === "asc" ? "desc" : "asc" });

  return (
    <section aria-label="Bảng dự án" className={cardClass}>
      <Tabs
        ariaLabel="Nhóm dự án"
        idPrefix="pnl-projects"
        value={state.tab}
        onChange={(tab) => onChange({ tab })}
        tabs={[
          { value: "accepted", label: `Đã nghiệm thu (${data.accepted.total})` },
          { value: "in_progress", label: `Đang triển khai (${data.inProgress.total}) · chỉ chi phí, không cộng vào tổng` }
        ]}
      />
      <div id="pnl-projects-panel" role="tabpanel" aria-labelledby={`pnl-projects-tab-${state.tab}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left">
            <thead>
              <HeaderRow columns={columns} state={state} onSort={sortBy} />
            </thead>
            <tbody>
              {list.rows.length === 0 ? (
                <EmptyRow colSpan={columns.length}>
                  {accepted ? "Không có dự án đã nghiệm thu nào khớp bộ lọc. Thử xem kỳ dài hơn hoặc đổi quy tắc chọn dự án." : "Không có dự án đang triển khai nào bắt đầu trong kỳ."}
                </EmptyRow>
              ) : null}
              {list.rows.map((row) => (
                <tr key={row.projectId} onClick={() => open(row)} className="cursor-pointer transition-colors hover:bg-muted/25">
                  <ProjectCell row={row} />
                  <td className={tdClass}>{row.picName ?? "—"}</td>
                  <td className={`${tdClass} whitespace-nowrap font-mono tabular-nums`}>
                    {formatMonthShort(row.startedOn)}
                    {accepted ? ` → ${formatMonthShort(row.acceptedOn)}` : ""}
                    {accepted && row.acceptedOnEstimated ? <span title="Dự án chưa có ngày G7: tháng nghiệm thu chỉ là ước lượng từ giờ log cuối và ngày kết thúc kế hoạch" className="block font-sans text-[11px] font-medium text-amber-700">ngày nghiệm thu chưa xác định</span> : null}
                  </td>
                  {accepted ? <Money amount={row.revenueAmount} /> : null}
                  <Money amount={row.laborCostAmount} />
                  <Money amount={row.otherCostAmount} />
                  {accepted ? <Money amount={row.ebitAmount} /> : <Money amount={row.totalCostAmount} />}
                  {accepted ? <td className={tdNumberClass}>{formatPercent(row.marginPercent)}</td> : null}
                  <td className={`${tdClass} text-center`}><ResultBadge result={row.result} /></td>
                </tr>
              ))}
              {accepted && data.accepted.total > 0 ? (
                <tr className="bg-muted/20">
                  <td colSpan={3} className={`${tdClass} font-bold`}>Tổng {data.accepted.total} dự án</td>
                  <Money bold amount={total.revenueAmount} />
                  <Money bold amount={total.laborCostAmount} />
                  <Money bold amount={total.otherCostAmount} />
                  <Money bold amount={total.ebitAmount} />
                  <td className={`${tdNumberClass} font-bold`}>{formatPercent(total.marginPercent)}</td>
                  <td className={`${tdClass} text-center`}><ResultBadge result={total.result} /></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {accepted ? (
          <p className={`${mutedNoteClass} border-b border-border/70 px-4 py-3`}>
            Đối soát: dòng tổng = năm ô tổng phía trên · {reconciliationText(check)}
            {check.balanced ? null : <span className="font-semibold text-rose-700"> · lệch {formatHoursValue(check.differenceMinutes)} giờ</span>}
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
            Trang {list.page}/{pageCount} · {accepted ? "ô tổng và sắp xếp tính trên toàn danh sách" : "sắp xếp tính trên toàn danh sách; không cộng vào ô tổng"}
          </p>
        </div>
      </div>
    </section>
  );
}
