"use client";
import { useEffect, useState } from "react";
import type { WorkspaceUserOption } from "@/lib/workspace-users";
type Change = { id: string; changedByUserId: string; changedAt: string; before: { ownerUserId?: string; assigneeUserId?: string }; after: { ownerUserId?: string; assigneeUserId?: string } };
export function AssignmentHistory({ taskId, revision, people }: { taskId: string; revision: string; people: WorkspaceUserOption[] }) {
  const [rows, setRows] = useState<Change[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/assignment-history`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(`Could not load assignment history (${response.status}).`); return response.json(); })
      .then(body => { if (!controller.signal.aborted) setRows(body.data); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId, revision, retry]);
  const name = (id?: string) => id ? (people.find(person => person.id === id)?.name || id) : "Chưa giao";
  return <details className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">
    <summary className="cursor-pointer font-semibold">Lịch sử phân công</summary>
    {loading ? <p role="status">Đang tải lịch sử…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Thử lại</button></p> : rows.length ? <ol className="mt-3 space-y-3">{rows.map(row => <li key={row.id} className="break-words"><p>{name(row.changedByUserId)} · <time dateTime={row.changedAt}>{new Date(row.changedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></p><p>Người phụ trách: {name(row.before.assigneeUserId)} thành {name(row.after.assigneeUserId)}</p>{row.before.ownerUserId !== row.after.ownerUserId && <p>Owner: {name(row.before.ownerUserId)} thành {name(row.after.ownerUserId)}</p>}</li>)}</ol> : <p className="mt-2 text-muted-foreground">Chưa có thay đổi phân công.</p>}
  </details>;
}
