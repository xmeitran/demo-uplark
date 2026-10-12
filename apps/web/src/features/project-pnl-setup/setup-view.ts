import { formatMillions } from "@/components/pnl/pnl-format";

/** Cột Giá trị của bảng hạng mục: Trọn gói "60,0", Theo giờ "Trần 7,2", Nội bộ để trống (mục 6.1 khối B). */
export function setupItemValueText(item: { valueAmount: number | null; valueKind: "value" | "ceiling" | "cost_cap" | "none" }): string {
  if (item.valueKind === "value") return item.valueAmount === null ? "Chưa nhập" : formatMillions(item.valueAmount);
  if (item.valueKind === "ceiling") return item.valueAmount === null ? "Chưa có trần" : `Trần ${formatMillions(item.valueAmount)}`;
  return "";
}

const oneDecimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

/** Tổng tỷ lệ các đợt phải đúng 100%: null when it is, else "thiếu 10%" / "thừa 5%" (mục 6.1 khối C). */
export function installmentTotalMessage(totalPercent: number): string | null {
  const difference = Math.round((totalPercent - 100) * 10_000) / 10_000;
  if (difference === 0) return null;
  return `${difference < 0 ? "thiếu" : "thừa"} ${oneDecimal.format(Math.abs(difference))}%`;
}
