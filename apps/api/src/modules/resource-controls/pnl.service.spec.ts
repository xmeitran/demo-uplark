/**
 * Layers 0, 1, 3 and 4 through the real services over the in-memory database, on the document's sample project
 * (pnl-scenario.testing.ts). The chain itself is specified in pnl-rules / pnl-tree / pnl-engine specs and Phụ lục B.
 */
import { describe, expect, it } from "vitest";
import { redactMoney } from "./pnl.service";
import { adminNoCost, founder, hours, plainUser, scenario, WS } from "./pnl-scenario.testing";

/** Dự án A accepted on 30/09 with every input complete and both months locked: the "Chính thức" end state. */
async function closedScenario() {
  const s = scenario();
  await s.approveCost("u-b", "2026-09", 25_200_000);
  await s.pnl.confirmFund("fund-ai", "2026-09", founder);
  s.approveG7("2026-09-30");
  await s.pnl.lockPeriod("2026-08", founder);
  await s.pnl.lockPeriod("2026-09", founder);
  return s;
}

describe("quyền (PL-26)", () => {
  it("User không vào tab P&L", async () => {
    const s = scenario();
    await expect(s.pnl.dashboard({}, plainUser)).rejects.toThrow("Admin");
    await expect(s.pnl.project("p-a", {}, plainUser)).rejects.toThrow("Admin");
    await expect(s.config.items(plainUser)).rejects.toThrow("Admin");
    await expect(s.config.setProjectValue("p-a", { amount: 1_000_000 }, plainUser)).rejects.toThrow("PM");
  });

  it("Admin ngoài nhóm quyền chi phí: hours are shown, every money figure is null, the two collapsed details stay closed", async () => {
    const s = scenario();
    const { data, meta } = await s.pnl.project("p-a", {}, adminNoCost);
    expect(meta).toMatchObject({ moneyVisible: false, canEdit: false, canApprove: false });
    expect(data.months.whole).toMatchObject({ loggedMinutes: hours(273.5), includedMinutes: hours(168), laborCostAmount: null, otherCostAmount: null, totalCostAmount: null });
    expect(data.totals.revenue.amount).toBeNull();
    expect(data.totals.cost).toEqual({ totalAmount: null, laborAmount: null, otherAmount: null });
    expect(data.totals.ebit).toMatchObject({ amount: null, marginPercent: null });
    expect(data.people.every((row) => row.laborCostAmount === null)).toBe(true);
    expect(data.items).toBeNull();
    expect(data.history).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/30970000|26350000|67200000|3360000/);
    const entries = await s.pnl.entries({ projectId: "p-a" }, adminNoCost);
    expect(entries.data.every((row) => row.hourlyCostRate === null && row.costAmount === null)).toBe(true);
    expect(entries.meta.totalCostAmount).toBeNull();
  });

  it("chi phí theo tháng: chỉ nhóm quyền chi phí xem và sửa; khóa kỳ, duyệt and Nhập tay need the matching right", async () => {
    const s = scenario();
    await expect(s.config.staffCosts({ periodKey: "2026-09" }, adminNoCost)).rejects.toThrow();
    await expect(s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", baseSalaryAmount: 1 }, adminNoCost)).rejects.toThrow("COST_EDIT");
    await expect(s.config.approveStaffCosts({ periodKey: "2026-09" }, adminNoCost)).rejects.toThrow("COST_APPROVE");
    await expect(s.pnl.lockPeriod("2026-08", adminNoCost)).rejects.toThrow("COST_APPROVE");
    await expect(s.config.createManualCost("p-a", { itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-09", label: "x", amount: 1 }, adminNoCost)).rejects.toThrow("COST_EDIT");
  });

  it("Tổng quan for an Admin outside the cost group: projects, hours and labels, no amount anywhere", async () => {
    const s = await closedScenario();
    const { data, meta } = await s.pnl.dashboard({ year: 2026 }, adminNoCost);
    expect(meta.moneyVisible).toBe(false);
    expect(data.totals).toMatchObject({ projectCount: 1, revenueAmount: null, totalCostAmount: null, laborCostAmount: null, otherCostAmount: null, ebitAmount: null, marginPercent: null, result: { label: "official" } });
    expect(data.accepted.rows[0]).toMatchObject({ projectName: "Dự án A", revenueAmount: null, laborCostAmount: null, ebitAmount: null, costByRoleGroup: { DELIVERY: null, PM: null, BD: null, FUND: null, COMMISSION: null } });
    expect(data.accepted.reconciliation.loggedMinutes).toBe(hours(273.5));
    expect(data.companyCosts.lines.every((line) => line.amount === null)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/\d{7,}/); // no figure of a million đồng or more survives
  });

  it("redactMoney nulls money keys only", () => {
    expect(redactMoney({ laborCostAmount: 5, amount: 7, hourlyCostRate: 3, marginPercent: 2, sharePercent: 40, loggedMinutes: 60, nested: [{ totalAmount: 1, label: "x" }] }))
      .toEqual({ laborCostAmount: null, amount: null, hourlyCostRate: null, marginPercent: null, sharePercent: 40, loggedMinutes: 60, nested: [{ totalAmount: null, label: "x" }] });
  });
});

describe("lớp 4 — Tổng quan P&L", () => {
  it("trạng thái gốc: Dự án A chưa qua G7 nên ở tab Đang triển khai — vẫn hiện doanh thu nhập tay, chưa có EBIT và không cộng vào ô tổng", async () => {
    const { data } = await scenario().pnl.dashboard({ year: 2026 }, founder);
    expect(data.filter).toMatchObject({ year: 2026, unit: "year", rule: "started_and_accepted", fromPeriodKey: "2026-01", toPeriodKey: "2026-12", countedProjectCount: 0, excludedTestProjectCount: 0 });
    expect(data.totals).toMatchObject({ projectCount: 0, revenueAmount: null, totalCostAmount: 0, ebitAmount: null, marginPercent: null });
    expect(data.accepted.rows).toEqual([]);
    expect(data.pending).toEqual([]); // nothing accepted, nothing to explain
    expect(data.inProgress).toMatchObject({ total: 1 });
    expect(data.inProgress.rows[0]).toMatchObject({ projectId: "p-a", projectName: "Dự án A", accountName: "Khách A", picName: "BD-1", startedOn: "2026-08-03", acceptedOn: null, revenueAmount: 67_200_000, ebitAmount: null, marginPercent: null, laborCostAmount: 26_350_000, otherCostAmount: 4_620_000, totalCostAmount: 30_970_000, result: { label: "provisional" } });
  });

  it("đã nghiệm thu, đủ dữ liệu, mọi tháng khóa: năm ô tổng, dòng tổng, đối soát, nhãn Chính thức, chi phí theo hai cách nhóm", async () => {
    const s = await closedScenario();
    const { data } = await s.pnl.dashboard({ year: 2026 }, founder);
    // Doanh thu ghi nhận = Giá trị dự án 67.200.000 (PL-14).
    // labor 21.340.000 + 5.010.000 + 15.825.000; other = quỹ 1.260.000 + 5.260.000 + hoa hồng 67.200.000 × 5% = 3.360.000
    expect(data.totals).toMatchObject({ projectCount: 1, revenueAmount: 67_200_000, laborCostAmount: 42_175_000, otherCostAmount: 9_880_000, totalCostAmount: 52_055_000, ebitAmount: 15_145_000, provisionalProjectCount: 0, result: { label: "official", labelText: "Chính thức" } });
    expect((data.totals.marginPercent as number).toFixed(1)).toBe("22.5");
    expect(data.pending).toEqual([]); // ẩn khi không còn gì chờ
    expect(data.accepted.rows).toHaveLength(1);
    expect(data.accepted.rows[0]).toMatchObject({ projectId: "p-a", acceptedOn: "2026-09-30", revenueAmount: 67_200_000, ebitAmount: 15_145_000, result: { label: "official" }, adjustedAfterClose: false });
    expect(data.accepted.totalRow).toMatchObject({ revenueAmount: data.totals.revenueAmount, laborCostAmount: data.totals.laborCostAmount, otherCostAmount: data.totals.otherCostAmount, ebitAmount: data.totals.ebitAmount });
    expect(data.accepted.reconciliation).toMatchObject({ loggedMinutes: hours(273.5), includedMinutes: hours(273.5), pendingMinutes: 0, excludedMinutes: 0, balanced: true });
    expect(data.inProgress.total).toBe(0);
    const amounts = (rows: typeof data.costGroups.role) => Object.fromEntries(rows.map((row) => [row.label, row.amount]));
    expect(amounts(data.costGroups.role)).toEqual({ "Delivery/DX": 38_435_000, PM: 3_200_000, BD: 540_000, "Quỹ chung": 6_520_000, "Hoa hồng": 3_360_000 });
    expect(amounts(data.costGroups.accounting)).toEqual({ "Salaries related": 42_175_000, "Functional operation": 6_520_000, "Hoa hồng": 3_360_000 });
    expect(data.costGroups.role.reduce((total, row) => total + (row.sharePercent as number), 0)).toBeCloseTo(100, 2);
    // Bấm một nhóm thì bảng dự án lọc theo nhóm đó.
    expect((await s.pnl.dashboard({ year: 2026, groupKey: "FUND" }, founder)).data.accepted.total).toBe(1);
    expect((await s.pnl.dashboard({ year: 2026, groupKey: "CS" }, founder)).data.accepted.total).toBe(0);
  });

  it("bộ lọc: kỳ, quy tắc chọn dự án, loại dự án, khách hàng, PIC; phân trang có tổng số", async () => {
    const s = await closedScenario();
    const count = async (query: Record<string, unknown>) => (await s.pnl.dashboard(query, founder)).data.accepted.total;
    expect(await count({ year: 2026, unit: "quarter", index: 3 })).toBe(1);
    expect(await count({ year: 2026, unit: "quarter", index: 4 })).toBe(0); // started in Q3
    expect(await count({ year: 2026, unit: "month", index: 9, rule: "accepted_in_period" })).toBe(1);
    expect(await count({ year: 2026, unit: "month", index: 9 })).toBe(0); // default rule looks at the start month (08)
    expect(await count({ year: 2025 })).toBe(0);
    // PIC = the owner of the project's first stage (BD-1 owns Validate), as on every other screen — not the PM_OWNER member.
    expect(await count({ year: 2026, projectType: "customer", accountId: "acc-a", picUserId: "u-bd" })).toBe(1);
    expect(await count({ year: 2026, projectType: "internal" })).toBe(0);
    expect(await count({ year: 2026, picUserId: "u-pm" })).toBe(0);
    // Several values arrive comma-joined: a project matches when it has one of them.
    expect(await count({ year: 2026, projectType: "internal,customer", accountId: "acc-x,acc-a", picUserId: "u-pm,u-bd" })).toBe(1);
    expect(await count({ year: 2026, accountId: "acc-x,acc-y" })).toBe(0);
    // q: project name, code or client name, without accents or case.
    expect(await count({ year: 2026, q: "du an a" })).toBe(1);
    expect(await count({ year: 2026, q: "KHACH a" })).toBe(1);
    expect(await count({ year: 2026, q: "da-a" })).toBe(1);
    expect(await count({ year: 2026, q: "không có" })).toBe(0);
    // unit "custom": the same selection rule over any month range.
    const custom = (await s.pnl.dashboard({ unit: "custom", fromMonth: "2026-07", toMonth: "2026-08" }, founder)).data;
    expect(custom.filter).toMatchObject({ unit: "custom", index: null, fromPeriodKey: "2026-07", toPeriodKey: "2026-08" });
    expect(custom.accepted.total).toBe(1);
    expect(custom.companyCosts.periodKeys).toEqual(["2026-07", "2026-08"]);
    expect(await count({ unit: "custom", fromMonth: "2026-09", toMonth: "2026-12" })).toBe(0);
    expect(await count({ unit: "custom", fromMonth: "2026-09", toMonth: "2026-12", rule: "accepted_in_period" })).toBe(1);
    await expect(s.pnl.dashboard({ unit: "custom" }, founder)).rejects.toThrow("fromMonth");
    await expect(s.pnl.dashboard({ unit: "custom", fromMonth: "2026-09", toMonth: "2026-08" }, founder)).rejects.toThrow("Khoảng tháng");
    await expect(s.pnl.dashboard({ unit: "custom", fromMonth: "2020-01", toMonth: "2026-08" }, founder)).rejects.toThrow("Khoảng tháng");
    const paged = (await s.pnl.dashboard({ year: 2026, page: 2, pageSize: 1 }, founder)).data;
    expect(paged.accepted).toMatchObject({ total: 1, page: 2, pageSize: 1, rows: [] });
    expect(paged.totals.projectCount).toBe(1); // ô tổng tính trên toàn danh sách, not the page
    await expect(s.pnl.dashboard({ unit: "week" as never }, founder)).rejects.toThrow("unit");
  });

  it("Tạm tính: the strip says why, by kind, with where to fix it; the tile counts the provisional projects", async () => {
    const s = scenario();
    s.approveG7("2026-09-30");
    const { data } = await s.pnl.dashboard({ year: 2026 }, founder);
    expect(data.totals.result).toMatchObject({ label: "provisional", labelText: "Tạm tính · 1 dự án" });
    expect(data.pending.map((row) => [row.kind, row.label, row.target])).toEqual([
      ["cost_rate", "105,5 giờ chờ cost rate", "staff_costs"],
      ["fund_unallocated", "quỹ tháng 09 chưa chia", "funds"],
      ["months_unlocked", "tháng 08, 09 chưa khóa", "periods"]
    ]);
    expect(data.pending[0]).toMatchObject({ minutes: hours(105.5), userCount: 1 });
  });

  it("bảng tất cả dự án không loại dự án chưa nghiệm thu", async () => {
    const s = await closedScenario();
    s.db.table("project").push({
      id: "p-open", workspaceId: WS, code: "DA-OPEN", name: "Dự án đang triển khai", status: "active", projectType: "delivery",
      isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-10-01T02:00:00.000Z")
    });

    const { data } = await s.pnl.dashboard({ year: 2026 }, founder);
    expect((data as any).all.rows.map((row: { projectId: string }) => row.projectId)).toEqual(["p-a", "p-open"]);
    expect((data as any).all.rows.find((row: { projectId: string }) => row.projectId === "p-open")).toMatchObject({ acceptedOn: null, revenueAmount: null, ebitAmount: null });
    expect(data.totals.projectCount).toBe(1);
  });

  it("A-3: nghiệm thu sau khi mọi tháng của kỳ lọc đã khóa → “điều chỉnh sau chốt”", async () => {
    const s = scenario({ now: "2026-11-10T03:00:00.000Z" });
    await s.approveCost("u-b", "2026-09", 25_200_000);
    await s.pnl.confirmFund("fund-ai", "2026-09", founder);
    await s.pnl.lockPeriod("2026-08", founder);
    await s.pnl.lockPeriod("2026-09", founder);
    s.approveG7("2026-11-20"); // decided after both locks (the fixture's clock is 10/11)
    s.setNow("2026-11-25T03:00:00.000Z");
    // Filter 08/2026 (the project's start month): its one month was locked before the acceptance.
    const row = (await s.pnl.dashboard({ year: 2026, unit: "month", index: 8 }, founder)).data.accepted.rows[0];
    expect(row).toMatchObject({ projectId: "p-a", adjustedAfterClose: true });
    // Quý 3 still has an open month (07/2026 was never locked): nothing reported was changed behind a lock.
    expect((await s.pnl.dashboard({ year: 2026, unit: "quarter", index: 3 }, founder)).data.accepted.rows[0].adjustedAfterClose).toBe(false);
  });

  it("khối 6: chi phí ngoài P&L dự án theo tháng phát sinh trong kỳ, with the list by person and project behind each line", async () => {
    const s = scenario();
    s.db.table("project").push({ id: "p-wl", workspaceId: WS, code: "DX-INT", name: "DX Internal Worklog", status: "active", projectType: "internal_worklog", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-01-01T00:00:00.000Z") });
    s.db.table("projectTask").push({ id: "t-int", workspaceId: WS, projectId: "p-wl", stageId: null, parentTaskId: null, title: "Họp nội bộ", taskTypeLayer1: "DELIVERY", contractItemId: null, estimateMinutes: 0, assigneeUserId: null });
    s.log({ userId: "u-a", taskId: "t-int", dateKey: "2026-09-29", hours: 4, taskLayer2: "INTERNAL_PROJECT" });
    const { data } = await s.pnl.dashboard({ year: 2026, unit: "month", index: 9 }, founder);
    expect(data.companyCosts.periodKeys).toEqual(["2026-09"]);
    expect(data.companyCosts.lines.map((line) => [line.key, line.label])).toEqual([["pre_sale", "Chi phí Pre-sale"], ["after_close", "Chi phí sau nghiệm thu chưa tính vào dự án"], ["internal", "Chi phí nội bộ"], ["unallocated", "Chi phí nhân sự chưa phân bổ"]]);
    const internal = data.companyCosts.lines.find((line) => line.key === "internal")!;
    expect(internal).toMatchObject({ amount: 649_524, minutes: hours(4) }); // 4 × 27.280.000 ÷ 168
    expect(data.companyCosts).toMatchObject({ staffCostAmount: 60_880_000, projectLaborAmount: 5_010_000, balanced: true });
    const detail = await s.pnl.companyCostDetail({ from: "2026-09", line: "internal" }, founder);
    expect(detail.data).toEqual([{ line: "internal", periodKey: "2026-09", userId: "u-a", userName: "Nhân sự A", projectId: "p-wl", projectName: "DX Internal Worklog", minutes: hours(4), amount: 649_524 }]);
    // The internal worklog project is never a row of the dashboard.
    expect([...data.accepted.rows, ...data.inProgress.rows].map((row) => row.projectId)).not.toContain("p-wl");
  });
});

describe("lớp 4 — P&L dự án", () => {
  it("khối 1: thông tin, phạm vi; thu hẹp Từ tháng – Đến tháng chỉ trong khoảng của dự án", async () => {
    const s = scenario();
    const whole = await s.project();
    expect(whole.header).toMatchObject({ projectName: "Dự án A", accountName: "Khách A", templateName: "Khách hàng", picName: "BD-1", plannedStartOn: "2026-08-03", plannedEndOn: "2026-10-30", closeGate: "G7", isTestProject: false });
    expect(whole.header.scope).toEqual({ whole: true, fromPeriodKey: null, toPeriodKey: null, minPeriodKey: "2026-08", maxPeriodKey: "2026-10" });
    const narrowed = await s.project({ fromMonth: "2026-09", toMonth: "2026-09" });
    expect(narrowed.months.rows.map((row) => row.periodKey)).toEqual(["2026-09"]);
    expect(narrowed.totals).toMatchObject({ loggedMinutes: hours(134.5), monthsWithHours: 1, cost: { totalAmount: 5_010_000, laborAmount: 5_010_000, otherAmount: 0 } });
    expect(narrowed.totals.revenue).toMatchObject({ amount: null, wholeProjectOnly: true, note: "Chỉ xem ở Toàn dự án" });
    expect(narrowed.totals.ebit).toMatchObject({ amount: null, wholeProjectOnly: true });
    expect(narrowed.months.whole.totalCostAmount).toBe(narrowed.totals.cost.totalAmount);
    expect(narrowed.header.result).toEqual(whole.header.result);
    await expect(s.project({ fromMonth: "2026-06", toMonth: "2026-09" })).rejects.toThrow("Phạm vi");
    await expect(s.pnl.project("nope", {}, founder)).rejects.toThrow("workspace");
  });

  it("khối 4: bấm một tháng — bảng người × ngày (ngày lễ đánh dấu), xem theo task, đối soát của tháng", async () => {
    const s = scenario();
    s.db.table("personalLeave").push({ id: "pl-1", workspaceId: WS, userId: "u-a", startDate: new Date("2026-09-10T00:00:00.000Z"), endDate: new Date("2026-09-11T00:00:00.000Z"), status: "approved" });
    const [september] = (await s.pnl.projectMonths("p-a", "2026-09", founder)).data;
    expect(september).toMatchObject({ periodKey: "2026-09", periodState: "awaiting_lock", standardMinutes: 168 * 60 });
    expect(september.days).toHaveLength(30);
    expect(september.days.find((day) => day.dateKey === "2026-09-02")).toEqual({ dateKey: "2026-09-02", weekend: false, holiday: true, holidayName: "Quốc khánh" });
    expect(september.days.find((day) => day.dateKey === "2026-09-05")).toMatchObject({ weekend: true, holiday: false });
    const a = september.people.find((row) => row.userId === "u-a")!;
    expect(a).toMatchObject({ roleGroupLabel: "Delivery/DX", loggedMinutes: hours(21), includedMinutes: hours(21), laborCostAmount: 3_410_000, status: { ok: true, label: "Đủ" }, leaveDays: ["2026-09-10", "2026-09-11"] });
    expect(Math.round(a.hourlyCostRate as number)).toBe(162_381);
    expect(a.byDay.map((day) => [day.dateKey, day.loggedMinutes / 60])).toEqual([["2026-09-01", 8], ["2026-09-03", 8], ["2026-09-04", 5]]); // nothing on the holiday
    expect(september.people.find((row) => row.userId === "u-b")).toMatchObject({ hourlyCostRate: null, pendingMinutes: hours(105.5), laborCostAmount: null, status: { ok: false, label: "Chờ cost rate T09" } });
    expect(september.tasks.map((task) => [task.taskTitle, task.loggedMinutes / 60, task.laborCostAmount])).toEqual([["Xây dựng – B", 105.5, null], ["Xây dựng – A", 21, 3_410_000], ["Quản lý dự án", 8, 1_600_000]]);
    expect(september.reconciliation).toEqual({ loggedMinutes: hours(134.5), includedMinutes: hours(29), pendingMinutes: hours(105.5), excludedMinutes: 0, differenceMinutes: 0, balanced: true });
    // "Mở hết các tháng"
    expect((await s.pnl.projectMonths("p-a", "all", founder)).data.map((row) => row.periodKey)).toEqual(["2026-08", "2026-09"]);
  });

  it("khối 5: chi tiết theo khoản mục — nguồn số của từng dòng; dòng Nhập tay nhập theo tháng phát sinh, khóa theo kỳ; lịch sử ghi lại", async () => {
    const s = scenario();
    const created = await s.config.createManualCost("p-a", { itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-09", label: "Thuê ngoài thiết kế", amount: 2_000_000 }, founder);
    let data = await s.project();
    const item = (code: string) => data.items!.find((row) => row.code === code)!;
    expect(item("CP.FUNCOP.RIENG")).toMatchObject({ method: "MANUAL", methodLabel: "Nhập tay", amount: 2_000_000, source: { kind: "manual", byMonth: [{ periodKey: "2026-09", amount: 2_000_000 }] } });
    expect(item("CP.FUNCOP.RIENG").manualLines).toEqual([{ id: created.data.id, itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-09", occurredOn: "2026-09-01", label: "Thuê ngoài thiết kế", amount: 2_000_000, note: undefined, locked: false }]);
    expect(item("CP.NS.DELIVERY").source).toMatchObject({ kind: "hours", byMonth: [{ periodKey: "2026-08", amount: 19_200_000 }, { periodKey: "2026-09", amount: 3_410_000 }] });
    expect(item("CP.FUNCOP.AI").source).toMatchObject({ kind: "fund", byMonth: [{ periodKey: "2026-08", amount: 1_260_000 }] });
    expect(item("CP.HOAHONG").source).toMatchObject({ kind: "formula", description: "[Doanh thu dự án] × [Tỷ lệ hoa hồng]" });
    expect(item("CHIPHI")).toMatchObject({ method: "GROUP", methodLabel: "Tổng nhóm", level: 1, amount: 32_970_000 });
    expect(data.months.rows.find((row) => row.periodKey === "2026-09")).toMatchObject({ directCostAmount: 2_000_000, otherCostAmount: 2_000_000, totalCostAmount: 7_010_000 });
    expect(data.totals.ebit.amount).toBe(34_230_000);

    await s.config.updateManualCost("p-a", created.data.id, { itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-09", label: "Thuê ngoài thiết kế", amount: 2_500_000 }, founder);
    expect((await s.project()).totals.cost.totalAmount).toBe(33_470_000);
    // Only a Nhập tay item of the project's template takes a line.
    await expect(s.config.createManualCost("p-a", { itemCode: "CP.NS.PM", periodKey: "2026-09", label: "x", amount: 1 }, founder)).rejects.toThrow("Nhập tay");
    await expect(s.config.createManualCost("p-a", { itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-09", label: "x", amount: 0 }, founder)).rejects.toThrow("lớn hơn 0");
    // Khóa theo kỳ.
    await s.pnl.lockPeriod("2026-08", founder);
    await expect(s.config.createManualCost("p-a", { itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-08", label: "x", amount: 1 }, founder)).rejects.toThrow("đã khóa");
    await s.config.deleteManualCost("p-a", created.data.id, founder);
    data = await s.project();
    expect(data.totals.cost.totalAmount).toBe(30_970_000);
    expect(data.history!.map((event) => event.label)).toEqual(expect.arrayContaining(["Thêm chi phí riêng", "Sửa chi phí riêng", "Xóa chi phí riêng", "Khóa kỳ"]));
    expect(data.history!.find((event) => event.action === "pnl.period_locked")).toMatchObject({ periodKey: "2026-08", actorName: null });
  });

  it("dự án nội bộ (Loại Nội bộ, Đào tạo): có Doanh thu/EBIT nhập tay, nhưng giờ vẫn tính theo chi phí tiêu hao", async () => {
    const s = scenario();
    s.db.table("project").push({ id: "p-int", workspaceId: WS, code: "NB-01", name: "Chuẩn hóa quy trình", status: "active", projectType: "internal", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-09-01T02:00:00.000Z") });
    // Doanh thu nhập tay được đọc cho cả project Nội bộ.
    s.db.table("projectPnlRecord").push({ id: "ppr_p-int", workspaceId: WS, projectId: "p-int", overrideDisabledCodes: [], overrideEnabledCodes: [], projectValueAmount: 10_000_000, frozenDisabledCodes: [], frozenAt: null });
    s.db.table("projectTask").push({ id: "t-nb", workspaceId: WS, projectId: "p-int", stageId: null, parentTaskId: null, title: "Viết quy trình", taskTypeLayer1: "DELIVERY", estimateMinutes: 600, assigneeUserId: "u-a" });
    s.log({ userId: "u-a", taskId: "t-nb", dateKey: "2026-09-22", hours: 8, taskLayer2: "INTERNAL_PROJECT" });
    const data = await s.project({}, "p-int");
    expect(data.header).toMatchObject({ templateKey: "internal", templateName: "Nội bộ", recordState: "recognizing", recordStateLabel: "Đang ghi nhận" });
    expect(data.totals.revenue).toMatchObject({ amount: 10_000_000, basis: "project_value", label: "Doanh thu dự án", projectValueAmount: 10_000_000, canEdit: true });
    expect(data.totals.ebit).toMatchObject({ amount: 8_700_952, missingReason: null });
    expect(data.totals.consumable).toBe(true);
    expect(data.totals.cost).toMatchObject({ totalAmount: 1_299_048, laborAmount: 1_299_048 }); // 8 × 27.280.000 ÷ 168
    expect(data.months.whole).toMatchObject({ includedMinutes: 0, excludedMinutes: hours(8), excludedByReason: [{ reason: "internal", label: "Nội bộ", minutes: hours(8) }], laborCostAmount: 1_299_048 });
    expect(data.months.wholeProjectItems).toEqual([]);
    expect(data.items!.map((row) => row.code)).toEqual(expect.arrayContaining(["DOANHTHU", "DOANHTHU.GHINHAN", "KQ.EBIT"]));
    const dashboard = (await s.pnl.dashboard({ year: 2026 }, founder)).data;
    expect([...dashboard.accepted.rows, ...dashboard.inProgress.rows].map((row) => row.projectId)).toContain("p-int");
    expect(dashboard.companyCosts.lines.find((line) => line.key === "internal")!.amount).toBe(1_299_048); // cộng vào dòng Chi phí nội bộ
  });

  it("mục 6.6: dự án đã qua G7 giữ mẫu tại thời điểm nghiệm thu", async () => {
    const s = scenario();
    s.approveG7("2026-09-30");
    await s.project();
    const record = s.db.table("projectPnlRecord").find((row) => row.projectId === "p-a")!;
    expect(record.frozenAt).toBeInstanceOf(Date);
    await s.config.setTemplate("customer", { disabledCodes: ["CP.HOAHONG"] }, founder); // a later change of the template…
    expect((await s.project()).months.wholeProjectItems[0]).toMatchObject({ amount: 3_360_000, expected: false }); // …does not reach the closed project (67.200.000 × 5%)
    await expect(s.config.setTemplateOverride("p-a", { disabledCodes: ["CP.HOAHONG"], reason: "x" }, founder)).rejects.toThrow("G7");
  });
});

describe("lớp 3 — Kỳ và khóa kỳ (PL-23, PL-24)", () => {
  it("danh sách các tháng với trạng thái và số việc còn thiếu; checklist năm điều kiện của tháng đang chọn", async () => {
    const { data } = await scenario().pnl.periods({ periodKey: "2026-09" }, founder);
    expect(data.periods.map((card) => [card.periodKey, card.stateLabel, card.statusText])).toEqual([
      ["2026-07", "Chờ khóa", "Chờ khóa · còn 1 việc"], // no commission rate in force before 08/2026 (condition 1)
      ["2026-08", "Chờ khóa", "Chờ khóa · sẵn sàng"],
      ["2026-09", "Chờ khóa", "Chờ khóa · còn 3 việc"],
      ["2026-10", "Đang mở", "Đang mở · hiện tại"],
      ["2026-11", "Chưa mở", "Chưa mở"]
    ]);
    expect(data.selected).toMatchObject({ periodKey: "2026-09", state: "awaiting_lock", canLock: false, lockButtonText: "Khóa kỳ 09/2026 · còn 3 việc", snapshotNote: "Khóa lưu ảnh chụp tham số, cost rate, số chia quỹ, kết quả cổng lọc" });
    expect(data.selected!.checklist.map((row) => [row.ok, row.label, row.detail, row.targetLabel])).toEqual([
      [true, "Tham số có hiệu lực cho tháng", null, null],
      [false, "Không còn giờ Chờ xử lý của tháng", "còn 105,5 giờ", "Danh sách"],
      [false, "Mọi người có giờ log có chi phí tháng Đã duyệt", "thiếu: Nhân sự B", "Hồ sơ nhân sự"],
      [false, "Mọi quỹ của tháng đã chia đủ và xác nhận", "còn: Công cụ AI", "Quỹ chi phí chung"],
      [true, "Dự án qua G7 trong tháng có ngày nghiệm thu và doanh thu dự án", null, null]
    ]);
  });

  it("chỉ khóa khi đủ năm điều kiện, và chỉ tháng đã hết", async () => {
    const s = scenario();
    await expect(s.pnl.lockPeriod("2026-09", founder)).rejects.toThrow("kỳ 08/2026 có dữ liệu và chưa khóa"); // order first (pnl-remaining-fixes.spec.ts)
    await expect(s.pnl.lockPeriod("2026-10", founder)).rejects.toThrow("chưa hết tháng");
    await expect(s.pnl.lockPeriod("2026-11", founder)).rejects.toThrow("chưa hết tháng");
    expect(s.db.table("pnlPeriod")).toEqual([]);
    // (1) a month without the commission rate in force is not ready either
    s.db.table("pnlParameterValue").splice(0, 1);
    await expect(s.pnl.lockPeriod("2026-08", founder)).rejects.toThrow("Tỷ lệ hoa hồng");
    const ordered = scenario();
    await ordered.pnl.lockPeriod("2026-08", founder);
    await expect(ordered.pnl.lockPeriod("2026-09", founder)).rejects.toThrow("còn 3 việc");
  });

  it("khóa lưu ảnh chụp tham số, cost rate, số chia quỹ, kết quả cổng lọc; ghi người và thời điểm", async () => {
    const s = scenario();
    const locked = await s.pnl.lockPeriod("2026-08", founder);
    expect(locked.meta).toMatchObject({ locked: true, entryCount: 18, loggedMinutes: hours(139), includedMinutes: hours(139), pendingMinutes: 0, staffCostAmount: 89_040_000, projectLaborAmount: 21_340_000, fundAmount: 1_260_000, standardMinutes: 168 * 60 });
    const [snapshot] = s.db.table("pnlPeriodSnapshot");
    expect(snapshot).toMatchObject({ periodKey: "2026-08", lockedByUserId: "u-admin", lockedByName: "Admin chi phí" });
    expect(snapshot.reopenedAt ?? null).toBeNull();
    expect(snapshot.data).toMatchObject({ workingDays: 21, standardDayMinutes: 480, standardMinutes: 10080, parameters: { standardDayHours: 8, pnlCloseGate: "G7", commissionPercent: 5 } });
    expect(snapshot.data.staffCosts).toEqual(expect.arrayContaining([{ userId: "u-a", totalAmount: 25_200_000 }, { userId: "u-bd", totalAmount: 30_240_000 }, { userId: "u-pm", totalAmount: 33_600_000 }]));
    expect(snapshot.data.fundShares).toEqual([{ fundId: "fp-08", projectId: "p-a", itemCode: "CP.FUNCOP.AI", minutes: hours(139), amount: 1_260_000 }]);
    expect(snapshot.data.entries).toHaveLength(18);
    expect(snapshot.data.entries.every((entry: { s: string }) => entry.s === "included")).toBe(true);
    expect(s.db.table("auditEvent").find((event) => event.action === "pnl.period_locked")).toMatchObject({ actorUserId: "u-admin", resource: "pnl_period", after: { periodKey: "2026-08", status: "LOCKED" } });
    const card = (await s.pnl.periods({}, founder)).data.periods.find((row) => row.periodKey === "2026-08")!;
    expect(card).toMatchObject({ state: "locked", statusText: "Đã khóa · 12/10 · Admin chi phí" });
    await expect(s.pnl.lockPeriod("2026-08", founder)).rejects.toThrow("đã khóa");
  });

  it("tháng đã khóa: P&L lấy số từ ảnh chụp — a holiday, a parameter or a reclassification added later changes nothing", async () => {
    const s = scenario();
    await s.pnl.lockPeriod("2026-08", founder);
    s.db.table("workspaceDayOff").push({ id: "off-late", workspaceId: WS, isActive: true, date: new Date("2026-08-14T00:00:00.000Z"), name: "Nghỉ bù" });
    for (const entry of s.db.table("taskTimeEntry")) if (entry.userId === "u-bd") entry.contractItemId = null;
    s.db.table("pnlFundAllocation").splice(0, 1);
    const august = (await s.project()).months.rows.find((row) => row.periodKey === "2026-08")!;
    expect(august).toMatchObject({ fromSnapshot: true, includedMinutes: hours(139), laborCostAmount: 21_340_000, fundCostAmount: 1_260_000 });
    // The open month does follow the calendar: September is not locked.
    expect((await s.config.standardHours({ from: "2026-08", to: "2026-08" }, founder)).data[0]).toMatchObject({ workingDays: 21, standardHours: 168 });
  });

  it("các đầu vào của tháng đã khóa không sửa được: chi phí tháng, import, quỹ, tham số", async () => {
    const s = scenario();
    await s.pnl.lockPeriod("2026-08", founder);
    await expect(s.config.setStaffCost({ userId: "u-a", periodKey: "2026-08", baseSalaryAmount: 30_000_000 }, founder)).rejects.toThrow("đã khóa");
    await expect(s.config.importStaffCosts({ periodKey: "2026-08", rows: [{ employeeCode: "NS-012", baseSalaryAmount: 1 }] }, founder)).rejects.toThrow("đã khóa");
    await expect(s.config.approveStaffCosts({ periodKey: "2026-08" }, founder)).rejects.toThrow("đã khóa");
    await expect(s.pnl.setFundAmount("fund-ai", "2026-08", { sourceCurrency: "VND", sourceAmount: 1 }, founder)).rejects.toThrow("đã khóa");
    await expect(s.pnl.rerunFund("fund-ai", "2026-08", founder)).rejects.toThrow("đã khóa"); // khóa rồi thì không chia lại
    await expect(s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 6, effectiveFrom: "2026-08", reason: "x" }, founder)).rejects.toThrow("đã khóa");
  });

  it("mở lại: Admin, bắt buộc lý do; các tháng sau đó mở lại theo; lịch sử khóa – mở lại được giữ", async () => {
    const s = await closedScenario();
    expect((await s.project()).header).toMatchObject({ recordState: "official", recordStateLabel: "Chính thức", result: { label: "official" } });
    await expect(s.pnl.reopenPeriod("2026-08", {}, founder)).rejects.toThrow("lý do");
    await expect(s.pnl.reopenPeriod("2026-08", { reason: "Sửa" }, adminNoCost)).rejects.toThrow();
    const reopened = await s.pnl.reopenPeriod("2026-08", { reason: "Sửa chi phí tháng 08 của BD-1" }, founder);
    expect(reopened.meta.reopenedPeriodKeys).toEqual(["2026-08", "2026-09"]);
    expect(s.db.table("pnlPeriod").map((row) => [row.periodKey, row.status])).toEqual([["2026-08", "REOPENED"], ["2026-09", "REOPENED"]]);
    expect(s.db.table("pnlPeriod").find((row) => row.periodKey === "2026-09")!.reopenReason).toBe("Sửa chi phí tháng 08 của BD-1");
    const data = await s.project();
    expect(data.header).toMatchObject({ recordState: "closed", result: { label: "provisional" } }); // Chính thức → Đã đóng until locked again
    expect(data.header.result.reasons.map((reason) => reason.label)).toEqual(["tháng 08, 09 chưa khóa"]);
    const { selected, periods } = (await s.pnl.periods({ periodKey: "2026-08" }, founder)).data;
    expect(periods.find((card) => card.periodKey === "2026-08")).toMatchObject({ state: "awaiting_lock", reopenReason: "Sửa chi phí tháng 08 của BD-1" });
    expect(selected!.history).toHaveLength(1);
    expect(selected!.history[0]).toMatchObject({ lockedByName: "Admin chi phí", reopenedByName: "Admin chi phí", reopenReason: "Sửa chi phí tháng 08 của BD-1", summary: { includedMinutes: hours(139) } });
    // Locking again writes a second cycle; the first stays for before / after comparison.
    await s.pnl.lockPeriod("2026-08", founder);
    expect(s.db.table("pnlPeriodSnapshot").filter((row) => row.periodKey === "2026-08")).toHaveLength(2);
    await expect(s.pnl.reopenPeriod("2026-09", { reason: "x" }, founder)).rejects.toThrow("đã khóa");
  });
});

describe("lớp 0/1 — Quỹ chi phí chung (PL-17)", () => {
  it("màn quỹ của kỳ: thông tin quỹ, phép quy đổi USD, cảnh báo giờ chờ, xem trước phân bổ", async () => {
    const { data } = await scenario().pnl.funds({ periodKey: "2026-09" }, founder);
    expect(data).toMatchObject({ periodKey: "2026-09", periodState: "awaiting_lock" });
    expect(data.funds[0]).toMatchObject({ code: "AI", name: "Công cụ AI", targetItemCode: "CP.FUNCOP.AI", targetItemName: "Chi phí công cụ AI", criterionLabel: "giờ tính P&L của tháng", eligibilityLabel: "dự án tính phí có giờ trong tháng · luôn loại dự án thử nghiệm" });
    expect(data.funds[0].period).toMatchObject({ amount: 5_260_000, sourceCurrency: "USD", sourceAmount: 200, exchangeRate: 26_300, amountText: "200 USD × 26.300 đ = 5.260.000 đ, theo hóa đơn tháng", status: "unallocated", statusLabel: "Chưa chia", locked: false });
    expect(data.warnings).toEqual([{ kind: "cost_rate", minutes: hours(105.5), label: "105,5 giờ của tháng đang Chờ xử lý (thiếu cost rate), chưa vào phép chia", target: "staff_costs" }]);
    expect(data.funds[0].preview).toMatchObject({ confirmed: false, canConfirm: true, totalMinutes: hours(29), totalAmount: 5_260_000 });
    expect(data.targetItemOptions.map((row) => row.code)).toEqual(["CP.FUNCOP.AI", "CP.FUNCOP.SOFTWARE"]);
    const august = (await scenario().pnl.funds({ periodKey: "2026-08" }, founder)).data.funds[0];
    expect(august.period).toMatchObject({ status: "allocated", statusLabel: "Đã chia đủ", allocatedAmount: 1_260_000, stale: false });
  });

  it("số chia chỉ vào P&L khi Admin xác nhận; chạy lại được trước khi khóa kỳ", async () => {
    const s = scenario();
    expect((await s.project()).months.rows.find((row) => row.periodKey === "2026-09")!.fundCostAmount).toBeNull();
    await s.pnl.confirmFund("fund-ai", "2026-09", founder);
    let data = await s.project();
    expect(data.months.rows.find((row) => row.periodKey === "2026-09")).toMatchObject({ fundCostAmount: 5_260_000, otherCostAmount: 5_260_000 });
    expect(data.items!.find((row) => row.code === "CP.FUNCOP.AI")!.amount).toBe(6_520_000);
    expect(data.header.result.reasons.map((reason) => reason.code)).not.toContain("fund_unallocated");
    expect(s.db.table("auditEvent").some((event) => event.action === "pnl.fund_confirmed" && event.actorUserId === "u-admin")).toBe(true);
    // Hours released afterwards make the confirmed split stale — the screen offers "Chạy lại".
    await s.approveCost("u-b", "2026-09", 25_200_000);
    expect((await s.pnl.funds({ periodKey: "2026-09" }, founder)).data.funds[0].period).toMatchObject({ status: "allocated", stale: true });
    await s.pnl.rerunFund("fund-ai", "2026-09", founder);
    data = await s.project();
    expect(data.months.rows.find((row) => row.periodKey === "2026-09")!.fundCostAmount).toBeNull();
    expect(data.header.result.reasons.map((reason) => reason.code)).toContain("fund_unallocated");
  });

  it("chia theo giờ tính P&L của từng dự án trong tháng; phần lẻ dồn vào dòng cuối; dự án nội bộ không nhận", async () => {
    const s = scenario();
    s.db.table("project").push({ id: "p-b", workspaceId: WS, code: "DA-B", name: "Dự án B", status: "active", projectType: "delivery", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-08-01T02:00:00.000Z") });
    s.db.table("projectContractItem").push({ id: "hm-b", workspaceId: WS, projectId: "p-b", code: "HM-01", name: "B", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 50_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
    s.db.table("projectStage").push({ id: "st-b", projectId: "p-b", activity: "Build", sortOrder: 10, taskTypeLayer1: "DELIVERY", afterPnlClose: false, ownerUserId: "u-pm", plannedStartAt: null, plannedEndAt: null });
    s.db.table("projectTask").push({ id: "t-b", workspaceId: WS, projectId: "p-b", stageId: "st-b", parentTaskId: null, title: "B", taskTypeLayer1: "DELIVERY", contractItemId: "hm-b", estimateMinutes: 0, assigneeUserId: "u-a" });
    s.log({ userId: "u-a", taskId: "t-b", dateKey: "2026-09-07", hours: 8 });
    s.log({ userId: "u-a", taskId: "t-b", dateKey: "2026-09-08", hours: 6 });
    const confirmed = await s.pnl.confirmFund("fund-ai", "2026-09", founder);
    // Dự án A 29 giờ, Dự án B 14 giờ of 43: 5.260.000 × 29 ÷ 43 = 3.547.441,86 → 3.547.442; B takes the rest.
    expect(confirmed.data.shares.map((row) => [row.projectId, row.minutes / 60, row.amount, row.takesRemainder])).toEqual([["p-a", 29, 3_547_442, false], ["p-b", 14, 1_712_558, true]]);
    expect(s.db.table("pnlFundAllocation").filter((row) => row.periodKey === "2026-09").reduce((total, row) => total + row.amount, 0)).toBe(5_260_000);
    expect((await s.project({}, "p-b")).months.whole.fundCostAmount).toBe(1_712_558);
    expect((await s.pnl.funds({ periodKey: "2026-09" }, founder)).data.funds[0].preview).toMatchObject({ confirmed: true, totalAmount: 5_260_000 });
  });

  it("khai báo quỹ and nhập số tiền theo hóa đơn: a USD amount needs the month's rate; a new amount voids the confirmed split", async () => {
    const s = scenario();
    await expect(s.pnl.createFund({ name: "Phần mềm dùng chung", targetItemCode: "CP.NS.PM" }, founder)).rejects.toThrow("Phân bổ quỹ");
    const fund = (await s.pnl.createFund({ name: "Phần mềm dùng chung", targetItemCode: "CP.FUNCOP.SOFTWARE" }, founder)).data;
    expect(fund).toMatchObject({ code: "QUY-02", eligibility: "billable_with_hours", active: true });
    await expect(s.pnl.setFundAmount(fund.id, "2026-09", { sourceCurrency: "USD", sourceAmount: 100 }, founder)).rejects.toThrow("tỷ giá USD");
    await s.config.addParameterValue({ key: "usdRate", scopeType: "company", value: 26_300, effectiveFrom: "2026-09", reason: "Tỷ giá tháng 09" }, founder);
    expect((await s.pnl.setFundAmount(fund.id, "2026-09", { sourceCurrency: "USD", sourceAmount: 100 }, founder)).data).toMatchObject({ amount: 2_630_000, exchangeRate: 26_300, status: "unallocated" });
    await s.pnl.confirmFund(fund.id, "2026-09", founder);
    expect((await s.project()).items!.find((row) => row.code === "CP.FUNCOP.SOFTWARE")!.amount).toBe(2_630_000);
    await s.pnl.setFundAmount(fund.id, "2026-09", { sourceCurrency: "VND", sourceAmount: 3_000_000 }, founder);
    expect(s.db.table("pnlFundAllocation").filter((row) => row.itemCode === "CP.FUNCOP.SOFTWARE")).toEqual([]);
    // No counted hour in a month → nothing to split, the fund stays Chưa chia.
    await s.pnl.setFundAmount(fund.id, "2026-10", { sourceCurrency: "VND", sourceAmount: 3_000_000 }, founder);
    await expect(s.pnl.confirmFund(fund.id, "2026-10", founder)).rejects.toThrow("Chưa có giờ tính P&L");
  });
});

describe("lớp 1 — Hồ sơ nhân sự › Chi phí theo tháng (PL-08, mục 6.7)", () => {
  it("thanh kỳ: giờ chuẩn của tháng và số người Đã duyệt / Nháp / Chưa có; người có giờ log chưa có chi phí được đánh dấu kèm số giờ chờ", async () => {
    const { data } = await scenario().config.staffCosts({ periodKey: "2026-09" }, founder);
    expect(data).toMatchObject({ periodKey: "2026-09", standardMinutes: 10080, workingDays: 21, standardDayHours: 8, counts: { approved: 2, draft: 0, missing: 1 }, lastImport: null });
    expect(data.rows.find((row) => row.userId === "u-a")).toMatchObject({ displayName: "Nhân sự A", totalAmount: 27_280_000, status: "APPROVED", statusLabel: "Đã duyệt", source: "manual", sourceLabel: "Nhập tay", components: { baseSalaryAmount: 27_280_000, performanceBonusAmount: 0, resultBonusAmount: 0, allowanceAmount: 0, overtimeAmount: 0, socialInsuranceAmount: 0 } });
    expect(data.rows.find((row) => row.userId === "u-b")).toMatchObject({ status: "NONE", components: null, totalAmount: null, loggedMinutes: hours(105.5), waitingMinutes: hours(105.5) });
    expect(Object.keys(data.rows[0].components ?? data.rows[1].components ?? {})).not.toContain("pitAmount"); // không có cột Thuế TNCN
  });

  it("Nháp → Đã duyệt: bản Nháp chưa dùng cho P&L; chỉ bản Đã duyệt ra cost rate; sửa bản đã duyệt thì về Nháp", async () => {
    const s = scenario();
    const saved = await s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", baseSalaryAmount: 20_000_000, performanceBonusAmount: 4_000_000, resultBonusAmount: 1_000_000, allowanceAmount: 500_000, overtimeAmount: 0, socialInsuranceAmount: 1_780_000 }, founder);
    expect(saved.data).toMatchObject({ monthlyCostAmount: 27_280_000, status: "DRAFT" }); // Tổng = cộng các cấu phần (wireframe: 27,28)
    expect(Math.round(saved.data.hourlyCostRate as number)).toBe(162_381);
    let month = (await s.project()).months.rows.find((row) => row.periodKey === "2026-09")!;
    expect(month).toMatchObject({ pendingMinutes: hours(105.5), laborCostAmount: 5_010_000 }); // still waiting
    expect((await s.config.staffCosts({ periodKey: "2026-09" }, founder)).data.counts).toEqual({ approved: 2, draft: 1, missing: 0 });
    const approved = await s.config.approveStaffCosts({ periodKey: "2026-09" }, founder); // "Duyệt bản nháp": every Nháp of the month
    expect(approved.data).toMatchObject({ approvedCount: 1, userIds: ["u-b"] });
    month = (await s.project()).months.rows.find((row) => row.periodKey === "2026-09")!;
    expect(month).toMatchObject({ pendingMinutes: 0, includedMinutes: hours(134.5), laborCostAmount: 5_010_000 + Math.round((105.5 * 27_280_000) / 168) });
    expect(s.db.table("resourceMonthlyCost").find((row) => row.userId === "u-b")).toMatchObject({ status: "APPROVED", approvedByUserId: "u-admin", approvedByName: "Admin chi phí" });
    // Editing an approved month makes it a Nháp again: its hours wait until the new figure is approved.
    await s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", baseSalaryAmount: 25_200_000 }, founder);
    expect((await s.project()).months.rows.find((row) => row.periodKey === "2026-09")!.pendingMinutes).toBe(hours(105.5));
    const audits = s.db.table("auditEvent").filter((event) => event.resource === "resource_monthly_cost" && event.resourceId === "u-b");
    expect(audits.map((event) => event.action)).toEqual(["pnl.resource_monthly_cost_changed", "pnl.resource_monthly_cost_approved", "pnl.resource_monthly_cost_changed"]);
    expect(audits[2]).toMatchObject({ actorUserId: "u-admin", before: { totalAmount: 27_280_000, status: "APPROVED" }, after: { totalAmount: 25_200_000, status: "DRAFT" } }); // giá trị trước và sau
  });

  it("đơn giá giờ nhập trực tiếp được nhân với giờ đã ghi nhận", async () => {
    const s = scenario();
    const saved = await s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", hourlyCostRate: 150_000 }, founder);
    expect(saved.data).toMatchObject({ hourlyCostRate: 150_000, status: "DRAFT" });
    expect(s.db.table("resourceMonthlyCost").find((row) => row.userId === "u-b")).toMatchObject({ hourlyCostRate: 150_000, status: "DRAFT" });
    await s.config.approveStaffCosts({ periodKey: "2026-09" }, founder);
    const month = (await s.project()).months.rows.find((row) => row.periodKey === "2026-09")!;
    expect(month.laborCostAmount).toBe(5_010_000 + Math.round(105.5 * 150_000));
  });

  it("validation: a month key, a known person, non-negative components, Lương tiêu chuẩn required", async () => {
    const s = scenario();
    await expect(s.config.setStaffCost({ userId: "u-b", periodKey: "09/2026", baseSalaryAmount: 1 }, founder)).rejects.toThrow("YYYY-MM");
    await expect(s.config.setStaffCost({ userId: "ghost", periodKey: "2026-09", baseSalaryAmount: 1 }, founder)).rejects.toThrow("Nhân sự");
    await expect(s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", baseSalaryAmount: -1 }, founder)).rejects.toThrow("không âm");
    await expect(s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", allowanceAmount: 500_000 }, founder)).rejects.toThrow("Lương tiêu chuẩn");
    await expect(s.config.setStaffCost({ userId: "u-b", periodKey: "2026-12", baseSalaryAmount: 1 }, founder)).rejects.toThrow("chưa mở");
  });

  it("import: dòng hợp lệ vào Nháp, dòng lỗi kèm lý do (mã không tồn tại, thiếu cấu phần bắt buộc); kết quả lần import cuối hiện lại", async () => {
    const s = scenario();
    await s.config.setEmployeeCode({ userId: "u-b", employeeCode: "ns-027" }, founder);
    await s.config.setEmployeeCode({ userId: "u-bd", employeeCode: "NS-044" }, founder);
    await expect(s.config.setEmployeeCode({ userId: "u-a", employeeCode: "NS-027" }, founder)).rejects.toThrow("đã gán");
    const result = (await s.config.importStaffCosts({ periodKey: "2026-09", rows: [
      { employeeCode: "NS-027", baseSalaryAmount: 25_200_000 },
      { employeeCode: "NS-044", baseSalaryAmount: 24_000_000, performanceBonusAmount: 4_000_000, resultBonusAmount: 740_000, allowanceAmount: 500_000, overtimeAmount: 0, socialInsuranceAmount: 1_000_000 },
      { employeeCode: "NS-099", baseSalaryAmount: 10_000_000 }
    ] }, founder)).data;
    expect(result).toMatchObject({ periodKey: "2026-09", byName: "Admin chi phí", validCount: 2 });
    expect(result.errors).toEqual([
      { rowNumber: 3, employeeCode: "NS-099", reason: "mã NS-099 không tồn tại" }
    ]);
    const { data } = await s.config.staffCosts({ periodKey: "2026-09" }, founder);
    expect(data.lastImport).toEqual(result);
    expect(data.rows.find((row) => row.userId === "u-bd")).toMatchObject({ employeeCode: "NS-044", totalAmount: 30_240_000, hourlyCostRate: 180_000, source: "import", sourceLabel: "Import", status: "DRAFT", statusLabel: "Nháp" });
    expect(data.rows.find((row) => row.userId === "u-b")).toMatchObject({ employeeCode: "NS-027", status: "DRAFT", waitingMinutes: hours(105.5) });
    const missing = (await s.config.importStaffCosts({ periodKey: "2026-09", rows: [{ employeeCode: "NS-027", allowanceAmount: 1 }] }, founder)).data;
    expect(missing).toMatchObject({ validCount: 0, errors: [{ rowNumber: 1, employeeCode: "NS-027", reason: "thiếu cấu phần bắt buộc: Lương tiêu chuẩn." }] });
    // A code twice in one file is ambiguous: every line of it is refused, the first one is not silently kept.
    const twice = (await s.config.importStaffCosts({ periodKey: "2026-09", rows: [{ employeeCode: "NS-044", hourlyCostRate: 200_000 }, { employeeCode: "NS-044", hourlyCostRate: 1 }] }, founder)).data;
    expect(twice).toMatchObject({ validCount: 0, errors: [{ rowNumber: 1, reason: "mã NS-044 lặp lại trong file" }, { rowNumber: 2, reason: "mã NS-044 lặp lại trong file" }] });
    const template = (await s.config.staffCostTemplate({ periodKey: "2026-09" }, founder)).data;
    expect(template.columns.map((column) => column.label)).toEqual(["Mã NS", "Nhân sự", "Đơn giá giờ (đồng/giờ)"]);
    expect(template.rows.slice(0, 2)).toEqual([{ employeeCode: "NS-027", displayName: "Nhân sự B" }, { employeeCode: "NS-044", displayName: "BD-1" }]);
  });

  it("trang hồ sơ từng người: the same data, one person, every month", async () => {
    const s = scenario();
    await s.pnl.lockPeriod("2026-08", founder);
    const { data, meta } = await s.config.staffCostsOfUser("u-a", founder);
    expect(data.map((row) => [row.periodKey, row.monthlyCostAmount, Math.round(row.hourlyCostRate), row.standardHours, row.locked, (row as unknown as { statusLabel: string }).statusLabel])).toEqual([["2026-09", 27_280_000, 162_381, 168, false, "Đã duyệt"], ["2026-08", 25_200_000, 150_000, 168, true, "Đã khóa"]]);
    expect(meta).toMatchObject({ userId: "u-a", canEdit: true, lockedPeriodKeys: ["2026-08"] });
  });
});

describe("lớp 0 — Tham số (PL-19, mục 6.3)", () => {
  it("bảng tham số: chỉ tỷ lệ, tỷ giá, giờ chuẩn và mốc (không còn đơn giá bán theo vai trò); giờ chuẩn của tháng do hệ thống tính từ lịch", async () => {
    const { data } = await scenario().config.parameters(founder);
    expect(data.rows.map((row) => [row.label, row.defaultValueText, row.scopeText, row.specificValueCount, row.effectiveFrom])).toEqual([
      ["Giờ chuẩn một ngày", "8 giờ", "Công ty", 0, "2026-01"],
      ["Tỷ giá USD", null, "Công ty, theo tháng", 0, null],
      ["Mốc đóng P&L dự án", "G7 (nghiệm thu)", "Công ty", 0, "2026-10"],
      ["Tỷ lệ hoa hồng", "5%", "Công ty, khách hàng", 0, "2026-08"]
    ]);
    expect(data.rows[0].derived).toMatchObject({ periodKey: "2026-10", workingDays: 22, standardHours: 176, text: "Giờ chuẩn tháng 10/2026: 22 ngày × 8 = 176 giờ, hệ thống tính từ lịch ngày nghỉ" });
    expect(data.moved).toEqual([{ label: "Lương tháng tiêu chuẩn", movedTo: "Hồ sơ nhân sự" }, { label: "Tiền giao thông", movedTo: "bỏ khỏi Tham số" }, { label: "Phí công cụ AI", movedTo: "quỹ AI, Quỹ chi phí chung" }]);
    expect(data.openPeriodKeys[0]).toBe("2026-10");
    expect(data.rows.map((row) => row.key)).not.toEqual(expect.arrayContaining(["standardSalary", "transport"]));
  });

  it("phạm vi hẹp nhất được ưu tiên: dự án → khách hàng → công ty; hoa hồng tính theo tỷ lệ đó", async () => {
    const s = scenario();
    const commission = async () => (await s.project()).months.wholeProjectItems[0].amount;
    expect(await commission()).toBe(3_360_000); // công ty 5%
    await s.config.addParameterValue({ key: "commissionPercent", scopeType: "customer", scopeId: "acc-a", value: 4, effectiveFrom: "2026-10", reason: "Thỏa thuận riêng với Khách A" }, founder);
    expect(await commission()).toBe(2_688_000); // khách hàng 4%
    await s.config.addParameterValue({ key: "commissionPercent", scopeType: "project", scopeId: "p-a", value: 6, effectiveFrom: "2026-10", reason: "Dự án chiến lược" }, founder);
    expect(await commission()).toBe(4_032_000); // dự án 6%
    const row = (await s.config.parameters(founder)).data.rows.find((item) => item.key === "commissionPercent")!;
    expect(row).toMatchObject({ defaultValueText: "5%", specificValueCount: 2 });
    expect(row.values.map((value) => [value.scopeLabel, value.valueText, value.effectiveFrom, value.current])).toEqual(expect.arrayContaining([["Công ty", "5%", "2026-08", true], ["Khách A", "4%", "2026-10", true], ["Dự án A", "6%", "2026-10", true]]));
    expect(row.history[0]).toMatchObject({ text: "thêm 6% cho Dự án A từ 10/2026", byName: "Admin chi phí", reason: "Dự án chiến lược" });
  });

  it("đổi bằng “Thêm giá trị mới” kèm lý do, không sửa đè; kỳ hiệu lực: a value only applies from its period on", async () => {
    const s = scenario();
    await expect(s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 7, effectiveFrom: "2026-10", reason: " " }, founder)).rejects.toThrow("lý do");
    await expect(s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 120, effectiveFrom: "2026-10", reason: "x" }, founder)).rejects.toThrow("từ 0 đến 100");
    await expect(s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 7, effectiveFrom: "2026-12", reason: "x" }, founder)).rejects.toThrow("chưa mở");
    await expect(s.config.addParameterValue({ key: "usdRate", scopeType: "customer", scopeId: "acc-a", value: 26_000, effectiveFrom: "2026-10", reason: "x" }, founder)).rejects.toThrow("phạm vi");
    await expect(s.config.addParameterValue({ key: "standardSalary" as never, scopeType: "company", value: 1, effectiveFrom: "2026-10", reason: "x" }, founder)).rejects.toThrow("chỉ tỷ lệ");
    await expect(s.config.addParameterValue({ key: "pnlCloseGate", scopeType: "company", value: "G8", effectiveFrom: "2026-10", reason: "x" }, founder)).rejects.toThrow("G7");
    await expect(s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 7, effectiveFrom: "2026-10", reason: "x" }, adminNoCost)).resolves.toBeDefined(); // Admin cấu hình
    await expect(s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 7, effectiveFrom: "2026-10", reason: "x" }, plainUser)).rejects.toThrow("Admin");
    expect(s.db.table("pnlParameterValue").filter((row) => row.key === "commissionPercent").map((row) => [row.value, row.effectiveFrom])).toEqual([[5, "2026-08"], [7, "2026-10"]]); // the old row is untouched
    // Not accepted yet: the rate in force now (10/2026) is 7%, on Giá trị dự án. Accepted in 09/2026: the rate of
    // that month, 5%, on the recognised revenue (the same 67.200.000).
    expect((await s.project()).months.wholeProjectItems[0].amount).toBe(4_704_000);
    s.approveG7("2026-09-30");
    expect((await s.project()).months.wholeProjectItems[0].amount).toBe(3_360_000);
  });

});

describe("lớp 0 — Khoản mục và Mẫu khoản mục (mục 6.2, 6.6)", () => {
  it("tab Khoản mục: cây mặc định đủ cấp cha–con, thanh kiểm tra cấu hình, thứ tự tính chỉ đọc", async () => {
    const { data } = await scenario().config.items(founder);
    expect(data).toMatchObject({ usingDefaultTree: true, hasDraft: false });
    expect(data.check).toMatchObject({ hasCycle: false, allGroupsSummed: true, errors: [], periodKey: "2026-10", canApply: false });
    // Kỳ 10/2026 has no hours yet: the required items that take their number from hours have none.
    expect(data.check.requiredWithoutValue).toEqual([{ code: "CP.NS.DELIVERY", name: "Chi phí nhân sự Delivery/DX" }]);
    const commission = data.items.find((item) => item.code === "CP.HOAHONG")!;
    expect(commission).toMatchObject({ name: "Hoa hồng", parentCode: "CHIPHI", level: 2, sign: 1, roleGroup: "BD", method: "FORMULA", methodLabel: "Công thức", formulaText: "[Doanh thu dự án] × [Tỷ lệ hoa hồng]", required: true, status: "active", statusLabel: "Đang dùng", sourceNote: "Khung I.10", codeLocked: false });
    expect(commission.dependsOn).toEqual([{ code: "DOANHTHU.GHINHAN", name: "Doanh thu dự án" }]);
    expect(commission.usedBy).toEqual([{ code: "CHIPHI", name: "Tổng chi phí" }]);
    expect(commission.lockedMethods.map((row) => row.method)).toEqual(["MANUAL", "SYSTEM", "FUND", "GROUP"]); // cách lấy số không hợp lệ bị khóa, có lý do
    expect(data.items.find((item) => item.code === "CHIPHI")).toMatchObject({ method: "GROUP", methodLabel: "Tổng nhóm", formulaText: null });
    expect(data.items.find((item) => item.code === "CP.FUNCOP.AI")).toMatchObject({ parentCode: "CP.FUNCOP", level: 3, methodLabel: "Phân bổ quỹ" });
    expect(data.formulaOperands.map((operand) => operand.label)).toEqual(expect.arrayContaining(["Doanh thu dự án", "Tổng chi phí", "Tỷ lệ hoa hồng"]));
  });

  it("sửa là bản nháp: nothing reaches the P&L until “Áp dụng bản nháp từ kỳ…”, which only takes an open period", async () => {
    const s = scenario();
    await s.config.saveItem({ code: "CP.DAOTAO", name: "Chi phí đào tạo khách hàng", parentCode: "CHIPHI", method: "MANUAL" }, founder);
    let { data } = await s.config.items(founder);
    expect(data).toMatchObject({ usingDefaultTree: false, hasDraft: true });
    expect(data.check.canApply).toBe(true);
    expect(data.items.find((item) => item.code === "CP.DAOTAO")).toMatchObject({ status: "draft", statusLabel: "Bản nháp", level: 2 });
    await expect(s.config.createManualCost("p-a", { itemCode: "CP.DAOTAO", periodKey: "2026-09", label: "Lớp học", amount: 1_000_000 }, founder)).rejects.toThrow("Nhập tay"); // not in force yet
    await s.pnl.lockPeriod("2026-08", founder);
    await expect(s.config.applyItemDrafts({ periodKey: "2026-08" }, founder)).rejects.toThrow("đang mở");
    await s.config.applyItemDrafts({ periodKey: "2026-10" }, founder);
    ({ data } = await s.config.items(founder));
    expect(data.items.find((item) => item.code === "CP.DAOTAO")).toMatchObject({ status: "active", effectiveFromPeriod: "2026-10" });
    await s.config.createManualCost("p-a", { itemCode: "CP.DAOTAO", periodKey: "2026-09", label: "Lớp học", amount: 1_000_000 }, founder);
    expect((await s.project()).totals.cost.totalAmount).toBe(31_970_000);
    // Mã đã có số ở kỳ khóa thì không sửa.
    expect(data.items.find((item) => item.code === "CP.HOAHONG")).toMatchObject({ codeLocked: true, codeLockReason: "Khóa: có số ở kỳ đã khóa" });
    await expect(s.config.saveItem({ code: "CP.WELFARE", name: "Welfare related", parentCode: "CHIPHI", method: "FUND" }, founder)).rejects.toThrow("kỳ đã khóa");
  });

  it("còn tham chiếu vòng thì chặn áp dụng; khoản mục hệ thống không đổi cách lấy số hay ngừng dùng", async () => {
    const s = scenario();
    await s.config.saveItem({ code: "CP.HOAHONG", name: "Hoa hồng", parentCode: "CHIPHI", method: "FORMULA", roleGroup: "BD", required: true, formula: [{ item: "CHIPHI" }, { op: "*" }, { param: "commissionPercent" }] }, founder);
    const { data } = await s.config.items(founder);
    expect(data.check).toMatchObject({ hasCycle: true, canApply: false });
    expect(data.check.cycleCodes).toEqual(expect.arrayContaining(["CHIPHI", "CP.HOAHONG"]));
    await expect(s.config.applyItemDrafts({ periodKey: "2026-10" }, founder)).rejects.toThrow("tham chiếu vòng");
    expect((await s.project()).months.wholeProjectItems[0].amount).toBe(3_360_000); // the draft never reached the P&L
    await s.config.discardItemDrafts(founder);
    expect((await s.config.items(founder)).data.hasDraft).toBe(false);
    await expect(s.config.saveItem({ code: "CP.HOAHONG", name: "Hoa hồng", parentCode: "CHIPHI", method: "MANUAL" }, founder)).rejects.toThrow("hệ thống");
    await expect(s.config.retireItem("CP.NS.PM", founder)).rejects.toThrow("hệ thống");
    await expect(s.config.saveItem({ code: "X", name: "X", parentCode: "CHIPHI", method: "FORMULA" }, founder)).rejects.toThrow("danh sách đại lượng");
    await expect(s.config.saveItem({ code: "X", name: "X", parentCode: "CHIPHI", method: "TYPED" as never }, founder)).rejects.toThrow("Cách lấy số");
  });

  it("tab Mẫu khoản mục: thẻ mẫu, bảng so sánh chỉ hiện dòng khác biệt, số dự án đang dùng", async () => {
    const { data } = await scenario().config.templates(founder);
    expect(data.templates.map((template) => [template.name, template.description, template.projectCount])).toEqual([
      ["Khách hàng", "Bộ mặc định, không tắt gì", 1],
      ["Nội bộ", "Tắt: Rebate License, Hoa hồng · chi phí tiêu hao", 0],
      ["Đào tạo", "Tắt: Rebate License, Hoa hồng · chi phí tiêu hao", 0]
    ]);
    expect(data.templates[0].enabledItemCount).toBe(22);
    expect(data.templates[1].enabledItemCount).toBe(20);
    expect(data.comparison.map((row) => [row.label, row.cells.customer, row.cells.internal, row.cells.training])).toEqual([
      ["Rebate License", { enabled: true }, { enabled: false }, { enabled: false }],
      ["Hoa hồng", { enabled: true }, { enabled: false }, { enabled: false }],
      ["Tỷ lệ hoa hồng (tham số, nhập tay)", { text: "5%" }, { text: "—" }, { text: "—" }]
    ]);
    expect(data.overrides).toEqual([]);
  });

  it("dự án ghi đè mẫu: bắt buộc lý do, chỉ ảnh hưởng dự án đó; chi phí nhân sự không tắt được", async () => {
    const s = scenario();
    await expect(s.config.setTemplateOverride("p-a", { disabledCodes: ["DOANHTHU.LIC"], reason: "" }, founder)).rejects.toThrow("lý do");
    await expect(s.config.setTemplateOverride("p-a", { disabledCodes: ["CP.NS.PM"], reason: "x" }, founder)).rejects.toThrow("chi phí nhân sự");
    await expect(s.config.setTemplate("customer", { disabledCodes: ["CHIPHI"] }, founder)).rejects.toThrow("Không tắt được");
    await s.config.setTemplateOverride("p-a", { disabledCodes: ["CP.HOAHONG"], reason: "Hợp đồng không qua BD" }, founder);
    const data = await s.project();
    expect(data.months.wholeProjectItems).toEqual([]);
    expect(data.totals.cost.totalAmount).toBe(27_610_000);
    expect(data.totals.ebit.amount).toBe(39_590_000);
    const { overrides } = (await s.config.templates(founder)).data;
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ projectName: "Dự án A", summary: "tắt Hoa hồng", byName: "Admin chi phí", reason: "Hợp đồng không qua BD" });
    expect(data.template).toMatchObject({ key: "customer", name: "Khách hàng", canOverride: true, override: { disabledCodes: ["CP.HOAHONG"], reason: "Hợp đồng không qua BD" } });
  });
});

describe("giờ log nguồn (PL-07)", () => {
  it("từ mọi số tổng mở được tới danh sách giờ log nguồn, cùng bộ lọc", async () => {
    const s = scenario();
    const all = await s.pnl.entries({ projectId: "p-a" }, founder);
    expect(all.meta).toMatchObject({ totalMinutes: hours(273.5), pendingDeadlineWorkingDays: 10 });
    const included = await s.pnl.entries({ projectId: "p-a", status: "included", periodKey: "2026-08" }, founder);
    expect(included.meta).toMatchObject({ totalMinutes: hours(139), totalCostAmount: 21_340_000 });
    const waiting = await s.pnl.entries({ periodKey: "2026-09", group: "cost_rate" }, founder);
    expect(waiting.meta.totalMinutes).toBe(hours(105.5));
    expect(waiting.data[0]).toMatchObject({ userDisplayName: "Nhân sự B", projectName: "Dự án A", taskTitle: "Xây dựng – B", reasonLabels: ["Thiếu cost rate của tháng"], blocksG7: false, target: "staff_costs", ownerDisplayName: "BD-1", overdue: true, costAmount: null, hourlyCostRate: null });
    expect((await s.pnl.entries({ projectId: "p-a", userId: "u-bd" }, founder)).data[0]).toMatchObject({ roleGroup: "BD", taskTypeLayer1: "PRE_SALE", minutes: hours(3), costAmount: 540_000 });
    await expect(s.pnl.entries({ status: "approved" }, founder)).rejects.toThrow("status");
  });

  it("bộ lọc nhận nhiều giá trị nối bằng dấu phẩy và khoảng ngày cụ thể (fromDay / toDay)", async () => {
    const s = scenario();
    const minutes = async (query: Record<string, unknown>) => (await s.pnl.entries(query, founder)).meta.totalMinutes;
    const all = await minutes({ projectId: "p-a" });
    expect(await minutes({ projectId: "p-a,p-a" })).toBe(all);
    expect(await minutes({ status: "included,pending,excluded", projectId: "p-a" })).toBe(all);
    expect(await minutes({ projectId: "p-a", userId: "u-bd,u-b" })).toBe(hours(3) + hours(105.5));
    expect(await minutes({ periodKey: "2026-09", group: "cost_rate,classification" })).toBe(hours(105.5));
    expect(await minutes({ periodKey: "2026-09", reason: "missing_staff_cost,missing_layer1" })).toBe(hours(105.5));
    expect(await minutes({ periodKey: "2026-09", status: "pending,excluded" })).toBe(hours(105.5));
    // Days are inclusive; the month parameters still work on their own.
    const firstDay = await s.pnl.entries({ fromDay: "2026-08-03", toDay: "2026-08-03", userId: "u-bd" }, founder);
    expect(firstDay.data.map((row) => row.workDate)).toEqual(["2026-08-03"]);
    expect(firstDay.meta.totalMinutes).toBe(hours(3));
    expect(await minutes({ fromDay: "2026-08-04", toDay: "2026-08-31", userId: "u-bd" })).toBe(0);
    expect(await minutes({ fromDay: "2026-08-01", toDay: "2026-09-30", projectId: "p-a" })).toBe(all);
    expect(await minutes({ fromDay: "2026-09-01", projectId: "p-a" })).toBe(await minutes({ projectId: "p-a", periodKey: "2026-09" }));
    expect(await minutes({ toDay: "2026-08-31", projectId: "p-a" })).toBe(await minutes({ projectId: "p-a", periodKey: "2026-08" }));
    await expect(s.pnl.entries({ fromDay: "2026-8-3" }, founder)).rejects.toThrow("fromDay");
    await expect(s.pnl.entries({ fromDay: "2026-08-10", toDay: "2026-08-01" }, founder)).rejects.toThrow("toDay");
    await expect(s.pnl.entries({ reason: "missing_staff_cost,nope" }, founder)).rejects.toThrow("reason");
    await expect(s.pnl.entries({ projectId: "p-a,p-zzz" }, founder)).rejects.toThrow("workspace");
  });
});
