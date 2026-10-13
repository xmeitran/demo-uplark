import { describe, expect, it } from "vitest";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { PROJECT_GATE_CATALOGUE, PROJECT_GATE_CODES, type ProjectGateActionInput, type ProjectGateCode } from "@b2b-crm/contracts";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";
import { allowedGateActions, blockingGateForStage, gateDocumentTicks, gatePassedAt, gateRequirements, isStartedStageStatus, planGateAction, g7PendingCheck, type GateFacts, type GateState } from "./gates";
import { issueLogActor } from "./issue-log.service";
import type { IssueLogActor } from "./issue-log";

const now = new Date("2026-10-12T03:00:00.000Z");
const actor = (userId: string, role: Partial<IssueLogActor> = {}): IssueLogActor & { displayName: string } => ({ userId, displayName: userId, isAdmin: false, isPm: false, isBd: false, isMember: true, ...role });
const member = actor("dx");
const pm = actor("pm", { isPm: true });
const bd = actor("bd", { isBd: true });
const director = actor("director", { isAdmin: true, isPm: true });

function facts(code: ProjectGateCode, overrides: Partial<GateFacts> = {}): GateFacts {
  return { reachable: true, documents: PROJECT_GATE_CATALOGUE[code].requiredDocumentTypes.map((type) => ({ type, present: true })), openTaskCount: 0, chargeable: true, projectValueReady: true, openIssuesWithoutOwnerOrDue: 0, ...overrides };
}
// G7 carries the PM's "đã thu đủ" tick (PL-16) unless a test takes it away.
const state = (code: ProjectGateCode, overrides: Partial<GateState> = {}): GateState => ({ code, status: "not_submitted", ...(code === "G7" ? { paymentConfirmedAt: now } : {}), ...overrides });
const plan = (code: ProjectGateCode, gate: Partial<GateState>, who: IssueLogActor, input: ProjectGateActionInput, gateFacts: Partial<GateFacts> = {}) =>
  planGateAction(PROJECT_GATE_CATALOGUE[code], state(code, gate), facts(code, gateFacts), who, input, now);

describe("gate catalogue G1–G8 (table 8.1)", () => {
  it("puts each gate at the end of its TPL-001 stage, in order", () => {
    const templateGates = PILOT_PROJECT_MILESTONE_TEMPLATE.flatMap((milestone, milestoneIndex) =>
      milestone.stages.map((stage, stageIndex) => ({ stageKey: stage.stageKey, gateCode: (stage as { gateCode?: string }).gateCode, lastOfMilestone: stageIndex === milestone.stages.length - 1, milestone: milestoneIndex + 1 })));
    expect(templateGates.filter((stage) => stage.gateCode).map((stage) => `${stage.gateCode}@${stage.stageKey}`)).toEqual([
      "G1@validate", "G2@design", "G3@build", "G4@deployment_preparation", "G5@pilot", "G6@onboard", "G7@acceptance", "G8@handover"
    ]);
    // Intake and Optimize carry no gate; the end-of-Optimize gate is merged into G8.
    expect(templateGates.filter((stage) => !stage.gateCode).map((stage) => stage.stageKey)).toEqual(["intake", "optimize"]);
    for (const stage of templateGates.filter((item) => item.gateCode)) {
      const definition = PROJECT_GATE_CATALOGUE[stage.gateCode as ProjectGateCode];
      expect(definition.stageKey).toBe(stage.stageKey);
      expect(definition.closesMilestone).toBe(stage.lastOfMilestone);
    }
  });

  it("asks the customer at G1, G2, G4, G7 only, with one working day at G4", () => {
    expect(PROJECT_GATE_CODES.filter((code) => PROJECT_GATE_CATALOGUE[code].customerConfirmation)).toEqual(["G1", "G2", "G4", "G7"]);
    expect(PROJECT_GATE_CODES.filter((code) => PROJECT_GATE_CATALOGUE[code].customerResponseParameter === "customerResponseG4WorkingDays")).toEqual(["G4"]);
  });

  it("lists the documents, preparer and approver of the table", () => {
    expect(PROJECT_GATE_CATALOGUE.G2.requiredDocumentTypes).toEqual(["BRD", "FRD", "SRS"]);
    expect(PROJECT_GATE_CATALOGUE.G4.requiredDocumentTypes).toEqual(["SOP", "Video hướng dẫn", "HDSD"]);
    expect(PROJECT_GATE_CATALOGUE.G7).toMatchObject({ preparedBy: "PM", approvedBy: "PM, BD", preparerMayApprove: true, bdMayApprove: true });
    expect(PROJECT_GATE_CATALOGUE.G1.paymentConfirmation).toBe(true);
    expect(PROJECT_GATE_CATALOGUE.G8.goLiveDate).toBe(true);
    expect(PROJECT_GATE_CODES.filter((code) => PROJECT_GATE_CATALOGUE[code].approvedBy !== "PM")).toEqual(["G7"]);
  });
});

describe("required documents are checked by type (V-11)", () => {
  it("ticks a type only when a usable document of that type exists", () => {
    const ticks = gateDocumentTicks(PROJECT_GATE_CATALOGUE.G2, [
      { artifactType: "brd", name: "BRD v1", usable: true },
      { artifactType: "FRD", name: "FRD draft", usable: false },
      { artifactType: "Other", name: "Notes", usable: true }
    ]);
    expect(ticks).toEqual([{ type: "BRD", present: true, documentName: "BRD v1" }, { type: "FRD", present: false }, { type: "SRS", present: false }]);
  });

  it("refuses a submission that misses a required type, however many other files there are", () => {
    const documents = [{ type: "BRD", present: true }, { type: "FRD", present: true }, { type: "SRS", present: false }];
    expect(() => plan("G2", {}, member, { action: "submit" }, { documents })).toThrow(/Thiếu tài liệu bắt buộc: SRS/);
    expect(plan("G2", {}, member, { action: "submit" }).toStatus).toBe("submitted");
  });
});

describe("a stage cannot start before its preceding gate (V-11)", () => {
  const stages = ["intake", "validate", "design", "build", "optimize", "handover"];
  const gates = [{ stageId: "validate", code: "G1", status: "not_submitted" }, { stageId: "design", code: "G2", status: "not_submitted" }, { stageId: "handover", code: "G8", status: "not_submitted" }];

  it("blocks on the nearest earlier gate and never on the stage's own gate", () => {
    expect(blockingGateForStage(stages, gates, "intake")).toBeNull();
    expect(blockingGateForStage(stages, gates, "validate")).toBeNull();
    expect(blockingGateForStage(stages, gates, "design")?.code).toBe("G1");
    expect(blockingGateForStage(stages, gates, "build")?.code).toBe("G2");
    // Optimize has no gate of its own: Handover still waits for the gate before Optimize.
    expect(blockingGateForStage(stages, gates, "handover")?.code).toBe("G2");
  });

  it("opens once the gate is approved or opened by exception, not while it waits for the customer", () => {
    const withStatus = (status: string) => gates.map((gate) => (gate.code === "G1" ? { ...gate, status } : gate));
    expect(blockingGateForStage(stages, withStatus("approved"), "design")).toBeNull();
    expect(blockingGateForStage(stages, withStatus("exception"), "design")).toBeNull();
    expect(blockingGateForStage(stages, withStatus("awaiting_customer"), "design")?.code).toBe("G1");
    expect(blockingGateForStage(stages, withStatus("submitted"), "design")?.code).toBe("G1");
  });

  it("knows which stage statuses mean the stage has started", () => {
    expect(["not_started", "todo", "planned"].map(isStartedStageStatus)).toEqual([false, false, false]);
    expect(["in_progress", "completed", "blocked"].map(isStartedStageStatus)).toEqual([true, true, true]);
  });

  it("does not accept a submission for a gate whose preceding gate is still closed", () => {
    expect(() => plan("G2", {}, member, { action: "submit" }, { reachable: false })).toThrow(ConflictException);
  });
});

describe("preparer and approver are different people (V-12)", () => {
  it("lets any project member prepare, but only the PM approve", () => {
    expect(allowedGateActions(PROJECT_GATE_CATALOGUE.G3, state("G3"), facts("G3"), member)).toEqual(["submit"]);
    expect(() => plan("G3", { status: "submitted", submittedByUserId: "dx" }, member, { action: "approve" })).toThrow(ForbiddenException);
    expect(plan("G3", { status: "submitted", submittedByUserId: "dx" }, pm, { action: "approve" }).toStatus).toBe("approved");
  });

  it("stops the PM from approving, rejecting or conditionally approving a submission they prepared", () => {
    for (const action of ["approve", "reject", "approve_conditional"] as const) {
      expect(() => plan("G3", { status: "submitted", submittedByUserId: "pm" }, pm, { action, reason: "x", conditionOwnerUserId: "dx", conditionDueAt: "2026-10-20" })).toThrow(/hai người khác nhau/);
    }
  });

  it("G7 exception (chốt 11/10 #8): the PM prepares the acceptance minutes and moves the project on; BD may approve too", () => {
    expect(() => plan("G7", {}, member, { action: "submit" })).toThrow(ForbiddenException);
    expect(plan("G7", {}, pm, { action: "submit" }).toStatus).toBe("submitted");
    expect(plan("G7", { status: "submitted", submittedByUserId: "pm" }, pm, { action: "approve" }).toStatus).toBe("awaiting_customer");
    expect(plan("G7", { status: "submitted", submittedByUserId: "pm" }, bd, { action: "approve" }).toStatus).toBe("awaiting_customer");
    expect(() => plan("G3", { status: "submitted", submittedByUserId: "dx" }, bd, { action: "approve" })).toThrow(ForbiddenException);
  });
});

describe("approve, reject, conditional approval (V-13)", () => {
  const submitted = { status: "submitted", submittedByUserId: "dx" };

  it("approves an internal gate straight away and records who and when", () => {
    const result = plan("G5", submitted, pm, { action: "approve" });
    expect(result).toMatchObject({ toStatus: "approved", passed: true, patch: { decision: "approved", decidedByUserId: "pm", decidedAt: now } });
    expect(result.history).toMatchObject({ action: "approve", byUserId: "pm", fromStatus: "submitted", toStatus: "approved" });
    expect(result.customerWait).toBeUndefined();
  });

  it("needs a reason to reject and sends the submission back for resubmission", () => {
    expect(() => plan("G5", submitted, pm, { action: "reject" })).toThrow(/bắt buộc ghi lý do/);
    const result = plan("G5", submitted, pm, { action: "reject", reason: "Thiếu log bug tuần 2" });
    expect(result).toMatchObject({ toStatus: "rejected", passed: false, patch: { decision: "rejected", decisionReason: "Thiếu log bug tuần 2" } });
    expect(allowedGateActions(PROJECT_GATE_CATALOGUE.G5, state("G5", { status: "rejected", submittedByUserId: "dx" }), facts("G5"), member)).toEqual(["submit"]);
  });

  it("does not plainly approve while tasks of the stage are open, and points to the conditional approval", () => {
    expect(() => plan("G5", submitted, pm, { action: "approve" }, { openTaskCount: 2 })).toThrow(/Duyệt có điều kiện/);
  });

  it("conditional approval needs the outstanding part, an owner and a due date, and becomes an Issue", () => {
    const base = { action: "approve_conditional" as const, reason: "Còn 2 task fix bug", conditionOwnerUserId: "dx", conditionDueAt: "2026-10-20" };
    expect(() => plan("G5", submitted, pm, { ...base, reason: "" }, { openTaskCount: 2 })).toThrow(BadRequestException);
    expect(() => plan("G5", submitted, pm, { ...base, conditionOwnerUserId: "" }, { openTaskCount: 2 })).toThrow(/người chịu trách nhiệm/);
    expect(() => plan("G5", submitted, pm, { ...base, conditionDueAt: undefined }, { openTaskCount: 2 })).toThrow(/hạn xử lý/);
    const result = plan("G5", submitted, pm, base, { openTaskCount: 2 });
    expect(result).toMatchObject({ toStatus: "approved", passed: true, patch: { decision: "conditional", decisionReason: "Còn 2 task fix bug" } });
    expect(result.conditionIssue).toEqual({ description: "[G5] Tồn đọng khi duyệt có điều kiện: Còn 2 task fix bug", ownerUserId: "dx", dueAt: "2026-10-20T00:00:00.000Z" });
  });

  it("a conditional approval never waives a missing document", () => {
    const documents = [{ type: "Log bug Pilot", present: true }, { type: "Đề xuất cải tiến Pilot", present: false }];
    expect(() => plan("G5", submitted, pm, { action: "approve_conditional", reason: "x", conditionOwnerUserId: "dx", conditionDueAt: "2026-10-20" }, { documents })).toThrow(/Thiếu tài liệu bắt buộc/);
  });
});

describe("customer confirmation after the internal approval (V-14) and the G1 payment confirmation", () => {
  it("G1 is not approved before the PM confirms instalment 1 and Giá trị dự án is entered (D-22); G7 needs the 'đã thu đủ' tick (PL-16)", () => {
    const submitted = { status: "submitted", submittedByUserId: "bd" };
    expect(() => plan("G1", submitted, pm, { action: "approve" })).toThrow(/đã thu đợt 1/);
    expect(() => plan("G1", { ...submitted, paymentConfirmedAt: now }, pm, { action: "approve" }, { projectValueReady: false })).toThrow(/Chưa nhập Giá trị dự án/);
    // Loại Nội bộ / Đào tạo: no Giá trị dự án, no payment tick.
    expect(plan("G1", submitted, pm, { action: "approve" }, { chargeable: false, projectValueReady: false }).toStatus).toBe("awaiting_customer");
    expect(() => plan("G1", {}, pm, { action: "confirm_payment" }, { chargeable: false })).toThrow(ConflictException);
    expect(() => plan("G7", { status: "submitted", submittedByUserId: "pm", paymentConfirmedAt: null }, pm, { action: "approve" })).toThrow(/đã thu đủ/);
    expect(plan("G7", { paymentConfirmedAt: null }, pm, { action: "confirm_payment" })).toMatchObject({ patch: { paymentConfirmedAt: now, paymentConfirmedByUserId: "pm" }, history: { note: "PM xác nhận BD đã thu đủ" } });
    expect(() => plan("G1", {}, member, { action: "confirm_payment" })).toThrow(ForbiddenException);
    expect(plan("G1", {}, pm, { action: "confirm_payment", reason: "BD báo đã thu 30%" })).toMatchObject({ toStatus: "not_submitted", patch: { paymentConfirmedAt: now, paymentConfirmedByUserId: "pm", paymentNote: "BD báo đã thu 30%" } });
    expect(() => plan("G2", {}, pm, { action: "confirm_payment" })).toThrow(ConflictException);
  });

  it("the internal approval starts the customer wait instead of opening the next stage", () => {
    const result = plan("G1", { status: "submitted", submittedByUserId: "bd", paymentConfirmedAt: now }, pm, { action: "approve" });
    expect(result).toMatchObject({ toStatus: "awaiting_customer", passed: false, customerWait: true });
  });

  it("the confirmation cannot be recorded before the internal approval", () => {
    expect(() => plan("G2", { status: "submitted" }, pm, { action: "confirm_customer", customerConfirmedBy: "Chị Lan", customerEvidence: "https://mail/1" })).toThrow(ConflictException);
  });

  it("records who confirmed on the customer's side, when, and the evidence, then opens what comes next", () => {
    const waiting = { status: "awaiting_customer", submittedByUserId: "dx" };
    expect(() => plan("G2", waiting, pm, { action: "confirm_customer", customerEvidence: "https://mail/1" })).toThrow(/người xác nhận phía khách/);
    expect(() => plan("G2", waiting, pm, { action: "confirm_customer", customerConfirmedBy: "Chị Lan" })).toThrow(/bằng chứng/);
    expect(() => plan("G2", waiting, member, { action: "confirm_customer", customerConfirmedBy: "Chị Lan", customerEvidence: "x" })).toThrow(ForbiddenException);
    const result = plan("G2", waiting, pm, { action: "confirm_customer", customerConfirmedBy: "Chị Lan (COO)", customerConfirmedAt: "2026-10-11", customerEvidence: "https://mail/1" });
    expect(result).toMatchObject({
      toStatus: "approved", passed: true, customerWait: false,
      patch: { customerConfirmedBy: "Chị Lan (COO)", customerEvidence: "https://mail/1", customerRecordedByUserId: "pm", customerConfirmedAt: new Date("2026-10-11T00:00:00.000Z") }
    });
  });

  it("a customer who refuses is a rejection that ends the wait", () => {
    expect(plan("G2", { status: "awaiting_customer", submittedByUserId: "dx" }, pm, { action: "reject", reason: "Khách yêu cầu sửa SRS" })).toMatchObject({ toStatus: "rejected", customerWait: false });
  });
});

describe("exception path (V-11)", () => {
  it("is for the Dx Director only, needs a reason, and is recorded on the gate", () => {
    expect(() => plan("G3", {}, pm, { action: "exception", reason: "Khách cần go-live gấp" })).toThrow(ForbiddenException);
    // A PM is an Admin account (PM implies WORKSPACE_ADMIN) but not the Dx Director: issueLogActor says so from the role held.
    const pmAdmin = issueLogActor({ subjectId: "pm", roleCodes: ["PM", "WORKSPACE_ADMIN", "DELIVERY_LEAD"], heldRoleCodes: ["PM"] } as any, { canManage: true, isMember: true });
    expect(pmAdmin).toMatchObject({ isAdmin: true, canGrantGateException: false });
    expect(() => plan("G3", {}, pmAdmin, { action: "exception", reason: "Khách cần go-live gấp" })).toThrow(ForbiddenException);
    for (const held of ["DX_DIRECTOR", "FOUNDER_GM", "WORKSPACE_ADMIN"]) {
      expect(issueLogActor({ subjectId: "u", roleCodes: [held, "WORKSPACE_ADMIN"], heldRoleCodes: [held] } as any, { canManage: false, isMember: false }).canGrantGateException).toBe(true);
    }
    expect(() => plan("G3", {}, director, { action: "exception" })).toThrow(/bắt buộc ghi lý do/);
    const result = plan("G3", {}, director, { action: "exception", reason: "Khách cần go-live gấp" });
    expect(result).toMatchObject({ toStatus: "exception", passed: true, patch: { exceptionByUserId: "director", exceptionReason: "Khách cần go-live gấp", exceptionAt: now } });
    expect(result.history).toMatchObject({ action: "exception", label: "Ngoại lệ", note: "Khách cần go-live gấp", byUserId: "director" });
  });

  it("offers nothing once the gate is open", () => {
    expect(allowedGateActions(PROJECT_GATE_CATALOGUE.G3, state("G3", { status: "approved" }), facts("G3"), director)).toEqual([]);
    expect(allowedGateActions(PROJECT_GATE_CATALOGUE.G3, state("G3", { status: "exception" }), facts("G3"), director)).toEqual([]);
  });
});

describe("G7 and G8 data conditions (8.1, V-16)", () => {
  it("G7 and G8 need every open issue to have an owner and a due date", () => {
    expect(gateRequirements(PROJECT_GATE_CATALOGUE.G7, state("G7"), facts("G7", { openIssuesWithoutOwnerOrDue: 2 })).map((item) => item.waivable)).toEqual([false]);
    expect(gateRequirements(PROJECT_GATE_CATALOGUE.G3, state("G3"), facts("G3", { openIssuesWithoutOwnerOrDue: 2 }))).toEqual([]);
  });

  it("G8 records Go-live only with a Go-live date", () => {
    const submitted = { status: "submitted", submittedByUserId: "dx" };
    expect(() => plan("G8", submitted, pm, { action: "approve" })).toThrow(/ngày Go-live/);
    expect(() => plan("G8", submitted, pm, { action: "approve", goLiveDate: "not a date" })).toThrow(/ngày không hợp lệ/);
    const result = plan("G8", submitted, pm, { action: "approve", goLiveDate: "2026-11-02" });
    expect(result).toMatchObject({ toStatus: "approved", passed: true, patch: { goLiveDate: new Date("2026-11-02T00:00:00.000Z") } });
  });
});

describe("G7 and hours Chờ xử lý (P&L spec 12/10 point 6)", () => {
  const submitted = { status: "submitted", submittedByUserId: "pm" };
  // What the P&L hour gate answers (PnlService.pendingHoursBlockingG7): the gate only passes it on.
  const blockers = (byReason: Array<{ reason: string; label: string; minutes: number; entryCount: number }>, projectId = "prj-1") =>
    ({ projectId, blockingMinutes: byReason.reduce((sum, row) => sum + row.minutes, 0), entryCount: byReason.length, byReason, waitingCostRateMinutes: 0 }) as any;

  it("takes the hour gate's answer as it is: its reasons and labels, blocked only when blockingMinutes > 0", () => {
    // "legacy_no_stage" is a reason the removed local rule did not know: it must reach the screen too.
    expect(g7PendingCheck(blockers([{ reason: "layer2_mismatch", label: "Lớp 2 không khớp", minutes: 120, entryCount: 1 }, { reason: "legacy_no_stage", label: "Chưa có stage", minutes: 90, entryCount: 2 }], "prj 1"))).toEqual({
      blocked: true,
      worklistHref: "/pnl/hours?projectId=prj%201",
      reasons: [{ reason: "layer2_mismatch", label: "Lớp 2 không khớp", entryCount: 1, minutes: 120 }, { reason: "legacy_no_stage", label: "Chưa có stage", entryCount: 2, minutes: 90 }]
    });
    expect(g7PendingCheck(blockers([]))).toMatchObject({ blocked: false, reasons: [] });
  });

  it("an exception does not skip the data condition at G7 (it closes the project P&L); elsewhere it still opens the gate", () => {
    const pnlPending = g7PendingCheck(blockers([{ reason: "missing_contract_item", label: "Chưa có hạng mục", minutes: 60, entryCount: 1 }]));
    expect(() => plan("G7", {}, director, { action: "exception", reason: "Khách đã dùng hệ thống" }, { pnlPending })).toThrow(/Còn giờ log Chờ xử lý/);
    expect(plan("G7", {}, director, { action: "exception", reason: "Khách đã dùng hệ thống" }, { pnlPending: g7PendingCheck(blockers([])) })).toMatchObject({ toStatus: "exception", passed: true });
    expect(plan("G6", {}, director, { action: "exception", reason: "x" }, { pnlPending })).toMatchObject({ toStatus: "exception" });
  });

  it("refuses the approval (plain and conditional) with the counts and the worklist link; other gates ignore it", () => {
    const pnlPending = g7PendingCheck(blockers([{ reason: "layer2_mismatch", label: "Lớp 2 không khớp", minutes: 120, entryCount: 1 }, { reason: "missing_contract_item", label: "Chưa có hạng mục", minutes: 60, entryCount: 1 }]));
    for (const action of ["approve", "approve_conditional"] as const) {
      expect(() => plan("G7", submitted, pm, { action, reason: "x", conditionOwnerUserId: "dx", conditionDueAt: "2026-10-20" }, { pnlPending }))
        .toThrow(/Lớp 2 không khớp 1 giờ log \(2 giờ\); Chưa có hạng mục 1 giờ log \(1 giờ\).*\/pnl\/hours\?projectId=prj-1/);
    }
    expect(gateRequirements(PROJECT_GATE_CATALOGUE.G7, state("G7"), facts("G7", { pnlPending }))).toEqual([expect.objectContaining({ waivable: false })]);
    expect(gateRequirements(PROJECT_GATE_CATALOGUE.G6, state("G6"), facts("G6", { pnlPending }))).toEqual([]);
    // The customer step is what passes G7: the same condition holds there.
    expect(() => plan("G7", { status: "awaiting_customer" }, pm, { action: "confirm_customer", customerConfirmedBy: "Chị Lan", customerEvidence: "BBNT đã ký" }, { pnlPending })).toThrow(BadRequestException);
  });

  it("hours waiting only for a cost rate do not block: with no classification problem G7 is approved", () => {
    // A missing cost rate is not a fact of the gate at all — the P&L stays "Tạm tính".
    const pnlPending = g7PendingCheck({ ...blockers([]), waitingCostRateMinutes: 480 });
    expect(plan("G7", submitted, pm, { action: "approve" }, { pnlPending })).toMatchObject({ toStatus: "awaiting_customer" });
  });

  it("reads the closing date from the gate row: customer confirmation, else approval, else exception; nothing before the gate is passed", () => {
    const decidedAt = new Date("2026-10-28T03:00:00.000Z"), customerConfirmedAt = new Date("2026-10-30T03:00:00.000Z"), exceptionAt = new Date("2026-11-01T03:00:00.000Z");
    expect(gatePassedAt({ status: "awaiting_customer", decidedAt })).toBeNull();
    expect(gatePassedAt({ status: "approved", decidedAt, customerConfirmedAt })).toEqual(customerConfirmedAt);
    expect(gatePassedAt({ status: "approved", decidedAt })).toEqual(decidedAt);
    expect(gatePassedAt({ status: "exception", decidedAt, exceptionAt })).toEqual(exceptionAt);
  });
});
