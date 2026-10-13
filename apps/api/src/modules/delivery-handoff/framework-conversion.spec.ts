import { describe, expect, it } from "vitest";
import {
  HOLDING_STAGE_KEY, LEGACY_STAGE_KEYS, milestoneKey, planFrameworkConversion, templateStageKeyFor,
  type FrameworkConversionPlan, type FrameworkOperation, type FrameworkSnapshot
} from "./framework-conversion";
import { LEGACY_NAME_MAP, TPL_001_KEY } from "./legacy-conversion";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";

type Stage = FrameworkSnapshot["stages"][number];
type Task = FrameworkSnapshot["tasks"][number];
const stage = (id: string, milestoneId: string, activity: string, extra: Partial<Stage> = {}): Stage =>
  ({ id, milestoneId, stageKey: id, activity, status: "not_started", sortOrder: 10, taskTypeLayer1: null, afterPnlClose: null, slaDays: null, loggedMinutes: 0, ...extra });
const task = (id: string, stageId: string | null, extra: Partial<Task> = {}): Task =>
  ({ id, stageId, parentTaskId: null, status: "todo", archivedAt: null, taskTypeLayer1: null, ...extra });
const snapshot = (input: Partial<FrameworkSnapshot> & { status?: string }): FrameworkSnapshot => ({
  project: { id: "p1", code: "P-1", name: "Dự án A", status: input.status ?? "in_progress", projectType: "delivery", milestoneTemplateKey: null },
  milestones: [], stages: [], gates: [], tasks: [], ...input
});
const ops = <T extends FrameworkOperation["type"]>(plan: FrameworkConversionPlan, type: T) => plan.operations.filter((operation): operation is Extract<FrameworkOperation, { type: T }> => operation.type === type);

/** What applyFrameworkConversion does, on the snapshot: the planner is then asked again. */
function applied(before: FrameworkSnapshot, plan: FrameworkConversionPlan): FrameworkSnapshot {
  const next: FrameworkSnapshot = JSON.parse(JSON.stringify(before));
  const stageId = (key: string) => next.stages.find((item) => item.stageKey === key)!.id;
  for (const operation of plan.operations) {
    if (operation.type === "retire_milestone") {
      const milestone = next.milestones.find((item) => item.id === operation.milestoneId)!;
      Object.assign(milestone, { name: `[Khung cũ] ${milestone.name}`, normalizedKey: `legacy:${milestone.normalizedKey}`, sortOrder: milestone.sortOrder + 9000 });
      for (const item of next.stages.filter((row) => operation.stageIds.includes(row.id))) item.stageKey = `legacy:${item.stageKey}`;
    } else if (operation.type === "create_milestone") {
      const template = PILOT_PROJECT_MILESTONE_TEMPLATE[operation.templateMilestone - 1];
      next.milestones.push({ id: `tpl-m${operation.templateMilestone}`, name: template.name, normalizedKey: milestoneKey(template.name), sortOrder: template.sortOrder });
    } else if (operation.type === "create_stage") {
      const template = PILOT_PROJECT_MILESTONE_TEMPLATE[operation.templateMilestone - 1].stages.find((item) => item.stageKey === operation.stageKey)!;
      next.stages.push(stage(`new-${template.stageKey}`, `tpl-m${operation.templateMilestone}`, template.activity, { stageKey: template.stageKey, sortOrder: template.sortOrder, taskTypeLayer1: template.taskTypeLayer1, afterPnlClose: template.afterPnlClose, status: operation.started ? "in_progress" : "not_started" }));
    } else if (operation.type === "create_holding_stage") {
      next.stages.push(stage("new-holding", "tpl-m1", "Chờ xếp stage", { stageKey: HOLDING_STAGE_KEY, sortOrder: 0, status: operation.started ? "in_progress" : "not_started" }));
    } else if (operation.type === "map_milestone") next.milestones.find((item) => item.id === operation.milestoneId)!.normalizedKey = operation.normalizedKey;
    else if (operation.type === "map_stage") {
      const { type: _type, stageId: id, name: _name, ...data } = operation;
      Object.assign(next.stages.find((item) => item.id === id)!, data);
    } else if (operation.type === "create_gate") next.gates.push({ stageId: stageId(operation.stageKey), code: operation.code });
    else if (operation.type === "set_template_key") next.project.milestoneTemplateKey = operation.templateKey;
    else if (operation.type === "set_project_status") next.project.status = operation.to;
    else if (operation.type === "move_task") next.tasks.find((item) => item.id === operation.taskId)!.stageId = stageId(operation.toStageKey);
    else if (operation.type === "classify_task") next.tasks.find((item) => item.id === operation.taskId)!.taskTypeLayer1 = operation.taskTypeLayer1;
  }
  return next;
}

const beforeG1 = snapshot({
  status: "planning",
  milestones: [{ id: "m1", name: "Nhận brief & kick-off", normalizedKey: "nhận brief & kick-off", sortOrder: 10 }, { id: "m2", name: "Việc khác", normalizedKey: "việc khác", sortOrder: 20 }],
  stages: [stage("s-intake", "m1", "Intake", { status: "in_progress" }), stage("s-presale", "m1", "Pre-sales - Lark License", { sortOrder: 20 }), stage("s-odd", "m2", "Linh tinh")],
  tasks: [task("t1", "s-intake"), task("t2", "s-presale"), task("t3", "s-odd"), task("t3a", "s-odd", { parentTaskId: "t3" }), task("t4", "s-intake", { status: "done" })]
});

const milestone2 = snapshot({
  milestones: [{ id: "m1", name: "Nhận brief & kick-off dự án", normalizedKey: "old-1", sortOrder: 10 }, { id: "m2", name: "Milestone 2: Xây dựng hệ thống", normalizedKey: "old-2", sortOrder: 20 }],
  stages: [
    stage("a", "m1", "Intake", { status: "completed" }), stage("b", "m1", "Validate", { status: "completed", sortOrder: 20 }),
    stage("c", "m2", "Thiết kế giải pháp Lark", { status: "completed" }), stage("d", "m2", "[BUILD] Quy trình nghỉ việc", { status: "in_progress", sortOrder: 20 }),
    stage("e", "m2", "Feature Build: báo cáo", { sortOrder: 30 }), stage("f", "m2", "Việc phát sinh", { sortOrder: 40 })
  ],
  tasks: [task("t1", "d"), task("t2", "d", { status: "done" }), task("t3", "f"), task("t4", "a", { taskTypeLayer1: "PM" })]
});

const milestone34 = snapshot({
  milestones: [{ id: "m3", name: "Triển khai, nghiệm thu, vận hành", normalizedKey: "old-3", sortOrder: 30 }],
  stages: [stage("on", "m3", "Onboarding", { status: "in_progress", taskTypeLayer1: "DELIVERY" }), stage("nt", "m3", "Nghiệm thu", { sortOrder: 20 })],
  tasks: [task("t1", "on"), task("t2", "nt"), task("t2a", null, { parentTaskId: "t2" }), task("t3", "on", { status: "completed" }), task("t4", "on", { taskTypeLayer1: "DELIVERY" })]
});

describe("planFrameworkConversion (table 9.1)", () => {
  it("names a TPL-001 stage only for names that mean one stage, inside the milestone the legacy table gives", () => {
    for (const [name, key] of Object.entries(LEGACY_STAGE_KEYS)) {
      const milestone = PILOT_PROJECT_MILESTONE_TEMPLATE.findIndex((item) => item.stages.some((row) => row.stageKey === key)) + 1;
      expect(LEGACY_NAME_MAP[name]?.milestone, name).toBe(milestone);
    }
    expect(templateStageKeyFor({ activity: "[DXE] Intake" })).toBe("intake");
    expect(templateStageKeyFor({ activity: "Deployment Preparation" })).toBe("deployment_preparation");
    expect(templateStageKeyFor({ activity: "Triển khai, nghiệm thu, vận hành" })).toBeNull();
  });

  it("chưa qua G1: creates TPL-001, re-homes tasks, parks unmapped ones, retires the old framework in place", () => {
    const plan = planFrameworkConversion(beforeG1);
    expect(plan.position).toBe("before_g1");
    expect(plan.totals).toMatchObject({ milestonesCreated: 4, stagesCreated: 11, gatesCreated: 8, milestonesRetired: 2, stagesRetired: 3, tasksRehomed: 3, tasksToHolding: 2, tasksClassified: 2 });
    expect(JSON.stringify(plan.operations)).not.toMatch(/contractItem/i); // v2 13/10: no contract line item is created or assigned
    expect(ops(plan, "move_task").map((operation) => [operation.taskId, operation.toStageKey])).toEqual([["t1", "intake"], ["t2", "intake"], ["t3", HOLDING_STAGE_KEY], ["t3a", HOLDING_STAGE_KEY], ["t4", "intake"]]);
    expect(ops(plan, "create_stage").filter((operation) => operation.started).map((operation) => operation.stageKey)).toEqual(["intake"]);
    expect(ops(plan, "create_gate").every((operation) => !operation.passed)).toBe(true);
    expect(ops(plan, "set_template_key")).toEqual([{ type: "set_template_key", templateKey: TPL_001_KEY }]);
    // Open tasks: Layer 1 of the stage they land in; the parked ones wait for the PM. Closed t4 is not classified.
    expect(ops(plan, "classify_task")).toEqual([
      { type: "classify_task", taskId: "t1", taskTypeLayer1: "PRE_SALE" },
      { type: "classify_task", taskId: "t2", taskTypeLayer1: "PRE_SALE" }
    ]);
    expect(plan.steps.join(" ")).toContain("Chờ xếp stage");
    // Framework operations come before anything that needs the new stages.
    const order = plan.operations.map((operation) => operation.type);
    expect(order.indexOf("retire_milestone")).toBeLessThan(order.indexOf("create_milestone"));
    expect(order.lastIndexOf("create_stage")).toBeLessThan(order.indexOf("create_gate"));
  });

  it("Milestone 2: maps milestones and stages in place, creates their gates and the classification of open tasks", () => {
    const plan = planFrameworkConversion(milestone2);
    expect(plan.position).toBe("milestone_2");
    expect(plan.totals).toMatchObject({ milestonesCreated: 0, stagesCreated: 0, milestonesRetired: 0, tasksRehomed: 0, milestonesMapped: 2, stagesMapped: 4 });
    expect(ops(plan, "map_stage").map((operation) => [operation.stageId, operation.stageKey])).toEqual([["a", "intake"], ["b", "validate"], ["c", "design"], ["d", "build"]]);
    expect(ops(plan, "map_stage")[3]).toMatchObject({ taskTypeLayer1: "DELIVERY", afterPnlClose: false, slaDays: 5 });
    expect(ops(plan, "map_milestone").map((operation) => operation.normalizedKey)).toEqual(["nhận brief & kick-off dự án", "xây dựng hệ thống"]);
    // G1 and G2 stand before the stage being worked on (build): passed. G3 is build's own gate: open.
    expect(ops(plan, "create_gate").map((operation) => [operation.code, operation.passed])).toEqual([["G1", true], ["G2", true], ["G3", false]]);
    expect(ops(plan, "classify_task")).toEqual([
      { type: "classify_task", taskId: "t1", taskTypeLayer1: "DELIVERY" },
      // 9.2: a stage whose own name says nothing takes its milestone's Layer 1.
      { type: "classify_task", taskId: "t3", taskTypeLayer1: "DELIVERY" }
    ]);
    // "Feature Build" is a second Build stage and "Việc phát sinh" maps to nothing: both stay as they are.
    expect(plan.notes.join(" ")).toContain("Feature Build: báo cáo; Việc phát sinh");
  });

  it("Milestone 3–4: keeps the framework; only the classification of open tasks and the status code", () => {
    const plan = planFrameworkConversion(milestone34);
    expect(plan.position).toBe("milestone_3_4");
    expect(plan.operations).toEqual([
      { type: "classify_task", taskId: "t1", taskTypeLayer1: "DELIVERY" },
      { type: "classify_task", taskId: "t2", taskTypeLayer1: "PM" },
      { type: "classify_task", taskId: "t2a", taskTypeLayer1: "PM" },
      { type: "set_project_status", from: "in_progress", to: "active" }
    ]);
    expect(plan.totals).toMatchObject({ tasksClassified: 3, statusesChanged: 1, gatesCreated: 0 });
  });

  it("không xác định: reports, plans nothing — until the PM's answer is passed", () => {
    const unknown = snapshot({ milestones: [{ id: "m", name: "lark_base", normalizedKey: "lark_base", sortOrder: 10 }], stages: [stage("s", "m", "Việc chung", { status: "in_progress" })], tasks: [task("t", "s")] });
    const plan = planFrameworkConversion(unknown);
    expect(plan).toMatchObject({ position: "unknown", operations: [], steps: [] });
    expect(plan.notes).toHaveLength(1);
    expect(planFrameworkConversion(snapshot({})).position).toBe("unknown");
    expect(planFrameworkConversion(unknown, { position: "milestone_3_4" }).totals).toMatchObject({ tasksClassified: 0, statusesChanged: 1 });
  });

  it("leaves completed projects and the internal worklog alone", () => {
    expect(planFrameworkConversion({ ...milestone34, project: { ...milestone34.project, status: "completed" } })).toMatchObject({ position: "not_running", operations: [] });
    expect(planFrameworkConversion({ ...milestone34, project: { ...milestone34.project, projectType: "internal_worklog" } }).operations).toEqual([]);
  });

  it("a project already on TPL-001 with nothing missing gives an empty plan", () => {
    const stages = PILOT_PROJECT_MILESTONE_TEMPLATE.flatMap((milestone, index) => milestone.stages.map((item) => stage(item.stageKey, `m${index + 1}`, item.activity, { sortOrder: item.sortOrder, taskTypeLayer1: item.taskTypeLayer1, afterPnlClose: item.afterPnlClose })));
    const plan = planFrameworkConversion(snapshot({
      status: "planning",
      project: { id: "p1", code: "P-1", name: "Dự án A", status: "planning", projectType: "delivery", milestoneTemplateKey: TPL_001_KEY },
      milestones: PILOT_PROJECT_MILESTONE_TEMPLATE.map((milestone, index) => ({ id: `m${index + 1}`, name: milestone.name, normalizedKey: milestoneKey(milestone.name), sortOrder: milestone.sortOrder })),
      stages,
      gates: stages.flatMap((item) => { const code = (PILOT_PROJECT_MILESTONE_TEMPLATE.flatMap((milestone) => milestone.stages as readonly any[]).find((row) => row.stageKey === item.stageKey)).gateCode; return code ? [{ stageId: item.id, code }] : []; }),
      tasks: [task("t", "intake", { taskTypeLayer1: "PRE_SALE" })]
    }));
    expect(plan).toMatchObject({ position: "before_g1", operations: [], steps: [] });
  });

  it.each([["chưa qua G1", beforeG1], ["Milestone 2", milestone2], ["Milestone 3–4", milestone34]])("%s: planning again after apply plans nothing", (_label, before) => {
    const plan = planFrameworkConversion(before);
    expect(plan.operations.length).toBeGreaterThan(0);
    const again = planFrameworkConversion(applied(before, plan));
    expect(again.operations).toEqual([]);
    expect(again.position).toBe(plan.position);
  });
});
