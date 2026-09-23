"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, UserRound, Plus, Trash2, X, Calendar, User, FileText, Layers, Briefcase } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/constructor-x/app-shell";
import { useAuth } from "@/lib/auth";
import type { ResourceListResponse, TaskPlanningBlockSummary, TaskTimeEntrySummary, WorkspaceDayOffSummary } from "@b2b-crm/contracts";
import { fetchWorkspaceUserOptions, type WorkspaceUserOption } from "@/lib/workspace-users";
import { CustomDatePicker } from "@/components/constructor-x/custom-controls";
import { CustomDropdown, type TaskSelectOption } from "@/components/crm-workspace/tasks-workbench";
import { CalendarFilterMultiSelect } from "@/components/crm-workspace/calendar-filter-multi-select";
import { ModalLayer } from "@/components/modal-layer";
import {
  formatVietnamDate,
  formatVietnamTime,
  toVietnamDateKey,
  vietnamDateTimeToIso,
  VIETNAM_TIME_ZONE_LABEL
} from "@/lib/vietnam-time";
import {
  computeCalendarOverlapLayout,
  getCalendarCardDensity,
  getCalendarEventGeometry,
  splitDateRangeIntoChunks
} from "@/lib/calendar-event-layout";
import {
  buildCalendarMemberOptions,
  buildCalendarProjectOptions,
  filterCalendarEvents,
  pruneCalendarFilterIds
} from "@/lib/calendar-filters";
import { buildPlanningActualPresentation } from "@/lib/planning-actual-presentation";

type CalendarWorkEvent = {
  id: string;
  recordId: string;
  kind: "planned" | "actual";
  taskId: string;
  accountId: string;
  accountName?: string;
  projectId?: string;
  projectName?: string;
  userId: string;
  userDisplayName?: string;
  userAvatarUrl?: string;
  title: string;
  notes?: string;
  startAt: string;
  endAt: string;
  minutes: number;
  status: string;
  timeZone?: string;
  hasExplicitWindow?: boolean;
  updatedAt?: string;
  sourcePlanningBlockId?: string;
  billingExemptReason?: TaskTimeEntrySummary["billingExemptReason"];
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const START_GRID_HOUR = 0; // 12 AM
const END_GRID_HOUR = 24; // 12 AM (24 hours)
const HOUR_ROW_HEIGHT = 44; // px (more compact to fit 24h)

const blockColors: Record<string, { bg: string; border: string; text: string }> = {
  planned:     { bg: "bg-blue-50/60 hover:bg-blue-100/60 border border-blue-100/50",       border: "border-l-[3px] border-blue-400",    text: "text-blue-700" },
  actual:      { bg: "bg-emerald-50/60 hover:bg-emerald-100/60 border border-emerald-100/50", border: "border-l-[3px] border-emerald-500", text: "text-emerald-700" },
  in_progress: { bg: "bg-indigo-50/60 hover:bg-indigo-100/60 border border-indigo-100/50",   border: "border-l-[3px] border-indigo-400",   text: "text-indigo-700" },
  completed:   { bg: "bg-emerald-50/60 hover:bg-emerald-100/60 border border-emerald-100/50", border: "border-l-[3px] border-emerald-400",  text: "text-emerald-700" },
  done:        { bg: "bg-emerald-50/60 hover:bg-emerald-100/60 border border-emerald-100/50", border: "border-l-[3px] border-emerald-400",  text: "text-emerald-700" },
  cancelled:   { bg: "bg-slate-100/80 hover:bg-slate-200/60 border border-slate-200/50",     border: "border-l-[3px] border-slate-400",    text: "text-slate-500" },
  at_risk:     { bg: "bg-amber-50/60 hover:bg-amber-100/60 border border-amber-100/50",      border: "border-l-[3px] border-amber-400",    text: "text-amber-700" },
  blocked:     { bg: "bg-orange-50/60 hover:bg-orange-100/60 border border-orange-100/50",   border: "border-l-[3px] border-orange-400",   text: "text-orange-700" },
  on_hold:     { bg: "bg-yellow-50/60 hover:bg-yellow-100/60 border border-yellow-100/50",   border: "border-l-[3px] border-yellow-400",   text: "text-yellow-700" },
};

const STATUS_LABEL: Record<string, string> = {
  planned:     "Kế hoạch",
  actual:      "Thực tế",
  in_progress: "Đang làm",
  completed:   "Hoàn thành",
  done:        "Hoàn thành",
  cancelled:   "Đã hủy",
  at_risk:     "Có rủi ro",
  blocked:     "Bị chặn",
  on_hold:     "Tạm dừng",
};

const getBlockColorSchema = (status: string) => {
  const normalized = (status || "planned").toLowerCase();
  return blockColors[normalized] || blockColors.planned;
};

const getStatusLabel = (status: string) => {
  const normalized = (status || "planned").toLowerCase();
  return STATUS_LABEL[normalized] || status;
};

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function addYears(date: Date, years: number) {
  const copy = new Date(date);
  copy.setFullYear(copy.getFullYear() + years);
  return copy;
}

function formatDateKey(date: Date) {
  return toVietnamDateKey(date);
}

function formatTimeRange(block: CalendarWorkEvent) {
  return `${formatVietnamTime(block.startAt)} - ${formatVietnamTime(block.endAt)}`;
}

function formatHours(minutes: number) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function initialsFor(name?: string) {
  const words = (name ?? "User").trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? "U"}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function planningBlockToEvent(block: TaskPlanningBlockSummary): CalendarWorkEvent {
  return {
    id: block.id,
    recordId: block.id,
    kind: "planned",
    taskId: block.taskId,
    accountId: block.accountId,
    accountName: block.accountName,
    projectId: block.projectId,
    projectName: block.projectName,
    userId: block.userId,
    userDisplayName: block.userDisplayName,
    userAvatarUrl: block.userAvatarUrl,
    title: block.title,
    notes: block.notes,
    startAt: block.startAt,
    endAt: block.endAt,
    minutes: block.plannedMinutes,
    status: block.status,
    timeZone: "Asia/Ho_Chi_Minh",
    hasExplicitWindow: true,
    updatedAt: block.updatedAt
  };
}

function actualEntryToEvent(entry: TaskTimeEntrySummary): CalendarWorkEvent {
  const hasExplicitWindow = Boolean(entry.startAt && entry.endAt);
  const workDateKey = toVietnamDateKey(entry.startAt ?? entry.workDate);
  const entryWorkTime = formatVietnamTime(entry.workDate);
  const fallbackStartIso = entryWorkTime && entryWorkTime !== "00:00"
    ? new Date(entry.workDate).toISOString()
    : vietnamDateTimeToIso(workDateKey, "09:00");
  const start = new Date(entry.startAt ?? fallbackStartIso);
  const end = new Date(start.getTime() + entry.minutes * 60 * 1000);
  return {
    id: `actual-${entry.id}`,
    recordId: entry.id,
    kind: "actual",
    taskId: entry.taskId,
    accountId: entry.accountId,
    accountName: entry.accountName,
    projectId: entry.projectId,
    projectName: entry.projectName,
    userId: entry.userId,
    userDisplayName: entry.userDisplayName,
    userAvatarUrl: entry.userAvatarUrl,
    title: entry.taskTitle ?? entry.note ?? "Actual work",
    notes: entry.note,
    startAt: entry.startAt ?? start.toISOString(),
    endAt: entry.endAt ?? end.toISOString(),
    minutes: entry.minutes,
    status: "actual",
    timeZone: entry.timeZone ?? "Asia/Ho_Chi_Minh",
    hasExplicitWindow,
    sourcePlanningBlockId: entry.sourcePlanningBlockId,
    billingExemptReason: entry.billingExemptReason
  };
}

function canonicalizeCalendarEvents(events: readonly CalendarWorkEvent[]) {
  return buildPlanningActualPresentation(
    events.filter(event => event.kind === "planned"),
    events.filter(event => event.kind === "actual")
  ).map(item => item.record);
}

async function readBackendMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim();
  } catch {
    // Keep the production-safe fallback for non-JSON responses.
  }
  return fallback;
}

function isTaskPlanningBlockSummary(value: unknown): value is TaskPlanningBlockSummary {
  if (!value || typeof value !== "object") return false;
  const block = value as Record<string, unknown>;
  const requiredStrings = [
    "id",
    "taskId",
    "accountId",
    "userId",
    "title",
    "startAt",
    "endAt",
    "status",
    "source",
    "createdAt",
    "updatedAt"
  ];
  if (!requiredStrings.every(key => typeof block[key] === "string" && String(block[key]).trim().length > 0)) {
    return false;
  }
  if (typeof block.plannedMinutes !== "number" || !Number.isFinite(block.plannedMinutes) || block.plannedMinutes <= 0) {
    return false;
  }
  const start = Date.parse(String(block.startAt));
  const end = Date.parse(String(block.endAt));
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function eventOverlapsRange(event: CalendarWorkEvent, range: { startAt: string; endAt: string }) {
  const eventStart = Date.parse(event.startAt);
  const eventEnd = Date.parse(event.endAt);
  const rangeStart = Date.parse(range.startAt);
  const rangeEnd = Date.parse(range.endAt);
  return [eventStart, eventEnd, rangeStart, rangeEnd].every(Number.isFinite)
    && eventStart < rangeEnd
    && eventEnd > rangeStart;
}

function upsertCalendarEvent(events: CalendarWorkEvent[], nextEvent: CalendarWorkEvent) {
  return [
    ...events.filter(event => !(event.kind === nextEvent.kind && event.recordId === nextEvent.recordId)),
    nextEvent
  ];
}

class CalendarUnauthorizedError extends Error {}

async function fetchAllResourcePages<T extends { id: string }>(
  path: string,
  params: URLSearchParams,
  pageSize: number,
  maximumPages: number,
  signal?: AbortSignal
) {
  const records = new Map<string, T>();
  let offset = 0;
  for (let page = 0; page < maximumPages; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageSize));
    pageParams.set("offset", String(offset));
    const response = await fetch(`${path}?${pageParams.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal
    });
    if (response.status === 401) throw new CalendarUnauthorizedError("Authentication required");
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);

    const payload = await response.json() as ResourceListResponse<T>;
    for (const item of payload.data ?? []) records.set(item.id, item);
    const pagination = payload.meta?.pagination;
    if (!pagination?.hasNextPage) return [...records.values()];
    const returned = pagination.returned || payload.data?.length || 0;
    if (returned <= 0) throw new Error(`${path} pagination did not advance`);
    offset = pagination.offset + returned;
  }
  throw new Error(`${path} exceeded the ${maximumPages}-page safety limit`);
}

// Local Confirm Modal Component
const CalendarConfirmModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  tone = "primary",
  loading = false,
  error
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  loading?: boolean;
  error?: string | null;
}) => {
  if (!isOpen) return null;

  return (
    <ModalLayer closeOnEscape={!loading} onClose={onCancel}>
    <div className="fixed inset-0 z-[2000] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] w-full max-w-sm flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="border-b border-slate-50 pb-2.5">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {message}
        </p>
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-xl px-4 py-2 text-xs font-semibold text-white transition active:scale-[0.98] shadow-sm cursor-pointer ${
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700 shadow-red-100"
                : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100"
            }`}
          >
            {loading ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </ModalLayer>
  );
};

export default function CalendarPage() {
  const { user, isLoading } = useAuth();
  const canManageWorkspace = Boolean(user?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"));
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadGenerationRef = useRef(0);
  const loadAbortControllerRef = useRef<AbortController | null>(null);
  const confirmedPlanningEventsRef = useRef(new Map<string, CalendarWorkEvent>());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [blocks, setBlocks] = useState<CalendarWorkEvent[]>([]);
  const [dayOffs, setDayOffs] = useState<WorkspaceDayOffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayOffError, setDayOffError] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Custom visual state
  const [activeTab, setActiveTab] = useState<"Day" | "Week" | "Month" | "Year">("Week");
  const [toast, setToast] = useState<{ message: string; type: "success" | "danger" | "info" } | null>(null);

  // Options for event adding
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<WorkspaceUserOption[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const taskOptionsLoadStartedRef = useRef(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [blockToDelete, setBlockToDelete] = useState<CalendarWorkEvent | null>(null);
  const [isDeletingBlock, setIsDeletingBlock] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [blockToComplete, setBlockToComplete] = useState<CalendarWorkEvent | null>(null);
  const [isCompletingBlock, setIsCompletingBlock] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [detailBlock, setDetailBlock] = useState<CalendarWorkEvent | null>(null);
  const [detailAnchorRect, setDetailAnchorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Event Add Form state
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [notes, setNotes] = useState("");
  const [eventStatus, setEventStatus] = useState<"planned" | "in_progress" | "completed" | "cancelled">("planned");
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);

  const taskOptions = useMemo<TaskSelectOption[]>(() => {
    return allTasks.map(t => ({
      value: t.id,
      label: t.title,
      subtext: t.projectName || "Không rõ dự án"
    }));
  }, [allTasks]);

  const userOptions = useMemo<TaskSelectOption[]>(() => {
    return allUsers.map(u => ({
      value: u.id,
      label: u.name,
      subtext: u.role,
      avatarUrl: u.avatarUrl,
      initials: u.initials,
      color: u.color
    }));
  }, [allUsers]);

  const timeOptions = useMemo<TaskSelectOption[]>(() => {
    return Array.from({ length: 28 }).map((_, i) => {
      const h = Math.floor(i / 2) + 8;
      const m = i % 2 === 0 ? "00" : "30";
      const val = `${h.toString().padStart(2, "0")}:${m}`;
      return { value: val, label: val };
    });
  }, []);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const monthGridDays = useMemo(() => {
    const year = weekStart.getFullYear();
    const month = weekStart.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayIndex = firstDay.getDay(); // 0 = Sun, 1 = Mon, ...
    const offset = startDayIndex === 0 ? -6 : 1 - startDayIndex;
    const gridStartDate = new Date(year, month, 1 + offset);
    return Array.from({ length: 42 }).map((_, i) => addDays(gridStartDate, i));
  }, [weekStart]);

  const activeRange = useMemo(() => {
    let startDate: Date;
    let endDate: Date;
    if (activeTab === "Day") {
      startDate = weekStart;
      endDate = addDays(weekStart, 1);
    } else if (activeTab === "Week") {
      startDate = weekStart;
      endDate = addDays(weekStart, 7);
    } else if (activeTab === "Month") {
      startDate = monthGridDays[0];
      endDate = addDays(monthGridDays[monthGridDays.length - 1], 1);
    } else {
      startDate = new Date(weekStart.getFullYear(), 0, 1);
      endDate = new Date(weekStart.getFullYear() + 1, 0, 1);
    }
    return {
      startAt: vietnamDateTimeToIso(toVietnamDateKey(startDate), "00:00"),
      endAt: vietnamDateTimeToIso(toVietnamDateKey(endDate), "00:00")
    };
  }, [activeTab, monthGridDays, weekStart]);

  const triggerToast = (message: string, type: "success" | "danger" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const projectFilterOptions = useMemo(
    () => buildCalendarProjectOptions(blocks),
    [blocks]
  );

  const memberFilterOptions = useMemo(
    () => buildCalendarMemberOptions(blocks, allUsers),
    [allUsers, blocks]
  );

  const filteredBlocks = useMemo(() => filterCalendarEvents(blocks, {
    projectIds: selectedProjectIds,
    memberIds: selectedMemberIds
  }), [blocks, selectedMemberIds, selectedProjectIds]);

  const dayOffByDate = useMemo(
    () => new Map(dayOffs.filter((dayOff) => dayOff.isActive).map((dayOff) => [dayOff.date, dayOff])),
    [dayOffs]
  );

  const hasActiveFilters = selectedProjectIds.length > 0 || selectedMemberIds.length > 0;

  const resetFilters = () => {
    setSelectedProjectIds([]);
    setSelectedMemberIds([]);
  };

  useEffect(() => {
    if (loading || error) return;
    setSelectedProjectIds((current) => {
      const next = pruneCalendarFilterIds(current, projectFilterOptions);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
    setSelectedMemberIds((current) => {
      const next = pruneCalendarFilterIds(current, memberFilterOptions);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [error, loading, memberFilterOptions, projectFilterOptions]);

  const blocksByDay = useMemo(() => {
    const grouped = new Map<string, CalendarWorkEvent[]>();
    for (const block of filteredBlocks) {
      const key = formatDateKey(new Date(block.startAt));
      grouped.set(key, [...(grouped.get(key) ?? []), block]);
    }
    for (const events of grouped.values()) {
      events.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return grouped;
  }, [filteredBlocks]);

  // Remove the legacy browser-only delete tombstones. Backend state is authoritative.
  useEffect(() => {
    localStorage.removeItem("lark_crm_deleted_planning_blocks");
  }, []);

  // Scroll to active working hours (8 AM) on load
  useEffect(() => {
    if (!loading && scrollContainerRef.current) {
      // 8 AM * 44px (height) = 352px. We scroll to 300px to show 7 AM onwards beautifully centered.
      scrollContainerRef.current.scrollTop = 300;
    }
  }, [loading]);

  const loadPlanningBlocks = async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;
    const requestedRange = { ...activeRange };
    setLoading(true);
    setError(null);
    setDayOffError(null);
    const chunks = splitDateRangeIntoChunks(requestedRange.startAt, requestedRange.endAt);
    const loadSource = async <T extends { id: string }>(path: string) => {
      const results = await Promise.allSettled(chunks.map(chunk => fetchAllResourcePages<T>(
        path,
        new URLSearchParams(chunk),
        200,
        25,
        controller.signal
      )));
      const data = new Map<string, T>();
      const errors: string[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const item of result.value) data.set(item.id, item);
        } else if (result.reason instanceof CalendarUnauthorizedError) {
          throw result.reason;
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      }
      return { data: [...data.values()], errors };
    };

    try {
      const [planningResult, actualResult, dayOffResult] = await Promise.allSettled([
        loadSource<TaskPlanningBlockSummary>("/api/tasks/planning-blocks"),
        loadSource<TaskTimeEntrySummary>("/api/tasks/time-entries"),
        loadSource<WorkspaceDayOffSummary>("/api/workspace/day-offs")
      ]);
      if (generation !== loadGenerationRef.current || controller.signal.aborted) return;
      if (
        (planningResult.status === "rejected" && planningResult.reason instanceof CalendarUnauthorizedError) ||
        (actualResult.status === "rejected" && actualResult.reason instanceof CalendarUnauthorizedError) ||
        (dayOffResult.status === "rejected" && dayOffResult.reason instanceof CalendarUnauthorizedError)
      ) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/calendar")}`);
        return;
      }

      const planningData = planningResult.status === "fulfilled" ? planningResult.value.data : [];
      const actualData = actualResult.status === "fulfilled" ? actualResult.value.data : [];
      const dayOffData = dayOffResult.status === "fulfilled" ? dayOffResult.value.data : [];
      const dayOffPartial = dayOffResult.status === "rejected" || dayOffResult.value.errors.length > 0;
      setDayOffs(dayOffPartial ? [] : dayOffData);
      setDayOffError(dayOffPartial ? "Không tải được lịch ngày nghỉ; trạng thái off trong phạm vi này chưa xác định." : null);
      const errors = [
        ...(planningResult.status === "fulfilled" ? planningResult.value.errors : [String(planningResult.reason)]),
        ...(actualResult.status === "fulfilled" ? actualResult.value.errors : [String(actualResult.reason)])
      ];
      const nextBlocks = buildPlanningActualPresentation(planningData, actualData).map(item =>
        item.kind === "planned" ? planningBlockToEvent(item.record) : actualEntryToEvent(item.record)
      );
      const planningPartial = planningResult.status === "rejected" || planningResult.value.errors.length > 0;
      const actualPartial = actualResult.status === "rejected" || actualResult.value.errors.length > 0;

      if (!planningPartial) {
        for (const event of nextBlocks) {
          if (event.kind === "planned") confirmedPlanningEventsRef.current.delete(event.recordId);
        }
      }

      let visibleBlocks = nextBlocks;
      setBlocks(current => {
        if (planningPartial) {
          for (const event of current) {
            if (event.kind === "planned" && eventOverlapsRange(event, requestedRange)) {
              visibleBlocks = upsertCalendarEvent(visibleBlocks, event);
            }
          }
        }
        for (const event of confirmedPlanningEventsRef.current.values()) {
          if (eventOverlapsRange(event, requestedRange)) {
            visibleBlocks = upsertCalendarEvent(visibleBlocks, event);
          }
        }
        if (actualPartial) {
          for (const event of current) {
            if (event.kind === "actual" && eventOverlapsRange(event, requestedRange)) {
              visibleBlocks = upsertCalendarEvent(visibleBlocks, event);
            }
          }
        }
        visibleBlocks = canonicalizeCalendarEvents(visibleBlocks);
        return visibleBlocks;
      });
      setDetailBlock(current => {
        if (!current) return null;
        return visibleBlocks.find(block => block.recordId === current.recordId && block.kind === current.kind)
          ?? (current.kind === "planned"
            ? visibleBlocks.find(block => block.kind === "actual" && block.sourcePlanningBlockId === current.recordId)
            : undefined)
          ?? current;
      });
      setError(errors.length > 0 ? `Một phần dữ liệu lịch chưa tải được: ${errors.join("; ")}` : null);
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
        if (loadAbortControllerRef.current === controller) loadAbortControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (isLoading) return;
    loadPlanningBlocks();
  }, [isLoading, activeRange.startAt, activeRange.endAt]);

  // Load user options eagerly; task options are paginated lazily on first Add Event open.
  useEffect(() => {
    async function loadFormOptions() {
      try {
        const users = await fetchWorkspaceUserOptions();
        setAllUsers(users);
        setUsersError(users.length > 0 ? null : "Workspace has no active users available for planning.");
      } catch (e) {
        console.warn("Failed to load workspace users:", e);
        setAllUsers([]);
        setUsersError("Could not load real workspace users. Planning is disabled until the directory is available.");
      }
    }
    if (!isLoading) {
      loadFormOptions();
    }
  }, [isLoading]);

  useEffect(() => {
    if (!showAddModal || taskOptionsLoadStartedRef.current) return;
    taskOptionsLoadStartedRef.current = true;
    void fetchAllResourcePages<any>("/api/tasks", new URLSearchParams(), 100, 20)
      .then(setAllTasks)
      .catch(error => {
        taskOptionsLoadStartedRef.current = false;
        console.warn("Failed to load paginated task options:", error);
        triggerToast("Không thể tải đầy đủ danh sách công việc.", "danger");
      });
  }, [showAddModal]);

  // Auto-fill title when task selection changes
  useEffect(() => {
    if (selectedTaskId) {
      const task = allTasks.find(t => t.id === selectedTaskId);
      if (task) {
        setEventTitle(task.title || "");
      }
    }
  }, [selectedTaskId, allTasks]);

  const handleOpenDetail = (block: CalendarWorkEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDetailAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    setCompletionError(null);
    setDetailBlock(block);
  };

  const handleDeleteBlock = async (block: CalendarWorkEvent) => {
    const blockId = block.kind === "planned" ? block.recordId : block.sourcePlanningBlockId;
    if (!blockId) return;
    setIsDeletingBlock(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/tasks/planning-blocks/${encodeURIComponent(blockId)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/calendar")}`);
        return;
      }
      if (!response.ok) {
        throw new Error(await readBackendMessage(response, "Không thể xóa mốc kế hoạch trên backend."));
      }
      confirmedPlanningEventsRef.current.delete(blockId);
      setBlockToDelete(null);
      setDetailBlock(null);
      await loadPlanningBlocks();
      triggerToast(
        block.kind === "actual"
          ? "Đã xóa lịch kế hoạch. Giờ thực tế vẫn được giữ lại."
          : "Đã xóa mốc kế hoạch.",
        "info"
      );
    } catch (error) {
      console.error("Failed to delete planning block from API:", error);
      const message = error instanceof Error ? error.message : "Không thể xóa mốc kế hoạch trên backend.";
      setDeleteError(message);
      triggerToast(message, "danger");
    } finally {
      setIsDeletingBlock(false);
    }
  };

  const handleCompleteBlock = async (block: CalendarWorkEvent) => {
    if (block.kind !== "planned") return;
    setIsCompletingBlock(true);
    setCompletionError(null);
    try {
      const response = await fetch(`/api/tasks/planning-blocks/${encodeURIComponent(block.id)}/transitions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          expectedUpdatedAt: block.updatedAt,
          reason: "Hoàn thành kế hoạch từ Calendar"
        })
      });
      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/calendar")}`);
        return;
      }
      if (!response.ok) {
        let message = response.status === 409
          ? "Kế hoạch đã được cập nhật ở nơi khác. Calendar sẽ tải lại dữ liệu mới nhất."
          : "Không thể hoàn thành kế hoạch trên backend.";
        try {
          const payload = await response.json();
          if (typeof payload?.message === "string" && payload.message.trim()) message = payload.message;
        } catch {
          // Keep the production-safe fallback message.
        }
        throw new Error(message);
      }
      const savedBlock = await response.json() as TaskPlanningBlockSummary;
      setBlockToComplete(null);
      setDetailBlock(null);
      await loadPlanningBlocks();
      triggerToast(
        `Đã hoàn thành kế hoạch. ${formatHours(savedBlock.plannedMinutes)} đã được tính vào giờ thực tế.`,
        "success"
      );
    } catch (completeError) {
      const message = completeError instanceof Error ? completeError.message : "Không thể hoàn thành kế hoạch trên backend.";
      setCompletionError(message);
      setBlockToComplete(null);
      triggerToast(message, "danger");
      await loadPlanningBlocks();
    } finally {
      setIsCompletingBlock(false);
    }
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usersError) {
      triggerToast(usersError, "danger");
      return;
    }
    if (!selectedTaskId || !selectedUserId || !eventTitle || !eventDate || !startTime || !endTime) {
      triggerToast("Vui lòng nhập đầy đủ thông tin bắt buộc.", "danger");
      return;
    }

    setIsSubmittingEvent(true);
    try {
      const startD = new Date(vietnamDateTimeToIso(eventDate, startTime));
      let endD = new Date(vietnamDateTimeToIso(eventDate, endTime));
      if (endD <= startD) {
        endD = new Date(endD.getTime() + 24 * 60 * 60 * 1000);
      }

      let diffMins = Math.round((endD.getTime() - startD.getTime()) / (1000 * 60));
      if (diffMins <= 0) {
        diffMins = 60; // fallback
      }

      const response = await fetch(`/api/tasks/${encodeURIComponent(selectedTaskId)}/planning-blocks`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          title: eventTitle,
          notes: notes.trim() || undefined,
          startAt: startD.toISOString(),
          endAt: endD.toISOString(),
          plannedMinutes: diffMins,
          status: eventStatus
        })
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/calendar")}`);
        return;
      }
      if (!response.ok) {
        throw new Error(`Failed to create block: ${response.status}`);
      }

      const payload: unknown = await response.json();
      if (!isTaskPlanningBlockSummary(payload) || payload.taskId !== selectedTaskId) {
        throw new Error("Planning block response is not canonical");
      }
      const savedEvent = planningBlockToEvent(payload);
      loadGenerationRef.current += 1;
      loadAbortControllerRef.current?.abort();
      confirmedPlanningEventsRef.current.set(savedEvent.recordId, savedEvent);
      if (eventOverlapsRange(savedEvent, activeRange)) {
        setBlocks(current => upsertCalendarEvent(current, savedEvent));
      }

      triggerToast("Đã thêm kế hoạch mới thành công!", "success");
      setShowAddModal(false);

      // Reset form
      setSelectedTaskId("");
      setSelectedUserId("");
      setEventTitle("");
      setEventDate("");
      setNotes("");
      setEventStatus("planned");

      // Reload blocks
      await loadPlanningBlocks();
    } catch (err) {
      console.error(err);
      triggerToast("Không thể lưu kế hoạch. Vui lòng kiểm tra và thử lại.", "danger");
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  const getBlockPositionStyle = (block: CalendarWorkEvent) => {
    const geometry = getCalendarEventGeometry(block, {
      startHour: START_GRID_HOUR,
      endHour: END_GRID_HOUR,
      hourRowHeight: HOUR_ROW_HEIGHT,
      minimumHeight: 32
    });
    return { top: `${geometry.top}px`, height: `${geometry.height}px`, pixelHeight: geometry.height };
  };

  const activeBlocks = filteredBlocks;
  const totalPlannedMinutes = activeBlocks.filter(b => b.kind === "planned").reduce((sum, block) => sum + block.minutes, 0);
  const totalActualMinutes = activeBlocks.filter(b => b.kind === "actual").reduce((sum, block) => sum + block.minutes, 0);
  const picCount = new Set(activeBlocks.map((block) => block.userId)).size;

  const displayDays = activeTab === "Day" ? [weekStart] : weekDays;

  const formattedMonthTitle = useMemo(() => {
    if (activeTab === "Day") {
      const dayStr = formatVietnamDate(weekStart, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      return dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
    } else if (activeTab === "Week") {
      const startStr = formatVietnamDate(weekStart, { day: "numeric", month: "short" });
      const endStr = formatVietnamDate(addDays(weekStart, 6), { day: "numeric", month: "short", year: "numeric" });
      return `Tuần: ${startStr} - ${endStr}`;
    } else if (activeTab === "Month") {
      return `Tháng ${weekStart.getMonth() + 1} năm ${weekStart.getFullYear()}`;
    } else {
      return `Năm ${weekStart.getFullYear()}`;
    }
  }, [weekStart, activeTab]);

  return (
    <AppShell
      activeRoute="/calendar"
      desktopSidebarTestId="calendar-desktop-sidebar"
      mobileHeaderTestId="calendar-mobile-shell"
      shellTestId="calendar-shell"
      title="Calendar"
    >
        <main data-testid="calendar-main" className="flex-1 overflow-auto p-4 sm:p-6">
          {/* Header section with Month title and Add Event button */}
          <div className="mb-4 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100 pb-5">
            {/* Left title and info */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <CalendarDays className="w-3.5 h-3.5 text-indigo-500" />
                Lịch trình kế hoạch
              </div>
              <h1 className="mt-3 mb-1.5 text-3xl font-black leading-tight tracking-normal text-slate-800">
                {formattedMonthTitle}
              </h1>
              <p className="text-xs font-medium text-slate-400">
                {formatVietnamDate(weekStart)} - {formatVietnamDate(addDays(weekStart, 6))} · {activeBlocks.length} mốc · {formatHours(totalPlannedMinutes)} KH · {formatHours(totalActualMinutes)} TT · {picCount} PIC · {VIETNAM_TIME_ZONE_LABEL}
              </p>
            </div>

            {/* Center pill segmented control */}
            <div className="flex justify-center items-center">
              <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-0.5 shadow-inner">
                {(["Day", "Week", "Month", "Year"] as const).map((tab) => {
                  const isActive = tab === activeTab;
                  const labelMap = { Day: "Ngày", Week: "Tuần", Month: "Tháng", Year: "Năm" };
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        isActive
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {labelMap[tab]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right side navigation & actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 shrink-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    if (activeTab === "Day") {
                      setWeekStart(today);
                    } else if (activeTab === "Week") {
                      setWeekStart(startOfWeek(today));
                    } else if (activeTab === "Month") {
                      const d = new Date(today.getFullYear(), today.getMonth(), 1);
                      setWeekStart(d);
                    } else {
                      const d = new Date(today.getFullYear(), 0, 1);
                      setWeekStart(d);
                    }
                  }}
                  className="h-10 min-w-16 rounded-xl border border-slate-200 bg-white hover:border-slate-300 px-3.5 text-xs font-semibold text-slate-600 transition shadow-sm cursor-pointer"
                >
                  Hôm nay
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === "Day") setWeekStart((current) => addDays(current, -1));
                    else if (activeTab === "Week") setWeekStart((current) => addDays(current, -7));
                    else if (activeTab === "Month") setWeekStart((current) => addMonths(current, -1));
                    else if (activeTab === "Year") setWeekStart((current) => addYears(current, -1));
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition shadow-sm cursor-pointer"
                  aria-label="Previous period"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === "Day") setWeekStart((current) => addDays(current, 1));
                    else if (activeTab === "Week") setWeekStart((current) => addDays(current, 7));
                    else if (activeTab === "Month") setWeekStart((current) => addMonths(current, 1));
                    else if (activeTab === "Year") setWeekStart((current) => addYears(current, 1));
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition shadow-sm cursor-pointer"
                  aria-label="Next period"
                >
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>

              <button
                onClick={() => setShowAddModal(true)}
                className="h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 flex items-center gap-1.5 transition active:scale-[0.98] shadow-md cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Thêm kế hoạch
              </button>
            </div>
          </div>

          <section
            aria-label="Bộ lọc Calendar"
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end"
            data-testid="calendar-filter-toolbar"
          >
            <div className="w-full min-w-0 sm:w-56">
              <CalendarFilterMultiSelect
                id="calendar-project-filter"
                label="Dự án"
                allLabel="Tất cả dự án"
                countLabel={(count) => `${count} dự án đã chọn`}
                icon="project"
                options={projectFilterOptions}
                selectedIds={selectedProjectIds}
                onChange={setSelectedProjectIds}
              />
            </div>
            <div className="w-full min-w-0 sm:w-56">
              <CalendarFilterMultiSelect
                id="calendar-member-filter"
                label="Thành viên"
                allLabel="Tất cả thành viên"
                countLabel={(count) => `${count} thành viên đã chọn`}
                icon="member"
                options={memberFilterOptions}
                selectedIds={selectedMemberIds}
                onChange={setSelectedMemberIds}
              />
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-11 w-full rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:w-auto"
              >
                Xóa bộ lọc
              </button>
            ) : null}
            <p
              aria-live="polite"
              className="text-xs font-medium text-muted-foreground sm:ml-auto sm:pb-3"
              data-testid="calendar-filter-summary"
            >
              {hasActiveFilters
                ? `${activeBlocks.length}/${blocks.length} mốc phù hợp`
                : `${blocks.length} mốc · ${dayOffByDate.size} ngày off`}
            </p>
          </section>

          {error ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          {dayOffError ? (
            <div role="status" className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span>{dayOffError}</span>
              {canManageWorkspace ? <Link href="/admin#day-offs" className="shrink-0 font-semibold underline underline-offset-2">Mở Admin để cấu hình ngày nghỉ</Link> : <span className="shrink-0 font-semibold">Liên hệ Workspace Admin</span>}
            </div>
          ) : null}

          {!loading && hasActiveFilters && activeBlocks.length === 0 ? (
            <div
              role="status"
              className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
              data-testid="calendar-filter-empty"
            >
              <span>Không có mốc Calendar phù hợp với bộ lọc hiện tại.</span>
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-11 rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                Xóa bộ lọc
              </button>
            </div>
          ) : null}

          {/* Interactive Schedule View Grid */}
          {activeTab === "Year" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 md:grid-rows-4 lg:grid-rows-3 gap-6 p-6 bg-slate-50/10 rounded-2xl border border-slate-100 shadow-sm h-[calc(100vh-280px)] overflow-y-auto min-h-0">
              {Array.from({ length: 12 }).map((_, monthIdx) => {
                const monthDate = new Date(weekStart.getFullYear(), monthIdx, 1);
                const label = `Tháng ${monthIdx + 1}`;
                const monthBlocks = activeBlocks.filter((block) => {
                  const [year, month] = toVietnamDateKey(block.startAt).split("-").map(Number);
                  return year === weekStart.getFullYear() && month === monthIdx + 1;
                });
                const monthDayOffs = [...dayOffByDate.values()].filter((dayOff) => Number(dayOff.date.slice(5, 7)) === monthIdx + 1);
                const totalPlannedHours = monthBlocks.filter(block => block.kind === "planned").reduce((sum, block) => sum + block.minutes, 0);
                const totalActualHours = monthBlocks.filter(block => block.kind === "actual").reduce((sum, block) => sum + block.minutes, 0);

                return (
                  <div
                    key={monthIdx}
                    onClick={() => {
                      setWeekStart(monthDate);
                      setActiveTab("Month");
                    }}
                    className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-slate-200 transition duration-205 cursor-pointer flex flex-col justify-between h-full"
                  >
                    <div>
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                        {label}
                      </h3>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Năm {weekStart.getFullYear()}
                      </p>
                    </div>

                    <div className="border-t border-slate-50 pt-2 flex items-center justify-between mt-4">
                      <div className="text-left">
                        <p className="text-[10px] text-slate-400 font-normal">Kế hoạch</p>
                        <p className="text-xs font-bold text-slate-700 mt-0.5">
                          {monthBlocks.length} mốc
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400 font-normal">Dự tính</p>
                        <p className="text-xs font-semibold text-indigo-600 mt-0.5">
                          {formatHours(totalPlannedHours)} KH / {formatHours(totalActualHours)} TT
                        </p>
                      </div>
                      {monthDayOffs.length > 0 ? <span title={monthDayOffs.map((dayOff) => `${dayOff.date} · ${dayOff.name}`).join("\n")} className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-800">{monthDayOffs.length} ngày off</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : activeTab === "Month" ? (
            <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-md flex flex-col h-[calc(100vh-280px)]">
              {/* Month grid headers */}
              <div className="flex border-b border-slate-100 bg-slate-50/50 shrink-0">
                <div className="flex-1 grid grid-cols-7 divide-x divide-slate-100">
                  {DAY_LABELS.map((d, index) => (
                    <div key={d} className="px-4 py-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                        {DAY_LABELS[index]}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Month grid cells body */}
              <div className="grid grid-cols-7 grid-rows-6 divide-x divide-y divide-slate-100 bg-white flex-1 min-h-0">
                {monthGridDays.map((day) => {
                  const key = formatDateKey(day);
                  const dayBlocks = blocksByDay.get(key) ?? [];
                  const dayOff = dayOffByDate.get(key);
                  const isCurrentMonth = day.getMonth() === weekStart.getMonth();
                  const isToday = key === formatDateKey(new Date());

                  return (
                    <div
                      key={key}
                      onClick={() => {
                        const y = day.getFullYear();
                        const m = (day.getMonth() + 1).toString().padStart(2, "0");
                        const d = day.getDate().toString().padStart(2, "0");
                        setEventDate(`${y}-${m}-${d}`);
                        setShowAddModal(true);
                      }}
                      className={`p-2 flex flex-col justify-between transition-colors min-h-0 h-full ${
                        isToday
                          ? "bg-blue-50/20"
                          : isCurrentMonth
                          ? "bg-white"
                          : "bg-slate-50/40 text-slate-400"
                      } hover:bg-slate-50/60 cursor-pointer`}
                    >
                      <div className="flex justify-between items-start">
                        <span
                          className={`text-[10.5px] font-bold ${
                            isToday
                              ? "bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-sm"
                              : isCurrentMonth
                              ? "text-slate-700"
                              : "text-slate-400"
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        {dayBlocks.length > 0 && (
                          <span className="text-[9px] font-medium text-slate-400/80">
                            {dayBlocks.length} task
                          </span>
                        )}
                      </div>

                      {dayOff ? <span title={dayOff.name} className="mt-1 max-w-full truncate rounded-md bg-amber-50 px-1.5 py-1 text-[9px] font-semibold text-amber-800">Off · {dayOff.name}</span> : null}

                      <div className="flex-1 mt-2 space-y-1 overflow-y-auto min-h-0 scrollbar-none">
                        {dayBlocks.map((block) => {
                          const colorSchema = getBlockColorSchema(block.status);
                          return (
                            <button
                              type="button"
                              key={block.id}
                              onClick={(e) => handleOpenDetail(block, e)}
                              data-testid="calendar-event-card"
                              data-event-id={block.id}
                              data-planning-block-id={block.kind === "planned" ? block.recordId : undefined}
                              data-time-entry-id={block.kind === "actual" ? block.recordId : undefined}
                              aria-label={`${block.kind === "planned" ? "KH" : "TT"}: ${block.title}, ${formatTimeRange(block)}, ${getStatusLabel(block.status)}${block.billingExemptReason ? ", ngày nghỉ, không tính phí" : ""}`}
                              className={`text-[8.5px] font-normal px-1.5 py-0.5 rounded border-l-[2px] truncate ${colorSchema.border} ${colorSchema.bg} ${colorSchema.text} cursor-pointer hover:opacity-90`}
                              title={`${block.title} (${formatTimeRange(block)})${block.billingExemptReason ? " · Ngày nghỉ, không tính phí" : ""}`}
                            >
                              {block.title}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section data-testid="calendar-week-canvas" className="overflow-x-auto overflow-y-hidden rounded-2xl border border-slate-100 bg-white shadow-md flex flex-col">
              <div className={`flex border-b border-slate-100 bg-slate-50/50 ${activeTab === "Week" ? "min-w-[980px]" : "min-w-full"}`}>
                {/* Hour stamp spacer cell */}
                <div className="w-16 shrink-0 border-r border-slate-100" />

                {/* Day headers */}
                <div className={`flex-1 grid divide-x divide-slate-100 ${activeTab === "Day" ? "grid-cols-1" : "grid-cols-7"}`}>
                  {displayDays.map((day, index) => {
                    const key = formatDateKey(day);
                    const isToday = key === formatDateKey(new Date());
                    const dayOff = dayOffByDate.get(key);
                    const dayLabelIndex = activeTab === "Day" ? (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1) : index;
                    return (
                      <div key={key} className={`px-4 py-3 text-center ${dayOff ? "bg-amber-50/70" : isToday ? "bg-blue-50/40" : ""}`}>
                        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{DAY_LABELS[dayLabelIndex]}</p>
                        <p className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition ${
                          isToday ? "bg-blue-600 text-white shadow-sm" : "text-slate-700"
                        }`}>
                          {day.getDate()}
                        </p>
                        {dayOff ? <p title={dayOff.name} className="mx-auto mt-1 max-w-full truncate rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-900">Off · {dayOff.name}</p> : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scrollable grid body wrapper */}
              <div
                ref={scrollContainerRef}
                data-testid="calendar-time-grid"
                className={`overflow-y-auto flex-1 bg-white select-none relative ${activeTab === "Week" ? "min-w-[980px]" : "min-w-full"}`}
                style={{ maxHeight: "calc(100vh - 280px)" }}
              >
                <div className="flex relative" style={{ height: `${(END_GRID_HOUR - START_GRID_HOUR) * HOUR_ROW_HEIGHT}px` }}>
                  {/* Left hour stamps timeline */}
                  <div className="w-16 shrink-0 border-r border-slate-100 select-none relative bg-slate-50/10">
                    {Array.from({ length: END_GRID_HOUR - START_GRID_HOUR }).map((_, hourIdx) => {
                      const h = hourIdx + START_GRID_HOUR;
                      return (
                        <div
                          key={h}
                          className="absolute left-0 right-0 pr-3.5 text-right text-[10px] font-medium text-slate-400/80"
                          style={{ top: `${hourIdx * HOUR_ROW_HEIGHT}px`, transform: "translateY(-50%)" }}
                        >
                          {`${h.toString().padStart(2, "0")}:00`}
                        </div>
                      );
                    })}
                  </div>

                  {/* Columns container (Relative body) */}
                  <div className={`flex-1 grid divide-x divide-slate-100 relative ${activeTab === "Day" ? "grid-cols-1" : "grid-cols-7"}`}>

                    {/* Horizontal row line dividers spanning across columns */}
                    {Array.from({ length: END_GRID_HOUR - START_GRID_HOUR }).map((_, hourIdx) => (
                      <div
                        key={hourIdx}
                        className="absolute left-0 right-0 border-b border-slate-100/70"
                        style={{ top: `${hourIdx * HOUR_ROW_HEIGHT}px`, height: "1px" }}
                      />
                    ))}

                    {/* Day column blocks */}
                    {displayDays.map((day) => {
                      const key = formatDateKey(day);
                      const dayBlocks = blocksByDay.get(key) ?? [];
                      const isToday = key === formatDateKey(new Date());

                      return (
                        <div
                          key={key}
                          data-testid="calendar-day-column"
                          data-date-key={key}
                          className={`relative h-full ${isToday ? "bg-blue-50/10" : ""}`}
                        >
                          {/* Render absolute positioned event blocks */}
                          {(() => {
                            const overlapLayout = computeCalendarOverlapLayout(dayBlocks);
                            return dayBlocks.map((block) => {
                              const colorSchema = getBlockColorSchema(block.status);
                              const { pixelHeight, ...position } = getBlockPositionStyle(block);
                              const ol = overlapLayout.get(block.id) ?? { colIndex: 0, totalCols: 1 };

                              // Width-based layout: more stable than left+right calc
                              const OUTER_GAP = 3; // px from column edge
                              const INNER_GAP = 2; // px between overlapping cards
                              const totalCols = ol.totalCols;
                              const reservedPixels = OUTER_GAP * 2 + INNER_GAP * (totalCols - 1);
                              const colW = `calc(${100 / totalCols}% - ${reservedPixels / totalCols}px)`;
                              const leftPixels = OUTER_GAP + ol.colIndex * INNER_GAP - (ol.colIndex * reservedPixels) / totalCols;
                              const colLeft = `calc(${(100 * ol.colIndex) / totalCols}% + ${leftPixels}px)`;

                              const inlineStyle = {
                                ...position,
                                left: colLeft,
                                width: colW,
                                right: undefined
                              };

                              const displayLevel = getCalendarCardDensity(pixelHeight, totalCols);

                              const kindBadge = block.kind === "actual" ? "TT" :
                                block.status === "planned" ? "KH" :
                                block.status === "in_progress" ? "Đang" :
                                block.status === "completed" ? "Xong" : "Hủy";

                              return (
                                <button
                                  type="button"
                                  key={block.id}
                                  style={inlineStyle}
                                  onClick={(e) => handleOpenDetail(block, e)}
                                  data-testid="calendar-event-card"
                                  data-event-id={block.id}
                                  data-planning-block-id={block.kind === "planned" ? block.recordId : undefined}
                                  data-time-entry-id={block.kind === "actual" ? block.recordId : undefined}
                                  aria-label={`${block.kind === "planned" ? "KH" : "TT"}: ${block.title}, ${formatTimeRange(block)}, ${getStatusLabel(block.status)}`}
                                  className={`absolute rounded-lg border-l-2 ${colorSchema.border} ${colorSchema.bg} shadow-sm transition-all duration-150 flex flex-col overflow-hidden text-left cursor-pointer hover:shadow-md hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1`}
                                >
                                  {/* Left accent border is handled by border-l-2 */}
                                  <div className={`flex h-full min-w-0 flex-col px-1.5 ${displayLevel === "micro" ? "py-0.5" : "py-1"}`}>

                                    {/* === MICRO LEVEL: time + title only === */}
                                    {displayLevel === "micro" && (
                                      <>
                                        <div className={`text-[8px] font-medium ${colorSchema.text} leading-tight truncate`}>
                                          {formatTimeRange(block)}
                                          <span className="ml-1 opacity-60">{kindBadge}</span>
                                        </div>
                                        <div data-calendar-primary="true" className="text-[9px] font-semibold text-slate-700 leading-tight truncate mt-0.5" title={block.title}>
                                          {block.title}
                                        </div>
                                      </>
                                    )}

                                    {/* === COMPACT LEVEL: + project subtitle === */}
                                    {displayLevel === "compact" && (
                                      <>
                                        <div className="flex items-center justify-between gap-1 min-w-0">
                                          <span className={`text-[8.5px] font-medium ${colorSchema.text} leading-tight truncate flex-1`}>
                                            {formatTimeRange(block)}
                                          </span>
                                          <span className={`text-[7px] font-semibold uppercase px-1 py-0.5 rounded bg-white/70 ${colorSchema.text} shrink-0`}>
                                            {kindBadge}
                                          </span>
                                        </div>
                                        <div data-calendar-primary="true" className="text-[9.5px] font-semibold text-slate-700 leading-tight mt-0.5 truncate" title={block.title}>
                                          {block.title}
                                        </div>
                                      </>
                                    )}

                                    {/* === FULL LEVEL: all details === */}
                                    {displayLevel === "full" && (
                                      <>
                                        {/* Top row: time range + kind badge + duration */}
                                        <div className="flex items-center justify-between gap-1">
                                          <div className="flex items-center gap-1 min-w-0">
                                            <span className={`inline-flex items-center gap-0.5 text-[8.5px] font-medium px-1.5 py-0.5 rounded bg-white/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${colorSchema.text} truncate`}>
                                              <Clock className="w-2.5 h-2.5 shrink-0" />
                                              {formatTimeRange(block)}
                                            </span>
                                            <span className={`text-[7px] font-semibold uppercase px-1 py-0.5 rounded bg-white/60 ${colorSchema.text} shrink-0`}>
                                              {kindBadge}
                                            </span>
                                          </div>
                                          <span className="text-[8px] text-slate-400 shrink-0">{formatHours(block.minutes)}</span>
                                        </div>

                                        {/* Title */}
                                        <div data-calendar-primary="true" className="mt-1 text-[10px] font-semibold text-slate-700 line-clamp-2 leading-snug" title={block.title}>
                                          {block.title}
                                        </div>

                                        {/* Project & log work */}
                                        <div className="mt-0.5 min-w-0">
                                          <p className="text-[8.5px] text-slate-400/90 truncate">
                                            {block.projectName ?? ""}
                                          </p>
                                          <p className="text-[8px] text-slate-400/70 truncate mt-0.5">{getStatusLabel(block.status)}</p>
                                        </div>

                                        {/* Footer: PIC. Mutating actions live in the detail dialog. */}
                                        <div className="flex items-center gap-1 mt-auto pt-1 border-t border-slate-100/60">
                                          <div className="flex items-center gap-1 min-w-0">
                                            <div className="w-4 h-4 rounded-full overflow-hidden bg-slate-300 text-white flex items-center justify-center text-[6.5px] font-bold shrink-0">
                                              {block.userAvatarUrl
                                                ? <img src={block.userAvatarUrl} alt={block.userDisplayName ?? ""} className="w-full h-full object-cover" />
                                                : initialsFor(block.userDisplayName)}
                                            </div>
                                            <span className="text-[8px] text-slate-400 truncate">{block.userDisplayName ?? block.userId}</span>
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </button>
                              );
                            });
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      {/* Floating dynamic toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-[3000] rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 border text-xs font-bold animate-in slide-in-from-bottom-5 ${
          toast.type === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : toast.type === "danger"
            ? "bg-red-50 border-red-200 text-red-800"
            : "bg-blue-50 border-blue-200 text-blue-800"
        }`}>
          <div className={`h-2 w-2 rounded-full ${
            toast.type === "success" ? "bg-emerald-500" : toast.type === "danger" ? "bg-red-500" : "bg-blue-500"
          }`} />
          {toast.message}
        </div>
      )}

      {/* Delete Confirmation Popup */}
      <CalendarConfirmModal
        isOpen={blockToDelete !== null}
        title="Xóa mốc kế hoạch"
        message={blockToDelete?.kind === "actual"
          ? "Chỉ xóa lịch kế hoạch đã hoàn thành. Giờ thực tế đã ghi vẫn được giữ lại trong công việc."
          : "Bạn có chắc chắn muốn xóa mốc kế hoạch này không? Mốc này sẽ biến mất khỏi lịch trình tuần."}
        confirmLabel="Xóa mốc"
        cancelLabel="Hủy"
        tone="danger"
        loading={isDeletingBlock}
        error={deleteError}
        onConfirm={() => blockToDelete && void handleDeleteBlock(blockToDelete)}
        onCancel={() => {
          if (isDeletingBlock) return;
          setDeleteError(null);
          setBlockToDelete(null);
        }}
      />
      <CalendarConfirmModal
        isOpen={blockToComplete !== null}
        title="Hoàn thành kế hoạch"
        message="Bạn có chắc chắn muốn hoàn thành mốc kế hoạch này không? Thời lượng kế hoạch sẽ được ghi nhận một lần vào giờ thực tế."
        confirmLabel="Hoàn thành kế hoạch"
        cancelLabel="Hủy"
        loading={isCompletingBlock}
        onConfirm={() => blockToComplete && void handleCompleteBlock(blockToComplete)}
        onCancel={() => !isCompletingBlock && setBlockToComplete(null)}
      />

      {/* Add Event Modal */}
      {showAddModal && (
        <ModalLayer onClose={() => setShowAddModal(false)}>
        <div className="fixed inset-0 z-[2000] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div aria-label="Lên lịch kế hoạch tuần mới" aria-modal="true" role="dialog" tabIndex={-1} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] w-full max-w-md flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-50 pb-3">
              <h3 className="text-sm font-bold text-slate-800">Lên lịch kế hoạch tuần mới</h3>
              <button
                aria-label="Đóng lịch kế hoạch"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="flex flex-col gap-4">
              {/* Task dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chọn công việc (Task)</label>
                <CustomDropdown
                  label=""
                  options={taskOptions}
                  value={selectedTaskId}
                  onChange={setSelectedTaskId}
                />
              </div>

              {/* Title input */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tiêu đề kế hoạch</label>
                <input
                  type="text"
                  required
                  value={eventTitle}
                  onChange={e => setEventTitle(e.target.value)}
                  placeholder="Tiêu đề hiển thị trên lịch..."
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-400 transition"
                />
              </div>

              {/* Assignee dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Thành viên phụ trách (PIC)</label>
                <CustomDropdown
                  label=""
                  options={userOptions}
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                />
                {usersError ? <p className="text-xs font-medium text-red-600" role="alert">{usersError}</p> : null}
              </div>

              {/* Status dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trạng thái kế hoạch</label>
                <CustomDropdown
                  label=""
                  options={[
                    { value: "planned", label: "Kế hoạch (Planned)" },
                    { value: "in_progress", label: "Đang làm (In Progress)" },
                    { value: "completed", label: "Hoàn thành (Completed)" },
                    { value: "cancelled", label: "Đã hủy (Cancelled)" }
                  ]}
                  value={eventStatus}
                  onChange={(val) => setEventStatus(val as any)}
                />
              </div>

              {/* Date Input */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ngày thực hiện</label>
                <CustomDatePicker
                  ariaLabel="Ngày thực hiện"
                  value={eventDate}
                  onChange={(val) => {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                      const y = d.getFullYear();
                      const m = (d.getMonth() + 1).toString().padStart(2, "0");
                      const day = d.getDate().toString().padStart(2, "0");
                      setEventDate(`${y}-${m}-${day}`);
                    } else {
                      setEventDate("");
                    }
                  }}
                  placeholder="Chọn ngày thực hiện..."
                />
              </div>

              {/* Start/End Time Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bắt đầu lúc</label>
                  <CustomDropdown
                    label=""
                    options={timeOptions}
                    value={startTime}
                    onChange={setStartTime}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kết thúc lúc</label>
                  <CustomDropdown
                    label=""
                    options={timeOptions}
                    value={endTime}
                    onChange={setEndTime}
                  />
                </div>
              </div>

              {/* Notes input */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ghi chú kế hoạch</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Mô tả công việc dự tính thực hiện..."
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-400 transition resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-slate-50 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition active:scale-[0.98] cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEvent || Boolean(usersError) || userOptions.length === 0}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition active:scale-[0.98] shadow-md disabled:opacity-60 cursor-pointer"
                >
                  {isSubmittingEvent ? "Đang lưu..." : "Lưu kế hoạch"}
                </button>
              </div>
            </form>
          </div>
        </div>
        </ModalLayer>
      )}

      {/* Google Calendar-like Detail Popover */}
      {detailBlock && detailAnchorRect && (
        <>
          {/* Overlay mask to close the popover on click outside */}
          <div
            className="fixed inset-0 z-[240]"
            onClick={() => setDetailBlock(null)}
          />
          <div
            role="dialog"
            aria-modal="false"
            aria-label={`${detailBlock.kind === "planned" ? "Chi tiết kế hoạch" : "Chi tiết giờ thực tế"}: ${detailBlock.title}`}
            data-planning-block-id={detailBlock.kind === "planned" ? detailBlock.recordId : undefined}
            data-time-entry-id={detailBlock.kind === "actual" ? detailBlock.recordId : undefined}
            className="fixed z-[250] overflow-y-auto bg-white rounded-2xl border border-slate-100 shadow-2xl p-5 flex flex-col animate-in fade-in zoom-in-95 duration-150 text-slate-800"
            style={(() => {
              const viewportPadding = 16;
              const width = Math.min(320, window.innerWidth - viewportPadding * 2);
              const maxHeight = Math.min(480, window.innerHeight - viewportPadding * 2);
              const preferredLeft = detailAnchorRect.left > window.innerWidth / 2
                ? detailAnchorRect.left - width - 12
                : detailAnchorRect.left + detailAnchorRect.width + 12;
              const left = Math.max(viewportPadding, Math.min(window.innerWidth - width - viewportPadding, preferredLeft));
              const preferredTop = detailAnchorRect.top + detailAnchorRect.height / 2 - 130;
              const top = Math.max(viewportPadding, Math.min(window.innerHeight - maxHeight - viewportPadding, preferredTop));
              return { left, top, width, maxHeight };
            })()}
          >
            {/* Colored top indicator */}
            <div
              className="absolute top-0 left-0 right-0 h-1.5 rounded-t-2xl"
              style={{
                backgroundColor:
                  detailBlock.status === "completed" || detailBlock.status === "done"
                    ? "#10b981"
                    : detailBlock.status === "in_progress"
                    ? "#6366f1"
                    : detailBlock.status === "cancelled"
                    ? "#94a3b8"
                    : detailBlock.status === "actual"
                    ? "#10b981"
                    : detailBlock.status === "at_risk"
                    ? "#f59e0b"
                    : detailBlock.status === "blocked"
                    ? "#f97316"
                    : detailBlock.status === "on_hold"
                    ? "#eab308"
                    : "#3b82f6"
              }}
            />

            {/* Popover Toolbar Actions */}
            <div className="flex justify-end gap-1.5 -mr-1">
              {detailBlock.kind === "planned" || detailBlock.sourcePlanningBlockId ? (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteError(null);
                      setBlockToDelete(detailBlock);
                      setDetailBlock(null);
                    }}
                    className="min-h-11 min-w-11 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition cursor-pointer inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                    aria-label={detailBlock.kind === "actual" ? "Xóa lịch kế hoạch, giữ giờ thực tế" : "Xóa kế hoạch"}
                    title={detailBlock.kind === "actual" ? "Xóa lịch kế hoạch, giữ giờ thực tế" : "Xóa kế hoạch"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : null}
              <button
                onClick={() => setDetailBlock(null)}
                aria-label="Đóng chi tiết Calendar"
                className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-700 transition cursor-pointer"
                title="Đóng"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Event Title */}
            <h3 className="text-sm font-bold text-slate-800 leading-snug mt-2 line-clamp-2 pr-4">
              {detailBlock.title}
            </h3>

            {/* Time / Period badge */}
            <div className="flex items-start gap-2.5 mt-3.5 text-xs text-slate-500 font-normal">
              <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-700">
                  {(() => {
                    const formatted = formatVietnamDate(detailBlock.startAt, {
                      weekday: "long",
                      day: "2-digit",
                      month: "long"
                    });
                    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
                  })()}
                </p>
                <p className="mt-0.5 text-slate-500 text-[11.5px]">
                  {formatTimeRange(detailBlock)} ({formatHours(detailBlock.minutes)}) · {detailBlock.timeZone === "Asia/Ho_Chi_Minh" ? VIETNAM_TIME_ZONE_LABEL : detailBlock.timeZone}
                </p>
                {detailBlock.kind === "actual" && !detailBlock.hasExplicitWindow ? (
                  <p className="mt-1 text-[10.5px] font-medium text-amber-600">
                    Log cũ chưa có giờ bắt đầu/kết thúc; đang hiển thị theo khung làm việc GMT+7.
                  </p>
                ) : null}
              </div>
            </div>

            {/* Project / Task details */}
            <div className="flex items-start gap-2.5 mt-3.5 text-xs text-slate-500 font-normal">
              <Briefcase className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-700">Dự án & Công việc</p>
                <p className="mt-0.5 text-slate-500 text-[11.5px]">
                  {detailBlock.projectName || "Không rõ dự án"}
                </p>
              </div>
            </div>

            {/* PIC Assignee details */}
            <div className="flex items-start gap-2.5 mt-3.5 text-xs text-slate-500 font-normal">
              <User className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-700">Thành viên phụ trách (PIC)</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-4.5 h-4.5 rounded-full overflow-hidden bg-blue-600 text-white flex items-center justify-center text-[7.5px] font-bold shadow-inner">
                    {detailBlock.userAvatarUrl ? (
                      <img src={detailBlock.userAvatarUrl} alt={detailBlock.userDisplayName} className="w-full h-full object-cover" />
                    ) : (
                      initialsFor(detailBlock.userDisplayName)
                    )}
                  </div>
                  <span className="text-[11.5px] text-slate-600 font-medium">{detailBlock.userDisplayName || detailBlock.userId}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="flex items-start gap-2.5 mt-3.5 text-xs text-slate-500 font-normal">
              <FileText className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-700">Mô tả chi tiết</p>
                <p className="mt-0.5 text-slate-500 text-[11.5px] whitespace-pre-wrap break-words italic">
                  {detailBlock.notes || "Không có mô tả chi tiết."}
                </p>
              </div>
            </div>

            {/* Status indicators */}
            <div className="flex items-center justify-between border-t border-slate-50 mt-4 pt-3">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Trạng thái</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  detailBlock.status === "completed" || detailBlock.status === "done" || detailBlock.status === "actual"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                    : detailBlock.status === "in_progress"
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                    : detailBlock.status === "cancelled"
                    ? "bg-slate-100 text-slate-500 border border-slate-200"
                    : detailBlock.status === "at_risk"
                    ? "bg-amber-50 text-amber-700 border border-amber-100"
                    : detailBlock.status === "blocked"
                    ? "bg-orange-50 text-orange-700 border border-orange-100"
                    : detailBlock.status === "on_hold"
                    ? "bg-yellow-50 text-yellow-700 border border-yellow-100"
                    : "bg-blue-50 text-blue-700 border border-blue-100"
                }`}
              >
                {getStatusLabel(detailBlock.status)}
              </span>
            </div>

            <Link
              href={`/tasks/${encodeURIComponent(detailBlock.taskId)}`}
              prefetch={false}
              aria-label={`Mở chi tiết công việc: ${detailBlock.title}`}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-bold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Mở chi tiết công việc
            </Link>

            {completionError && detailBlock.kind === "planned" && (
              <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">
                {completionError}
              </div>
            )}

            {detailBlock.kind === "planned" && ["planned", "in_progress"].includes(detailBlock.status) && (
              <button
                type="button"
                onClick={() => setBlockToComplete(detailBlock)}
                disabled={isCompletingBlock}
                className="mt-4 min-h-11 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCompletingBlock ? "Đang hoàn thành..." : "Hoàn thành kế hoạch"}
              </button>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
