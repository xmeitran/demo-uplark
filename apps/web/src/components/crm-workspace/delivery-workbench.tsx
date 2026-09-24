"use client";

import { useRouter } from "next/navigation";
import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type AccountsResponse,
  type CapacitySummaryItem,
  type CapacitySummaryResponse,
  type CreateProjectInput,
  type CreateProjectTaskInput,
  type ProjectStageSummary,
  type ProjectSummary,
  type ProjectTaskSummary,
  type ResourceListResponse,
  type UpdateProjectInput,
  type UpdateProjectStageInput
} from "@b2b-crm/contracts";
import { ShopifyAppShell, ShopifyDataTable, ShopifyIcon, ShopifyPage, type ShopifyIconName } from "../shopify-ui";
import {
  deploymentStagePlan,
  formatTaskMinutes,
  formatTaskTitle,
  getDeploymentStageForTask,
  statusLabels
} from "./task-display-helpers";
import {
  loadTaskDrafts,
  persistTaskDrafts,
  productionWriteFailureMessage,
  taskDraftsEnabled
} from "../../features/crm-tasks/task-draft-storage";
import { loadRouteDataJson } from "../../lib/route-data-cache";
import { businessFunctionConfigs, type BusinessFunctionConfig } from "./business-function-config";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { ModalLayer } from "../modal-layer";
import type { DeliveryCreateTaskModalDefaults } from "./delivery-create-task-modal.lazy";
import type { DeliveryCreateProjectPayload, DeliveryUpdateProjectPayload } from "./delivery-create-project-modal.lazy";
import type { TaskSelectOption } from "./tasks-workbench";

const LazyCreateTaskModal = lazy(() => import("./delivery-create-task-modal.lazy"));
const LazyCreateProjectModal = lazy(() => import("./delivery-create-project-modal.lazy"));
const LazyDeliveryStageEditModal = lazy(() => import("./delivery-stage-edit-modal.lazy"));

type DeliveryAccountOption = {
  id: string;
  name: string;
};

type DeliveryProjectGroup = Pick<
  ProjectSummary,
  "accountId" | "accountName" | "code" | "hierarchyOrderVersion" | "id" | "name" | "opportunityId" | "opportunityStage" | "opportunityTitle" | "status"
>;

type DeliveryStageView = Pick<
  ProjectStageSummary,
  | "id"
  | "stageKey"
  | "phase"
  | "activity"
  | "sortOrder"
  | "cumulativePercent"
  | "activityPercent"
  | "criteria"
  | "description"
  | "upbaseRole"
  | "customerRole"
  | "status"
  | "ownerUserId"
  | "ownerDisplayName"
  | "plannedStartAt"
  | "plannedEndAt"
  | "actualStartAt"
  | "actualEndAt"
  | "scopeSummary"
  | "standardMinutes"
  | "acceptanceCriteria"
  | "blockerSummary"
  | "progressPercent"
>;

type StageEditDraft = {
  status: string;
  ownerUserId: string;
  plannedStartAt: string;
  plannedEndAt: string;
  actualStartAt: string;
  actualEndAt: string;
  scopeSummary: string;
  standardMinutes: string;
  acceptanceCriteria: string;
  blockerSummary: string;
  progressPercent: string;
};

type CreateTaskModalDefaults = DeliveryCreateTaskModalDefaults;

type StageDetailState = {
  stage: DeliveryStageView;
  stageIndex: number;
};

type DeliveryStageViewMode = "table" | "group" | "kanban";

type DeliveryStageRuntimeRow = {
  assignees: string[];
  dueLabel: string;
  estimateMinutes: number;
  loggedMinutes: number;
  progressPercent: number;
  stage: DeliveryStageView;
  stageIndex: number;
  standardMinutes: number;
  statusLabel: string;
  tasks: ProjectTaskSummary[];
};

type DeliveryProjectRollup = {
  activeTasks: number;
  assignees: string[];
  blockedStages: number;
  completedStages: number;
  currentStage?: DeliveryStageView;
  dueLabel: string;
  estimateMinutes: number;
  loggedMinutes: number;
  progressPercent: number;
  stageCount: number;
  tasks: ProjectTaskSummary[];
};

type DeliveryOverviewPayload = {
  capacity: CapacitySummaryResponse;
  projects: ResourceListResponse<ProjectSummary>;
  stagesByProjectId: Record<string, ProjectStageSummary[]>;
  tasks: ResourceListResponse<ProjectTaskSummary>;
};

const stageTaskTypes = [
  "discovery",
  "blueprint",
  "proposal",
  "implementation",
  "prototype",
  "kickoff",
  "customer_action",
  "acceptance"
];

const stageStatusOptions = [
  { value: "not_started", label: "Chưa bắt đầu", icon: "clock" },
  { value: "in_progress", label: "Đang triển khai", icon: "settings" },
  { value: "blocked", label: "Đang bị chặn", icon: "alert-circle", iconTone: "critical" },
  { value: "completed", label: "Hoàn tất", icon: "checkmark", iconTone: "success" },
  { value: "cancelled", label: "Đã hủy", icon: "alert-circle" }
];

const fallbackDeliveryResourceOptions: TaskSelectOption[] = [
  { value: "none", label: "Chưa giao", icon: "person" },
  { value: "founder", label: "Kha Nguyen (Founder)", icon: "person" }
];

function DeliveryModal({
  children,
  onClose,
  title
}: Readonly<{
  children: ReactNode;
  onClose: () => void;
  title: string;
}>) {
  return (
    <ModalLayer onClose={onClose}>
    <div className="task-modal-backdrop" onClick={onClose}>
      <div
        aria-label={title}
        aria-modal="true"
        className="task-modal-shell"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="task-modal-header">
          <h3>{title}</h3>
          <button aria-label="Close modal" className="task-modal-close" onClick={onClose} type="button">
            <ShopifyIcon name="x" size={18} />
          </button>
        </div>
        <div className="task-modal-body">{children}</div>
      </div>
    </div>
    </ModalLayer>
  );
}

function toTimestamp(value?: string) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatDeliveryDate(value?: string) {
  if (!value) return "Chưa đặt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa đặt";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function toDateInputValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function formatStageDateRange(tasks: ProjectTaskSummary[]) {
  const dueTimes = tasks
    .map((task) => toTimestamp(task.dueAt))
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);

  if (dueTimes.length === 0) {
    return "Chưa có hạn stage";
  }

  const first = new Date(dueTimes[0]).toISOString();
  const last = new Date(dueTimes[dueTimes.length - 1]).toISOString();
  if (dueTimes[0] === dueTimes[dueTimes.length - 1]) {
    return `Hạn ${formatDeliveryDate(first)}`;
  }

  return `${formatDeliveryDate(first)} - ${formatDeliveryDate(last)}`;
}

function getStageTaskType(stageIndex: number) {
  return stageTaskTypes[stageIndex] ?? "implementation";
}

function getStageStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    not_started: "Chưa bắt đầu",
    in_progress: "Đang triển khai",
    blocked: "Đang bị chặn",
    completed: "Hoàn tất",
    cancelled: "Đã hủy"
  };
  return labels[status ?? ""] ?? "Chưa bắt đầu";
}

function normalizeDeliveryTaskStatus(status?: string) {
  return (status || "").trim().toLowerCase().replaceAll(/[\s/-]+/g, "_");
}

function isClosedDeliveryTaskStatus(status?: string) {
  return ["completed", "done", "cancelled", "canceled"].includes(normalizeDeliveryTaskStatus(status));
}

function getTaskBelongsToStage(task: ProjectTaskSummary, stage: DeliveryStageView, stageIndex: number) {
  if (task.stageId && stage.id && !stage.id.startsWith("template-")) {
    return task.stageId === stage.id;
  }
  return getDeploymentStageForTask(task).index === stageIndex;
}

function getProjectStageRows(stages: ProjectStageSummary[] | undefined): DeliveryStageView[] {
  return stages && stages.length > 0 ? stages : [];
}

function getDeliveryProjectRollup(
  project: DeliveryProjectGroup,
  tasks: ProjectTaskSummary[],
  stages: ProjectStageSummary[] | undefined
): DeliveryProjectRollup {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  const stageRows = getProjectStageRows(stages);
  const assignees = Array.from(
    new Set(projectTasks.map((task) => task.assigneeDisplayName || task.assigneeUserId || "Chưa giao").filter(Boolean))
  );
  const estimateMinutes = projectTasks.reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0);
  const loggedMinutes = projectTasks.reduce((sum, task) => sum + Number(task.loggedMinutes || 0), 0);
  const activeTasks = projectTasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length;
  const blockedStages = stageRows.filter((stage) => stage.status === "blocked").length;
  const completedStages = stageRows.filter((stage) => stage.status === "completed").length;
  const progressCandidates = stageRows.filter((stage) => Number(stage.progressPercent || 0) > 0 || stage.status !== "not_started");
  const stageIndexWithTasks = stageRows.reduce((latestIndex, stage, index) => {
    return projectTasks.some((task) => getTaskBelongsToStage(task, stage, index)) ? index : latestIndex;
  }, -1);
  const currentStage =
    [...progressCandidates].sort((a, b) => Number(b.sortOrder || 0) - Number(a.sortOrder || 0))[0] ??
    (stageIndexWithTasks >= 0 ? stageRows[stageIndexWithTasks] : undefined) ??
    stageRows[0];
  const storedProgress = Math.max(...stageRows.map((stage) => Number(stage.progressPercent || 0)), 0);
  const progressPercent =
    completedStages === stageRows.length && stageRows.length > 0
      ? 100
      : Math.max(0, Math.min(100, Math.round(storedProgress > 0 ? storedProgress : Number(currentStage?.cumulativePercent || 0))));

  return {
    activeTasks,
    assignees,
    blockedStages,
    completedStages,
    currentStage,
    dueLabel: formatStageDateRange(projectTasks),
    estimateMinutes,
    loggedMinutes,
    progressPercent,
    stageCount: stageRows.length,
    tasks: projectTasks
  };
}

function toStageEditDraft(stage: DeliveryStageView): StageEditDraft {
  return {
    status: stage.status || "not_started",
    ownerUserId: stage.ownerUserId || "",
    plannedStartAt: toDateInputValue(stage.plannedStartAt),
    plannedEndAt: toDateInputValue(stage.plannedEndAt),
    actualStartAt: toDateInputValue(stage.actualStartAt),
    actualEndAt: toDateInputValue(stage.actualEndAt),
    scopeSummary: stage.scopeSummary || "",
    standardMinutes: String(stage.standardMinutes ?? ""),
    acceptanceCriteria: stage.acceptanceCriteria || "",
    blockerSummary: stage.blockerSummary || "",
    progressPercent: String(stage.progressPercent ?? 0)
  };
}

function getStageCloseIssues(row: DeliveryStageRuntimeRow, draft?: StageEditDraft) {
  const nextStatus = draft?.status || row.stage.status || "not_started";
  const nextProgress = Number(draft?.progressPercent ?? row.stage.progressPercent ?? 0);
  const nextBlocker = draft ? draft.blockerSummary.trim() : row.stage.blockerSummary?.trim() || "";
  const isClosing = nextStatus === "completed" || (Number.isFinite(nextProgress) && nextProgress >= 100);

  if (!isClosing) {
    return [];
  }

  const openTasks = row.tasks.filter((task) => !isClosedDeliveryTaskStatus(task.status));
  return [
    nextBlocker ? "Còn blocker/rủi ro chưa xử lý." : undefined,
    openTasks.length > 0
      ? `Còn ${openTasks.length} task chưa hoàn tất${openTasks[0]?.title ? `: ${formatTaskTitle(openTasks[0].title)}` : ""}.`
      : undefined
  ].filter((issue): issue is string => Boolean(issue));
}

function parseStageNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateStageEditDraft(draft: StageEditDraft) {
  const progressPercent = parseStageNumber(draft.progressPercent);
  const standardMinutes = parseStageNumber(draft.standardMinutes);
  const issues = [
    progressPercent === undefined || progressPercent < 0 || progressPercent > 100
      ? "Tiến độ stage phải là số từ 0 đến 100."
      : undefined,
    standardMinutes !== undefined && standardMinutes < 0
      ? "Giờ chuẩn stage phải lớn hơn hoặc bằng 0."
      : undefined
  ];

  return {
    issues: issues.filter((issue): issue is string => Boolean(issue)),
    progressPercent,
    standardMinutes
  };
}

function buildDeliveryAccounts(
  accounts: DeliveryAccountOption[],
  projects: DeliveryProjectGroup[],
  tasks: ProjectTaskSummary[]
): DeliveryAccountOption[] {
  const accountMap = new Map<string, DeliveryAccountOption>();

  accounts.forEach((account) => {
    accountMap.set(account.id, { id: account.id, name: account.name });
  });
  projects.forEach((project) => {
    accountMap.set(project.accountId, { id: project.accountId, name: project.accountName });
  });
  tasks.forEach((task) => {
    accountMap.set(task.accountId, { id: task.accountId, name: task.accountName });
  });

  return Array.from(accountMap.values());
}

function buildDeliveryResourceOptions(resources: CapacitySummaryItem[], includeUnassigned = false): TaskSelectOption[] {
  const options = resources
    .filter((resource) => resource.userId && resource.userDisplayName)
    .map((resource) => ({
      value: resource.userId,
      label: resource.displayRole ? `${resource.userDisplayName} (${resource.displayRole})` : resource.userDisplayName,
      icon: "person"
    }));

  const deduped = Array.from(new Map(options.map((option) => [option.value, option])).values());
  const actualOptions = deduped;
  return includeUnassigned ? [fallbackDeliveryResourceOptions[0], ...actualOptions] : actualOptions;
}

function buildDeliveryProjects(projects: ProjectSummary[], tasks: ProjectTaskSummary[]): DeliveryProjectGroup[] {
  const projectMap = new Map<string, DeliveryProjectGroup>();

  projects.forEach((project) => {
    projectMap.set(project.id, project);
  });

  tasks.forEach((task) => {
    if (!task.projectId) {
      return;
    }

    if (!projectMap.has(task.projectId)) {
      projectMap.set(task.projectId, {
        id: task.projectId,
        accountId: task.accountId,
        accountName: task.accountName,
        code: task.projectId,
        hierarchyOrderVersion: 0,
        name: task.projectName || "Dự án chưa đặt tên",
        status: "active"
      });
    }
  });

  return Array.from(projectMap.values());
}

function DeliveryWorkbench({ config, projectId }: Readonly<{ config: BusinessFunctionConfig; projectId?: string }>) {
  const router = useRouter();
  const principal = "founder";
  const isDetailView = Boolean(projectId);
  const [deliveryTasks, setDeliveryTasks] = useState<ProjectTaskSummary[]>([]);
  const [deliveryProjects, setDeliveryProjects] = useState<DeliveryProjectGroup[]>([]);
  const [deliveryAccountOptions, setDeliveryAccountOptions] = useState<DeliveryAccountOption[]>([]);
  const [deliveryResources, setDeliveryResources] = useState<CapacitySummaryItem[]>([]);
  const [deliveryStagesByProjectId, setDeliveryStagesByProjectId] = useState<Record<string, ProjectStageSummary[]>>({});
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [deleteProjectRequest, setDeleteProjectRequest] = useState<DeliveryProjectGroup | null>(null);
  const [createDefaults, setCreateDefaults] = useState<CreateTaskModalDefaults | null>(null);
  const [editingStage, setEditingStage] = useState<DeliveryStageView | null>(null);
  const [stageDetail, setStageDetail] = useState<StageDetailState | null>(null);
  const [stageEditDraft, setStageEditDraft] = useState<StageEditDraft | null>(null);
  const [stageViewMode, setStageViewMode] = useState<DeliveryStageViewMode>("table");
  const [expandedStageIds, setExpandedStageIds] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadDeliveryState() {
      setIsLoading(true);
      const [overviewPayload, accountsPayload] = await Promise.all([
        loadRouteDataJson<DeliveryOverviewPayload>(`/api/delivery/overview?principal=${encodeURIComponent(principal)}`).catch(() => ({
          capacity: {
            data: [],
            meta: {
              generatedAt: new Date().toISOString(),
              periodEnd: new Date().toISOString(),
              periodStart: new Date().toISOString(),
              principal,
              rowScope: "empty_fallback",
              source: "api_unavailable" as const
            }
          },
          projects: { data: [] },
          stagesByProjectId: {},
          tasks: { data: [] }
        })),
        loadRouteDataJson<AccountsResponse>(`/api/accounts?principal=${encodeURIComponent(principal)}&limit=100`).catch(() => ({
          data: [],
          meta: {
            hiddenFields: [],
            principal,
            rowScope: "empty_fallback"
          }
        }))
      ]);

      if (ignore) {
        return;
      }

      const nextTasks = loadTaskDrafts(overviewPayload.tasks.data ?? []);
      const nextProjects = buildDeliveryProjects(overviewPayload.projects.data ?? [], nextTasks);
      setDeliveryTasks(nextTasks);
      setDeliveryProjects(nextProjects);
      setDeliveryAccountOptions((accountsPayload.data ?? []).map((account) => ({ id: account.id, name: account.name })));
      setDeliveryResources(overviewPayload.capacity.data ?? []);
      setDeliveryStagesByProjectId(overviewPayload.stagesByProjectId ?? {});
      setSelectedProjectId((current) => projectId || current || nextProjects[0]?.id || "");
      setIsLoading(false);
    }

    void loadDeliveryState();
    return () => {
      ignore = true;
    };
  }, [projectId]);

  const deliveryAccounts = useMemo(
    () => buildDeliveryAccounts(deliveryAccountOptions, deliveryProjects, deliveryTasks),
    [deliveryAccountOptions, deliveryProjects, deliveryTasks]
  );
  const taskAssigneeOptions = useMemo(
    () => buildDeliveryResourceOptions(deliveryResources),
    [deliveryResources]
  );
  const stageOwnerOptions = useMemo(
    () => buildDeliveryResourceOptions(deliveryResources, true),
    [deliveryResources]
  );
  const selectedProject =
    deliveryProjects.find((project) => project.id === (projectId || selectedProjectId)) ??
    (isDetailView ? undefined : deliveryProjects[0]);
  const editingProject = editingProjectId ? deliveryProjects.find((project) => project.id === editingProjectId) : undefined;
  const editingProjectFirstStage = editingProject ? getProjectStageRows(deliveryStagesByProjectId[editingProject.id] ?? [])[0] : undefined;
  const selectedProjectTasks = selectedProject
    ? deliveryTasks.filter((task) => task.projectId === selectedProject.id)
    : [];
  const selectedProjectStages = selectedProject ? deliveryStagesByProjectId[selectedProject.id] ?? [] : [];
  const deliveryStageRows = getProjectStageRows(selectedProjectStages);
  const selectedProjectEstimate = selectedProjectTasks.reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0);
  const selectedProjectLogged = selectedProjectTasks.reduce((sum, task) => sum + Number(task.loggedMinutes || 0), 0);
  const selectedProjectAssignees = Array.from(
    new Set(selectedProjectTasks.map((task) => task.assigneeDisplayName || task.assigneeUserId || "Chưa giao").filter(Boolean))
  );
  const selectedProjectOpportunity = selectedProject?.opportunityTitle || "Chưa gắn opportunity nguồn";
  const blockedStages = deliveryStageRows.filter((stage) => stage.status === "blocked").length;
  const activeStages = deliveryStageRows.filter((stage) => stage.status === "in_progress").length;
  const stagesWithTasks = deliveryStageRows.filter((stage, index) =>
    selectedProjectTasks.some((task) => getTaskBelongsToStage(task, stage, index))
  ).length;
  const deliveryStageRuntimeRows = useMemo<DeliveryStageRuntimeRow[]>(
    () =>
      deliveryStageRows.map((stage, stageIndex) => {
        const tasks = selectedProjectTasks.filter((task) => getTaskBelongsToStage(task, stage, stageIndex));
        const assignees = Array.from(
          new Set(tasks.map((task) => task.assigneeDisplayName || task.assigneeUserId || "Chưa giao").filter(Boolean))
        );
        const estimateMinutes = tasks.reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0);
        const loggedMinutes = tasks.reduce((sum, task) => sum + Number(task.loggedMinutes || 0), 0);

        return {
          assignees,
          dueLabel: formatStageDateRange(tasks),
          estimateMinutes,
          loggedMinutes,
          progressPercent: Math.max(0, Math.min(100, stage.progressPercent || 0)),
          stage,
          stageIndex,
          standardMinutes: typeof stage.standardMinutes === "number" ? stage.standardMinutes : estimateMinutes,
          statusLabel: getStageStatusLabel(stage.status),
          tasks
        };
      }),
    [deliveryStageRows, selectedProjectTasks]
  );
  const deliveryStageGroups = useMemo(
    () =>
      Array.from(new Set(deliveryStageRuntimeRows.map((row) => row.stage.phase))).map((phase) => ({
        phase,
        rows: deliveryStageRuntimeRows.filter((row) => row.stage.phase === phase)
      })),
    [deliveryStageRuntimeRows]
  );
  const deliveryStageKanbanColumns = useMemo(
    () =>
      [
        { key: "not_started", label: "Chưa bắt đầu" },
        { key: "in_progress", label: "Đang triển khai" },
        { key: "blocked", label: "Bị chặn" },
        { key: "completed", label: "Hoàn tất" }
      ].map((column) => ({
        ...column,
        rows: deliveryStageRuntimeRows.filter((row) => (row.stage.status || "not_started") === column.key)
      })),
    [deliveryStageRuntimeRows]
  );
  const projectRollups = useMemo(
    () =>
      deliveryProjects.map((project) => ({
        project,
        rollup: getDeliveryProjectRollup(project, deliveryTasks, deliveryStagesByProjectId[project.id])
      })),
    [deliveryProjects, deliveryStagesByProjectId, deliveryTasks]
  );
  const totalActiveProjects = projectRollups.filter(({ rollup }) => rollup.stageCount > 0 && rollup.completedStages < rollup.stageCount).length;
  const totalCompletedProjects = projectRollups.filter(({ rollup }) => rollup.stageCount > 0 && rollup.completedStages === rollup.stageCount).length;
  const totalBlockedProjects = projectRollups.filter(({ rollup }) => rollup.blockedStages > 0).length;
  const editingStageRuntime = editingStage
    ? deliveryStageRuntimeRows.find((row) => row.stage.id === editingStage.id)
    : undefined;
  const editingStageCloseIssues =
    editingStageRuntime && stageEditDraft ? getStageCloseIssues(editingStageRuntime, stageEditDraft) : [];
  const editingStageValidation = stageEditDraft
    ? validateStageEditDraft(stageEditDraft)
    : { issues: [], progressPercent: undefined, standardMinutes: undefined };

  useEffect(() => {
    setExpandedStageIds(new Set());
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!isDetailView || deliveryStageRuntimeRows.length === 0) {
      return;
    }

    setExpandedStageIds((current) => {
      if (current.size > 0) {
        return current;
      }

      const rowsWithTasks = deliveryStageRuntimeRows.filter((row) => row.tasks.length > 0).map((row) => row.stage.id);
      return rowsWithTasks.length > 0 ? new Set(rowsWithTasks) : current;
    });
  }, [deliveryStageRuntimeRows, isDetailView]);

  const toggleStageExpanded = (stageId: string) => {
    setExpandedStageIds((current) => {
      const next = new Set(current);
      if (next.has(stageId)) {
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  };

  const openProjectDetail = (id: string) => {
    router.push(`/delivery/${encodeURIComponent(id)}`);
  };

  async function createDeliveryProject(projectInput: DeliveryCreateProjectPayload) {
    const body: CreateProjectInput = {
      accountId: projectInput.accountId,
      code: projectInput.code,
      createStageTemplate: projectInput.createStageTemplate,
      name: projectInput.name,
      ownerUserId: projectInput.ownerUserId,
      plannedEndAt: projectInput.plannedEndAt,
      plannedStartAt: projectInput.plannedStartAt,
      scopeSummary: projectInput.scopeSummary,
      acceptanceCriteria: projectInput.acceptanceCriteria,
      status: projectInput.status,
      milestoneMode: projectInput.milestoneMode,
      milestoneTemplateKey: projectInput.milestoneTemplateKey,
      manualMilestones: projectInput.manualMilestones
    };

    try {
      const response = await fetch(`/api/projects?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const message = Array.isArray(errorPayload?.message)
          ? errorPayload.message.join(" ")
          : errorPayload?.message || "Chưa tạo được dự án. Kiểm tra session đăng nhập hoặc quyền tạo project.";
        throw new Error(message);
      }

      const createdProject = (await response.json()) as ProjectSummary;
      const stageResponse = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.id)}/stages?principal=${encodeURIComponent(principal)}`
      );
      const stagePayload = stageResponse.ok
        ? ((await stageResponse.json()) as ResourceListResponse<ProjectStageSummary>)
        : { data: [] };

      setDeliveryProjects((current) => buildDeliveryProjects([...current, createdProject], deliveryTasks));
      setDeliveryAccountOptions((current) =>
        current.some((account) => account.id === createdProject.accountId)
          ? current
          : [...current, { id: createdProject.accountId, name: createdProject.accountName }]
      );
      setDeliveryStagesByProjectId((current) => ({
        ...current,
        [createdProject.id]: stagePayload.data ?? []
      }));
      setSelectedProjectId(createdProject.id);
      setShowCreateProject(false);
      setNotice(`Đã tạo dự án "${createdProject.name}" với stage template triển khai.`);
      router.push(`/delivery/${encodeURIComponent(createdProject.id)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Chưa tạo được dự án triển khai.");
    }
  }

  async function updateDeliveryProject(projectId: string, projectInput: DeliveryUpdateProjectPayload) {
    const body: UpdateProjectInput = {
      accountId: projectInput.accountId,
      code: projectInput.code,
      name: projectInput.name,
      ownerUserId: projectInput.ownerUserId,
      plannedEndAt: projectInput.plannedEndAt,
      plannedStartAt: projectInput.plannedStartAt,
      scopeSummary: projectInput.scopeSummary,
      acceptanceCriteria: projectInput.acceptanceCriteria,
      status: projectInput.status
    };

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}?principal=${encodeURIComponent(principal)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const message = Array.isArray(errorPayload?.message)
          ? errorPayload.message.join(" ")
          : errorPayload?.message || "Chưa cập nhật được dự án.";
        throw new Error(message);
      }

      const updatedProject = (await response.json()) as ProjectSummary;
      const stageResponse = await fetch(
        `/api/projects/${encodeURIComponent(updatedProject.id)}/stages?principal=${encodeURIComponent(principal)}`
      );
      const stagePayload = stageResponse.ok
        ? ((await stageResponse.json()) as ResourceListResponse<ProjectStageSummary>)
        : { data: [] };

      setDeliveryProjects((current) =>
        buildDeliveryProjects(
          current.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
          deliveryTasks
        )
      );
      setDeliveryStagesByProjectId((current) => ({
        ...current,
        [updatedProject.id]: stagePayload.data ?? current[updatedProject.id] ?? []
      }));
      setEditingProjectId(null);
      setNotice(`Đã cập nhật dự án "${updatedProject.name}".`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Chưa cập nhật được dự án triển khai.");
    }
  }

  async function deleteDeliveryProject(project: DeliveryProjectGroup) {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}?principal=${encodeURIComponent(principal)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const message = Array.isArray(errorPayload?.message)
          ? errorPayload.message.join(" ")
          : errorPayload?.message || "Chưa xóa được dự án.";
        throw new Error(message);
      }

      const remainingTasks = deliveryTasks.filter((task) => task.projectId !== project.id);
      setDeliveryTasks(remainingTasks);
      setDeliveryProjects((current) => buildDeliveryProjects(current.filter((item) => item.id !== project.id), remainingTasks));
      setDeliveryStagesByProjectId((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      if (selectedProjectId === project.id) {
        setSelectedProjectId("");
      }
      setNotice(`Đã xóa dự án "${project.name}" khỏi danh sách triển khai.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Chưa xóa được dự án triển khai.");
    }
  }

  const openCreateForStage = (stageIndex: number) => {
    if (!selectedProject) {
      setNotice("Chọn một dự án trước khi tạo task theo stage.");
      return;
    }

    const stage = deliveryStageRows[stageIndex];
    if (!stage) {
      setNotice("Dự án này chưa có stage backend. Hãy tạo stage template thật trước khi tạo task.");
      return;
    }

    setCreateDefaults({
      accountId: selectedProject.accountId,
      projectId: selectedProject.id,
      stageId: stage.id,
      taskType: getStageTaskType(stageIndex),
      title: `${stage.activity} - công việc mới`,
      description: `Task thuộc stage ${stage.activity} của dự án ${selectedProject.name}.`
    });
  };

  const openEditStage = (stage: DeliveryStageView) => {
    if (stage.id.startsWith("template-")) {
      setNotice("Stage này đang là template fallback, chưa có bản ghi backend để chỉnh sửa.");
      return;
    }

    setEditingStage(stage);
    setStageEditDraft(toStageEditDraft(stage));
  };

  async function updateDeliveryStage(stage: DeliveryStageView, input: UpdateProjectStageInput) {
    if (!selectedProject || stage.id.startsWith("template-")) {
      setNotice("Stage này đang là template fallback, chưa có bản ghi backend để cập nhật.");
      return false;
    }

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.id)}/stages/${encodeURIComponent(stage.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input)
        }
      );

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const message = Array.isArray(errorPayload?.message)
          ? errorPayload?.message.join(" ")
          : errorPayload?.message || "Chưa cập nhật được stage. Kiểm tra session đăng nhập hoặc API backend.";
        throw new Error(message);
      }

      const updated = (await response.json()) as ProjectStageSummary;
      setDeliveryStagesByProjectId((current) => ({
        ...current,
        [selectedProject.id]: (current[selectedProject.id] ?? []).map((item) => (item.id === updated.id ? updated : item))
      }));
      setNotice(`Đã cập nhật stage ${updated.activity}.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Chưa cập nhật được stage. Kiểm tra session đăng nhập hoặc API backend.");
      return false;
    }
  }

  async function submitStageEdit() {
    if (!editingStage || !stageEditDraft) {
      return;
    }
    if (editingStageValidation.issues.length > 0) {
      setNotice(`Chưa thể lưu stage: ${editingStageValidation.issues.join(" ")}`);
      return;
    }
    if (editingStageRuntime && editingStageCloseIssues.length > 0) {
      setNotice(`Chưa thể hoàn tất stage: ${editingStageCloseIssues.join(" ")}`);
      return;
    }

    const saved = await updateDeliveryStage(editingStage, {
      status: stageEditDraft.status,
      ownerUserId: stageEditDraft.ownerUserId === "none" ? null : stageEditDraft.ownerUserId || undefined,
      plannedStartAt: stageEditDraft.plannedStartAt || undefined,
      plannedEndAt: stageEditDraft.plannedEndAt || undefined,
      actualStartAt: stageEditDraft.actualStartAt || undefined,
      actualEndAt: stageEditDraft.actualEndAt || undefined,
      scopeSummary: stageEditDraft.scopeSummary,
      standardMinutes: editingStageValidation.standardMinutes,
      acceptanceCriteria: stageEditDraft.acceptanceCriteria,
      blockerSummary: stageEditDraft.blockerSummary,
      progressPercent: editingStageValidation.progressPercent ?? 0
    });
    if (saved) {
      setEditingStage(null);
      setStageEditDraft(null);
    }
  }

  const syncDeliveryTasks = (nextTasks: ProjectTaskSummary[]) => {
    setDeliveryTasks(nextTasks);
    persistTaskDrafts(nextTasks);
  };

  async function createDeliveryTask(taskInput: any) {
    const body: CreateProjectTaskInput = {
      accountId: taskInput.accountId,
      projectId: taskInput.projectId,
      stageId: taskInput.stageId,
      title: taskInput.title,
      description: taskInput.description,
      taskType: taskInput.taskType,
      status: "todo",
      priority: taskInput.priority,
      assigneeUserId: taskInput.assigneeUserId,
      plannedStartAt: taskInput.plannedStartAt,
      dueAt: taskInput.dueAt,
      estimateMinutes: taskInput.estimateMinutes,
      customerVisible: taskInput.customerVisible
    };

    try {
      const response = await fetch(`/api/tasks?principal=${encodeURIComponent(principal)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error("create_task_failed");
      }

      const result = await response.json();
      const taskId = result.id || `task-${Date.now()}`;
      const createdTask: ProjectTaskSummary = {
        id: taskId,
        accountId: taskInput.accountId,
        accountName: taskInput.accountName,
        projectId: taskInput.projectId,
        projectName: taskInput.projectName,
        stageId: taskInput.stageId,
        sortOrder: 10,
        stageKey: deliveryStageRows.find((stage) => stage.id === taskInput.stageId)?.stageKey,
        stageActivity: deliveryStageRows.find((stage) => stage.id === taskInput.stageId)?.activity,
        title: taskInput.title,
        description: taskInput.description,
        taskType: taskInput.taskType,
        status: "todo",
        priority: taskInput.priority,
        ownerUserId: "founder",
        ownerDisplayName: "Kha Nguyen",
        assigneeUserId: taskInput.assigneeUserId,
        assigneeDisplayName: taskInput.assigneeDisplayName,
        plannedStartAt: taskInput.plannedStartAt,
        dueAt: taskInput.dueAt,
        estimateMinutes: taskInput.estimateMinutes,
        loggedMinutes: 0,
        approvedMinutes: 0,
        overdue: false,
        customerVisible: taskInput.customerVisible,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        statusHistory: [],
        timeEntries: []
      };

      syncDeliveryTasks([...deliveryTasks, createdTask]);
      setCreateDefaults(null);
      setNotice(`Đã tạo task "${formatTaskTitle(taskInput.title)}" trong dự án ${taskInput.projectName}.`);
    } catch {
      if (!taskDraftsEnabled()) {
        setNotice(productionWriteFailureMessage());
        return;
      }

      const fallbackTask: ProjectTaskSummary = {
        id: `task-${Date.now()}`,
        accountId: taskInput.accountId,
        accountName: taskInput.accountName,
        projectId: taskInput.projectId,
        projectName: taskInput.projectName,
        stageId: taskInput.stageId,
        sortOrder: 10,
        stageKey: deliveryStageRows.find((stage) => stage.id === taskInput.stageId)?.stageKey,
        stageActivity: deliveryStageRows.find((stage) => stage.id === taskInput.stageId)?.activity,
        title: taskInput.title,
        description: taskInput.description,
        taskType: taskInput.taskType,
        status: "todo",
        priority: taskInput.priority,
        ownerUserId: "founder",
        ownerDisplayName: "Kha Nguyen",
        assigneeUserId: taskInput.assigneeUserId,
        assigneeDisplayName: taskInput.assigneeDisplayName,
        plannedStartAt: taskInput.plannedStartAt,
        dueAt: taskInput.dueAt,
        estimateMinutes: taskInput.estimateMinutes,
        loggedMinutes: 0,
        approvedMinutes: 0,
        overdue: false,
        customerVisible: taskInput.customerVisible,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        statusHistory: [],
        timeEntries: []
      };

      syncDeliveryTasks([...deliveryTasks, fallbackTask]);
      setCreateDefaults(null);
      setNotice(`Đã lưu task "${formatTaskTitle(taskInput.title)}" ở chế độ offline.`);
    }
  }

  return (
    <ShopifyAppShell active={config.active} principal="founder">
      <ShopifyPage heading={config.title}>
        <div className="business-workbench">
          {isDetailView ? (
            <a className="delivery-back-link" href="/delivery">
              <ShopifyIcon name="arrow-left" size={15} />
              Quay lại danh sách dự án
            </a>
          ) : null}

          <section className="delivery-compact-hero" aria-labelledby="delivery-overview">
            <div>
              <span className="business-icon-badge">
                <ShopifyIcon name={config.icon} size={18} />
              </span>
              <p className="business-kicker">{config.operatingFunction}</p>
              <h2 id="delivery-overview">Dự án triển khai</h2>
              {!isDetailView ? <p>Danh sách project đã bàn giao từ BD, đang triển khai hoặc đã hoàn tất.</p> : null}
            </div>
            {notice || !isDetailView ? (
              <div className="delivery-hero-actions">
                <span>{notice || "Click một project để xem stage và task theo từng stage."}</span>
                {!isDetailView ? (
                  <button
                    className="sales-hero-action"
                    disabled={deliveryAccounts.length === 0}
                    onClick={() => setShowCreateProject(true)}
                    type="button"
                  >
                    <ShopifyIcon name="plus" size={15} />
                    Tạo dự án
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {!isDetailView ? (
            <>
              <div className="delivery-project-summary-grid">
                <article>
                  <span>Tổng project</span>
                  <strong>{deliveryProjects.length}</strong>
                  <p>Đang hiển thị trong danh sách triển khai</p>
                </article>
                <article>
                  <span>Đang triển khai</span>
                  <strong>{totalActiveProjects}</strong>
                  <p>Project còn stage chưa hoàn tất</p>
                </article>
                <article>
                  <span>Có blocker</span>
                  <strong>{totalBlockedProjects}</strong>
                  <p>Cần ưu tiên tháo chặn</p>
                </article>
                <article>
                  <span>Hoàn tất</span>
                  <strong>{totalCompletedProjects}</strong>
                  <p>Toàn bộ stage đã đóng</p>
                </article>
              </div>

              <section className="tasks-list-card delivery-project-table-card" aria-labelledby="delivery-project-list-heading">
                <div className="tasks-section-head">
                  <span className="tasks-section-title" id="delivery-project-list-heading">
                    <ShopifyIcon name="briefcase" size={15} />
                    Danh sách dự án triển khai
                  </span>
                  <span className="tasks-section-count">{deliveryProjects.length} dự án</span>
                </div>

                {deliveryProjects.length ? (
                  <ShopifyDataTable
                    ariaLabel="Danh sách dự án triển khai"
                    columns={[
                      {
                        key: "project",
                        width: "23%",
                        mobileLabel: "Dự án",
                        mobilePriority: "title",
                        header: (
                          <span className="tasks-table-heading">
                            <ShopifyIcon name="briefcase" size={14} />
                            Dự án
                          </span>
                        )
                      },
                      {
                        key: "source",
                        width: "20%",
                        mobileLabel: "Opportunity nguồn",
                        header: (
                          <span className="tasks-table-heading">
                            <ShopifyIcon name="trend" size={14} />
                            Opportunity nguồn
                          </span>
                        )
                      },
                      {
                        key: "status",
                        width: "16%",
                        mobileLabel: "Trạng thái",
                        header: (
                          <span className="tasks-table-heading">
                            <ShopifyIcon name="info" size={14} />
                            Trạng thái
                          </span>
                        )
                      },
                      {
                        key: "stage",
                        width: "17%",
                        mobileLabel: "Stage hiện tại",
                        header: (
                          <span className="tasks-table-heading">
                            <ShopifyIcon name="target" size={14} />
                            Stage hiện tại
                          </span>
                        )
                      },
                      {
                        key: "owner",
                        width: "13%",
                        mobileLabel: "PIC",
                        header: (
                          <span className="tasks-table-heading">
                            <ShopifyIcon name="users" size={14} />
                            PIC
                          </span>
                        )
                      },
                      {
                        key: "time",
                        width: "10%",
                        mobileLabel: "Task / thời gian",
                        header: (
                          <span className="tasks-table-heading">
                            <ShopifyIcon name="clock" size={14} />
                            Task
                          </span>
                        )
                      },
                      {
                        key: "actions",
                        width: "10%",
                        mobileLabel: "Hành động",
                        header: (
                          <span className="tasks-table-heading">
                            Hành động
                          </span>
                        )
                      }
                    ]}
                    minWidth={1180}
                    rows={projectRollups.map(({ project, rollup }) => {
                      const statusTone = rollup.blockedStages > 0 ? "danger" : rollup.completedStages === rollup.stageCount ? "success" : "info";
                      const statusLabel =
                        rollup.blockedStages > 0
                          ? "Có blocker"
                          : rollup.completedStages === rollup.stageCount
                            ? "Hoàn tất"
                            : "Đang triển khai";

                      return {
                        key: project.id,
                        onClick: () => openProjectDetail(project.id),
                        mobileTitle: project.name,
                        mobileSubtitle: `${project.accountName} · ${project.opportunityTitle || "Chưa gắn opportunity nguồn"}`,
                        mobileMeta: (
                          <span className={`tasks-chip tone-${statusTone}`}>
                            {statusLabel}
                          </span>
                        ),
                        cells: [
                          (
                            <div className="tasks-relation-cell">
                              <span className="tasks-relation-title">{project.name}</span>
                              <span className="tasks-relation-meta">{project.accountName}</span>
                            </div>
                          ),
                          (
                            <div className="tasks-relation-cell">
                              <span className="tasks-relation-title">{project.opportunityTitle || "Chưa gắn"}</span>
                              <span className="tasks-relation-meta">{project.opportunityStage ? `Stage BD: ${project.opportunityStage}` : "Nguồn BD"}</span>
                            </div>
                          ),
                          (
                            <div className="delivery-project-progress-cell">
                              <span className={`tasks-chip tone-${statusTone}`}>{statusLabel}</span>
                              <span className="tasks-time-track" aria-hidden="true">
                                <span style={{ width: `${rollup.progressPercent}%` }} />
                              </span>
                              <small>{rollup.progressPercent}% · {rollup.completedStages}/{rollup.stageCount} stage</small>
                            </div>
                          ),
                          (
                            <div className="tasks-relation-cell">
                              <span className="tasks-relation-title">{rollup.currentStage?.activity || "Chưa có stage"}</span>
                              <span className="tasks-relation-meta">{rollup.dueLabel}</span>
                            </div>
                          ),
                          (
                            <div className="tasks-relation-cell">
                              <span className="tasks-relation-title">{rollup.currentStage?.ownerDisplayName || rollup.assignees[0] || "Chưa giao"}</span>
                              <span className="tasks-relation-meta">{rollup.assignees.length ? `${rollup.assignees.length} người có task` : "Chưa có task"}</span>
                            </div>
                          ),
                          (
                            <div className="tasks-time-cell">
                              <span>{rollup.tasks.length} task</span>
                              <span>{formatTaskMinutes(rollup.loggedMinutes)} / {formatTaskMinutes(rollup.estimateMinutes)}</span>
                            </div>
                          ),
                          (
                            <div className="delivery-project-row-actions">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingProjectId(project.id);
                                }}
                                type="button"
                              >
                                Sửa
                              </button>
                              <button
                                data-tone="danger"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteProjectRequest(project);
                                }}
                                type="button"
                              >
                                Xóa
                              </button>
                            </div>
                          )
                        ]
                      };
                    })}
                  />
                ) : (
                  <p className="proposal-empty-state">
                    {isLoading ? "Đang tải danh sách dự án triển khai..." : "Chưa có dự án triển khai."}
                  </p>
                )}
              </section>
            </>
          ) : null}

          {isDetailView ? <section className="premium-card delivery-project-board" aria-labelledby="delivery-project-board-heading">
            <div className="delivery-project-board-head">
              <div>
                <h3 id="delivery-project-board-heading">{selectedProject?.name || "Chi tiết dự án triển khai"}</h3>
              </div>
              <div className="delivery-stage-mode-panel">
                <span>{activeStages} stage đang chạy · {blockedStages} blocker</span>
                <div className="delivery-stage-view-toggle" aria-label="Chọn kiểu xem stage">
                  {[
                    { value: "table", label: "Bảng", icon: "list" },
                    { value: "group", label: "Nhóm", icon: "briefcase" },
                    { value: "kanban", label: "Kanban", icon: "target" }
                  ].map((item) => (
                    <button
                      aria-pressed={stageViewMode === item.value}
                      data-active={stageViewMode === item.value}
                      key={item.value}
                      onClick={() => setStageViewMode(item.value as DeliveryStageViewMode)}
                      type="button"
                    >
                      <ShopifyIcon name={item.icon as ShopifyIconName} size={13} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {selectedProject ? (
              <>
                <div className="delivery-project-summary-grid">
                  <article>
                    <span>Opportunity nguồn</span>
                    <strong>{selectedProjectOpportunity}</strong>
                    <p>{selectedProject?.opportunityStage ? `Stage BD: ${selectedProject.opportunityStage}` : "Trace về deal BD ban đầu"}</p>
                  </article>
                  <article>
                    <span>Tổng task</span>
                    <strong>{selectedProjectTasks.length}</strong>
                    <p>{stagesWithTasks}/{deliveryStageRows.length} stage đang có task</p>
                  </article>
                  <article>
                    <span>Thời gian</span>
                    <strong>{formatTaskMinutes(selectedProjectLogged)} / {formatTaskMinutes(selectedProjectEstimate)}</strong>
                    <p>{formatStageDateRange(selectedProjectTasks)}</p>
                  </article>
                  <article>
                    <span>Người đang nhận việc</span>
                    <strong>{selectedProjectAssignees.length || 0}</strong>
                    <p>{selectedProjectAssignees.slice(0, 4).join(", ") || "Chưa giao task"}</p>
                  </article>
                </div>

                {stageViewMode === "table" ? (
                  <div className="delivery-stage-list delivery-stage-view-panel" aria-label="Stage của dự án đang chọn" key="stage-table-view">
                    <div className="delivery-stage-list-head" aria-hidden="true">
                      <span>Stage</span>
                      <span>Tiến độ</span>
                      <span>PIC</span>
                      <span>Timeline</span>
                      <span>Task</span>
                      <span />
                    </div>
                    {deliveryStageRuntimeRows.length > 0 ? deliveryStageRuntimeRows.map((row) => {
                      const isExpanded = expandedStageIds.has(row.stage.id);

                      return (
                        <Fragment key={row.stage.id}>
                          <article className="delivery-stage-row" data-status={row.stage.status || "not_started"}>
                            <div className="delivery-stage-row-title">
                              <span>{row.stage.phase}</span>
                              <strong>{row.stage.activity}</strong>
                            </div>
                            <div className="delivery-stage-row-progress">
                              <span>{row.statusLabel}</span>
                              <div className="delivery-stage-progress" aria-label={`Tiến độ stage ${row.stage.activity}: ${row.progressPercent}%`}>
                                <span style={{ width: `${row.progressPercent}%` }} />
                              </div>
                              <small>{row.progressPercent}%</small>
                            </div>
                            <div className="delivery-stage-row-meta">
                              <span>{row.stage.ownerDisplayName || row.assignees[0] || "Chưa giao"}</span>
                              <small>{row.assignees.length ? `${row.assignees.length} người có task` : "Chưa có task"}</small>
                            </div>
                            <div className="delivery-stage-row-meta">
                              <span>{formatDeliveryDate(row.stage.plannedEndAt)}</span>
                              <small>{row.dueLabel}</small>
                            </div>
                            <div className="delivery-stage-row-meta">
                              <span>{row.tasks.length} task</span>
                              <small>{formatTaskMinutes(row.loggedMinutes)} / {formatTaskMinutes(row.standardMinutes)}</small>
                            </div>
                            <div className="delivery-stage-row-actions">
                              <button aria-expanded={isExpanded} type="button" onClick={() => toggleStageExpanded(row.stage.id)}>
                                {isExpanded ? "Thu gọn" : "Mở rộng"}
                              </button>
                              <button type="button" onClick={() => openEditStage(row.stage)}>
                                Chỉnh sửa
                              </button>
                              <button type="button" onClick={() => openCreateForStage(row.stageIndex)}>
                                <ShopifyIcon name="plus" size={13} />
                                Task
                              </button>
                            </div>
                          </article>
                          {isExpanded ? (
                            <div className="delivery-stage-task-panel" data-empty={row.tasks.length === 0}>
                              <div className="delivery-stage-task-panel-head">
                                <strong>Task trong {row.stage.activity}</strong>
                                <span>{formatTaskMinutes(row.loggedMinutes)} / {formatTaskMinutes(row.standardMinutes)}</span>
                              </div>
                              {row.tasks.length > 0 ? (
                                row.tasks.map((task) => (
                                  <a href={`/tasks/${task.id}`} className="delivery-stage-task-line" key={task.id}>
                                    <span>{formatTaskTitle(task.title)}</span>
                                    <small>{statusLabels[task.status] || task.status}</small>
                                    <small>{task.assigneeDisplayName || "Chưa giao"}</small>
                                    <small>{formatDeliveryDate(task.dueAt)}</small>
                                    <small>{formatTaskMinutes(Number(task.loggedMinutes || 0))} / {formatTaskMinutes(Number(task.estimateMinutes || 0))}</small>
                                  </a>
                                ))
                              ) : (
                                <p>Chưa có task trong stage này.</p>
                              )}
                            </div>
                          ) : null}
                        </Fragment>
                      );
                    }) : (
                      <p className="proposal-empty-state">
                        Chưa có stage triển khai thật cho dự án này.
                      </p>
                    )}
                  </div>
                ) : null}

                {stageViewMode === "group" ? (
                  <div className="delivery-stage-group-view delivery-stage-view-panel" aria-label="Stage được gom theo milestone" key="stage-group-view">
                    {deliveryStageGroups.length > 0 ? deliveryStageGroups.map((group) => (
                      <section className="delivery-stage-group" key={group.phase}>
                        <div className="delivery-stage-group-head">
                          <div>
                            <span>Milestone</span>
                            <strong>{group.phase}</strong>
                          </div>
                          <small>{group.rows.length} stage</small>
                        </div>
                        <div className="delivery-stage-group-rows">
                          {group.rows.map((row) => (
                            <article className="delivery-stage-group-row" data-status={row.stage.status || "not_started"} key={row.stage.id}>
                              <div>
                                <span>{row.statusLabel}</span>
                                <strong>{row.stage.activity}</strong>
                              </div>
                              <div className="delivery-stage-progress" aria-label={`Tiến độ stage ${row.stage.activity}: ${row.progressPercent}%`}>
                                <span style={{ width: `${row.progressPercent}%` }} />
                              </div>
                              <div className="delivery-stage-group-meta">
                                <span>{row.stage.ownerDisplayName || row.assignees[0] || "Chưa giao PIC"}</span>
                                <span>{formatDeliveryDate(row.stage.plannedEndAt)}</span>
                                <span>{row.tasks.length} task</span>
                              </div>
                              <div className="delivery-stage-row-actions">
                                <button type="button" onClick={() => openEditStage(row.stage)}>
                                  Chỉnh sửa
                                </button>
                                <button type="button" onClick={() => openCreateForStage(row.stageIndex)}>
                                  <ShopifyIcon name="plus" size={13} />
                                  Task
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )) : (
                      <p className="proposal-empty-state">
                        Chưa có stage triển khai thật cho dự án này.
                      </p>
                    )}
                  </div>
                ) : null}

                {stageViewMode === "kanban" ? (
                  <div className="delivery-stage-kanban delivery-stage-view-panel" aria-label="Kanban stage theo trạng thái" key="stage-kanban-view">
                    {deliveryStageRuntimeRows.length > 0 ? deliveryStageKanbanColumns.map((column) => (
                      <section className="delivery-stage-kanban-column" key={column.key}>
                        <div className="delivery-stage-kanban-head">
                          <strong>{column.label}</strong>
                          <span>{column.rows.length}</span>
                        </div>
                        <div className="delivery-stage-kanban-cards">
                          {column.rows.length ? (
                            column.rows.map((row) => (
                              <article className="delivery-stage-kanban-card" data-status={row.stage.status || "not_started"} key={row.stage.id}>
                                <span>{row.stage.phase}</span>
                                <strong>{row.stage.activity}</strong>
                                <div className="delivery-stage-progress" aria-label={`Tiến độ stage ${row.stage.activity}: ${row.progressPercent}%`}>
                                  <span style={{ width: `${row.progressPercent}%` }} />
                                </div>
                                <small>{row.stage.ownerDisplayName || row.assignees[0] || "Chưa giao PIC"}</small>
                                <small>{formatDeliveryDate(row.stage.plannedEndAt)} · {row.tasks.length} task</small>
                                <div className="delivery-stage-row-actions">
                                  <button type="button" onClick={() => openEditStage(row.stage)}>
                                    Chỉnh sửa
                                  </button>
                                  <button type="button" onClick={() => openCreateForStage(row.stageIndex)}>
                                    <ShopifyIcon name="plus" size={13} />
                                    Task
                                  </button>
                                </div>
                              </article>
                            ))
                          ) : (
                            <p>Không có stage.</p>
                          )}
                        </div>
                      </section>
                    )) : (
                      <p className="proposal-empty-state">
                        Chưa có stage triển khai thật cho dự án này.
                      </p>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="proposal-empty-state">
                {isLoading ? "Đang tải project và task triển khai..." : "Không tìm thấy dự án triển khai này."}
              </p>
            )}
          </section> : null}

          {createDefaults ? (
            <Suspense fallback={null}>
              <LazyCreateTaskModal
                isOpen={Boolean(createDefaults)}
                onClose={() => setCreateDefaults(null)}
                onSave={createDeliveryTask}
                accounts={deliveryAccounts}
                projects={deliveryProjects}
                stages={deliveryStageRows.map((stage) => ({
                  activity: stage.activity,
                  cumulativePercent: stage.cumulativePercent,
                  id: stage.id,
                  phase: stage.phase,
                  projectId: selectedProject?.id
                }))}
                defaults={createDefaults}
                assigneeOptions={taskAssigneeOptions}
              />
            </Suspense>
          ) : null}
          {showCreateProject ? (
            <Suspense fallback={null}>
              <LazyCreateProjectModal
                accounts={deliveryAccounts}
                isOpen={showCreateProject}
                onClose={() => setShowCreateProject(false)}
                onSave={(payload) => createDeliveryProject(payload as DeliveryCreateProjectPayload)}
                resourceOptions={taskAssigneeOptions}
              />
            </Suspense>
          ) : null}
          {editingProject ? (
            <Suspense fallback={null}>
              <LazyCreateProjectModal
                accounts={deliveryAccounts}
                initialProject={editingProject}
                initialStage={editingProjectFirstStage}
                isOpen={Boolean(editingProject)}
                mode="edit"
                onClose={() => setEditingProjectId(null)}
                onSave={(payload) => updateDeliveryProject(editingProject.id, payload as DeliveryUpdateProjectPayload)}
                resourceOptions={stageOwnerOptions}
              />
            </Suspense>
          ) : null}
          {deleteProjectRequest ? (
            <ConfirmActionDialog
              confirmLabel="Xóa dự án"
              onCancel={() => setDeleteProjectRequest(null)}
              onConfirm={async () => {
                const project = deleteProjectRequest;
                setDeleteProjectRequest(null);
                await deleteDeliveryProject(project);
              }}
              title="Xóa dự án triển khai?"
              tone="danger"
            >
              Dự án "{deleteProjectRequest.name}" sẽ bị xóa khỏi danh sách triển khai cùng các công việc đang liên kết trên màn hình này.
            </ConfirmActionDialog>
          ) : null}
          {stageDetail && (
            <DeliveryModal onClose={() => setStageDetail(null)} title={`Chi tiết stage ${stageDetail.stage.activity}`}>
              {(() => {
                const stageTasks = selectedProjectTasks.filter((task) =>
                  getTaskBelongsToStage(task, stageDetail.stage, stageDetail.stageIndex)
                );
                const stageEstimate = stageTasks.reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0);
                const stageLogged = stageTasks.reduce((sum, task) => sum + Number(task.loggedMinutes || 0), 0);
                const stageProgress = Math.max(0, Math.min(100, stageDetail.stage.progressPercent || 0));
                const runtimeRow = deliveryStageRuntimeRows.find((row) => row.stage.id === stageDetail.stage.id);
                const closeIssues = runtimeRow
                  ? getStageCloseIssues(runtimeRow, {
                      ...toStageEditDraft(stageDetail.stage),
                      blockerSummary: stageDetail.stage.blockerSummary || "",
                      progressPercent: "100",
                      status: "completed"
                    })
                  : [];

                return (
                  <div className="delivery-stage-modal">
                    <div className="delivery-stage-modal-summary">
                      <article>
                        <span>Trạng thái</span>
                        <strong>{getStageStatusLabel(stageDetail.stage.status)}</strong>
                      </article>
                      <article>
                        <span>Owner</span>
                        <strong>{stageDetail.stage.ownerDisplayName || "Chưa giao"}</strong>
                      </article>
                      <article>
                        <span>Timeline</span>
                        <strong>{formatDeliveryDate(stageDetail.stage.plannedEndAt)}</strong>
                      </article>
                      <article>
                        <span>Task</span>
                        <strong>{stageTasks.length}</strong>
                      </article>
                    </div>

                    <div className="delivery-stage-progress" aria-label={`Tiến độ stage ${stageDetail.stage.activity}: ${stageProgress}%`}>
                      <span style={{ width: `${stageProgress}%` }} />
                    </div>

                    <div className="delivery-stage-modal-grid">
                      <div>
                        <span>Tiêu chí nghiệm thu</span>
                        <p>{stageDetail.stage.acceptanceCriteria || "Chưa ghi tiêu chí nghiệm thu."}</p>
                      </div>
                      <div>
                        <span>Blocker / rủi ro</span>
                        <p>{stageDetail.stage.blockerSummary || "Chưa ghi blocker."}</p>
                      </div>
                    </div>

                    <div className="delivery-stage-modal-tasks">
                      <div className="delivery-stage-modal-title">
                        <strong>Task trong stage</strong>
                        <span>{formatTaskMinutes(stageLogged)} / {formatTaskMinutes(stageEstimate)}</span>
                      </div>
                      {stageTasks.length > 0 ? (
                        stageTasks.map((task) => (
                          <a href={`/tasks/${task.id}`} className="delivery-stage-task-row" key={task.id}>
                            <span>{formatTaskTitle(task.title)}</span>
                            <small>
                              {statusLabels[task.status] || task.status} · {task.assigneeDisplayName || "Chưa giao"} · {formatDeliveryDate(task.dueAt)}
                            </small>
                          </a>
                        ))
                      ) : (
                        <p>Chưa có task trong stage này.</p>
                      )}
                    </div>

                    <div className="delivery-stage-modal-actions">
                      <button
                        className="task-secondary-btn"
                        onClick={() => {
                          setStageDetail(null);
                          openEditStage(stageDetail.stage);
                        }}
                        type="button"
                      >
                        Chỉnh stage
                      </button>
                      <button
                        className="task-secondary-btn"
                        onClick={() => {
                          setStageDetail(null);
                          openCreateForStage(stageDetail.stageIndex);
                        }}
                        type="button"
                      >
                        Tạo task
                      </button>
                      <button
                        className="task-primary-btn"
                        onClick={() => {
                          void updateDeliveryStage(stageDetail.stage, {
                            status: "in_progress",
                            actualStartAt: stageDetail.stage.actualStartAt ?? new Date().toISOString(),
                            progressPercent: Math.max(stageProgress, stageDetail.stage.cumulativePercent > 0 ? Math.min(stageDetail.stage.cumulativePercent, 95) : 10)
                          });
                          setStageDetail(null);
                        }}
                        type="button"
                      >
                        Bắt đầu
                      </button>
                      <button
                        className="task-primary-btn"
                        disabled={closeIssues.length > 0}
                        onClick={() => {
                          if (closeIssues.length > 0) {
                            setNotice(`Chưa thể hoàn tất stage: ${closeIssues.join(" ")}`);
                            return;
                          }
                          void updateDeliveryStage(stageDetail.stage, {
                            status: "completed",
                            actualEndAt: new Date().toISOString(),
                            progressPercent: 100
                          });
                          setStageDetail(null);
                        }}
                        type="button"
                      >
                        Hoàn tất
                      </button>
                    </div>
                  </div>
                );
              })()}
            </DeliveryModal>
          )}
          {editingStage && stageEditDraft ? (
            <Suspense fallback={null}>
              <LazyDeliveryStageEditModal
                closeIssues={editingStageCloseIssues}
                draft={stageEditDraft}
                onClose={() => {
                  setEditingStage(null);
                  setStageEditDraft(null);
                }}
                onDraftPatch={(patch) => {
                  setStageEditDraft((current) => (current ? { ...current, ...patch } : current));
                }}
                onSubmit={() => {
                  void submitStageEdit();
                }}
                ownerOptions={stageOwnerOptions}
                runtime={editingStageRuntime}
                stage={editingStage}
                statusOptions={stageStatusOptions}
                validationIssues={editingStageValidation.issues}
              />
            </Suspense>
          ) : null}
        </div>
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

export function DeliveryBusinessFunctionPage({ projectId }: Readonly<{ projectId?: string }>) {
  return <DeliveryWorkbench config={businessFunctionConfigs.delivery} projectId={projectId} />;
}
