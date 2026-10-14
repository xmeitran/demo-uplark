import { describe, expect, it } from "vitest";
import { DEFAULT_COST_TREE, DEFAULT_ITEM_TEMPLATES, checkCostTree, costByGroups, effectiveDisabledCodes, evaluateCostTree, templateKeyOfProjectType, type CostItemDef } from "./pnl-tree";

const inputs = { revenueAmount: 67_200_000, laborByRole: { DELIVERY: 22_610_000, PM: 3_200_000, BD: 540_000 }, manualByCode: new Map([["DOANHTHU.GHINHAN", 67_200_000]]), fundByCode: new Map([["CP.FUNCOP.AI", 1_260_000]]), params: { commissionPercent: 0.05 } };
const evaluate = (patch: Partial<typeof inputs> = {}, disabled: string[] = [], tree: CostItemDef[] = DEFAULT_COST_TREE) => evaluateCostTree(tree, effectiveDisabledCodes(tree, disabled), { ...inputs, ...patch });

describe("cây khoản mục (PL-20, PL-21)", () => {
  it("the default set is valid: no cycle, every parent is a Tổng nhóm, one labor item per role group", () => {
    const check = checkCostTree(DEFAULT_COST_TREE);
    expect(check).toMatchObject({ ok: true, cycleCodes: [], groupErrors: [], errors: [] });
    expect(new Set(DEFAULT_COST_TREE.map((row) => row.method))).toEqual(new Set(["MANUAL", "SYSTEM", "FORMULA", "FUND", "GROUP"])); // năm cách lấy số
    expect(DEFAULT_COST_TREE.find((row) => row.code === "DOANHTHU.GHINHAN")).toMatchObject({ name: "Doanh thu dự án", method: "MANUAL", required: true });
    expect(DEFAULT_COST_TREE.find((row) => row.code === "DOANHTHU.LIC")).toMatchObject({ name: "Rebate License", method: "MANUAL" });
    expect(DEFAULT_COST_TREE.find((row) => row.code === "CP.FUNCOP.AI")).toMatchObject({ parentCode: "CP.FUNCOP", method: "FUND" });
    expect(DEFAULT_COST_TREE.some((row) => /accumulate/i.test(row.name))).toBe(false);
  });

  it("rejects a system-backed revenue line", () => {
    const tree = DEFAULT_COST_TREE.map((row) => row.code === "DOANHTHU.GHINHAN" ? { ...row, method: "SYSTEM" as const, systemSource: "revenue" as const } : row);
    expect(checkCostTree(tree).errors).toContain("DOANHTHU.GHINHAN: doanh thu dự án phải dùng \"Nhập tay\", không lấy từ hệ thống.");
  });

  it("thứ tự tính do hệ thống tự suy: Hoa hồng after Doanh thu ghi nhận, Tổng chi phí after Hoa hồng, EBIT last", () => {
    const { order, dependsOn, usedBy } = checkCostTree(DEFAULT_COST_TREE);
    const at = (code: string) => order.indexOf(code);
    expect(at("DOANHTHU.GHINHAN")).toBeLessThan(at("CP.HOAHONG"));
    expect(at("CP.HOAHONG")).toBeLessThan(at("CHIPHI"));
    expect(at("CHIPHI")).toBeLessThan(at("KQ.EBIT"));
    expect(dependsOn["CP.HOAHONG"]).toEqual(["DOANHTHU.GHINHAN"]);
    expect(usedBy["CP.HOAHONG"]).toEqual(["CHIPHI"]);
  });

  it("chặn tham chiếu vòng: a formula that reads its own total is reported and nothing is evaluated for it", () => {
    const tree = DEFAULT_COST_TREE.map((row) => (row.code === "CP.HOAHONG" ? { ...row, formula: [{ item: "CHIPHI" }, { op: "*" as const }, { param: "commissionPercent" }] } : row));
    const check = checkCostTree(tree);
    expect(check.ok).toBe(false);
    expect(check.cycleCodes).toEqual(expect.arrayContaining(["CHIPHI", "CP.HOAHONG"]));
    expect(evaluateCostTree(tree, new Set(), inputs).has("CHIPHI")).toBe(false);
  });

  it("dòng có dòng con phải dùng Tổng nhóm; unknown references and a missing labor item are errors", () => {
    const withChildOfLeaf = [...DEFAULT_COST_TREE, { ...DEFAULT_COST_TREE[2], code: "X.CHILD", parentCode: "CP.WELFARE" }];
    expect(checkCostTree(withChildOfLeaf).groupErrors).toEqual(["CP.WELFARE: có dòng con nên phải dùng Tổng nhóm."]);
    expect(checkCostTree(DEFAULT_COST_TREE.filter((row) => row.code !== "CP.NS.CS")).errors.join(" ")).toContain("Nhóm vai trò CS cần đúng một khoản mục chi phí nhân sự");
    const badRef = DEFAULT_COST_TREE.map((row) => (row.code === "KQ.EBIT" ? { ...row, formula: [{ item: "NOPE" }] } : row));
    expect(checkCostTree(badRef).errors.join(" ")).toContain('tham chiếu khoản mục "NOPE" không tồn tại');
  });

  it("dòng cha = cộng dòng con; Hoa hồng = Doanh thu dự án × tỷ lệ; EBIT = doanh thu − tổng chi phí", () => {
    const values = evaluate();
    const amount = (code: string) => values.get(code)?.amount;
    expect(amount("CP.SALARIES")).toBe(26_350_000);
    expect(amount("CP.FUNCOP")).toBe(1_260_000);
    expect(amount("CP.HOAHONG")).toBe(3_360_000);
    expect(amount("CHIPHI")).toBe(30_970_000);
    expect(amount("DOANHTHU")).toBe(67_200_000);
    expect(amount("KQ.EBIT")).toBe(36_230_000);
    expect(amount("KQ.BIEN")).toBeCloseTo(53.9137, 4);
    expect(amount("KQ.CPDT")).toBeCloseTo(46.0863, 4);
    expect(values.get("KETQUA")).toEqual({ incomplete: false }); // a heading, no number
  });

  it("Nhập tay and Rebate License land where the tree puts them", () => {
    const values = evaluate({ manualByCode: new Map([["DOANHTHU.GHINHAN", 67_200_000], ["CP.FUNCOP.RIENG", 2_000_000], ["DOANHTHU.LIC", 1_000_000]]) });
    expect(values.get("CP.FUNCOP")?.amount).toBe(3_260_000);
    expect(values.get("DOANHTHU")?.amount).toBe(68_200_000);
    expect(values.get("CHIPHI")?.amount).toBe(32_970_000);
    expect(values.get("CP.HOAHONG")?.amount).toBe(3_360_000); // on Doanh thu ghi nhận, not on the rebate
  });

  it("thiếu đầu vào thì không có số — never 0: no revenue → no commission, no EBIT; no commission rate → cost is partial", () => {
    const noRevenue = evaluate({ revenueAmount: undefined, manualByCode: new Map() });
    expect(noRevenue.get("DOANHTHU.GHINHAN")?.amount).toBeUndefined();
    expect(noRevenue.get("CP.HOAHONG")?.amount).toBeUndefined();
    expect(noRevenue.get("KQ.EBIT")?.amount).toBeUndefined();
    expect(noRevenue.get("CHIPHI")).toEqual({ amount: 27_610_000, incomplete: true });
    const noRate = evaluate({ params: { commissionPercent: undefined as unknown as number } });
    expect(noRate.get("CP.HOAHONG")?.amount).toBeUndefined();
    expect(noRate.get("CHIPHI")?.incomplete).toBe(true);
  });
});

describe("mẫu khoản mục (PL-22)", () => {
  it("mẫu trùng tên với loại dự án: Khách hàng, Nội bộ, Đào tạo", () => {
    expect(DEFAULT_ITEM_TEMPLATES.map((template) => template.name)).toEqual(["Khách hàng", "Nội bộ", "Đào tạo"]);
    expect(templateKeyOfProjectType("delivery")).toBe("customer");
    expect(templateKeyOfProjectType("internal")).toBe("internal");
    expect(templateKeyOfProjectType("Training")).toBe("training");
  });

  it("mọi loại project có Doanh thu/EBIT; Nội bộ và Đào tạo chỉ giữ cách tính giờ tiêu hao", () => {
    const [customer, internal, training] = DEFAULT_ITEM_TEMPLATES;
    expect(customer).toMatchObject({ disabledCodes: [], consumable: false });
    for (const template of [internal, training]) {
      const off = effectiveDisabledCodes(DEFAULT_COST_TREE, template.disabledCodes);
      expect(["DOANHTHU", "DOANHTHU.GHINHAN", "KQ.EBIT", "KQ.BIEN"].some((code) => off.has(code))).toBe(false);
      expect(["DOANHTHU.LIC", "CP.HOAHONG"].every((code) => off.has(code))).toBe(true);
      expect(template.consumable).toBe(true);
      expect([...off].some((code) => code.startsWith("CP.NS."))).toBe(false); // labor is never switched off
    }
  });

  it("a switched-off item is left out of every sum", () => {
    const values = evaluate({}, DEFAULT_ITEM_TEMPLATES[1].disabledCodes);
    expect(values.has("CP.HOAHONG")).toBe(false);
    expect(values.has("KQ.EBIT")).toBe(true);
    expect(values.get("CHIPHI")).toEqual({ amount: 27_610_000, incomplete: false });
  });
});

describe("chi phí theo nhóm, sinh từ cây (mục 4 khối 4)", () => {
  it("Nhóm hạch toán = the children of Tổng chi phí; Vai trò = labor by role, Quỹ chung, Hoa hồng, Chi phí riêng", () => {
    const values = evaluate({ manualByCode: new Map([["DOANHTHU.GHINHAN", 67_200_000], ["CP.FUNCOP.RIENG", 800_000]]) });
    const groups = costByGroups(DEFAULT_COST_TREE, new Set(), values);
    const amounts = (rows: typeof groups.role) => Object.fromEntries(rows.filter((row) => row.amount !== 0).map((row) => [row.label, row.amount]));
    expect(amounts(groups.accounting)).toEqual({ "Salaries related": 26_350_000, "Functional operation": 2_060_000, "Hoa hồng": 3_360_000 });
    expect(amounts(groups.role)).toEqual({ "Delivery/DX": 22_610_000, PM: 3_200_000, BD: 540_000, "Quỹ chung": 1_260_000, "Hoa hồng": 3_360_000, "Chi phí riêng": 800_000 });
    const total = values.get("CHIPHI")!.amount;
    expect(groups.accounting.reduce((sum, row) => sum + row.amount, 0)).toBe(total);
    expect(groups.role.reduce((sum, row) => sum + row.amount, 0)).toBe(total);
  });
});
