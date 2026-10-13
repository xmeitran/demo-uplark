/**
 * Loads what the P&L chain reads (layers 0, 1 and 3) and hands it to the pure engine (pnl-engine.ts).
 * Only flat queries joined in memory: the same loader serves the API and the in-memory database of the specs.
 *
 * A locked month is read from its snapshot (PL-24): its standard hours, cost rates, gate results, fund shares and
 * manual lines are the ones stored by the lock. Hours logged into it afterwards are "Chờ xử lý – Tháng đã khóa".
 */
import type { PnlParameterKey, PnlParameterScopeType } from "@b2b-crm/contracts";
import { loadLatestParameterRows } from "../../shared/system-parameters";
import { isLostDealProject } from "../delivery-handoff/lost-deal";
import { isGatePassed, projectGatePosition } from "../delivery-handoff/gates";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "../delivery-handoff/member-participation";
import { normalizeProjectStatus } from "../delivery-handoff/project-status";
import { firstStageOf } from "../delivery-handoff/project-visibility";
import { isInternalWorklogProjectType } from "../delivery-handoff/task-classification";
import { nextMonthKey, reportDayStart, reportMonthKey, reportMonthStart } from "./pnl-calc";
import { classifyEntry, computeProjectPnl, type EngineEntry, type ProjectPnl } from "./pnl-engine";
import { costRateOf, isPnlGateReason, rateKey, roleGroupOf, standardMonthMinutes, workingDaysOfMonth, type CostRate, type PnlGateReason, type PnlGateStatus, type RoleGroup } from "./pnl-rules";
import { DEFAULT_COST_TREE, DEFAULT_ITEM_TEMPLATES, effectiveDisabledCodes, templateKeyOfProjectType, type CostItemDef, type ItemTemplateDef } from "./pnl-tree";

const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
export const dayKeyOf = (date: Date) => new Date(date.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
export const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

// ---------------------------------------------------------------------------
// Parameters (PL-19)
// ---------------------------------------------------------------------------

export interface ParameterRow {
  id: string; key: string; subKey: string | null; scopeType: string; scopeId: string | null; value: unknown;
  effectiveFrom: string; reason: string | null; createdByUserId: string | null; createdByName: string | null; createdAt: Date;
}
export interface ParameterScope { projectId?: string | null; accountId?: string | null; projectType?: string | null }

/** Narrowest scope first: dự án → khách hàng hoặc loại dự án → công ty. Between a customer value and a project-type value the customer's wins. */
const SCOPE_RANK: Record<string, number> = { project: 3, customer: 2, project_type: 1, company: 0 };

export const PNL_PARAMETER_CATALOGUE: Record<PnlParameterKey, { label: string; unit: string; kind: "number" | "gate"; allowedScopes: PnlParameterScopeType[]; scopeText: string; note: string | null; fallback?: number | string; fallbackFrom?: string; min?: number; max?: number }> = {
  standardDayHours: { label: "Giờ chuẩn một ngày", unit: "giờ", kind: "number", allowedScopes: ["company"], scopeText: "Công ty", note: null, fallback: 8, fallbackFrom: "2026-01", min: 0.5, max: 24 },
  usdRate: { label: "Tỷ giá USD", unit: "đ", kind: "number", allowedScopes: ["company"], scopeText: "Công ty, theo tháng", note: null, min: 1, max: 1_000_000 },
  pnlCloseGate: { label: "Mốc đóng P&L dự án", unit: "", kind: "gate", allowedScopes: ["company"], scopeText: "Công ty", note: null, fallback: "G7", fallbackFrom: "2026-10" },
  commissionPercent: { label: "Tỷ lệ hoa hồng", unit: "%", kind: "number", allowedScopes: ["company", "customer", "project_type", "project"], scopeText: "Công ty, khách hàng", note: "nhập tay", min: 0, max: 100 }
};
export const PNL_PARAMETER_KEYS = Object.keys(PNL_PARAMETER_CATALOGUE) as PnlParameterKey[];
/** Only G7 can be evaluated: a stage knows its side of G7 (ProjectStage.afterPnlClose). The parameter keeps scope, period and history so moving it later is a value, not a structure (PL-27). */
export const PNL_CLOSE_GATES = ["G7"] as const;

export class ParameterStore {
  constructor(private readonly rows: readonly ParameterRow[], private readonly fallbacks: Partial<Record<PnlParameterKey, number | string>> = {}) {}

  private applies(row: ParameterRow, scope: ParameterScope) {
    if (row.scopeType === "company") return true;
    if (row.scopeType === "project") return Boolean(scope.projectId) && row.scopeId === scope.projectId;
    if (row.scopeType === "customer") return Boolean(scope.accountId) && row.scopeId === scope.accountId;
    return Boolean(scope.projectType) && String(row.scopeId ?? "").toLowerCase() === templateKeyOfProjectType(scope.projectType);
  }

  /** The value in force for a month and a scope: rows effective on or before the month, narrowest scope, then newest period, then newest entry. */
  resolveRow(key: PnlParameterKey, subKey: string | null, periodKey: string, scope: ParameterScope = {}): ParameterRow | undefined {
    return this.rows
      .filter((row) => row.key === key && (row.subKey ?? null) === subKey && row.effectiveFrom <= periodKey && this.applies(row, scope))
      .sort((left, right) => SCOPE_RANK[right.scopeType] - SCOPE_RANK[left.scopeType] || right.effectiveFrom.localeCompare(left.effectiveFrom) || right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  resolve(key: PnlParameterKey, subKey: string | null, periodKey: string, scope: ParameterScope = {}): number | string | undefined {
    const row = this.resolveRow(key, subKey, periodKey, scope);
    if (row) return row.value as number | string;
    return subKey === null ? this.fallbacks[key] ?? PNL_PARAMETER_CATALOGUE[key].fallback : undefined;
  }

  number(key: PnlParameterKey, subKey: string | null, periodKey: string, scope: ParameterScope = {}): number | undefined {
    const value = this.resolve(key, subKey, periodKey, scope);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  all() { return this.rows; }
}

// ---------------------------------------------------------------------------
// Snapshot of a locked month (PL-23)
// ---------------------------------------------------------------------------

/** `r` of a lock taken before 13/10/2026 may hold the retired reason "missing_contract_item"; `ci` (line item) and `ac` (Pre-sale chờ ký hợp đồng) are no longer written. */
export interface SnapshotEntry { id: string; p: string | null; u: string; t: string | null; d: string; m: number; l1: string | null; l2: string | null; s2: string | null; rg: RoleGroup; ci?: string | null; s: PnlGateStatus; r: string[]; ac?: boolean }
export interface SnapshotData {
  /** 2 adds `tree`, `disabledCodes` and the creation time of every parameter value. */
  version: 1 | 2;
  periodKey: string;
  workingDays: number;
  standardDayMinutes: number;
  standardMinutes: number;
  /** Company values in force for the month, and (`values`) every parameter row effective on or before it. */
  parameters: Record<string, unknown>;
  /** The cost-item tree in force at the lock. */
  tree?: CostItemDef[];
  /** Per project with a fund share or a Nhập tay line in the month: the codes switched off for it at the lock (template + override). */
  disabledCodes?: Record<string, string[]>;
  /** Approved monthly costs: the cost rates of the month. */
  staffCosts: Array<{ userId: string; totalAmount: number }>;
  /** Kết quả cổng lọc of every hour of the month. */
  entries: SnapshotEntry[];
  funds: Array<{ fundId: string; name: string; itemCode: string; amount: number }>;
  fundShares: Array<{ fundId: string; projectId: string; itemCode: string; minutes: number; amount: number }>;
  manualLines: Array<{ id: string; projectId: string; itemCode: string | null; amount: number; label: string }>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface PnlScope {
  /** Only these projects' hours (their whole lifecycle). */
  projectIds?: string[];
  /** Only hours of these months (every project). */
  periodKeys?: string[];
}

export interface ProjectCtx {
  id: string; code: string; name: string; accountId: string; accountName: string; projectType: string; status: string;
  isTest: boolean; internalWorklog: boolean;
  templateKey: string; template: ItemTemplateDef; consumable: boolean;
  /** Template + this project's override (or the set frozen at G7), ancestors expanded. */
  disabledCodes: Set<string>;
  record: any | null;
  /** PL-13 "Giá trị dự án" (VND); undefined = chưa nhập, or a Loại Nội bộ / Đào tạo project (it has none). */
  projectValueAmount?: number;
  g1Passed: boolean; g1At?: Date;
  closeGate: string; closePassed: boolean; acceptedAt?: Date; acceptedOn?: string;
  /**
   * Accepted by its status alone (a project older than the gates, without status history): `acceptedOn` is then only the
   * latest of its last hour before the closing point and its planned end — shown as "ngày nghiệm thu chưa xác định".
   */
  acceptanceEstimated: boolean;
  lostDeal: boolean;
  startedOn: string; plannedStartOn: string | null; plannedEndOn: string | null;
  picUserId: string | null;
  createdAt: Date;
}

export interface EntryMeta { taskTitle?: string; loggedAt?: Date; pendingSince?: Date; taskTypeLayer2: string | null; selectedTaskTypeLayer2: string | null; stageId?: string; stageName?: string }

export interface PnlContext {
  workspaceId: string;
  now: Date;
  currentPeriodKey: string;
  params: ParameterStore;
  /** The parameter values a month is computed with: the lock's snapshot for a locked month, the live rows otherwise. */
  paramsOf(periodKey: string): ParameterStore;
  dayOffs: Map<string, string>;
  dayOffKeys: Set<string>;
  /** Locked months → when and by whom; `snapshot` is absent only for months locked before snapshots existed. */
  locked: Map<string, { lockedAt: Date; lockedByName: string | null; snapshot?: SnapshotData }>;
  lockedKeys: Set<string>;
  projects: Map<string, ProjectCtx>;
  users: Map<string, { id: string; name: string; roleGroup: RoleGroup }>;
  entries: EngineEntry[];
  entryMeta: Map<string, EntryMeta>;
  tree: CostItemDef[];
  usingDefaultTree: boolean;
  templates: Map<string, ItemTemplateDef>;
  /** Approved and draft monthly costs, by rateKey(userId, periodKey). */
  staffCosts: Map<string, { userId: string; periodKey: string; totalAmount: number; status: string }>;
  /** Confirmed fund shares: live ones for open months, the snapshot's for locked months. */
  fundShares: Array<{ projectId: string; periodKey: string; itemCode: string; amount: number; minutes: number; fundId: string; counted?: boolean }>;
  unallocatedFundPeriods: Set<string>;
  manualLines: Array<{ id: string; projectId: string; periodKey: string; itemCode: string | null; amount: number; label: string; occurredOn: string; note?: string; counted?: boolean }>;
  /**
   * The tree and switched-off codes a project's lifecycle is added up with: the live ones, plus every item that carries
   * a number of a locked month (kept on, and kept in the tree, as it was when that month was locked — PL-24).
   */
  pnlTreeOf(projectId: string): { tree: CostItemDef[]; disabledCodes: Set<string> };
  standardDayMinutes(periodKey: string): number;
  workingDays(periodKey: string): number;
  standardMinutes(periodKey: string): number;
  rate(userId: string, periodKey: string): CostRate | undefined;
  entriesOf(projectId: string): EngineEntry[];
  compute(projectId: string, range?: { from: string; to: string }): ProjectPnl;
  userName(userId: string | null | undefined): string | null;
}

const GATE_DATE = (gate: any): Date | undefined => {
  const dates = [gate.status === "exception" ? gate.exceptionAt : null, gate.decidedAt, gate.customerConfirmedAt].filter(Boolean).map((value: Date) => new Date(value));
  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : gate.updatedAt ? new Date(gate.updatedAt) : undefined;
};

/**
 * Before gates were stored, "Đã hoàn thành" / "Đang bảo trì" were only reachable after acceptance; kept for projects
 * without gate rows. The date is the first move into such a status; without status history there is none.
 */
function acceptedByStatus(status: unknown, history: ReadonlyArray<{ fromStatus?: string | null; toStatus: string; changedAt?: Date }>): { passed: boolean; at?: Date } {
  const accepted = (value: unknown) => { const code = normalizeProjectStatus(value); return code === "completed" || code === "maintenance"; };
  const row = [...history].sort((left, right) => new Date(left.changedAt ?? 0).getTime() - new Date(right.changedAt ?? 0).getTime()).find((item) => accepted(item.toStatus));
  return { passed: Boolean(row) || accepted(status), at: row?.changedAt ? new Date(row.changedAt) : undefined };
}

function monthRange(periodKeys: readonly string[]) {
  const sorted = [...periodKeys].sort();
  return { gte: reportMonthStart(sorted[0]), lt: reportMonthStart(nextMonthKey(sorted[sorted.length - 1])) };
}

const group = <T,>(rows: readonly T[], keyOf: (row: T) => string | null | undefined) => {
  const map = new Map<string, T[]>();
  for (const row of rows) { const key = keyOf(row); if (key) map.set(key, [...(map.get(key) ?? []), row]); }
  return map;
};

// ponytail: loads the matching time entries into memory (one row per logged block) and every project of the workspace
// when no project is given; aggregate in SQL or cache per month if a workspace outgrows it.
export async function loadPnlContext(prisma: any, workspaceId: string, scope: PnlScope = {}, now = new Date()): Promise<PnlContext> {
  const currentPeriodKey = reportMonthKey(now);
  const entryWhere = {
    workspaceId, minutes: { gt: 0 }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES },
    ...(scope.projectIds ? { projectId: { in: scope.projectIds } } : {}),
    ...(scope.periodKeys?.length ? { workDate: monthRange(scope.periodKeys) } : {})
  };
  const [parameterRows, systemRows, dayOffRows, lockedRows, snapshotRows, itemRows, templateRows, entryRows] = await Promise.all([
    prisma.pnlParameterValue.findMany({ where: { workspaceId } }),
    loadLatestParameterRows(prisma, workspaceId, ["standardDayHours", "pnlCloseGate"]),
    prisma.workspaceDayOff.findMany({ where: { workspaceId, isActive: true }, select: { date: true, name: true } }),
    prisma.pnlPeriod.findMany({ where: { workspaceId, projectId: null, status: "LOCKED" }, select: { periodKey: true, lockedAt: true, lockedByUserId: true } }),
    prisma.pnlPeriodSnapshot.findMany({ where: { workspaceId, reopenedAt: null } }),
    prisma.pnlCostItem.findMany({ where: { workspaceId, status: "active" }, orderBy: { sortOrder: "asc" } }),
    prisma.pnlItemTemplate.findMany({ where: { workspaceId } }),
    (scope.projectIds && !scope.projectIds.length) ? [] : prisma.taskTimeEntry.findMany({
      where: entryWhere,
      select: { id: true, projectId: true, taskId: true, userId: true, minutes: true, workDate: true, createdAt: true, taskTypeLayer1: true, taskTypeLayer2: true, selectedTaskTypeLayer2: true, legacyConvertedAt: true, legacyPendingReason: true }
    })
  ]);

  const fallbacks: Partial<Record<PnlParameterKey, number | string>> = {};
  const storedDayHours = systemRows.get("standardDayHours")?.value;
  if (typeof storedDayHours === "number" && storedDayHours > 0) fallbacks.standardDayHours = storedDayHours;
  const params = new ParameterStore(parameterRows.map((row: any) => ({ ...row, subKey: row.subKey ?? null, createdAt: new Date(row.createdAt) })), fallbacks);
  const dayOffs = new Map<string, string>(dayOffRows.map((row: any) => [new Date(row.date).toISOString().slice(0, 10), row.name]));
  const dayOffKeys = new Set(dayOffs.keys());

  const snapshotByPeriod = new Map<string, any>();
  for (const row of [...snapshotRows].sort((left: any, right: any) => new Date(left.lockedAt).getTime() - new Date(right.lockedAt).getTime())) snapshotByPeriod.set(row.periodKey, row);
  const locked = new Map<string, { lockedAt: Date; lockedByName: string | null; snapshot?: SnapshotData }>();
  for (const row of lockedRows) {
    const snapshot = snapshotByPeriod.get(row.periodKey);
    locked.set(row.periodKey, { lockedAt: new Date(snapshot?.lockedAt ?? row.lockedAt ?? 0), lockedByName: snapshot?.lockedByName ?? null, snapshot: snapshot?.data as SnapshotData | undefined });
  }
  const lockedKeys = new Set(locked.keys());
  const inScopeMonth = (periodKey: string) => !scope.periodKeys?.length || scope.periodKeys.includes(periodKey);
  const inScopeProject = (projectId: string | null) => !scope.projectIds || (projectId !== null && scope.projectIds.includes(projectId));
  const snapshotEntries: Array<{ periodKey: string; data: SnapshotData; entry: SnapshotEntry }> = [];
  const snapshotIds = new Map<string, Set<string>>();
  for (const [periodKey, lock] of locked) {
    if (!lock.snapshot) continue;
    snapshotIds.set(periodKey, new Set(lock.snapshot.entries.map((entry) => entry.id)));
    if (!inScopeMonth(periodKey)) continue;
    for (const entry of lock.snapshot.entries) if (inScopeProject(entry.p)) snapshotEntries.push({ periodKey, data: lock.snapshot, entry });
  }

  // Projects and what the record derives from.
  const projectIds = scope.projectIds ? [...new Set([...scope.projectIds, ...snapshotEntries.map((row) => row.entry.p).filter((id): id is string => Boolean(id))])] : undefined;
  const projectRows: any[] = await prisma.project.findMany({
    where: { workspaceId, ...(projectIds ? { id: { in: projectIds } } : {}) },
    select: { id: true, code: true, name: true, status: true, projectType: true, isTestProject: true, accountId: true, createdAt: true }
  });
  const ids = projectRows.map((project) => project.id);
  const inProjects = { projectId: { in: ids } };
  const closeGate = String(params.resolve("pnlCloseGate", null, currentPeriodKey) ?? "G7");
  const [accounts, gateRows, historyRows, recordRows, projectStages, milestoneRows] = ids.length ? await Promise.all([
    prisma.account.findMany({ where: { id: { in: [...new Set(projectRows.map((project) => project.accountId))] } }, select: { id: true, name: true } }),
    prisma.projectGate.findMany({ where: { ...inProjects, code: { in: ["G1", closeGate] } } }),
    prisma.projectStatusHistory.findMany({ where: inProjects, select: { projectId: true, fromStatus: true, toStatus: true, closeReasonCode: true, changedAt: true } }),
    prisma.projectPnlRecord.findMany({ where: inProjects }),
    prisma.projectStage.findMany({ where: inProjects, orderBy: { sortOrder: "asc" }, select: { projectId: true, ownerUserId: true, sortOrder: true, createdAt: true, plannedStartAt: true, plannedEndAt: true } }),
    prisma.projectMilestone.findMany({ where: inProjects, select: { projectId: true, sortOrder: true, gateStatus: true } })
  ]) : [[], [], [], [], [], []];

  const gatesByProject = group<any>(gateRows, (row) => row.projectId);
  const historyByProject = group<any>(historyRows, (row) => row.projectId);
  const recordByProject = new Map<string, any>(recordRows.map((row: any) => [row.projectId, row]));
  const milestonesByProject = group<any>(milestoneRows, (row) => row.projectId);
  // Acceptance: the gate row is the source. A project without G1–G8 (hand-built milestones, or older than the gates) has
  // passed the closing point when every milestone of its own is approved, or — as before — by its status.
  const acceptance = new Map<string, { passed: boolean; at?: Date }>(projectRows.map((row) => {
    const gates = gatesByProject.get(row.id) ?? [];
    const close = gates.find((gate) => gate.code === closeGate);
    if (close) return [row.id, { passed: isGatePassed(close.status), at: isGatePassed(close.status) ? GATE_DATE(close) : undefined }];
    if (gates.length) return [row.id, { passed: false }];
    const byStatus = acceptedByStatus(row.status, historyByProject.get(row.id) ?? []);
    return [row.id, { passed: byStatus.passed || projectGatePosition([], milestonesByProject.get(row.id) ?? [], closeGate).closePassed, at: byStatus.at }];
  }));
  // Accepted without a date: every hour of those projects, to find the last one before the closing point (never the
  // month scope of this load — the estimate must be the same on every screen).
  const undatedIds = projectRows.filter((row) => acceptance.get(row.id)!.passed && !acceptance.get(row.id)!.at).map((row) => row.id);
  // Accepted and not frozen yet: the template they keep is the one in force on the G7 date, read from the change history.
  const needsTemplateHistory = projectRows.some((row) => acceptance.get(row.id)!.at && !recordByProject.get(row.id)?.frozenAt);
  const [closingRows, templateEvents]: any[][] = await Promise.all([
    undatedIds.length ? prisma.taskTimeEntry.findMany({ where: { workspaceId, projectId: { in: undatedIds }, minutes: { gt: 0 }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } }, select: { projectId: true, taskId: true, workDate: true } }) : [],
    needsTemplateHistory ? prisma.auditEvent.findMany({ where: { workspaceId, resource: "pnl_template", action: "pnl.template_changed" }, orderBy: { createdAt: "asc" } }) : []
  ]);

  // Tasks → stage (a sub-task saved without a stage sits in its parent's).
  const taskIds = [...new Set([...entryRows, ...closingRows].map((row: any) => row.taskId).filter(Boolean))];
  const tasks: any[] = taskIds.length ? await prisma.projectTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, stageId: true, parentTaskId: true } }) : [];
  const taskById = new Map<string, any>(tasks.map((task) => [task.id, task]));
  const parentIds = [...new Set(tasks.filter((task) => !task.stageId && task.parentTaskId && !taskById.has(task.parentTaskId)).map((task) => task.parentTaskId))];
  if (parentIds.length) for (const parent of await prisma.projectTask.findMany({ where: { id: { in: parentIds } }, select: { id: true, title: true, stageId: true, parentTaskId: true } })) taskById.set(parent.id, parent);
  const stageIdOf = (taskId: string | null) => { const task = taskId ? taskById.get(taskId) : undefined; return task?.stageId ?? (task?.parentTaskId ? taskById.get(task.parentTaskId)?.stageId : undefined) ?? undefined; };
  const stageIds = [...new Set([...entryRows, ...closingRows].map((row: any) => stageIdOf(row.taskId)).filter(Boolean))];
  const stageRows: any[] = stageIds.length ? await prisma.projectStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, activity: true, afterPnlClose: true } }) : [];
  const stageById = new Map<string, any>(stageRows.map((stage) => [stage.id, stage]));

  const tree: CostItemDef[] = itemRows.length
    ? itemRows.map((row: any) => ({ code: row.code, name: row.name, parentCode: row.parentCode ?? null, sign: row.sign === -1 ? -1 : 1, roleGroup: row.roleGroup ?? null, unit: row.unit, method: row.method, systemSource: row.systemSource ?? null, formula: row.formula ?? null, required: Boolean(row.required), sortOrder: row.sortOrder }))
    : DEFAULT_COST_TREE;
  const templates = new Map<string, ItemTemplateDef>(DEFAULT_ITEM_TEMPLATES.map((template) => [template.key, template]));
  for (const row of templateRows) templates.set(row.key, { key: row.key, name: row.name, disabledCodes: row.disabledCodes ?? [], consumable: Boolean(row.consumable) });

  const accountName = new Map<string, string>(accounts.map((account: any) => [account.id, account.name]));
  const lastHourBeforeClose = new Map<string, string>();
  for (const row of closingRows) {
    if (stageById.get(stageIdOf(row.taskId) ?? "")?.afterPnlClose === true) continue;
    const dateKey = dayKeyOf(new Date(row.workDate));
    if (dateKey > (lastHourBeforeClose.get(row.projectId) ?? "")) lastHourBeforeClose.set(row.projectId, dateKey);
  }
  /** Mục 6.6: the template's switched-off codes as they were at `at` — the `before` of the first change made after it. */
  const templateCodesAt = (template: ItemTemplateDef, at: Date | undefined): string[] => {
    const later = at ? templateEvents.find((event) => event.resourceId === template.key && new Date(event.createdAt).getTime() > at.getTime()) : undefined;
    return later ? ((later.before as any)?.disabledCodes ?? []) : template.disabledCodes;
  };
  const stagesByProject = group<any>(projectStages, (row) => row.projectId);

  const projects = new Map<string, ProjectCtx>();
  for (const row of projectRows) {
    const gates = gatesByProject.get(row.id) ?? [];
    const history = historyByProject.get(row.id) ?? [];
    const g1 = gates.find((gate) => gate.code === "G1");
    const accepted = acceptance.get(row.id)!;
    // "G1 đã duyệt": the gate row, or — without G1–G8 — the project's first milestone being approved.
    const g1Passed = projectGatePosition(gates, milestonesByProject.get(row.id) ?? [], closeGate).g1Passed;
    const record = recordByProject.get(row.id) ?? null;
    const storedValue = record?.projectValueAmount === null || record?.projectValueAmount === undefined ? undefined : Number(record.projectValueAmount);
    const templateKey = templateKeyOfProjectType(row.projectType);
    const template = templates.get(templateKey) ?? DEFAULT_ITEM_TEMPLATES[0];
    const switchedOff = record?.frozenAt
      ? record.frozenDisabledCodes ?? []
      : [...templateCodesAt(template, accepted.at), ...(record?.overrideDisabledCodes ?? [])].filter((code) => !(record?.overrideEnabledCodes ?? []).includes(code));
    const stages = stagesByProject.get(row.id) ?? [];
    const starts = stages.map((stage) => stage.plannedStartAt).filter(Boolean).map((value: Date) => new Date(value).getTime());
    const ends = stages.map((stage) => stage.plannedEndAt).filter(Boolean).map((value: Date) => new Date(value).getTime());
    const plannedStartOn = starts.length ? dayKeyOf(new Date(Math.min(...starts))) : null;
    const plannedEndOn = ends.length ? dayKeyOf(new Date(Math.max(...ends))) : null;
    // No G7 date: a display fallback only, the later of the last hour before the closing point and the planned end.
    const estimatedOn = accepted.passed && !accepted.at ? [lastHourBeforeClose.get(row.id), plannedEndOn].filter((value): value is string => Boolean(value)).sort().pop() : undefined;
    const acceptedAt = accepted.at ?? (estimatedOn ? reportDayStart(estimatedOn) : undefined);
    projects.set(row.id, {
      id: row.id, code: row.code, name: row.name, accountId: row.accountId, accountName: accountName.get(row.accountId) ?? "", projectType: row.projectType, status: String(row.status),
      isTest: Boolean(row.isTestProject), internalWorklog: isInternalWorklogProjectType(row.projectType),
      templateKey, template, consumable: template.consumable, disabledCodes: effectiveDisabledCodes(tree, switchedOff), record,
      projectValueAmount: template.consumable ? undefined : storedValue,
      g1Passed, g1At: g1 && isGatePassed(g1.status) ? GATE_DATE(g1) : undefined,
      closeGate, closePassed: accepted.passed, acceptedAt, acceptedOn: accepted.at ? dayKeyOf(accepted.at) : estimatedOn, acceptanceEstimated: accepted.passed && !accepted.at,
      lostDeal: isLostDealProject(row.status, history),
      startedOn: plannedStartOn ?? dayKeyOf(new Date(row.createdAt)), plannedStartOn, plannedEndOn,
      // "PIC" as everywhere else in the app: the owner of the project's first stage (project-visibility.ts).
      picUserId: firstStageOf<any>(stages)?.ownerUserId ?? null,
      createdAt: new Date(row.createdAt)
    });
  }

  // People: display name and role group (PL-10).
  const userIds = [...new Set([...entryRows.map((row: any) => row.userId), ...snapshotEntries.map((row) => row.entry.u), ...[...projects.values()].map((project) => project.picUserId).filter(Boolean)])] as string[];
  const [userRows, bindingRows, roleRows] = userIds.length ? await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } }),
    prisma.roleBinding.findMany({ where: { userId: { in: userIds }, workspaceId, endsAt: null }, select: { userId: true, roleId: true } }),
    prisma.role.findMany({ select: { id: true, code: true } })
  ]) : [[], [], []];
  const roleCode = new Map<string, string>(roleRows.map((role: any) => [role.id, role.code]));
  const rolesByUser = group<any>(bindingRows, (row) => row.userId);
  const users = new Map<string, { id: string; name: string; roleGroup: RoleGroup }>(userRows.map((user: any) => [user.id, { id: user.id, name: user.displayName || user.email || user.id, roleGroup: roleGroupOf((rolesByUser.get(user.id) ?? []).map((binding) => roleCode.get(binding.roleId) ?? "")) }]));
  const roleGroupOfUser = (userId: string) => users.get(userId)?.roleGroup ?? "DELIVERY";

  // Layer 1: monthly staff costs, fund amounts and shares, manual lines.
  // Without a project scope every monthly cost is needed: the company lines start from the month's whole staff cost (PL-12).
  const costWhere = { workspaceId, ...(scope.periodKeys?.length ? { periodKey: { in: scope.periodKeys } } : scope.projectIds ? { userId: { in: userIds } } : {}) };
  const [costRows, fundPeriodRows, allocationRows, manualRows] = await Promise.all([
    prisma.resourceMonthlyCost.findMany({ where: costWhere, select: { userId: true, periodKey: true, totalMonthlyIncome: true, status: true } }),
    prisma.pnlFundPeriod.findMany({ where: { workspaceId }, select: { id: true, fundId: true, periodKey: true, status: true } }),
    prisma.pnlFundAllocation.findMany({ where: { workspaceId, ...(scope.projectIds ? inProjects : {}) } }),
    prisma.projectCost.findMany({ where: { workspaceId, costType: { not: "LABOR" }, ...(scope.projectIds ? inProjects : {}) } })
  ]);
  const staffCosts = new Map<string, { userId: string; periodKey: string; totalAmount: number; status: string }>(costRows.map((row: any) => [rateKey(row.userId, row.periodKey), { userId: row.userId, periodKey: row.periodKey, totalAmount: num(row.totalMonthlyIncome), status: String(row.status) }]));

  const standardDayMinutes = (periodKey: string) => locked.get(periodKey)?.snapshot?.standardDayMinutes ?? Math.round((params.number("standardDayHours", null, periodKey) ?? 8) * 60);
  const workingDays = (periodKey: string) => locked.get(periodKey)?.snapshot?.workingDays ?? workingDaysOfMonth(periodKey, dayOffKeys);
  const standardMinutes = (periodKey: string) => locked.get(periodKey)?.snapshot?.standardMinutes ?? standardMonthMinutes(periodKey, dayOffKeys, standardDayMinutes(periodKey));
  const snapshotRates = new Map<string, CostRate>();
  for (const [periodKey, lock] of locked) for (const cost of lock.snapshot?.staffCosts ?? []) snapshotRates.set(rateKey(cost.userId, periodKey), { monthlyAmount: cost.totalAmount, standardMinutes: lock.snapshot!.standardMinutes });
  const rate = (userId: string, periodKey: string) => (locked.get(periodKey)?.snapshot ? snapshotRates.get(rateKey(userId, periodKey)) : costRateOf(staffCosts.get(rateKey(userId, periodKey)), standardMinutes(periodKey)));

  // Step 3 for every hour.
  const entries: EngineEntry[] = [];
  const entryMeta = new Map<string, EntryMeta>();
  for (const row of entryRows) {
    const dateKey = dayKeyOf(new Date(row.workDate));
    const periodKey = dateKey.slice(0, 7);
    const task = row.taskId ? taskById.get(row.taskId) : undefined;
    const stage = stageById.get(stageIdOf(row.taskId) ?? "");
    entryMeta.set(row.id, { taskTitle: task?.title ?? undefined, loggedAt: new Date(row.createdAt), pendingSince: new Date(row.legacyConvertedAt ?? row.createdAt), taskTypeLayer2: row.taskTypeLayer2 ?? null, selectedTaskTypeLayer2: row.selectedTaskTypeLayer2 ?? null, stageId: stage?.id, stageName: stage?.activity });
    const ids = snapshotIds.get(periodKey);
    if (ids?.has(row.id)) continue; // the snapshot's version of this hour is the one that counts
    const project = row.projectId ? projects.get(row.projectId) : undefined;
    entries.push(classifyEntry({
      id: row.id, projectId: row.projectId ?? null, userId: row.userId, taskId: row.taskId ?? null, dateKey, minutes: row.minutes,
      taskTypeLayer1: row.taskTypeLayer1 ?? null, taskTypeLayer2: row.taskTypeLayer2 ?? null, selectedTaskTypeLayer2: row.selectedTaskTypeLayer2 ?? null,
      afterPnlClose: stage?.afterPnlClose ?? null,
      lostDeal: Boolean(project?.lostDeal),
      loggedAfterLock: Boolean(ids),
      legacyPendingReason: row.legacyPendingReason ?? null,
      roleGroup: roleGroupOfUser(row.userId)
    }, rate(row.userId, periodKey)));
  }
  for (const { periodKey, entry } of snapshotEntries) {
    // A locked month keeps its snapshot — a deal lost later moves only the Pre-sale hours of open months. The one thing
    // re-read is an hour a lock before 13/10/2026 left waiting for a contract line item ("Chưa có hạng mục", retired):
    // nothing is missing on it any more, so it is settled by today's rule — Chi phí Pre-sale of a lost deal, else Được tính.
    const reasons = (entry.r ?? []).filter(isPnlGateReason);
    const retired = entry.s === "pending" && reasons.length < (entry.r ?? []).length;
    const settled: Pick<EngineEntry, "status" | "reasons"> = retired && entry.l1 === "PRE_SALE" && entry.p && projects.get(entry.p)?.lostDeal
      ? { status: "excluded", reasons: ["lost_deal_pre_sale"] }
      : { status: retired && !reasons.length ? "included" : entry.s, reasons };
    entries.push({
      id: entry.id, projectId: entry.p, userId: entry.u, taskId: entry.t, dateKey: entry.d, periodKey, minutes: entry.m, layer1: entry.l1, roleGroup: entry.rg,
      ...settled, rate: rate(entry.u, periodKey), fromSnapshot: true
    });
    if (!entryMeta.has(entry.id)) entryMeta.set(entry.id, { taskTypeLayer2: entry.l2, selectedTaskTypeLayer2: entry.s2 });
  }

  const fundShares: PnlContext["fundShares"] = allocationRows.filter((row: any) => !locked.get(row.periodKey)?.snapshot).map((row: any) => ({ projectId: row.projectId, periodKey: row.periodKey, itemCode: row.itemCode, amount: num(row.amount), minutes: row.minutes, fundId: row.fundPeriodId }));
  const manualLines: PnlContext["manualLines"] = manualRows
    .map((row: any) => ({ id: row.id, projectId: row.projectId, periodKey: reportMonthKey(new Date(row.occurredAt)), itemCode: row.itemCode ?? null, amount: num(row.amount), label: row.label, occurredOn: dayKeyOf(new Date(row.occurredAt)), note: row.note ?? undefined }))
    .filter((row: any) => !locked.get(row.periodKey)?.snapshot);
  // PL-24: a locked month keeps the tree and the on/off switches it was locked with (snapshots before version 2 have none and follow the live ones).
  const lockedDefs = new Map<string, CostItemDef>();
  for (const [periodKey, lock] of [...locked].sort(([left], [right]) => left.localeCompare(right))) {
    if (!lock.snapshot) continue;
    for (const def of lock.snapshot.tree ?? []) lockedDefs.set(def.code, def);
    const counted = (projectId: string, itemCode: string | null) => { const off = lock.snapshot!.disabledCodes?.[projectId]; return off ? !(itemCode && off.includes(itemCode)) : undefined; };
    for (const share of lock.snapshot.fundShares) if (inScopeProject(share.projectId)) fundShares.push({ ...share, periodKey, counted: counted(share.projectId, share.itemCode) });
    for (const line of lock.snapshot.manualLines) if (inScopeProject(line.projectId)) manualLines.push({ ...line, periodKey, occurredOn: `${periodKey}-01`, counted: counted(line.projectId, line.itemCode) });
  }
  const pnlTreeOf = (projectId: string) => {
    const live = projects.get(projectId)?.disabledCodes ?? new Set<string>();
    const kept = [...fundShares, ...manualLines].filter((row) => row.projectId === projectId && row.counted && row.itemCode).map((row) => row.itemCode as string);
    if (!kept.length) return { tree, disabledCodes: live };
    const byCode = new Map(tree.map((row) => [row.code, row]));
    const disabledCodes = new Set(live);
    for (const code of kept) {
      for (let cursor: string | null = code, guard = 0; cursor && guard < 50; guard += 1) {
        const def: CostItemDef | undefined = byCode.get(cursor) ?? lockedDefs.get(cursor);
        if (!def) break;
        byCode.set(def.code, def);
        disabledCodes.delete(def.code);
        cursor = def.parentCode;
      }
    }
    return { tree: byCode.size === tree.length ? tree : [...byCode.values()].sort((left, right) => left.sortOrder - right.sortOrder), disabledCodes };
  };
  // A month locked out of order must not follow a value added later for an earlier open month: it reads its own snapshot.
  const lockedParams = new Map<string, ParameterStore>();
  const paramsOf = (periodKey: string) => {
    const values = (locked.get(periodKey)?.snapshot?.parameters as { values?: any[] } | undefined)?.values;
    if (!Array.isArray(values)) return params;
    if (!lockedParams.has(periodKey)) lockedParams.set(periodKey, new ParameterStore(values.map((row, index) => ({ id: `snapshot-${index}`, reason: null, createdByUserId: null, createdByName: null, ...row, subKey: row.subKey ?? null, createdAt: new Date(row.createdAt ?? index) })), fallbacks));
    return lockedParams.get(periodKey) as ParameterStore;
  };
  const unallocatedFundPeriods = new Set<string>(fundPeriodRows.filter((row: any) => row.status !== "allocated" && !lockedKeys.has(row.periodKey)).map((row: any) => row.periodKey));

  const byProject = group(entries, (entry) => entry.projectId);
  const context: PnlContext = {
    workspaceId, now, currentPeriodKey, params, paramsOf, pnlTreeOf, dayOffs, dayOffKeys, locked, lockedKeys, projects, users, entries, entryMeta, tree, usingDefaultTree: !itemRows.length, templates,
    staffCosts, fundShares, unallocatedFundPeriods, manualLines, standardDayMinutes, workingDays, standardMinutes, rate,
    entriesOf: (projectId) => byProject.get(projectId) ?? [],
    userName: (userId) => (userId ? users.get(userId)?.name ?? userId : null),
    compute(projectId, range) {
      const project = projects.get(projectId) as ProjectCtx;
      const parameterScope = { projectId, accountId: project.accountId, projectType: project.projectType };
      // The commission rate is the one in force when revenue is recognised; until then, the current one.
      const commissionPeriod = project.acceptedOn?.slice(0, 7) ?? currentPeriodKey;
      // An open month follows the template in force now; a locked month what was switched on when it was locked.
      const on = <T extends { itemCode: string | null; counted?: boolean }>(row: T): T => ({ ...row, counted: row.counted ?? !(row.itemCode && project.disabledCodes.has(row.itemCode)) });
      return computeProjectPnl({
        entries: context.entriesOf(projectId), projectValueAmount: project.projectValueAmount, closePassed: project.closePassed, acceptanceDateMissing: project.acceptanceEstimated, g1Passed: project.g1Passed, lostDeal: project.lostDeal, consumable: project.consumable,
        lockedPeriods: lockedKeys,
        fundShares: fundShares.filter((share) => share.projectId === projectId).map(on),
        unallocatedFundPeriods,
        manualLines: manualLines.filter((line) => line.projectId === projectId).map(on),
        ...pnlTreeOf(projectId),
        commissionPercent: paramsOf(commissionPeriod).number("commissionPercent", null, commissionPeriod, parameterScope),
        range
      });
    }
  };
  return context;
}
