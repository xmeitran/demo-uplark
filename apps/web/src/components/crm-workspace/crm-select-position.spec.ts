import { describe, expect, it } from "vitest";
import { portalMenuStyle, portalPopoverStyle } from "./crm-select-position";

describe("portalMenuStyle", () => {
  const rect = (top: number) => ({ top, bottom: top + 40, left: 100, width: 300 });

  it("opens under the trigger when there is room", () => {
    expect(portalMenuStyle(rect(100), 800)).toMatchObject({ position: "fixed", left: 100, width: 300, top: 146, bottom: "auto" });
  });

  it("flips above the trigger near the bottom of the viewport", () => {
    expect(portalMenuStyle(rect(700), 800)).toMatchObject({ top: "auto", bottom: 106 });
  });

  it("honours a preferred upward direction unless only the space below fits", () => {
    expect(portalMenuStyle(rect(400), 800, "up")).toMatchObject({ top: "auto", bottom: 406 });
    expect(portalMenuStyle(rect(20), 800, "up")).toMatchObject({ top: 66, bottom: "auto" });
  });
});

describe("portalPopoverStyle", () => {
  const size = { width: 300, height: 400 };
  const viewport = { width: 1000, height: 800 };

  it("opens under the trigger when it fits", () => {
    expect(portalPopoverStyle({ top: 100, bottom: 140, left: 50 }, size, viewport)).toMatchObject({ position: "fixed", left: 50, top: 146 });
  });

  it("flips above near the bottom and shifts left near the right edge", () => {
    expect(portalPopoverStyle({ top: 700, bottom: 740, left: 900 }, size, viewport)).toMatchObject({ left: 692, top: 294 });
  });

  it("stays inside a viewport too small for either side", () => {
    expect(portalPopoverStyle({ top: 200, bottom: 240, left: -20 }, size, { width: 320, height: 500 })).toMatchObject({ left: 8, top: 92 });
  });
});
