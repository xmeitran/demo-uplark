import { describe, expect, it } from "vitest";
import { formatCompactVnd, formatVnd } from "./currency";
describe("Vietnamese đồng presentation without conversion", () => {
  it("keeps the original denomination and formats whole đồng with Vietnamese separators", () => {
    expect(formatVnd(1234567)).toBe("1.234.567 đ");
    expect(formatVnd(4200000)).toBe("4.200.000 đ");
    expect(formatVnd(1234.6)).toBe("1.235 đ");
    expect(formatVnd(-1234.6)).toBe("-1.235 đ");
    expect(formatVnd(-0.2)).toBe("0 đ");
    expect(formatVnd(0)).toBe("0 đ");
  });
  it("preserves missing and invalid values as a placeholder", () => {
    for (const value of [undefined,null,NaN,Infinity,-Infinity]) {
      expect(formatVnd(value)).toBe("—");
      expect(formatCompactVnd(value)).toBe("—");
    }
  });
  it("labels every compact amount including negative balances in Vietnamese", () => {
    expect(formatCompactVnd(42)).toBe("42 đ");
    expect(formatCompactVnd(999)).toBe("999 đ");
    expect(formatCompactVnd(1200)).toBe("1,2 nghìn đ");
    expect(formatCompactVnd(4200000)).toBe("4,2 triệu đ");
    expect(formatCompactVnd(-4200000000)).toBe("-4,2 tỷ đ");
    expect(formatCompactVnd(0)).toBe("0 đ");
  });
  it("promotes rounded values near unit boundaries instead of rendering 1.000 smaller units", () => {
    expect(formatCompactVnd(999999)).toBe("1 triệu đ");
    expect(formatCompactVnd(999999999)).toBe("1 tỷ đ");
    expect(formatCompactVnd(-999999999)).toBe("-1 tỷ đ");
  });
});


describe("very large đồng labels", () => {
  it("bounds trillion and scientific display without losing the full amount", () => {
    expect(formatCompactVnd(1234567890123)).toBe("1,2 nghìn tỷ đ");
    expect(formatVnd(1234567890123)).toBe("1.234.567.890.123 đ");
    expect(formatCompactVnd(1e15)).toBe("1 triệu tỷ đ");
    expect(formatCompactVnd(1e18)).toBe("1 × 10^18 đ");
    expect(formatCompactVnd(999.99e18)).toBe("1 × 10^21 đ");
    expect(formatCompactVnd(Number.MAX_VALUE).length).toBeLessThan(24);
    expect(formatVnd(Number.MAX_VALUE)).not.toContain("Infinity");
  });
});
