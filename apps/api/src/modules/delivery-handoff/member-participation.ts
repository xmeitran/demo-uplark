import { reportDayStart } from "../resource-controls/pnl-calc";

/** EV-035: participation of a member in a project for a period. Always derived, never stored. */
export type MemberParticipationState = "active" | "on_hold" | "missing_data" | "no_log";

/** Time entries in these approval states are not actual work. */
export const NON_ACTUAL_TIME_ENTRY_STATUSES = ["rejected", "cancelled", "canceled", "planned"];

/** The single definition of "actual hours": every time entry except rejected, cancelled and planned ones. */
export function isActualTimeEntry(entry: { approvalStatus?: unknown }): boolean {
  return !NON_ACTUAL_TIME_ENTRY_STATUSES.includes(String(entry.approvalStatus ?? "").trim().toLowerCase());
}

export function sumActualMinutes(entries?: ReadonlyArray<{ minutes: number; approvalStatus?: unknown }> | null): number {
  return (entries ?? []).reduce((sum, entry) => sum + (isActualTimeEntry(entry) ? entry.minutes : 0), 0);
}

const REPORT_DAY_MS = 24 * 60 * 60 * 1000;
// Offset of the reporting timezone, derived from the shared report-day helper so there is one source for it.
const REPORT_TZ_OFFSET_MS = -reportDayStart("1970-01-01").getTime();

function reportDayStartOf(instant: Date) {
  return reportDayStart(new Date(instant.getTime() + REPORT_TZ_OFFSET_MS).toISOString().slice(0, 10));
}

/**
 * Participation periods are whole local days (Asia/Ho_Chi_Minh): startDate is the start of its local day and
 * endDate includes its whole local day, so the returned `end` is exclusive (query with `lt`).
 */
export function participationWindow(startDate: Date, endDate: Date): { start: Date; end: Date } {
  return { start: reportDayStartOf(startDate), end: new Date(reportDayStartOf(endDate).getTime() + REPORT_DAY_MS) };
}

export interface MemberParticipationInput {
  projectOnHold: boolean;
  /** A completed project has no open work to report as missing. */
  projectCompleted?: boolean;
  /** Minutes of actual (non-rejected) time entries of the member in the project within the period. */
  actualMinutes: number;
  /** Open, non-archived tasks the member owns or is assigned to in the project. */
  openTasks: ReadonlyArray<{ plannedStartAt?: unknown; dueAt?: unknown }>;
}

export function deriveMemberParticipation(input: MemberParticipationInput): { state: MemberParticipationState; reason: string } {
  if (input.projectOnHold) return { state: "on_hold", reason: "Project đang On Hold" };
  if (input.actualMinutes > 0) return { state: "active", reason: "Có Time Log thực tế trong kỳ" };
  if (input.projectCompleted) return { state: "no_log", reason: "Project đã hoàn thành, không có Time Log thực tế trong kỳ" };
  if (input.openTasks.length === 0) return { state: "missing_data", reason: "Chưa có Task đang mở được giao trong Project" };
  if (!input.openTasks.some((task) => task.plannedStartAt && task.dueAt)) {
    return { state: "missing_data", reason: "Task được giao thiếu ngày bắt đầu hoặc hạn hoàn thành" };
  }
  return { state: "no_log", reason: "Có kế hoạch nhưng chưa có Time Log thực tế trong kỳ" };
}
