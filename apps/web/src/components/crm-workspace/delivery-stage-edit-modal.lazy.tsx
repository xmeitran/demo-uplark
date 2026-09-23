"use client";

import { CustomDropdown, DatePickerField, FormField, FormTextArea, Modal } from "./tasks-workbench";
import { ShopifyIcon } from "../shopify-ui";
import { formatTaskMinutes } from "./task-display-helpers";

type StageOption = {
  value: string;
  label: string;
  icon?: string;
  iconTone?: string;
};

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

type StageForEdit = {
  activity: string;
  phase: string;
};

type StageRuntime = {
  estimateMinutes: number;
  loggedMinutes: number;
  tasks: unknown[];
};

export default function DeliveryStageEditModal({
  closeIssues,
  draft,
  onClose,
  onDraftPatch,
  onSubmit,
  ownerOptions,
  runtime,
  stage,
  statusOptions,
  validationIssues
}: Readonly<{
  closeIssues: string[];
  draft: StageEditDraft;
  onClose: () => void;
  onDraftPatch: (patch: Partial<StageEditDraft>) => void;
  onSubmit: () => void;
  ownerOptions: StageOption[];
  runtime?: StageRuntime;
  stage: StageForEdit;
  statusOptions: StageOption[];
  validationIssues: string[];
}>) {
  const hasProgressIssue = validationIssues.some((issue) => issue.includes("Tiến độ"));
  const hasStandardMinutesIssue = validationIssues.some((issue) => issue.includes("Giờ chuẩn"));

  return (
    <Modal isOpen onClose={onClose} title={`Chỉnh stage ${stage.activity}`} variant="stage-edit">
      <form
        className="task-form-modern delivery-stage-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="delivery-stage-edit-context">
          <article>
            <span>Stage</span>
            <strong>{stage.phase} · {stage.activity}</strong>
          </article>
          <article>
            <span>Task</span>
            <strong>{runtime?.tasks.length ?? 0}</strong>
          </article>
          <article>
            <span>Giờ task hiện tại</span>
            <strong>
              {formatTaskMinutes(runtime?.loggedMinutes ?? 0)} / {formatTaskMinutes(runtime?.estimateMinutes ?? 0)}
            </strong>
          </article>
        </div>

        <div className="delivery-stage-edit-section">
          <div className="task-form-grid" style={{ zIndex: 1006 }}>
            <CustomDropdown
              label="Trạng thái stage"
              onChange={(value) => onDraftPatch({ status: value })}
              options={statusOptions}
              value={draft.status}
            />
            <CustomDropdown
              label="PIC stage"
              onChange={(value) => onDraftPatch({ ownerUserId: value })}
              options={ownerOptions}
              value={draft.ownerUserId || "none"}
            />
          </div>
        </div>

        <div className="delivery-stage-edit-section">
          <div className="task-form-grid">
            <DatePickerField
              label="Ngày dự kiến bắt đầu"
              onChange={(value) => onDraftPatch({ plannedStartAt: value })}
              openDirection="down"
              value={draft.plannedStartAt}
            />
            <DatePickerField
              label="Ngày dự kiến hoàn tất"
              onChange={(value) => onDraftPatch({ plannedEndAt: value })}
              openDirection="down"
              value={draft.plannedEndAt}
            />
          </div>

          <div className="task-form-grid">
            <DatePickerField
              label="Ngày thực tế bắt đầu"
              onChange={(value) => onDraftPatch({ actualStartAt: value })}
              openDirection="down"
              value={draft.actualStartAt}
            />
            <DatePickerField
              label="Ngày thực tế hoàn tất"
              onChange={(value) => onDraftPatch({ actualEndAt: value })}
              openDirection="down"
              value={draft.actualEndAt}
            />
          </div>
        </div>

        <div className="delivery-stage-edit-section">
          <div className="task-form-grid">
            <FormField
              ariaDescribedBy={validationIssues.length > 0 ? "delivery-stage-validation-errors" : undefined}
              ariaInvalid={hasProgressIssue}
              label="Tiến độ stage (%)"
              max={100}
              min={0}
              onChange={(event) => onDraftPatch({ progressPercent: event.target.value })}
              placeholder="VD: 65"
              required
              step={1}
              type="number"
              value={draft.progressPercent}
            />
            <FormField
              ariaDescribedBy={validationIssues.length > 0 ? "delivery-stage-validation-errors" : undefined}
              ariaInvalid={hasStandardMinutesIssue}
              label="Giờ chuẩn stage (phút)"
              min={0}
              onChange={(event) => onDraftPatch({ standardMinutes: event.target.value })}
              placeholder="VD: 480"
              step={1}
              type="number"
              value={draft.standardMinutes}
            />
          </div>
        </div>

        <div className="delivery-stage-edit-section">
          <FormTextArea
            label="Scope stage"
            onChange={(event) => onDraftPatch({ scopeSummary: event.target.value })}
            placeholder="Nêu phạm vi công việc, deliverable chính và phần ngoài phạm vi nếu có"
            rows={3}
            value={draft.scopeSummary}
          />

          <div className="delivery-stage-edit-text-grid">
            <FormTextArea
              label="Tiêu chí nghiệm thu"
              onChange={(event) => onDraftPatch({ acceptanceCriteria: event.target.value })}
              placeholder="Mô tả điều kiện cần đạt để đóng stage"
              rows={3}
              value={draft.acceptanceCriteria}
            />
            <FormTextArea
              label="Blocker / rủi ro"
              onChange={(event) => onDraftPatch({ blockerSummary: event.target.value })}
              placeholder="Ghi blocker, người cần xử lý hoặc quyết định cần chốt"
              rows={3}
              value={draft.blockerSummary}
            />
          </div>
        </div>

        {validationIssues.length > 0 ? (
          <div className="delivery-stage-edit-guard validation" id="delivery-stage-validation-errors" role="alert">
            <div>
              <ShopifyIcon name="alert" size={16} />
              <strong>Kiểm tra lại dữ liệu stage</strong>
            </div>
            <ul>
              {validationIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {closeIssues.length > 0 ? (
          <div className="delivery-stage-edit-guard" role="alert">
            <div>
              <ShopifyIcon name="alert" size={16} />
              <strong>Chưa đủ điều kiện đóng stage</strong>
            </div>
            <ul>
              {closeIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="delivery-stage-edit-actions">
          <button className="task-button secondary" onClick={onClose} type="button">
            Hủy
          </button>
          <button className="task-button primary" disabled={validationIssues.length > 0 || closeIssues.length > 0} type="submit">
            Lưu stage
          </button>
        </div>
      </form>
    </Modal>
  );
}
