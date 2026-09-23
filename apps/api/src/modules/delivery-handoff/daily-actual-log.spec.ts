import { describe, expect, it } from "vitest";
import {
  buildDailyActualLogStatus,
  getDailyActualLogWindow
} from "./daily-actual-log";

describe("getDailyActualLogWindow", () => {
  it("keeps the instant before Vietnam midnight in the prior local day", () => {
    const window = getDailyActualLogWindow(new Date("2026-07-01T16:59:59.999Z"));

    expect(window).toEqual({
      localDate: "2026-07-01",
      startAt: new Date("2026-06-30T17:00:00.000Z"),
      endAt: new Date("2026-07-01T17:00:00.000Z")
    });
  });

  it("starts a new local day at Vietnam midnight", () => {
    const window = getDailyActualLogWindow(new Date("2026-07-01T17:00:00.000Z"));

    expect(window).toEqual({
      localDate: "2026-07-02",
      startAt: new Date("2026-07-01T17:00:00.000Z"),
      endAt: new Date("2026-07-02T17:00:00.000Z")
    });
  });
});

describe("buildDailyActualLogStatus", () => {
  it.each([
    [479, "below_target"],
    [480, "target_met"],
    [481, "over_target"]
  ] as const)("classifies %i minutes as %s", (totalMinutes, state) => {
    expect(buildDailyActualLogStatus("2026-07-02", totalMinutes)).toEqual({
      localDate: "2026-07-02",
      timeZone: "Asia/Ho_Chi_Minh",
      totalMinutes,
      targetMinutes: 480,
      state
    });
  });
});
