/**
 * Domain types for the Timesheet feature (spec 35).
 *
 * These mirror the shape the real API will eventually return so that swapping
 * `timesheet-mock-data` for live fetches touches only the data layer. Every
 * duration is stored in MINUTES (same unit as `TaskTimeEntry.minutes`).
 */

/** MTS-03 work-group taxonomy. Replaces the free-text `workType` column. */
export type WorkGroup =
  | "customer_project"
  | "internal_project"
  | "ticket_maintenance"
  | "meeting"
  | "training"
  | "other";

export const WORK_GROUPS: readonly WorkGroup[] = [
  "customer_project",
  "internal_project",
  "ticket_maintenance",
  "meeting",
  "training",
  "other"
];

export const WORK_GROUP_LABELS: Record<WorkGroup, string> = {
  customer_project: "Dự án khách hàng",
  internal_project: "Dự án nội bộ",
  ticket_maintenance: "Ticket / Bảo trì",
  meeting: "Họp",
  training: "Đào tạo",
  other: "Khác"
};

export type ProjectStatus =
  | "discovery"
  | "onboarding"
  | "in_progress"
  | "acceptance"
  | "paused"
  | "completed";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  discovery: "Khảo sát",
  onboarding: "Onboarding",
  in_progress: "Đang chạy",
  acceptance: "Nghiệm thu",
  paused: "Tạm dừng",
  completed: "Hoàn thành"
};

export type NodeStatus = "not_started" | "in_progress" | "blocked" | "completed";

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  blocked: "Đang chặn",
  completed: "Hoàn thành"
};

/** Member participation state inside a project (PTS-03). */
export type MemberState = "active" | "on_hold" | "released";

export const MEMBER_STATE_LABELS: Record<MemberState, string> = {
  active: "Đang tham gia",
  on_hold: "Tạm dừng",
  released: "Đã rời"
};

export interface Department {
  id: string;
  name: string;
}

export interface Person {
  id: string;
  name: string;
  initials: string;
  role: string;
  departmentId: string;
  teamName: string;
  /** MTS-01: locked at 8h/day by @kha on 2026-07-29 (spec 35 §5b). */
  standardMinutesPerDay: number;
  /** 1.0 = full time. Reserved for the part-time question still open in spec 35 §5b.1. */
  contractRatio: number;
  active: boolean;
}

export interface TaskNode {
  id: string;
  code: string;
  name: string;
  stageId: string;
  assigneeId: string | null;
  estimateMinutes: number;
  status: NodeStatus;
  startDate: string | null;
  dueDate: string | null;
  completedDate: string | null;
}

export interface StageNode {
  id: string;
  name: string;
  milestoneId: string;
  ownerId: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: NodeStatus;
  tasks: TaskNode[];
}

export interface MilestoneNode {
  id: string;
  name: string;
  projectId: string;
  picId: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: NodeStatus;
  stages: StageNode[];
}

export interface ProjectMember {
  personId: string;
  role: string;
  state: MemberState;
  joinedAt: string;
}

export interface ProjectNode {
  id: string;
  code: string;
  name: string;
  accountName: string;
  status: ProjectStatus;
  workGroup: WorkGroup;
  picId: string;
  deadline: string | null;
  members: ProjectMember[];
  milestones: MilestoneNode[];
}

export interface TimeLog {
  id: string;
  /** ISO date `YYYY-MM-DD` in Asia/Ho_Chi_Minh. */
  date: string;
  personId: string;
  projectId: string;
  milestoneId: string;
  stageId: string;
  taskId: string;
  minutes: number;
  workGroup: WorkGroup;
  billable: boolean;
  note: string;
}

/**
 * One workflow transition of a task, mirroring the production
 * `TaskStatusHistory` model. Cumulative-flow and cycle-time analysis are
 * impossible without this — a task's current status alone cannot say when it
 * entered that status.
 */
export interface TaskStatusEvent {
  id: string;
  taskId: string;
  projectId: string;
  /** ISO date `YYYY-MM-DD`. */
  changedAt: string;
  fromStatus: NodeStatus | null;
  toStatus: NodeStatus;
  changedByUserId: string | null;
}

/** Everything a Timesheet screen needs, in one bundle. */
export interface TimesheetDataset {
  generatedAt: string;
  departments: Department[];
  people: Person[];
  projects: ProjectNode[];
  logs: TimeLog[];
  statusEvents: TaskStatusEvent[];
  /** Vietnamese public holidays inside the covered range (`YYYY-MM-DD`). */
  holidays: string[];
  months: string[];
}

/** RBAC scope shown in the UI (spec 35 §4 G12 — mocked until roles are real). */
export type ViewerScope = "workspace" | "managed_projects" | "self";

export const VIEWER_SCOPE_LABELS: Record<ViewerScope, string> = {
  workspace: "Toàn workspace (Founder/GM)",
  managed_projects: "Dự án tôi quản lý (Delivery Lead / PM)",
  self: "Chỉ dữ liệu của tôi (Member)"
};
