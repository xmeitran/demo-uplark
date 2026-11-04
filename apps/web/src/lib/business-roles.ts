"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRolesResponse } from "@b2b-crm/contracts";

type WorkspaceRoles = WorkspaceRolesResponse["data"];
// One request per page load, shared by every component; Admin › Setting refreshes it after a change.
let cached: Promise<WorkspaceRoles> | undefined;

function loadRoles(fresh = false) {
  if (!cached || fresh) {
    cached = fetch("/api/admin/business-roles", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as WorkspaceRolesResponse).data : Promise.reject(new Error("Không tải được danh sách vai trò."))));
    cached.catch(() => { cached = undefined; });
  }
  return cached;
}

/** The organization's role names set in Admin › Setting. `businessRoleLabel(code)` is the name shown for a person's business role. */
export function useWorkspaceRoles() {
  const [roles, setRoles] = useState<WorkspaceRoles | null>(null);
  useEffect(() => {
    let live = true;
    loadRoles().then((next) => { if (live) setRoles(next); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const reload = useCallback(async () => setRoles(await loadRoles(true)), []);
  const businessRoleLabel = useCallback((code?: string | null) => (code ? roles?.businessRoles.find((role) => role.code === code)?.label : undefined), [roles]);
  return { roles, reload, businessRoleLabel };
}
