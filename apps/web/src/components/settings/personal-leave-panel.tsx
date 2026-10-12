"use client";

/**
 * D-09: personal leave is read from the approved leave requests of the Lark Approval flow. Read-only here —
 * a wrong row is fixed in Lark and synced again.
 */
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage, readApiError } from "@/lib/api-error";

interface PersonalLeaveRow {
  id: string;
  userName: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  leaveType?: string;
  status: string;
  syncedAt: string;
}

interface PersonalLeaveResponse {
  data: PersonalLeaveRow[];
  meta: { configured: boolean; messagingEnabled: boolean; lastSync: { at: string; status: string; detail: string } | null };
}

const SYNC_STATUS_LABELS: Record<string, string> = { sent: "Thành công", disabled: "Chưa bật", failed: "Lỗi" };
const day = (value: string) => value.split("-").reverse().join("/");
const dateTime = (value: string) => new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });

function rangeLabel(row: PersonalLeaveRow) {
  if (row.startDate === row.endDate) return `${day(row.startDate)}${row.startHalfDay || row.endHalfDay ? ` (nửa ngày ${row.startHalfDay ? "chiều" : "sáng"})` : ""}`;
  return `${day(row.startDate)}${row.startHalfDay ? " (từ chiều)" : ""} – ${day(row.endDate)}${row.endHalfDay ? " (hết sáng)" : ""}`;
}

function endpoint() {
  const principal = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("principal")?.trim();
  return `/api/admin/personal-leave${principal ? `?principal=${encodeURIComponent(principal)}` : ""}`;
}

export function PersonalLeavePanel() {
  const [list, setList] = useState<PersonalLeaveResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint(), { cache: "no-store", credentials: "same-origin", signal });
      if (!response.ok) throw await readApiError(response);
      setList((await response.json()) as PersonalLeaveResponse);
      setError(null);
    } catch (failure) {
      if (!signal?.aborted) setError(apiErrorMessage(failure, "Không tải được ngày nghỉ cá nhân."));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await fetch(endpoint(), { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw await readApiError(response);
      await load();
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không đồng bộ được ngày nghỉ cá nhân."));
    } finally {
      setSyncing(false);
    }
  };

  const lastSync = list?.meta.lastSync;
  return (
    <section aria-label="Ngày nghỉ cá nhân" className="mt-8 rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="!text-base font-bold text-slate-900">Ngày nghỉ cá nhân</h2>
          <p className="mt-1 text-sm text-slate-500">
            Lấy từ đơn nghỉ phép đã duyệt trên Lark Approval, chỉ xem. Nghỉ cả ngày thì không ghi giờ và không bị nhắc thiếu log; nghỉ nửa ngày thì trần giờ của ngày còn một nửa.
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {lastSync ? `Đồng bộ gần nhất: ${dateTime(lastSync.at)} · ${SYNC_STATUS_LABELS[lastSync.status] ?? lastSync.status}${lastSync.detail ? ` — ${lastSync.detail}` : ""}` : "Chưa đồng bộ lần nào."}
            {list && !list.meta.configured ? " Chưa cấu hình mã Approval nghỉ phép." : ""}
          </p>
        </div>
        <button type="button" onClick={sync} disabled={syncing} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {syncing ? "Đang đồng bộ…" : "Đồng bộ ngay"}
        </button>
      </header>
      {error ? <p role="alert" className="px-5 py-3 text-sm text-red-700">{error}</p> : null}
      {list && list.data.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">Chưa có ngày nghỉ cá nhân nào trong 30 ngày qua và sắp tới.</p> : null}
      {list && list.data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="px-5 py-3">Nhân sự</th><th className="px-5 py-3">Thời gian nghỉ</th><th className="px-5 py-3">Loại nghỉ</th><th className="px-5 py-3">Trạng thái</th><th className="px-5 py-3">Đồng bộ lúc</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.map((row) => (
                <tr key={row.id} className={row.status === "approved" ? "" : "text-slate-400"}>
                  <td className="px-5 py-3 font-semibold text-slate-900">{row.userName}</td>
                  <td className="px-5 py-3">{rangeLabel(row)}</td>
                  <td className="px-5 py-3">{row.leaveType ?? "—"}</td>
                  <td className="px-5 py-3">{row.status === "approved" ? "Đã duyệt" : "Đã huỷ"}</td>
                  <td className="px-5 py-3">{dateTime(row.syncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
