"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, Info, LockKeyhole, Pencil, Plus, Save, Unlock, X } from "lucide-react";
import type {
  CreateWorkspaceDayOffInput,
  UpdateWorkspaceDayOffInput,
  WorkspaceDayOffCategory,
  WorkspaceDayOffListResponse,
  WorkspaceDayOffSummary
} from "@b2b-crm/contracts";
import { toVietnamDateKey } from "@/lib/vietnam-time";
import { usePersistedFilter } from "@/lib/persisted-filters";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { FilterBar, FilterField, MultiSelectFilter, matchesAny } from "@/components/filters";

const CATEGORY_OPTIONS: Array<{ value: WorkspaceDayOffCategory; label: string }> = [
  { value: "national_holiday", label: "Ngày lễ nhà nước" },
  { value: "company_day_off", label: "Ngày nghỉ của công ty" },
  { value: "other", label: "Ngày nghỉ khác" }
];

function dateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("vi-VN", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh"
  });
}

function categoryLabel(category: WorkspaceDayOffCategory) {
  return CATEGORY_OPTIONS.find((item) => item.value === category)?.label ?? "Ngày nghỉ khác";
}

function responseError(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && "message" in message && typeof (message as { message?: unknown }).message === "string") {
    return (message as { message: string }).message;
  }
  return fallback;
}

export function WorkspaceDayOffSettings() {
  const [year, setYear] = usePersistedFilter("settings:day-off:year", Number(toVietnamDateKey(new Date()).slice(0, 4)));
  const [items, setItems] = useState<WorkspaceDayOffSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceDayOffSummary | null>(null);
  const today = toVietnamDateKey(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<WorkspaceDayOffCategory>("national_holiday");
  const [note, setNote] = useState("");
  const [categoryFilter, setCategoryFilter] = usePersistedFilter<string[]>("settings:day-off:categories", []);
  const [statusFilter, setStatusFilter] = usePersistedFilter<string[]>("settings:day-off:statuses", []);
  const currentYear = Number(today.slice(0, 4));
  // The picker lists the years around today plus the one being viewed; the arrows step without limit.
  const yearOptions = [...new Set([year, ...Array.from({ length: 8 }, (_, index) => currentYear - 5 + index)])].sort((a, b) => b - a).map((value) => ({ value: String(value), label: `Năm ${value}` }));
  const visibleItems = items.filter((item) => matchesAny(categoryFilter, item.category) && matchesAny(statusFilter, item.isActive ? "active" : "inactive"));
  const filterCount = [year !== currentYear, categoryFilter.length > 0, statusFilter.length > 0].filter(Boolean).length;
  const resetFilters = () => { setYear(currentYear); setCategoryFilter([]); setStatusFilter([]); };

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/day-offs?year=${year}`, {
        credentials: "same-origin", cache: "no-store", signal
      });
      const body = await response.json().catch(() => null) as WorkspaceDayOffListResponse | { message?: unknown } | null;
      if (!response.ok) throw new Error(responseError(body, "Không tải được danh sách ngày nghỉ."));
      const result = body as WorkspaceDayOffListResponse;
      setItems(result.data ?? []);
      setCanManage(Boolean(result.meta?.canManage));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Không tải được danh sách ngày nghỉ.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items]);
  const upcomingCount = useMemo(() => items.filter((item) => item.isActive && item.date >= today).length, [items, today]);

  const resetEditor = () => {
    setEditing(null);
    setStartDate(today);
    setEndDate(today);
    setName("");
    setCategory("national_holiday");
    setNote("");
    setError(null);
  };

  const beginEdit = (item: WorkspaceDayOffSummary) => {
    setEditing(item);
    setStartDate(item.date);
    setEndDate(item.date);
    setName(item.name);
    setCategory(item.category);
    setNote(item.note ?? "");
    setError(null);
    setNotice(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: CreateWorkspaceDayOffInput | UpdateWorkspaceDayOffInput = editing
        ? { date: startDate, name, category, note, expectedUpdatedAt: editing.updatedAt }
        : { startDate, endDate, name, category, note };
      const response = await fetch(editing ? `/api/workspace/day-offs/${encodeURIComponent(editing.id)}` : "/api/workspace/day-offs", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Không lưu được ngày nghỉ."));
      const count = Number((body as { meta?: { created?: number } })?.meta?.created ?? 1);
      setNotice(editing ? "Đã cập nhật ngày nghỉ." : `Đã khóa ${count} ngày; không thể lập kế hoạch hoặc ghi giờ trong các ngày này.`);
      resetEditor();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được ngày nghỉ.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: WorkspaceDayOffSummary) => {
    const nextActive = !item.isActive;
    if (!nextActive && !window.confirm(`Ngừng áp dụng ngày nghỉ ${dateLabel(item.date)}? Giờ đã ghi trong ngày này sẽ được tính phí trở lại nếu bản ghi gốc có bật tính phí.`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: UpdateWorkspaceDayOffInput = {
        isActive: nextActive,
        expectedUpdatedAt: item.updatedAt
      };
      const response = await fetch(`/api/workspace/day-offs/${encodeURIComponent(item.id)}`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Không đổi được trạng thái ngày nghỉ."));
      setNotice(nextActive ? `Đã khóa ngày ${dateLabel(item.date)}; không thể lập kế hoạch hoặc ghi giờ.` : `Đã bỏ khóa ngày ${dateLabel(item.date)}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đổi được trạng thái ngày nghỉ.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm lg:col-span-2" aria-labelledby="workspace-day-off-title">
      <div className="rounded-t-2xl border-b border-border bg-gradient-to-r from-amber-50 via-white to-slate-50 px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
            <CalendarDays className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">WORKSPACE POLICY</p>
            <h2 id="workspace-day-off-title" className="mt-1 text-lg font-bold tracking-tight text-foreground">Ngày nghỉ &amp; ngày lễ</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Áp dụng cho toàn workspace. Ngày đã khóa được đánh dấu trên Calendar, loại khỏi ngày làm việc chuẩn và không cho phép lập kế hoạch hoặc ghi giờ.
            </p>
          </div>
        </div>
      </div>
      </div>

      <FilterBar className="border-b border-border px-5 py-4 sm:px-6" onReset={filterCount ? resetFilters : undefined} activeCount={filterCount}>
        <FilterField label="Năm" className="shrink-0">
          <div className="inline-flex flex-nowrap items-center gap-1">
            <button type="button" aria-label="Năm trước" onClick={() => setYear((value) => value - 1)} className="task-select-trigger !w-9 shrink-0 !justify-center !px-0"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <div className="w-[8rem] shrink-0"><CrmSelect ariaLabel="Chọn năm" options={yearOptions} value={String(year)} onChange={(value) => setYear(Number(value))} /></div>
            <button type="button" aria-label="Năm sau" onClick={() => setYear((value) => value + 1)} className="task-select-trigger !w-9 shrink-0 !justify-center !px-0"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
        </FilterField>
        <MultiSelectFilter label="Phân loại" options={CATEGORY_OPTIONS} values={categoryFilter} onChange={setCategoryFilter} allLabel="Tất cả phân loại" searchable={false} className="min-w-[200px] flex-1 sm:max-w-xs" />
        <MultiSelectFilter label="Trạng thái" options={[{ value: "active", label: "Đang off" }, { value: "inactive", label: "Đã mở khóa" }]} values={statusFilter} onChange={setStatusFilter} allLabel="Tất cả trạng thái" searchable={false} className="min-w-[200px] flex-1 sm:max-w-xs" />
      </FilterBar>

      <div className="grid border-b border-border sm:grid-cols-3 sm:divide-x sm:divide-border">
        <Summary label="Ngày đã cấu hình" value={items.length} />
        <Summary label="Đang khóa & không tính phí" value={activeCount} tone="success" />
        <Summary label="Từ hôm nay trở đi" value={upcomingCount} tone="warning" />
      </div>

      {!canManage ? (
        <div className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-border bg-slate-50 p-4 text-xs leading-relaxed text-muted-foreground sm:mx-6">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div>
            <p className="font-semibold text-slate-700">Chế độ chỉ đọc</p>
            <p className="mt-0.5">Chỉ Founder/GM hoặc Workspace Admin được tạo, sửa và khóa ngày nghỉ. Các tài khoản khác chỉ xem được lịch đã cấu hình.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mx-5 mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:mx-6 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-foreground">{editing ? "Sửa chính sách ngày nghỉ" : "Khóa ngày nghỉ mới"}</h3>
              {!editing ? <p className="mt-0.5 text-xs text-muted-foreground">Chọn một ngày hoặc một khoảng ngày. Mỗi ngày được lưu thành một bản ghi riêng.</p> : null}
            </div>
            {editing ? <button type="button" onClick={resetEditor} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Hủy sửa"><X className="h-4 w-4" /></button> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              {editing ? "Ngày" : "Từ ngày"}
              <input required type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (!editing && endDate < event.target.value) setEndDate(event.target.value); }} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
            </label>
            {!editing ? (
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Đến ngày
                <input required type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
              </label>
            ) : null}
            <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-2">
              Tên ngày nghỉ
              <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Nghỉ lễ Quốc khánh" className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/70" />
            </label>
            <div className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-2"><span>Phân loại</span><CrmSelect options={CATEGORY_OPTIONS} value={category} onChange={(value) => setCategory(value as WorkspaceDayOffCategory)} /></div>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-6">
              Ghi chú <span className="font-normal">(không bắt buộc)</span>
              <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú nội bộ hoặc căn cứ ngày nghỉ" className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/70" />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
              <LockKeyhole className="h-3.5 w-3.5" /> Không thể lập kế hoạch hoặc ghi giờ vào ngày đã khóa.
            </span>
            <button disabled={saving} type="submit" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
              {editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {saving ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Khóa & chặn công việc"}
            </button>
          </div>
        </form>
      )}

      {error ? <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-destructive"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
      {notice ? <div role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 px-3 py-2.5 text-xs leading-relaxed text-success"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}

      <div className="mx-5 mt-5 overflow-hidden rounded-2xl border border-border sm:mx-6">
        <div className="flex flex-col gap-2 border-b border-border bg-slate-50/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">Lịch ngày nghỉ {year}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Ngày mở khóa vẫn được giữ lại để bảo toàn lịch sử.</p>
          </div>
          {loading ? <span className="text-xs text-muted-foreground">Đang tải…</span> : <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{visibleItems.length < items.length ? `${visibleItems.length}/${items.length}` : items.length} ngày</span>}
        </div>
        {loading && items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Đang tải ngày nghỉ…</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <CalendarDays className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium text-foreground">Chưa có ngày nghỉ nào cho năm {year}</p>
            <p className="mt-1 text-xs text-muted-foreground">Thêm ngày nghỉ lễ nhà nước hoặc ngày nghỉ riêng của workspace ở form phía trên.</p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">Không có kết quả phù hợp bộ lọc</p>
            <button type="button" onClick={() => { setCategoryFilter([]); setStatusFilter([]); }} className="mt-3 rounded-lg border border-border px-3 py-1.5 !text-xs !font-semibold text-primary hover:bg-muted">Đặt lại bộ lọc</button>
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-background text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-2.5 font-semibold">Ngày</th><th className="px-4 py-2.5 font-semibold">Tên / loại</th><th className="px-4 py-2.5 font-semibold">Tác động</th><th className="px-4 py-2.5 font-semibold">Trạng thái</th>{canManage ? <th className="px-4 py-2.5 text-right font-semibold">Thao tác</th> : null}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleItems.map((item) => (
                  <tr key={item.id} className={item.isActive ? "bg-background" : "bg-muted/20 text-muted-foreground"}>
                    <td className="px-4 py-3 font-medium tabular-nums text-foreground">{dateLabel(item.date)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{item.name}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{categoryLabel(item.category)}{item.note ? ` · ${item.note}` : ""}</p>
                    </td>
                    <td className="px-4 py-3">{item.isActive ? <span className="inline-flex flex-col gap-0.5 text-success"><span className="inline-flex items-center gap-1.5 font-semibold"><LockKeyhole className="h-3.5 w-3.5" />Đã khóa toàn workspace</span><span className="pl-5 text-[10px] text-muted-foreground">Không lập kế hoạch / ghi giờ</span></span> : <span className="text-muted-foreground">Không còn khóa</span>}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{item.isActive ? "Đang off" : "Đã mở khóa"}</span></td>
                    {canManage ? <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button type="button" disabled={saving} onClick={() => beginEdit(item)} aria-label={`Sửa ${item.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" disabled={saving} onClick={() => void toggleActive(item)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold disabled:opacity-50 ${item.isActive ? "border-border text-muted-foreground hover:bg-muted" : "border-success/30 text-success hover:bg-success/5"}`}>
                          {item.isActive ? <><Unlock className="h-3.5 w-3.5" />Mở khóa</> : <><LockKeyhole className="h-3.5 w-3.5" />Khóa lại</>}
                        </button>
                      </div>
                    </td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Ngày nghỉ chỉ chặn phát sinh công việc mới và loại khỏi giờ tính phí; dữ liệu cũ vẫn được giữ để đối soát, không tự sửa hóa đơn đã phát hành.
      </p>
    </section>
  );
}

function Summary({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "success" | "warning" }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
