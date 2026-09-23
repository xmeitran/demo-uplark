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
    const body = await response.json();
    for (const member of body.data ?? []) if (member.userId && member.status === "active") {
      members.set(member.userId, mapWorkspaceUserToOption({ ...member, id: member.userId }));
    }
    permissions = body.meta.permissions;
    principalUserId = body.meta.principalUserId;
    const page = body.meta.pagination;
    if (!page.hasNextPage) break;
    if (!page.returned || page.offset + page.returned <= offset) throw new Error("Project member pagination did not advance. Retry loading members.");
    offset = page.offset + page.returned;
  }
  return { members: [...members.values()], principalUserId, permissions };
}
