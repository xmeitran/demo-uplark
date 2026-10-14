import { describe, expect, it } from "vitest";
import { projectValueActionLabel, projectValueSubmitDisabled } from "./pnl-project-edit-logic";

describe("project revenue editor", () => {
  it("labels the inline action according to whether the project already has revenue", () => {
    expect(projectValueActionLabel(null)).toBe("Nhập doanh thu");
    expect(projectValueActionLabel(67_200_000)).toBe("Sửa doanh thu");
  });

  it("requires a positive changed amount and a reason when the API requires one", () => {
    expect(projectValueSubmitDisabled(null, null, false, "")).toBe(true);
    expect(projectValueSubmitDisabled(67_200_000, 67_200_000, false, "")).toBe(true);
    expect(projectValueSubmitDisabled(67_200_000, null, true, "")).toBe(true);
    expect(projectValueSubmitDisabled(67_200_000, 60_000_000, true, "Phụ lục 02")).toBe(false);
  });
});
