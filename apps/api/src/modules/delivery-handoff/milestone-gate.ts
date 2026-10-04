import { isClosedTaskStatus } from "./task-status";

export type MilestoneGateFacts = {
  requiredDocumentCount: number;
  submittedDocumentCount: number;
  customerConfirmationRequired: boolean;
  customerConfirmationAt?: Date | string | null;
  taskStatuses: readonly unknown[];
};

export type MilestoneGateEvaluation = {
  documentsSatisfied: boolean;
  confirmationSatisfied: boolean;
  tasksSatisfied: boolean;
  taskCount: number;
  completedTaskCount: number;
  remainingTaskCount: number;
  missingRequirements: string[];
  satisfied: boolean;
};

export function evaluateMilestoneGate(facts: MilestoneGateFacts): MilestoneGateEvaluation {
  const requiredDocumentCount = Math.max(0, Number(facts.requiredDocumentCount) || 0);
  const submittedDocumentCount = Math.max(0, Number(facts.submittedDocumentCount) || 0);
  const taskCount = facts.taskStatuses.length;
  const completedTaskCount = facts.taskStatuses.filter(isClosedTaskStatus).length;
  const remainingTaskCount = Math.max(0, taskCount - completedTaskCount);
  const documentsSatisfied = submittedDocumentCount >= requiredDocumentCount;
  const confirmationSatisfied = !facts.customerConfirmationRequired || Boolean(facts.customerConfirmationAt);
  const tasksSatisfied = remainingTaskCount === 0;
  const missingRequirements: string[] = [];

  if (!documentsSatisfied) {
    missingRequirements.push(`Còn ${requiredDocumentCount - submittedDocumentCount} hồ sơ bắt buộc.`);
  }
  if (!confirmationSatisfied) {
    missingRequirements.push("Chưa có xác nhận khách hàng.");
  }
  if (!tasksSatisfied) {
    missingRequirements.push(`Còn ${remainingTaskCount} task chưa hoàn tất.`);
  }

  return {
    documentsSatisfied,
    confirmationSatisfied,
    tasksSatisfied,
    taskCount,
    completedTaskCount,
    remainingTaskCount,
    missingRequirements,
    satisfied: missingRequirements.length === 0
  };
}
