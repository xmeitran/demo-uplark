/**
 * Planned hours of one task. A task has no hour cap (user's call, 2026-10-28): the 8-hour limit is per person per day,
 * checked when a plan or a time log is saved (API: dayCapMessage in delivery-handoff/projects.shared.ts).
 */
export const TASK_ESTIMATE_HINT = "Không giới hạn số giờ kế hoạch của mỗi task. Mỗi người lập kế hoạch và ghi giờ tối đa 8 giờ một ngày.";
export const TASK_ESTIMATE_ERROR = "Giờ kế hoạch phải là một số không âm.";

/** Text of a planned-hours input -> hours, keeping decimals ("1.5", "1,5"); blank or not a number -> 0. */
export function parsePlannedHours(text: string) {
  const hours = Number(String(text).trim().replace(",", "."));
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/** Whether the planned hours may be saved: any non-negative number. */
export function isPlannedHoursInvalid(hours: number) {
  return !Number.isFinite(hours) || hours < 0;
}
