import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import type { DateRange } from "@/components/filters/filter-dates";
import { isWithinRange, matchesAny } from "@/components/filters/filter-values";

/** The filters shared by the project's Overview, Project Sheet and Tasks tabs. Empty = all. */
export type ProjectTaskFilters = { query: string; due: DateRange; assigneeIds: string[]; statuses: string[]; priorities: string[]; milestoneIds: string[] };
export const EMPTY_PROJECT_TASK_FILTERS: ProjectTaskFilters = { query: "", due: { from: "", to: "" }, assigneeIds: [], statuses: [], priorities: [], milestoneIds: [] };

type FilterableTask = { title: string; status: string; priority: string; due?: string; assigneeUserId?: string; assigneeUserIds?: string[]; subtasks?: FilterableTask[] };

/** The page keeps task dates as display text ("Jan 5, 2026", "TBD", "Not set"): back to YYYY-MM-DD, "" when there is none. */
export function uiDateToDay(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function activeProjectTaskFilterCount(filters: ProjectTaskFilters) {
  return [filters.query.trim(), filters.due.from || filters.due.to, filters.assigneeIds.length, filters.statuses.length, filters.priorities.length, filters.milestoneIds.length].filter(Boolean).length;
}

/** One task against every filter except the milestone, which the caller knows from the hierarchy. `searchText` adds fields to search (stage, assignee name…). */
export function taskMatchesFilters(task: FilterableTask, filters: ProjectTaskFilters, ...searchText: Array<string | undefined>): boolean {
  const assignees = task.assigneeUserIds?.length ? task.assigneeUserIds : task.assigneeUserId ? [task.assigneeUserId] : [];
  return matchesSearch(filters.query, task.title, ...searchText)
    && isWithinRange(uiDateToDay(task.due), filters.due)
    && matchesAny(filters.assigneeIds, assignees)
    && matchesAny(filters.statuses, task.status)
    && matchesAny(filters.priorities, task.priority);
}

/** Board rows: a parent task stays visible when one of its subtasks matches. */
export function taskOrSubtaskMatchesFilters(task: FilterableTask, filters: ProjectTaskFilters, ...searchText: Array<string | undefined>): boolean {
  return taskMatchesFilters(task, filters, ...searchText) || (task.subtasks ?? []).some((subtask) => taskMatchesFilters(subtask, filters, ...searchText));
}
