import { describe, expect, it } from "vitest";
import { getDailyActualLogFeedback } from "./daily-actual-log-feedback";

describe("daily actual-log feedback", () => {
  it("keeps the normal success flow below the daily target", () => {
    expect(getDailyActualLogFeedback({
      localDate: "2026-07-29",
      timeZone: "Asia/Ho_Chi_Minh",
      totalMinutes: 479,
      targetMinutes: 480,
      state: "below_target"
    }, "Nguyễn Văn A")).toBeNull();
  });

  it("announces the exact eight-hour target with an informational tone", () => {
    expect(getDailyActualLogFeedback({
      localDate: "2026-07-29",
      timeZone: "Asia/Ho_Chi_Minh",
      totalMinutes: 480,
      targetMinutes: 480,
      state: "target_met"
    }, "Nguyễn Văn A")).toEqual({
      heading: "Đã ghi nhận đủ 8 giờ",
      message: "Nguyễn Văn A đã ghi nhận đủ 8 giờ trong ngày 29/07/2026.",
      tone: "info"
    });
  });

  it("shows the exact total and overage as a non-destructive warning", () => {
    expect(getDailyActualLogFeedback({
      localDate: "2026-07-29",
      timeZone: "Asia/Ho_Chi_Minh",
      totalMinutes: 525,
      targetMinutes: 480,
      state: "over_target"
    }, "Nguyễn Văn A")).toEqual({
      heading: "Đã vượt mốc 8 giờ/ngày",
      message: "Nguyễn Văn A đã ghi nhận 8 giờ 45 phút trong ngày 29/07/2026, vượt 45 phút so với mốc 8 giờ.",
      tone: "warning"
    });
  });

  it("uses a safe label when the canonical response has no display name", () => {
    expect(getDailyActualLogFeedback({
      localDate: "invalid-date-key",
      timeZone: "Asia/Ho_Chi_Minh",
      totalMinutes: 481,
      targetMinutes: 480,
      state: "over_target"
    })?.message).toBe(
      "Người dùng đã ghi nhận 8 giờ 1 phút trong ngày invalid-date-key, vượt 1 phút so với mốc 8 giờ."
    );
  });
});
