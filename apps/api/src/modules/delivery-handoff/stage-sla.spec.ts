import { describe, expect, it } from "vitest";
import { localDateKey } from "../../shared/working-days";
import { customerWaitWorkingDays, stageSlaState } from "./stage-sla";

// 2026-10-08 is a Thursday.
const thursday = new Date("2026-10-08T02:00:00.000Z");
const at = (day: string) => new Date(`${day}T03:00:00.000Z`);

describe("stage SLA in working days (8.1, V-19)", () => {
  it("suggests the due date in working days, skipping the weekend and days off", () => {
    expect(localDateKey(stageSlaState({ slaDays: 3, startedAt: thursday }, at("2026-10-08")).dueAt as Date)).toBe("2026-10-13");
    expect(localDateKey(stageSlaState({ slaDays: 3, startedAt: thursday }, at("2026-10-08"), new Set(["2026-10-12"])).dueAt as Date)).toBe("2026-10-14");
  });

  it("has no due date without an SLA or a start", () => {
    expect(stageSlaState({ slaDays: null, startedAt: thursday }, at("2026-10-20"))).toEqual({ slaDays: null, paused: false, customerWaitDays: 0, overrun: false, overrunDays: 0 });
    expect(stageSlaState({ slaDays: 3 }, at("2026-10-20"))).toEqual({ slaDays: 3, paused: false, customerWaitDays: 0, overrun: false, overrunDays: 0 });
  });

  it("flags an overrun and counts it in working days", () => {
    expect(stageSlaState({ slaDays: 3, startedAt: thursday }, at("2026-10-13"))).toMatchObject({ overrun: false, overrunDays: 0 });
    expect(stageSlaState({ slaDays: 3, startedAt: thursday }, at("2026-10-15"))).toMatchObject({ overrun: true, overrunDays: 2 });
    // A stage that finished late stays late; one that finished in time is not late afterwards.
    expect(stageSlaState({ slaDays: 3, startedAt: thursday, finishedAt: at("2026-10-14") }, at("2026-11-01"))).toMatchObject({ overrun: true, overrunDays: 1 });
    expect(stageSlaState({ slaDays: 3, startedAt: thursday, finishedAt: at("2026-10-12") }, at("2026-11-01"))).toMatchObject({ overrun: false });
  });

  it("stops the clock while waiting for the customer: the wait moves the due date and is never delay", () => {
    const paused = stageSlaState({ slaDays: 3, startedAt: thursday, pausedAt: at("2026-10-12") }, at("2026-10-20"));
    expect(paused).toMatchObject({ paused: true, overrun: false, overrunDays: 0, customerWaitDays: 6 });
    expect(localDateKey(paused.dueAt as Date)).toBe("2026-10-21");
  });

  it("keeps an overrun that already existed when the clock stopped", () => {
    expect(stageSlaState({ slaDays: 3, startedAt: thursday, pausedAt: at("2026-10-15") }, at("2026-10-20"))).toMatchObject({ paused: true, overrun: true, overrunDays: 2 });
  });

  it("counts the finished wait separately and resumes the clock from where it stopped", () => {
    expect(customerWaitWorkingDays(at("2026-10-12"), at("2026-10-15"))).toBe(3);
    expect(customerWaitWorkingDays(null, at("2026-10-15"))).toBe(0);
    const resumed = stageSlaState({ slaDays: 3, startedAt: thursday, customerWaitDays: 3 }, at("2026-10-16"));
    expect(resumed).toMatchObject({ paused: false, customerWaitDays: 3, overrun: false });
    expect(localDateKey(resumed.dueAt as Date)).toBe("2026-10-16");
    expect(stageSlaState({ slaDays: 3, startedAt: thursday, customerWaitDays: 3 }, at("2026-10-19"))).toMatchObject({ overrun: true, overrunDays: 1 });
  });
});
