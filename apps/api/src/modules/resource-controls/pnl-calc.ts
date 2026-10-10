/**
 * Pure P&L arithmetic. Kept free of Prisma/Nest so every figure shown in the
 * P&L screens can be unit-tested from plain values.
 */

// Reporting months follow Asia/Ho_Chi_Minh, which is UTC+7 all year (no DST).
const REPORT_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

export type CostRateRow = {
  userId: string | null;
  hourlyCostRate: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
};

export type LaborEntry = {
  userId: string;
  minutes: number;
  approvalStatus?: string | null;
  workDate: Date;
};

export type LaborByUser = {
  userId: string;
  approvedMinutes: number;
  laborCostAmount: number;
  missingRateMinutes: number;
  /** Rate applied to this person's most recent approved entry in the range. */
  hourlyCostRate?: number;
};

/** YYYY-MM of an instant in the reporting timezone. */
export function reportMonthKey(date: Date) {
  return new Date(date.getTime() + REPORT_TZ_OFFSET_MS).toISOString().slice(0, 7);
}

/** Instant at which a YYYY-MM-DD day starts in the reporting timezone. */
export function reportDayStart(dateKey: string) {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() - REPORT_TZ_OFFSET_MS);
}

/** Instant at which a YYYY-MM month starts in the reporting timezone. */
export function reportMonthStart(periodKey: string) {
  return reportDayStart(`${periodKey}-01`);
}

export function nextMonthKey(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * The rate in force at `at`: the row with the latest effectiveFrom that is not
 * after `at` and has not ended. A rate entered for one month therefore carries
 * forward until a later month overrides it.
 */
export function effectiveCostRate(rows: readonly CostRateRow[], at: Date) {
  let best: CostRateRow | undefined;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > at.getTime()) continue;
    if (row.effectiveTo && row.effectiveTo.getTime() <= at.getTime()) continue;
    if (!best || row.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = row;
  }
  return best;
}

export function isApprovedEntry(entry: { approvalStatus?: string | null }) {
  return String(entry.approvalStatus ?? "").toLowerCase() === "approved";
}

/**
 * Labor cost = approved minutes × the person's hourly cost rate on the work
 * date. Hours are NOT capped at 8h/day (meeting 2026-10-06: no cap until the
 * OT policy is settled). Approved minutes without a rate are reported, never
 * silently costed at zero.
 */
export function summarizeLabor(entries: readonly LaborEntry[], ratesByUser: ReadonlyMap<string, readonly CostRateRow[]>) {
  const byUser = new Map<string, LaborByUser & { lastWorkDate: number }>();
  for (const entry of entries) {
    if (!isApprovedEntry(entry) || entry.minutes <= 0) continue;
    const row = byUser.get(entry.userId) ?? { userId: entry.userId, approvedMinutes: 0, laborCostAmount: 0, missingRateMinutes: 0, lastWorkDate: -Infinity };
    row.approvedMinutes += entry.minutes;
    const rate = effectiveCostRate(ratesByUser.get(entry.userId) ?? [], entry.workDate);
    if (rate) {
      row.laborCostAmount += (entry.minutes * rate.hourlyCostRate) / 60;
      if (entry.workDate.getTime() >= row.lastWorkDate) {
        row.lastWorkDate = entry.workDate.getTime();
        row.hourlyCostRate = rate.hourlyCostRate;
      }
    } else {
      row.missingRateMinutes += entry.minutes;
    }
    byUser.set(entry.userId, row);
  }
  const people = Array.from(byUser.values()).map(({ lastWorkDate: _lastWorkDate, ...person }) => ({ ...person, laborCostAmount: roundMoney(person.laborCostAmount) }));
  return {
    people,
    approvedMinutes: people.reduce((total, person) => total + person.approvedMinutes, 0),
    laborCostAmount: roundMoney(people.reduce((total, person) => total + person.laborCostAmount, 0)),
    missingRateMinutes: people.reduce((total, person) => total + person.missingRateMinutes, 0)
  };
}

export type RevenueBasis = "custom" | "planned" | "none";

/**
 * One revenue figure for the whole statement. A manually entered revenue for
 * the period wins (0 is a valid entry). Whole-project planned revenue is used
 * only for a whole-project view: against the cost of a single period it would
 * mix scopes, so a period without an entered revenue has none.
 * Cash collected is reported next to it but never replaces it, so EBIT and its
 * margin always share a basis.
 */
export function resolveRevenue(input: { customRevenueAmount?: number; plannedRevenueAmount: number; periodScoped?: boolean }) {
  if (input.customRevenueAmount !== undefined) return { revenueAmount: input.customRevenueAmount, revenueBasis: "custom" as RevenueBasis };
  if (!input.periodScoped && input.plannedRevenueAmount > 0) return { revenueAmount: input.plannedRevenueAmount, revenueBasis: "planned" as RevenueBasis };
  return { revenueAmount: 0, revenueBasis: "none" as RevenueBasis };
}

export function computeMargin(revenueAmount: number, totalCostAmount: number) {
  const grossMarginAmount = roundMoney(revenueAmount - totalCostAmount);
  return {
    grossMarginAmount,
    grossMarginPercent: revenueAmount > 0 ? Math.round((grossMarginAmount / revenueAmount) * 10000) / 100 : undefined,
    /** %Expenses/Revenue. Undefined without revenue: a ratio to zero says nothing. */
    expenseRatioPercent: revenueAmount > 0 ? Math.round((totalCostAmount / revenueAmount) * 10000) / 100 : undefined
  };
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** BRD expense groups a non-labor cost line can belong to. Labor is always "salaries-related" and is computed. */
export const COST_CATEGORIES = ["welfare-related", "basic-activities", "business-location", "sell-marketing", "functional-operation"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const DEFAULT_COST_CATEGORY: CostCategory = "functional-operation";

export function normalizeCostCategory(value: unknown): CostCategory {
  return (COST_CATEGORIES as readonly string[]).includes(String(value)) ? (value as CostCategory) : DEFAULT_COST_CATEGORY;
}

/**
 * Splits a shared cost pool across projects in proportion to their weights.
 * Shares are whole đồng and always add up to the total: the rounding
 * remainder goes to the heaviest project. No positive weight → nothing is allocated.
 */
export function allocatePool(total: number, weights: ReadonlyMap<string, number>) {
  const shares = new Map<string, number>();
  const positive = Array.from(weights.entries()).filter(([, weight]) => weight > 0);
  const weightSum = positive.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0) || weightSum <= 0) return shares;
  let allocated = 0;
  for (const [projectId, weight] of positive) {
    const share = Math.floor((total * weight) / weightSum);
    shares.set(projectId, share);
    allocated += share;
  }
  const [heaviest] = positive.reduce((best, current) => (current[1] > best[1] ? current : best));
  shares.set(heaviest, (shares.get(heaviest) ?? 0) + (total - allocated));
  return shares;
}

/** Every YYYY-MM from `from` to `to` inclusive. */
export function monthKeysBetween(from: string, to: string) {
  const keys: string[] = [];
  for (let key = from; key <= to && keys.length < 600; key = nextMonthKey(key)) keys.push(key);
  return keys;
}

// ---------------------------------------------------------------------------
// Calculator: user-defined parameters and formulas
// ---------------------------------------------------------------------------

/**
 * Reads a parameter value typed by a user. Returns undefined when the text holds no readable number.
 * The web mirrors this rule in apps/web/src/components/pnl/pnl-cost-shared.ts (readParameterValue);
 * both specs run the same table of cases — change them together.
 *
 *  - "%" anywhere divides by 100 ("5%" → 0.05).
 *  - Both "." and ",": the one written last is the decimal mark, the other is thousands
 *    ("1.250,5" and "1,250.5" → 1250.5).
 *  - One kind, several times: thousands, in groups of three ("1.250.000" → 1250000).
 *  - One separator: a decimal mark ("0.05", "12,5", "1250.300" → 1250.3), EXCEPT the ambiguous
 *    shape of a non-zero 1–3 digit integer part followed by exactly three digits ("26.300", "1,250"),
 *    which is read as thousands. A zero integer part is always a decimal ("0.125", "0,005").
 */
export function parseParameterValue(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  const match = /-?\d[\d.,]*/.exec(text);
  if (!match) return undefined;
  const negative = match[0].startsWith("-");
  const body = match[0].replace(/^-/, "").replace(/[.,]+$/, "");
  const dots = body.split(".").length - 1;
  const commas = body.split(",").length - 1;
  let digits: string;
  if (dots && commas) {
    const decimal = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    if ((decimal === "." ? dots : commas) !== 1) return undefined;
    digits = body.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (dots + commas > 1) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(body)) return undefined;
    digits = body.replace(/[.,]/g, "");
  } else if (/^0*[1-9]\d{0,2}[.,]\d{3}$/.test(body)) {
    digits = body.replace(/[.,]/, "");
  } else {
    digits = body.replace(",", ".");
  }
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;
  const signed = negative ? -value : value;
  return text.includes("%") ? signed / 100 : signed;
}

export type FormulaResult = { ok: true; value: number } | { ok: false; error: string };

type Token = { type: "number"; value: number; text: string } | { type: "name"; value: string } | { type: "op"; value: string };

function tokenize(source: string): Token[] | string {
  const tokens: Token[] = [];
  // Accept the typographic operators people paste from documents.
  const text = source.replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-");
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/\d/.test(char)) {
      // Inside a formula "." is the only decimal mark; "," and ";" only separate function arguments.
      const match = /^\d+(\.\d+)*/.exec(text.slice(index))!;
      const literal = match[0];
      if (literal.split(".").length > 2) return `Không dùng dấu phân cách hàng nghìn trong công thức: viết ${literal.replace(/\./g, "")} thay cho ${literal}`;
      // "26.300" reads as 26300 in a parameter but would be 26.3 here: refuse instead of guessing.
      if (/^0*[1-9]\d{0,2}\.\d{3}$/.test(literal)) return `Số ${literal} dễ hiểu nhầm: không dùng dấu phân cách hàng nghìn trong công thức. Viết ${literal.replace(".", "")} nếu là hàng nghìn, hoặc ${literal}0 nếu là số thập phân`;
      tokens.push({ type: "number", value: Number(literal), text: literal });
      index += literal.length;
      continue;
    }
    if (/[\p{L}_]/u.test(char)) {
      const match = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(text.slice(index))!;
      tokens.push({ type: "name", value: match[0].toUpperCase() });
      index += match[0].length;
      continue;
    }
    if ("+-*/()%;,".includes(char)) { tokens.push({ type: "op", value: char }); index += 1; continue; }
    return `Ký tự không hợp lệ "${char}"`;
  }
  return tokens;
}

/**
 * Evaluates one arithmetic formula: numbers, names (parameters or system
 * variables), + − × ÷, parentheses, a trailing % (÷100) and MIN/MAX/ROUND.
 * Numbers use "." as the decimal mark and no thousands separator; "," and ";"
 * are always argument separators, so "ROUND(X/3,2)" has two arguments and
 * "X*21,5" is an error (never read as 21.5).
 * It is a calculator only — no code execution, no I/O. Dividing by zero gives
 * 0 so a ratio over an empty month does not break the statement.
 */
export function evaluateFormula(source: string, variables: ReadonlyMap<string, number>): FormulaResult {
  if (typeof source !== "string" || !source.trim()) return { ok: false, error: "Công thức đang trống" };
  if (source.length > 500) return { ok: false, error: "Công thức dài quá 500 ký tự" };
  const tokens = tokenize(source);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => peek()?.type === "op" && peek()!.value === value;
  class FormulaError extends Error {}
  const fail = (message: string): never => { throw new FormulaError(message); };
  const isSeparator = () => isOp(",") || isOp(";");
  /** A separator met outside a function's argument list: say exactly what to write instead. */
  const rejectStraySeparator = () => {
    if (!isSeparator()) return;
    const separator = (tokens[position] as { value: string }).value;
    const before = tokens[position - 1];
    const after = tokens[position + 1];
    if (separator === "," && before?.type === "number" && after?.type === "number") {
      fail(`Số thập phân trong công thức viết bằng dấu chấm: viết ${before.text}.${after.text} thay cho ${before.text},${after.text}. Dấu phẩy chỉ tách đối số của hàm; không dùng dấu phân cách hàng nghìn`);
    }
    fail(`Dấu "${separator}" chỉ dùng để tách đối số trong hàm MIN, MAX, ROUND`);
  };

  function expression(): number {
    let value = term();
    while (isOp("+") || isOp("-")) {
      const operator = (tokens[position++] as { value: string }).value;
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  function term(): number {
    let value = unary();
    while (isOp("*") || isOp("/")) {
      const operator = (tokens[position++] as { value: string }).value;
      const right = unary();
      value = operator === "*" ? value * right : right === 0 ? 0 : value / right;
    }
    return value;
  }
  function unary(): number {
    if (isOp("-")) { position += 1; return -unary(); }
    if (isOp("+")) { position += 1; return unary(); }
    let value = primary();
    while (isOp("%")) { position += 1; value /= 100; }
    return value;
  }
  function primary(): number {
    const token = peek();
    if (!token) return fail("Công thức kết thúc giữa chừng");
    if (token.type === "number") { position += 1; return token.value; }
    if (token.type === "name") {
      position += 1;
      if (isOp("(")) {
        position += 1;
        const args: number[] = [];
        if (!isOp(")")) { args.push(expression()); while (isSeparator()) { position += 1; args.push(expression()); } }
        if (!isOp(")")) fail(`Thiếu dấu ) sau ${token.value}`);
        position += 1;
        if (token.value === "MIN" || token.value === "MAX") { if (!args.length) fail(`${token.value} cần ít nhất một giá trị`); return token.value === "MIN" ? Math.min(...args) : Math.max(...args); }
        if (token.value === "ROUND") { if (args.length < 1 || args.length > 2) fail("ROUND(giá trị, số chữ số)"); const factor = 10 ** Math.max(0, Math.min(6, Math.trunc(args[1] ?? 0))); return Math.round(args[0] * factor) / factor; }
        return fail(`Không có hàm ${token.value}. Dùng được: MIN, MAX, ROUND`);
      }
      const value = variables.get(token.value);
      if (value === undefined) return fail(`Chưa có tham số hoặc biến "${token.value}"`);
      return value;
    }
    if (token.value === "(") {
      position += 1;
      const value = expression();
      rejectStraySeparator();
      if (!isOp(")")) fail("Thiếu dấu )");
      position += 1;
      return value;
    }
    rejectStraySeparator();
    return fail(`Dấu "${token.value}" đặt sai chỗ`);
  }

  try {
    const value = expression();
    rejectStraySeparator();
    if (position < tokens.length) fail(`Thừa "${tokens[position].value}" ở cuối công thức`);
    if (!Number.isFinite(value)) fail("Kết quả không phải là số");
    return { ok: true, value };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, error: error.message };
    throw error;
  }
}

/** System variables a formula may use; everything else must be a user parameter. */
export const SYSTEM_VARIABLES = ["DOANH_THU_THANG", "DOANH_THU_KE_HOACH", "GIO_DUYET", "CP_NHAN_SU", "CP_KHAC", "QUY_DUNG_CHUNG", "SO_NHAN_SU"] as const;
