/** Presentation only: values are already denominated in Vietnamese đồng. Never converts currencies. */
const integer = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
export function formatVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${integer.format(Math.abs(value) < 0.5 ? 0 : value)} đ`;
}
export function formatCompactVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute < 1_000) return formatVnd(value);
  // Promote after rounding so boundaries never render as “1.000 nghìn”.
  if (absolute >= 1e18) {
    let exponent = Math.floor(Math.log10(absolute) / 3) * 3;
    if (Math.round(absolute / 10 ** exponent * 10) / 10 >= 1000) exponent += 3;
    return `${compactNumber.format(value / 10 ** exponent)} × 10^${exponent} đ`;
  }
  const units = [{ divisor: 1e15, label: "triệu tỷ" }, { divisor: 1e12, label: "nghìn tỷ" }, { divisor: 1e9, label: "tỷ" }, { divisor: 1e6, label: "triệu" }, { divisor: 1e3, label: "nghìn" }];
  const unit = units.find(item => absolute >= item.divisor || Math.round(absolute / item.divisor * 10) / 10 >= 1);
  return unit ? `${compactNumber.format(value / unit.divisor)} ${unit.label} đ` : formatVnd(value);
}
