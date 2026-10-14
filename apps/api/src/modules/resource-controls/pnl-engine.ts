/**
 * "Yêu cầu tab P&L – hệ thống PM" (v2, 13/10/2026), section 2.1 steps 4–12. Pure: values in, figures out.
 * Steps 1–3 (standard hours, cost rate, hour gate) are in pnl-rules.ts, the cost-item tree in pnl-tree.ts.
 *
 * Money is whole đồng. The one place a cost is rounded is `costOfMinutes` on a bucket of one person × one month
 * (× one project); every month, project and company figure is a plain sum of those buckets, so parents always equal
 * the sum of their children (PL-07, step 10) and the five company parts add up to the month's staff cost (PL-12).
 */
import type { PnlReason, PnlMonthMissing, PnlFixTarget } from "@b2b-crm/contracts";
import {
  PENDING_GROUP_LABELS,
  PNL_GATE_REASON_LABELS,
  RESULT_LABELS,
  blocksG7,
  classifyPnlEntry,
  costOfMinutes,
  pendingGroupOf,
  recordStateOf,
  reconcileHours,
  type CostRate,
  type PendingGroup,
  type PnlGateInput,
  type PnlGateReason,
  type PnlGateStatus,
  type RecordState,
  type ResultLabel,
  type RoleGroup
} from "./pnl-rules";
import { SYSTEM_ITEM_CODES, accountingGroupOf, contributionOf, costByGroups, evaluateCostTree, type CostItemDef, type CostItemValue } from "./pnl-tree";

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface RawEntry extends Omit<PnlGateInput, "hasCostRate"> {
  id: string;
  userId: string;
  taskId?: string | null;
  /** YYYY-MM-DD in Vietnam time. */
  dateKey: string;
  minutes: number;
  roleGroup: RoleGroup;
}

export interface EngineEntry {
  id: string;
  projectId: string | null;
  userId: string;
  taskId: string | null;
  dateKey: string;
  periodKey: string;
  minutes: number;
  layer1: string | null;
  roleGroup: RoleGroup;
  status: PnlGateStatus;
  reasons: PnlGateReason[];
  /** Cost rate of the person for the entry's month; undefined without an approved monthly cost. */
  rate?: CostRate;
  /** The figures of this entry come from a lock snapshot. */
  fromSnapshot?: boolean;
}

/** Steps 2 + 3 for one hour: its gate result and the rate it is costed at. */
export function classifyEntry(raw: RawEntry, rate: CostRate | undefined): EngineEntry {
  const gate = classifyPnlEntry({ ...raw, hasCostRate: Boolean(rate) });
  return {
    id: raw.id, projectId: raw.projectId ?? null, userId: raw.userId, taskId: raw.taskId ?? null, dateKey: raw.dateKey, periodKey: raw.dateKey.slice(0, 7),
    minutes: raw.minutes, layer1: raw.taskTypeLayer1 ?? null, roleGroup: raw.roleGroup,
    status: gate.status, reasons: gate.reasons,
    rate
  };
}

/** Hours of one person in one month (of one project), split by gate result. The rounding unit of every cost. */
export interface HourBucket {
  projectId: string | null;
  userId: string;
  periodKey: string;
  roleGroup: RoleGroup;
  rate?: CostRate;
  loggedMinutes: number;
  includedMinutes: number;
  pendingMinutes: number;
  excludedMinutes: number;
  pendingByGroup: Record<PendingGroup, number>;
  /** Pending hours that block G7 (subset of pendingMinutes). */
  blockingMinutes: number;
  byReason: Partial<Record<PnlGateReason, number>>;
  internalMinutes: number;
  afterCloseMinutes: number;
  lostDealMinutes: number;
}

const emptyPending = (): Record<PendingGroup, number> => ({ cost_rate: 0, classification: 0, layer2_mismatch: 0, locked_period: 0 });

export function bucketEntries(entries: readonly EngineEntry[]): HourBucket[] {
  const buckets = new Map<string, HourBucket>();
  for (const entry of entries) {
    const key = `${entry.projectId ?? ""}|${entry.userId}|${entry.periodKey}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { projectId: entry.projectId, userId: entry.userId, periodKey: entry.periodKey, roleGroup: entry.roleGroup, rate: entry.rate, loggedMinutes: 0, includedMinutes: 0, pendingMinutes: 0, excludedMinutes: 0, pendingByGroup: emptyPending(), blockingMinutes: 0, byReason: {}, internalMinutes: 0, afterCloseMinutes: 0, lostDealMinutes: 0 };
      buckets.set(key, bucket);
    }
    bucket.rate = bucket.rate ?? entry.rate;
    bucket.loggedMinutes += entry.minutes;
    const primary = entry.reasons[0];
    if (primary) bucket.byReason[primary] = (bucket.byReason[primary] ?? 0) + entry.minutes;
    if (entry.status === "included") bucket.includedMinutes += entry.minutes;
    else if (entry.status === "pending") {
      bucket.pendingMinutes += entry.minutes;
      bucket.pendingByGroup[pendingGroupOf(entry.reasons)] += entry.minutes;
      if (blocksG7(entry)) bucket.blockingMinutes += entry.minutes;
    } else {
      bucket.excludedMinutes += entry.minutes;
      if (primary === "internal") bucket.internalMinutes += entry.minutes;
      else if (primary === "after_close") bucket.afterCloseMinutes += entry.minutes;
      else if (primary === "lost_deal_pre_sale") bucket.lostDealMinutes += entry.minutes;
    }
  }
  return [...buckets.values()];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Cost of each costed hour block, derived from its bucket (one person × one month × one project × one gate result) so a
 * list of entries, or a task, always adds up to the figure it is opened from: the bucket's cost is split by minutes and
 * the last block (by date) takes what rounding left over. Pending hours and hours without a cost rate have no cost.
 */
export function entryCosts(entries: readonly EngineEntry[]): Map<string, number> {
  const groups = new Map<string, EngineEntry[]>();
  for (const entry of entries) {
    if (entry.status === "pending" || !entry.rate) continue;
    const key = `${entry.projectId ?? ""}|${entry.userId}|${entry.periodKey}|${entry.status === "included" ? "included" : entry.reasons[0]}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const costs = new Map<string, number>();
  for (const rows of groups.values()) {
    const ordered = [...rows].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.id.localeCompare(right.id));
    let left = costOfMinutes(sum(ordered.map((entry) => entry.minutes)), ordered[0].rate) as number;
    ordered.forEach((entry, index) => {
      const cost = index === ordered.length - 1 ? left : Math.min(left, costOfMinutes(entry.minutes, entry.rate) as number);
      left -= cost;
      costs.set(entry.id, cost);
    });
  }
  return costs;
}

const hoursText = (minutes: number) => (Math.round((minutes / 60) * 100) / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const monthText = (periodKey: string) => periodKey.slice(5);
/** Margin and share percentages, four decimals — the screen rounds once, from this (49,4494 → 49,4%, never 49,45 → 49,5%). */
export const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1e6) / 1e4 : undefined);

// ---------------------------------------------------------------------------
// Step 6 — shared fund split (PL-17)
// ---------------------------------------------------------------------------

export interface FundShare { projectId: string; minutes: number; sharePercent: number; amount: number; takesRemainder: boolean }

/**
 * Phần của dự án = số tiền quỹ × giờ tính P&L của dự án trong tháng ÷ tổng giờ tính P&L của các dự án nhận chia.
 * Each share is rounded to the đồng; the last row takes whatever rounding left over so the rows total the fund exactly.
 * No eligible hours → nothing to split (an empty list): the fund stays "Chưa chia".
 */
export function splitFund(amount: number, projects: ReadonlyArray<{ projectId: string; minutes: number }>): FundShare[] {
  const rows = projects.filter((row) => row.minutes > 0);
  const totalMinutes = sum(rows.map((row) => row.minutes));
  if (!totalMinutes) return [];
  let allocated = 0;
  return rows.map((row, index) => {
    const last = index === rows.length - 1;
    const share = last ? amount - allocated : Math.round((amount * row.minutes) / totalMinutes);
    allocated += share;
    return { projectId: row.projectId, minutes: row.minutes, sharePercent: Math.round((row.minutes / totalMinutes) * 10000) / 100, amount: share, takesRemainder: last };
  });
}

/** PL-03: a USD amount is converted with the rate in force for the month it occurred in. No rate → no VND amount. */
export function toVnd(sourceCurrency: string, sourceAmount: number, usdRate: number | undefined): number | undefined {
  if (sourceCurrency === "VND") return Math.round(sourceAmount);
  return usdRate === undefined ? undefined : Math.round(sourceAmount * usdRate);
}

// ---------------------------------------------------------------------------
// Step 7 — revenue (PL-13, PL-14): one manually entered revenue amount per project, see computeProjectPnl
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Steps 4–11 — one project over its lifecycle
// ---------------------------------------------------------------------------

export interface ProjectPnlInput {
  /** Every hour of the project, classified. Locked months come from their snapshot (plus hours logged after the lock). */
  entries: readonly EngineEntry[];
  /** PL-13 project revenue (VND) as the PM entered it; undefined = chưa nhập. Applies to every project type. */
  projectValueAmount?: number;
  /** The P&L closing gate (G7) is approved. */
  closePassed: boolean;
  /** Accepted by its status only (no gate row, no status history): there is no real G7 date, so never "Chính thức". */
  acceptanceDateMissing?: boolean;
  g1Passed: boolean;
  lostDeal: boolean;
  /** The project's template is read as "chi phí tiêu hao" for internal hours. */
  consumable: boolean;
  lockedPeriods: ReadonlySet<string>;
  /**
   * Confirmed fund shares of the project. `counted` is set for a locked month: whether the share's item was switched on
   * for the project when the month was locked (PL-24) — it then no longer follows `disabledCodes`.
   */
  fundShares: ReadonlyArray<{ periodKey: string; itemCode: string; amount: number; counted?: boolean }>;
  /** Months in which a fund has an amount that is not allocated and confirmed yet. */
  unallocatedFundPeriods: ReadonlySet<string>;
  /** "Nhập tay" lines of the project. */
  manualLines: ReadonlyArray<{ periodKey: string; itemCode: string | null; amount: number; counted?: boolean }>;
  tree: readonly CostItemDef[];
  /** Codes switched off for this project (template + override), ancestors already expanded. */
  disabledCodes: ReadonlySet<string>;
  /** Tỷ lệ hoa hồng in force for the project, percent (5 = 5%). Undefined = chưa nhập. */
  commissionPercent?: number;
  /** "Từ tháng – Đến tháng": totals and month rows only add the selected months; revenue and EBIT are whole-project only. */
  range?: { from: string; to: string };
}

export interface MonthFigures {
  periodKey: string;
  locked: boolean;
  loggedMinutes: number;
  includedMinutes: number;
  pendingMinutes: number;
  excludedMinutes: number;
  byReason: Partial<Record<PnlGateReason, number>>;
  pendingByGroup: Record<PendingGroup, number>;
  laborCostAmount: number;
  fundCostAmount: number;
  directCostAmount: number;
  otherCostAmount: number;
  totalCostAmount: number;
  missing: PnlMonthMissing[];
}

export interface PersonFigures {
  userId: string;
  roleGroup: RoleGroup;
  loggedMinutes: number;
  includedMinutes: number;
  pendingMinutes: number;
  /** Undefined while none of the person's counted hours has a cost. */
  laborCostAmount?: number;
  missing: PnlMonthMissing[];
}

export interface ProjectPnl {
  months: MonthFigures[];
  whole: Omit<MonthFigures, "periodKey" | "locked">;
  people: PersonFigures[];
  revenue: { amount?: number; basis: "project_value" | "recognized" | "none"; projectValueAmount?: number; recognizedAmount?: number; rebateAmount: number; missingReason?: string };
  commission: { amount?: number; expected: boolean; enabled: boolean };
  /**
   * "Khoản tính cho cả dự án": the cost lines computed once for the lifecycle (Công thức — the commission), as they enter
   * Tổng chi phí (signed). Tổng chi phí = Σ the months' total cost + Σ these amounts.
   */
  wholeProjectCosts: Array<{ code: string; name: string; amount?: number }>;
  laborCostAmount: number;
  otherCostAmount: number;
  totalCostAmount: number;
  ebit: { amount?: number; marginPercent?: number; expected: boolean };
  /** Lifecycle value of every enabled item of the tree. */
  itemValues: Map<string, CostItemValue>;
  costGroups: ReturnType<typeof costByGroups>;
  afterClose: { minutes: number; amount: number; uncostedMinutes: number; rows: Array<{ periodKey: string; minutes: number; amount?: number }> };
  /** Internal projects: hours are "Bị loại – Nội bộ" for a chargeable P&L but are still costed (dòng Chi phí nội bộ). */
  internalCost: { minutes: number; amount: number; uncostedMinutes: number };
  reconciliation: ReturnType<typeof reconcileHours>;
  blockingMinutes: number;
  result: { label: ResultLabel; labelText: string; reasons: PnlReason[] };
  recordState: RecordState;
  scoped: boolean;
}

const MISSING_LABELS: Record<PnlMonthMissing["kind"], string> = {
  cost_rate: "Thiếu cost rate",
  classification: "Thiếu phân loại",
  layer2_mismatch: "Lớp 2 không khớp",
  locked_period: "Giờ ghi bù vào tháng đã khóa",
  fund_unallocated: "Quỹ chưa chia"
};
const MISSING_TARGETS: Record<PnlMonthMissing["kind"], PnlFixTarget> = { cost_rate: "staff_costs", classification: "pending_hours", layer2_mismatch: "pending_hours", locked_period: "periods", fund_unallocated: "funds" };

function monthMissing(periodKey: string, buckets: readonly HourBucket[], fundUnallocated: boolean): PnlMonthMissing[] {
  const missing: PnlMonthMissing[] = [];
  for (const kind of ["cost_rate", "classification", "layer2_mismatch", "locked_period"] as PendingGroup[]) {
    const rows = buckets.filter((bucket) => bucket.pendingByGroup[kind] > 0);
    if (rows.length) missing.push({ kind, label: MISSING_LABELS[kind], minutes: sum(rows.map((bucket) => bucket.pendingByGroup[kind])), periodKey, userIds: [...new Set(rows.map((bucket) => bucket.userId))], target: MISSING_TARGETS[kind] });
  }
  if (fundUnallocated) missing.push({ kind: "fund_unallocated", label: MISSING_LABELS.fund_unallocated, periodKey, target: "funds" });
  return missing;
}

function addReasons(target: Partial<Record<PnlGateReason, number>>, source: Partial<Record<PnlGateReason, number>>) {
  for (const [reason, minutes] of Object.entries(source) as Array<[PnlGateReason, number]>) target[reason] = (target[reason] ?? 0) + minutes;
}

/**
 * Steps 4–11. Labor = Σ over months of (a person's counted hours of the month × that person's rate of that month);
 * fund shares and manual lines land in their month; revenue and commission are computed once for the project;
 * everything stops at the closing point because hours after it never pass the gate.
 */
export function computeProjectPnl(input: ProjectPnlInput): ProjectPnl {
  const buckets = bucketEntries(input.entries);
  const inRange = (periodKey: string) => !input.range || (periodKey >= input.range.from && periodKey <= input.range.to);
  // A line entered before the tree existed has no item: it stays a project-specific cost under the first Nhập tay cost item.
  const fallbackManualCode = input.tree.find((row) => row.method === "MANUAL" && !input.disabledCodes.has(row.code) && accountingGroupOf(input.tree, row.code) && row.code === "CP.FUNCOP.RIENG")?.code
    ?? input.tree.find((row) => row.method === "MANUAL" && !input.disabledCodes.has(row.code) && accountingGroupOf(input.tree, row.code))?.code;
  // What an amount of an item adds to Tổng chi phí: the tree's own rule (sign, switched off, method), so a month row and
  // "Toàn dự án" can never disagree. An item the tree does not read with that method adds nothing in either.
  const treeByCode = new Map(input.tree.map((row) => [row.code, row]));
  const inCost = (method: CostItemDef["method"], code: string | null | undefined, amount: number) =>
    (code && treeByCode.get(code)?.method === method ? contributionOf(treeByCode, input.disabledCodes, code, SYSTEM_ITEM_CODES.costGroup, amount) : 0);
  const laborCode = (roleGroup: RoleGroup) => input.tree.find((row) => row.method === "SYSTEM" && row.systemSource === "labor" && row.roleGroup === roleGroup)?.code;
  const manual = input.manualLines.filter((line) => line.counted ?? (!line.itemCode || !input.disabledCodes.has(line.itemCode))).map((line) => {
    const code = line.itemCode ?? fallbackManualCode ?? null;
    return { ...line, costSide: Boolean(code && accountingGroupOf(input.tree, code)), costAmount: inCost("MANUAL", code, line.amount) };
  });
  const funds = input.fundShares.filter((share) => share.counted ?? !input.disabledCodes.has(share.itemCode)).map((share) => ({ ...share, costAmount: inCost("FUND", share.itemCode, share.amount) }));

  // A consumable (internal) project has no "Được tính" hour by definition; what it consumes is the cost of its Nội bộ hours.
  const rawLaborOf = (bucket: HourBucket) => (input.consumable ? costOfMinutes(bucket.internalMinutes, bucket.rate) ?? 0 : costOfMinutes(bucket.includedMinutes, bucket.rate) ?? 0);
  /** Labor as it enters Tổng chi phí, through the labor item of the logger's role group. */
  const laborOf = (bucket: HourBucket) => inCost("SYSTEM", laborCode(bucket.roleGroup), rawLaborOf(bucket));

  const periodKeys = [...new Set([...buckets.map((bucket) => bucket.periodKey), ...funds.map((share) => share.periodKey), ...manual.filter((line) => line.costSide).map((line) => line.periodKey)])].sort();
  const months: MonthFigures[] = periodKeys.filter(inRange).map((periodKey) => {
    const rows = buckets.filter((bucket) => bucket.periodKey === periodKey);
    const byReason: Partial<Record<PnlGateReason, number>> = {};
    const pendingByGroup = emptyPending();
    for (const bucket of rows) {
      addReasons(byReason, bucket.byReason);
      for (const group of Object.keys(pendingByGroup) as PendingGroup[]) pendingByGroup[group] += bucket.pendingByGroup[group];
    }
    const laborCostAmount = sum(rows.map(laborOf));
    const fundCostAmount = sum(funds.filter((share) => share.periodKey === periodKey).map((share) => share.costAmount));
    const directCostAmount = sum(manual.filter((line) => line.periodKey === periodKey && line.costSide).map((line) => line.costAmount));
    const hasHours = rows.some((bucket) => bucket.loggedMinutes > 0);
    return {
      periodKey, locked: input.lockedPeriods.has(periodKey),
      loggedMinutes: sum(rows.map((bucket) => bucket.loggedMinutes)), includedMinutes: sum(rows.map((bucket) => bucket.includedMinutes)),
      pendingMinutes: sum(rows.map((bucket) => bucket.pendingMinutes)), excludedMinutes: sum(rows.map((bucket) => bucket.excludedMinutes)),
      byReason, pendingByGroup, laborCostAmount, fundCostAmount, directCostAmount,
      otherCostAmount: fundCostAmount + directCostAmount, totalCostAmount: laborCostAmount + fundCostAmount + directCostAmount,
      missing: monthMissing(periodKey, rows, hasHours && input.unallocatedFundPeriods.has(periodKey) && !input.lockedPeriods.has(periodKey))
    };
  });

  // Revenue is a project-level manual input. G7 still changes the reporting label
  // from expected to final, but it no longer changes the source or locks the input.
  const revenueEnabled = !input.disabledCodes.has(SYSTEM_ITEM_CODES.revenue);
  const baseRevenue = revenueEnabled ? input.projectValueAmount : undefined;

  // Step 10: the tree adds everything up over the lifecycle (never narrowed: revenue, commission and EBIT are whole-project figures).
  const laborByRole: Partial<Record<RoleGroup, number>> = {};
  for (const bucket of buckets) laborByRole[bucket.roleGroup] = (laborByRole[bucket.roleGroup] ?? 0) + rawLaborOf(bucket);
  const byCode = (rows: ReadonlyArray<{ itemCode: string | null; amount: number }>, fallback?: string) => {
    const map = new Map<string, number>();
    for (const row of rows) { const code = row.itemCode ?? fallback; if (code) map.set(code, (map.get(code) ?? 0) + row.amount); }
    return map;
  };
  const manualByCode = byCode(manual, fallbackManualCode);
  if (baseRevenue !== undefined) manualByCode.set(SYSTEM_ITEM_CODES.revenue, baseRevenue);
  const itemValues = evaluateCostTree(input.tree, input.disabledCodes, {
    revenueAmount: baseRevenue,
    laborByRole,
    manualByCode,
    fundByCode: byCode(funds),
    params: { commissionPercent: input.commissionPercent === undefined ? undefined : input.commissionPercent / 100 }
  });
  const valueOf = (code: string) => itemValues.get(code)?.amount;
  const commissionEnabled = revenueEnabled && !input.disabledCodes.has(SYSTEM_ITEM_CODES.commission);
  const commissionAmount = commissionEnabled ? valueOf(SYSTEM_ITEM_CODES.commission) : undefined;
  const rebateAmount = valueOf(SYSTEM_ITEM_CODES.rebate) ?? 0;
  const hasChildren = new Set(input.tree.map((row) => row.parentCode));
  const wholeProjectCosts = input.tree
    .filter((row) => row.method === "FORMULA" && !hasChildren.has(row.code) && !input.disabledCodes.has(row.code) && accountingGroupOf(input.tree, row.code))
    .map((row) => ({ code: row.code, name: row.name, amount: valueOf(row.code) === undefined ? undefined : inCost("FORMULA", row.code, valueOf(row.code) as number) }));

  const laborCostAmount = sum(buckets.map(laborOf));
  const totalCostAmount = valueOf(SYSTEM_ITEM_CODES.costGroup) ?? laborCostAmount;
  const revenueAmount = revenueEnabled ? valueOf(SYSTEM_ITEM_CODES.revenueGroup) : undefined;
  const ebitAmount = revenueAmount === undefined || input.disabledCodes.has(SYSTEM_ITEM_CODES.ebit) ? undefined : revenueAmount - totalCostAmount;

  const whole: ProjectPnl["whole"] = {
    loggedMinutes: sum(months.map((row) => row.loggedMinutes)), includedMinutes: sum(months.map((row) => row.includedMinutes)),
    pendingMinutes: sum(months.map((row) => row.pendingMinutes)), excludedMinutes: sum(months.map((row) => row.excludedMinutes)),
    byReason: {}, pendingByGroup: emptyPending(),
    laborCostAmount: sum(months.map((row) => row.laborCostAmount)), fundCostAmount: sum(months.map((row) => row.fundCostAmount)), directCostAmount: sum(months.map((row) => row.directCostAmount)),
    otherCostAmount: 0, totalCostAmount: 0, missing: months.flatMap((row) => row.missing)
  };
  for (const row of months) {
    addReasons(whole.byReason, row.byReason);
    for (const group of Object.keys(whole.pendingByGroup) as PendingGroup[]) whole.pendingByGroup[group] += row.pendingByGroup[group];
  }
  // "Toàn dự án" = the months + "Khoản tính cho cả dự án" (commission). Narrowed: the selected months only.
  whole.otherCostAmount = input.range ? whole.fundCostAmount + whole.directCostAmount : totalCostAmount - laborCostAmount;
  whole.totalCostAmount = whole.laborCostAmount + whole.otherCostAmount;

  const people: PersonFigures[] = [...new Set(buckets.map((bucket) => bucket.userId))].map((userId) => {
    const rows = buckets.filter((bucket) => bucket.userId === userId && inRange(bucket.periodKey));
    const costed = rows.filter((bucket) => (input.consumable ? bucket.internalMinutes : bucket.includedMinutes) > 0 && bucket.rate);
    return {
      userId, roleGroup: rows[0]?.roleGroup ?? buckets.find((bucket) => bucket.userId === userId)!.roleGroup,
      loggedMinutes: sum(rows.map((bucket) => bucket.loggedMinutes)), includedMinutes: sum(rows.map((bucket) => bucket.includedMinutes)), pendingMinutes: sum(rows.map((bucket) => bucket.pendingMinutes)),
      laborCostAmount: costed.length ? sum(costed.map(laborOf)) : undefined,
      missing: [...new Set(rows.map((bucket) => bucket.periodKey))].sort().flatMap((periodKey) => monthMissing(periodKey, rows.filter((bucket) => bucket.periodKey === periodKey), false))
    };
  }).filter((person) => person.loggedMinutes > 0);

  const costedRows = (minutesOf: (bucket: HourBucket) => number) => {
    const rows = buckets.filter((bucket) => minutesOf(bucket) > 0);
    return {
      minutes: sum(rows.map(minutesOf)),
      amount: sum(rows.map((bucket) => costOfMinutes(minutesOf(bucket), bucket.rate) ?? 0)),
      uncostedMinutes: sum(rows.filter((bucket) => !bucket.rate).map(minutesOf)),
      rows: [...new Set(rows.map((bucket) => bucket.periodKey))].sort().map((periodKey) => {
        const ofMonth = rows.filter((bucket) => bucket.periodKey === periodKey);
        return { periodKey, minutes: sum(ofMonth.map(minutesOf)), amount: ofMonth.some((bucket) => bucket.rate) ? sum(ofMonth.map((bucket) => costOfMinutes(minutesOf(bucket), bucket.rate) ?? 0)) : undefined };
      })
    };
  };
  const afterClose = costedRows((bucket) => bucket.afterCloseMinutes);
  const internalCost = costedRows((bucket) => bucket.internalMinutes);

  // Step 11 — the label (PL-25). Always on the whole lifecycle, whatever the range.
  const allMonths = periodKeys.map((periodKey) => ({ periodKey, hasHours: buckets.some((bucket) => bucket.periodKey === periodKey && bucket.loggedMinutes > 0) }));
  const hourMonths = allMonths.filter((row) => row.hasHours).map((row) => row.periodKey);
  const unlockedMonths = hourMonths.filter((periodKey) => !input.lockedPeriods.has(periodKey));
  const pendingTotal = sum(buckets.map((bucket) => bucket.pendingMinutes));
  const pendingOf = (group: PendingGroup) => buckets.filter((bucket) => bucket.pendingByGroup[group] > 0);
  const reasons: PnlReason[] = [];
  const notComputable: PnlReason[] = [];
  const anyRate = buckets.some((bucket) => bucket.rate);
  // PL-25 "chưa có doanh thu dự án".
  if (revenueEnabled && baseRevenue === undefined) notComputable.push({ code: "no_project_value", label: "chưa nhập doanh thu dự án", target: "project_value" });
  if (buckets.length && !anyRate) notComputable.push({ code: "no_cost_rate", label: "chưa có cost rate nào", target: "staff_costs" });
  if (!input.closePassed && !input.consumable) reasons.push({ code: "not_closed", label: "chưa qua G7", target: "approval" });
  if (input.closePassed && input.acceptanceDateMissing) reasons.push({ code: "missing_acceptance_date", label: "Thiếu ngày nghiệm thu (G7)", target: "project_setup" });
  const pendingReason = (group: PendingGroup, code: PnlReason["code"], target: PnlFixTarget) => {
    const rows = pendingOf(group);
    if (!rows.length) return;
    const minutes = sum(rows.map((bucket) => bucket.pendingByGroup[group]));
    reasons.push({ code, label: `${hoursText(minutes)} ${PENDING_GROUP_LABELS[group]}`, minutes, userCount: new Set(rows.map((bucket) => bucket.userId)).size, periodKeys: [...new Set(rows.map((bucket) => bucket.periodKey))].sort(), target });
  };
  pendingReason("cost_rate", "pending_cost_rate", "staff_costs");
  pendingReason("classification", "pending_classification", "pending_hours");
  pendingReason("layer2_mismatch", "pending_layer2_mismatch", "pending_hours");
  pendingReason("locked_period", "pending_locked_period", "periods");
  if (unlockedMonths.length) reasons.push({ code: "months_unlocked", label: `tháng ${unlockedMonths.map(monthText).join(", ")} chưa khóa`, periodKeys: unlockedMonths, target: "periods" });
  const fundMonths = hourMonths.filter((periodKey) => input.unallocatedFundPeriods.has(periodKey) && !input.lockedPeriods.has(periodKey));
  if (fundMonths.length) reasons.push({ code: "fund_unallocated", label: `quỹ tháng ${fundMonths.map(monthText).join(", ")} chưa chia`, periodKeys: fundMonths, target: "funds" });
  if (commissionEnabled && baseRevenue !== undefined && input.commissionPercent === undefined) reasons.push({ code: "missing_commission_rate", label: "chưa nhập tỷ lệ hoa hồng", target: "parameters" });
  const uncosted = afterClose.uncostedMinutes + internalCost.uncostedMinutes;
  if (uncosted) reasons.push({ code: "uncosted_hours", label: `${hoursText(uncosted)} giờ ngoài P&L dự án chưa có cost rate`, minutes: uncosted, target: "staff_costs" });

  const official = (input.closePassed || input.consumable) && !unlockedMonths.length && pendingTotal === 0 && !reasons.length && !notComputable.length;
  const label: ResultLabel = notComputable.length ? "not_computable" : official ? "official" : "provisional";

  return {
    months, whole, people,
    revenue: {
      amount: input.range ? undefined : revenueAmount,
      basis: !revenueEnabled || baseRevenue === undefined ? "none" : input.closePassed ? "recognized" : "project_value",
      projectValueAmount: baseRevenue, recognizedAmount: input.closePassed ? baseRevenue : undefined, rebateAmount,
      missingReason: revenueEnabled && baseRevenue === undefined ? "chưa nhập doanh thu dự án" : undefined
    },
    commission: { amount: commissionAmount, expected: !input.closePassed, enabled: commissionEnabled },
    wholeProjectCosts,
    laborCostAmount, otherCostAmount: totalCostAmount - laborCostAmount, totalCostAmount,
    ebit: { amount: input.range ? undefined : ebitAmount, marginPercent: input.range || ebitAmount === undefined || revenueAmount === undefined ? undefined : percentOf(ebitAmount, revenueAmount), expected: !input.closePassed },
    itemValues, costGroups: costByGroups(input.tree, input.disabledCodes, itemValues),
    afterClose, internalCost,
    reconciliation: reconcileHours(whole),
    blockingMinutes: sum(buckets.map((bucket) => bucket.blockingMinutes)),
    result: { label, labelText: RESULT_LABELS[label], reasons: [...notComputable, ...reasons] },
    recordState: recordStateOf({ lostDeal: input.lostDeal, g1Passed: input.g1Passed, closePassed: input.closePassed, internalTemplate: input.consumable, allHourMonthsLocked: !unlockedMonths.length, pendingMinutes: pendingTotal, acceptanceDateMissing: input.acceptanceDateMissing }),
    scoped: Boolean(input.range)
  };
}

/** Hours "Chờ xử lý" that block the G7 approval, by reason (mục 7 điểm 6). */
export function g7Blockers(entries: readonly EngineEntry[]) {
  const byReason = new Map<PnlGateReason, { minutes: number; entryCount: number }>();
  let waitingCostRateMinutes = 0;
  for (const entry of entries) {
    if (entry.status !== "pending") continue;
    if (!blocksG7(entry)) { if (entry.reasons.includes("missing_staff_cost")) waitingCostRateMinutes += entry.minutes; continue; }
    const reason = entry.reasons.find((code) => code !== "missing_staff_cost" && code !== "locked_period") as PnlGateReason;
    const current = byReason.get(reason) ?? { minutes: 0, entryCount: 0 };
    byReason.set(reason, { minutes: current.minutes + entry.minutes, entryCount: current.entryCount + 1 });
  }
  const rows = [...byReason.entries()].map(([reason, value]) => ({ reason, label: PNL_GATE_REASON_LABELS[reason], ...value }));
  return { blockingMinutes: sum(rows.map((row) => row.minutes)), entryCount: sum(rows.map((row) => row.entryCount)), byReason: rows, waitingCostRateMinutes };
}

// ---------------------------------------------------------------------------
// Step 12 — company-level lines (PL-12)
// ---------------------------------------------------------------------------

export type CompanyLineKey = "pre_sale" | "after_close" | "internal" | "unallocated";
export const COMPANY_LINE_LABELS: Record<CompanyLineKey, string> = {
  pre_sale: "Chi phí Pre-sale",
  after_close: "Chi phí sau nghiệm thu chưa tính vào dự án",
  internal: "Chi phí nội bộ",
  unallocated: "Chi phí nhân sự chưa phân bổ"
};

export interface CompanyMonth {
  periodKey: string;
  /** Tổng chi phí nhân sự của tháng = Σ approved monthly costs. */
  staffCostAmount: number;
  projectLaborAmount: number;
  lines: Record<CompanyLineKey, { amount: number; minutes: number; uncostedMinutes: number }>;
  /**
   * Hours logged beyond the month's standard hours cost more than the month's staff cost. "Chưa phân bổ" then stops at 0
   * and the excess is shown apart: projectLabor + the four lines − overAllocated = staffCost.
   */
  overAllocatedAmount: number;
  details: Array<{ line: Exclude<CompanyLineKey, "unallocated">; userId: string; projectId: string | null; minutes: number; amount?: number }>;
}

/**
 * Per month of occurrence: staff cost that went into projects, the three named lines, and the remainder
 * "Chi phí nhân sự chưa phân bổ" = tổng chi phí nhân sự của tháng − phần đã vào dự án − ba dòng trên, so the five parts
 * always add up to the month's staff cost. Trial projects are out of every total (PL-02): their hours stay in the remainder.
 */
export function companyCostMonth(periodKey: string, staffCostAmount: number, entries: readonly EngineEntry[], testProjectIds: ReadonlySet<string>): CompanyMonth {
  const buckets = bucketEntries(entries.filter((entry) => entry.periodKey === periodKey && !(entry.projectId && testProjectIds.has(entry.projectId))));
  const line = (minutesOf: (bucket: HourBucket) => number) => {
    const rows = buckets.filter((bucket) => minutesOf(bucket) > 0);
    return { amount: sum(rows.map((bucket) => costOfMinutes(minutesOf(bucket), bucket.rate) ?? 0)), minutes: sum(rows.map(minutesOf)), uncostedMinutes: sum(rows.filter((bucket) => !bucket.rate).map(minutesOf)) };
  };
  const projectLaborAmount = sum(buckets.map((bucket) => costOfMinutes(bucket.includedMinutes, bucket.rate) ?? 0));
  const preSale = line((bucket) => bucket.lostDealMinutes);
  const afterClose = line((bucket) => bucket.afterCloseMinutes);
  const internal = line((bucket) => bucket.internalMinutes);
  const details: CompanyMonth["details"] = [];
  for (const [key, minutesOf] of [["pre_sale", (bucket: HourBucket) => bucket.lostDealMinutes], ["after_close", (bucket: HourBucket) => bucket.afterCloseMinutes], ["internal", (bucket: HourBucket) => bucket.internalMinutes]] as const) {
    for (const bucket of buckets) if (minutesOf(bucket) > 0) details.push({ line: key, userId: bucket.userId, projectId: bucket.projectId, minutes: minutesOf(bucket), amount: costOfMinutes(minutesOf(bucket), bucket.rate) });
  }
  const rest = staffCostAmount - projectLaborAmount - preSale.amount - afterClose.amount - internal.amount;
  return {
    periodKey, staffCostAmount, projectLaborAmount,
    lines: { pre_sale: preSale, after_close: afterClose, internal, unallocated: { amount: Math.max(rest, 0), minutes: 0, uncostedMinutes: 0 } },
    overAllocatedAmount: Math.max(-rest, 0),
    details
  };
}

// ---------------------------------------------------------------------------
// Layer 3 — the five-condition checklist (mục 6.5 khối 2)
// ---------------------------------------------------------------------------

export interface ChecklistInput {
  periodKey: string;
  /** Parameters that have no value in force for the month. */
  missingParameters: string[];
  /** Hours of the month (trial projects left out). */
  entries: readonly EngineEntry[];
  /** userId → display name, for everyone with hours in the month. */
  userNames: ReadonlyMap<string, string>;
  /** People with logged hours in the month who have no APPROVED monthly cost. */
  usersWithoutApprovedCost: string[];
  /** Funds of the month: amount entered, allocated total, confirmed. */
  funds: ReadonlyArray<{ name: string; amount: number; allocatedAmount: number; confirmed: boolean }>;
  /** Projects whose closing gate was approved in the month. */
  acceptedProjects: ReadonlyArray<{ name: string; acceptedOn: string | null; projectValueAmount?: number }>;
}

export interface ChecklistRow { key: "parameters" | "pending_hours" | "staff_costs" | "funds" | "accepted_projects"; ok: boolean; label: string; detail: string | null; count: number; names: string[]; target: PnlFixTarget | null; targetLabel: string | null }

const NAMES_SHOWN = 3;
const nameList = (names: string[]) => (names.length <= NAMES_SHOWN ? names.join(", ") : `${names.slice(0, NAMES_SHOWN).join(", ")} và ${names.length - NAMES_SHOWN} người khác`);

/** Khóa khi đủ năm điều kiện. Each row says how much is missing, names the few, and where to fix it. */
export function periodChecklist(input: ChecklistInput): ChecklistRow[] {
  // (2) "không còn giờ Chờ xử lý của tháng" — no exception any more: Pre-sale hours count from the start (chốt 13/10).
  const pendingMinutes = sum(input.entries.filter((entry) => entry.status === "pending").map((entry) => entry.minutes));
  const noCost = input.usersWithoutApprovedCost.map((userId) => input.userNames.get(userId) ?? userId);
  const openFunds = input.funds.filter((fund) => !fund.confirmed || fund.allocatedAmount !== fund.amount).map((fund) => fund.name);
  const badProjects = input.acceptedProjects.filter((project) => !project.acceptedOn || project.projectValueAmount === undefined).map((project) => project.name);
  return [
    { key: "parameters", ok: !input.missingParameters.length, label: "Tham số có hiệu lực cho tháng", detail: input.missingParameters.length ? `thiếu: ${input.missingParameters.join(", ")}` : null, count: input.missingParameters.length, names: input.missingParameters, target: input.missingParameters.length ? "parameters" : null, targetLabel: input.missingParameters.length ? "Tham số" : null },
    { key: "pending_hours", ok: pendingMinutes === 0, label: "Không còn giờ Chờ xử lý của tháng", detail: pendingMinutes ? `còn ${hoursText(pendingMinutes)} giờ` : null, count: pendingMinutes, names: [], target: pendingMinutes ? "pending_hours" : null, targetLabel: pendingMinutes ? "Danh sách" : null },
    { key: "staff_costs", ok: !noCost.length, label: "Mọi người có giờ log có chi phí tháng Đã duyệt", detail: noCost.length ? `thiếu: ${nameList(noCost)}` : null, count: noCost.length, names: noCost, target: noCost.length ? "staff_costs" : null, targetLabel: noCost.length ? "Hồ sơ nhân sự" : null },
    { key: "funds", ok: !openFunds.length, label: "Mọi quỹ của tháng đã chia đủ và xác nhận", detail: openFunds.length ? `còn: ${openFunds.join(", ")}` : null, count: openFunds.length, names: openFunds, target: openFunds.length ? "funds" : null, targetLabel: openFunds.length ? "Quỹ chi phí chung" : null },
    { key: "accepted_projects", ok: !badProjects.length, label: "Dự án qua G7 trong tháng có ngày nghiệm thu và doanh thu dự án", detail: badProjects.length ? `thiếu: ${badProjects.join(", ")}` : null, count: badProjects.length, names: badProjects, target: badProjects.length ? "project_value" : null, targetLabel: badProjects.length ? "P&L dự án" : null }
  ];
}

// ---------------------------------------------------------------------------
// Layer 4 — Tổng quan P&L selection and totals (mục 4)
// ---------------------------------------------------------------------------

/** Năm / H1-H2 / Quý / Tháng → first and last month of the filter period. */
export function dashboardPeriod(year: number, unit: "year" | "half" | "quarter" | "month", index?: number): { from: string; to: string } {
  const key = (month: number) => `${year}-${String(month).padStart(2, "0")}`;
  const size = unit === "year" ? 12 : unit === "half" ? 6 : unit === "quarter" ? 3 : 1;
  const slots = 12 / size;
  const slot = unit === "year" ? 1 : Math.min(Math.max(Math.trunc(index ?? 1), 1), slots);
  return { from: key((slot - 1) * size + 1), to: key(slot * size) };
}

export interface DashboardCandidate {
  isTest: boolean;
  /** Internal/training projects use consumable-hour costing but remain visible in P&L. */
  consumable: boolean;
  lostDeal: boolean;
  /** Planned start, YYYY-MM-DD. */
  startedOn: string;
  /** Closing gate approval date, YYYY-MM-DD; undefined = not passed. */
  acceptedOn?: string;
}

/**
 * Mục 4 khối 1 + khối 5: which tab a project belongs to for a filter period, or none.
 *  - "Bắt đầu trong kỳ & đã nghiệm thu" (default): planned start inside the period and G7 passed as of now.
 *  - "Nghiệm thu trong kỳ": the G7 date inside the period, whatever the start date.
 *  - "Đang triển khai": started in the period, G7 not passed — costs only, never in the totals.
 * Trial projects are out of everything (PL-02).
 */
export function dashboardTab(project: DashboardCandidate, period: { from: string; to: string }, rule: "started_and_accepted" | "accepted_in_period"): "accepted" | "in_progress" | null {
  if (project.isTest || project.lostDeal) return null;
  const within = (dateKey: string | undefined) => Boolean(dateKey) && dateKey!.slice(0, 7) >= period.from && dateKey!.slice(0, 7) <= period.to;
  if (project.acceptedOn) return (rule === "accepted_in_period" ? within(project.acceptedOn) : within(project.startedOn)) ? "accepted" : null;
  return within(project.startedOn) ? "in_progress" : null;
}

/** A-3: accepted after every month of the filter period had already been locked. */
export function adjustedAfterClose(acceptedAt: Date | undefined, periodKeys: readonly string[], lockedAtByPeriod: ReadonlyMap<string, Date>): boolean {
  if (!acceptedAt || !periodKeys.length || !periodKeys.every((periodKey) => lockedAtByPeriod.has(periodKey))) return false;
  return periodKeys.every((periodKey) => (lockedAtByPeriod.get(periodKey) as Date).getTime() < acceptedAt.getTime());
}

/**
 * Mục 4 khối 2: each tile = Σ of the projects' whole-project figures; Biên EBIT = Σ EBIT ÷ Σ doanh thu (never the
 * average of project margins). The tile is Tạm tính when at least one project is.
 * PL-25: a project that is "Không tính được" (no revenue, or no cost rate at all) has no figure to add — it is left out
 * of revenue, cost AND EBIT, and counted, so EBIT = Doanh thu − Tổng chi phí always holds on the tiles.
 */
export function dashboardTotals(projects: ReadonlyArray<Pick<ProjectPnl, "revenue" | "laborCostAmount" | "otherCostAmount" | "totalCostAmount" | "ebit" | "result">>) {
  const counted = projects.filter((project) => project.result.label !== "not_computable" && project.revenue.amount !== undefined);
  const revenueAmount = counted.length ? sum(counted.map((project) => project.revenue.amount as number)) : undefined;
  const totalCostAmount = sum(counted.map((project) => project.totalCostAmount));
  const ebitAmount = revenueAmount === undefined ? undefined : revenueAmount - totalCostAmount;
  const provisional = projects.filter((project) => project.result.label === "provisional").length;
  const notComputable = projects.length - counted.length;
  const label: ResultLabel = !projects.length || (!provisional && !notComputable) ? "official" : "provisional";
  return {
    projectCount: projects.length,
    /** The projects the amounts are the sum of. */
    counted,
    revenueAmount,
    laborCostAmount: sum(counted.map((project) => project.laborCostAmount)),
    otherCostAmount: sum(counted.map((project) => project.otherCostAmount)),
    totalCostAmount,
    ebitAmount,
    marginPercent: ebitAmount === undefined || revenueAmount === undefined ? undefined : percentOf(ebitAmount, revenueAmount),
    provisionalProjectCount: provisional,
    notComputableProjectCount: notComputable,
    label,
    labelText: label === "provisional" ? `${RESULT_LABELS.provisional} · ${provisional + notComputable} dự án` : RESULT_LABELS.official
  };
}
