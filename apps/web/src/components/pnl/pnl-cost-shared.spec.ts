import { describe, expect, it } from "vitest";
import { matchPastedRates, readParameterValue } from "./pnl-cost-shared";

describe("matchPastedRates", () => {
  const people = [{ userId: "a", displayName: "Nguyễn Văn An" }, { userId: "b", displayName: "Trần Đức" }, { userId: "c", displayName: "Lê Hoa" }, { userId: "d", displayName: "Lê Hoa" }];
  it("matches names without diacritics and reads spreadsheet number formats", () => {
    const result = matchPastedRates("Họ tên\tĐơn giá\nnguyen van an\t150.000\nTRẦN ĐỨC\tDev\t200,000.00\nLê Hoa\t90000\nNgười Lạ;50000\n", people);
    expect(result.matched).toEqual({ a: 150000, b: 200000 });
    expect(result.unmatched).toEqual(["Lê Hoa", "Người Lạ"]);
  });
});

describe("readParameterValue", () => {
  // Same table as apps/api/src/modules/resource-controls/pnl-calc.spec.ts — keep the two in step.
  const PARAMETER_CASES: Array<[string, number | undefined]> = [
    ["5%", 0.05], ["12,5%", 0.125], ["12.5%", 0.125],
    // Leading-zero integer part is always a decimal.
    ["0.125", 0.125], ["0,005", 0.005], ["0.05", 0.05], ["0,5", 0.5],
    // One separator + exactly three digits after a non-zero 1–3 digit integer part: thousands.
    ["26.300", 26300], ["26.300 ₫", 26300], ["1,250", 1250], ["999.999", 999999],
    // Not that shape: a decimal.
    ["1250.300", 1250.3], ["1250,300", 1250.3], ["26.30", 26.3], ["26,3", 26.3], ["1.2500", 1.25],
    // Several separators of one kind: thousands.
    ["1.250.000", 1250000], ["1,250,000", 1250000], ["10.000.000 ₫", 10000000],
    // Mixed: the last one is the decimal mark.
    ["1.250,5", 1250.5], ["1,250.5", 1250.5], ["1.250.000,75", 1250000.75], ["1,250,000.75", 1250000.75],
    ["176 giờ", 176], ["200 USD", 200], ["-1.250,5", -1250.5], ["-5%", -0.05],
    ["1.2.3", undefined], ["1,250.5,5", undefined], ["chưa có", undefined], ["", undefined]
  ];

  it("reads parameter values by the same rule as the API", () => {
    for (const [text, expected] of PARAMETER_CASES) expect(readParameterValue(text), text).toBe(expected);
  });
});
