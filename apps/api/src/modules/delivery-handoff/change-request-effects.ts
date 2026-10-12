/**
 * Side effects of the change-request flow (V-26, V-30, V-39, V-40, 8.2), registered into `issueLogHooks`.
 * They run after the record's own transaction committed and never fail the request (issue-log.service runHooks).
 *
 *  CR-02 → CR-03  onChangeRequestClassified         stage "Change Request – {mã}" in the running milestone with the task
 *                                                   "Đánh giá yêu cầu thay đổi" (Lớp 1 PM, hạng mục gốc)                    V-39
 *  CR-07 → CR-07C onChangeRequestApproved           line item "Yêu cầu thay đổi" (estimate gốc = effort of CR-03) + baseline   V-30
 *  CR-08B → 08C   onChangeRequestBaselineUpdate     next baseline version with the implementation tasks                        V-30
 *  CR-08C → CR-09 computeChangeRequestActualEffort  actual effort = logged hours of the request's line item / standard day     V-30
 *  Từ chối / Hoãn / Huỷ  onChangeRequestStageClosed the stage closes; assessment hours stay on the root line item              V-39
 *  Không phải CR  onNotChangeRequestAsTask          "trong phạm vi": an ordinary task where the record was reported            V-26
 */
import { ConflictException } from "@nestjs/common";
import type { ChangeRequestLinks, ProjectRiskSummary } from "@b2b-crm/contracts";
import { getStoredParameter } from "../../shared/system-parameters";
import { recordBaselineChange } from "./baseline.service";
import { defaultContractItemId } from "./contract-item";
import { readExtension } from "./issue-log";
import { issueLogHooks, type IssueLogContext } from "./issue-log.service";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "./member-participation";
import { deriveTaskTypeLayer2 } from "./task-classification";
import { CLOSED_WORK_STATUSES } from "./task-status";

export const CR_EVALUATION_TASK_TITLE = "Đánh giá yêu cầu thay đổi";
export const CR_EVALUATION_TASK_TYPE = "cr_evaluation";
/** D-23 / V-29: the request has the customer's approval on file — from CR-07C until it closes. */
const APPROVED_STATUSES = ["approved", "implementing"];

type HookInput = { ctx: IssueLogContext; record: any; project: any };

export const changeRequestStageName = (code: string) => `Change Request – ${code}`;

/** D-23: a line item of kind "Yêu cầu thay đổi" needs a change request that reached Đã duyệt (CR-07C) and is not closed, rejected or deferred. */
export function isApprovedChangeRequest(record: { type?: string | null; status?: string | null } | null | undefined): boolean {
  return record?.type === "change_request" && APPROVED_STATUSES.includes(String(record.status));
}

/** "Milestone đang chạy": the first one that is neither approved nor still locked; else the last one that is open. */
export function runningMilestone<T extends { sortOrder: number; gateStatus?: string | null }>(milestones: readonly T[]): T | undefined {
  const ordered = [...milestones].sort((left, right) => left.sortOrder - right.sortOrder);
  return ordered.find((milestone) => milestone.gateStatus !== "approved" && milestone.gateStatus !== "locked")
    ?? [...ordered].reverse().find((milestone) => milestone.gateStatus !== "locked")
    ?? ordered[0];
}

/** V-30: "giờ chia 8" — minutes over the standard day, two decimals. */
export function effortMd(minutes: number, standardDayMinutes: number): number {
  return standardDayMinutes > 0 ? Math.round((minutes / standardDayMinutes) * 100) / 100 : 0;
}

async function dayMinutes(client: any, workspaceId: string) {
  return Math.round((await getStoredParameter(client, workspaceId, "standardDayHours")) * 60);
}

async function note(ctx: IssueLogContext, record: any, action: string, label: string, text?: string) {
  await ctx.prisma.projectRiskEvent.create({
    data: { riskId: record.id, action, fromStatus: record.status, toStatus: record.status, fromStep: record.crStep, toStep: record.crStep, note: text, changes: { label }, actorUserId: null, actorName: "Hệ thống", at: ctx.now ?? new Date() }
  });
}

async function mergeExtension(client: any, recordId: string, patch: Record<string, string | number | null>) {
  const current = await client.projectRisk.findFirst({ where: { id: recordId }, select: { extension: true } });
  await client.projectRisk.update({ where: { id: recordId }, data: { extension: { ...readExtension({ type: "change_request", status: "", extension: current?.extension }), ...patch } } });
}

async function rootContractItem(client: any, workspaceId: string, projectId: string) {
  const items = await client.projectContractItem.findMany({ where: { workspaceId, projectId, status: "active" }, select: { id: true, kind: true, sortOrder: true, contractType: true } });
  const id = defaultContractItemId(items);
  return items.find((item: any) => item.id === id) ?? null;
}

async function createTaskIn(client: any, ctx: IssueLogContext, project: any, stage: any, data: { title: string; taskType: string; contractItem: any; ownerUserId: string | null; description?: string }) {
  const last = await client.projectTask.findFirst({ where: { projectId: project.id, stageId: stage.id, parentTaskId: null, archivedAt: null }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return client.projectTask.create({
    data: {
      accountId: project.accountId, workspaceId: ctx.principal.workspaceId, projectId: project.id, stageId: stage.id, title: data.title, description: data.description, taskType: data.taskType,
      taskTypeLayer1: stage.taskTypeLayer1 ?? null,
      taskTypeLayer2: deriveTaskTypeLayer2({ projectType: project.projectType, afterPnlClose: stage.afterPnlClose, contractType: data.contractItem?.contractType }),
      contractItemId: data.contractItem?.id ?? null, status: "todo", priority: "medium", ownerUserId: data.ownerUserId, assigneeUserId: data.ownerUserId,
      estimateMinutes: 0, sortOrder: (last?.sortOrder ?? 0) + 10, createdByUserId: ctx.principal.subjectId
    }
  });
}

async function closeStage(ctx: IssueLogContext, record: any) {
  const now = ctx.now ?? new Date();
  const stage = await ctx.prisma.projectStage.findFirst({ where: { changeRequestId: record.id } });
  if (!stage || CLOSED_WORK_STATUSES.includes(stage.status)) return;
  await ctx.prisma.$transaction(async (tx: any) => {
    // A closed stage keeps no open work; the hours already logged stay where they are (root line item for the assessment).
    await tx.projectTask.updateMany({ where: { stageId: stage.id, archivedAt: null, status: { notIn: CLOSED_WORK_STATUSES } }, data: { status: "done", completedAt: now } });
    await tx.projectStage.update({ where: { id: stage.id }, data: { status: "completed", actualEndAt: now, progressPercent: 100 } });
  });
}

Object.assign(issueLogHooks, {
  async onChangeRequestClassified({ ctx, record, project }: HookInput) {
    const now = ctx.now ?? new Date();
    const workspaceId = ctx.principal.workspaceId;
    const created = await ctx.prisma.$transaction(async (tx: any) => {
      if (await tx.projectStage.findFirst({ where: { changeRequestId: record.id }, select: { id: true } })) return false;
      const milestone = runningMilestone<{ id: string; name: string; sortOrder: number; gateStatus?: string | null }>(await tx.projectMilestone.findMany({ where: { workspaceId, projectId: project.id }, select: { id: true, name: true, sortOrder: true, gateStatus: true } }));
      if (!milestone) return false;
      const last = await tx.projectStage.findFirst({ where: { projectId: project.id, milestoneId: milestone.id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true, afterPnlClose: true } });
      const stage = await tx.projectStage.create({
        data: {
          accountId: project.accountId, workspaceId, projectId: project.id, milestoneId: milestone.id, stageKey: `cr-${String(record.code).toLowerCase()}-${record.id}`.slice(0, 64), phase: milestone.name,
          activity: changeRequestStageName(record.code), sortOrder: (last?.sortOrder ?? 0) + 10, cumulativePercent: 0, activityPercent: 0,
          criteria: "Yêu cầu thay đổi được đóng (CR-09), hoặc khách Từ chối / Hoãn", description: record.description, status: "in_progress", actualStartAt: now,
          ownerUserId: ctx.principal.subjectId, taskTypeLayer1: "PM", afterPnlClose: last?.afterPnlClose ?? null, changeRequestId: record.id
        }
      });
      const task = await createTaskIn(tx, ctx, project, stage, { title: CR_EVALUATION_TASK_TITLE, taskType: CR_EVALUATION_TASK_TYPE, contractItem: await rootContractItem(tx, workspaceId, project.id), ownerUserId: ctx.principal.subjectId, description: `Ghi giờ các bước CR-02 đến CR-07 của ${record.code}.` });
      await tx.projectTaskAssignee?.createMany?.({ data: [{ workspaceId, taskId: task.id, userId: ctx.principal.subjectId, isPrimary: true }], skipDuplicates: true });
      await tx.project.update({ where: { id: project.id }, data: { hierarchyOrderVersion: { increment: 1 } } });
      return true;
    });
    if (created) await note(ctx, record, "cr_stage_created", "Hệ thống tạo stage của yêu cầu", `Stage "${changeRequestStageName(record.code)}" với task "${CR_EVALUATION_TASK_TITLE}" (Lớp 1 PM, hạng mục gốc).`);
  },

  async onChangeRequestApproved({ ctx, record, project }: HookInput) {
    const workspaceId = ctx.principal.workspaceId;
    const actor = { userId: ctx.principal.subjectId, displayName: ctx.principal.displayName };
    const result = await ctx.prisma.$transaction(async (tx: any) => {
      let item = await tx.projectContractItem.findFirst({ where: { projectId: project.id, changeRequestId: record.id } });
      if (!item) {
        const existing = await tx.projectContractItem.findMany({ where: { projectId: project.id }, select: { code: true, sortOrder: true } });
        const code = existing.some((row: any) => row.code.toLowerCase() === String(record.code).toLowerCase()) ? `${record.code}-${existing.length + 1}` : record.code;
        const effort = Number(readExtension(record).estimatedEffortMd);
        item = await tx.projectContractItem.create({
          data: {
            workspaceId, projectId: project.id, code, name: `Yêu cầu thay đổi ${record.code}: ${String(record.description).slice(0, 120)}`, kind: "CHANGE_REQUEST", changeRequestId: record.id,
            // V-30: "Effort dự kiến ở CR-03 thành estimate gốc của hạng mục". Type and value stay "Chờ phân loại" for the PM.
            estimateMinutes: Number.isFinite(effort) && effort > 0 ? Math.round(effort * (await dayMinutes(tx, workspaceId))) : null,
            sortOrder: Math.max(0, ...existing.map((row: any) => row.sortOrder)) + 10, createdByUserId: ctx.principal.subjectId
          }
        });
        await tx.auditEvent?.create({ data: { workspaceId, actorUserId: ctx.principal.subjectId, action: "contract_item.created", resource: "project_contract_item", resourceId: item.id, after: { projectId: project.id, code, kind: "CHANGE_REQUEST", changeRequestId: record.id, estimateMinutes: item.estimateMinutes }, requestId: `cr-approved:${record.id}` } });
      }
      const versions = await recordBaselineChange(tx, { workspaceId, projectId: project.id, cause: { type: "change_request", id: record.id, code: record.code, reason: `${record.code} được khách duyệt: thêm hạng mục ${item.code}` }, actor });
      return { item, versions };
    });
    await writeBaselineVersion(ctx, record, project.id);
    const written = Object.entries(result.versions).map(([layer, version]) => `${layer} v${version}`).join(", ");
    await note(ctx, record, "cr_line_item_created", "Hệ thống tạo hạng mục của yêu cầu", `Hạng mục ${result.item.code}${written ? `; baseline mới: ${written}` : "; dự án chưa khóa baseline"}.`);
  },

  async onChangeRequestBaselineUpdate({ ctx, record, project }: HookInput) {
    const versions = await ctx.prisma.$transaction((tx: any) => recordBaselineChange(tx, {
      workspaceId: ctx.principal.workspaceId, projectId: project.id, cause: { type: "change_request", id: record.id, code: record.code, reason: `${record.code}: cập nhật hạng mục, task triển khai và kế hoạch (CR-08B)` },
      actor: { userId: ctx.principal.subjectId, displayName: ctx.principal.displayName }
    }));
    await writeBaselineVersion(ctx, record, project.id);
    const written = Object.entries(versions).map(([layer, version]) => `${layer} v${version}`).join(", ");
    if (written) await note(ctx, record, "cr_baseline_updated", "Baseline mới", written);
  },

  async computeChangeRequestActualEffort({ ctx, record }: HookInput) {
    const links = await loadChangeRequestLinks(ctx.prisma, ctx.principal.workspaceId, record.projectId, [record]);
    const actual = links.get(record.id)?.actualEffortMd ?? 0;
    await mergeExtension(ctx.prisma, record.id, { actualEffortMd: actual });
    await closeStage(ctx, record);
    await note(ctx, record, "cr_actual_effort", "Effort thực tế (tự tính)", `${actual} MD từ giờ log của các task gắn với hạng mục của yêu cầu.`);
  },

  async onChangeRequestStageClosed({ ctx, record }: HookInput) {
    await closeStage(ctx, record);
  },

  /**
   * V-26 "trong phạm vi thì là task thường": the task goes to the stage the record was reported on, else to the first
   * running ordinary stage of the running milestone; the record keeps a link to it. Without such a stage nothing is
   * created and the history says so.
   */
  async onNotChangeRequestAsTask({ ctx, record, project }: HookInput) {
    const workspaceId = ctx.principal.workspaceId;
    if (record.taskId) return; // already tied to a task
    const stages = await ctx.prisma.projectStage.findMany({ where: { workspaceId, projectId: project.id, changeRequestId: null }, orderBy: { sortOrder: "asc" }, include: { milestone: { select: { sortOrder: true, gateStatus: true } } } });
    const milestone = runningMilestone(stages.map((stage: any) => ({ ...stage.milestone, id: stage.milestoneId })));
    const stage = stages.find((item: any) => item.id === record.stageId)
      ?? stages.find((item: any) => item.milestoneId === (milestone as any)?.id && !CLOSED_WORK_STATUSES.includes(item.status));
    if (!stage) return note(ctx, record, "task_not_created", "Chưa tạo được task thường", "Dự án không có stage đang mở để nhận task; PM tạo task ở cấu hình milestone.");
    const task = await createTaskIn(ctx.prisma, ctx, project, stage, { title: String(record.description).slice(0, 160), taskType: "implementation", contractItem: await rootContractItem(ctx.prisma, workspaceId, project.id), ownerUserId: record.ownerUserId ?? ctx.principal.subjectId, description: `Tạo từ ${record.code} (kết luận CR-02: trong phạm vi).` });
    await ctx.prisma.projectRisk.update({ where: { id: record.id }, data: { taskId: task.id, stageId: stage.id, milestoneId: stage.milestoneId } });
    await ctx.prisma.project.update({ where: { id: project.id }, data: { hierarchyOrderVersion: { increment: 1 } } });
    await note(ctx, record, "task_created", "Tạo task thường (trong phạm vi)", `Task "${task.title}" tại stage "${stage.activity}".`);
  },

  /**
   * V-26: a customer-side Blocker that stops progress proposes Tạm dừng. The proposal itself is computed by the status
   * proposal engine from the open records (status-proposal.ts `customerBlockerCodes`), which ProjectsService runs after
   * every issue-log change — nothing to do here, and the status is never set from this hook.
   */
  async suggestProjectOnHold() {}
});

/** "Phiên bản baseline mới" of the record = the current version of each locked layer. */
async function writeBaselineVersion(ctx: IssueLogContext, record: any, projectId: string) {
  const rows: Array<{ layer: string; _max: { version: number | null } }> = await ctx.prisma.projectBaseline.groupBy({ by: ["layer"], where: { projectId }, _max: { version: true } });
  if (rows.length) await mergeExtension(ctx.prisma, record.id, { newBaselineVersion: rows.sort((left, right) => left.layer.localeCompare(right.layer)).map((row) => `${row.layer} v${row._max.version}`).join(", ") });
}

/** What the system created for each change request: its stage, evaluation task, line item and the effort figures. */
export async function loadChangeRequestLinks(client: any, workspaceId: string, projectId: string, records: ReadonlyArray<{ id: string; type: string; extension?: unknown }>): Promise<Map<string, ChangeRequestLinks>> {
  const ids = records.filter((record) => record.type === "change_request").map((record) => record.id);
  const links = new Map<string, ChangeRequestLinks>();
  if (!ids.length || typeof client?.projectContractItem?.findMany !== "function") return links;
  const [stages, items, standard] = await Promise.all([
    client.projectStage.findMany({ where: { workspaceId, projectId, changeRequestId: { in: ids } }, select: { id: true, activity: true, status: true, changeRequestId: true, tasks: { where: { taskType: CR_EVALUATION_TASK_TYPE }, select: { id: true, title: true }, take: 1 } } }),
    client.projectContractItem.findMany({ where: { workspaceId, projectId, changeRequestId: { in: ids } }, select: { id: true, code: true, name: true, changeRequestId: true } }),
    dayMinutes(client, workspaceId)
  ]);
  const evaluationTaskIds = stages.flatMap((stage: any) => stage.tasks.map((task: any) => task.id));
  const [byItem, byTask] = await Promise.all([
    items.length ? client.taskTimeEntry.groupBy({ by: ["contractItemId"], where: { workspaceId, projectId, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES }, contractItemId: { in: items.map((item: any) => item.id) } }, _sum: { minutes: true } }) : [],
    evaluationTaskIds.length ? client.taskTimeEntry.groupBy({ by: ["taskId"], where: { workspaceId, projectId, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES }, taskId: { in: evaluationTaskIds } }, _sum: { minutes: true } }) : []
  ]);
  const minutes = (rows: any[], key: string, id: string | undefined) => rows.find((row) => row[key] === id)?._sum?.minutes ?? 0;
  for (const record of records) {
    if (record.type !== "change_request") continue;
    const stage = stages.find((item: any) => item.changeRequestId === record.id);
    const item = items.find((candidate: any) => candidate.changeRequestId === record.id);
    const estimated = Number(readExtension({ type: record.type, status: "", extension: record.extension }).estimatedEffortMd);
    if (!stage && !item) continue;
    links.set(record.id, {
      stageId: stage?.id, stageName: stage?.activity, stageStatus: stage?.status, evaluationTaskId: stage?.tasks[0]?.id, evaluationTaskTitle: stage?.tasks[0]?.title,
      contractItemId: item?.id, contractItemCode: item?.code, contractItemName: item?.name,
      estimatedEffortMd: Number.isFinite(estimated) ? estimated : undefined,
      actualEffortMd: item ? effortMd(minutes(byItem, "contractItemId", item.id), standard) : undefined,
      evaluationEffortMd: stage?.tasks[0] ? effortMd(minutes(byTask, "taskId", stage.tasks[0].id), standard) : undefined
    });
  }
  return links;
}

export async function attachChangeRequestLinks(client: any, workspaceId: string, projectId: string, rows: ReadonlyArray<{ id: string; type: string; extension?: unknown }>, summaries: ProjectRiskSummary[]): Promise<ProjectRiskSummary[]> {
  const links = await loadChangeRequestLinks(client, workspaceId, projectId, rows);
  return summaries.map((summary) => (links.has(summary.id) ? { ...summary, changeRequestLinks: links.get(summary.id) } : summary));
}

/**
 * V-39 / V-29 for a task being added to a stage: an ordinary stage has no rule (null). In a change-request stage,
 * implementation tasks exist only once the request is Đã duyệt, and they belong to the request's line item.
 */
export async function changeRequestStageRule(client: any, workspaceId: string, stageId: string | null | undefined): Promise<{ contractItemId: string; changeRequestId: string; changeRequestCode: string } | null> {
  if (!stageId || typeof client?.projectStage?.findFirst !== "function") return null;
  const stage = await client.projectStage.findFirst({ where: { id: stageId, workspaceId }, select: { changeRequestId: true } });
  if (!stage?.changeRequestId) return null;
  const request = await client.projectRisk.findFirst({ where: { id: stage.changeRequestId }, select: { type: true, status: true, code: true } });
  if (!isApprovedChangeRequest(request)) throw new ConflictException(`Chỉ thêm task triển khai vào stage của ${request?.code ?? "yêu cầu thay đổi"} khi yêu cầu đã được khách duyệt (V-29, V-39).`);
  const item = await client.projectContractItem.findFirst({ where: { workspaceId, changeRequestId: stage.changeRequestId, status: "active" }, select: { id: true } });
  if (!item) throw new ConflictException("Yêu cầu thay đổi chưa có hạng mục hợp đồng; tạo hạng mục của yêu cầu trước khi thêm task triển khai.");
  return { contractItemId: item.id, changeRequestId: stage.changeRequestId, changeRequestCode: request?.code ?? "CR" };
}
