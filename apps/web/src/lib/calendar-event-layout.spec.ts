import { describe, expect, it } from "vitest";

import {
  computeCalendarOverlapLayout,
  getCalendarCardDensity,
  getCalendarEventGeometry,
  splitDateRangeIntoChunks,
  vietnamMinuteOfDay
} from "./calendar-event-layout";

describe("calendar event layout", () => {
  it("computes Vietnam wall-clock geometry independently of the browser time zone", () => {
    expect(vietnamMinuteOfDay("2026-07-14T02:30:00.000Z")).toBe(9 * 60 + 30);

    expect(getCalendarEventGeometry({
      id: "one-hour",
      startAt: "2026-07-14T02:00:00.000Z",
      endAt: "2026-07-14T03:00:00.000Z"
    }, {
      startHour: 0,
      endHour: 24,
      hourRowHeight: 44
    })).toEqual({ top: 9 * 44, height: 42 });

    const overnight = getCalendarEventGeometry({
      id: "overnight",
      startAt: "2026-07-14T16:30:00.000Z",
      endAt: "2026-07-14T17:30:00.000Z"
    }, {
      startHour: 0,
      endHour: 24,
      hourRowHeight: 44
    });
    expect(overnight).toEqual({ top: 23.5 * 44, height: 22 });
    expect(Number.isFinite(overnight.top)).toBe(true);
    expect(Number.isFinite(overnight.height)).toBe(true);
  });

  it("assigns overlapping events to separate lanes and reuses lanes after an event ends", () => {
    const layout = computeCalendarOverlapLayout([
      { id: "a", startAt: "2026-07-14T02:00:00.000Z", endAt: "2026-07-14T03:30:00.000Z" },
      { id: "b", startAt: "2026-07-14T02:15:00.000Z", endAt: "2026-07-14T03:00:00.000Z" },
      { id: "c", startAt: "2026-07-14T02:30:00.000Z", endAt: "2026-07-14T04:00:00.000Z" },
      { id: "d", startAt: "2026-07-14T03:30:00.000Z", endAt: "2026-07-14T04:30:00.000Z" }
    ]);

    expect(layout.get("a")).toEqual({ colIndex: 0, totalCols: 3 });
    expect(layout.get("b")).toEqual({ colIndex: 1, totalCols: 3 });
    expect(layout.get("c")).toEqual({ colIndex: 2, totalCols: 3 });
    expect(layout.get("d")).toEqual({ colIndex: 0, totalCols: 3 });
  });

  it("selects card density from both rendered height and overlap pressure", () => {
    expect(getCalendarCardDensity(63, 1)).toBe("micro");
    expect(getCalendarCardDensity(120, 3)).toBe("micro");
    expect(getCalendarCardDensity(80, 1)).toBe("compact");
    expect(getCalendarCardDensity(120, 2)).toBe("compact");
    expect(getCalendarCardDensity(96, 1)).toBe("full");
  });

  it("splits long ranges into contiguous chunks no longer than 90 days", () => {
    const startAt = "2026-01-01T00:00:00.000Z";
    const endAt = "2026-07-15T00:00:00.000Z";
    const chunks = splitDateRangeIntoChunks(startAt, endAt, 89);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].startAt).toBe(startAt);
    expect(chunks.at(-1)?.endAt).toBe(endAt);

    for (const [index, chunk] of chunks.entries()) {
      const durationDays = (Date.parse(chunk.endAt) - Date.parse(chunk.startAt)) / 86_400_000;
      expect(durationDays).toBeGreaterThan(0);
      expect(durationDays).toBeLessThanOrEqual(90);
      if (index > 0) expect(chunk.startAt).toBe(chunks[index - 1].endAt);
    }
  });
});
