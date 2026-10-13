/**
 * Section 9 of "Nguyên tắc nền tảng hệ thống PM" — conversion of the data that existed before the rules.
 *
 *   npx tsx --tsconfig apps/api/tsconfig.json scripts/operations/convert-legacy-data.ts --dry-run
 *   npx tsx --tsconfig apps/api/tsconfig.json scripts/operations/convert-legacy-data.ts --backup-dir=/path/to/backups
 *   npx tsx --tsconfig apps/api/tsconfig.json scripts/operations/convert-legacy-data.ts --restore=/path/to/backups/legacy-conversion-<stamp>
 *
 * Options: --workspace=<id> (default: every workspace), --effective-date=YYYY-MM-DD (default: the stored parameter
 * "Ngày áp dụng quy tắc mới", else today in Vietnam time), --set-effective-date (also stores that date as the
 * parameter), --report-csv=<path> (table 9.1 report; default <backup-dir>/chuyen-doi-du-an-dang-chay.csv).
 *
 * Re-runnable: it only fills what is empty, never overwrites a classification, never changes minutes, and a second
 * run changes nothing. --dry-run executes every step inside a transaction and rolls it back, so its counts are the
 * real run's. A real run first writes a backup of every column it may touch. Rules live in
 * apps/api/src/modules/delivery-handoff/legacy-conversion.ts; migration 20261012190000 adds the marker columns.
 */
import "reflect-metadata";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  PROJECT_POSITIONS,
  classifyProjectPosition,
  entriesBeforeEightHourRule,
  isRunningProject,
  legacyWorkGroup,
  mapLegacyStage,
  type LegacyPendingReason
} from "../../apps/api/src/modules/delivery-handoff/legacy-conversion";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "../../apps/api/src/modules/delivery-handoff/member-participation";
import { PROJECT_STATUS_CATALOGUE, normalizeProjectStatus } from "../../apps/api/src/modules/delivery-handoff/project-status";
import { ProjectsService } from "../../apps/api/src/modules/delivery-handoff/projects.service";
import { isInternalWorklogProjectType, isValidTaskTypePair } from "../../apps/api/src/modules/delivery-handoff/task-classification";
import { nextMonthKey, reportDayStart, reportMonthKey, reportMonthStart } from "../../apps/api/src/modules/resource-controls/pnl-calc";
import { PNL_GATE_REASON_LABELS, PNL_GATE_STATUS_LABELS, classifyPnlEntry, hourlyCostOn, staffCostKey } from "../../apps/api/src/modules/resource-controls/pnl-rules";
import { getStoredParameter, standardDayMinutes, validateSystemParameter } from "../../apps/api/src/shared/system-parameters";
import { addWorkspaceWorkingDays, localDateKey } from "../../apps/api/src/shared/working-days";

type Tx = Prisma.TransactionClient;
const args = new Map(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.join("=") || "true"] as const; }));
const dryRun = args.has("dry-run");
const prisma = new PrismaClient();
// The service's own helpers do the Layer 2 derivation and the copy to time entries (locked cost periods never change).
const service = new ProjectsService(prisma as any) as any;
const LEGACY_MILESTONE = "Dữ liệu cũ chuyển đổi";
class DryRunRollback extends Error {}

const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

async function snapshot(tx: Tx, workspaceId: string, worklogProjectIds: string[]) {
  const [stages, tasks, entries, costs] = await Promise.all([
    tx.projectStage.findMany({ where: { workspaceId }, select: { taskTypeLayer1: true, afterPnlClose: true } }),
    tx.projectTask.findMany({ where: { workspaceId }, select: { taskTypeLayer1: true, taskTypeLayer2: true } }),
    tx.taskTimeEntry.findMany({
      where: { workspaceId },
      select: {
        projectId: true, userId: true, minutes: true, workDate: true, approvalStatus: true, taskTypeLayer1: true, taskTypeLayer2: true,
        legacyPendingReason: true, beforeEightHourRule: true, task: { select: { stage: { select: { afterPnlClose: true } }, parentTask: { select: { stage: { select: { afterPnlClose: true } } } } } }
      }
    }),
    tx.resourceMonthlyCost.findMany({ where: { workspaceId, hourlyCostRate: { not: null } }, select: { userId: true, periodKey: true, hourlyCostRate: true } })
  ]);
  const rates = new Map(costs.map((cost) => [staffCostKey(cost.userId, cost.periodKey), Number(cost.hourlyCostRate)]));
  // The same gate the P&L screens use, on the same entries (actual hours, not the internal worklog). Lost-deal
  // Pre-sale exclusion needs the status history and is left out: it does not depend on this conversion.
  const gate = new Map<string, { entries: number; minutes: number }>();
  for (const row of entries) {
    if (row.minutes <= 0 || NON_ACTUAL_TIME_ENTRY_STATUSES.includes(String(row.approvalStatus).toLowerCase()) || (row.projectId && worklogProjectIds.includes(row.projectId))) continue;
    const result = classifyPnlEntry({ ...row, afterPnlClose: (row.task?.stage ?? row.task?.parentTask?.stage)?.afterPnlClose ?? null, hasCostRate: hourlyCostOn(rates, row.userId, row.workDate) !== undefined });
    const key = `${PNL_GATE_STATUS_LABELS[result.status]}${result.reason ? ` · ${PNL_GATE_REASON_LABELS[result.reason]}` : ""}`;
    const bucket = gate.get(key) ?? { entries: 0, minutes: 0 };
    bucket.entries += 1;
    bucket.minutes += row.minutes;
    gate.set(key, bucket);
  }
  return {
    stages: { total: stages.length, withLayer1: stages.filter((row) => row.taskTypeLayer1).length, withPosition: stages.filter((row) => row.afterPnlClose !== null).length },
    tasks: { total: tasks.length, withLayer1: tasks.filter((row) => row.taskTypeLayer1).length, withLayer2: tasks.filter((row) => row.taskTypeLayer2).length },
    timeEntries: {
      total: entries.length, totalMinutes: entries.reduce((sum, row) => sum + row.minutes, 0),
      withLayer1: entries.filter((row) => row.taskTypeLayer1).length, withLayer2: entries.filter((row) => row.taskTypeLayer2).length,
      beforeEightHourRule: entries.filter((row) => row.beforeEightHourRule).length
    },
    pnlGate: Object.fromEntries([...gate.entries()].sort().map(([key, value]) => [key, `${value.entries} dòng / ${hours(value.minutes)}`]))
  };
}

/** 9.2: an hour that belongs outside any customer project goes to a task of its own person in DX Internal Worklog. */
async function moveToInternalWorklog(tx: Tx, workspaceId: string, worklog: { id: string; accountId: string }, entries: Array<{ id: string; userId: string; taskId: string; projectId: string | null }>, now: Date) {
  if (!entries.length) return 0;
  const normalizedKey = LEGACY_MILESTONE.toLowerCase();
  const milestone = await tx.projectMilestone.findFirst({ where: { projectId: worklog.id, normalizedKey }, select: { id: true } })
    ?? await tx.projectMilestone.create({ data: { workspaceId, accountId: worklog.accountId, projectId: worklog.id, name: LEGACY_MILESTONE, normalizedKey, sortOrder: 9990 }, select: { id: true } });
  const stage = await tx.projectStage.findFirst({ where: { projectId: worklog.id, stageKey: "legacy-conversion" }, select: { id: true } })
    ?? await tx.projectStage.create({
      data: { workspaceId, accountId: worklog.accountId, projectId: worklog.id, milestoneId: milestone.id, stageKey: "legacy-conversion", phase: LEGACY_MILESTONE, activity: "Họp/Khác và hoạt động công ty (dữ liệu cũ)", sortOrder: 10, cumulativePercent: 0, activityPercent: 0, criteria: "Giờ log cũ chuyển sang DX Internal Worklog theo mục 9.2.", legacyConvertedAt: now },
      select: { id: true }
    });
  const users = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(entries.map((entry) => entry.userId))] } }, select: { id: true, displayName: true, email: true } })).map((user) => [user.id, user]));
  const taskByUser = new Map<string, string>();
  for (const entry of entries) {
    let taskId = taskByUser.get(entry.userId);
    if (!taskId) {
      const title = `Họp/Khác (dữ liệu cũ) – ${users.get(entry.userId)?.displayName || users.get(entry.userId)?.email || entry.userId}`;
      taskId = (await tx.projectTask.findFirst({ where: { workspaceId, stageId: stage.id, ownerUserId: entry.userId }, select: { id: true } })
        ?? await tx.projectTask.create({ data: { workspaceId, accountId: worklog.accountId, projectId: worklog.id, stageId: stage.id, title, status: "done", ownerUserId: entry.userId, assigneeUserId: entry.userId, taskTypeLayer2: "INTERNAL_PROJECT", legacyConvertedAt: now }, select: { id: true } })).id;
      taskByUser.set(entry.userId, taskId);
    }
    await tx.taskTimeEntry.update({ where: { id: entry.id }, data: { taskId, projectId: worklog.id, accountId: worklog.accountId, taskTypeLayer2: "INTERNAL_PROJECT", legacyConvertedAt: now } });
    await tx.auditEvent.create({ data: { workspaceId, action: "legacy.time_entry_moved_to_internal_worklog", resource: "task_time_entry", resourceId: entry.id, before: { taskId: entry.taskId, projectId: entry.projectId }, after: { taskId, projectId: worklog.id }, requestId: "legacy-conversion" } });
  }
  return entries.length;
}

export async function convertWorkspace(tx: Tx, workspaceId: string, now: Date) {
  const principal = { workspaceId, subjectId: undefined, subjectType: "system", roleCodes: [] };
  const projects = await tx.project.findMany({
    where: { workspaceId },
    select: {
      id: true, code: true, name: true, status: true, projectType: true, milestoneTemplateKey: true, accountId: true,
      members: { where: { relation: "PM_OWNER" }, orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { displayName: true, email: true } } } }
    }
  });
  const worklogProjects = projects.filter((project) => isInternalWorklogProjectType(project.projectType));
  const worklogIds = worklogProjects.map((project) => project.id);
  const storedEffectiveDate = await getStoredParameter(tx, workspaceId, "effectiveDate");
  const effectiveDate = validateSystemParameter("effectiveDate", args.get("effective-date") ?? storedEffectiveDate ?? localDateKey(now)) as string;
  if (args.has("set-effective-date") && storedEffectiveDate !== effectiveDate) {
    await tx.systemParameter.create({ data: { workspaceId, key: "effectiveDate", value: effectiveDate, updatedByName: "convert-legacy-data" } });
  }
  const before = await snapshot(tx, workspaceId, worklogIds);
  const lockedMonths = (await tx.pnlPeriod.findMany({ where: { workspaceId, projectId: null, status: "LOCKED" }, select: { periodKey: true } })).map((period) => period.periodKey);
  const notLocked = { NOT: lockedMonths.map((periodKey) => ({ workDate: { gte: reportMonthStart(periodKey), lt: reportMonthStart(nextMonthKey(periodKey)) } })) };

  // 1. Stages: Layer 1 and side of the P&L closing point, only where empty. The internal worklog has no template:
  //    its Layer 1 follows the logger's main role (4.1), not a stage, so its stages are left alone.
  const stages = await tx.projectStage.findMany({
    where: { workspaceId, projectId: { notIn: worklogIds } },
    select: { id: true, projectId: true, stageKey: true, activity: true, status: true, sortOrder: true, taskTypeLayer1: true, afterPnlClose: true, owner: { select: { displayName: true, email: true } }, milestone: { select: { name: true, sortOrder: true } }, project: { select: { milestoneTemplateKey: true } } }
  });
  const stageMilestone = new Map<string, 1 | 2 | 3 | 4 | null>();
  const unmapped = new Map<string, number>();
  const stageCounts = { examined: stages.length, updated: 0, fullyClassified: 0, layer1Missing: 0, positionMissing: 0, conflict: 0 };
  for (const stage of stages) {
    const mapping = mapLegacyStage({ milestoneTemplateKey: stage.project.milestoneTemplateKey, stageKey: stage.stageKey, stageName: stage.activity, milestoneName: stage.milestone.name });
    stageMilestone.set(stage.id, mapping.milestone);
    const taskTypeLayer1 = stage.taskTypeLayer1 ?? mapping.taskTypeLayer1;
    let afterPnlClose = stage.afterPnlClose ?? mapping.afterPnlClose;
    // Matrix 4.3: never create Pre-sale after the closing point out of a value somebody set and a mapped position.
    if (stage.afterPnlClose === null && afterPnlClose === true && !isValidTaskTypePair(taskTypeLayer1, "TICKET_MAINTENANCE")) afterPnlClose = null;
    const data = { ...(stage.taskTypeLayer1 === null && taskTypeLayer1 ? { taskTypeLayer1 } : {}), ...(stage.afterPnlClose === null && afterPnlClose !== null ? { afterPnlClose } : {}) };
    if (Object.keys(data).length) {
      await tx.projectStage.update({ where: { id: stage.id }, data: { ...data, legacyConvertedAt: now } });
      stageCounts.updated += 1;
    }
    if (mapping.source === "conflict") stageCounts.conflict += 1;
    if (taskTypeLayer1 && afterPnlClose !== null) stageCounts.fullyClassified += 1;
    else {
      if (!taskTypeLayer1) stageCounts.layer1Missing += 1;
      if (afterPnlClose === null) stageCounts.positionMissing += 1;
      const name = `${stage.milestone.name} › ${stage.activity}${taskTypeLayer1 ? " [thiếu vị trí]" : afterPnlClose !== null ? " [thiếu Lớp 1]" : ""}`;
      unmapped.set(name, (unmapped.get(name) ?? 0) + 1);
    }
  }

  // 2. Tasks (D-02): a framework task takes its stage's Layer 1, a sub-task repeats its parent. Only where empty.
  const convertedTasks: Array<{ id: string; taskTypeLayer1: string }> = await tx.$queryRaw`
    UPDATE "ProjectTask" t SET "taskTypeLayer1" = s."taskTypeLayer1", "legacyConvertedAt" = ${now}
    FROM "ProjectStage" s
    WHERE t."stageId" = s."id" AND t."workspaceId" = ${workspaceId} AND t."parentTaskId" IS NULL AND t."taskTypeLayer1" IS NULL
      AND s."taskTypeLayer1" IS NOT NULL AND NOT (t."projectId" = ANY(${worklogIds}::text[]))
    RETURNING t."id", t."taskTypeLayer1"`;
  for (let depth = 0; depth < 4; depth += 1) {
    const children: Array<{ id: string; taskTypeLayer1: string }> = await tx.$queryRaw`
      UPDATE "ProjectTask" t SET "taskTypeLayer1" = p."taskTypeLayer1", "legacyConvertedAt" = ${now}
      FROM "ProjectTask" p
      WHERE t."parentTaskId" = p."id" AND t."workspaceId" = ${workspaceId} AND t."taskTypeLayer1" IS NULL AND p."taskTypeLayer1" IS NOT NULL
        AND (t."projectId" IS NULL OR NOT (t."projectId" = ANY(${worklogIds}::text[])))
      RETURNING t."id", t."taskTypeLayer1"`;
    if (!children.length) break;
    convertedTasks.push(...children);
  }

  // 3. Layer 2 (table 4.2) through the service's derivation; changed tasks take their unlocked time entries along.
  let layer2Tasks = 0;
  for (const project of projects) layer2Tasks += await service.rederiveProjectTaskLayer2(tx, principal, project.id, "legacy_conversion");

  // 4. Time entries (D-03) still without a layer take their task's, through the service's helper.
  let entriesReclassified = 0;
  for (const layer of ["taskTypeLayer1", "taskTypeLayer2"] as const) {
    const stale = await tx.taskTimeEntry.findMany({ where: { workspaceId, [layer]: null, task: { [layer]: { not: null } }, ...notLocked }, select: { taskId: true, task: { select: { taskTypeLayer1: true, taskTypeLayer2: true } } } });
    const taskIdsByValue = new Map<string, Set<string>>();
    for (const row of stale) taskIdsByValue.set(row.task[layer]!, (taskIdsByValue.get(row.task[layer]!) ?? new Set()).add(row.taskId));
    for (const [value, taskIds] of taskIdsByValue) entriesReclassified += await service.reclassifyTaskTimeEntries(tx, workspaceId, [...taskIds], { [layer]: value });
  }

  // 5. Old groups. "Họp"/"Khác" with no project and company activity move to the person's Internal Worklog task;
  //    "Họp"/"Khác" inside a customer project stay and wait for the PM; a day off has no leave model to go to yet.
  // Entries created up to the end of the effective date predate the rules.
  const cutoff = reportDayStart(effectiveDate).getTime() + 24 * 60 * 60 * 1000;
  const entries = await tx.taskTimeEntry.findMany({
    where: { workspaceId },
    select: {
      id: true, taskId: true, projectId: true, userId: true, workType: true, dayOffId: true, workDate: true, startAt: true, minutes: true, overtimeMinutes: true, approvalStatus: true, createdAt: true,
      taskTypeLayer1: true, legacyConvertedAt: true, beforeEightHourRule: true,
      task: { select: { stageId: true, stage: { select: { afterPnlClose: true } }, parentTask: { select: { stageId: true } } } }
    }
  });
  const isLocked = (workDate: Date) => lockedMonths.includes(reportMonthKey(workDate));
  const groups = entries.map((entry) => ({ entry, group: legacyWorkGroup(entry) })).filter((row) => row.group);
  const toMove = groups.filter(({ entry, group }) => !(entry.projectId && worklogIds.includes(entry.projectId)) && (group === "company_activity" || (group === "meeting_or_other" && !entry.projectId)));
  const movable = toMove.filter(({ entry }) => !isLocked(entry.workDate)).map(({ entry }) => entry);
  const movedToWorklog = worklogProjects[0] ? await moveToInternalWorklog(tx, workspaceId, worklogProjects[0], movable, now) : 0;
  const movedIds = new Set(worklogProjects[0] ? movable.map((entry) => entry.id) : []);
  const groupInProject = groups.filter(({ entry, group }) => group === "meeting_or_other" && entry.projectId && !worklogIds.includes(entry.projectId));
  const dayOff = groups.filter(({ group }) => group === "day_off");

  // 6. Marker on every entry that predates the rules: when the conversion handled it and, if it could not be mapped,
  //    why. Written once: a later run neither restarts the deadline nor re-opens what the PM resolved.
  const legacyGroupIds = new Set(groupInProject.map(({ entry }) => entry.id));
  const stageById = new Map((await tx.projectStage.findMany({ where: { workspaceId }, select: { id: true, taskTypeLayer1: true, afterPnlClose: true } })).map((stage) => [stage.id, stage]));
  const layer1ByTask = new Map((await tx.projectTask.findMany({ where: { workspaceId }, select: { id: true, taskTypeLayer1: true } })).map((task) => [task.id, task.taskTypeLayer1]));
  const idsByReason = new Map<LegacyPendingReason | null, string[]>();
  for (const entry of entries) {
    if (entry.legacyConvertedAt || entry.createdAt.getTime() >= cutoff || movedIds.has(entry.id)) continue;
    const stageId = entry.task.stageId ?? entry.task.parentTask?.stageId ?? null;
    const classified = Boolean(layer1ByTask.get(entry.taskId)) && stageId !== null && stageById.get(stageId)?.afterPnlClose !== null && stageById.get(stageId)?.afterPnlClose !== undefined;
    const reason: LegacyPendingReason | null = legacyGroupIds.has(entry.id) ? "legacy_group_in_project"
      : classified || !entry.projectId || worklogIds.includes(entry.projectId) ? null
      : stageId ? "legacy_unmapped_stage" : "legacy_no_stage";
    idsByReason.set(reason, [...(idsByReason.get(reason) ?? []), entry.id]);
  }
  for (const [legacyPendingReason, ids] of idsByReason) await tx.taskTimeEntry.updateMany({ where: { id: { in: ids } }, data: { legacyConvertedAt: now, legacyPendingReason } });

  // 7. Days above the daily cap before the effective date: marked, never cut.
  const capMinutes = standardDayMinutes({ standardDayHours: await getStoredParameter(tx, workspaceId, "standardDayHours") });
  const overCap = entriesBeforeEightHourRule(
    entries.filter((entry) => !NON_ACTUAL_TIME_ENTRY_STATUSES.includes(String(entry.approvalStatus).toLowerCase())).map((entry) => ({ id: entry.id, userId: entry.userId, at: entry.startAt ?? entry.workDate, minutes: entry.minutes, overtimeMinutes: entry.overtimeMinutes })),
    effectiveDate, capMinutes
  );
  const alreadyMarked = new Set(entries.filter((entry) => entry.beforeEightHourRule).map((entry) => entry.id));
  const newlyMarked = overCap.entryIds.filter((id) => !alreadyMarked.has(id));
  if (newlyMarked.length) await tx.taskTimeEntry.updateMany({ where: { id: { in: newlyMarked } }, data: { beforeEightHourRule: true } });

  // 9.1 report: where each running project stands. Nothing is restructured.
  const minutesByStage = new Map<string, number>();
  for (const entry of entries) {
    const stageId = entry.task.stageId ?? entry.task.parentTask?.stageId;
    if (stageId) minutesByStage.set(stageId, (minutesByStage.get(stageId) ?? 0) + entry.minutes);
  }
  const reportRows = projects.filter((project) => !worklogIds.includes(project.id)).map((project) => {
    const own = stages.filter((stage) => stage.projectId === project.id).sort((left, right) => left.milestone.sortOrder - right.milestone.sortOrder || left.sortOrder - right.sortOrder);
    const pm = project.members[0]?.user ?? own[0]?.owner;
    const statusLabel = PROJECT_STATUS_CATALOGUE[normalizeProjectStatus(project.status) ?? "planning"]?.label ?? project.status;
    if (!isRunningProject(project.status)) {
      return { project, pm, statusLabel, position: "Đã hoàn thành (ngoài bảng 9.1)", handling: "PM quyết định: Đã hoàn thành, hoặc Đang bảo trì nếu đã bàn giao CS (9.3)" };
    }
    const position = PROJECT_POSITIONS[classifyProjectPosition(own.map((stage) => ({ milestone: stageMilestone.get(stage.id) ?? null, status: stage.status, loggedMinutes: minutesByStage.get(stage.id) ?? 0 })))];
    return { project, pm, statusLabel, position: own.length ? position.label : `${PROJECT_POSITIONS.unknown.label} (không có milestone)`, handling: position.handling };
  });

  const after = await snapshot(tx, workspaceId, worklogIds);
  // D-30: a conversion that changes the logged total is wrong, whatever else it did.
  if (after.timeEntries.totalMinutes !== before.timeEntries.totalMinutes || after.timeEntries.total !== before.timeEntries.total) throw new Error(`Tổng giờ log thay đổi (${before.timeEntries.totalMinutes} -> ${after.timeEntries.totalMinutes} phút): dừng chuyển đổi.`);
  const deadline = await addWorkspaceWorkingDays(tx, workspaceId, now, await getStoredParameter(tx, workspaceId, "pendingHoursWorkingDays"));
  const summary = {
    workspaceId, convertedAt: now.toISOString(), effectiveDate, effectiveDateStored: storedEffectiveDate ?? (args.has("set-effective-date") ? effectiveDate : null),
    pendingDeadline: deadline.toISOString(), lockedCostPeriods: lockedMonths,
    stages: { ...stageCounts, unmappedNames: Object.fromEntries([...unmapped.entries()].sort((left, right) => right[1] - left[1])) },
    tasks: { layer1Filled: convertedTasks.length, layer2Changed: layer2Tasks },
    timeEntries: {
      reclassified: entriesReclassified,
      markedConverted: [...idsByReason.values()].reduce((sum, ids) => sum + ids.length, 0),
      pendingReasonsWritten: Object.fromEntries([...idsByReason.entries()].filter(([reason]) => reason).map(([reason, ids]) => [PNL_GATE_REASON_LABELS[reason!], ids.length])),
      movedToInternalWorklog: movedToWorklog,
      notMovedNoWorklogProject: worklogProjects[0] ? 0 : movable.length,
      notMovedLockedPeriod: toMove.length - movable.length,
      oldGroupInCustomerProject: { entries: groupInProject.length, minutes: groupInProject.reduce((sum, { entry }) => sum + entry.minutes, 0) },
      dayOffEntriesNeedingLeaveRecord: dayOff.map(({ entry }) => entry.id),
      beforeEightHourRule: { personDays: overCap.personDays, entries: overCap.entryIds.length, newlyMarked: newlyMarked.length }
    },
    projects: {
      completedNeedingDecision: reportRows.filter((row) => normalizeProjectStatus(row.project.status) === "completed").length,
      byPosition: reportRows.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.position]: (counts[row.position] ?? 0) + 1 }), {})
    },
    before, after
  };
  if (!dryRun) await tx.auditEvent.create({ data: { workspaceId, action: "legacy.conversion_run", resource: "workspace", resourceId: workspaceId, after: JSON.parse(JSON.stringify({ ...summary, before: undefined, after: undefined })), requestId: "legacy-conversion" } });
  return { summary, reportRows, projectIds: projects.map((project) => project.id) };
}

const BACKUP_TABLES = {
  ProjectStage: ["id", "taskTypeLayer1", "afterPnlClose", "legacyConvertedAt"],
  ProjectTask: ["id", "taskTypeLayer1", "taskTypeLayer2", "legacyConvertedAt"],
  TaskTimeEntry: ["id", "taskId", "projectId", "accountId", "contractItemId", "taskTypeLayer1", "taskTypeLayer2", "legacyConvertedAt", "legacyPendingReason", "beforeEightHourRule"],
  // Not written by the conversion; the status rules called after it may apply a status (see main).
  Project: ["id", "status"]
} as const;

async function backup(directory: string, workspaceIds: string[]) {
  mkdirSync(directory, { recursive: true });
  for (const [table, columns] of Object.entries(BACKUP_TABLES)) {
    const rows = await prisma.$queryRawUnsafe(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${table}" WHERE "workspaceId" = ANY($1)`, workspaceIds);
    writeFileSync(join(directory, `${table}.json`), JSON.stringify(rows));
  }
  writeFileSync(join(directory, "SystemParameter.effectiveDate.json"), JSON.stringify(await prisma.systemParameter.findMany({ where: { workspaceId: { in: workspaceIds }, key: "effectiveDate" } })));
}

/** Puts the backed-up columns back. Rows the conversion created (Internal Worklog tasks, audit events) are left in place. */
async function restore(directory: string) {
  await prisma.$transaction(async (tx) => {
    for (const [table, columns] of Object.entries(BACKUP_TABLES)) {
      const rows: Array<Record<string, unknown>> = JSON.parse(readFileSync(join(directory, `${table}.json`), "utf8"));
      const assignments = columns.slice(1).map((column, index) => `"${column}" = $${index + 2}${column === "legacyConvertedAt" ? "::timestamp" : ""}`).join(", ");
      for (const row of rows) await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${assignments} WHERE "id" = $1`, ...columns.map((column) => row[column] ?? null));
      console.log(`Đã khôi phục ${rows.length} dòng ${table}`);
    }
  }, { timeout: 600_000, maxWait: 20_000 });
}

async function main() {
  if (args.has("restore")) return restore(resolve(args.get("restore")!));
  const workspaceIds = args.has("workspace") ? [args.get("workspace")!] : (await prisma.project.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } })).map((row) => row.workspaceId);
  const now = new Date();
  const backupDir = resolve(args.get("backup-dir") ?? process.env.LEGACY_CONVERSION_BACKUP_DIR ?? "backups", `legacy-conversion-${now.toISOString().replace(/[:.]/g, "-")}`);
  if (!dryRun) {
    await backup(backupDir, workspaceIds);
    console.log(`Sao lưu: ${backupDir}`);
  }
  const results: Array<Awaited<ReturnType<typeof convertWorkspace>>> = [];
  try {
    await prisma.$transaction(async (tx) => {
      for (const workspaceId of workspaceIds) results.push(await convertWorkspace(tx, workspaceId, now));
      if (dryRun) throw new DryRunRollback();
    }, { timeout: 600_000, maxWait: 20_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  console.log(JSON.stringify(results.map((result) => result.summary), null, 2));
  const csv = [["Mã dự án", "Tên dự án", "PM/PIC", "Trạng thái", "Vị trí tại ngày áp dụng", "Cách xử lý đề xuất (bảng 9.1)"], ...results.flatMap((result) => result.reportRows.map((row) => [row.project.code, row.project.name, row.pm?.displayName || row.pm?.email || "Chưa có PM/PIC", row.statusLabel, row.position, row.handling]))];
  const csvPath = resolve(args.get("report-csv") ?? join(dryRun ? "." : backupDir, "chuyen-doi-du-an-dang-chay.csv"));
  writeFileSync(csvPath, `﻿${csv.map((line) => line.map(csvCell).join(",")).join("\n")}\n`);
  console.log(`Báo cáo bảng 9.1: ${csvPath}`);
  if (dryRun) return console.log("CHẠY THỬ: không có gì được ghi vào cơ sở dữ liệu.");
  writeFileSync(join(backupDir, "conversion-summary.json"), JSON.stringify(results.map((result) => result.summary), null, 2));
  // 9.3: after the conversion the system proposes a status per project and the PM confirms. This script sets no
  // status; the status rules themselves (V-17) apply "Đã hoàn thành" / "Đang bảo trì" on their own, so what they
  // changed is counted and printed. --skip-status-proposals leaves the step out.
  if (args.has("skip-status-proposals")) return console.log("Đề xuất trạng thái: bỏ qua theo --skip-status-proposals.");
  if (typeof service.recomputeStatusProposal !== "function" || typeof (prisma as any).projectStatusProposal?.count !== "function") return console.log("Đề xuất trạng thái: bỏ qua (chưa có recomputeStatusProposal).");
  const projectIds = results.flatMap((result) => result.projectIds);
  const statusBefore = new Map((await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, status: true } })).map((project) => [project.id, project.status]));
  for (const projectId of projectIds) await service.recomputeStatusProposal(projectId);
  const changed = (await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, status: true } })).filter((project) => project.status !== statusBefore.get(project.id));
  const proposals = await (prisma as any).projectStatusProposal.groupBy({ by: ["proposedStatus"], where: { projectId: { in: projectIds }, status: "pending" }, _count: { _all: true } });
  const statusReport = {
    pendingProposals: Object.fromEntries(proposals.map((row: any) => [row.proposedStatus, row._count._all])),
    statusesAppliedByTheRules: changed.map((project) => `${project.code}: ${statusBefore.get(project.id)} -> ${project.status}`)
  };
  writeFileSync(join(backupDir, "status-proposals.json"), JSON.stringify(statusReport, null, 2));
  console.log("Đề xuất trạng thái:", JSON.stringify(statusReport, null, 2));
}

// Importing the file (a check of convertWorkspace inside a rolled-back transaction) does not start a run.
if (/convert-legacy-data\.ts$/.test(process.argv[1] ?? "")) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
