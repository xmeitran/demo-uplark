import { describe, expect, it } from "vitest";
import { portalMenuStyle } from "./crm-select-position";

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
