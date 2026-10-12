"use client";

/**
 * The pending project status proposal on the status card (rules 5.1, V-17): what the system proposes, its basis,
 * and Xác nhận / Từ chối for the roles allowed to decide. The API only returns a proposal to those roles (7.7).
 */
import React, { useEffect, useState } from "react";
import type { ProjectStatusProposalSummary } from "@b2b-crm/contracts";
import { apiErrorMessage, readApiError } from "@/lib/api-error";
import { PROJECT_STATUS_CATALOGUE, normalizeProjectStatus, type ProjectStatusDefinition } from "@/lib/project-status";
import { formatVietnamDate } from "@/lib/vietnam-time";

function withPrincipal(path: string) {
  const principal = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("principal")?.trim();
  return principal ? `${path}?principal=${encodeURIComponent(principal)}` : path;
}

export function ProjectStatusProposalCard({ projectId, pending, onDecided, className = "" }: {
  projectId: string;
  /** The project's pending proposal, as the project response already carries it. */
  pending?: ProjectStatusProposalSummary | null;
  onDecided?: () => void | Promise<void>;
  className?: string;
}) {
  const [proposal, setProposal] = useState<ProjectStatusProposalSummary | null>(pending ?? null);
  const [mode, setMode] = useState<"idle" | "confirm" | "decline">("idle");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setProposal(pending ?? null); setMode("idle"); setError(null); }, [pending?.id]);

  if (!proposal) return null;
  const code = normalizeProjectStatus(proposal.proposedStatus);
  const definition: ProjectStatusDefinition | null = code ? PROJECT_STATUS_CATALOGUE[code] : null;
  // V-18: Tạm dừng needs a reason and Có rủi ro an action or blocker; the proposal pre-fills it when the rules give one.
  const needsReason = mode === "decline" || (mode === "confirm" && Boolean(definition?.reasonRequired));
  const reasonLabel = mode === "decline" ? "Lý do từ chối đề xuất" : definition?.reasonLabel ?? "Lý do";
  const open = (next: "confirm" | "decline") => { setMode(next); setError(null); setReason(next === "confirm" ? proposal.suggestedReason ?? "" : ""); };

  const decide = async (decision: "confirm" | "decline") => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(withPrincipal(`/api/projects/${encodeURIComponent(projectId)}/status-proposals/${encodeURIComponent(proposal.id)}/decision`), {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason: reason.trim() || undefined })
      });
      if (!response.ok) throw await readApiError(response);
      setProposal(null);
      await onDecided?.();
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không lưu được quyết định. Vui lòng thử lại."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="group" aria-label="Đề xuất trạng thái" className={`rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-800">Hệ thống đề xuất</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-sky-800">{proposal.proposedStatusLabel}</span>
        <span className="text-xs text-sky-900">Căn cứ: {proposal.basis} · {formatVietnamDate(proposal.createdAt)}</span>
        {proposal.canDecide && mode === "idle" ? (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => (definition?.reasonRequired ? open("confirm") : void decide("confirm"))} disabled={saving} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">Xác nhận</button>
            <button type="button" onClick={() => open("decline")} disabled={saving} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-muted-foreground">Từ chối</button>
          </span>
        ) : null}
      </div>
      {mode !== "idle" ? (
        <form className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); if (!needsReason || reason.trim()) void decide(mode); }}>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-semibold text-sky-900">{reasonLabel}{needsReason ? " *" : ""}</span>
            <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <span className="flex gap-2">
            <button type="submit" disabled={saving || (needsReason && !reason.trim())} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60">{saving ? "Đang lưu…" : mode === "confirm" ? "Xác nhận" : "Từ chối đề xuất"}</button>
            <button type="button" onClick={() => setMode("idle")} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold">Hủy</button>
          </span>
        </form>
      ) : null}
      {error ? <p role="alert" className="mt-1.5 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
