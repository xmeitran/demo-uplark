/**
 * Tab P&L — layer 0 (Admin › Thiết lập P&L: Khoản mục, Tham số, Mẫu khoản mục) and the layer 1 inputs that are typed
 * in a P&L place: monthly staff cost (mục 6.7), a project's P&L setup (mục 6.1) and the "Nhập tay" lines (PL-18).
 * Funds and periods are in pnl.service.ts. Every write records who, when, before and after (PL-26).
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  isAdminAccount,
  type PnlCostItem,
  type PnlCostItemInput,
  type PnlCostItemMethod,
  type PnlCostItemsResponse,
  type PnlFormulaToken,
  type PnlManualCostInput,
  type PnlMeta,
  type PnlParameterKey,
  type PnlParameterRow,
  type PnlParameterScopeType,
  type PnlParameterValue,
  type PnlParameterValueInput,
  type PnlParametersResponse,
  type PnlProjectValueInput,
  type PnlStaffCostApproveInput,
  type PnlStaffCostComponents,
  type PnlStaffCostImportInput,
  type PnlStaffCostImportResult,
  type PnlStaffCostInput,
  type PnlStaffCostRow,
  type PnlStaffCostTemplateResponse,
  type PnlStaffCostsResponse,
  type PnlStandardHoursResponse,
  type PnlTemplateInput,
  type PnlTemplateOverrideInput,
  type PnlTemplatesResponse,
  type PrincipalContext,
  type StaffMonthlyCostsResponse
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { assertCostApprove, assertCostEdit, assertCostView, assertProjectSetupEdit, canApproveCost, canEditCost, canEditProjectSetup, canViewCost } from "./cost-permissions";
import { monthKeysBetween, reportDayStart, reportMonthKey } from "./pnl-calc";
import { PNL_CLOSE_GATES, PNL_PARAMETER_CATALOGUE, PNL_PARAMETER_KEYS, dayKeyOf, num, type ParameterRow, type PnlContext, type ProjectCtx } from "./pnl-context";
import { ROLE_GROUPS, ROLE_GROUP_LABELS, STAFF_COST_STATUS_LABELS, isRoleGroup, periodStateOf, workingDaysOfMonth } from "./pnl-rules";
import { PnlService, pnlMeta, requirePeriodKey, shiftMonth } from "./pnl.service";
import { COST_ITEM_METHOD_LABELS, DEFAULT_COST_TREE, REVENUE_ALWAYS_ON_CODES, SYSTEM_ITEM_CODES, accountingGroupOf, checkCostTree, effectiveDisabledCodes, normalizeRevenueItem, normalizeTemplateDisabledCodes, type CostItemDef } from "./pnl-tree";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const monthLabel = (periodKey: string) => `${periodKey.slice(5)}/${periodKey.slice(0, 4)}`;
const METHODS: PnlCostItemMethod[] = ["MANUAL", "SYSTEM", "FORMULA", "FUND", "GROUP"];
// Revenue keeps a stable code for formulas and snapshots, but its amount is a
// manual project input. All other chain codes remain system-controlled.
const SYSTEM_CODES = new Set<string>(Object.values(SYSTEM_ITEM_CODES).filter((code) => code !== SYSTEM_ITEM_CODES.revenue));
const ITEM_STATUS_LABELS = { active: "Đang dùng", draft: "Bản nháp", retired: "Ngừng dùng" } as const;

/** Component columns of ResourceMonthlyCost, named after the payroll system's output (mục 6.7 khối 3). */
const COMPONENT_COLUMNS: Record<keyof PnlStaffCostComponents, { column: string; label: string }> = {
  baseSalaryAmount: { column: "p1BaseAmount", label: "Lương tiêu chuẩn" },
  performanceBonusAmount: { column: "p3PerformanceAmount", label: "Thưởng hiệu suất" },
  resultBonusAmount: { column: "p4OtherVariableAmount", label: "Thưởng hiệu quả" },
  allowanceAmount: { column: "p2AllowanceAmount", label: "Phụ cấp" },
  overtimeAmount: { column: "overtimeAmount", label: "OT" },
  socialInsuranceAmount: { column: "socialInsuranceAmount", label: "BHXH công ty đóng" }
};
const COMPONENT_KEYS = Object.keys(COMPONENT_COLUMNS) as Array<keyof PnlStaffCostComponents>;
const SOURCE_LABELS: Record<string, string> = { manual: "Nhập tay", import: "Import", payroll: "Hệ thống lương", converted_hourly_rate: "Quy đổi từ đơn giá giờ" };
const MAX_MONEY = 1_000_000_000_000;

/** People with a payroll code first, by code; the rest by name. */
function byEmployeeCode(left: { employeeCode: string | null; displayName: string }, right: { employeeCode: string | null; displayName: string }) {
  if (Boolean(left.employeeCode) !== Boolean(right.employeeCode)) return left.employeeCode ? -1 : 1;
  return (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.displayName.localeCompare(right.displayName, "vi");
}

function assertAdmin(principal: PrincipalContext) {
  if (!isAdminAccount(principal)) throw new ForbiddenException("Chỉ tài khoản Admin được cấu hình P&L.");
}

function formulaText(tokens: readonly PnlFormulaToken[] | null | undefined, nameOf: (code: string) => string): string | null {
  if (!tokens?.length) return null;
  return tokens.map((token) => ("item" in token ? `[${nameOf(token.item)}]` : "param" in token ? `[${PNL_PARAMETER_CATALOGUE[token.param as PnlParameterKey]?.label ?? token.param}]` : "value" in token ? String(token.value) : ({ "*": "×", "/": "÷", "+": "+", "-": "−" } as Record<string, string>)[token.op])).join(" ");
}

function valueText(key: PnlParameterKey, value: unknown): string {
  if (key === "pnlCloseGate") return value === "G7" ? "G7 (nghiệm thu)" : String(value);
  const number = Number(value).toLocaleString("vi-VN", { maximumFractionDigits: 4 });
  return key === "commissionPercent" ? `${number}%` : key === "standardDayHours" ? `${number} giờ` : `${number} đ`;
}

@Injectable()
export class PnlConfigService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PnlService) private readonly pnl: PnlService) {}

  private async audit(principal: PrincipalContext, action: string, resource: string, resourceId: string, before: unknown, after: unknown, db: any = this.prisma) {
    await db.auditEvent.create({ data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource, resourceId, before: before ?? undefined, after: after ?? undefined, requestId: randomUUID() } });
  }

  private openPeriodKeys(ctx: PnlContext) {
    return monthKeysBetween(shiftMonth(ctx.currentPeriodKey, -11), ctx.currentPeriodKey).filter((periodKey) => !ctx.lockedKeys.has(periodKey)).reverse();
  }

  private assertOpenPeriod(ctx: PnlContext, periodKey: string, what: string) {
    if (ctx.lockedKeys.has(periodKey)) throw new ConflictException(`Kỳ ${monthLabel(periodKey)} đã khóa; ${what}.`);
    if (periodKey > ctx.currentPeriodKey) throw new BadRequestException(`Kỳ ${monthLabel(periodKey)} chưa mở.`);
  }

  /**
   * PL-21 "mã đã có số ở kỳ khóa thì không sửa", PL-24: refuses a change that would move or drop a number of a locked
   * month. `codes` (descendants included by the caller) are checked against the locked months' Nhập tay lines, confirmed
   * fund shares and — for a labor item — counted hours of its role group; `projectIds` narrows it to those projects.
   * `ctx` must be loaded without a scope.
   */
  private assertNoLockedNumbers(ctx: PnlContext, codes: ReadonlySet<string>, action: string, projectIds?: ReadonlySet<string>) {
    const mine = (projectId: string | null) => Boolean(projectId) && (!projectIds || projectIds.has(projectId as string));
    // A line entered before the tree existed has no item: the chain files it under the first Nhập tay cost item.
    const fallback = ctx.tree.find((row) => row.code === "CP.FUNCOP.RIENG" && row.method === "MANUAL")?.code ?? ctx.tree.find((row) => row.method === "MANUAL" && accountingGroupOf(ctx.tree, row.code))?.code;
    const roles = new Set(ctx.tree.filter((row) => codes.has(row.code) && row.method === "SYSTEM" && row.systemSource === "labor").map((row) => row.roleGroup));
    const hits = new Map<string, Set<string>>();
    const hit = (periodKey: string, code: string) => { if (ctx.lockedKeys.has(periodKey)) hits.set(periodKey, (hits.get(periodKey) ?? new Set()).add(code)); };
    for (const row of [...ctx.fundShares, ...ctx.manualLines]) {
      const code = row.itemCode ?? fallback;
      if (code && codes.has(code) && row.counted !== false && mine(row.projectId)) hit(row.periodKey, code);
    }
    if (roles.size) for (const entry of ctx.entries) if (entry.status === "included" && roles.has(entry.roleGroup) && mine(entry.projectId)) hit(entry.periodKey, ctx.tree.find((row) => row.systemSource === "labor" && row.roleGroup === entry.roleGroup)!.code);
    if (!hits.size) return;
    const months = [...hits.keys()].sort();
    const names = [...new Set(months.flatMap((periodKey) => [...hits.get(periodKey)!]))].map((code) => ctx.tree.find((row) => row.code === code)?.name ?? code);
    throw new ConflictException(`${action}: ${names.join(", ")} đã có số ở kỳ đã khóa ${months.map(monthLabel).join(", ")}. Mở lại kỳ đó trước, hoặc tạo khoản mục mới.`);
  }

  /** The guard for one stored item: retiring it, or moving it (parent, sign), must not touch a locked month. */
  private assertItemChangeAllowed(ctx: PnlContext, current: any, change: { retire?: boolean; parentCode?: unknown; sign?: unknown }) {
    if (current?.status !== "active") return;
    const moved = ("parentCode" in change && (change.parentCode ?? null) !== (current.parentCode ?? null)) || ("sign" in change && (change.sign === -1 ? -1 : 1) !== (current.sign === -1 ? -1 : 1));
    if (!change.retire && !moved) return;
    this.assertNoLockedNumbers(ctx, effectiveDisabledCodes(ctx.tree, [current.code]), change.retire ? `Không ngừng dùng được khoản mục ${current.name}` : `Không đổi được khoản mục cha hay dấu của ${current.name}`);
  }

  // -------------------------------------------------------------------------
  // Mục 6.2 — Khoản mục
  // -------------------------------------------------------------------------

  private toDef(row: any): CostItemDef {
    return normalizeRevenueItem({ code: row.code, name: row.name, parentCode: row.parentCode ?? null, sign: row.sign === -1 ? -1 : 1, roleGroup: row.roleGroup ?? null, unit: row.unit ?? "VND", method: row.method, systemSource: row.systemSource ?? null, formula: row.formula ?? null, required: Boolean(row.required), sortOrder: row.sortOrder ?? 10 });
  }

  /** The stored tree, or the default set while nothing is stored; and the tree as it would be with the drafts applied. */
  private async trees(workspaceId: string) {
    const rows: any[] = await this.prisma.pnlCostItem.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" } });
    const stored = rows.length > 0;
    const active = stored ? rows.filter((row) => row.status === "active").map((row) => normalizeRevenueItem(row)) : DEFAULT_COST_TREE.map((row) => ({ ...row, status: "active", draft: null, effectiveFromPeriod: null, sourceNote: "Khung I.10" }));
    const drafted = [
      ...active.filter((row) => !(row.draft as any)?.retire).map((row) => ({ ...row, ...((row.draft as object) ?? {}) })),
      ...rows.filter((row) => row.status === "draft").map((row) => normalizeRevenueItem(row))
    ].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
    const hasDraft = rows.some((row) => row.status === "draft" || row.draft);
    return { rows, stored, active, drafted, hasDraft };
  }

  async items(principal: PrincipalContext): Promise<PnlCostItemsResponse> {
    const meta = pnlMeta(principal);
    const ctx = await this.pnl.context(principal.workspaceId, { periodKeys: [reportMonthKey(this.pnl.now())] });
    const { rows, stored, active, drafted, hasDraft } = await this.trees(principal.workspaceId);
    const shown: any[] = hasDraft ? [...drafted, ...active.filter((row) => (row.draft as any)?.retire)] : active;
    const defs = (hasDraft ? drafted : active).map((row) => this.toDef(row));
    const check = checkCostTree(defs);
    const byCode = new Map(shown.map((row) => [row.code, row]));
    const nameOf = (code: string) => byCode.get(code)?.name ?? code;
    const hasChildren = new Set(defs.map((row) => row.parentCode).filter(Boolean));
    const levelOf = (row: any) => { let level = 1; for (let cursor = row; cursor?.parentCode && byCode.has(cursor.parentCode) && level < 20; cursor = byCode.get(cursor.parentCode)) level += 1; return level; };
    const lockedPeriods = [...ctx.lockedKeys].sort();
    const periodKey = ctx.currentPeriodKey;

    // "Khoản mục bắt buộc chưa có số ở kỳ": does the workspace have the item's input for the month at all?
    const ofMonth = ctx.entries.filter((entry) => entry.periodKey === periodKey && entry.status === "included");
    const hasValue = (row: CostItemDef): boolean => {
      if (row.code === SYSTEM_ITEM_CODES.revenue) return true; // revenue is entered once per project, not per month
      if (row.method === "SYSTEM") return row.systemSource === "revenue" || ofMonth.some((entry) => entry.roleGroup === row.roleGroup);
      if (row.method === "FORMULA") return (row.formula ?? []).every((token) => !("param" in token) || ctx.params.resolve(token.param as PnlParameterKey, null, periodKey) !== undefined);
      if (row.method === "FUND") return ctx.fundShares.some((share) => share.periodKey === periodKey && share.itemCode === row.code);
      if (row.method === "MANUAL") return ctx.manualLines.some((line) => line.periodKey === periodKey && line.itemCode === row.code);
      return true;
    };

    const items: PnlCostItem[] = shown.map((row) => {
      const def = this.toDef(row);
      const retiring = Boolean((rows.find((item) => item.code === row.code)?.draft as any)?.retire);
      const status = row.status === "draft" ? "draft" : retiring || row.status === "retired" ? "retired" : "active";
      const codeLocked = row.status === "active" && lockedPeriods.some((key) => !row.effectiveFromPeriod || key >= row.effectiveFromPeriod);
      const lockedMethods = METHODS.filter((method) => method !== def.method).flatMap((method) => {
        if (hasChildren.has(def.code)) return [{ method, reason: "Khoản mục có dòng con nên chỉ dùng Tổng nhóm." }];
        if (def.code === SYSTEM_ITEM_CODES.revenue) return [{ method, reason: "Doanh thu được nhập tay theo từng dự án." }];
        if (SYSTEM_CODES.has(def.code) || (def.method === "SYSTEM" && def.systemSource === "labor")) return [{ method, reason: "Khoản mục hệ thống: chuỗi tính đọc đúng cách lấy số này." }];
        if (codeLocked) return [{ method, reason: "Đã có số ở kỳ đã khóa." }];
        return [];
      });
      return {
        code: def.code, name: def.name, parentCode: def.parentCode, level: levelOf(row), sign: def.sign, roleGroup: def.roleGroup, unit: def.unit, method: def.method, methodLabel: COST_ITEM_METHOD_LABELS[def.method],
        systemSource: def.systemSource ?? null, formula: def.formula ?? null, formulaText: formulaText(def.formula, nameOf), required: def.required,
        effectiveFromPeriod: row.effectiveFromPeriod ?? null, status, statusLabel: ITEM_STATUS_LABELS[status], sourceNote: row.sourceNote ?? null, sortOrder: def.sortOrder,
        codeLocked, codeLockReason: codeLocked ? "Khóa: có số ở kỳ đã khóa" : null, lockedMethods,
        dependsOn: (check.dependsOn[def.code] ?? []).map((code) => ({ code, name: nameOf(code) })), usedBy: (check.usedBy[def.code] ?? []).map((code) => ({ code, name: nameOf(code) })),
        draft: row.status === "active" && row.draft ? (row.draft as Partial<PnlCostItemInput>) : null
      };
    });
    return {
      data: {
        check: {
          hasCycle: check.cycleCodes.length > 0, cycleCodes: check.cycleCodes, allGroupsSummed: !check.groupErrors.length, groupErrors: check.groupErrors, errors: check.errors,
          requiredWithoutValue: defs.filter((row) => row.required && !hasValue(row)).map((row) => ({ code: row.code, name: row.name })), periodKey, canApply: hasDraft && check.ok
        },
        items, hasDraft, openPeriodKeys: this.openPeriodKeys(ctx),
        formulaOperands: [
          ...defs.filter((row) => row.unit !== "NONE").map((row) => ({ token: { item: row.code } as PnlFormulaToken, label: row.name })),
          ...PNL_PARAMETER_KEYS.filter((key) => PNL_PARAMETER_CATALOGUE[key].kind === "number").map((key) => ({ token: { param: key } as PnlFormulaToken, label: PNL_PARAMETER_CATALOGUE[key].label }))
        ],
        usingDefaultTree: !stored
      },
      meta
    };
  }

  /** "Nạp bộ khoản mục mặc định": stores the default set (and adds any default code that is missing later). */
  async loadDefaultItems(principal: PrincipalContext) {
    assertAdmin(principal);
    const existing: any[] = await this.prisma.pnlCostItem.findMany({ where: { workspaceId: principal.workspaceId }, select: { code: true } });
    const have = new Set(existing.map((row) => row.code));
    const missing = DEFAULT_COST_TREE.filter((row) => !have.has(row.code));
    if (missing.length) {
      await this.prisma.pnlCostItem.createMany({ data: missing.map((row) => ({ workspaceId: principal.workspaceId, ...row, formula: row.formula ?? undefined, systemSource: row.systemSource ?? null, status: "active", sourceNote: "Khung I.10", updatedByUserId: principal.subjectId })) });
      await this.audit(principal, "pnl.cost_items_loaded", "pnl_cost_item", "default", undefined, { codes: missing.map((row) => row.code) });
    }
    return { data: { created: missing.length } };
  }

  private parseItem(input: PnlCostItemInput, current: any | undefined): Record<string, unknown> {
    const code = text(input?.code)?.toUpperCase();
    if (!code || !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) throw new BadRequestException("Mã khoản mục gồm chữ in hoa, số, dấu chấm, gạch (tối đa 40 ký tự).");
    const name = text(input.name);
    if (!name || name.length > 120) throw new BadRequestException("Tên khoản mục là bắt buộc (tối đa 120 ký tự).");
    if (!METHODS.includes(input.method)) throw new BadRequestException("Cách lấy số phải là Nhập tay, Lấy từ hệ thống, Công thức, Phân bổ quỹ hoặc Tổng nhóm.");
    const systemSource = input.method === "SYSTEM" ? input.systemSource ?? current?.systemSource ?? null : null;
    if (code === SYSTEM_ITEM_CODES.revenue && input.method !== "MANUAL") throw new BadRequestException("Doanh thu dự án chỉ được nhập tay theo từng dự án.");
    if (input.method === "SYSTEM" && systemSource === "revenue") throw new BadRequestException("Doanh thu dự án không được lấy từ hệ thống; hãy chọn Nhập tay.");
    if (input.roleGroup && !isRoleGroup(input.roleGroup)) throw new BadRequestException("Nhóm vai trò không hợp lệ.");
    const unit = input.unit ?? current?.unit ?? "VND";
    if (!["VND", "PERCENT", "NONE"].includes(unit)) throw new BadRequestException("Đơn vị không hợp lệ.");
    if (input.method === "FORMULA" && !(Array.isArray(input.formula) && input.formula.length)) throw new BadRequestException("Công thức phải được ghép từ danh sách đại lượng.");
    return {
      code, name, parentCode: text(input.parentCode ?? undefined)?.toUpperCase() ?? null, sign: input.sign === -1 ? -1 : 1, roleGroup: input.roleGroup ?? null, unit, method: input.method,
      systemSource, formula: input.method === "FORMULA" ? input.formula : null,
      required: Boolean(input.required), sourceNote: text(input.sourceNote ?? undefined) ?? current?.sourceNote ?? null, sortOrder: Number.isInteger(input.sortOrder) ? input.sortOrder : current?.sortOrder ?? 900
    };
  }

  /** Saves a change as a DRAFT: nothing reaches the P&L until "Áp dụng bản nháp từ kỳ…". */
  async saveItem(input: PnlCostItemInput, principal: PrincipalContext) {
    assertAdmin(principal);
    if (!(await this.prisma.pnlCostItem.count({ where: { workspaceId: principal.workspaceId } }))) await this.loadDefaultItems(principal);
    const code = text(input?.code)?.toUpperCase() ?? "";
    const current: any = await this.prisma.pnlCostItem.findFirst({ where: { workspaceId: principal.workspaceId, code } });
    const data = this.parseItem(input, current);
    if (current && (SYSTEM_CODES.has(code) || (current.method === "SYSTEM" && current.systemSource === "labor")) && (data.method !== current.method || data.systemSource !== current.systemSource)) {
      throw new BadRequestException("Khoản mục hệ thống không đổi được cách lấy số.");
    }
    if (current?.status === "active" && data.method !== current.method && code !== SYSTEM_ITEM_CODES.revenue) {
      const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
      if ([...ctx.lockedKeys].some((key) => !current.effectiveFromPeriod || key >= current.effectiveFromPeriod)) throw new ConflictException("Khoản mục đã có số ở kỳ đã khóa: không đổi cách lấy số, hãy tạo khoản mục mới.");
    }
    if (data.parentCode === code) throw new BadRequestException("Khoản mục không thể là cha của chính nó.");
    if (current?.status === "active" && ((data.parentCode ?? null) !== (current.parentCode ?? null) || data.sign !== (current.sign === -1 ? -1 : 1))) {
      this.assertItemChangeAllowed(await this.pnl.context(principal.workspaceId), current, data);
    }
    const { code: _code, ...fields } = data;
    const row = !current
      ? await this.prisma.pnlCostItem.create({ data: { workspaceId: principal.workspaceId, ...(data as any), status: "draft", updatedByUserId: principal.subjectId } })
      : current.status === "draft"
        ? await this.prisma.pnlCostItem.update({ where: { id: current.id }, data: { ...(fields as any), updatedByUserId: principal.subjectId } })
        : await this.prisma.pnlCostItem.update({ where: { id: current.id }, data: { draft: fields as any, updatedByUserId: principal.subjectId } });
    await this.audit(principal, "pnl.cost_item_draft_saved", "pnl_cost_item", code, current ? { name: current.name, parentCode: current.parentCode, method: current.method } : undefined, data);
    return { data: row };
  }

  /** Marks an item to stop being used (as a draft). A stored draft item is simply removed. */
  async retireItem(codeRef: string, principal: PrincipalContext) {
    assertAdmin(principal);
    const code = codeRef.toUpperCase();
    if (!(await this.prisma.pnlCostItem.count({ where: { workspaceId: principal.workspaceId } }))) await this.loadDefaultItems(principal);
    const current: any = await this.prisma.pnlCostItem.findFirst({ where: { workspaceId: principal.workspaceId, code } });
    if (!current) throw new NotFoundException("Không tìm thấy khoản mục.");
    if (code === SYSTEM_ITEM_CODES.revenue || SYSTEM_CODES.has(code) || (current.method === "SYSTEM" && current.systemSource === "labor")) throw new BadRequestException("Khoản mục hệ thống không ngừng dùng được.");
    if (current.status === "active") this.assertItemChangeAllowed(await this.pnl.context(principal.workspaceId), current, { retire: true });
    if (current.status === "draft") await this.prisma.pnlCostItem.delete({ where: { id: current.id } });
    else await this.prisma.pnlCostItem.update({ where: { id: current.id }, data: { draft: { retire: true }, updatedByUserId: principal.subjectId } });
    await this.audit(principal, "pnl.cost_item_retire_drafted", "pnl_cost_item", code, { status: current.status }, { retire: true });
    return { data: { code } };
  }

  async discardItemDrafts(principal: PrincipalContext) {
    assertAdmin(principal);
    await this.prisma.pnlCostItem.deleteMany({ where: { workspaceId: principal.workspaceId, status: "draft" } });
    const drafted: any[] = (await this.prisma.pnlCostItem.findMany({ where: { workspaceId: principal.workspaceId, status: "active" } })).filter((row: any) => row.draft);
    for (const row of drafted) await this.prisma.pnlCostItem.update({ where: { id: row.id }, data: { draft: null as any } });
    return { data: { discarded: true } };
  }

  /** "Áp dụng bản nháp từ kỳ…": only an open period can be chosen, and a tree with a reference cycle is refused. */
  async applyItemDrafts(input: { periodKey?: string }, principal: PrincipalContext) {
    assertAdmin(principal);
    const periodKey = requirePeriodKey(input?.periodKey);
    const ctx = await this.pnl.context(principal.workspaceId);
    this.assertOpenPeriod(ctx, periodKey, "bản nháp chỉ áp dụng từ kỳ đang mở");
    const { rows, drafted, hasDraft } = await this.trees(principal.workspaceId);
    if (!hasDraft) throw new BadRequestException("Không có bản nháp để áp dụng.");
    // A month may have been locked since the draft was saved: this is where the change reaches the P&L.
    for (const row of rows) if (row.draft) this.assertItemChangeAllowed(ctx, row, row.draft as object);
    const check = checkCostTree(drafted.map((row) => this.toDef(row)));
    if (check.cycleCodes.length) throw new ConflictException(`Còn tham chiếu vòng giữa các khoản mục: ${check.cycleCodes.join(", ")}.`);
    if (!check.ok) throw new ConflictException(`Cấu hình chưa hợp lệ: ${[...check.groupErrors, ...check.errors].join(" ")}`);
    await this.prisma.$transaction(async (tx: any) => {
      for (const row of rows) {
        if (row.status === "draft") await tx.pnlCostItem.update({ where: { id: row.id }, data: { status: "active", effectiveFromPeriod: periodKey } });
        else if ((row.draft as any)?.retire) await tx.pnlCostItem.update({ where: { id: row.id }, data: { status: "retired", draft: null } });
        else if (row.draft) await tx.pnlCostItem.update({ where: { id: row.id }, data: { ...(row.draft as object), draft: null } });
      }
      await this.audit(principal, "pnl.cost_items_applied", "pnl_cost_item", "tree", undefined, { periodKey, codes: rows.filter((row) => row.status === "draft" || row.draft).map((row) => row.code) }, tx);
    });
    return { data: { applied: true, periodKey } };
  }

  // -------------------------------------------------------------------------
  // Mục 6.6 — Mẫu khoản mục
  // -------------------------------------------------------------------------

  async templates(principal: PrincipalContext): Promise<PnlTemplatesResponse> {
    const meta = pnlMeta(principal);
    const ctx = await this.pnl.context(principal.workspaceId, { periodKeys: [reportMonthKey(this.pnl.now())] });
    const projects = [...ctx.projects.values()];
    const byCode = new Map(ctx.tree.map((row) => [row.code, row]));
    const levelOf = (row: CostItemDef) => { let level = 1; for (let cursor = row; cursor.parentCode && byCode.has(cursor.parentCode) && level < 20; cursor = byCode.get(cursor.parentCode) as CostItemDef) level += 1; return level; };
    const templates = [...ctx.templates.values()];
    const off = new Map(templates.map((template) => [template.key, effectiveDisabledCodes(ctx.tree, template.disabledCodes)]));
    const canDisable = (row: CostItemDef) => !(row.method === "SYSTEM" && row.systemSource === "labor") && row.code !== SYSTEM_ITEM_CODES.costGroup && row.code !== SYSTEM_ITEM_CODES.resultGroup;
    const names = (codes: readonly string[]) => codes.filter((code) => byCode.has(code)).map((code) => byCode.get(code)!.name).join(", ");
    const commission = (key: string) => (off.get(key)?.has(SYSTEM_ITEM_CODES.commission) ? "—" : (() => { const value = ctx.params.number("commissionPercent", null, ctx.currentPeriodKey, { projectType: key }); return value === undefined ? "chưa nhập" : valueText("commissionPercent", value); })());
    const itemRows = ctx.tree.filter((row) => new Set(templates.map((template) => off.get(template.key)!.has(row.code))).size > 1)
      .map((row) => ({ kind: "item" as const, code: row.code, label: row.name, cells: Object.fromEntries(templates.map((template) => [template.key, { enabled: !off.get(template.key)!.has(row.code) }])) }));
    const commissionCells = Object.fromEntries(templates.map((template) => [template.key, { text: commission(template.key) }]));
    return {
      data: {
        templates: templates.map((template) => ({
          key: template.key, name: template.name,
          description: template.disabledCodes.length ? `Tắt: ${names(template.disabledCodes)}${template.consumable ? " · chi phí tiêu hao" : ""}` : "Bộ mặc định, không tắt gì",
          consumable: template.consumable, disabledCodes: template.disabledCodes, enabledItemCount: ctx.tree.length - off.get(template.key)!.size,
          projectCount: projects.filter((project) => project.templateKey === template.key).length
        })),
        comparison: [...itemRows, ...(new Set(Object.values(commissionCells).map((cell) => cell.text)).size > 1 ? [{ kind: "parameter" as const, code: "commissionPercent", label: "Tỷ lệ hoa hồng (tham số, nhập tay)", cells: commissionCells }] : [])],
        comparisonNote: "Sửa mẫu có hiệu lực từ kỳ đang mở; dự án đã qua G7 giữ mẫu tại thời điểm nghiệm thu",
        overrides: projects.filter((project) => project.record?.overrideAt).map((project) => ({
          projectId: project.id, projectName: project.name,
          summary: [project.record.overrideDisabledCodes?.length ? `tắt ${names(project.record.overrideDisabledCodes)}` : "", project.record.overrideEnabledCodes?.length ? `bật ${names(project.record.overrideEnabledCodes)}` : ""].filter(Boolean).join(" · "),
          disabledCodes: project.record.overrideDisabledCodes ?? [], enabledCodes: project.record.overrideEnabledCodes ?? [], byName: project.record.overrideByName ?? null, at: new Date(project.record.overrideAt).toISOString(), reason: project.record.overrideReason ?? ""
        })),
        items: ctx.tree.map((row) => ({ code: row.code, name: row.name, parentCode: row.parentCode, level: levelOf(row), canDisable: canDisable(row) }))
      },
      meta
    };
  }

  private checkSwitchable(ctx: PnlContext, codes: unknown, what: string): string[] {
    if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) throw new BadRequestException(`${what} phải là danh sách mã khoản mục.`);
    const byCode = new Map(ctx.tree.map((row) => [row.code, row]));
    for (const code of codes as string[]) {
      const row = byCode.get(code);
      if (!row) throw new BadRequestException(`Khoản mục ${code} không có trong cây.`);
      if (REVENUE_ALWAYS_ON_CODES.has(code)) throw new BadRequestException("Doanh thu và các chỉ số kết quả luôn bật cho mọi loại project.");
      // Labor cost may never be switched off: it would drop out of the project while staying out of the company lines (PL-12).
      if ((row.method === "SYSTEM" && row.systemSource === "labor") || code === SYSTEM_ITEM_CODES.costGroup) throw new BadRequestException(`Không tắt được khoản mục ${row.name}: chi phí nhân sự luôn thuộc P&L.`);
    }
    return [...new Set(codes as string[])];
  }

  /** A template only switches items of the default set on or off; it never has a tree of its own (PL-22). */
  async setTemplate(key: string, input: PnlTemplateInput, principal: PrincipalContext) {
    assertAdmin(principal);
    const ctx = await this.pnl.context(principal.workspaceId);
    const template = ctx.templates.get(key);
    if (!template) throw new NotFoundException("Không tìm thấy mẫu khoản mục.");
    const disabledCodes = normalizeTemplateDisabledCodes(this.checkSwitchable(ctx, input?.disabledCodes, "disabledCodes"));
    // "Sửa mẫu có hiệu lực từ kỳ đang mở": a code that already carries a number of a locked month cannot be switched off.
    // Accepted projects are out of it — they keep the template of their G7 date.
    const wasOff = effectiveDisabledCodes(ctx.tree, template.disabledCodes);
    const newlyOff = new Set([...effectiveDisabledCodes(ctx.tree, disabledCodes)].filter((code) => !wasOff.has(code)));
    this.assertNoLockedNumbers(ctx, newlyOff, `Mẫu ${template.name} không tắt được khoản mục`, new Set([...ctx.projects.values()].filter((project) => project.templateKey === key && !project.closePassed).map((project) => project.id)));
    const existing: any = await this.prisma.pnlItemTemplate.findFirst({ where: { workspaceId: principal.workspaceId, key } });
    const data = { name: template.name, disabledCodes, consumable: template.consumable, updatedByUserId: principal.subjectId };
    const row = existing ? await this.prisma.pnlItemTemplate.update({ where: { id: existing.id }, data }) : await this.prisma.pnlItemTemplate.create({ data: { workspaceId: principal.workspaceId, key, ...data } });
    await this.audit(principal, "pnl.template_changed", "pnl_template", key, { disabledCodes: template.disabledCodes }, { disabledCodes, effectiveFrom: ctx.currentPeriodKey });
    return { data: row };
  }

  /** "Dự án ghi đè mẫu": a reason is mandatory and only this project is affected. A project past G7 keeps its template. */
  async setTemplateOverride(projectId: string, input: PnlTemplateOverrideInput, principal: PrincipalContext) {
    assertAdmin(principal);
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [projectId] });
    const project = ctx.projects.get(projectId);
    if (!project) throw new NotFoundException("Dự án không thuộc workspace hiện tại.");
    if (project.closePassed) throw new ConflictException("Dự án đã qua G7: giữ mẫu tại thời điểm nghiệm thu.");
    const reason = text(input?.reason);
    if (!reason) throw new BadRequestException("Ghi đè mẫu khoản mục bắt buộc phải có lý do.");
    const disabledCodes = this.checkSwitchable(ctx, input.disabledCodes ?? [], "disabledCodes");
    const enabledCodes = this.checkSwitchable(ctx, input.enabledCodes ?? [], "enabledCodes");
    const nowOff = effectiveDisabledCodes(ctx.tree, [...project.template.disabledCodes, ...disabledCodes].filter((code) => !enabledCodes.includes(code)));
    this.assertNoLockedNumbers(ctx, new Set([...nowOff].filter((code) => !project.disabledCodes.has(code))), `Dự án ${project.name} không tắt được khoản mục`, new Set([projectId]));
    const cleared = !disabledCodes.length && !enabledCodes.length;
    const data = { overrideDisabledCodes: disabledCodes, overrideEnabledCodes: enabledCodes, overrideReason: reason, overrideByUserId: principal.subjectId, overrideByName: principal.displayName, overrideAt: cleared ? null : this.pnl.now() };
    const row = project.record
      ? await this.prisma.projectPnlRecord.update({ where: { projectId }, data })
      : await this.prisma.projectPnlRecord.create({ data: { id: `ppr_${projectId}`, workspaceId: principal.workspaceId, projectId, ...data } });
    await this.audit(principal, "pnl.template_override", "pnl_project", projectId, { disabledCodes: project.record?.overrideDisabledCodes ?? [], enabledCodes: project.record?.overrideEnabledCodes ?? [] }, { disabledCodes, enabledCodes, reason });
    return { data: row };
  }

  // -------------------------------------------------------------------------
  // Mục 6.3 — Tham số
  // -------------------------------------------------------------------------

  async parameters(principal: PrincipalContext): Promise<PnlParametersResponse> {
    const meta = pnlMeta(principal);
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: undefined, periodKeys: [reportMonthKey(this.pnl.now())] });
    const period = ctx.currentPeriodKey;
    const projects = [...ctx.projects.values()].filter((project) => !project.internalWorklog);
    const accounts = [...new Map(projects.map((project) => [project.accountId, { id: project.accountId, name: project.accountName }])).values()];
    const scopeLabel = (row: ParameterRow) => row.scopeType === "company" ? "Công ty" : row.scopeType === "customer" ? accounts.find((account) => account.id === row.scopeId)?.name ?? "Khách hàng" : row.scopeType === "project" ? ctx.projects.get(row.scopeId ?? "")?.name ?? "Dự án" : `Loại dự án ${ctx.templates.get(row.scopeId ?? "")?.name ?? row.scopeId}`;
    const all = ctx.params.all();
    const rowOf = (key: PnlParameterKey, subKey: string | null): PnlParameterRow => {
      const definition = PNL_PARAMETER_CATALOGUE[key];
      // No parameter of the tab is a money figure any more (the selling rate per role is gone, chốt 13/10).
      const hidden = false;
      const rows = all.filter((row) => row.key === key && (row.subKey ?? null) === subKey).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.createdAt.getTime() - left.createdAt.getTime());
      const scopes = [...new Set(rows.map((row) => `${row.scopeType}|${row.scopeId ?? ""}`))];
      const currentIds = new Set(scopes.map((scope) => rows.find((row) => `${row.scopeType}|${row.scopeId ?? ""}` === scope && row.effectiveFrom <= period)?.id).filter(Boolean));
      const values: PnlParameterValue[] = rows.map((row) => ({
        id: row.id, key, subKey, scopeType: row.scopeType as PnlParameterScopeType, scopeId: row.scopeId, scopeLabel: scopeLabel(row), value: hidden ? null : row.value as number | string, valueText: hidden ? null : valueText(key, row.value),
        effectiveFrom: row.effectiveFrom, reason: row.reason, createdByName: row.createdByName, createdAt: row.createdAt.toISOString(), current: currentIds.has(row.id)
      }));
      const company = ctx.params.resolveRow(key, subKey, period);
      const fallback = subKey === null ? ctx.params.resolve(key, null, period) : undefined;
      const defaultValue = hidden ? null : (company?.value as number | string | undefined) ?? fallback ?? null;
      const dayHours = Number(ctx.params.resolve("standardDayHours", null, period) ?? 8);
      const days = workingDaysOfMonth(period, ctx.dayOffKeys);
      return {
        key, subKey, label: subKey && isRoleGroup(subKey) ? `${definition.label} · ${ROLE_GROUP_LABELS[subKey]}` : definition.label, unit: definition.unit,
        defaultValue, defaultValueText: defaultValue === null ? null : valueText(key, defaultValue),
        scopeText: definition.scopeText, allowedScopes: definition.allowedScopes,
        specificValueCount: values.filter((row) => row.current && row.scopeType !== "company").length,
        effectiveFrom: company?.effectiveFrom ?? (defaultValue === null ? null : definition.fallbackFrom ?? null), note: definition.note,
        derived: key === "standardDayHours" ? { periodKey: period, workingDays: days, standardDayHours: dayHours, standardHours: days * dayHours, text: `Giờ chuẩn tháng ${monthLabel(period)}: ${days} ngày × ${dayHours.toLocaleString("vi-VN")} = ${(days * dayHours).toLocaleString("vi-VN")} giờ, hệ thống tính từ lịch ngày nghỉ` } : null,
        values,
        history: [...rows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).map((row) => ({ at: row.createdAt.toISOString(), text: `thêm ${hidden ? "giá trị" : valueText(key, row.value)} cho ${scopeLabel(row)} từ ${monthLabel(row.effectiveFrom)}`, byName: row.createdByName, reason: row.reason }))
      };
    };
    return {
      data: {
        rows: [rowOf("standardDayHours", null), rowOf("usdRate", null), rowOf("pnlCloseGate", null), rowOf("commissionPercent", null)],
        moved: [
          { label: "Lương tháng tiêu chuẩn", movedTo: "Hồ sơ nhân sự" },
          { label: "Tiền giao thông", movedTo: "bỏ khỏi Tham số" },
          { label: "Phí công cụ AI", movedTo: "quỹ AI, Quỹ chi phí chung" }
        ],
        priorityNote: "Thứ tự ưu tiên: dự án → khách hàng hoặc loại dự án → công ty · giá trị trên bảng chỉ để đọc",
        openPeriodKeys: this.openPeriodKeys(ctx),
        scopeOptions: {
          customers: accounts.sort((left, right) => left.name.localeCompare(right.name, "vi")),
          projectTypes: [...ctx.templates.values()].map((template) => ({ value: template.key, label: template.name })),
          projects: projects.map((project) => ({ id: project.id, name: project.name })).sort((left, right) => left.name.localeCompare(right.name, "vi"))
        }
      },
      meta
    };
  }

  /** "Thêm giá trị mới": scope, value, effective period (an open one), reason. Never an overwrite — history is the rows (PL-19). */
  async addParameterValue(input: PnlParameterValueInput, principal: PrincipalContext) {
    assertAdmin(principal);
    const key = input?.key;
    const definition = PNL_PARAMETER_CATALOGUE[key];
    if (!definition) throw new BadRequestException("Tham số không có trong tab Tham số của P&L (chỉ tỷ lệ, tỷ giá, giờ chuẩn và mốc đóng P&L).");
    const scopeType = input.scopeType ?? "company";
    if (!definition.allowedScopes.includes(scopeType)) throw new BadRequestException(`${definition.label} không có giá trị riêng theo phạm vi này.`);
    const subKey = null;
    const reason = text(input.reason);
    if (!reason) throw new BadRequestException("Thêm giá trị tham số bắt buộc phải nhập lý do.");
    const effectiveFrom = requirePeriodKey(input.effectiveFrom, "effectiveFrom");
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: undefined, periodKeys: [effectiveFrom] });
    this.assertOpenPeriod(ctx, effectiveFrom, "kỳ đã khóa không nhận giá trị mới");
    let value: number | string;
    if (definition.kind === "gate") {
      if (!(PNL_CLOSE_GATES as readonly unknown[]).includes(input.value)) throw new BadRequestException(`Mốc đóng P&L "${String(input.value)}" chưa dùng được: hệ thống mới biết vị trí của stage so với G7.`);
      value = String(input.value);
    } else {
      value = typeof input.value === "string" ? Number(input.value) : input.value;
      if (typeof value !== "number" || !Number.isFinite(value) || value < (definition.min ?? 0) || value > (definition.max ?? Number.MAX_SAFE_INTEGER)) throw new BadRequestException(`${definition.label}: giá trị phải từ ${definition.min} đến ${definition.max}.`);
    }
    let scopeId: string | null = null;
    if (scopeType === "customer") {
      scopeId = text(input.scopeId) ?? null;
      if (!scopeId || !(await this.prisma.account.findFirst({ where: { id: scopeId, workspaceId: principal.workspaceId }, select: { id: true } }))) throw new BadRequestException("Chọn khách hàng của workspace.");
    } else if (scopeType === "project") {
      scopeId = text(input.scopeId) ?? null;
      if (!scopeId || !ctx.projects.has(scopeId)) throw new BadRequestException("Chọn dự án của workspace.");
    } else if (scopeType === "project_type") {
      scopeId = text(input.scopeId) ?? null;
      if (!scopeId || !ctx.templates.has(scopeId)) throw new BadRequestException("Chọn loại dự án: Khách hàng, Nội bộ hoặc Đào tạo.");
    }
    const previous = ctx.params.resolveRow(key, subKey, effectiveFrom, scopeType === "project" ? { projectId: scopeId } : scopeType === "customer" ? { accountId: scopeId } : scopeType === "project_type" ? { projectType: scopeId } : {});
    const row = await this.prisma.pnlParameterValue.create({ data: { workspaceId: principal.workspaceId, key, subKey, scopeType, scopeId, value, effectiveFrom, reason, createdByUserId: principal.subjectId, createdByName: principal.displayName } });
    // The two parameters the rest of the system also reads (daily cap, stage position) keep ONE current value:
    // a company value in force now is mirrored to the Admin › Tham số store.
    if ((key === "standardDayHours" || key === "pnlCloseGate") && scopeType === "company" && effectiveFrom <= ctx.currentPeriodKey && typeof (this.prisma as any).systemParameter?.create === "function") {
      await (this.prisma as any).systemParameter.create({ data: { workspaceId: principal.workspaceId, key, value, updatedByUserId: principal.subjectId, updatedByName: principal.displayName } });
    }
    await this.audit(principal, "pnl.parameter_value_added", "pnl_parameter", key, previous && previous.scopeType === scopeType ? { value: previous.value, effectiveFrom: previous.effectiveFrom } : undefined, { subKey, scopeType, scopeId, value, effectiveFrom, reason });
    return { data: row };
  }

  /** Lịch làm việc → giờ chuẩn của tháng (PL-09): working days × standard day hours, holidays of Admin › Ngày nghỉ left out. */
  async standardHours(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlStandardHoursResponse> {
    pnlMeta(principal);
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
    const from = text(query.from) ? requirePeriodKey(query.from, "from") : `${ctx.currentPeriodKey.slice(0, 4)}-01`;
    const to = text(query.to) ? requirePeriodKey(query.to, "to") : `${from.slice(0, 4)}-12`;
    return {
      data: monthKeysBetween(from, to).slice(0, 36).map((periodKey) => ({
        periodKey, workingDays: ctx.workingDays(periodKey), standardDayHours: ctx.standardDayMinutes(periodKey) / 60, standardHours: ctx.standardMinutes(periodKey) / 60,
        holidays: [...ctx.dayOffs.entries()].filter(([dateKey]) => dateKey.startsWith(periodKey)).sort().map(([dateKey, name]) => ({ dateKey, name }))
      }))
    };
  }

  // -------------------------------------------------------------------------
  // Mục 6.7 — Hồ sơ nhân sự › Chi phí theo tháng
  // -------------------------------------------------------------------------

  /** A person of the caller's workspace: a role binding there, now or in the past (their old months stay editable). */
  private async requireStaff(workspaceId: string, userId: string) {
    const [user, binding] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, subjectType: "INTERNAL_USER" }, select: { id: true } }),
      this.prisma.roleBinding.findFirst({ where: { workspaceId, userId }, select: { id: true } })
    ]);
    if (!user || !binding) throw new NotFoundException("Nhân sự không thuộc workspace hiện tại.");
  }

  private componentsOf(row: any): { [K in keyof PnlStaffCostComponents]: number } {
    return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, num(row[COMPONENT_COLUMNS[key].column])])) as { [K in keyof PnlStaffCostComponents]: number };
  }

  async staffCosts(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlStaffCostsResponse> {
    assertCostView(principal); // "Chỉ nhóm quyền chi phí xem và sửa"
    const meta = pnlMeta(principal);
    const periodKey = text(query.periodKey) ? requirePeriodKey(query.periodKey) : shiftMonth(reportMonthKey(this.pnl.now()), -1);
    const ctx = await this.pnl.context(principal.workspaceId, { periodKeys: [periodKey] });
    const [costRows, bindingRows, codeRows, imports]: any[][] = await Promise.all([
      this.prisma.resourceMonthlyCost.findMany({ where: { workspaceId: principal.workspaceId, periodKey } }),
      this.prisma.roleBinding.findMany({ where: { workspaceId: principal.workspaceId, endsAt: null }, select: { userId: true } }),
      this.prisma.pnlStaffCode.findMany({ where: { workspaceId: principal.workspaceId } }),
      this.prisma.auditEvent.findMany({ where: { workspaceId: principal.workspaceId, resource: "pnl_staff_cost_import", resourceId: periodKey }, orderBy: { createdAt: "desc" }, take: 1 })
    ]);
    const ofMonth = ctx.entries.filter((entry) => entry.periodKey === periodKey);
    const userIds = [...new Set([...costRows.map((row) => row.userId), ...ofMonth.map((entry) => entry.userId), ...bindingRows.map((row) => row.userId)])];
    const users: any[] = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds }, subjectType: "INTERNAL_USER" }, select: { id: true, displayName: true, email: true, departmentCode: true, status: true } }) : [];
    const locked = ctx.lockedKeys.has(periodKey);
    const standardMinutes = ctx.standardMinutes(periodKey);
    const codeOf = new Map(codeRows.map((row) => [row.userId, row.employeeCode]));
    const rows: PnlStaffCostRow[] = users.map((user) => {
      const cost = costRows.find((row) => row.userId === user.id);
      const mine = ofMonth.filter((entry) => entry.userId === user.id);
      const loggedMinutes = sum(mine.map((entry) => entry.minutes));
      const total = cost ? num(cost.totalMonthlyIncome) : null;
      const status = !cost ? "NONE" : cost.status === "APPROVED" ? (locked ? "LOCKED" : "APPROVED") : "DRAFT";
      return {
        userId: user.id, employeeCode: codeOf.get(user.id) ?? null, displayName: user.displayName || user.email, department: user.departmentCode ?? null, periodKey,
        components: cost ? this.componentsOf(cost) : null, totalAmount: total,
        hourlyCostRate: total !== null && standardMinutes > 0 ? (total * 60) / standardMinutes : null,
        source: cost ? (cost.source ?? "manual") : null, sourceLabel: cost ? SOURCE_LABELS[cost.source ?? "manual"] ?? cost.source : null,
        status, statusLabel: STAFF_COST_STATUS_LABELS[status],
        loggedMinutes, waitingMinutes: cost?.status === "APPROVED" ? 0 : loggedMinutes,
        approvedAt: cost?.approvedAt ? new Date(cost.approvedAt).toISOString() : null, approvedByName: cost?.approvedByName ?? null, updatedAt: cost?.updatedAt ? new Date(cost.updatedAt).toISOString() : null
      } as PnlStaffCostRow;
    }).filter((row) => row.status !== "NONE" || row.loggedMinutes > 0 || users.find((user) => user.id === row.userId)?.status === "ACTIVE")
      .sort(byEmployeeCode);
    const days = ctx.workingDays(periodKey);
    return {
      data: {
        periodKey, periodState: periodStateOf(periodKey, ctx.currentPeriodKey, locked), standardMinutes, workingDays: days, standardDayHours: ctx.standardDayMinutes(periodKey) / 60,
        counts: { approved: rows.filter((row) => row.status === "APPROVED" || row.status === "LOCKED").length, draft: rows.filter((row) => row.status === "DRAFT").length, missing: rows.filter((row) => row.status === "NONE" && row.loggedMinutes > 0).length },
        rows, lastImport: imports[0] ? (imports[0].after as PnlStaffCostImportResult) : null,
        periodOptions: monthKeysBetween(shiftMonth(ctx.currentPeriodKey, -11), ctx.currentPeriodKey).reverse(),
        notes: {
          phase: "Giai đoạn 1 nhập tay hoặc import. Khi nối hệ thống lương, dữ liệu vào ở trạng thái Nháp để duyệt, cùng luồng này.",
          lockRules: ["Bản Nháp chưa dùng cho P&L · tháng đã khóa không sửa, kể cả dữ liệu từ hệ thống lương; muốn đổi thì tạo bản điều chỉnh có lý do hoặc mở lại kỳ", "Mọi lần nhập, sửa, duyệt ghi người, thời điểm, giá trị trước và sau · chỉ nhóm quyền chi phí xem và sửa"]
        }
      },
      meta
    };
  }

  /** Trang hồ sơ từng người: the same table, one person, every month (old route GET /staff-costs?userId=). */
  async staffCostsOfUser(userId: string, principal: PrincipalContext): Promise<StaffMonthlyCostsResponse> {
    assertCostView(principal);
    await this.requireStaff(principal.workspaceId, userId);
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
    const rows: any[] = await this.prisma.resourceMonthlyCost.findMany({ where: { workspaceId: principal.workspaceId, userId }, orderBy: { periodKey: "desc" } });
    return {
      data: rows.map((row) => {
        const standardMinutes = ctx.standardMinutes(row.periodKey);
        const locked = ctx.lockedKeys.has(row.periodKey);
        const status = row.status === "APPROVED" ? (locked ? "LOCKED" as const : "APPROVED" as const) : "DRAFT" as const;
        return {
          periodKey: row.periodKey, monthlyCostAmount: num(row.totalMonthlyIncome), hourlyCostRate: standardMinutes > 0 ? (num(row.totalMonthlyIncome) * 60) / standardMinutes : 0, standardHours: standardMinutes / 60,
          role: row.role ?? undefined, level: row.level ?? undefined, source: row.source === "converted_hourly_rate" ? "converted_hourly_rate" as const : "manual" as const, locked, updatedAt: new Date(row.updatedAt).toISOString(),
          components: this.componentsOf(row), status, statusLabel: STAFF_COST_STATUS_LABELS[status], sourceLabel: SOURCE_LABELS[row.source ?? "manual"] ?? row.source
        };
      }),
      meta: { userId, canEdit: canEditCost(principal), currency: "VND", standardDayHours: ctx.standardDayMinutes(ctx.currentPeriodKey) / 60, lockedPeriodKeys: [...ctx.lockedKeys].sort() }
    };
  }

  private parseComponents(input: Partial<PnlStaffCostComponents> & { monthlyCostAmount?: number | null }, label = ""): { [K in keyof PnlStaffCostComponents]: number } {
    const given = COMPONENT_KEYS.filter((key) => input[key] !== undefined && input[key] !== null && (input[key] as unknown) !== "");
    const source: Partial<PnlStaffCostComponents> = given.length ? input : { baseSalaryAmount: input.monthlyCostAmount ?? undefined };
    if (source.baseSalaryAmount === undefined || source.baseSalaryAmount === null || (source.baseSalaryAmount as unknown) === "") throw new BadRequestException(`${label}thiếu cấu phần bắt buộc: ${COMPONENT_COLUMNS.baseSalaryAmount.label}.`);
    return Object.fromEntries(COMPONENT_KEYS.map((key) => {
      const raw = source[key] ?? 0;
      const value = typeof raw === "string" ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_MONEY) throw new BadRequestException(`${label}${COMPONENT_COLUMNS[key].label} phải là số không âm.`);
      return [key, Math.round(value)];
    })) as { [K in keyof PnlStaffCostComponents]: number };
  }

  private costData(periodKey: string, components: { [K in keyof PnlStaffCostComponents]: number }, source: string) {
    const [year, month] = periodKey.split("-").map(Number);
    const total = sum(COMPONENT_KEYS.map((key) => components[key]));
    return {
      create: { periodKey, periodStart: new Date(Date.UTC(year, month - 1, 1)), periodEnd: new Date(Date.UTC(year, month, 0)), currency: "VND" },
      // A new or changed figure is a Nháp again: only the approval makes it a cost rate (PL-08).
      values: { ...Object.fromEntries(COMPONENT_KEYS.map((key) => [COMPONENT_COLUMNS[key].column, components[key]])), pitAmount: 0, otherAmount: 0, totalMonthlyIncome: total, hourlyCostRate: null, status: "DRAFT", source, approvedAt: null, approvedByUserId: null, approvedByName: null },
      total
    };
  }

  /** Nhập / sửa chi phí tháng của một người — luôn lưu Nháp. `monthlyCostAmount: null` removes an unapproved month. */
  async setStaffCost(input: PnlStaffCostInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const periodKey = requirePeriodKey(input?.periodKey);
    const userId = text(input?.userId);
    if (!userId) throw new BadRequestException("userId is required");
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
    this.assertOpenPeriod(ctx, periodKey, "mở lại kỳ trước khi sửa chi phí tháng");
    await this.requireStaff(principal.workspaceId, userId);
    const existing: any = await this.prisma.resourceMonthlyCost.findFirst({ where: { workspaceId: principal.workspaceId, userId, periodKey } });
    // PL-08: only the approved version feeds the P&L, so taking it away (removing it, or replacing it by a new Nháp) is the approver's call.
    if (existing?.status === "APPROVED" && !canApproveCost(principal)) throw new ForbiddenException(`Chi phí tháng ${monthLabel(periodKey)} của người này Đã duyệt: xóa hoặc thay cần quyền Duyệt chi phí (COST_APPROVE) hoặc Founder/GM.`);
    const before = existing ? { periodKey, totalAmount: num(existing.totalMonthlyIncome), status: existing.status, components: this.componentsOf(existing) } : undefined;
    if (input.monthlyCostAmount === null && COMPONENT_KEYS.every((key) => input[key] === undefined)) {
      if (existing) await this.prisma.resourceMonthlyCost.delete({ where: { id: existing.id } });
      await this.audit(principal, "pnl.resource_monthly_cost_changed", "resource_monthly_cost", userId, before, { periodKey, totalAmount: null });
      return { data: { userId, periodKey, monthlyCostAmount: null, hourlyCostRate: null, status: "NONE" }, meta: { persisted: true } };
    }
    const components = this.parseComponents(input);
    const data = this.costData(periodKey, components, "manual");
    const extra = { role: text(input.role) ?? existing?.role ?? null, level: text(input.level) ?? existing?.level ?? null };
    if (existing) await this.prisma.resourceMonthlyCost.update({ where: { id: existing.id }, data: { ...data.values, ...extra } });
    else await this.prisma.resourceMonthlyCost.create({ data: { workspaceId: principal.workspaceId, userId, ...data.create, ...data.values, ...extra } });
    await this.audit(principal, "pnl.resource_monthly_cost_changed", "resource_monthly_cost", userId, before, { periodKey, totalAmount: data.total, status: "DRAFT", components });
    const standardMinutes = ctx.standardMinutes(periodKey);
    return { data: { userId, periodKey, monthlyCostAmount: data.total, hourlyCostRate: standardMinutes > 0 ? (data.total * 60) / standardMinutes : null, status: "DRAFT" }, meta: { persisted: true } };
  }

  /** "Duyệt bản nháp": Nháp → Đã duyệt. From here the month's hours of these people stop waiting for a cost rate. */
  async approveStaffCosts(input: PnlStaffCostApproveInput, principal: PrincipalContext) {
    assertCostApprove(principal);
    const periodKey = requirePeriodKey(input?.periodKey);
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
    this.assertOpenPeriod(ctx, periodKey, "mở lại kỳ trước khi duyệt chi phí tháng");
    const drafts: any[] = (await this.prisma.resourceMonthlyCost.findMany({ where: { workspaceId: principal.workspaceId, periodKey, status: { not: "APPROVED" } } }))
      .filter((row: any) => !input.userIds || input.userIds.includes(row.userId));
    const standardMinutes = ctx.standardMinutes(periodKey);
    const now = this.pnl.now();
    await this.prisma.$transaction(async (tx: any) => {
      for (const row of drafts) {
        // hourlyCostRate is kept for readers of the column; the P&L always divides the total by the month's standard hours itself.
        await tx.resourceMonthlyCost.update({ where: { id: row.id }, data: { status: "APPROVED", approvedAt: now, approvedByUserId: principal.subjectId, approvedByName: principal.displayName, hourlyCostRate: standardMinutes > 0 ? Math.round(((num(row.totalMonthlyIncome) * 60) / standardMinutes) * 100) / 100 : null } });
        await this.audit(principal, "pnl.resource_monthly_cost_approved", "resource_monthly_cost", row.userId, { periodKey, status: row.status, totalAmount: num(row.totalMonthlyIncome) }, { periodKey, status: "APPROVED", totalAmount: num(row.totalMonthlyIncome) }, tx);
      }
    });
    return { data: { periodKey, approvedCount: drafts.length, userIds: drafts.map((row) => row.userId) } };
  }

  /** Import Excel (rows parsed by the browser from the template): valid rows become Nháp, the others are listed with the reason. */
  async importStaffCosts(input: PnlStaffCostImportInput, principal: PrincipalContext): Promise<{ data: PnlStaffCostImportResult }> {
    assertCostEdit(principal);
    const periodKey = requirePeriodKey(input?.periodKey);
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 2000) throw new BadRequestException("File import cần từ 1 đến 2000 dòng.");
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
    this.assertOpenPeriod(ctx, periodKey, "tháng đã khóa không nhận import");
    const codes: any[] = await this.prisma.pnlStaffCode.findMany({ where: { workspaceId: principal.workspaceId } });
    const userOf = new Map(codes.map((row) => [String(row.employeeCode).toUpperCase(), row.userId]));
    const existing: any[] = await this.prisma.resourceMonthlyCost.findMany({ where: { workspaceId: principal.workspaceId, periodKey } });
    const errors: PnlStaffCostImportResult["errors"] = [];
    const valid: Array<{ userId: string; components: { [K in keyof PnlStaffCostComponents]: number } }> = [];
    const seen = new Set<string>();
    input.rows.forEach((row, index) => {
      const employeeCode = String(row?.employeeCode ?? "").trim();
      const fail = (reason: string) => errors.push({ rowNumber: index + 1, employeeCode, reason });
      const userId = userOf.get(employeeCode.toUpperCase());
      if (!employeeCode) return fail("thiếu mã nhân sự");
      if (!userId) return fail(`mã ${employeeCode} không tồn tại`);
      if (seen.has(userId)) return fail(`mã ${employeeCode} lặp lại trong file`);
      if (!canApproveCost(principal) && existing.some((item) => item.userId === userId && item.status === "APPROVED")) return fail("chi phí tháng Đã duyệt, cần quyền Duyệt chi phí (COST_APPROVE) để thay");
      try {
        valid.push({ userId, components: this.parseComponents(row) });
        seen.add(userId);
      } catch (error) {
        fail(error instanceof BadRequestException ? String(error.message) : "dòng không hợp lệ");
      }
    });
    const result: PnlStaffCostImportResult = { periodKey, at: this.pnl.now().toISOString(), byName: principal.displayName, validCount: valid.length, errors };
    await this.prisma.$transaction(async (tx: any) => {
      for (const row of valid) {
        const data = this.costData(periodKey, row.components, "import");
        const current = existing.find((item) => item.userId === row.userId);
        if (current) await tx.resourceMonthlyCost.update({ where: { id: current.id }, data: data.values });
        else await tx.resourceMonthlyCost.create({ data: { workspaceId: principal.workspaceId, userId: row.userId, ...data.create, ...data.values } });
        await this.audit(principal, "pnl.resource_monthly_cost_changed", "resource_monthly_cost", row.userId, current ? { periodKey, totalAmount: num(current.totalMonthlyIncome), status: current.status } : undefined, { periodKey, totalAmount: data.total, status: "DRAFT", source: "import" }, tx);
      }
      await this.audit(principal, "pnl.staff_cost_imported", "pnl_staff_cost_import", periodKey, undefined, result, tx);
    });
    return { data: result };
  }

  async staffCostTemplate(query: Record<string, unknown>, principal: PrincipalContext): Promise<PnlStaffCostTemplateResponse> {
    assertCostView(principal);
    const periodKey = requirePeriodKey(query.periodKey);
    const [codes, bindings]: any[][] = await Promise.all([
      this.prisma.pnlStaffCode.findMany({ where: { workspaceId: principal.workspaceId } }),
      this.prisma.roleBinding.findMany({ where: { workspaceId: principal.workspaceId, endsAt: null }, select: { userId: true } })
    ]);
    const userIds = [...new Set([...codes.map((row) => row.userId), ...bindings.map((row) => row.userId)])];
    const users: any[] = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds }, subjectType: "INTERNAL_USER", status: "ACTIVE" }, select: { id: true, displayName: true, email: true } }) : [];
    const codeOf = new Map(codes.map((row) => [row.userId, row.employeeCode]));
    return {
      data: {
        periodKey,
        columns: [{ key: "employeeCode", label: "Mã NS", required: true }, { key: "displayName", label: "Nhân sự", required: false }, ...COMPONENT_KEYS.map((key) => ({ key, label: COMPONENT_COLUMNS[key].label, required: key === "baseSalaryAmount" }))],
        rows: users.map((user) => ({ employeeCode: codeOf.get(user.id) ?? null, displayName: user.displayName || user.email })).sort(byEmployeeCode)
      }
    };
  }

  /** Mã nhân sự (đúng mã của hệ thống lương) — what an import row is matched on. */
  async setEmployeeCode(input: { userId?: string; employeeCode?: string | null }, principal: PrincipalContext) {
    assertCostEdit(principal);
    const userId = text(input?.userId);
    if (!userId) throw new NotFoundException("Nhân sự không thuộc workspace hiện tại.");
    await this.requireStaff(principal.workspaceId, userId);
    const employeeCode = text(input.employeeCode ?? undefined)?.toUpperCase();
    const current: any = await this.prisma.pnlStaffCode.findFirst({ where: { workspaceId: principal.workspaceId, userId } });
    if (!employeeCode) {
      if (current) await this.prisma.pnlStaffCode.delete({ where: { id: current.id } });
    } else {
      if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(employeeCode)) throw new BadRequestException("Mã nhân sự gồm chữ, số, dấu chấm, gạch (tối đa 30 ký tự).");
      const taken: any = await this.prisma.pnlStaffCode.findFirst({ where: { workspaceId: principal.workspaceId, employeeCode } });
      if (taken && taken.userId !== userId) throw new ConflictException(`Mã ${employeeCode} đã gán cho người khác.`);
      if (current) await this.prisma.pnlStaffCode.update({ where: { id: current.id }, data: { employeeCode } });
      else await this.prisma.pnlStaffCode.create({ data: { workspaceId: principal.workspaceId, userId, employeeCode } });
    }
    await this.audit(principal, "pnl.staff_code_changed", "pnl_staff_code", userId, current ? { employeeCode: current.employeeCode } : undefined, { employeeCode: employeeCode ?? null });
    return { data: { userId, employeeCode: employeeCode ?? null } };
  }

  // -------------------------------------------------------------------------
  // PL-13 / D-22 — doanh thu dự án, entered on the Doanh thu figure of the P&L dự án screen
  // -------------------------------------------------------------------------

  /**
   * One amount (VND) per project type, entered by the PM (Admin) from BD's figures. Required before G1.
   * After G1 a change needs a reason — except the first entry of a project that never had a value: there is nothing to
   * justify changing. The value remains editable after G7 because it is the source of revenue, not a system-derived result.
   */
  async setProjectValue(projectId: string, input: PnlProjectValueInput, principal: PrincipalContext) {
    assertProjectSetupEdit(principal);
    if (!canViewCost(principal)) throw new ForbiddenException("Doanh thu dự án chỉ dành cho nhóm quyền chi phí.");
    const project = (await this.pnl.context(principal.workspaceId, { projectIds: [projectId] })).projects.get(projectId);
    if (!project) throw new NotFoundException("Dự án không thuộc workspace hiện tại.");
    const amount = input?.amount === null || input?.amount === undefined || (input.amount as unknown) === "" ? null : Number(input.amount);
    if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)) throw new BadRequestException("Doanh thu dự án là số tiền VND nguyên, lớn hơn 0.");
    const current = project.projectValueAmount ?? null;
    if (amount === current) return { data: { projectId, amount: current } };
    if (amount === null && project.g1Passed) throw new ConflictException("Dự án đã qua G1: doanh thu không được để trống, chỉ sửa thành số khác kèm lý do.");
    const reason = text(input.reason);
    if (project.g1Passed && current !== null && !reason) throw new BadRequestException("Sửa doanh thu sau G1 bắt buộc phải ghi lý do.");
    await this.prisma.$transaction(async (tx: any) => {
      // PL-28: one record per project (database trigger); a project older than the records gets its record here.
      if (project.record) await tx.projectPnlRecord.update({ where: { projectId }, data: { projectValueAmount: amount } });
      else await tx.projectPnlRecord.create({ data: { id: `ppr_${projectId}`, workspaceId: principal.workspaceId, projectId, projectValueAmount: amount } });
      await this.audit(principal, "pnl.project_value_changed", "pnl_project", projectId, { amount: current }, { amount, reason: reason ?? null }, tx);
    });
    return { data: { projectId, amount } };
  }

  // -------------------------------------------------------------------------
  // PL-18 — dòng Nhập tay chi phí riêng (the one editable line of the P&L dự án screen)
  // -------------------------------------------------------------------------

  private async parseManualCost(projectId: string, input: PnlManualCostInput, principal: PrincipalContext) {
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [projectId] });
    const project = ctx.projects.get(projectId);
    if (!project) throw new NotFoundException("Dự án không thuộc workspace hiện tại.");
    const item = ctx.tree.find((row) => row.code === input?.itemCode);
    if (!item || item.method !== "MANUAL") throw new BadRequestException("Chọn một khoản mục có cách lấy số Nhập tay.");
    if (project.disabledCodes.has(item.code)) throw new BadRequestException(`Khoản mục ${item.name} đang tắt ở mẫu của dự án này.`);
    const occurredOn = text(input.occurredOn) ?? (text(input.periodKey) ? `${requirePeriodKey(input.periodKey)}-01` : undefined);
    if (!occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || Number.isNaN(Date.parse(`${occurredOn}T00:00:00.000Z`))) throw new BadRequestException("Chọn tháng phát sinh (periodKey YYYY-MM) hoặc ngày phát sinh (occurredOn YYYY-MM-DD).");
    const label = text(input.label);
    if (!label || label.length > 200) throw new BadRequestException("Nội dung chi phí là bắt buộc (tối đa 200 ký tự).");
    if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_MONEY) throw new BadRequestException("Số tiền phải là số lớn hơn 0.");
    const note = text(input.note);
    if (note && note.length > 1000) throw new BadRequestException("Ghi chú tối đa 1000 ký tự.");
    this.assertOpenPeriod(ctx, occurredOn.slice(0, 7), "chi phí riêng khóa theo kỳ");
    return { ctx, project, data: { itemCode: item.code, category: accountingGroupOf(ctx.tree, item.code)?.code ?? null, label, amount: Math.round(input.amount), occurredAt: reportDayStart(occurredOn), note: note ?? null } };
  }

  async createManualCost(projectId: string, input: PnlManualCostInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const { project, data } = await this.parseManualCost(projectId, input, principal);
    const row = await this.prisma.projectCost.create({ data: { workspaceId: principal.workspaceId, accountId: project.accountId, projectId, costType: "OTHER" as never, currency: "VND", createdByUserId: principal.subjectId, ...data } });
    await this.audit(principal, "pnl.project_cost_created", "pnl_project", projectId, undefined, { costId: row.id, ...data, occurredAt: data.occurredAt.toISOString(), periodKey: reportMonthKey(data.occurredAt) });
    return { data: { id: row.id, ...data, occurredOn: dayKeyOf(data.occurredAt), periodKey: reportMonthKey(data.occurredAt) }, meta: { persisted: true } };
  }

  private async manualCost(projectId: string, costId: string, principal: PrincipalContext) {
    const existing: any = await this.prisma.projectCost.findFirst({ where: { id: costId, workspaceId: principal.workspaceId, projectId } });
    if (!existing || String(existing.costType) === "LABOR") throw new NotFoundException("Không tìm thấy khoản chi phí riêng.");
    const ctx = await this.pnl.context(principal.workspaceId, { projectIds: [] });
    this.assertOpenPeriod(ctx, reportMonthKey(new Date(existing.occurredAt)), "chi phí riêng khóa theo kỳ");
    return existing;
  }

  async updateManualCost(projectId: string, costId: string, input: PnlManualCostInput, principal: PrincipalContext) {
    assertCostEdit(principal);
    const existing = await this.manualCost(projectId, costId, principal);
    const { data } = await this.parseManualCost(projectId, { ...input, itemCode: input.itemCode ?? existing.itemCode }, principal);
    await this.prisma.projectCost.update({ where: { id: existing.id }, data });
    await this.audit(principal, "pnl.project_cost_changed", "pnl_project", projectId, { costId, itemCode: existing.itemCode, label: existing.label, amount: num(existing.amount), periodKey: reportMonthKey(new Date(existing.occurredAt)) }, { costId, ...data, occurredAt: data.occurredAt.toISOString(), periodKey: reportMonthKey(data.occurredAt) });
    return { data: { id: costId, ...data, occurredOn: dayKeyOf(data.occurredAt), periodKey: reportMonthKey(data.occurredAt) }, meta: { persisted: true } };
  }

  async deleteManualCost(projectId: string, costId: string, principal: PrincipalContext) {
    assertCostEdit(principal);
    const existing = await this.manualCost(projectId, costId, principal);
    await this.prisma.projectCost.delete({ where: { id: existing.id } });
    await this.audit(principal, "pnl.project_cost_deleted", "pnl_project", projectId, { costId, itemCode: existing.itemCode, label: existing.label, amount: num(existing.amount), periodKey: reportMonthKey(new Date(existing.occurredAt)) }, undefined);
    return { data: { id: costId }, meta: { deleted: true } };
  }
}
