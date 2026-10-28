"use client";

/**
 * Edit and delete dialogs of a project, shared by the project list and the project detail page,
 * with the requests behind them (update, delete, "close instead" when the project has records).
 */
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Archive, BarChart2, CheckCircle2, Clock, Trash2, X } from "lucide-react";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";
import { CustomDropdown, CustomDatePicker } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import { CrmMultiSelect, CrmSelect } from "@/components/crm-workspace/crm-select";
import { useAuth } from "@/lib/auth";
import { isAdminView } from "@/lib/auth-role";
import { readApiError } from "@/lib/api-error";
import { systemRoleLabel } from "@/lib/people-roles";
import { uiProjectDateToIso } from "@/lib/project-date";
import { PROJECT_CLOSE_REASONS, PROJECT_STATUS_LABELS, projectStatusStyleMap, quickProjectStatusOptions, type ProjectCloseReasonCode } from "@/lib/project-status";
import { fetchWorkspaceUserOptions, type WorkspaceUserOption } from "@/lib/workspace-users";
import { INTERNAL_WORKLOG_PROJECT_TYPE, PROJECT_TYPE_OPTIONS, projectKindOf } from "@b2b-crm/contracts";
import { fetchAccountOptions, mapProjectSummaryToUiProject, toBackendProjectStatus } from "./live-projects";
import type { Project } from "./data";

export const STATUS_CFG = projectStatusStyleMap({
  active:    { color:"#16a34a", bg:"#dcfce7", icon:CheckCircle2 },
  in_review: { color:"#2563eb", bg:"#eff6ff", icon:BarChart2 },
  planning:  { color:"#0891b2", bg:"#e0f2fe", icon:Clock },
  on_hold:   { color:"#64748b", bg:"#f1f5f9", icon:Clock },
  completed: { color:"#16a34a", bg:"#f0fdf4", icon:CheckCircle2 },
  at_risk:   { color:"#dc2626", bg:"#fee2e2", icon:AlertCircle },
  closed:    { color:"#475569", bg:"#e2e8f0", icon:Archive },
}, { color:"#64748b", bg:"#f1f5f9", icon:Clock });

export function getProjectCode(project: Project) {
  return project.tags[0] ?? "";
}

/** Project.milestoneApprovalRequired. "Không duyệt": no milestone locks, a milestone (or G1–G8 gate) completes with its tasks. */
export function MilestoneApprovalField({ value, onChange, disabled = false }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5" title={disabled ? "Chỉ tài khoản Admin (PM) được đổi chế độ này" : undefined}>
      <span className="text-xs font-semibold text-muted-foreground">Duyệt milestone</span>
      <CustomDropdown
        ariaLabel="Duyệt milestone"
        options={[{ value: "required", label: "Yêu cầu duyệt" }, { value: "none", label: "Không duyệt" }]}
        value={value ? "required" : "none"}
        onChange={(next) => onChange(next === "required")}
        disabled={disabled}
      />
      <p className="text-[11px] text-muted-foreground">{value ? "Milestone cần gửi hồ sơ và được duyệt trước khi chuyển sang milestone tiếp theo." : "Các milestone mở ngay từ đầu và tự hoàn thành khi mọi task đã xong."}</p>
    </div>
  );
}

export function UserAvatar({ user, size = "md" }: { user: WorkspaceUserOption; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const className = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white`}
      style={{ backgroundColor: user.color }}
    >
      {user.avatarUrl && !failed ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        user.initials
      )}
    </span>
  );
}

export function ProjectUserDropdown({
  users,
  value,
  onChange,
  placeholder = "Select PIC"
}: {
  users: WorkspaceUserOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <CrmSelect
      ariaLabel="PIC dự án"
      disabled={users.length === 0}
      options={[
        { value: "none", label: users.length === 0 ? "No synced users" : "Unassigned" },
        ...users.map((user) => ({
          value: user.id,
          label: user.name,
          meta: `${user.role || "Chưa gán"} · ${systemRoleLabel(user.systemRole)}${user.email ? ` · ${user.email}` : ""}`,
          avatarUrl: user.avatarUrl,
          initials: user.initials,
          color: user.color
        }))
      ]}
      searchable
      searchPlaceholder="Tìm tên, email hoặc vai trò..."
      value={value || "none"}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

export function ProjectMemberMultiSelect({ users, selectedIds, onChange, placeholder = "Select project members" }: { users: WorkspaceUserOption[]; selectedIds: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  return (
    <CrmMultiSelect
      ariaLabel="Thành viên dự án"
      disabled={users.length === 0}
      options={users.map((user) => ({
        value: user.id,
        label: user.name,
        meta: `${user.role || "Chưa gán"} · ${systemRoleLabel(user.systemRole)} · ${user.email}`,
        avatarUrl: user.avatarUrl,
        initials: user.initials,
        color: user.color
      }))}
      placeholder={users.length === 0 ? "No synced users" : placeholder}
      selectedCountLabel={(count) => `${count} đã chọn`}
      values={selectedIds}
      onChange={onChange}
    />
  );
}

export interface ProjectEditValues {
  name: string;
  code: string;
  client: string;
  status: Project["status"];
  projectType: string;
  scopeSummary: string;
  ownerUserId: string;
  memberUserIds: string[];
  isTestProject: boolean;
  milestoneApprovalRequired: boolean;
  plannedStartAt: string;
  plannedEndAt: string;
}

export type ProjectClientOption = { value: string; label: string; accountId?: string };

export function ProjectEditModal({
  project,
  clientOptions,
  workspaceUsers,
  loadingWorkspaceUsers,
  workspaceUsersError,
  isSaving,
  error,
  onClose,
  onSave
}: {
  project: Project;
  clientOptions: ProjectClientOption[];
  workspaceUsers: WorkspaceUserOption[];
  loadingWorkspaceUsers: boolean;
  workspaceUsersError: string | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: ProjectEditValues) => void;
}) {
  const editDialogRef = useDialogAccessibility(true, () => { if (!isSaving) onClose(); });
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(getProjectCode(project));
  const [client, setClient] = useState(project.client);
  const [status, setStatus] = useState<Project["status"]>(project.status);
  // Loại dự án (V-01). The fixed worklog project keeps its own kind; the API refuses a change once G1 is approved.
  const initialProjectType = projectKindOf(project.projectType) ?? "delivery";
  const [projectType, setProjectType] = useState<string>(initialProjectType);
  const projectTypeOptions = initialProjectType === INTERNAL_WORKLOG_PROJECT_TYPE ? [...PROJECT_TYPE_OPTIONS, { value: INTERNAL_WORKLOG_PROJECT_TYPE, label: "Nội bộ (DX Internal Worklog)" }] : PROJECT_TYPE_OPTIONS;
  const [scopeSummary, setScopeSummary] = useState(project.scopeSummary ?? "");
  const initialMemberIds = project.memberUserIds ?? project.members.map((member) => member.id).filter((id): id is string => Boolean(id));
  const [ownerUserId, setOwnerUserId] = useState(project.ownerUserId ?? initialMemberIds[0] ?? "none");
  const [memberUserIds, setMemberUserIds] = useState<string[]>(initialMemberIds);
  // PL-02: "Dự án thử nghiệm" and the milestone approval mode — after creation only an Admin account changes them (the API enforces the same).
  const [isTestProject, setIsTestProject] = useState(project.isTestProject === true);
  const [milestoneApprovalRequired, setMilestoneApprovalRequired] = useState(project.milestoneApprovalRequired !== false);
  const canEditTestFlag = isAdminView(useAuth().user);
  const [plannedStartAt, setPlannedStartAt] = useState(project.startDate);
  const [plannedEndAt, setPlannedEndAt] = useState(project.dueDate);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isSaving) return;
    onSave({
      name: name.trim(),
      code: code.trim(),
      client,
      status,
      projectType,
      scopeSummary: scopeSummary.trim(),
      ownerUserId,
      memberUserIds,
      isTestProject,
      milestoneApprovalRequired,
      plannedStartAt,
      plannedEndAt
    });
  };

  return (
    <ModalLayer onClose={onClose}>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        ref={editDialogRef} role="dialog" aria-modal="true" aria-label="Chỉnh sửa dự án" tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90dvh] overflow-visible shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div>
            <h3 className="text-base font-bold text-foreground">Chỉnh sửa dự án</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Update persisted CRM fields for this workspace project.</p>
          </div>
          <button
            aria-label="Close edit project dialog"
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Tên dự án <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                aria-label="Tên dự án"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-project-code" className="text-xs font-semibold text-muted-foreground">Mã dự án</label>
              <input id="edit-project-code"
                type="text"
                aria-label="Mã dự án"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Trạng thái</label>
              {/* No reason field here: only statuses the server accepts without one. */}
              <CustomDropdown
                ariaLabel="Trạng thái"
                options={quickProjectStatusOptions(project.status).map((option) => ({ value: option.value, label: option.label, color: STATUS_CFG[option.value].color }))}
                value={status}
                onChange={(value) => setStatus(value as Project["status"])}
              />
              <p className="text-[11px] text-muted-foreground">Các trạng thái khác được cập nhật tại trang dự án</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Loại dự án</label>
              <CustomDropdown
                ariaLabel="Loại dự án"
                options={projectTypeOptions}
                value={projectType}
                onChange={setProjectType}
              />
            </div>

            <MilestoneApprovalField value={milestoneApprovalRequired} onChange={setMilestoneApprovalRequired} disabled={!canEditTestFlag} />

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Khách hàng</label>
              <CustomDropdown
                ariaLabel="Khách hàng"
                options={clientOptions}
                value={client}
                onChange={setClient}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">PIC</label>
              <ProjectUserDropdown
                users={workspaceUsers}
                value={ownerUserId}
                onChange={(value) => {
                  setOwnerUserId(value);
                  if (value !== "none" && !memberUserIds.includes(value)) {
                    setMemberUserIds((current) => [...current, value]);
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Dự án thử nghiệm</span>
              <label htmlFor="edit-project-test-flag" title={canEditTestFlag ? undefined : "Chỉ tài khoản Admin (PM) được đổi tùy chọn này"} className="flex w-full items-center gap-2 px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground">
                <input id="edit-project-test-flag" type="checkbox" checked={isTestProject} disabled={!canEditTestFlag} onChange={(event) => setIsTestProject(event.target.checked)} />
                Không tính vào số tổng P&amp;L
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Planned Start</label>
              <CustomDatePicker ariaLabel="Planned Start Date" value={plannedStartAt} onChange={setPlannedStartAt} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Planned End</label>
              <CustomDatePicker ariaLabel="Planned End Date" value={plannedEndAt} onChange={setPlannedEndAt} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-project-scope" className="text-xs font-semibold text-muted-foreground">Project Scope</label>
            <textarea id="edit-project-scope"
              rows={3}
              value={scopeSummary}
              onChange={(event) => setScopeSummary(event.target.value)}
              placeholder="Describe scope, objectives, deliverables, and key boundaries..."
              className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm text-foreground focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Project Members ({memberUserIds.length} selected)</span>
              <span className="text-[10px] text-muted-foreground">
                {loadingWorkspaceUsers ? "Loading synced users..." : "Synced workspace users"}
              </span>
            </label>
            <ProjectMemberMultiSelect
              users={workspaceUsers}
              selectedIds={memberUserIds}
              onChange={setMemberUserIds}
            />
            {!loadingWorkspaceUsers && workspaceUsers.length === 0 && (
              <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                {workspaceUsersError ?? "No synced active users are available for assignment."}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

export function ProjectDeleteConfirmModal({
  project,
  isDeleting,
  error,
  closeInstead,
  onCancel,
  onConfirm,
  onCloseProject
}: {
  project: Project;
  isDeleting: boolean;
  error: string | null;
  /** The API refused the delete because the project has records: the dialog then offers to close it. */
  closeInstead: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onCloseProject: (closeReasonCode: ProjectCloseReasonCode, note: string) => void;
}) {
  const deleteDialogRef = useDialogAccessibility(true, () => { if (!isDeleting) onCancel(); });
  const [closeReasonCode, setCloseReasonCode] = useState<ProjectCloseReasonCode | "">("");
  const [closeNote, setCloseNote] = useState("");
  const alreadyClosed = project.status === PROJECT_STATUS_LABELS.closed;
  return (
    <ModalLayer closeOnEscape={!isDeleting} onClose={onCancel}>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        ref={deleteDialogRef} role="alertdialog" aria-modal="true" aria-label="Delete Project" tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-border bg-red-50">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Delete Project</h3>
              <p className="text-xs text-muted-foreground mt-1">
                This removes the project only if production rules allow it.
              </p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-semibold text-foreground">{project.name}</span>? Projects with tasks are protected and the API will block deletion.
          </p>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}
          {closeInstead && alreadyClosed && (
            <p className="text-xs text-muted-foreground">Dự án đã ở trạng thái Đã đóng, không cần thao tác thêm.</p>
          )}
          {closeInstead && !alreadyClosed && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
              <label className="block text-xs font-semibold text-foreground" htmlFor="close-project-reason">Đóng dự án thay vì xóa: chọn lý do đóng</label>
              <select
                id="close-project-reason"
                value={closeReasonCode}
                onChange={(event) => setCloseReasonCode(event.target.value as ProjectCloseReasonCode | "")}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
              >
                <option value="">Chọn lý do đóng</option>
                {Object.entries(PROJECT_CLOSE_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input
                type="text"
                value={closeNote}
                onChange={(event) => setCloseNote(event.target.value)}
                placeholder="Ghi chú (không bắt buộc)"
                aria-label="Ghi chú đóng dự án"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
              />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            {closeInstead ? (
              !alreadyClosed && (
                <button
                  type="button"
                  disabled={isDeleting || !closeReasonCode}
                  onClick={() => { if (closeReasonCode) onCloseProject(closeReasonCode, closeNote.trim()); }}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-slate-800 shadow-md hover:bg-slate-900 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDeleting ? "Đang đóng…" : "Đóng dự án"}
                </button>
              )
            ) : (
              <button
                type="button"
                disabled={isDeleting}
                onClick={onConfirm}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 shadow-md hover:bg-red-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeleting ? "Deleting..." : "Delete Project"}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
    </ModalLayer>
  );
}

export type ProjectAction = { kind: "edit" | "delete"; project: Project };

/**
 * The open edit or delete dialog and its requests. Callers that already hold the accounts and synced users pass them;
 * otherwise they load when the edit dialog opens.
 */
export function ProjectActionDialogs({ action, onDone, onUpdated, onDeleted, onUnauthorized, clientOptions: givenClientOptions, workspaceUsers: givenWorkspaceUsers, loadingWorkspaceUsers: givenLoadingUsers = false, workspaceUsersError: givenUsersError = null }: {
  action: ProjectAction | null;
  onDone: () => void;
  /** After a save, or after "close instead" in the delete dialog. */
  onUpdated: (projectId: string, updated: Project) => void;
  onDeleted: (project: Project) => void;
  onUnauthorized: () => void;
  clientOptions?: ProjectClientOption[];
  workspaceUsers?: WorkspaceUserOption[];
  loadingWorkspaceUsers?: boolean;
  workspaceUsersError?: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [needsClose, setNeedsClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ clientOptions: ProjectClientOption[]; workspaceUsers: WorkspaceUserOption[]; error: string | null } | null>(null);
  const needsOptions = action?.kind === "edit" && (!givenClientOptions || !givenWorkspaceUsers);
  const clientOptions = givenClientOptions ?? loaded?.clientOptions ?? [];
  const workspaceUsers = givenWorkspaceUsers ?? loaded?.workspaceUsers ?? [];

  useEffect(() => {
    if (!needsOptions || loaded) return;
    const controller = new AbortController();
    Promise.all([fetchAccountOptions(controller.signal), fetchWorkspaceUserOptions(controller.signal)])
      .then(([accounts, users]) => setLoaded({ clientOptions: accounts, workspaceUsers: users, error: null }))
      .catch((loadError) => {
        if (!controller.signal.aborted) setLoaded({ clientOptions: [], workspaceUsers: [], error: loadError instanceof Error ? loadError.message : "Could not load synced workspace users" });
      });
    return () => controller.abort();
  }, [needsOptions, loaded]);

  const close = () => {
    setError(null);
    setNeedsClose(false);
    onDone();
  };

  const send = async (projectId: string, method: "PATCH" | "DELETE", body?: unknown) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 401) {
      onUnauthorized();
      return null;
    }
    return response;
  };

  const update = async (project: Project, values: ProjectEditValues) => {
    if (saving) return;
    const selectedAccount = clientOptions.find(option => option.value === values.client || option.label === values.client);
    if (!selectedAccount?.accountId) {
      setError("Select an existing CRM account before saving this production project.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ownerUserId = values.ownerUserId === "none" ? null : values.ownerUserId;
      const memberUserIds = Array.from(new Set([...values.memberUserIds, ...(ownerUserId ? [ownerUserId] : [])]));
      const response = await send(project.id, "PATCH", {
        accountId: selectedAccount.accountId,
        name: values.name,
        code: values.code || undefined,
        // Unchanged status is left out so a system-owned or reason-bound status never blocks saving other fields.
        status: values.status === project.status ? undefined : toBackendProjectStatus(values.status),
        projectType: values.projectType,
        scopeSummary: values.scopeSummary || null,
        // Only what the user changed: the dates shown are the stages' actual-or-planned days, so re-sending them would
        // overwrite the planned dates (and the locked baseline); an unchanged PIC is not a PIC change.
        ownerUserId: ownerUserId === (project.ownerUserId ?? null) ? undefined : ownerUserId,
        memberUserIds,
        isTestProject: values.isTestProject,
        milestoneApprovalRequired: values.milestoneApprovalRequired,
        plannedStartAt: values.plannedStartAt === project.startDate ? undefined : uiProjectDateToIso(values.plannedStartAt),
        plannedEndAt: values.plannedEndAt === project.dueDate ? undefined : uiProjectDateToIso(values.plannedEndAt)
      });
      if (!response) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.message === "string" ? body.message : `Could not update project: ${response.status}`);
      }
      onUpdated(project.id, mapProjectSummaryToUiProject(await response.json()));
      close();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update project");
    } finally {
      setSaving(false);
    }
  };

  const closeInstead = async (project: Project, closeReasonCode: ProjectCloseReasonCode, note: string) => {
    if (deletingId) return;
    setDeletingId(project.id);
    setError(null);
    try {
      const response = await send(project.id, "PATCH", { status: "closed", closeReasonCode, statusReason: note || undefined });
      if (!response) return;
      if (!response.ok) throw await readApiError(response, "Không đóng được dự án");
      onUpdated(project.id, mapProjectSummaryToUiProject(await response.json()));
      close();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Không đóng được dự án");
    } finally {
      setDeletingId(null);
    }
  };

  const remove = async (project: Project) => {
    if (deletingId) return;
    setDeletingId(project.id);
    setError(null);
    try {
      const response = await send(project.id, "DELETE");
      if (!response) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // A project with records is closed, never deleted: the dialog switches to "Đóng dự án".
        if (body.code === "PROJECT_HAS_RECORDS") setNeedsClose(true);
        throw new Error(typeof body.message === "string" ? body.message : `Could not delete project: ${response.status}`);
      }
      onDeleted(project);
      close();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete project");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AnimatePresence>
      {action?.kind === "edit" && (
        <ProjectEditModal
          project={action.project}
          clientOptions={clientOptions}
          workspaceUsers={workspaceUsers}
          loadingWorkspaceUsers={givenWorkspaceUsers ? givenLoadingUsers : !loaded}
          workspaceUsersError={givenWorkspaceUsers ? givenUsersError : loaded?.error ?? null}
          isSaving={saving}
          error={error}
          onClose={close}
          onSave={(values) => update(action.project, values)}
        />
      )}
      {action?.kind === "delete" && (
        <ProjectDeleteConfirmModal
          project={action.project}
          isDeleting={deletingId === action.project.id}
          error={error}
          closeInstead={needsClose}
          onCancel={close}
          onConfirm={() => remove(action.project)}
          onCloseProject={(closeReasonCode, note) => closeInstead(action.project, closeReasonCode, note)}
        />
      )}
    </AnimatePresence>
  );
}
