import { describe, expect, it } from "vitest";
import { captureBaseline } from "./baseline.service";
import { CR_EVALUATION_TASK_TITLE, CR_EVALUATION_TASK_TYPE, changeRequestStageRule, effortMd, isApprovedChangeRequest, loadChangeRequestLinks, runningMilestone } from "./change-request-effects";
import { fakePrisma } from "./fake-prisma.testing";
import { assertStageGateOpen, listProjectGates } from "./gates.service";
import { issueLogHooks, changeRequestStepSlaDays, type IssueLogContext } from "./issue-log.service";
import { computeProjectStatus } from "./status-proposal";

const project = { id: "p1", accountId: "a1", projectType: "delivery" };
const principal = { workspaceId: "w", tenantKey: "t", subjectId: "pm", displayName: "PM", roleCodes: [] } as any;
const actor = { userId: "pm", isAdmin: false, isPm: true, isBd: false, isMember: true };

function seed() {
  const fake = fakePrisma({
    project: [{ id: "p1", workspaceId: "w", hierarchyOrderVersion: 1 }],
    projectMilestone: [
      { id: "m1", workspaceId: "w", projectId: "p1", name: "Milestone 1", sortOrder: 10, gateStatus: "approved" },
      { id: "m2", workspaceId: "w", projectId: "p1", name: "Milestone 2", sortOrder: 20, gateStatus: "open" },
      { id: "m3", workspaceId: "w", projectId: "p1", name: "Milestone 3", sortOrder: 30, gateStatus: "locked" }
    ],
    projectStage: [
      { id: "s-design", workspaceId: "w", projectId: "p1", milestoneId: "m2", activity: "Design", sortOrder: 10, status: "in_progress", taskTypeLayer1: "DELIVERY", afterPnlClose: false, ownerUserId: "pm", milestone: { id: "m2", name: "Milestone 2", sortOrder: 20, gateStatus: "open" } },
      { id: "s-prep", workspaceId: "w", projectId: "p1", milestoneId: "m2", activity: "Deployment preparation", sortOrder: 40, status: "not_started", afterPnlClose: false, milestone: { id: "m2", name: "Milestone 2", sortOrder: 20, gateStatus: "open" } }
    ],
    projectContractItem: [{ id: "root", workspaceId: "w", projectId: "p1", code: "HM-01", name: "HĐ gốc", kind: "ROOT", contractType: "FIXED_PRICE", valueAmount: 1000, estimateMinutes: 4800, status: "active", sortOrder: 10 }],
    projectRisk: [{ id: "cr1", workspaceId: "w", projectId: "p1", code: "CR-001", type: "change_request", status: "assessing", crStep: "CR-03", description: "Thêm báo cáo tồn kho", extension: { estimatedEffortMd: 2.5 }, ownerUserId: "pm" }]
  });
  const ctx: IssueLogContext = { prisma: fake.prisma, principal, actor, now: new Date("2026-10-12T03:00:00.000Z") };
  const record = () => fake.table("projectRisk")[0];
  const run = (hook: string) => issueLogHooks[hook]({ ctx, record: record(), project });
  return { ...fake, ctx, record, run };
}

describe("V-39: stage and evaluation task of a change request", () => {
  it("creates stage “Change Request – {mã}” in the running milestone with the task “Đánh giá yêu cầu thay đổi” (Lớp 1 PM, hạng mục gốc), once", async () => {
    const { run, table } = seed();
    await run("onChangeRequestClassified");
    await run("onChangeRequestClassified");
    const stages = table("projectStage").filter((stage) => stage.changeRequestId === "cr1");
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ activity: "Change Request – CR-001", milestoneId: "m2", phase: "Milestone 2", sortOrder: 50, status: "in_progress", taskTypeLayer1: "PM", ownerUserId: "pm" });
    const tasks = table("projectTask").filter((task) => task.stageId === stages[0].id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: CR_EVALUATION_TASK_TITLE, taskType: CR_EVALUATION_TASK_TYPE, taskTypeLayer1: "PM", taskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "root", ownerUserId: "pm", assigneeUserId: "pm" });
    expect(table("projectRiskEvent").map((event) => event.action)).toEqual(["cr_stage_created"]);
  });

  it("the running milestone is the first one neither approved nor locked", () => {
    const milestone = (sortOrder: number, gateStatus: string) => ({ sortOrder, gateStatus });
    expect(runningMilestone([milestone(30, "locked"), milestone(10, "approved"), milestone(20, "open")])?.sortOrder).toBe(20);
    expect(runningMilestone([milestone(10, "approved"), milestone(20, "approved")])?.sortOrder).toBe(20);
  });

  it("implementation tasks enter the stage only after approval, on the request's line item; Từ chối / Hoãn closes the stage", async () => {
    const { run, table, prisma, record } = seed();
    await run("onChangeRequestClassified");
    const stage = table("projectStage").find((item) => item.changeRequestId === "cr1")!;
    expect(await changeRequestStageRule(prisma, "w", "s-design")).toBeNull();
    await expect(changeRequestStageRule(prisma, "w", stage.id)).rejects.toThrow(/đã được khách duyệt/);

    Object.assign(record(), { status: "approved", crStep: "CR-07C" });
    await run("onChangeRequestApproved");
    const item = table("projectContractItem").find((row) => row.changeRequestId === "cr1")!;
    expect(await changeRequestStageRule(prisma, "w", stage.id)).toEqual({ contractItemId: item.id, changeRequestId: "cr1", changeRequestCode: "CR-001" });

    await run("onChangeRequestStageClosed");
    expect(stage).toMatchObject({ status: "completed", progressPercent: 100 });
    expect(table("projectTask").find((task) => task.stageId === stage.id)).toMatchObject({ status: "done", contractItemId: "root" }); // assessment hours stay on the root item
  });
});

describe("V-40: the change-request stage never blocks a gate", () => {
  it("its open tasks are not counted by the milestone's gate and time can be logged in it while that gate is not passed", async () => {
    const { run, table, prisma, ctx } = seed();
    table("projectGate").push({ id: "g4", workspaceId: "w", projectId: "p1", milestoneId: "m2", stageId: "s-prep", code: "G4", status: "not_submitted", sortOrder: 4, history: [] });
    await run("onChangeRequestClassified");
    const crStage = table("projectStage").find((item) => item.changeRequestId === "cr1")!;
    // The fake has no groupBy over tasks by stage and no artifacts: give the gate loader what it reads.
    prisma.projectTask.groupBy = async () => table("projectStage").map((stage) => ({ stageId: stage.id, _count: { _all: table("projectTask").filter((task) => task.stageId === stage.id).length } }));
    prisma.projectArtifact.findMany = async () => [];

    const gates = await listProjectGates(ctx, project);
    expect(gates.data[0]).toMatchObject({ code: "G4", openTaskCount: 0 });
    expect(gates.stageSla.map((sla) => sla.stageId)).not.toContain(crStage.id);
    // A stage placed after the unpassed G4 is blocked — except the change-request stage.
    table("projectStage").push({ id: "s-after", workspaceId: "w", projectId: "p1", milestoneId: "m2", activity: "Sau G4", sortOrder: 45, milestone: { sortOrder: 20 } });
    await expect(assertStageGateOpen(prisma, "w", "s-after", "ghi giờ")).rejects.toThrow(/G4/);
    await expect(assertStageGateOpen(prisma, "w", crStage.id, "ghi giờ")).resolves.toBeUndefined();
  });
});

describe("V-30: approval creates the line item, a new baseline version, and the actual effort is computed", () => {
  it("line item “Yêu cầu thay đổi” linked to the request with estimate gốc = CR-03 effort; B0 v2; actual effort = logged hours / 8", async () => {
    const { run, table, prisma, record } = seed();
    await captureBaseline(prisma, { workspaceId: "w", projectId: "p1", cause: { type: "gate", code: "G1", reason: "G1 được duyệt" }, actor: { userId: "pm" } });
    await run("onChangeRequestClassified");
    Object.assign(record(), { status: "approved", crStep: "CR-07C" });
    await run("onChangeRequestApproved");
    await run("onChangeRequestApproved"); // idempotent

    const items = table("projectContractItem").filter((row) => row.changeRequestId === "cr1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: "CR-001", kind: "CHANGE_REQUEST", estimateMinutes: 1200, contractType: null }); // 2.5 MD × 8 h
    const b0 = table("projectBaseline").filter((row) => row.layer === "B0");
    expect(b0.map((row) => row.version)).toEqual([1, 2]);
    expect(b0[1]).toMatchObject({ causeType: "change_request", causeId: "cr1", causeCode: "CR-001" });
    expect(table("projectBaseline").filter((row) => row.layer === "B1")).toHaveLength(2); // the request's stage and task entered the plan
    expect(record().extension.newBaselineVersion).toBe("B0 v2, B1 v2");

    // CR-08B: the PM added an implementation task → B1 v3. CR-09: 12 h logged on the request's item, 3 h on the assessment.
    const stage = table("projectStage").find((item) => item.changeRequestId === "cr1")!;
    const evaluation = table("projectTask").find((task) => task.stageId === stage.id)!;
    table("projectTask").push({ id: "impl", workspaceId: "w", projectId: "p1", stageId: stage.id, parentTaskId: null, archivedAt: null, title: "Làm báo cáo", estimateMinutes: 960, contractItemId: items[0].id, status: "in_progress" });
    await run("onChangeRequestBaselineUpdate");
    expect(record().extension.newBaselineVersion).toBe("B0 v2, B1 v3");
    table("taskTimeEntry").push(
      { workspaceId: "w", projectId: "p1", taskId: "impl", contractItemId: items[0].id, minutes: 720, approvalStatus: "approved" },
      { workspaceId: "w", projectId: "p1", taskId: "impl", contractItemId: items[0].id, minutes: 600, approvalStatus: "rejected" },
      { workspaceId: "w", projectId: "p1", taskId: evaluation.id, contractItemId: "root", minutes: 180, approvalStatus: "approved" }
    );
    expect((await loadChangeRequestLinks(prisma, "w", "p1", [record() as any])).get("cr1")).toMatchObject({
      stageId: stage.id, stageName: "Change Request – CR-001", evaluationTaskId: evaluation.id, contractItemCode: "CR-001", estimatedEffortMd: 2.5, actualEffortMd: 1.5, evaluationEffortMd: 0.38
    });
    await run("computeChangeRequestActualEffort");
    expect(record().extension.actualEffortMd).toBe(1.5);
    expect(stage.status).toBe("completed");
  });

  it("D-23: the line item needs the request past CR-07C and still running; effort is minutes over the standard day", () => {
    expect(["approved", "implementing"].map((status) => isApprovedChangeRequest({ type: "change_request", status }))).toEqual([true, true]);
    expect(["customer_approval", "closed", "rejected", "deferred"].map((status) => isApprovedChangeRequest({ type: "change_request", status }))).toEqual([false, false, false, false]);
    expect(isApprovedChangeRequest({ type: "issue", status: "approved" })).toBe(false);
    expect(effortMd(720, 480)).toBe(1.5);
  });
});

describe("V-26: the other conclusions of CR-02", () => {
  it("“trong phạm vi”: an ordinary task in the stage the record was reported on, linked to the record", async () => {
    const { run, table, record } = seed();
    Object.assign(record(), { status: "not_cr", stageId: "s-design" });
    await run("onNotChangeRequestAsTask");
    const task = table("projectTask")[0];
    expect(task).toMatchObject({ stageId: "s-design", title: "Thêm báo cáo tồn kho", taskType: "implementation", taskTypeLayer1: "DELIVERY", contractItemId: "root", ownerUserId: "pm" });
    expect(record()).toMatchObject({ taskId: task.id, stageId: "s-design", milestoneId: "m2" });
  });

  it("a customer-side Blocker that names what it blocks proposes Tạm dừng through the status proposal, not Có rủi ro", () => {
    const facts = { currentStatus: "active", gates: null, pilotHasTimeLog: false, onboardHasTimeLog: false, openIssueCodes: ["BLK-001"], overdueTaskCount: 0, highDelayWarningCount: 0, holdIsCustomerWait: false };
    expect(computeProjectStatus(facts)?.status).toBe("at_risk");
    expect(computeProjectStatus({ ...facts, customerBlockerCodes: ["BLK-001"] })).toMatchObject({ status: "on_hold", automatic: false, suggestedReason: "Blocker phía khách chặn tiến độ: BLK-001" });
  });
});

describe("CR step SLA comes from the parameter changeRequestStepSlaDays", () => {
  it("reads the Admin's value and falls back to the catalogue for a step the parameter does not list", async () => {
    const { prisma, table } = seed();
    expect(await changeRequestStepSlaDays(prisma, "w", "CR-03", 3)).toBe(3);
    table("systemParameter").push({ workspaceId: "w", key: "changeRequestStepSlaDays", value: { "CR-02": 1, "CR-03": 5, "CR-04": 2, "CR-05A": 1, "CR-05B": 1, "CR-06": 1, "CR-07": 1, "CR-08A": 2, "CR-08B": 1 }, createdAt: new Date() });
    expect(await changeRequestStepSlaDays(prisma, "w", "CR-03", 3)).toBe(5);
    expect(await changeRequestStepSlaDays(prisma, "w", "CR-G1", 4)).toBe(4);
  });
});
