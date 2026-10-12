/**
 * One spec per remaining defect of the P&L tab (13/10). Each fails on the code as it was before the fix.
 * Engine cases use plain values; service cases use the Phụ lục B fixture (pnl-scenario.testing.ts) through the real services.
 */
import { describe, expect, it } from "vitest";
import { classifyEntry, computeProjectPnl, dashboardTotals, type ProjectPnl, type ProjectPnlInput } from "./pnl-engine";
import { DEFAULT_COST_TREE, contributionOf, type CostItemDef } from "./pnl-tree";
import { founder, scenario, staffCost, WS } from "./pnl-scenario.testing";

const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const def = (code: string, name: string, parentCode: string, method: CostItemDef["method"], extra: Partial<CostItemDef> = {}): CostItemDef =>
  ({ code, name, parentCode, method, sign: 1, roleGroup: null, unit: "VND", required: false, sortOrder: 900, ...extra });

/** The default tree plus three lines that subtract: a Nhập tay line inside a group, a whole group under Tổng chi phí, and a fund item. */
const SIGNED_TREE: CostItemDef[] = [
  ...DEFAULT_COST_TREE,
  def("CP.FUNCOP.HOANTRA", "Hoàn tiền license", "CP.FUNCOP", "MANUAL", { sign: -1 }),
  def("CP.GIAMTRU", "Giảm trừ chi phí", "CHIPHI", "GROUP", { sign: -1 }),
  def("CP.GIAMTRU.NCC", "Nhà cung cấp hỗ trợ", "CP.GIAMTRU", "MANUAL"),
  def("CP.FUNCOP.TAITRO", "Tài trợ công cụ", "CP.FUNCOP", "FUND", { sign: -1 })
];

let sequence = 0;
const hour = (dateKey: string, hours: number, userId = "u-a", roleGroup: "DELIVERY" | "PM" = "DELIVERY") => classifyEntry({
  id: `rf-${++sequence}`, projectId: "p-1", userId, dateKey, minutes: hours * 60, roleGroup,
  taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", afterPnlClose: false
}, { monthlyAmount: 25_200_000, standardMinutes: 168 * 60 }); // 150.000 đ/giờ

const project = (patch: Partial<ProjectPnlInput> = {}) => computeProjectPnl({
  entries: [hour("2026-08-03", 8), hour("2026-09-01", 4)],
  items: [{ id: "hm-01", contractType: "FIXED_PRICE", valueAmount: 60_000_000 }],
  closePassed: false, g1Passed: true, lostDeal: false, consumable: false, lockedPeriods: new Set(), unallocatedFundPeriods: new Set(),
  fundShares: [{ periodKey: "2026-08", itemCode: "CP.FUNCOP.AI", amount: 1_000_000 }, { periodKey: "2026-09", itemCode: "CP.FUNCOP.TAITRO", amount: 250_000 }],
  manualLines: [
    { periodKey: "2026-08", itemCode: "CP.FUNCOP.RIENG", amount: 2_000_000 },
    { periodKey: "2026-08", itemCode: "CP.FUNCOP.HOANTRA", amount: 500_000 },
    { periodKey: "2026-09", itemCode: "CP.GIAMTRU.NCC", amount: 300_000 }
  ],
  tree: SIGNED_TREE, disabledCodes: new Set(), commissionPercent: 5, sellRate: () => undefined, ...patch
});

/** "Toàn dự án" = the month rows + "Khoản tính cho cả dự án" — the identity every case below must keep. */
function expectAddsUp(pnl: ProjectPnl) {
  expect(sum(pnl.months.map((row) => row.totalCostAmount)) + sum(pnl.wholeProjectCosts.map((row) => row.amount))).toBe(pnl.totalCostAmount);
  expect(pnl.whole.totalCostAmount).toBe(pnl.totalCostAmount);
  expect(pnl.whole.laborCostAmount + pnl.whole.otherCostAmount).toBe(pnl.totalCostAmount);
  expect(sum(pnl.costGroups.accounting.map((row) => row.amount))).toBe(pnl.totalCostAmount);
  expect(sum(pnl.costGroups.role.map((row) => row.amount))).toBe(pnl.totalCostAmount);
}

describe("1 · khoản mục dấu trừ: Toàn dự án = cộng các dòng tháng", () => {
  it("the sign is applied by one function, through every level on the way up", () => {
    const byCode = new Map(SIGNED_TREE.map((row) => [row.code, row]));
    const none = new Set<string>();
    expect(contributionOf(byCode, none, "CP.FUNCOP.HOANTRA", "CP.FUNCOP", 500_000)).toBe(-500_000);
    expect(contributionOf(byCode, none, "CP.FUNCOP.HOANTRA", "CHIPHI", 500_000)).toBe(-500_000);
    expect(contributionOf(byCode, none, "CP.GIAMTRU.NCC", "CP.GIAMTRU", 300_000)).toBe(300_000); // adds to its own group…
    expect(contributionOf(byCode, none, "CP.GIAMTRU.NCC", "CHIPHI", 300_000)).toBe(-300_000); // …which subtracts from the total
    expect(contributionOf(byCode, new Set(["CP.GIAMTRU"]), "CP.GIAMTRU.NCC", "CHIPHI", 300_000)).toBe(0);
    expect(contributionOf(byCode, none, "DOANHTHU.LIC", "CHIPHI", 300_000)).toBe(0); // not a cost line
    expect(Object.is(contributionOf(byCode, none, "CP.FUNCOP.HOANTRA", "CHIPHI", 0), 0)).toBe(true); // never -0
  });

  it("dự án: mỗi dòng tháng mang đúng dấu, cộng lại bằng Toàn dự án và bằng cây khoản mục", () => {
    const pnl = project();
    const [august, september] = pnl.months;
    // 08: nhân sự 8 × 150.000; quỹ 1.000.000; riêng 2.000.000 − 500.000 hoàn tiền.
    expect(august).toMatchObject({ periodKey: "2026-08", laborCostAmount: 1_200_000, fundCostAmount: 1_000_000, directCostAmount: 1_500_000, otherCostAmount: 2_500_000, totalCostAmount: 3_700_000 });
    // 09: nhân sự 4 × 150.000; quỹ −250.000 (tài trợ); riêng −300.000 (nhóm giảm trừ).
    expect(september).toMatchObject({ periodKey: "2026-09", laborCostAmount: 600_000, fundCostAmount: -250_000, directCostAmount: -300_000, otherCostAmount: -550_000, totalCostAmount: 50_000 });
    expect(pnl.wholeProjectCosts).toEqual([{ code: "CP.HOAHONG", name: "Hoa hồng", amount: 3_000_000 }]);
    expect(pnl.totalCostAmount).toBe(3_700_000 + 50_000 + 3_000_000);
    expect(pnl.itemValues.get("CHIPHI")?.amount).toBe(6_750_000);
    expect(pnl.ebit.amount).toBe(60_000_000 - 6_750_000);
    expectAddsUp(pnl);
  });

  it("thu hẹp Từ tháng – Đến tháng: Toàn phạm vi = cộng các tháng đã chọn, cùng dấu", () => {
    const pnl = project({ range: { from: "2026-09", to: "2026-09" } });
    expect(pnl.months.map((row) => row.periodKey)).toEqual(["2026-09"]);
    expect(pnl.whole).toMatchObject({ laborCostAmount: 600_000, fundCostAmount: -250_000, directCostAmount: -300_000, otherCostAmount: -550_000, totalCostAmount: 50_000 });
  });

  it("nhóm chi phí: dòng trừ hiện số âm, cả hai cách nhóm cộng lại bằng Tổng chi phí", () => {
    const pnl = project();
    expect(Object.fromEntries(pnl.costGroups.accounting.map((row) => [row.key, row.amount]))).toMatchObject({ "CP.SALARIES": 1_800_000, "CP.FUNCOP": 2_250_000, "CP.GIAMTRU": -300_000, "CP.HOAHONG": 3_000_000 });
    expect(Object.fromEntries(pnl.costGroups.role.map((row) => [row.key, row.amount]))).toMatchObject({ DELIVERY: 1_800_000, FUND: 750_000, MANUAL: 1_200_000, COMMISSION: 3_000_000 });
    expectAddsUp(pnl);
  });

  it("Tổng quan: ô tổng và hàng Tổng cộng các dự án có dòng trừ vẫn khớp", () => {
    const accepted = project({ closePassed: true, lockedPeriods: new Set(["2026-08", "2026-09"]) });
    const other = project({ closePassed: true, lockedPeriods: new Set(["2026-08", "2026-09"]), manualLines: [], fundShares: [] });
    const totals = dashboardTotals([accepted, other]);
    expect(totals.totalCostAmount).toBe(accepted.totalCostAmount + other.totalCostAmount);
    expect(totals.laborCostAmount + totals.otherCostAmount).toBe(totals.totalCostAmount);
    expect(totals.ebitAmount).toBe((totals.revenueAmount as number) - totals.totalCostAmount);
    for (const pnl of [accepted, other]) expectAddsUp(pnl);
  });

  it("qua dịch vụ: màn P&L dự án và Tổng quan của dự án mẫu có một dòng hoàn tiền", async () => {
    const s = scenario();
    await s.config.loadDefaultItems(founder);
    s.db.table("pnlCostItem").push({ id: "ci-hoantra", workspaceId: WS, ...def("CP.FUNCOP.HOANTRA", "Hoàn tiền license", "CP.FUNCOP", "MANUAL", { sign: -1, sortOrder: 135 }), systemSource: null, formula: null, status: "active" });
    await s.config.createManualCost("p-a", { itemCode: "CP.FUNCOP.HOANTRA", periodKey: "2026-09", label: "Hoàn tiền license tháng 09", amount: 400_000 }, founder);
    const before = (await scenario().project()).totals.cost.totalAmount as number;

    const data = await s.project();
    expect(data.totals.cost.totalAmount).toBe(before - 400_000);
    expect(data.months.rows.find((row) => row.periodKey === "2026-09")).toMatchObject({ directCostAmount: -400_000, otherCostAmount: -400_000 });
    expect(sum(data.months.rows.map((row) => row.totalCostAmount)) + sum(data.months.wholeProjectItems.map((row) => row.amount))).toBe(data.months.whole.totalCostAmount);
    expect(data.months.whole.totalCostAmount).toBe(data.totals.cost.totalAmount);

    const row = (await s.pnl.dashboard({ year: 2026, tab: "in_progress" }, founder)).data.inProgress.rows[0];
    expect(row.totalCostAmount).toBe(data.totals.cost.totalAmount);
    expect(sum(Object.values(row.costByAccountingGroup))).toBe(row.totalCostAmount);
    expect(sum(Object.values(row.costByRoleGroup))).toBe(row.totalCostAmount);
  });
});

describe("7 · tổng hiển thị = cộng những gì màn hình hiện", () => {
  it("mẫu tắt một khoản mục chi phí nhân sự: giờ của nhóm đó ra khỏi cả dòng tháng lẫn Toàn dự án", () => {
    const entries = [hour("2026-08-03", 8), hour("2026-08-04", 2, "u-pm", "PM")];
    const on = project({ entries, manualLines: [], fundShares: [] });
    expect(on.months[0].laborCostAmount).toBe(1_500_000);
    const off = project({ entries, manualLines: [], fundShares: [], disabledCodes: new Set(["CP.NS.PM"]) });
    expect(off.months[0].laborCostAmount).toBe(1_200_000); // was 1.500.000 while the total said 1.200.000
    expect(off.laborCostAmount).toBe(1_200_000);
    expect(off.people.find((person) => person.userId === "u-pm")?.laborCostAmount).toBe(0);
    expectAddsUp(on);
    expectAddsUp(off);
  });

  it("một khoản mục Công thức khác dưới Tổng chi phí cũng là “Khoản tính cho cả dự án”, không biến mất khỏi bảng tháng", async () => {
    const reserve = def("CP.DUPHONG", "Dự phòng bảo hành", "CHIPHI", "FORMULA", { formula: [{ item: "DOANHTHU.GHINHAN" }, { op: "*" }, { value: 0.02 }] });
    const pnl = project({ tree: [...SIGNED_TREE, reserve] });
    expect(pnl.wholeProjectCosts).toEqual([{ code: "CP.HOAHONG", name: "Hoa hồng", amount: 3_000_000 }, { code: "CP.DUPHONG", name: "Dự phòng bảo hành", amount: 1_200_000 }]);
    expectAddsUp(pnl);

    const s = scenario();
    await s.config.loadDefaultItems(founder);
    s.db.table("pnlCostItem").push({ id: "ci-duphong", workspaceId: WS, ...reserve, systemSource: null, status: "active" });
    const data = await s.project();
    expect(data.months.wholeProjectItems.map((row) => [row.code, row.label, row.amount])).toEqual([["CP.HOAHONG", "Hoa hồng", 3_360_000], ["CP.DUPHONG", "Dự phòng bảo hành", 1_344_000]]);
    expect(sum(data.months.rows.map((row) => row.totalCostAmount)) + sum(data.months.wholeProjectItems.map((row) => row.amount))).toBe(data.months.whole.totalCostAmount);
    const narrowed = await s.project({ fromMonth: "2026-08", toMonth: "2026-08" });
    expect(narrowed.months.wholeProjectItems.map((row) => row.amount)).toEqual([null, null]); // Chỉ xem ở Toàn dự án
    expect(sum(narrowed.months.rows.map((row) => row.totalCostAmount))).toBe(narrowed.months.whole.totalCostAmount);
  });
});

describe("2 · khóa kỳ theo thứ tự; mở lại kéo theo các tháng sau", () => {
  const ready09 = async (s: ReturnType<typeof scenario>) => { await s.approveCost("u-b", "2026-09", 25_200_000); await s.pnl.confirmFund("fund-ai", "2026-09", founder); };
  const selected = async (s: ReturnType<typeof scenario>, periodKey: string) => (await s.pnl.periods({ periodKey }, founder)).data.selected!;

  it("tháng sau chỉ khóa được khi mọi tháng trước có dữ liệu đã khóa; thông báo nêu tháng đầu tiên chưa khóa", async () => {
    const s = scenario();
    await ready09(s); // tháng 09 đủ năm điều kiện
    await expect(s.pnl.lockPeriod("2026-09", founder)).rejects.toThrow("Chưa khóa được kỳ 09/2026: kỳ 08/2026 có dữ liệu và chưa khóa. Khóa kỳ 08/2026 trước.");
    expect(s.db.table("pnlPeriod")).toEqual([]);
    expect(await selected(s, "2026-09")).toMatchObject({ canLock: false, lockBlockedByPeriodKey: "2026-08", lockBlockedReason: "Chưa khóa được kỳ 09/2026: kỳ 08/2026 có dữ liệu và chưa khóa. Khóa kỳ 08/2026 trước.", reopenPeriodKeys: [] });
    expect(await selected(s, "2026-08")).toMatchObject({ canLock: true, lockBlockedByPeriodKey: null, lockBlockedReason: null }); // nothing before 08

    await s.pnl.lockPeriod("2026-08", founder);
    expect(await selected(s, "2026-09")).toMatchObject({ canLock: true, lockBlockedByPeriodKey: null, lockBlockedReason: null });
    await expect(s.pnl.lockPeriod("2026-09", founder)).resolves.toMatchObject({ meta: { locked: true } });
  });

  it("“có dữ liệu” = giờ log, chi phí tháng, số tiền quỹ hoặc dòng Nhập tay; tháng trống không chặn", async () => {
    const blocks = async (seed: (s: ReturnType<typeof scenario>) => void) => {
      const s = scenario();
      seed(s);
      await expect(s.pnl.lockPeriod("2026-08", founder)).rejects.toThrow("kỳ 07/2026 có dữ liệu và chưa khóa");
    };
    await expect(scenario().pnl.lockPeriod("2026-08", founder)).resolves.toBeTruthy(); // tháng 07 trống
    await blocks((s) => { s.log({ userId: "u-a", taskId: "t-build-a", dateKey: "2026-07-31", hours: 1 }); });
    await blocks((s) => { s.db.table("resourceMonthlyCost").push(staffCost("u-a", "2026-07", 25_200_000, "DRAFT")); });
    await blocks((s) => { s.db.table("pnlFundPeriod").push({ id: "fp-07", workspaceId: WS, fundId: "fund-ai", periodKey: "2026-07", amount: 1, sourceCurrency: "VND", sourceAmount: 1, exchangeRate: null, status: "unallocated", confirmedAt: null }); });
    await blocks((s) => { s.db.table("projectCost").push({ id: "pc-07", workspaceId: WS, projectId: "p-a", costType: "OTHER", itemCode: "CP.FUNCOP.RIENG", label: "Thuê ngoài", amount: 1, occurredAt: new Date("2026-07-15T03:00:00.000Z") }); });
    // The first open month is the one named, not the nearest.
    const s = scenario();
    s.db.table("resourceMonthlyCost").push(staffCost("u-a", "2026-06", 25_200_000), staffCost("u-a", "2026-07", 25_200_000));
    await expect(s.pnl.lockPeriod("2026-08", founder)).rejects.toThrow("kỳ 06/2026 có dữ liệu và chưa khóa");
  });

  it("mở lại tháng 08: tháng 09 mở lại trong cùng thao tác, liệt kê trước khi xác nhận, mỗi tháng một dòng lịch sử cùng lý do", async () => {
    const s = scenario();
    await ready09(s);
    await s.pnl.lockPeriod("2026-08", founder);
    await s.pnl.lockPeriod("2026-09", founder);
    expect((await selected(s, "2026-08")).reopenPeriodKeys).toEqual(["2026-08", "2026-09"]); // what the confirmation lists
    expect((await selected(s, "2026-09")).reopenPeriodKeys).toEqual(["2026-09"]);

    const reason = "Sửa chi phí tháng 08 của BD-1";
    const reopened = await s.pnl.reopenPeriod("2026-08", { reason }, founder);
    expect(reopened.meta.reopenedPeriodKeys).toEqual(["2026-08", "2026-09"]);
    expect(s.db.table("pnlPeriod").map((row) => [row.periodKey, row.status, row.reopenReason])).toEqual([["2026-08", "REOPENED", reason], ["2026-09", "REOPENED", reason]]);
    for (const periodKey of ["2026-08", "2026-09"]) {
      const { history, reopenPeriodKeys } = await selected(s, periodKey);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ reopenedByName: "Admin chi phí", reopenReason: reason });
      expect(reopenPeriodKeys).toEqual([]);
    }
    expect(s.db.table("auditEvent").filter((event) => event.action === "pnl.period_reopened").map((event) => event.after)).toEqual([
      { status: "REOPENED", periodKey: "2026-08", reason, reopenedWithPeriodKey: "2026-08" },
      { status: "REOPENED", periodKey: "2026-09", reason, reopenedWithPeriodKey: "2026-08" }
    ]);
    // Both are open again, so the order applies again.
    await expect(s.pnl.lockPeriod("2026-09", founder)).rejects.toThrow("kỳ 08/2026 có dữ liệu và chưa khóa");
  });
});

describe("4 · PIC của dự án trên tab P&L = PIC ở mọi nơi khác (chủ giai đoạn đầu tiên)", () => {
  it("không còn lấy thành viên PM_OWNER: theo giai đoạn có thứ tự nhỏ nhất, và bộ lọc PIC của Tổng quan lọc theo đúng người đó", async () => {
    const s = scenario(); // PM_OWNER member: PM-1; first stage (Validate, sortOrder 10): BD-1
    expect((await s.project()).header).toMatchObject({ picUserId: "u-bd", picName: "BD-1" });
    const dashboard = async (picUserId?: string) => (await s.pnl.dashboard({ year: 2026, ...(picUserId ? { picUserId } : {}) }, founder)).data;
    expect((await dashboard()).filter.options.pics).toEqual([{ id: "u-bd", name: "BD-1" }]);
    expect((await dashboard("u-bd")).inProgress.rows.map((row) => [row.projectId, row.picName])).toEqual([["p-a", "BD-1"]]);
    expect((await dashboard("u-pm")).inProgress.total).toBe(0);

    // A stage placed before it takes over; a first stage without an owner means no PIC (no fallback to a later stage).
    s.db.table("projectStage").push({ id: "st-m0", projectId: "p-a", activity: "Lead", sortOrder: 5, taskTypeLayer1: "PRE_SALE", afterPnlClose: false, ownerUserId: "u-cs", plannedStartAt: null, plannedEndAt: null });
    expect((await s.project()).header).toMatchObject({ picUserId: "u-cs", picName: "CS-1" });
    expect((await dashboard("u-cs")).inProgress.total).toBe(1);
    expect((await dashboard("u-bd")).inProgress.total).toBe(0);
    s.db.table("projectStage").find((stage) => stage.id === "st-m0")!.ownerUserId = null;
    expect((await s.project()).header).toMatchObject({ picUserId: null, picName: null });
  });
});
