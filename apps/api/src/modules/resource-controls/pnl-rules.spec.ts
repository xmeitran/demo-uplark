import { describe, expect, it } from "vitest";
import {
  blocksG7,
  classifyPnlEntry,
  costOfMinutes,
  costRateOf,
  hourlyRate,
  pendingDeadline,
  pendingGroupOf,
  periodStateOf,
  recordStateOf,
  reconcileHours,
  roleGroupOf,
  standardMonthMinutes,
  workingDaysOfMonth,
  type PnlGateInput
} from "./pnl-rules";

/** An hour that passes all four conditions of PL-04. */
const counted: PnlGateInput = { projectId: "p-1", taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", afterPnlClose: false, hasCostRate: true };
const gate = (patch: Partial<PnlGateInput>) => classifyPnlEntry({ ...counted, ...patch });

describe("bước 1 — giờ chuẩn của tháng (PL-09, PNL-28)", () => {
  it("tháng 08/2026: 21 ngày × 8 = 168 giờ", () => {
    expect(workingDaysOfMonth("2026-08")).toBe(21);
    expect(standardMonthMinutes("2026-08") / 60).toBe(168);
  });

  it("tháng 10/2026: 22 ngày × 8 = 176 giờ", () => {
    expect(workingDaysOfMonth("2026-10")).toBe(22);
    expect(standardMonthMinutes("2026-10") / 60).toBe(176);
  });

  it("ngày lễ trong lịch Admin bị loại: tháng 09/2026 còn 21 ngày vì nghỉ lễ 02/09", () => {
    expect(workingDaysOfMonth("2026-09")).toBe(22);
    expect(workingDaysOfMonth("2026-09", new Set(["2026-09-02"]))).toBe(21);
    expect(standardMonthMinutes("2026-09", new Set(["2026-09-02"])) / 60).toBe(168);
  });

  it("a holiday on a weekend takes nothing out, and the standard day is a parameter", () => {
    expect(workingDaysOfMonth("2026-08", new Set(["2026-08-01", "2026-08-02"]))).toBe(21); // Saturday, Sunday
    expect(standardMonthMinutes("2026-08", new Set(), 7.5 * 60) / 60).toBe(157.5);
  });
});

describe("bước 2 — cost rate (PL-08, PL-09)", () => {
  it("= tổng chi phí tháng đã duyệt ÷ giờ chuẩn của tháng", () => {
    const rate = costRateOf({ totalAmount: 25_200_000, status: "APPROVED" }, 168 * 60)!;
    expect(hourlyRate(rate)).toBe(150_000);
    expect(Math.round(hourlyRate(costRateOf({ totalAmount: 27_280_000, status: "APPROVED" }, 168 * 60)!))).toBe(162_381);
  });

  it("chỉ bản Đã duyệt được dùng: a Nháp, a missing month or a month without standard hours gives no rate", () => {
    expect(costRateOf({ totalAmount: 25_200_000, status: "DRAFT" }, 168 * 60)).toBeUndefined();
    expect(costRateOf(undefined, 168 * 60)).toBeUndefined();
    expect(costRateOf({ totalAmount: 25_200_000, status: "APPROVED" }, 0)).toBeUndefined();
  });

  it("chỉ làm tròn khi hiển thị: the cost of hours is computed from the unrounded rate", () => {
    const rate = { monthlyAmount: 27_280_000, standardMinutes: 168 * 60 };
    expect(costOfMinutes(21 * 60, rate)).toBe(3_410_000); // 21 × 162.380,95…, not 21 × 162.381 = 3.410.001
    expect(costOfMinutes(2 * 60, rate)).toBe(324_762);
    expect(costOfMinutes(60, undefined)).toBeUndefined(); // never 0 for a missing rate
  });
});

describe("bước 3 — cổng lọc giờ (PL-04, PL-05, PL-06)", () => {
  it("Được tính when all four conditions hold; giờ log không qua bước duyệt", () => {
    expect(gate({})).toEqual({ status: "included", reasons: [] });
  });

  it("(1) Lớp 2 người ghi chọn phải khớp với task: lệch thì Chờ xử lý, lý do Lớp 2 không khớp", () => {
    expect(gate({ selectedTaskTypeLayer2: "INTERNAL_PROJECT" })).toMatchObject({ status: "pending", reason: "layer2_mismatch", reasons: ["layer2_mismatch"] });
    expect(gate({ selectedTaskTypeLayer2: "TICKET_MAINTENANCE" })).toMatchObject({ status: "pending", reason: "layer2_mismatch" });
    // chosen as chargeable on a maintenance (Milestone 4) task: waits too instead of being excluded silently
    expect(gate({ taskTypeLayer2: "TICKET_MAINTENANCE", afterPnlClose: true, selectedTaskTypeLayer2: "CUSTOMER_PROJECT" })).toMatchObject({ status: "pending", reason: "layer2_mismatch" });
    // chosen as chargeable on an internal task
    expect(gate({ taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT" })).toMatchObject({ status: "pending", reason: "layer2_mismatch" });
  });

  it("a legacy row without a choice (before 10/2026) is judged on the task's Layer 2 alone", () => {
    expect(gate({ selectedTaskTypeLayer2: null })).toEqual({ status: "included", reasons: [] });
    expect(gate({ selectedTaskTypeLayer2: null, hasCostRate: false })).toMatchObject({ status: "pending", reasons: ["missing_staff_cost"] });
    expect(gate({ selectedTaskTypeLayer2: null, taskTypeLayer2: "INTERNAL_PROJECT" })).toMatchObject({ status: "excluded", reason: "internal" });
  });

  it("(2) Sau mốc đóng P&L: task từ Milestone 4 trở đi bị loại, có lý do", () => {
    expect(gate({ taskTypeLayer2: "TICKET_MAINTENANCE", selectedTaskTypeLayer2: "TICKET_MAINTENANCE", afterPnlClose: true })).toEqual({ status: "excluded", reason: "after_close", reasons: ["after_close"] });
    expect(gate({ afterPnlClose: null })).toMatchObject({ status: "pending", reason: "unknown_close_position" });
  });

  it("(3) thiếu phân loại → Chờ xử lý, kèm lý do; “đủ phân loại” no longer asks for a contract line item (chốt 13/10)", () => {
    expect(gate({ taskTypeLayer1: "PRE_SALE" })).toEqual({ status: "included", reasons: [] }); // Pre-sale counts from the start (Phụ lục B ca 4)
    expect(gate({ taskTypeLayer1: null })).toMatchObject({ status: "pending", reason: "missing_layer1" });
    expect(gate({ taskTypeLayer2: null, selectedTaskTypeLayer2: "CUSTOMER_PROJECT" })).toMatchObject({ status: "pending", reason: "missing_layer2" });
    expect(gate({ projectId: null })).toMatchObject({ status: "pending", reason: "missing_project" });
    expect(gate({ taskTypeLayer1: null, hasCostRate: false }).reasons).toEqual(["missing_layer1", "missing_staff_cost"]);
  });

  it("(4) thiếu cost rate của tháng → Chờ xử lý, never costed at 0", () => {
    expect(gate({ hasCostRate: false })).toEqual({ status: "pending", reason: "missing_staff_cost", reasons: ["missing_staff_cost"] });
  });

  it("Nội bộ: Lớp 2 là Nội bộ thì Bị loại, lý do Nội bộ — with or without a cost rate", () => {
    expect(gate({ taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT", afterPnlClose: null, hasCostRate: false })).toEqual({ status: "excluded", reason: "internal", reasons: ["internal"] });
  });

  it("giờ Pre-sale của deal thua bị loại khỏi P&L dự án (PL-12), whatever else is missing", () => {
    expect(gate({ lostDeal: true, taskTypeLayer1: "PRE_SALE", hasCostRate: false })).toEqual({ status: "excluded", reason: "lost_deal_pre_sale", reasons: ["lost_deal_pre_sale"] });
    expect(gate({ lostDeal: true, taskTypeLayer1: "DELIVERY" }).status).toBe("included");
  });

  it("ghi bù vào tháng đã khóa → Chờ xử lý, lý do Tháng đã khóa (A-1a), before anything else", () => {
    expect(gate({ loggedAfterLock: true })).toEqual({ status: "pending", reason: "locked_period", reasons: ["locked_period"] });
    expect(gate({ loggedAfterLock: true, taskTypeLayer2: "INTERNAL_PROJECT" }).reason).toBe("locked_period");
  });

  it("an old Họp/Khác hour inside a project waits for the PM's review", () => {
    expect(gate({ legacyPendingReason: "legacy_group_in_project" })).toMatchObject({ status: "pending", reason: "legacy_group_in_project" });
    expect(gate({ legacyPendingReason: "legacy_no_stage", taskTypeLayer1: null }).reasons[0]).toBe("legacy_no_stage");
  });

  it("G7 chỉ bị chặn bởi giờ chờ vì thiếu hoặc sai phân loại; giờ chờ cost rate không chặn (mục 7 điểm 6)", () => {
    expect(blocksG7(gate({ hasCostRate: false }))).toBe(false);
    expect(blocksG7(gate({ loggedAfterLock: true }))).toBe(false);
    expect(blocksG7(gate({ selectedTaskTypeLayer2: "INTERNAL_PROJECT" }))).toBe(true);
    expect(blocksG7(gate({ taskTypeLayer1: null }))).toBe(true);
    expect(blocksG7(gate({ taskTypeLayer1: null, hasCostRate: false }))).toBe(true);
    expect(blocksG7(gate({}))).toBe(false);
    expect(blocksG7(gate({ taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: null }))).toBe(false); // excluded, not pending
  });

  it("each pending hour falls in exactly one group of the “Dữ liệu chờ xử lý” strip", () => {
    expect(pendingGroupOf(["missing_staff_cost"])).toBe("cost_rate");
    expect(pendingGroupOf(["missing_layer1", "missing_staff_cost"])).toBe("classification");
    expect(pendingGroupOf(["layer2_mismatch", "missing_staff_cost"])).toBe("layer2_mismatch");
    expect(pendingGroupOf(["locked_period"])).toBe("locked_period");
  });

  it("PL-07: giờ đã ghi = Được tính + Chờ xử lý + Bị loại", () => {
    expect(reconcileHours({ loggedMinutes: 16410, includedMinutes: 10080, pendingMinutes: 6330, excludedMinutes: 0 })).toMatchObject({ balanced: true, differenceMinutes: 0 });
    expect(reconcileHours({ loggedMinutes: 100, includedMinutes: 60, pendingMinutes: 10, excludedMinutes: 10 })).toMatchObject({ balanced: false, differenceMinutes: 20 });
  });

  it("PL-05: quá 10 ngày làm việc thì thành DL-01; giờ Pre-sale đang chờ ký hợp đồng không tính hạn này", () => {
    const logged = new Date("2026-09-01T03:00:00.000Z");
    const due = pendingDeadline(logged, new Date("2026-09-16T03:00:00.000Z"), 10, new Set(["2026-09-02"]));
    expect(due.deadline!.toISOString()).toBe("2026-09-16T16:59:59.999Z"); // 10 working days after 01/09, skipping the holiday
    expect(due.overdue).toBe(false);
    expect(pendingDeadline(logged, new Date("2026-09-17T03:00:00.000Z"), 10, new Set(["2026-09-02"])).overdue).toBe(true);
    expect(pendingDeadline(logged, new Date("2026-12-01T03:00:00.000Z"), 10, new Set(), true)).toEqual({ deadline: undefined, overdue: false });
  });
});

describe("nhóm vai trò, kỳ và hồ sơ P&L", () => {
  it("PL-10: the logger's role group decides the cost item", () => {
    expect(roleGroupOf(["PM", "WORKSPACE_ADMIN"])).toBe("PM");
    expect(roleGroupOf(["BD"])).toBe("BD");
    expect(roleGroupOf(["BD_LEAD", "WORKSPACE_ADMIN"])).toBe("BD");
    expect(roleGroupOf(["CS"])).toBe("CS");
    expect(roleGroupOf(["DX"])).toBe("DELIVERY");
    expect(roleGroupOf([])).toBe("DELIVERY");
  });

  it("PL-23: Chưa mở → Đang mở (tháng hiện tại) → Chờ khóa (tự chuyển khi hết tháng) → Đã khóa", () => {
    expect(periodStateOf("2026-11", "2026-10", false)).toBe("not_open");
    expect(periodStateOf("2026-10", "2026-10", false)).toBe("open");
    expect(periodStateOf("2026-09", "2026-10", false)).toBe("awaiting_lock");
    expect(periodStateOf("2026-07", "2026-10", true)).toBe("locked");
  });

  it("PL-28: the record's state follows G1, G7, the locks and the close reason — as the state diagram draws it", () => {
    const base = { lostDeal: false, g1Passed: false, closePassed: false, internalTemplate: false, hasInternalItem: false, allHourMonthsLocked: false, pendingMinutes: 0 };
    expect(recordStateOf(base)).toBe("awaiting_contract");
    expect(recordStateOf({ ...base, g1Passed: true })).toBe("recognizing");
    expect(recordStateOf({ ...base, g1Passed: true, closePassed: true })).toBe("closed");
    expect(recordStateOf({ ...base, g1Passed: true, closePassed: true, allHourMonthsLocked: true })).toBe("official");
    expect(recordStateOf({ ...base, g1Passed: true, closePassed: true, allHourMonthsLocked: true, pendingMinutes: 60 })).toBe("closed");
    // Đóng, thua deal: chỉ trước G1
    expect(recordStateOf({ ...base, lostDeal: true })).toBe("lost_deal");
    expect(recordStateOf({ ...base, lostDeal: true, g1Passed: true })).toBe("recognizing");
    // Dự án Loại Nội bộ, Đào tạo: Đang ghi nhận ngay khi tạo dự án (PL-28)
    expect(recordStateOf({ ...base, internalTemplate: true })).toBe("recognizing");
  });
});
