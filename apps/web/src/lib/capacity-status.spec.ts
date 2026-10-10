import { describe, expect, it } from "vitest";
import { capacityLoadStatus } from "./capacity-status";

describe("capacityLoadStatus", () => {
  it("keeps the load bands when capacity is known", () => {
    expect(capacityLoadStatus(0, true).statusText).toBe("Còn trống");
    expect(capacityLoadStatus(95, true).statusText).toBe("Ổn định");
    expect(capacityLoadStatus(105, true)).toMatchObject({ statusText: "Vượt tải nhẹ", overloaded: true });
    expect(capacityLoadStatus(115, true).statusText).toBe("Quá tải cao");
    expect(capacityLoadStatus(130, true).statusText).toBe("Bị chặn trên 120%");
  });

  it.each([0, 60, 105, 150])("never judges load (%s%%) against a defaulted capacity", (percentage) => {
    expect(capacityLoadStatus(percentage, false)).toEqual({ tone: "warning", statusText: "Thiếu dữ liệu capacity", overloaded: false });
  });
});
