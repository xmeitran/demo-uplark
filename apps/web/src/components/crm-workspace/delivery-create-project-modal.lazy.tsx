"use client";

import { useEffect, useState } from "react";
import type { CreateProjectInput, ProjectStageSummary, ProjectSummary, UpdateProjectInput } from "@b2b-crm/contracts";
import { CustomDropdown, DatePickerField, FormField, FormTextArea, Modal, type TaskSelectOption } from "./tasks-workbench";

type DeliveryCreateProjectAccountOption = {
  id: string;
  name: string;
};

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
              <small>Seed 8 stage triển khai và áp PIC, timeline, scope, UAT vào stage đầu tiên.</small>
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

function toDateInputValue(value?: string) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}
