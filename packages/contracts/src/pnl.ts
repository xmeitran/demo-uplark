/**
 * Tab P&L — API contract of "Yêu cầu tab P&L – hệ thống PM" (v2: revenue is one manual amount per project).
 * Screen-by-screen mapping: docs/pnl-api-cho-man-hinh.md. Rules: apps/api/src/modules/resource-controls/pnl-*.ts.
 *
 * Conventions for every type below:
 *  - Money is exact VND (integer đồng). The web formats "triệu đồng"; the API never rounds to millions.
 *  - Hours are minutes (integer). 105,5 giờ = 6330.
 *  - A money / rate / margin field is `null` when it has no number: an input is missing (the result label and its
 *    reasons say which) or the viewer is outside the cost permission group (`meta.moneyVisible === false`).
 *    It is never 0 in place of missing data (PL-25).
 *  - Months are "YYYY-MM", days "YYYY-MM-DD", in Vietnam time.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary (mục 3.1)
// ---------------------------------------------------------------------------

export type PnlGateStatusCode = "included" | "pending" | "excluded";
export type PnlGateReasonCode =
  | "internal" | "after_close" | "lost_deal_pre_sale"
  | "missing_project" | "missing_layer1" | "missing_layer2" | "layer2_mismatch" | "unknown_close_position"
  | "legacy_group_in_project" | "legacy_unmapped_stage" | "legacy_no_stage"
  | "missing_staff_cost" | "locked_period";

/** Chính thức / Tạm tính / Không tính được (PL-25). */
export type PnlResultLabelCode = "official" | "provisional" | "not_computable";
/** Chờ hợp đồng / Đang ghi nhận / Đã đóng / Chính thức / Đóng, thua deal (mục 2.2). */
export type PnlRecordStateCode = "awaiting_contract" | "recognizing" | "closed" | "official" | "lost_deal";
/** Chưa mở / Đang mở / Chờ khóa / Đã khóa (PL-23). */
export type PnlPeriodStateCode = "not_open" | "open" | "awaiting_lock" | "locked";
/** Nhóm vai trò (PL-20). */
export type PnlRoleGroupCode = "DELIVERY" | "PM" | "BD" | "CS";
/** Năm cách lấy số (PL-21): Nhập tay / Lấy từ hệ thống / Công thức / Phân bổ quỹ / Tổng nhóm. */
export type PnlCostItemMethod = "MANUAL" | "SYSTEM" | "FORMULA" | "FUND" | "GROUP";
export type PnlFormulaToken = { item: string } | { param: string } | { value: number } | { op: "+" | "-" | "*" | "/" };

/** Where a "thiếu …" link leads (mục 2.4 bước 7, 11, 14). */
/** `project_value`: the Doanh thu figure of the project P&L screen, where the PM enters the project's revenue. */
export type PnlFixTarget = "staff_costs" | "pending_hours" | "funds" | "periods" | "project_setup" | "project_value" | "parameters" | "approval";

export type PnlReasonCode =
  | "not_closed" | "pending_cost_rate" | "pending_classification" | "pending_layer2_mismatch" | "pending_locked_period"
  | "months_unlocked" | "fund_unallocated" | "missing_commission_rate" | "uncosted_hours"
  | "no_project_value" | "no_cost_rate"
  /** Accepted by its status alone: the G7 date is only an estimate, the project stays Tạm tính. */
  | "missing_acceptance_date";

/** One reason a figure is Tạm tính or Không tính được, with the place to fix it. */
export interface PnlReason {
  code: PnlReasonCode;
  /** Ready to show, e.g. "105,5 giờ chờ cost rate", "tháng 08, 09 chưa khóa". */
  label: string;
  minutes?: number;
  userCount?: number;
  periodKeys?: string[];
  target: PnlFixTarget;
}

export interface PnlResult {
  label: PnlResultLabelCode;
  labelText: string;
  reasons: PnlReason[];
}

/** PL-07 — its own line, never the result label. */
export interface PnlHourReconciliation {
  loggedMinutes: number;
  includedMinutes: number;
  pendingMinutes: number;
  excludedMinutes: number;
  differenceMinutes: number;
  balanced: boolean;
}

export interface PnlMeta {
  generatedAt: string;
  currency: "VND";
  /** false: the viewer is an Admin outside the cost permission group — every money field is null. */
  moneyVisible: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canExport: boolean;
}

// ---------------------------------------------------------------------------
// Mục 4 — Tổng quan P&L (GET /pnl/dashboard)
// ---------------------------------------------------------------------------

/** "custom": an arbitrary month range given by `fromMonth` / `toMonth` (YYYY-MM, inclusive, at most 60 months). */
export type PnlDashboardPeriodUnit = "year" | "half" | "quarter" | "month" | "custom";
/** "Bắt đầu trong kỳ & đã nghiệm thu" (default) | "Nghiệm thu trong kỳ". */
export type PnlDashboardRule = "started_and_accepted" | "accepted_in_period";

export interface PnlDashboardQuery {
  year?: number;
  unit?: PnlDashboardPeriodUnit;
  /** half: 1–2, quarter: 1–4, month: 1–12. Ignored for year. */
  index?: number;
  rule?: PnlDashboardRule;
  /** unit "custom" only. */
  fromMonth?: string;
  toMonth?: string;
  /** These three take one value or several comma-joined ("a,b"); a project matches when it has one of them. */
  projectType?: string;
  accountId?: string;
  picUserId?: string;
  /** Text found in the project name, project code or client name (case- and accent-insensitive). */
  q?: string;
  /** "all" (default) | "accepted" | "in_progress" — which project list the page/sort apply to. All lists are returned. */
  tab?: "all" | "accepted" | "in_progress";
  /** Filter the project table to one cost group of block 4 (key of PnlCostGroup). */
  groupKey?: string;
  page?: number;
  pageSize?: number;
  sort?: "name" | "start" | "accepted" | "revenue" | "laborCost" | "otherCost" | "ebit" | "margin";
  direction?: "asc" | "desc";
}

export interface PnlCostGroup {
  key: string;
  label: string;
  amount: number | null;
  /** Share of total cost, 0–100 with two decimals. */
  sharePercent: number | null;
}

export interface PnlDashboardProjectRow {
  projectId: string;
  projectCode: string;
  projectName: string;
  accountId: string;
  accountName: string;
  projectType: string;
  picUserId: string | null;
  picName: string | null;
  /** Planned start, YYYY-MM-DD. */
  startedOn: string;
  /** G7 approval date; null on the "Đang triển khai" tab. */
  acceptedOn: string | null;
  /** true: the project has no G7 date — `acceptedOn` is an estimate, show it as "ngày nghiệm thu chưa xác định". */
  acceptedOnEstimated: boolean;
  /** Doanh thu nhập tay theo dự án; null chỉ khi chưa nhập hoặc người xem không có quyền xem số. EBIT vẫn null ở tab "Đang triển khai". */
  revenueAmount: number | null;
  laborCostAmount: number | null;
  otherCostAmount: number | null;
  totalCostAmount: number | null;
  ebitAmount: number | null;
  marginPercent: number | null;
  result: PnlResult;
  /** A-3: accepted after every month of the filter period had been locked. */
  adjustedAfterClose: boolean;
  /** Cost by group key in both groupings, for filtering the table by a group of block 4. */
  costByAccountingGroup: Record<string, number | null>;
  costByRoleGroup: Record<string, number | null>;
  reconciliation: PnlHourReconciliation;
}

export interface PnlPendingStripItem {
  /** not_computable: projects "Không tính được" (PL-25), left out of every tile. */
  kind: "cost_rate" | "classification" | "layer2_mismatch" | "locked_period" | "fund_unallocated" | "months_unlocked" | "not_computable";
  /** e.g. "105,5 giờ chờ cost rate". */
  label: string;
  projectCount?: number;
  minutes?: number;
  userCount?: number;
  periodKeys?: string[];
  target: PnlFixTarget;
}

export interface PnlCompanyCostLine {
  key: "pre_sale" | "after_close" | "internal" | "unallocated";
  label: string;
  amount: number | null;
  minutes: number;
  /** Hours of the line that have no approved cost rate yet: they are in "Chưa phân bổ" until they get one. */
  uncostedMinutes: number;
  byMonth: Array<{ periodKey: string; amount: number | null; minutes: number }>;
}

export interface PnlCompanyCosts {
  /** Months of the filter period, by month of occurrence. */
  periodKeys: string[];
  /** Tổng chi phí nhân sự (approved monthly costs) of those months. */
  staffCostAmount: number | null;
  /** Phần đã vào P&L dự án. */
  projectLaborAmount: number | null;
  lines: PnlCompanyCostLine[];
  /**
   * Hours logged beyond a month's standard hours cost more than that month's staff cost: "Chưa phân bổ" stops at 0 and
   * the excess is this amount (0 in the normal case). Show it as its own note, never as a negative line.
   */
  overAllocatedAmount: number | null;
  /** PL-12: projectLabor + the four lines − overAllocated = staffCost. Always true by construction; exposed for the reconciliation note. */
  balanced: boolean;
}

export interface PnlDashboardResponse {
  data: {
    /** Khối 1. */
    filter: {
      year: number; unit: PnlDashboardPeriodUnit; index: number | null; rule: PnlDashboardRule;
      fromPeriodKey: string; toPeriodKey: string;
      countedProjectCount: number; excludedTestProjectCount: number;
      options: { years: number[]; projectTypes: Array<{ value: string; label: string }>; accounts: Array<{ id: string; name: string }>; pics: Array<{ id: string; name: string }> };
      /** "nên xem kỳ dài (6 tháng đến 1 năm) vì dự án thường kéo dài hơn 2 tháng". */
      hint: string;
    };
    /** Khối 2. */
    totals: {
      projectCount: number;
      revenueAmount: number | null;
      totalCostAmount: number | null;
      laborCostAmount: number | null;
      otherCostAmount: number | null;
      ebitAmount: number | null;
      /** Σ EBIT ÷ Σ doanh thu, not an average of project margins. */
      marginPercent: number | null;
      result: PnlResult;
      provisionalProjectCount: number;
      notComputableProjectCount: number;
    };
    /** Khối 3 — empty array = hide the strip. */
    pending: PnlPendingStripItem[];
    /** Khối 4. */
    costGroups: { accounting: PnlCostGroup[]; role: PnlCostGroup[] };
    /** Khối 5. The default list contains every P&L-eligible project; the two lifecycle tabs remain available for focused views. */
    all: { total: number; page: number; pageSize: number; rows: PnlDashboardProjectRow[] };
    accepted: {
      total: number; page: number; pageSize: number;
      rows: PnlDashboardProjectRow[];
      /** Dòng tổng = khối 2, computed on the whole list (not the page). */
      totalRow: { revenueAmount: number | null; laborCostAmount: number | null; otherCostAmount: number | null; ebitAmount: number | null; marginPercent: number | null; result: PnlResult };
      reconciliation: PnlHourReconciliation;
    };
    inProgress: { total: number; page: number; pageSize: number; rows: PnlDashboardProjectRow[] };
    /** Khối 6. */
    companyCosts: PnlCompanyCosts;
  };
  meta: PnlMeta;
}

/** GET /pnl/company-costs?from=&to=&line= — "Bấm một dòng mở danh sách theo người và dự án". */
export interface PnlCompanyCostDetailResponse {
  data: Array<{ line: PnlCompanyCostLine["key"]; periodKey: string; userId: string | null; userName: string | null; projectId: string | null; projectName: string | null; minutes: number; amount: number | null }>;
  meta: PnlMeta & { companyCosts: PnlCompanyCosts };
}

// ---------------------------------------------------------------------------
// Mục 5 — P&L dự án (GET /pnl/projects/:projectId)
// ---------------------------------------------------------------------------

export interface PnlMonthMissing {
  kind: "cost_rate" | "classification" | "layer2_mismatch" | "locked_period" | "fund_unallocated";
  /** e.g. "Thiếu cost rate". */
  label: string;
  minutes?: number;
  periodKey: string;
  userIds?: string[];
  target: PnlFixTarget;
}

export interface PnlProjectMonthRow {
  periodKey: string;
  periodState: PnlPeriodStateCode;
  periodStateLabel: string;
  /** true: the row's numbers come from the lock snapshot. */
  fromSnapshot: boolean;
  loggedMinutes: number;
  includedMinutes: number;
  pendingMinutes: number;
  excludedMinutes: number;
  excludedByReason: Array<{ reason: PnlGateReasonCode; label: string; minutes: number }>;
  pendingByReason: Array<{ reason: PnlGateReasonCode; label: string; minutes: number }>;
  laborCostAmount: number | null;
  /** Phần quỹ được chia + chi phí riêng của tháng. null (shown "—") when the month has neither. */
  otherCostAmount: number | null;
  fundCostAmount: number | null;
  directCostAmount: number | null;
  totalCostAmount: number | null;
  /** Empty = "Đủ". */
  missing: PnlMonthMissing[];
}

export interface PnlProjectPersonRow {
  /** null = the "Chưa giao" row (planned hours nobody is assigned to). */
  userId: string | null;
  displayName: string;
  roleGroup: PnlRoleGroupCode | null;
  roleGroupLabel: string | null;
  plannedMinutes: number;
  loggedMinutes: number | null;
  includedMinutes: number | null;
  laborCostAmount: number | null;
  /** "Đủ", or what is missing, e.g. "Chờ cost rate T09". */
  status: { ok: boolean; label: string; missing: PnlMonthMissing[] } | null;
}

export interface PnlProjectItemRow {
  code: string;
  name: string;
  parentCode: string | null;
  level: number;
  sign: 1 | -1;
  unit: "VND" | "PERCENT" | "NONE";
  method: PnlCostItemMethod;
  methodLabel: string;
  roleGroup: PnlRoleGroupCode | null;
  /** Lũy kế toàn dự án. PERCENT items carry a percentage (two decimals) here. */
  amount: number | null;
  /** A summed child had no number. */
  incomplete: boolean;
  /** "bấm từng dòng xem nguồn số". */
  source: { kind: "hours" | "revenue" | "formula" | "fund" | "manual" | "group"; description: string; byMonth: Array<{ periodKey: string; amount: number }> };
  /** Nhập tay items only: the lines entered, editable by the cost permission group while their month is open. */
  manualLines?: PnlManualLine[];
}

export interface PnlManualLine {
  id: string;
  itemCode: string;
  periodKey: string;
  occurredOn: string;
  label: string;
  amount: number | null;
  note?: string;
  /** The month is locked: the line cannot change. */
  locked: boolean;
}

export interface PnlProjectResponse {
  data: {
    /** Khối 1. */
    header: {
      projectId: string; projectCode: string; projectName: string;
      accountId: string; accountName: string;
      projectType: string; templateKey: string; templateName: string;
      picUserId: string | null; picName: string | null;
      projectStatus: string;
      plannedStartOn: string | null; plannedEndOn: string | null;
      /** Ngày nghiệm thu (G7). null = "G7 chưa có". */
      acceptedOn: string | null;
      /** true: no G7 date on record — `acceptedOn` is an estimate, show "ngày nghiệm thu chưa xác định". */
      acceptedOnEstimated: boolean;
      closeGate: string;
      isTestProject: boolean;
      recordState: PnlRecordStateCode; recordStateLabel: string;
      result: PnlResult;
      scope: { whole: boolean; fromPeriodKey: string | null; toPeriodKey: string | null; minPeriodKey: string; maxPeriodKey: string };
    };
    /** Khối 2 — always equal to the "Toàn dự án" row of khối 4. */
    totals: {
      plannedMinutes: number;
      loggedMinutes: number;
      /** (logged − planned) ÷ planned, percent; null without a plan. */
      loggedVsPlanPercent: number | null;
      monthsWithHours: number;
      /** null + wholeProjectOnly when the scope is narrowed: show "Chỉ xem ở Toàn dự án". */
      revenue: {
        amount: number | null; basis: "project_value" | "recognized" | "none"; label: string; note: string; wholeProjectOnly: boolean; missingReason: string | null;
        /** D-22 / PL-13: doanh thu nhập tay theo dự án (stored under the legacy projectValueAmount field). */
        projectValueAmount: number | null;
        /** The viewer may enter or change it now (Admin - PM in the cost group, every project type). */
        canEdit: boolean;
        /** A change needs a reason: G1 is approved and a value already exists (the first entry never needs one). */
        reasonRequired: boolean;
        /** Reserved for compatibility; manual project revenue is not locked by G7. */
        lockedReason: string | null;
      };
      cost: { totalAmount: number | null; laborAmount: number | null; otherAmount: number | null };
      ebit: { amount: number | null; marginPercent: number | null; expected: boolean; label: string; wholeProjectOnly: boolean; missingReason: string | null };
      /** Loại Nội bộ / Đào tạo: read hours as "chi phí tiêu hao"; doanh thu vẫn nhập tay như mọi project. */
      consumable: boolean;
    };
    /** Khối 3. */
    people: PnlProjectPersonRow[];
    /** Khối 4. */
    months: {
      whole: Omit<PnlProjectMonthRow, "periodKey" | "periodState" | "periodStateLabel" | "fromSnapshot">;
      rows: PnlProjectMonthRow[];
      /**
       * "Khoản tính cho cả dự án" — every cost line computed once for the lifecycle (Hoa hồng, and any other Công thức
       * item under Tổng chi phí), with the amount it enters the total with (negative for a line that subtracts), so
       * whole.totalCostAmount = Σ rows[].totalCostAmount + Σ these amounts. Empty when the template has none;
       * `amount` null + note "Chỉ xem ở Toàn dự án" when the scope is narrowed.
       */
      wholeProjectItems: Array<{ code: string; label: string; amount: number | null; note: string; expected: boolean }>;
      /** "Chi phí sau nghiệm thu chưa tính vào dự án" — never added to Toàn dự án. */
      afterClose: { visible: boolean; note: string; minutes: number; amount: number | null; uncostedMinutes: number; rows: Array<{ periodKey: string; minutes: number; amount: number | null }> };
      reconciliation: PnlHourReconciliation;
    };
    /** Khối 5 — both null outside the cost permission group. */
    items: PnlProjectItemRow[] | null;
    history: PnlHistoryEvent[] | null;
    /** PL-22: the item template of the project's Loại dự án and this project's own deviation from it ("ghi đè mẫu", reason mandatory). */
    template: PnlProjectTemplate;
  };
  meta: PnlMeta;
}

export interface PnlProjectTemplate {
  key: string;
  name: string;
  /** Codes switched off for this project right now (template + override, or the set frozen at G7). */
  disabledCodes: string[];
  override: null | { disabledCodes: string[]; enabledCodes: string[]; reason: string; byName: string | null; at: string };
  /** Admin - PM may override the template for this project. */
  canOverride: boolean;
}

/** PUT /pnl/projects/:projectId/template-override. */
export interface PnlTemplateOverrideInput {
  /** Codes switched off / back on for this project only. */
  disabledCodes: string[];
  enabledCodes?: string[];
  /** Bắt buộc. */
  reason: string;
}

export interface PnlHistoryEvent {
  id: string;
  at: string;
  actorName: string | null;
  /** e.g. "pnl.period_locked", "pnl.project_cost_changed". */
  action: string;
  label: string;
  periodKey?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

/** GET /pnl/projects/:projectId/months/:periodKey (or periodKey = "all" for "Mở hết các tháng"). */
export interface PnlProjectMonthDetail {
  periodKey: string;
  periodState: PnlPeriodStateCode;
  standardMinutes: number;
  days: Array<{ dateKey: string; weekend: boolean; holiday: boolean; holidayName?: string }>;
  /** Bảng người × ngày. */
  people: Array<{
    userId: string; displayName: string; roleGroup: PnlRoleGroupCode; roleGroupLabel: string;
    /** Cost rate of the month, VND/giờ (unrounded). */
    hourlyCostRate: number | null;
    loggedMinutes: number; includedMinutes: number; pendingMinutes: number; excludedMinutes: number;
    laborCostAmount: number | null;
    /** `missing`: what the label stands for, by kind (the same rows as PnlProjectPersonRow.status.missing). */
    status: { ok: boolean; label: string; missing?: PnlMonthMissing[] };
    /** Personal leave days of the month (YYYY-MM-DD). */
    leaveDays: string[];
    byDay: Array<{ dateKey: string; loggedMinutes: number; includedMinutes: number; pendingMinutes: number; excludedMinutes: number }>;
  }>;
  /** "đổi được sang xem theo task". */
  tasks: Array<{
    taskId: string; taskTitle: string; layer1: string | null;
    loggedMinutes: number; includedMinutes: number; pendingMinutes: number; excludedMinutes: number;
    /** Display figure (minutes × each person's rate); the month's total is the people table's. */
    laborCostAmount: number | null;
    reasons: Array<{ reason: PnlGateReasonCode; label: string; minutes: number }>;
  }>;
  /** "cuối bảng là đối soát của tháng". */
  reconciliation: PnlHourReconciliation;
}
export interface PnlProjectMonthDetailResponse { data: PnlProjectMonthDetail[]; meta: PnlMeta }

/**
 * PUT /pnl/projects/:projectId/project-value — manual project revenue (D-22, PL-13), entered on the Doanh thu figure.
 * `amount` null clears it (only before G1). `reason` is mandatory when G1 is approved and a value already exists.
 */
export interface PnlProjectValueInput {
  amount: number | null;
  reason?: string;
}

/** POST/PATCH /pnl/projects/:projectId/manual-costs — the "Nhập tay" line. */
export interface PnlManualCostInput {
  /** A Nhập tay item of the project's template. */
  itemCode: string;
  /** Tháng phát sinh, YYYY-MM (stored on the first day) — or an exact day in occurredOn. */
  periodKey?: string;
  occurredOn?: string;
  label: string;
  amount: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Giờ log nguồn và danh sách chờ xử lý (GET /pnl/entries) — PL-07 "từ mọi số tổng mở được tới danh sách giờ log nguồn"
// ---------------------------------------------------------------------------

export interface PnlSourceEntryRow {
  id: string;
  projectId: string | null; projectCode?: string; projectName?: string;
  taskId: string | null; taskTitle?: string;
  userId: string; userDisplayName: string;
  roleGroup: PnlRoleGroupCode;
  workDate: string;
  periodKey: string;
  minutes: number;
  taskTypeLayer1: string | null;
  /** Derived from the task. */
  taskTypeLayer2: string | null;
  /** Chosen by the person; null on legacy rows. */
  selectedTaskTypeLayer2: string | null;
  status: PnlGateStatusCode; statusLabel: string;
  reason?: PnlGateReasonCode;
  reasons: PnlGateReasonCode[];
  reasonLabels: string[];
  /** Blocks the G7 approval (thiếu hoặc sai phân loại). */
  blocksG7: boolean;
  hourlyCostRate: number | null;
  costAmount: number | null;
  deadline?: string;
  overdue?: boolean;
  ownerUserId?: string; ownerDisplayName?: string;
  /** Where to fix it. */
  target?: PnlFixTarget;
  fromSnapshot: boolean;
}
export interface PnlSourceEntriesResponse {
  data: PnlSourceEntryRow[];
  meta: PnlMeta & { entryCount: number; totalMinutes: number; totalCostAmount: number | null; overdueCount: number; pendingDeadlineWorkingDays: number };
}

/** Result of ResourceControlsService/PnlService.pendingHoursBlockingG7(workspaceId, projectId). */
export interface PnlG7Blockers {
  projectId: string;
  /** Hours "Chờ xử lý" because of a missing or wrong classification. 0 = G7 may be approved. */
  blockingMinutes: number;
  entryCount: number;
  byReason: Array<{ reason: PnlGateReasonCode; label: string; minutes: number; entryCount: number }>;
  /** Hours only waiting for a cost rate: they do NOT block G7; the P&L stays Tạm tính. */
  waitingCostRateMinutes: number;
}

// ---------------------------------------------------------------------------
// Mục 6.2 — tab Khoản mục (GET /pnl/config/items)
// ---------------------------------------------------------------------------

export interface PnlCostItem {
  code: string;
  name: string;
  parentCode: string | null;
  level: number;
  sign: 1 | -1;
  roleGroup: PnlRoleGroupCode | null;
  unit: "VND" | "PERCENT" | "NONE";
  method: PnlCostItemMethod;
  methodLabel: string;
  systemSource: "revenue" | "labor" | null;
  formula: PnlFormulaToken[] | null;
  /** "[Doanh thu dự án] × [Tỷ lệ hoa hồng]". */
  formulaText: string | null;
  required: boolean;
  effectiveFromPeriod: string | null;
  /** active = Đang dùng, draft = bản nháp chưa áp dụng, retired = ngừng dùng. */
  status: "active" | "draft" | "retired";
  statusLabel: string;
  sourceNote: string | null;
  sortOrder: number;
  /** Mã khóa: đã có số ở kỳ đã khóa. */
  codeLocked: boolean;
  codeLockReason: string | null;
  /** Methods that cannot be picked for this item, with the reason. */
  lockedMethods: Array<{ method: PnlCostItemMethod; reason: string }>;
  /** Thứ tự tính (chỉ đọc). */
  dependsOn: Array<{ code: string; name: string }>;
  usedBy: Array<{ code: string; name: string }>;
  /** Pending draft changes of an active item; null when none. */
  draft: Partial<PnlCostItemInput> | null;
}

export interface PnlCostItemInput {
  code: string;
  name: string;
  parentCode: string | null;
  sign?: 1 | -1;
  roleGroup?: PnlRoleGroupCode | null;
  unit?: "VND" | "PERCENT" | "NONE";
  method: PnlCostItemMethod;
  systemSource?: "revenue" | "labor" | null;
  formula?: PnlFormulaToken[] | null;
  required?: boolean;
  sourceNote?: string | null;
  sortOrder?: number;
}

export interface PnlCostItemsResponse {
  data: {
    /** Khối 1. */
    check: {
      hasCycle: boolean; cycleCodes: string[];
      allGroupsSummed: boolean; groupErrors: string[];
      errors: string[];
      /** Khoản mục bắt buộc chưa có số ở kỳ đang xét. */
      requiredWithoutValue: Array<{ code: string; name: string }>;
      periodKey: string;
      canApply: boolean;
    };
    /** Khối 2 + 3: the tree in display order, drafts merged in (status says which). */
    items: PnlCostItem[];
    hasDraft: boolean;
    /** Kỳ đang mở — the only ones "Áp dụng bản nháp từ kỳ…" offers. */
    openPeriodKeys: string[];
    /** Đại lượng chèn được vào công thức. */
    formulaOperands: Array<{ token: PnlFormulaToken; label: string }>;
    usingDefaultTree: boolean;
  };
  meta: PnlMeta;
}

// ---------------------------------------------------------------------------
// Mục 6.3 — tab Tham số (GET /pnl/config/parameters)
// ---------------------------------------------------------------------------

export type PnlParameterKey = "standardDayHours" | "usdRate" | "pnlCloseGate" | "commissionPercent";
export type PnlParameterScopeType = "company" | "customer" | "project_type" | "project";

export interface PnlParameterValue {
  id: string;
  key: PnlParameterKey;
  /** Always null today: no parameter of the tab has one value per sub-key any more (the selling rate per role is gone, chốt 13/10). */
  subKey: string | null;
  scopeType: PnlParameterScopeType;
  scopeId: string | null;
  scopeLabel: string;
  value: number | string | null;
  /** "5%", "26.300 đ", "8 giờ", "G7 (nghiệm thu)". */
  valueText: string | null;
  effectiveFrom: string;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
  /** false: superseded by a newer value of the same scope. */
  current: boolean;
}

export interface PnlParameterRow {
  key: PnlParameterKey;
  subKey: string | null;
  label: string;
  unit: string;
  /** Giá trị mặc định = the company value in force for the current month; null = chưa nhập. */
  defaultValue: number | string | null;
  defaultValueText: string | null;
  /** "Công ty", "Công ty, theo tháng", "Công ty, khách hàng", "Công ty, dự án". */
  scopeText: string;
  allowedScopes: PnlParameterScopeType[];
  /** Số giá trị riêng (scopes other than company) in force. */
  specificValueCount: number;
  effectiveFrom: string | null;
  /** "nhập tay", "đề xuất A-5", … */
  note: string | null;
  /** standardDayHours only: "Giờ chuẩn tháng 10/2026: 22 ngày × 8 = 176 giờ, hệ thống tính từ lịch ngày nghỉ". */
  derived: null | { periodKey: string; workingDays: number; standardDayHours: number; standardHours: number; text: string };
  /** Khối 3. */
  values: PnlParameterValue[];
  history: Array<{ at: string; text: string; byName: string | null; reason: string | null }>;
}

export interface PnlParametersResponse {
  data: {
    rows: PnlParameterRow[];
    /** Khối 2 — shown while the move is in progress. */
    moved: Array<{ label: string; movedTo: string }>;
    priorityNote: string;
    openPeriodKeys: string[];
    scopeOptions: { customers: Array<{ id: string; name: string }>; projectTypes: Array<{ value: string; label: string }>; projects: Array<{ id: string; name: string }> };
  };
  meta: PnlMeta;
}

export interface PnlParameterValueInput {
  key: PnlParameterKey;
  subKey?: string | null;
  scopeType: PnlParameterScopeType;
  scopeId?: string | null;
  value: number | string;
  /** Chỉ kỳ đang mở. */
  effectiveFrom: string;
  /** Bắt buộc. */
  reason: string;
}

/** GET /pnl/calendar/standard-hours?from=&to= */
export interface PnlStandardHoursResponse {
  data: Array<{ periodKey: string; workingDays: number; standardDayHours: number; standardHours: number; holidays: Array<{ dateKey: string; name: string }> }>;
}

// ---------------------------------------------------------------------------
// Mục 6.4 — tab Quỹ chi phí chung (GET /pnl/funds?periodKey=)
// ---------------------------------------------------------------------------

export interface PnlFundAllocationRow {
  projectId: string; projectName: string;
  includedMinutes: number;
  sharePercent: number;
  amount: number | null;
  /** The last row takes the rounding remainder. */
  takesRemainder: boolean;
}

export interface PnlFundSummary {
  fundId: string;
  code: string;
  name: string;
  targetItemCode: string; targetItemName: string;
  criterion: "pnl_hours"; criterionLabel: string;
  eligibility: "billable_with_hours" | "selected_projects"; eligibilityLabel: string;
  eligibleProjectIds: string[];
  active: boolean;
  /** null = no amount entered for the month. */
  period: null | {
    periodKey: string;
    amount: number | null;
    sourceCurrency: "VND" | "USD";
    sourceAmount: number | null;
    exchangeRate: number | null;
    /** "200 USD × 26.300 đ = 5.260.000 đ, theo hóa đơn tháng". */
    amountText: string | null;
    invoiceRef: string | null;
    status: "unallocated" | "allocated"; statusLabel: string;
    confirmedAt: string | null; confirmedByName: string | null;
    allocatedAmount: number | null;
    /** Hours changed since the confirmation: "Chạy lại" then confirm again. */
    stale: boolean;
    locked: boolean;
  };
  /** Khối 3: the confirmed split when allocated and not stale, else the live preview. */
  preview: { rows: PnlFundAllocationRow[]; totalMinutes: number; totalAmount: number | null; confirmed: boolean; canConfirm: boolean; blockedReason: string | null };
}

export interface PnlFundsResponse {
  data: {
    periodKey: string;
    periodState: PnlPeriodStateCode;
    funds: PnlFundSummary[];
    /** Khối 4. */
    warnings: Array<{ kind: "cost_rate" | "classification" | "layer2_mismatch" | "locked_period"; label: string; minutes: number; target: PnlFixTarget }>;
    periodOptions: string[];
    targetItemOptions: Array<{ code: string; name: string }>;
  };
  meta: PnlMeta;
}

export interface PnlFundInput { code?: string; name: string; targetItemCode: string; eligibility?: "billable_with_hours" | "selected_projects"; eligibleProjectIds?: string[]; active?: boolean }
export interface PnlFundAmountInput { sourceCurrency: "VND" | "USD"; sourceAmount: number; invoiceRef?: string | null }

// ---------------------------------------------------------------------------
// Mục 6.5 — tab Kỳ và khóa kỳ (GET /pnl/periods)
// ---------------------------------------------------------------------------

export interface PnlChecklistItem {
  key: "parameters" | "pending_hours" | "staff_costs" | "funds" | "accepted_projects";
  ok: boolean;
  label: string;
  /** "còn 117,5 giờ", "thiếu: Nhân sự B", "còn: Công cụ AI". */
  detail: string | null;
  count: number;
  names: string[];
  target: PnlFixTarget | null;
  targetLabel: string | null;
}

export interface PnlPeriodCard {
  periodKey: string;
  state: PnlPeriodStateCode;
  stateLabel: string;
  /** "Đã khóa · 05/08 · PM-1", "Chờ khóa · sẵn sàng", "Chờ khóa · còn 3 việc", "Đang mở · hiện tại", "Chưa mở". */
  statusText: string;
  missingCount: number;
  lockedAt: string | null;
  lockedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface PnlPeriodsResponse {
  data: {
    periods: PnlPeriodCard[];
    selected: null | {
      periodKey: string;
      state: PnlPeriodStateCode;
      checklist: PnlChecklistItem[];
      /** Five conditions met, the month is over, and every earlier month that has data is locked. */
      canLock: boolean;
      lockButtonText: string;
      /** Kỳ khóa theo thứ tự: the first earlier month that has data (hours, costs, fund amounts) and is not locked; null = none. */
      lockBlockedByPeriodKey: string | null;
      /** The sentence to show under the disabled lock button; null when the order does not block. */
      lockBlockedReason: string | null;
      /** A locked month: the months "Mở lại" reopens in one action — this one and every later locked month. Empty otherwise. */
      reopenPeriodKeys: string[];
      snapshotNote: string;
      reopenNote: string;
      explanation: string;
      /** Lock / reopen cycles of the month, newest first. */
      history: Array<{ lockedAt: string; lockedByName: string | null; reopenedAt: string | null; reopenedByName: string | null; reopenReason: string | null; summary: PnlPeriodSnapshotSummary }>;
    };
  };
  meta: PnlMeta;
}

export interface PnlPeriodSnapshotSummary {
  entryCount: number;
  loggedMinutes: number; includedMinutes: number; pendingMinutes: number; excludedMinutes: number;
  staffCostAmount: number | null;
  projectLaborAmount: number | null;
  fundAmount: number | null;
  directCostAmount: number | null;
  standardMinutes: number;
}

export interface PnlReopenPeriodInput { reason: string }

// ---------------------------------------------------------------------------
// Mục 6.6 — tab Mẫu khoản mục (GET /pnl/config/templates)
// ---------------------------------------------------------------------------

export interface PnlTemplatesResponse {
  data: {
    /** Khối 1. */
    templates: Array<{ key: string; name: string; description: string; consumable: boolean; disabledCodes: string[]; enabledItemCount: number; projectCount: number }>;
    /** Khối 2 — only rows that differ between templates; parameter rows carry text values. */
    comparison: Array<{ kind: "item" | "parameter"; code: string; label: string; cells: Record<string, { enabled?: boolean; text?: string }> }>;
    comparisonNote: string;
    /** Khối 3. */
    overrides: Array<{ projectId: string; projectName: string; summary: string; disabledCodes: string[]; enabledCodes: string[]; byName: string | null; at: string; reason: string }>;
    items: Array<{ code: string; name: string; parentCode: string | null; level: number; canDisable: boolean }>;
  };
  meta: PnlMeta;
}
export interface PnlTemplateInput { disabledCodes: string[] }

// ---------------------------------------------------------------------------
// Mục 6.7 — Hồ sơ nhân sự › Chi phí theo tháng (GET /pnl/staff-costs?periodKey=)
// ---------------------------------------------------------------------------

export interface PnlStaffCostComponents {
  /** Lương tiêu chuẩn. */
  baseSalaryAmount: number;
  /** Thưởng hiệu suất. */
  performanceBonusAmount: number;
  /** Thưởng hiệu quả. */
  resultBonusAmount: number;
  /** Phụ cấp. */
  allowanceAmount: number;
  /** OT. */
  overtimeAmount: number;
  /** BHXH công ty đóng. */
  socialInsuranceAmount: number;
}

export interface PnlStaffCostRow {
  userId: string;
  /** Mã nhân sự (đúng mã của hệ thống lương); null = chưa gán mã. */
  employeeCode: string | null;
  displayName: string;
  department: string | null;
  periodKey: string;
  components: { [K in keyof PnlStaffCostComponents]: number | null } | null;
  totalAmount: number | null;
  /** Đơn giá giờ nhập/được duyệt, VND/giờ. Chỉ "Đã duyệt" feeds the P&L. */
  hourlyCostRate: number | null;
  source: "manual" | "import" | "payroll" | "converted_hourly_rate" | null;
  sourceLabel: string | null;
  /** NONE = "Chưa có". LOCKED = approved and the month is locked. */
  status: "NONE" | "DRAFT" | "APPROVED" | "LOCKED";
  statusLabel: string;
  /** Hours the person logged in the month. */
  loggedMinutes: number;
  /** Hours waiting for this month's cost (person has hours but no approved cost): the row is highlighted. */
  waitingMinutes: number;
  approvedAt: string | null;
  approvedByName: string | null;
  updatedAt: string | null;
}

export interface PnlStaffCostsResponse {
  data: {
    periodKey: string;
    periodState: PnlPeriodStateCode;
    /** Khối 1. */
    standardMinutes: number; workingDays: number; standardDayHours: number;
    counts: { approved: number; draft: number; missing: number };
    /** Khối 3. */
    rows: PnlStaffCostRow[];
    /** Khối 4 — the last import of the month. */
    lastImport: null | PnlStaffCostImportResult;
    periodOptions: string[];
    /** Khối 2 and 5 — fixed texts. */
    notes: { phase: string; lockRules: string[] };
  };
  meta: PnlMeta;
}

export interface PnlStaffCostInput extends Partial<PnlStaffCostComponents> {
  userId: string;
  periodKey: string;
  /** Đơn giá giờ trực tiếp, VND/giờ. Đây là số được nhân với giờ P&L đã ghi nhận. */
  hourlyCostRate?: number | null;
  /** Legacy single-figure entry: stored as Lương tiêu chuẩn when no component is given. null removes the draft. */
  monthlyCostAmount?: number | null;
  role?: string;
  level?: string;
}

export interface PnlStaffCostImportInput {
  periodKey: string;
  /** Rows parsed from the template by the browser. */
  rows: Array<{ employeeCode: string; hourlyCostRate?: number } & Partial<PnlStaffCostComponents>>;
}

export interface PnlStaffCostImportResult {
  periodKey: string;
  at: string;
  byName: string | null;
  validCount: number;
  errors: Array<{ rowNumber: number; employeeCode: string; reason: string }>;
}

/** GET /pnl/staff-costs/template?periodKey= — what the browser needs to build "Tải file mẫu". */
export interface PnlStaffCostTemplateResponse {
  data: { periodKey: string; columns: Array<{ key: "employeeCode" | "displayName" | "hourlyCostRate" | keyof PnlStaffCostComponents; label: string; required: boolean }>; rows: Array<{ employeeCode: string | null; displayName: string }> };
}

/** One month of one person on the profile page (GET /staff-costs?userId=) — the same row as mục 6.7, read per person. */
export interface StaffMonthlyCostRow {
  periodKey: string;
  /** Monthly equivalent kept for legacy/payroll display; not used to derive the hourly rate for new entries. */
  monthlyCostAmount: number;
  /** Đơn giá giờ nhập/được duyệt, VND/giờ. */
  hourlyCostRate: number;
  /** Working days of the month × "Giờ chuẩn một ngày". */
  standardHours: number;
  role?: string;
  level?: string;
  source: "manual" | "converted_hourly_rate";
  sourceLabel: string;
  components: PnlStaffCostComponents;
  status: "DRAFT" | "APPROVED" | "LOCKED";
  statusLabel: string;
  /** The cost period is locked: the row cannot change until the period is reopened. */
  locked: boolean;
  updatedAt: string;
}

export interface StaffMonthlyCostsResponse {
  data: StaffMonthlyCostRow[];
  meta: { userId: string; canEdit: boolean; currency: string; standardDayHours: number; lockedPeriodKeys: string[] };
}

export interface PnlStaffCostApproveInput {
  periodKey: string;
  /** Omit to approve every Nháp row of the month ("Duyệt bản nháp"). */
  userIds?: string[];
}
