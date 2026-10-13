/**
 * Baseline (rules 6.3: D-19, D-20, D-21; v2, chốt 13/10). Pure: no database access; persistence is in baseline.service.ts.
 *
 * D-20: "Baseline gồm milestone, timeline và giờ dự kiến, khóa tại G1. Thay đổi kế hoạch sau khi khóa được duyệt (D-21)
 * thì sinh phiên bản mới; phiên bản cũ giữ để đối soát." — the plan only:
 *   milestones (name, order), stages (order, planned start/end, SLA) and top-level tasks (dates, estimate).
 *   Sub-tasks are not baselined: they are the staff's own planning under a task (V-03, D-19).
 * Stored under layer code "B1" (BASELINE_LAYER). Rows of the retired commercial layer "B0" are left in place, unread.
 */
import type { BaselineDiffEntry, BaselineSnapshot } from "@b2b-crm/contracts";

/** The one stored layer: the plan. */
export const BASELINE_LAYER = "B1";

type Row = Record<string, unknown> & { id: string };

const FIELD_LABELS: Record<string, string> = {
  name: "Tên", estimateMinutes: "Giờ dự kiến (phút)",
  sortOrder: "Thứ tự", milestoneId: "Milestone", plannedStartAt: "Ngày bắt đầu", plannedEndAt: "Ngày kết thúc", slaDays: "SLA (ngày làm việc)",
  title: "Tên", stageId: "Stage", dueAt: "Hạn hoàn thành"
};
const COLLECTIONS: ReadonlyArray<[keyof BaselineSnapshot, BaselineDiffEntry["entity"]]> = [["milestones", "milestone"], ["stages", "stage"], ["tasks", "task"]];

const scalar = (value: unknown): string | number | null => (value === undefined || value === null ? null : typeof value === "number" ? value : String(value));
const rowName = (row: Row) => String(row.name ?? row.title ?? row.code ?? row.id);

/** What changed between two versions: added, removed and changed rows with before/after per field. */
export function diffBaselines(previous: BaselineSnapshot | null | undefined, next: BaselineSnapshot): BaselineDiffEntry[] {
  const entries: BaselineDiffEntry[] = [];
  for (const [key, entity] of COLLECTIONS) {
    const before = new Map(((previous?.[key] ?? []) as unknown as Row[]).map((row) => [row.id, row]));
    const after = new Map(((next[key] ?? []) as unknown as Row[]).map((row) => [row.id, row]));
    for (const [id, row] of after) {
      const old = before.get(id);
      if (!old) { entries.push({ entity, id, name: rowName(row), change: "added" }); continue; }
      // A task's title and the display order are labels, not baselined values: renaming or reordering is not a baseline change.
      const fields = Object.keys(row).filter((field) => field !== "id" && field !== "title" && field !== "sortOrder" && scalar(row[field]) !== scalar(old[field]))
        .map((field) => ({ field: FIELD_LABELS[field] ?? field, before: scalar(old[field]), after: scalar(row[field]) }));
      if (fields.length) entries.push({ entity, id, name: rowName(row), change: "changed", fields });
    }
    for (const [id, row] of before) if (!after.has(id)) entries.push({ entity, id, name: rowName(row), change: "removed" });
  }
  return entries;
}

export function baselineTotals(snapshot: BaselineSnapshot) {
  return { tasks: snapshot.tasks?.length ?? 0, estimateMinutes: (snapshot.tasks ?? []).reduce((total, row) => total + (row.estimateMinutes ?? 0), 0) };
}

/** D-21: after the baseline is locked a change of timeline or estimated hours needs an Admin (PM or Dx Director). */
export function baselineChangeBlocker(input: { locked: boolean; isApprover: boolean }): string | null {
  if (!input.locked || input.isApprover) return null;
  return "Baseline đã khóa: đổi timeline hoặc giờ dự kiến phải được Admin (PM hoặc Dx Director) duyệt (D-21). Hãy gửi yêu cầu thay đổi timeline của task, hoặc nhờ PM gia hạn stage.";
}

export interface EstimateFinding {
  dedupeKey: string;
  title: string;
  detail: string;
  taskId?: string;
}

/**
 * D-19, level Ghi nhận (record and remind the PM, never block): "Giờ dự kiến của task đặt trong khung milestone (D-37).
 * Tổng giờ dự kiến các sub-task vượt giờ của task thì ghi nhận và nhắc PM" — the sub-tasks of a task together against
 * the task's own estimate. A task without an estimate (0 / null) has nothing to compare against.
 */
export function estimateFindings(tasks: ReadonlyArray<{ id: string; title: string; parentTaskId: string | null; estimateMinutes: number }>): EstimateFinding[] {
  const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} giờ`;
  const findings: EstimateFinding[] = [];
  for (const task of tasks) {
    if (task.parentTaskId || !task.estimateMinutes) continue;
    const planned = tasks.filter((child) => child.parentTaskId === task.id).reduce((total, child) => total + child.estimateMinutes, 0);
    if (planned > task.estimateMinutes) {
      findings.push({ dedupeKey: `D-19:task:${task.id}`, taskId: task.id, title: "Tổng giờ dự kiến các sub-task vượt giờ của task", detail: `Task "${task.title}": các sub-task dự kiến ${hours(planned)}, task ${hours(task.estimateMinutes)}.` });
    }
  }
  return findings;
}
