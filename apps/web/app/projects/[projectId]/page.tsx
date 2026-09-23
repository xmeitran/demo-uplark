"use client";
import { useProjectPeople } from "@/hooks/use-project-people";
import { MoneyAmount } from "@/components/money-amount";


import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Edit3, MoreHorizontal, Plus, Calendar, Users,
  Check, CheckCircle2, Clock, AlertCircle, Flag,
  MessageSquare, BarChart2, TrendingUp, Wallet, Layers, ChevronRight, ChevronLeft,
  ListChecks, FileText, GitBranch, Download, UserPlus,
  Target, X, ChevronDown, ChevronUp, Activity,
  Trash2, Pencil, Pin, History, Search, Upload, Paperclip
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PROJECT_TAB_NAV_EVENT } from "@/components/constructor-x/sidebar";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CustomDropdown, CustomDatePicker } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import { useAuth } from "@/lib/auth";
import type { Project } from "../data";
import {
  fetchLiveProjectById as fetchLiveProjectSummaryById,
  mapProjectSummaryToUiProject,
  readLiveProjectSnapshot,
  clearLiveProjectSnapshotCache
} from "../live-projects";
import {
  getPushedProjectsOwnerKey,
  readPushedProjectIds,
  writePushedProjectIds,
} from "@/lib/frontend-data-store";
import type {
  ProjectActivitySummary,
  FileObjectSummary,
  ProjectDocumentSummary,
  ProjectRiskSummary,
  ProjectStageSummary,
  ProjectSummary,
  ProjectTaskSummary,
  ResourceListResponse,
  TaskTimeEntrySummary
} from "@b2b-crm/contracts";
import {
  fetchWorkspaceUserOptions,
  isUnauthorizedWorkspaceUsersError,
  type WorkspaceUserOption
} from "@/lib/workspace-users";
import { formatVietnamTime, VIETNAM_TIME_ZONE, VIETNAM_TIME_ZONE_LABEL } from "@/lib/vietnam-time";
import { hasAnyAuthRole } from "@/lib/auth-role";
import { formatProjectDateRange } from "@/lib/project-date";
import {
  alignItemsToOrder,
  buildHierarchyOrderInput,
  createHierarchyOrderCoordinator,
  isSortableTopLevelTask
} from "@/features/project-hierarchy/hierarchy-order";
import { putProjectHierarchyOrder } from "@/features/project-hierarchy/hierarchy-order-client";
import {
  HierarchyDragHandle,
  HierarchySortableList,
  type SortHandleProps
} from "@/features/project-hierarchy/hierarchy-sortable";
import type { ProjectHierarchyOrderKind } from "@b2b-crm/contracts";

const ACTIVITY_PAGE_SIZE = 10;

function ProjectDateRange({
  startDate,
  dueDate,
  fallback = "Not set",
  className = ""
}: {
  startDate?: string | null;
  dueDate?: string | null;
  fallback?: string;
  className?: string;
}) {
  const label = formatProjectDateRange(startDate, dueDate, fallback);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 font-mono tabular-nums ${className}`} title={label}>
      <Calendar aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function HierarchyStaticList({
  ids,
  hierarchyKind,
  label,
  listClassName,
  renderItem
}: {
  ids: readonly string[];
  hierarchyKind: ProjectHierarchyOrderKind;
  label: string;
  listClassName?: string;
  renderItem: (id: string) => React.ReactNode;
}) {
  return (
    <div
      role="list"
      aria-label={label}
      data-hierarchy-kind={hierarchyKind}
      className={listClassName}
    >
      {ids.map((id) => (
        <div
          key={id}
          role="listitem"
          data-hierarchy-kind={hierarchyKind}
          data-hierarchy-id={id}
        >
          {renderItem(id)}
        </div>
      ))}
    </div>
  );
}

const PROJECT_NOT_FOUND: Project = {
  id: "__project_not_found__",
  name: "Project not found",
  description: "",
  status: "On Hold",
  priority: "Low",
  progress: 0,
  budget: 1,
  spent: 0,
  startDate: "",
  dueDate: "",
  members: [],
  tasks: { total: 0, done: 0 },
  client: "",
  color: "#64748b",
  tags: [],
  category: "Unknown"
};

async function fetchLiveProjectById(projectId: string, signal?: AbortSignal, cacheScope?: string): Promise<Project | null> {
  return fetchLiveProjectSummaryById(projectId, { signal, cacheScope });
}

async function fetchLiveProjectWorkItems(projectId: string, signal?: AbortSignal) {
  const [stagesResponse, taskSummaries] = await Promise.all([
    fetch(`/api/projects/${encodeURIComponent(projectId)}/stages`, {
      cache: "no-store",
      credentials: "same-origin",
      signal
    }),
    fetchAllProjectTasks(projectId, signal)
  ]);

  if (stagesResponse.status === 401) {
    throw new LiveProjectDetailError("Unauthorized", 401);
  }

  if (!stagesResponse.ok) {
    throw new LiveProjectDetailError(`Could not load project stages: ${stagesResponse.status}`, stagesResponse.status);
  }

  const stagesPayload = (await stagesResponse.json()) as ResourceListResponse<ProjectStageSummary>;
  return mapProjectWorkItems(stagesPayload.data, taskSummaries);
}

async function fetchAllProjectTasks(projectId: string, signal?: AbortSignal) {
  const tasks: ProjectTaskSummary[] = [];
  const limit = 200;
  let offset = 0;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}&limit=${limit}&offset=${offset}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal
    });

    if (response.status === 401) {
      throw new LiveProjectDetailError("Unauthorized", 401);
    }

    if (!response.ok) {
      throw new LiveProjectDetailError(`Could not load project tasks: ${response.status}`, response.status);
    }

    const payload = (await response.json()) as ResourceListResponse<ProjectTaskSummary>;
    tasks.push(...payload.data);
    const pagination = payload.meta.pagination;
    hasNextPage = Boolean(pagination?.hasNextPage);
    offset += pagination?.returned ?? payload.data.length;

    if (!pagination || payload.data.length === 0) {
      hasNextPage = false;
    }
  }

  return tasks;
}

async function fetchProjectOperationalRecords(projectId: string, signal?: AbortSignal) {
  const [documentsPayload, activityPayload, risksPayload] = await Promise.all([
    fetchProjectResource<ProjectDocumentSummary>(projectId, "documents", signal),
    fetchProjectResource<ProjectActivitySummary>(projectId, "activity", signal),
    fetchProjectResource<ProjectRiskSummary>(projectId, "risks", signal)
  ]);

  return {
    documents: documentsPayload.data.map(mapProjectDocumentToDoc),
    activityLog: activityPayload.data.map(mapProjectActivityToLogItem),
    risks: risksPayload.data.map(mapProjectRiskToRiskItem)
  };
}

async function fetchProjectResource<T>(projectId: string, resource: "documents" | "activity" | "risks", signal?: AbortSignal) {
  const limit = resource === "activity" ? 10 : 100;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${resource}?limit=${limit}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });

  if (response.status === 401) {
    throw new LiveProjectDetailError("Unauthorized", 401);
  }

  if (!response.ok) {
    throw new LiveProjectDetailError(`Could not load project ${resource}: ${response.status}`, response.status);
  }

  return (await response.json()) as ResourceListResponse<T>;
}

class LiveProjectDetailError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LiveProjectDetailError";
  }
}

type ProjectTeamMember = {
  id: string;
  initials: string;
  name: string;
  email: string;
  role: string;
  department?: string;
  color: string;
  tasks: number;
  done: number;
  status: "active";
  avatarUrl?: string;
};

const EMPTY_TEAM_MEMBERS: ProjectTeamMember[] = [];
const UNASSIGNED_TASKS_MILESTONE_ID = "__unassigned_tasks__";
const UNASSIGNED_TASKS_STAGE_ID = "__unassigned_stage__";

function isUnassignedTasksMilestoneId(milestoneId: string) {
  return milestoneId === UNASSIGNED_TASKS_MILESTONE_ID;
}

function isUnassignedTasksStageId(stageId: string) {
  return stageId === UNASSIGNED_TASKS_STAGE_ID;
}

function stageIdForTaskMutation(stageId: string) {
  return isUnassignedTasksStageId(stageId) ? null : stageId;
}

function toProjectTeamMemberFromProjectMember(member: Project["members"][number]): ProjectTeamMember {
  const identity = member.id || member.email || member.name || member.initials;
  return {
    id: identity,
    initials: member.initials,
    name: member.name || member.email || member.initials,
    email: member.email || "",
    role: "Project member",
    color: member.color,
    tasks: member.assignedTaskCount ?? 0,
    done: member.doneTaskCount ?? 0,
    status: "active",
    avatarUrl: member.avatarUrl
  };
}

function toProjectTeamMember(user: WorkspaceUserOption): ProjectTeamMember {
  return {
    id: user.id,
    initials: user.initials,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    color: user.color,
    tasks: 0,
    done: 0,
    status: "active",
    avatarUrl: user.avatarUrl
  };
}

function mergeTeamMembers(projectMembers: ProjectTeamMember[], workspaceMembers: ProjectTeamMember[]) {
  const hydratedMembers = projectMembers.map((projectMember) => {
    const keys = teamMemberStrongIdentityKeys(projectMember);
    const workspaceMember = workspaceMembers.find((member) => {
      const workspaceKeys = teamMemberStrongIdentityKeys(member);
      return keys.some((key) => workspaceKeys.includes(key));
    });

    return workspaceMember
      ? {
          ...projectMember,
          id: projectMember.id,
          initials: workspaceMember.initials || projectMember.initials,
          name: workspaceMember.name || projectMember.name,
          email: workspaceMember.email || projectMember.email,
          role: workspaceMember.role || projectMember.role,
          department: workspaceMember.department || projectMember.department,
          tasks: projectMember.tasks,
          done: projectMember.done,
          avatarUrl: projectMember.avatarUrl || workspaceMember.avatarUrl,
          color: projectMember.color || workspaceMember.color
        }
      : projectMember;
  });
  return dedupeTeamMembers(hydratedMembers);
}

function dedupeTeamMembers(members: ProjectTeamMember[]) {
  const entries: Array<{ keys: Set<string>; member: ProjectTeamMember }> = [];

  for (const member of members) {
    const keys = teamMemberIdentityKeys(member);
    const existing = entries.find((entry) => keys.some((key) => entry.keys.has(key)));
    if (existing) {
      existing.member = mergeTeamMemberRecords(existing.member, member);
      teamMemberIdentityKeys(existing.member).forEach((key) => existing.keys.add(key));
    } else {
      entries.push({ keys: new Set(keys), member });
    }
  }

  return entries.map((entry) => entry.member);
}

function teamMemberIdentityKeys(member: ProjectTeamMember) {
  const strongKeys = teamMemberStrongIdentityKeys(member);
  if (strongKeys.length > 0) {
    return strongKeys;
  }

  return [
    normalizeIdentityValue(member.initials)
  ].filter((key): key is string => Boolean(key));
}

function teamMemberStrongIdentityKeys(member: ProjectTeamMember) {
  return [
    member.id ? `id:${member.id}` : normalizeIdentityValue(member.email)
  ].filter((key): key is string => Boolean(key));
}

function mergeTeamMemberRecords(existing: ProjectTeamMember, incoming: ProjectTeamMember): ProjectTeamMember {
  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    initials: existing.initials || incoming.initials,
    name: existing.name || incoming.name,
    email: existing.email || incoming.email,
    role: preferredProjectRole(existing.role, incoming.role),
    department: existing.department || incoming.department,
    color: existing.color || incoming.color,
    tasks: existing.tasks + incoming.tasks,
    done: existing.done + incoming.done,
    avatarUrl: existing.avatarUrl || incoming.avatarUrl
  };
}

function preferredProjectRole(existing?: string, incoming?: string) {
  if (incoming && incoming !== "Project member") {
    return incoming;
  }
  if (existing && existing !== "Project member") {
    return existing;
  }
  return incoming || existing || "Project member";
}

function projectMemberIdentity(member: ProjectTeamMember) {
  return normalizeIdentityValue(member.id)
    ?? normalizeIdentityValue(member.email)
    ?? normalizeIdentityValue(member.name)
    ?? member.initials;
}

function projectMemberMatches(left: ProjectTeamMember, right: ProjectTeamMember) {
  const leftKeys = teamMemberIdentityKeys(left);
  const rightKeys = teamMemberIdentityKeys(right);
  return leftKeys.some((key) => rightKeys.includes(key));
}

function resolveProjectMemberUserId(member: ProjectTeamMember, workspaceMembers: ProjectTeamMember[]) {
  const memberKeys = teamMemberStrongIdentityKeys(member);
  if (memberKeys.length === 0) {
    return undefined;
  }

  const workspaceMember = workspaceMembers.find((candidate) => {
    const workspaceKeys = teamMemberStrongIdentityKeys(candidate);
    return memberKeys.some((key) => workspaceKeys.includes(key));
  });

  return workspaceMember?.id;
}

function resolveProjectMemberUserIds(members: ProjectTeamMember[], workspaceMembers: ProjectTeamMember[]) {
  const resolvedUserIds: string[] = [];
  for (const member of members) {
    const userId = resolveProjectMemberUserId(member, workspaceMembers);
    if (userId && !resolvedUserIds.includes(userId)) {
      resolvedUserIds.push(userId);
    }
  }
  return resolvedUserIds;
}

function taskMatchesProjectMember(task: TaskItem, member: ProjectTeamMember) {
  const taskKeys = [
    normalizeIdentityValue(task.assigneeUserId),
    normalizeIdentityValue(task.assignee)
  ].filter((key): key is string => Boolean(key));
  const memberKeys = [
    normalizeIdentityValue(member.id),
    normalizeIdentityValue(member.initials),
    normalizeIdentityValue(member.name),
    normalizeIdentityValue(member.email)
  ].filter((key): key is string => Boolean(key));
  return taskKeys.some((key) => memberKeys.includes(key));
}

function getSelectedTeamMember<T extends ProjectTeamMember>(members: T[], id?: string) {
  const normalizedId = normalizeIdentityValue(id);
  return normalizedId
    ? members.find((member) => normalizeIdentityValue(member.id) === normalizedId)
    : undefined;
}

// ─── Color constants ──────────────────────────────────────────────────────────
const C = {
  success: "#16a34a",
  warning: "#d97706",
  danger:  "#dc2626",
  info:    "#0891b2",
  purple:  "#7c3aed",
  blue:    "#2563eb",
  slate:   "#64748b",
  pink:    "#db2777",
};

// ─── Data types ───────────────────────────────────────────────────────────────

interface Milestone {
  id: string; name: string; description: string;
  startDate: string; dueDate: string;
  pic: string; picName: string; picColor: string;
  picUserId?: string;
  picAvatarUrl?: string;
  assigneeIds?: string[];
  assigneeNames?: string[];
  status: "done" | "in-progress" | "upcoming" | "at-risk";
  order: number;
}

interface TimeEntry {
  id: string;
  actualHours: number;
  period: string;
  description: string;
  date: string;
  occurredAt?: string;
  activityTime?: string;
  userId?: string;
  userInitials?: string;
  userName?: string;
  userColor?: string;
  userAvatarUrl?: string;
}

interface TaskItem {
  id: string; title: string;
  status: "todo" | "in-progress" | "done";
  priority: "critical" | "high" | "medium" | "low";
  assignee: string; aColor: string; due: string;
  startDate?: string;
  assigneeUserId?: string;
  assigneeAvatarUrl?: string;
  plannedHours?: number;
  actualHours?: number;
  week?: number;
  milestoneId?: string;
  stageId?: string;
  stageName?: string;
  description?: string;
  timeEntries?: TimeEntry[];
  sortOrder?: number;
}

interface StageItem {
  id: string;
  name: string;
  tasks: TaskItem[];
  pic?: string;
  picName?: string;
  picColor?: string;
  picUserId?: string;
  picAvatarUrl?: string;
  startDate?: string;
  dueDate?: string;
  description?: string;
  status?: "upcoming" | "in-progress" | "done";
  isMilestonePlaceholder?: boolean;
  sortOrder?: number;
}

interface MilestoneGroup {
  milestoneId: string;
  stages: StageItem[];
}

interface HierarchyUiState {
  milestones: Milestone[];
  groups: MilestoneGroup[];
  version: number;
}

interface DocVersion {
  version: number;
  size: string;
  date: string;
  author: string; // initials
  note: string;
  fileObjectId?: string;
}

interface ProjectDoc {
  id: string;
  name: string;
  type: string; // PDF, DOCX, XLSX, FIG, PPTX, Other
  color: string;
  category: string; // Requirements, Technical, Design, Operations, Legal, Other
  artifactType?: string;
  storageKey?: string;
  versions: DocVersion[];
}

function mapProjectDocumentToDoc(document: ProjectDocumentSummary): ProjectDoc {
  const extension = document.name.includes(".") ? document.name.split(".").pop()?.toUpperCase() ?? "DOC" : "DOC";
  const category = categoryFromArtifactType(document.artifactType);
  return {
    id: document.id,
    name: document.name,
    type: extension.length <= 5 ? extension : "DOC",
    color: colorForDocumentCategory(category),
    category,
    artifactType: document.artifactType,
    storageKey: document.storageKey,
    versions: (document.versions ?? []).map((version) => ({
      version: version.version,
      size: formatFileSize(version.file.byteSize),
      date: formatApiDate(version.createdAt),
      author: version.createdByDisplayName || "API",
      note: version.note || "Uploaded version",
      fileObjectId: version.fileObjectId
    }))
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}

function mapProjectActivityToLogItem(activity: ProjectActivitySummary): ActivityLogItem {
  const icon = activity.activityType === "document" ? FileText : activity.activityType === "risk" ? AlertCircle : Activity;
  const color = activity.activityType === "risk" ? C.danger : activity.activityType === "document" ? C.blue : C.success;
  return {
    id: activity.id,
    icon,
    color,
    text: activity.subject,
    target: activity.target ?? activity.createdByDisplayName ?? "",
    time: formatActivityTimestamp(activity.occurredAt, activity.occurredTime),
    sortAt: activity.occurredAt,
    source: "project",
    userId: activity.createdByUserId,
    userName: activity.createdByDisplayName,
    userInitials: activity.createdByDisplayName ? initialsForDisplayName(activity.createdByDisplayName) : undefined,
    userAvatarUrl: activity.createdByAvatarUrl
  };
}

function buildWorkLogActivityItems(tasks: TaskItem[]): ActivityLogItem[] {
  return tasks.flatMap(task =>
    (task.timeEntries ?? []).map(entry => ({
      id: `work-log-${task.id}-${entry.id}`,
      icon: Clock,
      color: entry.userColor || C.success,
      text: entry.description || `${entry.userName ?? "User"} logged actual work`,
      target: task.stageName ? `${task.title} · ${task.stageName}` : task.title,
      time: entry.activityTime || entry.date,
      sortAt: entry.occurredAt || entry.date,
      source: "work-log" as const,
      userId: entry.userId,
      userName: entry.userName,
      userInitials: entry.userInitials,
      userAvatarUrl: entry.userAvatarUrl,
      hours: entry.actualHours,
      badge: `${formatHours(entry.actualHours)}h actual`
    }))
  );
}

function compareActivityDesc(left: ActivityLogItem, right: ActivityLogItem) {
  const leftTime = Date.parse(left.sortAt || left.time) || 0;
  const rightTime = Date.parse(right.sortAt || right.time) || 0;
  return rightTime - leftTime;
}

function mapProjectRiskToRiskItem(risk: ProjectRiskSummary): RiskItem {
  return {
    id: risk.id,
    category: risk.category,
    description: risk.description,
    likelihood: risk.likelihood,
    impact: risk.impact,
    response: risk.response,
    switch: risk.switchTrigger ?? risk.status,
    owner: risk.ownerDisplayName ?? "PMO",
    status: risk.status
  };
}

function categoryFromArtifactType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("requirement") || normalized.includes("scope")) return "Requirements";
  if (normalized.includes("technical") || normalized.includes("architecture")) return "Technical";
  if (normalized.includes("design")) return "Design";
  if (normalized.includes("legal") || normalized.includes("contract")) return "Legal";
  if (normalized.includes("operation") || normalized.includes("handoff")) return "Operations";
  return "Other";
}

function artifactTypeFromCategory(value: string) {
  return value === "Other" ? "project_document" : `project_${value.toLowerCase()}`;
}

function colorForDocumentCategory(value: string) {
  if (value === "Requirements") return C.blue;
  if (value === "Technical") return C.purple;
  if (value === "Design") return C.pink;
  if (value === "Legal") return C.danger;
  if (value === "Operations") return C.success;
  return C.slate;
}

function mapStageGroupToMilestone(stages: ProjectStageSummary[]): Milestone {
  const [representative] = stages;
  const milestone = mapStageToMilestone(representative, representative.milestoneSortOrder);
  const plannedStarts = stages.map(stage => stage.actualStartAt || stage.plannedStartAt).filter(Boolean) as string[];
  const plannedEnds = stages.map(stage => stage.actualEndAt || stage.plannedEndAt).filter(Boolean) as string[];
  const statuses = stages.map(stage => toStageStatus(stage.status));

  return {
    ...milestone,
    startDate: formatApiDate(plannedStarts.sort()[0]),
    dueDate: formatApiDate(plannedEnds.sort().at(-1)),
    status: statuses.every(status => status === "done")
      ? "done"
      : statuses.some(status => status === "in-progress")
        ? "in-progress"
        : "upcoming"
  };
}

function mapProjectWorkItems(stages: ProjectStageSummary[], tasks: ProjectTaskSummary[]) {
  const sortedStages = [...stages].sort((a, b) =>
    (a.milestoneSortOrder - b.milestoneSortOrder)
    || (a.sortOrder - b.sortOrder)
    || a.activity.localeCompare(b.activity)
  );
  const taskBuckets = new Map<string, ProjectTaskSummary[]>();
  const unassignedTasks: ProjectTaskSummary[] = [];

  for (const task of tasks) {
    // The board orders only active top-level siblings. Subtasks keep their own
    // task-detail hierarchy and archived records are not part of the permutation.
    if (!isSortableTopLevelTask(task)) continue;
    if (task.stageId) {
      const bucket = taskBuckets.get(task.stageId) ?? [];
      bucket.push(task);
      taskBuckets.set(task.stageId, bucket);
    } else {
      unassignedTasks.push(task);
    }
  }

  for (const bucket of taskBuckets.values()) {
    bucket.sort((a, b) => (a.sortOrder - b.sortOrder) || a.title.localeCompare(b.title));
  }
  unassignedTasks.sort((a, b) => (a.sortOrder - b.sortOrder) || a.title.localeCompare(b.title));

  const stageGroups = new Map<string, ProjectStageSummary[]>();
  for (const stage of sortedStages) {
    stageGroups.set(stage.milestoneId, [...(stageGroups.get(stage.milestoneId) ?? []), stage]);
  }

  const groupedStages = Array.from(stageGroups.values());
  const milestones = groupedStages.map(mapStageGroupToMilestone);
  const groups = groupedStages.map((stageGroup) => ({
    milestoneId: stageGroup[0].milestoneId,
    stages: stageGroup.map((stage) => mapStageToStageItem(stage, taskBuckets.get(stage.id) ?? []))
  }));

  if (unassignedTasks.length > 0) {
    const fallbackMilestone: Milestone = {
      id: UNASSIGNED_TASKS_MILESTONE_ID,
      name: "Unassigned Tasks",
      description: "Tasks without a linked project stage in the production database.",
      startDate: "",
      dueDate: "",
      pic: "NA",
      picName: "Unassigned",
      picColor: C.slate,
      status: "in-progress",
      order: sortedStages.length + 1
    };
    milestones.push(fallbackMilestone);
    groups.push({
      milestoneId: fallbackMilestone.id,
      stages: [{
        id: UNASSIGNED_TASKS_STAGE_ID,
        name: "No Stage",
        tasks: unassignedTasks.map(mapProjectTaskToTaskItem),
        status: "in-progress"
      }]
    });
  }

  return { milestones, groups };
}

function mapStageToMilestone(stage: ProjectStageSummary, order: number): Milestone {
  const ownerName = stage.ownerDisplayName || stage.ownerUserId || "Unassigned";
  return {
    id: stage.milestoneId,
    name: stage.milestoneName,
    description: stage.scopeSummary || stage.description || stage.criteria || "",
    startDate: formatApiDate(stage.actualStartAt || stage.plannedStartAt),
    dueDate: formatApiDate(stage.actualEndAt || stage.plannedEndAt),
    pic: initialsForDisplayName(ownerName),
    picName: ownerName,
    picColor: colorForIdentity(ownerName),
    picUserId: stage.ownerUserId,
    picAvatarUrl: stage.ownerAvatarUrl,
    assigneeIds: stage.ownerUserId ? [stage.ownerUserId] : undefined,
    assigneeNames: [ownerName],
    status: toMilestoneStatus(stage.status),
    order
  };
}

function mapStageToStageItem(stage: ProjectStageSummary, tasks: ProjectTaskSummary[]): StageItem {
  const ownerName = stage.ownerDisplayName || stage.ownerUserId || "Unassigned";
  const isMilestonePlaceholder = tasks.length === 0
    && normalizeBoardEntityName(stage.activity) !== ""
    && normalizeBoardEntityName(stage.activity) === normalizeBoardEntityName(stage.phase);
  return {
    id: stage.id,
    name: stage.activity || stage.phase || stage.stageKey,
    tasks: tasks.map(mapProjectTaskToTaskItem),
    pic: initialsForDisplayName(ownerName),
    picName: ownerName,
    picColor: colorForIdentity(ownerName),
    picUserId: stage.ownerUserId,
    picAvatarUrl: stage.ownerAvatarUrl,
    startDate: formatApiDate(stage.actualStartAt || stage.plannedStartAt),
    dueDate: formatApiDate(stage.actualEndAt || stage.plannedEndAt),
    description: stage.scopeSummary || stage.description || stage.criteria || "",
    status: toStageStatus(stage.status),
    isMilestonePlaceholder,
    sortOrder: stage.sortOrder
  };
}

function normalizeBoardEntityName(value?: string) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isMilestonePlaceholderStage(stage: StageItem, milestone: Milestone) {
  const stageName = normalizeBoardEntityName(stage.name);
  return Boolean(stage.isMilestonePlaceholder)
    || (stage.tasks.length === 0 && stageName !== "" && stageName === normalizeBoardEntityName(milestone.name));
}

function visibleStagesForMilestone(group: MilestoneGroup, milestone: Milestone) {
  return group.stages.filter(stage => !isMilestonePlaceholderStage(stage, milestone));
}

function mapProjectTaskToTaskItem(task: ProjectTaskSummary): TaskItem {
  const assigneeName = task.assigneeDisplayName || task.ownerDisplayName || task.assigneeUserId || task.ownerUserId || "Unassigned";
  return {
    id: task.id,
    title: task.title,
    status: toTaskStatus(task.status),
    priority: toTaskPriority(task.priority),
    assignee: initialsForDisplayName(assigneeName),
    aColor: colorForIdentity(assigneeName),
    assigneeUserId: task.assigneeUserId || task.ownerUserId,
    assigneeAvatarUrl: task.assigneeAvatarUrl || task.ownerAvatarUrl,
    startDate: formatApiDate(task.plannedStartAt) || undefined,
    due: formatApiDate(task.dueAt) || "Not set",
    plannedHours: minutesToHours(task.estimateMinutes),
    actualHours: minutesToHours(task.loggedMinutes),
    description: task.description,
    timeEntries: (task.timeEntries ?? []).map(mapTimeEntryToUi),
    sortOrder: task.sortOrder
  };
}

function mapTimeEntryToUi(entry: TaskTimeEntrySummary): TimeEntry {
  const userName = entry.userDisplayName || entry.userId;
  const occurredAt = entry.startAt || entry.workDate;
  return {
    id: entry.id,
    actualHours: minutesToHours(entry.minutes),
    period: entry.workType,
    description: entry.note || "Logged production time entry",
    date: formatApiDate(entry.workDate),
    occurredAt,
    activityTime: formatActivityTimestamp(occurredAt),
    userId: entry.userId,
    userInitials: initialsForDisplayName(userName),
    userName,
    userColor: colorForIdentity(userName),
    userAvatarUrl: entry.userAvatarUrl
  };
}

function dateInputValue(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function buildLocalDateTimeIso(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0).toISOString();
}

function buildWorkLogDateIso(dateValue: string, period: string) {
  const match = period.match(/(\d{1,2}):(\d{2})/);
  const timeValue = match ? `${match[1].padStart(2, "0")}:${match[2]}` : "09:00";
  return buildLocalDateTimeIso(dateValue, timeValue);
}

function toMilestoneStatus(status: string): Milestone["status"] {
  const normalized = status.toLowerCase();
  if (["done", "completed"].includes(normalized)) return "done";
  if (["in_progress", "active", "started"].includes(normalized)) return "in-progress";
  if (["blocked", "at_risk", "cancelled"].includes(normalized)) return "at-risk";
  return "upcoming";
}

function toStageStatus(status: string): StageItem["status"] {
  const normalized = status.toLowerCase();
  if (["done", "completed"].includes(normalized)) return "done";
  if (["in_progress", "active", "started"].includes(normalized)) return "in-progress";
  return "upcoming";
}

function toTaskStatus(status: string): TaskItem["status"] {
  const normalized = status.toLowerCase();
  if (["done", "completed"].includes(normalized)) return "done";
  if (["in_progress", "active", "started"].includes(normalized)) return "in-progress";
  return "todo";
}

function toTaskPriority(priority: string): TaskItem["priority"] {
  const normalized = priority.toLowerCase();
  if (["critical", "urgent"].includes(normalized)) return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function toApiStageStatus(status?: StageItem["status"] | Milestone["status"]) {
  if (status === "done") return "completed";
  if (status === "in-progress") return "in_progress";
  if (status === "at-risk") return "at_risk";
  return "not_started";
}

function toApiTaskStatus(status: TaskItem["status"]) {
  if (status === "done") return "done";
  if (status === "in-progress") return "in_progress";
  return "todo";
}

function minutesToHours(minutes?: number) {
  if (!minutes || minutes <= 0) return 0;
  return roundHours(minutes / 60);
}

function hoursToMinutes(hours?: number) {
  if (!hours || hours <= 0) return 0;
  return Math.round(hours * 60);
}

function roundHours(hours = 0) {
  return Math.round((hours + Number.EPSILON) * 10) / 10;
}

function sumHours(values: number[]) {
  return roundHours(values.reduce((sum, value) => sum + value, 0));
}

function formatHours(hours = 0) {
  const rounded = roundHours(hours);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type ProjectSheetTaskRow = {
  task: TaskItem;
  milestone: Milestone;
  stage: StageItem;
};

function ProjectSheetPanel({
  project,
  milestones,
  milestoneGroups,
  teamMembers,
  onOpenTasks,
  onOpenTeam,
  onOpenTask
}: {
  project: Project;
  milestones: Milestone[];
  milestoneGroups: MilestoneGroup[];
  teamMembers: ProjectTeamMember[];
  onOpenTasks: () => void;
  onOpenTeam: () => void;
  onOpenTask: (task: TaskItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskItem["status"]>("all");
  const [memberFilter, setMemberFilter] = useState("all");

  const rows = useMemo<ProjectSheetTaskRow[]>(() => milestones.flatMap((milestone) => {
    const group = milestoneGroups.find((item) => item.milestoneId === milestone.id);
    return (group?.stages ?? []).flatMap((stage) => stage.tasks.map((task) => ({ task, milestone, stage })));
  }), [milestoneGroups, milestones]);

  const plannedHours = sumHours(rows.map(({ task }) => task.plannedHours ?? 0));
  const actualHours = sumHours(rows.map(({ task }) => task.actualHours ?? 0));
  const varianceHours = roundHours(actualHours - plannedHours);
  const doneTasks = rows.filter(({ task }) => task.status === "done").length;
  const alertCount = milestones.filter((milestone) => milestone.status === "at-risk").length + rows.filter(({ task }) => {
    if (task.status === "done" || !task.due || task.due === "Not set") return false;
    const due = Date.parse(task.due);
    return Number.isFinite(due) && due < Date.now();
  }).length;

  const normalizedQuery = query.trim().toLocaleLowerCase("vi");
  const visibleRows = rows.filter(({ task, milestone, stage }) => {
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (memberFilter !== "all" && task.assigneeUserId !== memberFilter && task.assignee !== memberFilter) return false;
    if (!normalizedQuery) return true;
    return [task.title, milestone.name, stage.name, task.assignee]
      .some((value) => value.toLocaleLowerCase("vi").includes(normalizedQuery));
  });

  const milestoneSummaries = milestones.map((milestone) => {
    const group = milestoneGroups.find((item) => item.milestoneId === milestone.id);
    const tasks = (group?.stages ?? []).flatMap((stage) => stage.tasks);
    const plan = sumHours(tasks.map((task) => task.plannedHours ?? 0));
    const actual = sumHours(tasks.map((task) => task.actualHours ?? 0));
    return { milestone, tasks, plan, actual, variance: roundHours(actual - plan), done: tasks.filter((task) => task.status === "done").length };
  });

  const statusLabel: Record<TaskItem["status"], string> = { done: "Done", "in-progress": "In Progress", todo: "To Do" };
  const milestoneLabel: Record<Milestone["status"], string> = { done: "Hoàn tất", "in-progress": "Đang thực hiện", upcoming: "Sắp tới", "at-risk": "Có rủi ro" };
  const readiness = [project.client, project.ownerDisplayName, project.startDate && project.dueDate].filter(Boolean).length;

  return (
    <div className="space-y-6" data-testid="project-sheet-control-center">
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-primary"><FileText className="h-4 w-4" /> Project Sheet</p>
          <h2 className="text-2xl font-black tracking-tight text-foreground">Project control center</h2>
          <p className="mt-1 text-sm text-muted-foreground">Một màn hình để đối soát phạm vi, kế hoạch, nguồn lực và giờ thực tế của project.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpenTasks} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"><ListChecks className="h-4 w-4" /> Mở Tasks</button>
          <button type="button" onClick={onOpenTeam} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"><Users className="h-4 w-4" /> Xem thành viên</button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Tiến độ", value: `${project.progress}%`, icon: TrendingUp, tone: "text-emerald-600 bg-emerald-50" },
          { label: "Task hoàn tất", value: `${doneTasks}/${rows.length}`, icon: ListChecks, tone: "text-blue-600 bg-blue-50" },
          { label: "Plan hour", value: `${formatHours(plannedHours)}h`, icon: Calendar, tone: "text-blue-600 bg-blue-50" },
          { label: "Actual hour", value: `${formatHours(actualHours)}h`, icon: Clock, tone: "text-purple-600 bg-purple-50" },
          { label: "Variance", value: `${varianceHours > 0 ? "+" : ""}${formatHours(varianceHours)}h`, icon: BarChart2, tone: varianceHours > 0 ? "text-red-600 bg-red-50" : "text-emerald-600 bg-emerald-50" },
          { label: "Cảnh báo", value: String(alertCount), icon: AlertCircle, tone: alertCount ? "text-red-600 bg-red-50" : "text-emerald-600 bg-emerald-50" }
        ].map((item) => (
          <article key={item.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-2"><p className="text-xs font-semibold text-muted-foreground">{item.label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-xl ${item.tone}`}><item.icon className="h-4 w-4" /></span></div>
            <p className="font-mono text-2xl font-black tabular-nums text-foreground">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="text-xl font-black tracking-tight text-foreground">Work breakdown &amp; delivery health</h3>
            <p className="mt-1 text-sm text-muted-foreground">Theo dõi từ Milestone → Stage → Task, luôn truy được về người thực hiện và Time Log.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:w-[620px]">
            <label className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2.5 sm:col-span-1"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm task, người thực hiện..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
            <select aria-label="Lọc trạng thái" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"><option value="all">Tất cả trạng thái</option><option value="done">Hoàn tất</option><option value="in-progress">Đang thực hiện</option><option value="todo">Chưa bắt đầu</option></select>
            <select aria-label="Lọc người thực hiện" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"><option value="all">Tất cả người thực hiện</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-3"><strong className="text-foreground">Cấu trúc dữ liệu</strong><span>Milestone</span><ChevronRight className="h-3.5 w-3.5" /><span>Stage</span><ChevronRight className="h-3.5 w-3.5" /><span>Task</span><ChevronRight className="h-3.5 w-3.5" /><span>Time Log</span></div>
          <span>Bấm một dòng để xem chi tiết</span>
        </div>

        <div className="grid gap-3 p-5 lg:grid-cols-3">
          {milestoneSummaries.map(({ milestone, tasks, plan, actual, variance, done }) => (
            <article key={milestone.id} className="rounded-2xl border border-border bg-muted/15 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Milestone</p><h4 className="mt-1 font-bold text-foreground">{milestone.name}</h4></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${milestone.status === "done" ? "bg-emerald-50 text-emerald-700" : milestone.status === "at-risk" ? "bg-red-50 text-red-700" : "bg-muted text-foreground"}`}>{milestoneLabel[milestone.status]}</span></div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>{done}/{tasks.length} task hoàn tất</span><span>{formatHours(plan)}h kế hoạch</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><div><p className="text-muted-foreground">Kế hoạch</p><strong className="font-mono text-foreground">{formatHours(plan)}h</strong></div><div><p className="text-muted-foreground">Đã ghi nhận</p><strong className="font-mono text-foreground">{formatHours(actual)}h</strong></div><div><p className="text-muted-foreground">Chênh lệch</p><strong className={`font-mono ${variance > 0 ? "text-red-600" : "text-emerald-600"}`}>{variance > 0 ? "+" : ""}{formatHours(variance)}h</strong></div></div>
            </article>
          ))}
          {milestoneSummaries.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Project chưa có Milestone hoặc Task để đối soát.</div>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead className="bg-muted/25"><tr>{["Hạng mục công việc", "Người thực hiện", "Trạng thái", "Kế hoạch", "Đã ghi nhận", "Chênh lệch"].map((label) => <th key={label} className="border-y border-border px-5 py-3 text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map(({ task, milestone, stage }) => {
                const taskVariance = roundHours((task.actualHours ?? 0) - (task.plannedHours ?? 0));
                const member = teamMembers.find((candidate) => candidate.id === task.assigneeUserId || candidate.initials === task.assignee);
                return (
                  <tr key={task.id} tabIndex={0} role="button" onClick={() => onOpenTask(task)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task); } }} className="cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/25 focus:bg-primary/5 focus:outline-none">
                    <td className="px-5 py-4"><p className="text-[10px] font-black uppercase tracking-wide text-primary">{milestone.name}</p><p className="mt-1 text-xs text-muted-foreground"><strong className="text-foreground">Stage:</strong> {stage.name} · Deadline {task.due}</p><p className="mt-1 font-bold text-foreground">{task.title}</p></td>
                    <td className="px-5 py-4"><span className="inline-flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: member?.color || task.aColor }}>{member?.initials || task.assignee}</span><span className="text-sm font-medium text-foreground">{member?.name || task.assignee}</span></span></td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${task.status === "done" ? "bg-emerald-50 text-emerald-700" : task.status === "in-progress" ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-600"}`}>{statusLabel[task.status]}</span></td>
                    <td className="px-5 py-4 font-mono text-sm tabular-nums text-foreground">{formatHours(task.plannedHours)}h</td>
                    <td className="px-5 py-4 font-mono text-sm tabular-nums text-foreground">{formatHours(task.actualHours)}h</td>
                    <td className={`px-5 py-4 font-mono text-sm font-semibold tabular-nums ${taskVariance > 0 ? "text-red-600" : "text-emerald-600"}`}>{taskVariance > 0 ? "+" : ""}{formatHours(taskVariance)}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleRows.length === 0 && rows.length > 0 && <p className="p-8 text-center text-sm text-muted-foreground">Không có task phù hợp với bộ lọc.</p>}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-5">
        <article className="rounded-2xl border border-border bg-card p-5 shadow-sm xl:col-span-3">
          <div className="mb-4 flex items-start justify-between"><div><h3 className="text-lg font-black text-foreground">Nguồn lực đang tham gia</h3><p className="mt-1 text-sm text-muted-foreground">Active được xác định từ Time Log trong kỳ theo dõi.</p></div><button type="button" onClick={onOpenTeam} className="text-sm font-semibold text-primary hover:underline">Xem đầy đủ →</button></div>
          <div className="space-y-2">{teamMembers.map((member) => { const memberTasks = rows.filter(({ task }) => task.assigneeUserId === member.id || task.assignee === member.initials); const memberActual = sumHours(memberTasks.map(({ task }) => task.actualHours ?? 0)); return <div key={member.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white" style={{ backgroundColor: member.color }}>{member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" /> : member.initials}</span><div className="min-w-0"><p className="truncate text-sm font-bold text-foreground">{member.name}</p><p className="text-xs text-muted-foreground">{member.role}</p></div></div><div className="flex items-center gap-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${memberActual > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{memberActual > 0 ? "Active" : "No log"}</span><span className="font-mono text-sm font-bold text-foreground">{member.done}/{member.tasks}</span></div></div>; })}</div>
          {teamMembers.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Chưa có thành viên trong project.</p>}
        </article>

        <article className="rounded-2xl border border-border bg-card p-5 shadow-sm xl:col-span-2">
          <h3 className="text-lg font-black text-foreground">Project master data</h3>
          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5 text-sm"><div><dt className="text-xs text-muted-foreground">Client</dt><dd className="mt-1 font-bold text-foreground">{project.client || "Chưa thiết lập"}</dd></div><div><dt className="text-xs text-muted-foreground">Project PIC</dt><dd className="mt-1 font-bold text-foreground">{project.ownerDisplayName || "Chưa phân công"}</dd></div><div><dt className="text-xs text-muted-foreground">Trạng thái</dt><dd className="mt-1 font-bold text-foreground">{project.status}</dd></div><div><dt className="text-xs text-muted-foreground">Kỳ project</dt><dd className="mt-1 font-bold text-foreground">{project.startDate || "TBD"} → {project.dueDate || "TBD"}</dd></div><div><dt className="text-xs text-muted-foreground">Loại dịch vụ</dt><dd className="mt-1 font-bold text-foreground">{project.category}</dd></div><div><dt className="text-xs text-muted-foreground">Data readiness</dt><dd className="mt-1 font-bold text-foreground">{readiness}/3 trường kiểm tra đạt</dd></div></dl>
        </article>
      </section>
    </div>
  );
}

function formatApiDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Renders "start → due"; when start isn't set, the arrow still points at due.
 * Shared by tasks (fallback "Not set") and milestones/stages (fallback "TBD").
 */
function formatDateRange(startDate: string | undefined, due: string | undefined, fallback: string = "Not set") {
  if (!due || due === fallback) return fallback;
  return <>{startDate} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {due}</>;
}

function formatActivityDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    timeZone: VIETNAM_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatActivityTimestamp(value?: string, explicitTime?: string) {
  if (!value && !explicitTime) return "";
  const dateLabel = formatActivityDate(value);
  const timeLabel = explicitTime || formatVietnamTime(value);
  if (timeLabel && dateLabel) return `${timeLabel} · ${VIETNAM_TIME_ZONE_LABEL} · ${dateLabel}`;
  if (timeLabel) return `${timeLabel} · ${VIETNAM_TIME_ZONE_LABEL}`;
  return dateLabel;
}

function parseUiDate(dateStr: string): Date {
  if (!dateStr || dateStr === "TBD" || dateStr === "Not set") return new Date();
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toApiDateValue(dateStr?: string) {
  if (!dateStr || dateStr === "TBD" || dateStr === "Not set") return undefined;
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

const TASK_DATE_RANGE_ERROR = "Start Date must be on or before Due Date.";

function isTaskDateRangeInvalid(startDate?: string, dueDate?: string) {
  const plannedStartAt = toApiDateValue(startDate);
  const dueAt = toApiDateValue(dueDate);
  return Boolean(plannedStartAt && dueAt && plannedStartAt > dueAt);
}

function weekBucketFromTaskDate(dateStr: string) {
  if (!dateStr || dateStr === "TBD" || dateStr === "Not set") return 1;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return 1;
  return Math.max(1, Math.min(5, Math.ceil(parsed.getDate() / 7)));
}

function formatUiDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initialsForDisplayName(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "NA";
  return words.slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("") || "NA";
}

function colorForIdentity(value: string) {
  const palette = [C.blue, C.success, C.purple, C.pink, C.warning, C.danger, C.slate, C.info];
  const hash = Array.from(value || "unassigned").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function normalizeIdentityValue(value?: string) {
  return value?.trim().toLowerCase();
}

function findTeamMember(members: ProjectTeamMember[], initials?: string, name?: string, id?: string) {
  const normalizedName = normalizeIdentityValue(name);
  const normalizedInitials = normalizeIdentityValue(initials);
  const normalizedId = normalizeIdentityValue(id);
  return members.find((member) => {
    const memberId = normalizeIdentityValue(member.id);
    const memberEmail = normalizeIdentityValue(member.email);
    const memberName = normalizeIdentityValue(member.name);
    const memberInitials = normalizeIdentityValue(member.initials);
    return (
      (normalizedId && (memberId === normalizedId || memberEmail === normalizedId)) ||
      (normalizedName && (memberName === normalizedName || memberEmail === normalizedName || memberId === normalizedName)) ||
      (normalizedInitials && (memberInitials === normalizedInitials || memberId === normalizedInitials))
    );
  });
}

function findAssignableTeamMember(
  projectMembers: ProjectTeamMember[],
  id?: string
) {
  const normalizedId = normalizeIdentityValue(id);
  if (!normalizedId) return undefined;
  return projectMembers.find((member) => normalizeIdentityValue(member.id) === normalizedId);
}

const PROJECT_MEMBER_ASSIGNMENT_ERROR = "The selected assignee is not a current project member. Add them from the Team tab or choose another project member.";

function userFacingAssignmentError(message: string) {
  if (/not project members|unknown or inactive project user/i.test(message)) {
    return PROJECT_MEMBER_ASSIGNMENT_ERROR;
  }
  return message.replace(/usr-[a-z0-9_-]+/gi, "the selected user");
}

function ModalMutationFeedback({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" aria-live="assertive" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
      {error}
    </div>
  );
}

function useModalMutation(onClose: () => void) {
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = useCallback(async (mutation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setSubmitting(true);
      setSubmitError(null);
      await mutation();
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save this assignment. Please try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [onClose, submitting]);

  return { submit, submitting, submitError };
}

async function mutationErrorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string") return payload.message;
    if (Array.isArray(payload?.message)) return payload.message.join(", ");
    if (typeof payload?.error === "string") return payload.error;
  } catch {
    // Ignore non-JSON error bodies from upstream/proxy responses.
  }
  return `${fallback}: ${response.status}`;
}

const EMPTY_MILESTONES: Milestone[] = [];

// ─── Live operational records ─────────────────────────────────────────────────

const EMPTY_MILESTONE_GROUPS: MilestoneGroup[] = [];
const EMPTY_ACTIVITY_LOG: ActivityLogItem[] = [];
const EMPTY_PROJECT_DOCS: ProjectDoc[] = [];


interface ActivityLogItem {
  id: string;
  icon: React.ElementType;
  color: string;
  text: string;
  target: string;
  time: string;
  sortAt?: string;
  source?: "project" | "work-log";
  userId?: string;
  userName?: string;
  userInitials?: string;
  userAvatarUrl?: string;
  hours?: number;
  badge?: string;
}

interface RiskItem {
  id: string;
  category: "Financial" | "Operational" | "External" | "Strategic";
  description: string;
  likelihood: "Low" | "Medium" | "High";
  impact: "Low" | "Medium" | "High";
  response: string;
  switch: string;
  owner: string;
  status: string;
}

const EMPTY_RISK_REGISTRY: RiskItem[] = [];

type ProjectRiskDraft = {
  category: RiskItem["category"];
  description: string;
  likelihood: RiskItem["likelihood"];
  impact: RiskItem["impact"];
  response: string;
  switchTrigger: string;
  ownerUserId?: string;
  status: string;
};

function ProjectIssuesPanel({
  risks,
  teamMembers,
  onCreate
}: {
  risks: RiskItem[];
  teamMembers: ProjectTeamMember[];
  onCreate: (draft: ProjectRiskDraft) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<RiskItem["category"]>("Operational");
  const [likelihood, setLikelihood] = useState<RiskItem["likelihood"]>("Medium");
  const [impact, setImpact] = useState<RiskItem["impact"]>("Medium");
  const [response, setResponse] = useState("");
  const [switchTrigger, setSwitchTrigger] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openCount = risks.filter((risk) => !["resolved", "closed", "done"].includes(risk.status.toLowerCase())).length;
  const highCount = risks.filter((risk) => risk.likelihood === "High" || risk.impact === "High").length;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!description.trim()) {
      setError("Hãy mô tả blocker, risk hoặc issue cần theo dõi.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        category,
        description: description.trim(),
        likelihood,
        impact,
        response: response.trim(),
        switchTrigger: switchTrigger.trim(),
        ownerUserId: ownerUserId || undefined,
        status: "open"
      });
      setDescription("");
      setResponse("");
      setSwitchTrigger("");
      setOwnerUserId("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thể tạo bản ghi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-blue-50 to-violet-50 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">PROJECT CONTROL</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">Blocker, risk &amp; issue register</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Tập trung các vấn đề cần xử lý trong project và làm rõ owner, mức độ ảnh hưởng cùng hành động tiếp theo.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-[210px]">
          <div className="rounded-xl border border-white/80 bg-white/75 px-3 py-2"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Đang mở</p><p className="mt-1 text-xl font-black text-foreground">{openCount}</p></div>
          <div className="rounded-xl border border-white/80 bg-white/75 px-3 py-2"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Mức cao</p><p className="mt-1 text-xl font-black text-rose-600">{highCount}</p></div>
        </div>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-foreground">Báo blocker / risk / issue</h3><p className="mt-1 text-xs text-muted-foreground">Bản ghi mới sẽ xuất hiện ngay trong danh sách điều phối của project.</p></div><AlertCircle className="h-5 w-5 text-amber-500" /></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="lg:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Mô tả vấn đề</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Ví dụ: Chờ dữ liệu đầu vào từ khách hàng để hoàn thành stage…" className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Phân loại</span><select value={category} onChange={(event) => setCategory(event.target.value as RiskItem["category"])} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"><option value="Operational">Vận hành</option><option value="Financial">Tài chính</option><option value="External">Đối ngoại</option><option value="Strategic">Chiến lược</option></select></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span><select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"><option value="">Chưa phân công</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Khả năng</span><select value={likelihood} onChange={(event) => setLikelihood(event.target.value as RiskItem["likelihood"])} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"><option value="Low">Thấp</option><option value="Medium">Vừa</option><option value="High">Cao</option></select></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Tác động</span><select value={impact} onChange={(event) => setImpact(event.target.value as RiskItem["impact"])} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"><option value="Low">Thấp</option><option value="Medium">Vừa</option><option value="High">Cao</option></select></label>
          <label className="lg:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Phương án xử lý</span><input value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Giảm thiểu, chờ phê duyệt, cập nhật dữ liệu…" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" /></label>
          <label className="lg:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Điều kiện chuyển trạng thái</span><input value={switchTrigger} onChange={(event) => setSwitchTrigger(event.target.value)} placeholder="Ví dụ: Khách hàng xác nhận trước 17:00" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" /></label>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-rose-600">{error}</p><button type="submit" disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"><Plus className="h-4 w-4" />{saving ? "Đang lưu…" : "Báo vấn đề"}</button></div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="text-sm font-bold text-foreground">Danh sách theo dõi</h3><p className="mt-1 text-xs text-muted-foreground">Các bản ghi được dùng làm đầu vào cho cảnh báo tiến độ và điều phối owner.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">{risks.length} bản ghi</span></div>
        {risks.length === 0 ? <div className="px-5 py-12 text-center"><AlertCircle className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-semibold text-foreground">Chưa có blocker hoặc risk nào</p><p className="mt-1 text-xs text-muted-foreground">Báo vấn đề đầu tiên để project có lịch sử xử lý rõ ràng.</p></div> : <div className="divide-y divide-border">{risks.map((risk) => <div key={risk.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_130px_130px_180px] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{risk.category === "Operational" ? "Vận hành" : risk.category === "Financial" ? "Tài chính" : risk.category === "External" ? "Đối ngoại" : "Chiến lược"}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${risk.status.toLowerCase() === "open" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{risk.status.toLowerCase() === "open" ? "Đang mở" : risk.status}</span></div><p className="mt-2 text-sm font-semibold text-foreground">{risk.description}</p><p className="mt-1 text-xs text-muted-foreground">Owner: {risk.owner || "Chưa phân công"}</p></div><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Khả năng</p><p className={`mt-1 text-sm font-bold ${risk.likelihood === "High" ? "text-rose-600" : risk.likelihood === "Medium" ? "text-amber-600" : "text-slate-600"}`}>{risk.likelihood === "High" ? "Cao" : risk.likelihood === "Medium" ? "Vừa" : "Thấp"}</p></div><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Tác động</p><p className={`mt-1 text-sm font-bold ${risk.impact === "High" ? "text-rose-600" : risk.impact === "Medium" ? "text-amber-600" : "text-slate-600"}`}>{risk.impact === "High" ? "Cao" : risk.impact === "Medium" ? "Vừa" : "Thấp"}</p></div><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Phương án xử lý</p><p className="mt-1 text-sm text-muted-foreground">{risk.response || "Chưa cập nhật"}</p></div></div>)}</div>}
      </div>
    </div>
  );
}

// ─── Config maps ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  "Active":    { color:C.success, bg:"#dcfce7", icon:CheckCircle2 },
  "In Review": { color:C.blue,    bg:"#dbeafe", icon:BarChart2 },
  "Planning":  { color:C.info,    bg:"#cffafe", icon:Clock },
  "On Hold":   { color:C.slate,   bg:"#f1f5f9", icon:Clock },
  "Completed": { color:C.success, bg:"#dcfce7", icon:CheckCircle2 },
  "At Risk":   { color:C.danger,  bg:"#fee2e2", icon:AlertCircle },
};

const PRIORITY_CFG = {
  critical: { label:"Critical", color:C.danger,  bg:"#fee2e2" },
  high:     { label:"High",     color:C.warning, bg:"#fef3c7" },
  medium:   { label:"Medium",   color:C.blue,    bg:"#dbeafe" },
  low:      { label:"Low",      color:C.success, bg:"#dcfce7" },
};

const TASK_STATUS = {
  done:          { color:C.success, bg:"#dcfce7", label:"Done" },
  "in-progress": { color:C.purple,  bg:"#ede9fe", label:"In Progress" },
  todo:          { color:C.slate,   bg:"#f1f5f9", label:"To Do" },
};

const MILESTONE_STATUS = {
  done:          { color:C.success, bg:"#dcfce7", label:"Completed",   icon:CheckCircle2 },
  "in-progress": { color:C.blue,    bg:"#dbeafe", label:"In Progress", icon:Activity },
  upcoming:      { color:C.slate,   bg:"#f1f5f9", label:"Upcoming",    icon:Clock },
  "at-risk":     { color:C.danger,  bg:"#fee2e2", label:"At Risk",     icon:AlertCircle },
};

const TABS = ["Overview", "Project Sheet", "Issues", "Dashboard", "Tasks", "Timeline", "Team", "Activity", "Documents"] as const;
type Tab = typeof TABS[number];

function isProjectDetailTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

// ─── Modals ───────────────────────────────────────────────────────────────────

const ProjectPickerFeedback = React.createContext<{ ready: boolean; feedback: React.ReactNode }>({ ready: false, feedback: null });

function ModalShell({ title, icon: Icon, iconColor, onClose, children, footer }: {
  title: string; icon: React.ElementType; iconColor: string;
  onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  const { feedback: pickerFeedback } = React.useContext(ProjectPickerFeedback);
  return (
    <ModalLayer onClose={onClose}>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale:0.92, opacity:0, y:16 }}
        animate={{ scale:1,    opacity:1, y:0 }}
        exit={  { scale:0.92, opacity:0, y:16 }}
        transition={{ type:"spring", damping:26, stiffness:380 }}
        aria-label={title}
        aria-modal="true"
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl"
        role="dialog"
        tabIndex={-1}
        style={{ backgroundColor:"var(--color-card)", border:"1px solid var(--color-border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor:`${iconColor}20` }}>
              <Icon className="w-4 h-4" style={{ color:iconColor }} />
            </div>
            <h2 className="text-base font-bold text-foreground">{title}</h2>
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" type="button">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div data-modal-body="true" className="min-h-0 overflow-y-auto px-6 py-5 space-y-4">{pickerFeedback}{children}</div>
        <div data-modal-footer="true" className="flex shrink-0 items-center justify-between px-6 py-4 border-t border-border bg-muted/20">{footer}</div>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}{required && <span style={{ color:C.danger }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function ProjectEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  accentColor = C.blue
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  accentColor?: string;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/70 px-6 py-10 text-center">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ backgroundColor: `${accentColor}14`, color: accentColor }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01]"
          style={{ backgroundColor: accentColor }}
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function TeamMemberAvatar({ member, size = "md" }: { member: ProjectTeamMember; size?: "xs" | "sm" | "md" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClass = size === "xs" ? "h-5 w-5 text-[8px]" : size === "sm" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[10px]";
  const showImage = Boolean(member.avatarUrl) && !imageFailed;

  return (
    <span
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-card font-bold text-white`}
      style={{ backgroundColor: member.color }}
      title={member.name}
    >
      {showImage ? (
        <img
          src={member.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        member.initials
      )}
    </span>
  );
}

function ProjectIdentityAvatar({
  member,
  initials,
  name,
  color,
  avatarUrl,
  size = "sm"
}: {
  member?: ProjectTeamMember;
  initials: string;
  name?: string;
  color: string;
  avatarUrl?: string;
  size?: "xs" | "sm" | "md";
}) {
  const fallbackMember: ProjectTeamMember = member
    ? { ...member, avatarUrl: member.avatarUrl || avatarUrl }
    : {
        id: initials || name || "unassigned",
        initials,
        name: name || initials || "Unassigned",
        email: "",
        role: "",
        color,
        tasks: 0,
        done: 0,
        status: "active",
        avatarUrl
      };

  return <TeamMemberAvatar member={fallbackMember} size={size} />;
}

function TeamMemberMultiSelect({
  members,
  selectedIds,
  onChange,
  placeholder = "Select users"
}: {
  members: ProjectTeamMember[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedMembers = selectedIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is ProjectTeamMember => Boolean(member));

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleMember = (memberId: string) => {
    onChange(
      selectedIds.includes(memberId)
        ? selectedIds.filter((id) => id !== memberId)
        : [...selectedIds, memberId]
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={members.length === 0}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-input bg-background px-3 py-2 text-left text-sm text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? "var(--color-primary)" : "var(--color-input)" }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selectedMembers.length > 0 ? (
            <>
              <span className="flex shrink-0 -space-x-1.5">
                {selectedMembers.slice(0, 4).map((member) => (
                  <TeamMemberAvatar key={member.id} member={member} size="sm" />
                ))}
              </span>
              <span className="min-w-0 truncate text-xs font-semibold">
                {selectedMembers.length === 1
                  ? selectedMembers[0].name
                  : `${selectedMembers.length} users selected`}
              </span>
            </>
          ) : (
            <span className="truncate text-muted-foreground/60">{members.length === 0 ? "No project members" : placeholder}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 z-[70] mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            style={{ boxShadow: "0 16px 40px rgba(15,23,42,0.16)" }}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {selectedMembers.length} selected
              </span>
              {selectedMembers.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {members.map((member) => {
                const selected = selectedIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted ${
                      selected ? "bg-primary/5" : ""
                    }`}
                  >
                    <TeamMemberAvatar member={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">{member.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {member.department || member.role} · {member.email}
                      </span>
                    </span>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"
                    }`}>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TeamMemberSingleSelect({
  members,
  value,
  onChange,
  placeholder = "Select user"
}: {
  members: ProjectTeamMember[];
  value?: ProjectTeamMember;
  onChange: (member: ProjectTeamMember | undefined) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedMember = value ? members.find((member) => member.id === value.id) ?? value : undefined;

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={members.length === 0}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-input bg-background px-3 py-2 text-left text-sm text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: open ? "var(--color-primary)" : "var(--color-input)" }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selectedMember ? (
            <>
              <TeamMemberAvatar member={selectedMember} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{selectedMember.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {selectedMember.department || selectedMember.role || selectedMember.email}
                </span>
              </span>
            </>
          ) : (
            <span className="truncate text-muted-foreground/60">{members.length === 0 ? "No project members" : placeholder}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 z-[70] mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            role="listbox"
            style={{ boxShadow: "0 16px 40px rgba(15,23,42,0.16)" }}
          >
            <div className="border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Project members
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {members.map((member) => {
                const selected = selectedMember?.id === member.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(member);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted ${
                      selected ? "bg-primary/5" : ""
                    }`}
                    role="option"
                  >
                    <TeamMemberAvatar member={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">{member.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {member.department || member.role} · {member.email}
                      </span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function resolveMilestoneAssigneeIds(milestone: Milestone, members: ProjectTeamMember[]) {
  const byIds = (milestone.assigneeIds ?? []).filter((id) => members.some((member) => member.id === id));
  if (byIds.length > 0) return byIds;
  const picMember = getSelectedTeamMember(members, milestone.picUserId);
  return picMember ? [picMember.id] : [];
}

// Add Stage Modal
function AddStageModal({ milestoneName, color, onClose, onSave, members = EMPTY_TEAM_MEMBERS }: {
  milestoneName: string; color: string; onClose: () => void;
  onSave: (stage: StageItem) => Promise<void>;
  members?: ProjectTeamMember[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<StageItem["status"]>("in-progress");
  const [pic, setPic] = useState<ProjectTeamMember | undefined>(members[0]);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const stageName = name.trim();
  const stageMatchesMilestone = normalizeBoardEntityName(stageName) === normalizeBoardEntityName(milestoneName);
  const canCreate = Boolean(stageName && pic && !stageMatchesMilestone);
  const { submit, submitting, submitError } = useModalMutation(onClose);

  useEffect(() => {
    setPic((current) => current && members.some((member) => member.id === current.id) ? current : members[0]);
  }, [members]);

  const STAGE_STATUS_CFG = {
    "upcoming": { label: "Upcoming", color: "#facc15", bg: "#fef9c31b" },
    "in-progress": { label: "In Progress", color: "#3b82f6", bg: "#dbeafe1b" },
    "done": { label: "Completed", color: "#22c55e", bg: "#dcfce71b" }
  };

  return (
    <AnimatePresence>
      <ModalShell title="Add Stage" icon={Flag} iconColor={color} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={() => {
                if(canCreate && pic) {
                  void submit(() => onSave({
                    id: `s-${Date.now()}`,
                    name: stageName,
                    tasks: [],
                    description: description.trim(),
                    status,
                    pic: pic.initials,
                    picName: pic.name,
                    picColor: pic.color,
                    picUserId: pic.id,
                    startDate,
                    dueDate
                  }));
                }
              }}
              disabled={!canCreate || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:color }}>
              <Flag className="w-4 h-4" /> {submitting ? "Creating..." : "Create Stage"}
            </motion.button>
          </>
        }>
        <Field label="Milestone">
          <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">{milestoneName}</div>
        </Field>

        <Field label="Stage Name" required>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Development, QA, Review..."
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none" />
          {stageMatchesMilestone && stageName && (
            <p className="mt-1 text-xs text-destructive">Stage name must be different from the milestone name.</p>
          )}
        </Field>

        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STAGE_STATUS_CFG).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setStatus(k as StageItem["status"])}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:status===k?cfg.color:"var(--color-border)", backgroundColor:status===k?cfg.bg:"transparent", color:status===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee (PIC)">
            <TeamMemberSingleSelect
              members={members}
              value={pic}
              onChange={setPic}
              placeholder="Select stage PIC"
            />
            {pic && <p className="text-[10px] text-muted-foreground mt-1">Selected PIC: {pic.name}</p>}
          </Field>

          <div className="space-y-2">
            <Field label="Start Date">
              <CustomDatePicker ariaLabel="Stage Start Date" value={startDate} onChange={val => setStartDate(val)} />
            </Field>
            <Field label="Due Date">
              <CustomDatePicker ariaLabel="Stage Due Date" value={dueDate} onChange={val => setDueDate(val)} />
            </Field>
          </div>
        </div>

        <Field label="Scope / Description">
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Describe the scope or deliverables of this stage..."
            className="w-full border border-input rounded-xl p-3 text-sm text-foreground bg-background focus:outline-none resize-none" />
        </Field>
        <ModalMutationFeedback error={submitError} />
      </ModalShell>
    </AnimatePresence>
  );
}

// Add Task Modal
function AddTaskModal({ stageName, color, onClose, onSave, members = EMPTY_TEAM_MEMBERS }: {
  stageName: string; color: string; onClose: () => void;
  onSave: (t: TaskItem) => Promise<void>;
  members?: ProjectTeamMember[];
}) {
  const [title,    setTitle]    = useState("");
  const [priority, setPriority] = useState<TaskItem["priority"]>("medium");
  const [status,   setStatus]   = useState<TaskItem["status"]>("todo");
  const [startDate, setStartDate] = useState("");
  const [due,      setDue]      = useState("");
  const [description, setDescription] = useState("");
  const [pic,      setPic]      = useState<ProjectTeamMember | undefined>(members[0]);
  const [plannedHours, setPlannedHours] = useState<number>(8);
  const [actualHours, setActualHours]   = useState<number>(0);
  const { submit, submitting, submitError } = useModalMutation(onClose);

  useEffect(() => {
    setPic((current) => current && members.some((member) => member.id === current.id) ? current : members[0]);
  }, [members]);

  return (
    <AnimatePresence>
      <ModalShell title="Add Task" icon={ListChecks} iconColor={color} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={() => {
                if (!title.trim() || !pic) return;
                void submit(async () => {
                  if (isTaskDateRangeInvalid(startDate, due)) {
                    throw new Error(TASK_DATE_RANGE_ERROR);
                  }
                  await onSave({
                    id:`t-${Date.now()}`,
                    title:title.trim(),
                    status,
                    priority,
                    assignee:pic.initials,
                    aColor:pic.color,
                    assigneeUserId: pic.id,
                    startDate: startDate || undefined,
                    due:due||"TBD",
                    plannedHours,
                    actualHours,
                    description: description.trim() || undefined
                  });
                });
              }}
              disabled={!title.trim() || !pic || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:color }}>
              <ListChecks className="w-4 h-4" /> {submitting ? "Adding..." : "Add Task"}
            </motion.button>
          </>
        }>
        <Field label="Stage">
          <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">{stageName}</div>
        </Field>
        <Field label="Task Title" required>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Describe the task..."
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none" />
        </Field>
        {/* Priority */}
        <Field label="Priority">
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(PRIORITY_CFG) as [TaskItem["priority"], typeof PRIORITY_CFG[keyof typeof PRIORITY_CFG]][]).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setPriority(k)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:priority===k?cfg.color:"var(--color-border)", backgroundColor:priority===k?cfg.bg:"transparent", color:priority===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>
        {/* Status */}
        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(TASK_STATUS) as [TaskItem["status"], typeof TASK_STATUS[keyof typeof TASK_STATUS]][]).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setStatus(k)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:status===k?cfg.color:"var(--color-border)", backgroundColor:status===k?cfg.bg:"transparent", color:status===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>
        <Field label="Assignee">
          <TeamMemberSingleSelect
            members={members}
            value={pic}
            onChange={setPic}
            placeholder="Select task assignee"
          />
          {pic && <p className="text-[10px] text-muted-foreground mt-1">Selected assignee: {pic.name}</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date (optional)">
            <CustomDatePicker ariaLabel="Start Date" value={startDate} onChange={val => setStartDate(val)} />
          </Field>
          <Field label="Due Date (optional)">
            <CustomDatePicker ariaLabel="Due Date" value={due} onChange={val => setDue(val)} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Describe the scope or deliverables of this task..."
            className="w-full border border-input rounded-xl p-3 text-sm text-foreground bg-background focus:outline-none resize-none" />
        </Field>
        {/* Hours */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="Planned Hours (Giờ kế hoạch)">
            <input
              type="number"
              min={0}
              value={plannedHours}
              onChange={e => setPlannedHours(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
            />
          </Field>
          <Field label="Actual Hours (Giờ thực tế)">
            <input
              type="number"
              min={0}
              value={actualHours}
              onChange={e => setActualHours(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
            />
          </Field>
        </div>
        <ModalMutationFeedback error={submitError} />
      </ModalShell>
    </AnimatePresence>
  );
}

// Milestone Modal (unchanged from before)
function MilestoneModal({ projectColor, onClose, onSave, members = EMPTY_TEAM_MEMBERS }: {
  projectColor:string; onClose:()=>void; onSave:(m:Milestone)=>Promise<void>;
  members?: ProjectTeamMember[];
}) {
  const [name, setName]        = useState("");
  const [desc, setDesc]        = useState("");
  const [start,setStart]       = useState("");
  const [due,  setDue]         = useState("");
  const [status,setStatus]     = useState<Milestone["status"]>("upcoming");
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>(members[0] ? [members[0].id] : []);
  const selectedAssignees = selectedAssigneeIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is ProjectTeamMember => Boolean(member));
  const pic = selectedAssignees[0];
  const { submit, submitting, submitError } = useModalMutation(onClose);

  useEffect(() => {
    if (selectedAssigneeIds.length === 0 && members[0]) {
      setSelectedAssigneeIds([members[0].id]);
    }
  }, [members, selectedAssigneeIds.length]);

  return (
    <AnimatePresence>
      <ModalShell title="Add Milestone" icon={Target} iconColor={projectColor} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={() => {
                if(!name.trim() || !pic) return;
                void submit(() => onSave({
                  id:`m-${Date.now()}`,
                  name:name.trim(),
                  description:desc,
                  startDate:start||"TBD",
                  dueDate:due||"TBD",
                  pic:pic.initials,
                  picName:pic.name,
                  picColor:pic.color,
                  picUserId:pic.id,
                  assigneeIds:selectedAssigneeIds,
                  assigneeNames:selectedAssignees.map((member) => member.name),
                  status,
                  order:999
                }));
              }}
              disabled={!name.trim() || !pic || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:projectColor }}>
              <Target className="w-4 h-4" /> {submitting ? "Adding..." : "Add Milestone"}
            </motion.button>
          </>
        }>
        <Field label="Milestone Name" required>
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Beta Launch — Internal"
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none" />
        </Field>
        <Field label="Description">
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} placeholder="What does this milestone achieve?"
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none resize-none" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date">
            <CustomDatePicker ariaLabel="Milestone Start Date" value={start} onChange={val => setStart(val)} />
          </Field>
          <Field label="Due Date">
            <CustomDatePicker ariaLabel="Milestone Due Date" value={due} onChange={val => setDue(val)} />
          </Field>
        </div>
        <Field label="Person in Charge">
          <TeamMemberMultiSelect
            members={members}
            selectedIds={selectedAssigneeIds}
            onChange={setSelectedAssigneeIds}
            placeholder="Select milestone PICs"
          />
          {pic && <p className="mt-1 text-[10px] text-muted-foreground">Primary PIC: {pic.name}</p>}
        </Field>
        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(MILESTONE_STATUS) as [Milestone["status"], typeof MILESTONE_STATUS[keyof typeof MILESTONE_STATUS]][]).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setStatus(k)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all"
                style={{ borderColor:status===k?cfg.color:"var(--color-border)", backgroundColor:status===k?cfg.bg:"transparent", color:status===k?cfg.color:"var(--color-muted-foreground)" }}>
                <cfg.icon className="w-3 h-3" />{cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>
        <ModalMutationFeedback error={submitError} />
      </ModalShell>
    </AnimatePresence>
  );
}

// Invite Member Modal
function InviteMemberModal({ color, onClose, onInvite, teamMembers, workspaceUsers }: {
  color: string;
  onClose: () => void;
  onInvite: (user: ProjectTeamMember) => Promise<void>;
  teamMembers: ProjectTeamMember[];
  workspaceUsers: ProjectTeamMember[];
}) {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const availableUsers = workspaceUsers.filter(su =>
    !teamMembers.some(tm => projectMemberMatches(tm, su))
  );

  const filteredUsers = availableUsers.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  const selectedUser = availableUsers.find(u => u.id === selectedUserId);

  return (
    <AnimatePresence>
      <ModalShell title="Invite Team Member" icon={UserPlus} iconColor={color} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={async () => {
                if (!selectedUser || submitting) return;
                try {
                  setSubmitting(true);
                  setSubmitError(null);
                  await onInvite(selectedUser);
                  onClose();
                } catch (error) {
                  setSubmitError(error instanceof Error ? error.message : "Could not add member");
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={!selectedUser || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:color }}>
              <UserPlus className="w-4 h-4" /> {submitting ? "Adding..." : "Add to Project"}
            </motion.button>
          </>
        }>

        <Field label="Search System Users">
          <div className="relative">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type name, email, or role..."
              className="w-full border border-input rounded-xl pl-9 pr-3.5 py-2 text-xs text-foreground bg-background focus:outline-none placeholder:text-muted-foreground/40"
            />
            <Search className="w-3.5 h-3.5 text-muted-foreground/50 absolute left-3 top-3.5" />
          </div>
        </Field>

        <div className="border border-border rounded-xl overflow-hidden bg-background">
          <div className="max-h-40 overflow-y-auto divide-y divide-border">
            {filteredUsers.length > 0 ? (
              filteredUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  type="button"
                  className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors text-xs ${
                    selectedUserId === u.id ? "bg-muted/70" : "hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <TeamMemberAvatar member={u} size="sm" />
                    <div>
                      <p className="font-semibold text-foreground">{u.name}</p>
                      <p className="text-[10px] text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
                      {u.role}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {availableUsers.length === 0 ? "All system users are already project members." : "No users match your search."}
              </div>
            )}
          </div>
        </div>

        {selectedUser && (
          <motion.div
            initial={{ opacity:0, y:5 }}
            animate={{ opacity:1, y:0 }}
            className="mt-3 p-3.5 rounded-xl border border-border bg-muted/20 space-y-2.5"
          >
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Preview Selected Profile</h4>
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-sm" style={{ backgroundColor:selectedUser.color }}>
                {selectedUser.initials}
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">{selectedUser.name}</p>
                <p className="text-[10px] text-muted-foreground">{selectedUser.role} • {selectedUser.department ?? "Workspace"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground pt-1.5 border-t border-border/40">
              <div>Email: <span className="font-medium text-foreground">{selectedUser.email}</span></div>
              <div>Department: <span className="font-medium text-foreground">{selectedUser.department ?? "Workspace"}</span></div>
            </div>
          </motion.div>
        )}

        {submitError ? (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
            {submitError}
          </div>
        ) : null}
      </ModalShell>
    </AnimatePresence>
  );
}

// File Upload Area Component
function FileUploadArea({
  fileName,
  fileSize,
  onFileSelect,
  projectColor,
}: {
  fileName: string;
  fileSize: string;
  onFileSelect: (file: File | null, name: string, size: string, extension: string) => void;
  projectColor: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = (file: File) => {
    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf("."));
    const ext = file.name.substring(file.name.lastIndexOf(".") + 1).toUpperCase();
    const sizeStr = (file.size / (1024 * 1024)).toFixed(1) + " MB";
    onFileSelect(file, nameWithoutExt, sizeStr, ext);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-5 text-center transition-all flex flex-col items-center justify-center gap-2 bg-card ${
        dragActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
      }`}
      style={{ borderColor: dragActive ? projectColor : "var(--color-border)" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleChange}
      />
      {fileName ? (
        <div className="flex items-center gap-3 w-full text-left bg-muted/40 p-3 rounded-lg border border-border/60">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${projectColor}15` }}>
            <Paperclip className="w-4.5 h-4.5" style={{ color: projectColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{fileName}</p>
            <p className="text-[10px] text-muted-foreground">{fileSize} • Selected</p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFileSelect(null, "", "", "");
            }}
            className="text-[10px] font-bold text-danger hover:underline"
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
            <Upload className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Drag a file here or choose one</p>
            <p className="text-[10px] text-muted-foreground">PDF, DOCX, XLSX, FIG, PPTX up to 10MB</p>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">Choose file</button>
        </>
      )}
    </div>
  );
}

// Add Document Modal
function AddDocModal({
  projectColor,
  onClose,
  onAdd,
}: {
  projectColor: string;
  onClose: () => void;
  onAdd: (doc: Omit<ProjectDoc, "id">, file: File, note: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Requirements");
  const [type, setType] = useState("PDF");
  const [size, setSize] = useState("1.0 MB");
  const [note, setNote] = useState("Initial upload note");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = ["Requirements", "Technical", "Design", "Operations", "Legal", "Other"];
  const fileTypes = ["PDF", "DOCX", "XLSX", "FIG", "PPTX", "Other"];

  const handleFileSelect = (file: File | null, fileName: string, fileSize: string, ext: string) => {
    setSelectedFile(file);
    setUploadedFileName(fileName);
    if (fileName) {
      setName(fileName);
      setSize(fileSize);
      if (fileTypes.includes(ext)) {
        setType(ext);
      } else {
        setType("Other");
      }
    } else {
      setName("");
      setSize("1.0 MB");
    }
  };

  return (
    <AnimatePresence>
      <ModalShell
        title="Add Document"
        icon={FileText}
        iconColor={projectColor}
        onClose={onClose}
        footer={
          <>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={async () => {
                if (!name.trim() || !selectedFile || saving) return;
                let finalColor = C.blue;
                if (type === "PDF") finalColor = C.danger;
                else if (type === "FIG") finalColor = C.pink;
                else if (type === "XLSX") finalColor = C.success;
                else if (type === "DOCX") finalColor = C.blue;
                else if (type === "PPTX") finalColor = C.warning;
                else finalColor = C.slate;

                setSaving(true);
                setError(null);
                const saved = await onAdd(
                  {
                    name: name.trim(),
                    type,
                    color: finalColor,
                    category,
                    versions: [],
                  },
                  selectedFile,
                  note.trim() || "Initial upload"
                );
                setSaving(false);
                if (saved) onClose();
                else setError("Upload failed. Your selected file and notes are still available.");
              }}
              disabled={!name.trim() || !selectedFile || saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor: projectColor }}
            >
              <Plus className="w-4 h-4" /> {saving ? "Uploading..." : "Save Document"}
            </motion.button>
          </>
        }
      >
        <Field label="Upload File">
          <FileUploadArea
            fileName={uploadedFileName}
            fileSize={size}
            onFileSelect={handleFileSelect}
            projectColor={projectColor}
          />
        </Field>
        {error ? <p className="text-xs font-semibold text-red-600" role="alert">{error}</p> : null}

        <Field label="Document Name" required>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Product Requirements Doc v3"
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <CustomDropdown
              options={categories.map((c) => ({ value: c, label: c }))}
              value={category}
              onChange={setCategory}
            />
          </Field>

          <Field label="File Type">
            <CustomDropdown
              options={fileTypes.map((t) => ({ value: t, label: t }))}
              value={type}
              onChange={setType}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="File Size">
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 1.2 MB"
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
            />
          </Field>

          <Field label="Initial Version">
            <input
              disabled
              value="v1.0"
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-muted-foreground bg-muted/30 focus:outline-none"
            />
          </Field>
        </div>

        <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Uploader identity is recorded from the authenticated session.</p>

        <Field label="Upload / Version Notes">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. Initial draft of product specs"
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none resize-none"
          />
        </Field>
      </ModalShell>
    </AnimatePresence>
  );
}

type VersionSaveResult = { ok: true } | { ok: false; error: string };

// Add Version Modal
function AddVersionModal({
  doc,
  projectColor,
  onClose,
  onAddVersion,
}: {
  doc: ProjectDoc;
  projectColor: string;
  onClose: () => void;
  onAddVersion: (docId: string, file: File, note: string) => Promise<VersionSaveResult>;
}) {
  const nextVer = doc.versions.reduce((latest, version) => Math.max(latest, version.version), 0) + 1;
  const [size, setSize] = useState("1.0 MB");
  const [note, setNote] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (file: File | null, fileName: string, fileSize: string, ext: string) => {
    setSelectedFile(file);
    setUploadedFileName(fileName);
    if (fileName) {
      setSize(fileSize);
    } else {
      setSize("1.0 MB");
    }
  };

  return (
    <AnimatePresence>
      <ModalShell
        title={`New Version for ${doc.name}`}
        icon={GitBranch}
        iconColor={projectColor}
        onClose={onClose}
        footer={
          <>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={async () => {
                if (!selectedFile || saving) return;
                setSaving(true);
                setError(null);
                const result = await onAddVersion(doc.id, selectedFile, note.trim() || `Version ${nextVer} update`);
                setSaving(false);
                if (result.ok) onClose();
                else setError(result.error);
              }}
              disabled={!selectedFile || saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: projectColor }}
            >
              <GitBranch className="w-4 h-4" /> {saving ? "Uploading..." : "Save New Version"}
            </motion.button>
          </>
        }
      >
        <Field label="Upload New Version File">
          <FileUploadArea
            fileName={uploadedFileName}
            fileSize={size}
            onFileSelect={handleFileSelect}
            projectColor={projectColor}
          />
        </Field>
        {error ? <p className="text-xs font-semibold text-red-600" role="alert">{error}</p> : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Next Version">
            <input
              disabled
              value={`v${nextVer}.0`}
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-muted-foreground bg-muted/30 focus:outline-none font-semibold"
            />
          </Field>

          <Field label="New File Size">
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 2.1 MB"
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
            />
          </Field>
        </div>

        <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Uploader identity is recorded from the authenticated session.</p>

        <Field label="What Changed in this Version?" required>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Incorporated feedback from the PM regarding client onboarding flow."
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none resize-none"
          />
        </Field>
      </ModalShell>
    </AnimatePresence>
  );
}

// Version History Modal
function VersionHistoryModal({
  doc,
  projectColor,
  onClose,
  onDownload,
  downloadingFileId,
  downloadError,
  teamMembers,
}: {
  doc: ProjectDoc;
  projectColor: string;
  onClose: () => void;
  onDownload: (fileObjectId: string) => void | Promise<void>;
  downloadingFileId: string | null;
  downloadError?: string | null;
  teamMembers: ProjectTeamMember[];
}) {
  return (
    <AnimatePresence>
      <ModalShell
        title={`Version History — ${doc.name}`}
        icon={History}
        iconColor={projectColor}
        onClose={onClose}
        footer={
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: projectColor }}
          >
            Close
          </button>
        }
      >
        {downloadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
            {downloadError}
          </div>
        ) : null}
        <div className="max-h-[400px] overflow-y-auto pr-1 space-y-4">
          <div className="relative border-l border-border pl-6 ml-3 space-y-5">
            {doc.versions.slice().reverse().map((v, idx) => {
              const member = teamMembers.find((m) => m.initials === v.author);
              return (
                <div key={v.version} className="relative">
                  <span
                    className="absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center"
                    style={{ backgroundColor: projectColor }}
                  />

                  <div className="bg-muted/30 border border-border/60 rounded-xl p-3.5 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground bg-card border border-border px-2 py-0.5 rounded-md">
                        v{v.version}.0
                      </span>
                      <span className="text-[10px] text-muted-foreground">{v.date}</span>
                    </div>

                    <p className="text-xs text-foreground/90 font-medium italic">"{v.note}"</p>

                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <ProjectIdentityAvatar
                          member={member}
                          initials={v.author}
                          name={member?.name ?? v.author}
                          color={member?.color ?? "#64748b"}
                          size="xs"
                        />
                        <span>{member?.name ?? v.author}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>Size: {v.size}</span>
                        {v.fileObjectId ? (
                          <button
                            aria-label={`Download ${doc.name} version ${v.version}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            disabled={downloadingFileId === v.fileObjectId}
                            onClick={() => void onDownload(v.fileObjectId!)}
                            type="button"
                          >
                            <Download className="h-3 w-3" />
                            {downloadingFileId === v.fileObjectId ? "Downloading..." : "Download"}
                          </button>
                        ) : (
                          <span title="Legacy version metadata has no durable file object">File unavailable (legacy)</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </ModalShell>
    </AnimatePresence>
  );
}

// ─── Action Menu Dropdown ─────────────────────────────────────────────────────


interface MenuItem {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  danger?: boolean;
}

function ActionMenu({
  items,
  onClose,
  anchorRef,
}: {
  items: MenuItem[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const positionMenu = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const menuHeight = ref.current?.offsetHeight ?? items.length * 37 + 8;
      const menuWidth = ref.current?.offsetWidth ?? 160;
      const gap = 6;
      const viewportPadding = 8;
      const openBelowTop = anchorRect.bottom + gap;
      const openAboveTop = anchorRect.top - menuHeight - gap;
      const top =
        openBelowTop + menuHeight <= window.innerHeight - viewportPadding
          ? openBelowTop
          : Math.max(viewportPadding, openAboveTop);
      const left = Math.min(
        Math.max(viewportPadding, anchorRect.right - menuWidth),
        window.innerWidth - menuWidth - viewportPadding
      );
      setPosition({ top, left });
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [anchorRef, items.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchorRef, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="fixed z-[80] w-40 rounded-xl border border-border bg-card shadow-xl overflow-hidden py-1"
      style={{ top: position.top, left: position.left, boxShadow:"0 8px 24px rgba(0,0,0,0.12)" }}>
      {items.map(item => (
        <button key={item.label}
          onClick={() => { anchorRef.current?.focus({ preventScroll: true }); item.onClick(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium transition-colors hover:bg-muted text-left"
          style={{ color: item.danger ? C.danger : "var(--color-foreground)" }}>
          <item.icon className="w-3.5 h-3.5 shrink-0" />{item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({ title, description, onClose, onConfirm, confirming = false, error }: {
  title: string; description: string;
  onClose: () => void; onConfirm: () => void | Promise<void>;
  confirming?: boolean;
  error?: string | null;
}) {
  return (
    <ModalLayer closeOnEscape={!confirming} onClose={onClose}>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}
      onClick={onClose}>
      <motion.div initial={{ scale:0.92, opacity:0 }} animate={{ scale:1, opacity:1 }}
        aria-label={title}
        aria-modal="true"
        exit={{ scale:0.92, opacity:0 }} transition={{ type:"spring", damping:26, stiffness:380 }}
        className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        tabIndex={-1}
        style={{ backgroundColor:"var(--color-card)", border:"1px solid var(--color-border)" }}
        onClick={e => e.stopPropagation()}>
        {/* Icon */}
        <div className="flex flex-col items-center px-6 pt-8 pb-4 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor:"#fee2e2" }}>
            <Trash2 className="w-5 h-5" style={{ color:C.danger }} />
          </div>
          <h2 className="text-base font-bold text-foreground mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 px-6 pb-6">
          <button onClick={onClose} disabled={confirming}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors">
            Cancel
          </button>
          <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
            onClick={() => void onConfirm()}
            disabled={confirming}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-60"
            style={{ backgroundColor:C.danger }}>
            {confirming ? "Deleting..." : "Delete"}
          </motion.button>
        </div>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

// ─── Edit Stage Modal ─────────────────────────────────────────────────────────

function EditStageModal({ stage, color, onClose, onSave, members = EMPTY_TEAM_MEMBERS }: {
  stage: StageItem; color: string;
  onClose: () => void; onSave: (updated: StageItem) => Promise<void>;
  members?: ProjectTeamMember[];
}) {
  const [name, setName] = useState(stage.name);
  const [description, setDescription] = useState(stage.description ?? "");
  const [status, setStatus] = useState<StageItem["status"]>(stage.status ?? "in-progress");

  const initPic = getSelectedTeamMember(members, stage.picUserId);
  const [pic, setPic] = useState<ProjectTeamMember | undefined>(initPic);
  const directoryReady = React.useContext(ProjectPickerFeedback).ready;
  const staleAssigneeError = directoryReady && !initPic && (stage.picUserId || (stage.picName && stage.picName !== "Unassigned"))
    ? PROJECT_MEMBER_ASSIGNMENT_ERROR
    : null;

  const [startDate, setStartDate] = useState(stage.startDate ?? "");
  const [dueDate, setDueDate] = useState(stage.dueDate ?? "");
  const { submit, submitting, submitError } = useModalMutation(onClose);

  useEffect(() => {
    setPic((current) => {
      if (current && members.some((member) => member.id === current.id)) {
        return current;
      }
      return getSelectedTeamMember(members, stage.picUserId);
    });
  }, [members, stage.pic, stage.picName, stage.picUserId]);

  const STAGE_STATUS_CFG = {
    "upcoming": { label: "Upcoming", color: "#facc15", bg: "#fef9c31b" },
    "in-progress": { label: "In Progress", color: "#3b82f6", bg: "#dbeafe1b" },
    "done": { label: "Completed", color: "#22c55e", bg: "#dcfce71b" }
  };

  return (
    <AnimatePresence>
      <ModalShell title="Edit Stage" icon={Pencil} iconColor={color} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={() => {
                if(!name.trim() || !pic) return;
                void submit(() => onSave({
                  ...stage,
                  name: name.trim(),
                  description: description.trim(),
                  status,
                  pic: pic.initials,
                  picName: pic.name,
                  picColor: pic.color,
                  picUserId: pic.id,
                  startDate,
                  dueDate
                }));
              }}
              disabled={!name.trim() || !pic || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:color }}>
              <Pencil className="w-4 h-4" /> {submitting ? "Saving..." : "Save Changes"}
            </motion.button>
          </>
        }>
        <Field label="Stage Name" required>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none" />
        </Field>

        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STAGE_STATUS_CFG).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setStatus(k as StageItem["status"])}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:status===k?cfg.color:"var(--color-border)", backgroundColor:status===k?cfg.bg:"transparent", color:status===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee (PIC)">
            <TeamMemberSingleSelect
              members={members}
              value={pic}
              onChange={setPic}
              placeholder="Select stage PIC"
            />
            {pic && <p className="text-[10px] text-muted-foreground mt-1">Selected PIC: {pic.name}</p>}
          </Field>

          <div className="space-y-2">
            <Field label="Start Date">
              <CustomDatePicker ariaLabel="Stage Start Date" value={startDate} onChange={val => setStartDate(val)} />
            </Field>
            <Field label="Due Date">
              <CustomDatePicker ariaLabel="Stage Due Date" value={dueDate} onChange={val => setDueDate(val)} />
            </Field>
          </div>
        </div>

        <Field label="Scope / Description">
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Describe the scope or deliverables of this stage..."
            className="w-full border border-input rounded-xl p-3 text-sm text-foreground bg-background focus:outline-none resize-none" />
        </Field>
        <ModalMutationFeedback error={submitError ?? staleAssigneeError} />
      </ModalShell>
    </AnimatePresence>
  );
}

function EditMilestoneModal({ milestone, color, onClose, onSave, members = EMPTY_TEAM_MEMBERS }: {
  milestone: Milestone; color: string;
  onClose: () => void; onSave: (updated: Milestone) => Promise<void>;
  members?: ProjectTeamMember[];
}) {
  const [name, setName] = useState(milestone.name);
  const [description, setDescription] = useState(milestone.description ?? "");
  const [status, setStatus] = useState<Milestone["status"]>(milestone.status);

  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>(() => resolveMilestoneAssigneeIds(milestone, members));
  const selectedAssignees = selectedAssigneeIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is ProjectTeamMember => Boolean(member));
  const pic = selectedAssignees[0];
  const directoryReady = React.useContext(ProjectPickerFeedback).ready;
  const staleAssigneeError = directoryReady && (milestone.picUserId || milestone.assigneeIds?.length) && !pic
    ? "The current PIC is no longer an active project member. You can keep it while renaming, or select an active member to transfer ownership."
    : null;

  const [startDate, setStartDate] = useState(milestone.startDate);
  const [dueDate, setDueDate] = useState(milestone.dueDate);
  const { submit, submitting, submitError } = useModalMutation(onClose);

  useEffect(() => {
    setSelectedAssigneeIds(resolveMilestoneAssigneeIds(milestone, members));
  }, [members, milestone]);

  return (
    <AnimatePresence>
      <ModalShell title="Edit Milestone" icon={Pencil} iconColor={color} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={() => {
                if(!name.trim()) return;
                void submit(() => onSave({
                  ...milestone,
                  name: name.trim(),
                  description: description.trim(),
                  status,
                  pic: pic?.initials ?? milestone.pic,
                  picName: pic?.name ?? milestone.picName,
                  picColor: pic?.color ?? milestone.picColor,
                  picUserId: pic?.id ?? milestone.picUserId,
                  assigneeIds: selectedAssigneeIds,
                  assigneeNames: selectedAssignees.map((member) => member.name),
                  startDate,
                  dueDate
                }));
              }}
              disabled={!name.trim() || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:color }}>
              <Pencil className="w-4 h-4" /> {submitting ? "Saving..." : "Save Changes"}
            </motion.button>
          </>
        }>
        <Field label="Milestone Name" required>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none" />
        </Field>

        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(MILESTONE_STATUS).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setStatus(k as Milestone["status"])}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:status===k?cfg.color:"var(--color-border)", backgroundColor:status===k?cfg.bg:"transparent", color:status===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee (PIC)">
            <TeamMemberMultiSelect
              members={members}
              selectedIds={selectedAssigneeIds}
              onChange={setSelectedAssigneeIds}
              placeholder="Select milestone PICs"
            />
            {pic && <p className="text-[10px] text-muted-foreground mt-1">Primary PIC: {pic.name}</p>}
          </Field>

          <div className="space-y-2">
            <Field label="Start Date">
              <CustomDatePicker ariaLabel="Stage Start Date" value={startDate} onChange={val => setStartDate(val)} />
            </Field>
            <Field label="Due Date">
              <CustomDatePicker ariaLabel="Stage Due Date" value={dueDate} onChange={val => setDueDate(val)} />
            </Field>
          </div>
        </div>

        <Field label="Scope / Description">
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Describe the scope or deliverables of this milestone..."
            className="w-full border border-input rounded-xl p-3 text-sm text-foreground bg-background focus:outline-none resize-none" />
        </Field>
        <ModalMutationFeedback error={submitError ?? staleAssigneeError} />
      </ModalShell>
    </AnimatePresence>
  );
}

// ─── Edit Task Modal ──────────────────────────────────────────────────────────

function EditTaskModal({ task, color, onClose, onSave, members = EMPTY_TEAM_MEMBERS }: {
  task: TaskItem; color: string;
  onClose: () => void; onSave: (t: TaskItem) => Promise<void>;
  members?: ProjectTeamMember[];
}) {
  const [title,    setTitle]    = useState(task.title);
  const [priority, setPriority] = useState<TaskItem["priority"]>(task.priority);
  const [status,   setStatus]   = useState<TaskItem["status"]>(task.status);
  const [startDate, setStartDate] = useState(task.startDate ?? "");
  const [due,      setDue]      = useState(task.due === "TBD" ? "" : task.due);
  const initPic = getSelectedTeamMember(members, task.assigneeUserId);
  const [pic, setPic] = useState<ProjectTeamMember | undefined>(initPic);
  const directoryReady = React.useContext(ProjectPickerFeedback).ready;
  const staleAssigneeError = directoryReady && !initPic && (task.assigneeUserId || (task.assignee && task.assignee !== "Unassigned"))
    ? PROJECT_MEMBER_ASSIGNMENT_ERROR
    : null;
  const [plannedHours, setPlannedHours] = useState<number>(task.plannedHours ?? 8);
  const [actualHours, setActualHours]   = useState<number>(task.actualHours ?? 0);
  const [description, setDescription]   = useState<string>(task.description ?? "");
  const { submit, submitting, submitError } = useModalMutation(onClose);

  useEffect(() => {
    setPic((current) => {
      if (current && members.some((member) => member.id === current.id)) {
        return current;
      }
      return getSelectedTeamMember(members, task.assigneeUserId);
    });
  }, [members, task.assignee, task.assigneeUserId]);

  return (
    <AnimatePresence>
      <ModalShell title="Edit Task" icon={Pencil} iconColor={color} onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
              onClick={() => {
                if (!title.trim() || !pic) return;
                void submit(async () => {
                  if (isTaskDateRangeInvalid(startDate, due)) {
                    throw new Error(TASK_DATE_RANGE_ERROR);
                  }
                  await onSave({
                    ...task,
                    title:title.trim(),
                    status,
                    priority,
                    assignee:pic.initials,
                    aColor:pic.color,
                    assigneeUserId: pic.id,
                    startDate: startDate || undefined,
                    due:due||"TBD",
                    plannedHours,
                    actualHours,
                    description: description.trim()
                  });
                });
              }}
              disabled={!title.trim() || !pic || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor:color }}>
              <Pencil className="w-4 h-4" /> {submitting ? "Saving..." : "Save Changes"}
            </motion.button>
          </>
        }>
        <Field label="Task Title" required>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none" />
        </Field>
        <Field label="Priority">
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(PRIORITY_CFG) as [TaskItem["priority"], typeof PRIORITY_CFG[keyof typeof PRIORITY_CFG]][]).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setPriority(k)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:priority===k?cfg.color:"var(--color-border)", backgroundColor:priority===k?cfg.bg:"transparent", color:priority===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>
        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(TASK_STATUS) as [TaskItem["status"], typeof TASK_STATUS[keyof typeof TASK_STATUS]][]).map(([k, cfg]) => (
              <motion.button key={k} whileTap={{ scale:0.95 }} onClick={() => setStatus(k)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{ borderColor:status===k?cfg.color:"var(--color-border)", backgroundColor:status===k?cfg.bg:"transparent", color:status===k?cfg.color:"var(--color-muted-foreground)" }}>
                {cfg.label}
              </motion.button>
            ))}
          </div>
        </Field>
        <Field label="Assignee">
          <TeamMemberSingleSelect
            members={members}
            value={pic}
            onChange={setPic}
            placeholder="Select task assignee"
          />
          {pic && <p className="text-[10px] text-muted-foreground mt-1">Selected assignee: {pic.name}</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date (optional)">
            <CustomDatePicker ariaLabel="Task Start Date" value={startDate} onChange={val => setStartDate(val)} />
          </Field>
          <Field label="Due Date (optional)">
            <CustomDatePicker ariaLabel="Task Due Date" value={due} onChange={val => setDue(val)} />
          </Field>
        </div>
        {/* Hours */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="Planned Hours (Giờ kế hoạch)">
            <input
              type="number"
              min={0}
              value={plannedHours}
              onChange={e => setPlannedHours(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
            />
          </Field>
          <Field label="Actual Hours (Giờ thực tế)">
            <input
              type="number"
              min={0}
              value={actualHours}
              onChange={e => setActualHours(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full border border-input rounded-xl px-3.5 py-2.5 text-sm text-foreground bg-background focus:outline-none"
            />
          </Field>
        </div>

        <Field label="Scope / Description">
          <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Describe the scope or deliverables of this task..."
            className="w-full border border-input rounded-xl p-3 text-sm text-foreground bg-background focus:outline-none resize-none" />
        </Field>
        <ModalMutationFeedback error={submitError ?? staleAssigneeError} />
      </ModalShell>
    </AnimatePresence>
  );
}

function LegacyTaskDetailsDrawer({ task, milestoneName, stageName, color, onClose, onSaveHours, onEditTask, members = EMPTY_TEAM_MEMBERS }: {
  task: TaskItem;
  milestoneName: string;
  stageName: string;
  color: string;
  onClose: () => void;
  onSaveHours: (actualHours: number, plannedHours: number, timeEntries: TimeEntry[]) => void;
  onEditTask: () => void;
  members?: ProjectTeamMember[];
}) {
  const [actualHours, setActualHours] = useState<number>(task.actualHours ?? 0);
  const [plannedHours, setPlannedHours] = useState<number>(task.plannedHours ?? 8);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(task.timeEntries ?? []);
  const [currentStatus, setCurrentStatus] = useState<TaskItem["status"]>(task.status);

  const initPic = getSelectedTeamMember(members, task.assigneeUserId);

  // Logging entry states
  const [logHours, setLogHours] = useState<number>(1);
  const [logDate, setLogDate] = useState<string>(dateInputValue());
  const [logPeriod, setLogPeriod] = useState<string>("08:00 - 10:00");
  const [logDescription, setLogDescription] = useState<string>("");
  const [logUser, setLogUser] = useState<ProjectTeamMember | undefined>(initPic);
  const [logSaving, setLogSaving] = useState(false);
  const [logMessage, setLogMessage] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [planningUserId, setPlanningUserId] = useState<string>(initPic?.id ?? members[0]?.id ?? "");
  const [planningDate, setPlanningDate] = useState<string>(dateInputValue());
  const [planningStartTime, setPlanningStartTime] = useState<string>("09:00");
  const [planningDurationHours, setPlanningDurationHours] = useState<number>(2);
  const [planningNotes, setPlanningNotes] = useState<string>("");
  const [planningSaving, setPlanningSaving] = useState(false);
  const [planningMessage, setPlanningMessage] = useState<string | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);

  const ts = TASK_STATUS[currentStatus];
  const tp = PRIORITY_CFG[task.priority];

  const handleAddLog = async () => {
    if (logHours <= 0 || !logDescription.trim() || !logUser) return;

    setLogSaving(true);
    setLogError(null);
    setLogMessage(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/time-entries`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: logUser.id,
          workDate: buildWorkLogDateIso(logDate, logPeriod),
          minutes: Math.round(logHours * 60),
          billable: true,
          workType: logPeriod.trim() || "delivery",
          approvalStatus: "submitted",
          note: logDescription.trim()
        })
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Could not log actual work: ${response.status}`);
      }

      const saved = mapTimeEntryToUi((await response.json()) as TaskTimeEntrySummary);
      const updated = [...timeEntries, saved];
      setTimeEntries(updated);

      const totalActual = sumHours(updated.map(entry => entry.actualHours));
      setActualHours(totalActual);
      if (currentStatus === "todo") {
        setCurrentStatus("in-progress");
      }
      onSaveHours(totalActual, plannedHours, updated);

      setLogHours(1);
      setLogDescription("");
      setLogMessage("Đã lưu giờ thực tế, cập nhật trạng thái task và ghi Activity cho project.");
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Could not log actual work");
    } finally {
      setLogSaving(false);
    }
  };

  const handleCreatePlanningBlock = async () => {
    const selectedUser = members.find((member) => member.id === planningUserId);
    if (!selectedUser || planningDurationHours <= 0 || !planningDate || !planningStartTime) return;

    setPlanningSaving(true);
    setPlanningError(null);
    setPlanningMessage(null);

    const startAt = buildLocalDateTimeIso(planningDate, planningStartTime);
    const startDate = new Date(startAt);
    const endAt = new Date(startDate.getTime() + planningDurationHours * 60 * 60 * 1000).toISOString();
    const plannedMinutes = Math.round(planningDurationHours * 60);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/planning-blocks`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          title: task.title,
          notes: planningNotes.trim() || undefined,
          startAt,
          endAt,
          plannedMinutes,
          status: "planned"
        })
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Could not create planning block: ${response.status}`);
      }

      const endTime = new Date(endAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      setPlanningMessage(`Đã đưa lên Calendar: ${planningStartTime} - ${endTime} · ${selectedUser.name}`);
      setPlanningNotes("");
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Could not create planning block");
    } finally {
      setPlanningSaving(false);
    }
  };

  const PRESETS = ["08:00 - 10:00", "10:00 - 12:00", "13:30 - 15:30", "15:30 - 17:30"];

  return (
    <ModalLayer onClose={onClose}>
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
      />

      {/* Drawer Body */}
      <motion.div
        aria-label="Chi tiết công việc"
        aria-modal="true"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 220 }}
        className="relative w-full max-w-[460px] h-full bg-background border-l border-border shadow-2xl z-50 flex flex-col p-6 overflow-y-auto"
        role="dialog"
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-border mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: color }}>
              <ListChecks className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Chi tiết công việc</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider font-mono">ID: {task.id}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onEditTask}
              title="Chỉnh sửa công việc"
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors flex items-center gap-1 text-xs font-semibold"
            >
              <Pencil className="w-4 h-4" /> Sửa
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Task Title */}
        <div className="mb-6">
          <h2 className="text-base font-extrabold text-foreground leading-snug">{task.title}</h2>
        </div>

        {/* Metadata Details Grid */}
        <div className="space-y-4 mb-6 pb-6 border-b border-border">
          {/* Milestone & Stage */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">Mốc & Giai đoạn:</span>
            <span className="col-span-2 text-xs font-bold text-foreground">
              {milestoneName} ➔ {stageName}
            </span>
          </div>

          {/* Status */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">Trạng thái:</span>
            <div className="col-span-2 flex">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md" style={{ backgroundColor: ts.bg, color: ts.color }}>
                {ts.label}
              </span>
            </div>
          </div>

          {/* Priority */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">Độ ưu tiên:</span>
            <div className="col-span-2 flex">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md" style={{ backgroundColor: tp.bg, color: tp.color }}>
                {tp.label}
              </span>
            </div>
          </div>

          {/* Assignee */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">Người thực hiện:</span>
            <div className="col-span-2 flex items-center gap-2">
              <ProjectIdentityAvatar
                member={initPic}
                initials={task.assignee}
                name={initPic?.name ?? task.assignee}
                color={task.aColor}
                avatarUrl={task.assigneeAvatarUrl}
                size="sm"
              />
              <span className="text-xs font-bold text-foreground">{initPic?.name ?? "Unassigned"}</span>
            </div>
          </div>

          {/* Planned date range */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">Thời gian kế hoạch:</span>
            <ProjectDateRange
              startDate={task.startDate}
              dueDate={task.due}
              className="col-span-2 text-xs font-bold text-foreground"
            />
          </div>
        </div>

        {/* Hours Overview */}
        <div className="bg-muted/30 border border-border rounded-xl p-4 mb-6">
          <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" /> Thời gian làm việc (Hours Tracker)
          </h4>

          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-card border border-border rounded-lg p-2.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Kế hoạch</span>
              <p className="text-lg font-mono font-black text-foreground mt-0.5">{formatHours(plannedHours)}h</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-2.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Thực tế đã làm</span>
              <p className="text-lg font-mono font-black mt-0.5" style={{ color: actualHours > plannedHours ? C.danger : C.success }}>{formatHours(actualHours)}h</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
              Planning syncs to Calendar
            </span>
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
              Actual work syncs to Activity
            </span>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ backgroundColor: ts.bg, color: ts.color }}>
              Task: {ts.label}
            </span>
          </div>

          {/* Hour consumption progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-muted-foreground font-bold mb-1">
              <span>Tỷ lệ tiêu hao giờ</span>
              <span>{plannedHours > 0 ? Math.round((actualHours / plannedHours) * 100) : 0}%</span>
            </div>
            <div className="h-2 bg-muted border border-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, plannedHours > 0 ? (actualHours / plannedHours) * 100 : 0)}%`,
                  backgroundColor: actualHours > plannedHours ? C.danger : color
                }}
              />
            </div>
          </div>
        </div>

        {/* Planning Calendar Sync */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-muted-foreground" /> Planning cho Calendar
          </h4>
          <div className="space-y-3">
            <div>
              <span className="text-[10px] font-semibold text-muted-foreground block mb-1.5">PIC thực hiện</span>
              <TeamMemberMultiSelect
                members={members}
                selectedIds={planningUserId ? [planningUserId] : []}
                onChange={(ids) => setPlanningUserId(ids[ids.length - 1] ?? "")}
                placeholder="Select PIC for planned work"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Ngày planning</span>
                <input
                  type="date"
                  value={planningDate}
                  onChange={(event) => setPlanningDate(event.target.value)}
                  className="w-full h-9 border border-input rounded-lg px-3 text-xs text-foreground bg-background focus:outline-none"
                />
              </div>
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Bắt đầu</span>
                <input
                  type="time"
                  value={planningStartTime}
                  onChange={(event) => setPlanningStartTime(event.target.value)}
                  className="w-full h-9 border border-input rounded-lg px-3 text-xs text-foreground bg-background focus:outline-none"
                />
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold text-muted-foreground block mb-1.5">Thời lượng dự kiến</span>
              <div className="flex gap-2 flex-wrap">
                {[2, 3].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => setPlanningDurationHours(hours)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                      planningDurationHours === hours
                        ? "border-foreground/30 bg-muted text-foreground"
                        : "border-border/70 text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {hours}h
                  </button>
                ))}
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={planningDurationHours}
                  onChange={(event) => setPlanningDurationHours(Math.max(0.5, Number(event.target.value) || 2))}
                  className="w-20 h-8 border border-input rounded-lg px-2 text-xs font-mono font-bold text-center text-foreground bg-background focus:outline-none"
                  aria-label="Custom planning duration hours"
                />
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Nội dung dự kiến làm</span>
              <textarea
                rows={2}
                value={planningNotes}
                onChange={(event) => setPlanningNotes(event.target.value)}
                placeholder="Ví dụ: Hoàn thiện mapping dữ liệu, test luồng khách hàng, chuẩn bị UAT..."
                className="w-full border border-input rounded-lg p-2.5 text-xs text-foreground bg-background focus:outline-none placeholder:text-muted-foreground/50 resize-none"
              />
            </div>

            {planningError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                {planningError}
              </div>
            ) : null}
            {planningMessage ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                {planningMessage}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleCreatePlanningBlock}
              disabled={planningSaving || !planningUserId || !planningDate || !planningStartTime}
              className="w-full h-9 rounded-lg text-xs font-semibold text-white shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: color }}
            >
              <Calendar className="w-3.5 h-3.5" />
              {planningSaving ? "Đang đồng bộ..." : "Đưa planning lên Calendar"}
            </button>
          </div>
        </div>

        {/* Log History */}
        <div className="mb-6">
          <h4 className="text-xs font-bold text-foreground mb-2.5 flex items-center gap-1.5">
            <History className="w-4 h-4 text-muted-foreground" /> Lịch sử ghi nhận giờ làm (Work Log History)
          </h4>
          {timeEntries.length > 0 ? (
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
              {timeEntries.map(entry => {
                const entryMember = findTeamMember(members, entry.userInitials, entry.userName, entry.userId);
                return (
                  <div key={entry.id} className="p-3 rounded-xl border border-border/80 bg-muted/20 text-xs flex flex-col gap-1.5 transition-colors hover:bg-muted/30">
                    <div className="flex items-center justify-between text-muted-foreground font-mono text-[10px]">
                      <div className="flex items-center gap-2">
                        <ProjectIdentityAvatar
                          member={entryMember}
                          initials={entry.userInitials || task.assignee}
                          name={entry.userName || entryMember?.name || "PIC"}
                          color={entry.userColor || color}
                          avatarUrl={entry.userAvatarUrl}
                          size="xs"
                        />
                        <span className="font-semibold text-foreground/85">{entry.date} · {entry.period}</span>
                      </div>
                      <span className="font-bold text-white px-2 py-0.5 rounded-md text-[9px] shrink-0" style={{ backgroundColor: color }}>
                        +{formatHours(entry.actualHours)}h
                      </span>
                    </div>
                    <p className="text-foreground/95 font-medium leading-relaxed pl-7">{entry.description}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-5 text-center border border-dashed border-border rounded-xl">
              <p className="text-xs text-muted-foreground">Chưa có nhật ký log giờ nào cho công việc này</p>
            </div>
          )}
        </div>

        {/* Hour Logger Mechanism */}
        <div className="flex-1 flex flex-col justify-end">
          <div className="border-t border-border pt-6 mt-auto">
            <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-muted-foreground" /> Thêm ghi nhận giờ làm mới (Add Log Entry)
            </h4>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Số giờ làm thực tế</span>
                  <div className="flex items-center border border-input rounded-lg overflow-hidden bg-background h-9">
                    <button
                      onClick={() => setLogHours(h => Math.max(0.5, h - 0.5))}
                      className="w-9 h-full flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-bold text-sm border-r border-input shrink-0"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={logHours}
                      onChange={e => setLogHours(Math.max(0.5, parseFloat(e.target.value) || 1))}
                      className="w-full h-full text-center font-mono font-black text-xs text-foreground bg-transparent focus:outline-none border-0"
                    />
                    <button
                      onClick={() => setLogHours(h => h + 0.5)}
                      className="w-9 h-full flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-bold text-sm border-l border-input shrink-0"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Số giờ kế hoạch (Task)</span>
                  <input
                    type="number"
                    min={0}
                    value={plannedHours}
                    onChange={e => setPlannedHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full h-9 border border-input rounded-lg text-center font-mono font-black text-xs text-foreground bg-background focus:outline-none"
                  />
                </div>
              </div>

              {/* Logged by user selection */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground block mb-1.5">Người thực tế thực hiện và log giờ</span>
                <div className="flex gap-2 flex-wrap">
                  {members.map(m => {
                    const isSelected = logUser?.initials === m.initials;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setLogUser(m)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                          isSelected
                            ? "bg-muted border-foreground/30 text-foreground"
                            : "border-border/60 text-muted-foreground hover:bg-muted/40"
                        }`}
                      >
                        <TeamMemberAvatar member={m} size="xs" />
                        <span>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Ngày làm thực tế</span>
                <input
                  type="date"
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  className="w-full h-9 border border-input rounded-lg px-3 text-xs text-foreground bg-background focus:outline-none"
                />
              </div>

              {/* Log Time Period */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Khung giờ làm việc</span>
                <input
                  type="text"
                  value={logPeriod}
                  onChange={e => setLogPeriod(e.target.value)}
                  placeholder="Ví dụ: 08:00 - 10:00"
                  className="w-full h-9 border border-input rounded-lg px-3 text-xs text-foreground bg-background focus:outline-none placeholder:text-muted-foreground/50"
                />

                {/* Presets badges */}
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {PRESETS.map(p => (
                    <button
                      key={p}
                      onClick={() => setLogPeriod(p)}
                      style={logPeriod === p ? {
                        backgroundColor: `${color}20`,
                        borderColor: `${color}50`,
                        color: color
                      } : {}}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all ${
                        logPeriod === p
                          ? ""
                          : "border-border/60 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Log completed items */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground block mb-1">Nội dung hoàn thành / Chi tiết công việc đã hoàn thành</span>
                <textarea
                  rows={2}
                  value={logDescription}
                  onChange={e => setLogDescription(e.target.value)}
                  placeholder="Ghi cụ thể các phần công việc đã hoàn thành trong khung giờ này..."
                  className="w-full border border-input rounded-lg p-2.5 text-xs text-foreground bg-background focus:outline-none placeholder:text-muted-foreground/50 resize-none"
                />
              </div>

              {logError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                  {logError}
                </div>
              ) : null}
              {logMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                  {logMessage}
                </div>
              ) : null}

              {/* Add log entry trigger button */}
              <button
                type="button"
                onClick={handleAddLog}
                disabled={logSaving || logHours <= 0 || !logDescription.trim() || !logUser}
                className="w-full h-9 border border-dashed rounded-lg text-xs font-semibold hover:bg-muted flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                style={{ borderColor: `${color}60`, color: color }}
              >
                <Plus className="w-3.5 h-3.5" /> {logSaving ? "Đang lưu..." : "Lưu work log & đồng bộ Activity"}
              </button>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="w-full h-11 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                >
                  Đóng
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    onSaveHours(actualHours, plannedHours, timeEntries);
                    onClose();
                  }}
                  className="w-full h-11 rounded-xl text-sm font-semibold text-white shadow-sm flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: color }}
                >
                  <Clock className="w-4 h-4" /> Lưu & Hoàn thành
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

function TaskDetailsDrawer({ task, milestoneName, stageName, color, onClose, onSaveHours, onEditTask, members = EMPTY_TEAM_MEMBERS }: {
  task: TaskItem;
  milestoneName: string;
  stageName: string;
  color: string;
  onClose: () => void;
  onSaveHours: (actualHours: number, plannedHours: number, timeEntries: TimeEntry[]) => void;
  onEditTask: () => void;
  members?: ProjectTeamMember[];
}) {
  const [actualHours, setActualHours] = useState<number>(task.actualHours ?? 0);
  const [plannedHours, setPlannedHours] = useState<number>(task.plannedHours ?? 8);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(task.timeEntries ?? []);
  const [currentStatus, setCurrentStatus] = useState<TaskItem["status"]>(task.status);
  const initPic = getSelectedTeamMember(members, task.assigneeUserId);

  const [planningModalOpen, setPlanningModalOpen] = useState(false);
  const [actualModalOpen, setActualModalOpen] = useState(false);

  const [logHours, setLogHours] = useState<number>(1);
  const [logDate, setLogDate] = useState<string>(dateInputValue());
  const [logPeriod, setLogPeriod] = useState<string>("08:00 - 10:00");
  const [logDescription, setLogDescription] = useState<string>("");
  const [logUser, setLogUser] = useState<ProjectTeamMember | undefined>(initPic);
  const [logSaving, setLogSaving] = useState(false);
  const [logMessage, setLogMessage] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const [planningUserId, setPlanningUserId] = useState<string>(initPic?.id ?? members[0]?.id ?? "");
  const [planningDate, setPlanningDate] = useState<string>(dateInputValue());
  const [planningStartTime, setPlanningStartTime] = useState<string>("09:00");
  const [planningDurationHours, setPlanningDurationHours] = useState<number>(2);
  const [planningNotes, setPlanningNotes] = useState<string>("");
  const [planningSaving, setPlanningSaving] = useState(false);
  const [planningMessage, setPlanningMessage] = useState<string | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);

  const ts = TASK_STATUS[currentStatus];
  const tp = PRIORITY_CFG[task.priority];
  const selectedPlanningUser = members.find((member) => member.id === planningUserId);
  const hourConsumption = plannedHours > 0 ? Math.round((actualHours / plannedHours) * 100) : 0;
  const PRESETS = ["08:00 - 10:00", "10:00 - 12:00", "13:30 - 15:30", "15:30 - 17:30"];

  const handleAddLog = async () => {
    if (logHours <= 0 || !logDescription.trim() || !logUser) return;

    setLogSaving(true);
    setLogError(null);
    setLogMessage(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/time-entries`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: logUser.id,
          workDate: buildWorkLogDateIso(logDate, logPeriod),
          minutes: Math.round(logHours * 60),
          billable: true,
          workType: logPeriod.trim() || "delivery",
          approvalStatus: "submitted",
          note: logDescription.trim()
        })
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Could not log actual work: ${response.status}`);
      }

      const saved = mapTimeEntryToUi((await response.json()) as TaskTimeEntrySummary);
      const updated = [...timeEntries, saved];
      const totalActual = sumHours(updated.map(entry => entry.actualHours));

      setTimeEntries(updated);
      setActualHours(totalActual);
      if (currentStatus === "todo") {
        setCurrentStatus("in-progress");
      }
      onSaveHours(totalActual, plannedHours, updated);

      setLogHours(1);
      setLogDescription("");
      setLogMessage("Đã lưu Actual Work và đồng bộ Activity cho project.");
      setActualModalOpen(false);
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Could not log actual work");
    } finally {
      setLogSaving(false);
    }
  };

  const handleCreatePlanningBlock = async () => {
    const selectedUser = members.find((member) => member.id === planningUserId);
    if (!selectedUser || planningDurationHours <= 0 || !planningDate || !planningStartTime) return;

    setPlanningSaving(true);
    setPlanningError(null);
    setPlanningMessage(null);

    const startAt = buildLocalDateTimeIso(planningDate, planningStartTime);
    const startDate = new Date(startAt);
    const endAt = new Date(startDate.getTime() + planningDurationHours * 60 * 60 * 1000).toISOString();
    const plannedMinutes = Math.round(planningDurationHours * 60);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/planning-blocks`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          title: task.title,
          notes: planningNotes.trim() || undefined,
          startAt,
          endAt,
          plannedMinutes,
          status: "planned"
        })
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Could not create planning block: ${response.status}`);
      }

      const endTime = new Date(endAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      onSaveHours(actualHours, plannedHours, timeEntries);
      setPlanningMessage(`Đã tạo Planning trên Calendar: ${planningStartTime} - ${endTime} · ${selectedUser.name}`);
      setPlanningNotes("");
      setPlanningModalOpen(false);
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Could not create planning block");
    } finally {
      setPlanningSaving(false);
    }
  };

  const ActionDialog = ({
    title,
    description,
    icon: Icon,
    open,
    onOpenChange,
    children
  }: {
    title: string;
    description: string;
    icon: React.ElementType;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }) => {
    if (!open) return null;

    return (
      <ModalLayer onClose={() => onOpenChange(false)}>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="presentation">
        <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-xs" onClick={() => onOpenChange(false)} />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${title.replace(/\s+/g, "-").toLowerCase()}-title`}
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          onClick={(event) => event.stopPropagation()}
          className="relative z-[61] w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: color }}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <h3 id={`${title.replace(/\s+/g, "-").toLowerCase()}-title`} className="text-base font-bold text-foreground">{title}</h3>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">{description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={`Close ${title}`}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        </motion.div>
      </div>
      </ModalLayer>
    );
  };

  return (
    <ModalLayer onClose={onClose}>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-xs"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 18 }}
        transition={{ type: "spring", damping: 26, stiffness: 240 }}
        onClick={(event) => event.stopPropagation()}
        className="relative z-50 flex h-[min(92vh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-5">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: color }}>
              <ListChecks className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chi tiết công việc</p>
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">ID: {task.id}</span>
              </div>
              <h2 id="task-detail-title" className="mt-2 max-w-3xl text-2xl font-black leading-tight text-foreground">{task.title}</h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onEditTask}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-4 w-4" /> Sửa
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close task detail"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <section className="space-y-5">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Mốc & giai đoạn</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{milestoneName} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {stageName}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Người thực hiện</p>
                    <div className="mt-1 flex items-center gap-2">
                      <ProjectIdentityAvatar
                        member={initPic}
                        initials={task.assignee}
                        name={initPic?.name ?? task.assignee}
                        color={task.aColor}
                        avatarUrl={task.assigneeAvatarUrl}
                        size="sm"
                      />
                      <span className="text-sm font-bold text-foreground">{initPic?.name ?? "Unassigned"}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Trạng thái</p>
                    <span className="mt-1 inline-flex rounded-lg px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: ts.bg, color: ts.color }}>
                      {ts.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ưu tiên & thời gian kế hoạch</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: tp.bg, color: tp.color }}>{tp.label}</span>
                      <ProjectDateRange
                        startDate={task.startDate}
                        dueDate={task.due}
                        className="text-xs font-bold text-foreground"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
                      <Clock className="h-4 w-4 text-muted-foreground" /> Work clarity
                    </h3>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">Planning là giờ dự kiến đưa lên Calendar. Actual là giờ đã làm, ghi vào Activity.</p>
                  </div>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ backgroundColor: ts.bg, color: ts.color }}>
                    Task: {ts.label}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Planning baseline</p>
                    <p className="mt-2 font-mono text-3xl font-black text-foreground">{formatHours(plannedHours)}h</p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">Dùng để so sánh kế hoạch tổng của task.</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Actual completed</p>
                    <p className="mt-2 font-mono text-3xl font-black" style={{ color: actualHours > plannedHours ? C.danger : C.success }}>{formatHours(actualHours)}h</p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">Tổng giờ thực tế từ Work Log History.</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-[11px] font-bold text-muted-foreground">
                    <span>Tỷ lệ tiêu hao giờ</span>
                    <span>{hourConsumption}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full border border-border bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, hourConsumption)}%`,
                        backgroundColor: actualHours > plannedHours ? C.danger : color
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlanningError(null);
                    setPlanningModalOpen(true);
                  }}
                  className="group rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-foreground/20 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ backgroundColor: color }}>
                      <Calendar className="h-4 w-4" />
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="mt-3 text-sm font-black text-foreground">Plan work</h3>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">Chọn PIC, ngày, giờ bắt đầu và thời lượng dự kiến cho Calendar.</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLogError(null);
                    setActualModalOpen(true);
                  }}
                  className="group rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-foreground/20 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ backgroundColor: color }}>
                      <Plus className="h-4 w-4" />
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="mt-3 text-sm font-black text-foreground">Log actual work</h3>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">Ghi giờ thực tế đã làm, nội dung hoàn thành và đồng bộ Activity.</p>
                </button>
              </div>

              {(planningMessage || logMessage) && (
                <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs font-bold" style={{ color: C.success }}>
                  {planningMessage ?? logMessage}
                </div>
              )}
            </section>

            <aside className="space-y-5">
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
                  <History className="h-4 w-4 text-muted-foreground" /> Work Log History
                </h3>
                <p className="mt-1 text-xs font-medium text-muted-foreground">Chỉ hiển thị lịch sử đã log. Form nhập mới nằm trong modal Actual.</p>

                {timeEntries.length > 0 ? (
                  <div className="mt-4 space-y-2.5">
                    {timeEntries.map((entry) => {
                      const entryMember = findTeamMember(members, entry.userInitials, entry.userName, entry.userId);
                      return (
                        <div key={entry.id} className="rounded-xl border border-border/80 bg-muted/20 p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <ProjectIdentityAvatar
                                member={entryMember}
                                initials={entry.userInitials || task.assignee}
                                name={entry.userName || entryMember?.name || "PIC"}
                                color={entry.userColor || color}
                                avatarUrl={entry.userAvatarUrl}
                                size="xs"
                              />
                              <span className="truncate font-mono font-bold text-foreground/85">{entry.date} · {entry.period}</span>
                            </div>
                            <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: color }}>
                              +{formatHours(entry.actualHours)}h
                            </span>
                          </div>
                          <p className="mt-2 pl-7 text-xs font-medium leading-relaxed text-foreground/90">{entry.description}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-center">
                    <p className="text-xs font-medium text-muted-foreground">Chưa có nhật ký giờ thực tế cho task này.</p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
                  <Target className="h-4 w-4 text-muted-foreground" /> Planning vs Actual
                </h3>
                <dl className="mt-4 space-y-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-muted-foreground">Calendar intent</dt>
                    <dd className="text-right font-bold text-foreground">Planning blocks</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-muted-foreground">Delivery evidence</dt>
                    <dd className="text-right font-bold text-foreground">Actual work logs</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="font-bold text-muted-foreground">Variance</dt>
                    <dd className="text-right font-mono font-black" style={{ color: actualHours > plannedHours ? C.danger : C.success }}>
                      {formatHours(actualHours - plannedHours)}h
                    </dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Đóng
          </button>
          <button
            type="button"
            onClick={() => {
              onSaveHours(actualHours, plannedHours, timeEntries);
              onClose();
            }}
            className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-sm"
            style={{ backgroundColor: color }}
          >
            <Clock className="h-4 w-4" /> Lưu trạng thái giờ
          </button>
        </footer>
      </motion.div>

      <ActionDialog
        title="Planning for Calendar"
        description="Dự kiến làm gì, khi nào, bởi ai. Không ghi Actual Hours."
        icon={Calendar}
        open={planningModalOpen}
        onOpenChange={setPlanningModalOpen}
      >
        <div className="space-y-4">
          <Field label="PIC thực hiện">
            <TeamMemberSingleSelect
              members={members}
              value={selectedPlanningUser}
              onChange={(member) => setPlanningUserId(member?.id ?? "")}
              placeholder="Select PIC for planned work"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ngày planning">
              <input
                type="date"
                value={planningDate}
                onChange={(event) => setPlanningDate(event.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none"
              />
            </Field>
            <Field label="Bắt đầu">
              <input
                type="time"
                value={planningStartTime}
                onChange={(event) => setPlanningStartTime(event.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Thời lượng dự kiến">
              <div className="flex flex-wrap gap-2">
                {[2, 3].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => setPlanningDurationHours(hours)}
                    className={`h-9 rounded-xl border px-4 text-sm font-bold transition-colors ${
                      planningDurationHours === hours
                        ? "border-foreground/30 bg-muted text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {hours}h
                  </button>
                ))}
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={planningDurationHours}
                  onChange={(event) => setPlanningDurationHours(Math.max(0.5, Number(event.target.value) || 2))}
                  aria-label="Custom planning duration hours"
                  className="h-9 w-24 rounded-xl border border-input bg-background px-2 text-center font-mono text-sm font-black text-foreground focus:outline-none"
                />
              </div>
            </Field>
            <Field label="Task baseline">
              <input
                type="number"
                min={0}
                value={plannedHours}
                onChange={(event) => setPlannedHours(Math.max(0, Number(event.target.value) || 0))}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-center font-mono text-sm font-black text-foreground focus:outline-none"
              />
            </Field>
          </div>

          <Field label="Nội dung dự kiến làm">
            <textarea
              rows={3}
              value={planningNotes}
              onChange={(event) => setPlanningNotes(event.target.value)}
              placeholder="Ví dụ: Hoàn thiện mapping dữ liệu, test luồng khách hàng, chuẩn bị UAT..."
              className="w-full resize-none rounded-xl border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </Field>

          {planningError && <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-bold" style={{ color: C.danger }}>{planningError}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setPlanningModalOpen(false)} className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-muted-foreground hover:bg-muted">Cancel</button>
            <button
              type="button"
              onClick={handleCreatePlanningBlock}
              disabled={planningSaving || !planningUserId || !planningDate || !planningStartTime}
              className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
              style={{ backgroundColor: color }}
            >
              <Calendar className="h-4 w-4" /> {planningSaving ? "Đang lưu..." : "Đưa lên Calendar"}
            </button>
          </div>
        </div>
      </ActionDialog>

      <ActionDialog
        title="Actual Work Log"
        description="Giờ đã làm thực tế. Lưu xong sẽ cập nhật Activity và trạng thái task."
        icon={Plus}
        open={actualModalOpen}
        onOpenChange={setActualModalOpen}
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số giờ thực tế">
              <div className="flex h-10 overflow-hidden rounded-xl border border-input bg-background">
                <button type="button" onClick={() => setLogHours((hours) => Math.max(0.5, hours - 0.5))} className="w-10 border-r border-input text-sm font-black text-muted-foreground hover:bg-muted">-</button>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={logHours}
                  onChange={(event) => setLogHours(Math.max(0.5, parseFloat(event.target.value) || 1))}
                  className="h-full flex-1 border-0 bg-transparent text-center font-mono text-sm font-black text-foreground focus:outline-none"
                />
                <button type="button" onClick={() => setLogHours((hours) => hours + 0.5)} className="w-10 border-l border-input text-sm font-black text-muted-foreground hover:bg-muted">+</button>
              </div>
            </Field>
            <Field label="Ngày làm">
              <input
                type="date"
                value={logDate}
                onChange={(event) => setLogDate(event.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none"
              />
            </Field>
          </div>

          <Field label="Người thực tế thực hiện">
            <TeamMemberSingleSelect
              members={members}
              value={logUser}
              onChange={setLogUser}
              placeholder="Select actual work owner"
            />
          </Field>

          <Field label="Khung giờ làm việc">
            <input
              type="text"
              value={logPeriod}
              onChange={(event) => setLogPeriod(event.target.value)}
              placeholder="Ví dụ: 08:00 - 10:00"
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setLogPeriod(period)}
                  className="rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-colors hover:bg-muted"
                  style={logPeriod === period ? { backgroundColor: `${color}20`, borderColor: `${color}50`, color } : { borderColor: "var(--color-border)", color: "var(--color-muted-foreground)" }}
                >
                  {period}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Nội dung đã hoàn thành">
            <textarea
              rows={3}
              value={logDescription}
              onChange={(event) => setLogDescription(event.target.value)}
              placeholder="Ghi rõ phần việc đã hoàn thành trong khung giờ này..."
              className="w-full resize-none rounded-xl border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </Field>

          {logError && <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-bold" style={{ color: C.danger }}>{logError}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setActualModalOpen(false)} className="h-10 rounded-xl border border-border px-4 text-sm font-bold text-muted-foreground hover:bg-muted">Cancel</button>
            <button
              type="button"
              onClick={handleAddLog}
              disabled={logSaving || logHours <= 0 || !logDescription.trim() || !logUser}
              className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
              style={{ backgroundColor: color }}
            >
              <Plus className="h-4 w-4" /> {logSaving ? "Đang lưu..." : "Lưu Actual Work"}
            </button>
          </div>
        </div>
      </ActionDialog>
    </div>
    </ModalLayer>
  );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, projectColor, onEdit, onDelete, onViewDetails, sortHandle, members = EMPTY_TEAM_MEMBERS }: {
  task: TaskItem;
  projectColor: string;
  onEdit: (task: TaskItem) => void;
  onDelete: (taskId: string) => void;
  onViewDetails: (task: TaskItem) => void;
  sortHandle?: SortHandleProps;
  members?: ProjectTeamMember[];
}) {
  const ts = TASK_STATUS[task.status];
  const tp = PRIORITY_CFG[task.priority];
  const assigneeMember = findTeamMember(members, task.assignee, undefined, task.assigneeUserId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const menuItems: MenuItem[] = [
    { label:"View Details", icon:ListChecks, onClick:() => onViewDetails(task) },
    { label:"Edit Task",    icon:Pencil, onClick:() => onEdit(task) },
    { label:"Delete Task",  icon:Trash2, onClick:() => onDelete(task.id), danger:true },
  ];

  return (
    <div className="group flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/30">
      <HierarchyDragHandle handle={sortHandle} label={`Sắp xếp task ${task.title}`} />
      <div
        onClick={() => onViewDetails(task)}
        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer group-hover:translate-x-0.5 transition-transform"
      >
        <div className="w-4 h-4 rounded border-[1.5px] flex items-center justify-center shrink-0"
          style={{ borderColor:task.status==="done"?C.success:"var(--color-border)", backgroundColor:task.status==="done"?C.success:"transparent" }}>
          {task.status==="done" && (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-medium ${task.status==="done" ? "line-through text-muted-foreground/75" : "text-foreground hover:underline"}`}
            title={task.title}
          >
            {task.title}
          </p>
          <ProjectDateRange
            startDate={task.startDate}
            dueDate={task.due}
            className="mt-1 max-w-full text-[10px] text-muted-foreground lg:hidden"
          />
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="hidden sm:inline text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor:tp.bg, color:tp.color }}>{tp.label}</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor:ts.bg, color:ts.color }}>{ts.label}</span>

        {/* Hours indicator styled with project accent color */}
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-md border font-mono transition-all duration-300"
          style={{ backgroundColor: `${projectColor}15`, borderColor: `${projectColor}35`, color: projectColor }}
          title="Giờ thực tế / Giờ kế hoạch">
          <Clock className="w-3 h-3" style={{ color: projectColor }} />
          <span>{formatHours(task.actualHours ?? 0)}h/{formatHours(task.plannedHours ?? 8)}h</span>
        </span>

        <ProjectIdentityAvatar
          member={assigneeMember}
          initials={task.assignee}
          name={assigneeMember?.name ?? task.assignee}
          color={task.aColor}
          avatarUrl={task.assigneeAvatarUrl}
          size="sm"
        />

        <ProjectDateRange
          startDate={task.startDate}
          dueDate={task.due}
          className="hidden max-w-[180px] text-[10px] text-muted-foreground lg:inline-flex"
        />

        {/* Action menu */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button
            ref={menuButtonRef}
            aria-label={`Task actions for ${task.title}`}
            onClick={() => setMenuOpen(v => !v)}
            className="p-1 rounded hover:bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 transition-all">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {menuOpen && <ActionMenu items={menuItems} anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

// ─── Stage Section ────────────────────────────────────────────────────────────

function StageSection({ stage, projectColor, onAddTask, onEditTask, onDeleteTask, onEditStage, onDeleteStage, onViewTaskDetails, onReorderTasks, sortHandle, hierarchyBusy = false, members = EMPTY_TEAM_MEMBERS }: {
  stage: StageItem; projectColor: string;
  onAddTask: (stageId: string, stageName: string) => void;
  onEditTask: (stageId: string, task: TaskItem) => void;
  onDeleteTask: (stageId: string, taskId: string) => void;
  onEditStage: (stage: StageItem) => void;
  onDeleteStage: (stageId: string, stageName: string) => void;
  onViewTaskDetails: (task: TaskItem) => void;
  onReorderTasks: (stageId: string, orderedIds: string[]) => void;
  sortHandle?: SortHandleProps;
  hierarchyBusy?: boolean;
  members?: ProjectTeamMember[];
}) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const done  = stage.tasks.filter(t => t.status === "done").length;
  const total = stage.tasks.length;

  const stagePlannedHours = sumHours(stage.tasks.map(t => t.plannedHours ?? 8));
  const stageActualHours = sumHours(stage.tasks.map(t => t.actualHours ?? 0));
  const isSyntheticNoStage = isUnassignedTasksStageId(stage.id);

  const stageMenuItems: MenuItem[] = isSyntheticNoStage
    ? []
    : [
        { label:"Edit Stage",  icon:Pencil, onClick:() => onEditStage(stage) },
        { label:"Delete Stage",  icon:Trash2, onClick:() => onDeleteStage(stage.id, stage.name), danger:true },
      ];

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      {/* Stage Header — outer is a div to avoid nested button */}
      <div className={`flex flex-wrap items-center justify-between gap-y-2 rounded-t-xl bg-muted/40 px-4 py-2.5 ${open ? "border-b border-border/50" : "rounded-b-xl"}`}>
        {!isSyntheticNoStage && <HierarchyDragHandle handle={sortHandle} label={`Sắp xếp stage ${stage.name}`} />}
        {/* Left: clickable area for collapse */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 cursor-pointer min-w-[140px] text-left">
          <Flag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="max-w-[200px] truncate text-sm font-semibold text-foreground" title={stage.name}>{stage.name}</span>

              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {done}/{total} xong
              </span>

              {/* Stage hours indicator matching Task hours indicator theme color */}
              <span className="flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-semibold transition-all duration-300"
                style={{ backgroundColor: `${projectColor}15`, borderColor: `${projectColor}35`, color: projectColor }}
                title="Giờ thực tế / Giờ kế hoạch">
                <Clock className="w-2.5 h-2.5" style={{ color: projectColor }} />
                <span>{formatHours(stageActualHours)}h/{formatHours(stagePlannedHours)}h</span>
              </span>
            </div>
            <ProjectDateRange
              startDate={stage.startDate}
              dueDate={stage.dueDate}
              fallback="TBD"
              className="mt-1 max-w-full text-[10px] text-muted-foreground"
            />
          </div>
        </button>
        {/* Right: action buttons */}
        <div className="flex w-full items-center justify-end gap-1.5 shrink-0 sm:w-auto">
          <motion.button
            whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }}
            onClick={() => onAddTask(stage.id, stage.name)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
            style={{ backgroundColor:projectColor }}>
            <Plus className="w-3 h-3" /> Task
          </motion.button>
          {!isSyntheticNoStage && (
            <div className="relative">
              <button ref={menuButtonRef} onClick={() => setMenuOpen(v => !v)}
                aria-label={`Stage actions for ${stage.name}`}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {menuOpen && <ActionMenu items={stageMenuItems} anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)} />}
            </div>
          )}
          <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Tasks */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height:0, opacity:0 }}
            animate={{ height:"auto", opacity:1, transitionEnd: { overflow: "visible" } }}
            exit={{ height:0, opacity:0, overflow: "hidden" }}
            transition={{ duration:0.18 }}
            className="overflow-hidden bg-card rounded-b-xl">
            {stage.tasks.length > 0 ? (
              sortHandle ? (
              <HierarchySortableList
                ids={stage.tasks.map(task => task.id)}
                hierarchyKind="task"
                disabled={hierarchyBusy}
                label={`Tasks trong stage ${stage.name}`}
                listClassName="divide-y divide-border/40"
                getItemLabel={(id) => stage.tasks.find(item => item.id === id)?.title ?? id}
                onReorder={(ids) => onReorderTasks(stage.id, ids)}
                renderItem={(taskId, taskHandle) => {
                  const task = stage.tasks.find(item => item.id === taskId);
                  return task ? (
                    <TaskRow
                      task={task} projectColor={projectColor}
                      onEdit={t => onEditTask(stage.id, t)}
                      onDelete={id => onDeleteTask(stage.id, id)}
                      onViewDetails={onViewTaskDetails}
                      sortHandle={taskHandle}
                      members={members}
                    />
                  ) : null;
                }}
              />
              ) : (
                <HierarchyStaticList
                  ids={stage.tasks.map(task => task.id)}
                  hierarchyKind="task"
                  label={`Tasks trong stage ${stage.name}`}
                  listClassName="divide-y divide-border/40"
                  renderItem={(taskId) => {
                    const task = stage.tasks.find(item => item.id === taskId);
                    return task ? (
                      <TaskRow
                        task={task}
                        projectColor={projectColor}
                        onEdit={t => onEditTask(stage.id, t)}
                        onDelete={id => onDeleteTask(stage.id, id)}
                        onViewDetails={onViewTaskDetails}
                        members={members}
                      />
                    ) : null;
                  }}
                />
              )
            ) : (
              <div className="px-4 py-6 text-center">
                <ListChecks className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1.5" />
                <p className="text-xs text-muted-foreground">No tasks yet</p>
                <button onClick={() => onAddTask(stage.id, stage.name)}
                  className="text-[11px] font-medium mt-1 hover:underline" style={{ color:projectColor }}>
                  Add first task
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Milestone Section (in Tasks tab) ────────────────────────────────────────

function MilestoneSectionTasks({ milestone, group, projectColor, onAddStage, onAddTask, onEditTask, onDeleteTask, onEditStage, onDeleteStage, onViewTaskDetails, onEditMilestone, onDeleteMilestone, onReorderStages, onReorderTasks, sortHandle, hierarchyBusy = false, members = EMPTY_TEAM_MEMBERS }: {
  milestone: Milestone; group: MilestoneGroup; projectColor: string;
  onAddStage: (milestoneId: string, milestoneName: string) => void;
  onAddTask: (milestoneId: string, stageId: string, stageName: string) => void;
  onEditTask: (milestoneId: string, stageId: string, task: TaskItem) => void;
  onDeleteTask: (milestoneId: string, stageId: string, taskId: string) => void;
  onEditStage: (stage: StageItem) => void;
  onDeleteStage: (milestoneId: string, stageId: string, stageName: string) => void;
  onViewTaskDetails: (task: TaskItem) => void;
  onEditMilestone: (milestone: Milestone) => void;
  onDeleteMilestone: (milestoneId: string) => void;
  onReorderStages: (milestoneId: string, orderedIds: string[]) => void;
  onReorderTasks: (milestoneId: string, stageId: string, orderedIds: string[]) => void;
  sortHandle?: SortHandleProps;
  hierarchyBusy?: boolean;
  members?: ProjectTeamMember[];
}) {
  const [open, setOpen] = useState(milestone.status !== "upcoming");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const cfg = MILESTONE_STATUS[milestone.status];
  const visibleStages = visibleStagesForMilestone(group, milestone);

  const totalTasks = group.stages.reduce((s, st) => s + st.tasks.length, 0);
  const doneTasks  = group.stages.reduce((s, st) => s + st.tasks.filter(t => t.status === "done").length, 0);

  const milestonePlannedHours = sumHours(group.stages.flatMap(st => st.tasks.map(t => t.plannedHours ?? 8)));
  const milestoneActualHours = sumHours(group.stages.flatMap(st => st.tasks.map(t => t.actualHours ?? 0)));
  const isSyntheticUnassignedMilestone = isUnassignedTasksMilestoneId(milestone.id);

  const milestoneMenuItems: MenuItem[] = isSyntheticUnassignedMilestone
    ? []
    : [
        { label: "Edit Milestone", icon: Pencil, onClick: () => onEditMilestone(milestone) },
        { label: "Delete Milestone", icon: Trash2, onClick: () => onDeleteMilestone(milestone.id), danger: true }
      ];

  return (
    <div>
      {/* Milestone Header */}
      {/* Milestone Header — use div not button to avoid nested-button violation */}
      <div
        className="w-full flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4 rounded-xl border transition-all hover:shadow-sm"
        style={{ backgroundColor:`${cfg.color}08`, borderColor:`${cfg.color}30` }}
      >
        {!isSyntheticUnassignedMilestone && <HierarchyDragHandle handle={sortHandle} label={`Sắp xếp milestone ${milestone.name}`} />}
        {/* Icon */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor:`${cfg.color}20` }}>
          <cfg.icon className="w-4 h-4" style={{ color:cfg.color }} />
        </div>
        {/* Text */}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex-1 text-left min-w-[140px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-foreground truncate max-w-[240px]" title={milestone.name}>{milestone.name}</span>

            <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ backgroundColor:cfg.bg, color:cfg.color }}>{cfg.label}</span>

            {totalTasks > 0 && (
              <span className="text-[10px] text-muted-foreground font-mono">{doneTasks}/{totalTasks} tác vụ</span>
            )}

            {/* Hours indicator styled dynamically with milestone status color */}
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md border flex items-center gap-1 font-mono transition-all duration-300"
              style={{ backgroundColor: `${cfg.color}15`, borderColor: `${cfg.color}35`, color: cfg.color }}>
              <Clock className="w-2.5 h-2.5" style={{ color: cfg.color }} />
              <span>{formatHours(milestoneActualHours)}h/{formatHours(milestonePlannedHours)}h</span>
            </span>
          </div>
          {/* Use div not p — p cannot contain block-level div (avatar) */}
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <ProjectDateRange
              startDate={milestone.startDate}
              dueDate={milestone.dueDate}
              fallback="TBD"
              className="max-w-full"
            />
            <span className="flex items-center gap-1">
              <ProjectIdentityAvatar
                member={findTeamMember(members, milestone.pic, milestone.picName, milestone.picUserId)}
                initials={milestone.pic}
                name={milestone.picName}
                color={milestone.picColor}
                avatarUrl={milestone.picAvatarUrl}
                size="xs"
              />
              {milestone.picName}
            </span>
          </div>
        </button>
        {/* Add Stage + toggle */}
        <div className="flex w-full items-center justify-end gap-2 shrink-0 sm:w-auto">
          {!isSyntheticUnassignedMilestone && (
            <>
              <motion.button
                whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }}
                onClick={e => { e.stopPropagation(); onAddStage(milestone.id, milestone.name); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border"
                style={{ borderColor:cfg.color, color:cfg.color, backgroundColor:`${cfg.color}10` }}>
                <Plus className="w-3 h-3" /> Add Stage
              </motion.button>

              <div className="relative" onClick={e => e.stopPropagation()}>
                <button ref={menuButtonRef} onClick={() => setMenuOpen(v => !v)}
                  aria-label={`Milestone actions for ${milestone.name}`}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {menuOpen && <ActionMenu items={milestoneMenuItems} anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)} />}
              </div>
            </>
          )}

          <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
        </div>
      </div>

      {/* Stages */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height:0, opacity:0 }}
            animate={{ height:"auto", opacity:1, transitionEnd: { overflow: "visible" } }}
            exit={{ height:0, opacity:0, overflow: "hidden" }}
            transition={{ duration:0.2 }}
            className="overflow-hidden pl-4 mt-2">
            {visibleStages.length > 0 ? (
              sortHandle ? (
              <HierarchySortableList
                ids={visibleStages.map(stage => stage.id)}
                hierarchyKind="stage"
                disabled={hierarchyBusy}
                label={`Stages trong milestone ${milestone.name}`}
                listClassName="flex flex-col gap-2.5"
                getItemLabel={(id) => visibleStages.find(item => item.id === id)?.name ?? id}
                onReorder={(ids) => onReorderStages(milestone.id, ids)}
                renderItem={(stageId, stageHandle) => {
                  const stage = visibleStages.find(item => item.id === stageId);
                  return stage ? (
                    <StageSection
                      stage={stage} projectColor={projectColor}
                      onAddTask={(id, name) => onAddTask(milestone.id, id, name)}
                      onEditTask={(id, task) => onEditTask(milestone.id, id, task)}
                      onDeleteTask={(id, taskId) => onDeleteTask(milestone.id, id, taskId)}
                      onEditStage={onEditStage}
                      onDeleteStage={(id, name) => onDeleteStage(milestone.id, id, name)}
                      onViewTaskDetails={onViewTaskDetails}
                      onReorderTasks={(id, ids) => onReorderTasks(milestone.id, id, ids)}
                      sortHandle={stageHandle}
                      hierarchyBusy={hierarchyBusy}
                      members={members}
                    />
                  ) : null;
                }}
              />
              ) : (
                <HierarchyStaticList
                  ids={visibleStages.map(stage => stage.id)}
                  hierarchyKind="stage"
                  label={`Stages trong milestone ${milestone.name}`}
                  listClassName="flex flex-col gap-2.5"
                  renderItem={(stageId) => {
                    const stage = visibleStages.find(item => item.id === stageId);
                    return stage ? (
                      <StageSection
                        stage={stage}
                        projectColor={projectColor}
                        onAddTask={(id, name) => onAddTask(milestone.id, id, name)}
                        onEditTask={(id, task) => onEditTask(milestone.id, id, task)}
                        onDeleteTask={(id, taskId) => onDeleteTask(milestone.id, id, taskId)}
                        onEditStage={onEditStage}
                        onDeleteStage={(id, name) => onDeleteStage(milestone.id, id, name)}
                        onViewTaskDetails={onViewTaskDetails}
                        onReorderTasks={() => undefined}
                        members={members}
                      />
                    ) : null;
                  }}
                />
              )
            ) : (
              <div className="py-8 text-center rounded-xl border border-dashed border-border">
                <Flag className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">No stages yet</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">Create a stage to start adding tasks</p>
                <motion.button whileHover={{ scale:1.04 }} whileTap={{ scale:0.96 }}
                  onClick={() => onAddStage(milestone.id, milestone.name)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm mx-auto"
                  style={{ backgroundColor:projectColor }}>
                  <Plus className="w-4 h-4" /> Create First Stage
                </motion.button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getWeekDateRange(startDateStr: string, weekNum: number): string {
  try {
    const baseDate = new Date(startDateStr);
    if (isNaN(baseDate.getTime())) {
      return `Tuần thứ ${weekNum} của dự án`;
    }

    const start = new Date(baseDate);
    start.setDate(baseDate.getDate() + (weekNum - 1) * 7);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const formatDate = (d: Date) => {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    return `${formatDate(start)} - ${formatDate(end)}`;
  } catch (e) {
    return `Khoảng thời gian tuần ${weekNum}`;
  }
}

// ─── Milestone Row (for Overview tab) ─────────────────────────────────────────

function MilestoneRow({ milestone, isNext, members = EMPTY_TEAM_MEMBERS }: { milestone: Milestone; isNext: boolean; members?: ProjectTeamMember[] }) {
  const cfg = MILESTONE_STATUS[milestone.status];
  const picMember = findTeamMember(members, milestone.pic, milestone.picName, milestone.picUserId);
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border-2"
          style={{ backgroundColor:`${cfg.color}20`, borderColor:milestone.status==="done"?cfg.color:"var(--color-border)" }}>
          <cfg.icon className="w-4 h-4" style={{ color:cfg.color }} />
        </div>
      </div>
      <div className="flex-1 rounded-xl border p-4 transition-all hover:shadow-sm"
        style={{ borderColor:isNext?`${cfg.color}60`:"var(--color-border)", backgroundColor:isNext?`${cfg.color}06`:"var(--color-card)" }}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <p className={`text-sm font-semibold ${milestone.status==="done" ? "line-through text-muted-foreground" : "text-foreground"}`}>{milestone.name}</p>
              {isNext && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor:`${cfg.color}20`, color:cfg.color }}>NEXT</span>}
            </div>
            {milestone.description && <p className="text-[11px] text-muted-foreground leading-relaxed">{milestone.description}</p>}
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg shrink-0" style={{ backgroundColor:cfg.bg, color:cfg.color }}>
            <cfg.icon className="w-2.5 h-2.5" />{cfg.label}
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <ProjectDateRange
            startDate={milestone.startDate}
            dueDate={milestone.dueDate}
            fallback="TBD"
            className="max-w-full text-[11px] text-muted-foreground"
          />
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ProjectIdentityAvatar
              member={picMember}
              initials={milestone.pic}
              name={milestone.picName}
              color={milestone.picColor}
              avatarUrl={milestone.picAvatarUrl}
              size="xs"
            />
            {milestone.picName}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline Date Helpers ──────────────────────────────────────────────────

function getStageDateRange(stage: StageItem, milStart: string, milDue: string) {
  // If stage has explicit dates, prioritize them
  if (stage.startDate && stage.dueDate) {
    return {
      start: parseUiDate(stage.startDate),
      due: parseUiDate(stage.dueDate),
      estimated: false
    };
  }

  // Fallback to tasks if dates are not defined
  const baseStart = stage.startDate ? parseUiDate(stage.startDate) : null;
  const baseDue = stage.dueDate ? parseUiDate(stage.dueDate) : null;

  if (!stage.tasks || stage.tasks.length === 0) {
    return {
      start: baseStart || parseUiDate(milStart),
      due: baseDue || parseUiDate(milDue),
      estimated: true
    };
  }

  let minMs = baseStart ? baseStart.getTime() : Infinity;
  let maxMs = baseDue ? baseDue.getTime() : -Infinity;

  stage.tasks.forEach(t => {
    const d = parseUiDate(t.due);
    const ms = d.getTime();
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
  });

  // If bounds are still infinity
  if (minMs === Infinity) minMs = parseUiDate(milStart).getTime();
  if (maxMs === -Infinity) maxMs = parseUiDate(milDue).getTime();

  // if single day task, give it 1 week duration for visibility
  if (minMs === maxMs) {
    maxMs = minMs + 7 * 24 * 60 * 60 * 1000;
  }
  return {
    start: new Date(minMs),
    due: new Date(maxMs),
    estimated: true
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params    = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "p1";
  const { user } = useAuth();
  const pushedProjectOwnerKey = getPushedProjectsOwnerKey(user);
  const [initialProjectSnapshot] = useState(() => readLiveProjectSnapshot(projectId, pushedProjectOwnerKey));

  const [project, setProject] = useState<Project>(initialProjectSnapshot?.project ?? PROJECT_NOT_FOUND);
  const [projectResolved, setProjectResolved] = useState(initialProjectSnapshot !== null);

  useEffect(() => {
    const controller = new AbortController();
    const cachedSnapshot = readLiveProjectSnapshot(projectId, pushedProjectOwnerKey);

    async function loadProject() {
      try {
        const liveProject = await fetchLiveProjectById(projectId, controller.signal, pushedProjectOwnerKey);
        if (controller.signal.aborted) return;
        setProject(liveProject ?? PROJECT_NOT_FOUND);
      } catch {
        if (controller.signal.aborted) return;
        setProject(PROJECT_NOT_FOUND);
      } finally {
        if (!controller.signal.aborted) {
          setProjectResolved(true);
        }
      }
    }

    if (cachedSnapshot) {
      setProject(cachedSnapshot.project ?? PROJECT_NOT_FOUND);
      setProjectResolved(true);
    } else {
      setProjectResolved(false);
      setProject(PROJECT_NOT_FOUND);
    }
    loadProject();

    return () => controller.abort();
  }, [projectId, pushedProjectOwnerKey]);

  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const initialTab = searchParams.get("tab");
    return isProjectDetailTab(initialTab) ? initialTab : "Overview";
  });
  const projectMainRef = useRef<HTMLElement>(null);
  const pendingTabScrollTopRef = useRef<number | null>(null);
  const setTabPreservingScroll = useCallback((nextTab: Tab) => {
    setTab((currentTab) => {
      if (currentTab === nextTab) return currentTab;
      pendingTabScrollTopRef.current = projectMainRef.current?.scrollTop ?? null;
      return nextTab;
    });
  }, []);
  const handleTabChange = useCallback((nextTab: Tab) => {
    if (nextTab === tab) return;
    setTabPreservingScroll(nextTab);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new CustomEvent(PROJECT_TAB_NAV_EVENT, {
      detail: { projectId, tab: nextTab }
    }));
  }, [projectId, setTabPreservingScroll, tab]);
  const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, currentTab: Tab) => {
    const currentIndex = TABS.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    handleTabChange(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(`project-tab-${nextTab.toLowerCase()}`)?.focus({ preventScroll: true });
    });
  }, [handleTabChange]);

  useLayoutEffect(() => {
    const requestedScrollTop = pendingTabScrollTopRef.current;
    const main = projectMainRef.current;
    if (requestedScrollTop === null || !main) return;
    pendingTabScrollTopRef.current = null;

    const restoreScroll = () => {
      const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
      main.scrollTop = Math.min(requestedScrollTop, maxScrollTop);
    };
    restoreScroll();
    const frame = window.requestAnimationFrame(restoreScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    const qTab = searchParams.get("tab");
    if (isProjectDetailTab(qTab)) {
      setTabPreservingScroll(qTab);
    }
  }, [searchParams, setTabPreservingScroll]);

  useEffect(() => {
    const handleProjectTabNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; tab?: string }>).detail;
      const nextTab = detail?.tab ?? null;
      if (detail?.projectId !== projectId || !isProjectDetailTab(nextTab)) return;
      setTabPreservingScroll(nextTab);
    };
    const handleHistoryNavigation = () => {
      const queryTab = new URLSearchParams(window.location.search).get("tab");
      if (isProjectDetailTab(queryTab)) {
        setTabPreservingScroll(queryTab);
      }
    };

    window.addEventListener(PROJECT_TAB_NAV_EVENT, handleProjectTabNavigation);
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => {
      window.removeEventListener(PROJECT_TAB_NAV_EVENT, handleProjectTabNavigation);
      window.removeEventListener("popstate", handleHistoryNavigation);
    };
  }, [projectId, setTabPreservingScroll]);

  const [isPushed, setIsPushed] = useState(false);
  const [isHoveredPush, setIsHoveredPush] = useState(false);
  const [isHoveredEdit, setIsHoveredEdit] = useState(false);
  const [isHoveredMore, setIsHoveredMore] = useState(false);

  const [priorityFilter, setPriorityFilter]   = useState<string>("All");
  const [memberFilter, setMemberFilter]       = useState<string>("All");
  const [milestoneFilter, setMilestoneFilter] = useState<string>("All");
  const [hoursMilestoneFilter, setHoursMilestoneFilter] = useState<string>("All");
  const [hoursStageFilter, setHoursStageFilter]         = useState<string>("All");
  const [weeklyWorkloadType, setWeeklyWorkloadType]     = useState<"tasks" | "hours">("tasks");

  const [timelineScale, setTimelineScale] = useState<"week" | "month">("month");
  const [timelineStartIdx, setTimelineStartIdx] = useState(0);

  useEffect(() => {
    // Center timeline near the first visible production stage when the scale changes.
    if (timelineScale === "month") {
      setTimelineStartIdx(0);
    } else {
      setTimelineStartIdx(0);
    }
  }, [timelineScale]);

  useEffect(() => {
    setHoursStageFilter("All");
  }, [hoursMilestoneFilter]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const parsed = readPushedProjectIds(pushedProjectOwnerKey);
      setIsPushed(parsed.includes(projectId));
    }
  }, [projectId, pushedProjectOwnerKey]);

  const handleTogglePush = () => {
    if (typeof window !== "undefined") {
      let pushed = readPushedProjectIds(pushedProjectOwnerKey);
      if (pushed.includes(projectId)) {
        pushed = pushed.filter((id: string) => id !== projectId);
      } else {
        pushed = [...pushed, projectId];
      }
      writePushedProjectIds(pushed, pushedProjectOwnerKey);
      setIsPushed(pushed.includes(projectId));
    }
  };

  const projectPeople = useProjectPeople(projectId);
  const teamMutationRef = useRef(false);
  // Team members state
  const [workspaceTeamMembers, setWorkspaceTeamMembers] = useState<ProjectTeamMember[]>([]);
  const [teamMembers, setTeamMembers] = useState<ProjectTeamMember[]>(EMPTY_TEAM_MEMBERS);
  const [loadingWorkspaceUsers, setLoadingWorkspaceUsers] = useState(true);
  const [workspaceUsersError, setWorkspaceUsersError] = useState<string | null>(null);
  const [workspaceUsersRevision, setWorkspaceUsersRevision] = useState(0);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [teamMutationError, setTeamMutationError] = useState<string | null>(null);
  const [mutatingMemberId, setMutatingMemberId] = useState<string | null>(null);
  const projectTeamMembers = project.id === PROJECT_NOT_FOUND.id
    ? EMPTY_TEAM_MEMBERS
    : dedupeTeamMembers(project.members.map(toProjectTeamMemberFromProjectMember));

  const persistProjectMembers = useCallback(async (nextMembers: ProjectTeamMember[]) => {
    if (teamMutationRef.current) throw new Error("Please wait for the current team update to finish.");
    teamMutationRef.current = true;
    try {
    const dedupedMembers = dedupeTeamMembers(nextMembers);
    const memberUserIds = dedupedMembers.map(member => member.id);
    if (memberUserIds.some(id => !id)) throw new Error("A project member is missing a valid user ID.");
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberUserIds })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Team`)}`);
      return null;
    }
    if (!response.ok) {
      throw new Error(await mutationErrorMessage(response, "Could not update project members"));
    }

    const updatedProject = mapProjectSummaryToUiProject((await response.json()) as ProjectSummary);
    setProject(updatedProject);
    const updatedProjectMembers = updatedProject.id === PROJECT_NOT_FOUND.id
      ? EMPTY_TEAM_MEMBERS
      : dedupeTeamMembers(updatedProject.members.map(toProjectTeamMemberFromProjectMember));
    const mergedMembers = mergeTeamMembers(updatedProjectMembers, workspaceTeamMembers);
    setTeamMembers(mergedMembers);
    clearLiveProjectSnapshotCache();
    projectPeople.refresh();
    return mergedMembers;
    } finally { teamMutationRef.current = false; }
  }, [projectId, workspaceTeamMembers, projectPeople.refresh]);

  const handleInviteMember = useCallback(async (user: ProjectTeamMember) => {
    setTeamMutationError(null);
    const nextMembers = teamMembers.some((member) => projectMemberMatches(member, user))
      ? teamMembers
      : [...teamMembers, user];
    await persistProjectMembers(nextMembers);
  }, [persistProjectMembers, teamMembers]);

  const handleRemoveMember = useCallback(async (member: ProjectTeamMember) => {
    const memberKey = projectMemberIdentity(member);
    try {
      setTeamMutationError(null);
      setMutatingMemberId(memberKey);
      const nextMembers = teamMembers.filter((candidate) => !projectMemberMatches(candidate, member));
      await persistProjectMembers(nextMembers);
    } catch (error) {
      setTeamMutationError(error instanceof Error ? error.message : "Could not remove member");
    } finally {
      setMutatingMemberId(null);
    }
  }, [persistProjectMembers, teamMembers]);

  useEffect(() => {
    if (!projectPeople.loading && !projectPeople.error) {
      // Keep assignment counts from the project summary. The members endpoint
      // is an identity directory and intentionally returns zero task counts.
      setTeamMembers(mergeTeamMembers(projectTeamMembers, projectPeople.members.map(toProjectTeamMember)));
    }
  }, [project.id, project.members, projectPeople.members, projectPeople.loading, projectPeople.error]);

  const assignmentTeamMembers = useMemo(() => projectPeople.members.map(toProjectTeamMember), [projectPeople.members]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkspaceUsers() {
      try {
        setLoadingWorkspaceUsers(true);
        setWorkspaceUsersError(null);
        const users = (await fetchWorkspaceUserOptions(controller.signal)).map(toProjectTeamMember);
        setWorkspaceTeamMembers(users);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorizedWorkspaceUsersError(error)) {
          window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`);
          return;
        }
        setWorkspaceTeamMembers([]);
        setWorkspaceUsersError(error instanceof Error ? error.message : "Could not load synced workspace users");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingWorkspaceUsers(false);
        }
      }
    }

    loadWorkspaceUsers();
    return () => controller.abort();
  }, [projectId, workspaceUsersRevision]);

  // Milestone and task hierarchy state.
  const [milestones, setMilestones] = useState<Milestone[]>(EMPTY_MILESTONES);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [milestoneGroups, setMilestoneGroups] = useState<MilestoneGroup[]>(EMPTY_MILESTONE_GROUPS);
  const [hierarchyOrderVersion, setHierarchyOrderVersion] = useState(initialProjectSnapshot?.project?.hierarchyOrderVersion ?? 0);
  const [hierarchyBusy, setHierarchyBusy] = useState(false);
  const [hierarchyAnnouncement, setHierarchyAnnouncement] = useState("");
  const hierarchyMutationInFlightRef = useRef(false);
  const hierarchyCoordinator = useRef(createHierarchyOrderCoordinator<HierarchyUiState>({
    milestones: EMPTY_MILESTONES,
    groups: EMPTY_MILESTONE_GROUPS,
    version: initialProjectSnapshot?.project?.hierarchyOrderVersion ?? 0
  }));
  const canReorderHierarchy = hasAnyAuthRole(user, ["FOUNDER_GM", "DELIVERY_LEAD"]);

  useEffect(() => {
    setHierarchyOrderVersion(project.hierarchyOrderVersion ?? 0);
  }, [project.hierarchyOrderVersion, projectId]);

  const applyHierarchyOrder = useCallback((
    state: HierarchyUiState,
    kind: ProjectHierarchyOrderKind,
    parentId: string | null,
    orderedIds: readonly string[]
  ): HierarchyUiState => {
    if (kind === "milestone") {
      const realMilestones = state.milestones.filter(item => !isUnassignedTasksMilestoneId(item.id));
      const alignedMilestones = alignItemsToOrder(realMilestones, orderedIds, item => item.id);
      const realGroups = state.groups.filter(item => !isUnassignedTasksMilestoneId(item.milestoneId));
      const alignedGroups = alignItemsToOrder(realGroups, orderedIds, item => item.milestoneId);
      if (!alignedMilestones || !alignedGroups) return state;
      return {
        ...state,
        milestones: [...alignedMilestones, ...state.milestones.filter(item => isUnassignedTasksMilestoneId(item.id))],
        groups: [...alignedGroups, ...state.groups.filter(item => isUnassignedTasksMilestoneId(item.milestoneId))]
      };
    }
    if (!parentId) return state;
    if (kind === "stage") {
      return {
        ...state,
        groups: state.groups.map(group => {
          if (group.milestoneId !== parentId) return group;
          const sortable = group.stages.filter(stage => !stage.isMilestonePlaceholder && !isUnassignedTasksStageId(stage.id));
          const aligned = alignItemsToOrder(sortable, orderedIds, item => item.id);
          if (!aligned) return group;
          let cursor = 0;
          return {
            ...group,
            stages: group.stages.map(stage =>
              stage.isMilestonePlaceholder || isUnassignedTasksStageId(stage.id) ? stage : aligned[cursor++]
            )
          };
        })
      };
    }
    return {
      ...state,
      groups: state.groups.map(group => ({
        ...group,
        stages: group.stages.map(stage => {
          if (stage.id !== parentId || isUnassignedTasksStageId(stage.id)) return stage;
          const aligned = alignItemsToOrder(stage.tasks, orderedIds, item => item.id);
          return aligned ? { ...stage, tasks: aligned } : stage;
        })
      }))
    };
  }, []);

  const reloadCanonicalHierarchy = useCallback(async () => {
    const [projectResponse, workItems] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        credentials: "same-origin"
      }),
      fetchLiveProjectWorkItems(projectId)
    ]);
    if (projectResponse.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return null;
    }
    if (!projectResponse.ok) throw new Error(`Could not reload hierarchy (${projectResponse.status}).`);
    const canonicalProject = mapProjectSummaryToUiProject(await projectResponse.json() as ProjectSummary);
    const canonical: HierarchyUiState = {
      milestones: workItems.milestones,
      groups: workItems.groups,
      version: canonicalProject.hierarchyOrderVersion ?? 0
    };
    setProject(canonicalProject);
    setMilestones(canonical.milestones);
    setMilestoneGroups(canonical.groups);
    setHierarchyOrderVersion(canonical.version);
    hierarchyCoordinator.current.replaceConfirmed(canonical);
    return canonical;
  }, [projectId]);

  const handleHierarchyReorder = useCallback(async (
    kind: ProjectHierarchyOrderKind,
    parentId: string | null,
    orderedIds: string[]
  ) => {
    if (hierarchyMutationInFlightRef.current || !canReorderHierarchy) return;
    hierarchyMutationInFlightRef.current = true;
    const current: HierarchyUiState = { milestones, groups: milestoneGroups, version: hierarchyOrderVersion };
    hierarchyCoordinator.current.replaceConfirmed(current);
    const optimistic = applyHierarchyOrder(current, kind, parentId, orderedIds);
    const snapshot = hierarchyCoordinator.current.begin(optimistic);
    setHierarchyBusy(true);
    setMutationError(null);
    setHierarchyAnnouncement("Đang lưu thứ tự mới…");
    setMilestones(optimistic.milestones);
    setMilestoneGroups(optimistic.groups);
    try {
      const result = await putProjectHierarchyOrder(projectId, buildHierarchyOrderInput({
        kind,
        parentId,
        orderedIds,
        expectedVersion: current.version
      }));
      if (!result.ok) {
        if (result.status === 401) {
          window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
          return;
        }
        if (result.status === 409) {
          await reloadCanonicalHierarchy();
          setMutationError("Thứ tự đã được người khác cập nhật. Danh sách mới nhất đã được tải lại.");
          setHierarchyAnnouncement("Có xung đột. Đã tải lại thứ tự mới nhất.");
          return;
        }
        throw new Error(result.message);
      }
      const canonical = applyHierarchyOrder(optimistic, kind, parentId, result.data.orderedIds);
      canonical.version = result.data.hierarchyOrderVersion;
      hierarchyCoordinator.current.confirm(snapshot, canonical);
      setMilestones(canonical.milestones);
      setMilestoneGroups(canonical.groups);
      setHierarchyOrderVersion(canonical.version);
      setProject(previous => ({ ...previous, hierarchyOrderVersion: canonical.version }));
      setHierarchyAnnouncement("Đã lưu thứ tự.");
    } catch (error) {
      const rollback = hierarchyCoordinator.current.reject(snapshot);
      if (rollback) {
        setMilestones(rollback.milestones);
        setMilestoneGroups(rollback.groups);
        setHierarchyOrderVersion(rollback.version);
      }
      setMutationError(error instanceof Error ? error.message : "Không thể lưu thứ tự.");
      setHierarchyAnnouncement("Không thể lưu. Thứ tự trước đó đã được khôi phục.");
    } finally {
      hierarchyMutationInFlightRef.current = false;
      setHierarchyBusy(false);
    }
  }, [
    applyHierarchyOrder,
    canReorderHierarchy,
    hierarchyBusy,
    hierarchyOrderVersion,
    milestoneGroups,
    milestones,
    projectId,
    reloadCanonicalHierarchy
  ]);

  // Modal state for stage/task creation
  const [addStageFor,  setAddStageFor]  = useState<{ id:string; name:string } | null>(null);
  const [addTaskFor,   setAddTaskFor]   = useState<{ milestoneId:string; stageId:string; stageName:string } | null>(null);

  // Modal state for edit/delete
  const [editTaskFor,   setEditTaskFor]   = useState<{ milestoneId:string; stageId:string; task:TaskItem } | null>(null);
  const [deleteTaskFor, setDeleteTaskFor] = useState<{ milestoneId:string; stageId:string; taskId:string; title:string } | null>(null);
  const [editStageFor,  setEditStageFor]  = useState<{ milestoneId:string; stage:StageItem } | null>(null);
  const [editMilestoneFor, setEditMilestoneFor] = useState<Milestone | null>(null);
  const [deleteMilestoneFor, setDeleteMilestoneFor] = useState<Milestone | null>(null);
  const [deleteStageFor,setDeleteStageFor]= useState<{ milestoneId:string; stageId:string; stageName:string } | null>(null);
  // viewTaskDetails removed — task detail navigates to /tasks/[taskId] full page
  const taskDetailRouter = useRouter();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutatingDelete, setMutatingDelete] = useState(false);

  useEffect(() => {
    setShowMilestoneModal(false);
    setAddStageFor(null);
    setAddTaskFor(null);
    setEditTaskFor(null);
    setEditStageFor(null);
    setEditMilestoneFor(null);
    setMutationError(null);
  }, [projectId]);

  const resolveMilestoneStageId = useCallback((milestoneId: string) => {
    return milestoneGroups.find(group => group.milestoneId === milestoneId)?.stages[0]?.id ?? milestoneId;
  }, [milestoneGroups]);

  // Documents state variables
  const [documents, setDocuments] = useState<ProjectDoc[]>(EMPTY_PROJECT_DOCS);
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>(EMPTY_ACTIVITY_LOG);
  const [activityPage, setActivityPage] = useState(0);
  const [riskRegistry, setRiskRegistry] = useState<RiskItem[]>(EMPTY_RISK_REGISTRY);
  const handleCreateProjectRisk = useCallback(async (draft: ProjectRiskDraft) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/risks`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });
    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Issues`)}`);
      return;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(payload?.message || "Không thể lưu bản ghi vấn đề.");
    }
    const created = await response.json() as ProjectRiskSummary;
    setRiskRegistry((current) => [mapProjectRiskToRiskItem(created), ...current]);
  }, [projectId]);
  const [showAddDocModal, setShowAddDocModal] = useState(false);
  const [addVersionForDoc, setAddVersionForDoc] = useState<ProjectDoc | null>(null);
  const [showVersionHistoryForDoc, setShowVersionHistoryForDoc] = useState<ProjectDoc | null>(null);
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [docCategoryFilter, setDocCategoryFilter] = useState("All");
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [documentMutationError, setDocumentMutationError] = useState<string | null>(null);
  const uploadedProjectFileCache = useRef(new WeakMap<File, FileObjectSummary>());

  const handleDownloadDocument = useCallback(async (fileObjectId: string) => {
    if (downloadingFileId) return;
    setDownloadingFileId(fileObjectId);
    setDocumentMutationError(null);
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(fileObjectId)}/download-grants`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInSeconds: 300 })
      });
      if (!response.ok) throw new Error(`Could not create download grant: ${response.status}`);
      const payload = await response.json() as { signedUrl?: string };
      if (!payload.signedUrl?.startsWith("/")) throw new Error("Download grant returned an invalid URL.");
      window.location.assign(payload.signedUrl);
    } catch (error) {
      setDocumentMutationError(error instanceof Error ? error.message : "Could not download this file.");
    } finally {
      setDownloadingFileId(null);
    }
  }, [downloadingFileId]);

  const uploadProjectFile = useCallback(async (file: File) => {
    const cached = uploadedProjectFileCache.current.get(file);
    if (cached) return cached;
    if (!project.accountId) throw new Error("Project account is unavailable.");
    const response = await fetch("/api/files", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: project.accountId,
        projectId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        base64Data: await readFileAsBase64(file),
        ownerType: "project_document",
        ownerId: projectId,
        internalOnly: true,
        customerVisible: false
      })
    });
    if (!response.ok) throw new Error(`Could not upload file: ${response.status}`);
    const uploaded = await response.json() as FileObjectSummary;
    uploadedProjectFileCache.current.set(file, uploaded);
    return uploaded;
  }, [project.accountId, projectId]);

  const handleAddDocument = useCallback(async (doc: Omit<ProjectDoc, "id">, file: File, note: string) => {
    try {
      const uploaded = await uploadProjectFile(file);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: doc.name,
        artifactType: artifactTypeFromCategory(doc.category),
        fileObjectId: uploaded.id,
        note,
        internalOnly: true,
        customerVisible: false,
        allowedRoles: []
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Documents`)}`);
      return false;
    }
    if (!response.ok) {
      return false;
    }

    const created = (await response.json()) as ProjectDocumentSummary;
    const nextDoc = mapProjectDocumentToDoc(created);
    setDocuments(prev => [...prev, nextDoc]);
    return true;
    } catch (error) {
      console.error("Project document upload failed", error);
      return false;
    }
  }, [projectId, uploadProjectFile]);

  const handleAddVersion = useCallback(async (docId: string, file: File, note: string): Promise<VersionSaveResult> => {
    const current = documents.find(doc => doc.id === docId);
    if (!current) return { ok: false, error: "This document is no longer available. Refresh the project and try again." };

    try {
    const uploaded = await uploadProjectFile(file);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}/versions`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileObjectId: uploaded.id,
        expectedVersion: current.versions.reduce((latest, version) => Math.max(latest, version.version), 0),
        note
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Documents`)}`);
      return { ok: false, error: "Your session expired. Sign in again to upload this version." };
    }
    if (response.status === 409) {
      let currentVersion = current.versions.reduce((latest, version) => Math.max(latest, version.version), 0);
      try {
        const canonicalPayload = await fetchProjectResource<ProjectDocumentSummary>(projectId, "documents");
        const canonicalDocuments = canonicalPayload.data.map(mapProjectDocumentToDoc);
        setDocuments(canonicalDocuments);
        const canonicalDocument = canonicalDocuments.find(document => document.id === docId);
        if (canonicalDocument) {
          currentVersion = canonicalDocument.versions.reduce((latest, version) => Math.max(latest, version.version), 0);
          setAddVersionForDoc(canonicalDocument);
        }
      } catch {
        // Keep the selected file and notes so the user can refresh and retry safely.
      }
      const conflictMessage = `Another version was saved first. The current canonical version is v${currentVersion}.0. Review the refreshed history, then retry.`;
      setDocumentMutationError(conflictMessage);
      return { ok: false, error: conflictMessage };
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      return { ok: false, error: payload?.message || `Version upload failed (${response.status}). Your selected file and notes are still available.` };
    }

    const savedDocument = await response.json() as ProjectDocumentSummary;
    setDocuments(prev => prev.map(doc => doc.id === docId ? mapProjectDocumentToDoc(savedDocument) : doc));
    setDocumentMutationError(null);
    return { ok: true };
    } catch (error) {
      console.error("Project document version upload failed", error);
      return { ok: false, error: error instanceof Error ? error.message : "Version upload failed. Your selected file and notes are still available." };
    }
  }, [documents, projectId, uploadProjectFile]);

  const handleDeleteDocument = useCallback(async (docId: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Documents`)}`);
      return;
    }
    if (!response.ok) {
      window.alert(`Could not delete document: ${response.status}`);
      return;
    }

    setDocuments(prev => prev.filter(doc => doc.id !== docId));
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProjectWorkItems() {
      try {
        setMilestones(EMPTY_MILESTONES);
        setMilestoneGroups(EMPTY_MILESTONE_GROUPS);
        setDocuments(EMPTY_PROJECT_DOCS);
        setActivityLog(EMPTY_ACTIVITY_LOG);
        setActivityPage(0);
        setRiskRegistry(EMPTY_RISK_REGISTRY);
        const [workItems, operationalRecords] = await Promise.all([
          fetchLiveProjectWorkItems(projectId, controller.signal),
          fetchProjectOperationalRecords(projectId, controller.signal)
        ]);
        if (controller.signal.aborted) return;
        setMilestones(workItems.milestones);
        setMilestoneGroups(workItems.groups);
        setDocuments(operationalRecords.documents);
        setActivityLog(operationalRecords.activityLog);
        setRiskRegistry(operationalRecords.risks);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof LiveProjectDetailError && error.status === 401) {
          window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`);
          return;
        }
        setMilestones(EMPTY_MILESTONES);
        setMilestoneGroups(EMPTY_MILESTONE_GROUPS);
        setDocuments(EMPTY_PROJECT_DOCS);
        setActivityLog(EMPTY_ACTIVITY_LOG);
        setRiskRegistry(EMPTY_RISK_REGISTRY);
      }
    }

    loadProjectWorkItems();
    return () => controller.abort();
  }, [projectId]);


  const handleSaveTaskHours = useCallback((milestoneId: string, stageId: string, taskId: string, actualHours: number, plannedHours: number, timeEntries: TimeEntry[]) => {
    setMilestoneGroups(prev => prev.map(mg =>
      mg.milestoneId === milestoneId
        ? {
            ...mg,
            stages: mg.stages.map(s =>
              s.id === stageId
                ? {
                    ...s,
                    tasks: s.tasks.map(t =>
                      t.id === taskId ? { ...t, actualHours, plannedHours, timeEntries } : t
                    )
                  }
                : s
            )
          }
        : mg
    ));
  }, []);

  const sc = STATUS_CFG[project.status];
  const pc = PRIORITY_CFG[project.priority.toLowerCase() as keyof typeof PRIORITY_CFG];
  const budgetPct = project.budget > 0 ? Math.round((project.spent / project.budget) * 100) : 0;

  const nextMilestoneIdx = milestones.findIndex(m => m.status !== "done");

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleAddMilestone = useCallback(async (m: Milestone) => {
    const owner = findAssignableTeamMember(teamMembers, m.picUserId);
    if (!owner) throw new Error(PROJECT_MEMBER_ASSIGNMENT_ERROR);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phase: m.name,
        activity: m.name,
        status: toApiStageStatus(m.status),
        ownerUserId: owner?.id,
        plannedStartAt: toApiDateValue(m.startDate),
        plannedEndAt: toApiDateValue(m.dueDate),
        criteria: m.description || "Milestone completion criteria",
        description: m.description,
        scopeSummary: m.description,
        progressPercent: m.status === "done" ? 100 : 0
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      const message = await mutationErrorMessage(response, "Could not create milestone");
      throw new Error(userFacingAssignmentError(message));
    }

    const stage = (await response.json()) as ProjectStageSummary;
    const createdMilestone = mapStageToMilestone(stage, milestones.length + 1);
    setMilestones(prev => [...prev, createdMilestone].sort((a, b) => a.order - b.order));
    setMilestoneGroups(prev => [...prev, { milestoneId: stage.milestoneId, stages: [mapStageToStageItem(stage, [])] }]);
    await reloadCanonicalHierarchy();
    setMutationError(null);
  }, [milestones.length, projectId, reloadCanonicalHierarchy, teamMembers, workspaceTeamMembers]);

  const handleEditMilestone = useCallback(async (milestoneId: string, updated: Milestone) => {
    const original = milestones.find(item => item.id === milestoneId);
    const ownerChanged = updated.picUserId !== original?.picUserId;
    const owner = findAssignableTeamMember(assignmentTeamMembers, updated.picUserId);
    if (ownerChanged && updated.picUserId && !owner) throw new Error(PROJECT_MEMBER_ASSIGNMENT_ERROR);
    const representativeStageId = resolveMilestoneStageId(milestoneId);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(representativeStageId)}?scope=milestone`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phase: updated.name !== original?.name ? updated.name : undefined,
        status: updated.status !== original?.status ? toApiStageStatus(updated.status) : undefined,
        ownerUserId: ownerChanged ? (owner?.id ?? null) : undefined,
        plannedStartAt: updated.startDate !== original?.startDate ? toApiDateValue(updated.startDate) : undefined,
        plannedEndAt: updated.dueDate !== original?.dueDate ? toApiDateValue(updated.dueDate) : undefined,
        criteria: updated.description !== original?.description ? updated.description || "Milestone completion criteria" : undefined,
        description: updated.description !== original?.description ? updated.description : undefined,
        scopeSummary: updated.description !== original?.description ? updated.description : undefined,
        progressPercent: updated.status !== original?.status && updated.status === "done" ? 100 : undefined
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      const message = await mutationErrorMessage(response, "Could not update milestone");
      throw new Error(userFacingAssignmentError(message));
    }

    const stage = (await response.json()) as ProjectStageSummary;
    setMilestones(prev => prev.map(m => m.id === milestoneId ? mapStageToMilestone(stage, m.order) : m));
    setMilestoneGroups(prev => prev.map(group =>
      group.milestoneId === milestoneId
        ? {
            ...group,
            milestoneId: stage.milestoneId,
            stages: group.stages.map(item =>
              item.id === stage.id
                ? {
                    ...item,
                    name: stage.activity || stage.phase || stage.stageKey,
                    pic: initialsForDisplayName(stage.ownerDisplayName || stage.ownerUserId || "Unassigned"),
                    picName: stage.ownerDisplayName || stage.ownerUserId || "Unassigned",
                    picColor: colorForIdentity(stage.ownerDisplayName || stage.ownerUserId || "Unassigned"),
                    picUserId: stage.ownerUserId,
                    startDate: formatApiDate(stage.actualStartAt || stage.plannedStartAt),
                    dueDate: formatApiDate(stage.actualEndAt || stage.plannedEndAt),
                    description: stage.scopeSummary || stage.description || stage.criteria || "",
                    status: toStageStatus(stage.status),
                    isMilestonePlaceholder: item.isMilestonePlaceholder
                  }
                : item
            )
          }
        : group
    ));
    await reloadCanonicalHierarchy();
    setMutationError(null);
  }, [projectId, reloadCanonicalHierarchy, resolveMilestoneStageId, teamMembers, workspaceTeamMembers]);

  const handleDeleteMilestone = useCallback(async (milestoneId: string) => {
    setMutatingDelete(true);
    setMutationError(null);
    const representativeStageId = resolveMilestoneStageId(milestoneId);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(representativeStageId)}?scope=milestone`, {
      method: "DELETE",
      credentials: "same-origin"
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      setMutationError(await mutationErrorMessage(response, "Could not delete milestone"));
      setMutatingDelete(false);
      return;
    }

    setMilestones(prev => prev.filter(m => m.id !== milestoneId));
    setMilestoneGroups(prev => prev.filter(mg => mg.milestoneId !== milestoneId));
    await reloadCanonicalHierarchy();
    setDeleteMilestoneFor(null);
    setMutatingDelete(false);
  }, [projectId, reloadCanonicalHierarchy, resolveMilestoneStageId]);

  const handleAddStage = useCallback(async (milestoneId: string, newStage: StageItem) => {
    const milestoneName = milestones.find(m => m.id === milestoneId)?.name.trim();
    const activity = newStage.name.trim();
    if (!milestoneName) {
      throw new Error("Could not create stage because the milestone was not found");
    }
    if (!activity || normalizeBoardEntityName(activity) === normalizeBoardEntityName(milestoneName)) {
      throw new Error("Stage name must be different from the milestone name");
    }

    const owner = findAssignableTeamMember(teamMembers, newStage.picUserId);
    if (!owner) throw new Error(PROJECT_MEMBER_ASSIGNMENT_ERROR);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phase: milestoneName,
        activity,
        status: toApiStageStatus(newStage.status),
        ownerUserId: owner?.id,
        plannedStartAt: toApiDateValue(newStage.startDate),
        plannedEndAt: toApiDateValue(newStage.dueDate),
        criteria: newStage.description || "Stage completion criteria",
        description: newStage.description,
        scopeSummary: newStage.description,
        progressPercent: newStage.status === "done" ? 100 : 0
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      const message = await mutationErrorMessage(response, "Could not create stage");
      throw new Error(userFacingAssignmentError(message));
    }

    const stage = (await response.json()) as ProjectStageSummary;
    setMilestoneGroups(prev => prev.map(group =>
      group.milestoneId === milestoneId
        ? { ...group, stages: [...group.stages, mapStageToStageItem(stage, [])] }
        : group
    ));
    await reloadCanonicalHierarchy();
    setMutationError(null);
  }, [milestones, projectId, reloadCanonicalHierarchy, teamMembers, workspaceTeamMembers]);

  const handleAddTask = useCallback(async (milestoneId: string, stageId: string, task: TaskItem) => {
    const assignee = findAssignableTeamMember(teamMembers, task.assigneeUserId);
    if (!assignee) throw new Error(PROJECT_MEMBER_ASSIGNMENT_ERROR);
    const mutationStageId = stageIdForTaskMutation(stageId);
    const response = await fetch("/api/tasks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        stageId: mutationStageId,
        title: task.title,
        status: toApiTaskStatus(task.status),
        priority: task.priority,
        assigneeUserId: assignee?.id,
        ownerUserId: assignee?.id,
        plannedStartAt: toApiDateValue(task.startDate),
        dueAt: toApiDateValue(task.due),
        estimateMinutes: hoursToMinutes(task.plannedHours),
        description: task.description
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      const message = await mutationErrorMessage(response, "Could not create task");
      throw new Error(userFacingAssignmentError(message));
    }

    const created = mapProjectTaskToTaskItem((await response.json()) as ProjectTaskSummary);
    setMilestoneGroups(prev => prev.map(mg =>
      mg.milestoneId === milestoneId
        ? { ...mg, stages: mg.stages.map(s => s.id === stageId ? { ...s, tasks:[...s.tasks, created] } : s) }
        : mg
    ));
    await reloadCanonicalHierarchy();
    setMutationError(null);
  }, [projectId, reloadCanonicalHierarchy, teamMembers, workspaceTeamMembers]);

  const handleEditTask = useCallback(async (milestoneId: string, stageId: string, updated: TaskItem) => {
    const assignee = findAssignableTeamMember(teamMembers, updated.assigneeUserId);
    if (!assignee) throw new Error(PROJECT_MEMBER_ASSIGNMENT_ERROR);
    const mutationStageId = stageIdForTaskMutation(stageId);
    const response = await fetch(`/api/tasks/${encodeURIComponent(updated.id)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        stageId: mutationStageId,
        title: updated.title,
        description: updated.description ?? null,
        status: toApiTaskStatus(updated.status),
        priority: updated.priority,
        assigneeUserId: assignee?.id ?? null,
        ownerUserId: assignee?.id ?? null,
        plannedStartAt: toApiDateValue(updated.startDate) ?? null,
        dueAt: toApiDateValue(updated.due) ?? null,
        estimateMinutes: hoursToMinutes(updated.plannedHours)
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      const message = await mutationErrorMessage(response, "Could not update task");
      throw new Error(userFacingAssignmentError(message));
    }

    const saved = mapProjectTaskToTaskItem((await response.json()) as ProjectTaskSummary);
    setMilestoneGroups(prev => prev.map(mg =>
      mg.milestoneId === milestoneId
        ? { ...mg, stages: mg.stages.map(s =>
            s.id === stageId
              ? { ...s, tasks: s.tasks.map(t => t.id === saved.id ? saved : t) }
              : s
          )}
        : mg
    ));
    setMutationError(null);
  }, [projectId, teamMembers, workspaceTeamMembers]);

  const handleDeleteTask = useCallback(async (milestoneId: string, stageId: string, taskId: string) => {
    setMutatingDelete(true);
    setMutationError(null);
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      setMutationError(await mutationErrorMessage(response, "Could not delete task"));
      setMutatingDelete(false);
      return;
    }

    setMilestoneGroups(prev => prev.map(mg =>
      mg.milestoneId === milestoneId
        ? { ...mg, stages: mg.stages.map(s =>
            s.id === stageId
              ? { ...s, tasks: s.tasks.filter(t => t.id !== taskId) }
              : s
          )}
        : mg
    ));
    await reloadCanonicalHierarchy();
    setDeleteTaskFor(null);
    setMutatingDelete(false);
  }, [projectId, reloadCanonicalHierarchy]);

  const handleEditStage = useCallback(async (milestoneId: string, stageId: string, updated: StageItem) => {
    const owner = findAssignableTeamMember(teamMembers, updated.picUserId);
    if (!owner) throw new Error(PROJECT_MEMBER_ASSIGNMENT_ERROR);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activity: updated.name,
        status: toApiStageStatus(updated.status),
        ownerUserId: owner?.id ?? null,
        plannedStartAt: toApiDateValue(updated.startDate),
        plannedEndAt: toApiDateValue(updated.dueDate),
        criteria: updated.description || "Stage completion criteria",
        description: updated.description,
        scopeSummary: updated.description,
        progressPercent: updated.status === "done" ? 100 : undefined
      })
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      const message = await mutationErrorMessage(response, "Could not update stage");
      throw new Error(userFacingAssignmentError(message));
    }

    const savedStage = (await response.json()) as ProjectStageSummary;
    const existingTasks = milestoneGroups.find(group => group.milestoneId === milestoneId)?.stages.find(stage => stage.id === stageId)?.tasks ?? [];
    const savedStageItem = { ...mapStageToStageItem(savedStage, []), tasks: existingTasks };
    setMilestoneGroups(prev => prev.map(mg =>
      mg.milestoneId === milestoneId
        ? { ...mg, stages: mg.stages.map(s => s.id === stageId ? savedStageItem : s) }
        : mg
    ));
    setMutationError(null);
  }, [milestoneGroups, projectId, teamMembers, workspaceTeamMembers]);

  const handleDeleteStage = useCallback(async (milestoneId: string, stageId: string) => {
    setMutatingDelete(true);
    setMutationError(null);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });

    if (response.status === 401) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=Tasks`)}`);
      return;
    }
    if (!response.ok) {
      setMutationError(await mutationErrorMessage(response, "Could not delete stage"));
      setMutatingDelete(false);
      return;
    }

    await reloadCanonicalHierarchy();
    setDeleteStageFor(null);
    setMutatingDelete(false);
  }, [projectId, reloadCanonicalHierarchy]);

  const coverStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, ${project.color}18 0%, ${project.color}35 50%, rgba(15,23,42,0.15) 100%)`,
    backgroundColor: `${project.color}12`,
  };

  // Total tasks stats across all milestones
  const allTasks: TaskItem[] = milestoneGroups.flatMap(mg =>
    mg.stages.flatMap(s =>
      s.tasks.map((t) => {
        const timeEntries = t.timeEntries ?? [];

        return {
          ...t,
          plannedHours: t.plannedHours ?? 0,
          actualHours: t.actualHours ?? 0,
          timeEntries,
          week: weekBucketFromTaskDate(t.due),
          milestoneId: mg.milestoneId,
          stageId: s.id,
          stageName: s.name
        };
      })
    )
  );
  const workLogActivity = buildWorkLogActivityItems(allTasks);
  const projectActivityFeed = [...activityLog, ...workLogActivity].sort(compareActivityDesc);
  const activityTotalPages = Math.max(1, Math.ceil(projectActivityFeed.length / ACTIVITY_PAGE_SIZE));
  const safeActivityPage = Math.min(activityPage, activityTotalPages - 1);
  const pagedProjectActivityFeed = projectActivityFeed.slice(
    safeActivityPage * ACTIVITY_PAGE_SIZE,
    safeActivityPage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE
  );
  const activityUserKeys = new Set(
    projectActivityFeed
      .map(item => normalizeIdentityValue(item.userId) ?? normalizeIdentityValue(item.userName))
      .filter((key): key is string => Boolean(key))
  );
  const actualWorkActivityHours = workLogActivity.reduce((sum, item) => sum + (item.hours ?? 0), 0);
  const touchedActivityTasks = new Set(workLogActivity.map(item => item.target.split(" · ")[0])).size;
  const doneTasks = allTasks.filter(t => t.status === "done").length;

  // Filtered tasks for performance calculations
  const filteredTasks = allTasks.filter(task => {
    // 1. Priority filter
    if (priorityFilter !== "All") {
      if (priorityFilter === "High" && task.priority !== "high" && task.priority !== "critical") return false;
      if (priorityFilter === "Medium" && task.priority !== "medium") return false;
      if (priorityFilter === "Low" && task.priority !== "low") return false;
    }
    // 2. Member filter
    if (memberFilter !== "All" && task.assignee !== memberFilter) {
      return false;
    }
    // 3. Milestone filter
    if (milestoneFilter !== "All") {
      const group = milestoneGroups.find(mg => mg.milestoneId === milestoneFilter);
      if (!group) return false;
      const belongs = group.stages.some(s => s.tasks.some(t => t.id === task.id));
      if (!belongs) return false;
    }
    return true;
  });

  const doneFiltered = filteredTasks.filter(t => t.status === "done").length;
  const filteredProgress = filteredTasks.length > 0 ? Math.round((doneFiltered / filteredTasks.length) * 100) : 0;

  const projectPending = !projectResolved && project.id === PROJECT_NOT_FOUND.id;
  const projectMissing = projectResolved && project.id === PROJECT_NOT_FOUND.id;

  if (projectPending || projectMissing) {
    return (
      <AppShell activeRoute="/projects" title="Project Detail">
          <main className="flex-1 overflow-auto p-4 sm:p-8">
            {projectPending ? (
              <div className="mx-auto max-w-5xl space-y-5" aria-busy="true" aria-label="Preparing project workspace">
                <span className="sr-only">Preparing project workspace</span>
                <div className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
                <div className="h-10 w-full animate-pulse rounded-xl border border-border bg-card" />
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                  <div className="h-64 animate-pulse rounded-xl border border-border bg-card md:col-span-2" />
                  <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
                </div>
              </div>
            ) : (
              <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <h1 className="text-2xl font-black text-foreground">Project not found</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  This project ID does not exist in the production CRM workspace.
                </p>
                <Link
                  href="/projects"
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to projects
                </Link>
              </div>
            )}
          </main>
      </AppShell>
    );
  }

  return (
    <ProjectPickerFeedback.Provider value={{ ready: !projectPeople.loading && !projectPeople.error, feedback: <>{projectPeople.loading && <p role="status">Loading project members…</p>}{projectPeople.error && <div role="alert" className="text-sm text-destructive">{projectPeople.error} <button className="underline" onClick={projectPeople.refresh}>Retry loading project members</button></div>}</> }}>
      {/* Modals */}
      {showAddDocModal && (
        <AddDocModal
          projectColor={project.color}
          onClose={() => setShowAddDocModal(false)}
          onAdd={handleAddDocument}
        />
      )}
      {addVersionForDoc && (
        <AddVersionModal
          doc={addVersionForDoc}
          projectColor={project.color}
          onClose={() => setAddVersionForDoc(null)}
          onAddVersion={handleAddVersion}
        />
      )}
      {showVersionHistoryForDoc && (
        <VersionHistoryModal
          doc={showVersionHistoryForDoc}
          projectColor={project.color}
          onClose={() => setShowVersionHistoryForDoc(null)}
          onDownload={handleDownloadDocument}
          downloadingFileId={downloadingFileId}
          downloadError={documentMutationError}
          teamMembers={teamMembers}
        />
      )}
      {showMilestoneModal && (
        <MilestoneModal projectColor={project.color} onClose={() => setShowMilestoneModal(false)} onSave={handleAddMilestone} members={assignmentTeamMembers} />
      )}
      {showInviteModal && (
        <InviteMemberModal
          color={project.color}
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInviteMember}
          teamMembers={teamMembers}
          workspaceUsers={workspaceTeamMembers}
        />
      )}

      {addStageFor && (
        <AddStageModal
          color={project.color}
          milestoneName={addStageFor.name}
          onClose={() => setAddStageFor(null)}
          onSave={newStage => handleAddStage(addStageFor.id, newStage)}
          members={assignmentTeamMembers}
        />
      )}
      {addTaskFor && (
        <AddTaskModal
          color={project.color}
          stageName={addTaskFor.stageName}
          onClose={() => setAddTaskFor(null)}
          onSave={task => handleAddTask(addTaskFor.milestoneId, addTaskFor.stageId, task)}
          members={assignmentTeamMembers}
        />
      )}
      {editTaskFor && (
        <EditTaskModal
          task={editTaskFor.task}
          color={project.color}
          onClose={() => setEditTaskFor(null)}
          onSave={updated => handleEditTask(editTaskFor.milestoneId, editTaskFor.stageId, updated)}
          members={assignmentTeamMembers}
        />
      )}
      {deleteTaskFor && (
        <DeleteConfirmModal
          title="Delete Task"
          description={`Remove "${deleteTaskFor.title}" from the active board? Tasks with operational history will be archived instead of permanently deleted.`}
          onClose={() => {
            setDeleteTaskFor(null);
            setMutationError(null);
          }}
          onConfirm={() => handleDeleteTask(deleteTaskFor.milestoneId, deleteTaskFor.stageId, deleteTaskFor.taskId)}
          confirming={mutatingDelete}
          error={mutationError}
        />
      )}
      {editStageFor && (
        <EditStageModal
          stage={editStageFor.stage}
          color={project.color}
          onClose={() => setEditStageFor(null)}
          onSave={updated => handleEditStage(editStageFor.milestoneId, editStageFor.stage.id, updated)}
          members={assignmentTeamMembers}
        />
      )}
      {editMilestoneFor && (
        <EditMilestoneModal
          milestone={editMilestoneFor}
          color={project.color}
          onClose={() => setEditMilestoneFor(null)}
          onSave={updated => handleEditMilestone(editMilestoneFor.id, updated)}
          members={assignmentTeamMembers}
        />
      )}
      {deleteMilestoneFor && (
        <DeleteConfirmModal
          title="Delete Milestone"
          description={`Delete milestone "${deleteMilestoneFor.name}"? This will also delete its stages and tasks.`}
          onClose={() => {
            setDeleteMilestoneFor(null);
            setMutationError(null);
          }}
          onConfirm={() => handleDeleteMilestone(deleteMilestoneFor.id)}
          confirming={mutatingDelete}
          error={mutationError}
        />
      )}
      {deleteStageFor && (
        <DeleteConfirmModal
          title="Delete Stage"
          description={`Delete stage "${deleteStageFor.stageName}"? This will also delete tasks in this stage.`}
          onClose={() => {
            setDeleteStageFor(null);
            setMutationError(null);
          }}
          onConfirm={() => handleDeleteStage(deleteStageFor.milestoneId, deleteStageFor.stageId)}
          confirming={mutatingDelete}
          error={mutationError}
        />
      )}
      {/* Task detail navigates to /tasks/[taskId] full page — no modal here */}

      <AppShell activeRoute="/projects" title="Project Detail">
        <main ref={projectMainRef} className="flex-1 overflow-auto [overflow-anchor:none]">
          {projectPeople.loading && <p role="status" className="px-6 pt-4 text-sm">Loading project members…</p>}
          {projectPeople.error && <div role="alert" className="mx-6 mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{projectPeople.error} <button className="underline" onClick={projectPeople.refresh}>Retry loading project members</button></div>}
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 px-4 pt-4 text-xs text-muted-foreground sm:px-6">
            <Link href="/projects" className="hover:text-foreground transition-colors flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Projects
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-foreground font-medium truncate max-w-[200px]">{project.name}</span>
          </div>

          {/* Cover */}
          <div className="relative mx-4 mt-5 h-40 overflow-hidden rounded-2xl border border-border shadow-sm sm:mx-6 sm:h-28" style={coverStyle}>
            <div className="absolute -top-4 -right-8 w-40 h-40 rounded-full opacity-30 blur-2xl pointer-events-none" style={{ backgroundColor:project.color }} />
            <div className="absolute -bottom-6 left-12 w-28 h-28 rounded-full opacity-20 blur-2xl pointer-events-none" style={{ backgroundColor:project.color }} />
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
              <button
                onClick={handleTogglePush}
                title={isPushed ? "Unpush from Sidebar Menu" : "Push to Sidebar Menu"}
                onMouseEnter={() => setIsHoveredPush(true)}
                onMouseLeave={() => setIsHoveredPush(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all shadow-sm"
                style={{
                  backgroundColor: isPushed
                    ? project.color
                    : (isHoveredPush ? `${project.color}25` : `${project.color}12`),
                  borderColor: isPushed ? 'transparent' : `${project.color}35`,
                  color: isPushed ? '#ffffff' : project.color
                }}
              >
                <Pin className="w-3.5 h-3.5" style={{ transform: isPushed ? "none" : "rotate(45deg)" }} />
                <span>{isPushed ? "Pushed to Menu" : "Push to Menu"}</span>
              </button>
              <button
                type="button" disabled aria-label="Edit project unavailable on this page" title="Edit the project from the Projects list"
                onMouseEnter={() => setIsHoveredEdit(true)}
                onMouseLeave={() => setIsHoveredEdit(false)}
                className="min-h-11 min-w-11 p-2 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: isHoveredEdit ? `${project.color}25` : `${project.color}12`,
                  borderColor: `${project.color}35`,
                  color: project.color
                }}
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button" disabled aria-label="More project actions unavailable" title="Additional actions are not available"
                onMouseEnter={() => setIsHoveredMore(true)}
                onMouseLeave={() => setIsHoveredMore(false)}
                className="min-h-11 min-w-11 p-2 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: isHoveredMore ? `${project.color}25` : `${project.color}12`,
                  borderColor: `${project.color}35`,
                  color: project.color
                }}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="absolute bottom-4 left-5">
              <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{project.category}</p>
              <h1 className="text-lg font-black text-foreground">{project.name}</h1>
            </div>
          </div>

          {/* Header Info */}
          <div className="mt-8 px-4 sm:px-6">
            <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-lg" style={{ backgroundColor:sc.bg, color:sc.color }}>
                  <sc.icon className="w-3 h-3" />{project.status}
                </span>
                <span className="text-[11px] font-semibold px-3 py-1 rounded-lg" style={{ backgroundColor:pc.bg, color:pc.color }}>{project.priority}</span>
                {project.tags.slice(0, 3).map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">{t}</span>
                ))}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
                  disabled={!projectPeople.permissions.canManage || projectPeople.loading} onClick={() => setShowInviteModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
                  <UserPlus className="w-4 h-4" /> Invite
                </motion.button>
                <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
                  onClick={() => {
                    const firstMil = milestones[0];
                    if (firstMil) {
                      const group = milestoneGroups.find(mg => mg.milestoneId === firstMil.id);
                      const firstStage = group ? visibleStagesForMilestone(group, firstMil)[0] : undefined;
                      if (firstStage) {
                        setAddTaskFor({
                          milestoneId: firstMil.id,
                          stageId: firstStage.id,
                          stageName: firstStage.name
                        });
                      } else {
                        setAddStageFor({ id: firstMil.id, name: firstMil.name });
                      }
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
                  style={{ backgroundColor:project.color }}>
                  <Plus className="w-4 h-4" /> Add Task
                </motion.button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-3xl">{project.description}</p>
            <div className="flex flex-wrap items-center gap-3 mb-7">
              {[
                { key:"dates", icon:Calendar, label:<>{project.startDate} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {project.dueDate}</> },
                { key:"team", icon:Users, label:`${teamMembers.length} members` },
                { key:"category", icon:Layers, label:project.category },
                { key:"client", icon:BarChart2,label:project.client },
              ].map(({ key, icon:Icon, label }) => (
                <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg border border-border">
                  <Icon className="w-3.5 h-3.5" />{label}
                </span>
              ))}
            </div>

            {/* KPI grid */}
            <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-5">
              {[
                { label:"Weighted progress", value:`${project.progress}%`, color:project.color, icon:TrendingUp   },
                { label:"Task completion", value:`${doneTasks}/${allTasks.length}`, color:C.success, icon:ListChecks   },
                { label:"Budget",     value:<MoneyAmount value={project.budget} />, color:C.blue, icon:Wallet },
                { label:"Spent",      value:`${budgetPct}%`,                color:budgetPct>90?C.danger:C.slate, icon:BarChart2 },
                { label:"Due Date",   value:project.dueDate,                color:C.warning, icon:Calendar      },
              ].map(s => (
                <div key={s.label} className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-lg shrink-0" style={{ backgroundColor:`${s.color}15` }}>
                    <s.icon className="w-3.5 h-3.5" style={{ color:s.color }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{s.value}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Weighted progress</span>
                <span className="text-[11px] font-bold font-mono" style={{ color:project.color }}>{project.progress}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden bg-muted">
                <motion.div initial={{ width:0 }} animate={{ width:`${project.progress}%` }} transition={{ duration:0.9, ease:"easeOut" }}
                  className="h-full rounded-full" style={{ backgroundColor:project.color }} />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-8 overflow-x-auto px-4 sm:px-6">
            <div className="flex min-w-max items-center border-b border-border" role="tablist" aria-label="Project detail sections">
              {TABS.map(t => (
                <button key={t} onClick={() => handleTabChange(t)} role="tab"
                  id={`project-tab-${t.toLowerCase()}`} aria-selected={tab === t}
                  aria-controls="project-tab-panel" tabIndex={tab === t ? 0 : -1}
                  onKeyDown={(event) => handleTabKeyDown(event, t)}
                  className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${tab===t?"text-foreground":"text-muted-foreground hover:text-foreground"}`}>
                  {t}
                  {tab===t && <motion.div layoutId="proj-tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor:project.color }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div id="project-tab-panel" role="tabpanel" aria-labelledby={`project-tab-${tab.toLowerCase()}`}
            className="px-4 py-7 sm:px-6">

              {/* ─── PROJECT SHEET ─── */}
              {tab === "Project Sheet" && (
                <ProjectSheetPanel
                  project={project}
                  milestones={milestones}
                  milestoneGroups={milestoneGroups}
                  teamMembers={teamMembers}
                  onOpenTasks={() => handleTabChange("Tasks")}
                  onOpenTeam={() => handleTabChange("Team")}
                  onOpenTask={(task) => taskDetailRouter.push(`/tasks/${encodeURIComponent(task.id)}`)}
                />
              )}

              {tab === "Issues" && (
                <ProjectIssuesPanel
                  risks={riskRegistry}
                  teamMembers={teamMembers}
                  onCreate={handleCreateProjectRisk}
                />
              )}

              {/* ─── OVERVIEW ─── */}
              {tab === "Overview" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                  <div className="space-y-5 xl:col-span-2">
                    {/* Milestones */}
                    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold text-foreground">Milestones</h3>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {milestones.filter(m=>m.status==="done").length}/{milestones.length}
                          </span>
                        </div>
                        <motion.button whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                          onClick={() => setShowMilestoneModal(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm"
                          style={{ backgroundColor:project.color }}>
                          <Plus className="w-3.5 h-3.5" /> Add Milestone
                        </motion.button>
                      </div>
                      <div className="p-5 space-y-0">
                        {milestones.length > 0 ? (
                          milestones.map((m, i) => (
                            <div key={m.id} className="relative">
                              {i < milestones.length - 1 && <div className="absolute left-4 top-9 w-px h-4 bg-border z-0" />}
                              <div className="relative z-10 mb-3">
                                <MilestoneRow milestone={m} isNext={i===nextMilestoneIdx} members={teamMembers} />
                              </div>
                            </div>
                          ))
                        ) : (
                          <ProjectEmptyState
                            icon={Target}
                            title="No milestones yet"
                            description="This project has no synced delivery plan yet. Add a milestone when the scope is ready to track."
                            actionLabel="Add Milestone"
                            onAction={() => setShowMilestoneModal(true)}
                            accentColor={project.color}
                          />
                        )}
                      </div>
                    </div>

                    {/* Budget */}
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Budget Overview</h3>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        {[
                          { label:"Total Budget", value:<MoneyAmount value={project.budget} />, color:C.blue },
                          { label:"Spent",         value:<MoneyAmount value={project.spent} />,  color:budgetPct>90?C.danger:C.warning },
                          { label:"Remaining",     value:<MoneyAmount value={(project.budget-project.spent)} />, color:C.success },
                        ].map(b => (
                          <div key={b.label} className="text-center p-3 rounded-xl border border-border bg-muted/30">
                            <p className="text-xl font-bold font-mono" style={{ color:b.color }}>{b.value}</p>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{b.label}</p>
                          </div>
                        ))}
                      </div>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <motion.div initial={{ width:0 }} animate={{ width:`${budgetPct}%` }} transition={{ duration:0.8 }}
                          className="h-full rounded-full" style={{ backgroundColor:budgetPct>90?C.danger:C.blue }} />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-muted-foreground"><MoneyAmount value={0} /></span>
                        <span className="text-[10px] font-semibold" style={{ color:budgetPct>90?C.danger:C.slate }}>{budgetPct}% utilized</span>
                        <span className="text-[10px] text-muted-foreground"><MoneyAmount value={project.budget} /></span>
                      </div>
                    </div>

                    {/* Activity */}
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h3>
                        <button onClick={() => handleTabChange("Activity")} className="text-xs font-medium hover:underline" style={{ color:project.color }}>View all</button>
                      </div>
                      <div className="space-y-3">
                        {projectActivityFeed.length > 0 ? (
                          projectActivityFeed.slice(0, 4).map(item => (
                            <div key={item.id} className="flex items-start gap-3">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor:`${item.color}15` }}>
                                <item.icon className="w-3.5 h-3.5" style={{ color:item.color }} />
                              </div>
                              <div>
                                <p className="text-xs text-foreground leading-relaxed">
                                  {item.text}{" "}{item.target && <span className="font-semibold" style={{ color:project.color }}>{item.target}</span>}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{item.time}{item.badge ? ` · ${item.badge}` : ""}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                            <Activity className="mx-auto mb-2 h-4 w-4 text-muted-foreground" />
                            <p className="text-xs font-semibold text-foreground">No activity yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">Project decisions and updates will appear here after work starts.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right col */}
                  <div className="space-y-6">
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4.5">Task Status</h3>
                      <div className="space-y-4">
                        {[
                          { label:"Done",        count:allTasks.filter(t=>t.status==="done").length,        color:C.success },
                          { label:"In Progress", count:allTasks.filter(t=>t.status==="in-progress").length, color:C.purple  },
                          { label:"To Do",       count:allTasks.filter(t=>t.status==="todo").length,        color:C.slate   },
                        ].map(s => (
                          <div key={s.label} className="flex items-center gap-3">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor:s.color }} />
                            <span className="text-xs text-foreground flex-1">{s.label}</span>
                            <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width:`${allTasks.length?((s.count/allTasks.length)*100):0}%`, backgroundColor:s.color }} />
                            </div>
                            <span className="text-xs font-mono font-bold text-foreground w-4 text-right">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Team</h3>
                        <button onClick={() => handleTabChange("Team")} className="text-xs font-medium hover:underline" style={{ color:project.color }}>View all</button>
                      </div>
                      <div className="space-y-4">
                        {teamMembers.length > 0 ? (
                          teamMembers.map(m => (
                            <div key={m.initials} className="flex items-center gap-2.5">
                              <div className="relative shrink-0">
                                <TeamMemberAvatar member={m} />
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px] border-card" style={{ backgroundColor:m.status==="active"?C.success:C.warning }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                                <p className="text-[10px] text-muted-foreground">{m.role}</p>
                              </div>
                              <span className="text-[10px] font-mono text-muted-foreground">{m.done}/{m.tasks}</span>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                            <Users className="mx-auto mb-2 h-4 w-4 text-muted-foreground" />
                            <p className="text-xs font-semibold text-foreground">No team members yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">Invite synced workspace users before assigning delivery work.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4.5">Tags</h3>
                      <div className="flex flex-wrap gap-2.5">
                        {project.tags.map(tag => (
                          <span key={tag} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border">{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── DASHBOARD ─── */}
              {tab === "Dashboard" && (() => {
                const priorityBuckets = [
                  { key: "critical", label: "Rất khẩn cấp", color: C.danger },
                  { key: "high", label: "Khẩn cấp", color: C.warning },
                  { key: "medium", label: "Trung bình", color: C.blue },
                  { key: "low", label: "Thấp", color: C.success }
                ] as const;
                const statusBuckets = [
                  { key: "done", label: "Done", color: C.success },
                  { key: "in-progress", label: "In Progress", color: C.blue },
                  { key: "todo", label: "To Do", color: C.slate }
                ] as const;
                const priorityRows = priorityBuckets.map((bucket) => {
                  const tasks = filteredTasks.filter((task) => task.priority === bucket.key);
                  const done = tasks.filter((task) => task.status === "done").length;
                  return {
                    ...bucket,
                    total: tasks.length,
                    done,
                    pct: tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0
                  };
                });
                const statusRows = statusBuckets.map((bucket) => {
                  const total = filteredTasks.filter((task) => task.status === bucket.key).length;
                  return {
                    ...bucket,
                    total,
                    pct: filteredTasks.length > 0 ? Math.round((total / filteredTasks.length) * 100) : 0
                  };
                });
                const priTotal = Math.max(1, priorityRows.reduce((sum, row) => sum + row.total, 0));

                const donutSlices = priorityRows
                  .filter((row) => row.total > 0)
                  .map((row) => ({ value: row.total, color: row.color, label: row.label }));

                let accumulatedDonutPercent = 0;

                const weeklyWorkloadRows = [1, 2, 3, 4, 5].map((week) => {
                  const weekTasks = filteredTasks.filter((task) => task.week === week);
                  const weekDone = weekTasks.filter((task) => task.status === "done").length;
                  const weekPlannedHours = weekTasks.reduce((sum, task) => sum + (task.plannedHours || 0), 0);
                  const weekActualHours = weekTasks
                    .filter((task) => task.status === "done")
                    .reduce((sum, task) => sum + (task.actualHours || 0), 0);
                  const total = weeklyWorkloadType === "tasks" ? weekTasks.length : weekPlannedHours;
                  const done = weeklyWorkloadType === "tasks" ? weekDone : weekActualHours;
                  return {
                    week,
                    total,
                    done,
                    remaining: Math.max(total - done, 0),
                    pct: total > 0 ? Math.round((done / total) * 100) : 0
                  };
                });
                const weeklyMaxValue = Math.max(1, ...weeklyWorkloadRows.flatMap((row) => [row.total, row.done]));
                const teamPerformanceRows = teamMembers
                  .map((member) => {
                    const scopedTasks = filteredTasks.filter((task) => taskMatchesProjectMember(task, member));
                    const allMemberTasks = allTasks.filter((task) => taskMatchesProjectMember(task, member));
                    const completed = scopedTasks.filter((task) => task.status === "done").length;
                    const total = scopedTasks.length;
                    const velocityTotal = allMemberTasks.length;
                    const velocityDone = allMemberTasks.filter((task) => task.status === "done").length;
                    const velocity = velocityTotal > 0 ? Math.round((velocityDone / velocityTotal) * 100) : null;
                    const plannedHours = scopedTasks.reduce((sum, task) => sum + (task.plannedHours || 0), 0);
                    const actualHours = scopedTasks.reduce((sum, task) => sum + (task.actualHours || 0), 0);
                    return {
                      member,
                      total,
                      completed,
                      pct: total > 0 ? Math.round((completed / total) * 100) : 0,
                      velocity,
                      plannedHours,
                      actualHours,
                      state: velocity === null ? "Chưa có task" : velocity >= 75 ? "Năng động" : "Cân bằng"
                    };
                  })
                  .sort((a, b) => (b.total - a.total) || (b.actualHours - a.actualHours) || a.member.name.localeCompare(b.member.name));
                const activePerformanceRows = teamPerformanceRows.filter((row) => row.total > 0 || row.actualHours > 0 || row.plannedHours > 0);
                const visiblePerformanceRows = (activePerformanceRows.length > 0 ? activePerformanceRows : teamPerformanceRows).slice(0, 6);
                const capacitySummary = {
                  active: teamPerformanceRows.filter((row) => row.state === "Năng động").length,
                  protect: teamPerformanceRows.filter((row) => row.state === "Cân bằng").length,
                  idle: teamPerformanceRows.filter((row) => row.state === "Chưa có task").length
                };

                return (
                  <div className="space-y-6">
                    {/* Filter Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
                      <div className="flex flex-wrap items-center gap-3.5">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Mức độ ưu tiên</span>
                          <CustomDropdown
                            options={[
                              { value: "All", label: "Tất cả mức độ" },
                              { value: "High", label: "Khẩn cấp & Rất khẩn cấp" },
                              { value: "Medium", label: "Trung bình" },
                              { value: "Low", label: "Thấp" }
                            ]}
                            value={priorityFilter}
                            onChange={setPriorityFilter}
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Nhân sự thực hiện</span>
                          <CustomDropdown
                            options={[
                              { value: "All", label: "Tất cả thành viên" },
                              ...Array.from(new Set(allTasks.map(t => t.assignee))).map(assignee => {
                                const m = teamMembers.find(tm => tm.initials === assignee);
                                return {
                                  value: assignee,
                                  label: m ? m.name : assignee
                                };
                              })
                            ]}
                            value={memberFilter}
                            onChange={setMemberFilter}
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Giai đoạn dự án</span>
                          <CustomDropdown
                            options={[
                              { value: "All", label: "Tất cả giai đoạn" },
                              ...milestones.map(m => ({
                                value: m.id,
                                label: m.name
                              }))
                            ]}
                            value={milestoneFilter}
                            onChange={setMilestoneFilter}
                          />
                        </div>
                      </div>
                      {/* Clear Filters CTA */}
                      {(priorityFilter !== "All" || memberFilter !== "All" || milestoneFilter !== "All") && (
                        <button
                          onClick={() => {
                            setPriorityFilter("All");
                            setMemberFilter("All");
                            setMilestoneFilter("All");
                          }}
                          className="text-xs font-semibold hover:underline flex items-center gap-1"
                          style={{ color: project.color }}
                        >
                          <X className="w-3.5 h-3.5" /> Xóa bộ lọc
                        </button>
                      )}
                    </div>

                    {/* Top Stats Cards */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-muted-foreground">Giờ kế hoạch</span><Calendar className="h-4 w-4 text-blue-600" /></div>
                        <p className="text-2xl font-black font-mono tracking-tight text-foreground">{formatHours(sumHours(filteredTasks.map((task) => task.plannedHours || 0)))}h</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Tổng estimate của bộ lọc</p>
                      </div>
                      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-muted-foreground">Giờ thực tế</span><Clock className="h-4 w-4 text-purple-600" /></div>
                        <p className="text-2xl font-black font-mono tracking-tight text-foreground">{formatHours(sumHours(filteredTasks.map((task) => task.actualHours || 0)))}h</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Tổng giờ đã ghi nhận</p>
                      </div>

                      {/* Filtered Completion Progress */}
                      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-muted-foreground">Công việc hoàn thành</span>
                          <span className="text-[10px] font-mono font-bold text-foreground">
                            {filteredTasks.filter(t => t.status === "done").length}/{filteredTasks.length}
                          </span>
                        </div>
                        <p className="text-2xl font-black font-mono tracking-tight text-foreground">{filteredProgress}%</p>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                          <div className="h-full rounded-full" style={{ width: `${filteredProgress}%`, backgroundColor: project.color }} />
                        </div>
                      </div>

                      {/* Issues */}
                      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-muted-foreground">Vấn đề đang mở</span>
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        </div>
                        <p className="text-2xl font-black font-mono tracking-tight text-foreground">{riskRegistry.filter((risk) => !["resolved", "closed", "done"].includes(risk.status.toLowerCase())).length}</p>
                        <button type="button" onClick={() => handleTabChange("Issues")} className="mt-1 text-[10px] font-semibold text-primary hover:underline">Mở sổ theo dõi →</button>
                      </div>
                    </div>

                    {/* Weekly Workload & Milestone Hours Details */}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                      {/* Left: Weekly Workload (Tasks vs. Hours) */}
                      <div className="xl:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Khối lượng & Hoàn thành theo tuần</h3>
                          <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-muted border border-border">
                            <button
                              onClick={() => setWeeklyWorkloadType("tasks")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                                weeklyWorkloadType === "tasks" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Số công việc
                            </button>
                            <button
                              onClick={() => setWeeklyWorkloadType("hours")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                                weeklyWorkloadType === "hours" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Số giờ làm
                            </button>
                          </div>
                        </div>

                        {/* Chart Grid representing Week 1 -> Week 5 */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-5 gap-3 pt-2">
                          {weeklyWorkloadRows.map(row => {
                            return (
                              <div key={row.week} className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-muted/10 hover:bg-muted/20 transition-all relative group">
                                <span className="text-[10px] font-bold text-muted-foreground">Tuần {row.week}</span>

                                {/* Vertical Stacked Bar Chart */}
                                <div className="w-10 h-24 bg-muted rounded-lg overflow-hidden flex flex-col justify-end border border-border/50 relative">
                                  {/* Total Workload Bar */}
                                  <div
                                    className="w-full bg-slate-400/20 absolute bottom-0 left-0 transition-all duration-500"
                                    style={{ height: `${Math.min(100, (row.total / weeklyMaxValue) * 100)}%` }}
                                  />
                                  {/* Completed Bar */}
                                  <div
                                    className="w-full rounded-b-md transition-all duration-500"
                                    style={{
                                      height: `${Math.min(100, (row.done / weeklyMaxValue) * 100)}%`,
                                      backgroundColor: project.color
                                    }}
                                  />
                                </div>

                                {/* Floating Tooltip Card */}
                                <div className="pointer-events-none absolute bottom-full mb-3 left-1/2 transform -translate-x-1/2 w-56 bg-slate-900/95 text-white border border-slate-700/50 shadow-xl rounded-xl p-3 z-30 opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100 transition-all duration-200 flex flex-col gap-1.5 text-[10px] leading-relaxed">
                                  {/* Arrow indicator */}
                                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-slate-900/95" />

                                  <p className="font-extrabold text-xs text-white pb-1 border-b border-slate-700/40">Tuần {row.week} - Chi tiết</p>
                                  <p className="text-slate-300 font-medium flex items-center gap-1">
                                    <span>Date</span> {getWeekDateRange(project.startDate, row.week)}
                                  </p>

                                  <div className="flex justify-between items-center mt-1">
                                    <span className="text-slate-400 font-semibold">Khối lượng kế hoạch:</span>
                                    <span className="font-black font-mono">{row.total} {weeklyWorkloadType === "tasks" ? "việc" : "h"}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-400 font-semibold">Đã hoàn thành:</span>
                                    <span className="font-black font-mono text-emerald-400">{row.done} {weeklyWorkloadType === "tasks" ? "việc" : "h"} ({row.pct}%)</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-400 font-semibold">Chưa hoàn thành:</span>
                                    <span className="font-black font-mono text-amber-400">{row.remaining} {weeklyWorkloadType === "tasks" ? "việc" : "h"}</span>
                                  </div>
                                </div>

                                <div className="text-center mt-1">
                                  <p className="text-xs font-black font-mono leading-none text-foreground">{row.pct}%</p>
                                  <p className="text-[9px] text-muted-foreground mt-0.5 font-semibold">hoàn thành</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: Milestone Planning Hours vs. Actual Hours (with Stage selection filter) */}
                      <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Số giờ Kế hoạch vs. Thực tế theo mốc</h3>

                        {/* Hour Filters */}
                        <div className="grid grid-cols-2 gap-2 mb-4">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Mốc sự kiện</span>
                            <CustomDropdown
                              options={[
                                { value: "All", label: "Tất cả mốc" },
                                ...milestones.map(m => ({ value: m.id, label: m.name }))
                              ]}
                              value={hoursMilestoneFilter}
                              onChange={setHoursMilestoneFilter}
                            />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase mb-1">Giai đoạn con</span>
                            <CustomDropdown
                              options={[
                                { value: "All", label: "Tất cả giai đoạn" },
                                ...(hoursMilestoneFilter === "All"
                                  ? []
                                  : (() => {
                                    const milestone = milestones.find(m => m.id === hoursMilestoneFilter);
                                    const group = milestoneGroups.find(mg => mg.milestoneId === hoursMilestoneFilter);
                                    return milestone && group
                                      ? visibleStagesForMilestone(group, milestone).map(st => ({ value: st.id, label: st.name }))
                                      : [];
                                  })()
                                )
                              ]}
                              value={hoursStageFilter}
                              onChange={setHoursStageFilter}
                              placeholder={hoursMilestoneFilter === "All" ? "Chọn mốc trước" : "Chọn giai đoạn"}
                            />
                          </div>
                        </div>

                        {/* Calculated Hour Stats */}
                        {(() => {
                          const hourTasks = allTasks.filter(t => {
                            if (hoursMilestoneFilter !== "All" && t.milestoneId !== hoursMilestoneFilter) return false;
                            if (hoursStageFilter !== "All" && t.stageId !== hoursStageFilter) return false;
                            return true;
                          });

                          const totalPlanned = hourTasks.reduce((sum, t) => sum + (t.plannedHours || 0), 0);
                          const totalActual = hourTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);
                          const limitPlanned = totalPlanned || 1;
                          const ratio = Math.round((totalActual / limitPlanned) * 100);

                          return (
                            <div className="flex-1 flex flex-col justify-between gap-4">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-muted/40 rounded-xl border border-border text-center">
                                  <p className="text-sm text-muted-foreground font-semibold">Giờ kế hoạch</p>
                                  <p className="text-xl font-mono font-black text-foreground mt-1">{totalPlanned}h</p>
                                </div>
                                <div className="p-3 bg-muted/40 rounded-xl border border-border text-center">
                                  <p className="text-sm text-muted-foreground font-semibold">Giờ thực tế</p>
                                  <p className="text-xl font-mono font-black text-foreground mt-1" style={{ color: totalActual > totalPlanned ? C.danger : C.success }}>{totalActual}h</p>
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
                                  <span>Tiến độ tiêu hao giờ</span>
                                  <span style={{ color: totalActual > totalPlanned ? C.danger : C.success }}>{ratio}% định mức</span>
                                </div>
                                <div className="h-2.5 bg-muted rounded-full overflow-hidden border border-border/50 relative">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, ratio)}%` }}
                                    transition={{ duration: 0.8 }}
                                    className="h-full rounded-full"
                                    style={{ backgroundColor: totalActual > totalPlanned ? C.danger : project.color }}
                                  />
                                </div>
                                <p className="text-[9px] text-muted-foreground italic text-center">
                                  {totalActual > totalPlanned ? "Thực tế vượt kế hoạch dự tính" : "Tiêu hao giờ trong tầm kiểm soát"}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Chart visualizers container */}
                    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
                      {/* Left Block: Pie Donut Chart & Line Chart */}
                      <div className="space-y-5">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                          {/* Pie/Donut Chart */}
                          <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Cơ cấu mức độ ưu tiên</h3>
                            <div className="flex items-center gap-5 justify-center flex-1 py-2">
                              <svg className="w-28 h-28 transform -rotate-90 shrink-0" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="35" fill="transparent" stroke="var(--color-border)" strokeWidth="12" />
                                {donutSlices.map((slice, sIdx) => {
                                  const slicePercent = (slice.value / priTotal) * 220;
                                  const strokeOffset = 220 - (accumulatedDonutPercent * 220);
                                  accumulatedDonutPercent += slice.value / priTotal;
                                  return (
                                    <circle
                                      key={sIdx}
                                      cx="50"
                                      cy="50"
                                      r="35"
                                      fill="transparent"
                                      stroke={slice.color}
                                      strokeWidth="12"
                                      strokeDasharray="220"
                                      strokeDashoffset={strokeOffset}
                                      className="transition-all duration-500"
                                    />
                                  );
                                })}
                              </svg>
                              <div className="flex flex-col gap-2 text-xs">
                                {donutSlices.map((slice, sIdx) => (
                                  <div key={sIdx} className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                                    <span className="text-muted-foreground">{slice.label}:</span>
                                    <span className="font-bold text-foreground font-mono">{slice.value} ({Math.round((slice.value / priTotal) * 100)}%)</span>
                                  </div>
                                ))}
                                {donutSlices.length === 0 && <span className="text-muted-foreground italic text-xs">Không có dữ liệu</span>}
                              </div>
                            </div>
                          </div>

                          {/* Status Mix */}
                          <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cơ cấu trạng thái task</h3>
                              <span className="text-[10px] font-bold font-mono text-muted-foreground">{filteredTasks.length} task</span>
                            </div>
                            <div className="space-y-3">
                              {statusRows.map((row) => (
                                <div key={row.key} className="space-y-1.5">
                                  <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="font-semibold text-foreground">{row.label}</span>
                                    <span className="font-mono font-bold text-muted-foreground">{row.total} ({row.pct}%)</span>
                                  </div>
                                  <div className="h-2 rounded-full bg-muted border border-border/50 overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${row.pct}%`, backgroundColor: row.color }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Priority workload rows */}
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Độ ưu tiên vs. hoàn thành</h3>
                            <span className="text-[10px] font-bold font-mono text-muted-foreground">{filteredTasks.length} task trong bộ lọc</span>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {priorityRows.map((row) => (
                              <div key={row.key} className="rounded-xl border border-border bg-muted/10 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-foreground">{row.label}</span>
                                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                                </div>
                                <div className="mt-3 flex items-end justify-between gap-3">
                                  <div>
                                    <p className="font-mono text-lg font-black text-foreground">{row.total}</p>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">task</p>
                                  </div>
                                  <p className="font-mono text-xs font-bold text-muted-foreground">{row.done}/{row.total} done</p>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full" style={{ width: `${row.pct}%`, backgroundColor: row.color }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Risk Table (Table View) */}
                        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
                          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-muted/20">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nhật ký Rủi ro & Giải pháp ứng phó</h3>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                              {riskRegistry.length} sự cố được giám sát
                            </span>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-border bg-muted/10 text-[9px] uppercase font-bold text-muted-foreground">
                                  <th className="px-4 py-2.5">Phân loại</th>
                                  <th className="px-4 py-2.5">Nội dung rủi ro</th>
                                  <th className="px-4 py-2.5 text-center">Khả năng</th>
                                  <th className="px-4 py-2.5 text-center">Tác động</th>
                                  <th className="px-4 py-2.5">Phương án xử lý</th>
                                  <th className="px-4 py-2.5">Chuyển trạng thái</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border text-xs text-foreground">
                                {riskRegistry.filter(r => {
                                  if (memberFilter !== "All" && r.owner !== memberFilter && r.owner !== "PMO") return false;
                                  return true;
                                }).map(risk => (
                                  <tr key={risk.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-2.5 font-semibold">
                                      <span className="px-2 py-0.5 rounded text-[9px] font-bold"
                                        style={{
                                          backgroundColor:
                                            risk.category === "Financial" ? `${C.danger}12` :
                                            risk.category === "Operational" ? `${C.purple}12` :
                                            risk.category === "External" ? `${C.warning}12` : `${C.info}12`,
                                          color:
                                            risk.category === "Financial" ? C.danger :
                                            risk.category === "Operational" ? C.purple :
                                            risk.category === "External" ? C.warning : C.info
                                        }}
                                      >
                                        {risk.category === "Financial" ? "Tài chính" :
                                         risk.category === "Operational" ? "Vận hành" :
                                         risk.category === "External" ? "Đối ngoại" : "Chiến lược"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-muted-foreground max-w-[180px] break-words">{risk.description}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        risk.likelihood === "High" ? "bg-red-500/10 text-red-600" :
                                        risk.likelihood === "Medium" ? "bg-amber-500/10 text-amber-600" : "bg-slate-500/10 text-slate-600"
                                      }`}>
                                        {risk.likelihood === "High" ? "Cao" : risk.likelihood === "Medium" ? "Vừa" : "Thấp"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        risk.impact === "High" ? "bg-red-500/10 text-red-600" :
                                        risk.impact === "Medium" ? "bg-amber-500/10 text-amber-600" : "bg-slate-500/10 text-slate-600"
                                      }`}>
                                        {risk.impact === "High" ? "Cao" : risk.impact === "Medium" ? "Vừa" : "Thấp"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 font-medium text-foreground">
                                      {risk.response === "Mitigate" ? "Giảm thiểu" :
                                       risk.response === "Avoid" ? "Tránh rủi ro" :
                                       risk.response === "Transfer" ? "Chuyển giao" : "Chấp nhận"}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <span className="font-mono text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                                        {risk.switch}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      {/* Right Block: Bar Chart & Team performance list */}
                      <div className="space-y-5">
                        {/* Bar Chart completions per member */}
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hiệu suất nhân sự</h3>
                            <span className="text-[10px] font-bold text-muted-foreground">{visiblePerformanceRows.length}/{teamMembers.length}</span>
                          </div>
                          <div className="space-y-3.5">
                            {visiblePerformanceRows.map(row => (
                              <div key={projectMemberIdentity(row.member)} className="space-y-1">
                                <div className="flex justify-between gap-3 text-[11px] font-medium">
                                  <span className="truncate text-foreground">{row.member.name}</span>
                                  <span className="shrink-0 text-muted-foreground font-mono">{row.completed}/{row.total} ({row.pct}%)</span>
                                </div>
                                <div className="h-3 bg-muted rounded-md overflow-hidden relative border border-border/50">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${row.pct}%` }}
                                    transition={{ duration: 0.8 }}
                                    className="h-full rounded-md"
                                    style={{ backgroundColor: row.member.color }}
                                  />
                                </div>
                              </div>
                            ))}
                            {visiblePerformanceRows.length === 0 && (
                              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center">
                                <p className="text-xs font-semibold text-muted-foreground">Chưa có dữ liệu task cho bộ lọc hiện tại.</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Team Performance State Grid */}
                        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
                          <div className="px-5 py-3.5 border-b border-border bg-muted/20">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trạng thái năng lực nhân sự</h3>
                              <button
                                type="button"
                                onClick={() => handleTabChange("Team")}
                                className="text-[10px] font-bold hover:underline"
                                style={{ color: project.color }}
                              >
                                Xem Team
                              </button>
                            </div>
                          </div>

                          <div className="p-5 space-y-4">
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { label: "Năng động", value: capacitySummary.active, tone: "text-emerald-600" },
                                { label: "Cân bằng", value: capacitySummary.protect, tone: "text-slate-600" },
                                { label: "Chưa có task", value: capacitySummary.idle, tone: "text-muted-foreground" }
                              ].map(item => (
                                <div key={item.label} className="rounded-xl border border-border bg-muted/20 p-2 text-center">
                                  <p className={`font-mono text-lg font-black ${item.tone}`}>{item.value}</p>
                                  <p className="mt-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{item.label}</p>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-2" data-testid="project-dashboard-capacity-summary">
                              {visiblePerformanceRows.slice(0, 4).map(row => (
                                <div key={projectMemberIdentity(row.member)} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-muted/10">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <TeamMemberAvatar member={row.member} size="sm" />
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-semibold text-foreground">{row.member.name}</p>
                                      <p className="text-[10px] font-mono text-muted-foreground">
                                        {formatHours(row.actualHours)}h actual / {formatHours(row.plannedHours)}h plan
                                      </p>
                                    </div>
                                  </div>
                                  <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                    row.state === "Năng động" ? "bg-emerald-500/10 text-emerald-600" :
                                    row.state === "Cân bằng" ? "bg-slate-500/10 text-slate-600" : "bg-muted text-muted-foreground"
                                  }`}>
                                    {row.velocity === null ? row.state : `${row.state} ${row.velocity}%`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}              {/* ─── TASKS (Milestone → Stage → Task) ─── */}
              {tab === "Tasks" && (
                <div>
                  <p className="sr-only" role="status" aria-live="polite">{hierarchyAnnouncement}</p>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-sm font-bold text-foreground">Task Board</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Grouped by Milestone <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> Stage · {allTasks.length} tasks total
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
                        onClick={() => setShowMilestoneModal(true)}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
                        <Target className="w-4 h-4" /> Add Milestone
                      </motion.button>
                    </div>
                  </div>

                  {/* Milestone groups */}
                  {milestones.length > 0 ? (
                    <div className="flex flex-col gap-5">
                      {milestones.some(item => !isUnassignedTasksMilestoneId(item.id)) ? (
                        canReorderHierarchy ? (
                        <HierarchySortableList
                          ids={milestones.filter(item => !isUnassignedTasksMilestoneId(item.id)).map(item => item.id)}
                          hierarchyKind="milestone"
                          disabled={hierarchyBusy}
                          label="Milestones của dự án"
                          listClassName="flex flex-col gap-5"
                          getItemLabel={(id) => milestones.find(item => item.id === id)?.name ?? id}
                          onReorder={(ids) => void handleHierarchyReorder("milestone", null, ids)}
                          renderItem={(milestoneId, milestoneHandle) => {
                            const milestone = milestones.find(item => item.id === milestoneId);
                            if (!milestone) return null;
                            const group = milestoneGroups.find(g => g.milestoneId === milestone.id) ?? { milestoneId:milestone.id, stages:[] };
                            return (
                              <MilestoneSectionTasks
                                milestone={milestone}
                                group={group}
                                projectColor={project.color}
                                onAddStage={(id, name) => setAddStageFor({ id, name })}
                                onAddTask={(id, stageId, stageName) => setAddTaskFor({ milestoneId:id, stageId, stageName })}
                                onEditTask={(id, stageId, task) => setEditTaskFor({ milestoneId:id, stageId, task })}
                                onDeleteTask={(id, stageId, taskId) => {
                                  const task = milestoneGroups.find(mg => mg.milestoneId === id)?.stages
                                    .find(s => s.id === stageId)?.tasks.find(t => t.id === taskId);
                                  setMutationError(null);
                                  setDeleteTaskFor({ milestoneId:id, stageId, taskId, title:task?.title ?? "" });
                                }}
                                onEditStage={(stage) => setEditStageFor({ milestoneId: milestone.id, stage })}
                                onDeleteStage={(id, stageId, stageName) => {
                                  setMutationError(null);
                                  setDeleteStageFor({ milestoneId:id, stageId, stageName });
                                }}
                                onViewTaskDetails={(task) => taskDetailRouter.push(`/tasks/${encodeURIComponent(task.id)}`)}
                                onEditMilestone={setEditMilestoneFor}
                                onDeleteMilestone={(id) => {
                                  const target = milestones.find(item => item.id === id);
                                  if (target) setDeleteMilestoneFor(target);
                                }}
                                onReorderStages={(id, ids) => void handleHierarchyReorder("stage", id, ids)}
                                onReorderTasks={(_id, stageId, ids) => void handleHierarchyReorder("task", stageId, ids)}
                                sortHandle={milestoneHandle}
                                hierarchyBusy={hierarchyBusy}
                                members={teamMembers}
                              />
                            );
                          }}
                        />
                      ) : (
                        <HierarchyStaticList
                          ids={milestones.filter(item => !isUnassignedTasksMilestoneId(item.id)).map(item => item.id)}
                          hierarchyKind="milestone"
                          label="Milestones của dự án"
                          listClassName="flex flex-col gap-5"
                          renderItem={(milestoneId) => {
                            const milestone = milestones.find(item => item.id === milestoneId);
                            if (!milestone) return null;
                            const group = milestoneGroups.find(g => g.milestoneId === milestone.id) ?? { milestoneId: milestone.id, stages: [] };
                            return (
                              <MilestoneSectionTasks
                                milestone={milestone}
                                group={group}
                                projectColor={project.color}
                                onAddStage={(id, name) => setAddStageFor({ id, name })}
                                onAddTask={(id, stageId, stageName) => setAddTaskFor({ milestoneId:id, stageId, stageName })}
                                onEditTask={(id, stageId, task) => setEditTaskFor({ milestoneId:id, stageId, task })}
                                onDeleteTask={(id, stageId, taskId) => setDeleteTaskFor({ milestoneId:id, stageId, taskId, title:"" })}
                                onEditStage={(stage) => setEditStageFor({ milestoneId: milestone.id, stage })}
                                onDeleteStage={(id, stageId, stageName) => setDeleteStageFor({ milestoneId:id, stageId, stageName })}
                                onViewTaskDetails={(task) => taskDetailRouter.push(`/tasks/${encodeURIComponent(task.id)}`)}
                                onEditMilestone={setEditMilestoneFor}
                                onDeleteMilestone={(id) => {
                                  const target = milestones.find(item => item.id === id);
                                  if (target) setDeleteMilestoneFor(target);
                                }}
                                onReorderStages={() => undefined}
                                onReorderTasks={() => undefined}
                                members={teamMembers}
                              />
                            );
                          }}
                        />
                        )
                      ) : null}
                      {milestones.some(item => isUnassignedTasksMilestoneId(item.id)) ? (
                        <HierarchyStaticList
                          ids={milestones.filter(item => isUnassignedTasksMilestoneId(item.id)).map(item => item.id)}
                          hierarchyKind="milestone"
                          label="Milestones chưa được phân loại của dự án"
                          listClassName="flex flex-col gap-5"
                          renderItem={(milestoneId) => {
                            const milestone = milestones.find(item => item.id === milestoneId);
                            if (!milestone) return null;
                            const group = milestoneGroups.find(g => g.milestoneId === milestone.id) ?? { milestoneId:milestone.id, stages:[] };
                            return (
                              <MilestoneSectionTasks
                                milestone={milestone}
                                group={group}
                                projectColor={project.color}
                                onAddStage={(id, name) => setAddStageFor({ id, name })}
                                onAddTask={(id, stageId, stageName) => setAddTaskFor({ milestoneId:id, stageId, stageName })}
                                onEditTask={(id, stageId, task) => setEditTaskFor({ milestoneId:id, stageId, task })}
                                onDeleteTask={(id, stageId, taskId) => {
                                  const task = milestoneGroups
                                    .find(mg => mg.milestoneId === id)?.stages
                                    .find(s => s.id === stageId)?.tasks
                                    .find(t => t.id === taskId);
                                  setMutationError(null);
                                  setDeleteTaskFor({ milestoneId:id, stageId, taskId, title: task?.title ?? "" });
                                }}
                                onEditStage={(stage) => setEditStageFor({ milestoneId: milestone.id, stage })}
                                onDeleteStage={(id, stageId, stageName) => {
                                  setMutationError(null);
                                  setDeleteStageFor({ milestoneId:id, stageId, stageName });
                                }}
                                onViewTaskDetails={(task) => taskDetailRouter.push(`/tasks/${encodeURIComponent(task.id)}`)}
                                onEditMilestone={setEditMilestoneFor}
                                onDeleteMilestone={(id) => {
                                  const target = milestones.find(item => item.id === id);
                                  if (target) {
                                    setMutationError(null);
                                    setDeleteMilestoneFor(target);
                                  }
                                }}
                                onReorderStages={() => undefined}
                                onReorderTasks={() => undefined}
                                members={teamMembers}
                              />
                            );
                          }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <ProjectEmptyState
                      icon={ListChecks}
                      title="No tasks yet"
                      description="This project does not have synced milestones, stages, or tasks yet. Add a milestone to start the delivery board."
                      actionLabel="Add Milestone"
                      onAction={() => setShowMilestoneModal(true)}
                      accentColor={project.color}
                    />
                  )}
                </div>
              )}

              {/* ─── TIMELINE (Milestone → Stage Gantt Chart) ─── */}
              {tab === "Timeline" && (() => {
                const timelineAnchor = new Date();
                const baseMonth = new Date(timelineAnchor.getFullYear(), timelineAnchor.getMonth(), 1);
                const weekBase = new Date(timelineAnchor);
                weekBase.setHours(0, 0, 0, 0);

                const viewStartDate = timelineScale === "month"
                  ? new Date(baseMonth.getFullYear(), baseMonth.getMonth() + timelineStartIdx, 1)
                  : new Date(weekBase.getFullYear(), weekBase.getMonth(), weekBase.getDate() + timelineStartIdx * 7);

                const viewEndDate = timelineScale === "month"
                  ? new Date(baseMonth.getFullYear(), baseMonth.getMonth() + timelineStartIdx + 6, 0, 23, 59, 59)
                  : new Date(viewStartDate.getFullYear(), viewStartDate.getMonth(), viewStartDate.getDate() + 6 * 7, 23, 59, 59);

                const totalMs = viewEndDate.getTime() - viewStartDate.getTime();

                // Dynamic Column Headers (6 columns)
                const headers = Array.from({ length: 6 }).map((_, i) => {
                  if (timelineScale === "month") {
                    const d = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + timelineStartIdx + i, 1);
                    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    return `${monthsShort[d.getMonth()]} '${d.getFullYear().toString().slice(-2)}`;
                  } else {
                    const start = new Date(weekBase.getFullYear(), weekBase.getMonth(), weekBase.getDate() + (timelineStartIdx + i) * 7);
                    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
                    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const pad = (n: number) => n.toString().padStart(2, "0");
                    return `${pad(start.getDate())} ${monthsShort[start.getMonth()]} - ${pad(end.getDate())} ${monthsShort[end.getMonth()]}`;
                  }
                });

                // Dynamic TODAY Indicator positioning
                const today = new Date();
                const todayVisible = today >= viewStartDate && today <= viewEndDate;
                const todayLeft = todayVisible ? ((today.getTime() - viewStartDate.getTime()) / totalMs) * 100 : 0;

                return (
                  <div>
                    {/* Header & Controls Panel */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5 bg-card border border-border p-4 rounded-xl shadow-2xs">
                      <div>
                        <h2 className="text-sm font-bold text-foreground">Project Timeline (Gantt)</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Visualizing milestones & stages · {timelineScale === "month" ? "Month View" : "Week View"}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        {/* Navigation Controls */}
                        <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/60">
                          <button
                            onClick={() => setTimelineStartIdx(prev => prev - 1)}
                            className="p-1.5 rounded-md hover:bg-card text-muted-foreground hover:text-foreground transition-all"
                            title="Previous"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setTimelineStartIdx(0);
                            }}
                            className="px-2.5 py-1 text-[10px] font-bold rounded-md hover:bg-card text-muted-foreground hover:text-foreground transition-all"
                          >
                            Today
                          </button>
                          <button
                            onClick={() => setTimelineStartIdx(prev => prev + 1)}
                            className="p-1.5 rounded-md hover:bg-card text-muted-foreground hover:text-foreground transition-all"
                            title="Next"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Week / Month Selector Toggle */}
                        <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/60">
                          <button
                            onClick={() => setTimelineScale("week")}
                            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                              timelineScale === "week"
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Week
                          </button>
                          <button
                            onClick={() => setTimelineScale("month")}
                            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                              timelineScale === "month"
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Month
                          </button>
                        </div>
                      </div>
                    </div>

                    {milestones.length === 0 ? (
                      <ProjectEmptyState
                        icon={Calendar}
                        title="No timeline yet"
                        description="The timeline will appear after this project has milestones and stages with delivery dates."
                        actionLabel="Add Milestone"
                        onAction={() => setShowMilestoneModal(true)}
                        accentColor={project.color}
                      />
                    ) : (
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm overflow-x-auto">
                      <div className="min-w-[850px] relative">
                        {/* Grid Calendar Header */}
                        <div className="flex border-b border-border pb-3 mb-4">
                          <div className="w-80 shrink-0 font-bold text-xs uppercase tracking-wider text-muted-foreground">Milestones & Stages</div>
                          <div className="flex-1 grid grid-cols-6 gap-1 text-center font-bold text-[10px] text-muted-foreground">
                            {headers.map((h, i) => (
                              <div key={i} className="py-1 bg-muted/40 rounded-lg truncate px-1" title={h}>{h}</div>
                            ))}
                          </div>
                        </div>

	                        {/* Timeline Rows */}
	                        <div className="relative space-y-4">
	                          {/* Red Today Line Indicator */}
	                          {todayVisible && (
	                            <div className="absolute top-0 bottom-0 left-80 right-0 z-20 pointer-events-none">
	                              <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/80 transition-all duration-300" style={{ left: `${todayLeft}%` }}>
	                                <div className="absolute top-0 -translate-x-1/2 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">TODAY</div>
	                              </div>
	                            </div>
	                          )}

                          {milestones.map(milestone => {
                            const group = milestoneGroups.find(g => g.milestoneId === milestone.id) ?? { milestoneId: milestone.id, stages: [] };
                            const timelineStages = visibleStagesForMilestone(group, milestone);

                            // Milestone date parsing & positioning
                            const sDate = parseUiDate(milestone.startDate);
                            const dDate = parseUiDate(milestone.dueDate);
                            const mVisible = sDate <= viewEndDate && dDate >= viewStartDate;

                            let mLeft = 0;
                            let mWidth = 0;
                            if (mVisible) {
                              const clipStart = sDate < viewStartDate ? viewStartDate : sDate;
                              const clipEnd = dDate > viewEndDate ? viewEndDate : dDate;
                              mLeft = ((clipStart.getTime() - viewStartDate.getTime()) / totalMs) * 100;
                              mWidth = ((clipEnd.getTime() - clipStart.getTime()) / totalMs) * 100;
                            }

                            const mStatus = milestone.status;
                            const milestoneMember = findTeamMember(teamMembers, milestone.pic, milestone.picName, milestone.picUserId);
                            let mBarBg = `${project.color}15`;
                            let mBarBorder = `${project.color}40`;
                            let mBarText = project.color;

                            if (mStatus === "done") {
                              mBarBg = "#22c55e1c";
                              mBarBorder = "#22c55e40";
                              mBarText = "#16a34a";
                            } else if (mStatus === "in-progress") {
                              mBarBg = "#3b82f61c";
                              mBarBorder = "#3b82f640";
                              mBarText = "#2563eb";
                            } else if (mStatus === "upcoming") {
                              mBarBg = "#facc151c";
                              mBarBorder = "#facc1540";
                              mBarText = "#ca8a04";
                            }

                            return (
                              <div key={milestone.id} className="space-y-2 pb-2 border-b border-border/40 last:border-b-0">
                                {/* Milestone Row */}
                                <div className="flex items-center">
                                  <div className="w-80 shrink-0 pr-4 flex items-center gap-2.5">
                                    <ProjectIdentityAvatar
                                      member={milestoneMember}
                                      initials={milestone.pic}
                                      name={milestone.picName}
                                      color={milestone.picColor}
                                      avatarUrl={milestone.picAvatarUrl}
                                      size="sm"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-bold text-foreground" title={milestone.name}>{milestone.name}</p>
                                      <span className="block truncate text-[10px] text-muted-foreground" title={formatProjectDateRange(milestone.startDate, milestone.dueDate, "TBD")}>
                                        {formatProjectDateRange(milestone.startDate, milestone.dueDate, "TBD")}
                                      </span>
                                    </div>
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{milestone.status}</span>
                                  </div>

                                  <div className="flex-1 relative h-8 flex items-center">
                                    {/* Background grid lines */}
                                    <div className="absolute inset-0 grid grid-cols-6 gap-0 pointer-events-none">
                                      {Array.from({ length: 6 }).map((_, idx) => (
                                        <div key={idx} className="h-full border-l border-dashed border-border/40 first:border-l-0" />
                                      ))}
                                    </div>

                                    {/* Milestone Gantt Bar */}
                                    {mVisible && (
                                      <div className="absolute h-6 rounded-lg flex items-center px-3 border text-[10px] font-semibold shadow-sm truncate transition-all duration-300 hover:scale-[1.01] hover:shadow-md select-none"
                                        title={milestone.name}
                                        style={{
                                          left: `${mLeft}%`,
                                          width: `${mWidth}%`,
                                          backgroundColor: mBarBg,
                                          borderColor: mBarBorder,
                                          color: mBarText
                                        }}>
                                        {milestone.name}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Stages Rows */}
                                {timelineStages.map(stage => {
                                  const { start: stageStart, due: stageDue, estimated: stageDatesEstimated } = getStageDateRange(stage, milestone.startDate, milestone.dueDate);
                                  const stageMember = findTeamMember(teamMembers, stage.pic, stage.picName, stage.picUserId);
                                  const sVisible = stageStart <= viewEndDate && stageDue >= viewStartDate;

                                  let sLeft = 0;
                                  let sWidth = 0;
                                  if (sVisible) {
                                    const clipStart = stageStart < viewStartDate ? viewStartDate : stageStart;
                                    const clipEnd = stageDue > viewEndDate ? viewEndDate : stageDue;
                                    sLeft = ((clipStart.getTime() - viewStartDate.getTime()) / totalMs) * 100;
                                    sWidth = ((clipEnd.getTime() - clipStart.getTime()) / totalMs) * 100;
                                  }

                                  const stageStatus = stage.status || "in-progress";
                                  const stageStatusCfg = {
                                    "upcoming": { label: "Upcoming", color: "#facc15", bg: "#fef9c31b" },
                                    "in-progress": { label: "In Progress", color: "#3b82f6", bg: "#dbeafe1b" },
                                    "done": { label: "Completed", color: "#22c55e", bg: "#dcfce71b" }
                                  }[stageStatus];

                                  let barBg = `${project.color}15`;
                                  let barBorder = `${project.color}40`;
                                  let barText = project.color;

                                  if (stageStatus === "done") {
                                    barBg = "#22c55e1c";
                                    barBorder = "#22c55e40";
                                    barText = "#16a34a";
                                  } else if (stageStatus === "in-progress") {
                                    barBg = "#3b82f61c";
                                    barBorder = "#3b82f640";
                                    barText = "#2563eb";
                                  } else if (stageStatus === "upcoming") {
                                    barBg = "#facc151c";
                                    barBorder = "#facc1540";
                                    barText = "#ca8a04";
                                  }

                                  return (
                                    <div key={stage.id} className="flex items-center pl-6">
                                      <div className="w-[296px] shrink-0 pr-4 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />

                                        {stage.pic ? (
                                          <ProjectIdentityAvatar
                                            member={stageMember}
                                            initials={stage.pic}
                                            name={stage.picName}
                                            color={stage.picColor || "#94a3b8"}
                                            avatarUrl={stage.picAvatarUrl}
                                            size="xs"
                                          />
                                        ) : (
                                          <div className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 text-[8px] font-bold text-muted-foreground">
                                            -
                                          </div>
                                        )}

                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-xs font-medium text-foreground" title={stage.name}>{stage.name}</p>
                                          <div className="flex items-center gap-1.5 mt-0.5">
                                            <span
                                              className="truncate text-[9px] text-muted-foreground"
                                              title={`${stageDatesEstimated ? "Ước tính · " : ""}${formatProjectDateRange(
                                                stage.startDate || formatUiDate(stageStart),
                                                stage.dueDate || formatUiDate(stageDue),
                                                "TBD"
                                              )}`}
                                            >
                                              {stageDatesEstimated ? "Ước tính · " : ""}{formatProjectDateRange(
                                                stage.startDate || formatUiDate(stageStart),
                                                stage.dueDate || formatUiDate(stageDue),
                                                "TBD"
                                              )}
                                            </span>
                                            <span className="text-[8px] text-muted-foreground/40">•</span>
                                            <span className="text-[9px] text-muted-foreground shrink-0">{stage.tasks?.length ?? 0} tasks</span>
                                          </div>
                                        </div>

                                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 transition-all"
                                          style={{ color: stageStatusCfg.color, backgroundColor: stageStatusCfg.bg, border: `1px solid ${stageStatusCfg.color}25` }}>
                                          {stageStatus === "done" ? "Done" : stageStatus === "in-progress" ? "In Progress" : "Upcoming"}
                                        </span>
                                      </div>

                                      <div className="flex-1 relative h-6 flex items-center">
                                        {/* Background grid lines */}
                                        <div className="absolute inset-0 grid grid-cols-6 gap-0 pointer-events-none">
                                          {Array.from({ length: 6 }).map((_, idx) => (
                                            <div key={idx} className="h-full border-l border-dashed border-border/40 first:border-l-0" />
                                          ))}
                                        </div>

                                        {/* Stage Gantt Bar */}
                                        {sVisible && (
                                          <div className="absolute h-4 rounded-md flex items-center px-2 text-[9px] font-semibold border shadow-xs truncate transition-all duration-300 hover:scale-[1.01] hover:shadow-md select-none"
                                            title={stage.name}
                                            style={{
                                              left: `${sLeft}%`,
                                              width: `${sWidth}%`,
                                              backgroundColor: barBg,
                                              borderColor: barBorder,
                                              color: barText
                                            }}>
                                            {stage.name}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })()}

              {/* ─── TEAM ─── */}
              {tab === "Team" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{teamMembers.length} members</p>
                      {workspaceUsersError ? (
                        <p className="mt-1 text-xs font-medium text-destructive">{workspaceUsersError} <button className="underline" onClick={() => setWorkspaceUsersRevision(value => value + 1)}>Retry loading workspace users</button></p>
                      ) : null}
                      {teamMutationError ? (
                        <p className="mt-1 text-xs font-medium text-destructive">{teamMutationError}</p>
                      ) : null}
                    </div>
                    <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }}
                      disabled={!projectPeople.permissions.canManage || projectPeople.loading || loadingWorkspaceUsers} onClick={() => setShowInviteModal(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
                      style={{ backgroundColor:project.color }}>
                      <UserPlus className="w-4 h-4" /> {loadingWorkspaceUsers ? "Loading users..." : "Invite Member"}
                    </motion.button>
                  </div>
                  {teamMembers.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                      {teamMembers.map((m, i) => {
                        const pct = m.tasks > 0 ? Math.round((m.done/m.tasks)*100) : 0;
                        const memberKey = projectMemberIdentity(m);
                        const isRemoving = mutatingMemberId === memberKey;
                        return (
                          <motion.div key={memberKey} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.07 }}
                            className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="relative">
                                  <TeamMemberAvatar member={m} />
                                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card" style={{ backgroundColor:m.status==="active"?C.success:C.warning }} />
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-foreground">{m.name}</p>
                                  <p className="text-xs text-muted-foreground">{m.role}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m)}
                                disabled={isRemoving || Boolean(mutatingMemberId) || !projectPeople.permissions.canManage}
                                aria-label={`Remove ${m.name} from project`}
                                className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-border px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-45"
                              >
                                {isRemoving ? "..." : <Trash2 className="w-4 h-4" />}
                              </button>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mb-3">
                              {[{label:"Assigned",value:m.tasks},{label:"Done",value:m.done},{label:"Done %",value:`${pct}%`}].map(s => (
                                <div key={s.label} className="text-center bg-muted/40 rounded-lg py-2">
                                  <p className="text-sm font-bold text-foreground">{s.value}</p>
                                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                                </div>
                              ))}
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:0.7 }}
                                className="h-full rounded-full" style={{ backgroundColor:m.color }} />
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <ProjectEmptyState
                      icon={Users}
                      title="No team members yet"
                      description="Invite synced workspace users to make them available for milestones, stages, and task ownership."
                      actionLabel="Invite Member"
                      onAction={projectPeople.permissions.canManage ? () => setShowInviteModal(true) : undefined}
                      accentColor={project.color}
                    />
                  )}
                </div>
              )}

              {/* ─── ACTIVITY ─── */}
              {tab === "Activity" && (
                <div className="min-h-[calc(100vh-430px)] w-full">
                  {projectActivityFeed.length > 0 ? (
                    <div className="grid w-full gap-5 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="project-activity-feed">
                      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Project activity</p>
                            <h2 className="mt-1 text-base font-black text-foreground">Real user work stream</h2>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
                            {[
                              { label:"Events", value:projectActivityFeed.length },
                              { label:"Users", value:activityUserKeys.size },
                              { label:"Actual", value:`${actualWorkActivityHours}h` },
                            ].map(stat => (
                              <div key={stat.label} className="rounded-lg border border-border bg-muted/25 px-3 py-2">
                                <p className="font-mono text-sm font-black text-foreground">{stat.value}</p>
                                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="divide-y divide-border">
                          {pagedProjectActivityFeed.map((item, i) => {
                            const member = findTeamMember(teamMembers, item.userInitials, item.userName, item.userId);
                            const displayName = item.userName || member?.name || "System";
                            const initials = item.userInitials || initialsForDisplayName(displayName);

                            return (
                              <motion.div
                                key={item.id}
                                data-testid="project-activity-row"
                                initial={{ opacity:0, y:8 }}
                                animate={{ opacity:1, y:0 }}
                                transition={{ delay:Math.min(i * 0.035, 0.35) }}
                                className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_180px]"
                              >
                                <div className="flex min-w-0 items-start gap-4">
                                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                                    <item.icon className="h-4 w-4" style={{ color:item.color }} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground">
                                        <ProjectIdentityAvatar
                                          member={member}
                                          initials={initials}
                                          name={displayName}
                                          color={item.color}
                                          avatarUrl={item.userAvatarUrl}
                                          size="xs"
                                        />
                                        {displayName}
                                      </span>
                                      {item.badge && (
                                        <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ backgroundColor:`${item.color}14`, color:item.color }}>
                                          {item.badge}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-foreground">
                                      {item.text}{" "}
                                      {item.target && <span className="font-semibold" style={{ color:project.color }}>{item.target}</span>}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground md:justify-end">
                                  <Clock className="h-3.5 w-3.5" />
                                  <span>{item.time || "Not set"}</span>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                        {projectActivityFeed.length > ACTIVITY_PAGE_SIZE && (
                          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs font-semibold text-muted-foreground">
                              Showing {safeActivityPage * ACTIVITY_PAGE_SIZE + 1}-{Math.min(projectActivityFeed.length, (safeActivityPage + 1) * ACTIVITY_PAGE_SIZE)} of {projectActivityFeed.length} activity items
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={safeActivityPage === 0}
                                onClick={() => setActivityPage(Math.max(0, safeActivityPage - 1))}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                Previous
                              </button>
                              <span className="min-w-14 text-center font-mono text-xs font-bold text-muted-foreground">
                                {safeActivityPage + 1}/{activityTotalPages}
                              </span>
                              <button
                                type="button"
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={safeActivityPage >= activityTotalPages - 1}
                                onClick={() => setActivityPage(Math.min(activityTotalPages - 1, safeActivityPage + 1))}
                              >
                                Next
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <aside className="space-y-4">
                        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Work clarity</p>
                          <div className="mt-4 space-y-3">
                            {[
                              { label:"Logged work entries", value:workLogActivity.length, icon:Clock },
                              { label:"Tasks touched", value:touchedActivityTasks, icon:ListChecks },
                              { label:"Project notes", value:activityLog.length, icon:History },
                            ].map(row => (
                              <div key={row.label} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
                                <row.icon className="h-4 w-4 text-muted-foreground" />
                                <span className="flex-1 text-xs font-semibold text-foreground">{row.label}</span>
                                <span className="font-mono text-sm font-black text-foreground">{row.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active users</p>
                          <div className="mt-4 space-y-2">
                            {teamMembers
                              .filter(member => activityUserKeys.has(projectMemberIdentity(member)) || activityUserKeys.has(normalizeIdentityValue(member.name) ?? ""))
                              .slice(0, 6)
                              .map(member => (
                                <div key={member.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                                  <TeamMemberAvatar member={member} size="sm" />
                                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{member.name}</span>
                                </div>
                              ))}
                            {activityUserKeys.size === 0 && (
                              <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                                User attribution will appear when entries include real users.
                              </p>
                            )}
                          </div>
                        </div>
                      </aside>
                    </div>
                  ) : (
                    <div data-testid="project-activity-empty" className="flex min-h-[calc(100vh-430px)] w-full items-center justify-center rounded-xl border border-dashed border-border bg-card/70 p-10">
                      <ProjectEmptyState
                        icon={Activity}
                        title="No activity yet"
                        description="Project activity, updates, and operational notes will appear here once the team records real work."
                        accentColor={project.color}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ─── DOCUMENTS ─── */}
              {tab === "Documents" && (() => {
                const filteredDocs = documents.filter(doc => {
                  const matchSearch = doc.name.toLowerCase().includes(docSearchQuery.toLowerCase());
                  const matchCategory = docCategoryFilter === "All" || doc.category === docCategoryFilter;
                  return matchSearch && matchCategory;
                });

                const categories = ["All", "Requirements", "Technical", "Design", "Operations", "Legal", "Other"];

                return (
                  <div className="space-y-4">
                    {/* Control Bar */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-card border border-border rounded-2xl shadow-sm">
                      <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                        {/* Search */}
                        <div className="relative flex-1 max-w-md">
                          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                          <input
                            type="text"
                            placeholder="Search documents..."
                            value={docSearchQuery}
                            onChange={e => setDocSearchQuery(e.target.value)}
                            className="w-full bg-background border border-input rounded-xl pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        {/* Category filter */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                          {categories.map(cat => (
                            <button
                              key={cat}
                              onClick={() => setDocCategoryFilter(cat)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                                docCategoryFilter === cat
                                  ? "bg-foreground text-background border-foreground"
                                  : "bg-muted/30 text-muted-foreground hover:bg-muted/70 border-border"
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      </div>
                      <motion.button
                        whileHover={{ scale:1.02 }}
                        whileTap={{ scale:0.97 }}
                        onClick={() => setShowAddDocModal(true)}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
                        style={{ backgroundColor:project.color }}
                      >
                        <Plus className="w-4 h-4" /> Upload Document
                      </motion.button>
                    </div>
                    {documentMutationError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{documentMutationError}</div> : null}

                    {/* Table View */}
                    {documents.length === 0 ? (
                      <ProjectEmptyState
                        icon={FileText}
                        title="No documents yet"
                        description="Requirements, handoff files, and delivery artifacts will appear here after they are uploaded or synced."
                        actionLabel="Upload Document"
                        onAction={() => setShowAddDocModal(true)}
                        accentColor={project.color}
                      />
                    ) : (
                    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-border bg-muted/20 text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                              <th className="py-3 px-4">Document</th>
                              <th className="py-3 px-4">Category</th>
                              <th className="py-3 px-4">Version</th>
                              <th className="py-3 px-4">Size</th>
                              <th className="py-3 px-4">Owner/PIC</th>
                              <th className="py-3 px-4">Last Updated</th>
                              <th className="py-3 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border text-sm">
                            {filteredDocs.length > 0 ? (
                              filteredDocs.map((doc, idx) => {
                                const latestVer = doc.versions[doc.versions.length - 1] || {
                                  version: 1,
                                  size: "0 KB",
                                  date: "TBD",
                                  author: "System",
                                  note: "Initial version"
                                };
                                const picUser = teamMembers.find(m => m.initials === latestVer.author);

                                return (
                                  <motion.tr
                                    key={doc.id}
                                    initial={{ opacity:0, y:6 }}
                                    animate={{ opacity:1, y:0 }}
                                    transition={{ delay:idx*0.03 }}
                                    className="hover:bg-muted/10 transition-colors"
                                  >
                                    {/* Document Icon & Name */}
                                    <td className="py-3.5 px-4 font-medium text-foreground">
                                      <div className="flex items-center gap-3">
                                        <div
                                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                          style={{ backgroundColor:`${doc.color}15` }}
                                        >
                                          <FileText className="w-4 h-4" style={{ color:doc.color }} />
                                        </div>
                                        <div>
                                          <p className="font-semibold text-sm hover:underline cursor-pointer" onClick={() => setShowVersionHistoryForDoc(doc)}>
                                            {doc.name}
                                          </p>
                                          <p className="text-[10px] text-muted-foreground sm:hidden">
                                            {doc.type} • {latestVer.size}
                                          </p>
                                        </div>
                                      </div>
                                    </td>
                                    {/* Category */}
                                    <td className="py-3.5 px-4">
                                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                        {doc.category || "General"}
                                      </span>
                                    </td>
                                    {/* Version Badge */}
                                    <td className="py-3.5 px-4">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-card border border-border">
                                        v{latestVer.version}.0
                                      </span>
                                    </td>
                                    {/* Size */}
                                    <td className="py-3.5 px-4 text-xs text-muted-foreground">
                                      {latestVer.size}
                                    </td>
                                    {/* Owner/PIC */}
                                    <td className="py-3.5 px-4">
                                      <div className="flex items-center gap-1.5">
                                        <ProjectIdentityAvatar
                                          member={picUser}
                                          initials={latestVer.author}
                                          name={picUser?.name ?? latestVer.author}
                                          color={picUser?.color ?? "#64748b"}
                                          size="sm"
                                        />
                                        <span className="text-xs text-foreground font-medium hidden sm:inline">
                                          {picUser?.name ?? latestVer.author}
                                        </span>
                                      </div>
                                    </td>
                                    {/* Last Updated */}
                                    <td className="py-3.5 px-4 text-xs text-muted-foreground">
                                      {latestVer.date}
                                    </td>
                                    {/* Actions */}
                                    <td className="py-3.5 px-4 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        {latestVer.fileObjectId ? (
                                          <button
                                            aria-label={`Download ${doc.name} version ${latestVer.version}`}
                                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                            disabled={downloadingFileId === latestVer.fileObjectId}
                                            onClick={() => handleDownloadDocument(latestVer.fileObjectId!)}
                                            title="Download latest version"
                                            type="button"
                                          >
                                            <Download className="w-4 h-4" />
                                          </button>
                                        ) : (
                                          <span className="px-2 py-1 text-[10px] text-muted-foreground" title="Legacy metadata has no durable file version">No file</span>
                                        )}
                                        <button
                                          onClick={() => setAddVersionForDoc(doc)}
                                          title="New version"
                                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <GitBranch className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={() => setShowVersionHistoryForDoc(doc)}
                                          title="Version history"
                                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <History className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={() => {
                                            if (confirm(`Are you sure you want to delete ${doc.name}?`)) {
                                              handleDeleteDocument(doc.id);
                                            }
                                          }}
                                          title="Delete"
                                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-danger transition-colors"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </motion.tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                                  No documents match the current filters.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })()}

          </div>
        </main>

        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
      </AppShell>
    </ProjectPickerFeedback.Provider>
  );
}
