/**
 * Table 9.1 of "Nguyên tắc nền tảng hệ thống PM" — converting ONE running project to the new framework. Pure planning:
 * nothing here reads or writes. framework-conversion.service.ts loads the snapshot, applies, backs up and restores.
 *
 * Every operation is the difference between the snapshot and the target, so planning a converted project gives nothing.
 * Old milestones and stages are never deleted: they are RETIRED in place (stage key and milestone key prefixed
 * "legacy:", milestone name prefixed "[Khung cũ] ", moved to the end). Issue log records and documents keep pointing at
 * them, and a restore only has to write the old columns back.
 */
import { PROJECT_POSITIONS, TPL_001_KEY, classifyProjectPosition, isRunningProject, lookupLegacyName, mapLegacyStage, normalizeLegacyName, type ProjectPosition } from "./legacy-conversion";
import { PROJECT_STATUS_CATALOGUE, normalizeProjectStatus } from "./project-status";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";
import { isInternalWorklogProjectType, isTaskTypeLayer1, taskTypeLayer1Label } from "./task-classification";
import { isClosedWorkStatus } from "./task-status";

export const HOLDING_STAGE_KEY = "cho-xep-stage";
export const HOLDING_STAGE_NAME = "Chờ xếp stage";
export const RETIRED_KEY_PREFIX = "legacy:";
export const RETIRED_NAME_PREFIX = "[Khung cũ] ";

type TemplateStage = (typeof PILOT_PROJECT_MILESTONE_TEMPLATE)[number]["stages"][number];
const TEMPLATE_STAGES: Array<{ stage: TemplateStage; milestone: 1 | 2 | 3 | 4 }> = PILOT_PROJECT_MILESTONE_TEMPLATE.flatMap((milestone, index) =>
  milestone.stages.map((stage) => ({ stage: stage as TemplateStage, milestone: (index + 1) as 1 | 2 | 3 | 4 })));
const TEMPLATE_STAGE_BY_KEY = new Map(TEMPLATE_STAGES.map((item) => [item.stage.stageKey as string, item]));
const gateCodeOf = (stageKey: string): string | undefined => (TEMPLATE_STAGE_BY_KEY.get(stageKey)?.stage as { gateCode?: string } | undefined)?.gateCode;

/** ProjectMilestone.normalizedKey as createProject writes it (normalizeMilestoneKey in projects.service.ts). */
export const milestoneKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/**
 * LEGACY_NAME_MAP says which TPL-001 MILESTONE an old name belongs to; this says which STAGE, for the names that name
 * one. Names that cover several stages ("Triển khai, nghiệm thu, vận hành") are left out: nobody guesses.
 */
export const LEGACY_STAGE_KEYS: Readonly<Record<string, string>> = {
  "nhan brief kick off": "intake",
  "pre sale": "intake",
  "pre sales": "intake",
  "thiet ke giai phap lark": "design",
  "xay dung he thong nghiem thu uat": "build",
  "configuration integration": "build",
  onboarding: "onboard",
  "nghiem thu": "acceptance",
  "nghiem thu he thong": "acceptance",
  "van hanh toi uu": "optimize"
};
const LEGACY_STAGE_PREFIXES: ReadonlyArray<readonly [string, string]> = [["pre sale ", "intake"], ["pre sales ", "intake"], ["feature build ", "build"]];

/** The TPL-001 stage an old stage corresponds to, by its key or its name ("[Tag] Rest" tried whole, by tag, by rest). */
export function templateStageKeyFor(stage: { stageKey?: string | null; activity?: string | null }): string | null {
  if (stage.stageKey && TEMPLATE_STAGE_BY_KEY.has(stage.stageKey)) return stage.stageKey;
  const raw = String(stage.activity ?? "");
  const tagged = /^\s*\[([^\]]+)\]\s*(.+)$/.exec(raw);
  for (const candidate of tagged ? [raw, tagged[1], tagged[2]] : [raw]) {
    const name = normalizeLegacyName(candidate);
    if (!name) continue;
    const own = TEMPLATE_STAGES.find(({ stage }) => normalizeLegacyName(stage.activity) === name || normalizeLegacyName(stage.stageKey) === name);
    if (own) return own.stage.stageKey;
    if (Object.prototype.hasOwnProperty.call(LEGACY_STAGE_KEYS, name)) return LEGACY_STAGE_KEYS[name];
    const prefixed = LEGACY_STAGE_PREFIXES.find(([prefix]) => name.startsWith(prefix));
    if (prefixed) return prefixed[1];
  }
  return null;
}

export interface FrameworkSnapshot {
  project: { id: string; code: string; name: string; status: string; projectType: string; milestoneTemplateKey: string | null };
  milestones: Array<{ id: string; name: string; normalizedKey: string; sortOrder: number }>;
  stages: Array<{
    id: string; milestoneId: string; stageKey: string; activity: string; status: string; sortOrder: number;
    taskTypeLayer1: string | null; afterPnlClose: boolean | null; slaDays?: number | null; loggedMinutes?: number;
  }>;
  gates: Array<{ stageId: string; code: string }>;
  tasks: Array<{ id: string; stageId: string | null; parentTaskId: string | null; status: string; archivedAt?: Date | string | null; taskTypeLayer1: string | null }>;
}

/** Stages are referred to by stage key: the executor resolves the key after the framework operations ran. */
export type FrameworkOperation =
  | { type: "retire_milestone"; milestoneId: string; name: string; stageIds: string[] }
  | { type: "create_milestone"; templateMilestone: 1 | 2 | 3 | 4; name: string }
  | { type: "create_stage"; stageKey: string; templateMilestone: 1 | 2 | 3 | 4; started: boolean }
  | { type: "create_holding_stage"; started: boolean }
  | { type: "map_milestone"; milestoneId: string; name: string; normalizedKey: string }
  | { type: "map_stage"; stageId: string; name: string; stageKey: string; taskTypeLayer1?: string; afterPnlClose?: boolean; slaDays?: number }
  | { type: "create_gate"; stageKey: string; code: string; passed: boolean }
  | { type: "set_template_key"; templateKey: string }
  | { type: "move_task"; taskId: string; toStageKey: string }
  | { type: "classify_task"; taskId: string; taskTypeLayer1: string }
  | { type: "set_project_status"; from: string; to: string };

export const EMPTY_FRAMEWORK_TOTALS = {
  milestonesCreated: 0, stagesCreated: 0, gatesCreated: 0, milestonesMapped: 0, stagesMapped: 0, milestonesRetired: 0, stagesRetired: 0,
  tasksRehomed: 0, tasksToHolding: 0, tasksClassified: 0, statusesChanged: 0
};
export type FrameworkTotals = typeof EMPTY_FRAMEWORK_TOTALS;

export type FrameworkPosition = ProjectPosition | "not_running";

export interface FrameworkConversionPlan {
  projectId: string;
  projectCode: string;
  projectName: string;
  position: FrameworkPosition;
  positionLabel: string;
  handling: string;
  /** What will happen, in Vietnamese, for the person who confirms. Empty when there is nothing to do. */
  steps: string[];
  /** Things the conversion will NOT do and somebody has to look at. */
  notes: string[];
  operations: FrameworkOperation[];
  totals: FrameworkTotals;
}

const STARTED = new Set(["in_progress", "completed", "done"]);
const isStarted = (stage: { status?: string | null; loggedMinutes?: number }) => STARTED.has(String(stage.status ?? "").toLowerCase()) || (stage.loggedMinutes ?? 0) > 0;
const isOpenTask = (task: { status: string; archivedAt?: unknown }) => !task.archivedAt && !isClosedWorkStatus(task.status);

/** A stage as it will be once the framework operations ran. */
interface FinalStage { key: string; id?: string; layer1: string | null; started: boolean; hasGate: boolean }

/**
 * `position` overrides the computed one: table 9.1 leaves "Không xác định" to the PM, who confirms where the project
 * stands; the caller then passes that answer.
 */
export function planFrameworkConversion(snapshot: FrameworkSnapshot, options: { position?: ProjectPosition } = {}): FrameworkConversionPlan {
  const { project } = snapshot;
  const operations: FrameworkOperation[] = [];
  const steps: string[] = [];
  const notes: string[] = [];
  const base = { projectId: project.id, projectCode: project.code, projectName: project.name };
  const done = (position: FrameworkPosition, positionLabel: string, handling: string): FrameworkConversionPlan => {
    const totals = { ...EMPTY_FRAMEWORK_TOTALS };
    for (const operation of operations) {
      if (operation.type === "create_milestone") totals.milestonesCreated += 1;
      else if (operation.type === "create_stage" || operation.type === "create_holding_stage") totals.stagesCreated += 1;
      else if (operation.type === "create_gate") totals.gatesCreated += 1;
      else if (operation.type === "map_milestone") totals.milestonesMapped += 1;
      else if (operation.type === "map_stage") totals.stagesMapped += 1;
      else if (operation.type === "retire_milestone") { totals.milestonesRetired += 1; totals.stagesRetired += operation.stageIds.length; }
      else if (operation.type === "move_task") { if (operation.toStageKey === HOLDING_STAGE_KEY) totals.tasksToHolding += 1; else totals.tasksRehomed += 1; }
      else if (operation.type === "classify_task") totals.tasksClassified += 1;
      else if (operation.type === "set_project_status") totals.statusesChanged += 1;
    }
    return { ...base, position, positionLabel, handling, steps: operations.length ? steps : [], notes, operations, totals };
  };

  if (isInternalWorklogProjectType(project.projectType) || !isRunningProject(project.status)) {
    notes.push(isInternalWorklogProjectType(project.projectType) ? "DX Internal Worklog không có khung milestone để chuyển đổi." : "Dự án đã hoàn thành hoặc đã đóng: nằm ngoài bảng 9.1.");
    return done("not_running", "Ngoài bảng 9.1", "Không chuyển đổi");
  }

  const milestoneById = new Map(snapshot.milestones.map((milestone) => [milestone.id, milestone]));
  const live = snapshot.stages
    .filter((stage) => !stage.stageKey.startsWith(RETIRED_KEY_PREFIX))
    .sort((left, right) => (milestoneById.get(left.milestoneId)?.sortOrder ?? 0) - (milestoneById.get(right.milestoneId)?.sortOrder ?? 0) || left.sortOrder - right.sortOrder);
  const mappingOf = (stage: (typeof live)[number]) => mapLegacyStage({ milestoneTemplateKey: project.milestoneTemplateKey, stageKey: stage.stageKey, stageName: stage.activity, milestoneName: milestoneById.get(stage.milestoneId)?.name });
  // The holding stage is the conversion's own: work parked there says nothing about where the project stands.
  const position = options.position ?? classifyProjectPosition(live.filter((stage) => stage.stageKey !== HOLDING_STAGE_KEY).map((stage) => ({ milestone: mappingOf(stage).milestone, status: stage.status, loggedMinutes: stage.loggedMinutes })));
  const { label, handling } = PROJECT_POSITIONS[position];
  if (position === "unknown") {
    notes.push(live.length ? "Không xác định được vị trí từ milestone/stage hiện có: PM xác nhận vị trí rồi chạy lại với vị trí đó." : "Dự án chưa có milestone/stage nào: PM xác nhận vị trí rồi chạy lại với vị trí đó.");
    return done(position, label, handling);
  }

  const liveKeys = new Set(live.map((stage) => stage.stageKey));
  const onTemplate = project.milestoneTemplateKey === TPL_001_KEY && TEMPLATE_STAGES.every(({ stage }) => liveKeys.has(stage.stageKey));
  let finalStages: FinalStage[] = live.map((stage) => ({ key: stage.stageKey, id: stage.id, layer1: stage.taskTypeLayer1 ?? (stage.stageKey === HOLDING_STAGE_KEY ? null : mappingOf(stage).taskTypeLayer1), started: isStarted(stage), hasGate: snapshot.gates.some((gate) => gate.stageId === stage.id) }));
  /** Stage key each task ends up in (only for tasks that move). */
  const movedTo = new Map<string, string>();

  if (position === "before_g1" && !onTemplate) {
    // 9.1 row 1: the whole TPL-001 framework is created; every task of an old stage moves to its TPL-001 stage.
    // As in 9.2: the stage's own name decides; when it says nothing, its milestone's name does ("Pre-sales - Lark License").
    const targetOf = new Map(live.map((stage) => [stage.id, templateStageKeyFor(stage) ?? templateStageKeyFor({ activity: milestoneById.get(stage.milestoneId)?.name })]));
    const startedKeys = new Set(live.filter(isStarted).map((stage) => targetOf.get(stage.id) ?? HOLDING_STAGE_KEY));
    const liveIds = new Set(live.map((stage) => stage.id));
    for (const milestone of snapshot.milestones) {
      const stageIds = live.filter((stage) => stage.milestoneId === milestone.id).map((stage) => stage.id);
      if (stageIds.length || !milestone.normalizedKey.startsWith(RETIRED_KEY_PREFIX)) operations.push({ type: "retire_milestone", milestoneId: milestone.id, name: milestone.name, stageIds });
    }
    PILOT_PROJECT_MILESTONE_TEMPLATE.forEach((milestone, index) => operations.push({ type: "create_milestone", templateMilestone: (index + 1) as 1 | 2 | 3 | 4, name: milestone.name }));
    for (const { stage, milestone } of TEMPLATE_STAGES) operations.push({ type: "create_stage", stageKey: stage.stageKey, templateMilestone: milestone, started: startedKeys.has(stage.stageKey) });
    const moving = snapshot.tasks.filter((task) => task.stageId && liveIds.has(task.stageId));
    for (const task of moving) movedTo.set(task.id, targetOf.get(task.stageId!) ?? HOLDING_STAGE_KEY);
    const needsHolding = [...movedTo.values()].includes(HOLDING_STAGE_KEY);
    if (needsHolding) operations.push({ type: "create_holding_stage", started: startedKeys.has(HOLDING_STAGE_KEY) });
    for (const task of moving) operations.push({ type: "move_task", taskId: task.id, toStageKey: movedTo.get(task.id)! });
    operations.push({ type: "set_template_key", templateKey: TPL_001_KEY });
    finalStages = [
      // The holding stage sits before every gate, so work on an unplaced task is never blocked by G1.
      ...(needsHolding ? [{ key: HOLDING_STAGE_KEY, layer1: null, started: startedKeys.has(HOLDING_STAGE_KEY), hasGate: false }] : []),
      ...TEMPLATE_STAGES.map(({ stage }) => ({ key: stage.stageKey as string, layer1: stage.taskTypeLayer1 as string, started: startedKeys.has(stage.stageKey), hasGate: false }))
    ];
    const toHolding = moving.filter((task) => movedTo.get(task.id) === HOLDING_STAGE_KEY).length;
    steps.push(`Tạo khung TPL-001: 4 milestone, ${TEMPLATE_STAGES.length} stage và các điểm chốt G1–G8.`);
    if (moving.length) steps.push(`Chuyển ${moving.length - toHolding} task sang stage TPL-001 tương ứng theo bảng ánh xạ tên${toHolding ? `; ${toHolding} task ở stage không ánh xạ được chuyển vào stage "${HOLDING_STAGE_NAME}" để PM xếp lại` : ""}.`);
    const retired = operations.filter((operation) => operation.type === "retire_milestone").length;
    if (retired) steps.push(`Lưu trữ ${retired} milestone cũ (${live.length} stage): không xóa, đổi tên thành "${RETIRED_NAME_PREFIX}…" và đưa xuống cuối; khôi phục được từ bản sao lưu.`);
  }

  if (position === "milestone_2") {
    // 9.1 row 2: milestones and stages keep their rows and names; they only take the TPL-001 keys their names map to.
    const milestoneKeys = new Set(snapshot.milestones.map((milestone) => milestone.normalizedKey));
    const claimedMilestones = new Set<number>();
    for (const milestone of [...snapshot.milestones].sort((left, right) => left.sortOrder - right.sortOrder)) {
      if (milestone.normalizedKey.startsWith(RETIRED_KEY_PREFIX)) continue;
      const number = lookupLegacyName(milestone.name)?.milestone;
      if (!number || claimedMilestones.has(number)) continue;
      claimedMilestones.add(number);
      const normalizedKey = milestoneKey(PILOT_PROJECT_MILESTONE_TEMPLATE[number - 1].name);
      if (milestone.normalizedKey === normalizedKey || milestoneKeys.has(normalizedKey)) continue;
      milestoneKeys.add(normalizedKey);
      operations.push({ type: "map_milestone", milestoneId: milestone.id, name: milestone.name, normalizedKey });
    }
    const claimedKeys = new Set(live.map((stage) => stage.stageKey).filter((key) => TEMPLATE_STAGE_BY_KEY.has(key)));
    const unmapped: string[] = [];
    for (const [index, stage] of live.entries()) {
      if (TEMPLATE_STAGE_BY_KEY.has(stage.stageKey)) continue;
      const key = stage.stageKey === HOLDING_STAGE_KEY ? null : templateStageKeyFor(stage);
      if (!key || claimedKeys.has(key)) { if (stage.stageKey !== HOLDING_STAGE_KEY) unmapped.push(stage.activity); continue; }
      claimedKeys.add(key);
      const template = TEMPLATE_STAGE_BY_KEY.get(key)!.stage as TemplateStage & { slaDays?: number };
      operations.push({
        type: "map_stage", stageId: stage.id, name: stage.activity, stageKey: key,
        ...(stage.taskTypeLayer1 === null ? { taskTypeLayer1: template.taskTypeLayer1 } : {}),
        ...(stage.afterPnlClose === null ? { afterPnlClose: template.afterPnlClose } : {}),
        ...(stage.slaDays == null && template.slaDays ? { slaDays: template.slaDays } : {})
      });
      finalStages[index] = { ...finalStages[index], key, layer1: stage.taskTypeLayer1 ?? template.taskTypeLayer1 };
    }
    if (claimedKeys.size && project.milestoneTemplateKey !== TPL_001_KEY) operations.push({ type: "set_template_key", templateKey: TPL_001_KEY });
    const mappedStages = operations.filter((operation) => operation.type === "map_stage").length;
    const mappedMilestones = operations.filter((operation) => operation.type === "map_milestone").length;
    if (mappedStages || mappedMilestones) steps.push(`Ánh xạ tại chỗ ${mappedMilestones} milestone và ${mappedStages} stage sang khóa TPL-001 (giữ nguyên tên, task và giờ log).`);
    if (unmapped.length) notes.push(`Stage không ánh xạ được sang TPL-001, giữ nguyên: ${unmapped.join("; ")}.`);
  }

  if (position !== "milestone_3_4") {
    // Gates of table 8.1 on every stage that carries a TPL-001 key. A gate the project is already past is created as
    // passed: an open one would block time logging in the stage being worked on (V-11).
    const lastStarted = finalStages.reduce((last, stage, index) => (stage.started ? index : last), -1);
    const codes = new Set(snapshot.gates.map((gate) => gate.code));
    const created: string[] = [];
    finalStages.forEach((stage, index) => {
      const code = gateCodeOf(stage.key);
      if (!code || stage.hasGate || codes.has(code)) return;
      codes.add(code);
      operations.push({ type: "create_gate", stageKey: stage.key, code, passed: index < lastStarted });
      created.push(index < lastStarted ? `${code} (đã qua)` : code);
    });
    if (created.length && !movedTo.size && !operations.some((operation) => operation.type === "create_stage")) steps.push(`Tạo điểm chốt cho các stage TPL-001: ${created.join(", ")}. Điểm chốt đứng trước stage đang làm được ghi "đã qua trước ngày áp dụng".`);
  }

  // Classification of OPEN tasks, for all three rows (v2, chốt 13/10: no contract line item is created or assigned).
  const layer1ByKey = new Map(finalStages.map((stage) => [stage.key, stage.layer1]));
  const keyById = new Map(finalStages.filter((stage) => stage.id).map((stage) => [stage.id!, stage.key]));
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const stageLayer1 = (task: FrameworkSnapshot["tasks"][number]) => layer1ByKey.get(movedTo.get(task.id) ?? keyById.get(task.stageId ?? "") ?? "") ?? null;
  const layer1Of = (task: FrameworkSnapshot["tasks"][number], depth = 0): string | null => {
    if (task.taskTypeLayer1) return task.taskTypeLayer1;
    const parent = task.parentTaskId ? taskById.get(task.parentTaskId) : undefined;
    // D-02: a sub-task repeats its parent, a framework task takes its stage's value.
    return parent && depth < 8 ? layer1Of(parent, depth + 1) : parent ? null : stageLayer1(task);
  };
  let layer1Count = 0;
  let pending = 0;
  for (const task of snapshot.tasks.filter(isOpenTask)) {
    if (task.taskTypeLayer1) continue;
    const layer1 = layer1Of(task);
    if (!isTaskTypeLayer1(layer1)) { pending += 1; continue; }
    layer1Count += 1;
    operations.push({ type: "classify_task", taskId: task.id, taskTypeLayer1: layer1 });
  }
  if (layer1Count) steps.push(`Phân loại task đang mở: gán Lớp 1 theo stage cho ${layer1Count} task. Lớp 2 được suy ra lại theo bảng 4.2 (Loại dự án và vị trí task).`);
  if (pending) notes.push(`${pending} task đang mở vẫn "${taskTypeLayer1Label(null)}" Lớp 1 vì stage của chúng chưa có Lớp 1.`);

  if (position === "milestone_3_4") {
    const code = normalizeProjectStatus(project.status);
    if (code && code !== project.status) {
      operations.push({ type: "set_project_status", from: project.status, to: code });
      steps.push(`Chuyển trạng thái lưu "${project.status}" sang mã của bộ trạng thái mới "${code}" (${PROJECT_STATUS_CATALOGUE[code].label}).`);
    } else if (!code) notes.push(`Trạng thái "${project.status}" không thuộc bộ trạng thái mới: PM chọn lại trạng thái.`);
  }
  return done(position, label, handling);
}
