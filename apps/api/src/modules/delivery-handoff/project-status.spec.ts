import { describe, expect, it } from "vitest";
import { isKnownProjectStatus, normalizeProjectStatus, projectStatusFilterValues, validateProjectStatusChange } from "./project-status";

describe("project status catalogue", () => {
  it("maps legacy aliases onto the six canonical codes", () => {
    expect(normalizeProjectStatus("in_progress")).toBe("active");
    expect(normalizeProjectStatus("On Hold")).toBe("on_hold");
    expect(normalizeProjectStatus("paused")).toBe("on_hold");
    expect(normalizeProjectStatus("acceptance")).toBe("in_review");
    expect(normalizeProjectStatus("done")).toBe("completed");
    expect(normalizeProjectStatus("pilot")).toBeNull();
  });

  it("keeps the legacy list filters working", () => {
    expect(projectStatusFilterValues("active")).toEqual(["in_progress", "active", "onboarding", "discovery"]);
    expect(projectStatusFilterValues("paused")).toEqual(["on_hold", "paused", "pause"]);
    expect(projectStatusFilterValues("Something Else")).toEqual(["something_else"]);
    expect(projectStatusFilterValues(null)).toBeNull();
  });
});

describe("validateProjectStatusChange", () => {
  it("requires a reason for On Hold and an action/blocker for At Risk", () => {
    expect(validateProjectStatusChange("in_progress", "on_hold", "  ").error).toContain("On Hold");
    expect(validateProjectStatusChange("in_progress", "at_risk", undefined).error).toContain("At Risk");
    expect(validateProjectStatusChange("in_progress", "on_hold", "Chờ khách hàng")).toEqual({ changed: true, from: "active", to: "on_hold" });
  });

  it("needs no reason when the status is unchanged or for other targets", () => {
    expect(validateProjectStatusChange("paused", "on_hold", "")).toEqual({ changed: false, from: "on_hold", to: "on_hold" });
    expect(validateProjectStatusChange("planning", "active", "")).toEqual({ changed: true, from: "planning", to: "active" });
  });

  it("accepts catalogue codes and legacy aliases on write and nothing else", () => {
    expect(["planning", "active", "in_review", "on_hold", "at_risk", "completed", "in_progress", "Paused", "done"].every(isKnownProjectStatus)).toBe(true);
    expect(["pilot", "", "archived", undefined, "hold on"].some(isKnownProjectStatus)).toBe(false);
  });

  it("applies the reason rule to a project created directly in On Hold or At Risk", () => {
    expect(validateProjectStatusChange(undefined, "on_hold", undefined).error).toBeTruthy();
    expect(validateProjectStatusChange(undefined, "at_risk", "Blocked by vendor").error).toBeUndefined();
    expect(validateProjectStatusChange(undefined, "planning", undefined)).toMatchObject({ changed: true, to: "planning" });
  });
});
