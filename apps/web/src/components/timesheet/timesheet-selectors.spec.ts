import { describe, expect, it } from "vitest";
import { buildMonthlyKpis, buildPersonMonthSummaries, buildPersonProjectRows, buildProjectMemberRows, buildProjectSummaries, filterLogs, peopleInScope } from "./timesheet-selectors";
import type { ProjectNode, TaskNode, TimesheetDataset } from "./timesheet-types";

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

const task = (id: string, patch: Partial<TaskNode> = {}): TaskNode => ({ id, code: id, name: id, stageId: "s-1", assigneeId: "p-1", estimateMinutes: 60, status: "in_progress", startDate: null, dueDate: null, completedDate: null, ...patch });
const project = (tasks: TaskNode[], patch: Partial<ProjectNode> = {}): ProjectNode => ({
  id: "pr-1", code: "PR-1", name: "Project", accountName: "Client", status: "active", workGroup: "customer_project", picId: "p-1", startDate: "2026-08-01", deadline: null,
  members: [{ personId: "p-1", state: "active" }],
  milestones: [{ id: "m-1", name: "M1", projectId: "pr-1", picId: null, startDate: null, dueDate: null, status: "in_progress", stages: [{ id: "s-1", name: "S1", milestoneId: "m-1", ownerId: null, startDate: null, dueDate: null, status: "in_progress", tasks }] }],
  ...patch
});
const septemberFilters = { month: "2026-09", departmentId: "all" as const, personId: "all", personIds: [], projectId: "all" as const, workGroup: "all" as const };

describe("project summaries", () => {
  // 60' in August + 360' in September against a 300' estimate.
  const withProject: TimesheetDataset = {
    ...dataset,
    generatedAt: "2026-09-30",
    windowStart: "2026-07-01",
    projects: [project([task("t-1", { estimateMinutes: 300 })])],
    logs: [{ ...dataset.logs[0], id: "l-0", date: "2026-08-15" }, ...dataset.logs]
  };

  it("compares all-time hours with the estimate and reports the period's hours separately", () => {
    const [row] = buildProjectSummaries(withProject, filterLogs(withProject, septemberFilters), "2026-09-30");
    expect(row.actualMinutes).toBe(360);
    expect(row.allTimeActualMinutes).toBe(420);
    expect(row.consumptionPercent).toBe(140);
    expect(row.varianceMinutes).toBe(120);
    expect(row.risk).toBe("over");
    // Viewing August (60' in the period) does not make the project look healthy.
    expect(buildProjectSummaries(withProject, filterLogs(withProject, { ...septemberFilters, month: "2026-08" }), "2026-09-30")[0].risk).toBe("over");
  });

  it("marks the percentage as partial when the window may start after the project did", () => {
    const summary = (patch: Partial<ProjectNode>) => buildProjectSummaries({ ...withProject, projects: [project([task("t-1")], patch)] }, [], "2026-09-30")[0];
    expect(summary({ startDate: "2026-08-01" }).coversWholeProject).toBe(true);
    expect(summary({ startDate: "2026-05-01" }).coversWholeProject).toBe(false);
    expect(summary({ startDate: null }).coversWholeProject).toBe(false);
  });

  it("reports a project without estimate as missing estimate, never as 0% healthy", () => {
    const [row] = buildProjectSummaries({ ...withProject, projects: [project([task("t-1", { estimateMinutes: 0 })])] }, [], "2026-09-30");
    expect(row.risk).toBe("no_estimate");
  });

  it("does not count closed tasks as open or overdue, nor paused tasks of an On Hold project", () => {
    const tasks = [
      task("t-open", { dueDate: "2026-09-01" }),
      task("t-cancelled", { status: "cancelled", dueDate: "2026-09-01" }),
      task("t-done", { status: "completed", dueDate: "2026-09-01" }),
      task("t-paused", { status: "not_started", paused: true, dueDate: "2026-09-01" })
    ];
    const active = project(tasks);
    const onHold = project(tasks, { status: "on_hold" });
    expect(buildProjectSummaries({ ...withProject, projects: [active] }, [], "2026-09-30")[0].overdueTaskCount).toBe(2);
    expect(buildProjectSummaries({ ...withProject, projects: [onHold] }, [], "2026-09-30")[0].overdueTaskCount).toBe(1);
    expect(buildProjectMemberRows(active, withProject, [])[0].openTaskCount).toBe(2);
  });
});

describe("per-person figures", () => {
  it("shows the estimate of the tasks listed for the person, not the whole project's", () => {
    const withProject = { ...dataset, projects: [project([task("t-1", { estimateMinutes: 120 }), task("t-2", { estimateMinutes: 600 })])] };
    const [row] = buildPersonProjectRows(withProject, dataset.logs.filter((log) => log.personId === "p-1"));
    expect(row.taskCount).toBe(1);
    expect(row.estimateMinutes).toBe(120);
  });

  it("counts working days only as days logged, and judges completeness on people in scope", () => {
    // 2026-09-05 is a Saturday; p-3 is a former user whose hours must not fill the others' standard hours.
    const logs = [...dataset.logs, { ...dataset.logs[0], id: "l-sat", date: "2026-09-05" }];
    const scoped = { ...dataset, generatedAt: "2026-09-07", people: dataset.people.map((person) => (person.id === "p-3" ? { ...person, active: false } : person)), logs };
    const summaries = buildPersonMonthSummaries(scoped, septemberFilters, logs);
    expect(summaries.map((row) => row.person.id).sort()).toEqual(["p-1", "p-2"]);
    expect(summaries.find((row) => row.person.id === "p-1")?.daysLogged).toBe(1);
    const kpis = buildMonthlyKpis(scoped, septemberFilters, logs, summaries);
    expect(kpis.actualMinutes).toBe(420);
    expect(kpis.missingMinutes).toBe(kpis.standardMinutes - 240);
  });
});
