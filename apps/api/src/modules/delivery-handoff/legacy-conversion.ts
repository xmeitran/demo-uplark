/**
 * Section 9 of "Nguyên tắc nền tảng hệ thống PM" — legacy data conversion, the pure rules.
 * The database side is scripts/operations/convert-legacy-data.ts; nothing here reads or writes.
 *
 * 9.2 "Lớp 1 theo milestone và stage chứa task": a legacy stage is mapped to a Layer 1 value and to its side of the
 * P&L closing point (G7) by TPL-001 stage key when the project uses the template, otherwise by its NAME and its
 * milestone's NAME against the explicit table below. A name that is not in the table stays unmapped: nobody guesses.
 */
import { STANDARD_DAY_MINUTES, getDailyActualLogWindow } from "./daily-actual-log";
import { normalizeProjectStatus } from "./project-status";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";
import type { TaskTypeLayer1 } from "./task-classification";

/** Project.milestoneTemplateKey of TPL-001 (BUILTIN_MILESTONE_TEMPLATE_KEY in projects.service.ts). */
export const TPL_001_KEY = "pilot-v1";

export interface LegacyStageMapping {
  /** null = the name does not decide Layer 1 (a milestone whose stages mix Delivery and PM). */
  taskTypeLayer1: TaskTypeLayer1 | null;
  /** Side of the P&L closing point G7: false = before, true = after, null = not decided by the name. */
  afterPnlClose: boolean | null;
  /** TPL-001 milestone the name corresponds to (table 9.1); null when it does not say. */
  milestone: 1 | 2 | 3 | 4 | null;
}

const entry = (taskTypeLayer1: TaskTypeLayer1 | null, afterPnlClose: boolean | null, milestone: LegacyStageMapping["milestone"]): LegacyStageMapping => ({ taskTypeLayer1, afterPnlClose, milestone });

/** Lower case, no diacritics, punctuation and emoji collapsed to one space, without a leading "upcoming" / "milestone N". */
export function normalizeLegacyName(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^upcoming /, "")
    .replace(/^milestone \d+ /, "");
}

/** TPL-001 itself: every stage by key and by name, every milestone by name (Layer 1 only when all its stages share it). */
function templateEntries() {
  const byStageKey = new Map<string, LegacyStageMapping>();
  const byName: Record<string, LegacyStageMapping> = {};
  PILOT_PROJECT_MILESTONE_TEMPLATE.forEach((milestone, index) => {
    const number = (index + 1) as 1 | 2 | 3 | 4;
    for (const stage of milestone.stages) {
      const mapped = entry(stage.taskTypeLayer1, stage.afterPnlClose, number);
      byStageKey.set(stage.stageKey, mapped);
      byName[normalizeLegacyName(stage.activity)] = mapped;
      byName[normalizeLegacyName(stage.stageKey)] = mapped;
    }
    const layers = new Set<TaskTypeLayer1>(milestone.stages.map((stage) => stage.taskTypeLayer1));
    const sides = new Set<boolean>(milestone.stages.map((stage) => stage.afterPnlClose));
    byName[normalizeLegacyName(milestone.name)] = entry(layers.size === 1 ? [...layers][0] : null, sides.size === 1 ? [...sides][0] : null, number);
  });
  return { byStageKey, byName };
}

const TEMPLATE = templateEntries();

/**
 * The mapping table, keyed by normalizeLegacyName. TPL-001 names come from the template; the rest are the variants
 * found in the data on 12/10/2026: Vietnamese/English spellings of the same stage, the previous default template, and
 * the five-milestone structure of the projects imported from Lark Base.
 */
export const LEGACY_NAME_MAP: Readonly<Record<string, LegacyStageMapping>> = {
  ...TEMPLATE.byName,
  // Milestone 1 — "Task của Milestone 1 (Intake, Validate)" is Pre-sale (4.1).
  "nhan brief kick off": entry("PRE_SALE", false, 1),
  "pre sale": entry("PRE_SALE", false, 1),
  "pre sales": entry("PRE_SALE", false, 1),
  // Milestone 2 — design and build.
  "thiet ke giai phap lark": entry("DELIVERY", false, 2),
  "xay dung he thong nghiem thu uat": entry("DELIVERY", false, 2),
  "configuration integration": entry("DELIVERY", false, 2),
  // Milestone 3 — pilot, onboarding (Delivery) and acceptance (PM).
  onboarding: entry("DELIVERY", false, 3),
  "nghiem thu": entry("PM", false, 3),
  "nghiem thu he thong": entry("PM", false, 3),
  "trien khai nghiem thu van hanh": entry(null, false, 3),
  // Milestone 4 — after acceptance.
  "van hanh toi uu": entry("DELIVERY", true, 4),
  "ban giao bao tri": entry(null, true, 4),
  // Before acceptance for certain, but Pre-sale (TPL-001 Intake) or Delivery cannot be told from the name.
  "khao sat thuc trang chuan hoa quy trinh": entry(null, false, null)
};

/** Names that only start with a mapped phrase: "Pre-sales - Lark License", "Feature Build: …". */
export const LEGACY_NAME_PREFIXES: ReadonlyArray<readonly [string, LegacyStageMapping]> = [
  ["pre sale ", LEGACY_NAME_MAP["pre sale"]],
  ["pre sales ", LEGACY_NAME_MAP["pre sales"]],
  ["feature build ", entry("DELIVERY", false, 2)]
];

/**
 * One name against the table. A name written "[Tag] Rest" is tried whole, then by its tag ("[BUILD] Quy trình nghỉ việc"
 * is a Build stage), then by the rest ("[DXE] Intake", "[ASNOVA Payroll] Milestone 3 - …").
 */
export function lookupLegacyName(name: unknown): LegacyStageMapping | null {
  const raw = String(name ?? "");
  const tagged = /^\s*\[([^\]]+)\]\s*(.+)$/.exec(raw);
  for (const candidate of tagged ? [raw, tagged[1], tagged[2]] : [raw]) {
    const key = normalizeLegacyName(candidate);
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(LEGACY_NAME_MAP, key)) return LEGACY_NAME_MAP[key];
    const prefixed = LEGACY_NAME_PREFIXES.find(([prefix]) => key.startsWith(prefix));
    if (prefixed) return prefixed[1];
  }
  return null;
}

export type LegacyMappingSource = "template" | "stage_name" | "milestone_name" | "stage_and_milestone" | "conflict" | "unmapped";

export interface LegacyStageInput {
  milestoneTemplateKey?: string | null;
  stageKey?: string | null;
  stageName?: string | null;
  milestoneName?: string | null;
}

/**
 * The stage's own name decides; what it leaves open is taken from its milestone's name. A stage whose name says one
 * side of the closing point inside a milestone that says the other is a contradiction and maps to nothing.
 */
export function mapLegacyStage(input: LegacyStageInput): LegacyStageMapping & { source: LegacyMappingSource } {
  if (input.milestoneTemplateKey === TPL_001_KEY) {
    const templated = TEMPLATE.byStageKey.get(String(input.stageKey ?? ""));
    if (templated) return { ...templated, source: "template" };
  }
  const stage = lookupLegacyName(input.stageName);
  const milestone = lookupLegacyName(input.milestoneName);
  if (!stage && !milestone) return { ...entry(null, null, null), source: "unmapped" };
  if (stage && milestone && stage.afterPnlClose !== null && milestone.afterPnlClose !== null && stage.afterPnlClose !== milestone.afterPnlClose) {
    return { ...entry(null, null, null), source: "conflict" };
  }
  return {
    taskTypeLayer1: stage?.taskTypeLayer1 ?? milestone?.taskTypeLayer1 ?? null,
    afterPnlClose: stage?.afterPnlClose ?? milestone?.afterPnlClose ?? null,
    milestone: stage?.milestone ?? milestone?.milestone ?? null,
    source: stage && milestone ? "stage_and_milestone" : stage ? "stage_name" : "milestone_name"
  };
}

// ---------------------------------------------------------------------------
// 9.2 — old Timesheet groups stored in TaskTimeEntry.workType (slugs lost their diacritics when saved)
// ---------------------------------------------------------------------------

const MEETING_OR_OTHER_WORK_TYPES = new Set(["h_p", "hop", "họp", "meeting", "kh_c", "khac", "khác"]);
const DAY_OFF_WORK_TYPES = new Set(["day_off", "dayoff", "day-off", "leave", "ngh", "nghi", "nghỉ", "ngh_ph_p", "nghi_phep"]);
const COMPANY_ACTIVITY_WORK_TYPES = new Set(["company_activity", "ho_t_ng_c_ng_ty", "hoat_dong_cong_ty"]);

export type LegacyWorkGroup = "meeting_or_other" | "day_off" | "company_activity";

export function legacyWorkGroup(entry: { workType?: string | null; dayOffId?: string | null }): LegacyWorkGroup | null {
  const slug = String(entry.workType ?? "").trim().toLowerCase();
  if (entry.dayOffId || DAY_OFF_WORK_TYPES.has(slug)) return "day_off";
  if (COMPANY_ACTIVITY_WORK_TYPES.has(slug)) return "company_activity";
  return MEETING_OR_OTHER_WORK_TYPES.has(slug) ? "meeting_or_other" : null;
}

/** TaskTimeEntry.legacyPendingReason; labels are the PNL_GATE_REASON_LABELS of the same codes (pnl-rules.ts). */
export const LEGACY_PENDING_REASONS = ["legacy_group_in_project", "legacy_unmapped_stage", "legacy_no_stage"] as const;
export type LegacyPendingReason = (typeof LEGACY_PENDING_REASONS)[number];

// ---------------------------------------------------------------------------
// 9.2 — "Ngày có hơn 8 giờ trước ngày áp dụng giữ nguyên và được đánh dấu"
// ---------------------------------------------------------------------------

export interface DayCapEntry {
  id: string;
  userId: string;
  /** startAt when the entry has a window, else workDate — the instant the daily cap attributes it to (D-13). */
  at: Date;
  minutes: number;
  overtimeMinutes?: number | null;
}

/**
 * Entries of the person-days whose standard minutes exceed the daily cap and that are dated (Vietnam time) before the
 * effective date. Hours are never changed: the result is only a mark.
 */
export function entriesBeforeEightHourRule(entries: readonly DayCapEntry[], effectiveDate: string, capMinutes: number = STANDARD_DAY_MINUTES) {
  const days = new Map<string, { minutes: number; ids: string[] }>();
  for (const item of entries) {
    const localDate = getDailyActualLogWindow(item.at).localDate;
    if (localDate >= effectiveDate) continue;
    const day = days.get(`${item.userId}|${localDate}`) ?? { minutes: 0, ids: [] };
    day.minutes += item.minutes - (item.overtimeMinutes ?? 0);
    day.ids.push(item.id);
    days.set(`${item.userId}|${localDate}`, day);
  }
  const over = [...days.values()].filter((day) => day.minutes > capMinutes);
  return { personDays: over.length, entryIds: over.flatMap((day) => day.ids) };
}

// ---------------------------------------------------------------------------
// 9.1 — where a running project stands on the effective date (report only; nothing is restructured)
// ---------------------------------------------------------------------------

export const PROJECT_POSITIONS = {
  before_g1: { label: "Chưa qua G1", handling: "Chuyển hẳn sang khung TPL-001" },
  milestone_2: { label: "Đang ở Milestone 2", handling: "Ánh xạ milestone và stage hiện có sang TPL-001; tạo hạng mục hợp đồng; gán Lớp 1 và hạng mục cho task đang mở" },
  milestone_3_4: { label: "Đang ở Milestone 3 hoặc 4", handling: "Giữ khung cũ tới khi đóng; chỉ bổ sung hạng mục hợp đồng, phân loại cho task đang mở và trạng thái theo bộ mới" },
  unknown: { label: "Không xác định", handling: "PM xác nhận vị trí của dự án, rồi áp một trong ba cách của bảng 9.1" }
} as const;
export type ProjectPosition = keyof typeof PROJECT_POSITIONS;

const STARTED_STAGE_STATUSES = new Set(["in_progress", "completed", "done"]);

/** Completed and closed projects are not "đang chạy". */
export function isRunningProject(status: unknown): boolean {
  const code = normalizeProjectStatus(status);
  return code !== "completed" && code !== "maintenance" && code !== "closed";
}

/**
 * The furthest TPL-001 milestone that has a started stage (status, or hours logged in it). A project whose stages
 * cannot be placed on TPL-001, or that has none, is "Không xác định" — the PM decides, the system does not guess.
 */
export function classifyProjectPosition(stages: ReadonlyArray<{ milestone: LegacyStageMapping["milestone"]; status?: string | null; loggedMinutes?: number }>): ProjectPosition {
  const isStarted = (stage: (typeof stages)[number]) => STARTED_STAGE_STATUSES.has(String(stage.status ?? "").toLowerCase()) || (stage.loggedMinutes ?? 0) > 0;
  const placed = stages.filter((stage) => stage.milestone !== null);
  const started = placed.filter(isStarted);
  // Nothing started on a known milestone: "chưa qua G1" only when no unplaced stage is being worked on either.
  if (!started.length) return placed.some((stage) => stage.milestone === 1) && !stages.some(isStarted) ? "before_g1" : "unknown";
  const furthest = Math.max(...started.map((stage) => stage.milestone as number));
  return furthest >= 3 ? "milestone_3_4" : furthest === 2 ? "milestone_2" : "before_g1";
}
