"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { FolderKanban, Percent, Receipt, TrendingUp, Wallet } from "lucide-react";
import type { PnlCompanyCostDetailResponse, PnlCompanyCostLine, PnlDashboardResponse, PnlMeta } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { DateRangeFilter, FilterField, MultiSelectFilter, PersonFilter, SearchFilter } from "@/components/filters";
import { HeaderLinkButton, PageHeader, pageMainClassName } from "@/components/page-header";
import { toVietnamDateKey } from "@/lib/vietnam-time";
import { DashboardProjectTable } from "./pnl-dashboard-table";
import { formatExactVnd, formatHoursValue, formatMonth, formatPercent, formatUpdatedAt, formatVndAmount, monthsBetween } from "./pnl-format";
import { COST_GROUP_ONLY, STAFF_COST_PHRASE, plainPending, resultExplanation } from "./pnl-plain";
import {
  PNL_RULES, dashboardApiQuery, dashboardFilterCount, dashboardPeriodPresets, dashboardSearch, monthsToDays, parseDashboardState, patchDashboardState, pendingHoursHref,
  resetDashboardFilters, snapToMonths, type PnlDashboardState
} from "./pnl-query";
import {
  EmptyRow, MiniTile, MoneyHiddenNote, PnlLoadError, PnlSkeleton, RESULT_TEXT_CLASS, Segmented, Tile,
  cardClass, mutedNoteClass, sectionTitleClass, tdClass, tdNumberClass, thClass, thNumberClass, useDebouncedText, usePnlLoad
} from "./pnl-ui";

type Dashboard = PnlDashboardResponse["data"];
type Patch = (patch: Partial<PnlDashboardState>) => void;

const COST_VIEWS = [
  { value: "accounting", label: "Nhóm hạch toán" },
  { value: "role", label: "Vai trò" }
] as const;

const RULE_SENTENCE: Record<PnlDashboardState["rule"], string> = {
  started_and_accepted: "bắt đầu trong kỳ và đến nay đã nghiệm thu",
  accepted_in_period: "nghiệm thu trong kỳ"
};

/** Khối 1 — bộ lọc và dòng trạng thái ngay dưới. Dàn theo grid để nhãn không bị dính khi màn hình rộng vừa. */
function DashboardFilters({ filter, allProjectCount, state, generatedAt, activeCount, onChange, onReset }: Readonly<{
  filter: Dashboard["filter"];
  allProjectCount: number;
  state: PnlDashboardState;
  generatedAt: string;
  activeCount: number;
  onChange: Patch;
  onReset: () => void;
}>) {
  const presets = useMemo(() => dashboardPeriodPresets(toVietnamDateKey(new Date())), []);
  // Picked days are rounded to whole months before they reach the URL, so the control shows what is computed.
  const pickPeriod = (days: { from: string; to: string }) => {
    const months = snapToMonths(days);
    if (months) onChange(months);
  };
  // Typing does not re-query on every key: the search goes to the URL (and the API) once the viewer pauses.
  const [search, setSearch] = useDebouncedText(state.q, (q) => onChange({ q }));

  return (
    <section aria-label="Bộ lọc P&L" className={`${cardClass} overflow-visible`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Báo cáo P&amp;L</p>
          <h2 className="!mt-1 text-sm font-bold text-foreground">Lọc danh sách dự án</h2>
          <p className="!mt-0.5 text-xs text-muted-foreground">Chọn phạm vi cần xem. Các bộ lọc sẽ được lưu trên đường dẫn.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">{allProjectCount} dự án</span>
          {activeCount ? (
            <button type="button" onClick={onReset} className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-semibold text-primary transition-colors hover:bg-primary/10">
              Xóa bộ lọc · {activeCount}
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-12">
        <FilterField label="Tìm kiếm" className="min-w-0 sm:col-span-2 xl:col-span-4">
          <SearchFilter value={search} onChange={setSearch} placeholder="Tên dự án, mã dự án hoặc khách hàng..." ariaLabel="Tìm dự án hoặc khách hàng" className="w-full" />
        </FilterField>
        <FilterField label="Kỳ báo cáo" className="min-w-0 xl:col-span-2">
          <DateRangeFilter ariaLabel="Kỳ báo cáo" value={monthsToDays(state)} onChange={pickPeriod} presets={presets} clearable={false} />
        </FilterField>
        <PersonFilter label="PIC" people={filter.options.pics} values={state.picUserId} onChange={(picUserId) => onChange({ picUserId })} allLabel="Tất cả PIC" searchPlaceholder="Tìm theo tên PIC..." className="min-w-0 xl:col-span-2" />
        <FilterField label="Phạm vi tính P&L" className="min-w-0 xl:col-span-4">
          <CrmSelect ariaLabel="Phạm vi tính P&L" value={state.rule} onChange={(rule) => onChange({ rule: rule as PnlDashboardState["rule"] })} options={PNL_RULES} />
        </FilterField>
        <MultiSelectFilter label="Loại dự án" options={filter.options.projectTypes} values={state.projectType} onChange={(projectType) => onChange({ projectType })} allLabel="Tất cả loại dự án" className="min-w-0 sm:col-span-1 xl:col-span-3" />
        <MultiSelectFilter label="Khách hàng" options={filter.options.accounts.map((account) => ({ value: account.id, label: account.name }))} values={state.accountId} onChange={(accountId) => onChange({ accountId })} allLabel="Tất cả khách hàng" searchPlaceholder="Tìm khách hàng..." className="min-w-0 sm:col-span-1 xl:col-span-3" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        <span>Đang hiển thị <strong className="text-foreground">{allProjectCount}</strong> dự án</span>
        <span aria-hidden className="text-border">•</span>
        <span>Tính P&amp;L cho <strong className="text-foreground">{filter.countedProjectCount}</strong> dự án {RULE_SENTENCE[filter.rule]}</span>
        <span aria-hidden className="text-border">•</span>
        <span>Cập nhật {formatUpdatedAt(generatedAt)}</span>
        {filter.excludedTestProjectCount ? <><span aria-hidden className="text-border">•</span><span>{filter.excludedTestProjectCount} dự án thử nghiệm không tính</span></> : null}
        {monthsBetween(state.fromMonth, state.toMonth).length <= 3 ? <span className="basis-full text-[11px] text-muted-foreground">Gợi ý: {filter.hint}</span> : null}
      </div>
    </section>
  );
}

/** Khối 2 — năm ô tổng. Mỗi ô có một dòng nói con số là gì; ô chưa có số ghi lý do. */
function DashboardTotals({ totals, moneyVisible }: Readonly<{ totals: Dashboard["totals"]; moneyVisible: boolean }>) {
  const whyEmpty = !moneyVisible ? COST_GROUP_ONLY
    : totals.projectCount === 0 ? "Chưa có dự án đã nghiệm thu nào khớp bộ lọc"
      : totals.notComputableProjectCount >= totals.projectCount ? "Các dự án trong kỳ chưa tính được lãi lỗ (xem cột Kết quả)"
        : "Chưa có số liệu";
  const waiting = totals.notComputableProjectCount;
  return (
    <>
      <section aria-label="Năm ô tổng" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile icon={FolderKanban} color="#0891b2" label="Dự án được tính" hint="Số dự án đủ điều kiện để cộng vào các ô tổng P&L" value={totals.projectCount} note={waiting ? `${waiting} dự án chưa tính được · xem lý do bên dưới` : totals.projectCount ? "đã cộng vào các ô tổng" : "chưa có dự án nào"} noteClass={waiting ? "font-medium text-amber-700" : undefined} />
      <Tile icon={Wallet} color="#2563eb" label="Giá trị dự án" hint="Giá trị dự án do Admin/PM nhập tay; đây không phải Budget tự động" value={formatVndAmount(totals.revenueAmount)} title={formatExactVnd(totals.revenueAmount)} note="Doanh thu nhập tay · VND" whyEmpty={whyEmpty} />
      <Tile
        icon={Receipt}
        color="#7c3aed"
        label="Tổng chi phí"
        hint="Chi phí nhân sự đã duyệt + chi phí khác của các dự án"
        value={formatVndAmount(totals.totalCostAmount)}
        title={formatExactVnd(totals.totalCostAmount)}
        note={`Nhân sự ${formatVndAmount(totals.laborCostAmount)} · khác ${formatVndAmount(totals.otherCostAmount)}`}
        whyEmpty={whyEmpty}
      />
      <Tile
        icon={TrendingUp}
        color="#16a34a"
        label="EBIT"
        hint="EBIT = giá trị dự án − tổng chi phí"
        value={formatVndAmount(totals.ebitAmount)}
        title={formatExactVnd(totals.ebitAmount)}
        note={<span title={resultExplanation(totals.result)} className="cursor-help">{totals.result.labelText}</span>}
        noteClass={`font-medium ${RESULT_TEXT_CLASS[totals.result.label]}`}
        whyEmpty={whyEmpty}
      />
      <Tile icon={Percent} color="#d97706" label="Biên EBIT" hint="Biên EBIT = EBIT ÷ giá trị dự án" value={formatPercent(totals.marginPercent)} note="tỷ lệ lãi trên dự án được tính" whyEmpty={whyEmpty} />
      </section>
      <section aria-label="Cách tính P&L" className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-xs text-sky-950 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <strong className="text-sm">Cách đọc số liệu</strong>
          <span>Giá trị dự án = số tiền Admin/PM nhập tay</span>
          <span>Tổng chi phí = nhân sự đã duyệt + chi phí khác</span>
          <span>EBIT = giá trị dự án − tổng chi phí</span>
          <span>Biên EBIT = EBIT ÷ giá trị dự án</span>
        </div>
        {waiting ? <p className="!mt-1.5 font-medium text-amber-800">{waiting} dự án chưa được cộng vào các ô tổng vì còn thiếu dữ liệu bắt buộc; xem trạng thái và lý do ngay dưới tên từng dự án.</p> : null}
      </section>
    </>
  );
}

/** Khối 3 — vì sao số còn tạm tính: mỗi dòng một câu, một số đếm và một nơi sửa. Đủ dữ liệu thì gọn còn một dòng. */
function DashboardPending({ data, meta }: Readonly<{ data: Dashboard; meta: PnlMeta }>) {
  if (!data.pending.length) {
    if (!data.totals.projectCount || data.totals.result.label !== "official") return null;
    return <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">Mọi số liệu trong kỳ là Chính thức: đủ dữ liệu và các tháng đã khóa sổ.</p>;
  }
  const mayFixCosts = meta.canEdit || meta.canApprove;
  const items = data.pending.map((item) => plainPending(item, { from: data.filter.fromPeriodKey, to: data.filter.toPeriodKey }));
  return (
    <section aria-labelledby="pnl-why-title" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
      <h2 id="pnl-why-title" className="!text-sm font-bold">Vì sao số liệu còn tạm tính?</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
        {items.map((item) => (
          <li key={item.kind}>
            {item.text}{" "}
            {item.open || mayFixCosts ? <Link href={item.href} className="whitespace-nowrap font-semibold !text-amber-900 underline underline-offset-2 hover:!text-amber-700">{item.actionLabel} ›</Link> : null}
          </li>
        ))}
      </ul>
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
        <div className="min-w-0">
          <h2 id="pnl-cost-groups-title" className={sectionTitleClass}>Chi phí theo nhóm</h2>
          <p className={`!mt-0.5 ${mutedNoteClass}`}>Tổng chi phí ở trên chia theo nhóm (đồng · tỷ trọng). Bấm một nhóm để bảng dự án chỉ hiện dự án có chi phí nhóm đó.</p>
        </div>
        <Segmented ariaLabel="Cách xem nhóm chi phí" value={state.view} options={COST_VIEWS} onChange={(view) => onChange({ view })} />
      </div>
      {list.length === 0 ? <p className={mutedNoteClass}>Chưa có nhóm chi phí nào trong kỳ.</p> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {list.map((group) => (
          <MiniTile
            key={group.key}
            label={group.label}
            title={formatExactVnd(group.amount)}
            value={`${formatVndAmount(group.amount)} · ${formatPercent(group.sharePercent, 0)}`}
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
              <td title={formatExactVnd(row.amount)} className={tdNumberClass}>{formatVndAmount(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tên ô của khối 6; tên đầy đủ của dòng (PL-12, `line.label`) nằm ở danh sách mở ra bên dưới. */
const COMPANY_TILE_LABELS: Record<PnlCompanyCostLine["key"], string> = { pre_sale: "Pre-sale của deal thua", after_close: "Sau nghiệm thu", internal: "Việc nội bộ", unallocated: "Chưa phân bổ" };

/** Khối 6 — chi phí ngoài P&L dự án (dòng cấp công ty). Không cộng vào năm ô tổng. */
function DashboardCompanyCosts({ companyCosts }: Readonly<{ companyCosts: Dashboard["companyCosts"] }>) {
  const [openKey, setOpenKey] = useState<PnlCompanyCostLine["key"] | null>(null);
  const openLine = companyCosts.lines.find((line) => line.key === openKey);
  const months = companyCosts.periodKeys;
  return (
    <section aria-labelledby="pnl-company-costs-title" className={`${cardClass} space-y-3 p-4`}>
      <div>
        <h2 id="pnl-company-costs-title" className={sectionTitleClass}>Chi phí nhân sự không thuộc P&amp;L dự án</h2>
        <p className={`!mt-0.5 ${mutedNoteClass}`}>Chi phí nhân sự của các tháng trong kỳ không vào dự án nào: pre-sale của deal thua, việc sau nghiệm thu, việc nội bộ và phần chưa phân bổ. Không cộng vào các ô tổng phía trên. Bấm một ô để xem theo người và dự án.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {companyCosts.lines.map((line) => (
          <MiniTile
            key={line.key}
            label={COMPANY_TILE_LABELS[line.key]}
            title={[line.label, formatExactVnd(line.amount)].filter(Boolean).join(" · ")}
            value={formatVndAmount(line.amount)}
            note={line.uncostedMinutes > 0 ? `còn ${formatHoursValue(line.uncostedMinutes)} giờ chưa có ${STAFF_COST_PHRASE}` : undefined}
            expanded={line.key === openKey}
            onClick={() => setOpenKey(line.key === openKey ? null : line.key)}
          />
        ))}
      </div>
      {companyCosts.overAllocatedAmount ? (
        <p role="note" title={formatExactVnd(companyCosts.overAllocatedAmount)} className="text-xs font-medium text-amber-700">
          Có người ghi giờ nhiều hơn giờ chuẩn của tháng: chi phí đã tính vào dự án và ba dòng trên lớn hơn tổng chi phí nhân sự {formatVndAmount(companyCosts.overAllocatedAmount)}, nên “Chưa phân bổ” dừng ở 0.
        </p>
      ) : null}
      {openLine && months.length ? <CompanyCostDetail line={openLine} from={months[0]} to={months[months.length - 1]} /> : null}
    </section>
  );
}

/** Màn P&L dự án — tổng quan (mục 4): chỉ báo cáo tiền của dự án đã nghiệm thu. Mọi con số là số API trả về. */
export function PnlDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYear = useMemo(() => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date())), []);
  const state = useMemo(() => parseDashboardState(new URLSearchParams(searchParams.toString()), currentYear), [searchParams, currentYear]);
  const { data: payload, error, loading, reload } = usePnlLoad<PnlDashboardResponse>(`/api/pnl/dashboard?${dashboardApiQuery(state)}`);

  const go = (next: PnlDashboardState) => {
    const query = dashboardSearch(next, currentYear);
    router.replace(query ? `/pnl?${query}` : "/pnl", { scroll: false });
  };
  const change: Patch = (patch) => go(patchDashboardState(state, patch));
  const reset = () => go(resetDashboardFilters(state, currentYear));
  const activeCount = dashboardFilterCount(state, currentYear);
  const ownQuery = dashboardSearch(state, currentYear);

  const data = payload?.data;
  const meta = payload?.meta;
  const mayFixCosts = Boolean(meta && (meta.canEdit || meta.canApprove));
  return (
    <AppShell activeRoute="/pnl" title="P&L dự án">
      <main className={pageMainClassName}>
        <PageHeader
          title="P&L dự án"
          subtitle="Theo dõi doanh thu, chi phí và EBIT của toàn bộ dự án trong workspace."
          meta="Đơn vị: đồng"
          actions={
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card p-1">
              <HeaderLinkButton className="!h-9 !rounded-lg !px-3 !py-0 !text-xs" href={data ? pendingHoursHref({ from: data.filter.fromPeriodKey, to: data.filter.toPeriodKey }) : "/pnl/hours"}>Giờ chờ xử lý</HeaderLinkButton>
              {mayFixCosts ? <HeaderLinkButton className="!h-9 !rounded-lg !px-3 !py-0 !text-xs" href="/users/costs">Chi phí nhân sự</HeaderLinkButton> : null}
              {mayFixCosts ? <HeaderLinkButton className="!h-9 !rounded-lg !bg-primary/5 !px-3 !py-0 !text-xs !text-primary hover:!bg-primary/10" href="/pnl/costs">Thiết lập P&amp;L</HeaderLinkButton> : null}
            </div>
          }
        />
        {error ? <PnlLoadError error={error} onRetry={reload} /> : null}
        {!data && !error ? <PnlSkeleton /> : null}
        {data && meta ? (
          <div aria-busy={loading} className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
            <DashboardFilters filter={data.filter} allProjectCount={data.all.total} state={state} generatedAt={meta.generatedAt} activeCount={activeCount} onChange={change} onReset={reset} />
            {meta.moneyVisible ? null : <MoneyHiddenNote />}
            <DashboardTotals totals={data.totals} moneyVisible={meta.moneyVisible} />
            <DashboardPending data={data} meta={meta} />
            <DashboardCostGroups groups={data.costGroups} state={state} onChange={change} />
            <DashboardProjectTable data={data} state={state} moneyVisible={meta.moneyVisible} returnTo={ownQuery ? `/pnl?${ownQuery}` : "/pnl"} onChange={change} onReset={activeCount ? reset : undefined} />
            <DashboardCompanyCosts companyCosts={data.companyCosts} />
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
