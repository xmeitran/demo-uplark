import { describe, expect, it } from "vitest";
import { EMPTY_PROJECT_TASK_FILTERS, activeProjectTaskFilterCount, taskMatchesFilters, taskOrSubtaskMatchesFilters, uiDateToDay, type ProjectTaskFilters } from "./task-filters";

const task = { title: "Khảo sát hiện trạng", status: "in-progress", priority: "high", due: "Oct 14, 2026", assigneeUserId: "u1", assigneeUserIds: ["u1", "u2"] };
const withFilters = (patch: Partial<ProjectTaskFilters>) => ({ ...EMPTY_PROJECT_TASK_FILTERS, ...patch });

describe("project task filters", () => {
  it("reads the page's display dates back into days", () => {
    expect(uiDateToDay("Oct 14, 2026")).toBe("2026-10-14");
    expect(uiDateToDay("Not set")).toBe("");
    expect(uiDateToDay("TBD")).toBe("");
    expect(uiDateToDay(undefined)).toBe("");
  });

  it("matches everything when no filter is set", () => {
    expect(taskMatchesFilters(task, EMPTY_PROJECT_TASK_FILTERS)).toBe(true);
    expect(activeProjectTaskFilterCount(EMPTY_PROJECT_TASK_FILTERS)).toBe(0);
  });

  it("matches any selected value of each filter and all filters together", () => {
    expect(taskMatchesFilters(task, withFilters({ statuses: ["todo", "in-progress"], priorities: ["high"] }))).toBe(true);
    expect(taskMatchesFilters(task, withFilters({ statuses: ["done"] }))).toBe(false);
    expect(taskMatchesFilters(task, withFilters({ assigneeIds: ["u2"] }))).toBe(true);
    expect(taskMatchesFilters(task, withFilters({ assigneeIds: ["u3"] }))).toBe(false);
    expect(taskMatchesFilters({ ...task, assigneeUserIds: [] }, withFilters({ assigneeIds: ["u1"] }))).toBe(true);
    expect(activeProjectTaskFilterCount(withFilters({ statuses: ["done", "todo"], query: "a", milestoneIds: ["m1"] }))).toBe(3);
  });

  it("searches without accents, including the extra fields", () => {
    expect(taskMatchesFilters(task, withFilters({ query: "khao sat" }))).toBe(true);
    expect(taskMatchesFilters(task, withFilters({ query: "nghiem thu" }))).toBe(false);
    expect(taskMatchesFilters(task, withFilters({ query: "nghiem thu" }), "Nghiệm thu")).toBe(true);
  });

  it("filters by due day; a task without a due date only passes all time", () => {
    expect(taskMatchesFilters(task, withFilters({ due: { from: "2026-10-01", to: "2026-10-31" } }))).toBe(true);
    expect(taskMatchesFilters(task, withFilters({ due: { from: "2026-10-15", to: "" } }))).toBe(false);
    expect(taskMatchesFilters({ ...task, due: "Not set" }, withFilters({ due: { from: "2026-10-01", to: "2026-10-31" } }))).toBe(false);
  });

  it("keeps a parent whose subtask matches", () => {
    const parent = { ...task, status: "done", subtasks: [{ ...task, title: "Con", status: "todo" }] };
    expect(taskMatchesFilters(parent, withFilters({ statuses: ["todo"] }))).toBe(false);
    expect(taskOrSubtaskMatchesFilters(parent, withFilters({ statuses: ["todo"] }))).toBe(true);
  });
});
