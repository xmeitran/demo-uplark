/**
 * D-07 (v2, chốt 13/10): Pre-sale hours belong to their project from the start; when the project is closed with the
 * reason "Thua deal" they leave the project P&L for the company-level cost line "Chi phí Pre-sale".
 */
import { isProjectClosed } from "./project-status";

export const LOST_DEAL_PRE_SALE_LABEL = "Chi phí Pre-sale";

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
