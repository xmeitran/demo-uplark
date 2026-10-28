import type {
  ProjectActivitySummary,
  ProjectDocumentSummary,
  EmploymentStatus,
  ProjectStageSummary,
  ProjectSummary,
  ProjectTaskSummary,
  TaskAttachmentSummary,
  TaskCommentSummary,
  TaskPlanningBlockSummary,
  TaskTimeEntrySummary
} from "@b2b-crm/contracts";
import { toIso, toMoneyNumber } from "../../shared/http/request-context";
import { deriveTaskStatus } from "./task-status";
import { sumActualMinutes } from "./member-participation";
import { normalizeProjectStatus, projectStatusLabel } from "./project-status";
import { isInternalWorklogProjectType, isLayer2Mismatch } from "./task-classification";
export function mapProjectSummary(project: any): ProjectSummary {
  const tasks = project.tasks ?? [];
  const stages = project.stages ?? [];
  const members = uniqueProjectMembers(project.members ?? []);
  const memberTaskStats = buildProjectMemberTaskStats(tasks);
  const activeBudget = project.budgets?.[0];
  const completedTaskCount = tasks.filter((task: any) => deriveTaskStatus({
    rawStatus: task.status,
    plannedStartAt: task.plannedStartAt,
    dueAt: task.dueAt,
    estimateMinutes: task.estimateMinutes,
    loggedMinutes: sumActualMinutes(task.timeEntries),
    timeEntries: task.timeEntries
  }) === "completed").length;
  const plannedMinutes = tasks.reduce((sum: number, task: any) => sum + Number(task.estimateMinutes ?? 0), 0);
  const loggedMinutes = tasks.reduce((sum: number, task: any) => sum + sumActualMinutes(task.timeEntries), 0);
  const approvedMinutes = tasks.reduce((sum: number, task: any) => sum + sumMinutes(
    (task.timeEntries ?? []).filter((entry: any) => normalizeTaskTimeEntryApprovalStatus(entry.approvalStatus) === "approved")
  ), 0);
  const activeStageCount = stages.filter((stage: any) => ["in_progress", "active"].includes(stage.status)).length;
  const firstStage = stages[0];
  const spentAmount = (project.costs ?? []).reduce((sum: number, cost: any) => sum + (toMoneyNumber(cost.amount) ?? 0), 0);
  const progressCandidates = stages
    .map((stage: any) => Number(stage.progressPercent || stage.cumulativePercent || 0))
    .filter((value: number) => Number.isFinite(value) && value > 0);
  const progressPercent = tasks.length > 0
    ? Math.round((completedTaskCount / tasks.length) * 100)
    : progressCandidates.length > 0
      ? Math.max(...progressCandidates)
      : undefined;
  const startCandidates = stages
    .map((stage: any) => stage.actualStartAt ?? stage.plannedStartAt)
    .filter(Boolean)
    .map((value: Date | string) => new Date(value));
  const endCandidates = stages
    .map((stage: any) => stage.actualEndAt ?? stage.plannedEndAt)
    .filter(Boolean)
    .map((value: Date | string) => new Date(value));

  return {
    id: project.id,
    accountId: project.accountId,
    accountName: project.account?.name ?? "",
    opportunityId: project.opportunityId ?? undefined,
    opportunityTitle: project.opportunity?.title ?? undefined,
    opportunityStage: project.opportunity?.stage ?? undefined,
    code: project.code,
    name: project.name,
    status: project.status,
    statusCode: normalizeProjectStatus(project.status) ?? undefined,
    statusLabel: projectStatusLabel(project.status),
    projectType: project.projectType ?? project.opportunity?.stage ?? "delivery",
    scopeSummary: project.scopeSummary ?? firstStage?.scopeSummary ?? undefined,
    marginPercent: toMoneyNumber(project.marginPercent),
    priority: project.priority ?? undefined,
    tags: project.tags ?? [],
    color: project.color ?? undefined,
    ownerUserId: firstStage?.ownerUserId ?? undefined,
    ownerDisplayName: firstStage?.owner?.displayName ?? undefined,
    ownerAvatarUrl: firstStage?.owner?.avatarUrl ?? undefined,
    memberUserIds: uniqueStrings(members.map((member: any) => member.userId).filter(Boolean)),
    members: members.map((member: any) => ({
      userId: member.userId,
      displayName: member.user?.displayName ?? member.userId,
      email: member.user?.email ?? "",
      avatarUrl: member.user?.avatarUrl ?? undefined,
      relation: member.relation,
      employmentStatus: deriveProjectMemberEmploymentStatus(member.user),
      ...projectMemberTaskStats(memberTaskStats.get(member.userId))
    })),
    budgetAmount: toMoneyNumber(activeBudget?.plannedRevenueAmount),
    spentAmount,
    budgetCurrency: activeBudget?.currency ?? undefined,
    progressPercent,
    taskCount: tasks.length,
    completedTaskCount,
    plannedMinutes,
    loggedMinutes,
    approvedMinutes,
    stageCount: stages.length,
    activeStageCount,
    plannedStartAt: minDateIso(startCandidates),
    plannedEndAt: maxDateIso(endCandidates),
    // The start shown is the actual one once the earliest stage has started; the UI labels it so an edited planned date is not mistaken for unsaved.
    startIsActual: startIsActual(stages) ? true : undefined,
    hierarchyOrderVersion: project.hierarchyOrderVersion ?? 0,
    isTestProject: project.isTestProject === true ? true : undefined,
    milestoneApprovalRequired: project.milestoneApprovalRequired === false ? false : undefined,
    milestoneMode: project.milestoneMode ?? "auto",
    milestoneTemplateKey: project.milestoneTemplateKey ?? undefined,
    isInternalWorklog: isInternalWorklogProjectType(project.projectType) || undefined
  };
}

/** ProjectMember is durable membership; employment state is owned by ResourceProfile. */
export function deriveProjectMemberEmploymentStatus(user: any): EmploymentStatus {
  const profileStatus = String(user?.resourceProfile?.employmentStatus ?? "").trim().toUpperCase();
  if (profileStatus === "ON_LEAVE") return "ON_LEAVE";
  if (profileStatus === "INACTIVE") return "INACTIVE";
  return user?.status === "SUSPENDED" ? "INACTIVE" : "ACTIVE";
}

function buildProjectMemberTaskStats(tasks: any[]) {
  const stats = new Map<string, { assignedTaskCount: number; doneTaskCount: number }>();

  for (const task of tasks) {
    const assignedIds = Array.from(new Set([
      ...(Array.isArray(task.taskAssignees) ? task.taskAssignees.map((row: any) => row.userId).filter(Boolean) : []),
      task.assigneeUserId,
      task.ownerUserId
    ]));
    for (const userId of assignedIds) {
      const current = stats.get(userId) ?? { assignedTaskCount: 0, doneTaskCount: 0 };
      current.assignedTaskCount += 1;
      if (deriveTaskStatus({
        rawStatus: task.status,
        estimateMinutes: task.estimateMinutes,
        loggedMinutes: sumActualMinutes(task.timeEntries)
      }) === "completed") {
        current.doneTaskCount += 1;
      }
      stats.set(userId, current);
    }
  }

  return stats;
}

function projectMemberTaskStats(stats?: { assignedTaskCount: number; doneTaskCount: number }) {
  const assignedTaskCount = stats?.assignedTaskCount ?? 0;
  const doneTaskCount = stats?.doneTaskCount ?? 0;
  return {
    assignedTaskCount,
    doneTaskCount,
    doneTaskPercent: assignedTaskCount > 0 ? Math.round((doneTaskCount / assignedTaskCount) * 100) : 0
  };
}

function minDateIso(values: Date[]) {
  const valid = values.filter((value) => !Number.isNaN(value.getTime()));
  if (valid.length === 0) {
    return undefined;
  }
  return new Date(Math.min(...valid.map((value) => value.getTime()))).toISOString();
}

function maxDateIso(values: Date[]) {
  const valid = values.filter((value) => !Number.isNaN(value.getTime()));
  if (valid.length === 0) {
    return undefined;
  }
  return new Date(Math.max(...valid.map((value) => value.getTime()))).toISOString();
}

function uniqueProjectMembers(members: any[]) {
  const unique = new Map<string, any>();

  for (const member of members) {
    const key = projectMemberIdentity(member);
    if (!key) {
      continue;
    }
    unique.set(key, mergeProjectMember(unique.get(key), member));
  }

  return Array.from(unique.values());
}

function projectMemberIdentity(member: any) {
  return normalizeIdentity(member.userId)
    ?? normalizeIdentity(member.user?.email)
    ?? normalizeIdentity(member.user?.displayName);
}

function mergeProjectMember(existing: any | undefined, incoming: any) {
  if (!existing) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    userId: existing.userId || incoming.userId,
    relation: existing.relation === "member" ? existing.relation : incoming.relation || existing.relation,
    user: {
      ...(incoming.user ?? {}),
      ...(existing.user ?? {}),
      displayName: existing.user?.displayName || incoming.user?.displayName,
      email: existing.user?.email || incoming.user?.email,
      avatarUrl: existing.user?.avatarUrl || incoming.user?.avatarUrl
    }
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeIdentity(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

/** True when the project's start date (earliest of actual ?? planned over its stages) is an actual start. */
export function startIsActual(stages: ReadonlyArray<{ actualStartAt?: Date | string | null; plannedStartAt?: Date | string | null }>): boolean {
  let earliest: { at: number; actual: boolean } | null = null;
  for (const stage of stages) {
    const value = stage.actualStartAt ?? stage.plannedStartAt;
    if (!value) continue;
    const at = new Date(value).getTime();
    if (!earliest || at < earliest.at) earliest = { at, actual: Boolean(stage.actualStartAt) };
  }
  return earliest?.actual ?? false;
}

export function mapProjectStageSummary(stage: any): ProjectStageSummary {
  return {
    id: stage.id,
    accountId: stage.accountId,
    accountName: stage.account?.name ?? "",
    projectId: stage.projectId,
    projectName: stage.project?.name ?? "",
    milestoneId: stage.milestoneId,
    milestoneName: stage.milestone?.name ?? stage.phase,
    milestoneSortOrder: stage.milestone?.sortOrder ?? 0,
    stageKey: stage.stageKey,
    phase: stage.phase,
    activity: stage.activity,
    sortOrder: stage.sortOrder,
    cumulativePercent: stage.cumulativePercent,
    activityPercent: stage.activityPercent,
    criteria: stage.criteria,
    description: stage.description ?? undefined,
    upbaseRole: stage.upbaseRole ?? undefined,
    customerRole: stage.customerRole ?? undefined,
    taskTypeLayer1: stage.taskTypeLayer1 ?? undefined,
    afterPnlClose: stage.afterPnlClose ?? undefined,
    changeRequestId: stage.changeRequestId ?? undefined,
    status: stage.status,
    ownerUserId: stage.ownerUserId ?? undefined,
    ownerDisplayName: stage.owner?.displayName ?? undefined,
    ownerAvatarUrl: stage.owner?.avatarUrl ?? undefined,
    ownerUserIds: Array.from(new Set<string>([stage.ownerUserId, ...(stage.coOwnerUserIds ?? [])].filter(Boolean))),
    plannedStartAt: toIso(stage.plannedStartAt),
    plannedEndAt: toIso(stage.plannedEndAt),
    actualStartAt: toIso(stage.actualStartAt),
    actualEndAt: toIso(stage.actualEndAt),
    acceptanceCriteria: stage.acceptanceCriteria ?? undefined,
    blockerSummary: stage.blockerSummary ?? undefined,
    scopeSummary: stage.scopeSummary ?? undefined,
    standardMinutes: stage.standardMinutes ?? undefined,
    progressPercent: stage.progressPercent,
    createdAt: toIso(stage.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(stage.updatedAt) ?? new Date().toISOString()
  };
}

export function mapProjectDocumentSummary(artifact: any): ProjectDocumentSummary {
  const versions = (artifact.versions ?? []).map((version: any) => ({
    id: version.id,
    version: version.version,
    note: version.note ?? undefined,
    fileObjectId: version.fileObjectId,
    file: mapFileObjectSummary(version.fileObject),
    createdByUserId: version.createdByUserId ?? undefined,
    createdByDisplayName: version.createdBy?.displayName ?? undefined,
    createdAt: toIso(version.createdAt) ?? new Date().toISOString()
  }));

  return {
    id: artifact.id,
    accountId: artifact.accountId,
    accountName: artifact.account?.name ?? "",
    projectId: artifact.projectId ?? "",
    projectName: artifact.project?.name ?? "",
    milestoneId: artifact.milestoneId ?? undefined,
    milestoneName: artifact.milestone?.name ?? undefined,
    code: artifact.code,
    name: artifact.name,
    artifactType: artifact.artifactType,
    storageKey: artifact.storageKey,
    customerVisible: artifact.customerVisible,
    internalOnly: artifact.internalOnly,
    allowedRoles: artifact.allowedRoles ?? [],
    signedUrlExpiresSeconds: artifact.signedUrlExpiresSeconds,
    versions,
    latestVersion: versions[versions.length - 1],
    createdAt: toIso(artifact.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(artifact.updatedAt) ?? new Date().toISOString()
  };
}

export function mapProjectActivitySummary(activity: any): ProjectActivitySummary {
  return {
    id: activity.id,
    accountId: activity.accountId,
    accountName: activity.account?.name ?? "",
    projectId: activity.projectId,
    projectName: activity.project?.name ?? "",
    activityType: activity.activityType,
    subject: activity.subject,
    note: activity.note ?? undefined,
    target: activity.target ?? undefined,
    occurredAt: toIso(activity.occurredAt) ?? new Date().toISOString(),
    occurredTime: activity.occurredTime ?? undefined,
    actionLabel: activity.actionLabel ?? undefined,
    fromValue: activity.fromValue ?? undefined,
    toValue: activity.toValue ?? undefined,
    entityType: activity.entityType ?? undefined,
    entityId: activity.entityId ?? undefined,
    status: activity.status,
    createdByUserId: activity.createdByUserId ?? undefined,
    createdByDisplayName: activity.createdBy?.displayName ?? undefined,
    createdByAvatarUrl: activity.createdBy?.avatarUrl ?? undefined,
    createdAt: toIso(activity.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(activity.updatedAt) ?? new Date().toISOString()
  };
}

export function mapTaskSummary(task: any): ProjectTaskSummary {
  const loggedMinutes = sumActualMinutes(task.timeEntries);
  const approvedMinutes = sumMinutes((task.timeEntries ?? []).filter((entry: any) => normalizeTaskTimeEntryApprovalStatus(entry.approvalStatus) === "approved"));
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks.map(mapTaskSummary) : undefined;
  const derivedStatus = deriveTaskStatus({
    rawStatus: task.status,
    plannedStartAt: task.plannedStartAt,
    dueAt: task.dueAt,
    estimateMinutes: task.estimateMinutes,
    loggedMinutes,
    timeEntries: task.timeEntries,
    subtasks: subtasks?.map((subtask: ProjectTaskSummary) => ({ derivedStatus: subtask.derivedStatus, status: subtask.status }))
  });
  const assignees: Array<{ userId: string; displayName?: string; avatarUrl?: string }> = Array.from(new Map<string, { userId: string; displayName?: string; avatarUrl?: string }>([
    ...(Array.isArray(task.taskAssignees) ? task.taskAssignees
      .filter((row: any) => row?.userId)
      .sort((a: any, b: any) => Number(b?.isPrimary ?? false) - Number(a?.isPrimary ?? false))
      .map((row: any) => [row.userId, {
        userId: row.userId,
        displayName: row.user?.displayName ?? undefined,
        avatarUrl: row.user?.avatarUrl ?? undefined
      }] as const) : []),
    ...(task.assigneeUserId ? [[task.assigneeUserId, {
      userId: task.assigneeUserId,
      displayName: task.assignee?.displayName ?? undefined,
      avatarUrl: task.assignee?.avatarUrl ?? undefined
    }] as const] : [])
  ]).values());

  return {
    id: task.id,
    accountId: task.accountId,
    accountName: task.account?.name ?? "",
    projectId: task.projectId ?? undefined,
    projectName: task.project?.name ?? undefined,
    stageId: task.stageId ?? undefined,
    stageKey: task.stage?.stageKey ?? undefined,
    stageActivity: task.stage?.activity ?? undefined,
    milestoneId: task.stage?.milestoneId ?? task.stage?.milestone?.id ?? undefined,
    milestoneName: task.stage?.milestone?.name ?? undefined,
    opportunityId: task.opportunityId ?? undefined,
    ticketId: task.ticketId ?? undefined,
    parentTaskId: task.parentTaskId ?? undefined,
    sortOrder: task.sortOrder ?? 10,
    attachmentCount: task._count?.attachments,
    title: task.title,
    description: task.description ?? undefined,
    taskType: task.taskType,
    taskTypeLayer1: task.taskTypeLayer1 ?? undefined,
    taskTypeLayer2: task.taskTypeLayer2 ?? undefined,
    status: task.status,
    derivedStatus,
    priority: task.priority,
    ownerUserId: task.ownerUserId ?? undefined,
    ownerDisplayName: task.owner?.displayName ?? undefined,
    ownerAvatarUrl: task.owner?.avatarUrl ?? undefined,
    assigneeUserId: task.assigneeUserId ?? undefined,
    assigneeDisplayName: task.assignee?.displayName ?? undefined,
    assigneeAvatarUrl: task.assignee?.avatarUrl ?? undefined,
    assigneeUserIds: assignees.map((assignee: any) => assignee.userId),
    assignees,
    ownerTeamId: task.ownerTeamId ?? undefined,
    ownerTeamName: task.ownerTeam?.name ?? undefined,
    plannedStartAt: toIso(task.plannedStartAt),
    dueAt: toIso(task.dueAt),
    startedAt: toIso(task.startedAt),
    completedAt: toIso(task.completedAt),
    cancelledAt: toIso(task.cancelledAt),
    estimateMinutes: task.estimateMinutes,
    loggedMinutes,
    approvedMinutes,
    archivedAt: toIso(task.archivedAt),
    archivedByUserId: task.archivedByUserId ?? undefined,
    archiveReason: task.archiveReason ?? undefined,
    overdue: derivedStatus === "overdue" && !task.archivedAt,
    cycleTimeDays: cycleTimeDays(task.startedAt, task.completedAt),
    customerVisible: task.customerVisible,
    createdAt: toIso(task.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(task.updatedAt) ?? new Date().toISOString(),
    statusHistory: (task.statusHistory ?? []).map((history: any) => ({
      id: history.id,
      taskId: history.taskId,
      accountId: history.accountId,
      projectId: history.projectId ?? undefined,
      fromStatus: history.fromStatus ?? undefined,
      toStatus: history.toStatus,
      changedByUserId: history.changedByUserId ?? undefined,
      changedAt: toIso(history.changedAt) ?? new Date().toISOString(),
      reason: history.reason ?? undefined
    })),
    timeEntries: (task.timeEntries ?? []).map(mapTaskTimeEntrySummary),
    planningBlocks: Array.isArray(task.planningBlocks)
      ? task.planningBlocks.map(mapTaskPlanningBlockSummary)
      : undefined,
    subtasks
  };
}

export function mapTaskTimeEntrySummary(entry: any): TaskTimeEntrySummary {
  const approvalStatus = normalizeTaskTimeEntryApprovalStatus(entry.approvalStatus);
  const dayOff = entry.dayOff as { id?: string; date?: Date | string; name?: string; isActive?: boolean } | null | undefined;
  const dayOffDate = dayOff?.date ? new Date(dayOff.date).toISOString().slice(0, 10) : undefined;
  const dayOffStartAt = dayOffDate
    ? new Date(new Date(`${dayOffDate}T00:00:00.000Z`).getTime() - 7 * 60 * 60 * 1000)
    : undefined;
  const dayOffEndAt = dayOffStartAt ? new Date(dayOffStartAt.getTime() + 24 * 60 * 60 * 1000) : undefined;
  const entryStartAt = entry.startAt ? new Date(entry.startAt) : undefined;
  const entryEndAt = entry.endAt
    ? new Date(entry.endAt)
    : entryStartAt
      ? new Date(entryStartAt.getTime() + Number(entry.minutes ?? 0) * 60_000)
      : undefined;
  const entryLocalDate = new Date(new Date(entry.workDate).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const billingExempt = Boolean(dayOff?.isActive && dayOffDate && dayOffStartAt && dayOffEndAt && (
    entryStartAt && entryEndAt
      ? entryStartAt < dayOffEndAt && entryEndAt > dayOffStartAt
      : entryLocalDate === dayOffDate
  ));

  return {
    id: entry.id,
    taskId: entry.taskId,
    accountId: entry.accountId,
    accountName: entry.account?.name ?? entry.task?.account?.name ?? undefined,
    projectId: entry.projectId ?? undefined,
    projectName: entry.project?.name ?? entry.task?.project?.name ?? undefined,
    taskTitle: entry.task?.title ?? undefined,
    taskStatus: entry.task?.status ?? undefined,
    taskEstimateMinutes: entry.task?.estimateMinutes ?? undefined,
    userId: entry.userId,
    userDisplayName: entry.user?.displayName ?? undefined,
    userEmail: entry.user?.email ?? undefined,
    userAvatarUrl: entry.user?.avatarUrl ?? undefined,
    workDate: toIso(entry.workDate) ?? new Date().toISOString(),
    startAt: toIso(entry.startAt) ?? undefined,
    endAt: toIso(entry.endAt) ?? undefined,
    timeZone: entry.timeZone ?? undefined,
    minutes: entry.minutes,
    billable: Boolean(entry.billable) && !billingExempt,
    billingExemptReason: billingExempt ? "workspace_day_off" : undefined,
    dayOffName: billingExempt ? dayOff?.name : undefined,
    dayOffDate: billingExempt ? dayOffDate : undefined,
    workType: entry.workType,
    approvalStatus,
    note: entry.note ?? undefined,
    reviewedByUserId: entry.reviewedByUserId ?? undefined,
    reviewedByDisplayName: entry.reviewedBy?.displayName ?? undefined,
    reviewedAt: toIso(entry.reviewedAt),
    reviewNote: entry.reviewNote ?? undefined,
    sourcePlanningBlockId: entry.sourcePlanningBlockId ?? undefined,
    taskTypeLayer1: entry.taskTypeLayer1 ?? undefined,
    taskTypeLayer2: entry.taskTypeLayer2 ?? undefined,
    selectedTaskTypeLayer2: entry.selectedTaskTypeLayer2 ?? undefined,
    layer2Mismatch: isLayer2Mismatch(entry.selectedTaskTypeLayer2, entry.taskTypeLayer2) ? true : undefined,
    loggedWhileOnHold: entry.loggedWhileOnHold === true ? true : undefined,
    beforeEightHourRule: entry.beforeEightHourRule === true ? true : undefined,
    createdAt: toIso(entry.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(entry.updatedAt) ?? new Date().toISOString()
  };
}

export function mapTaskPlanningBlockSummary(block: any): TaskPlanningBlockSummary {
  return {
    id: block.id,
    taskId: block.taskId,
    accountId: block.accountId,
    accountName: block.account?.name ?? undefined,
    projectId: block.projectId ?? undefined,
    projectName: block.project?.name ?? undefined,
    userId: block.userId,
    userDisplayName: block.user?.displayName ?? undefined,
    userEmail: block.user?.email ?? undefined,
    userAvatarUrl: block.user?.avatarUrl ?? undefined,
    title: block.title,
    notes: block.notes ?? undefined,
    startAt: toIso(block.startAt) ?? new Date().toISOString(),
    endAt: toIso(block.endAt) ?? new Date().toISOString(),
    plannedMinutes: block.plannedMinutes,
    billable: block.billable ?? true,
    workType: block.workType ?? "delivery",
    status: block.status,
    source: block.source,
    createdByUserId: block.createdByUserId ?? undefined,
    createdAt: toIso(block.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(block.updatedAt) ?? new Date().toISOString()
  };
}

export function mapTaskCommentSummary(comment: any): TaskCommentSummary {
  return {
    id: comment.id,
    taskId: comment.taskId,
    accountId: comment.accountId,
    projectId: comment.projectId ?? undefined,
    parentCommentId: comment.parentCommentId ?? undefined,
    body: comment.body,
    visibility: comment.visibility,
    status: comment.status,
    larkTaskGuid: comment.larkTaskGuid ?? undefined,
    larkCommentId: comment.larkCommentId ?? undefined,
    syncStatus: comment.syncStatus,
    syncError: comment.syncError ?? undefined,
    createdByUserId: comment.createdByUserId ?? undefined,
    createdByDisplayName: comment.createdBy?.displayName ?? undefined,
    createdByAvatarUrl: comment.createdBy?.avatarUrl ?? undefined,
    createdAt: toIso(comment.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(comment.updatedAt) ?? new Date().toISOString()
  };
}

export function mapTaskAttachmentSummary(attachment: any): TaskAttachmentSummary {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    accountId: attachment.accountId,
    projectId: attachment.projectId ?? undefined,
    fileObjectId: attachment.fileObjectId,
    commentId: attachment.commentId ?? undefined,
    larkTaskGuid: attachment.larkTaskGuid ?? undefined,
    larkAttachmentToken: attachment.larkAttachmentToken ?? undefined,
    syncStatus: attachment.syncStatus,
    syncError: attachment.syncError ?? undefined,
    file: mapFileObjectSummary(attachment.fileObject),
    createdByUserId: attachment.createdByUserId ?? undefined,
    createdAt: toIso(attachment.createdAt) ?? new Date().toISOString()
  };
}

function sumMinutes(entries?: Array<{ minutes: number }>) {
  return (entries ?? []).reduce((sum, entry) => sum + entry.minutes, 0);
}

function normalizeTaskTimeEntryApprovalStatus(status: unknown) {
  const normalized = typeof status === "string" ? status.toLowerCase().replace(/[\s-]+/g, "_") : "";
  return normalized === "done" ? "approved" : normalized || "approved";
}

function mapFileObjectSummary(file: any) {
  return {
    id: file.id,
    accountId: file.accountId,
    projectId: file.projectId ?? undefined,
    fileName: file.fileName,
    contentType: file.contentType,
    byteSize: file.byteSize,
    checksumSha256: file.checksumSha256,
    storageProvider: file.storageProvider,
    externalUrl: file.externalUrl ?? undefined,
    ownerType: file.ownerType,
    ownerId: file.ownerId ?? undefined,
    customerVisible: file.customerVisible,
    internalOnly: file.internalOnly,
    allowedRoles: file.allowedRoles ?? [],
    scanStatus: file.scanStatus,
    status: file.status,
    createdAt: toIso(file.createdAt) ?? new Date().toISOString(),
    revokedAt: toIso(file.revokedAt),
    deletedAt: toIso(file.deletedAt)
  };
}

function cycleTimeDays(startedAt?: Date | string | null, completedAt?: Date | string | null) {
  if (!startedAt || !completedAt) {
    return undefined;
  }

  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) {
    return undefined;
  }

  return Math.round(((completed - started) / (1000 * 60 * 60 * 24)) * 10) / 10;
}
