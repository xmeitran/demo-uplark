import { expect, it } from "vitest";
import { defaultWorkLogDate } from "./work-log-date";
it("prefers a valid selected day, then task date, then Vietnam today", () => {
  const now = new Date("2026-09-06T18:00:00Z");
  expect(defaultWorkLogDate("2026-07-12", "2026-07-01", now)).toBe("2026-07-12");
  expect(defaultWorkLogDate("2026-02-31", "2026-07-01", now)).toBe("2026-07-01");
  expect(defaultWorkLogDate(undefined, "invalid", now)).toBe("2026-09-07");
});
