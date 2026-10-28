import { isClosedTaskStatus } from "./task-status";

export type MilestoneGateFacts = {
  requiredDocumentCount: number;
  submittedDocumentCount: number;
  missingDocumentTypes?: readonly string[];
  customerConfirmationRequired: boolean;
  customerConfirmationAt?: Date | string | null;
  taskStatuses: readonly unknown[];
  /** false = "Không duyệt": only the tasks count, and a milestone without tasks is not done. */
  approvalRequired?: boolean;
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
  const noApproval = facts.approvalRequired === false;
  const documentsSatisfied = noApproval || submittedDocumentCount >= requiredDocumentCount;
  const confirmationSatisfied = noApproval || !facts.customerConfirmationRequired || Boolean(facts.customerConfirmationAt);
  const tasksSatisfied = remainingTaskCount === 0 && (!noApproval || taskCount > 0);
  const missingRequirements: string[] = [];

  if (!documentsSatisfied) {
    if (facts.missingDocumentTypes?.length) {
      missingRequirements.push(`Thiếu loại hồ sơ: ${facts.missingDocumentTypes.join(", ")}.`);
    } else {
      missingRequirements.push(`Còn ${requiredDocumentCount - submittedDocumentCount} hồ sơ bắt buộc.`);
    }
  }
  if (!confirmationSatisfied) {
    missingRequirements.push("Chưa có xác nhận khách hàng.");
  }
  if (!tasksSatisfied) {
    missingRequirements.push(taskCount === 0 ? "Milestone chưa có task." : `Còn ${remainingTaskCount} task chưa hoàn tất.`);
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
