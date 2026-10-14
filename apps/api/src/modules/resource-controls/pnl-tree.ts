/**
 * Cây khoản mục (PL-20, PL-21, mục 6.2) and Mẫu khoản mục (PL-22, mục 6.6). Pure.
 * One tree for the workspace, one currency. Every cost group a screen shows is generated from it.
 */
import { INTERNAL_WORKLOG_PROJECT_TYPE, projectKindOf, type PnlCostItemMethod, type PnlFormulaToken } from "@b2b-crm/contracts";
import { ROLE_GROUP_LABELS, type RoleGroup } from "./pnl-rules";

export interface CostItemDef {
  code: string;
  name: string;
  parentCode: string | null;
  /** +1 adds to the parent, -1 subtracts. */
  sign: 1 | -1;
  roleGroup: RoleGroup | null;
  /** VND, PERCENT (a ratio shown as %), NONE (a heading that carries no number). */
  unit: "VND" | "PERCENT" | "NONE";
  method: PnlCostItemMethod;
  /** SYSTEM only: which figure of the chain feeds the item. */
  systemSource?: "revenue" | "labor" | null;
  /** FORMULA only: operands and operators picked from the list, never free text. */
  formula?: PnlFormulaToken[] | null;
  required: boolean;
  sortOrder: number;
}

/** The five "cách lấy số" (PL-21). */
export const COST_ITEM_METHOD_LABELS: Record<PnlCostItemMethod, string> = {
  MANUAL: "Nhập tay",
  SYSTEM: "Lấy từ hệ thống",
  FORMULA: "Công thức",
  FUND: "Phân bổ quỹ",
  GROUP: "Tổng nhóm"
};

/** Codes the chain itself reads. They can be renamed and moved, never removed or given another method. */
export const SYSTEM_ITEM_CODES = {
  revenueGroup: "DOANHTHU",
  revenue: "DOANHTHU.GHINHAN",
  rebate: "DOANHTHU.LIC",
  costGroup: "CHIPHI",
  commission: "CP.HOAHONG",
  resultGroup: "KETQUA",
  ebit: "KQ.EBIT",
  margin: "KQ.BIEN",
  costRatio: "KQ.CPDT"
} as const;

/**
 * Revenue used to be represented as a SYSTEM item named "Doanh thu ghi nhận".
 * Keep the code stable for saved formulas and old workspaces, but make its input
 * semantics explicit: one amount entered manually for every project type.
 */
export function normalizeRevenueItem<T extends { code: string; name: string; method: PnlCostItemMethod; systemSource?: "revenue" | "labor" | null; required?: boolean }>(row: T): T {
  if (row.code !== SYSTEM_ITEM_CODES.revenue) return row;
  return {
    ...row,
    name: row.name === "Doanh thu ghi nhận" ? "Doanh thu dự án" : row.name,
    method: "MANUAL",
    systemSource: null,
    required: true
  };
}

const item = (code: string, name: string, parentCode: string | null, method: PnlCostItemMethod, extra: Partial<CostItemDef> = {}): Omit<CostItemDef, "sortOrder"> =>
  ({ code, name, parentCode, method, sign: 1, roleGroup: null, unit: "VND", required: false, ...extra });

/**
 * Bộ khoản mục mặc định (mục 6.2 khối 2). The accounting groups are the six expense groups already used by the
 * workspace (BRD 2.1); "Khung I.10" itself is not in the repository, so its exact group names are the Admin's to adjust.
 * Doanh thu dự án has its own stable code and is entered manually per project; DOANHTHU.LIC is Rebate License. Chi phí công cụ AI sits under Functional operation.
 * No "Accumulate EBIT": the project P&L already covers the whole lifecycle.
 */
export const DEFAULT_COST_TREE: CostItemDef[] = [
  item("DOANHTHU", "Doanh thu", null, "GROUP"),
  item("DOANHTHU.GHINHAN", "Doanh thu dự án", "DOANHTHU", "MANUAL", { required: true }),
  item("DOANHTHU.LIC", "Rebate License", "DOANHTHU", "MANUAL"),
  item("CHIPHI", "Tổng chi phí", null, "GROUP"),
  item("CP.SALARIES", "Salaries related", "CHIPHI", "GROUP"),
  item("CP.NS.DELIVERY", "Chi phí nhân sự Delivery/DX", "CP.SALARIES", "SYSTEM", { systemSource: "labor", roleGroup: "DELIVERY", required: true }),
  item("CP.NS.PM", "Chi phí nhân sự PM", "CP.SALARIES", "SYSTEM", { systemSource: "labor", roleGroup: "PM" }),
  item("CP.NS.BD", "Chi phí nhân sự BD", "CP.SALARIES", "SYSTEM", { systemSource: "labor", roleGroup: "BD" }),
  item("CP.WELFARE", "Welfare related", "CHIPHI", "MANUAL"),
  item("CP.BASIC", "Basic activities", "CHIPHI", "MANUAL"),
  item("CP.LOCATION", "Business location", "CHIPHI", "MANUAL"),
  item("CP.SELLMKT", "Sell & marketing", "CHIPHI", "MANUAL"),
  item("CP.FUNCOP", "Functional operation", "CHIPHI", "GROUP"),
  item("CP.FUNCOP.AI", "Chi phí công cụ AI", "CP.FUNCOP", "FUND"),
  item("CP.FUNCOP.SOFTWARE", "Phần mềm dùng chung", "CP.FUNCOP", "FUND"),
  item("CP.FUNCOP.RIENG", "Chi phí thuê ngoài, license riêng", "CP.FUNCOP", "MANUAL"),
  item("CP.NS.CS", "Chi phí nhân sự CS", "CHIPHI", "SYSTEM", { systemSource: "labor", roleGroup: "CS" }),
  item("CP.HOAHONG", "Hoa hồng", "CHIPHI", "FORMULA", { roleGroup: "BD", required: true, formula: [{ item: "DOANHTHU.GHINHAN" }, { op: "*" }, { param: "commissionPercent" }] }),
  item("KETQUA", "Kết quả", null, "GROUP", { unit: "NONE" }),
  item("KQ.EBIT", "EBIT", "KETQUA", "FORMULA", { formula: [{ item: "DOANHTHU" }, { op: "-" }, { item: "CHIPHI" }] }),
  item("KQ.BIEN", "Biên EBIT", "KETQUA", "FORMULA", { unit: "PERCENT", formula: [{ item: "KQ.EBIT" }, { op: "/" }, { item: "DOANHTHU" }] }),
  item("KQ.CPDT", "% Chi phí / Doanh thu", "KETQUA", "FORMULA", { unit: "PERCENT", formula: [{ item: "CHIPHI" }, { op: "/" }, { item: "DOANHTHU" }] })
].map((row, index) => ({ ...row, sortOrder: (index + 1) * 10 }));

/** Mẫu khoản mục: a template only switches items of the default set on or off (PL-22). */
export interface ItemTemplateDef {
  key: string;
  name: string;
  disabledCodes: string[];
  /** Read as "chi phí tiêu hao" for hours; revenue is still entered per project. */
  consumable: boolean;
}

/** Revenue and its result ratios are always available for every project type. */
export const REVENUE_ALWAYS_ON_CODES: ReadonlySet<string> = new Set([
  SYSTEM_ITEM_CODES.revenueGroup,
  SYSTEM_ITEM_CODES.revenue,
  SYSTEM_ITEM_CODES.ebit,
  SYSTEM_ITEM_CODES.margin,
  SYSTEM_ITEM_CODES.costRatio
]);

/** Internal/training only disable optional revenue-side inputs, not project revenue itself. */
const INTERNAL_DISABLED = ["DOANHTHU.LIC", "CP.HOAHONG"];
/** Mẫu trùng tên với Loại dự án: Khách hàng, Nội bộ, Đào tạo. */
export const DEFAULT_ITEM_TEMPLATES: ItemTemplateDef[] = [
  { key: "customer", name: "Khách hàng", disabledCodes: [], consumable: false },
  { key: "internal", name: "Nội bộ", disabledCodes: INTERNAL_DISABLED, consumable: true },
  { key: "training", name: "Đào tạo", disabledCodes: INTERNAL_DISABLED, consumable: true }
];

/** Project.projectType (Loại dự án) → template key: Khách hàng, Nội bộ (the fixed worklog project too) or Đào tạo. */
export function templateKeyOfProjectType(projectType: unknown): string {
  const kind = projectKindOf(projectType);
  if (kind === "internal" || kind === INTERNAL_WORKLOG_PROJECT_TYPE) return "internal";
  return kind === "training" ? "training" : "customer";
}

/** A code is off when it, or any ancestor, is switched off. */
export function effectiveDisabledCodes(items: readonly CostItemDef[], disabledCodes: Iterable<string>): Set<string> {
  const off = new Set(disabledCodes);
  const byCode = new Map(items.map((row) => [row.code, row]));
  const result = new Set<string>();
  for (const row of items) {
    for (let cursor: CostItemDef | undefined = row, guard = 0; cursor && guard < 50; cursor = cursor.parentCode ? byCode.get(cursor.parentCode) : undefined, guard += 1) {
      if (off.has(cursor.code)) { result.add(row.code); break; }
    }
  }
  return result;
}

/** Remove legacy template settings that disabled the now-universal revenue/result lines. */
export function normalizeTemplateDisabledCodes(disabledCodes: Iterable<string>): string[] {
  return [...new Set(disabledCodes)].filter((code) => !REVENUE_ALWAYS_ON_CODES.has(code));
}

export interface CostTreeCheck {
  /** Codes caught in a reference cycle (a formula reading itself through other items, or a parent loop). Blocks "Áp dụng". */
  cycleCodes: string[];
  /** Every item with children uses Tổng nhóm, and every Tổng nhóm item is summed by the system. */
  groupErrors: string[];
  /** Anything else that would make a figure wrong: unknown references, a missing system item, an invalid method. */
  errors: string[];
  /** Thứ tự tính, derived — nobody types it. */
  order: string[];
  dependsOn: Record<string, string[]>;
  usedBy: Record<string, string[]>;
  ok: boolean;
}

function dependenciesOf(row: CostItemDef, children: Map<string, CostItemDef[]>): string[] {
  if (row.method === "GROUP") return (children.get(row.code) ?? []).map((child) => child.code);
  if (row.method === "FORMULA") return (row.formula ?? []).flatMap((token) => ("item" in token ? [token.item] : []));
  return [];
}

/** Thanh "Kiểm tra cấu hình" (mục 6.2 khối 1) and the derived calculation order (PL-21). */
export function checkCostTree(items: readonly CostItemDef[]): CostTreeCheck {
  const byCode = new Map(items.map((row) => [row.code, row]));
  const children = new Map<string, CostItemDef[]>();
  for (const row of items) if (row.parentCode) children.set(row.parentCode, [...(children.get(row.parentCode) ?? []), row]);
  const errors: string[] = [];
  const groupErrors: string[] = [];
  if (byCode.size !== items.length) errors.push("Có mã khoản mục bị trùng.");
  const dependsOn: Record<string, string[]> = {};
  const usedBy: Record<string, string[]> = Object.fromEntries(items.map((row) => [row.code, [] as string[]]));
  for (const row of items) {
    if (row.parentCode && !byCode.has(row.parentCode)) errors.push(`${row.code}: khoản mục cha "${row.parentCode}" không tồn tại.`);
    if (children.has(row.code) && row.method !== "GROUP") groupErrors.push(`${row.code}: có dòng con nên phải dùng Tổng nhóm.`);
    if (row.method === "FORMULA") {
      const error = formulaShapeError(row.formula ?? []);
      if (error) errors.push(`${row.code}: ${error}`);
    }
    if (row.method === "SYSTEM" && row.systemSource === "revenue") errors.push(`${row.code}: doanh thu dự án phải dùng "Nhập tay", không lấy từ hệ thống.`);
    else if (row.method === "SYSTEM" && !(row.systemSource === "labor" && row.roleGroup)) errors.push(`${row.code}: "Lấy từ hệ thống" chỉ dùng cho Chi phí nhân sự kèm Nhóm vai trò.`);
    const deps = dependenciesOf(row, children);
    for (const dep of deps) {
      if (!byCode.has(dep)) errors.push(`${row.code}: tham chiếu khoản mục "${dep}" không tồn tại.`);
      else usedBy[dep].push(row.code);
    }
    dependsOn[row.code] = deps.filter((dep) => byCode.has(dep));
  }
  // Every role group needs exactly one labor item, or labor cost of that group would vanish from (or double in) the total.
  for (const group of Object.keys(ROLE_GROUP_LABELS) as RoleGroup[]) {
    const count = items.filter((row) => row.method === "SYSTEM" && row.systemSource === "labor" && row.roleGroup === group).length;
    if (count !== 1) errors.push(`Nhóm vai trò ${ROLE_GROUP_LABELS[group]} cần đúng một khoản mục chi phí nhân sự (đang có ${count}).`);
  }
  for (const code of [SYSTEM_ITEM_CODES.revenueGroup, SYSTEM_ITEM_CODES.revenue, SYSTEM_ITEM_CODES.costGroup, SYSTEM_ITEM_CODES.commission]) {
    if (!byCode.has(code)) errors.push(`Thiếu khoản mục hệ thống ${code}.`);
  }
  // Kahn's algorithm; whatever is left has a cycle.
  const remaining = new Map(Object.entries(dependsOn).map(([code, deps]) => [code, new Set(deps)]));
  const order: string[] = [];
  for (let progressed = true; progressed && remaining.size; ) {
    progressed = false;
    for (const row of items) {
      const deps = remaining.get(row.code);
      if (!deps || deps.size) continue;
      order.push(row.code);
      remaining.delete(row.code);
      for (const other of remaining.values()) other.delete(row.code);
      progressed = true;
    }
  }
  const cycleCodes = [...remaining.keys()];
  return { cycleCodes, groupErrors, errors, order, dependsOn, usedBy, ok: !cycleCodes.length && !groupErrors.length && !errors.length };
}

function formulaShapeError(tokens: readonly PnlFormulaToken[]): string | undefined {
  if (!tokens.length) return "công thức đang trống.";
  if (tokens.length % 2 === 0) return "công thức phải xen kẽ đại lượng và phép tính.";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isOperator = "op" in token;
    if (isOperator !== (index % 2 === 1)) return "công thức phải xen kẽ đại lượng và phép tính.";
    if (isOperator && !["+", "-", "*", "/"].includes(token.op)) return `phép tính "${String(token.op)}" không hợp lệ.`;
  }
  return undefined;
}

export interface CostItemValue {
  /** Undefined = the item has no number (an input is missing). Never 0 in its place (PL-25). */
  amount?: number;
  /** A summed child had no number: the amount is a partial sum. */
  incomplete: boolean;
}

export interface CostTreeInputs {
  /** Legacy revenue input kept for the engine boundary; it is copied to the manual project-revenue item. */
  revenueAmount?: number;
  laborByRole: Partial<Record<RoleGroup, number>>;
  /** Nhập tay lines by item code. */
  manualByCode: ReadonlyMap<string, number>;
  /** Confirmed fund shares by target item code. */
  fundByCode: ReadonlyMap<string, number>;
  /** Parameters a formula may read. Percent parameters are passed as fractions (5% → 0.05). */
  params: Readonly<Record<string, number | undefined>>;
}

/**
 * The one place a sign is applied — the tree total, the month rows and the cost-group cards all read it, so they add up.
 * What `amount` of the item `code` adds to its ancestor `ancestorCode`: the amount × the signs on the way up (the item's
 * own included, the ancestor's not). 0 when the item is not under that ancestor, or it or anything on the way is switched off.
 */
export function contributionOf(byCode: ReadonlyMap<string, CostItemDef>, disabled: ReadonlySet<string>, code: string, ancestorCode: string, amount: number): number {
  let factor = 1;
  for (let cursor = byCode.get(code), guard = 0; cursor && guard < 50; cursor = cursor.parentCode ? byCode.get(cursor.parentCode) : undefined, guard += 1) {
    if (cursor.code === ancestorCode) return factor * amount || 0; // never -0
    if (disabled.has(cursor.code)) return 0;
    factor *= cursor.sign;
  }
  return 0;
}

const roundTo = (value: number, unit: CostItemDef["unit"]) => (unit === "PERCENT" ? Math.round(value * 1e6) / 1e4 : Math.round(value));

/** × and ÷ before + and −, left to right. Any operand without a number, or a division by zero, leaves the formula without one. */
function evaluateFormula(tokens: readonly PnlFormulaToken[], read: (token: PnlFormulaToken) => number | undefined): number | undefined {
  const values: number[] = [];
  const operators: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if ("op" in token) { operators.push(token.op); continue; }
    const value = read(token);
    if (value === undefined) return undefined;
    const previous = operators[operators.length - 1];
    if (previous === "*" || previous === "/") {
      operators.pop();
      const left = values.pop() as number;
      if (previous === "/" && value === 0) return undefined;
      values.push(previous === "*" ? left * value : left / value);
    } else values.push(value);
  }
  return values.slice(1).reduce((total, value, index) => (operators[index] === "-" ? total - value : total + value), values[0]);
}

/**
 * Step 10: "Dòng cha = cộng dòng con". Values are computed in the derived order; items switched off by the project's
 * template are left out of every sum. A tree with a cycle evaluates nothing (the config check blocks applying one).
 */
export function evaluateCostTree(items: readonly CostItemDef[], disabled: ReadonlySet<string>, inputs: CostTreeInputs): Map<string, CostItemValue> {
  const check = checkCostTree(items);
  const byCode = new Map(items.map((row) => [row.code, row]));
  const children = new Map<string, CostItemDef[]>();
  for (const row of items) if (row.parentCode) children.set(row.parentCode, [...(children.get(row.parentCode) ?? []), row]);
  const result = new Map<string, CostItemValue>();
  for (const code of check.order) {
    const row = byCode.get(code) as CostItemDef;
    if (disabled.has(code)) continue;
    let value: CostItemValue;
    switch (row.method) {
      case "SYSTEM":
        value = row.systemSource === "revenue" ? { amount: inputs.revenueAmount, incomplete: false } : { amount: inputs.laborByRole[row.roleGroup as RoleGroup] ?? 0, incomplete: false };
        break;
      case "MANUAL": {
        const amount = inputs.manualByCode.get(code);
        // Required manual inputs (currently project revenue) must stay missing,
        // not become 0, so the P&L can explain why EBIT is unavailable.
        value = { amount: amount ?? (row.required ? undefined : 0), incomplete: false };
        break;
      }
      case "FUND":
        value = { amount: inputs.fundByCode.get(code) ?? 0, incomplete: false };
        break;
      case "FORMULA": {
        let incomplete = false;
        const amount = evaluateFormula(row.formula ?? [], (token) => {
          if ("value" in token) return token.value;
          if ("param" in token) return inputs.params[token.param];
          if (!("item" in token) || disabled.has(token.item)) return undefined;
          const operand = result.get(token.item);
          incomplete = incomplete || Boolean(operand?.incomplete);
          return operand?.amount;
        });
        value = { amount: amount === undefined || !Number.isFinite(amount) ? undefined : roundTo(amount, row.unit), incomplete };
        break;
      }
      default: {
        if (row.unit === "NONE") { value = { incomplete: false }; break; }
        const active = (children.get(code) ?? []).filter((child) => !disabled.has(child.code));
        const known = active.filter((child) => result.get(child.code)?.amount !== undefined);
        const incomplete = known.length !== active.length || active.some((child) => result.get(child.code)?.incomplete);
        // Revenue that is not known yet leaves its group without a number (PL-25 "Không tính được") — a rebate alone is not
        // the project's revenue. A missing cost component only makes the cost total partial (Tạm tính).
        const revenueMissing = active.some((child) => child.code === SYSTEM_ITEM_CODES.revenue && result.get(child.code)?.amount === undefined);
        value = { amount: revenueMissing ? undefined : known.length ? known.reduce((total, child) => total + contributionOf(byCode, disabled, child.code, code, result.get(child.code)!.amount as number), 0) : active.length ? undefined : 0, incomplete };
      }
    }
    result.set(code, value);
  }
  return result;
}

/** The accounting group of an item under Tổng chi phí = its level-2 ancestor (the item itself when it hangs off the root). */
export function accountingGroupOf(items: readonly CostItemDef[], code: string): CostItemDef | undefined {
  const byCode = new Map(items.map((row) => [row.code, row]));
  let cursor = byCode.get(code);
  for (let guard = 0; cursor && guard < 50; guard += 1) {
    if (cursor.parentCode === SYSTEM_ITEM_CODES.costGroup) return cursor;
    cursor = cursor.parentCode ? byCode.get(cursor.parentCode) : undefined;
  }
  return undefined;
}

export interface CostGroupRow { key: string; label: string; amount: number }

/**
 * Mục 4 khối 4 — cost by group, generated from the tree, in both groupings (each adds up to Tổng chi phí):
 *  - "Nhóm hạch toán": one row per child of Tổng chi phí;
 *  - "Vai trò": labor by the role group of the logger, then the non-labor leaves by how they get their number —
 *    Quỹ chung (Phân bổ quỹ), Hoa hồng (the commission item), Chi phí riêng (Nhập tay) — as the wireframe draws them.
 */
export function costByGroups(items: readonly CostItemDef[], disabled: ReadonlySet<string>, values: ReadonlyMap<string, CostItemValue>): { accounting: CostGroupRow[]; role: CostGroupRow[] } {
  const byCode = new Map(items.map((row) => [row.code, row]));
  // Signed like the total: a group or a line that subtracts (a rebate, an offset) shows as a negative amount, so the cards add up to Tổng chi phí.
  const inCost = (row: CostItemDef) => contributionOf(byCode, disabled, row.code, SYSTEM_ITEM_CODES.costGroup, values.get(row.code)?.amount ?? 0);
  const accounting = items
    .filter((row) => row.parentCode === SYSTEM_ITEM_CODES.costGroup && !disabled.has(row.code))
    .map((row) => ({ key: row.code, label: row.name, amount: inCost(row) }));
  const role = new Map<string, CostGroupRow>();
  const add = (key: string, label: string, amount: number) => role.set(key, { key, label, amount: (role.get(key)?.amount ?? 0) + amount });
  const hasChildren = new Set(items.map((row) => row.parentCode).filter(Boolean));
  for (const row of items) {
    if (disabled.has(row.code) || hasChildren.has(row.code) || !accountingGroupOf(items, row.code)) continue;
    const amount = inCost(row);
    if (row.method === "SYSTEM" && row.systemSource === "labor" && row.roleGroup) add(row.roleGroup, ROLE_GROUP_LABELS[row.roleGroup], amount);
    else if (row.method === "FUND") add("FUND", "Quỹ chung", amount);
    else if (row.code === SYSTEM_ITEM_CODES.commission) add("COMMISSION", "Hoa hồng", amount);
    else if (row.method === "MANUAL") add("MANUAL", "Chi phí riêng", amount);
    else add(row.code, row.name, amount);
  }
  return { accounting, role: [...role.values()] };
}
