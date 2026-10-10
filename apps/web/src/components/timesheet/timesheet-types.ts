/**
 * Domain types for the Timesheet feature (spec 35).
 *
 * Built from the live API by `timesheet-live-data`. Every duration is stored in
 * MINUTES (same unit as `TaskTimeEntry.minutes`).
 */

import type { ProjectStatusCode } from "@/lib/project-status";
import { TASK_STATUS_LABEL } from "@/components/crm-workspace/task-display-helpers";

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

/** Canonical Project Status (see @/lib/project-status); null = unknown, shown as "Chưa xác định". */
export type ProjectStatus = ProjectStatusCode | null;

/** `cancelled` covers cancelled/archived/skipped work: closed, never open or overdue. */
export type NodeStatus = "not_started" | "waiting" | "in_progress" | "blocked" | "completed" | "cancelled";

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  not_started: TASK_STATUS_LABEL.notStarted,
  waiting: "Đang chờ",
  in_progress: TASK_STATUS_LABEL.inProgress,
  blocked: "Bị chặn",
  completed: TASK_STATUS_LABEL.completed,
  cancelled: "Đã hủy"
};

/**
 * HR employment state of a project member. NOT the participation state: that is
 * derived per period by the API (EV-035, see fetchProjectMemberParticipation).
 */
export type MemberState = "active" | "on_leave" | "released";

export const MEMBER_STATE_LABELS: Record<MemberState, string> = {
  active: "Đang làm việc",
  on_leave: "Đang nghỉ",
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
  avatarUrl?: string;
  avatarColor?: string;
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
  /** Raw status was `paused`: shown as not started, and not overdue while its project is On Hold. */
  paused?: boolean;
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
  /** Project role / join date: only set when the member payload carries them. */
  role?: string;
  state: MemberState;
  joinedAt?: string;
}

export interface ProjectNode {
  id: string;
  code: string;
  name: string;
  accountName: string;
  status: ProjectStatus;
  workGroup: WorkGroup;
  picId: string;
  /** Planned start of the project; null when the payload has none. */
  startDate: string | null;
  /** Planned end date of the project. */
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

/** Everything a Timesheet screen needs, in one bundle. */
export interface TimesheetDataset {
  /** "Today" as an Asia/Ho_Chi_Minh date key. */
  generatedAt: string;
  /** First day (date key) of the loaded time-entry window; logs before it are not in `logs`. */
  windowStart?: string;
  departments: Department[];
  people: Person[];
  projects: ProjectNode[];
  logs: TimeLog[];
  /** Vietnamese public holidays inside the covered range (`YYYY-MM-DD`). */
  holidays: string[];
  months: string[];
}

/** RBAC scope shown in the UI (spec 35 §4 G12 — mocked until roles are real). */
export type ViewerScope = "workspace" | "managed_projects" | "self";

export const VIEWER_SCOPE_LABELS: Record<ViewerScope, string> = {
  workspace: "Toàn workspace (Founder/GM)",
  managed_projects: "Dự án tôi quản lý (Project Manager / PM)",
  self: "Chỉ dữ liệu của tôi (Member)"
};
