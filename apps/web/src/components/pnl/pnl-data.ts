import type { ProjectPlSummaryItem, ProjectSummary, TaskTimeEntrySummary } from "@b2b-crm/contracts";

export type PnlProjectStatus = "Chờ xử lý" | "Đã đối soát" | "Thiếu dữ liệu";

export type PnlExpense = {
  key: string;
  label: string;
  amount: number;
  color: string;
};

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
  grossMargin: number;
  grossMarginPercent?: number;
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
  planMinutes: number;
  logworkMinutes: number;
  pnlMinutes: number;
  excludedMinutes: number;
  pendingMinutes: number;
  expenses: PnlExpense[];
  daily: PnlDailyPoint[];
  people: PnlPerson[];
};

export const EXPENSE_COLORS = ["#2563eb", "#7c3aed", "#16a34a", "#db2777", "#f59e0b", "#64748b"];
export const EXPENSE_LABELS = ["BD", "PM", "Delivery / DX", "AI / Công cụ", "Overhead", "Khác"];

const PEOPLE = [
  { id: "an", name: "An Nguyễn", role: "Project Manager", weight: 1.1 },
  { id: "pm", name: "Phạm Minh Quân", role: "Project Manager", weight: 1.25 },
  { id: "bt", name: "Bùi Thanh", role: "Project Manager", weight: 1.05 },
  { id: "dp", name: "Đỗ Phương", role: "DX enabler", weight: 0.82 },
  { id: "lh", name: "Lê Hoàng", role: "DX enabler", weight: 0.82 },
  { id: "nl", name: "Nguyễn Linh", role: "DX enabler", weight: 0.7 }
] as const;

const DEMO_DATES = [
  "01/09/2026", "02/09/2026", "03/09/2026", "04/09/2026", "07/09/2026",
  "08/09/2026", "09/09/2026", "10/09/2026", "11/09/2026", "14/09/2026",
  "15/09/2026", "16/09/2026", "17/09/2026", "18/09/2026", "21/09/2026",
  "22/09/2026", "23/09/2026", "24/09/2026", "25/09/2026", "28/09/2026"
];

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function makeDemoPeople(totalMinutes: number, pendingMinutes: number): PnlPerson[] {
  const approved = totalMinutes - pendingMinutes;
  const dayMultipliers = [0.92, 1.02, 1.02, 1.08, 1.1, 0.92, 1.02, 1.02, 1.08, 1.1];
  const weighted = PEOPLE.reduce((sum, person) => sum + person.weight, 0);

  return PEOPLE.map((person, personIndex) => {
    const logworkMinutes = Math.round((totalMinutes * person.weight / weighted) / 10) * 10;
    const pnlMinutes = Math.round((approved * person.weight / weighted) / 10) * 10;
    const daily: PnlPerson["daily"] = {};
    DEMO_DATES.forEach((date, dateIndex) => {
      const base = Math.max(30, Math.round((logworkMinutes / DEMO_DATES.length) * dayMultipliers[dateIndex % dayMultipliers.length] / 10) * 10);
      const pnl = Math.max(0, Math.round(base * (pnlMinutes / Math.max(logworkMinutes, 1)) / 10) * 10);
      daily[date] = { plan: 480, logwork: base, pnl };
    });

    // Correct the first row's total by retaining a deterministic, believable matrix.
    if (personIndex === PEOPLE.length - 1) {
      daily[DEMO_DATES[0]] = { plan: 480, logwork: Math.max(30, Math.round((logworkMinutes / 60 / DEMO_DATES.length) * 60)), pnl: Math.max(30, Math.round((pnlMinutes / 60 / DEMO_DATES.length) * 60)) };
    }

    return {
      id: person.id,
      name: person.name,
      role: person.role,
      planMinutes: 480 * DEMO_DATES.length,
      logworkMinutes,
      pnlMinutes,
      daily
    };
  });
}

function makeDemoDaily(totalMinutes: number): PnlDailyPoint[] {
  const weights = [0.93, 0.96, 0.96, 1.0, 1.01, 0.93, 0.96, 0.96, 1.0, 1.01];
  return DEMO_DATES.map((date, index) => ({
    date,
    label: date.slice(0, 5),
    minutes: Math.round((totalMinutes / DEMO_DATES.length * weights[index % weights.length]) / 6) * 6
  }));
}

function makeExpenses(total: number): PnlExpense[] {
  const ratios = [0.08, 0.18, 0.54, 0.08, 0.07, 0.05];
  return EXPENSE_LABELS.map((label, index) => ({
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label,
    amount: Math.round((total * ratios[index]) / 10000) * 10000,
    color: EXPENSE_COLORS[index]
  }));
}

function demoProject(input: {
  id: string;
  code: string;
  name: string;
  client: string;
  revenue: number;
  planHours: number;
  logworkHours: number;
  pnlHours: number;
  expenses: number;
}): PnlProject {
  const planMinutes = input.planHours * 60;
  const logworkMinutes = input.logworkHours * 60;
  const pnlMinutes = input.pnlHours * 60;
  return {
    ...input,
    currency: "VND",
    plannedRevenue: input.revenue,
    paidRevenue: input.revenue,
    plannedCost: input.expenses,
    grossMargin: input.revenue - input.expenses,
    dataSource: "project",
    status: logworkMinutes === pnlMinutes ? "Đã đối soát" : "Chờ xử lý",
    planMinutes,
    logworkMinutes,
    pnlMinutes,
    excludedMinutes: 0,
    pendingMinutes: Math.max(logworkMinutes - pnlMinutes, 0),
    expenses: makeExpenses(input.expenses),
    daily: makeDemoDaily(logworkMinutes),
    people: makeDemoPeople(logworkMinutes, Math.max(logworkMinutes - pnlMinutes, 0))
  };
}

export const DEMO_PNL_PROJECTS: PnlProject[] = [
  demoProject({ id: "P-9001", code: "P-9001", name: "CRM cho Khách hàng A", client: "Khách hàng A", revenue: 1_680_000_000, planHours: 4_800, logworkHours: 620, pnlHours: 590, expenses: 430_000_000 }),
  demoProject({ id: "P-9002", code: "P-9002", name: "Portal đối tác B", client: "Khách hàng B", revenue: 620_000_000, planHours: 2_240, logworkHours: 420, pnlHours: 390, expenses: 280_000_000 }),
  demoProject({ id: "P-9003", code: "P-9003", name: "Tích hợp ERP nội bộ", client: "Nội bộ", revenue: 300_000_000, planHours: 1_200, logworkHours: 280, pnlHours: 0, expenses: 180_000_000 })
];

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

function isWeekday(date: string) {
  const day = new Date(`${date}T12:00:00+07:00`).getDay();
  return day !== 0 && day !== 6;
}

function mapExpenseGroups(summary: ProjectPlSummaryItem): PnlExpense[] {
  const total = summary.totalCostAmount || summary.actualLaborCostAmount + summary.directCostAmount + summary.writeOffAmount;
  if (!total) return makeExpenses(0);
  return [
    { key: "bd", label: "BD", amount: 0, color: EXPENSE_COLORS[0] },
    { key: "pm", label: "PM", amount: 0, color: EXPENSE_COLORS[1] },
    { key: "delivery-dx", label: "Delivery / DX", amount: summary.actualLaborCostAmount, color: EXPENSE_COLORS[2] },
    { key: "ai-tools", label: "AI / Công cụ", amount: 0, color: EXPENSE_COLORS[3] },
    { key: "overhead", label: "Overhead", amount: summary.directCostAmount, color: EXPENSE_COLORS[4] },
    { key: "other", label: "Khác", amount: summary.writeOffAmount, color: EXPENSE_COLORS[5] }
  ].map((item) => ({ ...item, amount: Math.max(item.amount, 0) }));
}

export function adaptLivePnlProjects(
  summaries: ProjectPlSummaryItem[],
  projects: ProjectSummary[],
  entries: TaskTimeEntrySummary[],
  period?: string
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
    const logworkMinutes = hasPeriodEntries
      ? projectEntries.reduce((total, entry) => total + entry.minutes, 0)
      : project?.loggedMinutes ?? summary.approvedLaborMinutes;
    const pnlMinutes = hasPeriodEntries
      ? projectEntries.filter((entry) => normalizeApprovalStatus(entry.approvalStatus) === "approved").reduce((total, entry) => total + entry.minutes, 0)
      : project?.approvedMinutes ?? summary.approvedLaborMinutes;
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
    const dateKeys = period ? periodDateKeys(period) : Array.from(daily.keys()).sort();
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
    return {
      id: summary.projectId,
      code: project?.code ?? summary.projectId,
      name: summary.projectName,
      client: summary.accountName ?? "Chưa gán khách hàng",
      currency: summary.currency,
      plannedRevenue: summary.plannedRevenueAmount,
      paidRevenue: summary.paidRevenueAmount,
      plannedCost: summary.plannedCostAmount,
      grossMargin: summary.grossMarginAmount,
      grossMarginPercent: summary.grossMarginPercent,
      projectStatus: project?.status,
      progressPercent: project?.progressPercent,
      taskCount: project?.taskCount,
      completedTaskCount: project?.completedTaskCount,
      ownerDisplayName: project?.ownerDisplayName,
      plannedStartAt: project?.plannedStartAt,
      plannedEndAt: project?.plannedEndAt,
      budgetAmount: project?.budgetAmount,
      spentAmount: project?.spentAmount,
      dataSource: hasPeriodEntries ? "period" : "project",
      status: statusFromEntries(logworkMinutes, pendingMinutes, project?.plannedMinutes ?? 0, !project),
      revenue: summary.paidRevenueAmount || summary.plannedRevenueAmount,
      planMinutes: project?.plannedMinutes ?? 0,
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

export function mergeWithDemoProjects(projects: PnlProject[]) {
  return projects;
}
