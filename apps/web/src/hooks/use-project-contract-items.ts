"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ProjectContractItemSummary } from "@b2b-crm/contracts";

/** Contract line items (hạng mục hợp đồng) of one project, shared by the overview block and the task forms. */
export interface ProjectContractItemsState {
  items: ProjectContractItemSummary[];
  /** PM (Admin) or the project's manager: may add/edit items and move tasks between them. */
  canManage: boolean;
  /** 6.1 Quyền: Admin accounts and the cost permission group see item values; a User account does not. */
  canViewValues: boolean;
  isInternalWorklog: boolean;
  loaded: boolean;
  error: string | null;
}

const EMPTY: ProjectContractItemsState = { items: [], canManage: false, canViewValues: false, isInternalWorklog: false, loaded: false, error: null };
const cache = new Map<string, ProjectContractItemsState>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export async function reloadProjectContractItems(projectId: string) {
  let next: ProjectContractItemsState;
  try {
    const principal = new URLSearchParams(window.location.search).get("principal")?.trim();
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/contract-items${principal ? `?principal=${encodeURIComponent(principal)}` : ""}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Không tải được hạng mục hợp đồng: ${response.status}`);
    const body = await response.json();
    next = { items: body.data ?? [], canManage: body.meta?.canManage === true, canViewValues: body.meta?.canViewValues === true, isInternalWorklog: body.meta?.isInternalWorklog === true, loaded: true, error: null };
  } catch (error) {
    next = { ...(cache.get(projectId) ?? EMPTY), loaded: true, error: error instanceof Error ? error.message : "Không tải được hạng mục hợp đồng" };
  }
  cache.set(projectId, next);
  listeners.forEach((listener) => listener());
}

// Several components mount this hook for one project at once: they share one mount-time request.
const mountLoads = new Set<string>();

/** Renders the cached value at once, then refetches on every mount so another screen's edits show up. */
export function useProjectContractItems(projectId: string): ProjectContractItemsState & { refresh: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, () => cache.get(projectId) ?? EMPTY, () => EMPTY);
  useEffect(() => {
    if (!projectId || mountLoads.has(projectId)) return;
    mountLoads.add(projectId);
    void reloadProjectContractItems(projectId).finally(() => mountLoads.delete(projectId));
  }, [projectId]);
  const refresh = useCallback(() => reloadProjectContractItems(projectId), [projectId]);
  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

/** D-06: the item the system assigns — the only one, or the root item (HĐ gốc). */
export function defaultContractItemId(items: ProjectContractItemSummary[]) {
  const active = items.filter((item) => item.status === "active");
  return (active.find((item) => item.kind === "ROOT") ?? active[0])?.id;
}
