import { describe, expect, it } from "vitest";
import { buildTimesheetAlerts } from "./timesheet-alerts";
import type { TimesheetDataset } from "./timesheet-types";

const dataset: TimesheetDataset = {
  generatedAt: "2026-09-29",
  months: ["2026-09"],
  departments: [],
  people: [{ id: "p-1", name: "A", initials: "A", role: "User", departmentId: "d", teamName: "T", standardMinutesPerDay: 480, contractRatio: 1, active: true }],
  projects: [{
    id: "prj-1", code: "PRJ-1", name: "Project", accountName: "Client", status: "in_progress", workGroup: "customer_project", picId: "p-1", deadline: null,
    members: [{ personId: "p-1", role: "Member", state: "active", joinedAt: "2026-09-01" }],
    milestones: [{ id: "m-1", name: "M1", projectId: "prj-1", picId: "p-1", startDate: null, dueDate: null, status: "in_progress", stages: [{ id: "s-1", name: "S1", milestoneId: "m-1", ownerId: "p-1", startDate: null, dueDate: null, status: "in_progress", tasks: [{ id: "t-1", code: "T1", name: "Task", stageId: "s-1", assigneeId: "p-1", estimateMinutes: 60, status: "blocked", startDate: null, dueDate: "2026-09-28", completedDate: null }] }] }]
  }],
  logs: [],
  statusEvents: [],
  holidays: []
};

describe("buildTimesheetAlerts", () => {
  it("summarizes missing logs, overdue and blocked work from live dataset", () => {
    const alerts = buildTimesheetAlerts(dataset, [], dataset.generatedAt);
    expect(alerts.map((alert) => alert.id)).toEqual(["missing-logs", "overdue-tasks", "blocked-tasks"]);
    expect(alerts.find((alert) => alert.id === "overdue-tasks")?.count).toBe(1);
  });

  it("returns no alerts when the scoped data is healthy", () => {
    const healthy = { ...dataset, people: [], projects: [], logs: [] };
    expect(buildTimesheetAlerts(healthy, [], healthy.generatedAt)).toEqual([]);
  });
});
