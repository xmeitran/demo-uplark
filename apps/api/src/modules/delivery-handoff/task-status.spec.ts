import { describe, expect, it } from "vitest";
import { isCancelledTaskStatus, isClosedTaskStatus, isCompletedTaskStatus } from "./task-status";

describe("task status semantics", () => {
  it.each(["done", "completed", "closed"])("treats %s as a completed status", (status) => {
    expect(isCompletedTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "blocked", "cancelled", ""])("does not treat %s as completed", (status) => {
    expect(isCompletedTaskStatus(status)).toBe(false);
  });

  it.each(["done", "completed", "closed", "cancelled", "canceled"])("treats %s as closed for gate evaluation", (status) => {
    expect(isClosedTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "blocked", ""])("does not treat %s as closed", (status) => {
    expect(isClosedTaskStatus(status)).toBe(false);
  });

  it.each(["cancelled", "canceled"])("treats %s as cancelled", (status) => {
    expect(isCancelledTaskStatus(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "done", "completed"])("does not treat %s as cancelled", (status) => {
    expect(isCancelledTaskStatus(status)).toBe(false);
  });
});
