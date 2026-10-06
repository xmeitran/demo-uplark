import { describe, expect, it } from "vitest";
import { filterLogs, peopleInScope } from "./timesheet-selectors";
import type { TimesheetDataset } from "./timesheet-types";

const dataset: TimesheetDataset = {
  generatedAt: "2026-09-30T00:00:00.000Z",
  months: ["2026-09"],
  departments: [],
  people: [
    { id: "p-1", name: "A", initials: "A", role: "Member", departmentId: "d-1", teamName: "Team", standardMinutesPerDay: 480, contractRatio: 1, active: true },
    { id: "p-2", name: "B", initials: "B", role: "Member", departmentId: "d-1", teamName: "Team", standardMinutesPerDay: 480, contractRatio: 1, active: true },
    { id: "p-3", name: "C", initials: "C", role: "Member", departmentId: "d-1", teamName: "Team", standardMinutesPerDay: 480, contractRatio: 1, active: true }
  ],
  projects: [],
  logs: [
    { id: "l-1", date: "2026-09-01", personId: "p-1", projectId: "pr-1", milestoneId: "m-1", stageId: "s-1", taskId: "t-1", minutes: 60, workGroup: "customer_project", billable: true, note: "" },
    { id: "l-2", date: "2026-09-01", personId: "p-2", projectId: "pr-1", milestoneId: "m-1", stageId: "s-1", taskId: "t-2", minutes: 120, workGroup: "customer_project", billable: true, note: "" },
    { id: "l-3", date: "2026-09-01", personId: "p-3", projectId: "pr-1", milestoneId: "m-1", stageId: "s-1", taskId: "t-3", minutes: 180, workGroup: "customer_project", billable: true, note: "" }
  ],
  statusEvents: [],
  holidays: []
};

describe("timesheet personnel filter", () => {
  it("filters logs and people by multiple selected personnel", () => {
    const filters = {
      month: "2026-09",
      departmentId: "all" as const,
      personId: "multiple",
      personIds: ["p-1", "p-3"],
      projectId: "all" as const,
      workGroup: "all" as const
    };

    expect(filterLogs(dataset, filters).map((log) => log.personId)).toEqual(["p-1", "p-3"]);
    expect(peopleInScope(dataset, filters).map((person) => person.id)).toEqual(["p-1", "p-3"]);
  });
});
