import { mapWorkspaceUserToOption, type WorkspaceUserOption } from "./workspace-users";
export interface ProjectPeople { members: WorkspaceUserOption[]; principalUserId: string; permissions: { canManage: boolean; canLogForOthers: boolean } }
export async function fetchProjectPeople(projectId: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProjectPeople> {
  const members = new Map<string, WorkspaceUserOption>();
  let offset = 0;
  let principalUserId = "";
  let permissions = { canManage: false, canLogForOthers: false };
  while (true) {
    const response = await fetcher(`/api/projects/${encodeURIComponent(projectId)}/members?limit=100&offset=${offset}`, { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.message === "string" ? body.message : `Could not load project members (${response.status}).`);
    }
    const rawBody = await response.json();
    const body = rawBody && typeof rawBody === "object" ? rawBody : {};
    for (const member of Array.isArray(body.data) ? body.data : []) if (member && typeof member === "object" && typeof member.userId === "string" && member.status === "active") {
      members.set(member.userId, mapWorkspaceUserToOption({ ...member, id: member.userId }));
    }
    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
    const rawPermissions = meta.permissions && typeof meta.permissions === "object" ? meta.permissions : {};
    permissions = {
      canManage: typeof rawPermissions.canManage === "boolean" ? rawPermissions.canManage : permissions.canManage,
      canLogForOthers: typeof rawPermissions.canLogForOthers === "boolean" ? rawPermissions.canLogForOthers : permissions.canLogForOthers
    };
    principalUserId = typeof meta.principalUserId === "string" ? meta.principalUserId : principalUserId;
    const page = meta.pagination;
    if (!page || typeof page !== "object" || !page.hasNextPage) break;
    const pageOffset = page.offset;
    const pageReturned = page.returned;
    if (!Number.isInteger(pageOffset) || pageOffset < 0 || !Number.isInteger(pageReturned) || pageReturned <= 0 || pageOffset + pageReturned <= offset) {
      throw new Error("Project member pagination did not advance. Retry loading members.");
    }
    offset = pageOffset + pageReturned;
  }
  return { members: [...members.values()], principalUserId, permissions };
}
