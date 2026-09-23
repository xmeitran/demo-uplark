import { describe, expect, it } from "vitest";

import { toVietnamDateInputValue, toVietnamDateKey, vietnamDayStartIso } from "./vietnam-time";

describe("vietnam-time", () => {
  it("formats UTC instants as the Vietnam calendar date for task date inputs", () => {
    expect(toVietnamDateInputValue("2026-05-13T17:00:00.000Z")).toBe("2026-05-14");
    expect(toVietnamDateKey("2026-05-13T17:00:00.000Z")).toBe("2026-05-14");
  });

  it("keeps plain date keys stable when building Vietnam day boundaries", () => {
    expect(vietnamDayStartIso("2026-05-14")).toBe("2026-05-13T17:00:00.000Z");
  });
});
