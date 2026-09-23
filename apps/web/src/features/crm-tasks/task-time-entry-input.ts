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
};

export function getDefaultTaskTimeEntryUserId(principal: string) {
  return principal === "founder" ? "usr-kha-founder" : "usr-deliverer";
}

export function resolveTaskTimeEntryUserId(logInput: Pick<TaskTimeEntryFormInput, "userId">, principal: string) {
  return logInput.userId || getDefaultTaskTimeEntryUserId(principal);
}

export function buildCreateTaskTimeEntryInput(
  logInput: TaskTimeEntryFormInput,
  principal: string
): CreateTaskTimeEntryInput {
  return {
    userId: resolveTaskTimeEntryUserId(logInput, principal),
    workDate: logInput.workDate,
    startAt: logInput.startAt,
    endAt: logInput.endAt,
    timeZone: logInput.timeZone,
    minutes: logInput.minutes,
    billable: logInput.billable,
    workType: logInput.workType,
    note: logInput.note
  };
}
