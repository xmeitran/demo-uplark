import type { AdminAccessMemberSummary } from "@b2b-crm/contracts";

const WORKSPACE_USERS_ENDPOINT = "/api/workspace/users";
const USER_COLORS = ["#2563eb", "#059669", "#7c3aed", "#db2777", "#d97706", "#dc2626", "#0891b2", "#64748b"];

type WorkspaceDirectoryMember = Pick<AdminAccessMemberSummary, "id" | "email" | "displayName" | "avatarUrl" | "roleCodes" | "status" | "departmentCode"> & { resourceDisplayRole?: string };

export interface WorkspaceUserOption {
  id: string;
  email: string;
  name: string;
  initials: string;
  color: string;
  avatarUrl?: string;
  role: string;
  department?: string;
  status: AdminAccessMemberSummary["status"];
}

export class WorkspaceUsersError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkspaceUsersError";
  }
}

export async function fetchWorkspaceUserOptions(signal?: AbortSignal): Promise<WorkspaceUserOption[]> {
  const response = await fetch(WORKSPACE_USERS_ENDPOINT, {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });

  if (!response.ok) {
    throw new WorkspaceUsersError(`Could not load workspace users: ${response.status}`, response.status);
  }

  const payload = (await response.json()) as { data: WorkspaceDirectoryMember[] };
  return payload.data.filter((user) => user.status === "active").map(mapWorkspaceUserToOption);
}

export function mapWorkspaceUserToOption(user: WorkspaceDirectoryMember): WorkspaceUserOption {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    initials: initialsFor(user.displayName || user.email),
    color: colorForId(user.id || user.email),
    avatarUrl: user.avatarUrl,
    role: user.resourceDisplayRole || formatRole(user.roleCodes[0]) || "Team member",
    department: user.departmentCode,
    status: user.status
  };
}

export function isUnauthorizedWorkspaceUsersError(error: unknown) {
  return error instanceof WorkspaceUsersError && error.status === 401;
}

function formatRole(roleCode?: string) {
  if (!roleCode) return "";
  return roleCode
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "U";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[words.length - 1][0] ?? ""}`.toUpperCase();
}

function colorForId(id: string) {
  const hash = Array.from(id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return USER_COLORS[hash % USER_COLORS.length];
}
