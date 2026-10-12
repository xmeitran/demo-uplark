/**
 * Phụ lục B of "Yêu cầu tab P&L – hệ thống PM": "Nhập đúng phần Đầu vào thì màn hình phải ra đúng phần Kết quả."
 * B1 is the fixture (pnl-scenario.testing.ts); every expectation below is a number or a sentence of B2 / B3,
 * read from the same service calls the screens make. Nothing here is adjusted to fit the implementation.
 */
import { describe, expect, it } from "vitest";
import { founder, hours, scenario, staffCost, WS } from "./pnl-scenario.testing";

const month = (data: Awaited<ReturnType<ReturnType<typeof scenario>["project"]>>, periodKey: string) => data.months.rows.find((row) => row.periodKey === periodKey)!;
const person = (data: Awaited<ReturnType<ReturnType<typeof scenario>["project"]>>, userId: string) => data.people.find((row) => row.userId === userId)!;

describe("Phụ lục B2 — kết quả qua chuỗi tính", () => {
  it("bước 1 · giờ chuẩn: tháng 08 168 giờ, tháng 09 168 giờ (21 ngày, nghỉ lễ 02/09)", async () => {
    const { config } = scenario();
    const { data } = await config.standardHours({ from: "2026-08", to: "2026-10" }, founder);
    expect(data.map((row) => [row.periodKey, row.workingDays, row.standardHours])).toEqual([["2026-08", 21, 168], ["2026-09", 21, 168], ["2026-10", 22, 176]]);
    expect(data[1].holidays).toEqual([{ dateKey: "2026-09-02", name: "Quốc khánh" }]);
  });

  it("bước 2 · cost rate: A 150.000 (T08) và 162.381 (T09); BD-1 180.000 (T08); PM-1 200.000 cả hai tháng; B tháng 09 chưa có", async () => {
    const { config } = scenario();
    const august = (await config.staffCosts({ periodKey: "2026-08" }, founder)).data.rows;
    const september = (await config.staffCosts({ periodKey: "2026-09" }, founder)).data.rows;
    const rate = (rows: typeof august, userId: string) => rows.find((row) => row.userId === userId)!.hourlyCostRate;
    expect(rate(august, "u-a")).toBe(150_000);
    expect(Math.round(rate(september, "u-a") as number)).toBe(162_381);
    expect(rate(august, "u-bd")).toBe(180_000);
    expect(rate(august, "u-pm")).toBe(200_000);
    expect(rate(september, "u-pm")).toBe(200_000);
    const b = september.find((row) => row.userId === "u-b")!;
    expect(b).toMatchObject({ status: "NONE", statusLabel: "Chưa có", hourlyCostRate: null, waitingMinutes: hours(105.5) });
  });

  it("bước 3 · cổng lọc: T08 139 giờ Được tính; T09 29 giờ Được tính, 105,5 giờ Chờ xử lý (thiếu cost rate của B); cả dự án 273,5 = 168 + 105,5 + 0", async () => {
    const data = await scenario().project();
    expect(month(data, "2026-08")).toMatchObject({ loggedMinutes: hours(139), includedMinutes: hours(139), pendingMinutes: 0, excludedMinutes: 0 });
    expect(month(data, "2026-09")).toMatchObject({ loggedMinutes: hours(134.5), includedMinutes: hours(29), pendingMinutes: hours(105.5), excludedMinutes: 0 });
    expect(month(data, "2026-09").pendingByReason).toEqual([{ reason: "missing_staff_cost", label: "Thiếu cost rate của tháng", minutes: hours(105.5) }]);
    expect(month(data, "2026-09").missing.find((row) => row.kind === "cost_rate")).toMatchObject({ label: "Thiếu cost rate", userIds: ["u-b"], target: "staff_costs" });
    expect(data.months.whole).toMatchObject({ loggedMinutes: hours(273.5), includedMinutes: hours(168), pendingMinutes: hours(105.5), excludedMinutes: 0 });
    expect(data.months.reconciliation).toMatchObject({ balanced: true, differenceMinutes: 0 });
  });

  it("bước 4 · chi phí nhân sự: T08 = 128 × 150.000 + 3 × 180.000 + 8 × 200.000 = 21.340.000 đ; T09 = 3.410.000 + 1.600.000 = 5.010.000 đ", async () => {
    const data = await scenario().project();
    expect(month(data, "2026-08").laborCostAmount).toBe(21_340_000);
    expect(month(data, "2026-09").laborCostAmount).toBe(5_010_000);
    expect(person(data, "u-a")).toMatchObject({ loggedMinutes: hours(149), includedMinutes: hours(149), laborCostAmount: 22_610_000, status: { ok: true, label: "Đủ" } });
    expect(person(data, "u-b")).toMatchObject({ loggedMinutes: hours(105.5), includedMinutes: 0, laborCostAmount: null, status: { ok: false, label: "Chờ cost rate T09" } });
  });

  it("bước 5 · BD, PM tính theo giờ ghi: BD-1 3 giờ và PM-1 16 giờ, cộng 3.740.000 đ, đã nằm trong bước 4", async () => {
    const data = await scenario().project();
    expect(person(data, "u-bd")).toMatchObject({ roleGroup: "BD", includedMinutes: hours(3), laborCostAmount: 540_000 });
    expect(person(data, "u-pm")).toMatchObject({ roleGroup: "PM", includedMinutes: hours(16), laborCostAmount: 3_200_000 });
    expect((person(data, "u-bd").laborCostAmount as number) + (person(data, "u-pm").laborCostAmount as number)).toBe(3_740_000);
    const item = (code: string) => data.items!.find((row) => row.code === code)!.amount;
    expect([item("CP.NS.BD"), item("CP.NS.PM"), item("CP.NS.DELIVERY")]).toEqual([540_000, 3_200_000, 22_610_000]);
  });

  it("bước 6 · quỹ: tháng 08 1.260.000 đ; tháng 09 chưa chia", async () => {
    const data = await scenario().project();
    expect(month(data, "2026-08")).toMatchObject({ fundCostAmount: 1_260_000, otherCostAmount: 1_260_000, totalCostAmount: 22_600_000, missing: [] });
    expect(month(data, "2026-09")).toMatchObject({ otherCostAmount: null, totalCostAmount: 5_010_000 });
    expect(month(data, "2026-09").missing.map((row) => row.kind)).toEqual(["cost_rate", "fund_unallocated"]);
  });

  it("bước 7 · doanh thu: 67.200.000 đ giá trị hợp đồng, chỉ dùng cho EBIT dự kiến", async () => {
    const data = await scenario().project();
    expect(data.totals.revenue).toMatchObject({ amount: 67_200_000, basis: "contract", note: "giá trị HĐ, chưa G7" });
    expect(data.totals.ebit).toMatchObject({ expected: true, label: "EBIT dự kiến" });
  });

  it("bước 8 · hoa hồng: 67.200.000 × 5% = 3.360.000 đ, dự kiến", async () => {
    const data = await scenario().project();
    expect(data.months.wholeProjectItems).toEqual([{ code: "CP.HOAHONG", label: "Hoa hồng", amount: 3_360_000, note: "Hoa hồng dự kiến", expected: true }]);
  });

  it("bước 10 · cộng vòng đời: tổng chi phí = 21.340.000 + 5.010.000 + 1.260.000 + 3.360.000 = 30.970.000 đ; EBIT dự kiến = 36.230.000 đ; biên 53,9%", async () => {
    const data = await scenario().project();
    expect(data.totals.cost).toEqual({ totalAmount: 30_970_000, laborAmount: 26_350_000, otherAmount: 4_620_000 });
    expect(data.months.whole).toMatchObject({ laborCostAmount: 26_350_000, otherCostAmount: 4_620_000, totalCostAmount: 30_970_000 });
    expect(data.totals.ebit.amount).toBe(36_230_000);
    expect((data.totals.ebit.marginPercent as number).toFixed(1)).toBe("53.9");
    expect(data.items!.find((row) => row.code === "CHIPHI")!.amount).toBe(30_970_000);
    expect(data.items!.find((row) => row.code === "KQ.EBIT")!.amount).toBe(36_230_000);
  });

  it("bước 11 · nhãn: Tạm tính, vì chưa qua G7; 105,5 giờ chờ cost rate; tháng 08, 09 chưa khóa; quỹ tháng 09 chưa chia", async () => {
    const data = await scenario().project();
    expect(data.header.result.label).toBe("provisional");
    expect(data.header.result.labelText).toBe("Tạm tính");
    expect(data.header.result.reasons.map((reason) => reason.label)).toEqual(["chưa qua G7", "105,5 giờ chờ cost rate", "tháng 08, 09 chưa khóa", "quỹ tháng 09 chưa chia"]);
    expect(data.header).toMatchObject({ recordState: "recognizing", recordStateLabel: "Đang ghi nhận", acceptedOn: null });
  });

  it("bước 12 · dòng cấp công ty: không phát sinh với dự án này ở trạng thái gốc", async () => {
    const { pnl } = scenario();
    const { data } = await pnl.dashboard({ year: 2026 }, founder);
    const line = (key: string) => data.companyCosts.lines.find((row) => row.key === key)!;
    expect([line("pre_sale").amount, line("after_close").amount, line("internal").amount]).toEqual([0, 0, 0]);
    // PL-12: năm phần cộng lại luôn bằng tổng chi phí nhân sự (25,2 + 27,28 + 30,24 + 33,6 × 2 = 149,92 triệu).
    expect(data.companyCosts.staffCostAmount).toBe(149_920_000);
    expect(data.companyCosts.projectLaborAmount).toBe(26_350_000);
    expect(line("unallocated").amount).toBe(149_920_000 - 26_350_000);
    expect(data.companyCosts.balanced).toBe(true);
    const project = await scenario().project();
    expect(project.months.afterClose).toMatchObject({ visible: false, minutes: 0, amount: null });
  });

  it("wireframe mục 5 dùng bộ số này: giờ kế hoạch 260, giờ thực hiện 273,5 (+5%, 2 tháng có giờ), dòng Chưa giao 21", async () => {
    const data = await scenario().project();
    expect(data.totals).toMatchObject({ plannedMinutes: hours(260), loggedMinutes: hours(273.5), monthsWithHours: 2 });
    expect(Math.round(data.totals.loggedVsPlanPercent as number)).toBe(5);
    expect(data.people.map((row) => [row.displayName, row.plannedMinutes / 60])).toEqual([["Nhân sự A", 120], ["Nhân sự B", 100], ["PM-1", 16], ["BD-1", 3], ["Chưa giao", 21]]);
    expect(month(data, "2026-08").periodStateLabel).toBe("Chờ khóa");
  });
});

describe("Phụ lục B3 — ca kiểm thử theo quy tắc mới", () => {
  it("ca 1 · duyệt chi phí tháng 09 của Nhân sự B 25.200.000 đ (cost rate 150.000): 105,5 giờ sang Được tính; chi phí tháng 09 tăng 15.825.000 đ; quỹ tháng 09 chạy lại được; EBIT dự kiến còn 20.405.000 đ", async () => {
    const s = scenario();
    const before = await s.project();
    await s.approveCost("u-b", "2026-09", 25_200_000);
    const rows = (await s.config.staffCosts({ periodKey: "2026-09" }, founder)).data.rows;
    expect(rows.find((row) => row.userId === "u-b")).toMatchObject({ status: "APPROVED", hourlyCostRate: 150_000, waitingMinutes: 0 });
    const after = await s.project();
    expect(month(after, "2026-09")).toMatchObject({ includedMinutes: hours(134.5), pendingMinutes: 0 });
    expect((month(after, "2026-09").laborCostAmount as number) - (month(before, "2026-09").laborCostAmount as number)).toBe(15_825_000);
    expect(after.totals.ebit).toMatchObject({ amount: 20_405_000, expected: true });
    // "quỹ tháng 09 chạy lại được trước khi xác nhận": the preview now counts the released hours.
    const rerun = await s.pnl.rerunFund("fund-ai", "2026-09", founder);
    expect(rerun.data.shares).toEqual([{ projectId: "p-a", minutes: hours(134.5), sharePercent: 100, amount: 5_260_000, takesRemainder: true }]);
    const funds = (await s.pnl.funds({ periodKey: "2026-09" }, founder)).data;
    expect(funds.warnings).toEqual([]);
    expect(funds.funds[0].preview).toMatchObject({ confirmed: false, canConfirm: true, totalMinutes: hours(134.5) });
  });

  it("ca 2 · A ghi thêm 20 giờ tháng 10 vào task của HM-02, G7 duyệt 30/10: doanh thu ghi nhận 67.200.000 (HM-01 60.000.000; HM-02 8.000.000 dừng ở trần 7.200.000); hoa hồng 3.360.000 ghi nhận; chi phí thêm 3.000.000, tổng 33.970.000; EBIT 33.230.000, biên 49,4%; vẫn Tạm tính", async () => {
    const s = scenario({ now: "2026-11-02T03:00:00.000Z" });
    s.log({ userId: "u-a", taskId: "t-cr", month: "2026-10", hours: 20 });
    await s.approveCost("u-a", "2026-10", 26_400_000); // giờ chuẩn 176 → cost rate 150.000 đ/giờ
    // Mục 7 điểm 6: giờ chờ cost rate của B không chặn G7.
    expect(await s.pnl.pendingHoursBlockingG7(WS, "p-a")).toMatchObject({ blockingMinutes: 0, waitingCostRateMinutes: hours(105.5) });
    s.approveG7("2026-10-30");
    const data = await s.project();
    expect(data.header).toMatchObject({ acceptedOn: "2026-10-30", recordState: "closed", recordStateLabel: "Đã đóng" });
    expect(data.totals.revenue).toMatchObject({ amount: 67_200_000, basis: "recognized", label: "Doanh thu ghi nhận" });
    const setup = (await s.config.projectSetup("p-a", founder)).data;
    expect(setup.items.find((item) => item.code === "HM-02")!.hourly).toMatchObject({ revenueToDateAmount: 8_000_000, ceilingAmount: 7_200_000, overThreshold: true });
    expect(data.items!.find((row) => row.code === "DOANHTHU.GHINHAN")!.amount).toBe(67_200_000);
    expect(data.months.wholeProjectItems[0]).toMatchObject({ amount: 3_360_000, expected: false, note: "Hoa hồng ghi nhận" });
    expect(month(data, "2026-10").laborCostAmount).toBe(3_000_000);
    expect(data.totals.cost.totalAmount).toBe(33_970_000);
    expect(data.totals.ebit).toMatchObject({ amount: 33_230_000, expected: false, label: "EBIT" });
    expect((data.totals.ebit.marginPercent as number).toFixed(1)).toBe("49.4");
    // "Nhãn vẫn Tạm tính vì còn giờ chờ và tháng chưa khóa"
    expect(data.header.result.label).toBe("provisional");
    expect(data.header.result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["pending_cost_rate", "months_unlocked"]));
    expect(data.header.result.reasons.map((reason) => reason.code)).not.toContain("not_closed");
  });

  it("ca 3 · sau G7, CS ghi 10 giờ tháng 11 vào task bảo trì Milestone 4 (cost rate 160.000): Bị loại, lý do Sau mốc đóng P&L; P&L dự án không đổi; dòng Chi phí sau nghiệm thu tháng 11 tăng 1.600.000 đ ở P&L dự án và ở Tổng quan", async () => {
    const s = scenario({ now: "2026-12-01T03:00:00.000Z" });
    s.approveG7("2026-10-30");
    const before = await s.project();
    const dashboardBefore = (await s.pnl.dashboard({ year: 2026 }, founder)).data;
    const [entryId] = s.log({ userId: "u-cs", taskId: "t-maint", month: "2026-11", hours: 10 }).slice(0, 1);
    await s.approveCost("u-cs", "2026-11", 26_880_000); // tháng 11: 21 ngày × 8 = 168 giờ → 160.000 đ/giờ
    const entries = (await s.pnl.entries({ projectId: "p-a", status: "excluded" }, founder)).data;
    expect(entries.find((row) => row.id === entryId)).toMatchObject({ status: "excluded", statusLabel: "Bị loại", reason: "after_close", reasonLabels: ["Sau mốc đóng P&L"], hourlyCostRate: 160_000 });
    const after = await s.project();
    expect(after.totals.cost).toEqual(before.totals.cost);
    expect(after.totals.ebit.amount).toBe(before.totals.ebit.amount);
    expect(after.months.whole.excludedMinutes).toBe(hours(10));
    expect(after.months.afterClose).toMatchObject({ visible: true, minutes: hours(10), amount: 1_600_000, rows: [{ periodKey: "2026-11", minutes: hours(10), amount: 1_600_000 }] });
    const line = (data: typeof dashboardBefore) => data.companyCosts.lines.find((row) => row.key === "after_close")!.byMonth.find((row) => row.periodKey === "2026-11")!.amount as number;
    const dashboardAfter = (await s.pnl.dashboard({ year: 2026 }, founder)).data;
    expect(line(dashboardAfter) - line(dashboardBefore)).toBe(1_600_000);
    expect(dashboardAfter.companyCosts.lines.find((row) => row.key === "after_close")!.label).toBe("Chi phí sau nghiệm thu chưa tính vào dự án");
  });

  /** Dự án mới ở ca 4: chưa có hợp đồng, BD ghi 6 giờ Pre-sale tháng 09 (cost rate BD tháng 09 là 180.000 đ/giờ). */
  function newDeal() {
    const s = scenario();
    s.db.table("project").push({ id: "p-new", workspaceId: WS, code: "DA-NEW", name: "Dự án mới", status: "planning", projectType: "delivery", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-09-01T02:00:00.000Z") });
    s.db.table("projectPnlRecord").push({ id: "ppr_p-new", workspaceId: WS, projectId: "p-new", overrideDisabledCodes: [], overrideEnabledCodes: [], contractStatus: "draft", frozenDisabledCodes: [], frozenAt: null });
    s.db.table("projectGate").push({ id: "g1-new", projectId: "p-new", code: "G1", status: "not_submitted", decidedAt: null }, { id: "g7-new", projectId: "p-new", code: "G7", status: "not_submitted", decidedAt: null });
    s.db.table("projectStage").push({ id: "st-new", projectId: "p-new", activity: "Validate", sortOrder: 10, taskTypeLayer1: "PRE_SALE", afterPnlClose: false, ownerUserId: "u-bd", plannedStartAt: null, plannedEndAt: null });
    s.db.table("projectTask").push({ id: "t-new", workspaceId: WS, projectId: "p-new", stageId: "st-new", parentTaskId: null, title: "Pre-sale deal mới", taskTypeLayer1: "PRE_SALE", contractItemId: null, estimateMinutes: 0, assigneeUserId: "u-bd" });
    s.db.table("resourceMonthlyCost").push(staffCost("u-bd", "2026-09", 30_240_000));
    const ids = s.log({ userId: "u-bd", taskId: "t-new", month: "2026-09", hours: 6, createdAt: "2026-09-01T10:00:00.000Z" });
    return { ...s, ids };
  }

  it("ca 4 · dự án mới, BD ghi 6 giờ Pre-sale tháng 09 khi chưa có hợp đồng: Chờ xử lý, lý do chưa có hạng mục; không tính hạn 10 ngày. Khi hạng mục gốc được tạo: tự chuyển sang hạng mục gốc và thành Được tính", async () => {
    const s = newDeal();
    const pending = (await s.pnl.entries({ projectId: "p-new" }, founder)).data;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ minutes: hours(6), status: "pending", statusLabel: "Chờ xử lý", reason: "missing_contract_item", reasonLabels: ["Chưa có hạng mục"], awaitingContract: true, contractItemId: null });
    // Logged on 01/09 and read on 12/10 — far beyond 10 working days — yet no deadline and not overdue.
    expect(pending[0].deadline).toBeUndefined();
    expect(pending[0].overdue).toBeUndefined();
    expect(await s.pnl.pendingHoursForAlerts(WS, ["p-new"])).toEqual([]);
    expect((await s.project({}, "p-new")).header).toMatchObject({ recordState: "awaiting_contract", recordStateLabel: "Chờ hợp đồng", result: { label: "not_computable", labelText: "Không tính được" } });

    s.db.table("projectContractItem").push({ id: "hm-new", workspaceId: WS, projectId: "p-new", code: "HM-01", name: "Hạng mục gốc", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 40_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
    const included = (await s.pnl.entries({ projectId: "p-new" }, founder)).data;
    expect(included[0]).toMatchObject({ status: "included", statusLabel: "Được tính", contractItemId: "hm-new", costAmount: 1_080_000, awaitingContract: false });
  });

  it("ca 5 · dự án ở ca 4 đóng với lý do Thua deal: 6 giờ không vào P&L dự án nào; dòng Chi phí Pre-sale tháng 09 tăng 1.080.000 đ", async () => {
    const s = newDeal();
    const preSale = async () => (await s.pnl.dashboard({ year: 2026 }, founder)).data.companyCosts.lines.find((row) => row.key === "pre_sale")!;
    const before = await preSale();
    Object.assign(s.db.table("project").find((row) => row.id === "p-new") as object, { status: "closed" });
    s.db.table("projectStatusHistory").push({ id: "psh-1", projectId: "p-new", fromStatus: "planning", toStatus: "closed", closeReasonCode: "lost_deal", changedAt: new Date("2026-10-05T03:00:00.000Z") });
    const entry = (await s.pnl.entries({ projectId: "p-new" }, founder)).data[0];
    expect(entry).toMatchObject({ status: "excluded", reason: "lost_deal_pre_sale" });
    const project = await s.project({}, "p-new");
    expect(project.header).toMatchObject({ recordState: "lost_deal", recordStateLabel: "Đóng, thua deal" });
    expect(project.months.whole).toMatchObject({ includedMinutes: 0, laborCostAmount: 0 });
    const after = await preSale();
    const of = (line: typeof after) => line.byMonth.find((row) => row.periodKey === "2026-09")!.amount as number;
    expect(of(after) - of(before)).toBe(1_080_000);
    expect(after).toMatchObject({ label: "Chi phí Pre-sale", minutes: hours(6) });
    // …and no project's P&L took them: Dự án A is unchanged and the lost deal is on neither tab of the dashboard.
    expect((await s.project()).totals.cost.totalAmount).toBe(30_970_000);
    const dashboard = (await s.pnl.dashboard({ year: 2026 }, founder)).data;
    expect([...dashboard.accepted.rows, ...dashboard.inProgress.rows].map((row) => row.projectId)).not.toContain("p-new");
  });

  it("ca 6 · tháng 08 đã khóa; A ghi bù 2 giờ vào ngày 28/08: giờ lưu trên Timesheet, Chờ xử lý lý do Tháng đã khóa; số tháng 08 giữ nguyên theo ảnh chụp; Admin mở lại kỳ 08 thì giờ được xét lại", async () => {
    const s = scenario();
    await s.pnl.lockPeriod("2026-08", founder);
    const [lateId] = s.log({ userId: "u-a", taskId: "t-build-a", dateKey: "2026-08-28", hours: 2, createdAt: "2026-10-12T02:00:00.000Z" });
    expect(s.db.table("taskTimeEntry").some((row) => row.id === lateId)).toBe(true); // vẫn lưu trên Timesheet
    const late = (await s.pnl.entries({ projectId: "p-a", periodKey: "2026-08", status: "pending" }, founder)).data;
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ id: lateId, reason: "locked_period", reasonLabels: ["Tháng đã khóa"], blocksG7: false, target: "periods" });
    const locked = await s.project();
    expect(month(locked, "2026-08")).toMatchObject({ periodState: "locked", periodStateLabel: "Đã khóa", fromSnapshot: true, includedMinutes: hours(139), laborCostAmount: 21_340_000, fundCostAmount: 1_260_000, totalCostAmount: 22_600_000, loggedMinutes: hours(141), pendingMinutes: hours(2) });
    // The snapshot holds even if an input of the locked month is changed behind the lock.
    Object.assign(s.db.table("resourceMonthlyCost").find((row) => row.userId === "u-a" && row.periodKey === "2026-08") as object, { totalMonthlyIncome: 99_000_000 });
    expect(month(await s.project(), "2026-08").laborCostAmount).toBe(21_340_000);
    Object.assign(s.db.table("resourceMonthlyCost").find((row) => row.userId === "u-a" && row.periodKey === "2026-08") as object, { totalMonthlyIncome: 25_200_000 });

    await expect(s.pnl.reopenPeriod("2026-08", { reason: "" }, founder)).rejects.toThrow("lý do");
    await s.pnl.reopenPeriod("2026-08", { reason: "Xét lại giờ ghi bù ngày 28/08" }, founder);
    const reopened = await s.project();
    expect(month(reopened, "2026-08")).toMatchObject({ periodState: "awaiting_lock", fromSnapshot: false, includedMinutes: hours(141), pendingMinutes: 0, laborCostAmount: 21_340_000 + 2 * 150_000 });
  });

  it("ca 7 · dự án thử nghiệm có giờ log trong tháng 09: không có trong Tổng quan, không nhận phần chia quỹ, không sinh cảnh báo", async () => {
    const s = scenario();
    s.db.table("project").push({ id: "p-test", workspaceId: WS, code: "TEST-001", name: "Test 001", status: "completed", projectType: "delivery", isTestProject: true, accountId: "acc-a", createdAt: new Date("2026-08-15T02:00:00.000Z") });
    s.db.table("projectGate").push({ id: "g1-t", projectId: "p-test", code: "G1", status: "approved", decidedAt: new Date("2026-08-16T03:00:00.000Z") }, { id: "g7-t", projectId: "p-test", code: "G7", status: "approved", decidedAt: new Date("2026-09-25T03:00:00.000Z") });
    s.db.table("projectContractItem").push({ id: "hm-t", workspaceId: WS, projectId: "p-test", code: "HM-01", name: "Thử", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 10_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
    s.db.table("projectStage").push({ id: "st-t", projectId: "p-test", activity: "Build", sortOrder: 10, taskTypeLayer1: "DELIVERY", afterPnlClose: false, ownerUserId: "u-pm", plannedStartAt: new Date("2026-08-17T02:00:00.000Z"), plannedEndAt: null });
    s.db.table("projectTask").push({ id: "t-test", workspaceId: WS, projectId: "p-test", stageId: "st-t", parentTaskId: null, title: "Thử", taskTypeLayer1: "DELIVERY", contractItemId: "hm-t", estimateMinutes: 0, assigneeUserId: "u-a" });
    s.log({ userId: "u-a", taskId: "t-test", dateKey: "2026-09-21", hours: 8 }); // Được tính: A has a September rate
    s.log({ userId: "u-b", taskId: "t-test", dateKey: "2026-09-01", hours: 4, createdAt: "2026-09-01T10:00:00.000Z" }); // Chờ xử lý, long overdue

    // Không có trong Tổng quan — whichever rule picks the projects.
    for (const rule of ["started_and_accepted", "accepted_in_period"] as const) {
      const dashboard = (await s.pnl.dashboard({ year: 2026, rule }, founder)).data;
      expect([...dashboard.accepted.rows, ...dashboard.inProgress.rows].map((row) => row.projectId)).not.toContain("p-test");
      expect(dashboard.filter.excludedTestProjectCount).toBe(1);
      expect(dashboard.totals.projectCount).toBe(0);
    }
    // Không nhận phần chia quỹ: the September split only knows Dự án A.
    const fund = (await s.pnl.funds({ periodKey: "2026-09" }, founder)).data.funds[0];
    expect(fund.preview.rows.map((row) => [row.projectId, row.includedMinutes, row.amount])).toEqual([["p-a", hours(29), 5_260_000]]);
    // Không sinh cảnh báo: nothing reaches DL-01, and the trial project's pending hours do not hold the month open.
    expect(await s.pnl.pendingHoursForAlerts(WS, ["p-test"])).toEqual([]);
    const overdue = (await s.pnl.entries({ projectId: "p-test", status: "pending" }, founder)).data;
    expect(overdue).toHaveLength(1);
    expect(overdue[0].deadline).toBeUndefined();
    const checklist = (await s.pnl.periods({ periodKey: "2026-09" }, founder)).data.selected!.checklist;
    expect(checklist.find((row) => row.key === "pending_hours")!.detail).toBe("còn 105,5 giờ");
  });

  it("ca 8 · A ghi 2 giờ tháng 09 vào task của HM-01 nhưng chọn Lớp 2 là Nội bộ: Chờ xử lý, lý do Lớp 2 không khớp; G7 chưa duyệt được; sửa thành Dự án tính phí thì Được tính, chi phí tháng 09 tăng 324.762 đ (2 × 162.381 đ)", async () => {
    const s = scenario();
    const before = await s.project();
    const [entryId] = s.log({ userId: "u-a", taskId: "t-build-a", dateKey: "2026-09-28", hours: 2, selected: "INTERNAL_PROJECT" });
    const wrong = (await s.pnl.entries({ projectId: "p-a", group: "layer2_mismatch" }, founder)).data;
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toMatchObject({ id: entryId, minutes: hours(2), status: "pending", reason: "layer2_mismatch", reasonLabels: ["Lớp 2 không khớp"], taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "INTERNAL_PROJECT", blocksG7: true, target: "pending_hours" });
    // G7 chưa duyệt được khi còn 2 giờ này — while B's 105,5 giờ chờ cost rate do not count.
    expect(await s.pnl.pendingHoursBlockingG7(WS, "p-a")).toEqual({ projectId: "p-a", blockingMinutes: hours(2), entryCount: 1, byReason: [{ reason: "layer2_mismatch", label: "Lớp 2 không khớp", minutes: hours(2), entryCount: 1 }], waitingCostRateMinutes: hours(105.5) });
    const pending = await s.project();
    expect(month(pending, "2026-09").laborCostAmount).toBe(month(before, "2026-09").laborCostAmount);
    expect(pending.header.result.reasons.map((reason) => reason.label)).toContain("2 giờ chọn Lớp 2 không khớp");

    Object.assign(s.db.table("taskTimeEntry").find((row) => row.id === entryId) as object, { selectedTaskTypeLayer2: "CUSTOMER_PROJECT" });
    expect(await s.pnl.pendingHoursBlockingG7(WS, "p-a")).toMatchObject({ blockingMinutes: 0 });
    const fixed = await s.project();
    expect(month(fixed, "2026-09").includedMinutes).toBe(hours(31));
    expect((month(fixed, "2026-09").laborCostAmount as number) - (month(before, "2026-09").laborCostAmount as number)).toBe(324_762);
  });
});
