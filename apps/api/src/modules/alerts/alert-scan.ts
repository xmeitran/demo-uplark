/**
 * 7.5 "Quét đầu ngày": evaluates every time-based trigger for every project that is not closed and reconciles the
 * result with the stored ProjectWarning rows. Idempotent: an open warning with the same dedupe key is refreshed,
 * never duplicated; a warning closes when the catalogue's close condition holds; a warning a person closed by hand
 * stays closed until its cause has cleared once.
 */
import { ADMIN_ROLE_CODES, type AlertScanResult, type AlertTriggerDef } from "@b2b-crm/contracts";
import { loadParameters } from "../../shared/system-parameters";
import { isWorkingDay, loadDayOffKeys, localDateKey } from "../../shared/working-days";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { refreshProjectIssueLogWarnings } from "../delivery-handoff/issue-log.service";
import { NON_ACTUAL_TIME_ENTRY_STATUSES } from "../delivery-handoff/member-participation";
import { isProjectClosed } from "../delivery-handoff/project-status";
import { firstStageOf } from "../delivery-handoff/project-visibility";
import { loadStageExtensions } from "../delivery-handoff/stage-extension";
import { stageSlaState } from "../delivery-handoff/stage-sla";
import { isClosedWorkStatus } from "../delivery-handoff/task-status";
import { closeProjectWarnings, isSuppressedByManualClose, loadAlertTriggers, openOrRefreshProjectWarning, REARM_ACTION, TRIGGER_OVERRIDES_KEY } from "../delivery-handoff/project-warnings";
import {
  clearStreakDecision,
  hasClearStreak,
  CONDITION_ABSENT_ACTION,
  CONDITION_PRESENT_ACTION,
  evaluateCustomerWait,
  evaluateDelayRisk,
  evaluateHandoffReview,
  evaluateStageSla,
  evaluateHoursUsed,
  evaluateMissingOwners,
  evaluateOverCapacity,
  evaluateOverdueTasks,
  evaluatePendingHours,
  evaluatePendingPlanChanges,
  evaluatePlanWithoutLog,
  isRunningProject,
  type ScanClock,
  type ScanPendingHours,
  type ScanPlanBlock,
  type ScanStage,
  type ScanTask,
  type WantedWarning
} from "./alert-evaluators";
import { deliverLarkAlert, mergeAlerts, NOTIFIED_ACTION, notifyReason, resolveRecipients, type PendingAlert } from "./alert-notifications";

export { loadAlertTriggers, TRIGGER_OVERRIDES_KEY };
/** Trigger codes this scan decides on its own. BRI-01…03 are decided per issue-log record by issue-log.service. */
export const SCAN_OWNED_CODES = ["NL-03", "NL-04", "NL-05", "TD-01", "TD-02", "TD-03", "TD-04", "TD-06", "BRI-04", "BRI-05", "DL-01"] as const;
const ISSUE_LOG_CODES = ["BRI-01", "BRI-02", "BRI-03"];
/** Triggers that left the catalogue (group YC went with the change-request flow, chốt 13/10): the scan closes what is still open. */
export const RETIRED_TRIGGER_CODES = ["YC-01"];
/** Triggers that close only after N consecutive clear working days. */
const CLEAR_STREAK_DAYS: Record<string, number> = { "TD-03": 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AlertScanOptions {
  now?: Date;
  /** False = reconcile the warning records only (no in-app notification, no Lark). */
  notify?: boolean;
  /** DL-01 data source: the pending hours of the given projects, from the P&L gate (resource-controls). */
  loadPendingHours?: (workspaceId: string, projectIds: string[]) => Promise<ScanPendingHours[]>;
  deliverLark?: typeof deliverLarkAlert;
  /** In-app channel: NotificationsService.notifyProjectWarnings. Without it the row is written directly (unit tests). */
  createNotification?: (input: ProjectWarningNotification) => Promise<unknown>;
  /** V-17: overdue tasks and high delay warnings are a function of the clock, so each scanned project gets its status proposal recomputed (ProjectsService.recomputeStatusProposal). */
  syncProjectStatus?: (projectId: string) => Promise<unknown>;
}

export interface ProjectWarningNotification { workspaceId: string; recipientUserId: string; dedupeKey: string; title: string; body: string; href: string; warningId: string; data: Record<string, unknown> }

const bump = (counter: Record<string, number>, code: string) => { counter[code] = (counter[code] ?? 0) + 1; };

/**
 * Brings the stored warnings of the evaluated trigger codes in line with `wanted`.
 * `existing` = every stored warning of those codes (with events, oldest first); the newest per (project, key) decides.
 */
export async function reconcileWarnings(
  client: any,
  input: { workspaceId: string; codes: readonly string[]; wanted: readonly WantedWarning[]; existing: readonly any[]; triggers: readonly AlertTriggerDef[]; clock: Pick<ScanClock, "now" | "dayOffKeys"> },
  result: Pick<AlertScanResult, "opened" | "refreshed" | "closed">
) {
  const keyOf = (item: { projectId: string; dedupeKey: string }) => `${item.projectId}|${item.dedupeKey}`;
  const latest = new Map<string, any>();
  for (const warning of [...input.existing].sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())) latest.set(keyOf(warning), warning);
  const wantedKeys = new Set<string>();
  for (const wanted of input.wanted) {
    if (!input.codes.includes(wanted.typeCode)) continue;
    wantedKeys.add(keyOf(wanted));
    const current = latest.get(keyOf(wanted));
    if (isSuppressedByManualClose(current)) continue;
    const wasOpen = current?.status === "open";
    await openOrRefreshProjectWarning(client, { workspaceId: input.workspaceId, ...wanted, actorUserId: null, triggerChecked: true });
    bump(wasOpen ? result.refreshed : result.opened, wanted.typeCode);
    // The condition is back: break a running "clear days" streak.
    if (wasOpen && CLEAR_STREAK_DAYS[wanted.typeCode] && hasClearStreak(current.events ?? [])) {
      await client.projectWarning.update({ where: { id: current.id }, data: { events: { create: { action: CONDITION_PRESENT_ACTION, note: "Điều kiện xuất hiện lại", at: input.clock.now } } } });
    }
  }
  for (const [key, current] of latest) {
    if (wantedKeys.has(key) || !input.codes.includes(current.typeCode)) continue;
    const trigger = input.triggers.find((item) => item.code === current.typeCode);
    if (current.status === "open") {
      const streak = CLEAR_STREAK_DAYS[current.typeCode];
      if (streak) {
        const decision = clearStreakDecision(current.events ?? [], input.clock, streak);
        if (decision === "wait") continue;
        if (decision === "mark") {
          await client.projectWarning.update({ where: { id: current.id }, data: { events: { create: { action: CONDITION_ABSENT_ACTION, note: `Hết điều kiện ngày ${localDateKey(input.clock.now)}`, at: input.clock.now } } } });
          continue;
        }
      }
      await closeProjectWarnings(client, { projectId: current.projectId, id: current.id }, null, `Điều kiện kết thúc: ${trigger?.closesWhen ?? "điều kiện cảnh báo không còn"}`);
      bump(result.closed, current.typeCode);
    } else if (isSuppressedByManualClose(current)) {
      // The cause is gone: lift the manual suppression so the next occurrence opens a new warning.
      await client.projectWarning.update({ where: { id: current.id }, data: { events: { create: { action: REARM_ACTION, note: "Điều kiện cảnh báo đã hết" } } } });
    }
  }
}

// ponytail: one scan loads the open plan of the whole workspace into memory (tasks, stages, plan blocks, hour totals).
// Fine for thousands of tasks; page per project if a workspace outgrows it.
export async function runAlertScan(prisma: any, workspaceId: string, options: AlertScanOptions = {}): Promise<AlertScanResult> {
  const now = options.now ?? new Date();
  const [params, triggers, dayOffKeys] = await Promise.all([
    loadParameters(prisma, workspaceId),
    loadAlertTriggers(prisma, workspaceId),
    loadDayOffKeys(prisma, workspaceId, new Date(now.getTime() - 400 * DAY_MS), new Date(now.getTime() + 60 * DAY_MS))
  ]);
  const clock: ScanClock = { now, dayOffKeys, params };
  const enabled = (code: string) => triggers.find((item) => item.code === code)?.enabled === true;
  const result: AlertScanResult = {
    workspaceId, scannedAt: now.toISOString(), projects: 0, opened: {}, refreshed: {}, closed: {},
    skipped: triggers.filter((item) => !item.enabled).map((item) => ({ code: item.code, reason: item.disabledReason ?? "Admin đã tắt điểm kích hoạt" })),
    notifications: { inApp: 0, lark: "không có tin" }
  };

  const projects = (await prisma.project.findMany({ where: { workspaceId }, select: { id: true, name: true, status: true } }))
    .filter((project: any) => !isProjectClosed(project.status));
  const projectIds: string[] = projects.map((project: any) => project.id);
  result.projects = projectIds.length;
  const runningIds = new Set<string>(projects.filter((project: any) => isRunningProject(project.status)).map((project: any) => project.id));

  const [taskRows, stageRows, loggedRows, blockRows, lastLogs, changeRows, handoffRows, before] = await Promise.all([
    prisma.projectTask.findMany({
      where: { workspaceId, projectId: { in: projectIds }, archivedAt: null },
      select: { id: true, projectId: true, title: true, status: true, parentTaskId: true, stageId: true, ownerUserId: true, assigneeUserId: true, dueAt: true, estimateMinutes: true }
    }),
    prisma.projectStage.findMany({
      where: { workspaceId, projectId: { in: projectIds } },
      select: { id: true, projectId: true, activity: true, status: true, ownerUserId: true, milestoneId: true, plannedStartAt: true, plannedEndAt: true, sortOrder: true, createdAt: true, milestone: { select: { sortOrder: true, name: true } },
        slaDays: true, slaPausedAt: true, customerWaitDays: true, actualStartAt: true, actualEndAt: true, changeRequestId: true }
    }),
    prisma.taskTimeEntry.groupBy({ by: ["taskId"], where: { workspaceId, projectId: { in: projectIds }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } }, _sum: { minutes: true } }),
    prisma.taskPlanningBlock.findMany({
      where: { workspaceId, projectId: { in: projectIds }, startAt: { gte: new Date(now.getTime() - 120 * DAY_MS), lt: new Date(now.getTime() + 21 * DAY_MS) } },
      select: { taskId: true, projectId: true, userId: true, startAt: true, plannedMinutes: true, status: true, user: { select: { displayName: true } } }
    }),
    prisma.taskTimeEntry.groupBy({ by: ["taskId", "userId"], where: { workspaceId, projectId: { in: projectIds }, approvalStatus: { notIn: NON_ACTUAL_TIME_ENTRY_STATUSES } }, _max: { workDate: true } }),
    prisma.taskTimelineChangeRequest.findMany({ where: { workspaceId, projectId: { in: projectIds }, status: "PENDING" }, select: { id: true, projectId: true, taskId: true, createdAt: true, reason: true, task: { select: { title: true, stageId: true } } } }),
    prisma.projectMilestone.findMany({ where: { workspaceId, projectId: { in: projectIds }, approvalRequestedAt: { not: null }, reviewerApprovedAt: null }, select: { id: true, projectId: true, name: true, approvalRequestedAt: true, reviewerUserId: true } }),
    prisma.projectWarning.findMany({ where: { workspaceId, status: "open" }, select: { id: true, typeCode: true } })
  ]);

  const logged = new Map<string, number>(loggedRows.map((row: any) => [row.taskId, row._sum?.minutes ?? 0]));
  const tasks: ScanTask[] = taskRows.map((task: any) => ({ ...task, loggedMinutes: logged.get(task.id) ?? 0 }));
  const group = <T extends { projectId: string | null }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) if (row.projectId) map.set(row.projectId, [...(map.get(row.projectId) ?? []), row]);
    return map;
  };
  const tasksByProject = group(tasks);
  const stagesByProject = group(stageRows as ScanStage[]);
  const blocks: ScanPlanBlock[] = blockRows;
  const blocksByProject = group(blocks);
  const lastLogAt = new Map<string, Date>(lastLogs.filter((row: any) => row._max?.workDate).map((row: any) => [`${row.taskId}:${row.userId}`, row._max.workDate]));
  // PM of a project: the one rule of project-visibility.ts (owner of the first stage).
  const pmByProject = new Map<string, string | null>(projects.map((project: any) => [project.id, firstStageOf<any>(stagesByProject.get(project.id) ?? [])?.ownerUserId ?? null]));

  const wanted: WantedWarning[] = [];
  for (const project of projects) {
    const projectTasks = tasksByProject.get(project.id) ?? [];
    const projectStages = stagesByProject.get(project.id) ?? [];
    if (enabled("NL-03")) wanted.push(...evaluateMissingOwners(project, projectTasks, projectStages));
    if (!runningIds.has(project.id)) continue;
    if (enabled("NL-04")) wanted.push(...evaluatePlanWithoutLog(project.id, projectTasks, blocksByProject.get(project.id) ?? [], lastLogAt, clock));
    if (enabled("TD-01")) wanted.push(...evaluateHoursUsed(project.id, projectTasks, projectStages, clock));
    if (enabled("TD-02")) wanted.push(...evaluateOverdueTasks(project.id, projectTasks, clock));
    if (enabled("TD-03")) wanted.push(...evaluateDelayRisk(project.id, projectTasks, projectStages, clock));
  }
  if (enabled("TD-06")) wanted.push(...evaluatePendingPlanChanges(changeRows.map((row: any) => ({ id: row.id, projectId: row.projectId, taskId: row.taskId, taskTitle: row.task?.title ?? row.taskId, stageId: row.task?.stageId ?? null, createdAt: row.createdAt, reason: row.reason })), pmByProject));
  if (enabled("BRI-04")) {
    // V-15: a hand-over file is a gate submission (G1–G8). Projects without gates still use the milestone approval request.
    const submitted: any[] = typeof prisma.projectGate?.findMany === "function"
      ? await prisma.projectGate.findMany({ where: { workspaceId, projectId: { in: projectIds }, status: "submitted", submittedAt: { not: null } }, select: { id: true, projectId: true, milestoneId: true, code: true, submittedAt: true } })
      : [];
    const milestoneName = (milestoneId: string) => (stageRows as any[]).find((stage) => stage.milestoneId === milestoneId)?.milestone?.name;
    wanted.push(...evaluateHandoffReview([
      ...submitted.map((gate) => ({ dedupeKey: `BRI-04:gate:${gate.id}`, milestoneId: gate.milestoneId, projectId: gate.projectId, milestoneName: [gate.code, milestoneName(gate.milestoneId)].filter(Boolean).join(" – "), requestedAt: gate.submittedAt, reviewerUserId: null })),
      ...handoffRows.map((row: any) => ({ milestoneId: row.id, projectId: row.projectId, milestoneName: row.name, requestedAt: row.approvalRequestedAt, reviewerUserId: row.reviewerUserId }))
    ], clock));
  }
  // TD-04 / BRI-05: stage SLA clock and the customer step of the gates. TD-05 is an event trigger: stage-extension.ts owns it.
  const runningStages = (stageRows as any[]).filter((stage) => runningIds.has(stage.projectId) && !stage.changeRequestId);
  const extensionRows = enabled("TD-04") ? await loadStageExtensions(prisma, workspaceId, projectIds) : [];
  const extensionsOf = (stageId: string) => extensionRows.filter((row) => row.stageId === stageId);
  if (enabled("TD-04")) {
    wanted.push(...evaluateStageSla(runningStages.filter((stage) => stage.slaDays != null && stage.actualStartAt && !stage.actualEndAt && !isClosedWorkStatus(stage.status)).map((stage) => {
      // Only a stage that really started has a running clock; a planned start date alone raises no alert.
      const startedAt: Date = stage.actualStartAt;
      // The wait in progress counts too: a stopped clock never becomes delay (V-19).
      const waited = stageSlaState({ slaDays: stage.slaDays, startedAt, pausedAt: stage.slaPausedAt, customerWaitDays: stage.customerWaitDays }, now, dayOffKeys).customerWaitDays;
      return { stageId: stage.id, projectId: stage.projectId, activity: stage.activity, milestoneId: stage.milestoneId, startedAt, slaWorkingDays: stage.slaDays, customerWaitWorkingDays: waited, ownerUserId: stage.ownerUserId, extendedDueAt: extensionsOf(stage.id).at(-1)?.newDueAt ?? null };
    }), clock));
  }
  if (enabled("BRI-05") && typeof prisma.projectGate?.findMany === "function") {
    const waiting: any[] = await prisma.projectGate.findMany({ where: { workspaceId, projectId: { in: projectIds }, status: "awaiting_customer", customerRequestedAt: { not: null } }, select: { projectId: true, milestoneId: true, code: true, customerRequestedAt: true } });
    wanted.push(...evaluateCustomerWait(waiting.map((gate) => ({ milestoneId: gate.milestoneId, projectId: gate.projectId, gate: gate.code, milestoneName: (stageRows as any[]).find((stage) => stage.milestoneId === gate.milestoneId)?.milestone?.name ?? gate.code, sentAt: gate.customerRequestedAt })), clock));
  }
  if (enabled("DL-01")) {
    if (options.loadPendingHours) wanted.push(...evaluatePendingHours(await options.loadPendingHours(workspaceId, projectIds), pmByProject, clock));
    else result.skipped.push({ code: "DL-01", reason: "Lượt quét này không được cấp nguồn giờ Chờ xử lý" });
  }

  const codes = SCAN_OWNED_CODES.filter((code) => enabled(code) && (code !== "DL-01" || Boolean(options.loadPendingHours)));
  const existing = await prisma.projectWarning.findMany({ where: { workspaceId, typeCode: { in: [...codes] } }, include: { events: { orderBy: { at: "asc" } } }, orderBy: { openedAt: "asc" } });

  if (enabled("NL-05")) {
    const names = new Map<string, string>(blockRows.map((row: any) => [row.userId, row.user?.displayName ?? row.userId]));
    const openByKey = new Map<string, string>(existing.filter((warning: any) => warning.typeCode === "NL-05" && warning.status === "open").map((warning: any) => [warning.dedupeKey, warning.projectId]));
    for (const item of evaluateOverCapacity(blocks.filter((block) => block.projectId && runningIds.has(block.projectId)), names, clock)) {
      const { projectIds: candidates, ...warning } = item;
      // Keep an already open record on its project while that project is still part of the person's plan.
      const current = openByKey.get(warning.dedupeKey);
      wanted.push({ ...warning, projectId: current && candidates.includes(current) ? current : warning.projectId });
    }
  }
  // A warning without a named person belongs to the project's PM (V-34 "người chịu trách nhiệm").
  for (const warning of wanted) warning.ownerUserId = warning.ownerUserId ?? pmByProject.get(warning.projectId) ?? null;

  // Warnings of a project that has since been closed are left alone: only scanned projects are reconciled.
  await reconcileWarnings(prisma, { workspaceId, codes, wanted, existing: existing.filter((warning: any) => projectIds.includes(warning.projectId)), triggers, clock }, result);

  for (const warning of before) if (RETIRED_TRIGGER_CODES.includes(warning.typeCode)) bump(result.closed, warning.typeCode);
  await closeProjectWarnings(prisma, { workspaceId, typeCode: { in: RETIRED_TRIGGER_CODES } }, null, "Loại cảnh báo đã bỏ khỏi danh mục");
  // BRI-02 (overdue) is a function of the clock: re-evaluate every open issue-log record.
  if (ISSUE_LOG_CODES.some(enabled)) for (const projectId of projectIds) await refreshProjectIssueLogWarnings(prisma, workspaceId, projectId, now);
  const after = await prisma.projectWarning.findMany({ where: { workspaceId, status: "open" }, select: { id: true, typeCode: true } });
  const beforeIds = new Set(before.map((warning: any) => warning.id));
  const afterIds = new Set(after.map((warning: any) => warning.id));
  for (const warning of after) if (!beforeIds.has(warning.id) && ISSUE_LOG_CODES.includes(warning.typeCode)) bump(result.opened, warning.typeCode);
  for (const warning of before) if (!afterIds.has(warning.id) && ISSUE_LOG_CODES.includes(warning.typeCode)) bump(result.closed, warning.typeCode);
  // After the warnings are reconciled: the status proposal reads them ("cảnh báo nguy cơ chậm mức Cao") and the overdue tasks.
  if (options.syncProjectStatus) for (const projectId of projectIds) await options.syncProjectStatus(projectId);

  if (options.notify !== false) result.notifications = await sendAlertNotifications(prisma, workspaceId, { now, triggers, pmByProject, projectNames: new Map(projects.map((project: any) => [project.id, project.name])), deliverLark: options.deliverLark, createNotification: options.createNotification });
  return result;
}

/** V-36 / V-37: one merged message per recipient and group for everything this scan has to announce. */
export async function sendAlertNotifications(
  prisma: any,
  workspaceId: string,
  input: { now: Date; triggers: readonly AlertTriggerDef[]; pmByProject: ReadonlyMap<string, string | null>; projectNames: ReadonlyMap<string, string>; deliverLark?: typeof deliverLarkAlert; createNotification?: AlertScanOptions["createNotification"] }
): Promise<AlertScanResult["notifications"]> {
  const [warnings, admins] = await Promise.all([
    // Open warnings, and closures of the last week that may still need their one "closed" message.
    prisma.projectWarning.findMany({ where: { workspaceId, OR: [{ status: "open" }, { closedAt: { gte: new Date(input.now.getTime() - 7 * DAY_MS) } }] }, include: { events: { orderBy: { at: "asc" } } } }),
    prisma.user.findMany({
      where: { status: "ACTIVE", subjectType: "INTERNAL_USER", roleBindings: { some: { workspaceId, ...activeMembershipWhere(input.now), role: { code: { in: ADMIN_ROLE_CODES } } } } },
      select: { id: true }
    })
  ]);
  const adminUserIds = admins.map((user: any) => user.id);
  const pending: PendingAlert[] = [];
  for (const warning of warnings) {
    const trigger = input.triggers.find((item) => item.code === warning.typeCode);
    // Not in the catalogue or switched off: on screen only. So is tier "screen_only".
    if (!trigger?.enabled || trigger.tier === "screen_only" || !input.projectNames.has(warning.projectId)) continue;
    const reason = notifyReason(warning, input.now);
    if (!reason) continue;
    pending.push({
      warningId: warning.id, projectId: warning.projectId, projectName: input.projectNames.get(warning.projectId)!, typeCode: warning.typeCode, title: warning.title, severity: warning.severity, reason, trigger,
      recipientUserIds: resolveRecipients(trigger.recipients, { ownerUserId: warning.ownerUserId, pmUserId: input.pmByProject.get(warning.projectId), adminUserIds })
    });
  }
  if (!pending.length) return { inApp: 0, lark: "không có tin" };

  const scanKey = input.now.toISOString();
  let inApp = 0;
  const larkStatuses = new Set<string>();
  for (const message of mergeAlerts(pending)) {
    if (message.recipientUserId === null) {
      larkStatuses.add(await (input.deliverLark ?? deliverLarkAlert)(message));
      continue;
    }
    const notification: ProjectWarningNotification = {
      workspaceId, recipientUserId: message.recipientUserId, title: message.title, body: message.body, href: message.href, warningId: message.alerts[0].warningId,
      dedupeKey: `project-warning:${scanKey}:${message.bucket}:${message.recipientUserId}`,
      data: { projectId: message.alerts[0].projectId, projectName: message.alerts[0].projectName, warningIds: message.alerts.map((alert) => alert.warningId), bucket: message.bucket }
    };
    if (input.createNotification) await input.createNotification(notification);
    else {
      const { warningId, ...content } = notification;
      await prisma.appNotification.create({ data: { ...content, kind: "project_warning", entityType: "project_warning", entityId: warningId, status: "pending" } });
    }
    inApp += 1;
  }
  const lark = [...larkStatuses].join("; ") || "không có tin";
  // Recorded only after the messages went out, so a failed scan announces again next time instead of staying silent.
  for (const alert of pending) {
    await prisma.projectWarningEvent.create({ data: { warningId: alert.warningId, action: NOTIFIED_ACTION, note: `${alert.reason}|${alert.severity}|${alert.recipientUserIds.length} người nhận trong ứng dụng; Lark: ${lark}`, at: input.now } });
  }
  return { inApp, lark };
}

/** The scan of a calendar day: skipped on a weekend or workspace day off unless forced (an Admin pressing "Quét ngay"). */
export async function shouldScanToday(prisma: any, workspaceId: string, now = new Date()): Promise<boolean> {
  return isWorkingDay(localDateKey(now), await loadDayOffKeys(prisma, workspaceId, new Date(now.getTime() - DAY_MS), new Date(now.getTime() + DAY_MS)));
}
