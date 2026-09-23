import { describe, expect, it } from "vitest";
import { buildCreateTaskTimeEntryInput, resolveTaskTimeEntryUserId } from "./task-time-entry-input";

describe("task time entry input", () => {
  it("uses the selected performer user id instead of the route principal", () => {
    const body = buildCreateTaskTimeEntryInput({
      userId: "usr-lark-kha",
      workDate: "2026-07-06",
      startAt: "2026-07-06T02:00:00.000Z",
      endAt: "2026-07-06T03:00:00.000Z",
      timeZone: "Asia/Ho_Chi_Minh",
      minutes: 60,
      billable: true,
      workType: "delivery",
      note: "Implementation work"
    }, "founder");

    expect(body).toMatchObject({
      userId: "usr-lark-kha",
      workDate: "2026-07-06",
      startAt: "2026-07-06T02:00:00.000Z",
      endAt: "2026-07-06T03:00:00.000Z",
      timeZone: "Asia/Ho_Chi_Minh",
      minutes: 60
    });
  });

  it("falls back to the principal default only when no performer is selected", () => {
    expect(resolveTaskTimeEntryUserId({}, "founder")).toBe("usr-kha-founder");
    expect(resolveTaskTimeEntryUserId({}, "delivery")).toBe("usr-deliverer");
  });
});
