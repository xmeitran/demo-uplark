import { describe, expect, it } from "vitest";
import { normalizeProjectStatus, projectStatusLabel, resolveProjectStatus } from "./project-status";

// Same cases as apps/api/src/modules/delivery-handoff/project-status.spec.ts.
describe("project status catalogue (web mirror of the API)", () => {
  it("maps legacy aliases onto the six canonical codes", () => {
    expect(normalizeProjectStatus("in_progress")).toBe("active");
    expect(normalizeProjectStatus("On Hold")).toBe("on_hold");
    expect(normalizeProjectStatus("paused")).toBe("on_hold");
    expect(normalizeProjectStatus("acceptance")).toBe("in_review");
    expect(normalizeProjectStatus("done")).toBe("completed");
    expect(normalizeProjectStatus("discovery")).toBe("active");
    expect(normalizeProjectStatus("cancelled")).toBe("at_risk");
    expect(normalizeProjectStatus("pilot")).toBeNull();
  });

  it("prefers the API statusCode over the raw status", () => {
    expect(resolveProjectStatus({ statusCode: "on_hold", status: "in_progress" })).toBe("on_hold");
    expect(resolveProjectStatus({ status: "onboarding" })).toBe("active");
  });

  it("never defaults an unknown or missing status to Active", () => {
    expect(resolveProjectStatus({ status: "pilot" })).toBeNull();
    expect(resolveProjectStatus({})).toBeNull();
    expect(projectStatusLabel(null)).toBe("Chưa xác định");
    expect(projectStatusLabel("in_review")).toBe("In Review");
  });
});
