/** Planned hours of one task (API: MAX_TASK_ESTIMATE_MINUTES in delivery-handoff/projects.shared.ts). */
export const MAX_TASK_ESTIMATE_HOURS = 8;
export const TASK_ESTIMATE_HINT = "Tối đa 8 giờ/task (480 phút). Việc dài hơn hãy tách thành nhiều task.";
export const TASK_ESTIMATE_ERROR = "Giờ kế hoạch của một task tối đa 8 giờ. Việc dài hơn hãy tách thành nhiều task hoặc sub-task.";

/** Text of a planned-hours input -> hours, keeping decimals ("1.5", "1,5"); blank or not a number -> 0. */
export function parsePlannedHours(text: string) {
  const hours = Number(String(text).trim().replace(",", "."));
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/**
 * Whether the planned hours may be saved. An estimate that was above the cap before and is left as it was
 * (`originalHours`) is not a change, so it never blocks saving the task's other fields.
 */
export function isPlannedHoursInvalid(hours: number, originalHours?: number) {
  if (!Number.isFinite(hours) || hours < 0) return true;
  if (originalHours !== undefined && hours === originalHours) return false;
  return hours > MAX_TASK_ESTIMATE_HOURS;
}
