import type { AnalyticsMetricKey } from "@b2b-crm/contracts";

const STATUS_LABELS: Record<string, string> = {
  onboarding: "Đang khởi động",
  completed: "Đã hoàn thành",
  paused: "Tạm dừng",
  in_progress: "Đang thực hiện",
  discovery: "Đang khảo sát",
  acceptance: "Đang nghiệm thu",
  todo: "Chưa bắt đầu",
  pending: "Chờ xử lý",
  active: "Đang hoạt động",
  blocked: "Đang bị chặn",
  cancelled: "Đã hủy",
  archived: "Đã lưu trữ",
  delivery: "Triển khai",
  rework: "Công việc làm lại"
};

export const ANALYTICS_METRIC_LABELS: Record<AnalyticsMetricKey, string> = {
  actualMinutes: "Giờ thực tế đã ghi nhận",
  reviewedApprovedMinutes: "Giờ làm đã duyệt",
  legacyApprovedMinutes: "Giờ cũ chưa đối soát",
  submittedMinutes: "Giờ đang chờ duyệt",
  rejectedMinutes: "Giờ bị từ chối",
  billableRatio: "Tỷ lệ giờ có tính phí",
  capacityMinutes: "Năng lực khả dụng",
  actualUtilization: "Mức sử dụng nguồn lực",
  plannedUtilization: "Mức phân bổ dự kiến",
  scheduledMinutes: "Giờ đã lên lịch",
  scheduleVarianceMinutes: "Chênh lệch giờ đã lên lịch",
  allocationMinutes: "Giờ phân bổ theo kế hoạch",
  estimateMinutes: "Giờ dự kiến",
  projectsTouched: "Dự án có hoạt động",
  taskCompletionRate: "Tỷ lệ hoàn thành công việc",
  onTimeCompletionRate: "Tỷ lệ hoàn thành đúng hạn",
  dueDateCoverage: "Mức đầy đủ ngày hạn",
  estimateVarianceMinutes: "Chênh lệch so với dự kiến",
  medianCycleTimeDays: "Thời gian hoàn thành trung vị",
  overdueTasks: "Công việc quá hạn",
  overdueEstimateMinutes: "Giờ dự kiến của việc quá hạn",
  blockedTasks: "Công việc đang bị chặn",
  overbookedPeople: "Nhân sự bị quá tải",
  reworkShare: "Tỷ trọng công việc làm lại"
};

export function businessStatusLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return STATUS_LABELS[normalized] ?? value.replaceAll("_", " ");
}

const WARNING_LABELS: Record<string, string> = {
  department_team_filter_matched_no_members: "Không có nhân sự phù hợp đồng thời với phòng ban và nhóm đã chọn.",
  scope_resolved_empty: "Không có dữ liệu phù hợp với quyền truy cập và bộ lọc hiện tại.",
  user_breakdown_not_authorized: "Tài khoản hiện tại không được phép xem chi tiết theo nhân sự."
};

export function businessWarningLabel(value: string): string {
  return WARNING_LABELS[value] ?? "Một phần dữ liệu nằm ngoài phạm vi có thể hiển thị. Hãy điều chỉnh bộ lọc hoặc liên hệ quản trị viên.";
}

export function analyticsUnavailableLabel(key: AnalyticsMetricKey): string {
  if (key === "capacityMinutes" || key === "actualUtilization" || key === "plannedUtilization") {
    return "Chưa có dữ liệu năng lực";
  }
  if (key === "onTimeCompletionRate" || key === "dueDateCoverage") {
    return "Chưa đủ dữ liệu ngày hạn";
  }
  if (key === "billableRatio" || key === "reworkShare") {
    return "Chưa đủ dữ liệu phân loại giờ";
  }
  return "Chưa đủ dữ liệu";
}

export const ANALYTICS_BREAKDOWN_LABELS: Record<string, string> = {
  user: "Nhân sự",
  project: "Dự án",
  department: "Phòng ban",
  team: "Nhóm"
};
