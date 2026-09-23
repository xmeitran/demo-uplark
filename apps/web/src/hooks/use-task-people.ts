"use client";
import { useCallback, useEffect, useState } from "react";
import { useProjectPeople } from "./use-project-people";
import { canLogForWorkspaceMember } from "@/lib/task-people-policy";
import { useAuth } from "@/lib/auth";
import { fetchWorkspaceUserOptions, type WorkspaceUserOption } from "@/lib/workspace-users";
/** Project assignments use persisted membership; standalone tasks retain the workspace directory. */
export function useTaskPeople(projectId?: string, enabled = true) {
  const project = useProjectPeople(enabled ? projectId : undefined);
  const { user, isLoading } = useAuth();
  const [members, setMembers] = useState<WorkspaceUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled || projectId) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetchWorkspaceUserOptions(controller.signal).then(rows => { if (!controller.signal.aborted) setMembers(rows); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load workspace members."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, enabled, revision]);
  if (projectId) return project;
  return { members, principalUserId: user?.id ?? "", permissions: { canManage: false, canLogForOthers: canLogForWorkspaceMember(user?.roleCodes) }, loading: loading || isLoading, error, refresh };
}
