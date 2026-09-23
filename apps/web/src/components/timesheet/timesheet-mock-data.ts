/**
 * Deterministic mock dataset for the Timesheet feature (spec 35).
 *
 * WHY DETERMINISTIC: the workbench renders on the server first, so a random
 * dataset would produce a hydration mismatch. Everything below is generated
 * from a fixed seed, so server and client always agree.
 *
 * WHEN THE REAL DB LANDS: replace `getTimesheetDataset()` with fetches against
 * `/api/tasks/time-entries` + the projects/stages APIs. Nothing else in the
 * `timesheet/` folder reads from this module directly except the workbench.
 *
 * The shape intentionally models what the production data does NOT have yet
 * (spec 35 gaps G1-G3, G7-G9): a real milestone layer, a controlled work-group
 * taxonomy, stage/task estimates, and per-person standard hours. Some rows are
 * deliberately left incomplete so the data-readiness screens (MTS-04, PTS-05)
 * have something honest to report.
 */

import type {
  Department,
  MemberState,
  MilestoneNode,
  NodeStatus,
  Person,
  ProjectNode,
  ProjectStatus,
  StageNode,
  TaskNode,
  TaskStatusEvent,
  TimeLog,
  TimesheetDataset,
  WorkGroup
} from "./timesheet-types";

/* ── Seeded PRNG (mulberry32) ───────────────────────────────────────────── */

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

function randomInt(random: () => number, min: number, max: number) {
  return min + Math.floor(random() * (max - min + 1));
}

/* ── Calendar helpers (Asia/Ho_Chi_Minh, no TZ maths needed for dates) ──── */

export const RANGE_START = "2026-05-01";
export const RANGE_END = "2026-07-31";
/** "Today" for the mock — matches the current product date so MTD reads right. */
export const MOCK_TODAY = "2026-07-29";

/** Vietnamese public holidays that fall inside the covered range. */
const HOLIDAYS = ["2026-05-01"];

export function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function eachDate(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = parseISODate(startISO);
  const end = parseISODate(endISO);
  while (cursor.getTime() <= end.getTime()) {
    out.push(toISODate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function isWeekend(iso: string): boolean {
  const day = parseISODate(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function isHoliday(iso: string, holidays: readonly string[]): boolean {
  return holidays.includes(iso);
}

/** A working day = Mon–Fri that is not a public holiday (spec 35 §5b.1). */
export function isWorkingDay(iso: string, holidays: readonly string[]): boolean {
  return !isWeekend(iso) && !isHoliday(iso, holidays);
}

/** `iso` shifted by `days`, clamped to `MOCK_TODAY` when `clampToToday`. */
export function shiftISO(iso: string, days: number, clampToToday = false): string {
  const date = parseISODate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  const shifted = toISODate(date);
  return clampToToday && shifted > MOCK_TODAY ? MOCK_TODAY : shifted;
}

/** Whole days between two ISO dates. */
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / 86_400_000);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function monthBounds(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));
  return { start: toISODate(start), end: toISODate(end) };
}

/** ISO week key like `2026-W23`, used by the weekly rollup (WTS-01). */
export function isoWeekKey(iso: string): string {
  const date = parseISODate(iso);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${`${week}`.padStart(2, "0")}`;
}

export function startOfIsoWeek(iso: string): string {
  const date = parseISODate(iso);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return toISODate(date);
}

/* ── Reference lists ────────────────────────────────────────────────────── */

const DEPARTMENTS: Department[] = [
  { id: "dep-delivery", name: "Delivery" },
  { id: "dep-product", name: "Product & Solution" },
  { id: "dep-qa", name: "QA & Support" }
];

interface PersonSeed {
  name: string;
  role: string;
  departmentId: string;
  teamName: string;
  /** 0..1 — how reliably this person logs work. Drives MTS-04 variety. */
  discipline: number;
  contractRatio?: number;
  active?: boolean;
}

const PERSON_SEEDS: PersonSeed[] = [
  { name: "Vũ Thu Huyền", role: "Delivery Lead", departmentId: "dep-delivery", teamName: "Delivery A", discipline: 0.95 },
  { name: "Trịnh Thị Phương Thảo", role: "Senior Developer", departmentId: "dep-delivery", teamName: "Delivery A", discipline: 0.92 },
  { name: "Lê Duy Anh", role: "Developer", departmentId: "dep-delivery", teamName: "Delivery A", discipline: 0.84 },
  { name: "Trần Hữu Vinh", role: "Solution Owner", departmentId: "dep-product", teamName: "Solution", discipline: 0.72 },
  { name: "Đặng Thúy Hiền", role: "Business Analyst", departmentId: "dep-product", teamName: "Solution", discipline: 0.78 },
  { name: "Đoàn Thị Vân Anh", role: "Project Manager", departmentId: "dep-product", teamName: "PMO", discipline: 0.88 },
  { name: "Đinh Hoàng Phương Linh", role: "Business Analyst", departmentId: "dep-product", teamName: "PMO", discipline: 0.66 },
  { name: "Trần Chung Tiến", role: "Developer", departmentId: "dep-delivery", teamName: "Delivery B", discipline: 0.58 },
  { name: "Nguyễn Thùy Dương", role: "QA Engineer", departmentId: "dep-qa", teamName: "QA", discipline: 0.47, contractRatio: 0.5 },
  { name: "Nguyễn Thanh Huyền", role: "Support Engineer", departmentId: "dep-qa", teamName: "QA", discipline: 0.35 },
  { name: "Phạm Minh Quân", role: "Developer", departmentId: "dep-delivery", teamName: "Delivery B", discipline: 0.81 },
  { name: "Hoàng Bảo Ngọc", role: "QA Engineer", departmentId: "dep-qa", teamName: "QA", discipline: 0.69 }
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  const first = parts[0] ?? "";
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

interface ProjectSeed {
  code: string;
  name: string;
  accountName: string;
  status: ProjectStatus;
  workGroup: WorkGroup;
  picIndex: number;
  memberIndexes: number[];
  deadline: string | null;
  milestones: Array<{ name: string; stages: string[] }>;
  /** Scales generated estimates so Estimate-vs-Actual has real spread. */
  estimateBias: number;
  /** Scales generated actuals. <1 = under-logged, >1 = overrun. */
  effortBias: number;
  /** Deliberate data holes so PTS-05 has something to flag. */
  gaps?: { missingEstimates?: boolean; missingDeadline?: boolean; missingOwners?: boolean };
}

const PROJECT_SEEDS: ProjectSeed[] = [
  {
    code: "PRJ-042",
    name: "HHM — Quy trình thanh toán",
    accountName: "Hoàng Hà Mobile",
    status: "acceptance",
    workGroup: "customer_project",
    picIndex: 0,
    memberIndexes: [0, 1, 2, 4, 8],
    deadline: "2026-08-15",
    estimateBias: 1,
    effortBias: 0.92,
    milestones: [
      { name: "M1 — Khảo sát & Blueprint", stages: ["Thu thập yêu cầu", "Chốt blueprint"] },
      { name: "M2 — Xây dựng", stages: ["Cấu hình quy trình", "Tích hợp kế toán"] },
      { name: "M3 — Nghiệm thu & Go-live", stages: ["UAT nội bộ", "UAT khách hàng", "Go-live"] }
    ]
  },
  {
    code: "PRJ-027",
    name: "FORLIFE — Tính lương",
    accountName: "Forlife",
    status: "in_progress",
    workGroup: "customer_project",
    picIndex: 5,
    memberIndexes: [5, 1, 2, 10, 11],
    deadline: "2026-09-30",
    estimateBias: 1.15,
    effortBias: 0.42,
    milestones: [
      { name: "M1 — Khảo sát chính sách lương", stages: ["Phỏng vấn HR", "Chuẩn hoá công thức"] },
      { name: "M2 — Cấu hình hệ thống", stages: ["Bảng lương", "Bảo hiểm & thuế", "Phiếu lương"] },
      { name: "M3 — Đối soát", stages: ["Chạy song song", "Xử lý sai lệch"] }
    ]
  },
  {
    code: "PRJ-094",
    name: "Lark HRM Suite",
    accountName: "Upbase (nội bộ)",
    status: "in_progress",
    workGroup: "internal_project",
    picIndex: 3,
    memberIndexes: [3, 6, 10, 11],
    deadline: "2026-08-31",
    estimateBias: 0.95,
    effortBias: 0.61,
    milestones: [
      { name: "M1 — Nền tảng", stages: ["Kiến trúc", "Xác thực & phân quyền"] },
      { name: "M2 — Phân hệ nhân sự", stages: ["Hồ sơ nhân sự", "Chấm công"] }
    ],
    gaps: { missingOwners: true }
  },
  {
    code: "PRJ-044",
    name: "HHM — Quản lý thông tin nhân sự",
    accountName: "Hoàng Hà Mobile",
    status: "acceptance",
    workGroup: "customer_project",
    picIndex: 0,
    memberIndexes: [0, 4, 6, 8],
    deadline: "2026-08-08",
    estimateBias: 1.35,
    effortBias: 0.28,
    milestones: [
      { name: "M1 — Chuẩn hoá dữ liệu", stages: ["Làm sạch dữ liệu", "Import"] },
      { name: "M2 — Vận hành", stages: ["Quy trình onboard", "Quy trình nghỉ việc", "Báo cáo"] }
    ]
  },
  {
    code: "PRJ-091",
    name: "ASNOVA — Tính lương",
    accountName: "Asnova",
    status: "completed",
    workGroup: "customer_project",
    picIndex: 1,
    memberIndexes: [1, 2, 9],
    deadline: "2026-06-30",
    estimateBias: 1,
    effortBias: 1.0,
    milestones: [
      { name: "M1 — Triển khai", stages: ["Cấu hình", "Đào tạo"] },
      { name: "M2 — Bàn giao", stages: ["Nghiệm thu"] }
    ]
  },
  {
    code: "PRJ-036",
    name: "HHM — Chấm công",
    accountName: "Hoàng Hà Mobile",
    status: "in_progress",
    workGroup: "customer_project",
    picIndex: 5,
    memberIndexes: [5, 7, 10, 11],
    deadline: null,
    estimateBias: 0.8,
    effortBias: 1.24,
    milestones: [
      { name: "M1 — Thiết bị & đồng bộ", stages: ["Kết nối máy chấm công", "Đồng bộ ca"] },
      { name: "M2 — Báo cáo", stages: ["Bảng công tháng"] }
    ],
    gaps: { missingDeadline: true, missingEstimates: true }
  },
  {
    code: "PRJ-080",
    name: "ĐPBM — HRM Suite",
    accountName: "Đông Phương Bình Minh",
    status: "discovery",
    workGroup: "customer_project",
    picIndex: 3,
    memberIndexes: [3, 6, 4],
    deadline: "2026-10-15",
    estimateBias: 0.7,
    effortBias: 1.05,
    milestones: [{ name: "M1 — Khảo sát", stages: ["Workshop", "Đề xuất giải pháp"] }]
  },
  {
    code: "OPS-001",
    name: "Vận hành & Ticket khách hàng",
    accountName: "Đa khách hàng",
    status: "in_progress",
    workGroup: "ticket_maintenance",
    picIndex: 9,
    memberIndexes: [9, 11, 7, 2],
    deadline: null,
    estimateBias: 0.5,
    effortBias: 1.0,
    milestones: [{ name: "M1 — Hỗ trợ định kỳ", stages: ["Ticket P1-P2", "Ticket P3-P4", "Bảo trì định kỳ"] }]
  },
  {
    code: "INT-002",
    name: "Nội bộ — Đào tạo & Onboarding",
    accountName: "Upbase (nội bộ)",
    status: "in_progress",
    workGroup: "training",
    picIndex: 5,
    memberIndexes: [5, 0, 3, 8, 9, 11],
    deadline: null,
    estimateBias: 0.4,
    effortBias: 1.0,
    milestones: [{ name: "M1 — Chương trình 2026", stages: ["Đào tạo nội bộ", "Onboarding nhân sự mới"] }]
  }
];

const TASK_VERBS = [
  "Phân tích yêu cầu",
  "Thiết kế luồng",
  "Dựng màn hình",
  "Cấu hình quy tắc",
  "Viết tài liệu hướng dẫn",
  "Kiểm thử chức năng",
  "Sửa lỗi sau kiểm thử",
  "Chuẩn bị dữ liệu mẫu",
  "Đào tạo người dùng",
  "Rà soát nghiệm thu"
];

const NOTE_TEMPLATES = [
  "Làm việc với PIC khách hàng, chốt lại yêu cầu",
  "Xử lý phần còn tồn từ buổi review trước",
  "Hoàn thiện phần cấu hình và tự kiểm thử",
  "Họp nội bộ thống nhất phương án",
  "Fix lỗi phát sinh khi chạy thử",
  "Chuẩn bị tài liệu bàn giao"
];

/* ── Task workflow chain ────────────────────────────────────────────────── */

interface StatusStep {
  at: string;
  from: NodeStatus | null;
  to: NodeStatus;
}

/**
 * A plausible `not_started → in_progress → (blocked) → completed` chain.
 *
 * Nothing is allowed past `MOCK_TODAY`: a transition that would land in the
 * future simply never happens, and the task keeps whatever status it had
 * reached. That keeps the cumulative-flow diagram and the cycle-time chart
 * self-consistent — a task can never be "completed" on a date that has not
 * arrived yet.
 */
function buildStatusChain(input: {
  random: () => number;
  milestoneIndex: number;
  forceCompleted: boolean;
}): { steps: StatusStep[]; status: NodeStatus; startedAt: string | null; completedAt: string | null } {
  const { random, milestoneIndex, forceCompleted } = input;

  // Later milestones are created later, so the CFD's total line climbs over time.
  // The spread has to reach the end of the range: bunching creation into the
  // first two months left the current month's flow diagram almost flat, with no
  // arrivals and barely any completions to look at.
  const createdAt = shiftISO(RANGE_START, milestoneIndex * 20 + randomInt(random, 0, 44));
  if (createdAt > MOCK_TODAY) {
    return { steps: [], status: "not_started", startedAt: null, completedAt: null };
  }

  const steps: StatusStep[] = [{ at: createdAt, from: null, to: "not_started" }];

  const startsAt = shiftISO(createdAt, randomInt(random, 1, 12));
  if (startsAt > MOCK_TODAY || (!forceCompleted && random() < 0.16)) {
    return { steps, status: "not_started", startedAt: null, completedAt: null };
  }
  steps.push({ at: startsAt, from: "not_started", to: "in_progress" });

  let current: NodeStatus = "in_progress";
  let cursor = startsAt;

  // A blocked spell in the middle of the work, which the CFD shows as a
  // thickening band rather than as a status that appeared from nowhere.
  if (!forceCompleted && random() < 0.18) {
    const blockedAt = shiftISO(cursor, randomInt(random, 2, 10));
    if (blockedAt <= MOCK_TODAY) {
      steps.push({ at: blockedAt, from: "in_progress", to: "blocked" });
      current = "blocked";
      cursor = blockedAt;
      if (random() < 0.45) {
        const unblockedAt = shiftISO(cursor, randomInt(random, 2, 9));
        if (unblockedAt <= MOCK_TODAY) {
          steps.push({ at: unblockedAt, from: "blocked", to: "in_progress" });
          current = "in_progress";
          cursor = unblockedAt;
        }
      }
    }
  }

  const completes = forceCompleted || random() < 0.62;
  if (completes && current === "in_progress") {
    const completedAt = shiftISO(cursor, randomInt(random, 2, 22));
    if (completedAt <= MOCK_TODAY) {
      steps.push({ at: completedAt, from: "in_progress", to: "completed" });
      return { steps, status: "completed", startedAt: startsAt, completedAt };
    }
  }

  return { steps, status: current, startedAt: startsAt, completedAt: null };
}

/* ── Generator ──────────────────────────────────────────────────────────── */

function buildPeople(): Person[] {
  return PERSON_SEEDS.map((seed, index) => ({
    id: `per-${index + 1}`,
    name: seed.name,
    initials: initialsOf(seed.name),
    role: seed.role,
    departmentId: seed.departmentId,
    teamName: seed.teamName,
    standardMinutesPerDay: 480,
    contractRatio: seed.contractRatio ?? 1,
    active: seed.active ?? true
  }));
}

function buildProjects(
  people: Person[],
  random: () => number,
  statusEvents: TaskStatusEvent[]
): ProjectNode[] {
  return PROJECT_SEEDS.map((seed, projectIndex) => {
    const projectId = `prj-${projectIndex + 1}`;
    const memberIds = seed.memberIndexes.map((i) => people[i].id);

    const milestones: MilestoneNode[] = seed.milestones.map((milestoneSeed, milestoneIndex) => {
      const milestoneId = `${projectId}-m${milestoneIndex + 1}`;
      const monthOffset = milestoneIndex;
      const startDate = toISODate(new Date(Date.UTC(2026, 4 + monthOffset, 1 + randomInt(random, 0, 6))));
      const dueDate = toISODate(new Date(Date.UTC(2026, 5 + monthOffset, 10 + randomInt(random, 0, 12))));

      const stages: StageNode[] = milestoneSeed.stages.map((stageName, stageIndex) => {
        const stageId = `${milestoneId}-s${stageIndex + 1}`;
        const taskCount = randomInt(random, 3, 6);
        const tasks: TaskNode[] = Array.from({ length: taskCount }, (_, taskIndex) => {
          const taskId = `${stageId}-t${taskIndex + 1}`;
          const assigneeId = random() < 0.9 ? pick(random, memberIds) : null;
          const hasEstimate = seed.gaps?.missingEstimates ? random() < 0.35 : random() < 0.9;
          // effortBias is expressed on the ESTIMATE side, not on logged minutes:
          // a project meant to read "only 28% consumed" gets a proportionally
          // larger estimate. Logged hours stay realistic per person so the
          // Monthly view is not distorted by project-level scenarios.
          const estimateHours = (randomInt(random, 3, 24) * seed.estimateBias) / seed.effortBias;
          const hasDue = seed.gaps?.missingDeadline ? random() < 0.4 : random() < 0.85;
          const dueOffset = randomInt(random, 0, 40);
          const due = toISODate(new Date(Date.UTC(2026, 4 + monthOffset, 8 + dueOffset)));

          // Build a real workflow chain first, then read the current status off
          // the end of it. Picking a status at random and back-filling dates
          // produced contradictions (tasks "completed" in the future), and a
          // cumulative-flow diagram needs the transitions anyway.
          const chain = buildStatusChain({
            random,
            milestoneIndex,
            forceCompleted: seed.status === "completed"
          });

          for (const step of chain.steps) {
            statusEvents.push({
              id: `evt-${statusEvents.length + 1}`,
              taskId,
              projectId,
              changedAt: step.at,
              fromStatus: step.from,
              toStatus: step.to,
              changedByUserId: assigneeId
            });
          }

          return {
            id: taskId,
            code: `${seed.code}-${milestoneIndex + 1}${stageIndex + 1}${taskIndex + 1}`,
            name: `${pick(random, TASK_VERBS)}: ${stageName.toLowerCase()}`,
            stageId,
            assigneeId,
            estimateMinutes: hasEstimate ? Math.round(estimateHours) * 60 : 0,
            status: chain.status,
            startDate: chain.startedAt,
            dueDate: hasDue ? due : null,
            completedDate: chain.completedAt
          };
        });

        return {
          id: stageId,
          name: stageName,
          milestoneId,
          ownerId: seed.gaps?.missingOwners && random() < 0.6 ? null : pick(random, memberIds),
          startDate,
          dueDate,
          status:
            tasks.every((task) => task.status === "completed")
              ? "completed"
              : tasks.some((task) => task.status === "blocked")
                ? "blocked"
                : tasks.some((task) => task.status === "in_progress")
                  ? "in_progress"
                  : "not_started",
          tasks
        };
      });

      return {
        id: milestoneId,
        name: milestoneSeed.name,
        projectId,
        picId: people[seed.picIndex].id,
        startDate,
        dueDate,
        status:
          stages.every((stage) => stage.status === "completed")
            ? "completed"
            : stages.some((stage) => stage.status === "blocked")
              ? "blocked"
              : stages.some((stage) => stage.status === "in_progress")
                ? "in_progress"
                : "not_started",
        stages
      };
    });

    const members = seed.memberIndexes.map((personIndex, order) => {
      const state: MemberState =
        seed.status === "completed"
          ? order === 0
            ? "active"
            : "released"
          : order > 2 && random() < 0.4
            ? "on_hold"
            : "active";
      return {
        personId: people[personIndex].id,
        role: people[personIndex].role,
        state,
        joinedAt: toISODate(new Date(Date.UTC(2026, 4, 1 + randomInt(random, 0, 20))))
      };
    });

    return {
      id: projectId,
      code: seed.code,
      name: seed.name,
      accountName: seed.accountName,
      status: seed.status,
      workGroup: seed.workGroup,
      picId: people[seed.picIndex].id,
      deadline: seed.gaps?.missingDeadline ? null : seed.deadline,
      members,
      milestones
    };
  });
}

interface TaskRef {
  projectId: string;
  milestoneId: string;
  stageId: string;
  taskId: string;
  workGroup: WorkGroup;
  assigneeId: string | null;
}

function flattenTasks(projects: ProjectNode[]): TaskRef[] {
  const refs: TaskRef[] = [];
  for (const project of projects) {
    for (const milestone of project.milestones) {
      for (const stage of milestone.stages) {
        for (const task of stage.tasks) {
          refs.push({
            projectId: project.id,
            milestoneId: milestone.id,
            stageId: stage.id,
            taskId: task.id,
            workGroup: project.workGroup,
            assigneeId: task.assigneeId
          });
        }
      }
    }
  }
  return refs;
}

function buildLogs(people: Person[], projects: ProjectNode[], random: () => number): TimeLog[] {
  const taskRefs = flattenTasks(projects);
  const logs: TimeLog[] = [];
  const days = eachDate(RANGE_START, RANGE_END).filter((iso) => iso <= MOCK_TODAY);

  people.forEach((person, personIndex) => {
    const seed = PERSON_SEEDS[personIndex];
    const ownTasks = taskRefs.filter((ref) => ref.assigneeId === person.id);
    const projectPool = ownTasks.length > 0
      ? ownTasks
      : taskRefs.filter((ref) => projects.find((p) => p.id === ref.projectId)?.members.some((m) => m.personId === person.id));
    if (projectPool.length === 0) return;

    for (const iso of days) {
      if (!isWorkingDay(iso, HOLIDAYS)) continue;
      if (random() > seed.discipline) continue;

      const entryCount = randomInt(random, 1, 3);
      // Target roughly a full day scaled by discipline and contract ratio.
      let dayTarget = Math.round(person.standardMinutesPerDay * person.contractRatio * (0.55 + seed.discipline * 0.5));
      // ~6% of logged days are genuine crunch days. Without these the matrix
      // would never show an overloaded cell, so the overload state would be
      // undemonstrable and untestable.
      if (random() < 0.06) dayTarget = Math.round(dayTarget * (1.3 + random() * 0.5));
      let remaining = Math.min(dayTarget, 780);

      for (let entry = 0; entry < entryCount && remaining >= 30; entry += 1) {
        const ref = pick(random, projectPool);
        const share = entry === entryCount - 1 ? remaining : Math.round((remaining * randomInt(random, 35, 70)) / 100);
        const minutes = Math.max(30, Math.round(share / 15) * 15);
        remaining -= share;

        // Overhead work groups get sprinkled in regardless of project type.
        const roll = random();
        const workGroup: WorkGroup =
          roll < 0.08 ? "meeting" : roll < 0.11 ? "training" : roll < 0.14 ? "other" : ref.workGroup;

        logs.push({
          id: `log-${logs.length + 1}`,
          date: iso,
          personId: person.id,
          projectId: ref.projectId,
          milestoneId: ref.milestoneId,
          stageId: ref.stageId,
          taskId: ref.taskId,
          minutes,
          billable: workGroup === "customer_project" || workGroup === "ticket_maintenance",
          workGroup,
          note: pick(random, NOTE_TEMPLATES)
        });
      }
    }
  });

  return logs;
}

let cached: TimesheetDataset | null = null;

/** Returns the (memoised) mock dataset. Safe to call during SSR and render. */
export function getTimesheetDataset(): TimesheetDataset {
  if (cached) return cached;
  const random = createRandom(20260729);
  const people = buildPeople();
  const statusEvents: TaskStatusEvent[] = [];
  const projects = buildProjects(people, random, statusEvents);
  const logs = buildLogs(people, projects, random);

  cached = {
    generatedAt: MOCK_TODAY,
    departments: DEPARTMENTS,
    people,
    projects,
    logs,
    statusEvents,
    holidays: HOLIDAYS,
    months: ["2026-05", "2026-06", "2026-07"]
  };
  return cached;
}
