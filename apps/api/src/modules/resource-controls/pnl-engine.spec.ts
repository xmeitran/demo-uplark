import { describe, expect, it } from "vitest";
import {
  adjustedAfterClose,
  classifyEntry,
  companyCostMonth,
  computeProjectPnl,
  dashboardPeriod,
  dashboardTab,
  dashboardTotals,
  g7Blockers,
  periodChecklist,
  splitFund,
  toVnd,
  type EngineEntry,
  type ProjectPnlInput,
  type RawEntry
} from "./pnl-engine";
import type { CostRate, RoleGroup } from "./pnl-rules";
import { DEFAULT_COST_TREE, DEFAULT_ITEM_TEMPLATES, effectiveDisabledCodes } from "./pnl-tree";

const H = 60;
const RATE_150: CostRate = { monthlyAmount: 25_200_000, standardMinutes: 168 * H };
let sequence = 0;
/** A classified hour block: counted by default; `rate: null` = the person has no approved cost for the month. */
function entry(patch: Partial<RawEntry> & { hours: number; rate?: CostRate | null }): EngineEntry {
  const { hours, rate, ...raw } = patch;
  return classifyEntry({
    id: `e-${++sequence}`, projectId: "p-1", userId: "u-a", dateKey: "2026-08-03", minutes: hours * H, roleGroup: "DELIVERY" as RoleGroup,
    taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", afterPnlClose: false, ...raw
  }, rate === null ? undefined : rate ?? RATE_150);
}

const project = (patch: Partial<ProjectPnlInput> = {}) => computeProjectPnl({
  entries: [], projectValueAmount: 67_200_000, closePassed: false, g1Passed: true, lostDeal: false, consumable: false, lockedPeriods: new Set(), fundShares: [], unallocatedFundPeriods: new Set(), manualLines: [],
  tree: DEFAULT_COST_TREE, disabledCodes: new Set(), commissionPercent: 5, ...patch
});

describe("bước 6 — chia quỹ chung (PL-17)", () => {
  it("phần của dự án = số tiền quỹ × giờ tính P&L của dự án ÷ tổng giờ tính P&L; phần lẻ dồn vào dòng cuối; tổng = tổng quỹ", () => {
    // Wireframe mục 6.4: quỹ 5.260.000 đ, Dự án A 29 giờ, B 412 giờ, C 427 giờ → 0,18 / 2,50 / 2,58 triệu.
    const shares = splitFund(5_260_000, [{ projectId: "A", minutes: 29 * H }, { projectId: "B", minutes: 412 * H }, { projectId: "C", minutes: 427 * H }]);
    expect(shares.map((row) => row.amount)).toEqual([175_737, 2_496_682, 2_587_581]);
    expect(shares.reduce((total, row) => total + row.amount, 0)).toBe(5_260_000);
    expect(shares.map((row) => row.sharePercent.toFixed(1))).toEqual(["3.3", "47.5", "49.2"]);
    expect(shares.map((row) => row.takesRemainder)).toEqual([false, false, true]);
  });

  it("the remainder of an indivisible amount goes to the last row, never lost", () => {
    const shares = splitFund(100, [{ projectId: "A", minutes: 60 }, { projectId: "B", minutes: 60 }, { projectId: "C", minutes: 60 }]);
    expect(shares.map((row) => row.amount)).toEqual([33, 33, 34]);
  });

  it("no counted hour → nothing is split (the fund stays Chưa chia); projects without hours take no share", () => {
    expect(splitFund(5_260_000, [])).toEqual([]);
    expect(splitFund(1_000, [{ projectId: "A", minutes: 0 }, { projectId: "B", minutes: 30 }])).toEqual([{ projectId: "B", minutes: 30, sharePercent: 100, amount: 1_000, takesRemainder: true }]);
  });

  it("PL-03: khoản USD quy đổi theo tỷ giá của tháng phát sinh — 200 USD × 26.300 đ = 5.260.000 đ; no rate, no amount", () => {
    expect(toVnd("USD", 200, 26_300)).toBe(5_260_000);
    expect(toVnd("USD", 200, undefined)).toBeUndefined();
    expect(toVnd("VND", 3_000_000, undefined)).toBe(3_000_000);
  });
});

describe("bước 7, 8 — doanh thu và hoa hồng (PL-13, PL-14, PL-15)", () => {
  it("trước G7: ô doanh thu là Giá trị dự án (PL-13), kết quả là EBIT dự kiến, hoa hồng dự kiến trên Giá trị dự án", () => {
    const pnl = project({ entries: [entry({ hours: 128 })] });
    expect(pnl.revenue).toMatchObject({ amount: 67_200_000, basis: "project_value", projectValueAmount: 67_200_000, recognizedAmount: undefined });
    expect(pnl.commission).toEqual({ amount: 3_360_000, expected: true, enabled: true });
    expect(pnl.ebit).toMatchObject({ amount: 67_200_000 - 19_200_000 - 3_360_000, expected: true });
  });

  it("tại G7: Giá trị dự án được ghi nhận một lần thành doanh thu cho cả dự án (PL-14), hoa hồng ghi nhận cùng lúc", () => {
    const pnl = project({ closePassed: true, entries: [entry({ hours: 10 })] });
    expect(pnl.revenue).toMatchObject({ amount: 67_200_000, basis: "recognized", recognizedAmount: 67_200_000 });
    expect(pnl.commission).toMatchObject({ amount: 3_360_000, expected: false });
    expect(pnl.ebit.expected).toBe(false);
  });

  it("hoa hồng không gộp vào cost rate của BD: it is its own item, by the narrowest rate in force", () => {
    const pnl = project({ commissionPercent: 4, entries: [entry({ hours: 3, roleGroup: "BD", userId: "u-bd", taskTypeLayer1: "PRE_SALE", rate: { monthlyAmount: 30_240_000, standardMinutes: 168 * H } })] });
    expect(pnl.itemValues.get("CP.NS.BD")?.amount).toBe(540_000);
    expect(pnl.itemValues.get("CP.HOAHONG")?.amount).toBe(2_688_000);
  });

  it("chưa nhập tỷ lệ hoa hồng → no commission figure and a reason, not 0", () => {
    const pnl = project({ commissionPercent: undefined, entries: [entry({ hours: 8 })] });
    expect(pnl.commission.amount).toBeUndefined();
    expect(pnl.result.reasons.map((reason) => reason.code)).toContain("missing_commission_rate");
  });
});

describe("bước 4, 9, 10 — chi phí nhân sự, chi phí riêng, cộng vòng đời", () => {
  it("PL-10: each person's hours of a month × that person's rate of that month — never another month's", () => {
    const pnl = project({ entries: [
      entry({ hours: 128, dateKey: "2026-08-03" }),
      entry({ hours: 21, dateKey: "2026-09-03", rate: { monthlyAmount: 27_280_000, standardMinutes: 168 * H } }),
      entry({ hours: 10, dateKey: "2026-10-05", rate: null }) // October has no approved cost: the August rate is NOT used
    ] });
    expect(pnl.months.map((row) => [row.periodKey, row.includedMinutes / H, row.pendingMinutes / H, row.laborCostAmount])).toEqual([["2026-08", 128, 0, 19_200_000], ["2026-09", 21, 0, 3_410_000], ["2026-10", 0, 10, 0]]);
    expect(pnl.laborCostAmount).toBe(22_610_000);
  });

  it("giờ đã log + cost rate đã duyệt được đưa vào P&L ngay cả khi chưa có phân loại/G7", () => {
    const pnl = project({ entries: [entry({
      hours: 24,
      dateKey: "2026-09-03",
      taskTypeLayer1: null,
      taskTypeLayer2: null,
      selectedTaskTypeLayer2: null,
      afterPnlClose: null,
      rate: { monthlyAmount: 35_200_000, hourlyAmount: 200_000, standardMinutes: 176 * H }
    })] });

    expect(pnl.whole).toMatchObject({ loggedMinutes: 24 * H, includedMinutes: 24 * H, pendingMinutes: 0, laborCostAmount: 4_800_000 });
    expect(pnl.people[0]).toMatchObject({ loggedMinutes: 24 * H, includedMinutes: 24 * H, laborCostAmount: 4_800_000 });
  });

  it("PL-11: một giờ của BD, PM chỉ được tính một lần — in the labor item of the logger's role group", () => {
    const pnl = project({ entries: [entry({ hours: 8, userId: "u-pm", roleGroup: "PM", taskTypeLayer1: "PM", rate: { monthlyAmount: 33_600_000, standardMinutes: 168 * H } }), entry({ hours: 8 })] });
    expect(pnl.itemValues.get("CP.NS.PM")?.amount).toBe(1_600_000);
    expect(pnl.itemValues.get("CP.NS.DELIVERY")?.amount).toBe(1_200_000);
    expect(pnl.laborCostAmount).toBe(2_800_000);
    expect(pnl.itemValues.get("CP.SALARIES")?.amount).toBe(2_800_000);
  });

  it("bước 9: chi phí riêng cộng vào đúng tháng phát sinh; phần quỹ đã xác nhận vào Chi phí khác của tháng", () => {
    const pnl = project({
      entries: [entry({ hours: 8 })],
      manualLines: [{ periodKey: "2026-09", itemCode: "CP.FUNCOP.RIENG", amount: 2_000_000 }, { periodKey: "2026-08", itemCode: null, amount: 500_000 }],
      fundShares: [{ periodKey: "2026-08", itemCode: "CP.FUNCOP.AI", amount: 1_260_000 }]
    });
    expect(pnl.months.map((row) => [row.periodKey, row.fundCostAmount, row.directCostAmount, row.otherCostAmount])).toEqual([["2026-08", 1_260_000, 500_000, 1_760_000], ["2026-09", 0, 2_000_000, 2_000_000]]);
    expect(pnl.itemValues.get("CP.FUNCOP.RIENG")?.amount).toBe(2_500_000); // a line without an item is still a project cost
    expect(pnl.totalCostAmount).toBe(1_200_000 + 1_260_000 + 2_500_000 + 3_360_000);
    expect(pnl.whole.totalCostAmount).toBe(pnl.totalCostAmount); // dòng Toàn dự án = ô tổng
  });

  it("Rebate License is a Nhập tay revenue line: it adds to Doanh thu, not to cost", () => {
    const pnl = project({ manualLines: [{ periodKey: "2026-08", itemCode: "DOANHTHU.LIC", amount: 1_000_000 }] });
    expect(pnl.revenue).toMatchObject({ amount: 68_200_000, rebateAmount: 1_000_000 });
    expect(pnl.months).toEqual([]);
    expect(pnl.totalCostAmount).toBe(3_360_000);
  });

  it("thu hẹp Từ tháng – Đến tháng: totals add the selected months only; Doanh thu and EBIT are whole-project only", () => {
    const entries = [entry({ hours: 128, dateKey: "2026-08-03" }), entry({ hours: 16, dateKey: "2026-09-03" })];
    const narrowed = project({ entries, range: { from: "2026-09", to: "2026-09" } });
    expect(narrowed.months.map((row) => row.periodKey)).toEqual(["2026-09"]);
    expect(narrowed.whole).toMatchObject({ loggedMinutes: 16 * H, laborCostAmount: 2_400_000, otherCostAmount: 0, totalCostAmount: 2_400_000 });
    expect(narrowed.revenue.amount).toBeUndefined();
    expect(narrowed.ebit.amount).toBeUndefined();
    expect(narrowed.result).toEqual(project({ entries }).result); // the label is the project's, not the range's
  });

  it("giờ sau mốc đóng P&L is costed apart and never added to the project", () => {
    const pnl = project({ closePassed: true, lockedPeriods: new Set(["2026-08"]), entries: [entry({ hours: 8 }), entry({ hours: 10, dateKey: "2026-11-03", afterPnlClose: true, taskTypeLayer2: "TICKET_MAINTENANCE", selectedTaskTypeLayer2: "TICKET_MAINTENANCE", rate: { monthlyAmount: 26_880_000, standardMinutes: 168 * H } })] });
    expect(pnl.afterClose).toMatchObject({ minutes: 10 * H, amount: 1_600_000, rows: [{ periodKey: "2026-11", minutes: 10 * H, amount: 1_600_000 }] });
    expect(pnl.laborCostAmount).toBe(1_200_000);
    expect(pnl.whole.excludedMinutes).toBe(10 * H);
  });

  it("dự án nội bộ vẫn có doanh thu/EBIT nhập tay; giờ Nội bộ vẫn tính theo chi phí tiêu hao", () => {
    const disabledCodes = effectiveDisabledCodes(DEFAULT_COST_TREE, DEFAULT_ITEM_TEMPLATES[1].disabledCodes);
    const pnl = project({ consumable: true, g1Passed: false, disabledCodes, projectValueAmount: 10_000_000, entries: [entry({ hours: 20, internalProject: true, taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT" })] });
    expect(pnl.revenue).toMatchObject({ amount: 10_000_000, basis: "project_value" });
    expect(pnl.ebit.amount).toBe(7_000_000);
    expect(pnl.commission).toMatchObject({ amount: undefined, enabled: false });
    expect(pnl.whole).toMatchObject({ includedMinutes: 0, excludedMinutes: 20 * H, laborCostAmount: 3_000_000 });
    expect(pnl.internalCost).toMatchObject({ minutes: 20 * H, amount: 3_000_000 });
    expect(pnl.recordState).toBe("recognizing");
    expect(pnl.result.reasons.map((reason) => reason.code)).not.toContain("no_project_value");
  });
});

describe("bước 11 — nhãn kết quả (PL-25)", () => {
  const closed = { closePassed: true, lockedPeriods: new Set(["2026-08"]), entries: [entry({ hours: 8 })] };

  it("Chính thức: đã qua G7, mọi tháng có giờ đã khóa, không còn giờ Chờ xử lý", () => {
    expect(project(closed)).toMatchObject({ result: { label: "official", labelText: "Chính thức", reasons: [] }, recordState: "official" });
  });

  it("Tạm tính, with the reason, as soon as one of the three fails", () => {
    expect(project({ ...closed, closePassed: false }).result).toMatchObject({ label: "provisional", reasons: [{ code: "not_closed", label: "chưa qua G7", target: "approval" }] });
    expect(project({ ...closed, lockedPeriods: new Set() }).result.reasons).toEqual([{ code: "months_unlocked", label: "tháng 08 chưa khóa", periodKeys: ["2026-08"], target: "periods" }]);
    const waiting = project({ ...closed, entries: [entry({ hours: 8 }), entry({ hours: 4, userId: "u-b", rate: null })] });
    expect(waiting.result).toMatchObject({ label: "provisional", reasons: [{ code: "pending_cost_rate", label: "4 giờ chờ cost rate", minutes: 240, userCount: 1, target: "staff_costs" }] });
    expect(waiting.recordState).toBe("closed");
  });

  it("Không tính được: chưa có doanh thu (Giá trị dự án) hoặc chưa có cost rate nào", () => {
    const noContract = project({ projectValueAmount: undefined, entries: [entry({ hours: 8 })] });
    expect(noContract.result).toMatchObject({ label: "not_computable", labelText: "Không tính được" });
    expect(noContract.result.reasons[0]).toMatchObject({ code: "no_project_value", label: "chưa nhập doanh thu dự án", target: "project_value" });
    expect(noContract.revenue.amount).toBeUndefined(); // not 0
    expect(noContract.ebit).toMatchObject({ amount: undefined, marginPercent: undefined }); // not a 100% margin
    const noRate = project({ entries: [entry({ hours: 8, rate: null })] });
    expect(noRate.result.label).toBe("not_computable");
    expect(noRate.result.reasons[0].code).toBe("no_cost_rate");
  });

  it("the other reasons: missing or wrong classification, hours logged into a locked month, an unconfirmed fund", () => {
    const pnl = project({
      entries: [entry({ hours: 8 }), entry({ hours: 2, taskTypeLayer1: null }), entry({ hours: 3, selectedTaskTypeLayer2: "INTERNAL_PROJECT" }), entry({ hours: 1, loggedAfterLock: true })],
      unallocatedFundPeriods: new Set(["2026-08", "2026-12"])
    });
    expect(pnl.result.reasons.map((reason) => reason.label)).toEqual(["chưa qua G7", "1 giờ ghi bù vào tháng đã khóa", "tháng 08 chưa khóa", "quỹ tháng 08 chưa chia"]);
    expect(pnl.blockingMinutes).toBe(0);
    expect(pnl.reconciliation).toMatchObject({ loggedMinutes: 14 * H, includedMinutes: 13 * H, pendingMinutes: 1 * H, balanced: true });
  });

  it("g7Blockers: only missing or wrong classification blocks; cost-rate waits are reported apart", () => {
    const blockers = g7Blockers([entry({ hours: 8 }), entry({ hours: 2, taskTypeLayer1: null, rate: null }), entry({ hours: 3, selectedTaskTypeLayer2: "INTERNAL_PROJECT" }), entry({ hours: 5, rate: null }), entry({ hours: 1, loggedAfterLock: true })]);
    expect(blockers).toEqual({
      blockingMinutes: 0, entryCount: 0, waitingCostRateMinutes: 7 * H,
      byReason: []
    });
  });
});

describe("bước 12 — dòng cấp công ty (PL-12)", () => {
  it("năm phần cộng lại luôn bằng tổng chi phí nhân sự của tháng", () => {
    const rate160: CostRate = { monthlyAmount: 26_880_000, standardMinutes: 168 * H };
    const entries = [
      entry({ hours: 100 }), // vào dự án
      entry({ hours: 6, projectId: "p-lost", userId: "u-bd", roleGroup: "BD", taskTypeLayer1: "PRE_SALE", lostDeal: true, rate: { monthlyAmount: 30_240_000, standardMinutes: 168 * H } }), // Chi phí Pre-sale
      entry({ hours: 10, userId: "u-cs", roleGroup: "CS", afterPnlClose: true, taskTypeLayer2: "TICKET_MAINTENANCE", selectedTaskTypeLayer2: "TICKET_MAINTENANCE", rate: rate160 }), // sau nghiệm thu
      entry({ hours: 12, projectId: "p-worklog", internalProject: true, taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT" }), // nội bộ
      entry({ hours: 9, projectId: "p-test" }), // dự án thử nghiệm: out of every named part
      entry({ hours: 4, userId: "u-b", rate: null }) // chờ cost rate: no cost anywhere yet
    ];
    const staffCost = 25_200_000 + 30_240_000 + 26_880_000;
    const month = companyCostMonth("2026-08", staffCost, entries, new Set(["p-test"]));
    expect(month.projectLaborAmount).toBe(15_000_000);
    expect(month.lines.pre_sale).toMatchObject({ amount: 1_080_000, minutes: 6 * H });
    expect(month.lines.after_close).toMatchObject({ amount: 1_600_000, minutes: 10 * H });
    expect(month.lines.internal).toMatchObject({ amount: 1_800_000, minutes: 12 * H });
    expect(month.lines.unallocated.amount).toBe(staffCost - 15_000_000 - 1_080_000 - 1_600_000 - 1_800_000);
    expect(month.projectLaborAmount + Object.values(month.lines).reduce((total, line) => total + line.amount, 0)).toBe(staffCost);
    expect(month.details.map((row) => [row.line, row.userId, row.projectId, row.amount])).toEqual([["pre_sale", "u-bd", "p-lost", 1_080_000], ["after_close", "u-cs", "p-1", 1_600_000], ["internal", "u-a", "p-worklog", 1_800_000]]);
  });

  it("an excluded hour without a cost rate is counted in hours and flagged, not costed at 0", () => {
    const month = companyCostMonth("2026-08", 0, [entry({ hours: 12, internalProject: true, taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: null, rate: null })], new Set());
    expect(month.lines.internal).toEqual({ amount: 0, minutes: 12 * H, uncostedMinutes: 12 * H });
  });
});

describe("lớp 3 — checklist năm điều kiện (mục 6.5)", () => {
  const ready = { periodKey: "2026-09", missingParameters: [], entries: [entry({ hours: 8, dateKey: "2026-09-03" })], userNames: new Map([["u-a", "Nhân sự A"], ["u-b", "Nhân sự B"]]), usersWithoutApprovedCost: [], funds: [{ name: "Công cụ AI", amount: 5_260_000, allocatedAmount: 5_260_000, confirmed: true }], acceptedProjects: [{ name: "Dự án C", acceptedOn: "2026-09-20", projectValueAmount: 260_000_000 }] };

  it("all five hold → every row is ticked", () => {
    expect(periodChecklist(ready).map((row) => [row.key, row.ok])).toEqual([["parameters", true], ["pending_hours", true], ["staff_costs", true], ["funds", true], ["accepted_projects", true]]);
  });

  it("each row says how much is missing, names the few and points to the screen to fix it", () => {
    const rows = periodChecklist({
      ...ready, missingParameters: ["Tỷ lệ hoa hồng"],
      entries: [entry({ hours: 105.5, userId: "u-b", rate: null, dateKey: "2026-09-03" }), entry({ hours: 12, taskTypeLayer1: null, dateKey: "2026-09-04" })],
      usersWithoutApprovedCost: ["u-b"], funds: [{ name: "Công cụ AI", amount: 5_260_000, allocatedAmount: 0, confirmed: false }, { name: "Phần mềm dùng chung", amount: 3_000_000, allocatedAmount: 3_000_000, confirmed: true }],
      acceptedProjects: [{ name: "Dự án C", acceptedOn: "2026-09-20", projectValueAmount: undefined }]
    });
    expect(rows.map((row) => [row.ok, row.detail, row.targetLabel])).toEqual([
      [false, "thiếu: Tỷ lệ hoa hồng", "Tham số"],
      [false, "còn 105,5 giờ", "Danh sách"],
      [false, "thiếu: Nhân sự B", "Hồ sơ nhân sự"],
      [false, "còn: Công cụ AI", "Quỹ chi phí chung"],
      [false, "thiếu: Dự án C", "P&L dự án"]
    ]);
  });

  it("(2) no exception any more: a Pre-sale hour counts from the start, and one still pending holds the month open (chốt 13/10)", () => {
    const presale = entry({ hours: 6, taskTypeLayer1: "PRE_SALE", dateKey: "2026-09-03" });
    expect(presale).toMatchObject({ status: "included", reasons: [] });
    expect(periodChecklist({ ...ready, entries: [entry({ hours: 6, taskTypeLayer1: "PRE_SALE", rate: null, dateKey: "2026-09-03" })] })[1]).toMatchObject({ ok: false, label: "Không còn giờ Chờ xử lý của tháng", detail: "còn 6 giờ" });
  });

  it("(4) tổng đã chia khác tổng quỹ thì chặn khóa kỳ, even when confirmed", () => {
    expect(periodChecklist({ ...ready, funds: [{ name: "Công cụ AI", amount: 5_260_000, allocatedAmount: 5_000_000, confirmed: true }] })[3].ok).toBe(false);
  });
});

describe("lớp 4 — Tổng quan P&L (mục 4)", () => {
  it("bộ lọc kỳ: Năm, H1/H2, Quý, Tháng", () => {
    expect(dashboardPeriod(2026, "year")).toEqual({ from: "2026-01", to: "2026-12" });
    expect(dashboardPeriod(2026, "half", 2)).toEqual({ from: "2026-07", to: "2026-12" });
    expect(dashboardPeriod(2026, "quarter", 3)).toEqual({ from: "2026-07", to: "2026-09" });
    expect(dashboardPeriod(2026, "month", 10)).toEqual({ from: "2026-10", to: "2026-10" });
  });

  it("“Bắt đầu trong kỳ & đã nghiệm thu” (mặc định) vs “Nghiệm thu trong kỳ”; “Đang triển khai” = bắt đầu trong kỳ, chưa qua G7", () => {
    const q3 = dashboardPeriod(2026, "quarter", 3);
    const base = { isTest: false, consumable: false, lostDeal: false };
    const startedBefore = { ...base, startedOn: "2026-05-04", acceptedOn: "2026-09-20" };
    expect(dashboardTab(startedBefore, q3, "started_and_accepted")).toBeNull();
    expect(dashboardTab(startedBefore, q3, "accepted_in_period")).toBe("accepted");
    const startedIn = { ...base, startedOn: "2026-07-06", acceptedOn: "2026-11-02" };
    expect(dashboardTab(startedIn, q3, "started_and_accepted")).toBe("accepted"); // accepted as of now, whatever the month
    expect(dashboardTab(startedIn, q3, "accepted_in_period")).toBeNull();
    expect(dashboardTab({ ...base, startedOn: "2026-08-03" }, q3, "started_and_accepted")).toBe("in_progress");
    expect(dashboardTab({ ...base, startedOn: "2026-03-02" }, q3, "started_and_accepted")).toBeNull();
  });

  it("PL-02: dự án thử nghiệm và lost deals không lên tab; Nội bộ vẫn lên P&L", () => {
    const year = dashboardPeriod(2026, "year");
    const accepted = { isTest: false, consumable: false, lostDeal: false, startedOn: "2026-03-02", acceptedOn: "2026-07-20" };
    expect(dashboardTab({ ...accepted, isTest: true }, year, "started_and_accepted")).toBeNull();
    expect(dashboardTab({ ...accepted, consumable: true }, year, "started_and_accepted")).toBe("accepted");
    expect(dashboardTab({ ...accepted, acceptedOn: undefined, lostDeal: true }, year, "started_and_accepted")).toBeNull();
  });

  it("ô tổng = cộng số Toàn dự án; biên EBIT = tổng EBIT ÷ tổng doanh thu, không lấy trung bình biên từng dự án", () => {
    const a = project({ closePassed: true, lockedPeriods: new Set(["2026-08"]), projectValueAmount: 100_000_000, commissionPercent: 0, entries: [entry({ hours: 400 })] }); // cost 60, EBIT 40, biên 40%
    const b = project({ closePassed: true, projectValueAmount: 20_000_000, commissionPercent: 0, entries: [entry({ hours: 120 })] }); // cost 18, EBIT 2, biên 10%
    const totals = dashboardTotals([a, b]);
    expect(totals).toMatchObject({ projectCount: 2, revenueAmount: 120_000_000, totalCostAmount: 78_000_000, laborCostAmount: 78_000_000, otherCostAmount: 0, ebitAmount: 42_000_000, marginPercent: 35 });
    expect(totals.marginPercent).not.toBe((40 + 10) / 2);
    // Ô gắn Tạm tính khi có ít nhất một dự án Tạm tính, ghi số dự án.
    expect(totals).toMatchObject({ label: "provisional", labelText: "Tạm tính · 1 dự án", provisionalProjectCount: 1 });
    expect(dashboardTotals([a])).toMatchObject({ label: "official", labelText: "Chính thức" });
  });

  it("a project without a figure is left out of that sum and counted — never added as 0", () => {
    const known = project({ closePassed: true, lockedPeriods: new Set(["2026-08"]), entries: [entry({ hours: 8 })] });
    const unknown = project({ closePassed: true, projectValueAmount: undefined, entries: [entry({ hours: 8 })] });
    const totals = dashboardTotals([known, unknown]);
    expect(totals.revenueAmount).toBe(known.revenue.amount);
    expect(totals).toMatchObject({ notComputableProjectCount: 1, label: "provisional" });
    expect(dashboardTotals([unknown])).toMatchObject({ revenueAmount: undefined, ebitAmount: undefined, marginPercent: undefined });
  });

  it("A-3: a project accepted after every month of the filter period was locked is “điều chỉnh sau chốt”", () => {
    const locks = new Map([["2026-07", new Date("2026-08-05T00:00:00Z")], ["2026-08", new Date("2026-09-04T00:00:00Z")], ["2026-09", new Date("2026-10-06T00:00:00Z")]]);
    const q3 = ["2026-07", "2026-08", "2026-09"];
    expect(adjustedAfterClose(new Date("2026-10-20T00:00:00Z"), q3, locks)).toBe(true);
    expect(adjustedAfterClose(new Date("2026-09-20T00:00:00Z"), q3, locks)).toBe(false);
    expect(adjustedAfterClose(new Date("2026-10-20T00:00:00Z"), [...q3, "2026-10"], locks)).toBe(false); // October is still open
    expect(adjustedAfterClose(undefined, q3, locks)).toBe(false);
  });
});
