import { describe, expect, it } from "vitest";
import { installmentTotalMessage, setupItemValueText } from "./setup-view";

describe("project P&L setup view", () => {
  it("shows the value column per contract type", () => {
    expect(setupItemValueText({ valueAmount: 60_000_000, valueKind: "value" })).toBe("60,0");
    expect(setupItemValueText({ valueAmount: 7_200_000, valueKind: "ceiling" })).toBe("Trần 7,2");
    expect(setupItemValueText({ valueAmount: 30_000_000, valueKind: "cost_cap" })).toBe("");
    expect(setupItemValueText({ valueAmount: null, valueKind: "none" })).toBe("");
    expect(setupItemValueText({ valueAmount: null, valueKind: "value" })).toBe("Chưa nhập");
  });

  it("says how far the instalment plan is from 100%", () => {
    expect(installmentTotalMessage(100)).toBeNull();
    expect(installmentTotalMessage(33.3 + 33.3 + 33.4)).toBeNull();
    expect(installmentTotalMessage(90)).toBe("thiếu 10%");
    expect(installmentTotalMessage(105)).toBe("thừa 5%");
  });
});
