/**
 * What the P&L setup / data-entry screens share that is not display formatting (pnl-format.ts), not a fix link
 * (pnl-query.ts) and not a component (pnl-ui.tsx, pnl-setup-ui.tsx): reading typed numbers, period helpers and the
 * pure view logic of the settings tabs.
 */
import type { PnlFixTarget } from "@b2b-crm/contracts";
import { formatMonth } from "./pnl-format";
import { fixTargetHref } from "./pnl-query";

const moneyFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export const inputClass = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
export const labelClass = "mb-1.5 block text-xs font-semibold text-muted-foreground";

/** Digits typed by the user → number of đồng. Empty input is "no value", not zero. */
export function parseMoneyInput(value: string): number | undefined {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : undefined;
}

export function formatMoneyInput(value: string) {
  const amount = parseMoneyInput(value);
  return amount === undefined ? "" : moneyFormat.format(amount);
}

export function currentPeriodKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

export function shiftPeriod(periodKey: string, delta: number) {
  const [year, month] = periodKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodLabel(periodKey: string) {
  return `Tháng ${periodKey.slice(5, 7)}/${periodKey.slice(0, 4)}`;
}

export function monthDateRange(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${periodKey}-01`, endDate: `${periodKey}-${String(lastDay).padStart(2, "0")}` };
}

/** A stored number as the viewer types it (vi-VN: comma for decimals, no grouping), so parseDecimalInput reads it back
 *  unchanged — String(12.345) would be "12.345", which reads as twelve thousand three hundred forty-five. */
export function formatDecimalInput(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "" : String(value).replace(".", ",");
}

/** "26.300", "5,5", "400000" → number; anything else → undefined. */
export function parseDecimalInput(value: string): number | undefined {
  const text = value.replace(/\s/g, "");
  if (!text) return undefined;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// --- 6.2 Cây khoản mục ------------------------------------------------------

export type TreeNode = { code: string; parentCode: string | null };
export type TreeRow<T> = T & { hasChildren: boolean; expanded: boolean };

/** The rows to draw, in the API's display order: a node is hidden while any ancestor is collapsed. */
export function visibleTreeRows<T extends TreeNode>(items: readonly T[], collapsed: ReadonlySet<string>): Array<TreeRow<T>> {
  const parents = new Set(items.map((item) => item.parentCode).filter(Boolean));
  const byCode = new Map(items.map((item) => [item.code, item]));
  const hidden = (item: T) => {
    const seen = new Set<string>();
    for (let parent = item.parentCode; parent && !seen.has(parent); parent = byCode.get(parent)?.parentCode ?? null) {
      if (collapsed.has(parent)) return true;
      seen.add(parent);
    }
    return false;
  };
  return items.filter((item) => !hidden(item)).map((item) => ({ ...item, hasChildren: parents.has(item.code), expanded: !collapsed.has(item.code) }));
}

/** Tree search: the items `matches` picks plus all their ancestors, so a hit keeps its place in the tree. */
export function filterTree<T extends TreeNode>(items: readonly T[], matches: (item: T) => boolean): T[] {
  const byCode = new Map(items.map((item) => [item.code, item]));
  const keep = new Set<string>();
  for (const item of items) {
    if (!matches(item)) continue;
    // Stops at a node already kept, which also ends a parent cycle.
    for (let node: T | undefined = item; node && !keep.has(node.code); node = node.parentCode ? byCode.get(node.parentCode) : undefined) keep.add(node.code);
  }
  return items.filter((item) => keep.has(item.code));
}

const formulaNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 });
type FormulaToken = { item: string } | { param: string } | { value: number } | { op: "+" | "-" | "*" | "/" };
const OP_SIGNS = { "+": "+", "-": "−", "*": "×", "/": "÷" } as const;
const tokenKey = (token: FormulaToken) => "item" in token ? `item:${token.item}` : "param" in token ? `param:${token.param}` : "value" in token ? `value:${token.value}` : `op:${token.op}`;

/** "[Doanh thu dự án] × [Tỷ lệ hoa hồng]" from tokens and the API's operand list. */
export function formulaText(tokens: readonly FormulaToken[], operands: ReadonlyArray<{ token: FormulaToken; label: string }>): string {
  const labels = new Map(operands.map((operand) => [tokenKey(operand.token), operand.label]));
  return tokens.map((token) => "op" in token ? OP_SIGNS[token.op] : "value" in token ? formulaNumber.format(token.value) : `[${labels.get(tokenKey(token)) ?? ("item" in token ? token.item : token.param)}]`).join(" ");
}
/** Công thức xen kẽ đại lượng và phép tính: what may be appended next. */
export function nextFormulaStep(tokens: readonly FormulaToken[]): "operand" | "operator" {
  const last = tokens[tokens.length - 1];
  return !last || "op" in last ? "operand" : "operator";
}

/** Khối 1 của tab Khoản mục: three statements, each ✓ or a problem. */
export function configCheckParts(check: { hasCycle: boolean; cycleCodes: string[]; allGroupsSummed: boolean; groupErrors: string[]; requiredWithoutValue: unknown[]; periodKey: string; errors: string[] }): Array<{ ok: boolean; text: string }> {
  return [
    check.hasCycle ? { ok: false, text: `Có tham chiếu vòng: ${check.cycleCodes.join(" → ")}` } : { ok: true, text: "Không có tham chiếu vòng" },
    check.allGroupsSummed ? { ok: true, text: "Mọi dòng tổng do hệ thống cộng" } : { ok: false, text: `${check.groupErrors.length || 1} dòng tổng chưa do hệ thống cộng` },
    check.requiredWithoutValue.length ? { ok: false, text: `${check.requiredWithoutValue.length} khoản mục bắt buộc chưa có số ở kỳ ${formatMonth(check.periodKey)}` } : { ok: true, text: `Khoản mục bắt buộc đều có số ở kỳ ${formatMonth(check.periodKey)}` },
    ...check.errors.map((text) => ({ ok: false, text }))
  ];
}

// --- 6.5 Checklist và các nút "tới đúng màn cần sửa" -------------------------

/** One checklist line: "Không còn giờ Chờ xử lý … · còn 117,5 giờ" + the link on the right. */
export function checklistRow(item: { ok: boolean; label: string; detail: string | null; target: string | null; targetLabel: string | null }, periodKey: string) {
  const href = item.ok || !item.target ? null : fixTargetHref(item.target as PnlFixTarget, { periodKey });
  return { ok: item.ok, text: item.detail ? `${item.label} · ${item.detail}` : item.label, link: href && item.targetLabel ? { href, label: item.targetLabel } : null };
}

// --- 6.7 Import chi phí tháng -------------------------------------------------

export type StaffCostColumn = { key: string; label: string; required: boolean };
export type StaffCostImportRow = { employeeCode: string } & Record<string, string | number>;
const sameText = (a: unknown, b: string) => String(a ?? "").trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");

/**
 * Sheet cells (first row = the template's header) → rows for POST /pnl/staff-costs/import.
 * Columns are matched by the template's header text; blank lines are skipped; a cell that is not a number is left
 * out so the API reports "thiếu cấu phần bắt buộc" for that line instead of the browser guessing 0.
 */
export function mapStaffCostSheet(matrix: ReadonlyArray<ReadonlyArray<unknown>>, columns: readonly StaffCostColumn[]): { rows: StaffCostImportRow[]; missingColumns: string[] } {
  const header = matrix[0] ?? [];
  const indexOf = (column: StaffCostColumn) => header.findIndex((cell) => sameText(cell, column.label) || sameText(cell, column.key));
  const codeIndex = indexOf(columns.find((column) => column.key === "employeeCode") ?? { key: "employeeCode", label: "Mã NS", required: true });
  const amountColumns = columns.filter((column) => column.key !== "employeeCode" && column.key !== "displayName").map((column) => ({ column, index: indexOf(column) }));
  const missingColumns = [...(codeIndex < 0 ? ["Mã NS"] : []), ...amountColumns.filter((entry) => entry.index < 0 && entry.column.required).map((entry) => entry.column.label)];
  if (missingColumns.length) return { rows: [], missingColumns };
  const rows: StaffCostImportRow[] = [];
  for (const line of matrix.slice(1)) {
    const employeeCode = String(line[codeIndex] ?? "").trim();
    const cells = amountColumns.filter((entry) => entry.index >= 0).map((entry) => ({ key: entry.column.key, raw: line[entry.index] }));
    if (!employeeCode && cells.every((cell) => cell.raw === null || cell.raw === undefined || cell.raw === "")) continue;
    const row: StaffCostImportRow = { employeeCode };
    for (const cell of cells) {
      const value = typeof cell.raw === "number" ? cell.raw : typeof cell.raw === "string" ? parseDecimalInput(cell.raw) : undefined;
      if (value !== undefined) row[cell.key] = value;
    }
    rows.push(row);
  }
  return { rows, missingColumns: [] };
}

/** "Import 09/2026: 44 dòng hợp lệ vào Nháp · 1 dòng lỗi: mã NS-099 không tồn tại". */
export function importResultText(result: { periodKey: string; validCount: number; errors: Array<{ employeeCode: string; reason: string }> }): string {
  const head = `Import ${formatMonth(result.periodKey)}: ${result.validCount} dòng hợp lệ vào Nháp`;
  if (!result.errors.length) return `${head} · không có dòng lỗi`;
  const first = result.errors[0];
  return `${head} · ${result.errors.length} dòng lỗi: ${first.employeeCode ? `mã ${first.employeeCode} ` : ""}${first.reason}${result.errors.length > 1 ? "…" : ""}`;
}

// --- Admin › Thiết lập P&L: hai tab cấu hình cốt lõi ----------------------------

export type SetupTab = "items" | "parameters";
export const SETUP_TABS: Array<{ id: SetupTab; label: string }> = [
  { id: "items", label: "Khoản mục" },
  { id: "parameters", label: "Tham số" }
];

/** `?tab=` of the URL → one of the two supported Admin tabs. Legacy tabs land on Khoản mục. */
export function setupTabOf(value: string | null): SetupTab {
  return SETUP_TABS.some((tab) => tab.id === value) ? value as SetupTab : "items";
}
