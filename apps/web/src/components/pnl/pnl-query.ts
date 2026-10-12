import type { PnlDashboardPeriodUnit, PnlDashboardRule, PnlFixTarget } from "@b2b-crm/contracts";

/** Everything the Tổng quan screen keeps in the URL. Empty string = "no filter". */
export interface PnlDashboardState {
  year: number;
  unit: PnlDashboardPeriodUnit;
  /** half 1–2, quarter 1–4, month 1–12; 1 for year. */
  index: number;
  rule: PnlDashboardRule;
  projectType: string;
  accountId: string;
  picUserId: string;
  tab: "accepted" | "in_progress";
  /** Khối 4: "Nhóm hạch toán" (default) | "Vai trò". */
  view: "accounting" | "role";
  groupKey: string;
  page: number;
  sort: PnlDashboardSort;
  direction: "asc" | "desc";
}

export const PNL_DASHBOARD_SORTS = ["name", "start", "accepted", "revenue", "laborCost", "otherCost", "ebit", "margin"] as const;
export type PnlDashboardSort = (typeof PNL_DASHBOARD_SORTS)[number];

export const PNL_PERIOD_UNITS: Array<{ value: PnlDashboardPeriodUnit; label: string }> = [
  { value: "year", label: "Năm" },
  { value: "half", label: "H1/H2" },
  { value: "quarter", label: "Quý" },
  { value: "month", label: "Tháng" }
];

export const PNL_RULES: Array<{ value: PnlDashboardRule; label: string }> = [
  { value: "started_and_accepted", label: "Bắt đầu trong kỳ & đã nghiệm thu" },
  { value: "accepted_in_period", label: "Nghiệm thu trong kỳ" }
];

const UNIT_SIZE: Record<PnlDashboardPeriodUnit, number> = { year: 1, half: 2, quarter: 4, month: 12 };

/** The values of the second period selector ("H1", "Quý 3", "Tháng 09"); empty for a year. */
export function periodIndexOptions(unit: PnlDashboardPeriodUnit): Array<{ value: string; label: string }> {
  if (unit === "year") return [];
  return Array.from({ length: UNIT_SIZE[unit] }, (_, position) => {
    const index = position + 1;
    const label = unit === "half" ? `H${index}` : unit === "quarter" ? `Quý ${index}` : `Tháng ${String(index).padStart(2, "0")}`;
    return { value: String(index), label };
  });
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function wholeNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** URL → state. Anything missing or invalid falls back to the spec's default (Năm, quy tắc "Bắt đầu trong kỳ & đã nghiệm thu"). */
export function parseDashboardState(params: URLSearchParams, currentYear: number): PnlDashboardState {
  const unit = oneOf(params.get("unit"), ["year", "half", "quarter", "month"] as const, "year");
  return {
    year: wholeNumber(params.get("year"), currentYear, 2000, 2100),
    unit,
    index: wholeNumber(params.get("index"), 1, 1, UNIT_SIZE[unit]),
    rule: oneOf(params.get("rule"), ["started_and_accepted", "accepted_in_period"] as const, "started_and_accepted"),
    projectType: params.get("projectType") ?? "",
    accountId: params.get("accountId") ?? "",
    picUserId: params.get("picUserId") ?? "",
    tab: oneOf(params.get("tab"), ["accepted", "in_progress"] as const, "accepted"),
    view: oneOf(params.get("view"), ["accounting", "role"] as const, "accounting"),
    groupKey: params.get("groupKey") ?? "",
    page: wholeNumber(params.get("page"), 1, 1, 100_000),
    sort: oneOf(params.get("sort"), PNL_DASHBOARD_SORTS, "start"),
    direction: oneOf(params.get("direction"), ["asc", "desc"] as const, "asc")
  };
}

function entries(state: PnlDashboardState, currentYear: number | null): Array<[string, string]> {
  const pairs: Array<[string, string | null]> = [
    ["year", currentYear !== null && state.year === currentYear ? null : String(state.year)],
    ["unit", state.unit === "year" ? null : state.unit],
    ["index", state.unit === "year" || state.index === 1 ? null : String(state.index)],
    ["rule", state.rule === "started_and_accepted" ? null : state.rule],
    ["projectType", state.projectType || null],
    ["accountId", state.accountId || null],
    ["picUserId", state.picUserId || null],
    ["tab", state.tab === "accepted" ? null : state.tab],
    ["groupKey", state.groupKey || null],
    ["page", state.page === 1 ? null : String(state.page)],
    ["sort", state.sort === "start" ? null : state.sort],
    ["direction", state.direction === "asc" ? null : state.direction]
  ];
  return pairs.filter((pair): pair is [string, string] => pair[1] !== null);
}

/** State → the page's own query string (defaults left out, so "/pnl" is the default view). */
export function dashboardSearch(state: PnlDashboardState, currentYear: number): string {
  const params = new URLSearchParams(entries(state, currentYear));
  if (state.view !== "accounting") params.set("view", state.view);
  return params.toString();
}

/** State → query of GET /pnl/dashboard. `view` is a screen-only choice and is not sent; the year always is. */
export function dashboardApiQuery(state: PnlDashboardState): string {
  return new URLSearchParams(entries(state, null)).toString();
}

/** Changing a filter goes back to page 1; changing the unit resets its index; changing the grouping drops the group filter. */
export function patchDashboardState(state: PnlDashboardState, patch: Partial<PnlDashboardState>): PnlDashboardState {
  const next = { ...state, ...patch };
  if (patch.page === undefined) next.page = 1;
  if (patch.unit !== undefined && patch.unit !== state.unit && patch.index === undefined) next.index = 1;
  if (patch.view !== undefined && patch.view !== state.view) next.groupKey = "";
  return next;
}

/** Narrowed scope of the project screen; both months must lie inside the project's range, else "Toàn dự án". */
export function parseProjectScope(params: URLSearchParams): { fromMonth: string; toMonth: string } | null {
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/;
  const fromMonth = params.get("fromMonth") ?? "";
  const toMonth = params.get("toMonth") ?? "";
  return monthKey.test(fromMonth) && monthKey.test(toMonth) && fromMonth <= toMonth ? { fromMonth, toMonth } : null;
}

/** The scope a From/To pick stands for: null ("Toàn dự án") when it covers the project's whole range; a "to" before "from" becomes "from". */
export function projectScopeOf(fromMonth: string, toMonth: string, range: { minPeriodKey: string; maxPeriodKey: string }): { fromMonth: string; toMonth: string } | null {
  const end = toMonth < fromMonth ? fromMonth : toMonth;
  return fromMonth === range.minPeriodKey && end === range.maxPeriodKey ? null : { fromMonth, toMonth: end };
}

export interface PnlFixContext {
  projectId?: string | null;
  periodKey?: string | null;
  from?: string | null;
  to?: string | null;
  /** `group` of GET /pnl/entries: cost_rate | classification | layer2_mismatch | locked_period. */
  group?: string | null;
}

const ENTRY_GROUPS = ["cost_rate", "classification", "layer2_mismatch", "locked_period"];

/** The "Chờ xử lý" worklist (/pnl/hours), scoped by whatever is known. */
export function pendingHoursHref(context: PnlFixContext = {}): string {
  const params = new URLSearchParams();
  if (context.projectId) params.set("projectId", context.projectId);
  if (context.periodKey) params.set("periodKey", context.periodKey);
  else if (context.from && context.to) { params.set("from", context.from); params.set("to", context.to); }
  if (context.group && ENTRY_GROUPS.includes(context.group)) params.set("group", context.group);
  const query = params.toString();
  return query ? `/pnl/hours?${query}` : "/pnl/hours";
}

/** Where a "thiếu … ›" link leads (PnlFixTarget → screen). */
export function fixTargetHref(target: PnlFixTarget, context: PnlFixContext = {}): string {
  const period = context.periodKey ? `&periodKey=${encodeURIComponent(context.periodKey)}` : "";
  switch (target) {
    case "pending_hours": return pendingHoursHref(context);
    case "project_setup": return context.projectId ? `/projects/${encodeURIComponent(context.projectId)}` : "/projects";
    // Same routes as the settings screens' fixTargetHref (pnl-cost-shared.ts): 6.7 lives at /users/costs.
    case "staff_costs": return `/users/costs${context.periodKey ? `?periodKey=${encodeURIComponent(context.periodKey)}` : ""}`;
    case "funds": return `/pnl/costs?tab=funds${period}`;
    case "periods": return `/pnl/costs?tab=periods${period}`;
    case "parameters": return "/pnl/costs?tab=parameters";
    case "approval": return "/admin#approval";
  }
}

/** Text of the link to the screen that fixes a missing input. */
export const FIX_TARGET_LABELS: Record<PnlFixTarget, string> = {
  staff_costs: "Chi phí tháng của nhân sự",
  pending_hours: "Mở task",
  funds: "Quỹ chi phí chung",
  periods: "Kỳ và khóa kỳ",
  project_setup: "Thiết lập P&L dự án",
  parameters: "Tham số",
  approval: "Admin › Approval"
};

/** Query of GET /pnl/entries for the worklist page: only the parameters the API knows, `status` defaulting to "pending". */
export function entriesApiQuery(params: URLSearchParams): string {
  const query = new URLSearchParams({ status: "pending" });
  for (const key of ["projectId", "periodKey", "from", "to", "status", "reason", "group", "line", "userId", "contractItemId", "blocking"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return query.toString();
}

/**
 * The BFF catch-all (/api/pnl/[...path]) forwards a path to the API's /pnl/… only when every segment is a plain
 * identifier: ids, month keys, item codes ("CP.FUNCOP.AI"), virtual instalment ids ("default:hm-01:1"). "." and ".."
 * — which a URL parser would resolve out of /pnl — and anything with another character are refused.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export function isSafePnlApiPath(path: readonly string[]): boolean {
  return path.length > 0 && path.every((segment) => SAFE_PATH_SEGMENT.test(segment));
}
