import type {
  Department,
  MilestoneNode,
  NodeStatus,
  Person,
  ProjectMember,
  ProjectNode,
  ProjectStatus,
  StageNode,
  TaskNode,
  TaskStatusEvent,
  TimeLog,
  TimesheetDataset,
  WorkGroup
} from "./timesheet-types";
import { formatDepartmentLabel } from "@/lib/department-labels";
import { normalizeNodeStatus } from "./timesheet-status";
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
  projectType?: string;
  ownerUserId?: string;
  memberUserIds?: string[];
  members?: Array<{ userId?: string; displayName?: string; relation?: string }>;
};

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
  statusHistory?: Array<{ id?: string; changedAt?: string; fromStatus?: string | null; toStatus?: string; changedByUserId?: string | null }>;
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

function dateOnly(value?: string) {
  return value ? value.slice(0, 10) : null;
}

function workGroup(value?: string, projectName?: string): WorkGroup {
  const normalized = `${value ?? ""} ${projectName ?? ""}`.toLowerCase();
  if (normalized.includes("training") || normalized.includes("đào tạo") || normalized.includes("onboard")) return "training";
  if (normalized.includes("meeting") || normalized.includes("họp")) return "meeting";
  if (normalized.includes("ticket") || normalized.includes("maintenance") || normalized.includes("bảo trì")) return "ticket_maintenance";
  if (normalized.includes("internal") || normalized.includes("nội bộ") || normalized.includes("[dx]")) return "internal_project";
  return "customer_project";
}

function statusEventStatus(value?: string): NodeStatus {
  return normalizeNodeStatus(value);
}

function projectStatus(value?: string): ProjectStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["completed", "done", "closed"].includes(normalized)) return "completed";
  if (["in_review", "review"].includes(normalized)) return "in_review";
  if (["planning", "not_started", "todo"].includes(normalized)) return "planning";
  if (["on_hold", "paused", "pause"].includes(normalized)) return "paused";
  if (["at_risk", "blocked", "cancelled"].includes(normalized)) return "at_risk";
  if (normalized === "onboarding") return "onboarding";
  if (normalized === "discovery") return "discovery";
  if (normalized === "acceptance") return "acceptance";
  return "in_progress";
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Không tải được dữ liệu Timesheet (${response.status}).`);
  return response.json() as Promise<T>;
}

async function loadPaged<T>(path: string, signal?: AbortSignal) {
  const separator = path.includes("?") ? "&" : "?";
  const pageUrl = (offset: number) => `${path}${separator}limit=100&offset=${offset}&principal=founder`;
  const rows: T[] = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const payload = await readJson<ApiResponse<T>>(pageUrl(offset), signal);
    const pageRows = payload.data ?? [];
    rows.push(...pageRows);
    const pagination = payload.meta?.pagination;
    if (!pagination?.hasNextPage || pageRows.length === 0) break;
    const nextOffset = (pagination.offset ?? offset) + (pagination.returned ?? pageRows.length);
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
  return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ENTRY_MAX_RANGE_DAYS = 90;
const TIMESHEET_HISTORY_DAYS = 1095;

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

async function loadTimeEntriesAcrossHistory(now: Date, signal?: AbortSignal) {
  const startAt = new Date(now.getTime() - TIMESHEET_HISTORY_DAYS * DAY_MS);
  const endAt = new Date(now.getTime() + DAY_MS);
  const ranges = buildTimesheetDateRanges(startAt, endAt);
  const batches = await Promise.all(ranges.map((range) => (
    loadPaged<ApiTimeEntry>(
      `/api/tasks/time-entries?startAt=${encodeURIComponent(range.startAt)}&endAt=${encodeURIComponent(range.endAt)}`,
      signal
    )
  )));

  const entriesById = new Map<string, ApiTimeEntry>();
  for (const entry of batches.flat()) entriesById.set(entry.id, entry);
  return [...entriesById.values()];
}

export async function loadTimesheetDataset(signal?: AbortSignal): Promise<TimesheetDataset> {
  const now = new Date();
  const year = now.getFullYear();
  const [projects, entries, users, dayOffResponse, apiTasks] = await Promise.all([
    loadPaged<ApiProject>("/api/projects", signal),
    loadTimeEntriesAcrossHistory(now, signal),
    readJson<ApiResponse<ApiUser>>("/api/workspace/users?principal=founder", signal),
    readJson<ApiResponse<{ date?: string; isActive?: boolean }>>(`/api/workspace/day-offs?year=${year}&principal=founder`, signal),
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
      // A time-entry record is the freshest source for the logged task
      // status/estimate when the task API is eventually consistent.
      task.status = entry.taskStatus || task.status;
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
      status: entry.taskStatus || "in_progress"
    });
  }
  const tasks: ApiTask[] = [...taskByKey.values()];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const usersById = new Map((users.data ?? []).map((user) => [user.id, user]));
  const projectMembers = new Map<string, Set<string>>();

  for (const project of projects) {
    const members = new Set<string>([
      ...(project.memberUserIds ?? []),
      ...(project.members ?? []).flatMap((member) => member.userId ? [member.userId] : [])
    ]);
    projectMembers.set(project.id, members);
  }

  for (const task of tasks) {
    const members = projectMembers.get(task.projectId) ?? new Set<string>();
    if (task.assigneeUserId) members.add(task.assigneeUserId);
    if (task.ownerUserId) members.add(task.ownerUserId);
    projectMembers.set(task.projectId, members);
  }
  for (const entry of entries) {
    const members = projectMembers.get(entry.projectId) ?? new Set<string>();
    members.add(entry.userId);
    projectMembers.set(entry.projectId, members);
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
      role: user?.resourceDisplayRole || user?.roleCodes?.[0] || "Workspace user",
      departmentId,
      teamName: departmentId,
      standardMinutesPerDay: 480,
      contractRatio: 1,
      active: user?.status !== "suspended"
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
          : taskStatuses.length > 0 && taskStatuses.every((value) => value === "completed")
            ? "completed"
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
            startDate: dateOnly(task.plannedStartAt),
            dueDate: dateOnly(task.dueAt),
            completedDate: dateOnly(task.completedAt)
          }))
        };
      });
      const stageStatuses = stageNodes.map((stage) => stage.status);
      const status: NodeStatus = stageStatuses.some((value) => value === "blocked")
        ? "blocked"
        : stageStatuses.length > 0 && stageStatuses.every((value) => value === "completed")
          ? "completed"
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
    const members: ProjectMember[] = [...(projectMembers.get(project.id) ?? [])].map((personId) => ({ personId, role: "Project member", state: "active", joinedAt: "" }));
    return {
      id: project.id,
      code: project.code || project.id,
      name: project.name,
      accountName: project.accountName || "—",
      status: projectStatus(project.status),
      workGroup: workGroup(project.projectType, project.name),
      picId: project.ownerUserId || "",
      deadline: null,
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
      date: dateOnly(entry.workDate) || dateOnly(entry.createdAt) || `${year}-01-01`,
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
  const months = [...new Set(logs.map((log) => log.date.slice(0, 7)))].sort();
  if (!months.includes(`${year}-${String(now.getMonth() + 1).padStart(2, "0")}`)) months.push(`${year}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const holidays = (dayOffResponse.data ?? []).filter((item) => item.isActive !== false && item.date).map((item) => item.date!.slice(0, 10));
  const statusEvents: TaskStatusEvent[] = tasks.flatMap((task) => (task.statusHistory ?? []).filter((event) => event.changedAt && event.toStatus).map((event, index) => ({ id: event.id || `${task.id}-${index}`, taskId: task.id, projectId: task.projectId, changedAt: event.changedAt!.slice(0, 10), fromStatus: event.fromStatus ? statusEventStatus(event.fromStatus) : null, toStatus: statusEventStatus(event.toStatus), changedByUserId: event.changedByUserId ?? null })));

  return { generatedAt: dateOnly(now.toISOString()) || `${year}-01-01`, departments, people: [...peopleById.values()], projects: projectNodes, logs, statusEvents, holidays, months };
}

export function emptyTimesheetDataset(): TimesheetDataset {
  const month = new Date().toISOString().slice(0, 7);
  return { generatedAt: new Date().toISOString().slice(0, 10), departments: [], people: [], projects: [], logs: [], statusEvents: [], holidays: [], months: [month] };
}
