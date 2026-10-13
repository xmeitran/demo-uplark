"use client";

/**
 * Stage extensions on a gate card (TD-04, TD-05, D-21): how many times the stage's due date was extended, why, and
 * the "Gia hạn stage" action for an Admin (PM, Dx Director). Every extension counts (chốt 13/10).
 */
import React, { useState } from "react";
import type { ProjectGateListResponse, ProjectStageSlaSummary } from "@b2b-crm/contracts";
import { apiErrorMessage, readApiError } from "@/lib/api-error";
import { formatVietnamDate } from "@/lib/vietnam-time";

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

export function StageExtensions({ projectId, sla, onExtended }: {
  projectId: string;
  sla: ProjectStageSlaSummary;
  onExtended: (list: ProjectGateListResponse) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [newDueAt, setNewDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extensions = sla.extensions ?? [];
  if (!extensions.length && !sla.canExtend) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(sla.stageId)}/extensions`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ newDueAt, reason: reason.trim() })
      });
      if (!response.ok) throw await readApiError(response);
      setOpen(false);
      setNewDueAt("");
      setReason("");
      await onExtended((await response.json()) as ProjectGateListResponse);
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không lưu được gia hạn. Vui lòng thử lại."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div aria-label={`Gia hạn stage ${sla.stageName}`} className="mt-3 rounded-lg bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">Gia hạn stage: {sla.extensionCount ?? 0} lần</span>
        {sla.extensionAbnormal ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Bất thường</span> : null}
        {sla.extendedDueAt ? <span>· hạn sau gia hạn <span className="text-foreground">{formatVietnamDate(sla.extendedDueAt)}</span></span> : null}
        {sla.canExtend && !open ? <button type="button" onClick={() => { setOpen(true); setError(null); }} className="ml-auto rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground">Gia hạn stage</button> : null}
      </div>
      {extensions.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {extensions.map((item) => (
            <li key={item.id}>
              {item.previousDueAt ? `${formatVietnamDate(item.previousDueAt)} → ` : ""}{formatVietnamDate(item.newDueAt)} · <span className="text-foreground">{item.reason}</span> · {item.approvedByName ?? "Admin"} duyệt {formatVietnamDate(item.approvedAt)}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <form className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); if (newDueAt && reason.trim()) void submit(); }}>
          <label><span className="mb-1 block font-semibold text-foreground">Hạn mới *</span><input type="date" value={newDueAt} onChange={(event) => setNewDueAt(event.target.value)} className={inputClass} /></label>
          <label><span className="mb-1 block font-semibold text-foreground">Lý do gia hạn *</span><input type="text" value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} /></label>
          <span className="flex gap-2">
            <button type="submit" disabled={saving || !newDueAt || !reason.trim()} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60">{saving ? "Đang lưu…" : "Duyệt gia hạn"}</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold">Hủy</button>
          </span>
        </form>
      ) : null}
      {error ? <p role="alert" className="mt-1.5 text-rose-600">{error}</p> : null}
    </div>
  );
}
