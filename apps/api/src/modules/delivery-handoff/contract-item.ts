/**
 * Hạng mục hợp đồng — contract line item (rules 2, 3.1-3.2, D-01, D-05..D-07, D-22, D-23).
 * Pure rules only; persistence lives in ProjectsService. Labels are mirrored by apps/web/src/lib/contract-item.ts.
 */
import { isProjectClosed } from "./project-status";

/** D-22: exactly one of three types (no Retainer, decision 2). */
export const CONTRACT_ITEM_TYPE_LABELS = { FIXED_PRICE: "Trọn gói", TIME_AND_MATERIAL: "Theo giờ", INTERNAL: "Nội bộ" } as const;
export type ContractItemType = keyof typeof CONTRACT_ITEM_TYPE_LABELS;
/** Shown while a line item has no type yet (items created by the data migration). */
export const CONTRACT_ITEM_TYPE_PENDING_LABEL = "Chờ phân loại";

/** Where the money comes from: the original contract, an appendix, or an approved change request. */
export const CONTRACT_ITEM_KIND_LABELS = { ROOT: "HĐ gốc", APPENDIX: "Phụ lục", CHANGE_REQUEST: "Yêu cầu thay đổi" } as const;
export type ContractItemKind = keyof typeof CONTRACT_ITEM_KIND_LABELS;

/** D-07: what a task or time entry shows before its project has any line item. */
export const NO_CONTRACT_ITEM_LABEL = "Chưa có hạng mục";
/** D-07 / decision 5: lost-deal Pre-sale hours are a separate company-level cost section, never project cost. */
export const LOST_DEAL_PRE_SALE_LABEL = "Chi phí Pre-sale";

const has = (labels: object, value: unknown): boolean => typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value);
export const isContractItemType = (value: unknown): value is ContractItemType => has(CONTRACT_ITEM_TYPE_LABELS, value);
export const isContractItemKind = (value: unknown): value is ContractItemKind => has(CONTRACT_ITEM_KIND_LABELS, value);
export const contractItemTypeLabel = (value: unknown): string => isContractItemType(value) ? CONTRACT_ITEM_TYPE_LABELS[value] : CONTRACT_ITEM_TYPE_PENDING_LABEL;

export interface ContractItemRef {
  id: string;
  kind: string;
  sortOrder: number;
}

/** D-06: one line item -> that one; several -> the root item (HĐ gốc), first in order; none -> null ("Chưa có hạng mục"). */
export function defaultContractItemId(activeItems: readonly ContractItemRef[]): string | null {
  const ordered = [...activeItems].sort((left, right) => left.sortOrder - right.sortOrder);
  return (ordered.find((item) => item.kind === "ROOT") ?? ordered[0])?.id ?? null;
}

/**
 * D-01 / D-05 / D-06 for a task being created or saved. A sub-task repeats its parent. A top-level task takes the
 * requested item; picking anything other than the default, or moving off the current item, is the PM's (Admin) call and
 * a move needs a reason. Returns `error` + `forbidden` instead of throwing so the service decides the HTTP status.
 */
export function resolveTaskContractItem(input: {
  isSubtask: boolean;
  parentItemId?: string | null;
  currentItemId?: string | null;
  requestedItemId?: string | null;
  activeItems: readonly ContractItemRef[];
  canAssign: boolean;
  reason?: string | null;
}): { value: string | null; moved: boolean; error?: string; forbidden?: boolean } {
  if (input.isSubtask) return { value: input.parentItemId ?? null, moved: false };
  const fallback = defaultContractItemId(input.activeItems);
  const current = input.currentItemId ?? null;
  const requested = input.requestedItemId || null;
  if (!requested || requested === current) return { value: current ?? fallback, moved: false };
  if (!input.activeItems.some((item) => item.id === requested)) {
    return { value: current, moved: false, error: "Hạng mục hợp đồng không thuộc dự án này hoặc đã ngừng dùng." };
  }
  // Creating with the default item is what the system would have done anyway.
  if (!current && requested === fallback) return { value: requested, moved: false };
  if (!input.canAssign) {
    return { value: current, moved: false, forbidden: true, error: "Chỉ PM (Admin) hoặc người quản lý dự án mới được gán hay đổi hạng mục hợp đồng của task." };
  }
  if (current && !String(input.reason ?? "").trim()) {
    return { value: current, moved: false, error: "Đổi hạng mục hợp đồng của task bắt buộc phải nhập lý do." };
  }
  return { value: requested, moved: Boolean(current) };
}

/** D-22: type and base value lock once the item has logged hours or the project has an issued invoice. */
export function lockedContractItemFields(
  current: { contractType: string | null; valueAmount: number | null },
  next: { contractType?: string | null; valueAmount?: number | null },
  usage: { hasTimeEntries: boolean; hasIssuedInvoice: boolean; /** ProjectPnlRecord.contractStatus === "signed" (P&L spec 6.1). */ contractSigned?: boolean }
): string[] {
  if (!usage.hasTimeEntries && !usage.hasIssuedInvoice && !usage.contractSigned) return [];
  const locked: string[] = [];
  // Filling in a value that was never set is not a change (migrated items start without type and value) — except on a
  // signed contract, whose base values are read-only as a whole.
  const wasSet = (value: unknown) => value !== null || Boolean(usage.contractSigned);
  if (next.contractType !== undefined && wasSet(current.contractType) && next.contractType !== current.contractType) locked.push("loại hợp đồng");
  if (next.valueAmount !== undefined && wasSet(current.valueAmount) && next.valueAmount !== current.valueAmount) locked.push("giá trị gốc");
  return locked;
}

/** D-07: a deal is lost when the project is Closed and its latest close carries the reason "Thua deal". */
export function isLostDealProject(status: unknown, statusHistory: ReadonlyArray<{ toStatus: string; closeReasonCode?: string | null; changedAt?: Date | string | null }>): boolean {
  if (!isProjectClosed(status)) return false;
  const closes = statusHistory.filter((row) => isProjectClosed(row.toStatus))
    .sort((left, right) => new Date(right.changedAt ?? 0).getTime() - new Date(left.changedAt ?? 0).getTime());
  return closes[0]?.closeReasonCode === "lost_deal";
}

export interface LostDealPreSaleEntry {
  projectId: string;
  projectCode: string;
  projectName: string;
  workDate: Date | string;
  minutes: number;
}

/** Decision 5: Pre-sale minutes of lost deals per calendar month of the work date, for the company-level cost section. */
export function summarizeLostDealPreSale(entries: readonly LostDealPreSaleEntry[]) {
  const months = new Map<string, { month: string; minutes: number; projects: Map<string, { projectId: string; projectCode: string; projectName: string; minutes: number }> }>();
  for (const entry of entries) {
    const month = new Date(entry.workDate).toISOString().slice(0, 7);
    const bucket = months.get(month) ?? { month, minutes: 0, projects: new Map() };
    const project = bucket.projects.get(entry.projectId) ?? { projectId: entry.projectId, projectCode: entry.projectCode, projectName: entry.projectName, minutes: 0 };
    project.minutes += entry.minutes;
    bucket.minutes += entry.minutes;
    bucket.projects.set(entry.projectId, project);
    months.set(month, bucket);
  }
  const rows = [...months.values()].sort((left, right) => left.month.localeCompare(right.month))
    .map((bucket) => ({ month: bucket.month, minutes: bucket.minutes, projects: [...bucket.projects.values()] }));
  return { label: LOST_DEAL_PRE_SALE_LABEL, level: "company" as const, totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0), months: rows };
}
