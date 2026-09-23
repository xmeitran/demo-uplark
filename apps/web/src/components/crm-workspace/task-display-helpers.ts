import type { ProjectTaskSummary } from "@b2b-crm/contracts";

export function formatDecimalNumber(value: number) {
  const hasDecimal = value % 1 !== 0;
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2
  }).format(value);
}

export function getTaskTypeIcon(type: string): string {
  const t = (type || "").toLowerCase();
  if (t === "implementation") return "settings";
  if (t === "blueprint" || t === "kickoff") return "order";
  if (t === "consulting" || t === "customer_action" || t === "customeraction") return "person";
  return "clock";
}

const uppercaseCodeTokens = new Set(["api", "crm", "csv", "dx", "hrm", "kh", "pqa", "qa", "uat", "ui", "ux"]);

function normalizeCodeKey(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function formatCodeLabel(value?: string | null) {
  const normalized = normalizeCodeKey(value);
  if (!normalized) return "";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => uppercaseCodeTokens.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const statusLabels: Record<string, string> = {
  todo: "Cần làm",
  in_progress: "Đang xử lý",
  completed: "Hoàn tất",
  blocked: "Đang bị chặn",
  cancelled: "Đã hủy",
  done: "Hoàn tất",
  paused: "Tạm dừng",
  pending: "Đang chờ",
  skipped: "Bỏ qua"
};

export const taskTypeLabels: Record<string, string> = {
  implementation: "Triển khai",
  blueprint: "Thiết kế giải pháp",
  kickoff: "Kickoff",
  proposal: "Đề xuất giải pháp",
  pqa: "PQA",
  prototype: "Prototype",
  acceptance: "Nghiệm thu",
  handover: "Bàn giao",
  consulting: "Tư vấn",
  support: "Hỗ trợ kỹ thuật",
  customer_action: "Việc phía khách hàng",
  customeraction: "Việc phía khách hàng",
  discovery: "Khảo sát",
  dx_manager: "Quản lý DX",
  optimization_backlog: "Backlog tối ưu"
};

export const priorityLabels: Record<string, string> = {
  urgent: "Khẩn cấp",
  critical: "Rất cao",
  high: "Cao",
  medium: "Vừa",
  low: "Thấp"
};

export const workTypeLabels: Record<string, string> = {
  delivery: "Triển khai",
  consulting: "Tư vấn",
  training: "Đào tạo",
  support: "Hỗ trợ",
  blueprint: "Thiết kế giải pháp",
  meeting: "Họp",
  billable_delivery: "Triển khai tính phí",
  non_billable_delivery: "Triển khai không tính phí",
  rework: "Làm lại",
  internal_admin: "Nội bộ/Admin",
  kh_c: "KH C"
};

export function getStatusLabel(status?: string | null) {
  const key = normalizeCodeKey(status);
  return statusLabels[key] || formatCodeLabel(status) || "Chưa đặt";
}

export function getTaskTypeLabel(taskType?: string | null) {
  const key = normalizeCodeKey(taskType);
  return taskTypeLabels[key] || formatCodeLabel(taskType) || "Công việc";
}

export function getPriorityLabel(priority?: string | null) {
  const key = normalizeCodeKey(priority);
  return priorityLabels[key] || formatCodeLabel(priority) || "Chưa đặt";
}

export function getWorkTypeLabel(workType?: string | null) {
  const key = normalizeCodeKey(workType);
  return workTypeLabels[key] || formatCodeLabel(workType) || "";
}

const localizedTaskTitles: Record<string, string> = {};

export function formatTaskTitle(title?: string) {
  if (!title) return "Công việc chưa đặt tên";
  return localizedTaskTitles[title] ?? title;
}

export function formatTaskMinutes(minutes?: number | null) {
  const value = Number(minutes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 phút";
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${formatDecimalNumber(remainder)} phút`;
  if (!remainder) return `${formatDecimalNumber(hours)} giờ`;
  return `${formatDecimalNumber(hours)} giờ ${formatDecimalNumber(remainder)} phút`;
}

export type DeploymentStage = {
  phase: "Standard" | "Digital Transform" | "Adoption";
  activity: string;
  cumulativePercent: number;
  activityPercent: number;
  criteria: "Quy trình" | "Số hóa";
  description: string;
  upbaseRole: string;
  customerRole: string;
};

export const deploymentStagePlan: DeploymentStage[] = [
  {
    phase: "Standard",
    activity: "Analyst",
    cumulativePercent: 10,
    activityPercent: 10,
    criteria: "Quy trình",
    description: "Phân tích thực trạng quy trình, dữ liệu, luồng vận hành và công cụ đang sử dụng.",
    upbaseRole: "Gửi biểu mẫu khảo sát, phỏng vấn và tổng hợp hiện trạng.",
    customerRole: "Cung cấp dữ liệu, tài liệu quy trình và chia sẻ khó khăn, nhu cầu."
  },
  {
    phase: "Standard",
    activity: "Standard",
    cumulativePercent: 30,
    activityPercent: 20,
    criteria: "Quy trình",
    description: "Chuẩn hóa tài liệu và quy trình sau phân tích; xây bộ quy trình làm nền tảng chuyển đổi.",
    upbaseRole: "Vẽ luồng BPMN, đề xuất chuẩn hóa và soạn draft tài liệu chuẩn.",
    customerRole: "Review, phản hồi và chốt quy trình chuẩn cuối cùng."
  },
  {
    phase: "Digital Transform",
    activity: "Proposal",
    cumulativePercent: 45,
    activityPercent: 15,
    criteria: "Quy trình",
    description: "Đề xuất phương án số hóa dựa trên quy trình chuẩn và tính năng phù hợp.",
    upbaseRole: "Đề xuất giải pháp, thiết kế demo trên Lark và viết tài liệu mô tả.",
    customerRole: "Nêu nhu cầu cụ thể, tham gia duyệt phương án và góp ý điều chỉnh."
  },
  {
    phase: "Digital Transform",
    activity: "Transform",
    cumulativePercent: 65,
    activityPercent: 20,
    criteria: "Số hóa",
    description: "Thiết lập, xây dựng hệ thống số trên nền tảng Lark, gồm setup, phân quyền và tích hợp dữ liệu.",
    upbaseRole: "Xây quy trình số trên Lark, set up Form/Flow/phân quyền và test kỹ thuật.",
    customerRole: "Cung cấp danh sách người dùng, hỗ trợ kiểm tra dữ liệu và phê duyệt quyền truy cập."
  },
  {
    phase: "Digital Transform",
    activity: "Prototype",
    cumulativePercent: 75,
    activityPercent: 10,
    criteria: "Số hóa",
    description: "Xây phiên bản nguyên mẫu để minh họa doanh nghiệp thấy luồng hoạt động trước khi áp dụng rộng.",
    upbaseRole: "Tạo prototype và trình bày cách thức hoạt động của base.",
    customerRole: "Trải nghiệm prototype, xác nhận phù hợp và góp ý trước pilot."
  },
  {
    phase: "Adoption",
    activity: "Pilot",
    cumulativePercent: 90,
    activityPercent: 15,
    criteria: "Quy trình",
    description: "Thử nghiệm hệ thống trong phạm vi hẹp để kiểm chứng hiệu quả, phát hiện lỗi và nhận phản hồi.",
    upbaseRole: "Đưa checklist test, triển khai pilot, theo dõi và báo cáo hiệu quả.",
    customerRole: "Tham gia test quy trình thực tế, báo cáo vướng mắc và góp ý tối ưu."
  },
  {
    phase: "Adoption",
    activity: "Onboarding",
    cumulativePercent: 95,
    activityPercent: 5,
    criteria: "Quy trình",
    description: "Đào tạo, hướng dẫn và hỗ trợ áp dụng hệ thống chính thức vào công việc.",
    upbaseRole: "Tổ chức đào tạo, cung cấp tài liệu hướng dẫn và support 1-1 giai đoạn đầu.",
    customerRole: "Tham gia đào tạo, áp dụng quy trình số hóa và feedback qua ticket support."
  },
  {
    phase: "Adoption",
    activity: "Nghiệm thu",
    cumulativePercent: 100,
    activityPercent: 5,
    criteria: "Quy trình",
    description: "Chốt nghiệm thu, bàn giao và xác nhận hoàn thành phạm vi triển khai.",
    upbaseRole: "Tổng hợp biên bản nghiệm thu, checklist bàn giao và khuyến nghị vận hành.",
    customerRole: "Xác nhận kết quả, ký nghiệm thu và thống nhất kế hoạch vận hành sau bàn giao."
  }
];

const deploymentStageByTaskType: Record<string, number> = {
  discovery: 0,
  blueprint: 1,
  proposal: 2,
  implementation: 3,
  transform: 3,
  prototype: 4,
  kickoff: 5,
  customer_action: 6,
  customeraction: 6,
  consulting: 6,
  support: 6,
  acceptance: 7,
  handover: 7
};

export function getDeploymentStageForTask(task: Pick<ProjectTaskSummary, "taskType" | "status">) {
  const typeKey = (task.taskType || "").toLowerCase();
  const index = deploymentStageByTaskType[typeKey] ?? 3;
  const stage = deploymentStagePlan[index] ?? deploymentStagePlan[3];
  return {
    index,
    stage,
    isCompleted: task.status === "completed",
    label: `${stage.activity} · ${stage.cumulativePercent}%`
  };
}
