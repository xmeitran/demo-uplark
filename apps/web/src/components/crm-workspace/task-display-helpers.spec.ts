import { describe, expect, it } from "vitest";
import { formatCodeLabel, getPriorityLabel, getTaskTypeLabel, getWorkTypeLabel } from "./task-display-helpers";

describe("task display helpers", () => {
  it("renders imported Lark/Base codes as readable labels", () => {
    expect(getPriorityLabel("urgent")).toBe("Khẩn cấp");
    expect(getTaskTypeLabel("dx_manager")).toBe("Quản lý DX");
    expect(getWorkTypeLabel("kh_c")).toBe("KH C");
  });

  it("falls back from raw snake-case codes to title labels", () => {
    expect(formatCodeLabel("customer_success_review")).toBe("Customer Success Review");
  });
});
