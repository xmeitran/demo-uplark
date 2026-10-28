/**
 * Persistence of the stage gates G1–G8 and of the project status proposal: instantiate, list, act, unlock what
 * comes next, pause the stage SLA during a customer wait, and keep the project status in step (V-17…V-19).
 * The rules are pure and live in gates.ts, stage-sla.ts and status-proposal.ts. ProjectsService delegates here.
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PROJECT_GATE_CATALOGUE,
  PROJECT_GATE_CODES,
  PROJECT_GATE_STATUS_LABELS,
  isProjectGateCode,
  type DecideProjectStatusProposalInput,
  type ProjectGateActionInput,
  type ProjectGateHistoryEntry,
  type ProjectGateListResponse,
  type ProjectGateStatus,
  type ProjectGateSummary,
  type ProjectStageSlaSummary,
  type ProjectStatusProposalSummary
} from "@b2b-crm/contracts";
import { getStoredParameter } from "../../shared/system-parameters";
import { addWorkspaceWorkingDays, loadDayOffKeys } from "../../shared/working-days";
import { allowedGateActions, blockingGateForStage, canGrantGateException, g7PendingCheck, gateDefinition, gateHooks, gateDocumentTicks, gatePassedAt, gateRequirements, isGatePassed, planGateAction, projectGatePosition, runGateHooks, stageBlockedMessage, type GateFacts } from "./gates";
import { countsTowardProjectAtRisk } from "./issue-log";
import { createIssueLogRecord, notifyOwner, type IssueLogContext } from "./issue-log.service";
import { normalizeProjectStatus } from "./project-status";
import { loadStageExtensions, stageExtensionState } from "./stage-extension";
import { customerWaitWorkingDays, stageSlaState } from "./stage-sla";
import { AUTOMATIC_PROJECT_STATUSES, AUTOMATIC_REASON, CONFIRMED_SYSTEM_REASON, CUSTOMER_BLOCKER_REASON, CUSTOMER_WAIT_REASON, isProgressBlockingCustomerBlocker, canDecideStatusProposal, computeProjectStatus, planStatusSync, statusProposalLabel, type ProjectStatusFacts } from "./status-proposal";
import { isCustomerProjectType } from "./task-classification";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "./member-participation";
import { CLOSED_WORK_STATUSES } from "./task-status";

const DAY_MS = 86_400_000;
const OPEN_TASK_STATUSES_EXCLUDED = ["done", "completed", "closed", "cancelled", "canceled"];

/** Who and where a status change is written for; `subjectId` is null when the system acts without a user (scheduler, time log). */
export interface StatusSyncContext {
  prisma: any;
  workspaceId: string;
  actorUserId: string | null;
  /** ProjectsService.recordProjectStatusChange: history row, audit and the NL-02 / NL-03 warnings of a status change. */
  recordStatusChange(tx: any, projectId: string, change: { from?: string; to: string }, reason?: string): Promise<void>;
  now?: Date;
}

export interface GateContext extends IssueLogContext {
  status: StatusSyncContext;
}

// Unit specs mock only the Prisma models they exercise.
function hasModel(client: any, model: string, method = "findMany") {
  return typeof client?.[model]?.[method] === "function";
}

function iso(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

/** Called for every template stage that carries a `gateCode` when a project is created. */
export async function createProjectGate(tx: any, stage: { id: string; workspaceId: string; projectId: string; milestoneId: string }, gateCode: unknown) {
  if (!isProjectGateCode(gateCode) || !hasModel(tx, "projectGate", "create")) return;
  await tx.projectGate.create({
    data: { workspaceId: stage.workspaceId, projectId: stage.projectId, milestoneId: stage.milestoneId, stageId: stage.id, code: gateCode, sortOrder: PROJECT_GATE_CODES.indexOf(gateCode) + 1 }
  });
}

async function orderedStages(client: any, workspaceId: string, projectId: string): Promise<any[]> {
  const stages = await client.projectStage.findMany({
    where: { workspaceId, projectId },
    select: { id: true, activity: true, stageKey: true, status: true, milestoneId: true, sortOrder: true, slaDays: true, slaPausedAt: true, customerWaitDays: true, actualStartAt: true, plannedStartAt: true, actualEndAt: true, changeRequestId: true,
      milestone: { select: { id: true, name: true, sortOrder: true } } }
  });
  // Old data: a stage a change request created before 13/10/2026 (changeRequestId set) stays outside the gate
  // sequence — it never blocks a gate, its open tasks are not counted, and time can still be logged in it.
  return stages.filter((stage: any) => !stage.changeRequestId).sort((left: any, right: any) => (left.milestone?.sortOrder ?? 0) - (right.milestone?.sortOrder ?? 0) || left.sortOrder - right.sortOrder);
}

/**
 * V-11, server side: throws when the stage sits behind a gate that is not approved (or opened by exception).
 * Used when a stage is started and when time is logged in it. A project without gates is never blocked here.
 */
export async function assertStageGateOpen(client: any, workspaceId: string, stageId: string | null | undefined, action: string) {
  if (!stageId || !hasModel(client, "projectGate") || !hasModel(client, "projectStage", "findFirst")) return;
  const stage = await client.projectStage.findFirst({ where: { id: stageId, workspaceId }, select: { projectId: true, project: { select: { milestoneApprovalRequired: true } } } });
  // "Không duyệt": no stage waits for a gate.
  if (!stage || stage.project?.milestoneApprovalRequired === false) return;
  const gates = await client.projectGate.findMany({ where: { workspaceId, projectId: stage.projectId }, select: { stageId: true, code: true, status: true } });
  if (!gates?.length) return;
  const stages = await orderedStages(client, workspaceId, stage.projectId);
  const blocking = blockingGateForStage<{ stageId: string; code: string; status: string }>(stages.map((item) => item.id), gates, stageId);
  if (blocking) throw new ConflictException(stageBlockedMessage(blocking, action));
}

/** True when the project runs on stage gates; its milestone gates are then driven by G1/G4/G7/G8 and not by hand. */
export async function projectUsesStageGates(client: any, workspaceId: string, projectId: string): Promise<boolean> {
  if (!hasModel(client, "projectGate", "count")) return false;
  return (await client.projectGate.count({ where: { workspaceId, projectId } })) > 0;
}

/** Where the project stands against G1 and the P&L closing point (projectGatePosition), read from the database. */
export async function loadProjectGatePosition(client: any, workspaceId: string, projectId: string) {
  const gates: any[] = hasModel(client, "projectGate") ? await client.projectGate.findMany({ where: { workspaceId, projectId }, select: { code: true, status: true } }) : [];
  const milestones: any[] = !gates.length && hasModel(client, "projectMilestone") ? await client.projectMilestone.findMany({ where: { workspaceId, projectId }, select: { sortOrder: true, gateStatus: true } }) : [];
  return projectGatePosition(gates, milestones);
}

async function displayNames(client: any, userIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length || !hasModel(client, "user")) return new Map();
  const users = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  return new Map(users.map((user: { id: string; displayName: string }) => [user.id, user.displayName]));
}

/** G7 data condition (P&L spec 12/10 point 6): asked from the P&L hour gate, so the gate and the worklist never disagree. */
async function loadG7BlockingHours(pendingHours: IssueLogContext["pendingHoursBlockingG7"], workspaceId: string, projectId: string) {
  return g7PendingCheck(pendingHours ? await pendingHours(workspaceId, projectId) : { projectId, blockingMinutes: 0, byReason: [] });
}

interface GateBundle {
  gates: any[];
  stages: any[];
  facts: Map<string, GateFacts & { documents: Array<{ type: string; present: boolean; documentName?: string }> }>;
  dayOffKeys: Set<string>;
}

/** The gate closes its own stage plus the gate-less stages right before it in the same milestone (Intake → G1, Optimize → G8). */
function gateStageIds(gate: any, gates: any[], stages: any[]): string[] {
  const ids: string[] = [];
  for (let index = stages.findIndex((stage) => stage.id === gate.stageId); index >= 0; index -= 1) {
    const stage = stages[index];
    if (stage.milestoneId !== gate.milestoneId || (stage.id !== gate.stageId && gates.some((item) => item.stageId === stage.id))) break;
    ids.push(stage.id);
  }
  return ids;
}

async function loadGateBundle(client: any, workspaceId: string, projectId: string, now: Date, pendingHours?: IssueLogContext["pendingHoursBlockingG7"]): Promise<GateBundle> {
  const gates: any[] = hasModel(client, "projectGate") ? await client.projectGate.findMany({ where: { workspaceId, projectId }, orderBy: { sortOrder: "asc" } }) : [];
  const stages = gates.length ? await orderedStages(client, workspaceId, projectId) : [];
  const facts: GateBundle["facts"] = new Map();
  if (!gates.length) return { gates, stages, facts, dayOffKeys: new Set() };

  const stageIds = stages.map((stage) => stage.id);
  const [artifacts, openTasks, projectRow, pnlRecord, looseIssues] = await Promise.all([
    client.projectArtifact.findMany({
      where: { workspaceId, projectId, milestoneId: { not: null } },
      select: { name: true, artifactType: true, milestoneId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { fileObject: { select: { status: true, scanStatus: true, deletedAt: true, revokedAt: true } } } } }
    }),
    client.projectTask.groupBy({ by: ["stageId"], where: { workspaceId, projectId, archivedAt: null, status: { notIn: OPEN_TASK_STATUSES_EXCLUDED } }, _count: { _all: true } }),
    // G1 (D-22): Giá trị dự án, and the payment ticks, concern Loại Khách hàng projects only.
    hasModel(client, "project", "findFirst") ? client.project.findFirst({ where: { id: projectId, workspaceId }, select: { projectType: true } }) : null,
    hasModel(client, "projectPnlRecord", "findFirst") ? client.projectPnlRecord.findFirst({ where: { workspaceId, projectId }, select: { projectValueAmount: true } }) : null,
    client.projectRisk.count({ where: { workspaceId, projectId, type: { in: ["blocker", "risk", "issue"] }, status: { in: ["pending", "in_progress"] }, OR: [{ ownerUserId: null }, { dueAt: null }] } })
  ]);
  const openTasksByStage = new Map<string, number>(openTasks.map((row: any) => [row.stageId, row._count._all]));
  const documents = artifacts.map((artifact: any) => {
    const file = artifact.versions[0]?.fileObject;
    return { name: artifact.name, artifactType: artifact.artifactType, milestoneId: artifact.milestoneId, usable: Boolean(file && file.status === "active" && file.scanStatus === "clean" && file.deletedAt === null && file.revokedAt === null) };
  });

  const chargeable = !projectRow || isCustomerProjectType(projectRow.projectType);
  const g7 = gates.find((gate) => gate.code === "G7");
  const pnlPending = g7 && !isGatePassed(g7.status) ? await loadG7BlockingHours(pendingHours, workspaceId, projectId) : undefined;

  for (const gate of gates) {
    const definition = gateDefinition(gate.code);
    const openTaskCount = gateStageIds(gate, gates, stages).reduce((sum, stageId) => sum + (openTasksByStage.get(stageId) ?? 0), 0);
    facts.set(gate.id, {
      reachable: blockingGateForStage(stageIds, gates, gate.stageId) === null,
      documents: gateDocumentTicks(definition, documents.filter((document: any) => document.milestoneId === gate.milestoneId)),
      openTaskCount,
      chargeable,
      projectValueReady: !hasModel(client, "projectPnlRecord", "findFirst") || (pnlRecord?.projectValueAmount !== null && pnlRecord?.projectValueAmount !== undefined),
      openIssuesWithoutOwnerOrDue: looseIssues,
      ...(gate.code === "G7" && pnlPending ? { pnlPending } : {})
    });
  }
  const earliest = stages.reduce((min: number, stage) => Math.min(min, new Date(stage.actualStartAt ?? stage.plannedStartAt ?? now).getTime()), now.getTime());
  const dayOffKeys = await loadDayOffKeys(client, workspaceId, new Date(earliest), new Date(now.getTime() + 120 * DAY_MS));
  return { gates, stages, facts, dayOffKeys };
}

function mapStageSlaClock(stage: any, now: Date, dayOffKeys: Set<string>): ProjectStageSlaSummary {
  const startedAt = stage.actualStartAt ?? stage.plannedStartAt ?? null;
  const state = stageSlaState({ slaDays: stage.slaDays, startedAt, finishedAt: stage.actualEndAt, pausedAt: stage.slaPausedAt, customerWaitDays: stage.customerWaitDays }, now, dayOffKeys);
  return {
    stageId: stage.id, stageName: stage.activity, slaDays: state.slaDays, startedAt: iso(startedAt), dueAt: iso(state.dueAt), finishedAt: iso(stage.actualEndAt),
    paused: state.paused, customerWaitDays: state.customerWaitDays, overrun: state.overrun, overrunDays: state.overrunDays
  };
}

export async function listProjectGates(ctx: IssueLogContext, project: { id: string; milestoneApprovalRequired?: boolean }): Promise<ProjectGateListResponse> {
  const now = ctx.now ?? new Date();
  const approvalRequired = project.milestoneApprovalRequired !== false;
  const workspaceId = ctx.principal.workspaceId;
  const bundle = await loadGateBundle(ctx.prisma, workspaceId, project.id, now, ctx.pendingHoursBlockingG7);
  const names = await displayNames(ctx.prisma, bundle.gates.flatMap((gate) => [gate.submittedByUserId, gate.decidedByUserId, gate.paymentConfirmedByUserId, gate.customerRecordedByUserId, gate.exceptionByUserId]));
  const issueIds = bundle.gates.map((gate) => gate.conditionIssueId).filter(Boolean);
  const issues: Array<{ id: string; code: string }> = issueIds.length ? await ctx.prisma.projectRisk.findMany({ where: { id: { in: issueIds } }, select: { id: true, code: true } }) : [];
  const stageById = new Map(bundle.stages.map((stage) => [stage.id, stage]));
  // TD-04 / TD-05: approved extensions of each stage; an extension still ahead of today is not an overrun.
  const extensionRows = bundle.stages.length ? await loadStageExtensions(ctx.prisma, workspaceId, [project.id]) : [];
  const extensionThreshold = extensionRows.length ? await getStoredParameter(ctx.prisma, workspaceId, "stageExtensionAbnormalCount") : 0;
  const mapStageSla = (stage: any, at: Date, dayOffKeys: Set<string>): ProjectStageSlaSummary => {
    const sla = mapStageSlaClock(stage, at, dayOffKeys);
    const extension = stageExtensionState(extensionRows.filter((row) => row.stageId === stage.id), extensionThreshold);
    const covered = Boolean(extension.extendedDueAt) && at.getTime() <= new Date(extension.extendedDueAt as string).getTime();
    return { ...sla, ...(covered ? { overrun: false, overrunDays: 0 } : {}), ...extension, canExtend: ctx.actor.isPm && !stage.actualEndAt };
  };

  const data = bundle.gates.map((gate): ProjectGateSummary => {
    const definition = gateDefinition(gate.code);
    const facts = bundle.facts.get(gate.id) as GateFacts & { documents: ProjectGateSummary["documents"] };
    const stage = stageById.get(gate.stageId);
    const passed = isGatePassed(gate.status);
    return {
      id: gate.id, code: gate.code, definition, projectId: gate.projectId, milestoneId: gate.milestoneId, milestoneName: stage?.milestone?.name ?? "", stageId: gate.stageId, stageName: stage?.activity ?? "",
      status: gate.status, statusLabel: PROJECT_GATE_STATUS_LABELS[gate.status as ProjectGateStatus] ?? gate.status,
      reachable: facts.reachable, documents: facts.documents, openTaskCount: facts.openTaskCount,
      // "Không duyệt": the open tasks are the only thing a gate waits for.
      missingRequirements: passed ? [] : !approvalRequired ? (facts.openTaskCount ? [`Còn ${facts.openTaskCount} task của stage chưa hoàn thành.`] : []) : gateRequirements(definition, gate, facts).map((item) => item.text),
      submittedAt: iso(gate.submittedAt), submittedByUserId: gate.submittedByUserId ?? undefined, submittedByName: names.get(gate.submittedByUserId),
      decision: gate.decision ?? undefined, decidedAt: iso(gate.decidedAt), decidedByUserId: gate.decidedByUserId ?? undefined, decidedByName: names.get(gate.decidedByUserId), decisionReason: gate.decisionReason ?? undefined,
      conditionIssueId: gate.conditionIssueId ?? undefined, conditionIssueCode: issues.find((issue) => issue.id === gate.conditionIssueId)?.code,
      paymentConfirmationRequired: definition.paymentConfirmation && facts.chargeable,
      paymentConfirmedAt: iso(gate.paymentConfirmedAt), paymentConfirmedByName: names.get(gate.paymentConfirmedByUserId), paymentNote: gate.paymentNote ?? undefined,
      customerRequestedAt: iso(gate.customerRequestedAt), customerDueAt: iso(gate.customerDueAt),
      customerOverdue: gate.status === "awaiting_customer" && Boolean(gate.customerDueAt) && new Date(gate.customerDueAt).getTime() < now.getTime(),
      customerConfirmedAt: iso(gate.customerConfirmedAt), customerConfirmedBy: gate.customerConfirmedBy ?? undefined, customerEvidence: gate.customerEvidence ?? undefined, customerRecordedByName: names.get(gate.customerRecordedByUserId),
      exceptionAt: iso(gate.exceptionAt), exceptionByName: names.get(gate.exceptionByUserId), exceptionReason: gate.exceptionReason ?? undefined,
      goLiveDate: gate.goLiveDate ? new Date(gate.goLiveDate).toISOString().slice(0, 10) : undefined,
      passedAt: iso(gatePassedAt(gate)),
      pnlPendingCheck: facts.pnlPending,
      sla: stage ? mapStageSla(stage, now, bundle.dayOffKeys) : undefined,
      allowedActions: approvalRequired ? allowedGateActions(definition, gate, facts, ctx.actor) : [],
      history: Array.isArray(gate.history) ? (gate.history as ProjectGateHistoryEntry[]) : []
    };
  });
  return {
    projectId: project.id,
    usesStageGates: data.length > 0,
    data,
    stageSla: bundle.stages.filter((stage) => stage.slaDays !== null && stage.slaDays !== undefined).map((stage) => mapStageSla(stage, now, bundle.dayOffKeys)),
    canException: approvalRequired && canGrantGateException(ctx.actor),
    milestoneApprovalRequired: approvalRequired
  };
}

/** A passed gate closes its stage and, when it closes the milestone, approves it and opens the next one (the columns the existing milestone lock reads). */
async function openWhatComesNext(tx: any, gate: any, actorUserId: string, now: Date) {
  const stage = await tx.projectStage.findFirst({ where: { id: gate.stageId }, select: { actualEndAt: true } });
  await tx.projectStage.update({ where: { id: gate.stageId }, data: { status: "completed", actualEndAt: stage?.actualEndAt ?? now } });
  if (!PROJECT_GATE_CATALOGUE[gate.code as keyof typeof PROJECT_GATE_CATALOGUE]?.closesMilestone) return;
  const milestone = await tx.projectMilestone.findFirst({ where: { id: gate.milestoneId } });
  if (!milestone) return;
  await tx.projectMilestone.update({ where: { id: milestone.id }, data: { gateStatus: "approved", reviewerApprovedAt: now, reviewerApprovedByUserId: actorUserId } });
  const next = await tx.projectMilestone.findFirst({ where: { projectId: gate.projectId, workspaceId: gate.workspaceId, sortOrder: { gt: milestone.sortOrder } }, orderBy: { sortOrder: "asc" } });
  if (next?.gateStatus === "locked") await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "open" } });
}

/**
 * "Không duyệt" (Project.milestoneApprovalRequired = false): no submission, review, payment tick or customer wait. Gates pass
 * by themselves, in order, once the stages they close have tasks and none is open; a pass does what an approval does
 * (next milestone, G1 baseline). A passed gate stays passed, as an approved one does. The caller re-syncs the project status.
 */
export async function autoPassStageGates(tx: any, workspaceId: string, projectId: string, actorUserId: string, now: Date) {
  const gates: any[] = await tx.projectGate.findMany({ where: { workspaceId, projectId }, orderBy: { sortOrder: "asc" } });
  if (!gates.length) return;
  const stages = await orderedStages(tx, workspaceId, projectId);
  const tasks: any[] = await tx.projectTask.findMany({ where: { workspaceId, projectId, archivedAt: null }, select: { stageId: true, status: true } });
  for (const gate of gates) {
    if (isGatePassed(gate.status)) continue;
    const stageIds = gateStageIds(gate, gates, stages);
    const stageTasks = tasks.filter((task) => stageIds.includes(task.stageId));
    if (!stageTasks.length || stageTasks.some((task) => !OPEN_TASK_STATUSES_EXCLUDED.includes(task.status))) return;
    const entry: ProjectGateHistoryEntry = { at: now.toISOString(), action: "approve", label: "Tự qua", byUserId: actorUserId, byName: null, fromStatus: gate.status, toStatus: "approved", note: "Dự án không duyệt milestone: stage đã hết task" };
    const updated = await tx.projectGate.update({
      where: { id: gate.id },
      data: { status: "approved", decision: "approved", decidedAt: now, decidedByUserId: actorUserId, history: [...(Array.isArray(gate.history) ? gate.history : []), entry] }
    });
    await openWhatComesNext(tx, gate, actorUserId, now);
    await gateHooks.captureBaseline?.(Object.assign({ tx, actor: { userId: actorUserId } }, { gate: updated, project: { id: projectId } }));
    // ponytail: the after-commit hooks (closeProjectPnl, pushDocumentsToWiki) are still empty TODOs; run them here too once they do something.
  }
}

export async function actOnProjectGate(ctx: GateContext, project: { id: string; accountId: string }, gateId: string, input: ProjectGateActionInput): Promise<ProjectGateListResponse> {
  const now = ctx.now ?? new Date();
  const { principal } = ctx;
  const workspaceId = principal.workspaceId;
  let hookInput: { gate: any; project: any; plan?: any } | undefined;
  let conditionIssue: any;

  await ctx.prisma.$transaction(async (tx: any) => {
    // Two people deciding at once must each see the other's result.
    await tx.$queryRaw`SELECT "id" FROM "ProjectGate" WHERE "id" = ${gateId} FOR UPDATE`;
    const bundle = await loadGateBundle(tx, workspaceId, project.id, now, ctx.pendingHoursBlockingG7);
    const gate = bundle.gates.find((item) => item.id === gateId);
    if (!gate) throw new NotFoundException("Không tìm thấy điểm chốt.");
    const definition = gateDefinition(gate.code);
    const plan = planGateAction(definition, gate, bundle.facts.get(gate.id) as GateFacts, { ...ctx.actor, displayName: principal.displayName }, input ?? ({} as ProjectGateActionInput), now);
    const patch: Record<string, unknown> = { ...plan.patch };
    const stage = bundle.stages.find((item) => item.id === gate.stageId);

    if (plan.conditionIssue) {
      // V-13: the outstanding part is an Issue with an owner and a due date, created through the issue log so it gets its code, history and warnings.
      const issue = await createIssueLogRecord({ ...ctx, now }, project, {
        type: "issue", description: plan.conditionIssue.description, severity: "medium", ownerUserId: plan.conditionIssue.ownerUserId, dueAt: plan.conditionIssue.dueAt,
        milestoneId: gate.milestoneId, stageId: gate.stageId, extension: { actualImpact: String(input.reason ?? "").trim() }
      } as any, { tx });
      patch.conditionIssueId = issue.id;
      conditionIssue = issue;
    }
    if (plan.customerWait === true) {
      // V-14: the customer's response deadline in working days; V-19: the stage clock stops now.
      const days = await getStoredParameter(tx, workspaceId, definition.customerResponseParameter);
      Object.assign(patch, { customerRequestedAt: now, customerDueAt: await addWorkspaceWorkingDays(tx, workspaceId, now, days), customerReminderCount: 0, customerConfirmedAt: null, customerConfirmedBy: null, customerEvidence: null, customerRecordedByUserId: null });
      await tx.projectStage.update({ where: { id: gate.stageId }, data: { slaPausedAt: now } });
    }
    if (plan.customerWait === false && stage?.slaPausedAt) {
      await tx.projectStage.update({ where: { id: gate.stageId }, data: { slaPausedAt: null, customerWaitDays: { increment: customerWaitWorkingDays(stage.slaPausedAt, now, bundle.dayOffKeys) } } });
    }

    const history = [...(Array.isArray(gate.history) ? gate.history : []), plan.history];
    const updated = await tx.projectGate.update({ where: { id: gate.id }, data: { ...patch, history } });
    if (plan.passed) await openWhatComesNext(tx, gate, principal.subjectId, now);
    // G1: the plan baseline is locked on approval — in this transaction, so the gate never passes without its baseline (baseline.service.ts).
    if (plan.passed) await gateHooks.captureBaseline?.(Object.assign({ tx, actor: { userId: principal.subjectId, displayName: principal.displayName } }, { gate: updated, project, plan }));
    await tx.auditEvent.create({
      data: { workspaceId, actorUserId: principal.subjectId, action: `project.gate_${input.action}`, resource: "project_gate", resourceId: gate.id,
        before: { status: gate.status }, after: JSON.parse(JSON.stringify({ code: gate.code, status: updated.status, ...plan.history })), requestId: randomUUID() }
    });
    await syncProjectStatus({ ...ctx.status, now }, tx, project.id);
    hookInput = { gate: updated, project, plan };
  });

  // Created inside the gate transaction, so its owner is told only now that it is committed.
  if (conditionIssue) await notifyOwner(ctx, project, conditionIssue, "created");
  if (hookInput) {
    const { plan, gate } = hookInput;
    const hooks = [
      ...(input.action === "submit" ? ["notifyApprovers"] : []),
      ...(plan.customerWait === true ? ["sendCustomerConfirmationRequest"] : []),
      ...(plan.passed ? ["pushDocumentsToWiki"] : []),
      // "Passed" has one meaning (isGatePassed): approved or opened by exception — both close the project P&L.
      ...(plan.passed && gate.code === "G7" ? ["closeProjectPnl"] : []),
      ...(gate.code === "G8" && input.action === "approve" ? ["checkGoLiveChecklist"] : [])
    ];
    await runGateHooks(hooks, hookInput);
  }
  return listProjectGates(ctx, project);
}

// ---------------------------------------------------------------------------
// Project status: proposal and automatic transitions (5.1, V-17…V-19)
// ---------------------------------------------------------------------------

async function loadStatusFacts(client: any, workspaceId: string, project: { id: string; status: string }, now: Date): Promise<ProjectStatusFacts> {
  const gates: any[] = hasModel(client, "projectGate") ? await client.projectGate.findMany({ where: { workspaceId, projectId: project.id }, select: { code: true, status: true, stageId: true } }) : [];
  const hasTimeLog = async (code: string) => {
    const stageId = gates.find((gate) => gate.code === code)?.stageId;
    if (!stageId || !hasModel(client, "taskTimeEntry", "findFirst")) return false;
    return Boolean(await client.taskTimeEntry.findFirst({ where: { workspaceId, projectId: project.id, task: { stageId }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } }, select: { id: true } }));
  };
  // "Quá hạn": the due day has passed (Vietnam time) and the task is still open.
  const startOfToday = new Date(Math.floor((now.getTime() + 7 * 3_600_000) / DAY_MS) * DAY_MS - 7 * 3_600_000);
  const [issues, overdueTaskCount, highDelayWarningCount, lastHold, pilotHasTimeLog, onboardHasTimeLog] = await Promise.all([
    hasModel(client, "projectRisk") ? client.projectRisk.findMany({ where: { workspaceId, projectId: project.id, type: { in: ["blocker", "risk", "issue"] } }, select: { code: true, type: true, status: true, extension: true }, orderBy: { createdAt: "asc" } }) : [],
    hasModel(client, "projectTask", "count") ? client.projectTask.count({ where: { workspaceId, projectId: project.id, archivedAt: null, dueAt: { lt: startOfToday }, status: { notIn: CLOSED_WORK_STATUSES } } }) : 0,
    // The delay triggers (TD-xx) belong to the scheduler scan; once it opens them at severity high they count here.
    hasModel(client, "projectWarning", "count") ? client.projectWarning.count({ where: { workspaceId, projectId: project.id, status: "open", severity: "high", typeCode: { startsWith: "TD-" } } }) : 0,
    normalizeProjectStatus(project.status) === "on_hold" && hasModel(client, "projectStatusHistory", "findFirst")
      ? client.projectStatusHistory.findFirst({ where: { projectId: project.id, toStatus: "on_hold" }, orderBy: { changedAt: "desc" }, select: { reason: true, changedAt: true } })
      : null,
    hasTimeLog("G5"),
    hasTimeLog("G6")
  ]);
  // No G1–G8: the project's own milestones give its position.
  let milestones: ProjectStatusFacts["milestones"] = null;
  if (!gates.length && hasModel(client, "projectMilestone")) {
    const rows: any[] = await client.projectMilestone.findMany({ where: { workspaceId, projectId: project.id }, select: { gateStatus: true } });
    const started = rows.length > 0 && Boolean(
      (hasModel(client, "projectStage", "findFirst") && await client.projectStage.findFirst({ where: { workspaceId, projectId: project.id, status: { not: "not_started" } }, select: { id: true } }))
      || (hasModel(client, "taskTimeEntry", "findFirst") && await client.taskTimeEntry.findFirst({ where: { workspaceId, projectId: project.id, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } }, select: { id: true } }))
    );
    milestones = { total: rows.length, approved: rows.filter((row) => row.gateStatus === "approved").length, started };
  }
  return {
    currentStatus: project.status,
    gates: gates.length ? gates : null,
    milestones,
    pilotHasTimeLog,
    onboardHasTimeLog,
    openIssueCodes: (issues as any[]).filter(countsTowardProjectAtRisk).map((issue) => issue.code),
    customerBlockerCodes: (issues as any[]).filter((issue) => countsTowardProjectAtRisk(issue) && isProgressBlockingCustomerBlocker(issue)).map((issue) => issue.code),
    overdueTaskCount,
    highDelayWarningCount,
    holdIsCustomerWait: isCustomerHold(lastHold?.reason) || await holdConfirmedFromCustomerProposal(client, project.id, lastHold)
  };
}

const isCustomerHold = (text: unknown) => [CUSTOMER_WAIT_REASON, CUSTOMER_BLOCKER_REASON].some((prefix) => String(text ?? "").startsWith(prefix));

/**
 * The marker of a customer-wait hold that survives a retyped reason: the confirmed proposal the hold came from, whose
 * basis the system wrote. ponytail: the proposal is matched to the history row by time (same request, ±2 minutes);
 * add a proposalId column on ProjectStatusHistory if that ever proves too loose.
 */
async function holdConfirmedFromCustomerProposal(client: any, projectId: string, lastHold: { changedAt?: Date | string | null } | null | undefined): Promise<boolean> {
  if (!lastHold?.changedAt || !hasModel(client, "projectStatusProposal")) return false;
  const at = new Date(lastHold.changedAt).getTime();
  const confirmed: Array<{ basis: string }> = await client.projectStatusProposal.findMany({
    where: { projectId, status: "confirmed", proposedStatus: "on_hold", decidedAt: { gte: new Date(at - 120_000), lte: new Date(at + 120_000) } }, select: { basis: true }
  });
  return (confirmed ?? []).some((proposal) => isCustomerHold(proposal.basis));
}

/**
 * Recomputes the status the rules imply and brings the project in line: applies the automatic transitions
 * (Đã hoàn thành, Đang bảo trì) with a history row and keeps at most one pending proposal for the rest.
 * `client` may be a transaction; nothing happens for a closed project or when the proposal table is not there.
 */
export async function syncProjectStatus(ctx: StatusSyncContext, client: any, projectId: string): Promise<void> {
  if (!hasModel(client, "projectStatusProposal", "findFirst")) return;
  const now = ctx.now ?? new Date();
  // One writer per project: two requests would otherwise both find no pending proposal and both create one (partial unique index).
  if (typeof client.$queryRaw === "function") await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-status:${projectId}`}, 0))::text`;
  const project = await client.project.findFirst({ where: { id: projectId, workspaceId: ctx.workspaceId }, select: { id: true, status: true } });
  if (!project) return;
  const facts = await loadStatusFacts(client, ctx.workspaceId, project, now);
  const lastProposal = await client.projectStatusProposal.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
  // ponytail: only the latest row is consulted, so a declined proposal stays quiet until its reason changes (counts aside, planStatusSync).
  const currentCode = normalizeProjectStatus(project.status);
  const lastEntry = currentCode && (AUTOMATIC_PROJECT_STATUSES as readonly string[]).includes(currentCode) && hasModel(client, "projectStatusHistory", "findFirst")
    ? await client.projectStatusHistory.findFirst({ where: { projectId, toStatus: currentCode }, orderBy: { changedAt: "desc" }, select: { reason: true } })
    : null;
  const setBySystem = [AUTOMATIC_REASON, CONFIRMED_SYSTEM_REASON].some((prefix) => String(lastEntry?.reason ?? "").startsWith(prefix));
  const plan = planStatusSync(project.status, computeProjectStatus(facts), lastProposal?.status === "declined" ? lastProposal : null, setBySystem);

  let current = normalizeProjectStatus(project.status) ?? project.status;
  for (const step of plan.apply) {
    await client.project.update({ where: { id: projectId }, data: { status: step.to } });
    await ctx.recordStatusChange(client, projectId, { from: current, to: step.to }, step.reason);
    current = step.to;
  }
  const pending = lastProposal?.status === "pending" ? lastProposal : await client.projectStatusProposal.findFirst({ where: { projectId, status: "pending" } });
  if (pending && plan.propose && pending.proposedStatus === plan.propose.proposedStatus && pending.basis === plan.propose.basis) return;
  if (pending) await client.projectStatusProposal.update({ where: { id: pending.id }, data: { status: "superseded", decidedAt: now } });
  if (plan.propose) {
    await client.projectStatusProposal.create({
      data: { workspaceId: ctx.workspaceId, projectId, fromStatus: current, proposedStatus: plan.propose.proposedStatus, basis: plan.propose.basis, suggestedReason: plan.propose.suggestedReason ?? null, createdAt: now }
    });
  }
}

export function mapStatusProposal(row: any, actor: { isPm: boolean; isAdmin: boolean }, names: Map<string, string> = new Map()): ProjectStatusProposalSummary {
  return {
    id: row.id, projectId: row.projectId, fromStatus: row.fromStatus, proposedStatus: row.proposedStatus, proposedStatusLabel: statusProposalLabel(row.proposedStatus),
    basis: row.basis, suggestedReason: row.suggestedReason ?? undefined, status: row.status, createdAt: new Date(row.createdAt).toISOString(),
    decidedAt: iso(row.decidedAt), decidedByName: names.get(row.decidedByUserId), declineReason: row.declineReason ?? undefined,
    canDecide: row.status === "pending" && canDecideStatusProposal(actor)
  };
}

export async function pendingStatusProposal(client: any, workspaceId: string, projectId: string, actor: { isPm: boolean; isAdmin: boolean }): Promise<ProjectStatusProposalSummary | undefined> {
  if (!hasModel(client, "projectStatusProposal", "findFirst")) return undefined;
  const row = await client.projectStatusProposal.findFirst({ where: { workspaceId, projectId, status: "pending" } });
  return row ? mapStatusProposal(row, actor) : undefined;
}

/** For the Projects list marker. */
export async function projectIdsWithPendingProposal(client: any, workspaceId: string, projectIds: string[]): Promise<Set<string>> {
  if (!projectIds.length || !hasModel(client, "projectStatusProposal")) return new Set();
  const rows = await client.projectStatusProposal.findMany({ where: { workspaceId, projectId: { in: projectIds }, status: "pending" }, select: { projectId: true } });
  return new Set(rows.map((row: { projectId: string }) => row.projectId));
}

/**
 * Confirm or decline a pending proposal. Confirming goes through `applyStatus` — the ordinary project update — so
 * the reason rules of V-18 and its permissions still hold; declining needs a reason.
 */
export async function decideStatusProposal(
  ctx: { prisma: any; principal: { workspaceId: string; subjectId: string }; actor: { isPm: boolean; isAdmin: boolean }; now?: Date },
  projectId: string,
  proposalId: string,
  input: DecideProjectStatusProposalInput,
  applyStatus: (status: string, reason: string | undefined) => Promise<unknown>
): Promise<ProjectStatusProposalSummary> {
  const now = ctx.now ?? new Date();
  const proposal = await ctx.prisma.projectStatusProposal.findFirst({ where: { id: proposalId, projectId, workspaceId: ctx.principal.workspaceId } });
  if (!proposal) throw new NotFoundException("Không tìm thấy đề xuất trạng thái.");
  if (proposal.status !== "pending") throw new ConflictException("Đề xuất này đã được xử lý hoặc đã được thay bằng đề xuất mới.");
  if (!canDecideStatusProposal(ctx.actor)) throw new ForbiddenException("Chỉ PIC dự án hoặc PM/Leader (Admin) mới được xác nhận hay từ chối đề xuất trạng thái.");
  const reason = String(input?.reason ?? "").trim();
  // Each decision claims the row only while it is still pending, so a confirm and a decline sent together cannot both land.
  const claim = async (data: Record<string, unknown>) => {
    const claimed = await ctx.prisma.projectStatusProposal.updateMany({ where: { id: proposal.id, status: "pending" }, data });
    if (claimed.count === 0) throw new ConflictException("Đề xuất này đã được xử lý hoặc đã được thay bằng đề xuất mới.");
  };
  if (input?.decision === "decline") {
    if (!reason) throw new BadRequestException("Từ chối đề xuất trạng thái bắt buộc ghi lý do.");
    await claim({ status: "declined", decidedAt: now, decidedByUserId: ctx.principal.subjectId, declineReason: reason });
    return mapStatusProposal(await ctx.prisma.projectStatusProposal.findFirst({ where: { id: proposal.id } }), ctx.actor);
  }
  if (input?.decision !== "confirm") throw new BadRequestException("decision phải là confirm hoặc decline.");
  await claim({ status: "confirmed", decidedAt: now, decidedByUserId: ctx.principal.subjectId });
  try {
    // A confirmed Đã hoàn thành / Đang bảo trì still rests on the system's rule, so the sync may take it back later (CONFIRMED_SYSTEM_REASON).
    const systemOwned = (AUTOMATIC_PROJECT_STATUSES as readonly string[]).includes(proposal.proposedStatus);
    await applyStatus(proposal.proposedStatus, systemOwned ? `${CONFIRMED_SYSTEM_REASON}: ${proposal.basis}${reason ? ` — ${reason}` : ""}` : reason || proposal.suggestedReason || undefined);
  } catch (error) {
    // The status change was refused: the proposal is still waiting for a decision.
    await ctx.prisma.projectStatusProposal.update({ where: { id: proposal.id }, data: { status: "pending", decidedAt: null, decidedByUserId: null } });
    throw error;
  }
  // The update above already recomputed and retired the pending row; whatever it wrote, this proposal was confirmed.
  return mapStatusProposal(await ctx.prisma.projectStatusProposal.update({ where: { id: proposal.id }, data: { status: "confirmed", decidedAt: now, decidedByUserId: ctx.principal.subjectId } }), ctx.actor);
}
