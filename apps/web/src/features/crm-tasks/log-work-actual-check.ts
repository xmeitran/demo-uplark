/**
 * What the "Ghi giờ thực tế" form says about the hours being logged, before the API is asked.
 * Only the 07:00–19:00 same-day window is refused here (the API refuses it too). A task without planned hours and
 * hours beyond the plan are both accepted by the API (rule D-19: the overrun is recorded and the PM is warned), so
 * they are a notice, never a refusal.
 */
export interface LogWorkActualInput {
  plannedMinutes: number;
  loggedMinutes: number;
  requestedMinutes: number;
  /** Minutes from midnight of the chosen slot; null when no slot is used or a time is missing. */
  slot?: { startMinutes: number | null; endMinutes: number | null } | null;
}

export const LOG_WORK_SLOT_ERROR = "Khung giờ phải nằm trong 07:00–19:00 và thời gian kết thúc phải sau thời gian bắt đầu.";

export function logWorkActualCheck(input: LogWorkActualInput, formatMinutes: (minutes: number) => string): { error: string | null; warning: string | null } {
  const { slot } = input;
  const error = slot && (slot.startMinutes === null || slot.endMinutes === null || slot.startMinutes < 7 * 60 || slot.endMinutes > 19 * 60 || slot.endMinutes <= slot.startMinutes)
    ? LOG_WORK_SLOT_ERROR
    : null;
  const planned = Math.max(0, input.plannedMinutes);
  const logged = Math.max(0, input.loggedMinutes);
  const over = logged + Math.max(0, input.requestedMinutes) - planned;
  const warning = planned <= 0
    ? "Task chưa có giờ kế hoạch. Giờ vẫn được ghi nhận; nên đặt giờ kế hoạch cho task để theo dõi tiến độ."
    : over > 0
      ? `Vượt giờ kế hoạch ${formatMinutes(over)} (kế hoạch ${formatMinutes(planned)}, đã ghi ${formatMinutes(logged)}). Giờ vẫn được ghi nhận và phần vượt được báo cho PM.`
      : null;
  return { error, warning };
}
