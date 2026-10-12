import type { CreateTaskTimeEntryInput } from "@b2b-crm/contracts";

export type TaskTimeEntryFormInput = {
  billable?: boolean;
  endAt?: string;
  minutes: number;
  note?: string;
  startAt?: string;
  timeZone?: string;
  userId?: string;
  workDate: string;
  workType?: string;
  /** Layer 2 chosen in the log form (P&L spec 12/10 point 5). */
  selectedTaskTypeLayer2?: CreateTaskTimeEntryInput["selectedTaskTypeLayer2"];
};

export function getDefaultTaskTimeEntryUserId(principal: string) {
  return principal === "founder" ? "usr-kha-founder" : "usr-deliverer";
}

export function resolveTaskTimeEntryUserId(
  logInput: Pick<TaskTimeEntryFormInput, "userId">,
  principal: string,
  currentUserId?: string
) {
  return logInput.userId || currentUserId || getDefaultTaskTimeEntryUserId(principal);
}

export function buildCreateTaskTimeEntryInput(
  logInput: TaskTimeEntryFormInput,
  principal: string,
  currentUserId?: string
): CreateTaskTimeEntryInput {
  return {
    userId: resolveTaskTimeEntryUserId(logInput, principal, currentUserId),
    workDate: logInput.workDate,
    startAt: logInput.startAt,
    endAt: logInput.endAt,
    timeZone: logInput.timeZone,
    minutes: logInput.minutes,
    billable: logInput.billable,
    workType: logInput.workType,
    note: logInput.note,
    selectedTaskTypeLayer2: logInput.selectedTaskTypeLayer2
  };
}
