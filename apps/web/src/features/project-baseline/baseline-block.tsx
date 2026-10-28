"use client";

/**
 * "Baseline" on the project detail page (rules 6.3, D-20, D-21; chốt 13/10): ONE baseline of the plan (milestone,
 * timeline, giờ dự kiến) — no money, no commercial layer — whether it is locked, and the version history with what
 * changed and why.
 * Renders what GET /projects/:id/baseline returns; an Admin can lock or re-lock with a reason.
 */
import { UserAvatar } from "@/components/user-avatar";
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Lock, LockOpen } from "lucide-react";
import type { ProjectBaselineResponse } from "@b2b-crm/contracts";
import { apiErrorMessage, readApiError } from "@/lib/api-error";
import { formatVietnamDate } from "@/lib/vietnam-time";
import { baselineCauseLabel, baselineDiffLine } from "./baseline-view";

function withPrincipal(path: string) {
  const principal = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("principal")?.trim();
  return principal ? `${path}?principal=${encodeURIComponent(principal)}` : path;
}

export function ProjectBaselineBlock({ projectId, refreshKey, className = "" }: {
  projectId: string;
  /** Reload when it changes (a gate was approved, the status moved). */
  refreshKey?: unknown;
  className?: string;
}) {
  const [baseline, setBaseline] = useState<ProjectBaselineResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = withPrincipal(`/api/projects/${encodeURIComponent(projectId)}/baseline`);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<ProjectBaselineResponse>) : null))
      .then((body) => setBaseline(body))
      .catch(() => undefined);
    return () => controller.abort();
  }, [url, refreshKey]);

  if (!baseline || (!baseline.history.length && !baseline.canCapture)) return null;

  const capture = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }) });
      if (!response.ok) throw await readApiError(response);
      setBaseline((await response.json()) as ProjectBaselineResponse);
      setCapturing(false);
      setReason("");
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không lưu được baseline. Vui lòng thử lại."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="group" aria-label="Baseline" className={`rounded-lg border border-border bg-background px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Baseline</span>
        <span title="Milestone, timeline và giờ dự kiến" className={`rounded-full px-2.5 py-1 text-xs font-bold ${baseline.current ? "bg-muted text-foreground" : "bg-muted/40 text-muted-foreground"}`}>{baseline.current ? `Phiên bản ${baseline.current.version}` : "Chưa có"}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${baseline.locked ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {baseline.locked ? <Lock aria-hidden="true" className="h-3 w-3" /> : <LockOpen aria-hidden="true" className="h-3 w-3" />}
          {baseline.locked ? "Baseline đã khóa" : "Chưa khóa"}
        </span>
        <span className="text-xs text-muted-foreground">{baseline.locked ? "Thay đổi timeline hoặc giờ dự kiến cần nêu lý do và được Admin duyệt." : "Khóa khi G1 được duyệt."}</span>
        <span className="ml-auto flex items-center gap-3">
          {baseline.canCapture && !capturing ? <button type="button" onClick={() => { setCapturing(true); setError(null); }} className="text-xs font-semibold text-primary hover:underline">{baseline.locked ? "Cập nhật baseline" : "Khóa baseline"}</button> : null}
          {baseline.history.length ? (
            <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:underline">
              {open ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />} Lịch sử phiên bản ({baseline.history.length})
            </button>
          ) : null}
        </span>
      </div>

      {capturing ? (
        <form className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) void capture(); }}>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-semibold text-foreground">Lý do {baseline.locked ? "tạo phiên bản mới" : "khóa baseline"} *</span>
            <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <span className="flex gap-2">
            <button type="submit" disabled={saving || !reason.trim()} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60">{saving ? "Đang lưu…" : "Lưu phiên bản"}</button>
            <button type="button" onClick={() => setCapturing(false)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Hủy</button>
          </span>
        </form>
      ) : null}
      {error ? <p role="alert" className="mt-1.5 text-xs text-rose-600">{error}</p> : null}

      {open ? (
        <ul className="mt-2 space-y-2 border-t border-border pt-2">
          {baseline.history.map((version) => (
            <li key={version.id} className="text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Phiên bản {version.version}</span> · {baselineCauseLabel(version)} · {version.createdByName ? <UserAvatar name={version.createdByName} size="xs" className="mr-1 align-middle" /> : null}{version.createdByName ?? "Hệ thống"} · {formatVietnamDate(version.createdAt)}
              </p>
              <p className="text-foreground">{version.reason}</p>
              {version.diff.length ? (
                <ul className="mt-0.5 list-disc pl-4">{version.diff.slice(0, 8).map((entry) => <li key={`${entry.entity}-${entry.id}`}>{baselineDiffLine(entry)}</li>)}{version.diff.length > 8 ? <li>… và {version.diff.length - 8} thay đổi khác</li> : null}</ul>
              ) : version.version === 1 ? <p>Phiên bản đầu: {version.totals.tasks} task, {Math.round((version.totals.estimateMinutes / 60) * 10) / 10} giờ dự kiến.</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
