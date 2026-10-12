"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { PnlProjectPersonRow, PnlProjectResponse } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { PersonLink } from "@/components/person-link";
import { formatDay, formatExactVnd, formatHoursValue, formatMillions, formatPercent, formatSignedPercent, monthsBetween } from "./pnl-format";
import { MonthRangePicker } from "./pnl-month-range";
import { ProjectDetails } from "./pnl-project-details";
import { ProjectMonths } from "./pnl-project-months";
import { fixTargetHref, parseProjectScope, projectScopeOf } from "./pnl-query";
import {
  MoneyHiddenNote, PnlLoadError, PnlPageHeader, PnlSkeleton, RESULT_TEXT_CLASS, ResultBadge, Tile,
  cardClass, mutedNoteClass, okTextClass, sectionTitleClass, secondaryButtonClass, tdClass, tdNumberClass, thClass, thNumberClass, usePnlLoad, warnTextClass
} from "./pnl-ui";

type Project = PnlProjectResponse["data"];
const WHOLE_ONLY = "Chỉ xem ở Toàn dự án";
const NO_MONEY = "Chỉ nhóm quyền chi phí";

/** Khối 1 — tên, nhãn kết quả, dòng thông tin, phạm vi "Toàn dự án" / Từ tháng – Đến tháng. */
function ProjectHeader({ header, onScope }: Readonly<{
  header: Project["header"];
  onScope: (scope: { fromMonth: string; toMonth: string } | null) => void;
}>) {
  const scope = header.scope;
  const months = monthsBetween(scope.minPeriodKey, scope.maxPeriodKey);
  const from = scope.fromPeriodKey ?? scope.minPeriodKey;
  const to = scope.toPeriodKey ?? scope.maxPeriodKey;
  const meta = [
    `Loại dự án ${header.templateName}`,
    header.picName,
    header.projectStatus,
    header.plannedStartOn || header.plannedEndOn ? `Kế hoạch ${formatDay(header.plannedStartOn)} → ${formatDay(header.plannedEndOn)}` : null,
    header.acceptedOnEstimated ? `${header.closeGate}: ngày nghiệm thu chưa xác định${header.acceptedOn ? ` (ước ${formatDay(header.acceptedOn)})` : ""}`
      : header.acceptedOn ? `${header.closeGate} ${formatDay(header.acceptedOn)}` : `${header.closeGate} chưa có`,
    `Hồ sơ P&L: ${header.recordStateLabel}`,
    header.isTestProject ? "Dự án thử nghiệm" : null
  ].filter(Boolean);
  const noG7Date = header.result.reasons.find((reason) => reason.code === "missing_acceptance_date");

  return (
    <section aria-label="Thông tin và phạm vi" className={`${cardClass} space-y-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="!text-lg font-bold text-foreground">{header.projectName} · {header.accountName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{meta.join(" · ")}</p>
          {noG7Date ? <p className="mt-1 text-xs"><Link href={fixTargetHref(noG7Date.target, { projectId: header.projectId })} className="font-semibold !text-amber-700 hover:underline">{noG7Date.label} · mở dự án ›</Link></p> : null}
        </div>
        <ResultBadge large result={header.result} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={scope.whole}
          onClick={() => onScope(null)}
          className={`h-10 rounded-lg border px-4 text-[13px] font-semibold transition-colors ${scope.whole ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
        >
          Toàn dự án
        </button>
        <MonthRangePicker months={months} from={from} to={to} active={!scope.whole} onApply={(fromMonth, toMonth) => onScope(projectScopeOf(fromMonth, toMonth, scope))} />
        <p className={mutedNoteClass}>Khi thu hẹp: ô Doanh thu, EBIT ghi “{WHOLE_ONLY}”</p>
        <Link href={`/projects/${encodeURIComponent(header.projectId)}`} className={`${secondaryButtonClass} ml-auto !text-muted-foreground`}>Mở dự án · Thiết lập P&amp;L ›</Link>
      </div>
    </section>
  );
}

/** Khối 2 — năm ô tổng, luôn bằng dòng "Toàn dự án" của khối 4. Ô thiếu đầu vào ghi lý do ngay dưới số. */
function ProjectTotals({ data, moneyVisible }: Readonly<{ data: Project; moneyVisible: boolean }>) {
  const { totals, header } = data;
  const { revenue, cost, ebit, costVsCap } = totals;
  const hidden = moneyVisible ? null : NO_MONEY;
  const ebitNote = ebit.wholeProjectOnly
    ? WHOLE_ONLY
    : ebit.missingReason ?? [ebit.marginPercent === null ? null : formatPercent(ebit.marginPercent), header.result.labelText].filter(Boolean).join(" · ");
  return (
    <section aria-label="Năm ô tổng" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Tile label="Giờ kế hoạch" value={formatHoursValue(totals.plannedMinutes)} unit="giờ" note="từ sub-task đã lập" />
      <Tile
        label="Giờ thực hiện"
        value={formatHoursValue(totals.loggedMinutes)}
        unit="giờ"
        note={[totals.loggedVsPlanPercent === null ? null : formatSignedPercent(totals.loggedVsPlanPercent), `${totals.monthsWithHours} tháng có giờ`].filter(Boolean).join(" · ")}
      />
      <Tile
        label={revenue.label}
        value={formatMillions(revenue.amount)}
        title={formatExactVnd(revenue.amount)}
        note={hidden ?? (revenue.wholeProjectOnly ? WHOLE_ONLY : revenue.missingReason ?? revenue.note)}
        noteClass={!hidden && revenue.missingReason && !revenue.wholeProjectOnly ? "font-medium text-amber-700" : undefined}
      />
      <Tile
        label="Tổng chi phí"
        value={formatMillions(cost.totalAmount)}
        title={formatExactVnd(cost.totalAmount)}
        note={hidden ?? `NS ${formatMillions(cost.laborAmount)} · khác ${formatMillions(cost.otherAmount)}`}
      />
      {costVsCap ? (
        <Tile
          label="Chi phí so với trần"
          value={formatMillions(costVsCap.costAmount)}
          title={formatExactVnd(costVsCap.costAmount)}
          note={hidden ?? `trần ${formatMillions(costVsCap.capAmount)} · đã dùng ${formatPercent(costVsCap.usedPercent)}`}
          noteClass={!hidden && costVsCap.usedPercent !== null && costVsCap.usedPercent >= costVsCap.warnThresholdPercent ? "font-medium text-amber-700" : undefined}
        />
      ) : (
        <Tile
          label={ebit.label}
          value={formatMillions(ebit.amount)}
          title={formatExactVnd(ebit.amount)}
          note={hidden ?? ebitNote}
          noteClass={hidden || ebit.wholeProjectOnly ? undefined : `font-medium ${RESULT_TEXT_CLASS[header.result.label]}`}
        />
      )}
    </section>
  );
}

function PersonRow({ person, moneyVisible }: Readonly<{ person: PnlProjectPersonRow; moneyVisible: boolean }>) {
  const unassigned = person.userId === null;
  return (
    <tr className={unassigned ? "text-muted-foreground" : "transition-colors hover:bg-muted/25"}>
      <th scope="row" className={`${tdClass} text-left font-normal ${unassigned ? "!text-muted-foreground" : ""}`}>
        {unassigned ? person.displayName : <PersonLink userId={person.userId} className="font-semibold !text-foreground hover:!text-primary">{person.displayName}</PersonLink>}
      </th>
      <td className={tdClass}>{person.roleGroupLabel}</td>
      <td className={`${tdNumberClass} ${unassigned ? "!text-muted-foreground" : ""}`}>{formatHoursValue(person.plannedMinutes)}</td>
      <td className={tdNumberClass}>{unassigned ? null : formatHoursValue(person.loggedMinutes)}</td>
      <td className={tdNumberClass}>{unassigned ? null : formatHoursValue(person.includedMinutes)}</td>
      {moneyVisible ? <td title={formatExactVnd(person.laborCostAmount)} className={tdNumberClass}>{unassigned ? null : formatMillions(person.laborCostAmount, "table")}</td> : null}
      <td title={person.status?.missing.map((missing) => missing.label).join(" · ") || undefined} className={`${tdClass} whitespace-nowrap ${person.status?.ok ? okTextClass : warnTextClass}`}>
        {person.status?.label}
      </td>
    </tr>
  );
}

/** Khối 3 — nhân sự tham gia, cộng dồn cả dự án. Cột chi phí chỉ hiện với nhóm quyền chi phí. */
function ProjectPeople({ people, moneyVisible }: Readonly<{ people: PnlProjectPersonRow[]; moneyVisible: boolean }>) {
  return (
    <section aria-labelledby="pnl-people-title" className={cardClass}>
      <h2 id="pnl-people-title" className={`${sectionTitleClass} px-4 pb-3 pt-4`}>Nhân sự tham gia, cộng dồn cả dự án</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-muted/30">
              <th scope="col" className={thClass}>Nhân sự</th>
              <th scope="col" className={thClass}>Vai trò</th>
              <th scope="col" className={thNumberClass}>Giờ KH</th>
              <th scope="col" className={thNumberClass}>Giờ đã ghi</th>
              <th scope="col" className={thNumberClass}>Giờ tính P&amp;L</th>
              {moneyVisible ? <th scope="col" className={thNumberClass}>Chi phí NS</th> : null}
              <th scope="col" className={thClass}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={moneyVisible ? 7 : 6} className="px-4 py-10 text-center text-sm text-muted-foreground">Chưa có ai được giao sub-task hoặc ghi giờ cho dự án này.</td>
              </tr>
            ) : null}
            {people.map((person) => <PersonRow key={person.userId ?? "unassigned"} person={person} moneyVisible={moneyVisible} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Màn P&L dự án (mục 5): cộng dồn từ khi tạo dự án tới mốc đóng P&L. Mọi con số là số API trả về. */
export function PnlProjectScreen({ projectId }: Readonly<{ projectId: string }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = useMemo(() => parseProjectScope(new URLSearchParams(searchParams.toString())), [searchParams]);
  const base = `/pnl/${encodeURIComponent(projectId)}`;
  const query = scope ? `?fromMonth=${scope.fromMonth}&toMonth=${scope.toMonth}` : "";
  const { data: payload, error, loading, reload } = usePnlLoad<PnlProjectResponse>(`/api/pnl/projects/${encodeURIComponent(projectId)}${query}`);
  const data = payload?.data;
  const moneyVisible = payload?.meta.moneyVisible ?? false;
  const setScope = (next: { fromMonth: string; toMonth: string } | null) =>
    router.replace(next ? `${base}?fromMonth=${next.fromMonth}&toMonth=${next.toMonth}` : base, { scroll: false });

  return (
    <AppShell activeRoute="/pnl" title={data ? `P&L · ${data.header.projectName}` : "P&L dự án"}>
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4 xl:p-6">
        <PnlPageHeader crumb={data ? `${data.header.projectName} · ${data.header.accountName}` : "Dự án"} unitNote="Đơn vị tiền: triệu đồng" />
        {error ? <PnlLoadError error={error} onRetry={reload} /> : null}
        {!data && !error ? <PnlSkeleton /> : null}
        {data && payload ? (
          <div aria-busy={loading} className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
            <ProjectHeader header={data.header} onScope={setScope} />
            {moneyVisible ? null : <MoneyHiddenNote />}
            <ProjectTotals data={data} moneyVisible={moneyVisible} />
            <ProjectPeople people={data.people} moneyVisible={moneyVisible} />
            <ProjectMonths projectId={projectId} months={data.months} moneyVisible={moneyVisible} />
            <ProjectDetails
              projectId={projectId}
              items={data.items}
              history={data.history}
              months={monthsBetween(data.header.scope.minPeriodKey, data.header.scope.maxPeriodKey)}
              canEdit={payload.meta.canEdit}
              onChanged={reload}
            />
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
