/**
 * Baseline (rules 6.3, D-20, D-21; v2, chốt 13/10): the plan only — "Baseline gồm milestone, timeline và giờ dự kiến,
 * khóa tại G1. Thay đổi kế hoạch sau khi khóa được duyệt (D-21) thì sinh phiên bản mới; phiên bản cũ giữ để đối soát."
 * There is no commercial layer any more (the old B0 of scope and signed price): rows of it stay stored, unread.
 */
export const BASELINE_CAUSE_LABELS = {
  gate: "Điểm chốt",
  /** Versions written before 13/10/2026 only. */
  change_request: "Yêu cầu thay đổi (dữ liệu cũ)",
  stage_extension: "Gia hạn stage",
  timeline_change: "Yêu cầu đổi timeline của task",
  plan_edit: "Admin sửa kế hoạch",
  manual: "Admin khóa lại baseline"
} as const;
export type BaselineCauseType = keyof typeof BASELINE_CAUSE_LABELS;

/** Milestones and stages in order, and the top-level tasks (sub-tasks are the staff's own planning, D-19). */
export interface BaselineMilestone { id: string; name: string; sortOrder: number }
export interface BaselineStage { id: string; milestoneId: string; name: string; sortOrder: number; plannedStartAt: string | null; plannedEndAt: string | null; slaDays: number | null }
export interface BaselineTask { id: string; stageId: string | null; title: string; plannedStartAt: string | null; dueAt: string | null; estimateMinutes: number }

export interface BaselineSnapshot {
  milestones?: BaselineMilestone[];
  stages?: BaselineStage[];
  tasks?: BaselineTask[];
}

export interface BaselineDiffEntry {
  entity: "milestone" | "stage" | "task";
  id: string;
  name: string;
  change: "added" | "removed" | "changed";
  /** Field label → before / after, for "changed". */
  fields?: Array<{ field: string; before: string | number | null; after: string | number | null }>;
}

export interface BaselineVersionSummary {
  id: string;
  version: number;
  reason: string;
  causeType: BaselineCauseType;
  causeId?: string;
  causeCode?: string;
  createdByName?: string;
  createdAt: string;
  /** Against the previous version; empty for version 1. */
  diff: BaselineDiffEntry[];
  totals: { tasks: number; estimateMinutes: number };
}

export interface ProjectBaselineResponse {
  projectId: string;
  /** D-21: a baseline exists, so timeline and estimates only change through an approved path. */
  locked: boolean;
  /** The version in force; null while the plan is not locked yet. */
  current: (BaselineVersionSummary & { snapshot: BaselineSnapshot }) | null;
  /** Newest first. */
  history: BaselineVersionSummary[];
  /** The caller is an Admin (PM / Dx Director) and may lock or re-lock the baseline with a reason. */
  canCapture: boolean;
}

/** TD-05: approved extensions of a stage; every one counts. */
export interface StageExtensionSummary {
  id: string;
  previousDueAt?: string;
  newDueAt: string;
  reason: string;
  approvedByName?: string;
  approvedAt: string;
}

export interface ExtendStageInput {
  newDueAt: string;
  reason: string;
}
