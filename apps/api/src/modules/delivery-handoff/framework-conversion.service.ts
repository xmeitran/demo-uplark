/**
 * Table 9.1 — the database side of framework-conversion.ts: snapshot, apply, backup, restore. One project at a time,
 * always on request (scripts/operations/convert-project-frameworks.ts or the Admin endpoint); nothing here runs in bulk.
 *
 * Backup: <directory>/<projectId>.json holds the plan and every row of the project in the tables the plan writes
 * (Project, ProjectMilestone, ProjectStage, ProjectGate, ProjectContractItem, and the stage / classification columns of
 * ProjectTask and TaskTimeEntry). Restore puts the columns back and removes the rows the conversion created.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HOLDING_STAGE_KEY, HOLDING_STAGE_NAME, RETIRED_KEY_PREFIX, RETIRED_NAME_PREFIX, ROOT_ITEM_REF, milestoneKey,
  type FrameworkConversionPlan, type FrameworkSnapshot
} from "./framework-conversion";
import { PROJECT_GATE_CATALOGUE, type ProjectGateCode } from "@b2b-crm/contracts";
import { captureBaseline } from "./baseline.service";
import { isGatePassed } from "./gates";
import { createProjectGate } from "./gates.service";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";

export interface FrameworkConversionHooks {
  /** ProjectsService.reclassifyTaskTimeEntries: unlocked time entries follow their task (D-03). */
  reclassifyTimeEntries?(tx: any, workspaceId: string, taskIds: string[], classification: { taskTypeLayer1?: string; contractItemId?: string }): Promise<number>;
  /** ProjectsService.rederiveProjectTaskLayer2: Layer 2 of every task of the project by table 4.2. */
  rederiveLayer2?(tx: any, projectId: string): Promise<number>;
}

/** The two private helpers of ProjectsService, the way convert-legacy-data.ts already calls them. */
export function projectsServiceHooks(projectsService: unknown, principal: { workspaceId: string; subjectId?: string; subjectType: string; roleCodes: string[] }): FrameworkConversionHooks {
  const service = projectsService as any;
  return {
    reclassifyTimeEntries: (tx, workspaceId, taskIds, classification) => service.reclassifyTaskTimeEntries(tx, workspaceId, taskIds, classification),
    rederiveLayer2: (tx, projectId) => service.rederiveProjectTaskLayer2(tx, principal, projectId, "framework_conversion")
  };
}

export interface FrameworkConversionContext {
  workspaceId: string;
  actor?: { userId?: string | null; displayName?: string | null };
  hooks?: FrameworkConversionHooks;
  backupDirectory?: string;
  requestId?: string;
  now?: Date;
}

export async function loadFrameworkSnapshot(client: any, workspaceId: string, projectId: string): Promise<FrameworkSnapshot | null> {
  const where = { workspaceId, projectId };
  const project = await client.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true, code: true, name: true, status: true, projectType: true, milestoneTemplateKey: true } });
  if (!project) return null;
  const [milestones, stages, gates, contractItems, tasks, minutes] = await Promise.all([
    client.projectMilestone.findMany({ where, select: { id: true, name: true, normalizedKey: true, sortOrder: true } }),
    client.projectStage.findMany({ where, select: { id: true, milestoneId: true, stageKey: true, activity: true, status: true, sortOrder: true, taskTypeLayer1: true, afterPnlClose: true, slaDays: true } }),
    client.projectGate.findMany({ where, select: { stageId: true, code: true } }),
    client.projectContractItem.findMany({ where, select: { id: true, kind: true, status: true, sortOrder: true, archivedAt: true } }),
    client.projectTask.findMany({ where, select: { id: true, stageId: true, parentTaskId: true, status: true, archivedAt: true, taskTypeLayer1: true, contractItemId: true } }),
    client.taskTimeEntry.groupBy({ by: ["taskId"], where: { workspaceId, task: { projectId } }, _sum: { minutes: true } })
  ]);
  const taskById = new Map<string, any>(tasks.map((task: any) => [task.id, task]));
  const minutesByStage = new Map<string, number>();
  for (const row of minutes as Array<{ taskId: string; _sum: { minutes: number | null } }>) {
    const task = taskById.get(row.taskId);
    const stageId = task?.stageId ?? taskById.get(task?.parentTaskId)?.stageId;
    if (stageId) minutesByStage.set(stageId, (minutesByStage.get(stageId) ?? 0) + (row._sum.minutes ?? 0));
  }
  return { project, milestones, stages: stages.map((stage: any) => ({ ...stage, loggedMinutes: minutesByStage.get(stage.id) ?? 0 })), gates, contractItems, tasks };
}

/**
 * The milestone lock (ProjectsService.assertMilestoneUnlocked) reads ProjectMilestone.gateStatus, which the gate approval
 * normally maintains. After gates were created as "passed", bring the milestones in line with them: approved when the
 * gate that closes the milestone is passed, open when the milestone before it is approved, locked otherwise.
 * Never downgrades a milestone (one approved the old way stays approved).
 */
async function syncMilestoneGateStatus(tx: any, scope: { workspaceId: string; projectId: string }, now: Date, actorUserId: string | null) {
  const [milestones, gates]: [any[], any[]] = await Promise.all([
    tx.projectMilestone.findMany({ where: scope, orderBy: { sortOrder: "asc" }, select: { id: true, normalizedKey: true, sortOrder: true, gateStatus: true } }),
    tx.projectGate.findMany({ where: scope, select: { milestoneId: true, code: true, status: true } })
  ]);
  let previousApproved = true;
  for (const milestone of [...milestones].sort((left, right) => left.sortOrder - right.sortOrder)) {
    if (String(milestone.normalizedKey ?? "").startsWith(RETIRED_KEY_PREFIX)) continue;
    const closed = gates.some((gate) => gate.milestoneId === milestone.id && PROJECT_GATE_CATALOGUE[gate.code as ProjectGateCode]?.closesMilestone && isGatePassed(gate.status));
    if (closed && milestone.gateStatus !== "approved") {
      await tx.projectMilestone.update({ where: { id: milestone.id }, data: { gateStatus: "approved", reviewerApprovedAt: now, reviewerApprovedByUserId: actorUserId } });
    } else if (!closed && previousApproved && milestone.gateStatus === "locked") {
      await tx.projectMilestone.update({ where: { id: milestone.id }, data: { gateStatus: "open" } });
    }
    previousApproved = closed || milestone.gateStatus === "approved";
  }
}

/** Runs the plan inside the caller's transaction. The caller backs up first (backupFrameworkConversion). */
export async function applyFrameworkConversion(tx: any, plan: FrameworkConversionPlan, ctx: FrameworkConversionContext) {
  const scope = { workspaceId: ctx.workspaceId, projectId: plan.projectId };
  const now = ctx.now ?? new Date();
  const project = await tx.project.findFirst({ where: { id: plan.projectId, workspaceId: ctx.workspaceId }, select: { id: true, accountId: true, name: true } });
  if (!project) throw new Error(`Không tìm thấy dự án ${plan.projectId}.`);
  const base = { workspaceId: ctx.workspaceId, accountId: project.accountId, projectId: project.id };
  const stageByKey = async (stageKey: string) => {
    const stage = await tx.projectStage.findFirst({ where: { ...scope, stageKey }, select: { id: true, workspaceId: true, projectId: true, milestoneId: true } });
    if (!stage) throw new Error(`Dự án ${plan.projectCode} không có stage "${stageKey}".`);
    return stage;
  };
  const templateMilestoneId = async (number: number) => {
    const milestone = await tx.projectMilestone.findFirst({ where: { ...scope, normalizedKey: milestoneKey(PILOT_PROJECT_MILESTONE_TEMPLATE[number - 1].name) }, select: { id: true } });
    if (!milestone) throw new Error(`Dự án ${plan.projectCode} chưa có milestone ${number} của TPL-001.`);
    return milestone.id as string;
  };
  let rootItemId: string | undefined;
  const group = (map: Map<string, string[]>, key: string, taskId: string) => map.set(key, [...(map.get(key) ?? []), taskId]);
  const moves = new Map<string, string[]>();
  const layer1 = new Map<string, string[]>();
  const items = new Map<string, string[]>();

  for (const operation of plan.operations) {
    if (operation.type === "retire_milestone") {
      const milestone = await tx.projectMilestone.findFirst({ where: { ...scope, id: operation.milestoneId }, select: { name: true, normalizedKey: true, sortOrder: true } });
      if (!milestone) continue;
      if (!milestone.normalizedKey.startsWith(RETIRED_KEY_PREFIX)) {
        await tx.projectMilestone.update({ where: { id: operation.milestoneId }, data: { name: `${RETIRED_NAME_PREFIX}${milestone.name}`, normalizedKey: `${RETIRED_KEY_PREFIX}${milestone.normalizedKey}`, sortOrder: milestone.sortOrder + 9000 } });
      }
      for (const stage of await tx.projectStage.findMany({ where: { ...scope, id: { in: operation.stageIds } }, select: { id: true, stageKey: true } })) {
        await tx.projectStage.update({ where: { id: stage.id }, data: { stageKey: `${RETIRED_KEY_PREFIX}${stage.stageKey}` } });
      }
    } else if (operation.type === "create_milestone") {
      const template = PILOT_PROJECT_MILESTONE_TEMPLATE[operation.templateMilestone - 1];
      await tx.projectMilestone.create({
        data: {
          ...base, name: template.name, normalizedKey: milestoneKey(template.name), sortOrder: template.sortOrder,
          requiredDocumentCount: template.requiredDocumentCount, requiredDocumentTypes: [...template.requiredDocumentTypes],
          unlockCriteria: { text: template.unlockCriteria, evidenceMode: "file_or_link" },
          gateStatus: operation.templateMilestone === 1 ? "open" : "locked",
          customerConfirmationRequired: template.customerConfirmationRequired, reviewerMode: template.reviewerMode
        }
      });
    } else if (operation.type === "create_stage") {
      const template = PILOT_PROJECT_MILESTONE_TEMPLATE[operation.templateMilestone - 1].stages.find((stage) => stage.stageKey === operation.stageKey) as any;
      await tx.projectStage.create({
        data: {
          ...base, milestoneId: await templateMilestoneId(operation.templateMilestone), stageKey: template.stageKey, phase: template.phase, activity: template.activity,
          sortOrder: template.sortOrder, cumulativePercent: template.cumulativePercent, activityPercent: template.activityPercent, criteria: template.criteria,
          upbaseRole: template.upbaseRole, customerRole: template.customerRole, taskTypeLayer1: template.taskTypeLayer1, afterPnlClose: template.afterPnlClose,
          slaDays: template.slaDays ?? null, status: operation.started ? "in_progress" : "not_started"
        }
      });
    } else if (operation.type === "create_holding_stage") {
      await tx.projectStage.create({
        data: {
          ...base, milestoneId: await templateMilestoneId(1), stageKey: HOLDING_STAGE_KEY, phase: HOLDING_STAGE_NAME, activity: HOLDING_STAGE_NAME, sortOrder: 0,
          cumulativePercent: 0, activityPercent: 0, criteria: "PM xếp từng task ở đây vào stage TPL-001 phù hợp.", status: operation.started ? "in_progress" : "not_started"
        }
      });
    } else if (operation.type === "map_milestone") {
      await tx.projectMilestone.update({ where: { id: operation.milestoneId }, data: { normalizedKey: operation.normalizedKey } });
    } else if (operation.type === "map_stage") {
      const { taskTypeLayer1, afterPnlClose, slaDays } = operation;
      await tx.projectStage.update({ where: { id: operation.stageId }, data: { stageKey: operation.stageKey, ...(taskTypeLayer1 ? { taskTypeLayer1 } : {}), ...(afterPnlClose !== undefined ? { afterPnlClose } : {}), ...(slaDays ? { slaDays } : {}) } });
    } else if (operation.type === "create_gate") {
      const stage = await stageByKey(operation.stageKey);
      await createProjectGate(tx, stage, operation.code);
      if (operation.passed) {
        const note = "Chuyển đổi khung (bảng 9.1): điểm chốt đã qua trước ngày áp dụng.";
        await tx.projectGate.updateMany({
          where: { stageId: stage.id },
          data: {
            status: "approved", decision: "approved", decidedAt: now, decidedByUserId: ctx.actor?.userId ?? null, decisionReason: note,
            history: [{ at: now.toISOString(), action: "migrated", label: "Chuyển đổi khung", byUserId: ctx.actor?.userId ?? null, byName: ctx.actor?.displayName ?? null, fromStatus: null, toStatus: "approved", note }]
          }
        });
      }
    } else if (operation.type === "set_template_key") {
      await tx.project.update({ where: { id: project.id }, data: { milestoneTemplateKey: operation.templateKey } });
    } else if (operation.type === "set_project_status") {
      await tx.project.update({ where: { id: project.id }, data: { status: operation.to } });
      // Every status change leaves a history row (V-17). ponytail: restoreFrameworkConversion puts the status back but keeps this row.
      if (typeof tx.projectStatusHistory?.create === "function") {
        await tx.projectStatusHistory.create({ data: { workspaceId: ctx.workspaceId, projectId: project.id, fromStatus: operation.from, toStatus: operation.to, reason: "Chuyển đổi khung (bảng 9.1): đổi mã trạng thái sang bộ trạng thái mới.", changedByUserId: ctx.actor?.userId ?? null } });
      }
    } else if (operation.type === "create_root_contract_item") {
      const existing: Array<{ code: string; sortOrder: number }> = await tx.projectContractItem.findMany({ where: scope, select: { code: true, sortOrder: true } });
      const codes = new Set(existing.map((item) => item.code.toLowerCase()));
      let number = existing.length + 1;
      while (codes.has(`hm-${String(number).padStart(2, "0")}`)) number += 1;
      rootItemId = (await tx.projectContractItem.create({
        data: { ...scope, code: `HM-${String(number).padStart(2, "0")}`, name: project.name, kind: "ROOT", sortOrder: Math.max(0, ...existing.map((item) => item.sortOrder)) + 10, createdByUserId: ctx.actor?.userId ?? null },
        select: { id: true }
      })).id;
    } else if (operation.type === "move_task") {
      group(moves, operation.toStageKey, operation.taskId);
    } else if (operation.type === "classify_task") {
      if (operation.taskTypeLayer1) group(layer1, operation.taskTypeLayer1, operation.taskId);
      if (operation.contractItemId) group(items, operation.contractItemId, operation.taskId);
    }
  }

  for (const [stageKey, taskIds] of moves) await tx.projectTask.updateMany({ where: { ...scope, id: { in: taskIds } }, data: { stageId: (await stageByKey(stageKey)).id } });
  for (const [taskTypeLayer1, taskIds] of layer1) {
    await tx.projectTask.updateMany({ where: { ...scope, id: { in: taskIds } }, data: { taskTypeLayer1 } });
    await ctx.hooks?.reclassifyTimeEntries?.(tx, ctx.workspaceId, taskIds, { taskTypeLayer1 });
  }
  for (const [reference, taskIds] of items) {
    const contractItemId = reference === ROOT_ITEM_REF ? rootItemId : reference;
    if (!contractItemId) throw new Error(`Dự án ${plan.projectCode}: chưa có hạng mục hợp đồng gốc để gán cho task.`);
    await tx.projectTask.updateMany({ where: { ...scope, id: { in: taskIds } }, data: { contractItemId } });
    await ctx.hooks?.reclassifyTimeEntries?.(tx, ctx.workspaceId, taskIds, { contractItemId });
  }
  // Table 4.2: a task that changed stage or contract item may have another Layer 2.
  const layer2TaskCount = (await ctx.hooks?.rederiveLayer2?.(tx, project.id)) ?? 0;
  if (plan.operations.some((operation) => operation.type === "create_gate")) {
    await syncMilestoneGateStatus(tx, scope, now, ctx.actor?.userId ?? null);
    // 8.1, G1: a gate recorded as passed locks the estimate as B0 / B1, exactly like an approval (after the tasks got their line items).
    const g1 = plan.operations.some((operation) => operation.type === "create_gate" && operation.code === "G1" && operation.passed)
      ? await tx.projectGate.findFirst({ where: { ...scope, code: "G1" }, select: { id: true } })
      : null;
    if (g1) {
      await captureBaseline(tx, { workspaceId: ctx.workspaceId, projectId: project.id, now,
        cause: { type: "gate", id: g1.id, code: "G1", reason: "Chuyển đổi khung (bảng 9.1): G1 đã qua trước ngày áp dụng, khóa estimate gốc thành B0 và B1" },
        actor: { userId: ctx.actor?.userId ?? null, displayName: ctx.actor?.displayName ?? null } });
    }
  }
  await tx.auditEvent.create({
    data: {
      workspaceId: ctx.workspaceId, actorUserId: ctx.actor?.userId ?? null, action: "project.framework_converted", resource: "project", resourceId: project.id,
      before: { position: plan.position },
      after: JSON.parse(JSON.stringify({ position: plan.position, totals: plan.totals, layer2TaskCount, steps: plan.steps, operations: plan.operations, backupDirectory: ctx.backupDirectory ?? null })),
      requestId: ctx.requestId ?? "framework-conversion"
    }
  });
  return { totals: plan.totals, layer2TaskCount };
}

/** backups/framework-conversion-<stamp>, next to the legacy-conversion-<stamp> folders of convert-legacy-data.ts. */
export function frameworkBackupDirectory(root: string | undefined, now: Date) {
  return resolve(root ?? process.env.LEGACY_CONVERSION_BACKUP_DIR ?? "backups", `framework-conversion-${now.toISOString().replace(/[:.]/g, "-")}`);
}

interface FrameworkBackup {
  version: 1; takenAt: string; workspaceId: string; projectId: string; plan: FrameworkConversionPlan;
  project: any; milestones: any[]; stages: any[]; gates: any[]; contractItems: any[]; tasks: any[]; timeEntries: any[];
}

/** Written BEFORE the plan is applied; one file per project. */
export async function backupFrameworkConversion(client: any, directory: string, workspaceId: string, plan: FrameworkConversionPlan) {
  const where = { workspaceId, projectId: plan.projectId };
  const classification = { id: true, taskTypeLayer1: true, taskTypeLayer2: true, contractItemId: true };
  const backup: FrameworkBackup = {
    version: 1, takenAt: new Date().toISOString(), workspaceId, projectId: plan.projectId, plan,
    project: await client.project.findFirst({ where: { id: plan.projectId, workspaceId }, select: { id: true, code: true, status: true, milestoneTemplateKey: true } }),
    milestones: await client.projectMilestone.findMany({ where }),
    stages: await client.projectStage.findMany({ where }),
    gates: await client.projectGate.findMany({ where }),
    contractItems: await client.projectContractItem.findMany({ where }),
    tasks: await client.projectTask.findMany({ where, select: { ...classification, stageId: true } }),
    timeEntries: await client.taskTimeEntry.findMany({ where: { workspaceId, task: { projectId: plan.projectId } }, select: classification })
  };
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${plan.projectId}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 1));
  return file;
}

/**
 * Every project file of the folder, each in its own transaction. Columns go back to their backed-up values; milestones,
 * stages, gates and contract items that are not in the backup (created by the conversion) are deleted. A task created
 * after the conversion inside a created stage loses its stage; one that points at a created contract item loses the item.
 */
export async function restoreFrameworkConversion(prisma: any, directory: string) {
  const restored: Array<{ projectId: string; projectCode: string; tasks: number; timeEntries: number; deleted: number }> = [];
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
    const backup: FrameworkBackup = JSON.parse(readFileSync(join(directory, name), "utf8"));
    if (backup.version !== 1 || !backup.project) continue;
    const where = { workspaceId: backup.workspaceId, projectId: backup.projectId };
    const ids = (rows: any[]) => rows.map((row) => row.id as string);
    await prisma.$transaction(async (tx: any) => {
      const changed = (current: any, old: any, columns: string[]) => columns.some((column) => (current[column] ?? null) !== (old[column] ?? null));
      const putBack = async (model: string, rows: any[], current: any[], columns: string[]) => {
        const now = new Map(current.map((row) => [row.id, row]));
        let count = 0;
        for (const old of rows) {
          if (!now.has(old.id) || !changed(now.get(old.id), old, columns)) continue;
          await tx[model].update({ where: { id: old.id }, data: Object.fromEntries(columns.map((column) => [column, old[column] ?? null])) });
          count += 1;
        }
        return count;
      };
      // 1. Tasks and time entries back first, so nothing hangs off what is deleted next.
      const taskColumns = ["stageId", "taskTypeLayer1", "taskTypeLayer2", "contractItemId"];
      const tasks = await putBack("projectTask", backup.tasks, await tx.projectTask.findMany({ where, select: { id: true, stageId: true, taskTypeLayer1: true, taskTypeLayer2: true, contractItemId: true } }), taskColumns);
      const entryColumns = ["taskTypeLayer1", "taskTypeLayer2", "contractItemId"];
      const timeEntries = await putBack("taskTimeEntry", backup.timeEntries, await tx.taskTimeEntry.findMany({ where: { id: { in: ids(backup.timeEntries) } }, select: { id: true, taskTypeLayer1: true, taskTypeLayer2: true, contractItemId: true } }), entryColumns);
      // 2. Rows the conversion created.
      const createdItems = { ...where, id: { notIn: ids(backup.contractItems) } };
      const createdItemIds = ids(await tx.projectContractItem.findMany({ where: createdItems, select: { id: true } }));
      if (createdItemIds.length) {
        await tx.projectTask.updateMany({ where: { contractItemId: { in: createdItemIds } }, data: { contractItemId: null } });
        await tx.taskTimeEntry.updateMany({ where: { contractItemId: { in: createdItemIds } }, data: { contractItemId: null } });
      }
      let deleted = (await tx.projectGate.deleteMany({ where: { ...where, id: { notIn: ids(backup.gates) } } })).count;
      deleted += (await tx.projectStage.deleteMany({ where: { ...where, id: { notIn: ids(backup.stages) } } })).count;
      deleted += (await tx.projectMilestone.deleteMany({ where: { ...where, id: { notIn: ids(backup.milestones) } } })).count;
      deleted += (await tx.projectContractItem.deleteMany({ where: createdItems })).count;
      // 3. Keys, names and order of the old framework, then the project itself.
      await putBack("projectMilestone", backup.milestones, await tx.projectMilestone.findMany({ where }), ["name", "normalizedKey", "sortOrder", "gateStatus"]);
      await putBack("projectStage", backup.stages, await tx.projectStage.findMany({ where }), ["milestoneId", "stageKey", "sortOrder", "status", "taskTypeLayer1", "afterPnlClose", "slaDays"]);
      await tx.project.update({ where: { id: backup.projectId }, data: { milestoneTemplateKey: backup.project.milestoneTemplateKey, ...(backup.plan.operations.some((operation) => operation.type === "set_project_status") ? { status: backup.project.status } : {}) } });
      await tx.auditEvent.create({ data: { workspaceId: backup.workspaceId, action: "project.framework_conversion_restored", resource: "project", resourceId: backup.projectId, after: { backup: join(directory, name), tasks, timeEntries, deleted }, requestId: "framework-conversion" } });
      restored.push({ projectId: backup.projectId, projectCode: backup.project.code, tasks, timeEntries, deleted });
    }, { timeout: 600_000, maxWait: 20_000 });
  }
  return restored;
}
