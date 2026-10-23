import type { AdminAccessMemberSummary, WorkspaceSystemRole } from "@b2b-crm/contracts";
import { useEffect, useState } from "react";
import { businessRoleFromMember, systemRoleFromCodes } from "./people-roles";

const WORKSPACE_USERS_ENDPOINT = "/api/workspace/users";
const USER_COLORS = ["#2563eb", "#059669", "#7c3aed", "#db2777", "#d97706", "#dc2626", "#0891b2", "#64748b"];

type WorkspaceDirectoryMember = Pick<AdminAccessMemberSummary, "id" | "email" | "displayName" | "avatarUrl" | "roleCodes" | "status"> & { resourceDisplayRole?: string };

export interface WorkspaceUserOption {
  id: string;
  email: string;
  name: string;
  initials: string;
  color: string;
  avatarUrl?: string;
  role: string;
  systemRole: WorkspaceSystemRole;
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
    initials: avatarInitialsFor(user.displayName || user.email),
    color: avatarColorFor(user.id || user.email),
    avatarUrl: user.avatarUrl,
    role: businessRoleFromMember(user),
    systemRole: systemRoleFromCodes(user.roleCodes),
    status: user.status
  };
}

export function isUnauthorizedWorkspaceUsersError(error: unknown) {
  return error instanceof WorkspaceUsersError && error.status === 401;
}

export function avatarInitialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "U";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[words.length - 1][0] ?? ""}`.toUpperCase();
}

export function avatarColorFor(id: string) {
  const hash = Array.from(id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return USER_COLORS[hash % USER_COLORS.length];
}

export type AvatarLookup = (person: { id?: string; email?: string; name?: string }) => string | undefined;

const personKey = (text?: string) => (text ?? "").trim().toLocaleLowerCase("vi");
let avatarDirectory: Promise<Map<string, string>> | undefined;

/** One directory read per page load, every status (a deactivated PIC still has a face); keyed by id, email and name. */
function loadAvatarDirectory() {
  avatarDirectory ??= fetch(WORKSPACE_USERS_ENDPOINT, { cache: "no-store", credentials: "same-origin" })
    .then((response) => (response.ok ? (response.json() as Promise<{ data: WorkspaceDirectoryMember[] }>) : { data: [] }))
    .then((payload) => {
      const map = new Map<string, string>();
      for (const user of payload.data ?? []) {
        if (!user.avatarUrl) continue;
        map.set(user.id, user.avatarUrl);
        if (user.email) map.set(personKey(user.email), user.avatarUrl);
        // A name shared by two people must not borrow either face.
        const nameKey = `name:${personKey(user.displayName)}`;
        map.set(nameKey, map.has(nameKey) ? "" : user.avatarUrl);
      }
      return map;
    })
    .catch(() => { avatarDirectory = undefined; return new Map<string, string>(); });
  return avatarDirectory;
}

/** Avatar of a person a list only knows by id, email or name — so every person picker shows the same faces. */
export function useWorkspaceAvatars(): AvatarLookup {
  const [directory, setDirectory] = useState<Map<string, string>>();
  useEffect(() => {
    let alive = true;
    void loadAvatarDirectory().then((map) => { if (alive) setDirectory(map); });
    return () => { alive = false; };
  }, []);
  return ({ id, email, name }) => (id && directory?.get(id)) || (email && directory?.get(personKey(email))) || (name && directory?.get(`name:${personKey(name)}`)) || undefined;
}
