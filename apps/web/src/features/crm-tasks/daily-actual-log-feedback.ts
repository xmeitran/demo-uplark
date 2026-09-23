import type { DailyActualLogStatus } from "@b2b-crm/contracts";

export type DailyActualLogFeedback = {
  heading: string;
  message: string;
  tone: "info" | "warning";
};

function formatLocalDate(localDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function formatMinutes(minutes: number) {
  const normalizedMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalizedMinutes / 60);
  const remainingMinutes = normalizedMinutes % 60;
  if (hours === 0) return `${remainingMinutes} phút`;
  if (remainingMinutes === 0) return `${hours} giờ`;
  return `${hours} giờ ${remainingMinutes} phút`;
}

export function getDailyActualLogFeedback(
  dailyActualLog: DailyActualLogStatus | null | undefined,
  userDisplayName?: string
): DailyActualLogFeedback | null {
  if (!dailyActualLog || dailyActualLog.state === "below_target") return null;

  const subject = userDisplayName?.trim() || "Người dùng";
  const localDate = formatLocalDate(dailyActualLog.localDate);
  if (dailyActualLog.state === "target_met") {
    return {
      heading: "Đã ghi nhận đủ 8 giờ",
      message: `${subject} đã ghi nhận đủ 8 giờ trong ngày ${localDate}.`,
      tone: "info"
    };
  }

  const overageMinutes = Math.max(0, dailyActualLog.totalMinutes - dailyActualLog.targetMinutes);
  return {
    heading: "Đã vượt mốc 8 giờ/ngày",
    message: `${subject} đã ghi nhận ${formatMinutes(dailyActualLog.totalMinutes)} trong ngày ${localDate}, vượt ${formatMinutes(overageMinutes)} so với mốc 8 giờ.`,
    tone: "warning"
  };
}
