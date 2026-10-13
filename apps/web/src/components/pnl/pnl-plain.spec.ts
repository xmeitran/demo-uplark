import { describe, expect, it } from "vitest";
import type { PnlPendingStripItem, PnlResult } from "@b2b-crm/contracts";
import { notComputableWhy, plainGateReason, plainMissing, plainPending, plainPersonStatus, plainReason, resultExplanation, whyNoValue } from "./pnl-plain";

const period = { from: "2026-01", to: "2026-12" };
const pending = (item: Partial<PnlPendingStripItem> & Pick<PnlPendingStripItem, "kind">) => plainPending({ label: "", target: "pending_hours", ...item }, period);

describe("plain wording of P&L reasons", () => {
  it("says “cost rate” as the monthly staff cost that has to be approved, with hours and months", () => {
    expect(plainReason({ code: "pending_cost_rate", label: "105,5 giờ chờ cost rate", minutes: 6330, periodKeys: ["2026-09"], target: "staff_costs" }))
      .toBe("105,5 giờ chưa có chi phí nhân sự tháng được duyệt (tháng 09/2026)");
    expect(plainReason({ code: "months_unlocked", label: "tháng 08, 09 chưa khóa", periodKeys: ["2026-08", "2026-09"], target: "periods" })).toBe("Tháng 08/2026, 09/2026 chưa khóa sổ");
    expect(plainReason({ code: "no_cost_rate", label: "chưa có cost rate nào", target: "staff_costs" })).not.toMatch(/cost rate/i);
  });

  it("falls back to the API's label for a code it does not know", () => {
    expect(plainReason({ code: "something_new" as never, label: "lý do mới", target: "periods" })).toBe("lý do mới");
    expect(plainGateReason("something_new", "Nhãn của API")).toBe("Nhãn của API");
    expect(plainGateReason("missing_staff_cost", "Thiếu cost rate của tháng")).toBe("Chưa có chi phí nhân sự tháng được duyệt");
  });

  it("a Không tính được row names only what blocks the calculation; an empty cell says why", () => {
    const result: PnlResult = { label: "not_computable", labelText: "Không tính được", reasons: [
      { code: "no_project_value", label: "chưa có Giá trị dự án", target: "project_value" },
      { code: "months_unlocked", label: "tháng 09 chưa khóa", periodKeys: ["2026-09"], target: "periods" }
    ] };
    expect(notComputableWhy(result)).toBe("Chưa có Giá trị dự án nên chưa tính được doanh thu");
    expect(whyNoValue(true, result)).toBe("Chưa có Giá trị dự án nên chưa tính được doanh thu");
    expect(whyNoValue(false, result)).toBe("Chỉ nhóm quyền chi phí xem được số tiền");
    const official: PnlResult = { label: "official", labelText: "Chính thức", reasons: [] };
    expect(notComputableWhy(official)).toBeNull();
    expect(whyNoValue(true, official)).toBe("Chưa có số liệu");
    expect(resultExplanation(official)).toMatch(/^Chính thức: /);
    expect(resultExplanation(result)).toMatch(/Lý do: Chưa có Giá trị dự án.*; Tháng 09\/2026 chưa khóa sổ\.$/);
  });
});

describe("“Vì sao số liệu còn tạm tính?”", () => {
  it("each kind is one sentence with its count and one place to fix it", () => {
    expect(pending({ kind: "cost_rate", minutes: 6330, userCount: 2, periodKeys: ["2026-09"], target: "staff_costs" })).toEqual({
      kind: "cost_rate", open: false, actionLabel: "Nhập / duyệt chi phí nhân sự", href: "/users/costs?periodKey=2026-09",
      text: "105,5 giờ của 2 người chưa tính được chi phí vì chưa có chi phí nhân sự tháng được duyệt (tháng 09/2026)."
    });
    expect(pending({ kind: "classification", minutes: 720 })).toMatchObject({ open: true, actionLabel: "Phân loại giờ", href: "/pnl/hours?from=2026-01&to=2026-12&group=classification", text: "12 giờ chưa phân loại công việc." });
    expect(pending({ kind: "months_unlocked", periodKeys: ["2026-03", "2026-05"], target: "periods" })).toMatchObject({ open: false, actionLabel: "Khóa kỳ", href: "/pnl/costs?tab=periods&periodKey=2026-03", text: "Tháng 03/2026, 05/2026 chưa khóa sổ nên số còn có thể đổi." });
    expect(pending({ kind: "fund_unallocated", periodKeys: ["2026-09"], target: "funds" })).toMatchObject({ href: "/pnl/costs?tab=funds&periodKey=2026-09" });
    expect(pending({ kind: "not_computable", projectCount: 45, target: "project_value" })).toMatchObject({ open: true, href: "#pnl-projects", text: "45 dự án chưa tính được lãi lỗ nên chưa cộng vào các ô tổng." });
  });
});

describe("what a month or a person is missing", () => {
  const missing = [
    { kind: "cost_rate" as const, label: "Thiếu cost rate", periodKey: "2026-09", target: "staff_costs" as const },
    { kind: "cost_rate" as const, label: "Thiếu cost rate", periodKey: "2026-10", target: "staff_costs" as const },
    { kind: "classification" as const, label: "Thiếu phân loại", periodKey: "2026-10", target: "pending_hours" as const }
  ];

  it("names it once per kind, with its months", () => {
    expect(plainMissing(missing[0])).toBe("Chưa có chi phí nhân sự tháng được duyệt · tháng 09/2026");
    expect(plainMissing(missing[0], false)).toBe("Chưa có chi phí nhân sự tháng được duyệt");
    expect(plainPersonStatus(missing)).toBe("Chưa có chi phí nhân sự tháng được duyệt (tháng 09/2026, 10/2026); Giờ chưa phân loại (tháng 10/2026)");
    expect(plainPersonStatus(missing, false)).toBe("Chưa có chi phí nhân sự tháng được duyệt; Giờ chưa phân loại");
    expect(plainPersonStatus([])).toBeNull();
  });
});
