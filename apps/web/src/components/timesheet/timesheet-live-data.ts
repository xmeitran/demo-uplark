import type {
  Department,
  MilestoneNode,
  NodeStatus,
  Person,
  ProjectMember,
  ProjectNode,
  StageNode,
  TaskNode,
  TaskStatusEvent,
  TimeLog,
  TimesheetDataset,
  WorkGroup
} from "./timesheet-types";

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

function dateOnly(value?: string) {
  return value ? value.slice(0, 10) : null;
}

function nodeStatus(value?: string): NodeStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (["done", "completed", "complete"].includes(normalized)) return "completed";
  if (["in_progress", "in-progress", "in progress", "doing"].includes(normalized)) return "in_progress";
  if (["blocked", "blocking"].includes(normalized)) return "blocked";
  return "not_started";
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
  return nodeStatus(value);
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Không tải được dữ liệu Timesheet (${response.status}).`);
  return response.json() as Promise<T>;
}

async function loadPaged<T>(path: string, signal?: AbortSignal) {
  const separator = path.includes("?") ? "&" : "?";
  const pageUrl = (offset: number) => `${path}${separator}limit=100&offset=${offset}&principal=founder`;
  const first = await readJson<ApiResponse<T>>(pageUrl(0), signal);
  const rows = [...(first.data ?? [])];
  const pagination = first.meta?.pagination;
  if (!pagination?.hasNextPage) return rows;
  const total = pagination.total ?? rows.length;
  const returned = pagination.returned ?? rows.length;
  if (!returned || total <= returned) return rows;
  const offsets = Array.from({ length: Math.min(30, Math.ceil((total - returned) / 100)) }, (_, index) => returned + index * 100);
  const pages = await Promise.all(offsets.map((offset) => readJson<ApiResponse<T>>(pageUrl(offset), signal)));
  for (const page of pages) rows.push(...(page.data ?? []));
  return rows;
}

export async function loadTimesheetDataset(signal?: AbortSignal): Promise<TimesheetDataset> {
  const now = new Date();
  const year = now.getFullYear();
  // The time-entry API enforces a maximum 90-day window. Keep the default
  // sheet within that contract while still covering the current quarter.
  const startAt = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const [projects, entries, users, dayOffResponse] = await Promise.all([
    loadPaged<ApiProject>("/api/projects", signal),
    loadPaged<ApiTimeEntry>(`/api/tasks/time-entries?startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`, signal),
    readJson<ApiResponse<ApiUser>>("/api/workspace/users?principal=founder", signal),
    readJson<ApiResponse<{ date?: string; isActive?: boolean }>>(`/api/workspace/day-offs?year=${year}&principal=founder`, signal)
  ]);

  // The time-entry contract already carries the task title and ID. Building
  // the sheet from that live slice avoids a 1,500-row task crawl and keeps the
  // first render responsive. Task estimates/status are intentionally shown as
  // unavailable until a dedicated timesheet aggregate endpoint is available.
  // A task can have several time entries (and several contributors). Keep one
  // hierarchy node per task while preserving every entry in `logs`; otherwise
  // React renders duplicate task keys and the same task appears multiple times
  // in the breakdown and charts.
  const taskByKey = new Map<string, ApiTask>();
  for (const entry of entries) {
    const key = `${entry.projectId}:${entry.taskId}`;
    if (!taskByKey.has(key)) {
      taskByKey.set(key, {
        id: entry.taskId,
        projectId: entry.projectId,
        title: entry.taskTitle || entry.taskId,
        stageActivity: "Time log",
        assigneeUserId: entry.userId,
        estimateMinutes: 0,
        status: "in_progress"
      });
    }
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
      const milestoneKey = task.stageActivity || task.stageKey || "unassigned";
      const stageKey = task.stageId || task.stageKey || "unassigned-stage";
      const stages = groupedMilestones.get(milestoneKey) ?? new Map<string, ApiTask[]>();
      stages.set(stageKey, [...(stages.get(stageKey) ?? []), task]);
      groupedMilestones.set(milestoneKey, stages);
    }
    const milestones: MilestoneNode[] = [...groupedMilestones.entries()].map(([milestoneName, stages], milestoneIndex) => ({
      id: `ms-${project.id}-${milestoneIndex}`,
      name: milestoneName === "unassigned" ? "Chưa phân loại" : milestoneName,
      projectId: project.id,
      picId: stages.values().next().value?.[0]?.assigneeUserId ?? null,
      startDate: null,
      dueDate: null,
      status: "in_progress",
      stages: [...stages.entries()].map(([stageId, stageTasks]): StageNode => ({
        id: stageId,
        name: stageTasks[0]?.stageActivity || "Giai đoạn",
        milestoneId: `ms-${project.id}-${milestoneIndex}`,
        ownerId: stageTasks[0]?.ownerUserId ?? stageTasks[0]?.assigneeUserId ?? null,
        startDate: dateOnly(stageTasks.map((task) => task.plannedStartAt).find(Boolean)),
        dueDate: dateOnly(stageTasks.map((task) => task.dueAt).find(Boolean)),
        status: stageTasks.some((task) => nodeStatus(task.status) === "in_progress") ? "in_progress" : stageTasks.every((task) => nodeStatus(task.status) === "completed") ? "completed" : "not_started",
        tasks: stageTasks.map((task): TaskNode => ({
          id: task.id,
          code: task.id,
          name: task.title,
          stageId,
          assigneeId: task.assigneeUserId || task.ownerUserId || null,
          estimateMinutes: task.estimateMinutes ?? 0,
          status: nodeStatus(task.status),
          startDate: dateOnly(task.plannedStartAt),
          dueDate: dateOnly(task.dueAt),
          completedDate: dateOnly(task.completedAt)
        }))
      }))
    }));
    const members: ProjectMember[] = [...(projectMembers.get(project.id) ?? [])].map((personId) => ({ personId, role: "Project member", state: "active", joinedAt: "" }));
    return {
      id: project.id,
      code: project.code || project.id,
      name: project.name,
      accountName: project.accountName || "—",
      status: project.status === "completed" ? "completed" : project.status === "paused" ? "paused" : "in_progress",
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

  const departments: Department[] = [...new Set([...peopleById.values()].map((person) => person.departmentId))].map((id) => ({ id, name: id === "unassigned" ? "Chưa phân loại" : id }));
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
