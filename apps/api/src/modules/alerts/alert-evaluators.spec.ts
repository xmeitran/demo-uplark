import { describe, expect, it } from "vitest";
import { systemParameterDefaults } from "../../shared/system-parameters";
import {
  addWorkingHours,
  clearStreakDecision,
  CONDITION_ABSENT_ACTION,
  CONDITION_PRESENT_ACTION,
  delayRiskFigures,
  evaluateCustomerWait,
  evaluateDelayRisk,
  evaluateHandoffReview,
  evaluateHoursUsed,
  evaluateMissingOwners,
  evaluateOverCapacity,
  evaluateOverdueTasks,
  evaluatePendingHours,
  evaluatePendingPlanChanges,
  evaluatePlanWithoutLog,
  evaluateStageSla,
  hasClearStreak,
  isRunningProject,
  type ScanClock,
  type ScanStage,
  type ScanTask
} from "./alert-evaluators";

// Wednesday 14 Oct 2026, 10:00 in Vietnam.
const now = new Date("2026-10-14T03:00:00.000Z");
const clock: ScanClock = { now, dayOffKeys: new Set(), params: systemParameterDefaults() };
const vn = (date: string, time = "09:00") => new Date(`${date}T${time}:00.000+07:00`);
const task = (over: Partial<ScanTask> = {}): ScanTask => ({ id: "t1", projectId: "p1", title: "Thiết kế form", status: "in_progress", parentTaskId: null, stageId: "s1", ownerUserId: null, assigneeUserId: "u1", dueAt: null, estimateMinutes: 600, loggedMinutes: 0, ...over });
const stage = (over: Partial<ScanStage> = {}): ScanStage => ({ id: "s1", projectId: "p1", activity: "Build", status: "in_progress", ownerUserId: "pm", milestoneId: "m1", plannedStartAt: null, plannedEndAt: null, ...over });

describe("running projects", () => {
  it("leaves out planning, on-hold, completed and closed projects", () => {
    expect(["in_progress", "at_risk", "pilot", "maintenance"].map(isRunningProject)).toEqual([true, true, true, true]);
    expect(["planning", "on_hold", "completed", "closed", "whatever"].map(isRunningProject)).toEqual([false, false, false, false, false]);
  });
});

describe("NL-03 missing owner", () => {
  it("opens for a running task or stage without owner, with the keys the event-driven trigger uses", () => {
    const wanted = evaluateMissingOwners({ id: "p1", status: "in_progress" }, [task({ assigneeUserId: null }), task({ id: "t2" }), task({ id: "t3", assigneeUserId: null, status: "done" })], [stage({ ownerUserId: null }), stage({ id: "s2" })]);
    expect(wanted.map((item) => item.dedupeKey)).toEqual(["NL-03:task:t1", "NL-03:stage:s1"]);
    expect(wanted[0]).toMatchObject({ typeCode: "NL-03", severity: "high", milestoneId: "m1" });
  });
  it("stays silent while the project is still planning", () => {
    expect(evaluateMissingOwners({ id: "p1", status: "planning" }, [task({ assigneeUserId: null })], [])).toEqual([]);
  });
});

describe("NL-04 plan without log", () => {
  const block = (startAt: Date, over = {}) => ({ taskId: "t1", projectId: "p1", userId: "u1", startAt, plannedMinutes: 120, status: "planned", ...over });
  it("opens once the plan is more than 2 working days old without a log by that person", () => {
    // Planned Fri 9 Oct -> Mon, Tue, Wed = 3 working days.
    const [wanted] = evaluatePlanWithoutLog("p1", [task()], [block(vn("2026-10-09"))], new Map(), clock);
    expect(wanted).toMatchObject({ dedupeKey: "NL-04:task:t1:user:u1", ownerUserId: "u1", taskId: "t1" });
    expect(wanted.dueAt?.toISOString()).toBe("2026-10-13T16:59:59.999Z");
  });
  it("waits while inside the limit, and honours the parameter", () => {
    expect(evaluatePlanWithoutLog("p1", [task()], [block(vn("2026-10-12"))], new Map(), clock)).toEqual([]);
    expect(evaluatePlanWithoutLog("p1", [task()], [block(vn("2026-10-12"))], new Map(), { ...clock, params: { ...clock.params, plannedNoLogWorkingDays: 1 } })).toHaveLength(1);
  });
  it("is not wanted (closes) once hours are logged, the task is closed or the block is no longer planned", () => {
    expect(evaluatePlanWithoutLog("p1", [task()], [block(vn("2026-10-09"))], new Map([["t1:u1", vn("2026-10-09")]]), clock)).toEqual([]);
    expect(evaluatePlanWithoutLog("p1", [task({ status: "done" })], [block(vn("2026-10-09"))], new Map(), clock)).toEqual([]);
    expect(evaluatePlanWithoutLog("p1", [task()], [block(vn("2026-10-09"), { status: "completed" })], new Map(), clock)).toEqual([]);
  });
  it("still warns about a plan made after the last log", () => {
    expect(evaluatePlanWithoutLog("p1", [task()], [block(vn("2026-10-09"))], new Map([["t1:u1", vn("2026-10-01")]]), clock)).toHaveLength(1);
  });
});

describe("NL-05 over capacity", () => {
  const block = (projectId: string, date: string, plannedMinutes: number, userId = "u1") => ({ taskId: "t", projectId, userId, startAt: vn(date), plannedMinutes, status: "planned" });
  it("opens when a person's weekly plan across projects exceeds 5 working days x 8 hours, on the project carrying most of it", () => {
    const wanted = evaluateOverCapacity([block("p1", "2026-10-12", 1000), block("p2", "2026-10-13", 1500), block("p1", "2026-10-15", 1)], new Map([["u1", "Lan"]]), clock);
    expect(wanted).toHaveLength(1);
    expect(wanted[0]).toMatchObject({ dedupeKey: "NL-05:user:u1:week:2026-10-12", projectId: "p2", projectIds: ["p2", "p1"], ownerUserId: "u1" });
    expect(wanted[0].detail).toContain("Lan");
  });
  it("is not wanted at or under the standard hours, and a day off lowers them", () => {
    expect(evaluateOverCapacity([block("p1", "2026-10-12", 2400)], new Map(), clock)).toEqual([]);
    expect(evaluateOverCapacity([block("p1", "2026-10-12", 2400)], new Map(), { ...clock, dayOffKeys: new Set(["2026-10-16"]) })).toHaveLength(1);
  });
  it("ignores other weeks and cancelled blocks", () => {
    expect(evaluateOverCapacity([block("p1", "2026-09-01", 9000), { ...block("p1", "2026-10-12", 9000), status: "cancelled" }], new Map(), clock)).toEqual([]);
  });
});

describe("TD-01 hours used", () => {
  it("opens at 80% of the estimate for a task (sub-tasks folded in) and for its stage", () => {
    const tasks = [task({ estimateMinutes: 600, loggedMinutes: 300 }), task({ id: "t1a", parentTaskId: "t1", estimateMinutes: 0, loggedMinutes: 180 })];
    const wanted = evaluateHoursUsed("p1", tasks, [stage()], clock);
    expect(wanted.map((item) => [item.dedupeKey, item.severity])).toEqual([["TD-01:task:t1", "medium"], ["TD-01:stage:s1", "medium"]]);
    expect(wanted[0].detail).toContain("80%");
  });
  it("is one level up over 100%, and not wanted below the threshold, without an estimate or once closed", () => {
    expect(evaluateHoursUsed("p1", [task({ loggedMinutes: 601 })], [], clock)[0].severity).toBe("high");
    expect(evaluateHoursUsed("p1", [task({ loggedMinutes: 479 })], [stage()], clock)).toEqual([]);
    expect(evaluateHoursUsed("p1", [task({ estimateMinutes: 0, loggedMinutes: 900 })], [stage()], clock)).toEqual([]);
    expect(evaluateHoursUsed("p1", [task({ loggedMinutes: 900, status: "done" })], [stage({ status: "completed" })], clock)).toEqual([]);
  });
  it("closes when a new plan raises the estimate, and follows the parameter", () => {
    expect(evaluateHoursUsed("p1", [task({ estimateMinutes: 1200, loggedMinutes: 500 })], [], clock)).toEqual([]);
    expect(evaluateHoursUsed("p1", [task({ loggedMinutes: 300 })], [], { ...clock, params: { ...clock.params, hoursUsedThresholdPercent: 50 } })).toHaveLength(1);
  });
});

describe("TD-02 overdue", () => {
  it("opens for an open task or sub-task past its due date", () => {
    const wanted = evaluateOverdueTasks("p1", [task({ dueAt: vn("2026-10-12") }), task({ id: "t2", parentTaskId: "t1", dueAt: vn("2026-10-13") })], clock);
    expect(wanted.map((item) => [item.dedupeKey, item.title])).toEqual([["TD-02:task:t1", "Task quá hạn"], ["TD-02:task:t2", "Sub-task quá hạn"]]);
    expect(wanted[0].detail).toContain("quá 2 ngày làm việc");
  });
  it("is not wanted on the due day, once completed, or after the deadline moved", () => {
    expect(evaluateOverdueTasks("p1", [task({ dueAt: vn("2026-10-14", "08:00") }), task({ dueAt: vn("2026-10-12"), status: "completed" }), task({ dueAt: vn("2026-10-20") }), task()], clock)).toEqual([]);
  });
});

describe("TD-03 risk of delay", () => {
  // Mon 5 Oct -> Fri 16 Oct = 10 working days; today is the 8th of them -> 80% of the time.
  const running = stage({ plannedStartAt: vn("2026-10-05"), plannedEndAt: vn("2026-10-16", "18:00") });
  const leaves = (done: number, logged = 0) => [
    task({ id: "a", estimateMinutes: done, status: "done", loggedMinutes: logged }),
    task({ id: "b", estimateMinutes: 1000 - done, status: "in_progress" })
  ];
  it("measures done volume by the estimate of completed sub-tasks, not by logged hours", () => {
    expect(delayRiskFigures(running, leaves(500, 5000), clock)).toMatchObject({ donePercent: 50, timePercent: 80, usedPercent: 500 });
  });
  it("(B) opens when done volume trails the time pace by more than 10 points", () => {
    const [wanted] = evaluateDelayRisk("p1", leaves(600), [running], clock);
    expect(wanted).toMatchObject({ dedupeKey: "TD-03:stage:s1", severity: "medium" });
    expect(wanted.detail).toContain("(B)");
    expect(evaluateDelayRisk("p1", leaves(700), [running], clock)).toEqual([]); // exactly 10 points behind: allowed
  });
  it("(A) is (B) with 80% of the estimated hours already used", () => {
    const [wanted] = evaluateDelayRisk("p1", leaves(600, 800), [running], clock);
    expect(wanted.severity).toBe("high");
    expect(wanted.detail).toContain("(A)");
  });
  it("(C) opens when the remaining volume exceeds the remaining capacity of the people still assigned", () => {
    // 3 working days left x 8h x 1 person = 24h capacity; 30h remain although the pace looks fine.
    const tasks = [task({ id: "a", estimateMinutes: 7200, status: "done" }), task({ id: "b", estimateMinutes: 1800 })];
    const [wanted] = evaluateDelayRisk("p1", tasks, [running], clock);
    expect(wanted.detail).toContain("(C)");
    expect(wanted.detail).not.toContain("(B)");
    expect(evaluateDelayRisk("p1", [tasks[0], task({ id: "b", estimateMinutes: 1440 })], [running], clock)).toEqual([]);
  });
  it("has no basis without planned dates or estimates, before the stage starts, or for a closed stage", () => {
    expect(delayRiskFigures(stage(), leaves(100), clock)).toBeNull();
    expect(delayRiskFigures(running, [task({ estimateMinutes: 0 })], clock)).toBeNull();
    expect(delayRiskFigures(stage({ plannedStartAt: vn("2026-10-20"), plannedEndAt: vn("2026-10-30") }), leaves(0), clock)).toBeNull();
    expect(evaluateDelayRisk("p1", leaves(0), [{ ...running, status: "completed" }], clock)).toEqual([]);
  });
  it("closes only after two consecutive clear working days", () => {
    const at = (date: string) => vn(date, "07:30");
    const opened = { action: "opened", at: at("2026-10-09") };
    expect(clearStreakDecision([opened], clock)).toBe("mark");
    expect(clearStreakDecision([opened, { action: CONDITION_ABSENT_ACTION, at: at("2026-10-14") }], clock)).toBe("wait"); // already marked today
    expect(clearStreakDecision([opened, { action: CONDITION_ABSENT_ACTION, at: at("2026-10-13") }], clock)).toBe("close");
    // The condition came back in between: the streak starts over.
    expect(clearStreakDecision([opened, { action: CONDITION_ABSENT_ACTION, at: at("2026-10-12") }, { action: CONDITION_PRESENT_ACTION, at: at("2026-10-13") }], clock)).toBe("mark");
    expect(clearStreakDecision([opened, { action: CONDITION_ABSENT_ACTION, at: at("2026-10-09") }], { now: vn("2026-10-10"), dayOffKeys: new Set() })).toBe("wait"); // Saturday
    expect(hasClearStreak([opened, { action: CONDITION_ABSENT_ACTION, at: now }, { action: "notified", at: now }])).toBe(true);
    expect(hasClearStreak([opened, { action: CONDITION_ABSENT_ACTION, at: now }, { action: "refreshed", at: now }])).toBe(false);
  });
});

describe("TD-06 unapproved plan change", () => {
  it("opens one warning per pending request, owned by the PM", () => {
    const [wanted] = evaluatePendingPlanChanges([{ id: "r1", projectId: "p1", taskId: "t1", taskTitle: "Build", stageId: "s1", createdAt: now, reason: "Khách đổi phạm vi" }], new Map([["p1", "pm"]]));
    expect(wanted).toMatchObject({ dedupeKey: "TD-06:request:r1", typeCode: "TD-06", ownerUserId: "pm", taskId: "t1" });
    expect(evaluatePendingPlanChanges([], new Map())).toEqual([]); // approved or rejected: no longer pending
  });
});

describe("BRI-04 handoff review", () => {
  const handoff = (requestedAt: Date) => ({ milestoneId: "m1", projectId: "p1", milestoneName: "Milestone 2", requestedAt, reviewerUserId: "dx" });
  it("counts 24 working hours: a file sent on Friday 15:00 is due Monday 15:00", () => {
    expect(addWorkingHours(vn("2026-10-09", "15:00"), 24).toISOString()).toBe(vn("2026-10-12", "15:00").toISOString());
    expect(addWorkingHours(vn("2026-10-12", "15:00"), 24, new Set(["2026-10-13"])).toISOString()).toBe(vn("2026-10-14", "15:00").toISOString());
  });
  it("opens after the deadline and is not wanted before it", () => {
    const [wanted] = evaluateHandoffReview([handoff(vn("2026-10-12", "09:00"))], clock);
    expect(wanted).toMatchObject({ dedupeKey: "BRI-04:milestone:m1", severity: "high", ownerUserId: "dx", milestoneId: "m1" });
    expect(evaluateHandoffReview([handoff(vn("2026-10-13", "11:00"))], clock)).toEqual([]);
  });
});

describe("DL-01 pending hours", () => {
  it("opens one warning per project for hours pending longer than 10 working days", () => {
    const entries = [
      { projectId: "p1", minutes: 60, loggedAt: vn("2026-09-28") }, // deadline 12 Oct: overdue
      { projectId: "p1", minutes: 90, loggedAt: vn("2026-09-25") }, // deadline 9 Oct: overdue
      { projectId: "p1", minutes: 30, loggedAt: vn("2026-10-05") }, // not yet
      { projectId: "p2", minutes: 30, loggedAt: vn("2026-10-01") } // deadline 15 Oct: not yet
    ];
    const wanted = evaluatePendingHours(entries, new Map([["p1", "pm"]]), clock);
    expect(wanted).toHaveLength(1);
    expect(wanted[0]).toMatchObject({ projectId: "p1", dedupeKey: "DL-01:pending-hours", ownerUserId: "pm" });
    expect(wanted[0].detail).toContain("2 giờ log (2.5 giờ)");
    expect(wanted[0].dueAt?.toISOString()).toBe("2026-10-09T16:59:59.999Z");
    expect(evaluatePendingHours(entries.slice(2), new Map(), clock)).toEqual([]); // handled: closes
  });
});

describe("TD-04, TD-05, BRI-05 (stage SLA, stage extensions, customer step of the gates)", () => {
  it("TD-04 stage over SLA, not counting customer wait", () => {
    const base = { stageId: "s1", projectId: "p1", activity: "Build", milestoneId: "m1", startedAt: vn("2026-10-05"), slaWorkingDays: 5, ownerUserId: "pm" };
    expect(evaluateStageSla([{ ...base, customerWaitWorkingDays: 0 }], clock)).toHaveLength(1); // 7 working days used
    expect(evaluateStageSla([{ ...base, customerWaitWorkingDays: 2 }], clock)).toEqual([]);
    // "Kết thúc khi: gia hạn được duyệt" — while the extended due date is ahead; once it passes the stage is late again.
    expect(evaluateStageSla([{ ...base, customerWaitWorkingDays: 0, extendedDueAt: new Date(clock.now.getTime() + 86_400_000) }], clock)).toEqual([]);
    expect(evaluateStageSla([{ ...base, customerWaitWorkingDays: 0, extendedDueAt: new Date(clock.now.getTime() - 86_400_000) }], clock)).toHaveLength(1);
  });
  it("BRI-05 customer late: 3 working days, 1 at G4, and nobody internal is blamed", () => {
    const wait = (gate: string, sentAt: Date) => ({ milestoneId: gate, projectId: "p1", gate, milestoneName: gate, sentAt });
    const wanted = evaluateCustomerWait([wait("G4", vn("2026-10-12")), wait("G2", vn("2026-10-12")), wait("G1", vn("2026-10-08"))], clock);
    expect(wanted.map((item) => item.dedupeKey)).toEqual(["BRI-05:milestone:G4", "BRI-05:milestone:G1"]);
    expect(wanted[0].ownerUserId).toBeNull();
    expect(wanted[0].detail).toContain("Nguyên nhân từ khách");
  });
});
