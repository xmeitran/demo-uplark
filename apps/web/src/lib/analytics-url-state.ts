import type { AnalyticsBreakdownBy, AnalyticsBreakdownSortKey, AnalyticsCompareMode, AnalyticsGrain } from "@b2b-crm/contracts";
import { ANALYTICS_BREAKDOWN_SORT_KEYS } from "@b2b-crm/contracts";

/**
 * Canonical URL state for /analytics. Only validated, non-default values are
 * serialized so a copied link is minimal and stable. IDs (never labels) own
 * the URL; labels come from the summary response's filterOptions.
 */

export type AnalyticsView = "overview" | "workforce" | "projects" | "resources";
export type AnalyticsPreset = "7d" | "30d" | "90d" | "month" | "quarter" | "custom";
export type AnalyticsBillableFilter = "all" | "billable" | "non_billable";

export interface AnalyticsUiState {
  view: AnalyticsView;
  preset: AnalyticsPreset;
  /** Custom range boundaries as HCM-local date-only strings (YYYY-MM-DD). */
  from?: string;
  to?: string;
  grain: AnalyticsGrain;
  compare: AnalyticsCompareMode;
  departmentIds: string[];
  teamIds: string[];
  userIds: string[];
  accountIds: string[];
  projectIds: string[];
  projectStatuses: string[];
  taskStatuses: string[];
  workTypes: string[];
  taskTypeLayer1Ids: string[];
  taskTypeLayer2Ids: string[];
  billable: AnalyticsBillableFilter;
  by: AnalyticsBreakdownBy;
  sort: AnalyticsBreakdownSortKey;
  direction: "asc" | "desc";
  cursor?: string;
}

export const ANALYTICS_DEFAULT_STATE: AnalyticsUiState = {
  view: "overview",
  preset: "30d",
  grain: "week",
  compare: "none",
  departmentIds: [],
  teamIds: [],
  userIds: [],
  accountIds: [],
  projectIds: [],
  projectStatuses: [],
  taskStatuses: [],
  workTypes: [],
  taskTypeLayer1Ids: [],
  taskTypeLayer2Ids: [],
  billable: "all",
  by: "project",
  sort: "reviewedApprovedMinutes",
  direction: "desc"
};

const VIEWS: AnalyticsView[] = ["overview", "workforce", "projects", "resources"];
const PRESETS: AnalyticsPreset[] = ["7d", "30d", "90d", "month", "quarter", "custom"];
const GRAINS: AnalyticsGrain[] = ["day", "week", "month"];
const BREAKDOWN_BYS: AnalyticsBreakdownBy[] = ["user", "project", "department", "team"];
const ID_PATTERN = /^[\w.:-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 128 && ID_PATTERN.test(value)))];
}

function parseDate(raw: string | null): string | undefined {
  if (!raw || !DATE_PATTERN.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? undefined : raw;
}

function shiftCalendarDate(raw: string, days: number): string | undefined {
  const parsed = parseDate(raw);
  if (!parsed) return undefined;
  const date = new Date(`${parsed}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

/** Convert an inclusive date-picker end date to the API's exclusive `to` date. */
export function inclusiveEndDateToExclusiveEndDate(inclusiveEndDate: string): string | undefined {
  return shiftCalendarDate(inclusiveEndDate, 1);
}

/** Convert the API's exclusive `to` date back to an inclusive date-picker end date. */
export function exclusiveEndDateToInclusiveEndDate(exclusiveEndDate: string): string | undefined {
  return shiftCalendarDate(exclusiveEndDate, -1);
}

export function parseAnalyticsSearchParams(params: URLSearchParams): AnalyticsUiState {
  const preset = parseEnum(params.get("preset"), PRESETS, ANALYTICS_DEFAULT_STATE.preset);
  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));
  const state: AnalyticsUiState = {
    view: parseEnum(params.get("view"), VIEWS, ANALYTICS_DEFAULT_STATE.view),
    // Keep an incomplete custom draft in URL state so choosing "custom" can
    // reveal the date controls before both boundaries have been entered.
    preset: preset === "custom" && from && to && from >= to ? ANALYTICS_DEFAULT_STATE.preset : preset,
    from,
    to,
    grain: parseEnum(params.get("grain"), GRAINS, ANALYTICS_DEFAULT_STATE.grain),
    compare: parseEnum(params.get("compare"), ["none", "previous"] as const, ANALYTICS_DEFAULT_STATE.compare),
    departmentIds: parseIds(params.get("dept")),
    teamIds: parseIds(params.get("team")),
    userIds: parseIds(params.get("user")),
    accountIds: parseIds(params.get("account")),
    projectIds: parseIds(params.get("project")),
    projectStatuses: parseIds(params.get("pstatus")),
    taskStatuses: parseIds(params.get("tstatus")),
    workTypes: parseIds(params.get("wtype")),
    taskTypeLayer1Ids: parseIds(params.get("tt1")),
    taskTypeLayer2Ids: parseIds(params.get("tt2")),
    billable: parseEnum(params.get("billable"), ["all", "billable", "non_billable"] as const, "all"),
    by: parseEnum(params.get("by"), BREAKDOWN_BYS, defaultBreakdownByForView(parseEnum(params.get("view"), VIEWS, "overview"))),
    sort: parseEnum(params.get("sort"), ANALYTICS_BREAKDOWN_SORT_KEYS, ANALYTICS_DEFAULT_STATE.sort),
    direction: parseEnum(params.get("dir"), ["asc", "desc"] as const, "desc"),
    cursor: params.get("cursor") ?? undefined
  };
  return state;
}

export function defaultBreakdownByForView(view: AnalyticsView): AnalyticsBreakdownBy {
  if (view === "workforce" || view === "resources") return "user";
  return "project";
}

export function serializeAnalyticsState(state: AnalyticsUiState): string {
  const params = new URLSearchParams();
  if (state.view !== ANALYTICS_DEFAULT_STATE.view) params.set("view", state.view);
  if (state.preset !== ANALYTICS_DEFAULT_STATE.preset) params.set("preset", state.preset);
  if (state.preset === "custom") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  if (state.grain !== ANALYTICS_DEFAULT_STATE.grain) params.set("grain", state.grain);
  if (state.compare !== "none") params.set("compare", state.compare);
  if (state.departmentIds.length > 0) params.set("dept", state.departmentIds.join(","));
  if (state.teamIds.length > 0) params.set("team", state.teamIds.join(","));
  if (state.userIds.length > 0) params.set("user", state.userIds.join(","));
  if (state.accountIds.length > 0) params.set("account", state.accountIds.join(","));
  if (state.projectIds.length > 0) params.set("project", state.projectIds.join(","));
  if (state.projectStatuses.length > 0) params.set("pstatus", state.projectStatuses.join(","));
  if (state.taskStatuses.length > 0) params.set("tstatus", state.taskStatuses.join(","));
  if (state.workTypes.length > 0) params.set("wtype", state.workTypes.join(","));
  if (state.taskTypeLayer1Ids.length > 0) params.set("tt1", state.taskTypeLayer1Ids.join(","));
  if (state.taskTypeLayer2Ids.length > 0) params.set("tt2", state.taskTypeLayer2Ids.join(","));
  if (state.billable !== "all") params.set("billable", state.billable);
  if (state.by !== defaultBreakdownByForView(state.view)) params.set("by", state.by);
  if (state.sort !== ANALYTICS_DEFAULT_STATE.sort) params.set("sort", state.sort);
  if (state.direction !== "desc") params.set("dir", state.direction);
  if (state.cursor) params.set("cursor", state.cursor);
  return params.toString();
}

function hcmToday(now: Date): Date {
  const shifted = new Date(now.getTime() + HCM_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function dateKey(utcMidnight: Date): string {
  return utcMidnight.toISOString().slice(0, 10);
}

/**
 * Resolve the [from,to) date-only boundaries (HCM local dates) for a preset.
 * `to` is exclusive and set to tomorrow so "today so far" is always included.
 */
export function resolvePresetRange(state: AnalyticsUiState, now = new Date()): { from: string; to: string } {
  const today = hcmToday(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  switch (state.preset) {
    case "7d":
      return { from: dateKey(new Date(tomorrow.getTime() - 7 * DAY_MS)), to: dateKey(tomorrow) };
    case "30d":
      return { from: dateKey(new Date(tomorrow.getTime() - 30 * DAY_MS)), to: dateKey(tomorrow) };
    case "90d":
      return { from: dateKey(new Date(tomorrow.getTime() - 90 * DAY_MS)), to: dateKey(tomorrow) };
    case "month": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from: dateKey(start), to: dateKey(tomorrow) };
    }
    case "quarter": {
      const quarterMonth = Math.floor(today.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(today.getUTCFullYear(), quarterMonth, 1));
      return { from: dateKey(start), to: dateKey(tomorrow) };
    }
    case "custom":
      return { from: state.from ?? dateKey(new Date(tomorrow.getTime() - 30 * DAY_MS)), to: state.to ?? dateKey(tomorrow) };
    default:
      return { from: dateKey(new Date(tomorrow.getTime() - 30 * DAY_MS)), to: dateKey(tomorrow) };
  }
}

/**
 * Keep chart mark counts inside budget: day grain is only honored for ranges
 * up to ~13 weeks; longer ranges fall back to week/month buckets.
 */
export function effectiveGrain(state: AnalyticsUiState, now = new Date()): AnalyticsGrain {
  const { from, to } = resolvePresetRange(state, now);
  const spanDays = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS);
  if (state.grain === "day" && spanDays > 92) return "week";
  if (state.grain === "week" && spanDays > 200) return "month";
  return state.grain;
}

export function buildAnalyticsApiQuery(state: AnalyticsUiState, now = new Date()): string {
  const { from, to } = resolvePresetRange(state, now);
  const params = new URLSearchParams();
  params.set("from", from);
  params.set("to", to);
  params.set("grain", effectiveGrain(state, now));
  if (state.compare !== "none") params.set("compare", state.compare);
  if (state.departmentIds.length > 0) params.set("departmentId", state.departmentIds.join(","));
  if (state.teamIds.length > 0) params.set("teamId", state.teamIds.join(","));
  if (state.userIds.length > 0) params.set("userId", state.userIds.join(","));
  if (state.accountIds.length > 0) params.set("accountId", state.accountIds.join(","));
  if (state.projectIds.length > 0) params.set("projectId", state.projectIds.join(","));
  if (state.projectStatuses.length > 0) params.set("projectStatus", state.projectStatuses.join(","));
  if (state.taskStatuses.length > 0) params.set("taskStatus", state.taskStatuses.join(","));
  if (state.workTypes.length > 0) params.set("workType", state.workTypes.join(","));
  if (state.taskTypeLayer1Ids.length > 0) params.set("taskTypeLayer1", state.taskTypeLayer1Ids.join(","));
  if (state.taskTypeLayer2Ids.length > 0) params.set("taskTypeLayer2", state.taskTypeLayer2Ids.join(","));
  if (state.billable !== "all") params.set("billable", state.billable);
  return params.toString();
}

export function buildBreakdownApiQuery(state: AnalyticsUiState, now = new Date()): string {
  const params = new URLSearchParams(buildAnalyticsApiQuery(state, now));
  params.set("by", state.by);
  params.set("sort", state.sort);
  params.set("direction", state.direction);
  params.set("limit", "25");
  if (state.cursor) params.set("cursor", state.cursor);
  return params.toString();
}

/** Filter/search commits always reset pagination to the first page. */
export function withFilterChange(state: AnalyticsUiState, change: Partial<AnalyticsUiState>): AnalyticsUiState {
  return { ...state, ...change, cursor: undefined };
}

export function countActiveFilters(state: AnalyticsUiState): number {
  return (
    state.departmentIds.length +
    state.teamIds.length +
    state.userIds.length +
    state.accountIds.length +
    state.projectIds.length +
    state.projectStatuses.length +
    state.taskStatuses.length +
    state.workTypes.length +
    state.taskTypeLayer1Ids.length +
    state.taskTypeLayer2Ids.length +
    (state.billable !== "all" ? 1 : 0) +
    (state.preset !== ANALYTICS_DEFAULT_STATE.preset ? 1 : 0) +
    (state.compare !== "none" ? 1 : 0)
  );
}
