/**
 * One spec per finding of the 12/10 review of the P&L tab. Each fails on the code as it was reviewed.
 * Same fixture as Phụ lục B (pnl-scenario.testing.ts), read through the real services.
 */
import { describe, expect, it } from "vitest";
import { companyCostMonth, computeProjectPnl, classifyEntry, dashboardTotals, entryCosts, type ProjectPnlInput } from "./pnl-engine";
import { DEFAULT_COST_TREE } from "./pnl-tree";
import { adminNoCost, founder, hours, scenario, staffCost, WS } from "./pnl-scenario.testing";
import { ResourceControlsService } from "./resource-controls.service";

type Scenario = ReturnType<typeof scenario>;
type ProjectData = Awaited<ReturnType<Scenario["project"]>>;
const month = (data: ProjectData, periodKey: string) => data.months.rows.find((row) => row.periodKey === periodKey)!;
const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const row = (s: Scenario, table: string, where: (item: Record<string, any>) => boolean) => s.db.table(table).find(where) as Record<string, any>;

/** Dx Director: an Admin account that is neither PM nor in the cost permission group. */
const dxDirector = { ...adminNoCost, heldRoleCodes: ["DX_DIRECTOR"] } as typeof founder;
const pm = { ...adminNoCost, subjectId: "u-pm", displayName: "PM-1", roleCodes: ["PM", "WORKSPACE_ADMIN", "DELIVERY_LEAD"], heldRoleCodes: ["PM"] } as typeof founder;
const costEditor = { ...founder, subjectId: "u-editor", displayName: "Người nhập", roleCodes: ["COST_EDIT", "COST_VIEW", "WORKSPACE_ADMIN"] } as typeof founder;

/** Tháng 08 và 09 đã khóa, tháng 09 có một dòng Nhập tay 2.000.000 đ ở CP.FUNCOP.RIENG; cây khoản mục đã lưu. */
async function lockedWithManualLine() {
  const s = scenario();
  await s.config.loadDefaultItems(founder);
  await s.approveCost("u-b", "2026-09", 25_200_000);
  await s.pnl.confirmFund("fund-ai", "2026-09", founder);
  await s.config.createManualCost("p-a", { itemCode: "CP.FUNCOP.RIENG", periodKey: "2026-09", label: "Thuê ngoài", amount: 2_000_000 }, founder);
  await s.pnl.lockPeriod("2026-08", founder);
  await s.pnl.lockPeriod("2026-09", founder);
  return s;
}

/** A second customer project, accepted on 28/09: 20.000.000 đ Trọn gói, A logs 8 giờ on 23/09. */
function addProjectB(s: Scenario) {
  s.db.table("project").push({ id: "p-b", workspaceId: WS, code: "DA-B", name: "Dự án B", status: "active", projectType: "delivery", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-08-05T02:00:00.000Z") });
  s.db.table("projectGate").push({ id: "g1-b", projectId: "p-b", code: "G1", status: "approved", decidedAt: new Date("2026-08-06T03:00:00.000Z") }, { id: "g7-b", projectId: "p-b", code: "G7", status: "approved", decidedAt: new Date("2026-09-28T03:00:00.000Z") });
  s.db.table("projectContractItem").push({ id: "hm-b", workspaceId: WS, projectId: "p-b", code: "HM-01", name: "Gói B", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 20_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
  s.db.table("projectStage").push({ id: "st-b", projectId: "p-b", activity: "Build", sortOrder: 10, taskTypeLayer1: "DELIVERY", afterPnlClose: false, ownerUserId: "u-pm", plannedStartAt: new Date("2026-08-10T02:00:00.000Z"), plannedEndAt: null });
  s.db.table("projectTask").push({ id: "t-b", workspaceId: WS, projectId: "p-b", stageId: "st-b", parentTaskId: null, title: "Làm B", taskTypeLayer1: "DELIVERY", contractItemId: "hm-b", estimateMinutes: 0, assigneeUserId: "u-a" });
  s.log({ userId: "u-a", taskId: "t-b", dateKey: "2026-09-23", hours: 8 });
}

/** Dự án cũ: trạng thái "completed", không có dòng gate, không có lịch sử trạng thái. Kế hoạch kết thúc 18/09, giờ cuối 22/09. */
function addLegacyProject(s: Scenario) {
  s.db.table("project").push({ id: "p-old", workspaceId: WS, code: "DA-OLD", name: "Dự án cũ", status: "completed", projectType: "delivery", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-08-05T02:00:00.000Z") });
  s.db.table("projectContractItem").push({ id: "hm-old", workspaceId: WS, projectId: "p-old", code: "HM-01", name: "Gói cũ", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 30_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
  s.db.table("projectStage").push({ id: "st-old", projectId: "p-old", activity: "Build", sortOrder: 10, taskTypeLayer1: "DELIVERY", afterPnlClose: false, ownerUserId: "u-pm", plannedStartAt: new Date("2026-08-10T02:00:00.000Z"), plannedEndAt: new Date("2026-09-18T02:00:00.000Z") });
  s.db.table("projectTask").push({ id: "t-old", workspaceId: WS, projectId: "p-old", stageId: "st-old", parentTaskId: null, title: "Làm", taskTypeLayer1: "DELIVERY", contractItemId: "hm-old", estimateMinutes: 0, assigneeUserId: "u-a" });
  s.log({ userId: "u-a", taskId: "t-old", dateKey: "2026-09-22", hours: 8 });
}

/** Phụ lục B ca 4: dự án mới chưa có hợp đồng, BD ghi 6 giờ Pre-sale tháng 09 — rồi tháng 09 được khóa. */
async function lockedWithAwaitingPreSale() {
  const s = scenario();
  s.db.table("project").push({ id: "p-new", workspaceId: WS, code: "DA-NEW", name: "Dự án mới", status: "planning", projectType: "delivery", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-09-01T02:00:00.000Z") });
  s.db.table("projectGate").push({ id: "g1-new", projectId: "p-new", code: "G1", status: "not_submitted", decidedAt: null }, { id: "g7-new", projectId: "p-new", code: "G7", status: "not_submitted", decidedAt: null });
  s.db.table("projectStage").push({ id: "st-new", projectId: "p-new", activity: "Validate", sortOrder: 10, taskTypeLayer1: "PRE_SALE", afterPnlClose: false, ownerUserId: "u-bd", plannedStartAt: null, plannedEndAt: null });
  s.db.table("projectTask").push({ id: "t-new", workspaceId: WS, projectId: "p-new", stageId: "st-new", parentTaskId: null, title: "Pre-sale deal mới", taskTypeLayer1: "PRE_SALE", contractItemId: null, estimateMinutes: 0, assigneeUserId: "u-bd" });
  s.db.table("resourceMonthlyCost").push(staffCost("u-bd", "2026-09", 30_240_000));
  s.log({ userId: "u-bd", taskId: "t-new", month: "2026-09", hours: 6, createdAt: "2026-09-01T10:00:00.000Z" });
  await s.approveCost("u-b", "2026-09", 25_200_000);
  await s.pnl.confirmFund("fund-ai", "2026-09", founder);
  await s.pnl.lockPeriod("2026-08", founder);
  await s.pnl.lockPeriod("2026-09", founder); // the lock lets "chờ ký hợp đồng" hours through (A-1b)
  return s;
}

describe("1 · tháng đã khóa không đổi theo cây khoản mục và mẫu (PL-21, PL-24)", () => {
  it("khoản mục đã có số ở kỳ khóa: không ngừng dùng, không đổi cha, không đổi dấu — thông báo nêu tháng", async () => {
    const s = await lockedWithManualLine();
    const base = { code: "CP.FUNCOP.RIENG", name: "Chi phí thuê ngoài, license riêng", parentCode: "CP.FUNCOP", method: "MANUAL" as const };
    await expect(s.config.retireItem("CP.FUNCOP.RIENG", founder)).rejects.toThrow("09/2026");
    await expect(s.config.saveItem({ ...base, parentCode: "CHIPHI" }, founder)).rejects.toThrow("09/2026");
    await expect(s.config.saveItem({ ...base, sign: -1 }, founder)).rejects.toThrow("09/2026");
    // Moving the group moves its children's locked numbers with it.
    await expect(s.config.saveItem({ code: "CP.FUNCOP", name: "Functional operation", parentCode: "CP.SALARIES", method: "GROUP" }, founder)).rejects.toThrow(/0[89]\/2026/);
    // A rename changes no number; an item without a locked number can still be retired.
    await expect(s.config.saveItem({ ...base, name: "Thuê ngoài và license riêng" }, founder)).resolves.toBeTruthy();
    await expect(s.config.retireItem("CP.WELFARE", founder)).resolves.toBeTruthy();
    expect(s.db.table("pnlCostItem").find((item) => item.code === "CP.FUNCOP.RIENG")!.status).toBe("active");
  });

  it("mẫu và ghi đè mẫu: không tắt được khoản mục đang có dòng nhập tay hay phần quỹ ở tháng đã khóa", async () => {
    const s = await lockedWithManualLine();
    await expect(s.config.setTemplate("customer", { disabledCodes: ["CP.FUNCOP.RIENG"] }, founder)).rejects.toThrow("09/2026");
    await expect(s.config.setTemplate("customer", { disabledCodes: ["CP.FUNCOP"] }, founder)).rejects.toThrow("2026"); // an ancestor switches it off too
    await expect(s.config.setTemplateOverride("p-a", { disabledCodes: ["CP.FUNCOP.AI"], reason: "không dùng AI" }, founder)).rejects.toThrow("08/2026");
    await expect(s.config.setTemplate("customer", { disabledCodes: ["CP.WELFARE"] }, founder)).resolves.toBeTruthy();
  });

  it("khóa lưu cây và trạng thái bật/tắt; tháng đã khóa đọc lại từ đó dù cây hoặc mẫu bị đổi sau lưng", async () => {
    const s = await lockedWithManualLine();
    const before = await s.project();
    expect(month(before, "2026-09")).toMatchObject({ directCostAmount: 2_000_000, fromSnapshot: true });
    const snapshot = s.db.table("pnlPeriodSnapshot").find((item) => item.periodKey === "2026-09")!.data;
    expect(snapshot.tree.map((item: { code: string }) => item.code)).toContain("CP.FUNCOP.RIENG");
    expect(snapshot.disabledCodes["p-a"]).toEqual([]);

    // Behind the guards: the item is retired and the template switches the fund target off.
    Object.assign(row(s, "pnlCostItem", (item) => item.code === "CP.FUNCOP.RIENG"), { status: "retired" });
    s.db.table("pnlItemTemplate").push({ id: "tpl-1", workspaceId: WS, key: "customer", name: "Khách hàng", disabledCodes: ["CP.FUNCOP.AI"], consumable: false });
    const after = await s.project();
    expect(after.months.rows).toEqual(before.months.rows);
    expect(after.months.whole).toEqual(before.months.whole);
    expect(after.totals.cost).toEqual(before.totals.cost);
    expect(after.items!.find((item) => item.code === "CP.FUNCOP.RIENG")).toMatchObject({ amount: 2_000_000 });
    // Dòng tháng và "Toàn dự án" luôn khớp: tổng các tháng + khoản tính cho cả dự án.
    expect(sum(after.months.rows.map((item) => item.totalCostAmount)) + (after.months.wholeProjectItems[0].amount as number)).toBe(after.months.whole.totalCostAmount);
  });

  it("tháng chưa khóa vẫn theo mẫu hiện tại (sửa mẫu có hiệu lực từ kỳ đang mở)", async () => {
    const s = scenario();
    await s.approveCost("u-b", "2026-09", 25_200_000);
    await s.pnl.confirmFund("fund-ai", "2026-09", founder);
    await s.pnl.lockPeriod("2026-08", founder);
    expect(month(await s.project(), "2026-09").fundCostAmount).toBeGreaterThan(0);
    s.db.table("pnlItemTemplate").push({ id: "tpl-1", workspaceId: WS, key: "customer", name: "Khách hàng", disabledCodes: ["CP.FUNCOP.AI"], consumable: false });
    const data = await s.project();
    expect(month(data, "2026-08").fundCostAmount).toBe(1_260_000); // locked: as snapshotted
    expect(month(data, "2026-09").fundCostAmount ?? 0).toBe(0); // open: the template in force now
    expect(sum(data.months.rows.map((item) => item.totalCostAmount)) + (data.months.wholeProjectItems[0].amount as number)).toBe(data.months.whole.totalCostAmount);
  });
});

describe("2 · giờ Pre-sale chờ ký hợp đồng nằm trong tháng đã khóa (A-1b)", () => {
  it("ký hợp đồng sau khi khóa: giờ sang Được tính ở hạng mục gốc, hết giờ chờ", async () => {
    const s = await lockedWithAwaitingPreSale();
    expect((await s.pnl.entries({ projectId: "p-new" }, founder)).data[0]).toMatchObject({ status: "pending", awaitingContract: true, fromSnapshot: true });
    s.db.table("projectContractItem").push({ id: "hm-new", workspaceId: WS, projectId: "p-new", code: "HM-01", name: "Hạng mục gốc", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 40_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
    expect((await s.pnl.entries({ projectId: "p-new" }, founder)).data[0]).toMatchObject({ status: "included", contractItemId: "hm-new", costAmount: 1_080_000, awaitingContract: false, fromSnapshot: true });
    const data = await s.project({}, "p-new");
    expect(month(data, "2026-09")).toMatchObject({ periodState: "locked", includedMinutes: hours(6), pendingMinutes: 0, laborCostAmount: 1_080_000 });
    expect(data.header.result.reasons.map((reason) => reason.code)).not.toContain("pending_classification");
  });

  it("thua deal sau khi khóa: giờ sang Bị loại và vào dòng Chi phí Pre-sale của đúng tháng đó", async () => {
    const s = await lockedWithAwaitingPreSale();
    Object.assign(row(s, "project", (item) => item.id === "p-new"), { status: "closed" });
    s.db.table("projectStatusHistory").push({ id: "psh-1", projectId: "p-new", fromStatus: "planning", toStatus: "closed", closeReasonCode: "lost_deal", changedAt: new Date("2026-10-05T03:00:00.000Z") });
    expect((await s.pnl.entries({ projectId: "p-new" }, founder)).data[0]).toMatchObject({ status: "excluded", reason: "lost_deal_pre_sale" });
    const line = (await s.pnl.dashboard({ year: 2026 }, founder)).data.companyCosts.lines.find((item) => item.key === "pre_sale")!;
    expect(line.byMonth.find((item) => item.periodKey === "2026-09")).toMatchObject({ amount: 1_080_000, minutes: hours(6) });
  });
});

describe("3 · quyền (PL-26, mục 6.1 dòng Quyền, mục 6.7 khối 5)", () => {
  function internalProject(s: Scenario) {
    s.db.table("project").push({ id: "p-int", workspaceId: WS, code: "NB-01", name: "Chuẩn hóa quy trình", status: "active", projectType: "internal", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-09-01T02:00:00.000Z") });
    s.db.table("projectContractItem").push({ id: "nb-01", workspaceId: WS, projectId: "p-int", code: "HM-01", name: "Nội bộ", kind: "ROOT", contractType: "INTERNAL", valueAmount: 10_000_000, estimateMinutes: null, status: "active", sortOrder: 10, archivedAt: null, warnThresholdPercent: 80 });
    s.db.table("projectTask").push({ id: "t-nb", workspaceId: WS, projectId: "p-int", stageId: null, parentTaskId: null, title: "Viết quy trình", taskTypeLayer1: "DELIVERY", contractItemId: "nb-01", estimateMinutes: 600, assigneeUserId: "u-a" });
    s.log({ userId: "u-a", taskId: "t-nb", dateKey: "2026-09-22", hours: 8, taskLayer2: "INTERNAL_PROJECT" });
  }

  it("Thiết lập P&L dự án: số suy từ cost rate chỉ hiện với nhóm quyền chi phí; giá trị hợp đồng thì mọi Admin thấy", async () => {
    const s = scenario();
    internalProject(s);
    expect((await s.config.projectSetup("p-int", founder)).data.items[0].internal).toMatchObject({ costCapAmount: 10_000_000, costToDateAmount: 1_299_048, usedPercent: 12.9905 });
    const outside = await s.config.projectSetup("p-int", adminNoCost);
    expect(outside.data.items[0].internal).toMatchObject({ costCapAmount: 10_000_000, costToDateAmount: null, usedPercent: null, overThreshold: false });
    expect(JSON.stringify(outside.data)).not.toContain("1299048");
  });

  it("Tham số: đơn giá bán chỉ hiện với nhóm quyền chi phí", async () => {
    const s = scenario();
    const sellRow = (data: Awaited<ReturnType<typeof s.config.parameters>>["data"]) => data.rows.find((item) => item.key === "sellRate" && item.subKey === "DELIVERY")!;
    expect(sellRow((await s.config.parameters(founder)).data)).toMatchObject({ defaultValue: 400_000, values: [{ value: 400_000 }] });
    const outside = (await s.config.parameters(adminNoCost)).data;
    expect(sellRow(outside)).toMatchObject({ defaultValue: null, defaultValueText: null, values: [{ value: null, valueText: null, effectiveFrom: "2026-08" }] });
    expect(JSON.stringify(outside)).not.toMatch(/400[.,]?000/);
    expect(outside.rows.find((item) => item.key === "commissionPercent")).toMatchObject({ defaultValue: 5 }); // a rate is not a price
  });

  it("mục 6.1: PM sửa, Admin khác chỉ xem (Founder/GM và Workspace Admin giữ quyền)", async () => {
    const s = scenario();
    const plan = { installments: [{ label: "Khi ký", percent: 50 }, { label: "Nghiệm thu", percent: 50 }] };
    await expect(s.config.setContractStatus("p-a", { status: "draft", reason: "x" }, dxDirector)).rejects.toThrow("PM");
    await expect(s.config.setInstallments("p-a", "hm-01", plan, dxDirector)).rejects.toThrow("PM");
    await expect(s.config.setInstallmentStatus("p-a", "default:hm-01:1", { status: "accepted" }, dxDirector)).rejects.toThrow("PM");
    await expect(s.config.setItemSettings("p-a", "hm-02", { warnThresholdPercent: 60 }, dxDirector)).rejects.toThrow("PM");
    expect((await s.config.projectSetup("p-a", dxDirector)).meta.canEdit).toBe(false);
    expect((await s.config.projectSetup("p-a", pm)).meta.canEdit).toBe(true);
    await expect(s.config.setItemSettings("p-a", "hm-02", { warnThresholdPercent: 60 }, pm)).resolves.toBeTruthy();
    await expect(s.config.setInstallments("p-a", "hm-01", plan, { ...dxDirector, heldRoleCodes: ["WORKSPACE_ADMIN"] } as typeof founder)).resolves.toBeTruthy();
    await expect(s.config.setItemSettings("p-a", "hm-02", { warnThresholdPercent: 70 }, founder)).resolves.toBeTruthy();
  });

  it("chi phí tháng Đã duyệt: xóa hoặc thay cần quyền Duyệt (COST_APPROVE); bản Nháp thì quyền Sửa là đủ", async () => {
    const s = scenario();
    const approved = () => row(s, "resourceMonthlyCost", (item) => item.userId === "u-a" && item.periodKey === "2026-09");
    await expect(s.config.setStaffCost({ userId: "u-a", periodKey: "2026-09", monthlyCostAmount: null }, costEditor)).rejects.toThrow("COST_APPROVE");
    await expect(s.config.setStaffCost({ userId: "u-a", periodKey: "2026-09", baseSalaryAmount: 1 }, costEditor)).rejects.toThrow("COST_APPROVE");
    expect(approved()).toMatchObject({ status: "APPROVED", totalMonthlyIncome: 27_280_000 });
    s.db.table("pnlStaffCode").push({ id: "code-a", workspaceId: WS, userId: "u-a", employeeCode: "NS-001" });
    const imported = (await s.config.importStaffCosts({ periodKey: "2026-09", rows: [{ employeeCode: "NS-001", baseSalaryAmount: 1 }] }, costEditor)).data;
    expect(imported).toMatchObject({ validCount: 0, errors: [{ employeeCode: "NS-001" }] });
    expect(imported.errors[0].reason).toContain("Đã duyệt");
    expect(approved()).toMatchObject({ status: "APPROVED", totalMonthlyIncome: 27_280_000 });
    // A draft is the editor's to change and remove.
    await s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", baseSalaryAmount: 20_000_000 }, costEditor);
    await expect(s.config.setStaffCost({ userId: "u-b", periodKey: "2026-09", monthlyCostAmount: null }, costEditor)).resolves.toMatchObject({ data: { status: "NONE" } });
    // Founder/GM holds both rights.
    await expect(s.config.setStaffCost({ userId: "u-a", periodKey: "2026-09", monthlyCostAmount: null }, founder)).resolves.toMatchObject({ data: { status: "NONE" } });
  });

  it("nhân sự phải thuộc workspace của người gọi", async () => {
    const s = scenario();
    s.db.table("user").push({ id: "u-other", displayName: "Người workspace khác", email: "other@example.test", subjectType: "INTERNAL_USER", status: "ACTIVE" });
    s.db.table("roleBinding").push({ id: "rb-other", userId: "u-other", roleId: "role-DX", workspaceId: "ws-2", endsAt: null });
    await expect(s.config.setStaffCost({ userId: "u-other", periodKey: "2026-09", baseSalaryAmount: 1 }, founder)).rejects.toThrow("không thuộc workspace");
    await expect(s.config.staffCostsOfUser("u-other", founder)).rejects.toThrow("không thuộc workspace");
    await expect(s.config.setEmployeeCode({ userId: "u-other", employeeCode: "NS-999" }, founder)).rejects.toThrow("không thuộc workspace");
    expect(s.db.table("resourceMonthlyCost").some((item) => item.userId === "u-other")).toBe(false);
  });
});

describe("4, 5 · Tổng quan: ô tổng và dòng tổng", () => {
  it("lọc theo một nhóm chi phí: năm ô tổng, dòng tổng và đối soát cùng tính trên các dự án đang hiện", async () => {
    const s = scenario();
    addProjectB(s);
    s.approveG7("2026-09-30");
    const all = (await s.pnl.dashboard({ year: 2026 }, founder)).data;
    expect(all.totals.projectCount).toBe(2);
    const filtered = (await s.pnl.dashboard({ year: 2026, groupKey: "FUND" }, founder)).data; // only Dự án A has a fund share
    expect(filtered.accepted.rows.map((item) => item.projectId)).toEqual(["p-a"]);
    const only = filtered.accepted.rows[0];
    expect(filtered.totals).toMatchObject({ projectCount: 1, revenueAmount: only.revenueAmount, laborCostAmount: only.laborCostAmount, otherCostAmount: only.otherCostAmount, totalCostAmount: only.totalCostAmount, ebitAmount: only.ebitAmount });
    expect(filtered.accepted.totalRow).toMatchObject({ revenueAmount: only.revenueAmount, laborCostAmount: only.laborCostAmount, otherCostAmount: only.otherCostAmount, ebitAmount: only.ebitAmount });
    expect(filtered.accepted.reconciliation.loggedMinutes).toBe(only.reconciliation.loggedMinutes);
    expect(filtered.filter.countedProjectCount).toBe(1);
    // The group cards still describe every accepted project, so another group can be picked.
    expect(filtered.costGroups.role).toEqual(all.costGroups.role);
  });

  const project = (patch: Partial<ProjectPnlInput>) => computeProjectPnl({
    entries: [], items: [{ id: "hm-01", contractType: "FIXED_PRICE", valueAmount: 60_000_000 }], closePassed: true, g1Passed: true, lostDeal: false, consumable: false, lockedPeriods: new Set(["2026-08"]),
    fundShares: [], unallocatedFundPeriods: new Set(), manualLines: [], tree: DEFAULT_COST_TREE, disabledCodes: new Set(), commissionPercent: 5, sellRate: () => undefined, ...patch
  });
  const hour = (patch: Partial<Parameters<typeof classifyEntry>[0]> = {}) => classifyEntry({ id: `e-${Math.random()}`, projectId: "p-1", userId: "u-a", dateKey: "2026-08-03", minutes: 480, roleGroup: "DELIVERY", taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", afterPnlClose: false, ...patch }, { monthlyAmount: 25_200_000, standardMinutes: 168 * 60 });

  it("PL-25: dự án Không tính được không vào ô nào; EBIT = Doanh thu − Tổng chi phí trên cùng một tập dự án", () => {
    const known = project({ entries: [hour()] });
    const noContract = project({ items: [], entries: [hour()] });
    // Qua G7 nhưng hạng mục Theo giờ thiếu đơn giá bán: chưa có doanh thu → Không tính được.
    const noSellRate = project({ items: [{ id: "hm-01", contractType: "TIME_AND_MATERIAL", valueAmount: 7_200_000 }], entries: [hour()] });
    expect(noSellRate.result.label).toBe("not_computable");
    const totals = dashboardTotals([known, noContract, noSellRate]);
    expect(totals).toMatchObject({ projectCount: 3, notComputableProjectCount: 2, revenueAmount: known.revenue.amount, totalCostAmount: known.totalCostAmount, laborCostAmount: known.laborCostAmount, ebitAmount: known.ebit.amount, label: "provisional" });
    expect((totals.revenueAmount as number) - totals.totalCostAmount).toBe(totals.ebitAmount);
  });

  it("dải Dữ liệu chờ xử lý nêu số dự án Không tính được đã để ngoài ô tổng", async () => {
    const s = scenario();
    addProjectB(s);
    s.approveG7("2026-09-30");
    Object.assign(row(s, "projectContractItem", (item) => item.id === "hm-b"), { valueAmount: null }); // Dự án B: chưa có giá trị hợp đồng
    const { data } = await s.pnl.dashboard({ year: 2026 }, founder);
    const a = data.accepted.rows.find((item) => item.projectId === "p-a")!;
    expect(data.totals).toMatchObject({ projectCount: 2, notComputableProjectCount: 1, revenueAmount: a.revenueAmount, totalCostAmount: a.totalCostAmount, ebitAmount: a.ebitAmount });
    expect(data.pending.find((item) => item.kind === "not_computable")).toMatchObject({ label: "1 dự án Không tính được, chưa cộng vào ô tổng", target: "project_setup" });
    expect(sum(data.costGroups.accounting.map((item) => item.amount))).toBe(data.totals.totalCostAmount);
  });
});

describe("6 · dự án chưa có dòng gate (đã hoàn thành theo trạng thái)", () => {
  it("không có lịch sử trạng thái: ngày nghiệm thu chỉ là ước lượng để hiển thị, kết quả Tạm tính kèm lý do, không bao giờ Chính thức", async () => {
    const s = scenario();
    addLegacyProject(s);
    await s.pnl.lockPeriod("2026-08", founder); // nothing of the old project is open in 08; 09 stays open
    const data = await s.project({}, "p-old");
    expect(data.header).toMatchObject({ acceptedOn: "2026-09-22", acceptedOnEstimated: true }); // latest of last log (22/09) and planned end (18/09)
    expect(data.header.result.label).toBe("provisional");
    expect(data.header.result.reasons).toContainEqual({ code: "missing_acceptance_date", label: "Thiếu ngày nghiệm thu (G7)", target: "project_setup" });
    const inSeptember = (await s.pnl.dashboard({ year: 2026, unit: "month", index: 9, rule: "accepted_in_period" }, founder)).data.accepted.rows;
    expect(inSeptember.find((item) => item.projectId === "p-old")).toMatchObject({ acceptedOn: "2026-09-22", acceptedOnEstimated: true, result: { label: "provisional" } });
    // Checklist điều kiện 5 của tháng ước lượng nêu tên dự án thiếu ngày nghiệm thu.
    const checklist = (await s.pnl.periods({ periodKey: "2026-09" }, founder)).data.selected!.checklist.find((item) => item.key === "accepted_projects")!;
    expect(checklist).toMatchObject({ ok: false, names: ["Dự án cũ"] });
  });

  it("mọi tháng đã khóa, hết giờ chờ: vẫn Tạm tính và hồ sơ dừng ở Đã đóng", () => {
    const pnl = computeProjectPnl({
      entries: [], items: [{ id: "hm-01", contractType: "FIXED_PRICE", valueAmount: 60_000_000 }], closePassed: true, acceptanceDateMissing: true, g1Passed: true, lostDeal: false, consumable: false, lockedPeriods: new Set(["2026-08"]),
      fundShares: [], unallocatedFundPeriods: new Set(), manualLines: [], tree: DEFAULT_COST_TREE, disabledCodes: new Set(), commissionPercent: 5, sellRate: () => undefined
    });
    expect(pnl.result.label).toBe("provisional");
    expect(pnl.recordState).toBe("closed");
  });

  it("có lịch sử trạng thái: lấy ngày chuyển sang Đã hoàn thành làm ngày nghiệm thu", async () => {
    const s = scenario();
    addLegacyProject(s);
    s.db.table("projectStatusHistory").push({ id: "psh-old", projectId: "p-old", fromStatus: "active", toStatus: "completed", closeReasonCode: null, changedAt: new Date("2026-09-25T03:00:00.000Z") });
    const header = (await s.project({}, "p-old")).header;
    expect(header).toMatchObject({ acceptedOn: "2026-09-25", acceptedOnEstimated: false });
    expect(header.result.reasons.map((reason) => reason.code)).not.toContain("missing_acceptance_date");
  });
});

describe("7 · dự án qua G7 giữ mẫu tại thời điểm nghiệm thu (mục 6.6)", () => {
  it("freezeTemplateAtClose: gọi được từ hook G7, không cần ai mở màn P&L; gọi lại không đổi gì", async () => {
    const s = scenario();
    await s.pnl.freezeTemplateAtClose(WS, "p-a");
    expect(row(s, "projectPnlRecord", (item) => item.projectId === "p-a").frozenAt).toBeNull(); // chưa qua G7
    s.approveG7("2026-09-30");
    await s.pnl.freezeTemplateAtClose(WS, "p-a");
    const record = { ...row(s, "projectPnlRecord", (item) => item.projectId === "p-a") };
    expect(record.frozenAt).toEqual(new Date("2026-09-30T03:00:00.000Z"));
    await s.pnl.freezeTemplateAtClose(WS, "p-a");
    expect(row(s, "projectPnlRecord", (item) => item.projectId === "p-a")).toMatchObject({ frozenAt: record.frozenAt, frozenDisabledCodes: record.frozenDisabledCodes });
  });

  it("mẫu bị sửa sau G7 nhưng trước lần đọc đầu tiên: dự án vẫn theo mẫu tại ngày G7; Tổng quan cũng chốt", async () => {
    const s = scenario();
    s.approveG7("2026-09-30");
    await s.config.setTemplate("customer", { disabledCodes: ["CP.HOAHONG"] }, founder); // after G7, before anybody read the project
    const { data } = await s.pnl.dashboard({ year: 2026 }, founder);
    expect(data.accepted.rows[0].costByRoleGroup.COMMISSION).toBe(3_000_000); // 60.000.000 × 5%
    expect(row(s, "projectPnlRecord", (item) => item.projectId === "p-a")).toMatchObject({ frozenAt: new Date("2026-09-30T03:00:00.000Z") });
    expect(row(s, "projectPnlRecord", (item) => item.projectId === "p-a").frozenDisabledCodes).not.toContain("CP.HOAHONG");
    expect((await s.project()).months.wholeProjectItems[0]).toMatchObject({ amount: 3_000_000, expected: false });
  });
});

describe("8 · các điểm nhỏ ảnh hưởng tới số", () => {
  it("route cũ POST/PATCH/DELETE /project-costs đã gỡ: chi phí riêng chỉ vào qua dòng Nhập tay", () => {
    for (const method of ["listProjectCosts", "createProjectCost", "updateProjectCost", "deleteProjectCost"]) expect(method in ResourceControlsService.prototype).toBe(false);
  });

  it("thu hẹp Từ tháng – Đến tháng: Khoản tính cho cả dự án ghi “Chỉ xem ở Toàn dự án”, không hiện số", async () => {
    const s = scenario();
    expect((await s.project()).months.wholeProjectItems[0]).toMatchObject({ amount: 3_360_000 });
    const narrowed = await s.project({ fromMonth: "2026-08", toMonth: "2026-08" });
    expect(narrowed.months.wholeProjectItems).toEqual([expect.objectContaining({ code: "CP.HOAHONG", amount: null, note: "Chỉ xem ở Toàn dự án" })]);
    expect(narrowed.months.whole.totalCostAmount).toBe(month(narrowed, "2026-08").totalCostAmount);
  });

  it("chi phí từng dòng giờ và từng task chia từ ô người × tháng: cộng lại đúng bằng ô đó", async () => {
    const s = scenario();
    s.log({ userId: "u-a", taskId: "t-cr", dateKey: "2026-09-28", hours: 1.5 });
    const entries = (await s.pnl.entries({ projectId: "p-a", userId: "u-a", periodKey: "2026-09", status: "included" }, founder));
    const bucket = Math.round((22.5 * 60 * 27_280_000) / (168 * 60)); // 22,5 giờ × 27.280.000 ÷ 168
    expect(sum(entries.data.map((item) => item.costAmount))).toBe(bucket);
    expect(entries.meta.totalCostAmount).toBe(bucket);
    const [detail] = (await s.pnl.projectMonths("p-a", "2026-09", founder)).data;
    expect(detail.people.find((item) => item.userId === "u-a")!.laborCostAmount).toBe(bucket);
    expect(sum(detail.tasks.map((item) => item.laborCostAmount))).toBe(sum(detail.people.map((item) => item.laborCostAmount)));
  });

  it("entryCosts: phần lẻ dồn vào dòng cuối của ô", () => {
    const rate = { monthlyAmount: 27_280_000, standardMinutes: 168 * 60 };
    const base = { projectId: "p-1", userId: "u-a", roleGroup: "DELIVERY" as const, taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", afterPnlClose: false };
    const rows = [["e-1", "2026-09-01", 480], ["e-2", "2026-09-02", 480], ["e-3", "2026-09-03", 300]].map(([id, dateKey, minutes]) => classifyEntry({ ...base, id: id as string, dateKey: dateKey as string, minutes: minutes as number }, rate));
    const costs = entryCosts(rows);
    expect([...costs.values()]).toEqual([1_299_048, 1_299_048, 811_904]); // 3.410.000 đ in all, not 3.410.001
  });

  it("trạng thái đợt thanh toán không lùi", async () => {
    const s = scenario();
    await s.config.setInstallmentStatus("p-a", "default:hm-01:1", { status: "paid" }, founder);
    const id = s.db.table("projectContractInstallment").find((item) => item.sequence === 1)!.id;
    await expect(s.config.setInstallmentStatus("p-a", id, { status: "invoiced" }, founder)).rejects.toThrow("không lùi");
    expect(s.db.table("projectContractInstallment").find((item) => item.sequence === 1)!.status).toBe("paid");
  });

  it("giờ vượt giờ chuẩn tháng: Chưa phân bổ dừng ở 0, phần vượt là dòng riêng, đẳng thức PL-12 vẫn đúng", () => {
    const rate = { monthlyAmount: 25_200_000, standardMinutes: 168 * 60 };
    const over = classifyEntry({ id: "e-1", projectId: "p-1", userId: "u-a", dateKey: "2026-08-03", minutes: 200 * 60, roleGroup: "DELIVERY", taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", afterPnlClose: false }, rate);
    const result = companyCostMonth("2026-08", 25_200_000, [over], new Set());
    expect(result.projectLaborAmount).toBe(30_000_000);
    expect(result.lines.unallocated.amount).toBe(0);
    expect(result.overAllocatedAmount).toBe(4_800_000);
    expect(result.projectLaborAmount + result.lines.unallocated.amount - result.overAllocatedAmount).toBe(result.staffCostAmount);
  });
});

// Locking is in order now (pnl-remaining-fixes.spec.ts); months locked out of order before that rule still exist in the data.
describe("9b · dữ liệu cũ khóa không theo thứ tự: tham số của tháng đã khóa đọc từ ảnh chụp", () => {
  it("giá trị mới có hiệu lực từ một tháng còn mở phía trước không đổi hoa hồng và doanh thu Theo giờ của tháng đã khóa", async () => {
    const s = scenario();
    s.log({ userId: "u-a", taskId: "t-cr", dateKey: "2026-09-28", hours: 10 }); // HM-02 Theo giờ: 10 giờ × 400.000 = 4.000.000
    await s.approveCost("u-b", "2026-09", 25_200_000);
    await s.pnl.confirmFund("fund-ai", "2026-09", founder);
    s.approveG7("2026-09-30");
    await s.pnl.lockPeriod("2026-08", founder);
    await s.pnl.lockPeriod("2026-09", founder);
    // The state the old code allowed: tháng 09 khóa, tháng 08 vẫn Chờ khóa.
    row(s, "pnlPeriod", (item) => item.periodKey === "2026-08").status = "OPEN";
    row(s, "pnlPeriodSnapshot", (item) => item.periodKey === "2026-08").reopenedAt = new Date("2026-10-12T03:00:00.000Z");
    const before = await s.project();
    expect(before.totals.revenue.amount).toBe(64_000_000);
    expect(before.months.wholeProjectItems[0].amount).toBe(3_200_000);
    await s.config.addParameterValue({ key: "commissionPercent", scopeType: "company", value: 10, effectiveFrom: "2026-08", reason: "đổi chính sách" }, founder);
    await s.config.addParameterValue({ key: "sellRate", subKey: "DELIVERY", scopeType: "company", value: 500_000, effectiveFrom: "2026-08", reason: "bảng giá mới" }, founder);
    const after = await s.project();
    expect(after.totals.revenue.amount).toBe(64_000_000);
    expect(after.months.wholeProjectItems[0].amount).toBe(3_200_000);
  });
});
