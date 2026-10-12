/**
 * Baselines (rules 6.3, D-20, D-21). "B0 thương mại (phạm vi và giá đã ký) và B1 triển khai (milestone, timeline,
 * giờ dự kiến đã khóa)". Both are taken when G1 passes (8.1: "estimate gốc khóa thành B0 và B1"); every later change
 * writes the next version and the old ones stay for reconciliation.
 */
export const BASELINE_LAYERS = ["B0", "B1"] as const;
export type BaselineLayer = (typeof BASELINE_LAYERS)[number];
export const BASELINE_LAYER_LABELS: Record<BaselineLayer, string> = {
  B0: "B0 thương mại (phạm vi và giá đã ký)",
  B1: "B1 triển khai (milestone, timeline, giờ dự kiến)"
};

export const BASELINE_CAUSE_LABELS = {
  gate: "Điểm chốt",
  change_request: "Yêu cầu thay đổi",
  stage_extension: "Gia hạn stage",
  timeline_change: "Yêu cầu đổi timeline của task",
  plan_edit: "Admin sửa kế hoạch",
  manual: "Admin khóa lại baseline"
} as const;
export type BaselineCauseType = keyof typeof BASELINE_CAUSE_LABELS;

/** B0: one row per contract line item. */
export interface BaselineLineItem {
  id: string;
  code: string;
  name: string;
  kind: string;
  contractType: string | null;
  valueAmount: number | null;
  currency: string;
  estimateMinutes: number | null;
}

/** B1: milestones and stages in order, and the top-level tasks (sub-tasks are the staff's own planning, D-19). */
export interface BaselineMilestone { id: string; name: string; sortOrder: number }
export interface BaselineStage { id: string; milestoneId: string; name: string; sortOrder: number; plannedStartAt: string | null; plannedEndAt: string | null; slaDays: number | null }
export interface BaselineTask { id: string; stageId: string | null; title: string; plannedStartAt: string | null; dueAt: string | null; estimateMinutes: number; contractItemId: string | null }

export interface BaselineSnapshot {
  lineItems?: BaselineLineItem[];
  milestones?: BaselineMilestone[];
  stages?: BaselineStage[];
  tasks?: BaselineTask[];
}

export interface BaselineDiffEntry {
  entity: "lineItem" | "milestone" | "stage" | "task";
  id: string;
  name: string;
  change: "added" | "removed" | "changed";
  /** Field label → before / after, for "changed". */
  fields?: Array<{ field: string; before: string | number | null; after: string | number | null }>;
}

export interface BaselineVersionSummary {
  id: string;
  layer: BaselineLayer;
  version: number;
  reason: string;
  causeType: BaselineCauseType;
  causeId?: string;
  causeCode?: string;
  createdByName?: string;
  createdAt: string;
  /** Against the previous version of the same layer; empty for version 1. */
  diff: BaselineDiffEntry[];
  totals: { lineItems?: number; valueAmount?: number; estimateMinutes: number; tasks?: number };
}

export interface ProjectBaselineResponse {
  projectId: string;
  /** D-21: B1 exists, so timeline and estimates only change through an approved path. */
  locked: boolean;
  current: Partial<Record<BaselineLayer, BaselineVersionSummary & { snapshot: BaselineSnapshot }>>;
  /** Newest first. */
  history: BaselineVersionSummary[];
  /** The caller is an Admin (PM / Dx Director) and may lock or re-lock the baseline with a reason. */
  canCapture: boolean;
}

/** What the system created for a change request (V-39, V-30); attached to the record in the issue log. */
export interface ChangeRequestLinks {
  stageId?: string;
  stageName?: string;
  stageStatus?: string;
  evaluationTaskId?: string;
  evaluationTaskTitle?: string;
  contractItemId?: string;
  contractItemCode?: string;
  contractItemName?: string;
  /** CR-03 estimate, in man-days. */
  estimatedEffortMd?: number;
  /** Logged hours of the request's implementation tasks / standard day; live until the request closes. */
  actualEffortMd?: number;
  /** Hours logged on the evaluation task (root line item), in man-days. */
  evaluationEffortMd?: number;
}

/** TD-05: approved extensions of a stage. Extensions caused by a change request are listed but not counted (V-40). */
export interface StageExtensionSummary {
  id: string;
  previousDueAt?: string;
  newDueAt: string;
  reason: string;
  changeRequestCode?: string;
  approvedByName?: string;
  approvedAt: string;
  counted: boolean;
}

export interface ExtendStageInput {
  newDueAt: string;
  reason: string;
  /** Issue-log id of the change request that causes the extension (V-40). */
  changeRequestId?: string;
}

/** 9.4: one row of the old CR Log file, keyed by the file's own column headers. */
export type CrLogImportRow = Record<string, string | number | null | undefined>;
export interface CrLogImportInput { rows: CrLogImportRow[] }
export interface CrLogImportResult {
  created: string[];
  /** Codes that already exist in the project: left untouched, so a re-import changes nothing. */
  unchanged: string[];
  /** Rows that could not be mapped, with the 1-based data row number and why. */
  rejected: Array<{ row: number; code?: string; reason: string }>;
  /** File headers nobody recognised; their values were ignored. */
  unmappedColumns: string[];
  counterLast: number;
}
