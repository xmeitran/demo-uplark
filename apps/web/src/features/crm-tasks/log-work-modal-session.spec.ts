import { describe, expect, it } from "vitest";
import { shouldResetLogWorkModal } from "./log-work-modal-session";

describe("shouldResetLogWorkModal", () => {
  it("resets when a modal session opens", () => {
    expect(shouldResetLogWorkModal(
      { isOpen: false, taskId: "task-1" },
      { isOpen: true, taskId: "task-1" }
    )).toBe(true);
  });

  it("does not reset while the same task modal remains open", () => {
    expect(shouldResetLogWorkModal(
      { isOpen: true, taskId: "task-1" },
      { isOpen: true, taskId: "task-1" }
    )).toBe(false);
  });

  it("resets when the open modal switches to another task", () => {
    expect(shouldResetLogWorkModal(
      { isOpen: true, taskId: "task-1" },
      { isOpen: true, taskId: "task-2" }
    )).toBe(true);
  });

  it("does not reset merely because a closed task selection changes", () => {
    expect(shouldResetLogWorkModal(
      { isOpen: false, taskId: "task-1" },
      { isOpen: false, taskId: "task-2" }
    )).toBe(false);
  });
});
