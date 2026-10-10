import type { ProjectCostItem, ProjectPlSummaryItem, ProjectSummary, TaskTimeEntrySummary } from "@b2b-crm/contracts";

export type PnlProjectStatus = "Chờ xử lý" | "Đã đối soát" | "Thiếu dữ liệu";

export type PnlExpense = {
  key: string;
  label: string;
  amount: number;
  color: string;
  status?: "Có số liệu" | "Chưa cung cấp";
  note?: string;
};

/** "none": the viewed period has no entered revenue (whole-project planned revenue is not a period figure). */
export type PnlRevenueBasis = "custom" | "paid" | "planned" | "none";
export type PnlResultStatus = "Sẵn sàng" | "Tạm tính" | "Thiếu dữ liệu";

export type PnlDailyPoint = {
  date: string;
  label: string;
  minutes: number;
  pnlMinutes?: number;
  pendingMinutes?: number;
  isWorkingDay?: boolean;
  entryCount?: number;
  peopleLogged?: number;
};

export type PnlPerson = {
  id: string;
  name: string;
  role: string;
  planMinutes: number;
  logworkMinutes: number;
  pnlMinutes: number;
  /** Cost figures come from the server (approved hours × cost rate); absent when the person has no approved hours. */
  hourlyCostRate?: number;
  laborCost?: number;
  missingRateMinutes?: number;
  daily: Record<string, { plan: number; logwork: number; pnl: number }>;
};

export type PnlProject = {
  id: string;
  code: string;
  name: string;
  client: string;
  currency: string;
  plannedRevenue: number;
  paidRevenue: number;
  plannedCost: number;
  costAvailable: boolean;
  /** Server totals. Never re-derive cost from revenue − margin. */
  totalCost: number;
  laborCost: number;
  directCost: number;
  writeOff: number;
  /** Approved minutes with no cost rate: their cost is missing from totalCost. */
  missingRateMinutes: number;
  costItems: ProjectCostItem[];
  /** API: totalCost − laborCost. */
  otherCost: number;
  /** API: entered cost lines inside totalCost (frozen when locked). */
  enteredCost: number;
  /**
   * Locked month only: frozen pool share + formula costs as one amount. When set, sharedCost is 0,
   * calculatedItems is empty, and people / costItems / hours are current data that may differ from the locked totals.
   */
  lockedOtherCost?: number;
  /** Share of the month's shared cost pool allocated to the project. */
  sharedCost: number;
  /** Costs calculated from the formulas users set up for each month. */
  calculatedItems: Array<{ code: string; label: string; category: string; amount: number }>;
  /** True when the figures are a locked month snapshot. */
  locked: boolean;
  grossMargin: number;
  grossMarginPercent?: number;
  /** %Expenses/Revenue from the API; absent without revenue. */
  expenseRatioPercent?: number;
  projectStatus?: string;
  progressPercent?: number;
  taskCount?: number;
  completedTaskCount?: number;
  ownerDisplayName?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  budgetAmount?: number;
  spentAmount?: number;
  dataSource: "period" | "project";
  status: PnlProjectStatus;
  revenue: number;
  revenueBasis: PnlRevenueBasis;
  revenueScope: "Kỳ báo cáo" | "Toàn project";
  pnlResultStatus: PnlResultStatus;
  planMinutes: number;
  logworkMinutes: number;
  /** Approved minutes, always the API's approvedLaborMinutes (the hours the labor cost is computed on). */
  pnlMinutes: number;
  excludedMinutes: number;
  pendingMinutes: number;
  expenses: PnlExpense[];
  daily: PnlDailyPoint[];
  people: PnlPerson[];
};

export const EXPENSE_COLORS = ["#2563eb", "#7c3aed", "#16a34a", "#db2777", "#f59e0b", "#64748b"];
function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function hours(minutes: number) {
  return round(minutes / 60);
}

export function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(value))} ₫`;
}

export function formatMoney(value: number, currency = "VND") {
  const code = currency.trim().toUpperCase() || "VND";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(value))} ${code}`;
}

export function formatHours(value: number) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(hours(value))}h`;
}

export function formatCompactVnd(value: number) {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2).replace(".", ",")}B ₫`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M ₫`;
  return formatVnd(value);
}

function normalizeApprovalStatus(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function statusFromEntries(logwork: number, pending: number, planned: number, missingProject = false): PnlProjectStatus {
  if (missingProject || (planned === 0 && logwork === 0)) return "Thiếu dữ liệu";
  if (pending > 0) return "Chờ xử lý";
  return "Đã đối soát";
}

function localDateKey(value: string | Date) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function periodDateKeys(period: string) {
  const [year, month] = period.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`);
}

function dateRangeKeys(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const keys: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys;
}

function isWeekday(date: string) {
  const day = new Date(`${date}T12:00:00+07:00`).getDay();
  return day !== 0 && day !== 6;
}

export const EXPENSE_GROUPS: Array<{ key: string; label: string; hint: string }> = [
  { key: "salaries-related", label: "Salaries Related", hint: "Giờ đã duyệt × cost rate theo tháng của từng người." },
  { key: "welfare-related", label: "Welfare Related", hint: "BHXH, phúc lợi, tuyển dụng, đào tạo." },
  { key: "basic-activities", label: "Basic Activities", hint: "Điện nước, internet, văn phòng phẩm, chi phí hoạt động." },
  { key: "business-location", label: "Business Location", hint: "Văn phòng, quản lý, vệ sinh." },
  { key: "sell-marketing", label: "Sell & MKT Expenses", hint: "Commission bên thứ ba, marketing B2B." },
  { key: "functional-operation", label: "Functional Operation", hint: "Thuê ngoài, phần mềm, AI, bank charge, thuế, tỷ giá, vận hành." }
];

/** Rows of a locked month: the snapshot keeps labor, entered lines and "everything else", not the six groups. */
export const LOCKED_EXPENSE_ROWS = {
  entered: { key: "locked-entered", label: "Chi phí nhập tay đã chốt" },
  other: { key: "locked-other", label: "Chi phí khác đã chốt (quỹ dùng chung + khoản tính theo công thức)" }
} as const;

/** Expense rows of a project. They always add up to the API's totalCostAmount. */
function mapExpenseGroups(summary: ProjectPlSummaryItem): PnlExpense[] {
  const labor = Math.max(summary.actualLaborCostAmount, 0);
  if (summary.lockedOtherCostAmount !== undefined) {
    const frozen = "Số đã chốt; không tách theo nhóm chi phí.";
    return [
      { key: "salaries-related", label: EXPENSE_GROUPS[0].label, amount: labor, color: EXPENSE_COLORS[0], status: "Có số liệu", note: "Chi phí nhân sự đã chốt." },
      { ...LOCKED_EXPENSE_ROWS.entered, amount: summary.enteredCostAmount ?? 0, color: EXPENSE_COLORS[2], status: "Có số liệu", note: frozen },
      { ...LOCKED_EXPENSE_ROWS.other, amount: summary.lockedOtherCostAmount, color: EXPENSE_COLORS[5], status: "Có số liệu", note: frozen }
    ];
  }
  const shared = summary.sharedCostAmount ?? 0;
  return EXPENSE_GROUPS.map((group, index) => {
    const entered = group.key === "salaries-related" ? labor : summary.costByCategory?.[group.key as keyof ProjectPlSummaryItem["costByCategory"]] ?? 0;
    // costByCategory already holds entered lines and calculated items; the shared pool is an operating cost.
    const amount = group.key === "functional-operation" ? entered + shared : entered;
    const note = group.key === "salaries-related" && summary.missingRateMinutes > 0 ? "Còn giờ chưa có cost rate nên số này chưa đủ."
      : group.key === "functional-operation" && shared > 0 ? `Gồm ${formatMoney(shared, summary.currency)} quỹ dùng chung phân bổ.`
        : amount > 0 ? group.hint : `Chưa nhập. ${group.hint}`;
    return { key: group.key, label: group.label, amount, color: EXPENSE_COLORS[index], status: amount > 0 ? "Có số liệu" as const : "Chưa cung cấp" as const, note };
  });
}

export function adaptLivePnlProjects(
  summaries: ProjectPlSummaryItem[],
  projects: ProjectSummary[],
  entries: TaskTimeEntrySummary[],
  period?: string,
  dateRange?: { startDate: string; endDate: string }
): PnlProject[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const entriesByProject = new Map<string, TaskTimeEntrySummary[]>();
  for (const entry of entries) {
    if (!entry.projectId) continue;
    const bucket = entriesByProject.get(entry.projectId) ?? [];
    bucket.push(entry);
    entriesByProject.set(entry.projectId, bucket);
  }

  return summaries.map((summary) => {
    const projectEntries = entriesByProject.get(summary.projectId) ?? [];
    const project = projectById.get(summary.projectId);
    const hasPeriodEntries = projectEntries.length > 0;
    const hasScopedRange = Boolean(period || dateRange);
    // Approved hours sit next to money, so they are the API's figure (reporting-timezone boundaries,
    // the same minutes the labor cost is computed on) — never re-derived from the entries loaded here.
    const pnlMinutes = summary.approvedLaborMinutes ?? 0;
    const loggedByEntries = hasPeriodEntries
      ? projectEntries.reduce((total, entry) => total + entry.minutes, 0)
      : hasScopedRange ? 0 : project?.loggedMinutes ?? pnlMinutes;
    // Logged time can never be less than what was approved out of it.
    const logworkMinutes = Math.max(loggedByEntries, pnlMinutes);
    const excludedMinutes = projectEntries.filter((entry) => ["rejected", "cancelled"].includes(normalizeApprovalStatus(entry.approvalStatus))).reduce((total, entry) => total + entry.minutes, 0);
    const pendingMinutes = Math.max(logworkMinutes - pnlMinutes - excludedMinutes, 0);
    const daily = new Map<string, { minutes: number; pnlMinutes: number; excludedMinutes: number; entryCount: number; people: Set<string> }>();
    projectEntries.forEach((entry) => {
      const date = localDateKey(entry.workDate);
      if (!date) return;
      const approvalStatus = normalizeApprovalStatus(entry.approvalStatus);
      const bucket = daily.get(date) ?? { minutes: 0, pnlMinutes: 0, excludedMinutes: 0, entryCount: 0, people: new Set<string>() };
      bucket.minutes += entry.minutes;
      bucket.entryCount += 1;
      bucket.people.add(entry.userId);
      if (approvalStatus === "approved") bucket.pnlMinutes += entry.minutes;
      if (["rejected", "cancelled"].includes(approvalStatus)) bucket.excludedMinutes += entry.minutes;
      daily.set(date, bucket);
    });
    const dateKeys = dateRange ? dateRangeKeys(dateRange.startDate, dateRange.endDate) : period ? periodDateKeys(period) : Array.from(daily.keys()).sort();
    const dailyPoints = dateKeys.map((date) => {
      const bucket = daily.get(date) ?? { minutes: 0, pnlMinutes: 0, excludedMinutes: 0, entryCount: 0, people: new Set<string>() };
      return {
        date,
        label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
        minutes: bucket.minutes,
        pnlMinutes: bucket.pnlMinutes,
        pendingMinutes: Math.max(bucket.minutes - bucket.pnlMinutes - bucket.excludedMinutes, 0),
        isWorkingDay: isWeekday(date),
        entryCount: bucket.entryCount,
        peopleLogged: bucket.people.size
      };
    });
    const people = new Map<string, PnlPerson>();
    const plannedByPerson = new Map<string, Map<string, number>>();
    projectEntries.forEach((entry) => {
      const current = people.get(entry.userId) ?? {
        id: entry.userId,
        name: entry.userDisplayName ?? entry.userEmail ?? entry.userId,
        role: "Project member",
        planMinutes: 0,
        logworkMinutes: 0,
        pnlMinutes: 0,
        daily: {}
      };
      if (entry.taskEstimateMinutes && entry.taskId) {
        const taskPlans = plannedByPerson.get(entry.userId) ?? new Map<string, number>();
        taskPlans.set(entry.taskId, Math.max(taskPlans.get(entry.taskId) ?? 0, entry.taskEstimateMinutes));
        plannedByPerson.set(entry.userId, taskPlans);
      }
      current.logworkMinutes += entry.minutes;
      const approvalStatus = normalizeApprovalStatus(entry.approvalStatus);
      if (approvalStatus === "approved") current.pnlMinutes += entry.minutes;
      const date = localDateKey(entry.workDate);
      if (!date) return;
      const daily = current.daily[date] ?? { plan: 0, logwork: 0, pnl: 0 };
      daily.logwork += entry.minutes;
      if (approvalStatus === "approved") daily.pnl += entry.minutes;
      current.daily[date] = daily;
      people.set(entry.userId, current);
    });
    people.forEach((person) => {
      person.planMinutes = [...(plannedByPerson.get(person.id)?.values() ?? [])].reduce((total, minutes) => total + minutes, 0);
    });
    // Approved hours and cost per person are computed by the API; attach them to the hours rows.
    if (summary.laborByPerson) people.forEach((person) => { person.pnlMinutes = 0; });
    for (const labor of summary.laborByPerson ?? []) {
      const person = people.get(labor.userId) ?? { id: labor.userId, name: labor.displayName, role: "Project member", planMinutes: 0, logworkMinutes: labor.approvedMinutes, pnlMinutes: labor.approvedMinutes, daily: {} };
      person.pnlMinutes = labor.approvedMinutes;
      person.logworkMinutes = Math.max(person.logworkMinutes, labor.approvedMinutes);
      person.hourlyCostRate = labor.hourlyCostRate;
      person.laborCost = labor.laborCostAmount;
      person.missingRateMinutes = labor.missingRateMinutes;
      people.set(labor.userId, person);
    }
    const revenueBasis: PnlRevenueBasis = summary.revenueBasis === "custom" ? "custom" : summary.revenueBasis === "none" ? "none" : "planned";
    const revenueScope: PnlProject["revenueScope"] = revenueBasis === "custom" ? "Kỳ báo cáo" : "Toàn project";
    const hasRevenue = summary.revenueBasis !== "none";
    const missingRateMinutes = summary.missingRateMinutes ?? 0;
    // "Sẵn sàng" means the viewed month itself is locked — never that some other month is.
    const pnlResultStatus: PnlResultStatus = summary.locked ? "Sẵn sàng" : !hasRevenue || (hasScopedRange && !hasPeriodEntries) ? "Thiếu dữ liệu" : "Tạm tính";
    return {
      id: summary.projectId,
      code: project?.code ?? summary.projectId,
      name: summary.projectName,
      client: summary.accountName ?? "Chưa gán khách hàng",
      currency: summary.currency,
      plannedRevenue: summary.plannedRevenueAmount,
      paidRevenue: summary.paidRevenueAmount,
      plannedCost: summary.plannedCostAmount,
      // Cost is usable once every approved hour has a rate; a real zero is a valid cost.
      costAvailable: missingRateMinutes === 0,
      totalCost: summary.totalCostAmount,
      laborCost: summary.actualLaborCostAmount,
      directCost: summary.directCostAmount,
      writeOff: summary.writeOffAmount,
      missingRateMinutes,
      costItems: summary.costItems ?? [],
      otherCost: summary.otherCostAmount ?? 0,
      enteredCost: summary.enteredCostAmount ?? 0,
      lockedOtherCost: summary.lockedOtherCostAmount,
      sharedCost: summary.sharedCostAmount ?? 0,
      calculatedItems: summary.calculatedItems ?? [],
      locked: Boolean(summary.locked),
      grossMargin: summary.grossMarginAmount,
      grossMarginPercent: summary.grossMarginPercent,
      expenseRatioPercent: summary.expenseRatioPercent,
      projectStatus: project?.status,
      progressPercent: project?.progressPercent,
      taskCount: project?.taskCount,
      completedTaskCount: project?.completedTaskCount,
      ownerDisplayName: project?.ownerDisplayName,
      plannedStartAt: project?.plannedStartAt,
      plannedEndAt: project?.plannedEndAt,
      budgetAmount: project?.budgetAmount,
      spentAmount: project?.spentAmount,
      dataSource: hasPeriodEntries || hasScopedRange ? "period" : "project",
      status: statusFromEntries(logworkMinutes, pendingMinutes, summary.plannedMinutes ?? project?.plannedMinutes ?? 0, !project || (hasScopedRange && !hasPeriodEntries)),
      revenue: summary.revenueAmount,
      revenueBasis,
      revenueScope,
      pnlResultStatus,
      planMinutes: summary.plannedMinutes ?? project?.plannedMinutes ?? 0,
      logworkMinutes,
      pnlMinutes,
      excludedMinutes,
      pendingMinutes,
      expenses: mapExpenseGroups(summary),
      daily: dailyPoints,
      people: Array.from(people.values())
    };
  });
}
