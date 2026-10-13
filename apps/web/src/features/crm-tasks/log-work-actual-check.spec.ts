import { describe, expect, it } from "vitest";
import { LOG_WORK_SLOT_ERROR, logWorkActualCheck } from "./log-work-actual-check";

const fmt = (minutes: number) => `${minutes}p`;

describe("logWorkActualCheck", () => {
  it("does not refuse a task without planned hours; it only says so", () => {
    const result = logWorkActualCheck({ plannedMinutes: 0, loggedMinutes: 0, requestedMinutes: 60 }, fmt);
    expect(result.error).toBeNull();
    expect(result.warning).toContain("Giờ vẫn được ghi nhận");
  });

  it("does not refuse hours beyond the plan (D-19); it warns with the overrun", () => {
    const result = logWorkActualCheck({ plannedMinutes: 480, loggedMinutes: 450, requestedMinutes: 60 }, fmt);
    expect(result.error).toBeNull();
    expect(result.warning).toBe("Vượt giờ kế hoạch 30p (kế hoạch 480p, đã ghi 450p). Giờ vẫn được ghi nhận và phần vượt được báo cho PM.");
  });

  it("is silent while the hours fit the plan", () => {
    expect(logWorkActualCheck({ plannedMinutes: 480, loggedMinutes: 60, requestedMinutes: 60, slot: { startMinutes: 540, endMinutes: 600 } }, fmt)).toEqual({ error: null, warning: null });
  });

  it("still refuses a slot outside 07:00–19:00 or that ends before it starts", () => {
    for (const slot of [{ startMinutes: 360, endMinutes: 420 }, { startMinutes: 1110, endMinutes: 1170 }, { startMinutes: 600, endMinutes: 540 }, { startMinutes: null, endMinutes: 600 }]) {
      expect(logWorkActualCheck({ plannedMinutes: 480, loggedMinutes: 0, requestedMinutes: 60, slot }, fmt).error).toBe(LOG_WORK_SLOT_ERROR);
    }
  });
});
