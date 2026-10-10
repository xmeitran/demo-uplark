export type CapacityLoadTone = "info" | "success" | "warning" | "critical" | "neutral";

/**
 * Weekly load label for one person. When the capacity figure is only the API's default
 * (capacityKnown=false) the percentage means nothing: say "Thiếu dữ liệu capacity" — never
 * "Còn trống" and never "Quá tải" against a number nobody entered.
 */
export function capacityLoadStatus(percentage: number, capacityKnown: boolean): { tone: CapacityLoadTone; statusText: string; overloaded: boolean } {
  if (!capacityKnown) return { tone: "warning", statusText: "Thiếu dữ liệu capacity", overloaded: false };
  if (percentage === 0) return { tone: "neutral", statusText: "Còn trống", overloaded: false };
  if (percentage <= 80) return { tone: "info", statusText: "Còn trống", overloaded: false };
  if (percentage <= 100) return { tone: "success", statusText: "Ổn định", overloaded: false };
  if (percentage <= 110) return { tone: "warning", statusText: "Vượt tải nhẹ", overloaded: true };
  return { tone: "critical", statusText: percentage > 120 ? "Bị chặn trên 120%" : "Quá tải cao", overloaded: true };
}
