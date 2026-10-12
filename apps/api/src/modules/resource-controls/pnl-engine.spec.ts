import { describe, expect, it } from "vitest";
import {
  adjustedAfterClose,
  classifyEntry,
  companyCostMonth,
  computeProjectPnl,
  contractValue,
  dashboardPeriod,
  dashboardTab,
  dashboardTotals,
  g7Blockers,
  periodChecklist,
  recognizedRevenue,
  splitFund,
  toVnd,
  type ContractItemInput,
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
    taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", afterPnlClose: false, ...raw
  }, rate === null ? undefined : rate ?? RATE_150);
}

const ITEMS: ContractItemInput[] = [{ id: "hm-01", contractType: "FIXED_PRICE", valueAmount: 60_000_000 }, { id: "hm-02", contractType: "TIME_AND_MATERIAL", valueAmount: 7_200_000 }];
const project = (patch: Partial<ProjectPnlInput> = {}) => computeProjectPnl({
  entries: [], items: ITEMS, closePassed: false, g1Passed: true, lostDeal: false, consumable: false, lockedPeriods: new Set(), fundShares: [], unallocatedFundPeriods: new Set(), manualLines: [],
  tree: DEFAULT_COST_TREE, disabledCodes: new Set(), commissionPercent: 5, sellRate: (role) => (role === "DELIVERY" ? 400_000 : undefined), ...patch
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
  it("giá trị hợp đồng = Trọn gói lấy giá trị + Theo giờ lấy mức trần; Nội bộ không cộng; không nhập tay", () => {
    expect(contractValue([...ITEMS, { id: "hm-03", contractType: "INTERNAL", valueAmount: 9_000_000 }])).toMatchObject({ amount: 67_200_000, fixedPriceAmount: 60_000_000, hourlyCeilingAmount: 7_200_000 });
  });

  it("no chargeable item, or one without a value or a type → no contract value (never 0)", () => {
    expect(contractValue([]).amount).toBeUndefined();
    expect(contractValue([{ id: "x", contractType: "INTERNAL", valueAmount: 1 }]).amount).toBeUndefined();
    expect(contractValue([ITEMS[0], { id: "y", contractType: "TIME_AND_MATERIAL", valueAmount: null }])).toMatchObject({ amount: undefined, missingValueCount: 1 });
    expect(contractValue([{ id: "z", contractType: null, valueAmount: 5 }]).amount).toBeUndefined();
  });

  it("Theo giờ = giờ tính P&L của hạng mục × đơn giá bán của vai trò người ghi, tối đa bằng mức trần", () => {
    const entries = [entry({ hours: 20, contractItemId: "hm-02", dateKey: "2026-10-05" }), entry({ hours: 5, contractItemId: "hm-02", rate: null })]; // the pending 5 giờ earn nothing
    const sell = (role: RoleGroup) => (role === "DELIVERY" ? 400_000 : undefined);
    const capped = recognizedRevenue(ITEMS, entries, sell);
    expect(capped.byItem.find((row) => row.itemId === "hm-02")).toMatchObject({ uncappedAmount: 8_000_000, amount: 7_200_000, capped: true });
    expect(capped.amount).toBe(67_200_000);
    const under = recognizedRevenue(ITEMS, [entry({ hours: 10, contractItemId: "hm-02" })], sell);
    expect(under.byItem[1]).toMatchObject({ amount: 4_000_000, capped: false });
    expect(under.amount).toBe(64_000_000);
  });

  it("a role with hours but no sell rate leaves the item, and the project, without recognised revenue", () => {
    const revenue = recognizedRevenue(ITEMS, [entry({ hours: 10, contractItemId: "hm-02", roleGroup: "PM", userId: "u-pm" })], (role) => (role === "DELIVERY" ? 400_000 : undefined));
    expect(revenue).toMatchObject({ amount: undefined, missingSellRateRoles: ["PM"] });
  });

  it("trước G7: ô doanh thu là giá trị hợp đồng, kết quả là EBIT dự kiến, hoa hồng dự kiến trên giá trị hợp đồng", () => {
    const pnl = project({ entries: [entry({ hours: 128 })] });
    expect(pnl.revenue).toMatchObject({ amount: 67_200_000, basis: "contract" });
    expect(pnl.commission).toEqual({ amount: 3_360_000, expected: true, enabled: true });
    expect(pnl.ebit).toMatchObject({ amount: 67_200_000 - 19_200_000 - 3_360_000, expected: true });
  });

  it("tại G7: doanh thu ghi nhận một lần cho cả dự án, hoa hồng ghi nhận cùng lúc trên doanh thu ghi nhận", () => {
    const pnl = project({ closePassed: true, entries: [entry({ hours: 10, contractItemId: "hm-02" })] });
    expect(pnl.revenue).toMatchObject({ amount: 64_000_000, basis: "recognized", contractAmount: 67_200_000 });
    expect(pnl.commission).toMatchObject({ amount: 3_200_000, expected: false });
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

  it("dự án nội bộ: no revenue, no EBIT, no commission; its Nội bộ hours are costed to compare with the cap", () => {
    const disabledCodes = effectiveDisabledCodes(DEFAULT_COST_TREE, DEFAULT_ITEM_TEMPLATES[1].disabledCodes);
    const pnl = project({ consumable: true, disabledCodes, items: [{ id: "nb", contractType: "INTERNAL", valueAmount: 10_000_000 }], entries: [entry({ hours: 20, taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT", contractItemId: "nb" })] });
    expect(pnl.revenue).toMatchObject({ amount: undefined, basis: "none" });
    expect(pnl.ebit.amount).toBeUndefined();
    expect(pnl.commission).toMatchObject({ amount: undefined, enabled: false });
    expect(pnl.whole).toMatchObject({ includedMinutes: 0, excludedMinutes: 20 * H, laborCostAmount: 3_000_000 });
    expect(pnl.internalCost).toMatchObject({ minutes: 20 * H, amount: 3_000_000 });
    expect(pnl.recordState).toBe("recognizing");
    expect(pnl.result.reasons.map((reason) => reason.code)).not.toContain("no_contract_value");
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

  it("Không tính được: chưa có doanh thu (giá trị hợp đồng) hoặc chưa có cost rate nào", () => {
    const noContract = project({ items: [], entries: [entry({ hours: 8 })] });
    expect(noContract.result).toMatchObject({ label: "not_computable", labelText: "Không tính được" });
    expect(noContract.result.reasons[0]).toMatchObject({ code: "no_contract_value", target: "project_setup" });
    expect(noContract.revenue.amount).toBeUndefined(); // not 0
    expect(noContract.ebit).toMatchObject({ amount: undefined, marginPercent: undefined }); // not a 100% margin
    const noRate = project({ entries: [entry({ hours: 8, rate: null })] });
    expect(noRate.result.label).toBe("not_computable");
    expect(noRate.result.reasons[0].code).toBe("no_cost_rate");
  });

  it("the other reasons: missing or wrong classification, hours logged into a locked month, an unconfirmed fund", () => {
    const pnl = project({
      entries: [entry({ hours: 8 }), entry({ hours: 2, contractItemId: null }), entry({ hours: 3, selectedTaskTypeLayer2: "INTERNAL_PROJECT" }), entry({ hours: 1, loggedAfterLock: true })],
      unallocatedFundPeriods: new Set(["2026-08", "2026-12"])
    });
    expect(pnl.result.reasons.map((reason) => reason.label)).toEqual(["chưa qua G7", "2 giờ thiếu phân loại hoặc hạng mục", "3 giờ chọn Lớp 2 không khớp", "1 giờ ghi bù vào tháng đã khóa", "tháng 08 chưa khóa", "quỹ tháng 08 chưa chia"]);
    expect(pnl.blockingMinutes).toBe(5 * H);
    expect(pnl.reconciliation).toMatchObject({ loggedMinutes: 14 * H, includedMinutes: 8 * H, pendingMinutes: 6 * H, balanced: true });
  });

  it("g7Blockers: only missing or wrong classification / line item blocks; cost-rate waits are reported apart", () => {
    const blockers = g7Blockers([entry({ hours: 8 }), entry({ hours: 2, contractItemId: null, rate: null }), entry({ hours: 3, selectedTaskTypeLayer2: "INTERNAL_PROJECT" }), entry({ hours: 5, rate: null }), entry({ hours: 1, loggedAfterLock: true })]);
    expect(blockers).toEqual({
      blockingMinutes: 5 * H, entryCount: 2, waitingCostRateMinutes: 5 * H,
      byReason: [{ reason: "missing_contract_item", label: "Chưa có hạng mục", minutes: 2 * H, entryCount: 1 }, { reason: "layer2_mismatch", label: "Lớp 2 không khớp", minutes: 3 * H, entryCount: 1 }]
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
      entry({ hours: 12, projectId: "p-worklog", taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT", contractItemId: null }), // nội bộ
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
    const month = companyCostMonth("2026-08", 0, [entry({ hours: 12, taskTypeLayer2: "INTERNAL_PROJECT", selectedTaskTypeLayer2: null, rate: null })], new Set());
    expect(month.lines.internal).toEqual({ amount: 0, minutes: 12 * H, uncostedMinutes: 12 * H });
  });
});

describe("lớp 3 — checklist năm điều kiện (mục 6.5)", () => {
  const ready = { periodKey: "2026-09", missingParameters: [], entries: [entry({ hours: 8, dateKey: "2026-09-03" })], userNames: new Map([["u-a", "Nhân sự A"], ["u-b", "Nhân sự B"]]), usersWithoutApprovedCost: [], funds: [{ name: "Công cụ AI", amount: 5_260_000, allocatedAmount: 5_260_000, confirmed: true }], acceptedProjects: [{ name: "Dự án C", acceptedOn: "2026-09-20", contractAmount: 260_000_000 }] };

  it("all five hold → every row is ticked", () => {
    expect(periodChecklist(ready).map((row) => [row.key, row.ok])).toEqual([["parameters", true], ["pending_hours", true], ["staff_costs", true], ["funds", true], ["accepted_projects", true]]);
  });

  it("each row says how much is missing, names the few and points to the screen to fix it", () => {
    const rows = periodChecklist({
      ...ready, missingParameters: ["Tỷ lệ hoa hồng"],
      entries: [entry({ hours: 105.5, userId: "u-b", rate: null, dateKey: "2026-09-03" }), entry({ hours: 12, contractItemId: null, dateKey: "2026-09-04" })],
      usersWithoutApprovedCost: ["u-b"], funds: [{ name: "Công cụ AI", amount: 5_260_000, allocatedAmount: 0, confirmed: false }, { name: "Phần mềm dùng chung", amount: 3_000_000, allocatedAmount: 3_000_000, confirmed: true }],
      acceptedProjects: [{ name: "Dự án C", acceptedOn: "2026-09-20", contractAmount: undefined }]
    });
    expect(rows.map((row) => [row.ok, row.detail, row.targetLabel])).toEqual([
      [false, "thiếu: Tỷ lệ hoa hồng", "Tham số"],
      [false, "còn 117,5 giờ", "Danh sách"],
      [false, "thiếu: Nhân sự B", "Hồ sơ nhân sự"],
      [false, "còn: Công cụ AI", "Quỹ chi phí chung"],
      [false, "thiếu: Dự án C", "Thiết lập P&L của dự án"]
    ]);
  });

  it("(2) giờ Pre-sale đang chờ ký hợp đồng không chặn khóa kỳ (A-1b)", () => {
    const presale = entry({ hours: 6, taskTypeLayer1: "PRE_SALE", contractItemId: null, awaitingContract: true, dateKey: "2026-09-03" });
    expect(presale).toMatchObject({ status: "pending", awaitingContract: true });
    expect(periodChecklist({ ...ready, entries: [presale] })[1]).toMatchObject({ ok: true, detail: null });
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

  it("PL-02: dự án thử nghiệm, dự án nội bộ and lost deals are on neither tab", () => {
    const year = dashboardPeriod(2026, "year");
    const accepted = { isTest: false, consumable: false, lostDeal: false, startedOn: "2026-03-02", acceptedOn: "2026-07-20" };
    expect(dashboardTab({ ...accepted, isTest: true }, year, "started_and_accepted")).toBeNull();
    expect(dashboardTab({ ...accepted, consumable: true }, year, "started_and_accepted")).toBeNull();
    expect(dashboardTab({ ...accepted, acceptedOn: undefined, lostDeal: true }, year, "started_and_accepted")).toBeNull();
  });

  it("ô tổng = cộng số Toàn dự án; biên EBIT = tổng EBIT ÷ tổng doanh thu, không lấy trung bình biên từng dự án", () => {
    const a = project({ closePassed: true, lockedPeriods: new Set(["2026-08"]), items: [{ id: "hm-01", contractType: "FIXED_PRICE", valueAmount: 100_000_000 }], commissionPercent: 0, entries: [entry({ hours: 400 })] }); // cost 60, EBIT 40, biên 40%
    const b = project({ closePassed: true, items: [{ id: "hm-01", contractType: "FIXED_PRICE", valueAmount: 20_000_000 }], commissionPercent: 0, entries: [entry({ hours: 120 })] }); // cost 18, EBIT 2, biên 10%
    const totals = dashboardTotals([a, b]);
    expect(totals).toMatchObject({ projectCount: 2, revenueAmount: 120_000_000, totalCostAmount: 78_000_000, laborCostAmount: 78_000_000, otherCostAmount: 0, ebitAmount: 42_000_000, marginPercent: 35 });
    expect(totals.marginPercent).not.toBe((40 + 10) / 2);
    // Ô gắn Tạm tính khi có ít nhất một dự án Tạm tính, ghi số dự án.
    expect(totals).toMatchObject({ label: "provisional", labelText: "Tạm tính · 1 dự án", provisionalProjectCount: 1 });
    expect(dashboardTotals([a])).toMatchObject({ label: "official", labelText: "Chính thức" });
  });

  it("a project without a figure is left out of that sum and counted — never added as 0", () => {
    const known = project({ closePassed: true, lockedPeriods: new Set(["2026-08"]), entries: [entry({ hours: 8 })] });
    const unknown = project({ closePassed: true, items: [], entries: [entry({ hours: 8 })] });
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
