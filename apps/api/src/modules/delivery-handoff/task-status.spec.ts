import { describe, expect, it } from "vitest";
import { isCompletedTaskStatus } from "./task-status";

describe("task status semantics", () => {
  it.each(["done", "completed", "closed"])("treats %s as a completed status", (status) => {
    expect(isCompletedTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "blocked", "cancelled", ""])("does not treat %s as completed", (status) => {
    expect(isCompletedTaskStatus(status)).toBe(false);
  });
});
