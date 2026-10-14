"use client";
import { useEffect, useMemo, useState } from "react";
import type { CreateTaskTimeEntryResponse, ProjectTaskSummary, ResourceListResponse, TaskTimeEntrySummary } from "@b2b-crm/contracts";
import { ShopifyAppShell, ShopifyBanner, ShopifyPage, ShopifySection } from "../shopify-ui";
import { CrmSelect } from "./crm-select";
import { LAYER2_MISMATCH_LABEL, defaultSelectedLayer2 } from "@/lib/task-classification";

import { useAuth } from "../../lib/auth";
import {
  getDailyActualLogFeedback,
  type DailyActualLogFeedback
} from "../../features/crm-tasks/daily-actual-log-feedback";

interface TimeEntry {
  id: string;
  consultant: string;
  project: string;
  stage: string;
  hours: number;
  workType: string;
  billable: boolean;
  note: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  taskId: string;
  layer2Mismatch?: boolean;
  updatedAt: string;
}

const initialTimeEntries: TimeEntry[] = [];

function vietnamWorkDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function ProjectControlsFunctionPage() {
  const { user } = useAuth();
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(initialTimeEntries);
  const [apiState, setApiState] = useState<"loading" | "ready" | "fallback">("loading");

  const [inputProject, setInputProject] = useState("");
  const [tasks, setTasks] = useState<ProjectTaskSummary[]>([]);
  const [inputTaskId, setInputTaskId] = useState("");
  const [inputHours, setInputHours] = useState("8");
  const [inputWorkType, setInputWorkType] = useState("Billable Delivery");
  const inputTask = tasks.find((task) => task.id === inputTaskId);
  const [inputNote, setInputNote] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [dailyCapacityFeedback, setDailyCapacityFeedback] = useState<DailyActualLogFeedback | null>(null);

  async function loadTimeEntriesAndTasks() {
    const [tasksResponse, entriesResponse] = await Promise.all([
      fetch("/api/tasks?limit=100", { cache: "no-store" }),
      fetch("/api/tasks/time-entries?limit=100", { cache: "no-store" })
    ]);
    if (!tasksResponse.ok || !entriesResponse.ok) throw new Error("Could not load canonical tasks and time entries.");
    const taskPayload = await tasksResponse.json() as ResourceListResponse<ProjectTaskSummary>;
    const entryPayload = await entriesResponse.json() as ResourceListResponse<TaskTimeEntrySummary>;
    setTasks(taskPayload.data);
    setApiState("ready");
    setInputTaskId((current) => taskPayload.data.some((task) => task.id === current) ? current : taskPayload.data[0]?.id ?? "");
    setTimeEntries(entryPayload.data.map(adaptTimeEntry));
  }

  useEffect(() => {
    void loadTimeEntriesAndTasks().catch(() => setApiState("fallback"));
  }, []);

  // Projects offered for logging are the ones that own a loaded task: hours are always logged against a task.
  const projects = useMemo(() => {
    const byId = new Map<string, string>();
    for (const task of tasks) if (task.projectId && !byId.has(task.projectId)) byId.set(task.projectId, task.projectName || "Dự án");
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [tasks]);

  useEffect(() => {
    setInputProject((current) => projects.some((project) => project.id === current) ? current : projects[0]?.id ?? "");
  }, [projects]);

  useEffect(() => {
    const available = tasks.filter((task) => !inputProject || task.projectId === inputProject);
    if (!available.some((task) => task.id === inputTaskId)) setInputTaskId(available[0]?.id ?? "");
  }, [inputProject, inputTaskId, tasks]);

  async function handleCreateTimeEntry(e: React.FormEvent) {
    e.preventDefault();
    const hours = parseFloat(inputHours);
    if (Number.isNaN(hours) || hours <= 0) {
      alert("Số giờ không hợp lệ.");
      return;
    }
    if (!inputTaskId) {
      setMutationError("Select a real task before submitting hours.");
      return;
    }
    const selectedTaskTypeLayer2 = defaultSelectedLayer2(inputTask?.taskTypeLayer2);
    if (!selectedTaskTypeLayer2) {
      setMutationError("Công việc chưa được hệ thống phân loại bối cảnh. Hãy bổ sung phân loại cho task trước khi ghi giờ.");
      return;
    }
    setMutationPending(true);
    setMutationError(null);
    setDailyCapacityFeedback(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(inputTaskId)}/time-entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workDate: vietnamWorkDate(),
          minutes: Math.round(hours * 60),
          billable: inputWorkType !== "Rework" && inputWorkType !== "Internal/Admin",
          workType: inputWorkType,
          note: inputNote,
          selectedTaskTypeLayer2
        })
      });
      if (!response.ok) throw new Error(`Could not submit hours: ${response.status}`);
      const savedEntry = await response.json() as CreateTaskTimeEntryResponse;
      setDailyCapacityFeedback(getDailyActualLogFeedback(savedEntry.dailyActualLog, savedEntry.userDisplayName));
      setInputNote("");
      await loadTimeEntriesAndTasks();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not submit hours.");
    } finally {
      setMutationPending(false);
    }
  }

  return (
    <ShopifyAppShell active="project-controls" principal={user?.name || "Workspace user"}>
      <ShopifyPage heading="Kiểm soát dự án">
        <div className="shopify-status-row" aria-label="Cấu hình kiểm soát dự án">
          <s-badge tone="success">1 ngày công = 8 giờ</s-badge>
          <s-badge tone={apiState === "ready" ? "success" : apiState === "loading" ? "info" : "warning"}>
            {apiState === "ready" ? "Dữ liệu công việc đã đồng bộ" : apiState === "loading" ? "Đang tải dữ liệu công việc" : "Chưa tải được dữ liệu công việc"}
          </s-badge>
        </div>
        {mutationError ? <div role="alert" style={{ marginTop: "12px" }}><ShopifyBanner heading="Thao tác chưa hoàn tất" tone="critical"><s-paragraph>{mutationError}</s-paragraph></ShopifyBanner></div> : null}
        {dailyCapacityFeedback ? (
          <div aria-live="polite" role="status" style={{ marginTop: "12px" }}>
            <ShopifyBanner heading={dailyCapacityFeedback.heading} tone={dailyCapacityFeedback.tone}>
              <s-paragraph>{dailyCapacityFeedback.message}</s-paragraph>
            </ShopifyBanner>
          </div>
        ) : null}

        {apiState === "fallback" ? (
          <div style={{ marginTop: "16px" }}>
            <ShopifyBanner heading="Chưa tải được dữ liệu" tone="warning">
              <s-paragraph>Chưa đọc được danh sách công việc và giờ đã ghi. Tải lại trang để thử lại; việc gửi giờ được tắt cho đến khi kết nối phục hồi.</s-paragraph>
            </ShopifyBanner>
          </div>
        ) : null}

          <div className="shopify-two-column" style={{ marginTop: "16px" }}>
            <div className="shopify-stack">
              <ShopifySection heading="Gửi giờ làm tuần">
                <form onSubmit={handleCreateTimeEntry} className="shopify-form-stack">
                  <div>
                    <label htmlFor="time-entry-project" style={fieldLabelStyle}>Dự án</label>
                    <CrmSelect id="time-entry-project" options={projects.length === 0 ? [{ value: "", label: "Chưa có dự án" }] : projects.map((project) => ({ value: project.id, label: project.name }))} value={inputProject} onChange={(value) => { setInputProject(value); setInputTaskId(""); }} />
                  </div>
                  <div className="shopify-field-row">
                    <div>
                      <label htmlFor="time-entry-task" style={fieldLabelStyle}>Công việc</label>
                      <CrmSelect id="time-entry-task" options={[{ value: "", label: "Chọn công việc" }, ...tasks.filter((task) => !inputProject || task.projectId === inputProject).map((task) => ({ value: task.id, label: task.title }))]} value={inputTaskId} onChange={setInputTaskId} />
                    </div>
                    <div>
                      <label htmlFor="time-entry-hours" style={fieldLabelStyle}>Số giờ</label>
                      <input id="time-entry-hours" type="number" min="1" max="24" value={inputHours} onChange={(event) => setInputHours(event.target.value)} style={fieldStyle} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="time-entry-work-type" style={fieldLabelStyle}>Loại công việc</label>
                    <CrmSelect id="time-entry-work-type" options={[{ value: "Billable Delivery", label: "Triển khai tính phí" }, { value: "Non-billable Delivery", label: "Triển khai không tính phí" }, { value: "Rework", label: "Làm lại" }, { value: "Support", label: "Hỗ trợ" }, { value: "Change Request", label: "Yêu cầu thay đổi" }, { value: "Internal/Admin", label: "Nội bộ / hành chính" }]} value={inputWorkType} onChange={setInputWorkType} />
                  </div>
                  <div>
                    <label htmlFor="time-entry-note" style={fieldLabelStyle}>Ghi chú công việc</label>
                    <textarea
                      id="time-entry-note"
                      value={inputNote}
                      onChange={(event) => setInputNote(event.target.value)}
                      required
                      placeholder="Mô tả cụ thể đầu việc đã thực hiện..."
                      style={{ ...fieldStyle, height: "80px" }}
                    />
                  </div>
                  <div className="shopify-action-row end">
                    <s-button disabled={apiState !== "ready" || projects.length === 0 || !inputTaskId || mutationPending} type="submit" variant="primary">{mutationPending ? "Đang gửi..." : "Gửi giờ"}</s-button>
                  </div>
                </form>
              </ShopifySection>
            </div>
            <div className="shopify-stack">
              <ShopifySection heading="Giờ đã ghi trong tuần">
                <div className="shopify-resource-list">
                  {timeEntries.map((entry) => (
                    <article key={entry.id}>
                      <div>
                        <strong>{entry.project} · {entry.hours}h ({formatWorkType(entry.workType)})</strong>
                        <span style={{ fontSize: "12px" }}>{entry.note}</span>
                        {entry.layer2Mismatch ? <span style={{ fontSize: "12px", color: "#b45309" }}>{LAYER2_MISMATCH_LABEL}</span> : null}
                      </div>
                      <s-badge tone={entry.status === "approved" ? "success" : entry.status === "rejected" ? "critical" : "warning"}>
                        {formatEntryStatus(entry.status)}
                      </s-badge>
                    </article>
                  ))}
                </div>
              </ShopifySection>
            </div>
          </div>
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

function adaptTimeEntry(entry: TaskTimeEntrySummary): TimeEntry {
  return {
    id: entry.id,
    consultant: entry.userDisplayName || entry.userEmail || entry.userId,
    project: entry.projectName || "Project",
    stage: entry.taskTitle || entry.taskId,
    hours: entry.minutes / 60,
    workType: entry.workType,
    billable: entry.billable,
    note: entry.note || "",
    status: (["submitted", "approved", "rejected"] as const).includes(entry.approvalStatus as "submitted" | "approved" | "rejected") ? entry.approvalStatus as TimeEntry["status"] : "draft",
    taskId: entry.taskId,
    layer2Mismatch: entry.layer2Mismatch,
    updatedAt: entry.updatedAt || entry.createdAt
  };
}

function formatWorkType(value: string) {
  const labels: Record<string, string> = {
    "Billable Delivery": "Triển khai tính phí",
    "Non-billable Delivery": "Triển khai không tính phí",
    Rework: "Làm lại",
    Support: "Hỗ trợ",
    "Change Request": "Yêu cầu thay đổi",
    "Internal/Admin": "Nội bộ / hành chính"
  };
  return labels[value] ?? value;
}

function formatEntryStatus(value: TimeEntry["status"]) {
  const labels = {
    draft: "Nháp",
    // V-07: time logs have no approval step; "submitted" only survives on rows written before that.
    submitted: "Đã ghi nhận",
    approved: "Đã ghi nhận",
    rejected: "Không tính"
  };
  return labels[value];
}

const fieldLabelStyle = {
  display: "block",
  fontWeight: 650,
  marginBottom: "6px"
};

const fieldStyle = {
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "10px",
  width: "100%"
};
