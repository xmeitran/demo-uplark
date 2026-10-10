import { describe, expect, it } from "vitest";
import { buildTimesheetAlerts } from "./timesheet-alerts";
import type { TimesheetFilters } from "./timesheet-selectors";
import type { TimesheetDataset } from "./timesheet-types";

const filters: TimesheetFilters = { month: "2026-09", departmentId: "all", personId: "all", personIds: [], projectId: "all", workGroup: "all" };

const dataset: TimesheetDataset = {
  generatedAt: "2026-09-29",
  months: ["2026-09"],
  departments: [],
  people: [{ id: "p-1", name: "A", initials: "A", role: "User", departmentId: "d", teamName: "T", standardMinutesPerDay: 480, contractRatio: 1, active: true }],
  projects: [{
    id: "prj-1", code: "PRJ-1", name: "Project", accountName: "Client", status: "active", workGroup: "customer_project", picId: "p-1", startDate: null, deadline: null,
    members: [{ personId: "p-1", role: "Member", state: "active", joinedAt: "2026-09-01" }],
    milestones: [{ id: "m-1", name: "M1", projectId: "prj-1", picId: "p-1", startDate: null, dueDate: null, status: "in_progress", stages: [{ id: "s-1", name: "S1", milestoneId: "m-1", ownerId: "p-1", startDate: null, dueDate: null, status: "in_progress", tasks: [{ id: "t-1", code: "T1", name: "Task", stageId: "s-1", assigneeId: "p-1", estimateMinutes: 60, status: "blocked", startDate: null, dueDate: "2026-09-28", completedDate: null }] }] }]
  }],
  logs: [],
  holidays: []
};

describe("buildTimesheetAlerts", () => {
  it("summarizes missing logs, overdue and blocked work from live dataset", () => {
    const alerts = buildTimesheetAlerts(dataset, [], dataset.generatedAt, filters);
    expect(alerts.map((alert) => alert.id)).toEqual(["missing-logs", "overdue-tasks", "blocked-tasks"]);
    expect(alerts.find((alert) => alert.id === "overdue-tasks")?.count).toBe(1);
  });

  it("returns no alerts when the scoped data is healthy", () => {
    const healthy = { ...dataset, people: [], projects: [], logs: [] };
    expect(buildTimesheetAlerts(healthy, [], healthy.generatedAt, filters)).toEqual([]);
  });

  it("only reports missing logs for today when the viewed period contains today, within the people filters", () => {
    const ids = (next: TimesheetFilters) => buildTimesheetAlerts(dataset, [], dataset.generatedAt, next).map((alert) => alert.id);
    expect(ids({ ...filters, month: "2026-08" })).not.toContain("missing-logs");
    expect(ids({ ...filters, departmentId: "other" })).not.toContain("missing-logs");
    expect(ids({ ...filters, personIds: ["someone-else"] })).not.toContain("missing-logs");
    // 2026-09-27 is a Sunday: nobody is expected to log.
    expect(buildTimesheetAlerts({ ...dataset, generatedAt: "2026-09-27" }, [], "2026-09-27", filters).map((alert) => alert.id)).not.toContain("missing-logs");
  });

  it("limits overdue and blocked counts to the filtered project", () => {
    expect(buildTimesheetAlerts(dataset, [], dataset.generatedAt, { ...filters, projectId: "another" }).map((alert) => alert.id)).toEqual(["missing-logs"]);
  });

  it("flags over-plan on all-time hours, not the period's, and never for a project without estimate", () => {
    const log = { id: "l-1", date: "2026-08-10", personId: "p-1", projectId: "prj-1", milestoneId: "m-1", stageId: "s-1", taskId: "t-1", minutes: 90, workGroup: "customer_project" as const, billable: true, note: "" };
    const withHistory = { ...dataset, logs: [log] };
    // Nothing logged in the viewed month, yet 90' all-time against a 60' estimate is over plan.
    expect(buildTimesheetAlerts(withHistory, [], withHistory.generatedAt, filters).find((alert) => alert.id === "over-plan")?.count).toBe(1);
  });
});
