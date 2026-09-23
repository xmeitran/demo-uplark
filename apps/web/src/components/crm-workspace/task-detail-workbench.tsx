"use client";
import { useTaskPeople } from "@/hooks/use-task-people";
import { AssignmentHistory } from "./assignment-history";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";


import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useEffect } from "react";
import type {
  ResourceListResponse,
  AccountsResponse,
  ProjectSummary,
  OpportunitySummary,
  ProjectTaskSummary,
  TaskPlanningBlockSummary,
  TaskAttachmentSummary,
  TransitionProjectTaskInput,
  CreateTaskTimeEntryResponse,
  CreateTaskTimeEntryInput
} from "@b2b-crm/contracts";
import { ShopifyIcon, PolarisFallbackText, type ShopifyIconName } from "../shopify-ui";
import {
  loadTaskDrafts,
  persistTaskDrafts,
  productionWriteFailureMessage,
  taskDraftsEnabled
} from "../../features/crm-tasks/task-draft-storage";
import {
  getTaskTypeIcon,
  getDeploymentStageForTask,
  formatTaskMinutes,
  formatTaskTitle,
  getPriorityLabel,
  getStatusLabel,
  getTaskTypeLabel,
  getWorkTypeLabel,
  ToastIcon,
  type ToastTone,
  EditTaskModal,
  TransitionStatusModal,
  LogWorkModal,
  CustomDropdown,
  DatePickerField
} from "./tasks-workbench";
import {
  getDailyActualLogFeedback,
  type DailyActualLogFeedback
} from "../../features/crm-tasks/daily-actual-log-feedback";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { ModalLayer } from "../modal-layer";
import { fetchWorkspaceUserOptions } from "@/lib/workspace-users";
import {
  formatVietnamDate,
  formatVietnamTime,
  toVietnamDateInputValue,
  toVietnamDateKey,
  vietnamDateTimeToIso,
  VIETNAM_TIME_ZONE,
  VIETNAM_TIME_ZONE_LABEL
} from "@/lib/vietnam-time";
import { buildPlanningActualPresentation } from "@/lib/planning-actual-presentation";

const EditPencilIcon = ({ onClick }: { onClick?: () => void }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: 0.4, cursor: "pointer", transition: "opacity 0.15s ease", marginLeft: "6px" }}
    className="edit-pencil-hover"
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);

function formatTaskDate(value?: string) {
  if (!value) return "Chưa đặt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa đặt";
  return formatVietnamDate(date);
}

/**
 * Steps the hero title down a size as it gets longer, so more of it fits before
 * the 2-line clamp kicks in. Applied as an inline style: the global `h1 { font-size:
 * clamp(...) }` rule in styles/tokens.css is unlayered CSS, which always wins over
 * Tailwind's `@layer utilities` classes regardless of selector specificity — a plain
 * `text-*` class here is silently ignored, so this can't be a Tailwind class.
 */
function taskTitleFontSize(title: string) {
  if (title.length > 90) return 20;
  if (title.length > 55) return 24;
  return 28;
}

function resolveTimeEntryWindow(entry: any) {
  const dateKey = toVietnamDateKey(entry.startAt ?? entry.workDate);
  const workTime = formatVietnamTime(entry.workDate);
  const startIso = entry.startAt || (
    workTime && workTime !== "00:00"
      ? new Date(entry.workDate).toISOString()
      : vietnamDateTimeToIso(dateKey, "09:00")
  );
  const endIso = entry.endAt || new Date(new Date(startIso).getTime() + (entry.minutes ?? 0) * 60 * 1000).toISOString();
  return {
    startIso,
    endIso,
    hasExplicitWindow: Boolean(entry.startAt && entry.endAt)
  };
}

function formatTimeEntryWindow(entry: any) {
  const window = resolveTimeEntryWindow(entry);
  return `${formatVietnamTime(window.startIso)} - ${formatVietnamTime(window.endIso)}`;
}

function isSubtaskDone(subtask: ProjectTaskSummary) {
  return ["done", "completed", "closed"].includes(subtask.status);
}

function getPriorityTone(priority?: string) {
  if (priority === "urgent" || priority === "critical") return "critical";
  if (priority === "high") return "critical";
  if (priority === "low") return "success";
  return "warning";
}

function getStatusClass(status?: string) {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "critical";
  if (status === "todo") return "warning";
  return "neutral";
}

function getTaskDetailIconName(taskType?: string): ShopifyIconName {
  const mapped = getTaskTypeIcon(taskType || "");
  if (mapped === "settings") return "target";
  if (mapped === "order") return "briefcase";
  if (mapped === "person") return "users";
  return "clock";
}

function formatAssigneeName(userId?: string, displayName?: string) {
  if (displayName) return displayName;
  if (userId === "founder" || userId === "usr-founder" || userId === "usr-kha-founder") return "Nguyễn Hùng Việt Kha";
  if (userId === "sales-owner") return "Sales Owner";
  if (userId === "delivery-lead") return "Delivery Lead";
  return userId || "Chưa phân công";
}

function initialForName(value?: string) {
  return (value || "?").trim().charAt(0).toUpperCase() || "?";
}

const ConfirmModal = ({
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
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white border border-slate-100 rounded-2xl p-5 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] w-full max-w-sm flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150"
      >
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
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition active:scale-[0.98] cursor-pointer"
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

type TaskAttachmentView = {
  id: string;
  fileObjectId?: string;
  ext: string;
  name: string;
  size: string;
  date: string;
  initials: string;
  bg: string;
  color: string;
};

function attachmentStyle(ext: string) {
  const normalized = ext.toUpperCase();
  const bgMap: Record<string, string> = {
    PDF: "bg-red-50 text-red-600",
    PNG: "bg-emerald-50 text-emerald-600",
    JPG: "bg-emerald-50 text-emerald-600",
    JPEG: "bg-emerald-50 text-emerald-600",
    DOCX: "bg-blue-50 text-blue-600",
    DOC: "bg-blue-50 text-blue-600",
    XLSX: "bg-green-50 text-green-600",
    ZIP: "bg-purple-50 text-purple-600",
  };
  const [bg, color] = (bgMap[normalized] || "bg-slate-50 text-slate-600").split(" ");
  return { bg, color };
}

function formatAttachmentSize(byteSize: number) {
  const sizeMB = (byteSize / (1024 * 1024)).toFixed(1);
  return Number(sizeMB) > 0 ? `${sizeMB} MB` : `${(byteSize / 1024).toFixed(0)} KB`;
}

function mapTaskAttachmentToView(attachment: TaskAttachmentSummary): TaskAttachmentView {
  const name = attachment.file.fileName;
  const ext = name.split(".").pop()?.toUpperCase() || "FILE";
  const { bg, color } = attachmentStyle(ext);
  return {
    id: attachment.id,
    fileObjectId: attachment.fileObjectId,
    ext,
    name,
    size: formatAttachmentSize(attachment.file.byteSize),
    date: new Date(attachment.createdAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "long", year: "numeric" }),
    initials: "KN",
    bg,
    color
  };
}

function appendPrincipal(url: string, principal?: string) {
  if (!principal) return url;
  return `${url}${url.includes("?") ? "&" : "?"}principal=${encodeURIComponent(principal)}`;
}

function buildTaskListBackUrl(task?: ProjectTaskSummary, principal?: string) {
  if (task?.projectId) {
    return appendPrincipal(`/projects/${encodeURIComponent(task.projectId)}?tab=Tasks`, principal);
  }

  return appendPrincipal("/tasks", principal);
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}


export function TaskDetailWorkbench({
  taskId,
  tasks,
  accounts,
  projects,
  principal
}: {
  taskId: string;
  tasks: ResourceListResponse<ProjectTaskSummary>;
  accounts: AccountsResponse;
  projects: ResourceListResponse<ProjectSummary>;
  principal: string;
}) {
  const router = useRouter();
  const [localTasks, setLocalTasks] = useState<ProjectTaskSummary[]>([]);
  const [isHydratingTaskDetail, setIsHydratingTaskDetail] = useState(() => {
    const initialTask = tasks.data.find(task => task.id === taskId);
    return !initialTask || !Array.isArray(initialTask.subtasks);
  });
  const currentTask = localTasks.find(t => t.id === taskId);
  const [toast, setToast] = useState<{ message: string; type: ToastTone } | null>(null);
  const [dailyCapacityFeedback, setDailyCapacityFeedback] = useState<DailyActualLogFeedback | null>(null);
  const [taskDetailSyncError, setTaskDetailSyncError] = useState<string | null>(null);

  // Inline edit state
  const [editingField, setEditingField] = useState<string | null>(null);
  const canUseOfflineDrafts = taskDraftsEnabled();

  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [pendingSubtaskId, setPendingSubtaskId] = useState<string | null>(null);
  const subtasks = currentTask?.subtasks ?? [];
  const completedSubtasks = subtasks.filter(isSubtaskDone).length;

  // Custom client-side attachments state matching the design specs
  const [attachments, setAttachments] = useState<TaskAttachmentView[]>([]);
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<string | null>(null);

  useEffect(() => {
    const localKey = `attachments_${taskId}`;
    let cancelled = false;

    async function loadAttachments() {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments?principal=${encodeURIComponent(principal || "founder")}`);
        if (!response.ok) {
          throw new Error(`Could not load attachments: ${response.status}`);
        }
        const payload = await response.json();
        const apiAttachments = Array.isArray(payload?.data) ? payload.data.map(mapTaskAttachmentToView) : [];
        if (cancelled) return;
        setAttachments(apiAttachments);
        localStorage.setItem(localKey, JSON.stringify(apiAttachments));
        return;
      } catch (error) {
        console.warn("Failed to fetch task attachments from API, trying local fallback:", error);
      }

      if (!canUseOfflineDrafts || cancelled) {
        setAttachments([]);
        return;
      }

      const stored = localStorage.getItem(localKey);
      if (stored) {
        try {
          setAttachments(JSON.parse(stored) as TaskAttachmentView[]);
          return;
        } catch {
          setAttachments([]);
        }
      }
    }

    loadAttachments();
    return () => {
      cancelled = true;
    };
  }, [taskId, principal, canUseOfflineDrafts]);

  const saveAttachments = (nextAtts: TaskAttachmentView[]) => {
    setAttachments(nextAtts);
    localStorage.setItem(`attachments_${taskId}`, JSON.stringify(nextAtts));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!currentTask?.accountId) {
      triggerToast("Không xác định được account của task để upload file.", "danger");
      return;
    }

    const name = file.name;
    const ext = name.split(".").pop()?.toUpperCase() || "FILE";
    const sizeStr = formatAttachmentSize(file.size);
    const initials = principal === "founder" ? "KN" : "DL";
    const { bg, color } = attachmentStyle(ext);

    const offlineAttachment = {
      id: `att-${Date.now()}`,
      ext,
      name,
      size: sizeStr,
      date: new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "long", year: "numeric" }),
      initials,
      bg,
      color
    };

    try {
      const base64Data = await readFileAsBase64(file);
      const fileResponse = await fetch(`/api/files?principal=${encodeURIComponent(principal || "founder")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: currentTask.accountId,
          projectId: currentTask.projectId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          base64Data,
          ownerType: "task",
          ownerId: taskId,
          customerVisible: false,
          internalOnly: true,
          allowedRoles: []
        })
      });

      if (!fileResponse.ok) {
        throw new Error(`File upload failed: ${fileResponse.status}`);
      }
      const fileObject = await fileResponse.json();
      const attachmentResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments?principal=${encodeURIComponent(principal || "founder")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileObjectId: fileObject.id })
      });
      if (!attachmentResponse.ok) {
        throw new Error(`Task attachment link failed: ${attachmentResponse.status}`);
      }

      const savedAttachment = mapTaskAttachmentToView(await attachmentResponse.json() as TaskAttachmentSummary);
      saveAttachments([savedAttachment, ...attachments]);
      triggerToast(`Đã tải lên tập tin: ${name}`, "success");
    } catch (error) {
      console.warn("Failed to upload task attachment to API:", error);
      if (!canUseOfflineDrafts) {
        triggerToast("Không thể tải file lên backend.", "danger");
        return;
      }

      saveAttachments([...attachments, offlineAttachment]);
      triggerToast(`Đã lưu tạm tập tin: ${name}`, "info");
    }
  };

  const handleRemoveAttachment = async (id: string) => {
    const file = attachments.find(a => a.id === id);
    try {
      if (file?.fileObjectId) {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(id)}?principal=${encodeURIComponent(principal || "founder")}`, {
          method: "DELETE"
        });
        if (!response.ok) {
          throw new Error(`Task attachment delete failed: ${response.status}`);
        }
      }

      const next = attachments.filter(a => a.id !== id);
      saveAttachments(next);
      if (file) {
        triggerToast(`Đã xóa tập tin: ${file.name}`, "info");
      }
    } catch (error) {
      console.warn("Failed to delete task attachment from API:", error);
      triggerToast("Không thể xóa file trên backend.", "danger");
    }
  };

  const syncCurrentTaskSubtasks = (nextSubtasks: ProjectTaskSummary[]) => {
    const updated = localTasks.map(task => task.id === taskId ? { ...task, subtasks: nextSubtasks } : task);
    syncTasks(updated);
  };

  const handleToggleSubtask = async (subtask: ProjectTaskSummary) => {
    if (!currentTask) return;
    const nextStatus = isSubtaskDone(subtask) ? "todo" : "done";
    setPendingSubtaskId(subtask.id);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(subtask.id)}?principal=${encodeURIComponent(principal || "founder")}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      if (!response.ok) throw new Error(`Subtask status update failed: ${response.status}`);
      const savedSubtask = (await response.json()) as ProjectTaskSummary;
      syncCurrentTaskSubtasks(subtasks.map(item => item.id === subtask.id ? savedSubtask : item));
    } catch (error) {
      console.warn("Failed to update subtask status:", error);
      triggerToast("Không thể cập nhật checklist trên backend.", "danger");
    } finally {
      setPendingSubtaskId(null);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTask || !newSubtaskTitle.trim() || isAddingSubtask) return;
    setIsAddingSubtask(true);
    try {
      const response = await fetch(`/api/tasks?principal=${encodeURIComponent(principal || "founder")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: currentTask.accountId,
          projectId: currentTask.projectId,
          stageId: currentTask.stageId,
          parentTaskId: currentTask.id,
          title: newSubtaskTitle.trim(),
          taskType: "checklist",
          status: "todo",
          priority: currentTask.priority,
          assigneeUserId: currentTask.assigneeUserId,
          estimateMinutes: 0,
          customerVisible: currentTask.customerVisible
        })
      });
      if (!response.ok) throw new Error(`Subtask create failed: ${response.status}`);
      const createdSubtask = (await response.json()) as ProjectTaskSummary;
      syncCurrentTaskSubtasks([...subtasks, createdSubtask]);
      setNewSubtaskTitle("");
      triggerToast("Đã thêm subtask.", "success");
    } catch (error) {
      console.warn("Failed to create subtask:", error);
      triggerToast("Không thể tạo checklist trên backend.", "danger");
    } finally {
      setIsAddingSubtask(false);
    }
  };

  const handleDeleteSubtask = async (id: string) => {
    setPendingSubtaskId(id);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(id)}?principal=${encodeURIComponent(principal || "founder")}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error(`Subtask delete failed: ${response.status}`);
      syncCurrentTaskSubtasks(subtasks.filter(subtask => subtask.id !== id));
      triggerToast("Đã xóa subtask.", "info");
    } catch (error) {
      console.warn("Failed to delete subtask:", error);
      triggerToast("Không thể xóa checklist trên backend.", "danger");
    } finally {
      setPendingSubtaskId(null);
    }
  };


  // Temporary inline fields
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAccountId, setEditAccountId] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editTaskType, setEditTaskType] = useState("");
  const [editAssigneeUserId, setEditAssigneeUserId] = useState("");
  const [editPlannedStartAt, setEditPlannedStartAt] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editEstimateMinutes, setEditEstimateMinutes] = useState("");
  const [editCustomerVisible, setEditCustomerVisible] = useState(false);

  // Modals state
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedTimeEntry, setSelectedTimeEntry] = useState<any | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<any | null>(null); // entry to delete (with confirm modal)
  const [isDeletingTimeEntry, setIsDeletingTimeEntry] = useState(false);
  const [deleteTimeEntryError, setDeleteTimeEntryError] = useState<string | null>(null);
  const [confirmCompletePlanningEntry, setConfirmCompletePlanningEntry] = useState<any | null>(null);
  const [isCompletingPlanningEntry, setIsCompletingPlanningEntry] = useState(false);
  const [planningCompletionError, setPlanningCompletionError] = useState<string | null>(null);

  // Global editing state and draft inputs state
  const [isGlobalEditing, setIsGlobalEditing] = useState(false);
  const [showConfirmEditModal, setShowConfirmEditModal] = useState(false);
  const [showConfirmSaveModal, setShowConfirmSaveModal] = useState(false);
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAccountId, setDraftAccountId] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftPriority, setDraftPriority] = useState("");
  const [draftTaskType, setDraftTaskType] = useState("");
  const [draftAssigneeUserId, setDraftAssigneeUserId] = useState("");
  const [draftPlannedStartAt, setDraftPlannedStartAt] = useState("");
  const [draftDueAt, setDraftDueAt] = useState("");
  const [draftEstimateMinutes, setDraftEstimateMinutes] = useState("");
  const [draftCustomerVisible, setDraftCustomerVisible] = useState(false);

  // Task comments state
  const [comments, setComments] = useState<any[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"internal" | "customer">("internal");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  useEffect(() => {
    const nextTasks = loadTaskDrafts(tasks.data);
    setLocalTasks(nextTasks);
    setIsHydratingTaskDetail(true);
  }, [tasks.data, taskId]);

  const workDateContext = useSearchParams().get("workDate") ?? undefined;
  const projectPeople = useTaskPeople(currentTask?.projectId, Boolean(currentTask));
  const workspaceAssigneeOptions = projectPeople.members.map(user => ({ value: user.id, label: user.name, subtext: user.email, avatarUrl: user.avatarUrl, initials: user.initials, color: user.color }));

  const triggerToast = (message: string, type: ToastTone = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const announceDailyCapacity = (feedback: DailyActualLogFeedback | null) => {
    setDailyCapacityFeedback(feedback);
    if (feedback) setTimeout(() => setDailyCapacityFeedback(null), 6500);
  };

  const syncTasks = (updatedList: ProjectTaskSummary[]) => {
    setLocalTasks(updatedList);
    persistTaskDrafts(updatedList);
  };

  const loadCanonicalTask = async () => {
    const response = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}?principal=${encodeURIComponent(principal || "founder")}`,
      { cache: "no-store", credentials: "same-origin" }
    );
    if (!response.ok) {
      throw new Error("Không thể tải lại dữ liệu công việc mới nhất. Vui lòng tải lại trang.");
    }
    const task = await response.json() as ProjectTaskSummary;
    if (!task?.id || task.id !== taskId) {
      throw new Error("Dữ liệu công việc mới nhất không hợp lệ. Vui lòng tải lại trang.");
    }
    return {
      ...task,
      planningBlocks: Array.isArray(task.planningBlocks) ? task.planningBlocks : [],
      timeEntries: Array.isArray(task.timeEntries) ? task.timeEntries : [],
      subtasks: Array.isArray(task.subtasks) ? task.subtasks : []
    } satisfies ProjectTaskSummary;
  };

  const replaceWithCanonicalTask = (task: ProjectTaskSummary) => {
    syncTasks(localTasks.map(item => item.id === taskId ? task : item));
  };

  const fetchComments = async () => {
    const localKey = `lark_crm_task_comments_${taskId}`;
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments?principal=${encodeURIComponent(principal || "founder")}`);
      if (!res.ok) {
        throw new Error("API call failed");
      }
      const data = await res.json();
      const commentsList = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
      setComments(commentsList);
      localStorage.setItem(localKey, JSON.stringify(commentsList));
    } catch (err) {
      console.warn("Failed to fetch comments from API, trying local fallback:", err);
      if (!canUseOfflineDrafts) {
        setComments([]);
        return;
      }

      const saved = localStorage.getItem(localKey);
      if (saved) {
        try {
          setComments(JSON.parse(saved));
        } catch {
          setComments([]);
        }
      } else {
        setComments([]);
      }
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;

    setIsSubmittingComment(true);
    const localKey = `lark_crm_task_comments_${taskId}`;
    const newCommentPayload = {
      body: commentBody.trim(),
      visibility: commentVisibility
    };

    setDailyCapacityFeedback(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments?principal=${encodeURIComponent(principal || "founder")}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(newCommentPayload)
      });

      if (!res.ok) {
        throw new Error("Failed to post comment to server");
      }

      await fetchComments();
      setCommentBody("");
      triggerToast("Đã thêm bình luận thành công!");
    } catch (err) {
      console.warn("Failed to post comment to API, using offline fallback:", err);
      if (!canUseOfflineDrafts) {
        triggerToast("Không thể lưu bình luận lên backend.", "danger");
        return;
      }

      const mockComment = {
        id: `local-comment-${Date.now()}`,
        taskId,
        accountId: currentTask?.accountId || "",
        body: commentBody.trim(),
        visibility: commentVisibility,
        status: "active",
        syncStatus: "pending",
        createdByUserId: principal || "founder",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const currentComments = [...comments, mockComment];
      setComments(currentComments);
      localStorage.setItem(localKey, JSON.stringify(currentComments));
      setCommentBody("");
      triggerToast("Đã lưu bình luận.", "success");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [taskId, principal]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateTaskDetail() {
      setIsHydratingTaskDetail(true);
      setTaskDetailSyncError(null);
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}?principal=${encodeURIComponent(principal || "founder")}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) {
          throw new Error(`Task detail returned ${response.status}`);
        }

        const task = await response.json() as ProjectTaskSummary;
        if (!task?.id || task.id !== taskId) {
          throw new Error("Task detail response is not canonical");
        }
        if (cancelled) return;

        const canonicalTask: ProjectTaskSummary = {
          ...task,
          planningBlocks: Array.isArray(task.planningBlocks) ? task.planningBlocks : [],
          timeEntries: Array.isArray(task.timeEntries) ? task.timeEntries : [],
          subtasks: Array.isArray(task.subtasks) ? task.subtasks : []
        };

        setLocalTasks(prevTasks => {
          if (prevTasks.some(item => item.id === canonicalTask.id)) {
            return prevTasks.map(item => item.id === canonicalTask.id ? canonicalTask : item);
          }
          return [canonicalTask, ...prevTasks];
        });
      } catch (error) {
        console.warn("Failed to hydrate task detail from API:", error);
        if (!cancelled) {
          setTaskDetailSyncError("Không thể đồng bộ dữ liệu công việc mới nhất. Nội dung tạm thời có thể chưa đầy đủ.");
        }
      } finally {
        if (!cancelled) {
          setIsHydratingTaskDetail(false);
        }
      }
    }

    hydrateTaskDetail();

    return () => {
      cancelled = true;
    };
  }, [principal, taskId]);

  const startEditing = (field: string) => {
    if (!currentTask) return;
    setEditingField(field);
    if (field === "title") setEditTitle(currentTask.title || "");
    else if (field === "description") setEditDescription(currentTask.description || "");
    else if (field === "accountId") setEditAccountId(currentTask.accountId || "");
    else if (field === "projectId") setEditProjectId(currentTask.projectId || "none");
    else if (field === "priority") setEditPriority(currentTask.priority || "medium");
    else if (field === "taskType") setEditTaskType(currentTask.taskType || "implementation");
    else if (field === "assigneeUserId") setEditAssigneeUserId(currentTask.assigneeUserId || "none");
    else if (field === "plannedStartAt") setEditPlannedStartAt(toVietnamDateInputValue(currentTask.plannedStartAt));
    else if (field === "dueAt") setEditDueAt(toVietnamDateInputValue(currentTask.dueAt));
    else if (field === "estimateMinutes") setEditEstimateMinutes(currentTask.estimateMinutes?.toString() || "");
    else if (field === "customerVisible") setEditCustomerVisible(currentTask.customerVisible ?? false);
  };

  const startGlobalEditing = () => {
    if (!currentTask) return;
    setDraftTitle(currentTask.title || "");
    setDraftDescription(currentTask.description || "");
    setDraftAccountId(currentTask.accountId || "");
    setDraftProjectId(currentTask.projectId || "none");
    setDraftPriority(currentTask.priority || "medium");
    setDraftTaskType(currentTask.taskType || "implementation");
    setDraftAssigneeUserId(currentTask.assigneeUserId || "none");
    setDraftPlannedStartAt(toVietnamDateInputValue(currentTask.plannedStartAt));
    setDraftDueAt(toVietnamDateInputValue(currentTask.dueAt));
    setDraftEstimateMinutes(currentTask.estimateMinutes?.toString() || "");
    setDraftCustomerVisible(currentTask.customerVisible ?? false);
    setIsGlobalEditing(true);
  };

  const handleConfirmEdit = () => {
    setShowConfirmEditModal(false);
    startGlobalEditing();
  };

  const handleConfirmSave = async () => {
    setShowConfirmSaveModal(false);
    await handleSaveAllFields();
  };

  const handleSaveAllFields = async () => {
    if (!currentTask) return;

    const accountObj = accounts.data.find(a => a.id === draftAccountId);
    const accountName = accountObj?.name || "Unknown Account";

    let finalProjectId: string | undefined = draftProjectId;
    let finalProjectName: string | undefined = undefined;
    if (draftProjectId === "none" || !draftProjectId) {
      finalProjectId = undefined;
      finalProjectName = undefined;
    } else {
      const projectObj = projects.data.find(p => p.id === draftProjectId);
      finalProjectName = projectObj?.name;
      if (projectObj && projectObj.accountId !== draftAccountId) {
        finalProjectId = undefined;
        finalProjectName = undefined;
      }
    }

    const selectedAssignee = workspaceAssigneeOptions.find(opt => opt.value === draftAssigneeUserId);
    const assigneeDisplayName = draftAssigneeUserId === "none" || !draftAssigneeUserId
      ? "Chưa giao"
      : selectedAssignee
      ? selectedAssignee.label
      : "Chưa giao";

    const taskInput: any = {
      accountId: draftAccountId,
      accountName,
      projectId: finalProjectId,
      projectName: finalProjectName,
      title: draftTitle,
      description: draftDescription,
      taskType: draftTaskType,
      priority: draftPriority,
      assigneeUserId: draftAssigneeUserId === "none" ? undefined : draftAssigneeUserId,
      assigneeDisplayName,
      plannedStartAt: draftPlannedStartAt ? new Date(draftPlannedStartAt).toISOString() : undefined,
      dueAt: draftDueAt ? new Date(draftDueAt).toISOString() : undefined,
      estimateMinutes: draftEstimateMinutes ? Number(draftEstimateMinutes) : 0,
      customerVisible: draftCustomerVisible
    };

    const body = {
      accountId: taskInput.accountId,
      projectId: taskInput.projectId,
      title: taskInput.title,
      description: taskInput.description,
      taskType: taskInput.taskType,
      priority: taskInput.priority,
      assigneeUserId: taskInput.assigneeUserId,
      plannedStartAt: taskInput.plannedStartAt,
      dueAt: taskInput.dueAt,
      estimateMinutes: taskInput.estimateMinutes,
      customerVisible: taskInput.customerVisible
    };

    try {
      const response = await fetch(`/api/tasks/${taskId}?principal=${encodeURIComponent(principal)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();
      const savedTask = (await response.json()) as ProjectTaskSummary;

      const editHistoryItem = {
        id: `hist-edit-${Date.now()}`,
        taskId: taskId,
        accountId: taskInput.accountId,
        toStatus: currentTask.status,
        changedAt: new Date().toISOString(),
        reason: "Task details updated (Chỉnh sửa thông tin task)."
      };

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            ...savedTask,
            statusHistory: [editHistoryItem, ...(t.statusHistory || [])],
            updatedAt: savedTask.updatedAt ?? new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setIsGlobalEditing(false);
      triggerToast(`Đã cập nhật công việc "${formatTaskTitle(taskInput.title)}".`, "success");
    } catch (max) {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Offline fallback
      const editHistoryItem = {
        id: `hist-edit-${Date.now()}`,
        taskId: taskId,
        accountId: taskInput.accountId,
        toStatus: currentTask.status,
        changedAt: new Date().toISOString(),
        reason: "Task details updated (Chỉnh sửa thông tin task - Ngoại tuyến)."
      };

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            ...taskInput,
            statusHistory: [editHistoryItem, ...(t.statusHistory || [])],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setIsGlobalEditing(false);
      triggerToast("Đã lưu chỉnh sửa ngoại tuyến.", "info");
    }
  };

  const handleSaveField = async (fieldName: string, value: any) => {
    if (!currentTask) return;

    const updatedInput: any = {
      accountId: currentTask.accountId,
      accountName: currentTask.accountName,
      projectId: currentTask.projectId,
      projectName: currentTask.projectName,
      title: currentTask.title,
      description: currentTask.description,
      taskType: currentTask.taskType,
      priority: currentTask.priority,
      assigneeUserId: currentTask.assigneeUserId,
      assigneeDisplayName: currentTask.assigneeDisplayName,
      plannedStartAt: currentTask.plannedStartAt,
      dueAt: currentTask.dueAt,
      estimateMinutes: currentTask.estimateMinutes,
      customerVisible: currentTask.customerVisible,
      [fieldName]: value
    };

    if (fieldName === "accountId") {
      const accountObj = accounts.data.find(a => a.id === value);
      updatedInput.accountName = accountObj?.name || "Unknown Account";

      const projectObj = projects.data.find(p => p.id === currentTask.projectId);
      if (projectObj && projectObj.accountId !== value) {
        updatedInput.projectId = undefined;
        updatedInput.projectName = undefined;
      }
    }

    if (fieldName === "projectId") {
      if (value === "none" || !value) {
        updatedInput.projectId = undefined;
        updatedInput.projectName = undefined;
      } else {
        const projectObj = projects.data.find(p => p.id === value);
        updatedInput.projectName = projectObj?.name;
      }
    }

    if (fieldName === "assigneeUserId") {
      updatedInput.assigneeDisplayName =
        value === "founder"
          ? "Kha Nguyen (Founder)"
          : value === "sales-owner"
          ? "Sales Owner"
          : value === "delivery-lead"
          ? "Delivery Lead"
          : "Deliverer Team";
    }

    if (fieldName === "estimateMinutes") {
      updatedInput.estimateMinutes = value ? Number(value) : 0;
    }

    await handleEditTask(updatedInput);
  };

  const backUrl = buildTaskListBackUrl(currentTask, principal);

  // API Call: Edit Task
  const handleEditTask = async (taskInput: any) => {
    if (!currentTask) return;

    const body = {
      accountId: taskInput.accountId,
      projectId: taskInput.projectId,
      title: taskInput.title,
      description: taskInput.description,
      taskType: taskInput.taskType,
      priority: taskInput.priority,
      assigneeUserId: taskInput.assigneeUserId,
      plannedStartAt: taskInput.plannedStartAt,
      dueAt: taskInput.dueAt,
      estimateMinutes: taskInput.estimateMinutes,
      customerVisible: taskInput.customerVisible
    };

    try {
      const response = await fetch(`/api/tasks/${taskId}?principal=${encodeURIComponent(principal)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();
      const savedTask = (await response.json()) as ProjectTaskSummary;

      const editHistoryItem = {
        id: `hist-edit-${Date.now()}`,
        taskId: taskId,
        accountId: taskInput.accountId,
        toStatus: currentTask.status,
        changedAt: new Date().toISOString(),
        reason: "Task details updated (Chỉnh sửa thông tin task)."
      };

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            ...savedTask,
            statusHistory: [editHistoryItem, ...(t.statusHistory || [])],
            updatedAt: savedTask.updatedAt ?? new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowEditModal(false);
      triggerToast(`Đã cập nhật công việc "${formatTaskTitle(taskInput.title)}".`, "success");
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Offline fallback
      const editHistoryItem = {
        id: `hist-edit-${Date.now()}`,
        taskId: taskId,
        accountId: taskInput.accountId,
        toStatus: currentTask.status,
        changedAt: new Date().toISOString(),
        reason: "Đã cập nhật thông tin công việc ở chế độ ngoại tuyến."
      };

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            ...taskInput,
            statusHistory: [editHistoryItem, ...(t.statusHistory || [])],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowEditModal(false);
      triggerToast("Đã cập nhật công việc ở chế độ ngoại tuyến.", "info");
    }
  };

  // API Call: Transition Task
  const handleTransitionTask = async (newStatus: string, reason: string) => {
    if (!currentTask) return;

    const body: TransitionProjectTaskInput = {
      status: newStatus,
      reason,
      changedAt: new Date().toISOString()
    };

    let transitionAccepted = false;
    try {
      const response = await fetch(`/api/tasks/${taskId}/transitions?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();
      transitionAccepted = true;
      const responseTask = await response.json() as ProjectTaskSummary;
      if (responseTask.id !== taskId || responseTask.status !== newStatus) {
        throw new Error("Transition response did not confirm the requested status.");
      }

      const readBackResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}?principal=${encodeURIComponent(principal || "founder")}`, { cache: "no-store" });
      if (!readBackResponse.ok) throw new Error("Could not verify the saved task status.");
      const savedTask = await readBackResponse.json() as ProjectTaskSummary;
      if (savedTask.id !== taskId || savedTask.status !== newStatus) {
        throw new Error("Saved task status did not match the requested transition.");
      }

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            ...savedTask
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowTransitionModal(false);
      triggerToast(`Đã chuyển trạng thái sang "${getStatusLabel(newStatus)}".`, "success");
    } catch {
      if (transitionAccepted) {
        setShowTransitionModal(false);
        triggerToast("Backend đã nhận yêu cầu chuyển trạng thái, nhưng chưa xác minh được trạng thái đã lưu. Hãy tải lại trước khi thao tác tiếp.", "danger");
        return;
      }
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      // Offline fallback
      const newHistoryItem = {
        id: `hist-${Date.now()}`,
        taskId: taskId,
        accountId: currentTask.accountId,
        fromStatus: currentTask.status,
        toStatus: newStatus,
        changedAt: new Date().toISOString(),
        reason
      };

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            status: newStatus,
            statusHistory: [newHistoryItem, ...(t.statusHistory || [])],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowTransitionModal(false);
      triggerToast("Đã chuyển trạng thái ở chế độ ngoại tuyến.", "info");
    }
  };

  const handleLogWork = async (logInput: any) => {
    if (!currentTask) return;

    // Handle Time Planning/Estimation
    if (logInput.type === "plan") {
      const selectedUserId = typeof logInput.userId === "string" && logInput.userId.trim() ? logInput.userId : undefined;
      const selectedStartTime = logInput.startTime || "09:00";
      const startAt = new Date(vietnamDateTimeToIso(logInput.workDate, selectedStartTime));
      const endAt = logInput.endTime
        ? new Date(vietnamDateTimeToIso(logInput.workDate, logInput.endTime))
        : new Date(startAt.getTime() + logInput.minutes * 60 * 1000);
      if (endAt <= startAt) {
        endAt.setDate(endAt.getDate() + 1);
      }

      const body: any = {
        userId: selectedUserId,
        title: currentTask.title,
        notes: logInput.note || "Kế hoạch thực hiện công việc",
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        plannedMinutes: logInput.minutes,
        billable: logInput.billable,
        workType: logInput.workType,
        status: "planned"
      };

      try {
        const response = await fetch(`/api/tasks/${taskId}/planning-blocks?principal=${encodeURIComponent(principal)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error();
        const savedPlanningBlock = await response.json() as TaskPlanningBlockSummary;

        const selectedAssignee = workspaceAssigneeOptions.find(opt => opt.value === savedPlanningBlock.userId);
        const userDisplayName = savedPlanningBlock.userDisplayName || selectedAssignee?.label || "Authenticated user";

        const updated = localTasks.map(t => {
          if (t.id === taskId) {
            return {
              ...t,
              planningBlocks: [
                savedPlanningBlock,
                ...(t.planningBlocks || []).filter(block => block.id !== savedPlanningBlock.id)
              ],
              updatedAt: new Date().toISOString()
            };
          }
          return t;
        });

        syncTasks(updated);
        setShowLogModal(false);
        triggerToast(`Đã lưu kế hoạch thời gian: ${formatTaskMinutes(logInput.minutes)} cho ${userDisplayName} và đồng bộ Calendar.`, "success");
      } catch (error) {
        if (!canUseOfflineDrafts) {
          console.error("Failed to create task planning block", error);
          triggerToast(productionWriteFailureMessage(), "danger");
          return;
        }

        if (!selectedUserId) {
          triggerToast("Không thể lưu kế hoạch ngoại tuyến khi chưa chọn một người dùng thật trong workspace.", "danger");
          return;
        }

        const selectedAssignee = workspaceAssigneeOptions.find(opt => opt.value === selectedUserId);
        const userDisplayName = selectedAssignee?.label || "Workspace user";
        const createdAt = new Date().toISOString();
        const newPlanningBlock: TaskPlanningBlockSummary = {
          id: `planning-local-${Date.now()}`,
          taskId: taskId,
          accountId: currentTask.accountId,
          accountName: currentTask.accountName,
          projectId: currentTask.projectId,
          projectName: currentTask.projectName,
          userId: selectedUserId,
          userDisplayName,
          title: currentTask.title,
          notes: body.notes,
          startAt: body.startAt,
          endAt: body.endAt,
          plannedMinutes: body.plannedMinutes,
          billable: body.billable,
          workType: body.workType,
          status: "planned",
          source: "offline",
          createdAt,
          updatedAt: createdAt
        };

        const updated = localTasks.map(t => {
          if (t.id === taskId) {
            return {
              ...t,
              planningBlocks: [newPlanningBlock, ...(t.planningBlocks || [])],
              updatedAt: new Date().toISOString()
            };
          }
          return t;
        });

        syncTasks(updated);
        setShowLogModal(false);
        triggerToast("Đã lưu kế hoạch thời gian ngoại tuyến.", "info");
      }
      return;
    }

    // Handle Actual Work Logging
    const body: CreateTaskTimeEntryInput = {
      userId: typeof logInput.userId === "string" && logInput.userId.trim() ? logInput.userId : undefined,
      workDate: logInput.workDate,
      startAt: logInput.startAt,
      endAt: logInput.endAt,
      timeZone: logInput.timeZone ?? VIETNAM_TIME_ZONE,
      minutes: logInput.minutes,
      billable: logInput.billable,
      workType: logInput.workType,
      note: logInput.note
    };

    try {
      const response = await fetch(`/api/tasks/${taskId}/time-entries?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error();
      const savedEntry = await response.json() as CreateTaskTimeEntryResponse;
      if (!savedEntry?.id) {
        setShowLogModal(false);
        triggerToast("Backend đã nhận giờ làm nhưng không trả về mã bản ghi; chưa thực hiện thao tác hoàn thành để tránh báo thành công sai.", "danger");
        return;
      }

      const selectedAssignee = workspaceAssigneeOptions.find(opt => opt.value === savedEntry.userId);
      const userDisplayName = savedEntry.userDisplayName ?? selectedAssignee?.label ?? "Authenticated user";
      const capacityFeedback = getDailyActualLogFeedback(savedEntry.dailyActualLog, userDisplayName);
      announceDailyCapacity(capacityFeedback);
      const { dailyActualLog: _dailyActualLog, ...savedTimeEntry } = savedEntry;

      const newEntry = {
        ...savedTimeEntry,
        id: savedTimeEntry.id,
        taskId: taskId,
        accountId: currentTask.accountId,
        userId: savedTimeEntry.userId,
        userDisplayName: savedTimeEntry.userDisplayName ?? userDisplayName,
        userAvatarUrl: savedTimeEntry.userAvatarUrl,
        workDate: savedTimeEntry.workDate ?? logInput.workDate,
        startAt: savedTimeEntry.startAt ?? logInput.startAt,
        endAt: savedTimeEntry.endAt ?? logInput.endAt,
        timeZone: savedTimeEntry.timeZone ?? logInput.timeZone,
        minutes: savedTimeEntry.minutes ?? logInput.minutes,
        billable: savedTimeEntry.billable ?? logInput.billable,
        workType: savedTimeEntry.workType ?? logInput.workType,
        approvalStatus: savedTimeEntry.approvalStatus ?? "approved",
        note: savedTimeEntry.note ?? logInput.note,
        createdAt: savedTimeEntry.createdAt ?? new Date().toISOString()
      };

      let completionFailedAfterSavedHours = false;
      let transitionRequestSucceeded = false;
      if (logInput.completeTask && currentTask.status !== "completed") {
        try {
          const changedAt = new Date().toISOString();
          const transitionBody: TransitionProjectTaskInput = {
            status: "completed",
            reason: "Đã hoàn thành công việc sau khi ghi giờ làm.",
            changedAt
          };
          const transitionResponse = await fetch(`/api/tasks/${taskId}/transitions?principal=${encodeURIComponent(principal)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(transitionBody)
          });
          if (!transitionResponse.ok) {
            completionFailedAfterSavedHours = true;
          } else {
            transitionRequestSucceeded = true;
          }
        } catch {
          completionFailedAfterSavedHours = true;
        }
      }

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          const entries = [...(t.timeEntries || []), newEntry];
          const totalLogged = entries.reduce((acc, curr) => acc + (curr.approvalStatus !== "planned" ? curr.minutes : 0), 0);
          return {
            ...t,
            timeEntries: entries,
            loggedMinutes: totalLogged,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowLogModal(false);
      const canonicalResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}?principal=${encodeURIComponent(principal || "founder")}`, { cache: "no-store" }).catch(() => null);
      const canonicalTask = canonicalResponse?.ok ? await canonicalResponse.json() as ProjectTaskSummary : null;
      const savedEntryId = String(savedTimeEntry.id || "");
      const entryReadBack = Boolean(canonicalTask?.timeEntries?.some((entry) => entry.id === savedEntryId));
      const completionReadBack = canonicalTask?.status === "completed";
      if (canonicalTask) {
        const canonicalTasks = localTasks.map((task) => task.id === taskId ? { ...task, ...canonicalTask } : task);
        syncTasks(canonicalTasks);
      }
      if (completionFailedAfterSavedHours) {
        triggerToast(`Đã lưu ${formatTaskMinutes(logInput.minutes)}; yêu cầu hoàn thành công việc thất bại. Hãy thử lại chỉ thao tác hoàn thành.`, "danger");
        return;
      }
      if (!entryReadBack || (logInput.completeTask && !completionReadBack)) {
        triggerToast(`Backend đã nhận ${formatTaskMinutes(logInput.minutes)}${logInput.completeTask && transitionRequestSucceeded ? " và yêu cầu hoàn thành" : ""}, nhưng chưa xác minh được trạng thái khi đọc lại. Hãy tải lại trước khi thao tác tiếp.`, "danger");
        return;
      }
      triggerToast(`Đã ghi ${formatTaskMinutes(logInput.minutes)} làm việc${completionReadBack ? " và hoàn thành công việc" : ""}.`, "success");
    } catch {
      if (!canUseOfflineDrafts) {
        triggerToast(productionWriteFailureMessage(), "danger");
        return;
      }

      if (!body.userId) {
        triggerToast("Không thể lưu giờ làm ngoại tuyến khi chưa chọn một người dùng thật trong workspace.", "danger");
        return;
      }

      const selectedAssignee = workspaceAssigneeOptions.find(opt => opt.value === body.userId);
      const userDisplayName = selectedAssignee?.label || "Workspace user";

      const newEntry = {
        id: `entry-${Date.now()}`,
        taskId: taskId,
        accountId: currentTask.accountId,
        userId: body.userId,
        userDisplayName,
        workDate: logInput.workDate,
        startAt: logInput.startAt,
        endAt: logInput.endAt,
        timeZone: logInput.timeZone,
        minutes: logInput.minutes,
        billable: logInput.billable,
        workType: logInput.workType,
        approvalStatus: "submitted",
        note: logInput.note,
        createdAt: new Date().toISOString()
      };

      const offlineTransitionHistoryItem = logInput.completeTask && currentTask.status !== "completed" ? {
          id: `hist-${Date.now()}`,
          taskId: taskId,
          accountId: currentTask.accountId,
          fromStatus: currentTask.status,
          toStatus: "completed",
          changedAt: new Date().toISOString(),
          reason: "Đã hoàn thành công việc sau khi ghi giờ làm (Ngoại tuyến)."
        } : null;
      const offlineNextStatus = offlineTransitionHistoryItem ? "completed" : undefined;

      const updated = localTasks.map(t => {
        if (t.id === taskId) {
          const entries = [...(t.timeEntries || []), newEntry];
          const totalLogged = entries.reduce((acc, curr) => acc + (curr.approvalStatus !== "planned" ? curr.minutes : 0), 0);
          return {
            ...t,
            status: offlineNextStatus || t.status,
            statusHistory: offlineTransitionHistoryItem
              ? [offlineTransitionHistoryItem, ...(t.statusHistory || [])]
              : t.statusHistory,
            timeEntries: entries,
            loggedMinutes: totalLogged,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      syncTasks(updated);
      setShowLogModal(false);
      triggerToast(`Đã ghi thời gian ngoại tuyến${offlineNextStatus ? " và hoàn thành công việc" : ""}.`, "info");
    }
  };

  const handleDeleteTimeEntry = async (entry: any) => {
    if (!currentTask) return;
    const deletesPlanningSource = entry.entryKind === "planning" || entry.deleteKind === "planning-source";
    const entryId = deletesPlanningSource
      ? (entry.entryKind === "planning" ? entry.id : entry.sourcePlanningBlockId)
      : entry.id;
    if (typeof entryId !== "string" || !entryId) return;

    setIsDeletingTimeEntry(true);
    setDeleteTimeEntryError(null);
    try {
      const url = deletesPlanningSource
        ? `/api/tasks/planning-blocks/${encodeURIComponent(entryId)}`
        : `/api/tasks/time-entries/${encodeURIComponent(entryId)}`;

      const response = await fetch(url, { method: "DELETE", credentials: "same-origin" });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!response.ok) {
        let message = deletesPlanningSource
          ? "Không thể xóa mốc kế hoạch trên backend."
          : "Không thể xóa thời gian đã ghi trên backend.";
        try {
          const payload = await response.json();
          if (typeof payload?.message === "string" && payload.message.trim()) message = payload.message.trim();
        } catch {
          // Keep the production-safe fallback message.
        }
        throw new Error(message);
      }

      const canonicalTask = await loadCanonicalTask();
      replaceWithCanonicalTask(canonicalTask);
      setConfirmDeleteEntry(null);
      setSelectedTimeEntry(null);
      triggerToast(
        deletesPlanningSource && entry.entryKind === "actual"
          ? "Đã xóa lịch kế hoạch. Giờ thực tế vẫn được giữ lại."
          : deletesPlanningSource
            ? "Đã xóa mốc kế hoạch."
            : "Đã xóa thời gian đã ghi.",
        "info"
      );
    } catch (err) {
      console.error("Delete time record failed:", err);
      const message = err instanceof Error
        ? err.message
        : deletesPlanningSource
          ? "Không thể xóa mốc kế hoạch trên backend."
          : "Không thể xóa thời gian đã ghi trên backend.";
      setDeleteTimeEntryError(message);
      triggerToast(message, "danger");
    } finally {
      setIsDeletingTimeEntry(false);
    }
  };

  const handleCompletePlanningEntry = async (entry: any) => {
    if (!currentTask || entry.entryKind !== "planning") return;

    setIsCompletingPlanningEntry(true);
    setPlanningCompletionError(null);
    try {
      const response = await fetch(
        `/api/tasks/planning-blocks/${encodeURIComponent(entry.id)}/transitions`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            expectedUpdatedAt: entry.updatedAt,
            reason: "Hoàn thành kế hoạch từ chi tiết công việc"
          })
        }
      );

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (response.status === 409) {
        let refreshedTask: ProjectTaskSummary;
        try {
          refreshedTask = await loadCanonicalTask();
        } catch {
          throw new Error("Kế hoạch đã được cập nhật ở nơi khác nhưng không thể tải dữ liệu mới nhất. Vui lòng tải lại trang.");
        }
        replaceWithCanonicalTask(refreshedTask);
        const generatedActual = refreshedTask.timeEntries?.find(item => item.sourcePlanningBlockId === entry.id);
        const refreshedBlock = refreshedTask.planningBlocks?.find(item => item.id === entry.id);
        setSelectedTimeEntry(generatedActual
          ? { ...generatedActual, entryKind: "actual" as const }
          : refreshedBlock
            ? {
                ...refreshedBlock,
                entryKind: "planning" as const,
                approvalStatus: "planned",
                planningStatus: refreshedBlock.status,
                workDate: refreshedBlock.startAt,
                minutes: refreshedBlock.plannedMinutes,
                note: refreshedBlock.notes
              }
            : null);
        throw new Error("Kế hoạch đã được cập nhật ở nơi khác. Dữ liệu mới nhất đã được tải lại.");
      }
      if (!response.ok) {
        let message = "Không thể hoàn thành kế hoạch trên backend.";
        try {
          const payload = await response.json();
          if (typeof payload?.message === "string" && payload.message.trim()) message = payload.message;
        } catch {
          // Keep the production-safe fallback message.
        }
        throw new Error(message);
      }

      const savedBlock = await response.json() as TaskPlanningBlockSummary;
      const canonicalTask = await loadCanonicalTask();
      const generatedActual = canonicalTask.timeEntries?.find(item => item.sourcePlanningBlockId === savedBlock.id);
      if (!generatedActual) {
        throw new Error("Kế hoạch đã hoàn thành nhưng giờ thực tế chưa xuất hiện trong dữ liệu mới nhất. Vui lòng tải lại trang.");
      }

      replaceWithCanonicalTask(canonicalTask);
      setSelectedTimeEntry(null);
      setConfirmCompletePlanningEntry(null);
      triggerToast(
        `Đã hoàn thành kế hoạch. ${formatTaskMinutes(generatedActual.minutes)} đã được tính vào tổng thời gian.`,
        "success"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể hoàn thành kế hoạch trên backend.";
      setPlanningCompletionError(message);
      setConfirmCompletePlanningEntry(null);
      triggerToast(message, "danger");
    } finally {
      setIsCompletingPlanningEntry(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const removeLocalTask = () => {
      const updated = localTasks.filter(t => t.id !== taskId);
      syncTasks(updated);
      triggerToast("Đã xóa công việc.", "success");
      setTimeout(() => {
        router.push(backUrl);
      }, 1000);
    };

    setIsDeletingTask(true);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}?principal=${encodeURIComponent(principal)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (!response.ok) {
        let message = productionWriteFailureMessage();
        try {
          const body = await response.json();
          if (typeof body?.message === "string" && body.message.trim()) {
            message = body.message;
          }
        } catch {
          // Keep the default production-safe failure message.
        }
        throw new Error(message);
      }

      setShowConfirmDeleteModal(false);
      removeLocalTask();
    } catch (error) {
      if (canUseOfflineDrafts) {
        setShowConfirmDeleteModal(false);
        removeLocalTask();
        return;
      }
      triggerToast(error instanceof Error ? error.message : productionWriteFailureMessage(), "danger");
    } finally {
      setIsDeletingTask(false);
    }
  };

  if (!currentTask && isHydratingTaskDetail) {
    return (
      <AppShell activeRoute="/projects" title="Task Detail">
        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Page body skeleton */}
          <main className="flex-1 overflow-auto bg-[#f5f7fa] p-3 sm:p-6">
            <div className="flex flex-col gap-5 animate-pulse">

              {/* Hero card skeleton */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-6 py-5">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-3 w-20 rounded-full bg-slate-100" />
                  <div className="h-2 w-2 rounded-full bg-slate-100" />
                  <div className="h-3 w-32 rounded-full bg-slate-100" />
                  <div className="h-2 w-2 rounded-full bg-slate-100" />
                  <div className="h-3 w-48 rounded-full bg-slate-100" />
                </div>
                {/* Title row */}
                <div className="flex items-start gap-4">
                  <div className="shrink-0 mt-0.5 h-10 w-10 rounded-xl bg-slate-100" />
                  <div className="flex-1 min-w-0">
                    <div className="h-6 w-3/4 rounded-lg bg-slate-100 mb-3" />
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-24 rounded-full bg-slate-100" />
                      <div className="h-4 w-16 rounded-full bg-slate-100" />
                      <div className="h-4 w-16 rounded-full bg-slate-100" />
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <div className="h-8 w-20 rounded-xl bg-slate-100" />
                    <div className="h-8 w-20 rounded-xl bg-slate-100" />
                    <div className="h-8 w-28 rounded-xl bg-slate-100" />
                  </div>
                </div>
                {/* Progress bar area */}
                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center gap-4">
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full w-1/3 rounded-full bg-indigo-100" />
                  </div>
                  <div className="h-3 w-12 rounded-full bg-slate-100" />
                </div>
              </div>

              {/* Two-column layout skeleton */}
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
                {/* Left column */}
                <div className="flex flex-col gap-5">
                  {[
                    { lines: 3, headerW: "w-28" },
                    { lines: 4, headerW: "w-36" },
                    { lines: 2, headerW: "w-32" }
                  ].map((card, ci) => (
                    <div key={ci} className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                      {/* Card header */}
                      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-50">
                        <div className="h-5 w-5 rounded-lg bg-slate-100" />
                        <div className={`h-3 ${card.headerW} rounded-full bg-slate-100`} />
                      </div>
                      {/* Card body */}
                      <div className="px-5 py-4 flex flex-col gap-3">
                        {Array.from({ length: card.lines }).map((_, li) => (
                          <div key={li} className="h-3 rounded-full bg-slate-100" style={{ width: `${100 - li * 12}%` }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Right sidebar skeleton */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden h-fit">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-50">
                    <div className="h-5 w-5 rounded-lg bg-slate-100" />
                    <div className="h-3 w-24 rounded-full bg-slate-100" />
                  </div>
                  <div className="px-5 py-4 flex flex-col gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-1.5">
                        <div className="h-2.5 w-16 rounded-full bg-slate-100" />
                        <div className="h-4 w-full rounded-lg bg-slate-100" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            {/* Center loading indicator */}
            <div className="fixed inset-0 pointer-events-none flex items-end justify-center pb-8">
              <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur-sm border border-slate-100 rounded-2xl px-5 py-3 shadow-lg">
                <svg className="animate-spin h-4 w-4 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs font-semibold text-slate-600">Đang tải chi tiết công việc...</span>
              </div>
            </div>
          </main>
        </div>
      </AppShell>
    );
  }

  if (!currentTask) {
    return (
      <AppShell activeRoute="/projects" title="Task Detail">
          {toast && (
            <div
              aria-live="polite"
              role="status"
              className="fixed bottom-4 left-4 right-4 z-[9999] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg animate-slide-up sm:bottom-6 sm:left-auto sm:right-6"
              style={{ background: toast.type === "success" ? "rgba(22,163,74,0.95)" : toast.type === "danger" ? "rgba(220,38,38,0.95)" : "rgba(92,106,196,0.95)" }}
            >
              <ToastIcon type={toast.type} />
              <span>{toast.message}</span>
            </div>
          )}
          <main className="flex-1 overflow-auto bg-[#f5f7fa] flex items-center justify-center p-4 sm:p-6">
            <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-10 py-10 flex flex-col items-center gap-4 max-w-sm w-full text-center">
              <div className="h-14 w-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-400">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Không tìm thấy công việc</p>
                <p className="mt-1 text-xs text-slate-400">Công việc với ID <code className="font-mono text-xs bg-slate-100 rounded px-1">{taskId}</code> không tồn tại hoặc đã bị xóa.</p>
              </div>
              <Link
                href={backUrl}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2 text-xs font-semibold text-white transition-all active:scale-[0.98]"
              >
                <ArrowLeft aria-hidden="true" className="inline h-3 w-3 align-middle" /> Quay lại danh sách
              </Link>
            </div>
          </main>
      </AppShell>
    );
  }


  const loggedMinutes = currentTask.loggedMinutes ?? 0;
  const estimateMinutes = currentTask.estimateMinutes ?? 0;
  const timeHistoryEntries = buildPlanningActualPresentation(
    currentTask.planningBlocks || [],
    currentTask.timeEntries || []
  ).map(item => item.kind === "planned"
    ? {
        ...item.record,
        entryKind: "planning" as const,
        approvalStatus: "planned",
        planningStatus: item.record.status,
        workDate: item.record.startAt,
        minutes: item.record.plannedMinutes,
        note: item.record.notes
      }
    : {
        ...item.record,
        entryKind: "actual" as const
      }
  ).sort((left, right) => {
    const leftDate = new Date(left.startAt ?? left.workDate ?? left.createdAt).getTime();
    const rightDate = new Date(right.startAt ?? right.workDate ?? right.createdAt).getTime();
    return rightDate - leftDate;
  });
  const effortPercent = estimateMinutes > 0 ? Math.min(100, Math.round((loggedMinutes / estimateMinutes) * 100)) : 0;
  const statusClass = getStatusClass(currentTask.status);
  const priorityClass = getPriorityTone(currentTask.priority);
  const displayTitle = formatTaskTitle(currentTask.title);
  const displayTaskType = getTaskTypeLabel(currentTask.taskType);
  const displayPriority = getPriorityLabel(currentTask.priority);
  const displayStatus = getStatusLabel(currentTask.status);
  const displayAssignee = formatAssigneeName(currentTask.assigneeUserId, currentTask.assigneeDisplayName);
  const assigneeAvatarUrl =
    currentTask.assigneeAvatarUrl ||
    workspaceAssigneeOptions.find((option) => option.value === currentTask.assigneeUserId)?.avatarUrl;



  const STATUS_PILL: Record<string, { bg: string; color: string }> = {
    completed:   { bg: "#dcfce7", color: "#16a34a" },
    in_progress: { bg: "#dbeafe", color: "#2563eb" },
    todo:        { bg: "#f1f5f9", color: "#64748b" },
    blocked:     { bg: "#fee2e2", color: "#dc2626" },
  };
  const PRIORITY_PILL: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#fee2e2", color: "#dc2626" },
    critical: { bg: "#fee2e2", color: "#dc2626" },
    high:   { bg: "#fef3c7", color: "#d97706" },
    medium: { bg: "#dbeafe", color: "#2563eb" },
    low:    { bg: "#dcfce7", color: "#16a34a" },
  };
  const sPill = STATUS_PILL[currentTask.status ?? ""] ?? { bg: "#f1f5f9", color: "#64748b" };
  const pPill = PRIORITY_PILL[currentTask.priority ?? ""] ?? { bg: "#f1f5f9", color: "#64748b" };

  return (
    <AppShell activeRoute="/projects" title="Task Detail">
        <main className="flex-1 overflow-auto bg-[#f5f7fa]">
          <div className="flex w-full flex-col gap-5 px-3 py-4 sm:px-6 sm:py-6">

            {projectPeople.loading && <p role="status">Loading project members…</p>}
            {projectPeople.error && <div role="alert">{projectPeople.error} <button onClick={projectPeople.refresh}>Retry loading project members</button></div>}
            <AssignmentHistory taskId={currentTask.id} revision={`${currentTask.assigneeUserId}:${currentTask.ownerUserId}`} people={projectPeople.members} />
            {taskDetailSyncError ? (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                {taskDetailSyncError}
              </div>
            ) : null}

            {/* ── ① Hero Header ────────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:px-6 sm:py-5">

              {/* Breadcrumb */}
              <nav className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                <Link href={backUrl} className="hover:text-indigo-600 transition-colors">Công việc</Link>
                {currentTask.projectName && (
                  <>
                    <svg className="h-3 w-3 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    <Link href={buildTaskListBackUrl(currentTask, principal)} className="hover:text-indigo-600 transition-colors max-w-[180px] truncate">
                      {currentTask.projectName}
                    </Link>
                  </>
                )}
                <svg className="h-3 w-3 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                <span className="text-slate-600 truncate max-w-[240px]">{displayTitle}</span>
              </nav>

              {/* Title row */}
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  {/* Task icon badge */}
                  <div className="shrink-0 mt-0.5 h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <ShopifyIcon name={getTaskDetailIconName(currentTask.taskType)} size={18} />
                  </div>

                  <div className="flex-1 min-w-0">
                    {isGlobalEditing ? (
                      <input
                        type="text"
                        value={draftTitle}
                        onChange={e => setDraftTitle(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xl font-bold text-slate-900 outline-none ring-2 ring-indigo-500/15 focus:border-indigo-400 transition"
                        autoFocus
                      />
                    ) : (
                      <div className="group relative inline-block max-w-full align-top">
                        {/* No line-clamp: the length-based font size above already keeps this
                            balanced, so the full title stays visible instead of being cut off. */}
                        <h1
                          style={{ fontSize: taskTitleFontSize(displayTitle), fontWeight: 700, lineHeight: 1.35 }}
                          title={displayTitle}
                        >{displayTitle}</h1>
                        {/* Full-title tooltip — themed via the popover design tokens so it matches
                            light/dark mode instead of a hardcoded dark card. */}
                        <div
                          className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-max max-w-md rounded-xl border p-3 text-xs font-medium leading-relaxed opacity-0 shadow-xl transition-all duration-200 group-hover:opacity-100"
                          style={{
                            backgroundColor: "var(--color-popover)",
                            color: "var(--color-popover-foreground)",
                            borderColor: "var(--color-border)"
                          }}
                        >
                          <div
                            className="absolute -top-1 left-4 h-2 w-2 rotate-45 border-l border-t"
                            style={{ backgroundColor: "var(--color-popover)", borderColor: "var(--color-border)" }}
                          />
                          {displayTitle}
                        </div>
                      </div>
                    )}

                    {/* Status + priority badges */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-slate-400 font-medium">{displayTaskType}</span>
                      <span className="text-slate-200">·</span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide"
                        style={{ background: sPill.bg, color: sPill.color }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: sPill.color }} />
                        {displayStatus}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide"
                        style={{ background: pPill.bg, color: pPill.color }}
                      >
                        {displayPriority}
                      </span>
                      {currentTask.overdue && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide bg-red-50 text-red-500">
                          Quá hạn
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:shrink-0 xl:justify-end">
                  <Link
                    href={backUrl}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all active:scale-[0.98]"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5"/>
                      <path d="M12 19l-7-7 7-7"/>
                    </svg>
                    Quay lại danh sách
                  </Link>
                  {isGlobalEditing ? (
                    <>
                      <button
                        onClick={() => setIsGlobalEditing(false)}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all active:scale-[0.98]"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={() => setShowConfirmSaveModal(true)}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-sm shadow-indigo-200"
                      >
                        Lưu thay đổi
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowConfirmEditModal(true)}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all active:scale-[0.98]"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Chỉnh sửa
                      </button>
                      <button
                        onClick={() => setShowTransitionModal(true)}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all active:scale-[0.98]"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                          <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                        </svg>
                        Đổi trạng thái
                      </button>
                      {currentTask.status !== "completed" ? (
                        <button
                          onClick={() => handleTransitionTask("completed", "Đánh dấu hoàn tất nhanh từ chi tiết công việc.")}
                          className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 text-xs font-semibold text-emerald-700 transition-all active:scale-[0.98] cursor-pointer"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          Hoàn tất
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTransitionTask("todo", "Mở lại công việc.")}
                          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-all active:scale-[0.98] cursor-pointer"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                          </svg>
                          Mở lại
                        </button>
                      )}
                      <button
                        onClick={() => setShowLogModal(true)}
                        className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-sm shadow-indigo-200"
                      >
                        <ShopifyIcon name="plus" size={12} />
                        Ghi giờ
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Meta bar */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5">
                  <ShopifyIcon name="users" size={11} />
                  <span className="font-semibold text-slate-700">{currentTask.accountName}</span>
                </div>
                {currentTask.projectName && (
                  <div className="flex items-center gap-1.5">
                    <ShopifyIcon name="briefcase" size={11} />
                    <span className="font-semibold text-slate-700">{currentTask.projectName}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <ShopifyIcon name="users" size={11} />
                  <span>Phụ trách:</span>
                  <span className="font-semibold text-slate-700">{displayAssignee}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShopifyIcon name="clock" size={11} />
                  <span className="font-semibold text-slate-700">{formatTaskMinutes(loggedMinutes)}</span>
                  <span className="text-slate-400">/ {formatTaskMinutes(estimateMinutes)}</span>
                  {estimateMinutes > 0 && (
                    <span className="inline-block h-1.5 w-14 rounded-full bg-slate-100 overflow-hidden align-middle">
                      <span className="block h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${effortPercent}%` }} />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <ShopifyIcon name="calendar" size={11} />
                  <span>Hạn chót:</span>
                  <span className={`font-semibold ${currentTask.overdue ? "text-red-500" : "text-slate-700"}`}>{formatTaskDate(currentTask.dueAt)}</span>
                </div>
              </div>
            </div>

            {/* ── ② Quick Stats Bar ────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
              {[
                {
                  icon: <ShopifyIcon name="clock" size={16} />,
                  bg: "bg-indigo-50", color: "text-indigo-600",
                  label: "Đã ghi", value: formatTaskMinutes(loggedMinutes)
                },
                {
                  icon: <ShopifyIcon name="target" size={16} />,
                  bg: "bg-violet-50", color: "text-violet-600",
                  label: "Ước tính", value: estimateMinutes ? formatTaskMinutes(estimateMinutes) : "—"
                },
                {
                  icon: <ShopifyIcon name="check" size={16} />,
                  bg: "bg-emerald-50", color: "text-emerald-600",
                  label: "Subtasks", value: `${completedSubtasks}/${subtasks.length}`
                },
                {
                  icon: <ShopifyIcon name="calendar" size={16} />,
                  bg: currentTask.overdue ? "bg-red-50" : "bg-amber-50",
                  color: currentTask.overdue ? "text-red-500" : "text-amber-600",
                  label: "Hạn chót", value: formatTaskDate(currentTask.dueAt)
                }
              ].map(stat => (
                <div
                  key={stat.label}
                  className="bg-white border border-slate-100 rounded-2xl px-4 py-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex items-center gap-3"
                >
                  <div className={`h-9 w-9 shrink-0 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center`}>
                    {stat.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{stat.label}</p>
                    <p className="text-sm font-bold text-slate-800 truncate">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── ③ Two-column layout ──────────────────────────────────────────────── */}
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">

              {/* ─────── LEFT COLUMN ─────── */}
              <div className="flex flex-col gap-5">

                {/* Description */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/>
                          <line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>
                        </svg>
                      </div>
                      <div className="text-xs font-bold text-slate-700 tracking-wide">Mô tả chi tiết</div>
                    </div>
                    {!isGlobalEditing && (
                      <button
                        onClick={() => setShowConfirmEditModal(true)}
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
                      >
                        Chỉnh sửa
                      </button>
                    )}
                  </div>
                  <div className="px-6 py-5">
                    {isGlobalEditing ? (
                      <textarea
                        value={draftDescription}
                        onChange={e => setDraftDescription(e.target.value)}
                        rows={6}
                        placeholder="Nhập mô tả công việc..."
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-400 transition resize-y leading-relaxed"
                      />
                    ) : (
                      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {currentTask.description || <span className="italic text-slate-300 text-xs">Chưa có mô tả chi tiết.</span>}
                      </p>
                    )}
                  </div>
                </div>

                {/* Subtasks */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="h-5 w-5 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                        <ShopifyIcon name="check" size={11} />
                      </div>
                      <div className="text-xs font-bold text-slate-700 tracking-wide">Subtasks</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-400">
                        {completedSubtasks}/{subtasks.length}
                      </span>
                      {subtasks.length > 0 && (
                        <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                            style={{ width: `${subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-6 py-4 flex flex-col gap-1">
                    {subtasks.map(sub => {
                      const done = isSubtaskDone(sub);
                      const disabled = pendingSubtaskId === sub.id;
                      return (
                      <div
                        key={sub.id}
                        className={`group flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors ${disabled ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => handleToggleSubtask(sub)}
                            aria-label={done ? `Đánh dấu chưa xong ${sub.title}` : `Đánh dấu hoàn tất ${sub.title}`}
                            className={`shrink-0 h-[18px] w-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all ${
                              done
                                ? "bg-emerald-500 border-emerald-500 text-white"
                                : "border-slate-300 hover:border-emerald-400 bg-white"
                            }`}
                          >
                            {done && (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </button>
                          <span className={`text-sm transition-colors ${done ? "line-through text-slate-400" : "text-slate-700 font-medium"}`}>
                            {sub.title}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => handleDeleteSubtask(sub.id)}
                          className="p-1.5 text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-lg hover:bg-red-50"
                          title="Xóa"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    );
                    })}

                    {subtasks.length === 0 && (
                      <p className="text-xs text-slate-400 italic text-center py-4">Chưa có subtask nào. Thêm bên dưới!</p>
                    )}

                    <form onSubmit={handleAddSubtask} className="flex items-center gap-2 mt-2 pt-3 border-t border-slate-100">
                      <input
                        type="text"
                        value={newSubtaskTitle}
                        onChange={e => setNewSubtaskTitle(e.target.value)}
                        placeholder="Thêm subtask mới..."
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-400 transition"
                      />
                      <button
                        type="submit"
                        disabled={isAddingSubtask || !newSubtaskTitle.trim()}
                        className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isAddingSubtask ? "Đang thêm" : "Thêm"}
                      </button>
                    </form>
                  </div>
                </div>

                {/* Attachments */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="h-5 w-5 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                        </svg>
                      </div>
                      <div className="text-xs font-bold text-slate-700 tracking-wide">Tài liệu đính kèm ({attachments.length})</div>
                    </div>
                    {attachments.length > 0 && (
                      <span className="text-[10px] text-slate-400 font-medium">Đã đồng bộ</span>
                    )}
                  </div>
                  <div className="p-0 flex flex-col">
                    {attachments.length > 0 ? (
                      <div className="overflow-x-auto w-full">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50/50">
                              <th className="px-6 py-2.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tên tập tin</th>
                              <th className="px-6 py-2.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Kích thước</th>
                              <th className="px-6 py-2.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Ngày tải</th>
                              <th className="px-6 py-2.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Người tải</th>
                              <th className="px-6 py-2.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider text-right">Xóa</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {attachments.map(file => (
                              <tr key={file.id} className="hover:bg-slate-50/30 transition-colors group">
                                <td className="px-6 py-2.5 flex items-center gap-2.5 min-w-[200px]">
                                  <div className={`h-7 w-7 rounded-lg ${file.bg} ${file.color} flex items-center justify-center font-bold text-[9px] shrink-0`}>
                                    {file.ext}
                                  </div>
                                  <span className="text-xs font-semibold text-slate-700 truncate group-hover:text-indigo-600 transition-colors max-w-[180px]" title={file.name}>
                                    {file.name}
                                  </span>
                                </td>
                                <td className="px-6 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{file.size}</td>
                                <td className="px-6 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{file.date}</td>
                                <td className="px-6 py-2.5">
                                  <span className="h-5 w-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[9px] font-bold">
                                    {file.initials}
                                  </span>
                                </td>
                                <td className="px-6 py-2.5 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => setDeleteAttachmentId(file.id)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                                    title="Xóa tập tin"
                                  >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic text-center py-6">Chưa có tài liệu đính kèm nào.</p>
                    )}

                    <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex justify-center">
                      <input
                        type="file"
                        id="task-file-uploader"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      <label
                        htmlFor="task-file-uploader"
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-slate-300 bg-white hover:border-indigo-500 hover:text-indigo-600 text-xs font-semibold text-slate-600 transition-all cursor-pointer shadow-sm hover:shadow"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        Tải lên tập tin mới
                      </label>
                    </div>
                  </div>
                </div>

                {/* Time Logs + Status History */}
                <div className="grid gap-5 md:grid-cols-2">

                  {/* Time Logs */}
                  <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600">
                          <ShopifyIcon name="clock" size={11} />
                        </div>
                        <div className="text-xs font-bold text-slate-700 tracking-wide">Giờ đã ghi</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-700">{formatTaskMinutes(loggedMinutes)} thực tế</span>
                        <span className="text-[10px] text-slate-400">/ {formatTaskMinutes(estimateMinutes)} kế hoạch</span>
                      </div>
                    </div>

                    {estimateMinutes > 0 && (
                      <div className="px-5 pt-3 pb-2.5 bg-slate-50/50 border-b border-slate-100/80 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                          <span>Hiệu suất thực tế so với kế hoạch</span>
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                            loggedMinutes > estimateMinutes
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : loggedMinutes === estimateMinutes
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : "bg-indigo-50 text-indigo-700 border border-indigo-100"
                          }`}>
                            {Math.round((loggedMinutes / estimateMinutes) * 100)}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              loggedMinutes > estimateMinutes ? "bg-amber-500 animate-pulse" : "bg-indigo-600"
                            }`}
                            style={{ width: `${Math.min(100, (loggedMinutes / estimateMinutes) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="px-5 py-4 flex-1">
                      {timeHistoryEntries.length > 0 ? (
                        <div className="flex flex-col gap-2 max-h-[220px] overflow-auto p-0.5">
                          {timeHistoryEntries.map((entry: any) => {
                              const isPlanned = entry.entryKind === "planning";
                              const isApproved = entry.approvalStatus === "approved";
                              const isRejected = entry.approvalStatus === "rejected";
                              const entryDisplayName = formatAssigneeName(entry.userId, entry.userDisplayName);
                              const entryAvatarUrl =
                                entry.userAvatarUrl ||
                                workspaceAssigneeOptions.find((option) => option.value === entry.userId)?.avatarUrl;

                              // Work type pill config (hex, matches LogWorkModal dropdown)
                              const WORK_TYPE_PILL: Record<string, { bg: string; color: string; label: string }> = {
                                delivery:       { bg: "#dbeafe", color: "#1d4ed8", label: "Triển khai" },
                                consulting:     { bg: "#f3e8ff", color: "#7e22ce", label: "Tư vấn KH" },
                                meeting:        { bg: "#e0f2fe", color: "#0369a1", label: "Họ p" },
                                training:       { bg: "#d1fae5", color: "#065f46", label: "Đào tạo" },
                                support:        { bg: "#fef3c7", color: "#92400e", label: "Hỗ trợ" },
                                blueprint:      { bg: "#ede9fe", color: "#6d28d9", label: "Thiết kế" },
                                rework:         { bg: "#fee2e2", color: "#b91c1c", label: "Làm lại" },
                                internal_admin: { bg: "#f1f5f9", color: "#475569", label: "Nội bộ" },
                                kh_c:           { bg: "#e0e7ff", color: "#3730a3", label: "KH C" },
                              };
                              const wtPill = WORK_TYPE_PILL[(entry.workType ?? "").toLowerCase()]
                                ?? { bg: "#f1f5f9", color: "#64748b", label: getWorkTypeLabel(entry.workType) };

                              // Approval status config — hex values match calendar blockColors exactly
                              const approvalConfig = isPlanned
                                ? {
                                    bg: "#dbeafe",
                                    color: "#1d4ed8",
                                    label: entry.planningStatus === "completed"
                                      ? "Kế hoạch hoàn tất"
                                      : entry.planningStatus === "cancelled"
                                      ? "Kế hoạch đã hủy"
                                      : "Kế hoạch"
                                  }
                                : isApproved
                                ? { bg: "#d1fae5", color: "#065f46", label: "Đã duyệt" }
                                : isRejected
                                ? { bg: "#f1f5f9", color: "#475569", label: "Từ chối" }
                                : { bg: "#fef3c7", color: "#92400e", label: "Chờ duyệt" };

                              return (
                                <div
                                  key={entry.id}
                                  data-planning-block-id={isPlanned ? entry.id : undefined}
                                  data-time-entry-id={!isPlanned ? entry.id : undefined}
                                  onClick={() => {
                                    setPlanningCompletionError(null);
                                    setSelectedTimeEntry(entry);
                                  }}
                                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                                    isPlanned
                                      ? "bg-slate-50/60 border-dashed border-slate-200 hover:bg-slate-100/60"
                                      : "bg-white border-slate-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-50"
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    {/* Avatar */}
                                    <div className={`shrink-0 h-8 w-8 rounded-full overflow-hidden flex items-center justify-center text-[10px] font-bold ${
                                      isPlanned ? "bg-indigo-100 text-indigo-800" : "bg-indigo-50 text-indigo-700"
                                    }`}>
                                      {entryAvatarUrl ? (
                                        <img src={entryAvatarUrl} alt={entryDisplayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                      ) : (
                                        initialForName(entryDisplayName || entry.userId)
                                      )}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                      {/* Row 1: Name + hours */}
                                      <div className="flex items-start justify-between gap-2">
                                        <span className="text-xs font-semibold text-slate-700 truncate">{entryDisplayName}</span>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <span className={`text-xs font-bold ${isPlanned ? "text-indigo-500" : "text-indigo-600"}`}>
                                            {formatTaskMinutes(entry.minutes)}
                                          </span>
                                          {/* Delete entry button */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setDeleteTimeEntryError(null);
                                              setConfirmDeleteEntry(entry.sourcePlanningBlockId
                                                ? { ...entry, deleteKind: "planning-source" }
                                                : entry);
                                            }}
                                            title={isPlanned || entry.sourcePlanningBlockId
                                              ? "Xóa lịch kế hoạch, giữ giờ thực tế"
                                              : "Xóa giờ thực tế"}
                                            aria-label={isPlanned || entry.sourcePlanningBlockId
                                              ? "Xóa lịch kế hoạch, giữ giờ thực tế"
                                              : "Xóa giờ thực tế"}
                                            className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 cursor-pointer"
                                          >
                                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                            </svg>
                                          </button>
                                        </div>
                                      </div>

                                      {/* Row 2: Date + badges */}
                                      <div className="flex items-center flex-wrap gap-1.5 mt-1">
                                        <span className="text-[10px] text-slate-400 font-medium">
                                          📅 {formatVietnamDate(entry.startAt ?? entry.workDate)} · {formatTimeEntryWindow(entry)}
                                        </span>
                                        {/* Approval status */}
                                        <span
                                          className="inline-flex rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
                                          style={{ background: approvalConfig.bg, color: approvalConfig.color }}
                                        >
                                          {approvalConfig.label}
                                        </span>
                                        {/* Work type */}
                                        {entry.workType && (
                                          <span
                                            className="inline-flex rounded-full px-1.5 py-px text-[9px] font-semibold"
                                            style={{ background: wtPill.bg, color: wtPill.color }}
                                          >
                                            {wtPill.label}
                                          </span>
                                        )}
                                        {/* Billable */}
                                        {entry.billable !== undefined && (
                                          <span className={`inline-flex rounded-full px-1.5 py-px text-[9px] font-medium ${
                                            entry.billable ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                                          }`}>
                                            {entry.billingExemptReason ? "Ngày nghỉ · không tính phí" : entry.billable ? "💰 Tính phí" : "Không tính phí"}
                                          </span>
                                        )}
                                      </div>

                                      {/* Row 3: Description / note */}
                                      {entry.note && (
                                        <p className="mt-1.5 text-[10px] text-slate-500 italic leading-relaxed line-clamp-3">
                                          {entry.note}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2.5 py-8 text-center">
                          <div className="h-10 w-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                            <ShopifyIcon name="clock" size={18} />
                          </div>
                          <p className="text-xs text-slate-400">Chưa có kế hoạch hoặc giờ thực tế nào.</p>
                          <button
                            onClick={() => setShowLogModal(true)}
                            className="rounded-xl bg-indigo-50 hover:bg-indigo-100 px-4 py-1.5 text-xs font-semibold text-indigo-600 transition-colors"
                          >
                            Ghi giờ đầu tiên
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status History */}
                  <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                          <ShopifyIcon name="trend" size={11} />
                        </div>
                        <div className="text-xs font-bold text-slate-700 tracking-wide">Lịch sử trạng thái</div>
                      </div>
                    </div>
                    <div className="px-5 py-4 flex-1">
                      {currentTask.statusHistory && currentTask.statusHistory.length > 0 ? (
                        <ol className="flex flex-col max-h-[240px] overflow-auto">
                          {currentTask.statusHistory.map((hist: any, index: number) => (
                            <li key={hist.id} className="flex items-start gap-3 pb-3 last:pb-0">
                              <div className="relative flex flex-col items-center shrink-0 mt-1">
                                <div className="h-2 w-2 rounded-full bg-indigo-500" />
                                {index < (currentTask.statusHistory?.length ?? 0) - 1 && (
                                  <div className="w-px flex-1 bg-slate-100 mt-1 min-h-[18px]" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-700 leading-snug">
                                    {hist.fromStatus
                                      ? <>{getStatusLabel(hist.fromStatus)} <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-middle" /> {getStatusLabel(hist.toStatus)}</>
                                      : getStatusLabel(hist.toStatus)}
                                  </span>
                                  <time className="text-[10px] text-slate-400 shrink-0 mt-px">
                                    {new Date(hist.changedAt).toLocaleDateString("vi-VN")}
                                  </time>
                                </div>
                                {hist.reason && <p className="mt-0.5 text-[10px] text-slate-400 italic">{hist.reason}</p>}
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="flex flex-col items-center gap-2.5 py-8 text-center">
                          <div className="h-10 w-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                            <ShopifyIcon name="trend" size={18} />
                          </div>
                          <p className="text-xs text-slate-400">Chưa có lịch sử chuyển đổi.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Comments */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-visible relative">
                  <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="h-5 w-5 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                      </div>
                      <div className="text-xs font-bold text-slate-700 tracking-wide">Bình luận</div>
                      {comments.length > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-px text-[10px] font-bold text-slate-500">{comments.length}</span>
                      )}
                    </div>
                  </div>

                  <div className="px-6 py-5 flex flex-col gap-4">
                    {comments && comments.length > 0 ? (
                      <div className="flex flex-col gap-3 max-h-[320px] overflow-auto pr-1">
                        {comments.map((comment: any) => {
                          const isInternal = comment.visibility === "internal";
                          const isOffline = comment.id?.toString().startsWith("local-comment");
                          const authorId = comment.createdByUserId;
                          const author = authorId === "founder" || authorId === "usr-founder" || authorId === "usr-kha-founder"
                            ? "Nguyễn Hùng Việt Kha"
                            : authorId === "sales-owner" ? "Sales Owner"
                            : authorId === "delivery-lead" ? "Delivery Lead"
                            : authorId || "Thành viên";
                          const avatarBg = ["bg-indigo-100 text-indigo-700","bg-violet-100 text-violet-700","bg-emerald-100 text-emerald-700","bg-amber-100 text-amber-700"];
                          const ci = author.charCodeAt(0) % avatarBg.length;
                          return (
                            <div key={comment.id} className="flex gap-3">
                              <div className={`shrink-0 h-7 w-7 rounded-full ${avatarBg[ci]} flex items-center justify-center text-[11px] font-bold mt-0.5`}>
                                {author[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-slate-700">{author}</span>
                                    <time className="text-[10px] text-slate-400">{new Date(comment.createdAt).toLocaleString("vi-VN")}</time>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {isOffline && <span className="rounded-full px-1.5 py-px text-[9px] bg-amber-50 text-amber-600 border border-amber-100 font-medium">Offline</span>}
                                    <span className={`rounded-full px-1.5 py-px text-[9px] border font-medium ${isInternal ? "bg-slate-100 border-slate-200 text-slate-500" : "bg-emerald-50 border-emerald-100 text-emerald-600"}`}>
                                      {isInternal ? "Nội bộ" : "Khách hàng"}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">{comment.body}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2.5 py-6 text-center">
                        <div className="h-10 w-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                        </div>
                        <p className="text-xs text-slate-400">Chưa có bình luận nào. Hãy là người đầu tiên!</p>
                      </div>
                    )}

                    <form onSubmit={handleSubmitComment} className="flex flex-col gap-3 border-t border-slate-100 pt-4">
                      <textarea
                        value={commentBody}
                        onChange={e => setCommentBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmitComment(e);
                          }
                        }}
                        placeholder="Viết bình luận..."
                        rows={2}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-400 transition resize-none leading-relaxed"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-medium">Đối tượng:</span>
                          <div className="w-32">
                            <CustomDropdown
                              label=""
                              value={commentVisibility}
                              options={[
                                { value: "internal", label: "Nội bộ", icon: "person" },
                                { value: "customer", label: "Khách hàng", icon: "person" }
                              ]}
                              onChange={(val: string) => setCommentVisibility(val as any)}
                              openDirection="up"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={isSubmittingComment || !commentBody.trim()}
                          className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          {isSubmittingComment ? "Đang gửi..." : "Gửi"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>

              {/* ─────── RIGHT SIDEBAR (sticky) ─────── */}
              <aside className="flex flex-col gap-5 lg:sticky lg:top-5 self-start">

                {/* Task Properties */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      </div>
                      <div className="text-xs font-bold text-slate-700 tracking-wide">Thuộc tính</div>
                    </div>
                  </div>

                  <div className="px-5 py-1 divide-y divide-slate-100">
                    {/* Account */}
                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Khách hàng</p>
                      {isGlobalEditing ? (
                        <CustomDropdown label="" value={draftAccountId} options={accounts.data.map((a: any) => ({ value: a.id, label: a.name, icon: "person" }))} onChange={(val: string) => setDraftAccountId(val)} />
                      ) : (
                        <p className="text-xs font-semibold text-slate-800 truncate">{currentTask.accountName}</p>
                      )}
                    </div>

                    {/* Project */}
                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Dự án</p>
                      {isGlobalEditing ? (
                        <CustomDropdown label="" value={draftProjectId} options={[{ value: "none", label: "Chưa gắn dự án", icon: "alert-circle" }, ...projects.data.filter((p: any) => p.accountId === draftAccountId).map((p: any) => ({ value: p.id, label: p.name, icon: "order" }))]} onChange={(val: string) => setDraftProjectId(val)} />
                      ) : (
                        <p className="text-xs font-semibold text-slate-800 truncate">{currentTask.projectName || <span className="font-normal italic text-slate-400">Chưa gắn</span>}</p>
                      )}
                    </div>

                    {/* Assignee */}
                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Phụ trách</p>
                      {isGlobalEditing ? (
                        <CustomDropdown
                          label=""
                          value={draftAssigneeUserId}
                          options={[
                            { value: "none", label: "Unassigned" },
                            ...workspaceAssigneeOptions
                          ]}
                          onChange={(val: string) => setDraftAssigneeUserId(val)}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-[9px] font-bold text-indigo-700 shrink-0">
                            {assigneeAvatarUrl ? (
                              <img src={assigneeAvatarUrl} alt={displayAssignee} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              initialForName(displayAssignee)
                            )}
                          </div>
                          <p className="text-xs font-semibold text-slate-800 truncate">{displayAssignee}</p>
                        </div>
                      )}
                    </div>

                    {/* Priority */}
                    {(() => {
                      const PRIORITY_OPTIONS = [
                        { value: "urgent",   label: "Khẩn cấp", icon: "alert-circle" as const, pillBg: "#fee2e2", pillColor: "#dc2626" },
                        { value: "critical", label: "Rất cao",  icon: "alert-circle" as const, pillBg: "#fecaca", pillColor: "#b91c1c" },
                        { value: "high",     label: "Cao",      icon: "alert-circle" as const, pillBg: "#fef3c7", pillColor: "#d97706" },
                        { value: "medium",   label: "Vừa",      icon: "star" as const,         pillBg: "#dbeafe", pillColor: "#2563eb" },
                        { value: "low",      label: "Thấp",     icon: "checkmark" as const,    pillBg: "#dcfce7", pillColor: "#16a34a" },
                      ];
                      const selectedPriority = PRIORITY_OPTIONS.find(o => o.value === (currentTask.priority ?? "").toLowerCase());
                      const iconNameMap: Record<string, ShopifyIconName> = {
                        "alert-circle": "alert",
                        "star": "spark",
                        "checkmark": "check",
                      };
                      return (
                        <div className="py-3 border-b border-slate-50">
                          <p className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Ưu tiên</p>
                          {isGlobalEditing ? (
                            <CustomDropdown label="" value={draftPriority} options={PRIORITY_OPTIONS} onChange={(val: string) => setDraftPriority(val)} />
                          ) : selectedPriority ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                              style={{ background: selectedPriority.pillBg, color: selectedPriority.pillColor }}
                            >
                              <ShopifyIcon
                                name={iconNameMap[selectedPriority.icon] ?? "alert"}
                                size={11}
                                className="shrink-0"
                              />
                              {displayPriority}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-slate-500">{displayPriority}</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Task type */}
                    {(() => {
                      const TASK_TYPE_OPTIONS = [
                        { value: "implementation",  label: "Triển khai",           icon: "settings" as const, pillBg: "#ede9fe", pillColor: "#7c3aed" },
                        { value: "discovery",       label: "Khảo sát",             icon: "clock" as const,    pillBg: "#e0f2fe", pillColor: "#0369a1" },
                        { value: "blueprint",       label: "Thiết kế giải pháp",   icon: "order" as const,    pillBg: "#fdf4ff", pillColor: "#a21caf" },
                        { value: "kickoff",         label: "Kickoff",              icon: "order" as const,    pillBg: "#fff7ed", pillColor: "#c2410c" },
                        { value: "proposal",        label: "Đề xuất giải pháp",    icon: "order" as const,    pillBg: "#fefce8", pillColor: "#854d0e" },
                        { value: "pqa",             label: "PQA",                  icon: "check" as const,    pillBg: "#dcfce7", pillColor: "#15803d" },
                        { value: "consulting",      label: "Tư vấn",               icon: "person" as const,   pillBg: "#f0fdf4", pillColor: "#166534" },
                        { value: "customer_action", label: "Việc phía khách hàng", icon: "person" as const,   pillBg: "#fef9c3", pillColor: "#a16207" },
                        { value: "support",         label: "Hỗ trợ kỹ thuật",      icon: "clock" as const,    pillBg: "#fff1f2", pillColor: "#be123c" },
                      ];
                      const selectedType = TASK_TYPE_OPTIONS.find(o => o.value === (currentTask.taskType ?? "").toLowerCase());
                      const typeIconMap: Record<string, ShopifyIconName> = {
                        "settings": "target",
                        "clock": "clock",
                        "order": "briefcase",
                        "check": "check",
                        "person": "users",
                      };
                      return (
                        <div className="py-3 border-b border-slate-50">
                          <p className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Loại</p>
                          {isGlobalEditing ? (
                            <CustomDropdown label="" value={draftTaskType} options={TASK_TYPE_OPTIONS} onChange={(val: string) => setDraftTaskType(val)} />
                          ) : selectedType ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                              style={{ background: selectedType.pillBg, color: selectedType.pillColor }}
                            >
                              <ShopifyIcon
                                name={typeIconMap[selectedType.icon] ?? "clock"}
                                size={11}
                                className="shrink-0"
                              />
                              {displayTaskType}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-slate-500">{displayTaskType}</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Dates */}
                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Ngày bắt đầu</p>
                      {isGlobalEditing ? (
                        <DatePickerField label="" value={draftPlannedStartAt} onChange={setDraftPlannedStartAt} openDirection="up" />
                      ) : (
                        <p className="text-xs font-semibold text-slate-800">{formatTaskDate(currentTask.plannedStartAt)}</p>
                      )}
                    </div>

                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Hạn chót</p>
                      {isGlobalEditing ? (
                        <DatePickerField label="" value={draftDueAt} onChange={setDraftDueAt} openDirection="up" />
                      ) : (
                        <p className={`text-xs font-semibold ${currentTask.overdue ? "text-red-500" : "text-slate-800"}`}>{formatTaskDate(currentTask.dueAt)}</p>
                      )}
                    </div>

                    {/* Estimate */}
                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Ước tính</p>
                      {isGlobalEditing ? (
                        <input type="number" value={draftEstimateMinutes} onChange={e => setDraftEstimateMinutes(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-400 transition" />
                      ) : (
                        <p className="text-xs font-semibold text-slate-800">{currentTask.estimateMinutes ? `${currentTask.estimateMinutes} phút` : "—"}</p>
                      )}
                    </div>

                    {/* Visibility */}
                    <div className="py-3">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5">Phạm vi</p>
                      {isGlobalEditing ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" id="draft-cust-vis" checked={draftCustomerVisible} onChange={e => setDraftCustomerVisible(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600 cursor-pointer" />
                          <span className="text-xs text-slate-700 font-medium">Hiển thị cho khách hàng</span>
                        </label>
                      ) : (
                        <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold ${currentTask.customerVisible ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {currentTask.customerVisible ? "🌐 Portal" : "🔒 Nội bộ"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="px-5 py-4 border-t border-slate-100">
                    <button
                      onClick={() => setShowConfirmDeleteModal(true)}
                      className="w-full rounded-xl border border-red-100 hover:bg-red-50 hover:border-red-200 px-3 py-2 text-xs font-semibold text-red-500 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                      </svg>
                      Xóa công việc
                    </button>
                  </div>
                </div>

              </aside>
            </div>

            {/* ── Modals ───────────────────────────────────────────────────────────── */}
            <EditTaskModal isOpen={showEditModal} onClose={() => setShowEditModal(false)} onSave={handleEditTask} task={currentTask} accounts={accounts.data} projects={projects.data} />
            <TransitionStatusModal isOpen={showTransitionModal} onClose={() => setShowTransitionModal(false)} onTransition={handleTransitionTask} currentStatus={currentTask.status} />
            <LogWorkModal selectedWorkDate={workDateContext} isOpen={showLogModal} onClose={() => setShowLogModal(false)} onLog={handleLogWork} task={currentTask} assigneeOptions={workspaceAssigneeOptions} />

            {/* ── Time Entry Detail Modal ─────────────────────────────────────────── */}
            {selectedTimeEntry && (() => {
              const ent = selectedTimeEntry;
              const isPlanned   = ent.entryKind === "planning";
              const canCompletePlanning = isPlanned && ["planned", "in_progress"].includes(ent.planningStatus);
              const isApproved  = ent.approvalStatus === "approved";
              const isRejected  = ent.approvalStatus === "rejected";
              const entryName   = formatAssigneeName(ent.userId, ent.userDisplayName);
              const entryAvatar = ent.userAvatarUrl || workspaceAssigneeOptions.find((o: any) => o.value === ent.userId)?.avatarUrl;

              const WORK_TYPE_PILL: Record<string, { bg: string; color: string; label: string }> = {
                delivery:       { bg: "#dbeafe", color: "#1d4ed8", label: "Triển khai" },
                consulting:     { bg: "#f3e8ff", color: "#7e22ce", label: "Tư vấn KH" },
                meeting:        { bg: "#e0f2fe", color: "#0369a1", label: "Họ p" },
                training:       { bg: "#d1fae5", color: "#065f46", label: "Đào tạo" },
                support:        { bg: "#fef3c7", color: "#92400e", label: "Hỗ trợ" },
                blueprint:      { bg: "#ede9fe", color: "#6d28d9", label: "Thiết kế" },
                rework:         { bg: "#fee2e2", color: "#b91c1c", label: "Làm lại" },
                internal_admin: { bg: "#f1f5f9", color: "#475569", label: "Nội bộ" },
                kh_c:           { bg: "#e0e7ff", color: "#3730a3", label: "KH C" },
              };
              const wtColor = WORK_TYPE_PILL[(ent.workType ?? "").toLowerCase()]
                ?? { bg: "#f1f5f9", color: "#64748b", label: getWorkTypeLabel(ent.workType) };
              // Approval status config — hex values match calendar blockColors exactly
              const approvalConfig = isPlanned
                ? {
                    bg: "#dbeafe",
                    color: "#1d4ed8",
                    label: ent.planningStatus === "completed"
                      ? "Kế hoạch hoàn tất"
                      : ent.planningStatus === "cancelled"
                      ? "Kế hoạch đã hủy"
                      : "Kế hoạch",
                    border: "1px solid #bfdbfe"
                  }
                : isApproved
                ? { bg: "#d1fae5", color: "#065f46", label: "Đã duyệt",  border: "1px solid #a7f3d0" }
                : isRejected
                ? { bg: "#f1f5f9", color: "#475569", label: "Từ chối",   border: "1px solid #cbd5e1" }
                : { bg: "#fef3c7", color: "#92400e", label: "Chờ duyệt", border: "1px solid #fde68a" };

              return (
                <ModalLayer onClose={() => setSelectedTimeEntry(null)}>
                <div
                  className="fixed inset-0 z-[1500] flex items-center justify-center p-4"
                  onClick={() => setSelectedTimeEntry(null)}
                >
                  {/* Backdrop */}
                  <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

                  {/* Modal */}
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="time-entry-detail-title"
                    data-planning-block-id={isPlanned ? ent.id : undefined}
                    data-time-entry-id={!isPlanned ? ent.id : undefined}
                    className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className={`px-5 py-4 flex items-center justify-between border-b ${isPlanned ? "bg-indigo-50 border-indigo-100" : "bg-white border-slate-100"}`}>
                      <div className="flex items-center gap-2">
                        <div className={`h-6 w-6 rounded-lg flex items-center justify-center ${isPlanned ? "bg-indigo-100" : "bg-indigo-50"}`}>
                          <ShopifyIcon name="clock" size={13} className="text-indigo-600" />
                        </div>
                        <span id="time-entry-detail-title" className="text-sm font-bold text-slate-800">{isPlanned ? "Chi tiết giờ kế hoạch" : "Chi tiết giờ đã ghi"}</span>
                      </div>
                      <button
                        onClick={() => setSelectedTimeEntry(null)}
                        aria-label="Đóng chi tiết thời gian"
                        className="h-7 w-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition"
                      >
                        <ShopifyIcon name="x" size={14} />
                      </button>
                    </div>

                    {/* Body */}
                    <div className="px-5 py-5 flex flex-col gap-4">

                      {/* User + hours row */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold shrink-0 ${
                            isPlanned ? "bg-indigo-100 text-indigo-800" : "bg-indigo-50 text-indigo-700"
                          }`}>
                            {entryAvatar ? (
                              <img src={entryAvatar} alt={entryName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            ) : initialForName(entryName || ent.userId)}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{entryName}</p>
                            {ent.userEmail && <p className="text-xs text-slate-400">{ent.userEmail}</p>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xl font-bold text-indigo-600">{formatTaskMinutes(ent.minutes)}</p>
                          <p className="text-[10px] text-slate-400">{isPlanned ? "thời gian kế hoạch" : "thời gian ghi"}</p>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="border-t border-slate-100" />

                      {/* Details grid */}
                      <div className="grid grid-cols-2 gap-3">
                        {/* Date */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ngày làm</span>
                          <span className="text-xs font-semibold text-slate-700">
                            📅 {formatVietnamDate(ent.startAt ?? ent.workDate, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
                          </span>
                        </div>

                        {/* Time window */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Khung giờ</span>
                          <span className="text-xs font-semibold text-slate-700">
                            {formatTimeEntryWindow(ent)} · {ent.timeZone === VIETNAM_TIME_ZONE ? VIETNAM_TIME_ZONE_LABEL : (ent.timeZone || VIETNAM_TIME_ZONE_LABEL)}
                          </span>
                          {!resolveTimeEntryWindow(ent).hasExplicitWindow && (
                            <span className="text-[10px] font-medium text-amber-600">
                              Log cũ chưa có giờ chi tiết.
                            </span>
                          )}
                        </div>

                        {/* Approval */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trạng thái duyệt</span>
                          <span
                            className="self-start inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{ background: approvalConfig.bg, color: approvalConfig.color, border: approvalConfig.border }}
                          >
                            {approvalConfig.label}
                          </span>
                        </div>

                        {/* Work type */}
                        {ent.workType && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loại công việc</span>
                            <span
                              className="self-start inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: wtColor.bg, color: wtColor.color }}
                            >
                              {wtColor.label}
                            </span>
                          </div>
                        )}

                        {/* Billable */}
                        {ent.billable !== undefined && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tính phí</span>
                            <span className={`self-start inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              ent.billable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}>
                              {ent.billingExemptReason ? "Ngày nghỉ · không tính phí" : ent.billable ? "💰 Có tính phí" : "Không tính phí"}
                            </span>
                          </div>
                        )}

                        {/* Source */}
                        {ent.source && (
                          <div className="flex flex-col gap-0.5 col-span-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nguồn</span>
                            <span className="text-xs text-slate-600 font-medium">{ent.source}</span>
                          </div>
                        )}
                      </div>

                      {/* Note / description */}
                      {ent.note && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mô tả / Ghi chú</span>
                          <div className="bg-slate-50 rounded-xl px-3.5 py-3 text-xs text-slate-600 leading-relaxed max-h-[140px] overflow-auto whitespace-pre-wrap border border-slate-100">
                            {ent.note}
                          </div>
                        </div>
                      )}

                      {planningCompletionError && isPlanned && (
                        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold text-red-700">
                          {planningCompletionError}
                        </div>
                      )}

                      {canCompletePlanning && (
                        <button
                          type="button"
                          onClick={() => {
                            setPlanningCompletionError(null);
                            setConfirmCompletePlanningEntry(ent);
                          }}
                          disabled={isCompletingPlanningEntry}
                          className="min-h-11 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isCompletingPlanningEntry ? "Đang hoàn thành..." : "Hoàn thành kế hoạch"}
                        </button>
                      )}

                      {!isPlanned && ent.sourcePlanningBlockId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTimeEntry(null);
                            setDeleteTimeEntryError(null);
                            setConfirmDeleteEntry({ ...ent, deleteKind: "planning-source" });
                          }}
                          className="min-h-11 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                        >
                          Xóa lịch kế hoạch, giữ giờ thực tế
                        </button>
                      ) : null}

                      {/* Delete action button */}
                      <button
                        onClick={() => {
                          setSelectedTimeEntry(null);
                          setDeleteTimeEntryError(null);
                          setConfirmDeleteEntry(ent);
                        }}
                        className="min-h-11 w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-4 py-2 text-xs font-semibold text-slate-500 hover:text-rose-600 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                        {isPlanned ? "Xóa mốc kế hoạch này" : "Xóa mục giờ này"}
                      </button>
                    </div>
                  </div>
                </div>
                </ModalLayer>
              );
            })()}
            <ConfirmModal isOpen={showConfirmEditModal} title="Xác nhận chỉnh sửa" message="Bạn có chắc chắn muốn chỉnh sửa thông tin task này không?" onConfirm={handleConfirmEdit} onCancel={() => setShowConfirmEditModal(false)} />
            <ConfirmModal isOpen={showConfirmSaveModal} title="Xác nhận lưu thay đổi" message="Bạn có chắc chắn muốn lưu lại toàn bộ thay đổi không?" onConfirm={handleConfirmSave} onCancel={() => setShowConfirmSaveModal(false)} />
            <ConfirmModal
              isOpen={showConfirmDeleteModal}
              title="Xóa công việc"
              message={`Bạn có chắc chắn muốn xóa công việc "${displayTitle}" không? Công việc có lịch sử vận hành sẽ được lưu trữ và ẩn khỏi board thay vì xóa vĩnh viễn.`}
              confirmLabel="Xóa công việc"
              cancelLabel="Hủy"
              tone="danger"
              loading={isDeletingTask}
              onConfirm={() => void handleDeleteTask(currentTask.id)}
              onCancel={() => !isDeletingTask && setShowConfirmDeleteModal(false)}
            />
            <ConfirmModal
              isOpen={deleteAttachmentId !== null}
              title="Xóa tài liệu đính kèm"
              message="Bạn có chắc chắn muốn xóa tài liệu đính kèm này không? Thao tác này không thể hoàn tác."
              confirmLabel="Xóa tài liệu"
              cancelLabel="Hủy"
              tone="danger"
              onConfirm={() => {
                if (deleteAttachmentId) {
                  handleRemoveAttachment(deleteAttachmentId);
                  setDeleteAttachmentId(null);
                }
              }}
              onCancel={() => setDeleteAttachmentId(null)}
            />

            {/* ── Confirm Delete Time Entry ─────────────────────────────────────── */}
            <ConfirmModal
              isOpen={confirmCompletePlanningEntry !== null}
              title="Hoàn thành kế hoạch"
              message="Bạn có chắc chắn muốn hoàn thành mốc kế hoạch này không? Thời lượng kế hoạch sẽ được ghi nhận một lần vào giờ thực tế."
              confirmLabel="Hoàn thành kế hoạch"
              cancelLabel="Hủy"
              loading={isCompletingPlanningEntry}
              onConfirm={() => confirmCompletePlanningEntry && void handleCompletePlanningEntry(confirmCompletePlanningEntry)}
              onCancel={() => !isCompletingPlanningEntry && setConfirmCompletePlanningEntry(null)}
            />
            <ConfirmModal
              isOpen={confirmDeleteEntry !== null}
              title={confirmDeleteEntry?.approvalStatus === "planned" || confirmDeleteEntry?.deleteKind === "planning-source"
                ? "Xóa mốc kế hoạch"
                : "Xóa mục giờ đã ghi"}
              message={
                confirmDeleteEntry?.deleteKind === "planning-source"
                  ? "Chỉ xóa lịch kế hoạch đã hoàn thành. Giờ thực tế đã ghi vẫn được giữ lại trong công việc."
                  : confirmDeleteEntry?.approvalStatus === "planned"
                  ? "Bạn có chắc chắn muốn xóa mốc kế hoạch này không? Mốc này sẽ biến mất khỏi lịch trình tuần."
                  : "Bạn có chắc chắn muốn xóa mục thời gian đã ghi này không? Thao tác không thể hoàn tác."
              }
              confirmLabel="Xóa"
              cancelLabel="Hủy"
              tone="danger"
              loading={isDeletingTimeEntry}
              error={deleteTimeEntryError}
              onConfirm={() => confirmDeleteEntry && void handleDeleteTimeEntry(confirmDeleteEntry)}
              onCancel={() => {
                if (isDeletingTimeEntry) return;
                setDeleteTimeEntryError(null);
                setConfirmDeleteEntry(null);
              }}
            />

            {/* ── Toast ────────────────────────────────────────────────────────────── */}
            {dailyCapacityFeedback && (
              <div
                aria-live="polite"
                role="status"
                className={`fixed bottom-20 left-4 right-4 z-[9999] flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg animate-slide-up sm:left-auto sm:right-6 ${
                  dailyCapacityFeedback.tone === "warning" ? "bg-amber-700" : "bg-indigo-600"
                }`}
              >
                <ToastIcon type={dailyCapacityFeedback.tone} />
                <span><strong>{dailyCapacityFeedback.heading}.</strong> {dailyCapacityFeedback.message}</span>
              </div>
            )}
            {toast && (
              <div
                aria-live="polite"
                role="status"
                className="fixed bottom-4 left-4 right-4 z-[9999] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg animate-slide-up sm:bottom-6 sm:left-auto sm:right-6"
                style={{ background: toast.type === "success" ? "rgba(22,163,74,0.95)" : toast.type === "danger" ? "rgba(220,38,38,0.95)" : toast.type === "warning" ? "rgba(180,83,9,0.96)" : "rgba(92,106,196,0.95)" }}
              >
                <ToastIcon type={toast.type} />
                <span>{toast.message}</span>
              </div>
            )}
          </div>
        </main>
    </AppShell>
  );
}
