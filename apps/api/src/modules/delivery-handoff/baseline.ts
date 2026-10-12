/**
 * Baselines B0 / B1 (rules 6.3: D-19, D-20, D-21). Pure: no database access; persistence is in baseline.service.ts.
 *
 * D-20: "Baseline có hai lớp: B0 thương mại (phạm vi và giá đã ký) và B1 triển khai (milestone, timeline, giờ dự kiến
 * đã khóa). Yêu cầu thay đổi được duyệt sinh phiên bản mới; phiên bản cũ giữ để đối soát."
 *   B0 = the contract line items: code, name, source, type, value, estimate gốc.
 *   B1 = milestones (name, order), stages (order, planned start/end, SLA) and top-level tasks (dates, estimate, line item).
 *        Sub-tasks are not baselined: they are the staff's own planning under a task (V-03, D-19).
 * 8.1, G1: "estimate gốc khóa thành B0 và B1" — both layers get version 1 when G1 passes.
 */
import type { BaselineDiffEntry, BaselineLayer, BaselineSnapshot } from "@b2b-crm/contracts";

type Row = Record<string, unknown> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  code: "Mã", name: "Tên", kind: "Nguồn", contractType: "Loại hợp đồng", valueAmount: "Giá trị", currency: "Tiền tệ", estimateMinutes: "Giờ dự kiến (phút)",
  sortOrder: "Thứ tự", milestoneId: "Milestone", plannedStartAt: "Ngày bắt đầu", plannedEndAt: "Ngày kết thúc", slaDays: "SLA (ngày làm việc)",
  title: "Tên", stageId: "Stage", dueAt: "Hạn hoàn thành", contractItemId: "Hạng mục"
};
const COLLECTIONS: ReadonlyArray<[keyof BaselineSnapshot, BaselineDiffEntry["entity"]]> = [["lineItems", "lineItem"], ["milestones", "milestone"], ["stages", "stage"], ["tasks", "task"]];

const scalar = (value: unknown): string | number | null => (value === undefined || value === null ? null : typeof value === "number" ? value : String(value));
const rowName = (row: Row) => String(row.name ?? row.title ?? row.code ?? row.id);

/** What changed between two versions of one layer: added, removed and changed rows with before/after per field. */
export function diffBaselines(previous: BaselineSnapshot | null | undefined, next: BaselineSnapshot): BaselineDiffEntry[] {
  const entries: BaselineDiffEntry[] = [];
  for (const [key, entity] of COLLECTIONS) {
    const before = new Map(((previous?.[key] ?? []) as unknown as Row[]).map((row) => [row.id, row]));
    const after = new Map(((next[key] ?? []) as unknown as Row[]).map((row) => [row.id, row]));
    for (const [id, row] of after) {
      const old = before.get(id);
      if (!old) { entries.push({ entity, id, name: rowName(row), change: "added" }); continue; }
      // A task's title and the display order are labels, not baselined values: renaming or reordering is not a baseline change.
      const fields = Object.keys(row).filter((field) => field !== "id" && !(entity !== "lineItem" && (field === "title" || field === "sortOrder")) && scalar(row[field]) !== scalar(old[field]))
        .map((field) => ({ field: FIELD_LABELS[field] ?? field, before: scalar(old[field]), after: scalar(row[field]) }));
      if (fields.length) entries.push({ entity, id, name: rowName(row), change: "changed", fields });
    }
    for (const [id, row] of before) if (!after.has(id)) entries.push({ entity, id, name: rowName(row), change: "removed" });
  }
  return entries;
}

export function baselineTotals(layer: BaselineLayer, snapshot: BaselineSnapshot) {
  const sum = (rows: ReadonlyArray<{ estimateMinutes?: number | null }> = []) => rows.reduce((total, row) => total + (row.estimateMinutes ?? 0), 0);
  if (layer === "B0") {
    const items = snapshot.lineItems ?? [];
    return { lineItems: items.length, valueAmount: items.reduce((total, item) => total + (item.valueAmount ?? 0), 0), estimateMinutes: sum(items) };
  }
  return { tasks: snapshot.tasks?.length ?? 0, estimateMinutes: sum(snapshot.tasks) };
}

/** D-21: after B1 is locked a change of timeline or estimated hours needs an Admin (PM or Dx Director). */
export function baselineChangeBlocker(input: { b1Locked: boolean; isApprover: boolean }): string | null {
  if (!input.b1Locked || input.isApprover) return null;
  return "Baseline B1 đã khóa: đổi timeline hoặc giờ dự kiến phải được Admin (PM hoặc Dx Director) duyệt (D-21). Hãy gửi yêu cầu thay đổi timeline của task, hoặc nhờ PM gia hạn stage.";
}

export interface EstimateFinding {
  dedupeKey: string;
  title: string;
  detail: string;
  taskId?: string;
}

/**
 * D-19, level Ghi nhận (record and remind the PM, never block):
 *  - "Giờ dự kiến của task lấy từ estimate gốc của hạng mục": the top-level tasks of a line item together may not
 *    plan more hours than the item's estimate gốc;
 *  - "Tổng giờ dự kiến các sub-task vượt giờ của task": the sub-tasks of a task together against the task.
 * An item or task without an estimate (0 / null) has nothing to compare against.
 */
export function estimateFindings(
  items: ReadonlyArray<{ id: string; code: string; name: string; estimateMinutes: number | null }>,
  tasks: ReadonlyArray<{ id: string; title: string; parentTaskId: string | null; contractItemId: string | null; estimateMinutes: number }>
): EstimateFinding[] {
  const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} giờ`;
  const findings: EstimateFinding[] = [];
  for (const item of items) {
    if (!item.estimateMinutes) continue;
    const planned = tasks.filter((task) => !task.parentTaskId && task.contractItemId === item.id).reduce((total, task) => total + task.estimateMinutes, 0);
    if (planned > item.estimateMinutes) {
      findings.push({ dedupeKey: `D-19:item:${item.id}`, title: `Giờ dự kiến các task vượt estimate gốc của hạng mục ${item.code}`, detail: `Hạng mục "${item.name}": các task dự kiến ${hours(planned)}, estimate gốc ${hours(item.estimateMinutes)}.` });
    }
  }
  for (const task of tasks) {
    if (task.parentTaskId || !task.estimateMinutes) continue;
    const planned = tasks.filter((child) => child.parentTaskId === task.id).reduce((total, child) => total + child.estimateMinutes, 0);
    if (planned > task.estimateMinutes) {
      findings.push({ dedupeKey: `D-19:task:${task.id}`, taskId: task.id, title: "Tổng giờ dự kiến các sub-task vượt giờ của task", detail: `Task "${task.title}": các sub-task dự kiến ${hours(planned)}, task ${hours(task.estimateMinutes)}.` });
    }
  }
  return findings;
}
