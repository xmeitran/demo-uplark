"use client";

import { useEffect, useState } from "react";
import type { CreateProjectInput, ProjectStageSummary, ProjectSummary, UpdateProjectInput } from "@b2b-crm/contracts";
import { CustomDropdown, DatePickerField, FormField, FormTextArea, Modal, type TaskSelectOption } from "./tasks-workbench";

type DeliveryCreateProjectAccountOption = {
  id: string;
  name: string;
};

type DraftMilestone = {
  id: string;
  name: string;
  requiredDocumentCount: number;
  requiredDocumentTypes: string;
  unlockCriteria: string;
  customerConfirmationRequired: boolean;
  reviewerRole: string;
  stages: Array<{ id: string; activity: string }>;
};

const PILOT_MILESTONE_DRAFT: DraftMilestone[] = [
  { id: "m1", name: "Nhận brief & kick-off dự án", requiredDocumentCount: 0, requiredDocumentTypes: "", unlockCriteria: "Đã xác nhận scope, mục tiêu và lịch kick-off.", customerConfirmationRequired: false, reviewerRole: "PM", stages: [{ id: "m1-s1", activity: "Validate scope & kick-off" }] },
  { id: "m2", name: "Xây dựng hệ thống", requiredDocumentCount: 3, requiredDocumentTypes: "BRD, FRD, SRS", unlockCriteria: "Đủ BRD, FRD, SRS được PM duyệt trước khi bắt đầu build.", customerConfirmationRequired: true, reviewerRole: "PM", stages: [{ id: "m2-s1", activity: "Thiết kế giải pháp" }, { id: "m2-s2", activity: "Xây dựng & kiểm thử" }, { id: "m2-s3", activity: "Chuẩn bị triển khai" }] },
  { id: "m3", name: "Pilot, Onboarding, Nghiệm thu hệ thống", requiredDocumentCount: 2, requiredDocumentTypes: "pilot_bug_log, onboard_bug_log", unlockCriteria: "Pilot và onboarding hoàn tất; lỗi/blocker đã có phương án xử lý.", customerConfirmationRequired: true, reviewerRole: "PM", stages: [{ id: "m3-s1", activity: "Pilot" }, { id: "m3-s2", activity: "Onboarding" }, { id: "m3-s3", activity: "Nghiệm thu hệ thống" }] },
  { id: "m4", name: "Bảo trì", requiredDocumentCount: 2, requiredDocumentTypes: "handover_cs, golive_confirmation", unlockCriteria: "Đã bàn giao cho CS/CSM và ghi nhận ngày Go-live.", customerConfirmationRequired: false, reviewerRole: "PM", stages: [{ id: "m4-s1", activity: "Tối ưu & hỗ trợ" }, { id: "m4-s2", activity: "Bàn giao & Go-live" }] }
];

export type DeliveryCreateProjectPayload = CreateProjectInput & {
  accountName?: string;
  ownerDisplayName?: string;
};

export type DeliveryUpdateProjectPayload = UpdateProjectInput & {
  accountName?: string;
  ownerDisplayName?: string;
};

export default function DeliveryCreateProjectModal({
  accounts,
  initialProject,
  initialStage,
  isOpen,
  mode = "create",
  onClose,
  onSave,
  resourceOptions
}: Readonly<{
  accounts: DeliveryCreateProjectAccountOption[];
  initialProject?: ProjectSummary;
  initialStage?: Partial<ProjectStageSummary>;
  isOpen: boolean;
  mode?: "create" | "edit";
  onClose: () => void;
  onSave: (data: DeliveryCreateProjectPayload | DeliveryUpdateProjectPayload) => void;
  resourceOptions: TaskSelectOption[];
}>) {
  const [accountId, setAccountId] = useState(initialProject?.accountId || accounts[0]?.id || "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(resourceOptions[0]?.value || "none");
  const [status, setStatus] = useState("active");
  const [plannedStartAt, setPlannedStartAt] = useState("");
  const [plannedEndAt, setPlannedEndAt] = useState("");
  const [scopeSummary, setScopeSummary] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [createStageTemplate, setCreateStageTemplate] = useState(true);
  const [milestoneMode, setMilestoneMode] = useState<"auto" | "manual">("auto");
  const [milestones, setMilestones] = useState<DraftMilestone[]>(PILOT_MILESTONE_DRAFT);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setAccountId(initialProject?.accountId || accounts[0]?.id || "");
    setCode(initialProject?.code || "");
    setName(initialProject?.name || "");
    setOwnerUserId(initialStage?.ownerUserId || resourceOptions[0]?.value || "none");
    setStatus(initialProject?.status || "active");
    setPlannedStartAt(toDateInputValue(initialStage?.plannedStartAt));
    setPlannedEndAt(toDateInputValue(initialStage?.plannedEndAt));
    setScopeSummary(initialStage?.scopeSummary || "");
    setAcceptanceCriteria(initialStage?.acceptanceCriteria || "");
    setCreateStageTemplate(true);
    setMilestoneMode("auto");
    setMilestones(PILOT_MILESTONE_DRAFT.map((milestone) => ({ ...milestone, stages: milestone.stages.map((stage) => ({ ...stage })) })));
  }, [accounts, initialProject, initialStage, isOpen, resourceOptions]);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedOwner = resourceOptions.find((option) => option.value === ownerUserId);
  const dateRangeInvalid = Boolean(plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt);
  const canSubmit = Boolean(accountId && name.trim() && !dateRangeInvalid);
  const timelineSummary =
    plannedStartAt && plannedEndAt
      ? `${plannedStartAt} -> ${plannedEndAt}`
      : plannedStartAt
        ? `Bắt đầu ${plannedStartAt}`
        : plannedEndAt
          ? `Hoàn tất ${plannedEndAt}`
          : "Chưa đặt";

  const isEditMode = mode === "edit";
  const modalTitle = isEditMode ? "Chỉnh sửa dự án triển khai" : "Tạo dự án triển khai";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} variant="create-task">
      <form
        className="task-form-modern task-form-compact delivery-create-project-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) {
            return;
          }

          onSave({
            accountId,
            accountName: selectedAccount?.name,
            code: code.trim() || undefined,
            createStageTemplate: isEditMode ? undefined : createStageTemplate,
            milestoneMode: isEditMode ? undefined : milestoneMode,
            milestoneTemplateKey: isEditMode ? undefined : milestoneMode === "auto" ? "pilot-v1" : undefined,
            manualMilestones: isEditMode ? undefined : milestones.map((milestone, milestoneIndex) => ({
              name: milestone.name.trim(),
              sortOrder: (milestoneIndex + 1) * 10,
              requiredDocumentCount: milestone.requiredDocumentCount,
              requiredDocumentTypes: milestone.requiredDocumentTypes.split(",").map((value) => value.trim()).filter(Boolean),
              unlockCriteria: milestone.unlockCriteria.trim(),
              customerConfirmationRequired: milestone.customerConfirmationRequired,
              reviewerRole: milestone.reviewerRole.trim() || undefined,
              stages: milestone.stages.map((stage, stageIndex) => ({ stageKey: `${milestone.id}-${stageIndex + 1}`, activity: stage.activity.trim(), phase: stage.activity.trim(), sortOrder: (stageIndex + 1) * 10 }))
            })),
            name: name.trim(),
            ownerDisplayName: selectedOwner?.label,
            ownerUserId: ownerUserId === "none" ? null : ownerUserId,
            plannedEndAt: plannedEndAt || null,
            plannedStartAt: plannedStartAt || null,
            scopeSummary: scopeSummary.trim(),
            acceptanceCriteria: acceptanceCriteria.trim(),
            status
          });
        }}
      >
        <div className="delivery-create-project-summary" aria-label="Tóm tắt dự án mới">
          <article>
            <span>Khách hàng</span>
            <strong>{selectedAccount?.name || "Chưa chọn"}</strong>
          </article>
          <article>
            <span>PIC</span>
            <strong>{ownerUserId === "none" ? "Chưa giao" : selectedOwner?.label || "Chưa giao"}</strong>
          </article>
          <article>
            <span>Timeline</span>
            <strong>{timelineSummary}</strong>
          </article>
        </div>

        <div className="delivery-create-project-section">
          <span className="delivery-create-project-section-title">Thông tin chính</span>
          <div className="task-form-grid">
            <CustomDropdown
              label="Khách hàng"
              value={accountId}
              options={accounts.map((account) => ({ value: account.id, label: account.name, icon: "person" }))}
              onChange={setAccountId}
            />
            <CustomDropdown
              label="PIC dự án"
              value={ownerUserId}
              options={resourceOptions}
              onChange={setOwnerUserId}
            />
          </div>

          <FormField
            label="Tên dự án"
            onChange={(event) => setName(event.target.value)}
            placeholder="VD: Triển khai UpLark Partner CRM giai đoạn 1"
            required
            value={name}
          />

          <div className="task-form-grid">
            <FormField
              label="Mã dự án"
              onChange={(event) => setCode(event.target.value)}
              placeholder="Tự sinh nếu bỏ trống"
              value={code}
            />
            <CustomDropdown
              label="Trạng thái"
              value={status}
              options={[
                { value: "active", label: "Đang triển khai", icon: "clock" },
                { value: "completed", label: "Hoàn tất", icon: "checkmark", iconTone: "success" },
                { value: "paused", label: "Tạm dừng", icon: "alert-circle" }
              ]}
              onChange={setStatus}
            />
          </div>
        </div>

        {!isEditMode ? (
          <div className="delivery-create-project-section delivery-milestone-config">
            <div className="delivery-create-project-section-heading">
              <span className="delivery-create-project-section-title">Milestone & điều kiện mở khóa</span>
              <small>Milestone tiếp theo chỉ mở khi đủ hồ sơ chuyển tiếp và điều kiện được admin cấu hình.</small>
            </div>
            <div className="delivery-milestone-mode-grid" role="radiogroup" aria-label="Cách tạo milestone">
              <label className={milestoneMode === "auto" ? "selected" : ""}>
                <input checked={milestoneMode === "auto"} name="milestone-mode" onChange={() => setMilestoneMode("auto")} type="radio" />
                <span><strong>Theo mẫu dự án</strong><small>4 milestone · 9 stage theo pilot UpLark</small></span>
              </label>
              <label className={milestoneMode === "manual" ? "selected" : ""}>
                <input checked={milestoneMode === "manual"} name="milestone-mode" onChange={() => setMilestoneMode("manual")} type="radio" />
                <span><strong>Tự chọn milestone</strong><small>Tự đặt milestone, stage và gate chuyển tiếp</small></span>
              </label>
            </div>
            <div className="delivery-milestone-list">
              {milestones.map((milestone, milestoneIndex) => (
                <article className="delivery-milestone-card" key={milestone.id}>
                  <div className="delivery-milestone-card-header">
                    <span className="delivery-milestone-index">M{milestoneIndex + 1}</span>
                    <input aria-label={`Tên milestone ${milestoneIndex + 1}`} disabled={milestoneMode === "auto"} onChange={(event) => updateMilestone(setMilestones, milestone.id, { name: event.target.value })} value={milestone.name} />
                    {milestoneMode === "manual" && milestones.length > 1 ? <button className="delivery-inline-remove" onClick={() => setMilestones((current) => current.filter((item) => item.id !== milestone.id))} type="button">Xóa</button> : null}
                  </div>
                  <div className="delivery-milestone-stage-preview">
                    {milestone.stages.map((stage) => <span key={stage.id}>{stage.activity}</span>)}
                    {milestoneMode === "manual" ? <button onClick={() => setMilestones((current) => current.map((item) => item.id === milestone.id ? { ...item, stages: [...item.stages, { id: `${milestone.id}-${Date.now()}`, activity: "Stage mới" }] } : item))} type="button">+ Stage</button> : null}
                  </div>
                  <div className="delivery-milestone-gate-grid">
                    <FormField label="Số hồ sơ bắt buộc" min={0} onChange={(event) => updateMilestone(setMilestones, milestone.id, { requiredDocumentCount: Math.max(0, Number(event.target.value) || 0) })} type="number" value={String(milestone.requiredDocumentCount)} />
                    <FormField label="Loại hồ sơ (phân tách bằng dấu phẩy)" onChange={(event) => updateMilestone(setMilestones, milestone.id, { requiredDocumentTypes: event.target.value })} placeholder="BRD, FRD, SRS" value={milestone.requiredDocumentTypes} />
                    <FormField label="Vai trò duyệt" onChange={(event) => updateMilestone(setMilestones, milestone.id, { reviewerRole: event.target.value })} value={milestone.reviewerRole} />
                  </div>
                  <FormTextArea label="Điều kiện mở milestone tiếp theo" onChange={(event) => updateMilestone(setMilestones, milestone.id, { unlockCriteria: event.target.value })} rows={2} value={milestone.unlockCriteria} />
                  <label className="delivery-gate-check"><input checked={milestone.customerConfirmationRequired} onChange={(event) => updateMilestone(setMilestones, milestone.id, { customerConfirmationRequired: event.target.checked })} type="checkbox" /> Cần khách hàng xác nhận trước khi mở bước tiếp theo</label>
                </article>
              ))}
            </div>
            {milestoneMode === "manual" ? <button className="task-secondary-action delivery-add-milestone" onClick={() => setMilestones((current) => [...current, { id: `m-${Date.now()}`, name: "Milestone mới", requiredDocumentCount: 0, requiredDocumentTypes: "", unlockCriteria: "", customerConfirmationRequired: false, reviewerRole: "PM", stages: [{ id: `s-${Date.now()}`, activity: "Stage mới" }] }])} type="button">+ Thêm milestone</button> : null}
          </div>
        ) : null}

        <div className="delivery-create-project-section">
          <span className="delivery-create-project-section-title">Timeline dự án</span>
          <div className="task-form-grid">
            <DatePickerField
              label="Ngày bắt đầu dự kiến"
              onChange={setPlannedStartAt}
              openDirection="down"
              popoverLayout="floating"
              value={plannedStartAt}
            />
            <DatePickerField
              label="Ngày nghiệm thu dự kiến"
              onChange={setPlannedEndAt}
              openDirection="down"
              popoverLayout="floating"
              value={plannedEndAt}
            />
          </div>
          {dateRangeInvalid && (
            <p className="delivery-create-project-error" role="alert">
              Ngày nghiệm thu dự kiến cần sau hoặc bằng ngày bắt đầu dự kiến.
            </p>
          )}
        </div>

        <div className="delivery-create-project-section">
          <span className="delivery-create-project-section-title">Phạm vi & UAT</span>
          <FormTextArea
            label="Scope dự án"
            onChange={(event) => setScopeSummary(event.target.value)}
            placeholder="Nêu phạm vi triển khai, module chính, nhóm người dùng và phần ngoài phạm vi nếu có."
            rows={3}
            value={scopeSummary}
          />
          <FormTextArea
            label="UAT / tiêu chí nghiệm thu"
            onChange={(event) => setAcceptanceCriteria(event.target.value)}
            placeholder="Mô tả điều kiện cần đạt để nghiệm thu: dữ liệu, workflow, quyền truy cập, training hoặc biên bản UAT."
            rows={3}
            value={acceptanceCriteria}
          />
        </div>

        {!isEditMode ? (
          <label className="delivery-create-project-check" htmlFor="create-project-stage-template">
            <input
              checked={createStageTemplate}
              id="create-project-stage-template"
              onChange={(event) => setCreateStageTemplate(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Tạo stage template</strong>
              <small>Seed cấu trúc milestone/stage và áp PIC, timeline, scope, UAT vào project.</small>
            </span>
          </label>
        ) : null}

        <div className="task-modal-footer">
          <button className="task-secondary-action" onClick={onClose} type="button">
            Hủy
          </button>
          <button className="task-primary-action" disabled={!canSubmit} type="submit">
            {isEditMode ? "Lưu thay đổi" : "Tạo dự án"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function updateMilestone(setMilestones: (updater: (current: DraftMilestone[]) => DraftMilestone[]) => void, id: string, patch: Partial<DraftMilestone>) {
  setMilestones((current) => current.map((milestone) => milestone.id === id ? { ...milestone, ...patch } : milestone));
}

function toDateInputValue(value?: string) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}
