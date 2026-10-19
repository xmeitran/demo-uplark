import type { DailyActualLogState, DailyActualLogStatus } from "@b2b-crm/contracts";
import { standardDayMinutes } from "../../shared/system-parameters";

/**
 * D-13: standard (hành chính) minutes one person may plan or log per day across all projects.
 * The only place the value lives — every cap, target and reminder reads it from here.
 */
// 7.6 "Giờ chuẩn một ngày": the catalogue default. Callers that can await should read the workspace's stored value
// through shared/system-parameters (loadParameters / getStoredParameter) instead of this constant.
export const STANDARD_DAY_MINUTES: number = standardDayMinutes();
export const DAILY_ACTUAL_LOG_TARGET_MINUTES = STANDARD_DAY_MINUTES;
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

/** targetMinutes: that person's standard hours of the day (workspace "Giờ chuẩn một ngày" minus approved leave). */
export function buildDailyActualLogStatus(localDate: string, totalMinutes: number, targetMinutes: number = DAILY_ACTUAL_LOG_TARGET_MINUTES): DailyActualLogStatus {
  let state: DailyActualLogState = "below_target";
  if (totalMinutes === targetMinutes) {
    state = "target_met";
  } else if (totalMinutes > targetMinutes) {
    state = "over_target";
  }

  return {
    localDate,
    timeZone: DAILY_ACTUAL_LOG_TIME_ZONE,
    totalMinutes,
    targetMinutes,
    state
  };
}
