"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceUserOption } from "@/lib/workspace-users";
import { getPriorityLabel, getStatusLabel, getTaskTypeLabel } from "./task-display-helpers";

type HistoryValue = Record<string, unknown> | null | undefined;

type TaskHistoryRow = {
  id: string;
  action: string;
  changedByUserId?: string | null;
  changedAt: string;
  before?: HistoryValue;
  after?: HistoryValue;
  reason?: string | null;
};

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function valueFor(row: TaskHistoryRow, key: string) {
  return row.after?.[key] ?? row.before?.[key];
}

function formatValue(key: string, value: unknown, people: WorkspaceUserOption[]) {
  if (value === null || value === undefined || value === "") return "Trống";
  if (key === "status") return getStatusLabel(String(value));
  if (key === "priority") return getPriorityLabel(String(value));
  if (key === "taskType") return getTaskTypeLabel(String(value));
  if (["ownerUserId", "assigneeUserId", "changedByUserId"].includes(key)) {
    return people.find((person) => person.id === String(value))?.name || String(value);
  }
  if (["plannedStartAt", "dueAt"].includes(key)) {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("vi-VN");
  }
  const text = String(value);
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    title: "Tên task",
    description: "Mô tả",
    taskType: "Loại công việc",
    taskTypeLayer1: "Nhóm task",
    taskTypeLayer2: "Bối cảnh task",
    status: "Trạng thái",
    priority: "Ưu tiên",
    ownerUserId: "Owner",
    assigneeUserId: "Người phụ trách",
    plannedStartAt: "Ngày bắt đầu",
    dueAt: "Hạn chót",
    estimateMinutes: "Estimate"
  };
  return labels[key] || key;
}

function changedFields(row: TaskHistoryRow) {
  const keys = Array.from(new Set([
    ...Object.keys(row.before || {}),
    ...Object.keys(row.after || {})
  ]));
  return keys.filter((key) => !sameValue(row.before?.[key], row.after?.[key]));
}

function actionLabel(action: string) {
  if (action === "task.created") return "Đã tạo công việc";
  if (action === "task.status_changed") return "Đã đổi trạng thái";
  if (action === "task.assignee_transferred") return "Đã đổi phân công";
  if (action === "task.project_changed") return "Đã đổi dự án";
  return "Đã cập nhật công việc";
}

function actorInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

function formatChangedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Vừa cập nhật";
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function TaskChangeHistory({
  taskId,
  principal,
  people,
  revision
}: {
  taskId: string;
  principal?: string;
  people: WorkspaceUserOption[];
  revision?: string;
}) {
  const [rows, setRows] = useState<TaskHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query = principal ? `?principal=${encodeURIComponent(principal)}&limit=30` : "?limit=30";
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/history${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Không thể tải lịch sử (${response.status}).`);
        return response.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) setRows(Array.isArray(body?.data) ? body.data : []);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setRows([]);
          setError(reason instanceof Error ? reason.message : "Không thể tải lịch sử.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [taskId, principal, revision]);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const nameFor = (userId?: string | null) => {
    if (!userId) return "Hệ thống";
    return peopleById.get(userId)?.name || userId;
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]" data-testid="task-change-history">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v6h6" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <div className="text-xs font-bold tracking-wide text-slate-700">Lịch sử cập nhập</div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{rows.length}</span>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <p className="py-5 text-center text-xs text-slate-400" role="status">Đang tải lịch sử…</p>
        ) : error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600" role="alert">{error}</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" />
              </svg>
            </div>
            <p className="text-xs text-slate-400">Chưa có thay đổi nào được ghi nhận.</p>
          </div>
        ) : (
          <ol className="max-h-[360px] space-y-4 overflow-auto pr-1">
            {rows.map((row, index) => {
              const actor = nameFor(row.changedByUserId);
              const fields = changedFields(row).filter((field) => !(row.action === "task.updated" && field === "status"));
              const displayedFields = fields.slice(0, 4);
              const overflowCount = Math.max(0, fields.length - displayedFields.length);
              return (
                <li key={row.id} className="relative flex gap-3">
                  {index < rows.length - 1 ? <span className="absolute left-[9px] top-6 h-[calc(100%+12px)] w-px bg-slate-100" aria-hidden="true" /> : null}
                  <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[8px] font-bold text-indigo-600 ring-4 ring-white">{actorInitials(actor)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold leading-snug text-slate-700">{actionLabel(row.action)}</p>
                      <time className="shrink-0 text-[10px] text-slate-400">{formatChangedAt(row.changedAt)}</time>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">{actor}</p>
                    {row.action === "task.status_changed" ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                        {formatValue("status", row.before?.status, people)} <span className="px-1 text-slate-300">→</span> {formatValue("status", row.after?.status, people)}
                      </p>
                    ) : displayedFields.length > 0 ? (
                      <div className="mt-1 space-y-0.5">
                        {displayedFields.map((field) => (
                          <p key={field} className="truncate text-[11px] leading-relaxed text-slate-600" title={`${fieldLabel(field)}: ${formatValue(field, row.before?.[field], people)} → ${formatValue(field, row.after?.[field], people)}`}>
                            <span className="font-medium text-slate-500">{fieldLabel(field)}:</span>{" "}
                            <span className="text-slate-400">{formatValue(field, row.before?.[field], people)}</span>
                            <span className="px-1 text-slate-300">→</span>
                            <span>{formatValue(field, row.after?.[field], people)}</span>
                          </p>
                        ))}
                        {overflowCount > 0 ? <p className="text-[10px] font-medium text-indigo-500">+{overflowCount} thay đổi khác</p> : null}
                      </div>
                    ) : null}
                    {row.reason ? <p className="mt-1 text-[10px] italic leading-relaxed text-slate-400">{row.reason}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
