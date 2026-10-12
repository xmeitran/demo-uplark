"use client";

/**
 * V-02: the project's two Lark groups (nội bộ, khách hàng). Nothing is shown once both exist; otherwise the state
 * "Chưa tạo được nhóm" with the reason, and "Tạo lại nhóm" for Admin and the project's PM.
 */
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage, readApiError } from "@/lib/api-error";

interface LarkGroupState {
  status: string;
  statusLabel: string;
  hasInternalGroup: boolean;
  hasCustomerGroup: boolean;
  error?: string;
  canRecreate: boolean;
}

function endpoint(projectId: string) {
  const principal = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("principal")?.trim();
  return `/api/projects/${encodeURIComponent(projectId)}/lark-groups${principal ? `?principal=${encodeURIComponent(principal)}` : ""}`;
}

export function LarkGroupsControl({ projectId, className = "" }: { projectId: string; className?: string }) {
  const [state, setState] = useState<LarkGroupState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (method: "GET" | "POST", signal?: AbortSignal) => {
    const response = await fetch(endpoint(projectId), { method, cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) throw await readApiError(response);
    setState((await response.json()) as LarkGroupState);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    // Customers and people without access simply do not see the control.
    request("GET", controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [request]);

  if (!state || state.status === "created") return null;

  const recreate = async () => {
    setSaving(true);
    setError(null);
    try {
      await request("POST");
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không tạo lại được nhóm Lark."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}>
      <span className="font-semibold">Nhóm Lark: {state.statusLabel}</span>
      <span className="text-amber-800">
        Nội bộ: {state.hasInternalGroup ? "đã có" : "chưa có"} · Khách hàng: {state.hasCustomerGroup ? "đã có" : "chưa có"}
        {state.error ? ` — ${state.error}` : ""}
      </span>
      {state.canRecreate ? (
        <button type="button" onClick={recreate} disabled={saving} className="ml-auto rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60">
          {saving ? "Đang tạo…" : "Tạo lại nhóm"}
        </button>
      ) : null}
      {error ? <p role="alert" className="w-full text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
