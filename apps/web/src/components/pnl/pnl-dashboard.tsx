"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { PnlCompanyCostDetailResponse, PnlCompanyCostLine, PnlDashboardResponse } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { FilterBar } from "@/components/filters/filter-controls";
import { DashboardProjectTable } from "./pnl-dashboard-table";
import { formatExactVnd, formatHoursValue, formatMillions, formatMonth, formatPercent, formatUpdatedAt } from "./pnl-format";
import {
  PNL_PERIOD_UNITS, PNL_RULES, dashboardApiQuery, dashboardSearch, parseDashboardState, patchDashboardState, pendingHoursHref, periodIndexOptions,
  type PnlDashboardState
} from "./pnl-query";
import {
  EmptyRow, MiniTile, MoneyHiddenNote, PnlLoadError, PnlPageHeader, PnlSkeleton, RESULT_TEXT_CLASS, Segmented, Tile, WarningStrip,
  cardClass, mutedNoteClass, sectionTitleClass, tdClass, tdNumberClass, thClass, thNumberClass, usePnlLoad, warningActionClass
} from "./pnl-ui";

type Dashboard = PnlDashboardResponse["data"];
type Patch = (patch: Partial<PnlDashboardState>) => void;

const COST_VIEWS = [
  { value: "accounting", label: "Nhóm hạch toán" },
  { value: "role", label: "Vai trò" }
] as const;

/** Khối 1 — bộ lọc và dòng trạng thái ngay dưới. */
function DashboardFilters({ filter, state, generatedAt, onChange }: Readonly<{
  filter: Dashboard["filter"];
  state: PnlDashboardState;
  generatedAt: string;
  onChange: Patch;
}>) {
  const years = [...new Set([...filter.options.years, state.year])].sort((a, b) => b - a);
  const indexOptions = periodIndexOptions(state.unit);
  return (
    <section aria-label="Bộ lọc" className="space-y-2">
      <FilterBar>
        <div className="w-[8.5rem] shrink-0">
          <CrmSelect
            ariaLabel="Năm"
            value={String(state.year)}
            onChange={(year) => onChange({ year: Number(year) })}
            options={years.map((year) => ({ value: String(year), label: `Năm ${year}` }))}
          />
        </div>
        <Segmented ariaLabel="Loại kỳ" value={state.unit} options={PNL_PERIOD_UNITS} onChange={(unit) => onChange({ unit })} />
        {indexOptions.length ? (
          <div className="w-[8rem] shrink-0">
            <CrmSelect ariaLabel="Kỳ trong năm" value={String(state.index)} onChange={(index) => onChange({ index: Number(index) })} options={indexOptions} />
          </div>
        ) : null}
        <div className="min-w-[15rem] flex-1">
          <CrmSelect ariaLabel="Quy tắc chọn dự án" value={state.rule} onChange={(rule) => onChange({ rule: rule as PnlDashboardState["rule"] })} options={PNL_RULES} />
        </div>
        <div className="w-[7.5rem] shrink-0">
          <CrmSelect
            ariaLabel="Loại dự án"
            value={state.projectType}
            onChange={(projectType) => onChange({ projectType })}
            options={[{ value: "", label: "Loại DA" }, ...filter.options.projectTypes]}
          />
        </div>
        <div className="w-[7.5rem] shrink-0">
          <CrmSelect
            ariaLabel="Khách hàng"
            searchable
            value={state.accountId}
            onChange={(accountId) => onChange({ accountId })}
            options={[{ value: "", label: "KH" }, ...filter.options.accounts.map((account) => ({ value: account.id, label: account.name }))]}
          />
        </div>
        <div className="w-[7.5rem] shrink-0">
          <CrmSelect
            ariaLabel="PIC"
            searchable
            value={state.picUserId}
            onChange={(picUserId) => onChange({ picUserId })}
            options={[{ value: "", label: "PIC" }, ...filter.options.pics.map((pic) => ({ value: pic.id, label: pic.name }))]}
          />
        </div>
      </FilterBar>
      <p className={mutedNoteClass}>
        Đang tính {filter.countedProjectCount} dự án · đã loại {filter.excludedTestProjectCount} dự án thử nghiệm · số liệu cập nhật {formatUpdatedAt(generatedAt)}
      </p>
      {state.unit === "quarter" || state.unit === "month" ? <p className={mutedNoteClass}>Gợi ý: {filter.hint}</p> : null}
    </section>
  );
}

/** Khối 2 — năm ô tổng. */
function DashboardTotals({ totals }: Readonly<{ totals: Dashboard["totals"] }>) {
  return (
    <section aria-label="Năm ô tổng" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Tile label="Dự án" value={totals.projectCount} note="đã nghiệm thu" />
      <Tile label="Doanh thu ghi nhận" value={formatMillions(totals.revenueAmount, "overview")} title={formatExactVnd(totals.revenueAmount)} note="ghi nhận tại G7" />
      <Tile
        label="Tổng chi phí"
        value={formatMillions(totals.totalCostAmount, "overview")}
        title={formatExactVnd(totals.totalCostAmount)}
        note={`NS ${formatMillions(totals.laborCostAmount, "overview")} · khác ${formatMillions(totals.otherCostAmount, "overview")}`}
      />
      <Tile
        label="EBIT"
        value={formatMillions(totals.ebitAmount, "overview")}
        title={formatExactVnd(totals.ebitAmount)}
        note={<span title={totals.result.reasons.map((reason) => reason.label).join(" · ") || undefined}>{totals.result.labelText}</span>}
        noteClass={`font-medium ${RESULT_TEXT_CLASS[totals.result.label]}`}
      />
      <Tile label="Biên EBIT" value={formatPercent(totals.marginPercent)} note="tổng EBIT ÷ tổng DT" />
    </section>
  );
}

/** Khối 4 — chi phí theo nhóm; bấm một nhóm thì bảng dự án lọc theo nhóm đó. */
function DashboardCostGroups({ groups, state, onChange }: Readonly<{
  groups: Dashboard["costGroups"];
  state: PnlDashboardState;
  onChange: Patch;
}>) {
  const list = groups[state.view];
  const active = list.find((group) => group.key === state.groupKey);
  return (
    <section aria-labelledby="pnl-cost-groups-title" className={`${cardClass} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pnl-cost-groups-title" className={sectionTitleClass}>Chi phí theo nhóm, sinh từ cây khoản mục</h2>
        <Segmented ariaLabel="Cách xem nhóm chi phí" value={state.view} options={COST_VIEWS} onChange={(view) => onChange({ view })} />
      </div>
      {list.length === 0 ? <p className={mutedNoteClass}>Chưa có nhóm chi phí nào trong kỳ.</p> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {list.map((group) => (
          <MiniTile
            key={group.key}
            label={group.label}
            title={formatExactVnd(group.amount)}
            value={`${formatMillions(group.amount, "overview")} · ${formatPercent(group.sharePercent, 0)}`}
            pressed={group.key === state.groupKey}
            onClick={() => onChange({ groupKey: group.key === state.groupKey ? "" : group.key })}
          />
        ))}
      </div>
      {active ? (
        <p className={mutedNoteClass}>
          Bảng dự án đang lọc theo nhóm “{active.label}”.{" "}
          <button type="button" onClick={() => onChange({ groupKey: "" })} className="font-semibold text-primary hover:underline">Bỏ lọc</button>
        </p>
      ) : null}
    </section>
  );
}

/** Danh sách theo người và dự án của một dòng cấp công ty (khối 6, bấm một dòng). */
function CompanyCostDetail({ line, from, to }: Readonly<{ line: PnlCompanyCostLine; from: string; to: string }>) {
  const url = `/api/pnl/company-costs?from=${from}&to=${to}&line=${line.key}`;
  const { data, error, loading, reload } = usePnlLoad<PnlCompanyCostDetailResponse>(url);
  if (error) return <PnlLoadError error={error} onRetry={reload} />;
  if (!data) return <p className={mutedNoteClass}>{loading ? "Đang tải danh sách…" : null}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
        <caption className="px-4 py-2 text-left text-xs font-semibold text-foreground">{line.label} · theo người và dự án</caption>
        <thead>
          <tr className="bg-muted/30">
            <th scope="col" className={thClass}>Tháng</th>
            <th scope="col" className={thClass}>Nhân sự</th>
            <th scope="col" className={thClass}>Dự án</th>
            <th scope="col" className={thNumberClass}>Giờ</th>
            <th scope="col" className={thNumberClass}>Chi phí</th>
          </tr>
        </thead>
        <tbody>
          {data.data.length === 0 ? <EmptyRow colSpan={5}>Không có dòng nào trong kỳ.</EmptyRow> : null}
          {data.data.map((row, index) => (
            <tr key={`${row.periodKey}-${row.userId}-${row.projectId}-${index}`}>
              <td className={`${tdClass} font-mono tabular-nums`}>{formatMonth(row.periodKey)}</td>
              <td className={tdClass}>{row.userName ?? "—"}</td>
              <td className={tdClass}>{row.projectName ?? "—"}</td>
              <td className={tdNumberClass}>{formatHoursValue(row.minutes)}</td>
              <td title={formatExactVnd(row.amount)} className={tdNumberClass}>{formatMillions(row.amount, "table")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tên ô của khối 6 như wireframe vẽ; tên đầy đủ của dòng (PL-12, `line.label`) nằm ở danh sách mở ra bên dưới. */
const COMPANY_TILE_LABELS: Record<PnlCompanyCostLine["key"], string> = { pre_sale: "Pre-sale (deal thua)", after_close: "Sau nghiệm thu", internal: "Nội bộ", unallocated: "Chưa phân bổ" };

/** Khối 6 — chi phí ngoài P&L dự án (dòng cấp công ty). Không cộng vào năm ô tổng. */
function DashboardCompanyCosts({ companyCosts }: Readonly<{ companyCosts: Dashboard["companyCosts"] }>) {
  const [openKey, setOpenKey] = useState<PnlCompanyCostLine["key"] | null>(null);
  const openLine = companyCosts.lines.find((line) => line.key === openKey);
  const months = companyCosts.periodKeys;
  return (
    <section aria-labelledby="pnl-company-costs-title" className={`${cardClass} space-y-3 p-4`}>
      <h2 id="pnl-company-costs-title" className={sectionTitleClass}>Chi phí ngoài P&amp;L dự án · theo tháng phát sinh trong kỳ</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {companyCosts.lines.map((line) => (
          <MiniTile
            key={line.key}
            label={COMPANY_TILE_LABELS[line.key]}
            title={[line.label, formatExactVnd(line.amount)].filter(Boolean).join(" · ")}
            value={formatMillions(line.amount, "overview")}
            note={line.uncostedMinutes > 0 ? `còn ${formatHoursValue(line.uncostedMinutes)} giờ chưa có cost rate` : undefined}
            expanded={line.key === openKey}
            onClick={() => setOpenKey(line.key === openKey ? null : line.key)}
          />
        ))}
      </div>
      {companyCosts.overAllocatedAmount ? (
        <p role="note" title={formatExactVnd(companyCosts.overAllocatedAmount)} className="text-xs font-medium text-amber-700">
          Giờ ghi vượt giờ chuẩn tháng: chi phí đã tính vào dự án và ba dòng trên nhiều hơn tổng chi phí nhân sự {formatMillions(companyCosts.overAllocatedAmount, "overview")} · “Chưa phân bổ” dừng ở 0
        </p>
      ) : null}
      {openLine && months.length ? <CompanyCostDetail line={openLine} from={months[0]} to={months[months.length - 1]} /> : null}
    </section>
  );
}

/** Màn Tổng quan P&L (mục 4): chỉ báo cáo tiền của dự án đã nghiệm thu. Mọi con số là số API trả về. */
export function PnlDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYear = useMemo(() => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date())), []);
  const state = useMemo(() => parseDashboardState(new URLSearchParams(searchParams.toString()), currentYear), [searchParams, currentYear]);
  const { data: payload, error, loading, reload } = usePnlLoad<PnlDashboardResponse>(`/api/pnl/dashboard?${dashboardApiQuery(state)}`);

  const change: Patch = (patch) => {
    const query = dashboardSearch(patchDashboardState(state, patch), currentYear);
    router.replace(query ? `/pnl?${query}` : "/pnl", { scroll: false });
  };

  const data = payload?.data;
  return (
    <AppShell activeRoute="/pnl" title="P&L">
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4 xl:p-6">
        <PnlPageHeader unitNote="Đơn vị: triệu đồng" />
        {error ? <PnlLoadError error={error} onRetry={reload} /> : null}
        {!data && !error ? <PnlSkeleton /> : null}
        {data && payload ? (
          <div aria-busy={loading} className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
            <DashboardFilters filter={data.filter} state={state} generatedAt={payload.meta.generatedAt} onChange={change} />
            {payload.meta.moneyVisible ? null : <MoneyHiddenNote />}
            <DashboardTotals totals={data.totals} />
            {data.pending.length ? (
              <WarningStrip
                action={
                  <Link href={pendingHoursHref({ from: data.filter.fromPeriodKey, to: data.filter.toPeriodKey })} className={warningActionClass}>
                    Xem danh sách ›
                  </Link>
                }
              >
                Tạm tính vì: {data.pending.map((item) => item.label).join(" · ")}
              </WarningStrip>
            ) : null}
            <DashboardCostGroups groups={data.costGroups} state={state} onChange={change} />
            <DashboardProjectTable data={data} state={state} onChange={change} />
            <DashboardCompanyCosts companyCosts={data.companyCosts} />
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
