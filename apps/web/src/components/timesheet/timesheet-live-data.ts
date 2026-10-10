import type {
  Department,
  MemberState,
  MilestoneNode,
  NodeStatus,
  Person,
  ProjectMember,
  ProjectNode,
  StageNode,
  TaskNode,
  TimeLog,
  TimesheetDataset,
  WorkGroup
} from "./timesheet-types";
import { formatDepartmentLabel } from "@/lib/department-labels";
import { businessRoleFromMember } from "@/lib/people-roles";
import { fetchAllPages } from "@/lib/api-pages";
import { resolveProjectStatus } from "@/lib/project-status";
import { isActualTimeEntry } from "@/lib/time-entry-actual";
import { toVietnamDateKey, vietnamDayStartIso } from "@/lib/vietnam-time";
import { isClosedNodeStatus, isPausedTaskStatus, normalizeNodeStatus } from "./timesheet-status";
import { monthBounds } from "./timesheet-dates";
import type { ProjectMemberParticipationItem } from "@b2b-crm/contracts";
export { normalizeNodeStatus } from "./timesheet-status";

type ApiUser = {
  id: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  departmentCode?: string;
  resourceDisplayRole?: string;
  roleCodes?: string[];
  status?: string;
};

type ApiProject = {
  id: string;
  code?: string;
  name: string;
  accountName?: string;
  status?: string;
  /** Canonical status from the API; preferred over `status`. */
  statusCode?: string;
  projectType?: string;
  ownerUserId?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  memberUserIds?: string[];
  members?: ApiProjectMember[];
};

/** `projectRole`/`role`/`joinedAt` are read when the payload carries them; today it does not. */
type ApiProjectMember = { userId?: string; displayName?: string; relation?: string; employmentStatus?: string; projectRole?: string; role?: string; joinedAt?: string };

type ApiTask = {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  status?: string;
  taskType?: string;
  stageId?: string;
  stageKey?: string;
  stageActivity?: string;
  milestoneId?: string;
  milestoneName?: string;
  ownerUserId?: string;
  assigneeUserId?: string;
  plannedStartAt?: string;
  dueAt?: string;
  completedAt?: string;
  estimateMinutes?: number;
};

type ApiTimeEntry = {
  id: string;
  taskId: string;
  projectId: string;
  projectName?: string;
  taskTitle?: string;
  taskStatus?: string;
  taskEstimateMinutes?: number;
  userId: string;
  userDisplayName?: string;
  workDate?: string;
  minutes?: number;
  billable?: boolean;
  workType?: string;
  /** Approval status of the entry; decides whether it counts as actual hours (isActualTimeEntry). */
  approvalStatus?: string;
  note?: string;
  createdAt?: string;
};

type ApiResponse<T> = { data?: T[]; meta?: { pagination?: { hasNextPage?: boolean; offset?: number; returned?: number; total?: number } } };

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function avatarColor(id: string) {
  const colors = ["#2563eb", "#059669", "#7c3aed", "#db2777", "#d97706", "#0891b2", "#64748b"];
  const hash = Array.from(id).reduce((total, character) => total + character.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/** Calendar day in Asia/Ho_Chi_Minh — a UTC slice puts 00:00–06:59 local on the previous day. */
export function dateOnly(value?: string) {
  return value ? toVietnamDateKey(value) || null : null;
}

function workGroup(value?: string, projectName?: string): WorkGroup {
  const normalized = `${value ?? ""} ${projectName ?? ""}`.toLowerCase();
  if (normalized.includes("training") || normalized.includes("đào tạo") || normalized.includes("onboard")) return "training";
  if (normalized.includes("meeting") || normalized.includes("họp")) return "meeting";
  if (normalized.includes("ticket") || normalized.includes("maintenance") || normalized.includes("bảo trì")) return "ticket_maintenance";
  if (normalized.includes("internal") || normalized.includes("nội bộ") || normalized.includes("[dx]")) return "internal_project";
  return "customer_project";
}

export function projectMemberState(value?: string): MemberState {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["ON_LEAVE", "ON_HOLD", "PAUSED"].includes(normalized)) return "on_leave";
  if (["INACTIVE", "RELEASED", "SUSPENDED"].includes(normalized)) return "released";
  return "active";
}

/** Prefer the canonical task status; time-entry rows may carry a stale/default status. */
export function resolveTaskStatus(taskStatus?: string, entryStatus?: string) {
  return taskStatus?.trim() || entryStatus || "in_progress";
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Không tải được dữ liệu Timesheet (${response.status}).`);
  return response.json() as Promise<T>;
}

function loadPaged<T>(path: string, signal?: AbortSignal) {
  return fetchAllPages<T>(`${path}${path.includes("?") ? "&" : "?"}principal=founder`, { signal, errorLabel: "Không tải được dữ liệu Timesheet" });
}

const participationCache = new Map<string, Promise<Map<string, ProjectMemberParticipationItem>>>();

/**
 * EV-035 participation state per member for one project and month ("YYYY-MM").
 * Cached per project+period for the life of ONE dataset load: loadTimesheetDataset clears it,
 * so "Thử lại"/reload never shows participation older than the hours next to it. Failures are not cached.
 */
export function fetchProjectMemberParticipation(projectId: string, month: string) {
  const key = `${projectId}:${month}`;
  let request = participationCache.get(key);
  if (!request) {
    const { start, end } = monthBounds(month);
    request = readJson<{ data?: ProjectMemberParticipationItem[] }>(`/api/projects/${encodeURIComponent(projectId)}/member-participation?startDate=${start}&endDate=${end}`)
      .then((body) => new Map((body.data ?? []).map((item) => [item.userId, item])));
    request.catch(() => participationCache.delete(key));
    participationCache.set(key, request);
  }
  return request;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ENTRY_MAX_RANGE_DAYS = 90;
// Keep the workbench responsive while covering the normal reporting period.
// The API supports 90-day windows; three years created 13 windows and made
// the old sequential pagination path effectively non-terminating in Render.
export const TIMESHEET_HISTORY_DAYS = 365;

export function buildTimesheetDateRanges(startAt: Date, endAt: Date, maxRangeDays = TIME_ENTRY_MAX_RANGE_DAYS) {
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs || maxRangeDays <= 0) return [];

  const ranges: Array<{ startAt: string; endAt: string }> = [];
  let cursorMs = startMs;
  const maxRangeMs = maxRangeDays * DAY_MS;
  while (cursorMs < endMs) {
    const nextMs = Math.min(cursorMs + maxRangeMs, endMs);
    ranges.push({ startAt: new Date(cursorMs).toISOString(), endAt: new Date(nextMs).toISOString() });
    cursorMs = nextMs;
  }
  return ranges;
}

/** First whole Asia/Ho_Chi_Minh day of the loaded time-entry window. */
export function timesheetWindowStart(now: Date) {
  return toVietnamDateKey(new Date(now.getTime() - TIMESHEET_HISTORY_DAYS * DAY_MS));
}

/**
 * Months offered in the period picker. The window is a rolling 365 days, so its oldest month is
 * only partly loaded: it is left out rather than measured against a full month's standard hours.
 */
export function selectableTimesheetMonths(logDates: string[], windowStart: string, today: string) {
  const months = new Set(logDates.map((date) => date.slice(0, 7)).filter((month) => `${month}-01` >= windowStart));
  months.add(today.slice(0, 7));
  return [...months].sort();
}

/** Every calendar year between two date keys, inclusive (day-offs are fetched per year). */
export function yearsBetween(startKey: string, endKey: string) {
  const years: number[] = [];
  for (let year = Number(startKey.slice(0, 4)); year <= Number(endKey.slice(0, 4)); year += 1) years.push(year);
  return years;
}

async function loadTimeEntriesAcrossHistory(now: Date, signal?: AbortSignal) {
  const startAt = new Date(vietnamDayStartIso(timesheetWindowStart(now)));
  const endAt = new Date(now.getTime() + DAY_MS);
  const ranges = buildTimesheetDateRanges(startAt, endAt);
  const batches = await Promise.all(ranges.map((range) => (
    loadPaged<ApiTimeEntry>(
      `/api/tasks/time-entries?startAt=${encodeURIComponent(range.startAt)}&endAt=${encodeURIComponent(range.endAt)}`,
      signal
    )
  )));

  const entriesById = new Map<string, ApiTimeEntry>();
  // The one definition of actual hours: rejected/cancelled/planned entries never reach the sheet.
  for (const entry of batches.flat()) if (isActualTimeEntry(entry)) entriesById.set(entry.id, entry);
  return [...entriesById.values()];
}

export async function loadTimesheetDataset(signal?: AbortSignal): Promise<TimesheetDataset> {
  participationCache.clear();
  const now = new Date();
  const today = toVietnamDateKey(now);
  const windowStart = timesheetWindowStart(now);
  const [projects, entries, users, dayOffResponses, apiTasks] = await Promise.all([
    loadPaged<ApiProject>("/api/projects", signal),
    loadTimeEntriesAcrossHistory(now, signal),
    readJson<ApiResponse<ApiUser>>("/api/workspace/users?principal=founder", signal),
    // One request per year the window touches; a single "this year" call lost last year's holidays.
    Promise.all(yearsBetween(windowStart, toVietnamDateKey(new Date(now.getTime() + DAY_MS))).map((year) => (
      readJson<ApiResponse<{ date?: string; isActive?: boolean }>>(`/api/workspace/day-offs?year=${year}&principal=founder`, signal)
    ))),
    // Keep the full task hierarchy separate from the time-entry slice. The
    // entry endpoint intentionally omits milestone/stage metadata, which made
    // every live row fall back to the generic "Time log" bucket.
    loadPaged<ApiTask>("/api/tasks?includeArchived=true", signal)
  ]);

  // The time-entry contract carries the task title, ID, canonical task status
  // and the task's planned estimate. Building the sheet from that live slice
  // avoids a 1,500-row task crawl while keeping plan/actual data aligned with
  // the task page.
  // A task can have several time entries (and several contributors). Keep one
  // hierarchy node per task while preserving every entry in `logs`; otherwise
  // React renders duplicate task keys and the same task appears multiple times
  // in the breakdown and charts.
  const taskByKey = new Map<string, ApiTask>();
  for (const task of apiTasks) {
    taskByKey.set(`${task.projectId}:${task.id}`, task);
  }
  for (const entry of entries) {
    const key = `${entry.projectId}:${entry.taskId}`;
    const task = taskByKey.get(key);
    if (task) {
      // Keep the canonical task status. The time-entry endpoint may expose a
      // generic/default status for every row, which would incorrectly turn a
      // completed or not-started task into "Đang làm".
      task.status = resolveTaskStatus(task.status, entry.taskStatus);
      if ((task.estimateMinutes ?? 0) <= 0 && (entry.taskEstimateMinutes ?? 0) > 0) task.estimateMinutes = entry.taskEstimateMinutes;
      continue;
    }
    taskByKey.set(key, {
      id: entry.taskId,
      projectId: entry.projectId,
      title: entry.taskTitle || entry.taskId,
      stageActivity: "Chưa phân loại",
      assigneeUserId: entry.userId,
      estimateMinutes: entry.taskEstimateMinutes ?? 0,
      status: resolveTaskStatus(undefined, entry.taskStatus)
    });
  }
  const tasks: ApiTask[] = [...taskByKey.values()];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const usersById = new Map((users.data ?? []).map((user) => [user.id, user]));
  const projectMembers = new Map<string, Set<string>>();
  const projectMemberStates = new Map<string, Map<string, MemberState>>();
  const memberPayloads = new Map<string, ApiProjectMember>();

  for (const project of projects) {
    for (const member of project.members ?? []) if (member.userId) memberPayloads.set(`${project.id}:${member.userId}`, member);
    const members = new Set<string>([
      ...(project.memberUserIds ?? []),
      ...(project.members ?? []).flatMap((member) => member.userId ? [member.userId] : [])
    ]);
    projectMembers.set(project.id, members);
    projectMemberStates.set(project.id, new Map(
      (project.members ?? [])
        .filter((member): member is { userId: string; employmentStatus?: string } => Boolean(member.userId))
        .map((member) => [member.userId, projectMemberState(member.employmentStatus)])
    ));
  }

  for (const task of tasks) {
    const members = projectMembers.get(task.projectId) ?? new Set<string>();
    if (task.assigneeUserId) members.add(task.assigneeUserId);
    if (task.ownerUserId) members.add(task.ownerUserId);
    const states = projectMemberStates.get(task.projectId) ?? new Map<string, MemberState>();
    if (task.assigneeUserId && !states.has(task.assigneeUserId)) states.set(task.assigneeUserId, "active");
    if (task.ownerUserId && !states.has(task.ownerUserId)) states.set(task.ownerUserId, "active");
    projectMemberStates.set(task.projectId, states);
    projectMembers.set(task.projectId, members);
  }
  for (const entry of entries) {
    const members = projectMembers.get(entry.projectId) ?? new Set<string>();
    members.add(entry.userId);
    projectMembers.set(entry.projectId, members);
    const states = projectMemberStates.get(entry.projectId) ?? new Map<string, MemberState>();
    if (!states.has(entry.userId)) states.set(entry.userId, "active");
    projectMemberStates.set(entry.projectId, states);
  }

  const peopleById = new Map<string, Person>();
  const addPerson = (id: string, fallbackName?: string) => {
    if (peopleById.has(id)) return;
    const user = usersById.get(id);
    const name = user?.displayName || fallbackName || id;
    const departmentId = user?.departmentCode || "unassigned";
    peopleById.set(id, {
      id,
      name,
      initials: initials(name),
      avatarUrl: user?.avatarUrl,
      avatarColor: avatarColor(id),
      role: businessRoleFromMember(user ?? {}),
      departmentId,
      teamName: departmentId,
      standardMinutesPerDay: 480,
      contractRatio: 1,
      // Someone who only appears through old time entries (not in the workspace directory) or is
      // suspended is a former user: kept for their hours, never expected to log.
      active: Boolean(user) && user?.status !== "suspended"
    });
  };
  for (const user of users.data ?? []) addPerson(user.id);
  for (const entry of entries) addPerson(entry.userId, entry.userDisplayName);

  const tasksByProject = new Map<string, ApiTask[]>();
  for (const task of tasks) tasksByProject.set(task.projectId, [...(tasksByProject.get(task.projectId) ?? []), task]);

  const projectNodes: ProjectNode[] = projects.map((project) => {
    const groupedMilestones = new Map<string, Map<string, ApiTask[]>>();
    for (const task of tasksByProject.get(project.id) ?? []) {
      const milestoneKey = task.milestoneId || "unassigned";
      const stageKey = task.stageId || task.stageKey || "unassigned-stage";
      const stages = groupedMilestones.get(milestoneKey) ?? new Map<string, ApiTask[]>();
      stages.set(stageKey, [...(stages.get(stageKey) ?? []), task]);
      groupedMilestones.set(milestoneKey, stages);
    }
    const milestones: MilestoneNode[] = [...groupedMilestones.entries()].map(([milestoneKey, stages], milestoneIndex) => {
      const milestoneId = `ms-${project.id}-${milestoneIndex}`;
      const milestoneName = (tasksByProject.get(project.id) ?? []).find((task) => (task.milestoneId || "unassigned") === milestoneKey)?.milestoneName || (milestoneKey === "unassigned" ? "Chưa phân loại" : milestoneKey);
      const stageNodes: StageNode[] = [...stages.entries()].map(([stageId, stageTasks]) => {
        const taskStatuses = stageTasks.map((task) => normalizeNodeStatus(task.status));
        const status: NodeStatus = taskStatuses.some((value) => value === "blocked")
          ? "blocked"
          : taskStatuses.length > 0 && taskStatuses.every(isClosedNodeStatus)
            ? taskStatuses.some((value) => value === "completed") ? "completed" : "cancelled"
            : taskStatuses.some((value) => value === "in_progress")
              ? "in_progress"
              : "not_started";
        return {
          id: stageId,
          name: stageTasks[0]?.stageActivity || "Giai đoạn",
          milestoneId,
          ownerId: stageTasks[0]?.ownerUserId ?? stageTasks[0]?.assigneeUserId ?? null,
          startDate: dateOnly(stageTasks.map((task) => task.plannedStartAt).find(Boolean)),
          dueDate: dateOnly(stageTasks.map((task) => task.dueAt).find(Boolean)),
          status,
          tasks: stageTasks.map((task): TaskNode => ({
            id: task.id,
            code: task.id,
            name: task.title,
            stageId,
            assigneeId: task.assigneeUserId || task.ownerUserId || null,
            estimateMinutes: task.estimateMinutes ?? 0,
            status: normalizeNodeStatus(task.status),
            paused: isPausedTaskStatus(task.status) || undefined,
            startDate: dateOnly(task.plannedStartAt),
            dueDate: dateOnly(task.dueAt),
            completedDate: dateOnly(task.completedAt)
          }))
        };
      });
      const stageStatuses = stageNodes.map((stage) => stage.status);
      const status: NodeStatus = stageStatuses.some((value) => value === "blocked")
        ? "blocked"
        : stageStatuses.length > 0 && stageStatuses.every(isClosedNodeStatus)
          ? stageStatuses.some((value) => value === "completed") ? "completed" : "cancelled"
          : stageStatuses.some((value) => value === "in_progress")
            ? "in_progress"
            : "not_started";
      return {
        id: milestoneId,
        name: milestoneName === "unassigned" ? "Chưa phân loại" : milestoneName,
        projectId: project.id,
        picId: stages.values().next().value?.[0]?.assigneeUserId ?? null,
        startDate: null,
        dueDate: null,
        status,
        stages: stageNodes
      };
    });
    const members: ProjectMember[] = [...(projectMembers.get(project.id) ?? [])].map((personId) => {
      const payload = memberPayloads.get(`${project.id}:${personId}`);
      return {
        personId,
        role: payload?.projectRole || payload?.role || undefined,
        state: projectMemberStates.get(project.id)?.get(personId) ?? "active",
        joinedAt: dateOnly(payload?.joinedAt) ?? undefined
      };
    });
    return {
      id: project.id,
      code: project.code || project.id,
      name: project.name,
      accountName: project.accountName || "—",
      status: resolveProjectStatus(project),
      workGroup: workGroup(project.projectType, project.name),
      picId: project.ownerUserId || "",
      startDate: dateOnly(project.plannedStartAt),
      deadline: dateOnly(project.plannedEndAt),
      members,
      milestones
    };
  });

  const taskToMilestone = new Map<string, { milestoneId: string; stageId: string }>();
  for (const project of projectNodes) for (const milestone of project.milestones) for (const stage of milestone.stages) for (const task of stage.tasks) taskToMilestone.set(task.id, { milestoneId: milestone.id, stageId: stage.id });
  const logs: TimeLog[] = entries.map((entry) => {
    const relation = taskToMilestone.get(entry.taskId);
    return {
      id: entry.id,
      date: dateOnly(entry.workDate) || dateOnly(entry.createdAt) || today,
      personId: entry.userId,
      projectId: entry.projectId,
      milestoneId: relation?.milestoneId || "unassigned-milestone",
      stageId: relation?.stageId || "unassigned-stage",
      taskId: entry.taskId,
      minutes: entry.minutes ?? 0,
      workGroup: workGroup(entry.workType, entry.projectName || projectById.get(entry.projectId)?.name),
      billable: entry.billable !== false,
      note: entry.note || ""
    };
  });

  const departments: Department[] = [...new Set([...peopleById.values()].map((person) => person.departmentId))].map((id) => ({ id, name: formatDepartmentLabel(id) }));
  const months = selectableTimesheetMonths(logs.map((log) => log.date), windowStart, today);
  const holidays = [...new Set(dayOffResponses.flatMap((response) => response.data ?? []).filter((item) => item.isActive !== false && item.date).flatMap((item) => dateOnly(item.date) ?? []))];

  return { generatedAt: today, windowStart, departments, people: [...peopleById.values()], projects: projectNodes, logs, holidays, months };
}

export function emptyTimesheetDataset(): TimesheetDataset {
  const today = toVietnamDateKey(new Date());
  return { generatedAt: today, departments: [], people: [], projects: [], logs: [], holidays: [], months: [today.slice(0, 7)] };
}
