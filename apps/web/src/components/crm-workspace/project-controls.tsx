"use client";
import { MoneyAmount } from "@/components/money-amount";

import { useEffect, useState } from "react";
import type { CreateTaskTimeEntryResponse, ProjectPlSummaryItem, ProjectPlSummaryResponse, ProjectTaskSummary, ResourceListResponse, TaskTimeEntrySummary } from "@b2b-crm/contracts";
import { ShopifyAppShell, ShopifyBanner, ShopifyDataTable, ShopifyPage, ShopifySection } from "../shopify-ui";

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
  updatedAt: string;
}

interface ProjectPL {
  accountName?: string;
  actualHours: number;
  actualLaborCostAmount: number;
  directCostAmount: number;
  grossMarginAmount: number;
  grossMarginPercent?: number;
  id: string;
  name: string;
  paidRevenueAmount: number;
  plannedCostAmount: number;
  plannedHours: number;
  plannedRevenueAmount: number;
  state: "On Plan" | "Margin Watch" | "Margin Risk" | "Over Budget" | "Needs Reforecast";
  targetMargin: number;
  totalCostAmount: number;
  writeOffAmount: number;
}

const initialTimeEntries: TimeEntry[] = [];
const fallbackProjects: ProjectPL[] = [];

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
  const canReviewTimeEntries = ["FOUNDER_GM", "DELIVERY_LEAD"].includes(user?.role || "");
  const roleMode: "founder" | "delivery_lead" | "consultant" = ["FOUNDER_GM", "FINANCE_ADMIN"].includes(user?.role || "")
    ? "founder"
    : user?.role === "DELIVERY_LEAD" ? "delivery_lead" : "consultant";
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(initialTimeEntries);
  const [projects, setProjects] = useState<ProjectPL[]>(fallbackProjects);
  const [apiState, setApiState] = useState<"loading" | "ready" | "fallback">("loading");
  const [apiMeta, setApiMeta] = useState("Đang tải dữ liệu dự án...");

  const [inputProject, setInputProject] = useState("");
  const [tasks, setTasks] = useState<ProjectTaskSummary[]>([]);
  const [inputTaskId, setInputTaskId] = useState("");
  const [inputHours, setInputHours] = useState("8");
  const [inputWorkType, setInputWorkType] = useState("Billable Delivery");
  const [inputNote, setInputNote] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [dailyCapacityFeedback, setDailyCapacityFeedback] = useState<DailyActualLogFeedback | null>(null);
  const [reviewReason, setReviewReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPlSummary() {
      try {
        const response = await fetch("/api/project-controls/pl-summary", { cache: "no-store" });
        if (!response.ok) throw new Error("Chưa lấy được dữ liệu mới nhất.");
        const payload = (await response.json()) as ProjectPlSummaryResponse;
        if (cancelled) return;
        const nextProjects = payload.data.map(adaptProjectPlSummary);
        setProjects(nextProjects);
        setInputProject((current) => nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? "");
        setApiState("ready");
        setApiMeta("Dữ liệu dự án đã đồng bộ");
      } catch (error) {
        if (cancelled) return;
        setProjects(fallbackProjects);
        setApiState("fallback");
        setApiMeta(error instanceof Error ? error.message : "Chưa có dữ liệu dự án mới nhất.");
      }
    }

    loadPlSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadTimeEntriesAndTasks() {
    const [tasksResponse, entriesResponse] = await Promise.all([
      fetch("/api/tasks?limit=100", { cache: "no-store" }),
      fetch("/api/tasks/time-entries?limit=100", { cache: "no-store" })
    ]);
    if (!tasksResponse.ok || !entriesResponse.ok) throw new Error("Could not load canonical tasks and time entries.");
    const taskPayload = await tasksResponse.json() as ResourceListResponse<ProjectTaskSummary>;
    const entryPayload = await entriesResponse.json() as ResourceListResponse<TaskTimeEntrySummary>;
    setTasks(taskPayload.data);
    setInputTaskId((current) => taskPayload.data.some((task) => task.id === current) ? current : taskPayload.data[0]?.id ?? "");
    setTimeEntries(entryPayload.data.map(adaptTimeEntry));
  }

  useEffect(() => {
    void loadTimeEntriesAndTasks().catch((error) => setMutationError(error instanceof Error ? error.message : "Could not load time entries."));
  }, []);

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
          approvalStatus: "submitted",
          note: inputNote
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

  async function handleReviewEntry(entry: TimeEntry, status: "approved" | "rejected") {
    const reason = status === "rejected" ? reviewReason.trim() : undefined;
    if (status === "rejected" && !reason) {
      setMutationError("Enter a rejection reason before rejecting submitted hours.");
      return;
    }
    setMutationPending(true);
    setMutationError(null);
    try {
      const response = await fetch(`/api/tasks/time-entries/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, reason, expectedUpdatedAt: entry.updatedAt })
      });
      if (!response.ok) throw new Error(`Could not ${status === "approved" ? "approve" : "reject"} hours: ${response.status}`);
      if (status === "rejected") setReviewReason("");
      await loadTimeEntriesAndTasks();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not review hours.");
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
            {apiState === "ready" ? apiMeta : apiState === "loading" ? "Đang tải dữ liệu dự án" : `Đang dùng dữ liệu dự phòng: ${apiMeta}`}
          </s-badge>
          <s-badge tone="neutral">Chế độ: {formatRoleMode(roleMode)}</s-badge>
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
            <ShopifyBanner heading="Đang dùng dữ liệu dự phòng" tone="warning">
              <s-paragraph>Chưa đọc được dữ liệu dự án mới nhất. Các thao tác ghi dữ liệu được tắt cho đến khi kết nối phục hồi.</s-paragraph>
            </ShopifyBanner>
          </div>
        ) : null}

        {roleMode === "consultant" ? (
          <div className="shopify-two-column" style={{ marginTop: "16px" }}>
            <div className="shopify-stack">
              <ShopifySection heading="Gửi giờ làm tuần">
                <form onSubmit={handleCreateTimeEntry} className="shopify-form-stack">
                  <div>
                    <label htmlFor="time-entry-project" style={fieldLabelStyle}>Dự án</label>
                    <select id="time-entry-project" value={inputProject} onChange={(event) => { setInputProject(event.target.value); setInputTaskId(""); }} style={fieldStyle}>
                      {projects.length === 0 ? <option value="">Chưa có dự án</option> : null}
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="shopify-field-row">
                    <div>
                      <label htmlFor="time-entry-task" style={fieldLabelStyle}>Công việc</label>
                      <select id="time-entry-task" value={inputTaskId} onChange={(event) => setInputTaskId(event.target.value)} style={fieldStyle}>
                        <option value="">Chọn công việc</option>
                        {tasks.filter((task) => !inputProject || task.projectId === inputProject).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="time-entry-hours" style={fieldLabelStyle}>Số giờ</label>
                      <input id="time-entry-hours" type="number" min="1" max="24" value={inputHours} onChange={(event) => setInputHours(event.target.value)} style={fieldStyle} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="time-entry-work-type" style={fieldLabelStyle}>Loại công việc</label>
                    <select id="time-entry-work-type" value={inputWorkType} onChange={(event) => setInputWorkType(event.target.value)} style={fieldStyle}>
                      <option value="Billable Delivery">Triển khai tính phí</option>
                      <option value="Non-billable Delivery">Triển khai không tính phí</option>
                      <option value="Rework">Làm lại</option>
                      <option value="Support">Hỗ trợ</option>
                      <option value="Change Request">Yêu cầu thay đổi</option>
                      <option value="Internal/Admin">Nội bộ / hành chính</option>
                    </select>
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
        ) : (
          <div className="shopify-stack" style={{ marginTop: "16px" }}>
            <ShopifySection heading="Tổng quan tài chính dự án">
              {(() => {
                const isFounder = roleMode === "founder";
                const columns = [
                  { key: "project", header: "Dự án", width: isFounder ? "20%" : "30%" },
                  { key: "revenue", header: "Doanh thu / đã thu", width: isFounder ? "14%" : "18%" },
                  { key: "effort", header: "Giờ kế hoạch / thực tế", width: isFounder ? "16%" : "20%" },
                  { key: "variance", header: "Chênh lệch giờ", width: isFounder ? "13%" : "18%" },
                  ...(isFounder ? [
                    { key: "cost", header: "Chi phí kế hoạch / thực tế", width: "19%" },
                    { key: "margin", header: "Biên lợi nhuận", width: "10%" }
                  ] : []),
                  { key: "state", header: "Trạng thái", width: isFounder ? "8%" : "14%" }
                ];

                return (
                  <ShopifyDataTable
                    ariaLabel="Tổng quan tài chính dự án"
                    columns={columns}
                    minWidth={isFounder ? 1120 : 860}
                    rows={projects.map((project) => {
                      const variance = project.actualHours - project.plannedHours;
                      const variancePct = project.plannedHours > 0 ? Math.round((variance / project.plannedHours) * 100) : 0;
                      const margin = project.grossMarginPercent ?? 0;

                      return {
                        key: project.id,
                        cells: [
                          (
                            <div style={{ display: "grid", gap: "2px" }}>
                              <strong>{project.name}</strong>
                              <span className="shopify-muted" style={{ fontSize: "12px" }}>{project.accountName ?? "Chưa gắn khách hàng"}</span>
                            </div>
                          ),
                          <span className="font-mono tabular-nums text-right"><MoneyAmount value={project.plannedRevenueAmount} /> / <MoneyAmount value={project.paidRevenueAmount} /></span>,
                          <span className="font-mono tabular-nums">{project.plannedHours}h / {project.actualHours}h</span>,
                          (
                            <span className="font-mono tabular-nums" style={{ color: variance > 0 ? "var(--danger)" : "var(--success)" }}>
                              {variance > 0 ? `+${variance}h` : `${variance}h`} ({variancePct > 0 ? `+${variancePct}%` : `${variancePct}%`})
                            </span>
                          ),
                          ...(isFounder ? [
                            <span key="cost" className="font-mono tabular-nums text-right"><MoneyAmount value={project.plannedCostAmount} /> / <MoneyAmount value={project.totalCostAmount} /></span>,
                            (
                              <span key="margin">
                                <span className="font-mono tabular-nums text-right" style={{ color: margin < project.targetMargin ? "var(--danger)" : "var(--success)" }}>{margin}%</span>{" "}
                                <span className="shopify-muted" style={{ fontSize: "12px" }}>(Mục tiêu: {project.targetMargin}%)</span>
                              </span>
                            )
                          ] : []),
                          (
                            <s-badge tone={project.state === "On Plan" ? "success" : project.state === "Margin Watch" ? "warning" : "critical"}>
                              {formatProjectState(project.state)}
                            </s-badge>
                          )
                        ]
                      };
                    })}
                  />
                );
              })()}
            </ShopifySection>

            {roleMode === "delivery_lead" && (
              <p className="shopify-muted" style={{ padding: "8px 12px", background: "var(--panel-strong)", borderRadius: "8px" }}>
                <strong>Chi phí đang được ẩn:</strong> Lead triển khai chỉ xem giờ làm và cảnh báo vận hành. Chi tiết chi phí và biên lợi nhuận chỉ dành cho Founder/Tài chính.
              </p>
            )}

            {canReviewTimeEntries ? <div style={{ marginTop: "20px" }}>
                <ShopifySection heading="Giờ làm đang chờ duyệt">
                  <div style={{ marginBottom: "12px" }}>
                    <label htmlFor="time-entry-review-reason" style={fieldLabelStyle}>Lý do từ chối</label>
                    <input id="time-entry-review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Bắt buộc khi từ chối" style={fieldStyle} />
                  </div>
                  {timeEntries.some((entry) => entry.status === "submitted") ? (
                    <ShopifyDataTable
                      ariaLabel="Giờ làm đang chờ duyệt"
                      columns={[
                        { key: "consultant", header: "Consultant", width: "15%" },
                        { key: "project", header: "Dự án", width: "18%" },
                        { key: "hours", header: "Giờ", width: "10%" },
                        { key: "note", header: "Ghi chú hoạt động", width: "32%" },
                        { key: "type", header: "Loại việc", width: "13%" },
                        { key: "action", header: "Thao tác", width: "12%" }
                      ]}
                      minWidth={900}
                      rows={timeEntries.filter((entry) => entry.status === "submitted").map((entry) => ({
                        key: entry.id,
                        cells: [
                          <strong>{entry.consultant}</strong>,
                          entry.project,
                          <span className="font-mono tabular-nums">{entry.hours}h</span>,
                          entry.note,
                          <s-badge tone={entry.workType === "Rework" ? "warning" : "info"}>{formatWorkType(entry.workType)}</s-badge>,
                          <div style={{ display: "flex", gap: "6px" }}>
                            <s-button disabled={mutationPending} onClick={() => handleReviewEntry(entry, "approved")} variant="primary">Duyệt</s-button>
                            <s-button disabled={mutationPending} onClick={() => handleReviewEntry(entry, "rejected")}>Từ chối</s-button>
                          </div>
                        ]
                      }))}
                    />
                  ) : (
                    <p className="shopify-muted">Không có giờ làm nào đang chờ duyệt.</p>
                  )}
                </ShopifySection>
            </div> : null}
          </div>
        )}
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
    updatedAt: entry.updatedAt || entry.createdAt
  };
}

function adaptProjectPlSummary(item: ProjectPlSummaryItem): ProjectPL {
  const plannedHours = Math.round(item.plannedCostAmount > 0 && item.approvedLaborMinutes > 0
    ? Math.max(item.approvedLaborMinutes, 480) / 60
    : 0);
  const actualHours = Math.round(item.approvedLaborMinutes / 60);
  const grossMarginPercent = item.grossMarginPercent === undefined ? undefined : Number(item.grossMarginPercent.toFixed(2));
  const targetMargin = 50;

  return {
    accountName: item.accountName,
    actualHours,
    actualLaborCostAmount: item.actualLaborCostAmount,
    directCostAmount: item.directCostAmount,
    grossMarginAmount: item.grossMarginAmount,
    grossMarginPercent,
    id: item.projectId,
    name: item.projectName,
    paidRevenueAmount: item.paidRevenueAmount,
    plannedCostAmount: item.plannedCostAmount,
    plannedHours,
    plannedRevenueAmount: item.plannedRevenueAmount,
    state: derivePlState(grossMarginPercent, targetMargin, item.totalCostAmount, item.plannedCostAmount),
    targetMargin,
    totalCostAmount: item.totalCostAmount,
    writeOffAmount: item.writeOffAmount
  };
}

function derivePlState(
  grossMarginPercent: number | undefined,
  targetMargin: number,
  totalCostAmount: number,
  plannedCostAmount: number
): ProjectPL["state"] {
  if (plannedCostAmount > 0 && totalCostAmount > plannedCostAmount * 1.1) return "Over Budget";
  if (grossMarginPercent === undefined) return "Needs Reforecast";
  if (grossMarginPercent < targetMargin - 15) return "Margin Risk";
  if (grossMarginPercent < targetMargin) return "Margin Watch";
  return "On Plan";
}

function formatRoleMode(role: "founder" | "delivery_lead" | "consultant") {
  const labels = {
    founder: "Founder / Tài chính",
    delivery_lead: "Lead triển khai",
    consultant: "Consultant"
  };
  return labels[role];
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
    submitted: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Từ chối"
  };
  return labels[value];
}

function formatProjectState(value: ProjectPL["state"]) {
  const labels: Record<ProjectPL["state"], string> = {
    "On Plan": "Đúng kế hoạch",
    "Margin Watch": "Cần theo dõi biên lợi nhuận",
    "Margin Risk": "Rủi ro biên lợi nhuận",
    "Over Budget": "Vượt ngân sách",
    "Needs Reforecast": "Cần dự báo lại"
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
