"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  CapacitySummaryItem,
  CapacitySummaryResponse,
  ProjectSummary,
  ResourceAllocationStatus,
  ResourceListResponse
} from "@b2b-crm/contracts";
import { ShopifyAppShell, ShopifyBanner, ShopifyDataTable, ShopifyIcon, ShopifyPage, ShopifySection } from "../shopify-ui";
import { ShopifyModal } from "../shopify-modal";
import { ConfirmActionDialog } from "./confirm-action-dialog";

type AllocationStatus = ResourceAllocationStatus | "blocked" | "completed";

interface Consultant {
  avatarUrl?: string;
  departmentCode?: string;
  email?: string;
  id: string;
  larkOpenId?: string;
  larkTenantKey?: string;
  name: string;
  role: string;
  skills: string[];
  capacityMinutesByWeek: Record<string, number>;
  allocations: {
    week: string;
    project: string;
    days: number;
    status: AllocationStatus;
  }[];
}

interface ProjectOption {
  accountId: string;
  accountName?: string;
  id: string;
  name: string;
}

interface WeekWindow {
  end: string;
  label: string;
  start: string;
}

type AllocationDraft = {
  consultant: Consultant;
  days: number;
  nextPercentage: number;
  project: ProjectOption;
  week: WeekWindow;
};

const minutesPerDay = 480;
const resourcePageSize = 12;

const fallbackProjects: ProjectOption[] = [];

type CustomDropdownOption = { value: string; label: string; icon?: "users" | "briefcase" | "calendar"; iconTone?: string };

function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  openDirection = "down"
}: {
  id?: string;
  label: React.ReactNode;
  value: string;
  options: CustomDropdownOption[];
  onChange: (val: string) => void;
  openDirection?: "up" | "down";
}) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const selectedOpt = options.find((o) => o.value === value) ?? options[0];
  const controlId = id ?? `resource-select-${generatedId.replace(/:/g, "")}`;

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
      setOpen(false);
    }
  };

  return (
    <div className="task-select-control" onBlur={handleBlur} style={{ position: "relative" }}>
      <span className="task-field-label" id={`${controlId}-label`}>
        {label}
      </span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${controlId}-label ${controlId}-value`}
        className="task-select-trigger"
        data-open={open ? "true" : "false"}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        type="button"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <span className="task-select-current" id={`${controlId}-value`}>
          {selectedOpt?.icon && (
            <ShopifyIcon
              className={`task-select-icon tone-${selectedOpt.iconTone ?? "neutral"}`}
              name={selectedOpt.icon}
              size={15}
            />
          )}
          <span className="task-select-value">{selectedOpt?.label}</span>
        </span>
        <ShopifyIcon className="task-select-chevron" name="chevron-down" size={14} />
      </button>

      {open && (
        <div
          aria-labelledby={`${controlId}-label`}
          className="task-select-menu"
          data-direction={openDirection}
          role="listbox"
          style={{ width: "100%" }}
        >
          {options.map((opt) => (
            <button
              aria-selected={opt.value === value}
              className="task-select-option"
              data-selected={opt.value === value ? "true" : "false"}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              role="option"
              type="button"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {opt.icon && (
                <ShopifyIcon
                  className={`task-select-icon tone-${opt.iconTone ?? "neutral"}`}
                  name={opt.icon}
                  size={15}
                />
              )}
              <span className="task-select-option-label">{opt.label}</span>
              {opt.value === value && (
                <ShopifyIcon className="task-select-check" name="check" size={15} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResourceMgmtFunctionPage({
  shellPrincipal = "founder",
  shellPrincipalAvatarUrl
}: Readonly<{
  shellPrincipal?: string;
  shellPrincipalAvatarUrl?: string;
}>) {
  const weekWindows = useMemo(() => buildWeekWindows(), []);
  const weeksList = weekWindows.map((week) => week.label);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>(fallbackProjects);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedConsultant, setSelectedConsultant] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(weeksList[0]);
  const [inputDays, setInputDays] = useState("2.5");
  const [inputStatus, setInputStatus] = useState<"tentative" | "reserved" | "confirmed">("confirmed");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [apiState, setApiState] = useState<"loading" | "ready" | "fallback">("loading");
  const [apiMeta, setApiMeta] = useState("Đang tải dữ liệu nguồn lực...");
  const [resourcePage, setResourcePage] = useState(1);
  const [overbookRequest, setOverbookRequest] = useState<AllocationDraft | null>(null);

  const consultantOptions = useMemo(() => {
    return consultants.map((c) => ({
      value: c.id,
      label: `${c.name} (${c.role})`,
      icon: "users" as const,
      iconTone: "info"
    }));
  }, [consultants]);

  const projectOptions = useMemo(() => {
    return projects.map((p) => ({
      value: p.id,
      label: p.accountName ? `${p.name} (${p.accountName})` : p.name,
      icon: "briefcase" as const,
      iconTone: "neutral"
    }));
  }, [projects]);

  const weekOptions = useMemo(() => {
    return weekWindows.map((w) => ({
      value: w.label,
      label: w.label,
      icon: "calendar" as const,
      iconTone: "neutral"
    }));
  }, [weekWindows]);

  async function refreshCapacity() {
    try {
      const summaries = await Promise.all(
        weekWindows.map(async (week) => {
          const url = new URL("/api/capacity/summary", window.location.origin);
          url.searchParams.set("principal", "founder");
          url.searchParams.set("periodStart", week.start);
          url.searchParams.set("periodEnd", week.end);
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error("Chưa lấy được dữ liệu mới nhất.");
          return { response: (await response.json()) as CapacitySummaryResponse, week };
        })
      );

      setConsultants(adaptCapacitySnapshots(summaries));
      setApiState("ready");
      setApiMeta("Dữ liệu nguồn lực đã đồng bộ");
    } catch (error) {
      setApiState("fallback");
      setApiMeta(error instanceof Error ? error.message : "Chưa có dữ liệu nguồn lực mới nhất.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [projectResponse] = await Promise.all([
          fetch("/api/projects?principal=founder", { cache: "no-store" }),
          refreshCapacity()
        ]);
        if (cancelled) return;
        if (projectResponse.ok) {
          const payload = (await projectResponse.json()) as ResourceListResponse<ProjectSummary>;
          const nextProjects = payload.data.map((project) => ({
            accountId: project.accountId,
            accountName: project.accountName,
            id: project.id,
            name: project.name
          }));
          setProjects(nextProjects);
          setSelectedProjectId((current) => nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? "");
        }
      } catch {
        if (!cancelled) setApiState("fallback");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [weekWindows]);

  useEffect(() => {
    setSelectedConsultant((current) => consultants.some((consultant) => consultant.id === current) ? current : consultants[0]?.id ?? "");
  }, [consultants]);

  useEffect(() => {
    setResourcePage(1);
  }, [consultants.length]);

  const totalConsultants = consultants.length;
  const firstWeek = weeksList[0];
  const overbookedThisWeek = consultants.filter((consultant) => getUtilizationData(consultant, firstWeek).percentage > 100).length;
  const larkSyncedCount = consultants.filter((consultant) => consultant.larkOpenId).length;
  const assignedThisWeek = consultants.filter((consultant) => getUtilizationData(consultant, firstWeek).allocated > 0).length;
  const totalResourcePages = Math.max(1, Math.ceil(consultants.length / resourcePageSize));
  const currentResourcePage = Math.min(resourcePage, totalResourcePages);
  const pagedConsultants = consultants.slice((currentResourcePage - 1) * resourcePageSize, currentResourcePage * resourcePageSize);

  function getUtilizationData(consultant: Consultant, week: string) {
    const allocated = consultant.allocations
      .filter((allocation) => allocation.week === week && !["released", "completed", "cancelled"].includes(allocation.status))
      .reduce((sum, allocation) => sum + allocation.days, 0);
    const available = (consultant.capacityMinutesByWeek[week] ?? 5 * minutesPerDay) / minutesPerDay;
    const percentage = available > 0 ? Math.round((allocated / available) * 100) : 0;

    let tone: "info" | "success" | "warning" | "critical" | "neutral" = "success";
    let statusText = "Ổn định";

    if (percentage === 0) {
      tone = "neutral";
      statusText = "Còn trống";
    } else if (percentage <= 80) {
      tone = "info";
      statusText = "Còn trống";
    } else if (percentage <= 100) {
      tone = "success";
      statusText = "Ổn định";
    } else if (percentage <= 110) {
      tone = "warning";
      statusText = "Vượt tải nhẹ";
    } else {
      tone = "critical";
      statusText = percentage > 120 ? "Bị chặn trên 120%" : "Quá tải cao";
    }

    return { allocated, available, percentage, tone, statusText };
  }

  async function submitAllocationDraft({ consultant, days, nextPercentage, project, week }: AllocationDraft) {
    const response = await fetch("/api/capacity/allocations?principal=founder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: project.accountId,
        projectId: project.id,
        userId: consultant.id,
        role: consultant.role,
        skill: consultant.skills[0],
        status: inputStatus,
        allocationPercent: Math.round(nextPercentage),
        plannedMinutes: Math.round(days * minutesPerDay),
        startAt: week.start,
        endAt: week.end,
        overbookApproved: nextPercentage > 100,
        note: "Tạo từ màn hình phân bổ nguồn lực"
      })
    });

    if (!response.ok) {
      const body = await response.text();
      alert(`Không thể lưu phân bổ lúc này (${response.status}). ${body}`);
      return;
    }

    setIsModalOpen(false);
    setToastMessage(`Đã phân bổ ${days} ngày cho ${consultant.name} vào dự án ${project.name}.`);
    setTimeout(() => setToastMessage(null), 4000);
    await refreshCapacity();
  }

  async function handleCreateAllocation() {
    const days = parseFloat(inputDays);
    if (Number.isNaN(days) || days <= 0 || days > 7) {
      alert("Số ngày phân bổ không hợp lệ (phải từ 0 đến 7 ngày/tuần).");
      return;
    }

    const consultant = consultants.find((item) => item.id === selectedConsultant);
    const project = projects.find((item) => item.id === selectedProjectId);
    const week = weekWindows.find((item) => item.label === selectedWeek);
    if (!consultant || !project || !week) return;

    const current = getUtilizationData(consultant, selectedWeek);
    const nextDays = current.allocated + days;
    const nextPercentage = current.available > 0 ? (nextDays / current.available) * 100 : 0;
    const draft = { consultant, days, nextPercentage, project, week };

    if (nextPercentage > 120) {
      alert(`Không thể thực hiện phân bổ này. Tổng tải tuần của ${consultant.name} sẽ là ${Math.round(nextPercentage)}% (vượt ngưỡng 120%).`);
      return;
    }

    if (nextPercentage > 110) {
      setOverbookRequest(draft);
      return;
    }

    await submitAllocationDraft(draft);
  }

  return (
    <ShopifyAppShell active="resource-mgmt" principal={shellPrincipal} principalAvatarUrl={shellPrincipalAvatarUrl}>
      <ShopifyPage heading="Nguồn lực & phân bổ">
        <div className="shopify-status-row" aria-label="Cài đặt nguồn lực" style={{ marginBottom: "16px" }}>
          <s-badge tone="neutral">Đội triển khai</s-badge>
          <s-badge tone={apiState === "ready" ? "success" : apiState === "loading" ? "info" : "warning"}>
            {apiState === "ready" ? apiMeta : apiState === "loading" ? "Đang tải dữ liệu nguồn lực" : "Đang dùng dữ liệu dự phòng"}
          </s-badge>
        </div>

        {toastMessage && (
          <div style={{ margin: "16px 0" }}>
            <ShopifyBanner heading="Thông báo hệ thống" tone="success">
              <s-paragraph>{toastMessage}</s-paragraph>
            </ShopifyBanner>
          </div>
        )}

        {apiState === "fallback" ? (
          <div style={{ marginBottom: "16px" }}>
            <ShopifyBanner heading="Chưa đọc được dữ liệu nguồn lực" tone="warning">
              <s-paragraph>Hãy kiểm tra phiên đăng nhập hoặc API capacity. Màn hình không dùng dữ liệu giả để tránh assign nhầm người.</s-paragraph>
            </ShopifyBanner>
          </div>
        ) : null}

        <div className="resource-summary-grid">
          <div className="kpi-metric-card" style={{ "--kpi-border": "var(--accent)" } as any}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="kpi-label">Tổng nhân sự</span>
              <span style={{ color: "var(--accent)" }}><ShopifyIcon name="users" size={18} /></span>
            </div>
            <span className="kpi-value font-mono tabular-nums">{totalConsultants}</span>
            <span className="kpi-detail">nguồn lực triển khai</span>
          </div>
          <div className="kpi-metric-card" style={{ "--kpi-border": "var(--success)" } as any}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="kpi-label">Hồ sơ đồng bộ</span>
              <span style={{ color: "var(--success)" }}><ShopifyIcon name="check" size={18} /></span>
            </div>
            <span className="kpi-value font-mono tabular-nums" style={{ color: "var(--success)" }}>{larkSyncedCount}</span>
            <span className="kpi-detail">có định danh và avatar</span>
          </div>
          <div className="kpi-metric-card" style={{ "--kpi-border": overbookedThisWeek ? "var(--danger)" : "var(--success)" } as any}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="kpi-label">Quá tải</span>
              <span style={{ color: overbookedThisWeek ? "var(--danger)" : "var(--success)" }}><ShopifyIcon name="alert" size={18} /></span>
            </div>
            <span className="kpi-value font-mono tabular-nums" style={{ color: overbookedThisWeek ? "var(--danger)" : "var(--success)" }}>{overbookedThisWeek}</span>
            <span className="kpi-detail">tuần này ({firstWeek})</span>
          </div>
          <div className="kpi-metric-card" style={{ "--kpi-border": "var(--warning)" } as any}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="kpi-label">Ngưỡng tối đa</span>
              <span style={{ color: "var(--warning)" }}><ShopifyIcon name="target" size={18} /></span>
            </div>
            <span className="kpi-value font-mono tabular-nums">120%</span>
            <span className="kpi-detail">mốc kiểm soát tải</span>
          </div>
        </div>

        <section className="resource-member-strip" aria-label="Danh sách nguồn lực đồng bộ">
          <div className="resource-section-heading">
            <div>
              <span>Danh sách nguồn lực</span>
              <strong>{assignedThisWeek} người đang có lịch tuần này</strong>
            </div>
            <small>{consultants.length > 0 ? `Hiển thị ${pageRangeLabel(currentResourcePage, resourcePageSize, consultants.length)}` : "Chưa có hồ sơ nguồn lực"}</small>
          </div>
          {consultants.length > 0 ? (
            <>
              <div className="resource-member-grid">
                {pagedConsultants.map((consultant) => {
                  const utilization = getUtilizationData(consultant, firstWeek);
                  return (
                    <article className="resource-member-card" key={consultant.id}>
                      <MemberAvatar consultant={consultant} />
                      <div className="resource-member-main">
                        <div className="resource-member-title">
                          <strong>{consultant.name}</strong>
                          <s-badge tone={utilization.tone}>{utilization.statusText}</s-badge>
                        </div>
                        <span>{consultant.role}</span>
                        <small>{consultant.departmentCode ? formatDepartment(consultant.departmentCode) : "Chưa có phòng ban"} · {consultant.email ?? "Chưa có email"}</small>
                        <div className="resource-member-tags">
                          <span>{consultant.larkOpenId ? "Đã đồng bộ" : "Chưa có định danh"}</span>
                          <span>{formatDays(utilization.allocated)}d / {formatDays(utilization.available)}d</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <ResourcePagination
                currentPage={currentResourcePage}
                pageSize={resourcePageSize}
                totalItems={consultants.length}
                totalPages={totalResourcePages}
                onPageChange={setResourcePage}
              />
            </>
          ) : (
            <div className="resource-empty-state">
              <ShopifyIcon name="users" size={18} />
              <strong>Chưa có nguồn lực active</strong>
              <span>Vào Chính sách để tạo member hoặc bật ResourceProfile cho nhân sự đã sync từ Lark.</span>
            </div>
          )}
        </section>

        <div className="shopify-index-toolbar" style={{ display: "flex", justifyContent: "flex-end" }}>
          <div className="shopify-action-row">
            <button
              onClick={() => setIsModalOpen(true)}
              className="task-button primary"
              style={{ fontFamily: "var(--font-sans)" }}
              disabled={consultants.length === 0 || projects.length === 0}
            >
              Phân bổ nguồn lực
            </button>
          </div>
        </div>

        <div className="premium-card" style={{ padding: "4px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "24px" }}>
          <ShopifySection heading="Lịch tải nguồn lực theo tuần">
            <ShopifyDataTable
              ariaLabel="Lịch tải nguồn lực theo tuần"
              columns={[
                { key: "consultant", header: "Nhân sự / vai trò", width: "22%" },
                ...weeksList.map((week) => ({ key: week, header: week, width: "11%" })),
                { key: "skills", header: "Kỹ năng & năng lực", width: "34%" }
              ]}
              minWidth={1040}
              rows={pagedConsultants.map((consultant) => ({
                key: consultant.id,
                cells: [
                  (
                    <div className="resource-table-member">
                      <MemberAvatar consultant={consultant} compact />
                      <div>
                        <strong>{consultant.name}</strong>
                        <span>{consultant.role}</span>
                        <small>{consultant.departmentCode ? formatDepartment(consultant.departmentCode) : "Chưa có phòng ban"} · {consultant.email ?? "Chưa có email"}</small>
                      </div>
                    </div>
                  ),
                  ...weeksList.map((week) => {
                    const { allocated, available, percentage, tone, statusText } = getUtilizationData(consultant, week);
                    return (
                      <div key={week} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span className="font-mono tabular-nums" style={{ fontSize: "13px", fontWeight: 650, color: "var(--text)" }}>{formatDays(allocated)}d / {formatDays(available)}d</span>
                        <span className="font-mono tabular-nums" style={{ fontSize: "11px", color: "var(--text-muted)" }}>({percentage}%)</span>
                        <div style={{ marginTop: "3px" }}>
                          <s-badge tone={tone}>{statusText}</s-badge>
                        </div>
                      </div>
                    );
                  }),
                  (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {consultant.skills.map((skill) => (
                        <span
                          key={skill}
                          style={{
                            fontSize: "11px",
                            padding: "3px 8px",
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                            border: "1px solid var(--accent-soft-strong)",
                            borderRadius: "100px",
                            fontWeight: 500,
                            transition: "all 140ms ease",
                            cursor: "default"
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )
                ]
              }))}
            />
            {consultants.length > resourcePageSize ? (
              <ResourcePagination
                currentPage={currentResourcePage}
                pageSize={resourcePageSize}
                totalItems={consultants.length}
                totalPages={totalResourcePages}
                onPageChange={setResourcePage}
              />
            ) : null}
          </ShopifySection>
        </div>

        <ShopifyModal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Phân bổ nguồn lực cho dự án">
          <div className="shopify-form-stack" style={{ padding: "8px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "var(--text-subtle)", margin: 0 }}>
              Gán năng lực consultant vào dự án đang triển khai. Nếu vượt ngưỡng tải, hệ thống sẽ yêu cầu duyệt trước khi xác nhận.
            </p>

            <div style={{ position: "relative", zIndex: 10 }}>
              <CustomDropdown
                label="Chọn nhân sự"
                value={selectedConsultant}
                options={consultantOptions}
                onChange={setSelectedConsultant}
              />
              {selectedConsultant ? null : (
                <p className="resource-form-note">Chưa có nhân sự nào trong danh sách nguồn lực để phân bổ.</p>
              )}
            </div>

            <div style={{ position: "relative", zIndex: 9 }}>
              <CustomDropdown
                label="Dự án"
                value={selectedProjectId}
                options={projectOptions}
                onChange={setSelectedProjectId}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", position: "relative", zIndex: 8 }}>
              <div>
                <CustomDropdown
                  label="Tuần làm việc"
                  value={selectedWeek}
                  options={weekOptions}
                  onChange={setSelectedWeek}
                />
              </div>

              <div className="task-field-control">
                <label className="task-field-label">Số ngày phân bổ</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="7"
                  value={inputDays}
                  onChange={(event) => setInputDays(event.target.value)}
                  className="task-text-input"
                  style={{ fontFamily: "var(--font-sans)" }}
                />
              </div>
            </div>

            <div className="task-field-control">
              <label className="task-field-label">Trạng thái</label>
              <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                {(["confirmed", "reserved", "tentative"] as const).map((status) => {
                  const active = inputStatus === status;
                  let activeStyle = {};

                  if (active) {
                    if (status === "confirmed") {
                      activeStyle = { background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--accent)" };
                    } else if (status === "reserved") {
                      activeStyle = { background: "rgba(178, 107, 0, 0.08)", border: "1px solid #b26b00", color: "#b26b00" };
                    } else {
                      activeStyle = { background: "rgba(18, 104, 168, 0.08)", border: "1px solid #1268a8", color: "#1268a8" };
                    }
                  }

                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setInputStatus(status)}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--panel-strong)",
                        color: "var(--text-muted)",
                        fontSize: "12.5px",
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        transition: "all 140ms ease",
                        fontFamily: "var(--font-sans)",
                        ...activeStyle
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: active
                            ? (status === "confirmed" ? "var(--accent)" : status === "reserved" ? "#b26b00" : "#1268a8")
                            : "var(--text-muted)",
                          transition: "all 140ms ease"
                        }}
                      />
                      {formatAllocationStatus(status)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="shopify-action-row end" style={{ marginTop: "8px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="task-button secondary"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateAllocation}
                className="task-button primary"
                style={{ fontFamily: "var(--font-sans)" }}
                disabled={!selectedConsultant}
              >
                Lưu phân bổ
              </button>
            </div>
          </div>
        </ShopifyModal>
        {overbookRequest ? (
          <ConfirmActionDialog
            confirmLabel="Gửi duyệt vượt tải"
            onCancel={() => setOverbookRequest(null)}
            onConfirm={async () => {
              const draft = overbookRequest;
              setOverbookRequest(null);
              await submitAllocationDraft(draft);
            }}
            title="Phân bổ vượt tải?"
            tone="warning"
          >
            Phân bổ này sẽ đẩy tải tuần của {overbookRequest.consultant.name} lên {Math.round(overbookRequest.nextPercentage)}%. Xác nhận để gửi phân bổ với trạng thái cần duyệt vượt tải.
          </ConfirmActionDialog>
        ) : null}
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

function adaptCapacitySnapshots(snapshots: Array<{ response: CapacitySummaryResponse; week: WeekWindow }>): Consultant[] {
  const byUser = new Map<string, Consultant>();

  snapshots.forEach(({ response, week }) => {
    response.data.forEach((item) => {
      const consultant = byUser.get(item.userId) ?? createConsultant(item);
      consultant.capacityMinutesByWeek[week.label] = item.availableMinutes;
      consultant.allocations = [
        ...consultant.allocations.filter((allocation) => allocation.week !== week.label),
        ...item.allocations.map((allocation) => ({
          week: week.label,
          project: allocation.projectName ?? allocation.accountName ?? allocation.projectId ?? allocation.accountId,
          days: allocation.plannedMinutes / minutesPerDay,
          status: allocation.status
        }))
      ];
      byUser.set(item.userId, consultant);
    });
  });

  return Array.from(byUser.values());
}

function createConsultant(item: CapacitySummaryItem): Consultant {
  return {
    avatarUrl: item.userAvatarUrl,
    departmentCode: item.departmentCode,
    email: item.userEmail,
    id: item.userId,
    larkOpenId: item.larkOpenId,
    larkTenantKey: item.larkTenantKey,
    name: item.userDisplayName,
    role: item.displayRole ? formatResourceRole(item.displayRole) : "Nguồn lực triển khai",
    skills: item.skills.length > 0 ? item.skills.map(formatResourceSkill) : ["Triển khai"],
    capacityMinutesByWeek: {},
    allocations: []
  };
}

function MemberAvatar({ consultant, compact = false }: { consultant: Consultant; compact?: boolean }) {
  const label = initialsFor(consultant.name || consultant.email || "Member");
  return (
    <span className={`resource-avatar${compact ? " compact" : ""}`} aria-label={consultant.name}>
      {consultant.avatarUrl ? <img src={consultant.avatarUrl} alt="" /> : label}
    </span>
  );
}

function ResourcePagination({
  currentPage,
  onPageChange,
  pageSize,
  totalItems,
  totalPages
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}) {
  if (totalItems <= pageSize) return null;

  return (
    <div className="resource-pagination" aria-label="Phân trang nguồn lực">
      <span>{pageRangeLabel(currentPage, pageSize, totalItems)}</span>
      <div>
        <button
          className="task-button secondary"
          disabled={currentPage <= 1}
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        >
          Trước
        </button>
        <button
          className="task-button secondary"
          disabled={currentPage >= totalPages}
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        >
          Sau
        </button>
      </div>
    </div>
  );
}

function pageRangeLabel(currentPage: number, pageSize: number, totalItems: number) {
  if (totalItems === 0) return "0 hồ sơ";
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalItems, currentPage * pageSize);
  return `${start}-${end} / ${totalItems} hồ sơ`;
}

function initialsFor(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatAllocationStatus(status: AllocationStatus) {
  const labels: Record<string, string> = {
    tentative: "Tạm giữ",
    reserved: "Đã giữ lịch",
    confirmed: "Đã xác nhận",
    blocked: "Đang chặn",
    completed: "Hoàn tất",
    released: "Đã nhả lịch",
    cancelled: "Đã hủy"
  };
  return labels[status] ?? status;
}

function formatResourceRole(role: string) {
  const labels: Record<string, string> = {
    "Delivery resource": "Nguồn lực triển khai",
    "Technical Implementer": "Chuyên viên triển khai",
    "Lark Consultant": "Consultant Lark"
  };
  return labels[role] ?? role;
}

function formatResourceSkill(skill: string) {
  const labels: Record<string, string> = {
    "Integration/API": "Tích hợp Lark",
    "Database Sync": "Đồng bộ dữ liệu",
    Docker: "Vận hành hệ thống",
    "Approval Workflow": "Luồng phê duyệt",
    "Process Analysis": "Phân tích quy trình",
    crm: "CRM",
    delivery: "Triển khai",
    implementation: "Implementation",
    lark: "Lark"
  };
  return labels[skill] ?? skill;
}

function formatDepartment(departmentCode: string) {
  const labels: Record<string, string> = {
    delivery: "Delivery",
    dx: "DX",
    finance: "Finance",
    founder: "Founder/GM",
    sales: "Sales"
  };
  return labels[departmentCode] ?? departmentCode;
}

function buildWeekWindows(): WeekWindow[] {
  const monday = startOfIsoWeek(new Date());
  return Array.from({ length: 4 }, (_, index) => {
    const start = new Date(monday);
    start.setUTCDate(monday.getUTCDate() + index * 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 7);
    return {
      label: `W${isoWeekNumber(start)} (${String(start.getUTCDate()).padStart(2, "0")}/${String(start.getUTCMonth() + 1).padStart(2, "0")})`,
      start: start.toISOString(),
      end: end.toISOString()
    };
  });
}

function startOfIsoWeek(date: Date) {
  const start = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start;
}

function isoWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const fieldLabelStyle = {
  color: "var(--text)",
  display: "block",
  fontSize: "12.5px",
  fontWeight: 600,
  marginBottom: "6px"
};

const fieldStyle = {
  background: "var(--panel-strong)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text)",
  fontFamily: "var(--font-sans)",
  fontSize: "13.5px",
  outline: "none",
  padding: "10px 12px",
  width: "100%"
};
