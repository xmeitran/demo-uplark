/**
 * "Yêu cầu tab P&L – hệ thống PM" (v2, 13/10/2026), section 2.1 steps 1–3 and the labels of section 3.
 * Pure: no Prisma, no Nest. Steps 4–12 are in pnl-engine.ts, the cost-item tree in pnl-tree.ts.
 * Where this document and "Nguyên tắc nền tảng hệ thống PM" differ, this one wins (its section 1, points 5 and 6).
 */
import { addWorkingDays, isWorkingDay } from "../../shared/working-days";

// ---------------------------------------------------------------------------
// Step 1 — standard hours of a month (PL-09, PNL-28)
// ---------------------------------------------------------------------------

/** Working days of a YYYY-MM month: Monday–Friday minus the workspace's active day-offs (Admin › Ngày nghỉ). */
export function workingDaysOfMonth(periodKey: string, dayOffKeys: ReadonlySet<string> = new Set()): number {
  const [year, month] = periodKey.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) if (isWorkingDay(`${periodKey}-${String(day).padStart(2, "0")}`, dayOffKeys)) count += 1;
  return count;
}

/** Giờ chuẩn của tháng (in minutes) = số ngày làm việc × giờ chuẩn một ngày. 08/2026: 21 × 8 = 168 giờ; 10/2026: 22 × 8 = 176 giờ. */
export function standardMonthMinutes(periodKey: string, dayOffKeys: ReadonlySet<string> = new Set(), standardDayMinutes = 480): number {
  return workingDaysOfMonth(periodKey, dayOffKeys) * standardDayMinutes;
}

// ---------------------------------------------------------------------------
// Step 2 — cost rate (PL-08, PL-09): approved hourly rate × logged hours
// ---------------------------------------------------------------------------

/**
 * A cost rate is kept as its two terms so nothing is rounded before the last step ("Chỉ làm tròn khi hiển thị").
 * One per person per month; a month without an approved cost has none — never a neighbouring month's (PL-10).
 */
export interface CostRate {
  /** Legacy monthly amount, kept for rows written before the direct hourly-rate flow. */
  monthlyAmount: number;
  /** Giờ chuẩn của tháng, minutes. */
  standardMinutes: number;
  /** Direct hourly rate, VND/hour. New rows use this as the source of truth. */
  hourlyAmount?: number;
}

export const STAFF_COST_STATUS_LABELS = { DRAFT: "Nháp", APPROVED: "Đã duyệt", LOCKED: "Đã khóa", NONE: "Chưa có" } as const;
export type StaffCostStatus = keyof typeof STAFF_COST_STATUS_LABELS;

/** Only an approved version of a month with standard hours yields a rate. */
export function costRateOf(cost: { totalAmount: number; hourlyCostRate?: number | null; status: string } | undefined, standardMinutes: number): CostRate | undefined {
  if (!cost || cost.status !== "APPROVED" || !(standardMinutes > 0)) return undefined;
  return { monthlyAmount: cost.totalAmount, standardMinutes, hourlyAmount: cost.hourlyCostRate ?? undefined };
}

/** VND per hour, unrounded. */
export function hourlyRate(rate: CostRate): number {
  return rate.hourlyAmount ?? (rate.monthlyAmount * 60) / rate.standardMinutes;
}

/** Cost of `minutes` at a rate, rounded to the đồng. The rounding unit of the engine is one person × one month × one bucket. */
export function costOfMinutes(minutes: number, rate: CostRate | undefined): number | undefined {
  return rate ? Math.round((minutes * hourlyRate(rate)) / 60) : undefined;
}

export const rateKey = (userId: string, periodKey: string) => `${userId}|${periodKey}`;

// ---------------------------------------------------------------------------
// Step 3 — the hour gate (PL-04, PL-05, PL-06)
// ---------------------------------------------------------------------------

export const PNL_GATE_STATUS_LABELS = { included: "Được tính", pending: "Chờ xử lý", excluded: "Bị loại" } as const;
export type PnlGateStatus = keyof typeof PNL_GATE_STATUS_LABELS;

export const PNL_GATE_REASON_LABELS = {
  // Bị loại (PL-06)
  internal: "Nội bộ",
  after_close: "Sau mốc đóng P&L",
  lost_deal_pre_sale: "Thua deal – Chi phí Pre-sale",
  // Chờ xử lý (PL-05) — thiếu hoặc sai phân loại
  missing_project: "Thiếu dự án",
  missing_layer1: "Thiếu phân loại Lớp 1",
  missing_layer2: "Thiếu phân loại Lớp 2",
  layer2_mismatch: "Lớp 2 không khớp",
  unknown_close_position: "Chưa xác định trước hay sau mốc đóng P&L",
  legacy_group_in_project: "Nhóm cũ Họp/Khác trong dự án",
  legacy_unmapped_stage: "Dữ liệu cũ: stage chưa ánh xạ được sang Lớp 1 hoặc mốc đóng P&L",
  legacy_no_stage: "Dữ liệu cũ: task không thuộc stage nào",
  // Chờ xử lý — không chặn G7
  missing_staff_cost: "Thiếu cost rate của tháng",
  locked_period: "Tháng đã khóa"
} as const;
export type PnlGateReason = keyof typeof PNL_GATE_REASON_LABELS;

export const isPnlGateReason = (value: unknown): value is PnlGateReason => typeof value === "string" && Object.prototype.hasOwnProperty.call(PNL_GATE_REASON_LABELS, value);

/** Pending reasons that are NOT a classification problem (mục 7 điểm 6, PL-16, A-9). */
const NON_BLOCKING_PENDING: ReadonlySet<PnlGateReason> = new Set(["missing_staff_cost", "locked_period"]);

/** How the dashboard's "Dữ liệu chờ xử lý" strip groups pending hours (mục 4 khối 3). */
export const PENDING_GROUP_LABELS = {
  cost_rate: "giờ chờ cost rate",
  classification: "giờ thiếu phân loại",
  layer2_mismatch: "giờ chọn Lớp 2 không khớp",
  locked_period: "giờ ghi bù vào tháng đã khóa"
} as const;
export type PendingGroup = keyof typeof PENDING_GROUP_LABELS;

/** One group per pending hour, so the groups add up to the pending total. Order: wrong choice, missing data, locked month, cost rate. */
export function pendingGroupOf(reasons: readonly PnlGateReason[]): PendingGroup {
  if (reasons.includes("layer2_mismatch")) return "layer2_mismatch";
  if (reasons.some((reason) => !NON_BLOCKING_PENDING.has(reason))) return "classification";
  return reasons.includes("locked_period") ? "locked_period" : "cost_rate";
}

/**
 * Mục 7 điểm 6: G7 is blocked only by hours pending for a missing or wrong classification.
 * Hours that only wait for a cost rate (or sit in a locked month) do not block it.
 */
export function blocksG7(entry: { status: PnlGateStatus; reasons: readonly PnlGateReason[] }): boolean {
  return entry.status === "pending" && entry.reasons.some((reason) => !NON_BLOCKING_PENDING.has(reason));
}

export interface PnlGateInput {
  projectId?: string | null;
  /** PRE_SALE | DELIVERY | PM, copied from the task. */
  taskTypeLayer1?: string | null;
  /** Layer 2 derived from the task's position (table 4.2): CUSTOMER_PROJECT | TICKET_MAINTENANCE | INTERNAL_PROJECT. */
  taskTypeLayer2?: string | null;
  /** Layer 2 the person chose when logging; null on rows written before the picker was restored (12/10/2026). */
  selectedTaskTypeLayer2?: string | null;
  /** Side of the P&L closing point the task's stage sits on: true = from Milestone 4 on, false = before, null = not known. */
  afterPnlClose?: boolean | null;
  /** The person has an APPROVED monthly cost for the month of the work date. */
  hasCostRate: boolean;
  /** The project was closed with the reason "Thua deal". */
  lostDeal?: boolean;
  /** The entry's month is locked and the entry is not in that lock's snapshot (ghi bù, A-1a). */
  loggedAfterLock?: boolean;
  /** What the legacy conversion could not settle on this entry; null once mapped or reviewed. */
  legacyPendingReason?: string | null;
}

export interface PnlGateResult {
  status: PnlGateStatus;
  /** Why the hour is excluded, or the first thing missing while it is pending. Absent when included. */
  reason?: PnlGateReason;
  reasons: PnlGateReason[];
}

/**
 * PL-04: an hour is "Được tính" when ALL FOUR hold —
 *   (1) the chosen Layer 2 is Dự án tính phí or Ticket/bảo trì AND agrees with the task;
 *   (2) it lies before the P&L closing point;
 *   (3) the classification is complete ("đủ phân loại" — there is no contract line item any more, chốt 13/10);
 *   (4) the person has an approved cost rate for that month.
 * PL-06: "Bị loại" always has a reason — Nội bộ, or Sau mốc đóng P&L (tasks from Milestone 4 on); Pre-sale hours of a
 * lost deal are excluded too because PL-12 moves them to the company line "Chi phí Pre-sale".
 * PL-05: anything else missing leaves the hour "Chờ xử lý" with its reasons.
 *
 * Order of the checks:
 *   a. a locked month accepts nothing new: "Tháng đã khóa" (A-1a) until the period is reopened;
 *   b. lost-deal Pre-sale hours are excluded whatever else is wrong — nobody will come back to fix them;
 *   c. a choice that differs from the task is "Lớp 2 không khớp" BEFORE any exclusion: an hour on a chargeable task
 *      chosen as Nội bộ must not silently drop out of the P&L (A-8, Phụ lục B ca 8);
 *   d. then the exclusions, then the missing data.
 * Legacy rows (selectedTaskTypeLayer2 = null) carry no choice to compare: the task's Layer 2 stands, so hours of the
 * months before 10/2026 become "Được tính" as soon as their monthly cost is back-filled (mục 7 điểm 8).
 */
export function classifyPnlEntry(input: PnlGateInput): PnlGateResult {
  const excluded = (reason: PnlGateReason): PnlGateResult => ({ status: "excluded", reason, reasons: [reason] });
  const pending = (reasons: PnlGateReason[]): PnlGateResult => ({ status: "pending", reason: reasons[0], reasons });

  if (input.loggedAfterLock) return pending(["locked_period"]);
  if (input.lostDeal && input.taskTypeLayer1 === "PRE_SALE") return excluded("lost_deal_pre_sale");
  // 9.2 of the rules document: an old "Họp"/"Khác" hour inside a project waits for the PM's review before any other rule reads it.
  if (input.legacyPendingReason === "legacy_group_in_project") return pending(["legacy_group_in_project"]);

  const layer2 = input.taskTypeLayer2 || null;
  const selected = input.selectedTaskTypeLayer2 || null;
  if (selected && layer2 && selected !== layer2) {
    return pending(["layer2_mismatch", ...(input.hasCostRate ? [] : ["missing_staff_cost" as const])]);
  }
  if (layer2 === "INTERNAL_PROJECT") return excluded("internal");
  if (input.afterPnlClose === true) return excluded("after_close");

  const reasons: PnlGateReason[] = [];
  if (!input.projectId) reasons.push("missing_project");
  if (!input.taskTypeLayer1) reasons.push("missing_layer1");
  if (!layer2) reasons.push("missing_layer2");
  if (input.afterPnlClose !== false) reasons.push("unknown_close_position");
  // Ticket/bảo trì only exists from Milestone 4 on (table 4.2); before the closing point it cannot agree with the task.
  if (layer2 === "TICKET_MAINTENANCE" && input.afterPnlClose === false) reasons.push("layer2_mismatch");
  if (!input.hasCostRate) reasons.push("missing_staff_cost");
  if ((input.legacyPendingReason === "legacy_unmapped_stage" || input.legacyPendingReason === "legacy_no_stage") && (reasons.includes("missing_layer1") || reasons.includes("unknown_close_position"))) {
    reasons.unshift(input.legacyPendingReason);
  }
  return reasons.length ? pending(reasons) : { status: "included", reasons: [] };
}

/** PL-07: Giờ đã ghi = Được tính + Chờ xử lý + Bị loại, on the same filter. Shown as its own line, never as the result label. */
export function reconcileHours(group: { loggedMinutes: number; includedMinutes: number; pendingMinutes: number; excludedMinutes: number }) {
  const { loggedMinutes, includedMinutes, pendingMinutes, excludedMinutes } = group;
  const differenceMinutes = loggedMinutes - (includedMinutes + pendingMinutes + excludedMinutes);
  return { loggedMinutes, includedMinutes, pendingMinutes, excludedMinutes, differenceMinutes, balanced: differenceMinutes === 0 };
}

/** PL-05: a pending hour older than N working days becomes data warning DL-01. Trial projects are exempt (PL-02) — the caller passes `exempt`. */
export function pendingDeadline(since: Date, now: Date, workingDays: number, dayOffKeys: ReadonlySet<string> = new Set(), exempt = false) {
  if (exempt) return { deadline: undefined, overdue: false };
  const deadline = addWorkingDays(since, workingDays, dayOffKeys);
  return { deadline, overdue: now.getTime() > deadline.getTime() };
}

// ---------------------------------------------------------------------------
// Role groups (PL-10, PL-20): labor cost lands in the cost item of the LOGGER's role group
// ---------------------------------------------------------------------------

export const ROLE_GROUP_LABELS = { DELIVERY: "Delivery/DX", PM: "PM", BD: "BD", CS: "CS" } as const;
export type RoleGroup = keyof typeof ROLE_GROUP_LABELS;
export const ROLE_GROUPS = Object.keys(ROLE_GROUP_LABELS) as RoleGroup[];
export const isRoleGroup = (value: unknown): value is RoleGroup => typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_GROUP_LABELS, value);

/** Business role → role group. Anyone who is not BD, PM or CS delivers (Dx, PQA, Dx Director, no role). */
export function roleGroupOf(roleCodes: readonly string[]): RoleGroup {
  if (roleCodes.includes("PM")) return "PM";
  if (roleCodes.includes("BD") || roleCodes.includes("BD_LEAD")) return "BD";
  if (roleCodes.includes("CS")) return "CS";
  return "DELIVERY";
}

// ---------------------------------------------------------------------------
// Periods (PL-23)
// ---------------------------------------------------------------------------

export const PERIOD_STATE_LABELS = { not_open: "Chưa mở", open: "Đang mở", awaiting_lock: "Chờ khóa", locked: "Đã khóa" } as const;
export type PeriodState = keyof typeof PERIOD_STATE_LABELS;

/** Chưa mở → Đang mở (the current month) → Chờ khóa (automatically once the month is over) → Đã khóa. */
export function periodStateOf(periodKey: string, currentPeriodKey: string, locked: boolean): PeriodState {
  if (locked) return "locked";
  if (periodKey > currentPeriodKey) return "not_open";
  return periodKey === currentPeriodKey ? "open" : "awaiting_lock";
}

// ---------------------------------------------------------------------------
// Results (PL-25) and the per-project record (PL-28, mục 2.2)
// ---------------------------------------------------------------------------

export const RESULT_LABELS = { official: "Chính thức", provisional: "Tạm tính", not_computable: "Không tính được" } as const;
export type ResultLabel = keyof typeof RESULT_LABELS;

export const RECORD_STATE_LABELS = {
  awaiting_contract: "Chờ hợp đồng",
  recognizing: "Đang ghi nhận",
  closed: "Đã đóng",
  official: "Chính thức",
  lost_deal: "Đóng, thua deal"
} as const;
export type RecordState = keyof typeof RECORD_STATE_LABELS;

/**
 * The record's state is never chosen: it follows the project's events (state diagram of mục 2.2).
 *   Chờ hợp đồng → (G1 được duyệt) → Đang ghi nhận → (G7 được duyệt) → Đã đóng → (mọi tháng khóa, hết giờ chờ) → Chính thức
 *   Chờ hợp đồng → (dự án đóng, lý do Thua deal — only before G1) → Đóng, thua deal
 * An internal project (Loại Nội bộ, Đào tạo) is "Đang ghi nhận" from the moment it is created.
 */
export function recordStateOf(input: { lostDeal: boolean; g1Passed: boolean; closePassed: boolean; internalTemplate: boolean; allHourMonthsLocked: boolean; pendingMinutes: number; acceptanceDateMissing?: boolean }): RecordState {
  if (input.lostDeal && !input.g1Passed) return "lost_deal";
  // A project accepted by its status alone (no G7 date) is closed but never "Chính thức".
  if (input.closePassed) return input.allHourMonthsLocked && input.pendingMinutes === 0 && !input.acceptanceDateMissing ? "official" : "closed";
  if (input.g1Passed || input.internalTemplate) return "recognizing";
  return "awaiting_contract";
}
