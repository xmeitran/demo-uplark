import type { DailyActualLogState, DailyActualLogStatus } from "@b2b-crm/contracts";

export const DAILY_ACTUAL_LOG_TARGET_MINUTES = 480 as const;
export const DAILY_ACTUAL_LOG_TIME_ZONE = "Asia/Ho_Chi_Minh" as const;

const HCM_OFFSET_MINUTES = 7 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export interface DailyActualLogWindow {
  localDate: string;
  startAt: Date;
  endAt: Date;
}

export function getDailyActualLogWindow(attributedAt: Date): DailyActualLogWindow {
  const hcmLocal = new Date(attributedAt.getTime() + HCM_OFFSET_MINUTES * MS_PER_MINUTE);
  const year = hcmLocal.getUTCFullYear();
  const month = hcmLocal.getUTCMonth() + 1;
  const day = hcmLocal.getUTCDate();
  const startAt = new Date(Date.UTC(year, month - 1, day) - HCM_OFFSET_MINUTES * MS_PER_MINUTE);

  return {
    localDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startAt,
    endAt: new Date(startAt.getTime() + MS_PER_DAY)
  };
}

export function buildDailyActualLogStatus(localDate: string, totalMinutes: number): DailyActualLogStatus {
  let state: DailyActualLogState = "below_target";
  if (totalMinutes === DAILY_ACTUAL_LOG_TARGET_MINUTES) {
    state = "target_met";
  } else if (totalMinutes > DAILY_ACTUAL_LOG_TARGET_MINUTES) {
    state = "over_target";
  }

  return {
    localDate,
    timeZone: DAILY_ACTUAL_LOG_TIME_ZONE,
    totalMinutes,
    targetMinutes: DAILY_ACTUAL_LOG_TARGET_MINUTES,
    state
  };
}
