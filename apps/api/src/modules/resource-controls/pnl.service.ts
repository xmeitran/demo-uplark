/**
 * Tab P&L — layers 3 and 4 of "Yêu cầu tab P&L – hệ thống PM": the two report screens, the source-hour list,
 * shared funds (their split needs the month's counted hours) and the monthly period with its lock.
 * Layer 0 configuration and the staff-cost / project-setup inputs are in pnl-config.service.ts.
 * Every figure comes from pnl-engine.ts through the one loader (pnl-context.ts).
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  isAdminAccount,
  type PnlChecklistItem,
  type PnlCompanyCostDetailResponse,
  type PnlCompanyCosts,
  type PnlCostGroup,
  type PnlDashboardProjectRow,
  type PnlDashboardQuery,
  type PnlDashboardResponse,
  type PnlSourceEntriesResponse,
  type PnlSourceEntryRow,
  type PnlFundAmountInput,
  type PnlFundInput,
  type PnlFundSummary,
  type PnlFundsResponse,
  type PnlG7Blockers,
  type PnlHistoryEvent,
  type PnlMeta,
  type PnlMonthMissing,
  type PnlPendingStripItem,
  type PnlPeriodCard,
  type PnlPeriodSnapshotSummary,
  type PnlPeriodsResponse,
  type PnlProjectItemRow,
  type PnlProjectMonthDetail,
  type PnlProjectMonthDetailResponse,
  type PnlProjectMonthRow,
  type PnlProjectPersonRow,
  type PnlProjectResponse,
  type PnlResult,
  type PrincipalContext
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { getStoredParameter } from "../../shared/system-parameters";
import { isWorkingDay } from "../../shared/working-days";
import { gateHooks } from "../delivery-handoff/gates";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "../delivery-handoff/member-participation";
import { projectStatusLabel } from "../delivery-handoff/project-status";
import { assertCostApprove, assertCostEdit, canApproveCost, canEditCost, canEditProjectSetup, canExportCost, canViewCost } from "./cost-permissions";
import { monthKeysBetween, nextMonthKey, reportMonthKey, reportMonthStart } from "./pnl-calc";
import { dayKeyOf, loadPnlContext, num, type PnlContext, type ProjectCtx, type SnapshotData } from "./pnl-context";
import {
  COMPANY_LINE_LABELS,
  adjustedAfterClose,
  bucketEntries,
  companyCostMonth,
  dashboardPeriod,
  dashboardTab,
  dashboardTotals,
  entryCosts,
  g7Blockers,
  percentOf,
  periodChecklist,
  splitFund,
  toVnd,
  type CompanyLineKey,
  type CompanyMonth,
  type EngineEntry,
  type ProjectPnl
} from "./pnl-engine";
import {
  PENDING_GROUP_LABELS,
  PERIOD_STATE_LABELS,
  PNL_GATE_REASON_LABELS,
  PNL_GATE_STATUS_LABELS,
  RECORD_STATE_LABELS,
  ROLE_GROUP_LABELS,
  blocksG7,
  costOfMinutes,
  hourlyRate,
  pendingDeadline,
  pendingGroupOf,
  periodStateOf,
  rateKey,
  reconcileHours,
  type PendingGroup,
  type PnlGateReason,
  type RoleGroup
} from "./pnl-rules";
import { COST_ITEM_METHOD_LABELS, SYSTEM_ITEM_CODES, accountingGroupOf, type CostItemDef } from "./pnl-tree";

const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const orNull = <T,>(value: T | undefined): T | null => (value === undefined ? null : value);
const hoursText = (minutes: number) => (Math.round((minutes / 60) * 100) / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const vnd = (amount: number) => `${Math.round(amount).toLocaleString("vi-VN")} đ`;
const monthLabel = (periodKey: string) => `${periodKey.slice(5)}/${periodKey.slice(0, 4)}`;
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
/** A query or body value as trimmed text; numbers are accepted (a caller inside the API passes 2026, the HTTP layer "2026"). */
const text = (value: unknown) => { const item = first(value); return (typeof item === "string" || typeof item === "number") && String(item).trim() ? String(item).trim() : undefined; };

/** One value or several comma-joined ("a,b") → trimmed, unique, at most 50. Nothing given = no filter. */
export const csvList = (value: unknown): string[] => [...new Set((text(value) ?? "").split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 50);
/** Lower case without Vietnamese accents, for name search. */
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function optionalDayKey(value: unknown, field: string): string | undefined {
  const key = text(value);
  if (key && !DAY_KEY.test(key)) throw new BadRequestException(`${field} phải có dạng YYYY-MM-DD.`);
  return key;
}

export function requirePeriodKey(value: unknown, field = "periodKey"): string {
  const key = text(value);
  if (!key || !PERIOD_KEY.test(key)) throw new BadRequestException(`${field} phải có dạng YYYY-MM.`);
  return key;
}

/**
 * PL-26: Admin accounts enter the P&L tab; revenue, cost, cost rate and prices show only to the cost permission group.
 * Money fields of a response are nulled for everybody else — the keys below are the money vocabulary of contracts/pnl.ts.
 */
const MONEY_KEY = /(Amount|amount|CostRate|exchangeRate|amountText)$|^(marginPercent|usedPercent)$/;
const MONEY_MAP_KEY = /^costBy[A-Z]\w*Group$/;
export function redactMoney<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactMoney(item)) as unknown as T;
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (MONEY_KEY.test(key) && (typeof item === "number" || typeof item === "string")) return [key, null];
    // Maps of group key → amount (costByAccountingGroup, costByRoleGroup): the keys stay, the amounts go.
    if (MONEY_MAP_KEY.test(key) && item && typeof item === "object") return [key, Object.fromEntries(Object.keys(item).map((group) => [group, null]))];
    return [key, redactMoney(item)];
  })) as T;
}

export function pnlMeta(principal: PrincipalContext, now = new Date()): PnlMeta {
  if (!isAdminAccount(principal) && !canViewCost(principal)) throw new ForbiddenException("Tab P&L chỉ dành cho tài khoản Admin.");
  return { generatedAt: now.toISOString(), currency: "VND", moneyVisible: canViewCost(principal), canEdit: canEditCost(principal), canApprove: canApproveCost(principal), canExport: canExportCost(principal) };
}

const respond = <T,>(data: T, meta: PnlMeta) => ({ data: meta.moneyVisible ? data : redactMoney(data), meta });

const toResult = (result: ProjectPnl["result"]): PnlResult => ({ label: result.label, labelText: result.labelText, reasons: result.reasons });

function personStatus(missing: readonly PnlMonthMissing[]) {
  if (!missing.length) return { ok: true, label: "Đủ", missing: [] as PnlMonthMissing[] };
  const months = (kind: PnlMonthMissing["kind"]) => missing.filter((row) => row.kind === kind).map((row) => `T${row.periodKey.slice(5)}`).join(", ");
  const head = missing[0].kind;
  const label = head === "cost_rate" ? `Chờ cost rate ${months("cost_rate")}` : head === "layer2_mismatch" ? `Lớp 2 không khớp ${months("layer2_mismatch")}` : head === "locked_period" ? `Ghi bù tháng đã khóa ${months("locked_period")}` : `Thiếu phân loại ${months("classification")}`;
  return { ok: false, label, missing: [...missing] };
}

const reasonRows = (byReason: Partial<Record<PnlGateReason, number>>, kinds: "pending" | "excluded") => {
  const excluded = new Set<PnlGateReason>(["internal", "after_close", "lost_deal_pre_sale"]);
  return (Object.entries(byReason) as Array<[PnlGateReason, number]>).filter(([reason, minutes]) => minutes > 0 && excluded.has(reason) === (kinds === "excluded")).map(([reason, minutes]) => ({ reason, label: PNL_GATE_REASON_LABELS[reason], minutes }));
};

@Injectable()
export class PnlService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    // Mục 6.6: the template is frozen when G7 passes. The gate carries its own workspace/project ids.
    gateHooks.closeProjectPnl = async ({ gate }) => { await this.freezeTemplateAtClose(gate.workspaceId, gate.projectId); };
  }

  /** Injected clock for the specs; the API always runs on the real one. */
  now: () => Date = () => new Date();

  context(workspaceId: string, scope: Parameters<typeof loadPnlContext>[2] = {}) {
    return loadPnlContext(this.prisma, workspaceId, scope, this.now());
  }

  private async audit(principal: PrincipalContext, action: string, resource: string, resourceId: string, before: unknown, after: unknown, db: any = this.prisma) {
    await db.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource, resourceId, before: before ?? undefined, after: after ?? undefined, requestId: randomUUID() } });
  }

  // -------------------------------------------------------------------------
  // Mục 4 — Tổng quan P&L
  // -------------------------------------------------------------------------

  private companyMonths(ctx: PnlContext, periodKeys: readonly string[]): CompanyMonth[] {
    const testIds = new Set([...ctx.projects.values()].filter((project) => project.isTest).map((project) => project.id));
    return periodKeys.map((periodKey) => {
      const snapshot = ctx.locked.get(periodKey)?.snapshot;
      const staffCostAmount = snapshot
        ? sum(snapshot.staffCosts.map((cost) => cost.totalAmount))
        : sum([...ctx.staffCosts.values()].filter((cost) => cost.periodKey === periodKey && cost.status === "APPROVED").map((cost) => cost.totalAmount));
      return companyCostMonth(periodKey, staffCostAmount, ctx.entries, testIds);
    });
  }

  private companyCosts(months: readonly CompanyMonth[]): PnlCompanyCosts {
    const keys: CompanyLineKey[] = ["pre_sale", "after_close", "internal", "unallocated"];
    const staffCostAmount = sum(months.map((month) => month.staffCostAmount));
    const projectLaborAmount = sum(months.map((month) => month.projectLaborAmount));
    const lines = keys.map((key) => ({
      key, label: COMPANY_LINE_LABELS[key],
      amount: sum(months.map((month) => month.lines[key].amount)), minutes: sum(months.map((month) => month.lines[key].minutes)), uncostedMinutes: sum(months.map((month) => month.lines[key].uncostedMinutes)),
      byMonth: months.map((month) => ({ periodKey: month.periodKey, amount: month.lines[key].amount, minutes: month.lines[key].minutes }))
    }));
    const overAllocatedAmount = sum(months.map((month) => month.overAllocatedAmount));
    return { periodKeys: months.map((month) => month.periodKey), staffCostAmount, projectLaborAmount, lines, overAllocatedAmount, balanced: projectLaborAmount + sum(lines.map((line) => line.amount)) - overAllocatedAmount === staffCostAmount };
  }

  async dashboard(query: PnlDashboardQuery & Record<string, unknown>, principal: PrincipalContext): Promise<PnlDashboardResponse> {
    const meta = pnlMeta(principal, this.now());
    const ctx = await this.context(principal.workspaceId);
    const year = Number(text(query.year) ?? ctx.currentPeriodKey.slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("year không hợp lệ.");
    const unit = (text(query.unit) ?? "year") as PnlDashboardQuery["unit"] & string;
    if (!["year", "half", "quarter", "month", "custom"].includes(unit)) throw new BadRequestException("unit phải là year, half, quarter, month hoặc custom.");
    const rule = (text(query.rule) ?? "started_and_accepted") as "started_and_accepted" | "accepted_in_period";
    if (!["started_and_accepted", "accepted_in_period"].includes(rule)) throw new BadRequestException("rule không hợp lệ.");
    const custom = unit === "custom";
    const index = unit === "year" || custom ? null : Number(text(query.index) ?? 1);
    // "custom" is the same project selection over a month range the viewer picked; the figures of a project are not cut to it.
    const period = custom ? { from: requirePeriodKey(query.fromMonth, "fromMonth"), to: requirePeriodKey(query.toMonth ?? query.fromMonth, "toMonth") } : dashboardPeriod(year, unit as "year", index ?? undefined);
    const periodKeys = monthKeysBetween(period.from, period.to);
    if (period.to < period.from || periodKeys.length > 60) throw new BadRequestException("Khoảng tháng phải từ 1 đến 60 tháng, toMonth không trước fromMonth.");
    const projectTypes = csvList(query.projectType);
    const accountIds = csvList(query.accountId);
    const picUserIds = csvList(query.picUserId);
    const search = fold(text(query.q) ?? "");

    const all = [...ctx.projects.values()].filter((project) => !project.internalWorklog);
    const matches = (project: ProjectCtx) => (!projectTypes.length || projectTypes.includes(project.templateKey) || projectTypes.includes(project.projectType as string))
      && (!accountIds.length || accountIds.includes(project.accountId))
      && (!picUserIds.length || picUserIds.includes(project.picUserId as string))
      && (!search || fold(`${project.name} ${project.code} ${project.accountName}`).includes(search));
    const tabOf = (project: ProjectCtx, asTest = project.isTest) => dashboardTab({ isTest: asTest, consumable: project.consumable, lostDeal: project.lostDeal, startedOn: project.startedOn, acceptedOn: project.closePassed ? project.acceptedOn ?? "0000-01-01" : undefined }, period, rule);
    const filtered = all.filter(matches);
    const excludedTestProjectCount = filtered.filter((project) => project.isTest && tabOf(project, false)).length;
    const lockedAt = new Map([...ctx.locked.entries()].map(([periodKey, lock]) => [periodKey, lock.lockedAt]));

    const toRow = (project: ProjectCtx, pnl: ProjectPnl, tab: "accepted" | "in_progress"): PnlDashboardProjectRow => ({
      projectId: project.id, projectCode: project.code, projectName: project.name, accountId: project.accountId, accountName: project.accountName, projectType: project.templateKey,
      picUserId: project.picUserId, picName: ctx.userName(project.picUserId), startedOn: project.startedOn, acceptedOn: tab === "accepted" ? orNull(project.acceptedOn) : null, acceptedOnEstimated: tab === "accepted" && project.acceptanceEstimated,
      // Doanh thu là số nhập tay theo từng dự án, nên hiển thị ở mọi tab lifecycle. EBIT vẫn chỉ hiển thị ở tab đã nghiệm thu.
      revenueAmount: orNull(pnl.revenue.amount),
      laborCostAmount: pnl.laborCostAmount, otherCostAmount: pnl.otherCostAmount, totalCostAmount: pnl.totalCostAmount,
      ebitAmount: tab === "accepted" ? orNull(pnl.ebit.amount) : null, marginPercent: tab === "accepted" ? orNull(pnl.ebit.marginPercent) : null,
      result: toResult(pnl.result),
      adjustedAfterClose: tab === "accepted" && adjustedAfterClose(project.acceptedAt, periodKeys, lockedAt),
      costByAccountingGroup: Object.fromEntries(pnl.costGroups.accounting.map((row) => [row.key, row.amount])),
      costByRoleGroup: Object.fromEntries(pnl.costGroups.role.map((row) => [row.key, row.amount])),
      reconciliation: pnl.reconciliation
    });
    const computed = filtered.map((project) => ({ project, tab: tabOf(project) })).filter((row): row is { project: ProjectCtx; tab: "accepted" | "in_progress" } => row.tab !== null).map((row) => ({ ...row, pnl: ctx.compute(row.project.id) }));
    // The overview list is intentionally broader than the two lifecycle tabs: P&L is also the place to inspect
    // projects that have not reached G7 yet. Keep test/lost-deal exclusions from the accounting rules,
    // but do not use the selected reporting period to hide an otherwise valid project from "Tất cả dự án".
    const allComputed = filtered
      .filter((project) => !project.isTest && !project.lostDeal)
      .map((project) => ({ project, tab: project.closePassed ? "accepted" as const : "in_progress" as const, pnl: ctx.compute(project.id) }));
    // Mục 6.6: an accepted project keeps the template of its G7 date. The figures above already use it; this stores it.
    await this.freezeTemplates(principal.workspaceId, computed.map((row) => row.project));
    // Khối 4 → khối 5: "bấm một nhóm thì bảng dự án lọc theo nhóm đó". The tiles, the total row and the reconciliation
    // line are computed on the projects the table shows, so "Tổng n dự án" is the sum of those n.
    const groupKey = text(query.groupKey);
    const inGroup = (pnl: ProjectPnl) => !groupKey || [...pnl.costGroups.accounting, ...pnl.costGroups.role].some((row) => row.key === groupKey && row.amount !== 0);
    const everyAccepted = computed.filter((row) => row.tab === "accepted");
    const accepted = everyAccepted.filter((row) => inGroup(row.pnl));
    const inProgress = computed.filter((row) => row.tab === "in_progress" && inGroup(row.pnl));
    const everyProject = allComputed.filter((row) => inGroup(row.pnl));
    const totals = dashboardTotals(accepted.map((row) => row.pnl));

    // Khối 3: why the totals are still Tạm tính, by kind.
    const acceptedIds = new Set(accepted.map((row) => row.project.id));
    const pendingEntries = ctx.entries.filter((entry) => entry.status === "pending" && entry.projectId && acceptedIds.has(entry.projectId));
    const pending: PnlPendingStripItem[] = [];
    for (const kind of ["cost_rate", "classification", "layer2_mismatch", "locked_period"] as PendingGroup[]) {
      const rows = pendingEntries.filter((entry) => pendingGroupOf(entry.reasons) === kind);
      if (!rows.length) continue;
      const minutes = sum(rows.map((entry) => entry.minutes));
      pending.push({ kind, label: `${hoursText(minutes)} ${PENDING_GROUP_LABELS[kind]}`, minutes, userCount: new Set(rows.map((entry) => entry.userId)).size, periodKeys: [...new Set(rows.map((entry) => entry.periodKey))].sort(), target: kind === "cost_rate" ? "staff_costs" : kind === "locked_period" ? "periods" : "pending_hours" });
    }
    const reasonMonths = (code: string) => [...new Set(accepted.flatMap((row) => row.pnl.result.reasons.filter((reason) => reason.code === code).flatMap((reason) => reason.periodKeys ?? [])))].sort();
    const fundMonths = reasonMonths("fund_unallocated");
    if (fundMonths.length) pending.push({ kind: "fund_unallocated", label: `quỹ tháng ${fundMonths.map((key) => key.slice(5)).join(", ")} chưa chia`, periodKeys: fundMonths, target: "funds" });
    const openMonths = reasonMonths("months_unlocked");
    if (openMonths.length) pending.push({ kind: "months_unlocked", label: `tháng ${openMonths.map((key) => key.slice(5)).join(", ")} chưa khóa`, periodKeys: openMonths, target: "periods" });
    if (totals.notComputableProjectCount) pending.push({ kind: "not_computable", label: `${totals.notComputableProjectCount} dự án Không tính được, chưa cộng vào ô tổng`, projectCount: totals.notComputableProjectCount, target: "project_value" });

    // Khối 4: cost by group, both groupings, generated from the tree — over every accepted project that has figures
    // (not only the group picked), so the cards add up to Tổng chi phí and another group can be picked.
    const allTotals = groupKey ? dashboardTotals(everyAccepted.map((row) => row.pnl)) : totals;
    const groupTotals = (pick: (pnl: ProjectPnl) => Array<{ key: string; label: string; amount: number }>): PnlCostGroup[] => {
      const rows = new Map<string, { key: string; label: string; amount: number }>();
      for (const pnl of allTotals.counted as ProjectPnl[]) for (const row of pick(pnl)) rows.set(row.key, { key: row.key, label: row.label, amount: (rows.get(row.key)?.amount ?? 0) + row.amount });
      return [...rows.values()].filter((row) => row.amount !== 0).map((row) => ({ ...row, sharePercent: meta.moneyVisible ? orNull(percentOf(row.amount, allTotals.totalCostAmount)) : null }));
    };

    const requestedTab = text(query.tab);
    // Keep the API's old default for direct callers; the web screen sends tab=all explicitly.
    const tab = requestedTab === "all" ? "all" : requestedTab === "in_progress" ? "in_progress" : "accepted";
    const pageSize = Math.min(Math.max(Number(text(query.pageSize) ?? 20) || 20, 1), 200);
    const page = Math.max(Number(text(query.page) ?? 1) || 1, 1);
    const sortKey = text(query.sort) ?? "start";
    const direction = text(query.direction) === "desc" ? -1 : 1;
    const sortValue = (row: PnlDashboardProjectRow): string | number => ({ name: row.projectName, start: row.startedOn, accepted: row.acceptedOn ?? "", revenue: row.revenueAmount ?? -Infinity, laborCost: row.laborCostAmount ?? 0, otherCost: row.otherCostAmount ?? 0, ebit: row.ebitAmount ?? -Infinity, margin: row.marginPercent ?? -Infinity } as Record<string, string | number>)[sortKey] ?? row.startedOn;
    const list = (rows: typeof computed, active: boolean) => {
      const mapped = rows.map((row) => toRow(row.project, row.pnl, row.tab))
        .sort((left, right) => { const a = sortValue(left); const b = sortValue(right); return (a < b ? -1 : a > b ? 1 : left.projectName.localeCompare(right.projectName)) * direction; });
      const current = active ? page : 1;
      return { total: mapped.length, page: current, pageSize, rows: mapped.slice((current - 1) * pageSize, current * pageSize) };
    };
    const totalResult: PnlResult = { label: totals.label, labelText: totals.labelText, reasons: [] };
    const acceptedList = list(accepted, tab === "accepted");
    const allList = list(everyProject, tab === "all");
    const years = [...new Set([...all.map((project) => Number(project.startedOn.slice(0, 4))), Number(ctx.currentPeriodKey.slice(0, 4)), year])].sort((left, right) => right - left);
    const uniq = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()].sort((left, right) => String((left as any).name).localeCompare(String((right as any).name)));

    return respond({
      filter: {
        year, unit: unit as "year", index, rule, fromPeriodKey: period.from, toPeriodKey: period.to,
        countedProjectCount: accepted.length, excludedTestProjectCount,
        options: {
          years,
          projectTypes: [...ctx.templates.values()].map((template) => ({ value: template.key, label: template.name })),
          accounts: uniq(all.map((project) => ({ id: project.accountId, name: project.accountName }))),
          pics: uniq(all.filter((project) => project.picUserId).map((project) => ({ id: project.picUserId as string, name: ctx.userName(project.picUserId) as string })))
        },
        hint: "Nên xem kỳ dài (6 tháng đến 1 năm) vì dự án thường kéo dài hơn 2 tháng."
      },
      totals: {
        projectCount: totals.projectCount, revenueAmount: orNull(totals.revenueAmount), totalCostAmount: totals.totalCostAmount, laborCostAmount: totals.laborCostAmount, otherCostAmount: totals.otherCostAmount,
        ebitAmount: orNull(totals.ebitAmount), marginPercent: orNull(totals.marginPercent), result: totalResult,
        provisionalProjectCount: totals.provisionalProjectCount, notComputableProjectCount: totals.notComputableProjectCount
      },
      pending,
      costGroups: { accounting: groupTotals((pnl) => pnl.costGroups.accounting), role: groupTotals((pnl) => pnl.costGroups.role) },
      accepted: {
        ...acceptedList,
        totalRow: { revenueAmount: orNull(totals.revenueAmount), laborCostAmount: totals.laborCostAmount, otherCostAmount: totals.otherCostAmount, ebitAmount: orNull(totals.ebitAmount), marginPercent: orNull(totals.marginPercent), result: totalResult },
        reconciliation: reconcileHours({
          loggedMinutes: sum(accepted.map((row) => row.pnl.reconciliation.loggedMinutes)), includedMinutes: sum(accepted.map((row) => row.pnl.reconciliation.includedMinutes)),
          pendingMinutes: sum(accepted.map((row) => row.pnl.reconciliation.pendingMinutes)), excludedMinutes: sum(accepted.map((row) => row.pnl.reconciliation.excludedMinutes))
        })
      },
      all: allList,
      inProgress: list(inProgress, tab === "in_progress"),
      companyCosts: this.companyCosts(this.companyMonths(ctx, periodKeys))
    }, meta);
  }

  /** Mục 4 khối 6: "Bấm một dòng mở danh sách theo người và dự án". */
  async companyCostDetail(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlCompanyCostDetailResponse> {
    const meta = pnlMeta(principal, this.now());
    const from = requirePeriodKey(query.from, "from");
    const to = requirePeriodKey(query.to ?? query.from, "to");
    if (to < from) throw new BadRequestException("to phải sau hoặc bằng from.");
    const line = text(query.line);
    const periodKeys = monthKeysBetween(from, to).slice(0, 24);
    const ctx = await this.context(principal.workspaceId, { periodKeys });
    const months = this.companyMonths(ctx, periodKeys);
    const data: PnlCompanyCostDetailResponse["data"] = months.flatMap((month) => month.details.filter((row) => !line || row.line === line).map((row) => ({
      line: row.line as CompanyLineKey, periodKey: month.periodKey, userId: row.userId, userName: ctx.userName(row.userId), projectId: row.projectId, projectName: row.projectId ? ctx.projects.get(row.projectId)?.name ?? null : null, minutes: row.minutes, amount: orNull(row.amount)
    })));
    if (!line || line === "unallocated") for (const month of months) data.push({ line: "unallocated", periodKey: month.periodKey, userId: null, userName: null, projectId: null, projectName: null, minutes: 0, amount: month.lines.unallocated.amount });
    const body = respond({ rows: data, companyCosts: this.companyCosts(months) }, meta);
    return { data: body.data.rows, meta: { ...meta, companyCosts: body.data.companyCosts } };
  }

  // -------------------------------------------------------------------------
  // Mục 5 — P&L dự án
  // -------------------------------------------------------------------------

  private async projectContext(projectId: string, principal: PrincipalContext) {
    const ctx = await this.context(principal.workspaceId, { projectIds: [projectId] });
    const project = ctx.projects.get(projectId);
    if (!project) throw new NotFoundException("Dự án không thuộc workspace hiện tại.");
    return { ctx, project };
  }

  /**
   * Mục 6.6: "dự án đã qua G7 giữ mẫu tại thời điểm nghiệm thu". For the G7 gate hook (closeProjectPnl), called once the
   * approval is committed. Idempotent, and a no-op for a project that has not passed G7.
   */
  async freezeTemplateAtClose(workspaceId: string, projectId: string): Promise<void> {
    const ctx = await this.context(workspaceId, { projectIds: [projectId] });
    await this.freezeTemplates(workspaceId, [...ctx.projects.values()].filter((project) => project.id === projectId));
  }

  /**
   * Stores the switched-off codes of every accepted project that has none stored yet. The loader already resolved them
   * as of the G7 date (template history), so a read before and after this write shows the same figures; every report
   * read calls it, which covers projects accepted before the hook existed. A project whose acceptance date is only an
   * estimate is left open until it has a real one.
   */
  private async freezeTemplates(workspaceId: string, projects: readonly ProjectCtx[]) {
    for (const project of projects) {
      if (!project.closePassed || project.acceptanceEstimated || !project.acceptedAt || project.record?.frozenAt) continue;
      const data = { frozenDisabledCodes: [...project.disabledCodes], frozenAt: project.acceptedAt };
      if (project.record) await this.prisma.projectPnlRecord.updateMany({ where: { projectId: project.id, frozenAt: null }, data });
      // PL-28: one record per project. A project older than the records gets its record here; a concurrent read may have written it first.
      else await this.prisma.projectPnlRecord.create({ data: { id: `ppr_${project.id}`, workspaceId, projectId: project.id, ...data } }).catch(() => undefined);
    }
  }

  async project(projectId: string, query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlProjectResponse> {
    const meta = pnlMeta(principal, this.now());
    const { ctx, project } = await this.projectContext(projectId, principal);
    await this.freezeTemplates(principal.workspaceId, [project]);
    const whole = ctx.compute(projectId);
    const allMonths = [...new Set([...ctx.entriesOf(projectId).map((entry) => entry.periodKey), project.startedOn.slice(0, 7)])].sort();
    const minPeriodKey = allMonths[0];
    const maxPeriodKey = [project.acceptedOn?.slice(0, 7), project.plannedEndOn?.slice(0, 7), allMonths[allMonths.length - 1]].filter(Boolean).sort().pop() as string;
    const fromKey = text(query.fromMonth);
    const toKey = text(query.toMonth);
    const range = fromKey || toKey ? { from: requirePeriodKey(fromKey ?? minPeriodKey, "fromMonth"), to: requirePeriodKey(toKey ?? maxPeriodKey, "toMonth") } : undefined;
    if (range && (range.to < range.from || range.from < minPeriodKey || range.to > maxPeriodKey)) throw new BadRequestException(`Phạm vi chỉ trong khoảng ${monthLabel(minPeriodKey)} đến ${monthLabel(maxPeriodKey)} của dự án.`);
    const pnl = range ? ctx.compute(projectId, range) : whole;

    // Giờ kế hoạch = Σ estimate of the lowest-level tasks ("từ sub-task đã lập"), by assignee; nobody assigned → "Chưa giao".
    const tasks: any[] = await this.prisma.projectTask.findMany({ where: { workspaceId: principal.workspaceId, projectId }, select: { id: true, parentTaskId: true, estimateMinutes: true, assigneeUserId: true, cancelledAt: true } });
    const parents = new Set(tasks.map((task) => task.parentTaskId).filter(Boolean));
    const leaves = tasks.filter((task) => !parents.has(task.id) && !task.cancelledAt);
    const plannedByUser = new Map<string, number>();
    for (const task of leaves) plannedByUser.set(task.assigneeUserId ?? "", (plannedByUser.get(task.assigneeUserId ?? "") ?? 0) + (task.estimateMinutes ?? 0));
    const plannedMinutes = sum([...plannedByUser.values()]);
    const unknownIds = [...plannedByUser.keys()].filter((id) => id && !ctx.users.has(id));
    const extraUsers: any[] = unknownIds.length ? await this.prisma.user.findMany({ where: { id: { in: unknownIds } }, select: { id: true, displayName: true, email: true } }) : [];
    const nameOf = (userId: string) => ctx.users.get(userId)?.name ?? extraUsers.find((user) => user.id === userId)?.displayName ?? userId;

    // A person appears with logged hours or with planned hours; an assignee of a task without an estimate adds no row.
    const peopleIds = [...new Set([...pnl.people.map((person) => person.userId), ...[...plannedByUser.entries()].filter(([userId, minutes]) => userId && minutes > 0).map(([userId]) => userId)])];
    const people: PnlProjectPersonRow[] = peopleIds.map((userId) => {
      const person = pnl.people.find((row) => row.userId === userId);
      const roleGroup = person?.roleGroup ?? ctx.users.get(userId)?.roleGroup ?? null;
      return {
        userId, displayName: nameOf(userId), roleGroup, roleGroupLabel: roleGroup ? ROLE_GROUP_LABELS[roleGroup] : null,
        plannedMinutes: plannedByUser.get(userId) ?? 0, loggedMinutes: person?.loggedMinutes ?? 0, includedMinutes: person?.includedMinutes ?? 0,
        laborCostAmount: orNull(person?.laborCostAmount), status: person ? personStatus(person.missing) : { ok: true, label: "Chưa ghi giờ", missing: [] }
      };
    }).sort((left, right) => (right.loggedMinutes ?? 0) - (left.loggedMinutes ?? 0) || left.displayName.localeCompare(right.displayName));
    if (plannedByUser.get("")) people.push({ userId: null, displayName: "Chưa giao", roleGroup: null, roleGroupLabel: null, plannedMinutes: plannedByUser.get("") as number, loggedMinutes: null, includedMinutes: null, laborCostAmount: null, status: null });

    const monthRow = (row: ProjectPnl["months"][number]): PnlProjectMonthRow => {
      const state = periodStateOf(row.periodKey, ctx.currentPeriodKey, row.locked);
      const hasOther = row.fundCostAmount !== 0 || row.directCostAmount !== 0 || ctx.fundShares.some((share) => share.projectId === projectId && share.periodKey === row.periodKey) || ctx.manualLines.some((line) => line.projectId === projectId && line.periodKey === row.periodKey);
      return {
        periodKey: row.periodKey, periodState: state, periodStateLabel: PERIOD_STATE_LABELS[state], fromSnapshot: Boolean(ctx.locked.get(row.periodKey)?.snapshot),
        loggedMinutes: row.loggedMinutes, includedMinutes: row.includedMinutes, pendingMinutes: row.pendingMinutes, excludedMinutes: row.excludedMinutes,
        excludedByReason: reasonRows(row.byReason, "excluded"), pendingByReason: reasonRows(row.byReason, "pending"),
        laborCostAmount: row.laborCostAmount, otherCostAmount: hasOther ? row.otherCostAmount : null, fundCostAmount: hasOther ? row.fundCostAmount : null, directCostAmount: hasOther ? row.directCostAmount : null,
        totalCostAmount: row.totalCostAmount, missing: row.missing
      };
    };
    const consumable = project.consumable;
    // PL-13: Admin - PM in the cost group enters the project's revenue directly.
    const mayEditValue = meta.moneyVisible && canEditProjectSetup(principal);
    // "Khoản tính cho cả dự án" is added to Toàn dự án only: with a narrowed scope it is, like Doanh thu and EBIT, "Chỉ xem ở Toàn dự án".
    // Every cost line computed once for the lifecycle is listed, with the amount it enters Tổng chi phí with, so
    // Toàn dự án = the month rows + these rows whatever the tree holds.
    const wholeProjectItems = whole.wholeProjectCosts.filter((row) => row.code !== SYSTEM_ITEM_CODES.commission || whole.commission.enabled).map((row) => {
      const commission = row.code === SYSTEM_ITEM_CODES.commission;
      return { code: row.code, label: commission ? "Hoa hồng" : row.name, amount: range ? null : orNull(row.amount), note: range ? "Chỉ xem ở Toàn dự án" : !commission ? "Tính một lần cho cả dự án" : whole.commission.expected ? "Hoa hồng dự kiến" : "Hoa hồng ghi nhận", expected: whole.commission.expected };
    });
    const revenueLabel = "Doanh thu dự án";

    const body: PnlProjectResponse["data"] = {
      header: {
        projectId, projectCode: project.code, projectName: project.name, accountId: project.accountId, accountName: project.accountName,
        projectType: project.projectType, templateKey: project.templateKey, templateName: project.template.name,
        picUserId: project.picUserId, picName: ctx.userName(project.picUserId),
        projectStatus: projectStatusLabel(project.status) ?? project.status,
        plannedStartOn: project.plannedStartOn, plannedEndOn: project.plannedEndOn, acceptedOn: orNull(project.acceptedOn), acceptedOnEstimated: project.acceptanceEstimated, closeGate: project.closeGate, isTestProject: project.isTest,
        recordState: whole.recordState, recordStateLabel: RECORD_STATE_LABELS[whole.recordState], result: toResult(whole.result),
        scope: { whole: !range, fromPeriodKey: range?.from ?? null, toPeriodKey: range?.to ?? null, minPeriodKey, maxPeriodKey }
      },
      totals: {
        plannedMinutes, loggedMinutes: pnl.whole.loggedMinutes,
        loggedVsPlanPercent: plannedMinutes > 0 ? Math.round(((pnl.whole.loggedMinutes - plannedMinutes) / plannedMinutes) * 10000) / 100 : null,
        monthsWithHours: pnl.months.filter((row) => row.loggedMinutes > 0).length,
        revenue: {
          amount: range ? null : orNull(whole.revenue.amount), basis: whole.revenue.basis, label: revenueLabel,
          note: range ? "Chỉ xem ở Toàn dự án" : whole.revenue.amount === undefined ? whole.revenue.missingReason ?? "" : "nhập tay theo từng dự án",
          wholeProjectOnly: Boolean(range), missingReason: orNull(whole.revenue.missingReason),
          projectValueAmount: orNull(project.projectValueAmount), canEdit: mayEditValue,
          reasonRequired: project.g1Passed && project.projectValueAmount !== undefined,
          lockedReason: null
        },
        cost: { totalAmount: pnl.whole.totalCostAmount, laborAmount: pnl.whole.laborCostAmount, otherAmount: pnl.whole.otherCostAmount },
        ebit: {
          amount: range ? null : orNull(whole.ebit.amount), marginPercent: range ? null : orNull(whole.ebit.marginPercent), expected: whole.ebit.expected,
          label: whole.ebit.expected ? "EBIT dự kiến" : "EBIT", wholeProjectOnly: Boolean(range),
          missingReason: whole.ebit.amount === undefined ? whole.revenue.missingReason ?? "chưa có doanh thu" : null
        },
        consumable
      },
      people,
      months: {
        whole: {
          loggedMinutes: pnl.whole.loggedMinutes, includedMinutes: pnl.whole.includedMinutes, pendingMinutes: pnl.whole.pendingMinutes, excludedMinutes: pnl.whole.excludedMinutes,
          excludedByReason: reasonRows(pnl.whole.byReason, "excluded"), pendingByReason: reasonRows(pnl.whole.byReason, "pending"),
          laborCostAmount: pnl.whole.laborCostAmount, otherCostAmount: pnl.whole.otherCostAmount, fundCostAmount: pnl.whole.fundCostAmount, directCostAmount: pnl.whole.directCostAmount,
          totalCostAmount: pnl.whole.totalCostAmount, missing: pnl.whole.missing
        },
        rows: pnl.months.map(monthRow),
        wholeProjectItems,
        afterClose: {
          visible: project.closePassed,
          note: project.closePassed ? "Giờ và chi phí Milestone 4 theo tháng · không cộng vào Toàn dự án" : `Chưa qua ${project.closeGate} · hiện giờ và chi phí Milestone 4 theo tháng · không cộng vào Toàn dự án`,
          minutes: whole.afterClose.minutes, amount: whole.afterClose.minutes ? whole.afterClose.amount : null, uncostedMinutes: whole.afterClose.uncostedMinutes,
          rows: whole.afterClose.rows.map((row) => ({ periodKey: row.periodKey, minutes: row.minutes, amount: orNull(row.amount) }))
        },
        reconciliation: pnl.reconciliation
      },
      items: meta.moneyVisible ? this.itemRows(ctx, project, whole) : null,
      history: meta.moneyVisible ? await this.projectHistory(ctx, project) : null,
      template: {
        key: project.templateKey, name: project.template.name, disabledCodes: [...project.disabledCodes],
        override: project.record?.overrideAt ? { disabledCodes: project.record.overrideDisabledCodes ?? [], enabledCodes: project.record.overrideEnabledCodes ?? [], reason: project.record.overrideReason ?? "", byName: project.record.overrideByName ?? null, at: new Date(project.record.overrideAt).toISOString() } : null,
        canOverride: isAdminAccount(principal) && !project.closePassed
      }
    };
    return respond(body, meta);
  }

  /** Mục 5 khối 5: the tree by the project's template, lifecycle totals, the source of every number, and the Nhập tay lines. */
  private itemRows(ctx: PnlContext, project: ProjectCtx, pnl: ProjectPnl): PnlProjectItemRow[] {
    // The tree the figures were added up with: an item that carries a number of a locked month stays listed (PL-24).
    const { tree, disabledCodes } = ctx.pnlTreeOf(project.id);
    const byCode = new Map(tree.map((row) => [row.code, row]));
    const levelOf = (row: CostItemDef) => { let level = 1; for (let cursor = row; cursor.parentCode && byCode.has(cursor.parentCode) && level < 20; cursor = byCode.get(cursor.parentCode) as CostItemDef) level += 1; return level; };
    const buckets = bucketEntries(ctx.entriesOf(project.id));
    const fallbackManual = tree.find((row) => row.code === "CP.FUNCOP.RIENG" && !disabledCodes.has(row.code))?.code ?? tree.find((row) => row.method === "MANUAL" && !disabledCodes.has(row.code) && accountingGroupOf(tree, row.code))?.code;
    const counted = (row: { itemCode: string | null; counted?: boolean }) => row.counted ?? !(row.itemCode && project.disabledCodes.has(row.itemCode));
    const lines = ctx.manualLines.filter((line) => line.projectId === project.id && counted(line)).map((line) => ({ ...line, itemCode: line.itemCode ?? fallbackManual ?? "" }));
    const byMonth = (rows: Array<{ periodKey: string; amount: number }>) => {
      const map = new Map<string, number>();
      for (const row of rows) map.set(row.periodKey, (map.get(row.periodKey) ?? 0) + row.amount);
      return [...map.entries()].sort().map(([periodKey, amount]) => ({ periodKey, amount }));
    };
    const operand = (token: any) => ("item" in token ? `[${byCode.get(token.item)?.name ?? token.item}]` : "param" in token ? `[${token.param === "commissionPercent" ? "Tỷ lệ hoa hồng" : token.param}]` : "value" in token ? String(token.value) : ({ "*": "×", "/": "÷", "+": "+", "-": "−" } as Record<string, string>)[token.op]);
    return tree.filter((row) => !disabledCodes.has(row.code)).map((row) => {
      const value = pnl.itemValues.get(row.code);
      let source: PnlProjectItemRow["source"];
      if (row.method === "SYSTEM" && row.systemSource === "labor") {
        source = { kind: "hours", description: `Giờ tính P&L của nhóm ${ROLE_GROUP_LABELS[row.roleGroup as RoleGroup]} × cost rate của từng người trong từng tháng`, byMonth: byMonth(buckets.filter((bucket) => bucket.roleGroup === row.roleGroup).map((bucket) => ({ periodKey: bucket.periodKey, amount: costOfMinutes(project.consumable ? bucket.internalMinutes : bucket.includedMinutes, bucket.rate) ?? 0 })).filter((item) => item.amount !== 0)) };
      } else if (row.code === SYSTEM_ITEM_CODES.revenue) {
        source = { kind: "revenue", description: "Doanh thu do Admin/PM nhập trực tiếp theo từng dự án; không lấy tự động từ hệ thống", byMonth: [] };
      } else if (row.method === "FUND") {
        source = { kind: "fund", description: "Phần quỹ chi phí chung được chia theo giờ tính P&L, đã xác nhận", byMonth: byMonth(ctx.fundShares.filter((share) => share.projectId === project.id && share.itemCode === row.code && counted(share))) };
      } else if (row.method === "MANUAL") {
        source = { kind: "manual", description: "Nhập tay theo tháng phát sinh", byMonth: byMonth(lines.filter((line) => line.itemCode === row.code)) };
      } else if (row.method === "FORMULA") {
        source = { kind: "formula", description: (row.formula ?? []).map(operand).join(" "), byMonth: [] };
      } else source = { kind: "group", description: "Tổng nhóm: hệ thống cộng các dòng con", byMonth: [] };
      return {
        code: row.code, name: row.name, parentCode: row.parentCode, level: levelOf(row), sign: row.sign, unit: row.unit, method: row.method, methodLabel: COST_ITEM_METHOD_LABELS[row.method], roleGroup: row.roleGroup,
        amount: orNull(value?.amount), incomplete: Boolean(value?.incomplete), source,
        ...(row.method === "MANUAL" ? { manualLines: lines.filter((line) => line.itemCode === row.code).map((line) => ({ id: line.id, itemCode: row.code, periodKey: line.periodKey, occurredOn: line.occurredOn, label: line.label, amount: line.amount, note: line.note, locked: ctx.lockedKeys.has(line.periodKey) })) } : {})
      };
    });
  }

  private async projectHistory(ctx: PnlContext, project: ProjectCtx): Promise<PnlHistoryEvent[]> {
    const months = new Set([...ctx.entriesOf(project.id).map((entry) => entry.periodKey), ...ctx.manualLines.filter((line) => line.projectId === project.id).map((line) => line.periodKey)]);
    const rows: any[] = await this.prisma.auditEvent.findMany({
      where: { workspaceId: ctx.workspaceId, OR: [{ resource: "pnl_project", resourceId: project.id }, { resource: { in: ["pnl_period", "pnl_fund"] } }] },
      orderBy: { createdAt: "desc" }, take: 500
    });
    const labels: Record<string, string> = {
      "pnl.period_locked": "Khóa kỳ", "pnl.period_reopened": "Mở lại kỳ", "pnl.fund_confirmed": "Xác nhận phân bổ quỹ", "pnl.fund_rerun": "Chạy lại phân bổ quỹ",
      "pnl.project_cost_created": "Thêm chi phí riêng", "pnl.project_cost_changed": "Sửa chi phí riêng", "pnl.project_cost_deleted": "Xóa chi phí riêng",
      "pnl.project_value_changed": "Sửa doanh thu dự án", "pnl.template_override": "Ghi đè mẫu khoản mục", "pnl.contract_status_changed": "Đổi trạng thái hợp đồng", "pnl.installments_changed": "Sửa đợt thanh toán", "pnl.installment_status_changed": "Đổi trạng thái đợt thanh toán"
    };
    const kept = rows.filter((row) => row.resource === "pnl_project" || months.has(String((row.after as any)?.periodKey ?? "")));
    const actorIds = [...new Set(kept.map((row) => row.actorUserId).filter((id) => id && !ctx.users.has(id)))];
    const actors: any[] = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } }) : [];
    return kept.map((row) => ({
      id: row.id, at: new Date(row.createdAt).toISOString(), actorName: row.actorUserId ? ctx.users.get(row.actorUserId)?.name ?? actors.find((user) => user.id === row.actorUserId)?.displayName ?? null : null,
      action: row.action, label: labels[row.action] ?? row.action, periodKey: (row.after as any)?.periodKey ?? (row.before as any)?.periodKey, reason: (row.after as any)?.reason, before: row.before ?? undefined, after: row.after ?? undefined
    }));
  }

  /** Mục 5 khối 4: bảng người × ngày of one month ("all" = every month with hours), the by-task view and the month's reconciliation. */
  async projectMonths(projectId: string, periodRef: string, principal: PrincipalContext): Promise<PnlProjectMonthDetailResponse> {
    const meta = pnlMeta(principal, this.now());
    const { ctx, project } = await this.projectContext(projectId, principal);
    const entries = ctx.entriesOf(projectId);
    const periodKeys = periodRef === "all" ? [...new Set(entries.map((entry) => entry.periodKey))].sort() : [requirePeriodKey(periodRef)];
    const userIds = [...new Set(entries.map((entry) => entry.userId))];
    const leaves: any[] = userIds.length && periodKeys.length
      ? await this.prisma.personalLeave.findMany({ where: { workspaceId: principal.workspaceId, userId: { in: userIds }, status: "approved" }, select: { userId: true, startDate: true, endDate: true } })
      : [];
    const costOf = entryCosts(entries);
    // What the project is charged for: its counted hours — for an internal project, its Nội bộ hours.
    const charged = (entry: EngineEntry) => (project.consumable ? entry.reasons[0] === "internal" : entry.status === "included") && costOf.has(entry.id);
    const data: PnlProjectMonthDetail[] = periodKeys.map((periodKey) => {
      const ofMonth = entries.filter((entry) => entry.periodKey === periodKey);
      const [year, month] = periodKey.split("-").map(Number);
      const days = Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, index) => {
        const dateKey = `${periodKey}-${String(index + 1).padStart(2, "0")}`;
        return { dateKey, weekend: !isWorkingDay(dateKey), holiday: ctx.dayOffs.has(dateKey), ...(ctx.dayOffs.has(dateKey) ? { holidayName: ctx.dayOffs.get(dateKey) } : {}) };
      });
      const split = (rows: readonly EngineEntry[]) => ({ loggedMinutes: sum(rows.map((entry) => entry.minutes)), includedMinutes: sum(rows.filter((entry) => entry.status === "included").map((entry) => entry.minutes)), pendingMinutes: sum(rows.filter((entry) => entry.status === "pending").map((entry) => entry.minutes)), excludedMinutes: sum(rows.filter((entry) => entry.status === "excluded").map((entry) => entry.minutes)) });
      const people = bucketEntries(ofMonth).map((bucket) => {
        const rows = ofMonth.filter((entry) => entry.userId === bucket.userId);
        const missing = (["cost_rate", "classification", "layer2_mismatch", "locked_period"] as PendingGroup[]).filter((kind) => bucket.pendingByGroup[kind] > 0).map((kind) => ({ kind, label: "", periodKey, target: "pending_hours" as const }));
        const leaveDays = days.map((day) => day.dateKey).filter((dateKey) => leaves.some((leave) => leave.userId === bucket.userId && new Date(leave.startDate).toISOString().slice(0, 10) <= dateKey && new Date(leave.endDate).toISOString().slice(0, 10) >= dateKey));
        const minutes = project.consumable ? bucket.internalMinutes : bucket.includedMinutes;
        return {
          userId: bucket.userId, displayName: ctx.userName(bucket.userId) as string, roleGroup: bucket.roleGroup, roleGroupLabel: ROLE_GROUP_LABELS[bucket.roleGroup],
          hourlyCostRate: bucket.rate ? hourlyRate(bucket.rate) : null,
          ...split(rows), laborCostAmount: minutes > 0 ? orNull(costOfMinutes(minutes, bucket.rate)) : bucket.rate ? 0 : null,
          status: personStatus(missing), leaveDays,
          byDay: [...new Set(rows.map((entry) => entry.dateKey))].sort().map((dateKey) => ({ dateKey, ...split(rows.filter((entry) => entry.dateKey === dateKey)) }))
        };
      }).sort((left, right) => right.loggedMinutes - left.loggedMinutes);
      const taskIds = [...new Set(ofMonth.map((entry) => entry.taskId ?? ""))];
      const tasks = taskIds.map((taskId) => {
        const rows = ofMonth.filter((entry) => (entry.taskId ?? "") === taskId);
        const reasons = new Map<PnlGateReason, number>();
        for (const entry of rows) if (entry.reasons[0]) reasons.set(entry.reasons[0], (reasons.get(entry.reasons[0]) ?? 0) + entry.minutes);
        // Each hour's share of its person × month bucket, so the tasks add up to the people table to the đồng.
        const costed = rows.filter(charged);
        return {
          taskId, taskTitle: ctx.entryMeta.get(rows[0].id)?.taskTitle ?? "(task đã xóa)",  layer1: rows[0].layer1,
          ...split(rows), laborCostAmount: costed.length ? sum(costed.map((entry) => costOf.get(entry.id) as number)) : null,
          reasons: [...reasons.entries()].map(([reason, minutes]) => ({ reason, label: PNL_GATE_REASON_LABELS[reason], minutes }))
        };
      }).sort((left, right) => right.loggedMinutes - left.loggedMinutes);
      return { periodKey, periodState: periodStateOf(periodKey, ctx.currentPeriodKey, ctx.lockedKeys.has(periodKey)), standardMinutes: ctx.standardMinutes(periodKey), days, people, tasks, reconciliation: reconcileHours(split(ofMonth)) };
    });
    return respond(data, meta);
  }

  // -------------------------------------------------------------------------
  // Giờ log nguồn (PL-07) and the "Chờ xử lý" worklist
  // -------------------------------------------------------------------------

  async entries(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlSourceEntriesResponse> {
    const meta = pnlMeta(principal, this.now());
    const projectIds = csvList(query.projectId);
    // Day-level scope (inclusive Vietnam days) next to the month one; the month parameters keep working.
    const fromDay = optionalDayKey(query.fromDay, "fromDay");
    const toDay = optionalDayKey(query.toDay, "toDay");
    if (fromDay && toDay && toDay < fromDay) throw new BadRequestException("toDay không được trước fromDay.");
    const month = text(query.from) ?? text(query.periodKey) ?? text(query.period);
    const from = month ?? (fromDay && toDay ? fromDay.slice(0, 7) : undefined);
    const to = month ? text(query.to) ?? month : toDay?.slice(0, 7);
    const periodKeys = from ? monthKeysBetween(requirePeriodKey(from, "from"), requirePeriodKey(to, "to")).slice(0, 36) : undefined;
    const statuses = csvList(query.status);
    const reasons = csvList(query.reason);
    const groupKeys = csvList(query.group);
    const userIds = csvList(query.userId);
    const line = text(query.line);
    if (statuses.some((status) => !Object.prototype.hasOwnProperty.call(PNL_GATE_STATUS_LABELS, status))) throw new BadRequestException("status phải là included, pending hoặc excluded.");
    if (reasons.some((reason) => !Object.prototype.hasOwnProperty.call(PNL_GATE_REASON_LABELS, reason))) throw new BadRequestException("reason không hợp lệ.");
    const ctx = await this.context(principal.workspaceId, { ...(projectIds.length ? { projectIds } : {}), ...(periodKeys && !projectIds.length ? { periodKeys } : {}) });
    if (projectIds.some((projectId) => !ctx.projects.has(projectId))) throw new NotFoundException("Dự án không thuộc workspace hiện tại.");
    const lineReason: Record<string, PnlGateReason> = { pre_sale: "lost_deal_pre_sale", after_close: "after_close", internal: "internal" };
    const rows = ctx.entries.filter((entry) =>
      (!periodKeys || periodKeys.includes(entry.periodKey))
      && (!fromDay || entry.dateKey >= fromDay)
      && (!toDay || entry.dateKey <= toDay)
      && (!statuses.length || statuses.includes(entry.status))
      && (!reasons.length || entry.reasons.some((reason) => reasons.includes(reason)))
      && (!groupKeys.length || (entry.status === "pending" && groupKeys.includes(pendingGroupOf(entry.reasons))))
      && (!line || entry.reasons[0] === lineReason[line])
      && (!userIds.length || userIds.includes(entry.userId))
      && (text(query.blocking) !== "true" || blocksG7(entry)));
    const deadlineDays = await getStoredParameter(this.prisma, principal.workspaceId, "pendingHoursWorkingDays");
    const now = this.now();
    const costOf = entryCosts(ctx.entries);
    const targetOf = (entry: EngineEntry) => { const kind = pendingGroupOf(entry.reasons); return kind === "cost_rate" ? "staff_costs" as const : kind === "locked_period" ? "periods" as const : "pending_hours" as const; };
    const data: PnlSourceEntryRow[] = rows.map((entry) => {
      const project = entry.projectId ? ctx.projects.get(entry.projectId) : undefined;
      const info = ctx.entryMeta.get(entry.id);
      // PL-02 / A-1b: no deadline (and so no DL-01) for a trial project. Pre-sale hours count like any other (chốt 13/10).
      const due = entry.status === "pending" && info?.pendingSince ? pendingDeadline(info.pendingSince, now, deadlineDays, ctx.dayOffKeys, Boolean(project?.isTest)) : undefined;
      return {
        id: entry.id, projectId: entry.projectId, projectCode: project?.code, projectName: project?.name, taskId: entry.taskId, taskTitle: info?.taskTitle,
        userId: entry.userId, userDisplayName: ctx.userName(entry.userId) as string, roleGroup: entry.roleGroup, workDate: entry.dateKey, periodKey: entry.periodKey, minutes: entry.minutes,
        taskTypeLayer1: entry.layer1, taskTypeLayer2: info?.taskTypeLayer2 ?? null, selectedTaskTypeLayer2: info?.selectedTaskTypeLayer2 ?? null,
        status: entry.status, statusLabel: PNL_GATE_STATUS_LABELS[entry.status], reason: entry.reasons[0], reasons: entry.reasons, reasonLabels: entry.reasons.map((code) => PNL_GATE_REASON_LABELS[code]),
        blocksG7: blocksG7(entry),
        hourlyCostRate: entry.rate ? hourlyRate(entry.rate) : null,
        // Only a cost that sits in a figure: project labor or a company line, as that hour's share of the figure. A pending hour has none yet.
        costAmount: orNull(costOf.get(entry.id)),
        ...(due?.deadline ? { deadline: due.deadline.toISOString(), overdue: due.overdue } : {}),
        ...(entry.status === "pending" && project?.picUserId ? { ownerUserId: project.picUserId, ownerDisplayName: ctx.userName(project.picUserId) as string } : {}),
        ...(entry.status === "pending" ? { target: targetOf(entry) } : {}),
        fromSnapshot: Boolean(entry.fromSnapshot),
        // Kept for the previous worklist screen until it is rebuilt.
        ...({ loggedAt: info?.loggedAt?.toISOString(), stageId: info?.stageId, stageName: info?.stageName, frozen: Boolean(entry.fromSnapshot) } as object)
      };
    }).sort((left, right) => (left.deadline ?? "9").localeCompare(right.deadline ?? "9") || left.workDate.localeCompare(right.workDate) || left.id.localeCompare(right.id));
    const body = respond(data, meta);
    return { data: body.data, meta: { ...meta, entryCount: data.length, totalMinutes: sum(data.map((row) => row.minutes)), totalCostAmount: meta.moneyVisible ? sum(data.map((row) => row.costAmount ?? 0)) : null, overdueCount: data.filter((row) => row.overdue).length, pendingDeadlineWorkingDays: deadlineDays } };
  }

  /**
   * For the G7 approval (mục 7 điểm 6, A-9): hours of the project "Chờ xử lý" because of a missing or wrong
   * classification or line item. Hours only waiting for a cost rate are reported apart and do not block.
   */
  async pendingHoursBlockingG7(workspaceId: string, projectId: string): Promise<PnlG7Blockers> {
    const ctx = await this.context(workspaceId, { projectIds: [projectId] });
    return { projectId, ...g7Blockers(ctx.entriesOf(projectId)) };
  }

  /** DL-01 source: pending hours past their deadline are judged by the scan; trial projects never get there. */
  async pendingHoursForAlerts(workspaceId: string, projectIds: string[]): Promise<Array<{ projectId: string; minutes: number; loggedAt: Date }>> {
    if (!projectIds.length) return [];
    const ctx = await this.context(workspaceId, { projectIds });
    return ctx.entries
      .filter((entry) => entry.status === "pending" && entry.projectId && !ctx.projects.get(entry.projectId)?.isTest && !ctx.projects.get(entry.projectId)?.internalWorklog)
      .map((entry) => ({ projectId: entry.projectId as string, minutes: entry.minutes, loggedAt: ctx.entryMeta.get(entry.id)?.pendingSince ?? new Date(`${entry.dateKey}T00:00:00.000Z`) }));
  }

  // -------------------------------------------------------------------------
  // Mục 6.4 — Quỹ chi phí chung
  // -------------------------------------------------------------------------

  /** Giờ tính P&L of the month per project that takes a share: chargeable projects with counted hours, never a trial project. */
  private fundBasis(ctx: PnlContext, periodKey: string, fund: { eligibility: string; eligibleProjectIds: string[]; targetItemCode: string }) {
    const minutes = new Map<string, number>();
    for (const entry of ctx.entries) {
      if (entry.periodKey !== periodKey || entry.status !== "included" || !entry.projectId) continue;
      const project = ctx.projects.get(entry.projectId);
      if (!project || project.isTest || project.consumable || project.internalWorklog) continue;
      // A project whose template (or override) switches the fund's target item off would drop its share: it takes none.
      if (project.disabledCodes?.has(fund.targetItemCode)) continue;
      if (fund.eligibility === "selected_projects" && !fund.eligibleProjectIds.includes(project.id)) continue;
      minutes.set(project.id, (minutes.get(project.id) ?? 0) + entry.minutes);
    }
    return [...minutes.entries()].map(([projectId, value]) => ({ projectId, minutes: value, name: ctx.projects.get(projectId)?.name ?? projectId })).sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }

  async funds(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlFundsResponse> {
    const meta = pnlMeta(principal, this.now());
    const now = this.now();
    const periodKey = text(query.periodKey) ? requirePeriodKey(query.periodKey) : reportMonthKey(now);
    const ctx = await this.context(principal.workspaceId, { periodKeys: [periodKey] });
    const lock = ctx.locked.get(periodKey);
    const [fundRows, periodRows, allocationRows]: any[][] = await Promise.all([
      this.prisma.pnlFund.findMany({ where: { workspaceId: principal.workspaceId }, orderBy: { code: "asc" } }),
      this.prisma.pnlFundPeriod.findMany({ where: { workspaceId: principal.workspaceId, periodKey } }),
      this.prisma.pnlFundAllocation.findMany({ where: { workspaceId: principal.workspaceId, periodKey } })
    ]);
    const itemName = new Map(ctx.tree.map((row) => [row.code, row.name]));
    const funds: PnlFundSummary[] = fundRows.filter((fund) => fund.active || periodRows.some((row) => row.fundId === fund.id)).map((fund) => {
      const period = periodRows.find((row) => row.fundId === fund.id);
      const basis = this.fundBasis(ctx, periodKey, fund);
      const live = period ? splitFund(num(period.amount), basis) : [];
      const confirmedRows = period ? allocationRows.filter((row) => row.fundPeriodId === period.id) : [];
      const confirmed = period?.status === "allocated";
      const stale = confirmed && !lock && (confirmedRows.length !== live.length || live.some((row) => confirmedRows.find((item) => item.projectId === row.projectId)?.minutes !== row.minutes));
      const totalMinutes = sum((confirmed ? confirmedRows : live).map((row: any) => row.minutes));
      const rows = confirmed
        ? confirmedRows.map((row, index) => ({ projectId: row.projectId, projectName: ctx.projects.get(row.projectId)?.name ?? row.projectId, includedMinutes: row.minutes, sharePercent: percentOf(row.minutes, totalMinutes) ?? 0, amount: num(row.amount), takesRemainder: index === confirmedRows.length - 1 }))
        : live.map((row) => ({ projectId: row.projectId, projectName: ctx.projects.get(row.projectId)?.name ?? row.projectId, includedMinutes: row.minutes, sharePercent: row.sharePercent, amount: row.amount, takesRemainder: row.takesRemainder }));
      const blockedReason = !period ? "Chưa nhập số tiền quỹ của tháng" : lock ? "Kỳ đã khóa, không chia lại" : !live.length ? "Chưa có giờ tính P&L của dự án nhận chia trong tháng" : null;
      const allocatedAmount = sum(confirmedRows.map((row) => num(row.amount)));
      return {
        fundId: fund.id, code: fund.code, name: fund.name, targetItemCode: fund.targetItemCode, targetItemName: itemName.get(fund.targetItemCode) ?? fund.targetItemCode,
        criterion: "pnl_hours", criterionLabel: "giờ tính P&L của tháng",
        eligibility: fund.eligibility, eligibilityLabel: fund.eligibility === "selected_projects" ? "các dự án được chọn có giờ trong tháng · luôn loại dự án thử nghiệm" : "dự án tính phí có giờ trong tháng · luôn loại dự án thử nghiệm",
        eligibleProjectIds: fund.eligibleProjectIds ?? [], active: Boolean(fund.active),
        period: period ? {
          periodKey, amount: num(period.amount), sourceCurrency: period.sourceCurrency, sourceAmount: num(period.sourceAmount), exchangeRate: period.exchangeRate === null || period.exchangeRate === undefined ? null : num(period.exchangeRate),
          amountText: period.sourceCurrency === "USD" ? `${num(period.sourceAmount).toLocaleString("vi-VN")} USD × ${vnd(num(period.exchangeRate))} = ${vnd(num(period.amount))}, theo hóa đơn tháng` : `${vnd(num(period.amount))}, theo hóa đơn tháng`,
          invoiceRef: period.invoiceRef ?? null, status: confirmed ? "allocated" : "unallocated", statusLabel: confirmed ? "Đã chia đủ" : "Chưa chia",
          confirmedAt: period.confirmedAt ? new Date(period.confirmedAt).toISOString() : null, confirmedByName: period.confirmedByName ?? null,
          allocatedAmount, stale, locked: Boolean(lock)
        } : null,
        preview: { rows, totalMinutes, totalAmount: period ? sum(rows.map((row) => row.amount)) : null, confirmed, canConfirm: Boolean(period) && !lock && live.length > 0 && meta.canApprove, blockedReason }
      } as PnlFundSummary;
    });
    // Khối 4: hours still pending are not in the split yet, so their projects get less than their due.
    const testIds = new Set([...ctx.projects.values()].filter((project) => project.isTest).map((project) => project.id));
    const pendingRows = ctx.entries.filter((entry) => entry.periodKey === periodKey && entry.status === "pending" && !(entry.projectId && testIds.has(entry.projectId)));
    const reasonText: Record<PendingGroup, string> = { cost_rate: "thiếu cost rate", classification: "thiếu phân loại", layer2_mismatch: "Lớp 2 không khớp", locked_period: "ghi bù vào tháng đã khóa" };
    const warnings = (Object.keys(reasonText) as PendingGroup[]).map((kind) => ({ kind, minutes: sum(pendingRows.filter((entry) => pendingGroupOf(entry.reasons) === kind).map((entry) => entry.minutes)) })).filter((row) => row.minutes > 0)
      .map((row) => ({ ...row, label: `${hoursText(row.minutes)} giờ của tháng đang Chờ xử lý (${reasonText[row.kind]}), chưa vào phép chia`, target: row.kind === "cost_rate" ? "staff_costs" as const : "pending_hours" as const }));
    return respond({
      periodKey, periodState: periodStateOf(periodKey, ctx.currentPeriodKey, Boolean(lock)), funds, warnings,
      periodOptions: monthKeysBetween(shiftMonth(ctx.currentPeriodKey, -11), ctx.currentPeriodKey).reverse(),
      targetItemOptions: ctx.tree.filter((row) => row.method === "FUND").map((row) => ({ code: row.code, name: row.name }))
    }, meta);
  }

  private parseFund(input: PnlFundInput, tree: readonly CostItemDef[]) {
    const name = text(input?.name);
    if (!name || name.length > 120) throw new BadRequestException("Tên quỹ là bắt buộc (tối đa 120 ký tự).");
    const target = tree.find((row) => row.code === input.targetItemCode);
    if (!target || target.method !== "FUND") throw new BadRequestException("Khoản mục đích phải là khoản mục có cách lấy số Phân bổ quỹ.");
    const eligibility = input.eligibility ?? "billable_with_hours";
    if (!["billable_with_hours", "selected_projects"].includes(eligibility)) throw new BadRequestException("Phạm vi dự án nhận chia không hợp lệ.");
    const eligibleProjectIds = Array.isArray(input.eligibleProjectIds) ? input.eligibleProjectIds.filter((id) => typeof id === "string") : [];
    if (eligibility === "selected_projects" && !eligibleProjectIds.length) throw new BadRequestException("Chọn ít nhất một dự án nhận chia.");
    return { name, targetItemCode: target.code, eligibility, eligibleProjectIds, active: input.active !== false };
  }

  async createFund(input: PnlFundInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const ctx = await this.context(principal.workspaceId, { projectIds: [] });
    const data = this.parseFund(input, ctx.tree);
    const code = (text(input.code) ?? `QUY-${String((await this.prisma.pnlFund.count({ where: { workspaceId: principal.workspaceId } })) + 1).padStart(2, "0")}`).toUpperCase();
    if (await this.prisma.pnlFund.findFirst({ where: { workspaceId: principal.workspaceId, code } })) throw new ConflictException(`Mã quỹ ${code} đã tồn tại.`);
    const row = await this.prisma.pnlFund.create({ data: { workspaceId: principal.workspaceId, code, ...data, createdByUserId: principal.subjectId } });
    await this.audit(principal, "pnl.fund_declared", "pnl_fund", row.id, undefined, { code, ...data });
    return { data: row };
  }

  async updateFund(fundId: string, input: PnlFundInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const fund = await this.prisma.pnlFund.findFirst({ where: { id: fundId, workspaceId: principal.workspaceId } });
    if (!fund) throw new NotFoundException("Không tìm thấy quỹ.");
    const ctx = await this.context(principal.workspaceId, { projectIds: [] });
    const data = this.parseFund({ ...fund, ...input } as PnlFundInput, ctx.tree);
    const row = await this.prisma.pnlFund.update({ where: { id: fund.id }, data });
    await this.audit(principal, "pnl.fund_declared", "pnl_fund", fund.id, { name: fund.name, targetItemCode: fund.targetItemCode, eligibility: fund.eligibility, active: fund.active }, data);
    return { data: row };
  }

  private async openFund(fundId: string, periodKey: string, principal: PrincipalContext) {
    const fund = await this.prisma.pnlFund.findFirst({ where: { id: fundId, workspaceId: principal.workspaceId } });
    if (!fund) throw new NotFoundException("Không tìm thấy quỹ.");
    const ctx = await this.context(principal.workspaceId, { periodKeys: [periodKey] });
    // PL-17: "khóa rồi thì không chia lại".
    if (ctx.lockedKeys.has(periodKey)) throw new ConflictException(`Kỳ ${monthLabel(periodKey)} đã khóa; mở lại kỳ trước khi đổi quỹ.`);
    const period = await this.prisma.pnlFundPeriod.findFirst({ where: { fundId, periodKey } });
    return { fund, ctx, period };
  }

  /** Layer 1 input: the fund's amount of the month, by invoice. A USD amount is converted with the month's rate (PL-03). */
  async setFundAmount(fundId: string, periodRef: string, input: PnlFundAmountInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const periodKey = requirePeriodKey(periodRef);
    const { fund, ctx, period } = await this.openFund(fundId, periodKey, principal);
    const sourceCurrency = input?.sourceCurrency === "USD" ? "USD" : "VND";
    const sourceAmount = Number(input?.sourceAmount);
    if (!Number.isFinite(sourceAmount) || sourceAmount < 0 || sourceAmount > 1e12) throw new BadRequestException("Số tiền quỹ phải là số không âm.");
    const usdRate = sourceCurrency === "USD" ? ctx.params.number("usdRate", null, periodKey) : undefined;
    const amount = toVnd(sourceCurrency, sourceAmount, usdRate);
    if (amount === undefined) throw new BadRequestException(`Chưa có tỷ giá USD có hiệu lực cho tháng ${monthLabel(periodKey)}; thêm ở tab Tham số.`);
    const data = { amount, sourceCurrency, sourceAmount, exchangeRate: usdRate ?? null, invoiceRef: text(input.invoiceRef) ?? null, status: "unallocated", confirmedAt: null, confirmedByUserId: null, confirmedByName: null, updatedByUserId: principal.subjectId };
    const row = await this.prisma.$transaction(async (tx: any) => {
      // A new amount voids the confirmed split: the shares no longer total the fund.
      if (period) await tx.pnlFundAllocation.deleteMany({ where: { fundPeriodId: period.id } });
      const saved = period ? await tx.pnlFundPeriod.update({ where: { id: period.id }, data }) : await tx.pnlFundPeriod.create({ data: { workspaceId: principal.workspaceId, fundId, periodKey, ...data } });
      await this.audit(principal, "pnl.fund_amount_changed", "pnl_fund", fund.id, period ? { periodKey, amount: num(period.amount) } : undefined, { periodKey, amount, sourceCurrency, sourceAmount, exchangeRate: usdRate ?? null }, tx);
      return saved;
    });
    return { data: row };
  }

  /** "Xác nhận phân bổ": only now do the shares enter each project's P&L, in the fund's target item, in that month. */
  async confirmFund(fundId: string, periodRef: string, principal: PrincipalContext) {
    assertCostApprove(principal);
    const periodKey = requirePeriodKey(periodRef);
    const { fund, ctx, period } = await this.openFund(fundId, periodKey, principal);
    if (!period) throw new BadRequestException("Chưa nhập số tiền quỹ của tháng.");
    const shares = splitFund(num(period.amount), this.fundBasis(ctx, periodKey, fund));
    if (!shares.length) throw new ConflictException("Chưa có giờ tính P&L của dự án nhận chia trong tháng, chưa chia được quỹ.");
    await this.prisma.$transaction(async (tx: any) => {
      await tx.pnlFundAllocation.deleteMany({ where: { fundPeriodId: period.id } });
      await tx.pnlFundAllocation.createMany({ data: shares.map((share) => ({ workspaceId: principal.workspaceId, fundPeriodId: period.id, projectId: share.projectId, periodKey, itemCode: fund.targetItemCode, minutes: share.minutes, amount: share.amount })) });
      await tx.pnlFundPeriod.update({ where: { id: period.id }, data: { status: "allocated", confirmedAt: this.now(), confirmedByUserId: principal.subjectId, confirmedByName: principal.displayName } });
      await this.audit(principal, "pnl.fund_confirmed", "pnl_fund", fund.id, undefined, { periodKey, fund: fund.name, amount: num(period.amount), shares: shares.map((share) => ({ projectId: share.projectId, minutes: share.minutes, amount: share.amount })) }, tx);
    });
    return { data: { fundId, periodKey, status: "allocated", shares } };
  }

  /** "Chạy lại" (before the lock): drops the confirmed split so the preview is computed from the hours as they are now. */
  async rerunFund(fundId: string, periodRef: string, principal: PrincipalContext) {
    assertCostApprove(principal);
    const periodKey = requirePeriodKey(periodRef);
    const { fund, ctx, period } = await this.openFund(fundId, periodKey, principal);
    if (!period) throw new BadRequestException("Chưa nhập số tiền quỹ của tháng.");
    await this.prisma.$transaction(async (tx: any) => {
      await tx.pnlFundAllocation.deleteMany({ where: { fundPeriodId: period.id } });
      await tx.pnlFundPeriod.update({ where: { id: period.id }, data: { status: "unallocated", confirmedAt: null, confirmedByUserId: null, confirmedByName: null } });
      if (period.status === "allocated") await this.audit(principal, "pnl.fund_rerun", "pnl_fund", fund.id, { periodKey, status: "allocated" }, { periodKey, status: "unallocated" }, tx);
    });
    return { data: { fundId, periodKey, status: "unallocated", shares: splitFund(num(period.amount), this.fundBasis(ctx, periodKey, fund)) } };
  }

  // -------------------------------------------------------------------------
  // Mục 6.5 — Kỳ và khóa kỳ (layer 3)
  // -------------------------------------------------------------------------

  private async checklist(ctx: PnlContext, periodKey: string): Promise<PnlChecklistItem[]> {
    const [fundRows, periodRows, allocationRows]: any[][] = await Promise.all([
      this.prisma.pnlFund.findMany({ where: { workspaceId: ctx.workspaceId } }),
      this.prisma.pnlFundPeriod.findMany({ where: { workspaceId: ctx.workspaceId, periodKey } }),
      this.prisma.pnlFundAllocation.findMany({ where: { workspaceId: ctx.workspaceId, periodKey } })
    ]);
    const ofMonth = ctx.entries.filter((entry) => entry.periodKey === periodKey);
    const missingParameters: string[] = [];
    if (ctx.params.number("standardDayHours", null, periodKey) === undefined) missingParameters.push("Giờ chuẩn một ngày");
    if (!ctx.params.resolve("pnlCloseGate", null, periodKey)) missingParameters.push("Mốc đóng P&L dự án");
    if (ctx.params.number("commissionPercent", null, periodKey) === undefined) missingParameters.push("Tỷ lệ hoa hồng");
    // PL-02: a trial project is out of every warning and total; its hours do not hold the month open — neither the
    // pending hours nor the "no approved cost" check of someone who only logged on a trial project.
    const counted = ofMonth.filter((entry) => !(entry.projectId && ctx.projects.get(entry.projectId)?.isTest));
    const loggers = [...new Set(counted.map((entry) => entry.userId))];
    return periodChecklist({
      periodKey, missingParameters,
      entries: counted,
      userNames: new Map(loggers.map((userId) => [userId, ctx.userName(userId) as string])),
      usersWithoutApprovedCost: loggers.filter((userId) => ctx.staffCosts.get(rateKey(userId, periodKey))?.status !== "APPROVED"),
      funds: periodRows.map((period) => ({ name: fundRows.find((fund) => fund.id === period.fundId)?.name ?? period.fundId, amount: num(period.amount), allocatedAmount: sum(allocationRows.filter((row) => row.fundPeriodId === period.id).map((row) => num(row.amount))), confirmed: period.status === "allocated" })),
      acceptedProjects: [...ctx.projects.values()].filter((project) => !project.isTest && !project.consumable && project.closePassed && project.acceptedOn?.slice(0, 7) === periodKey).map((project) => ({ name: project.name, acceptedOn: project.acceptanceEstimated ? null : project.acceptedOn ?? null, projectValueAmount: project.projectValueAmount }))
    });
  }

  async periods(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlPeriodsResponse> {
    const meta = pnlMeta(principal, this.now());
    const current = reportMonthKey(this.now());
    const earliest: any = await this.prisma.taskTimeEntry.findFirst({ where: { workspaceId: principal.workspaceId, minutes: { gt: 0 } }, orderBy: { workDate: "asc" }, select: { workDate: true } });
    const firstKey = [earliest ? reportMonthKey(new Date(earliest.workDate)) : current, shiftMonth(current, -3)].sort()[0];
    const from = [firstKey, shiftMonth(current, -11)].sort()[1];
    const periodKeys = monthKeysBetween(from, nextMonthKey(current));
    const selectedKey = text(query.periodKey) ? requirePeriodKey(query.periodKey) : undefined;
    const open = periodKeys.filter((periodKey) => periodKey <= current);
    const ctx = await this.context(principal.workspaceId, { periodKeys: [...new Set([...open, ...(selectedKey && selectedKey <= current ? [selectedKey] : [])])] });
    const cards: PnlPeriodCard[] = [];
    const checklists = new Map<string, PnlChecklistItem[]>();
    for (const periodKey of periodKeys) {
      const lock = ctx.locked.get(periodKey);
      const state = periodStateOf(periodKey, current, Boolean(lock));
      const checklist = state === "awaiting_lock" || state === "open" ? await this.checklist(ctx, periodKey) : [];
      checklists.set(periodKey, checklist);
      const missingCount = checklist.filter((row) => !row.ok).length;
      const day = (date: Date) => `${dayKeyOf(date).slice(8)}/${dayKeyOf(date).slice(5, 7)}`;
      cards.push({
        periodKey, state, stateLabel: PERIOD_STATE_LABELS[state], missingCount,
        statusText: state === "locked" ? ["Đã khóa", day(lock!.lockedAt), lock!.lockedByName].filter(Boolean).join(" · ") : state === "awaiting_lock" ? `Chờ khóa · ${missingCount ? `còn ${missingCount} việc` : "sẵn sàng"}` : state === "open" ? "Đang mở · hiện tại" : "Chưa mở",
        lockedAt: lock ? lock.lockedAt.toISOString() : null, lockedByName: lock?.lockedByName ?? null, reopenedAt: null, reopenReason: null
      });
    }
    const history: any[] = await this.prisma.pnlPeriodSnapshot.findMany({ where: { workspaceId: principal.workspaceId }, orderBy: { lockedAt: "desc" }, select: { periodKey: true, lockedAt: true, lockedByName: true, reopenedAt: true, reopenedByName: true, reopenReason: true, summary: true } });
    for (const card of cards) {
      const last = history.find((row) => row.periodKey === card.periodKey && row.reopenedAt);
      if (last && card.state !== "locked") { card.reopenedAt = new Date(last.reopenedAt).toISOString(); card.reopenReason = last.reopenReason ?? null; }
    }
    const chosen = selectedKey ?? cards.find((card) => card.state === "awaiting_lock")?.periodKey ?? current;
    const card = cards.find((row) => row.periodKey === chosen);
    const checklist = checklists.get(chosen) ?? [];
    const missing = checklist.filter((row) => !row.ok).length;
    const state = card?.state ?? periodStateOf(chosen, current, ctx.lockedKeys.has(chosen));
    const blockedBy = state === "awaiting_lock" ? await this.firstOpenMonthBefore(principal.workspaceId, chosen, ctx.lockedKeys) : undefined;
    return respond({
      periods: cards,
      selected: {
        periodKey: chosen, state, checklist,
        canLock: state === "awaiting_lock" && missing === 0 && !blockedBy && meta.canApprove,
        lockButtonText: state === "locked" ? `Kỳ ${monthLabel(chosen)} đã khóa` : state !== "awaiting_lock" ? `Kỳ ${monthLabel(chosen)} chưa hết tháng` : missing ? `Khóa kỳ ${monthLabel(chosen)} · còn ${missing} việc` : `Khóa kỳ ${monthLabel(chosen)}`,
        lockBlockedByPeriodKey: blockedBy ?? null,
        lockBlockedReason: blockedBy ? lockOrderMessage(chosen, blockedBy) : null,
        reopenPeriodKeys: state === "locked" ? [...ctx.lockedKeys].filter((periodKey) => periodKey >= chosen).sort() : [],
        snapshotNote: "Khóa lưu ảnh chụp tham số, cost rate, số chia quỹ, kết quả cổng lọc",
        reopenNote: "Mở lại kỳ đã khóa: Admin, bắt buộc lý do; các tháng sau mở lại theo · giờ ghi bù vào tháng đã khóa nằm ở Chờ xử lý",
        explanation: "Kỳ chỉ khóa dữ liệu đầu vào của tháng. P&L dự án vẫn cộng trọn vòng đời; dự án có giờ ở tháng chưa khóa thì Tạm tính.",
        history: history.filter((row) => row.periodKey === chosen).map((row) => ({ lockedAt: new Date(row.lockedAt).toISOString(), lockedByName: row.lockedByName ?? null, reopenedAt: row.reopenedAt ? new Date(row.reopenedAt).toISOString() : null, reopenedByName: row.reopenedByName ?? null, reopenReason: row.reopenReason ?? null, summary: row.summary as PnlPeriodSnapshotSummary }))
      }
    }, meta);
  }

  /**
   * Kỳ khóa theo thứ tự: the first month before `periodKey` that has data — hours, monthly staff costs, fund amounts or
   * Nhập tay lines — and is not locked. A later month builds on it (and reopening it reopens the later ones), so it goes first.
   */
  private async firstOpenMonthBefore(workspaceId: string, periodKey: string, lockedKeys: ReadonlySet<string>): Promise<string | undefined> {
    const before = reportMonthStart(periodKey);
    const [hours, costs, funds, lines]: any[][] = await Promise.all([
      this.prisma.taskTimeEntry.findMany({ where: { workspaceId, minutes: { gt: 0 }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES }, workDate: { lt: before } }, select: { workDate: true }, distinct: ["workDate"] }),
      this.prisma.resourceMonthlyCost.findMany({ where: { workspaceId, periodKey: { lt: periodKey } }, select: { periodKey: true }, distinct: ["periodKey"] }),
      this.prisma.pnlFundPeriod.findMany({ where: { workspaceId, periodKey: { lt: periodKey } }, select: { periodKey: true }, distinct: ["periodKey"] }),
      this.prisma.projectCost.findMany({ where: { workspaceId, costType: { not: "LABOR" }, occurredAt: { lt: before } }, select: { occurredAt: true } })
    ]);
    return [...hours.map((row) => reportMonthKey(new Date(row.workDate))), ...costs.map((row) => String(row.periodKey)), ...funds.map((row) => String(row.periodKey)), ...lines.map((row) => reportMonthKey(new Date(row.occurredAt)))]
      .filter((key) => key < periodKey && !lockedKeys.has(key)).sort()[0];
  }

  /**
   * Khóa kỳ (PL-23): allowed for a month that is over ("Chờ khóa") once the five conditions hold and every earlier month with data is locked. The lock stores the
   * snapshot of the month — parameters, cost rates, fund shares, gate results (and the month's manual lines) — and from
   * then on every P&L reads the month from it. Snapshot, status and audit are written in one transaction.
   */
  async lockPeriod(periodRef: string, principal: PrincipalContext) {
    assertCostApprove(principal);
    const periodKey = PERIOD_KEY.test(periodRef) ? periodRef : (await this.prisma.pnlPeriod.findFirst({ where: { id: periodRef, workspaceId: principal.workspaceId, projectId: null } }))?.periodKey;
    if (!periodKey) throw new NotFoundException("Không tìm thấy kỳ.");
    const ctx = await this.context(principal.workspaceId, { periodKeys: [periodKey] });
    if (ctx.lockedKeys.has(periodKey)) throw new ConflictException(`Kỳ ${monthLabel(periodKey)} đã khóa.`);
    if (periodStateOf(periodKey, ctx.currentPeriodKey, false) !== "awaiting_lock") throw new ConflictException(`Kỳ ${monthLabel(periodKey)} chưa hết tháng nên chưa khóa được.`);
    const earlier = await this.firstOpenMonthBefore(principal.workspaceId, periodKey, ctx.lockedKeys);
    if (earlier) throw new ConflictException(lockOrderMessage(periodKey, earlier));
    const checklist = await this.checklist(ctx, periodKey);
    const open = checklist.filter((row) => !row.ok);
    if (open.length) throw new ConflictException(`Chưa khóa được kỳ ${monthLabel(periodKey)}, còn ${open.length} việc: ${open.map((row) => `${row.label}${row.detail ? ` (${row.detail})` : ""}`).join("; ")}.`);

    const [fundRows, periodRows]: any[][] = await Promise.all([
      this.prisma.pnlFund.findMany({ where: { workspaceId: principal.workspaceId } }),
      this.prisma.pnlFundPeriod.findMany({ where: { workspaceId: principal.workspaceId, periodKey } })
    ]);
    const ofMonth = ctx.entries.filter((entry) => entry.periodKey === periodKey);
    const fundOf = new Map(periodRows.map((period) => [period.id, fundRows.find((fund) => fund.id === period.fundId)]));
    const fundShares = ctx.fundShares.filter((share) => share.periodKey === periodKey);
    const manualLines = ctx.manualLines.filter((line) => line.periodKey === periodKey);
    const data: SnapshotData = {
      version: 2, periodKey, workingDays: ctx.workingDays(periodKey), standardDayMinutes: ctx.standardDayMinutes(periodKey), standardMinutes: ctx.standardMinutes(periodKey),
      parameters: { standardDayHours: ctx.params.resolve("standardDayHours", null, periodKey), pnlCloseGate: ctx.params.resolve("pnlCloseGate", null, periodKey), commissionPercent: ctx.params.resolve("commissionPercent", null, periodKey) ?? null, usdRate: ctx.params.resolve("usdRate", null, periodKey) ?? null, values: ctx.params.all().filter((row) => row.effectiveFrom <= periodKey).map((row) => ({ key: row.key, subKey: row.subKey, scopeType: row.scopeType, scopeId: row.scopeId, value: row.value, effectiveFrom: row.effectiveFrom, createdAt: row.createdAt.toISOString() })) },
      // PL-24: the month is read back with the tree and the on/off switches of today, whatever changes later.
      tree: ctx.tree,
      disabledCodes: Object.fromEntries([...new Set([...fundShares, ...manualLines].map((row) => row.projectId))].map((projectId) => [projectId, [...(ctx.projects.get(projectId)?.disabledCodes ?? [])]])),
      staffCosts: [...ctx.staffCosts.values()].filter((cost) => cost.periodKey === periodKey && cost.status === "APPROVED").map((cost) => ({ userId: cost.userId, totalAmount: cost.totalAmount, ...(cost.hourlyCostRate === null ? {} : { hourlyCostRate: cost.hourlyCostRate }) })),
      entries: ofMonth.map((entry) => ({ id: entry.id, p: entry.projectId, u: entry.userId, t: entry.taskId, d: entry.dateKey, m: entry.minutes, l1: entry.layer1, l2: ctx.entryMeta.get(entry.id)?.taskTypeLayer2 ?? null, s2: ctx.entryMeta.get(entry.id)?.selectedTaskTypeLayer2 ?? null, rg: entry.roleGroup, s: entry.status, r: entry.reasons })),
      funds: periodRows.map((period) => ({ fundId: period.fundId, name: fundOf.get(period.id)?.name ?? period.fundId, itemCode: fundOf.get(period.id)?.targetItemCode ?? "", amount: num(period.amount) })),
      fundShares: fundShares.map((share) => ({ fundId: share.fundId, projectId: share.projectId, itemCode: share.itemCode, minutes: share.minutes, amount: share.amount })),
      manualLines: manualLines.map((line) => ({ id: line.id, projectId: line.projectId, itemCode: line.itemCode, amount: line.amount, label: line.label }))
    };
    const company = this.companyMonths(ctx, [periodKey])[0];
    const summary: PnlPeriodSnapshotSummary = {
      entryCount: ofMonth.length, loggedMinutes: sum(ofMonth.map((entry) => entry.minutes)),
      includedMinutes: sum(ofMonth.filter((entry) => entry.status === "included").map((entry) => entry.minutes)), pendingMinutes: sum(ofMonth.filter((entry) => entry.status === "pending").map((entry) => entry.minutes)), excludedMinutes: sum(ofMonth.filter((entry) => entry.status === "excluded").map((entry) => entry.minutes)),
      staffCostAmount: company.staffCostAmount, projectLaborAmount: company.projectLaborAmount, fundAmount: sum(data.funds.map((fund) => fund.amount)), directCostAmount: sum(data.manualLines.map((line) => line.amount)), standardMinutes: data.standardMinutes
    };
    const now = this.now();
    const [year, month] = periodKey.split("-").map(Number);
    return this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.pnlPeriod.findFirst({ where: { workspaceId: principal.workspaceId, projectId: null, periodKey } });
      const lock = { status: "LOCKED", lockedAt: now, lockedByUserId: principal.subjectId, formulaVersion: 3 };
      const row = existing
        ? await tx.pnlPeriod.update({ where: { id: existing.id }, data: lock })
        : await tx.pnlPeriod.create({ data: { workspaceId: principal.workspaceId, periodKey, periodStart: new Date(Date.UTC(year, month - 1, 1)), periodEnd: new Date(Date.UTC(year, month, 0)), currency: "VND", revenueAmount: 0, ...lock } });
      await tx.pnlPeriodSnapshot.create({ data: { workspaceId: principal.workspaceId, periodKey, data, summary, lockedAt: now, lockedByUserId: principal.subjectId, lockedByName: principal.displayName } });
      await this.audit(principal, "pnl.period_locked", "pnl_period", row.id, { status: existing?.status ?? "NOT_CREATED" }, { status: "LOCKED", periodKey, ...summary }, tx);
      return { data: row, meta: { locked: true, immutable: true, ...summary } };
    });
  }

  /**
   * Mở lại kỳ (PL-23): a reason is mandatory, and every later locked month reopens in the same action (their figures
   * build on this month's). Each month gets its own history line with the same reason; `reopenedWithPeriodKey` in the
   * audit event tells which month the action was started on.
   */
  async reopenPeriod(periodRef: string, input: { reason?: string }, principal: PrincipalContext) {
    assertCostApprove(principal);
    if (!isAdminAccount(principal) && !principal.roleCodes.includes("FOUNDER_GM")) throw new ForbiddenException("Chỉ Admin mở lại được kỳ đã khóa.");
    const reason = text(input?.reason);
    if (!reason) throw new BadRequestException("Phải nhập lý do khi mở lại kỳ đã khóa.");
    const period: any = await this.prisma.pnlPeriod.findFirst({ where: PERIOD_KEY.test(periodRef) ? { workspaceId: principal.workspaceId, projectId: null, periodKey: periodRef } : { id: periodRef, workspaceId: principal.workspaceId, projectId: null } });
    if (!period) throw new NotFoundException("Không tìm thấy kỳ.");
    if (period.status !== "LOCKED") throw new ConflictException("Chỉ mở lại được kỳ đã khóa.");
    const later: any[] = await this.prisma.pnlPeriod.findMany({ where: { workspaceId: principal.workspaceId, projectId: null, status: "LOCKED", periodKey: { gt: period.periodKey } }, orderBy: { periodKey: "asc" } });
    const now = this.now();
    const reopened = await this.prisma.$transaction(async (tx: any) => {
      const rows = [];
      for (const row of [period, ...later]) {
        rows.push(await tx.pnlPeriod.update({ where: { id: row.id }, data: { status: "REOPENED", reopenedAt: now, reopenedByUserId: principal.subjectId, reopenReason: reason } }));
        await tx.pnlPeriodSnapshot.updateMany({ where: { workspaceId: principal.workspaceId, periodKey: row.periodKey, reopenedAt: null }, data: { reopenedAt: now, reopenedByUserId: principal.subjectId, reopenedByName: principal.displayName, reopenReason: reason } });
        await this.audit(principal, "pnl.period_reopened", "pnl_period", row.id, { status: "LOCKED" }, { status: "REOPENED", periodKey: row.periodKey, reason, reopenedWithPeriodKey: period.periodKey }, tx);
      }
      return rows;
    });
    return { data: reopened[0], meta: { locked: false, auditReason: reason, reopenedPeriodKeys: reopened.map((row: any) => row.periodKey) } };
  }
}

const lockOrderMessage = (periodKey: string, earlier: string) => `Chưa khóa được kỳ ${monthLabel(periodKey)}: kỳ ${monthLabel(earlier)} có dữ liệu và chưa khóa. Khóa kỳ ${monthLabel(earlier)} trước.`;

export function shiftMonth(periodKey: string, delta: number): string {
  const [year, month] = periodKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
