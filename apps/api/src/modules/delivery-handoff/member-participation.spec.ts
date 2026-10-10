import { describe, expect, it } from "vitest";
import { deriveMemberParticipation, isActualTimeEntry, participationWindow, sumActualMinutes } from "./member-participation";

const planned = { plannedStartAt: new Date("2026-10-01"), dueAt: new Date("2026-10-05") };

describe("deriveMemberParticipation", () => {
  it("puts every member of an On Hold project on hold, even with time logs", () => {
    expect(deriveMemberParticipation({ projectOnHold: true, actualMinutes: 120, openTasks: [planned] }).state).toBe("on_hold");
  });

  it("is active with at least one actual time entry in the period", () => {
    expect(deriveMemberParticipation({ projectOnHold: false, actualMinutes: 30, openTasks: [] }).state).toBe("active");
  });

  it("reports missing data without an open task or without task dates", () => {
    expect(deriveMemberParticipation({ projectOnHold: false, actualMinutes: 0, openTasks: [] }).state).toBe("missing_data");
    expect(deriveMemberParticipation({ projectOnHold: false, actualMinutes: 0, openTasks: [{ plannedStartAt: null, dueAt: planned.dueAt }] }).state).toBe("missing_data");
  });

  it("reports no_log when there is a plan but no actual in the period", () => {
    expect(deriveMemberParticipation({ projectOnHold: false, actualMinutes: 0, openTasks: [{}, planned] })).toEqual({
      state: "no_log",
      reason: "Có kế hoạch nhưng chưa có Time Log thực tế trong kỳ"
    });
  });

  it("does not report members of a completed project as missing data", () => {
    expect(deriveMemberParticipation({ projectOnHold: false, projectCompleted: true, actualMinutes: 0, openTasks: [] }).state).toBe("no_log");
    expect(deriveMemberParticipation({ projectOnHold: false, projectCompleted: true, actualMinutes: 45, openTasks: [] }).state).toBe("active");
  });
});

describe("actual hours", () => {
  it("counts every entry except rejected, cancelled and planned", () => {
    expect(["approved", "submitted", "done", "Approved"].every((approvalStatus) => isActualTimeEntry({ approvalStatus }))).toBe(true);
    expect(["rejected", "cancelled", "canceled", "planned", " Planned "].some((approvalStatus) => isActualTimeEntry({ approvalStatus }))).toBe(false);
    expect(sumActualMinutes([{ minutes: 60, approvalStatus: "approved" }, { minutes: 30, approvalStatus: "submitted" }, { minutes: 500, approvalStatus: "rejected" }, { minutes: 90, approvalStatus: "planned" }])).toBe(90);
  });
});

describe("participationWindow", () => {
  it("covers whole Asia/Ho_Chi_Minh days: start of startDate through the end of endDate", () => {
    const window = participationWindow(new Date("2026-10-01"), new Date("2026-10-31"));
    expect(window.start.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    // An entry logged at 20:00 local on the last day is inside the period.
    const lateEntry = new Date("2026-10-31T13:00:00.000Z");
    expect(lateEntry >= window.start && lateEntry < window.end).toBe(true);
  });

  it("gives the same window for a date key and for that local day's midnight instant", () => {
    expect(participationWindow(new Date("2026-09-30T17:00:00.000Z"), new Date("2026-09-30T17:00:00.000Z"))).toEqual(participationWindow(new Date("2026-10-01"), new Date("2026-10-01")));
  });
});
