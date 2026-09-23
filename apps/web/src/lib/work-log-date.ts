import { toVietnamDateKey } from "./vietnam-time";
/** The selected calendar day wins only when opening a fresh draft. */
export function defaultWorkLogDate(selectedDay?: string, plannedStart?: string, now: Date = new Date()) {
  if (selectedDay && /^\d{4}-\d{2}-\d{2}$/.test(selectedDay) && !Number.isNaN(Date.parse(selectedDay)) && new Date(selectedDay).toISOString().slice(0, 10) === selectedDay) return selectedDay;
  if (plannedStart && !Number.isNaN(Date.parse(plannedStart))) return toVietnamDateKey(plannedStart);
  return toVietnamDateKey(now);
}
