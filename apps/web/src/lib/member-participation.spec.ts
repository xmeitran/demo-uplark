import { describe, expect, it } from "vitest";
import { currentVietnamMonthRange, PARTICIPATION_STATE } from "./member-participation";
import { PROJECT_STATUS_LABELS } from "./project-status";

describe("currentVietnamMonthRange", () => {
  it("uses the Vietnam calendar month, not the UTC one", () => {
    // 2026-02-28T18:00Z is already 01/03 in Asia/Ho_Chi_Minh.
    expect(currentVietnamMonthRange(new Date("2026-02-28T18:00:00Z"))).toEqual({ startDate: "2026-03-01", endDate: "2026-03-31", label: "03/2026" });
    expect(currentVietnamMonthRange(new Date("2024-02-10T03:00:00Z")).endDate).toBe("2024-02-29");
  });
});

describe("participation labels", () => {
  it("uses Vietnamese labels that cannot be confused with a Project Status", () => {
    expect(PARTICIPATION_STATE.active.label).toBe("Đang tham gia");
    expect(PARTICIPATION_STATE.on_hold.label).toBe("Tạm dừng theo dự án");
    expect(PARTICIPATION_STATE.missing_data.label).toBe("Thiếu dữ liệu");
    expect(PARTICIPATION_STATE.no_log.label).toBe("Chưa có giờ trong kỳ");
    const statusLabels = Object.values(PROJECT_STATUS_LABELS);
    for (const state of Object.values(PARTICIPATION_STATE)) expect(statusLabels).not.toContain(state.label);
  });
});
