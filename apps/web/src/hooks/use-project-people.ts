"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchProjectPeople, type ProjectPeople } from "@/lib/project-people";
const empty: ProjectPeople = { members: [], principalUserId: "", permissions: { canManage: false, canLogForOthers: false } };
export function useProjectPeople(projectId?: string) {
  const [data, setData] = useState<ProjectPeople>(empty);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setData(empty); setError(null);
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    fetchProjectPeople(projectId, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load project members.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, revision]);
  return { ...data, loading, error, refresh };
}
