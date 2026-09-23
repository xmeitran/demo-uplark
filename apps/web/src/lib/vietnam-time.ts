export const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const VIETNAM_TIME_ZONE_LABEL = "GMT+7";

const VIETNAM_OFFSET = "+07:00";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: VIETNAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: VIETNAM_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export function toVietnamDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateKeyFormatter.format(date);
}

export function toVietnamDateInputValue(value?: Date | string | null) {
  if (!value) return "";
  return toVietnamDateKey(value);
}

export function formatVietnamTime(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return timeFormatter.format(date).replace("24:", "00:");
}

export function formatVietnamDate(value?: Date | string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...options
  }).format(date);
}

export function vietnamDateTimeToIso(dateKey: string, time: string) {
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${dateKey}T${normalizedTime}${VIETNAM_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

export function vietnamDayStartIso(value: Date | string) {
  const dateKey = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : toVietnamDateKey(value);
  return vietnamDateTimeToIso(dateKey, "00:00");
}

export function vietnamDayEndIso(value: Date | string) {
  const start = new Date(vietnamDayStartIso(value));
  if (Number.isNaN(start.getTime())) return "";
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}
