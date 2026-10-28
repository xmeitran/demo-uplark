import { describe, expect, it } from "vitest";
import { evaluateMilestoneGate } from "./milestone-gate";

describe("milestone gate evaluation", () => {
  it("reports every missing requirement instead of only a generic blocked state", () => {
    const result = evaluateMilestoneGate({
      requiredDocumentCount: 2,
      submittedDocumentCount: 1,
      customerConfirmationRequired: true,
      taskStatuses: ["done", "todo", "cancelled"]
    });

    expect(result).toMatchObject({
      documentsSatisfied: false,
      confirmationSatisfied: false,
      tasksSatisfied: false,
      taskCount: 3,
      completedTaskCount: 2,
      remainingTaskCount: 1,
      satisfied: false
    });
    expect(result.missingRequirements).toEqual([
      "Còn 1 hồ sơ bắt buộc.",
      "Chưa có xác nhận khách hàng.",
      "Còn 1 task chưa hoàn tất."
    ]);
  });

  it("is satisfied when all configured requirements pass", () => {
    expect(evaluateMilestoneGate({
      requiredDocumentCount: 1,
      submittedDocumentCount: 1,
      customerConfirmationRequired: true,
      customerConfirmationAt: new Date(),
      taskStatuses: ["done", "completed", "cancelled"]
    })).toMatchObject({
      tasksSatisfied: true,
      completedTaskCount: 3,
      remainingTaskCount: 0,
      missingRequirements: [],
      satisfied: true
    });
  });

  it("\"Không duyệt\": only the tasks count, and a milestone without tasks is not done", () => {
    const facts = { requiredDocumentCount: 2, submittedDocumentCount: 0, customerConfirmationRequired: true, approvalRequired: false };
    expect(evaluateMilestoneGate({ ...facts, taskStatuses: ["done", "cancelled"] })).toMatchObject({ documentsSatisfied: true, confirmationSatisfied: true, missingRequirements: [], satisfied: true });
    expect(evaluateMilestoneGate({ ...facts, taskStatuses: ["done", "todo"] }).missingRequirements).toEqual(["Còn 1 task chưa hoàn tất."]);
    expect(evaluateMilestoneGate({ ...facts, taskStatuses: [] })).toMatchObject({ missingRequirements: ["Milestone chưa có task."], satisfied: false });
  });
});
