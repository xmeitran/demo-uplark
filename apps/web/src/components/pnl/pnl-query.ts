import type { PnlDashboardRule, PnlFixTarget, PnlGateStatusCode } from "@b2b-crm/contracts";
import { fromCsvParam, toCsvParam } from "@/components/filters/filter-values";
// pnl-cost-shared imports fixTargetHref from here; both sides only call the other inside functions.
import { monthDateRange, shiftPeriod } from "./pnl-cost-shared";

/** Inclusive days (YYYY-MM-DD), both "" = no range — the value of the shared DateRangeFilter. */
type DayRange = { from: string; to: string };
export type MonthRange = { fromMonth: string; toMonth: string };
export type PeriodPreset = DayRange & { id: string; label: string };

/** Everything the Tổng quan screen keeps in the URL. Empty string = "no filter". */
export interface PnlDashboardState {
  /** The period, whole months (YYYY-MM, inclusive). Default: the current year. */
  fromMonth: string;
  toMonth: string;
  rule: PnlDashboardRule;
  /** Text searched in project name, project code and client name. */
  q: string;
  /** Multi-selects: empty = all. */
  projectType: string[];
  accountId: string[];
  picUserId: string[];
  tab: "all" | "accepted" | "in_progress";
  /** Khối 4: "Nhóm hạch toán" (default) | "Vai trò". */
  view: "accounting" | "role";
  groupKey: string;
  page: number;
  sort: PnlDashboardSort;
  direction: "asc" | "desc";
}

export const PNL_DASHBOARD_SORTS = ["name", "start", "accepted", "revenue", "laborCost", "otherCost", "ebit", "margin"] as const;
export type PnlDashboardSort = (typeof PNL_DASHBOARD_SORTS)[number];

export const PNL_RULES: Array<{ value: PnlDashboardRule; label: string }> = [
  { value: "started_and_accepted", label: "Bắt đầu trong kỳ và đã nghiệm thu" },
  { value: "accepted_in_period", label: "Nghiệm thu trong kỳ" }
];

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** The API takes at most this many months in one period. */
export const MAX_PERIOD_MONTHS = 60;
const monthKey = (year: number | string, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * P&L is computed per whole month: picked days become the months they fall in (from → its month, to → its month),
 * at most MAX_PERIOD_MONTHS from the start. Null when a day is missing, malformed or out of order.
 */
export function snapToMonths(range: DayRange): MonthRange | null {
  if (!DAY_KEY.test(range.from) || !DAY_KEY.test(range.to) || range.to < range.from) return null;
  const fromMonth = range.from.slice(0, 7);
  const last = shiftPeriod(fromMonth, MAX_PERIOD_MONTHS - 1);
  const toMonth = range.to.slice(0, 7);
  return { fromMonth, toMonth: toMonth > last ? last : toMonth };
}

/** Whole months → the days the date control shows: first day of `fromMonth` to last day of `toMonth`. */
export function monthsToDays(months: MonthRange): DayRange {
  return { from: monthDateRange(months.fromMonth).startDate, to: monthDateRange(months.toMonth).endDate };
}

/** The period of an address written before the date control: `year` + `unit` (year | half | quarter | month) + `index`. */
export function legacyPeriod(year: number, unit: string | null, index: number): MonthRange {
  const size = unit === "half" ? 6 : unit === "quarter" ? 3 : unit === "month" ? 1 : 12;
  const slot = Math.min(Math.max(index, 1), 12 / size);
  return { fromMonth: monthKey(year, (slot - 1) * size + 1), toMonth: monthKey(year, slot * size) };
}

function calendarPicks(today: string) {
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const quarter = monthKey(year, Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1);
  const pick = (id: string, label: string, fromMonth: string, toMonth: string) => ({ id, label, fromMonth, toMonth });
  return {
    thisMonth: pick("this-month", "Tháng này", month, month),
    lastMonth: pick("last-month", "Tháng trước", shiftPeriod(month, -1), shiftPeriod(month, -1)),
    thisQuarter: pick("this-quarter", "Quý này", quarter, shiftPeriod(quarter, 2)),
    lastQuarter: pick("last-quarter", "Quý trước", shiftPeriod(quarter, -3), shiftPeriod(quarter, -1)),
    firstHalf: pick("first-half", "6 tháng đầu năm", monthKey(year, 1), monthKey(year, 6)),
    secondHalf: pick("second-half", "6 tháng cuối năm", monthKey(year, 7), monthKey(year, 12)),
    last3Months: pick("last-3-months", "3 tháng gần nhất", shiftPeriod(month, -2), month),
    thisYear: pick("this-year", "Năm nay", monthKey(year, 1), monthKey(year, 12)),
    lastYear: pick("last-year", "Năm trước", monthKey(year - 1, 1), monthKey(year - 1, 12))
  };
}
const toPreset = (pick: MonthRange & { id: string; label: string }): PeriodPreset => ({ id: pick.id, label: pick.label, ...monthsToDays(pick) });

/** Quick picks of the Tổng quan period, all whole months; `today` is the Vietnam day (YYYY-MM-DD). No "all time". */
export function dashboardPeriodPresets(today: string): PeriodPreset[] {
  const picks = calendarPicks(today);
  return [picks.thisMonth, picks.lastMonth, picks.thisQuarter, picks.lastQuarter, picks.firstHalf, picks.secondHalf, picks.thisYear, picks.lastYear].map(toPreset);
}

/**
 * Quick picks of the project scope: "Toàn dự án" (the empty range, so the control's "×" leads back to it), then
 * calendar picks cut to the project's months. A pick with no month of the project is left out.
 */
export function projectPeriodPresets(range: { minPeriodKey: string; maxPeriodKey: string }, today: string): PeriodPreset[] {
  const picks = calendarPicks(today);
  const cut = [picks.thisMonth, picks.lastMonth, picks.thisQuarter, picks.last3Months, picks.thisYear]
    .map((pick) => ({ ...pick, ...clampMonths(pick, range) }))
    .filter((pick) => pick.fromMonth <= pick.toMonth);
  return [{ id: "whole", label: "Toàn dự án", from: "", to: "" }, ...cut.map(toPreset)];
}

function clampMonths(months: MonthRange, range: { minPeriodKey: string; maxPeriodKey: string }): MonthRange {
  return { fromMonth: months.fromMonth < range.minPeriodKey ? range.minPeriodKey : months.fromMonth, toMonth: months.toMonth > range.maxPeriodKey ? range.maxPeriodKey : months.toMonth };
}

/**
 * What a pick of the project's date control stands for: null = "Toàn dự án" (the empty range, the whole span, or
 * days with no month of the project); otherwise the picked days snapped to months and cut to the project's months.
 */
export function projectScopeOfDays(days: DayRange, range: { minPeriodKey: string; maxPeriodKey: string }): MonthRange | null {
  const snapped = snapToMonths(days);
  if (!snapped) return null;
  const cut = clampMonths(snapped, range);
  return cut.fromMonth <= cut.toMonth ? projectScopeOf(cut.fromMonth, cut.toMonth, range) : null;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function wholeNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * URL → state. The period is `fromMonth` + `toMonth`; an address written before the date control (`year`, `unit`,
 * `index`) opens on the same months. Anything missing or invalid falls back to the default: the current year, rule
 * "Bắt đầu trong kỳ và đã nghiệm thu".
 */
export function parseDashboardState(params: URLSearchParams, currentYear: number): PnlDashboardState {
  const fromMonth = params.get("fromMonth") ?? "";
  const toMonth = params.get("toMonth") ?? "";
  const given = MONTH_KEY.test(fromMonth) && MONTH_KEY.test(toMonth) && fromMonth <= toMonth;
  const period = given
    ? (snapToMonths(monthsToDays({ fromMonth, toMonth })) as MonthRange)
    : legacyPeriod(wholeNumber(params.get("year"), currentYear, 2000, 2100), params.get("unit"), wholeNumber(params.get("index"), 1, 1, 12));
  return {
    ...period,
    rule: oneOf(params.get("rule"), ["started_and_accepted", "accepted_in_period"] as const, "started_and_accepted"),
    q: params.get("q")?.trim() ?? "",
    projectType: fromCsvParam(params.get("projectType")),
    accountId: fromCsvParam(params.get("accountId")),
    picUserId: fromCsvParam(params.get("picUserId")),
    tab: oneOf(params.get("tab"), ["all", "accepted", "in_progress"] as const, "all"),
    view: oneOf(params.get("view"), ["accounting", "role"] as const, "accounting"),
    groupKey: params.get("groupKey") ?? "",
    page: wholeNumber(params.get("page"), 1, 1, 100_000),
    sort: oneOf(params.get("sort"), PNL_DASHBOARD_SORTS, "start"),
    direction: oneOf(params.get("direction"), ["asc", "desc"] as const, "asc")
  };
}

const isDefaultPeriod = (state: MonthRange, currentYear: number) => state.fromMonth === monthKey(currentYear, 1) && state.toMonth === monthKey(currentYear, 12);

function entries(state: PnlDashboardState, period: Array<[string, string | null]>): Array<[string, string]> {
  const pairs: Array<[string, string | null]> = [
    ...period,
    ["rule", state.rule === "started_and_accepted" ? null : state.rule],
    ["q", state.q || null],
    ["projectType", toCsvParam(state.projectType) ?? null],
    ["accountId", toCsvParam(state.accountId) ?? null],
    ["picUserId", toCsvParam(state.picUserId) ?? null],
    ["tab", state.tab === "all" ? null : state.tab],
    ["groupKey", state.groupKey || null],
    ["page", state.page === 1 ? null : String(state.page)],
    ["sort", state.sort === "start" ? null : state.sort],
    ["direction", state.direction === "asc" ? null : state.direction]
  ];
  return pairs.filter((pair): pair is [string, string] => pair[1] !== null);
}

/** State → the page's own query string (defaults left out, so "/pnl" is the current year). */
export function dashboardSearch(state: PnlDashboardState, currentYear: number): string {
  const standard = isDefaultPeriod(state, currentYear);
  const params = new URLSearchParams(entries(state, [["fromMonth", standard ? null : state.fromMonth], ["toMonth", standard ? null : state.toMonth]]));
  if (state.view !== "accounting") params.set("view", state.view);
  return params.toString();
}

/** State → query of GET /pnl/dashboard: always a month range (`unit=custom`). `view` is a screen-only choice and is not sent. */
export function dashboardApiQuery(state: PnlDashboardState): string {
  const query = new URLSearchParams(entries(state, [["unit", "custom"], ["fromMonth", state.fromMonth], ["toMonth", state.toMonth]]));
  query.set("tab", state.tab);
  return query.toString();
}

/** Changing a filter goes back to page 1; changing the grouping drops the group filter. */
export function patchDashboardState(state: PnlDashboardState, patch: Partial<PnlDashboardState>): PnlDashboardState {
  const next = { ...state, ...patch };
  if (patch.page === undefined) next.page = 1;
  if (patch.view !== undefined && patch.view !== state.view) next.groupKey = "";
  return next;
}

/** How many filters of the Tổng quan filter bar differ from the default view (the number next to "Đặt lại"). */
export function dashboardFilterCount(state: PnlDashboardState, currentYear: number): number {
  return [!isDefaultPeriod(state, currentYear), state.rule !== "started_and_accepted", Boolean(state.q), state.projectType.length > 0, state.accountId.length > 0, state.picUserId.length > 0].filter(Boolean).length;
}

/** "Đặt lại": the current year, the default rule and no narrowing; the tab, grouping and sort the viewer chose stay. */
export function resetDashboardFilters(state: PnlDashboardState, currentYear: number): PnlDashboardState {
  return { ...state, ...legacyPeriod(currentYear, "year", 1), rule: "started_and_accepted", q: "", projectType: [], accountId: [], picUserId: [], groupKey: "", page: 1 };
}

/** Narrowed scope of the project screen; both months must lie inside the project's range, else "Toàn dự án". */
export function parseProjectScope(params: URLSearchParams): { fromMonth: string; toMonth: string } | null {
  const fromMonth = params.get("fromMonth") ?? "";
  const toMonth = params.get("toMonth") ?? "";
  return MONTH_KEY.test(fromMonth) && MONTH_KEY.test(toMonth) && fromMonth <= toMonth ? { fromMonth, toMonth } : null;
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
    // Giá trị dự án is entered on the Doanh thu figure of the project's own P&L screen (PL-13).
    case "project_value": return context.projectId ? `/pnl/${encodeURIComponent(context.projectId)}` : "/pnl";
    // Same routes as the settings screens' fixTargetHref (pnl-cost-shared.ts): 6.7 lives at /users/costs.
    case "staff_costs": return `/users/costs${context.periodKey ? `?periodKey=${encodeURIComponent(context.periodKey)}` : ""}`;
    case "funds": return `/pnl/costs?tab=funds${period}`;
    case "periods": return `/pnl/costs?tab=periods${period}`;
    case "parameters": return "/pnl/costs?tab=parameters";
    case "approval": return "/admin#approval";
  }
}

export const PNL_ENTRY_STATUSES: readonly PnlGateStatusCode[] = ["pending", "included", "excluded"];

/** Everything the "Giờ chờ xử lý" screen keeps in the URL. Empty list = all. */
export interface PnlHoursState {
  q: string;
  /** Ngày ghi giờ, inclusive Vietnam days; both "" = all time. */
  from: string;
  to: string;
  userIds: string[];
  projectIds: string[];
  /** Default ["pending"]; [] = every status (`status=all` in the URL). */
  statuses: PnlGateStatusCode[];
  reasons: string[];
  groups: string[];
}

/**
 * URL → state. The links other screens build still work: `periodKey=2026-09` and `from=2026-01&to=2026-12` (months)
 * become the day range of those months; `fromDay` / `toDay` are the specific days the date filter writes.
 */
export function parseHoursState(params: URLSearchParams): PnlHoursState {
  const day = (key: string) => { const value = params.get(key) ?? ""; return DAY_KEY.test(value) ? value : ""; };
  const month = (key: string) => { const value = params.get(key) ?? ""; return MONTH_KEY.test(value) ? value : ""; };
  const fromMonth = month("periodKey") || month("from");
  const toMonth = month("periodKey") || month("to") || fromMonth;
  const status = params.get("status");
  return {
    q: params.get("q")?.trim() ?? "",
    from: day("fromDay") || (fromMonth ? monthDateRange(fromMonth).startDate : ""),
    to: day("toDay") || (toMonth ? monthDateRange(toMonth).endDate : ""),
    userIds: fromCsvParam(params.get("userId")),
    projectIds: fromCsvParam(params.get("projectId")),
    statuses: status === null ? ["pending"] : fromCsvParam(status).filter((value): value is PnlGateStatusCode => (PNL_ENTRY_STATUSES as readonly string[]).includes(value)),
    reasons: fromCsvParam(params.get("reason")),
    groups: fromCsvParam(params.get("group")).filter((group) => ENTRY_GROUPS.includes(group))
  };
}

/** Parameters the screen has no control for; they ride along from the link that opened it until "Đặt lại". */
const HOURS_PASS_THROUGH = ["line", "blocking"];

/** State → the page's own query string (defaults left out). `current` carries the pass-through parameters. */
export function hoursSearch(state: PnlHoursState, current?: URLSearchParams): string {
  const onlyPending = state.statuses.length === 1 && state.statuses[0] === "pending";
  const pairs: Array<[string, string | undefined]> = [
    ["q", state.q || undefined],
    ["fromDay", state.from || undefined],
    ["toDay", state.to || undefined],
    ["userId", toCsvParam(state.userIds)],
    ["projectId", toCsvParam(state.projectIds)],
    ["status", onlyPending ? undefined : toCsvParam(state.statuses) ?? "all"],
    ["reason", toCsvParam(state.reasons)],
    ["group", toCsvParam(state.groups)],
    ...HOURS_PASS_THROUGH.map((key): [string, string | undefined] => [key, current?.get(key) || undefined])
  ];
  return new URLSearchParams(pairs.filter((pair): pair is [string, string] => Boolean(pair[1]))).toString();
}

/** Filters of the hours screen that narrow the list (status "Chờ xử lý" alone is the default, not a filter). */
export function hoursFilterCount(state: PnlHoursState): number {
  const onlyPending = state.statuses.length === 1 && state.statuses[0] === "pending";
  return [Boolean(state.q), Boolean(state.from || state.to), state.userIds.length > 0, state.projectIds.length > 0, !onlyPending, state.reasons.length > 0, state.groups.length > 0].filter(Boolean).length;
}

/**
 * Query of GET /pnl/entries for the hours screen: the API narrows by status, day and kind of pending hour; project,
 * person, reason and text are narrowed on the screen from that answer, so their option lists stay complete.
 */
export function entriesApiQuery(params: URLSearchParams): string {
  const state = parseHoursState(params);
  const query = new URLSearchParams();
  if (state.statuses.length) query.set("status", state.statuses.join(","));
  if (state.from) query.set("fromDay", state.from);
  if (state.to) query.set("toDay", state.to);
  if (state.groups.length) query.set("group", state.groups.join(","));
  for (const key of HOURS_PASS_THROUGH) {
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
