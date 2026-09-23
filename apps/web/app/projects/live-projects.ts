import type { AccountSummary, AccountsResponse, ProjectSummary, ResourceListPaginationMeta, ResourceListResponse } from "@b2b-crm/contracts";
import type { Project } from "./data";

export const PROJECT_PAGE_SIZE = 10;
export const LIVE_PROJECT_SNAPSHOT_TTL_MS = 5_000;
const LIVE_COLORS = ["#2563eb", "#059669", "#7c3aed", "#db2777", "#d97706", "#dc2626", "#64748b", "#0891b2"];

type LiveProjectSnapshot = {
  expiresAt: number;
  project: Project | null;
};

export type LiveProjectSnapshotResult = {
  project: Project | null;
};

let snapshotGeneration = 0;
const liveProjectSnapshots = new Map<string, LiveProjectSnapshot>();
const liveProjectRequests = new Map<string, Promise<Project | null>>();

export class LiveProjectsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LiveProjectsError";
  }
}

export interface LiveProjectAccountOption {
  value: string;
  label: string;
  accountId: string;
}

export interface FetchLiveProjectsOptions {
  limit?: number;
  offset?: number;
  q?: string;
  status?: Project["status"] | "all";
  category?: string;
  signal?: AbortSignal;
  cacheScope?: string;
}

export interface LiveProjectsResult {
  projects: Project[];
  accountOptions: LiveProjectAccountOption[];
  total: number;
  pagination: ResourceListPaginationMeta;
}

type ProjectMemberSummary = NonNullable<ProjectSummary["members"]>[number];

function normalizeProjectPaginationMeta(payload: ResourceListResponse<ProjectSummary>, limit: number, offset: number): ResourceListPaginationMeta {
  return payload.meta.pagination ?? {
    limit,
    offset,
    returned: payload.data.length,
    total: payload.data.length,
    hasNextPage: false,
    hasPreviousPage: offset > 0
  };
}

export async function fetchLiveProjects(options: FetchLiveProjectsOptions = {}): Promise<LiveProjectsResult> {
  const limit = options.limit ?? PROJECT_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset)
  });
  const q = options.q?.trim();
  const category = options.category?.trim();
  if (q) {
    params.set("q", q);
  }
  if (options.status && options.status !== "all") {
    params.set("status", toBackendProjectStatus(options.status));
  }
  if (category && category !== "all") {
    params.set("category", category);
  }
  const response = await fetch(`/api/projects?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal
  });

  if (!response.ok) {
    throw new LiveProjectsError(`Could not load live projects: ${response.status}`, response.status);
  }

  const payload = (await response.json()) as ResourceListResponse<ProjectSummary>;
  const pagination = normalizeProjectPaginationMeta(payload, limit, offset);
  const projects = payload.data.map(mapProjectSummaryToUiProject);
  primeLiveProjectSnapshots(projects, options.cacheScope);
  return {
    projects,
    accountOptions: buildAccountOptions(payload.data),
    total: pagination.total,
    pagination
  };
}

export async function fetchAccountOptions(signal?: AbortSignal): Promise<LiveProjectAccountOption[]> {
  const accounts: AccountSummary[] = [];
  let offset = 0;
  while (true) {
    const response = await fetch(`/api/accounts?limit=100${offset ? `&offset=${offset}` : ""}`, { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) throw new LiveProjectsError(`Could not load CRM accounts: ${response.status}`, response.status);
    const payload = await response.json() as AccountsResponse;
    accounts.push(...payload.data);
    const page = payload.meta?.pagination;
    if (!page?.hasNextPage) break;
    if (!page.returned || page.offset + page.returned <= offset) throw new LiveProjectsError("Client pagination did not advance. Retry loading clients.", 502);
    offset = page.offset + page.returned;
  }
  return Array.from(new Map(accounts.map(account => [account.id, account])).values()).map(mapAccountSummaryToOption).sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchLiveProjectById(
  projectId: string,
  options: { signal?: AbortSignal; cacheScope?: string } = {}
): Promise<Project | null> {
  throwIfAborted(options.signal);

  const cacheKey = getLiveProjectCacheKey(projectId, options.cacheScope);
  const snapshot = readLiveProjectSnapshot(projectId, options.cacheScope);
  if (snapshot) {
    return abortForCaller(Promise.resolve(snapshot.project), options.signal);
  }

  let sharedRequest = liveProjectRequests.get(cacheKey);
  if (!sharedRequest) {
    const requestGeneration = snapshotGeneration;
    sharedRequest = requestLiveProject(projectId)
      .then((project) => {
        if (requestGeneration === snapshotGeneration) writeLiveProjectSnapshot(cacheKey, project);
        return project;
      })
      .finally(() => {
        if (requestGeneration === snapshotGeneration) liveProjectRequests.delete(cacheKey);
      });
    liveProjectRequests.set(cacheKey, sharedRequest);
  }

  return abortForCaller(sharedRequest, options.signal);
}

export function readLiveProjectSnapshot(projectId: string, cacheScope?: string): LiveProjectSnapshotResult | null {
  const cacheKey = getLiveProjectCacheKey(projectId, cacheScope);
  const snapshot = liveProjectSnapshots.get(cacheKey);
  if (!snapshot) return null;
  if (snapshot.expiresAt <= Date.now()) {
    liveProjectSnapshots.delete(cacheKey);
    return null;
  }
  return { project: snapshot.project };
}

export function clearLiveProjectSnapshotCache() {
  snapshotGeneration += 1;
  liveProjectSnapshots.clear();
  liveProjectRequests.clear();
}

function primeLiveProjectSnapshots(projects: Project[], cacheScope?: string) {
  projects.forEach((project) => {
    writeLiveProjectSnapshot(getLiveProjectCacheKey(project.id, cacheScope), project);
  });
}

async function requestLiveProject(projectId: string): Promise<Project | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new LiveProjectsError(`Could not load live project: ${response.status}`, response.status);
  }

  return mapProjectSummaryToUiProject((await response.json()) as ProjectSummary);
}

function writeLiveProjectSnapshot(cacheKey: string, project: Project | null) {
  liveProjectSnapshots.set(cacheKey, {
    expiresAt: Date.now() + LIVE_PROJECT_SNAPSHOT_TTL_MS,
    project
  });
}

function getLiveProjectCacheKey(projectId: string, cacheScope?: string) {
  return `${resolveLiveProjectCacheScope(cacheScope)}:${projectId}`;
}

function resolveLiveProjectCacheScope(cacheScope?: string) {
  const explicitScope = cacheScope?.trim().toLowerCase();
  if (explicitScope) return explicitScope;
  if (typeof window === "undefined") return "anonymous";

  try {
    const rawUser = window.localStorage.getItem("crm_auth_user");
    if (!rawUser) return "anonymous";
    const user = JSON.parse(rawUser) as { id?: string | null; email?: string | null };
    return user.id?.trim().toLowerCase() || user.email?.trim().toLowerCase() || "anonymous";
  } catch {
    return "anonymous";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function abortForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => signal.removeEventListener("abort", handleAbort);

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function createAbortError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function isUnauthorizedLiveProjectsError(error: unknown) {
  return error instanceof LiveProjectsError && error.status === 401;
}

export function mapProjectSummaryToUiProject(project: ProjectSummary): Project {
  const color = project.color || colorForId(project.id);
  const status = toUiStatus(project.status);
  const taskCount = project.taskCount ?? 0;
  const completedTaskCount = project.completedTaskCount ?? (status === "Completed" ? taskCount : 0);
  const uniqueMembers = uniqueProjectMembers(project.members ?? []);
  const members = uniqueMembers.map((member) => ({
    id: member.userId,
    name: member.displayName,
    email: member.email,
    avatarUrl: member.avatarUrl,
    initials: initialsFor(member.displayName || member.email || member.userId),
    color: colorForId(member.userId),
    assignedTaskCount: member.assignedTaskCount ?? 0,
    doneTaskCount: member.doneTaskCount ?? 0,
    doneTaskPercent: member.doneTaskPercent ?? 0
  }));
  const projectType = project.projectType || project.opportunityStage || "delivery";

  return {
    id: project.id,
    hierarchyOrderVersion: project.hierarchyOrderVersion,
    accountId: project.accountId,
    name: project.name,
    description: buildDescription(project),
    status,
    priority: project.priority ? `${project.priority[0].toUpperCase()}${project.priority.slice(1)}` as Project["priority"] : toUiPriority(project.status, project.progressPercent),
    progress: clampPercent(project.progressPercent ?? (taskCount > 0 ? Math.round((completedTaskCount / taskCount) * 100) : status === "Completed" ? 100 : 0)),
    budget: project.budgetAmount ?? 0,
    spent: project.spentAmount ?? 0,
    startDate: formatUiDate(project.plannedStartAt),
    dueDate: formatUiDate(project.plannedEndAt),
    members,
    ownerUserId: project.ownerUserId,
    ownerDisplayName: project.ownerDisplayName,
    ownerAvatarUrl: project.ownerAvatarUrl,
    memberUserIds: uniqueStrings(project.memberUserIds ?? members.map((member) => member.id).filter((id): id is string => Boolean(id))),
    projectType,
    scopeSummary: project.scopeSummary,
    budgetCurrency: project.budgetCurrency,
    tasks: { total: taskCount, done: completedTaskCount },
    plannedHours: minutesToHours(project.plannedMinutes),
    loggedHours: minutesToHours(project.loggedMinutes),
    pnlHours: minutesToHours(project.approvedMinutes),
    client: project.accountName || "Unassigned Account",
    color,
    tags: project.tags?.length ? project.tags : [project.code, formatProjectStatusLabel(project.status)].filter(Boolean),
    category: formatProjectCategory(projectType) || "Delivery"
  };
}

function minutesToHours(minutes?: number) {
  if (!minutes || minutes <= 0) return 0;
  return Math.round((minutes / 60 + Number.EPSILON) * 10) / 10;
}

function uniqueProjectMembers(members: NonNullable<ProjectSummary["members"]>) {
  const unique = new Map<string, ProjectMemberSummary>();

  for (const member of members) {
    const key = member.userId;
    if (!key) {
      continue;
    }
    const existing = unique.get(key);
    unique.set(key, existing ? mergeProjectMember(existing, member) : member);
  }

  return Array.from(unique.values());
}

function mergeProjectMember(
  existing: ProjectMemberSummary,
  incoming: ProjectMemberSummary
): ProjectMemberSummary {
  return {
    ...incoming,
    userId: existing.userId || incoming.userId,
    displayName: existing.displayName || incoming.displayName,
    email: existing.email || incoming.email,
    avatarUrl: existing.avatarUrl || incoming.avatarUrl,
    relation: existing.relation === "member" ? existing.relation : incoming.relation || existing.relation,
    assignedTaskCount: Math.max(existing.assignedTaskCount ?? 0, incoming.assignedTaskCount ?? 0),
    doneTaskCount: Math.max(existing.doneTaskCount ?? 0, incoming.doneTaskCount ?? 0),
    doneTaskPercent: percent(
      Math.max(existing.doneTaskCount ?? 0, incoming.doneTaskCount ?? 0),
      Math.max(existing.assignedTaskCount ?? 0, incoming.assignedTaskCount ?? 0)
    )
  };
}

function percent(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeIdentity(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function toBackendProjectStatus(status: Project["status"]) {
  const map: Record<Project["status"], string> = {
    Active: "in_progress",
    "In Review": "in_review",
    Planning: "planning",
    "On Hold": "on_hold",
    Completed: "completed",
    "At Risk": "at_risk"
  };
  return map[status];
}

export function buildAccountOptions(projects: ProjectSummary[]): LiveProjectAccountOption[] {
  const seen = new Map<string, LiveProjectAccountOption>();
  for (const project of projects) {
    const label = project.accountName || "Unassigned Account";
    if (!project.accountId || seen.has(project.accountId)) {
      continue;
    }
    seen.set(project.accountId, {
      value: label,
      label,
      accountId: project.accountId
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function mapAccountSummaryToOption(account: AccountSummary): LiveProjectAccountOption {
  return {
    value: account.name,
    label: account.name,
    accountId: account.id
  };
}

function buildDescription(project: ProjectSummary) {
  if (project.scopeSummary?.trim()) {
    return project.scopeSummary.trim();
  }
  const parts = [
    project.code,
    project.opportunityTitle ? `Opportunity: ${project.opportunityTitle}` : undefined,
    project.stageCount ? `${project.stageCount} stages` : undefined,
    project.taskCount ? `${project.taskCount} tasks` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Imported from operational CRM data.";
}

function toUiStatus(status: string): Project["status"] {
  const normalized = status.toLowerCase();
  if (["completed", "done", "closed"].includes(normalized)) return "Completed";
  if (["in_review", "review"].includes(normalized)) return "In Review";
  if (["planning", "not_started", "todo"].includes(normalized)) return "Planning";
  if (["on_hold", "paused"].includes(normalized)) return "On Hold";
  if (["at_risk", "blocked", "cancelled"].includes(normalized)) return "At Risk";
  return "Active";
}

function toUiPriority(status: string, progress?: number): Project["priority"] {
  const normalized = status.toLowerCase();
  if (["at_risk", "blocked", "cancelled"].includes(normalized)) return "Critical";
  if (["on_hold", "paused", "pause"].includes(normalized)) return "Low";
  if ((progress ?? 0) < 20 && normalized !== "completed") return "High";
  return "Medium";
}

export function formatProjectStatusLabel(status?: string) {
  if (!status) return "";
  const normalized = status.trim().toLowerCase();
  const labels: Record<string, string> = {
    active: "Active",
    in_progress: "In progress",
    started: "In progress",
    onboarding: "Onboarding",
    discovery: "Discovery",
    in_review: "In review",
    review: "In review",
    planning: "Planning",
    not_started: "Not started",
    todo: "To do",
    on_hold: "On hold",
    paused: "Paused",
    pause: "Paused",
    completed: "Completed",
    done: "Done",
    closed: "Closed",
    at_risk: "At risk",
    blocked: "Blocked",
    cancelled: "Cancelled"
  };
  if (labels[normalized]) return labels[normalized];
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatProjectCategory(value?: string) {
  if (!value) return "";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function colorForId(id: string) {
  const hash = Array.from(id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return LIVE_COLORS[hash % LIVE_COLORS.length];
}

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PR";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "PR";
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatUiDate(value?: string) {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
