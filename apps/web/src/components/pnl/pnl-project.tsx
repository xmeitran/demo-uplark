"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarClock, Clock3, Lock, Receipt, TrendingUp, Wallet } from "lucide-react";
import type { PnlMeta, PnlProjectPersonRow, PnlProjectResponse } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { DateRangeFilter } from "@/components/filters";
import { HeaderLinkButton, PageHeader, pageMainClassName } from "@/components/page-header";
import { toVietnamDateKey } from "@/lib/vietnam-time";
import { PersonLink } from "@/components/person-link";
import { formatDay, formatExactVnd, formatHoursValue, formatMillions, formatMonth, formatPercent, formatSignedPercent, monthsBetween } from "./pnl-format";
import { COST_GROUP_ONLY, FIX_ACTION_LABELS, RESULT_MEANING, notComputableWhy, plainPersonStatus, plainReason } from "./pnl-plain";
import { ItemTree, ProjectHistory } from "./pnl-project-details";
import { ProjectValueModal, TemplateOverrideModal } from "./pnl-project-edit";
import { ProjectMonths } from "./pnl-project-months";
import { fixTargetHref, monthsToDays, parseProjectScope, projectPeriodPresets, projectScopeOfDays } from "./pnl-query";
import {
  Chip, MoneyHiddenNote, NoValue, PnlLoadError, PnlSkeleton, RESULT_TEXT_CLASS, ResultBadge, Tile,
  cardClass, mutedNoteClass, secondaryButtonClass, sectionTitleClass, tdClass, tdNumberClass, thClass, thNumberClass, usePnlLoad
} from "./pnl-ui";

type Project = PnlProjectResponse["data"];
const WHOLE_ONLY = "Chỉ xem ở Toàn dự án";

/** Khối 2 — năm ô tổng kiểu trang Dự án: nhãn nhỏ, ô biểu tượng, số lớn, một dòng chú thích. Ô thiếu số ghi lý do. */
function ProjectTotals({ data, moneyVisible, canEdit, onEditValue }: Readonly<{ data: Project; moneyVisible: boolean; canEdit: boolean; onEditValue: () => void }>) {
  const { totals, header } = data;
  const { revenue, cost, ebit } = totals;
  const hidden = moneyVisible ? null : COST_GROUP_ONLY;
  const blocked = notComputableWhy(header.result);
  const revenueNote = revenue.amount === null ? revenue.note : "nhập tay theo từng dự án";
  const ebitNote = [ebit.marginPercent === null ? null : `Biên ${formatPercent(ebit.marginPercent)}`, header.result.labelText].filter(Boolean).join(" · ");
  const vsPlan = totals.loggedVsPlanPercent === null ? null : `${formatSignedPercent(totals.loggedVsPlanPercent)} so với kế hoạch`;
  return (
    <section aria-label="Năm ô tổng" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile icon={CalendarClock} color="#0891b2" label="Giờ kế hoạch" value={formatHoursValue(totals.plannedMinutes)} unit="giờ" note="từ các sub-task đã lập" />
      <Tile icon={Clock3} color="#0891b2" label="Giờ thực hiện" value={formatHoursValue(totals.loggedMinutes)} unit="giờ" note={[vsPlan, `${totals.monthsWithHours} tháng có giờ`].filter(Boolean).join(" · ")} />
      <Tile
          icon={Wallet}
          color="#2563eb"
          label={revenue.label}
          value={formatMillions(revenue.amount)}
          title={revenue.lockedReason ?? formatExactVnd(revenue.amount)}
          note={revenueNote}
          whyEmpty={hidden ?? (revenue.wholeProjectOnly ? WHOLE_ONLY : blocked ?? revenue.missingReason ?? "Chưa có số liệu")}
          action={moneyVisible && canEdit && revenue.canEdit ? <button type="button" onClick={onEditValue} title="Nhập hoặc sửa doanh thu dự án" className="shrink-0 rounded-lg border border-border px-2 py-0.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted">{revenue.projectValueAmount === null ? "Nhập" : "Sửa"}</button> : undefined}
      />
      <Tile
        icon={Receipt}
        color="#7c3aed"
        label="Tổng chi phí"
        value={formatMillions(cost.totalAmount)}
        title={formatExactVnd(cost.totalAmount)}
        note={`Nhân sự ${formatMillions(cost.laborAmount)} · khác ${formatMillions(cost.otherAmount)}`}
        whyEmpty={hidden ?? blocked ?? "Chưa có số liệu"}
      />
      <Tile
          icon={TrendingUp}
          color="#16a34a"
          label={ebit.label}
          value={formatMillions(ebit.amount)}
          title={formatExactVnd(ebit.amount)}
          note={ebitNote}
          noteClass={`font-medium ${RESULT_TEXT_CLASS[header.result.label]}`}
          whyEmpty={hidden ?? (ebit.wholeProjectOnly ? WHOLE_ONLY : blocked ?? ebit.missingReason ?? "Chưa có số liệu")}
      />
    </section>
  );
}

const statementGrid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_112px] sm:px-5";

/** Một dòng của báo cáo lãi lỗ: tên và một dòng giải thích bên trái, số tiền bên phải. */
function StatementRow({ label, hint, amount, why, strong = false, aside }: Readonly<{ label: string; hint: string; amount: number | null; why: string; strong?: boolean; aside?: string }>) {
  return (
    <div className={`${statementGrid} border-t border-border ${strong ? "bg-muted/30" : ""}`}>
      <div className="min-w-0">
        <p className={`text-foreground ${strong ? "text-base font-bold" : "text-sm font-bold"}`}>{label}</p>
        <p className="!mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <p title={formatExactVnd(amount)} className={`text-right font-mono tabular-nums text-foreground ${strong ? "text-base font-bold" : "text-sm font-semibold"}`}>{amount === null ? <NoValue why={why} /> : formatMillions(amount)}</p>
      <p className="col-span-2 text-right text-xs font-semibold text-muted-foreground sm:col-span-1">{aside}</p>
    </div>
  );
}

/**
 * Khối 3 — "Báo cáo lãi lỗ", trung tâm của trang: nhãn kết quả và lý do ở trên, rồi Doanh thu → Chi phí nhân sự →
 * Chi phí khác → Tổng chi phí → EBIT đọc từ trên xuống; bên dưới là từng khoản mục (mở ra tới từng dòng, nhập tay tại chỗ).
 */
function ProjectStatement({ data, meta, projectId, onChanged, onEditValue, onOverrideTemplate }: Readonly<{ data: Project; meta: PnlMeta; projectId: string; onChanged: () => Promise<void>; onEditValue: () => void; onOverrideTemplate: () => void }>) {
  const { header, totals } = data;
  const { revenue, cost, ebit } = totals;
  const scope = header.scope;
  const [itemsOpen, setItemsOpen] = useState(true);
  const mayFixCosts = meta.canEdit || meta.canApprove;
  const hidden = meta.moneyVisible ? null : COST_GROUP_ONLY;
  const blocked = notComputableWhy(header.result);
  const why = hidden ?? blocked ?? "Chưa có số liệu";
  const wholeOnly = hidden ?? WHOLE_ONLY;
  const scopeText = scope.whole ? "toàn dự án" : `${formatMonth(scope.fromPeriodKey)} – ${formatMonth(scope.toPeriodKey)}`;
  const facts = [
    `Loại dự án ${header.templateName}`,
    header.picName ? `PIC ${header.picName}` : null,
    header.plannedStartOn || header.plannedEndOn ? `Kế hoạch ${formatDay(header.plannedStartOn)} → ${formatDay(header.plannedEndOn)}` : null,
    header.acceptedOnEstimated ? `Nghiệm thu (${header.closeGate}): chưa có ngày${header.acceptedOn ? `, ước ${formatDay(header.acceptedOn)}` : ""}`
      : header.acceptedOn ? `Nghiệm thu (${header.closeGate}) ngày ${formatDay(header.acceptedOn)}` : `Chưa nghiệm thu (${header.closeGate})`,
    `Hồ sơ P&L: ${header.recordStateLabel}`,
    header.isTestProject ? "Dự án thử nghiệm" : null
  ].filter(Boolean);
  const reasons = header.result.reasons;

  return (
    <section aria-labelledby="pnl-statement-title" className={cardClass}>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="pnl-statement-title" className={sectionTitleClass}>Báo cáo lãi lỗ · {scopeText}</h2>
            <p className="!mt-1 text-sm text-muted-foreground">{facts.join(" · ")}</p>
          </div>
          <ResultBadge large result={header.result} />
        </div>
        {reasons.length ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <h3 className="!text-sm font-bold">{header.result.label === "not_computable" ? "Vì sao chưa tính được?" : "Vì sao số liệu còn tạm tính?"}</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
              {reasons.map((reason) => {
                const open = reason.target === "pending_hours" || reason.target === "project_setup" || reason.target === "approval";
                const href = fixTargetHref(reason.target, { projectId: header.projectId, periodKey: reason.target === "pending_hours" ? undefined : reason.periodKeys?.[0], group: reason.code.replace(/^pending_/, "") });
                // Doanh thu dự án is entered right here, on the Doanh thu figure.
                if (reason.target === "project_value") {
                  return (
                    <li key={reason.code}>
                      {plainReason(reason)}.{" "}
                      {meta.canEdit && revenue.canEdit ? <button type="button" onClick={onEditValue} className="whitespace-nowrap font-semibold !text-amber-900 underline underline-offset-2 hover:!text-amber-700">{FIX_ACTION_LABELS.project_value} ›</button> : "PM (Admin) nhập ở ô Doanh thu."}
                    </li>
                  );
                }
                return (
                  <li key={reason.code}>
                    {plainReason(reason)}.{" "}
                    {open || mayFixCosts ? <Link href={href} className="whitespace-nowrap font-semibold !text-amber-900 underline underline-offset-2 hover:!text-amber-700">{reason.target === "pending_hours" ? "Xem các giờ này" : FIX_ACTION_LABELS[reason.target]} ›</Link> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : <p className="text-sm text-muted-foreground">{RESULT_MEANING[header.result.label]}</p>}
      </div>

      <StatementRow
          label={revenue.label}
          hint="Doanh thu do Admin/PM nhập trực tiếp theo từng dự án; không lấy tự động từ hệ thống"
          amount={revenue.amount}
          why={revenue.wholeProjectOnly ? wholeOnly : why}
      />
      <StatementRow label="Chi phí nhân sự" hint="Giờ đã tính vào P&L × đơn giá giờ của từng người trong tháng" amount={cost.laborAmount} why={why} />
      <StatementRow label="Chi phí khác" hint="Quỹ chi phí chung được chia, chi phí riêng của dự án, hoa hồng…" amount={cost.otherAmount} why={why} />
      <StatementRow strong label="Tổng chi phí" hint="Chi phí nhân sự + chi phí khác" amount={cost.totalAmount} why={why} />
      <StatementRow
          strong
          label={ebit.label}
          hint={ebit.expected ? "Lãi lỗ dự kiến = doanh thu dự án − tổng chi phí đến nay" : "Lãi lỗ = doanh thu dự án − tổng chi phí"}
          amount={ebit.amount}
          why={ebit.wholeProjectOnly ? wholeOnly : why}
          aside={ebit.marginPercent === null ? undefined : `Biên EBIT ${formatPercent(ebit.marginPercent)}`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="!text-sm font-bold text-foreground">Chi tiết theo khoản mục P&amp;L</h3>
          <p className="!mt-0.5 text-xs text-muted-foreground">Từng dòng doanh thu, chi phí, cộng dồn cả dự án (triệu đồng). Nhập chi phí riêng của dự án ở dòng “Nhập tay”.</p>
          <p className="!mt-0.5 text-xs text-muted-foreground">
            Mẫu khoản mục: <span className="font-semibold text-foreground">{data.template.name}</span>
            {data.template.override ? ` · dự án ghi đè mẫu · ${data.template.override.byName ?? "—"} · ${formatDay(data.template.override.at.slice(0, 10))} · lý do: ${data.template.override.reason}` : null}
            {data.template.canOverride ? <>{" · "}<button type="button" onClick={onOverrideTemplate} className="font-semibold text-foreground underline underline-offset-2 hover:text-primary">Ghi đè mẫu</button></> : null}
          </p>
        </div>
        {data.items ? (
          <button type="button" aria-expanded={itemsOpen} aria-controls="pnl-items-panel" onClick={() => setItemsOpen(!itemsOpen)} className={`${secondaryButtonClass} !h-9 !text-xs`}>{itemsOpen ? "Thu gọn" : "Xem khoản mục"}</button>
        ) : <span title="Bạn không thuộc nhóm quyền chi phí nên không mở được mục này." className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden />Chỉ nhóm quyền chi phí</span>}
      </div>
      {data.items && itemsOpen ? <ItemTree projectId={projectId} items={data.items} months={monthsBetween(scope.minPeriodKey, scope.maxPeriodKey)} canEdit={meta.canEdit} projectRevenue={totals.revenue} onChanged={onChanged} /> : null}
    </section>
  );
}

const initialsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "?";

function PersonRow({ person, moneyVisible }: Readonly<{ person: PnlProjectPersonRow; moneyVisible: boolean }>) {
  const unassigned = person.userId === null;
  const missing = person.status ? plainPersonStatus(person.status.missing) : null;
  return (
    <tr className={unassigned ? "text-muted-foreground" : "transition-colors hover:bg-muted/25"}>
      <th scope="row" className={`${tdClass} text-left font-normal`}>
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${unassigned ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{unassigned ? "–" : initialsOf(person.displayName)}</span>
          <span className="min-w-0">
            {unassigned ? <span className="block truncate text-muted-foreground">{person.displayName}</span> : <PersonLink userId={person.userId} className="block truncate font-semibold !text-foreground hover:!text-primary">{person.displayName}</PersonLink>}
            {person.roleGroupLabel ? <span className="block truncate text-xs text-muted-foreground">{person.roleGroupLabel}</span> : null}
          </span>
        </span>
      </th>
      <td className={`${tdNumberClass} ${unassigned ? "!text-muted-foreground" : ""}`}>{formatHoursValue(person.plannedMinutes)}</td>
      <td className={tdNumberClass}>{unassigned ? null : formatHoursValue(person.loggedMinutes)}</td>
      <td className={tdNumberClass}>{unassigned ? null : formatHoursValue(person.includedMinutes)}</td>
      {moneyVisible ? <td title={formatExactVnd(person.laborCostAmount)} className={tdNumberClass}>{unassigned ? null : person.laborCostAmount === null ? <NoValue why={missing ?? "Chưa có giờ được tính vào P&L"} /> : formatMillions(person.laborCostAmount, "table")}</td> : null}
      <td className={`${tdClass} text-center`}>
        {!person.status ? null : missing ? <Chip tone="warn" title={missing}>Thiếu</Chip> : <Chip tone={person.status.ok ? "ok" : "warn"}>{person.status.label}</Chip>}
      </td>
    </tr>
  );
}

/** Khối 4 — nhân sự tham gia, cộng dồn cả dự án. Cột chi phí chỉ hiện với nhóm quyền chi phí. */
function ProjectPeople({ people, moneyVisible }: Readonly<{ people: PnlProjectPersonRow[]; moneyVisible: boolean }>) {
  return (
    <section aria-labelledby="pnl-people-title" className={cardClass}>
      <div className="px-4 pb-3 pt-4 sm:px-5">
        <h2 id="pnl-people-title" className={sectionTitleClass}>Nhân sự tham gia</h2>
        <p className={`!mt-0.5 ${mutedNoteClass}`}>Giờ và chi phí của từng người, cộng dồn cả dự án. Rê chuột vào “Thiếu” để xem còn thiếu dữ liệu gì.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0 text-left">
          <colgroup><col /><col className="w-[112px]" /><col className="w-[104px]" /><col className="w-[112px]" />{moneyVisible ? <col className="w-[120px]" /> : null}<col className="w-[104px]" /></colgroup>
          <thead>
            <tr className="bg-muted/30">
              <th scope="col" className={thClass}>Nhân sự</th>
              <th scope="col" title="Giờ ước tính của các sub-task giao cho người này" className={thNumberClass}>Giờ kế hoạch</th>
              <th scope="col" title="Giờ người này đã ghi cho dự án" className={thNumberClass}>Giờ đã ghi</th>
              <th scope="col" title="Phần giờ đã ghi đủ điều kiện để quy ra chi phí của dự án (giờ đã tính vào P&L)" className={thNumberClass}>Giờ đã tính</th>
              {moneyVisible ? <th scope="col" title="Giờ đã tính vào P&L × đơn giá giờ của người đó trong từng tháng (triệu đồng)" className={thNumberClass}>Chi phí</th> : null}
              <th scope="col" title="Đủ, hoặc còn thiếu dữ liệu khiến giờ của người này chưa tính được" className={`${thClass} !text-center`}>Dữ liệu</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={moneyVisible ? 6 : 5} className="px-4 py-10 text-center text-sm text-muted-foreground">Chưa có ai được giao sub-task hoặc ghi giờ cho dự án này.</td>
              </tr>
            ) : null}
            {people.map((person) => <PersonRow key={person.userId ?? "unassigned"} person={person} moneyVisible={moneyVisible} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Màn P&L của một dự án (mục 5): cộng dồn từ khi tạo dự án tới mốc đóng P&L. Mọi con số là số API trả về. */
export function PnlProjectScreen({ projectId }: Readonly<{ projectId: string }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = useMemo(() => parseProjectScope(new URLSearchParams(searchParams.toString())), [searchParams]);
  const base = `/pnl/${encodeURIComponent(projectId)}`;
  const query = scope ? `?fromMonth=${scope.fromMonth}&toMonth=${scope.toMonth}` : "";
  const { data: payload, error, loading, reload } = usePnlLoad<PnlProjectResponse>(`/api/pnl/projects/${encodeURIComponent(projectId)}${query}`);
  const data = payload?.data;
  const moneyVisible = payload?.meta.moneyVisible ?? false;
  const range = data?.header.scope;
  const presets = useMemo(() => (range ? projectPeriodPresets(range, toVietnamDateKey(new Date())) : []), [range]);
  const scopeDays = !range || range.whole ? { from: "", to: "" } : monthsToDays({ fromMonth: range.fromPeriodKey ?? range.minPeriodKey, toMonth: range.toPeriodKey ?? range.maxPeriodKey });
  // The scope changes the URL; where "Quay lại" leads (returnTo) stays.
  const [editing, setEditing] = useState<"value" | "template" | null>(null);
  const setScope = (next: { fromMonth: string; toMonth: string } | null) => {
    const params = new URLSearchParams(next ? { fromMonth: next.fromMonth, toMonth: next.toMonth } : {});
    const returnTo = searchParams.get("returnTo");
    if (returnTo) params.set("returnTo", returnTo);
    const search = params.toString();
    router.replace(search ? `${base}?${search}` : base, { scroll: false });
  };

  return (
    <AppShell activeRoute="/pnl" title="P&L dự án">
      <main className={pageMainClassName}>
        <PageHeader
          back={{ href: "/pnl", label: "P&L dự án" }}
          title={data ? data.header.projectName : "P&L của dự án"}
          subtitle={data ? `${data.header.accountName} · ${data.header.projectStatus}` : undefined}
          meta="Đơn vị tiền: triệu đồng"
          actions={<HeaderLinkButton href={`/projects/${encodeURIComponent(projectId)}`}>Mở dự án</HeaderLinkButton>}
        />
        {error ? <PnlLoadError error={error} onRetry={reload} /> : null}
        {!data && !error ? <PnlSkeleton /> : null}
        {data && payload ? (
          <div aria-busy={loading} className={`space-y-4 ${loading ? "opacity-70" : ""}`}>
            <section aria-label="Phạm vi thời gian" className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Phạm vi thời gian</span>
                <DateRangeFilter ariaLabel="Thu hẹp theo thời gian" value={scopeDays} presets={presets} onChange={(days) => setScope(projectScopeOfDays(days, data.header.scope))} />
              </div>
              <p className={`${mutedNoteClass} max-w-3xl pb-2.5`}>P&amp;L tính theo tháng nên khoảng ngày được làm tròn thành các tháng trọn vẹn của dự án ({formatMonth(data.header.scope.minPeriodKey)} – {formatMonth(data.header.scope.maxPeriodKey)}). Khi thu hẹp, Doanh thu và EBIT ghi “{WHOLE_ONLY}” vì chỉ tính cho cả dự án.</p>
            </section>
            {moneyVisible ? null : <MoneyHiddenNote />}
            <ProjectTotals data={data} moneyVisible={moneyVisible} canEdit={payload.meta.canEdit} onEditValue={() => setEditing("value")} />
            <ProjectStatement data={data} meta={payload.meta} projectId={projectId} onChanged={reload} onEditValue={() => setEditing("value")} onOverrideTemplate={() => setEditing("template")} />
            <ProjectPeople people={data.people} moneyVisible={moneyVisible} />
            <ProjectMonths projectId={projectId} months={data.months} moneyVisible={moneyVisible} />
            <ProjectHistory history={data.history} />
            {editing === "value" ? <ProjectValueModal projectId={projectId} revenue={data.totals.revenue} reload={reload} onClose={() => setEditing(null)} /> : null}
            {editing === "template" ? <TemplateOverrideModal projectId={projectId} template={data.template} reload={reload} onClose={() => setEditing(null)} /> : null}
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
