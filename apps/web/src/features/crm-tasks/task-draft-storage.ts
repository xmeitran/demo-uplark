import type { ProjectTaskSummary } from "@b2b-crm/contracts";

const TASK_DRAFTS_KEY = "lark_crm_custom_tasks_list";

export function taskDraftsEnabled() {
  return process.env.NEXT_PUBLIC_CRM_OFFLINE_DRAFTS === "1";
}

export function loadTaskDrafts(serverTasks: ProjectTaskSummary[]) {
  if (!taskDraftsEnabled() || typeof window === "undefined") {
    return serverTasks;
  }

  const saved = window.localStorage.getItem(TASK_DRAFTS_KEY);
  if (!saved) {
    persistTaskDrafts(serverTasks);
    return serverTasks;
  }

  try {
    return JSON.parse(saved) as ProjectTaskSummary[];
  } catch {
    return serverTasks;
  }
}

export function persistTaskDrafts(updatedList: ProjectTaskSummary[]) {
  if (!taskDraftsEnabled() || typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(TASK_DRAFTS_KEY, JSON.stringify(updatedList));
}

export function productionWriteFailureMessage() {
  return "Không thể lưu thay đổi vì chưa ghi nhận được trên hệ thống. Vui lòng đăng nhập lại hoặc thử lại khi kết nối ổn định.";
}
