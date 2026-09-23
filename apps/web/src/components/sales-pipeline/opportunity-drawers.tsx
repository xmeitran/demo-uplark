"use client";
import { MoneyAmount } from "@/components/money-amount";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEPLOYMENT_KICKOFF_STATUSES, PAYMENT_EVIDENCE_TYPES, SALES_DELAY_REASONS, SALES_LOST_REASONS, SALES_WON_REASONS } from "@b2b-crm/contracts";
import { ShopifyModal } from "../shopify-modal";
import { ShopifyIcon } from "../shopify-ui";
import { ModalLayer } from "../modal-layer";
import { activityTypes, stageOptions } from "./constants";
import type { OpportunityWorkbench } from "./use-opportunity-workbench";
import { formatForecastCategory, formatNumber, formatStageLabel, formatStaleReason, formatTaxonomyLabel, formatVndInput, parseVndInput, stageTone } from "./utils";

const VISIBLE_PIPELINE_STAGES = ["lead", "discovery", "proposal", "negotiation", "contracting", "won"];

export function OpportunityDrawers({ workbench }: { workbench: OpportunityWorkbench }) {
  const {
    handoffModalOpen,
    handoffDraft,
    loading
  } = workbench.state;
  const {
    createHandoffKickoff,
    setHandoffDraft,
    setHandoffModalOpen
  } = workbench.actions;

  return (
    <ShopifyModal onClose={() => setHandoffModalOpen(false)} open={handoffModalOpen} size="large" title="Tạo dự án bàn giao">
      <div className="pipeline-create-modal opportunity-kickoff-modal">
        <div className="pipeline-modal-intro">
          <span className="pipeline-modal-icon" aria-hidden="true">
            <ShopifyIcon name="handoff" size={18} />
          </span>
          <div>
            <strong>Thông tin kickoff</strong>
            <span>Chốt người phụ trách, lịch bắt đầu và điều kiện bàn giao trước khi chuyển sang triển khai.</span>
          </div>
        </div>
        <div className="opportunity-form-grid">
          <PipelineTextField label="Mã dự án" onChange={(value) => setHandoffDraft((current) => ({ ...current, projectCode: value }))} placeholder="Ví dụ: CRM-ALPHA-P1" value={handoffDraft.projectCode} />
          <PipelineTextField label="Tên dự án" onChange={(value) => setHandoffDraft((current) => ({ ...current, projectName: value }))} placeholder="Ví dụ: CRM/ERP phase 1" value={handoffDraft.projectName} />
        </div>
        <div className="opportunity-form-grid">
          <PipelineTextField label="Phụ trách kickoff" onChange={(value) => setHandoffDraft((current) => ({ ...current, kickoffOwnerUserId: value }))} placeholder="Tên hoặc mã người phụ trách" value={handoffDraft.kickoffOwnerUserId} />
          <PipelineDateField label="Ngày kickoff" onChange={(value) => setHandoffDraft((current) => ({ ...current, kickoffAt: value }))} value={handoffDraft.kickoffAt} />
        </div>
        <CustomDropdown
          label="Trạng thái triển khai"
          onChange={(value) => setHandoffDraft((current) => ({ ...current, deploymentStatus: value }))}
          options={DEPLOYMENT_KICKOFF_STATUSES.map((status) => ({ value: status.code, label: status.label }))}
          value={handoffDraft.deploymentStatus}
        />
        <div className="opportunity-check-grid">
          <Checklist label="Phạm vi thương mại" checked={handoffDraft.commercialScope} onChange={(checked) => setHandoffDraft((current) => ({ ...current, commercialScope: checked }))} />
          <Checklist label="SOW đã ký" checked={handoffDraft.signedSow} onChange={(checked) => setHandoffDraft((current) => ({ ...current, signedSow: checked }))} />
          <Checklist label="Đã có người kickoff" checked={handoffDraft.kickoffOwner} onChange={(checked) => setHandoffDraft((current) => ({ ...current, kickoffOwner: checked }))} />
          <Checklist label="Billing sẵn sàng" checked={handoffDraft.billingReady} onChange={(checked) => setHandoffDraft((current) => ({ ...current, billingReady: checked }))} />
          <Checklist label="Đã có người triển khai" checked={handoffDraft.deliveryOwner} onChange={(checked) => setHandoffDraft((current) => ({ ...current, deliveryOwner: checked }))} />
          <Checklist label="Đã xếp lịch kickoff" checked={handoffDraft.kickoffScheduled} onChange={(checked) => setHandoffDraft((current) => ({ ...current, kickoffScheduled: checked }))} />
          <Checklist label="Tạo task template theo stage" checked={handoffDraft.createStageTaskTemplate} onChange={(checked) => setHandoffDraft((current) => ({ ...current, createStageTaskTemplate: checked }))} />
        </div>
        <PipelineTextArea label="Ghi chú kickoff" onChange={(value) => setHandoffDraft((current) => ({ ...current, note: value }))} placeholder="Thêm ngữ cảnh cần bàn giao cho đội triển khai" value={handoffDraft.note} />
        <div className="pipeline-modal-actions">
          <button className="pipeline-command-button" onClick={() => setHandoffModalOpen(false)} type="button">
            Hủy
          </button>
          <button className="pipeline-command-button primary" disabled={loading} onClick={createHandoffKickoff} type="button">
            <ShopifyIcon name="handoff" size={15} />
            <span>Tạo kickoff</span>
          </button>
        </div>
      </div>
    </ShopifyModal>
  );
}

export function OpportunityDetailPage({ 
  workbench,
  onBack
}: { 
  workbench: OpportunityWorkbench;
  onBack: () => void;
}) {
  const {
    selected,
    draft,
    closeDraft,
    loading,
    activities,
    activityDraft,
    financeMilestoneDraft,
    paymentSchedules,
    paymentEvidenceDraft,
    arAging,
    financeLoading,
    isEditing,
    leads,
    opportunities,
    salesOwners
  } = workbench.state;

  const {
    addPaymentEvidence,
    addPaymentMilestone,
    cancelEditing,
    setDraft,
    confirmSave,
    setCloseDraft,
    closeOpportunity,
    setActivityDraft,
    createActivity,
    setFinanceMilestoneDraft,
    setPaymentEvidenceDraft,
    setHandoffModalOpen,
    setIsEditing,
    setActivityOpen,
    setDetailOpen,
    setFinanceOpen,
    openDetail,
    openActivities,
    openFinance
  } = workbench.actions;

  const [activeTab, setActiveTab] = useState<"overview" | "activities" | "finance" >("overview");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  // Mount/Update effect to map incoming action selections to tabs
  useEffect(() => {
    if (workbench.state.activityOpen) {
      setActiveTab("activities");
    } else if (workbench.state.financeOpen) {
      setActiveTab("finance");
    } else {
      setActiveTab("overview");
    }
  }, [workbench.state.activityOpen, workbench.state.financeOpen]);

  const handleTabChange = (tab: "overview" | "activities" | "finance") => {
    setActiveTab(tab);
    setDetailOpen(tab === "overview");
    setActivityOpen(tab === "activities");
    setFinanceOpen(tab === "finance");
    if (tab === "overview") {
      openDetail(selected!);
    } else if (tab === "activities") {
      openActivities(selected!);
    } else if (tab === "finance") {
      openFinance(selected!);
    }
  };

  if (!selected) return null;

  const isWon = selected.stage === "won";
  const isLost = selected.stage === "lost";
  const isClosed = selected.stage === "won" || selected.stage === "lost";
  const closedOutcomeLabel = isWon ? "BD đã xác nhận thắng" : isLost ? "BD đã xác nhận thua" : "Chưa chốt";
  const displayProbability = isWon ? 100 : isLost ? 0 : selected.probability;
  const stageEditOptions = (isClosed ? [selected.stage] : stageOptions.filter((stage) => !["won", "lost"].includes(stage)))
    .map((stage) => ({ value: stage, label: formatStageLabel(stage) }));
  const ownerOptions = getOwnerOptions(salesOwners, opportunities, selected);
  const sourceOptions = getSourceOptions(leads, selected);
  const handoffCriteria = [
    { label: "Phạm vi thương mại", checked: closeDraft.commercialScope },
    { label: "SOW đã ký", checked: closeDraft.signedSow },
    { label: "Đã có người kickoff", checked: closeDraft.kickoffOwner },
    { label: "Billing sẵn sàng", checked: closeDraft.billingReady }
  ];
  const completedHandoffCriteria = handoffCriteria.filter((item) => item.checked).length;
  const missingHandoffCriteria = handoffCriteria.filter((item) => !item.checked).map((item) => item.label);
  const isHandoffReady = completedHandoffCriteria === handoffCriteria.length;
  const canStartHandoff = Boolean(isWon && selected.closedAt && isHandoffReady);
  const missingHandoffCount = missingHandoffCriteria.length;
  const handoffBlockedReason = isLost
    ? "Deal đã thua nên không bàn giao triển khai."
    : !isWon
    ? "Chuyển cơ hội sang Thắng trước khi kickoff."
    : !isHandoffReady
    ? `Cần hoàn tất ${missingHandoffCount} điều kiện bàn giao: ${missingHandoffCriteria.join(", ")}.`
    : !selected.closedAt
    ? "Cần xác nhận thời điểm thắng trước khi kickoff."
    : "Đã sẵn sàng tạo dự án bàn giao.";
  const amountHint = draft.amount ? formatOptionalVnd(parseVndInput(draft.amount)) : "Chưa nhập giá trị";
  const opportunityOwner = getOpportunityOwner(selected);
  const opportunitySource = selected.leadId ? "Tạo từ lead" : "Tạo trực tiếp";
  const timelineItems = getOpportunityTimeline(selected);
  const stageProgress = getStageProgress(selected);
  const paymentScheduleOptions = paymentSchedules.map((schedule) => ({
    value: schedule.id,
    label: formatFinanceLabel(schedule.title)
  }));
  const milestoneOptions = paymentSchedules.flatMap((schedule) =>
    schedule.milestones.map((milestone) => ({
      value: milestone.id,
      label: `${formatFinanceLabel(milestone.label)} · ${formatFinanceLabel(schedule.title)}`,
      invoiceId: milestone.invoices?.[0]?.id ?? ""
    }))
  );
  const evidenceTypeOptions = PAYMENT_EVIDENCE_TYPES.map((type) => ({
    value: type.code,
    label: formatEvidenceType(type.code)
  }));
  const selectedEvidenceMilestone = milestoneOptions.find((milestone) => milestone.value === paymentEvidenceDraft.milestoneId);
  const canAddMilestone = Boolean((financeMilestoneDraft.scheduleId || paymentSchedules[0]?.id) && financeMilestoneDraft.label.trim());
  const canAddEvidence = Boolean(paymentEvidenceDraft.milestoneId && paymentEvidenceDraft.externalUrl.trim());
  const openConfirm = (dialog: ConfirmDialogState) => setConfirmDialog(dialog);

  return (
    <div className="opportunity-detail">
      <div className="opportunity-detail-header">
        <button className="opportunity-back-button" onClick={onBack} type="button">
          <ShopifyIcon name="arrow-left" size={16} />
          <span>Quay lại danh sách</span>
        </button>
        
        <div className="opportunity-title-row">
          <div>
            <div className="opportunity-title-stack">
              {isEditing && !isClosed ? (
                <div className="opportunity-title-edit">
                  <PipelineTextField
                    disabled={loading}
                    label="Tên cơ hội"
                    onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
                    placeholder="Ví dụ: Managed services expansion"
                    value={draft.title}
                  />
                </div>
              ) : (
                <h1 className="opportunity-detail-title">
                  <ShopifyIcon name="spark" size={18} />
                  {selected.title}
                </h1>
              )}
              <s-badge tone={stageTone(selected.stage)}>{formatStageLabel(selected.stage)}</s-badge>
            </div>
            <span className="opportunity-detail-subtitle">
              Khách hàng: <strong>{selected.accountName}</strong>
            </span>
            <div className="opportunity-hero-meta" aria-label="Ngữ cảnh cơ hội">
              <span>
                <ShopifyIcon name="users" size={13} />
                Phụ trách: <strong>{opportunityOwner}</strong>
              </span>
              <span>
                <ShopifyIcon name="target" size={13} />
                Nguồn: <strong>{opportunitySource}</strong>
              </span>
              <span>
                <ShopifyIcon name="calendar" size={13} />
                Vào giai đoạn: <strong>{formatDisplayDate(selected.stageEnteredAt)}</strong>
              </span>
            </div>
          </div>
          
          <div className="opportunity-action-stack">
            <div className="opportunity-action-row">
              {isEditing ? (
                <>
                  <button className="pipeline-command-button" disabled={loading} onClick={cancelEditing} type="button">
                    <ShopifyIcon name="x" size={15} />
                    <span>Hủy sửa</span>
                  </button>
                  <button
                    className="pipeline-command-button primary"
                    disabled={loading}
                    onClick={() => openConfirm({
                      confirmLabel: "Lưu thay đổi",
                      description: "Các thay đổi về tên cơ hội, phụ trách, ngày, việc tiếp theo, giai đoạn, xác suất và giá trị sẽ được ghi vào cơ hội này.",
                      onConfirm: confirmSave,
                      title: "Xác nhận lưu thay đổi"
                    })}
                    type="button"
                  >
                    <ShopifyIcon name="check" size={15} />
                    <span>Lưu thay đổi</span>
                  </button>
                </>
              ) : (
                <button
                  className="pipeline-command-button"
                  disabled={loading || isClosed}
                  onClick={() => openConfirm({
                    confirmLabel: "Bắt đầu sửa",
                    description: "Bật chế độ sửa để cập nhật thông tin chính, người phụ trách, lịch theo dõi, giai đoạn, xác suất và giá trị. Bạn vẫn cần xác nhận trước khi lưu.",
                    onConfirm: () => setIsEditing(true),
                    title: "Bật chế độ sửa?"
                  })}
                  type="button"
                >
                  <ShopifyIcon name="edit" size={15} />
                  <span>Sửa cơ hội</span>
                </button>
              )}
              {isWon && (
                <button className="pipeline-command-button primary" disabled={!canStartHandoff || loading} onClick={() => setHandoffModalOpen(true)} type="button">
                  <ShopifyIcon name="handoff" size={15} />
                  <span>{canStartHandoff ? "Bắt đầu kickoff" : "Chưa thể bàn giao"}</span>
                </button>
              )}
            </div>
            <span className={isEditing ? "opportunity-edit-state editing" : "opportunity-edit-state"}>
              {isEditing ? "Đang sửa, cần xác nhận lưu." : isClosed ? "Deal đã chốt." : "Đang xem, bấm Sửa để cập nhật."}
            </span>
            {!isClosed && !isHandoffReady && (
              <span className="opportunity-action-note blocked">
                Có thể chốt thắng trước; bàn giao sẽ mở sau khi đủ {missingHandoffCount} điều kiện.
              </span>
            )}
            {isWon && (
              <span className={canStartHandoff ? "opportunity-action-note ready" : "opportunity-action-note blocked"}>
                {handoffBlockedReason}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="opportunity-detail-layout">
        <div className="opportunity-detail-column">
          <div className="premium-card opportunity-card">
            <span className="opportunity-card-eyebrow">
              <ShopifyIcon name="trend" size={14} />
              Chỉ số chính
            </span>
            <div className="opportunity-detail-metrics">
              <InlineMetricShell label="Giá trị">
                {isEditing && !isClosed ? (
                  <label className="pipeline-field inline">
                    <span className="sr-only">Giá trị</span>
                    <div className="pipeline-input-shell">
                      <input
                        className="pipeline-input"
                        disabled={loading}
                        inputMode="numeric"
                        onChange={(event) => setDraft((current) => ({ ...current, amount: formatVndInput(event.target.value) }))}
                        placeholder="180.000.000"
                        type="text"
                        value={draft.amount}
                      />
                      <span>đ</span>
                    </div>
                  </label>
                ) : (
                  <strong>{selected.amount === undefined ? "Bị giới hạn" : <MoneyAmount value={selected.amount} />}</strong>
                )}
              </InlineMetricShell>
              <InlineMetricShell label="Dự báo có trọng số">
                <strong>{selected.weightedForecast === undefined ? "Bị giới hạn" : <MoneyAmount value={selected.weightedForecast} />}</strong>
              </InlineMetricShell>
              <DetailField label="Nhóm dự báo" value={formatForecastCategory(selected.forecastCategory)} />
              <InlineMetricShell label="Xác suất">
                {isEditing && !isClosed ? (
                  <PipelineNumberField
                    disabled={loading}
                    label="Xác suất (%)"
                    max={100}
                    min={0}
                    onChange={(value) => setDraft((current) => ({ ...current, probability: value }))}
                    value={draft.probability}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{formatNumber(displayProbability)}%</strong>
                )}
              </InlineMetricShell>
              <InlineMetricShell label="Phụ trách">
                {isEditing && !isClosed ? (
                  <CustomDropdown
                    disabled={loading || ownerOptions.length === 0}
                    label="Phụ trách"
                    value={draft.ownerUserId}
                    options={ownerOptions}
                    onChange={(val) => setDraft((current) => ({ ...current, ownerUserId: val }))}
                    renderOption={(opt) => (
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <ShopifyIcon name="users" size={14} />
                        <span>{opt.label}</span>
                      </span>
                    )}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{opportunityOwner}</strong>
                )}
              </InlineMetricShell>
              <InlineMetricShell label="Nguồn cơ hội">
                {isEditing && !isClosed ? (
                  <CustomDropdown
                    disabled={loading}
                    label="Nguồn cơ hội"
                    value={draft.leadId || "direct"}
                    options={sourceOptions}
                    onChange={(val) => setDraft((current) => ({ ...current, leadId: val === "direct" ? "" : val }))}
                    renderOption={(opt) => (
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <ShopifyIcon name={opt.value === "direct" ? "spark" : "users"} size={14} />
                        <span>{opt.label}</span>
                      </span>
                    )}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{opportunitySource}</strong>
                )}
              </InlineMetricShell>
              <InlineMetricShell label="Giai đoạn">
                {isEditing && !isClosed ? (
                  <CustomDropdown
                    disabled={loading}
                    label="Giai đoạn"
                    value={draft.stage}
                    options={stageEditOptions}
                    onChange={(val) => setDraft((current) => ({ ...current, stage: val }))}
                    renderOption={(opt) => (
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", textTransform: "capitalize" }}>
                        <span style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: opt.value === "won" ? "var(--success)" : opt.value === "lost" ? "var(--danger)" : "var(--accent)"
                        }} />
                        <span>{opt.label}</span>
                      </span>
                    )}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{formatStageLabel(selected.stage)}</strong>
                )}
              </InlineMetricShell>
              <InlineMetricShell label="Ngày vào giai đoạn">
                {isEditing && !isClosed ? (
                  <PipelineDateField
                    disabled={loading}
                    label="Ngày vào giai đoạn"
                    onChange={(value) => setDraft((current) => ({ ...current, stageEnteredAt: value }))}
                    value={draft.stageEnteredAt}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{formatDisplayDate(selected.stageEnteredAt)}</strong>
                )}
              </InlineMetricShell>
              <DetailField label="Tuổi giai đoạn" value={`${formatNumber(selected.stageAgeDays)} ngày`} />
              <InlineMetricShell label="Ngày việc tiếp theo">
                {isEditing && !isClosed ? (
                  <PipelineDateField
                    disabled={loading}
                    label="Ngày việc tiếp theo"
                    onChange={(value) => setDraft((current) => ({ ...current, nextActivityAt: value }))}
                    value={draft.nextActivityAt}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{selected.nextActivityAt ? formatDisplayDate(selected.nextActivityAt) : "Chưa có"}</strong>
                )}
              </InlineMetricShell>
              <InlineMetricShell label="Việc tiếp theo" wide>
                {isEditing && !isClosed ? (
                  <PipelineTextField
                    disabled={loading}
                    label="Việc tiếp theo"
                    onChange={(value) => setDraft((current) => ({ ...current, nextActivitySubject: value }))}
                    placeholder="Ví dụ: Hẹn workshop, gửi báo giá hoặc xác nhận người quyết định"
                    value={draft.nextActivitySubject}
                    visuallyHiddenLabel
                  />
                ) : (
                  <strong>{selected.nextActivityAt ? formatDisplayDate(selected.nextActivityAt) : "Chưa có"}</strong>
                )}
              </InlineMetricShell>
              <DetailField label="Sức khỏe" value={selected.stale ? formatStaleReason(selected.staleReason) : "Cơ hội ổn"} isAlert={selected.stale} />
            </div>
            {isEditing && !isClosed ? (
              <span className="opportunity-field-hint inline-metric-hint">
                Giá trị xem trước: <strong>{amountHint}</strong>. Bấm Lưu thay đổi để ghi lại các chỉnh sửa.
              </span>
            ) : null}
          </div>
          
          <div className="premium-card opportunity-card">
            <span className="opportunity-card-eyebrow">
              <ShopifyIcon name="briefcase" size={14} />
              Quyết định & bàn giao
            </span>
            <div className="opportunity-form-stack">
              <div className="opportunity-form-grid">
	                <div className="opportunity-deal-panel">
	                  <span className="opportunity-field-label">Quyết định BD</span>
                    {isClosed ? (
                      <div className={isLost ? "opportunity-deal-confirmed lost" : "opportunity-deal-confirmed won"}>
                        <ShopifyIcon name={isLost ? "x" : "check"} size={15} />
                        <strong>{closedOutcomeLabel}</strong>
                        <span>{selected.closedAt ? formatDisplayDate(selected.closedAt) : formatDisplayDate(selected.stageEnteredAt)}</span>
                      </div>
                    ) : (
                      <div className="opportunity-deal-toggle" role="group" aria-label="Xác nhận kết quả deal">
	                        <button
	                          disabled={loading}
                          onClick={() => openConfirm({
                            confirmLabel: "Xác nhận thắng deal",
                            description: "BD xác nhận thương vụ đã thắng. Sau bước này, hệ thống mới cho bàn giao khi checklist sẵn sàng.",
                            onConfirm: (reason) => closeOpportunity("won", reason),
                            reason: {
                              label: "Lý do thắng",
                              options: SALES_WON_REASONS.map((reason) => ({ value: reason.code, label: reason.label })),
                              required: true
                            },
                            title: "Thắng deal này?"
                          })}
                          type="button"
                        >
                          <ShopifyIcon name="check" size={14} />
                          Thắng deal
                        </button>
                        <button
                          className="danger"
                          disabled={loading}
                          onClick={() => openConfirm({
                            confirmLabel: "Xác nhận thua deal",
                            description: "BD xác nhận thương vụ đã thua. Lý do thua sẽ được lưu để theo dõi chất lượng pipeline.",
                            onConfirm: (reason) => closeOpportunity("lost", reason),
                            reason: {
                              label: "Lý do thua",
                              options: SALES_LOST_REASONS.map((reason) => ({ value: reason.code, label: reason.label })),
                              required: true
                            },
                            tone: "danger",
                            title: "Thua deal này?"
                          })}
                          type="button"
                        >
                          <ShopifyIcon name="x" size={14} />
                          Thua deal
                        </button>
                      </div>
                    )}
	                </div>

	                <div>
                  {isClosed ? (
                      <div className="opportunity-lost-reason-card">
                        <span className="opportunity-field-label">Lý do chốt</span>
                        <strong>{selected.closeReason ? formatTaxonomyLabel(selected.closeReason.replace("close_won:", "").replace("close_lost:", "")) : "Chưa ghi nhận"}</strong>
                      </div>
                  ) : (
                    <div className="opportunity-decision-support">
                      <div className="opportunity-handoff-checklist">
                        <div className="opportunity-handoff-checklist-header">
                          <label>Điều kiện bàn giao</label>
                          <span>{completedHandoffCriteria}/4 sẵn sàng</span>
                        </div>
                        <div className="opportunity-checklist-stack">
                          <Checklist disabled={isLost} label="Phạm vi thương mại" checked={closeDraft.commercialScope} onChange={(checked) => setCloseDraft((current) => ({ ...current, commercialScope: checked }))} />
                          <Checklist disabled={isLost} label="SOW đã ký" checked={closeDraft.signedSow} onChange={(checked) => setCloseDraft((current) => ({ ...current, signedSow: checked }))} />
                          <Checklist disabled={isLost} label="Đã có người kickoff" checked={closeDraft.kickoffOwner} onChange={(checked) => setCloseDraft((current) => ({ ...current, kickoffOwner: checked }))} />
                          <Checklist disabled={isLost} label="Billing sẵn sàng" checked={closeDraft.billingReady} onChange={(checked) => setCloseDraft((current) => ({ ...current, billingReady: checked }))} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="premium-card opportunity-context-card">
          <div className="opportunity-tab-list" role="tablist" aria-label="Ngữ cảnh cơ hội">
            <TabHeader
              active={activeTab === "overview"}
              onClick={() => handleTabChange("overview")}
              label="Tổng quan"
              icon={<ShopifyIcon name="info" size={14} />}
            />
            <TabHeader
              active={activeTab === "activities"}
              onClick={() => handleTabChange("activities")}
              label={`Hoạt động (${activities.length})`}
              icon={<ShopifyIcon name="check" size={14} />}
            />
            <TabHeader
              active={activeTab === "finance"}
              onClick={() => handleTabChange("finance")}
              label="Tín hiệu tài chính"
              icon={<ShopifyIcon name="cash" size={14} />}
            />
          </div>
          
          <div className="opportunity-tab-panel">
            {activeTab === "overview" && (
              <div className="opportunity-overview">
                <div className="opportunity-summary-block">
                  <h3>Tóm tắt thương vụ</h3>
                  <p>
                    Giai đoạn <strong>{formatStageLabel(selected.stage)}</strong>, xác suất <strong>{formatNumber(displayProbability)}%</strong>, phụ trách bởi <strong>{opportunityOwner}</strong>, việc tiếp theo <strong>{selected.nextActivityAt ? formatDisplayDate(selected.nextActivityAt) : "chưa có"}</strong>.
                  </p>
                </div>

                <div className="opportunity-stage-block">
                  <span className="opportunity-card-eyebrow">Tiến trình bán hàng</span>
                  <div className="opportunity-stage-progress">
                    <div className="opportunity-stage-rail" aria-hidden="true">
                      <span className="opportunity-stage-line" />
                      <span className="opportunity-stage-line active" style={{ width: `${stageProgress.activeLinePercent}%` }} />
                      <div className="opportunity-stage-durations">
                        {stageProgress.durations.map((duration) => (
                          <span className={duration.label ? "opportunity-stage-duration" : "opportunity-stage-duration empty"} key={duration.key}>
                            {duration.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {stageProgress.steps.map((step, idx) => (
                        <div aria-label={`${step.label}: ${step.ariaState}${step.dateLabel ? `, ${step.dateLabel}` : ""}`} className={`opportunity-stage-step ${step.state}`} key={step.stage}>
                          <div className="opportunity-stage-dot">
                            {step.state === "past" ? (
                              <ShopifyIcon name="check" size={12} />
                            ) : idx + 1}
                          </div>
                          <span>{step.label}</span>
                          {step.dateLabel ? <small>{step.dateLabel}</small> : null}
                        </div>
                    ))}
                  </div>
                </div>

                <div className="opportunity-timeline-block">
                  <div className="opportunity-section-head">
                    <span className="opportunity-card-eyebrow">
                      <ShopifyIcon name="clock" size={14} />
                      Timeline cơ hội
                    </span>
                    <span>{timelineItems.length} mốc</span>
                  </div>
                  <div className="opportunity-timeline">
                    {timelineItems.map((item) => (
                      <div className="opportunity-timeline-item" key={item.id}>
                        <span className="opportunity-timeline-dot" />
                        <div className="opportunity-timeline-avatar" aria-hidden="true">
                          {getInitials(item.owner)}
                        </div>
                        <div className="opportunity-timeline-body">
                          <div className="opportunity-timeline-main">
                            <strong>{item.title}</strong>
                            <span className="opportunity-timeline-date">{item.date}</span>
                          </div>
                          <div className="opportunity-timeline-meta">
                            <span>{item.description}</span>
                            <span>Phụ trách: <strong>{item.owner}</strong></span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className={isHandoffReady ? "opportunity-readiness-card ready" : "opportunity-readiness-card"}>
                  <div>
                    <strong>Sẵn sàng bàn giao</strong>
                    <span>{completedHandoffCriteria}/4 sẵn sàng</span>
                  </div>
                  <p>{handoffBlockedReason}</p>
                </div>
              </div>
            )}
            
            {/* Activities Tab */}
            {activeTab === "activities" && (
              <div className="opportunity-activity-panel">
                <div className="opportunity-inline-form">
                  <div className="opportunity-section-head">
                    <span className="opportunity-card-eyebrow">
                      <ShopifyIcon name="plus" size={14} />
                      Thêm hoạt động
                    </span>
                    <span>{activities.length} hoạt động</span>
                  </div>

                  <div className="opportunity-form-grid">
                    <CustomDropdown
                      label="Loại"
                      value={activityDraft.type}
                      options={activityTypes.map((type) => ({ value: type, label: formatActivityType(type) }))}
                      onChange={(val) => setActivityDraft((current) => ({ ...current, type: val }))}
                    />
                    <PipelineDateField
                      label="Hạn xử lý"
                      onChange={(value) => setActivityDraft((current) => ({ ...current, dueAt: value }))}
                      value={activityDraft.dueAt}
                    />
                  </div>
                  
                  <PipelineTextField
                    label="Tiêu đề"
                    onChange={(value) => setActivityDraft((current) => ({ ...current, subject: value }))}
                    placeholder="Ví dụ: Gọi xác nhận bước tiếp theo"
                    value={activityDraft.subject}
                  />

                  <CustomDropdown
                    label="Lý do chậm"
                    value={activityDraft.delayReason ?? ""}
                    options={[
                      { value: "", label: "Không có lý do chậm" },
                      ...SALES_DELAY_REASONS.map((reason) => ({ value: reason.code, label: reason.label }))
                    ]}
                    onChange={(val) => setActivityDraft((current) => ({ ...current, delayReason: val }))}
                  />
                  
                  <PipelineTextArea
                    label="Ghi chú"
                    onChange={(value) => setActivityDraft((current) => ({ ...current, note: value }))}
                    placeholder="Ghi chú ngắn cho lần chăm sóc tiếp theo"
                    value={activityDraft.note}
                  />
                  
                  <button className="pipeline-command-button primary" disabled={loading} onClick={createActivity} type="button">
                    <ShopifyIcon name="plus" size={15} />
                    <span>Thêm hoạt động</span>
                  </button>
                </div>
                
                <div className="opportunity-activity-list">
                  {activities.length ? (
                    activities.map((activity) => (
                      <article className="opportunity-activity-card" key={activity.id}>
                        <div className="opportunity-activity-icon" aria-hidden="true">
                          {getActivityIcon(activity.type)}
                        </div>
                        <div className="opportunity-activity-body">
                          <strong>{formatActivitySubject(activity.subject)}</strong>
                          <span>
                            {formatActivityType(activity.type)}
                            {activity.dueAt ? ` • Hạn: ${new Date(activity.dueAt).toLocaleDateString("vi-VN")}` : ""}
                          </span>
                          {activity.note && (
                            <p>{formatActivityNote(activity.note)}</p>
                          )}
                        </div>
                        <span className={activity.status === "completed" ? "opportunity-status-pill done" : "opportunity-status-pill"}>
                          {formatActivityStatus(activity.status)}
                        </span>
                      </article>
                    ))
                  ) : (
                    <div className="opportunity-empty-state">
                      Chưa có hoạt động.
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Finance Tab */}
            {activeTab === "finance" && (
              <div className="opportunity-finance-panel">
                {financeLoading ? (
                  <div className="opportunity-empty-state">
                    Đang tải tín hiệu tài chính...
                  </div>
                ) : (
                  <>
                    <div className="opportunity-finance-section">
                      {paymentSchedules.length ? (
                        <div className="opportunity-finance-action-grid">
                          <div className="opportunity-finance-form-card">
                            <div className="opportunity-section-head">
                              <span className="opportunity-card-eyebrow">
                                <ShopifyIcon name="plus" size={14} />
                                Cập nhật lịch thu
                              </span>
                              <span>Thêm mốc thu mới</span>
                            </div>
                            <CustomDropdown
                              label="Lịch thu"
                              value={financeMilestoneDraft.scheduleId || paymentSchedules[0]?.id || ""}
                              options={paymentScheduleOptions}
                              onChange={(value) => setFinanceMilestoneDraft((current) => ({ ...current, scheduleId: value }))}
                            />
                            <div className="opportunity-form-grid">
                              <PipelineTextField
                                label="Tên mốc thu"
                                onChange={(value) => setFinanceMilestoneDraft((current) => ({ ...current, label: value }))}
                                placeholder="Ví dụ: Thanh toán nghiệm thu"
                                value={financeMilestoneDraft.label}
                              />
                              <label className="pipeline-field">
                                <span className="pipeline-field-label">Số tiền</span>
                                <div className="pipeline-input-shell">
                                  <input
                                    className="pipeline-input"
                                    inputMode="numeric"
                                    onChange={(event) => setFinanceMilestoneDraft((current) => ({ ...current, amount: formatVndInput(event.target.value) }))}
                                    placeholder="80.000.000"
                                    type="text"
                                    value={financeMilestoneDraft.amount}
                                  />
                                  <span>đ</span>
                                </div>
                              </label>
                            </div>
                            <PipelineDateField
                              label="Hạn thu"
                              onChange={(value) => setFinanceMilestoneDraft((current) => ({ ...current, dueAt: value }))}
                              value={financeMilestoneDraft.dueAt}
                            />
                            <Checklist
                              checked={financeMilestoneDraft.customerVisible}
                              label="Hiển thị với khách hàng"
                              onChange={(checked) => setFinanceMilestoneDraft((current) => ({ ...current, customerVisible: checked }))}
                            />
                            <button className="pipeline-command-button primary" disabled={financeLoading || !canAddMilestone} onClick={addPaymentMilestone} type="button">
                              <ShopifyIcon name="plus" size={15} />
                              <span>Thêm mốc thu</span>
                            </button>
                          </div>

                          <div className="opportunity-finance-form-card">
                            <div className="opportunity-section-head">
                              <span className="opportunity-card-eyebrow">
                                <ShopifyIcon name="cash" size={14} />
                                Bằng chứng thanh toán
                              </span>
                              <span>{milestoneOptions.length} mốc</span>
                            </div>
                            <CustomDropdown
                              label="Mốc thu"
                              value={paymentEvidenceDraft.milestoneId || milestoneOptions[0]?.value || ""}
                              options={milestoneOptions.length ? milestoneOptions : [{ value: "", label: "Chưa có mốc thu" }]}
                              onChange={(value) => {
                                const option = milestoneOptions.find((milestone) => milestone.value === value);
                                setPaymentEvidenceDraft((current) => ({
                                  ...current,
                                  milestoneId: value,
                                  invoiceId: option?.invoiceId ?? ""
                                }));
                              }}
                            />
                            <CustomDropdown
                              label="Loại bằng chứng"
                              value={paymentEvidenceDraft.evidenceType}
                              options={evidenceTypeOptions}
                              onChange={(value) => setPaymentEvidenceDraft((current) => ({ ...current, evidenceType: value }))}
                            />
                            <PipelineTextField
                              label="Tên chứng từ"
                              onChange={(value) => setPaymentEvidenceDraft((current) => ({ ...current, title: value }))}
                              placeholder="Ví dụ: Ủy nhiệm chi kickoff"
                              value={paymentEvidenceDraft.title}
                            />
                            <PipelineTextField
                              label="Link chứng từ"
                              onChange={(value) => setPaymentEvidenceDraft((current) => ({ ...current, externalUrl: value }))}
                              placeholder="https://..."
                              value={paymentEvidenceDraft.externalUrl}
                            />
                            {selectedEvidenceMilestone?.invoiceId ? (
                              <span className="opportunity-field-hint">Bằng chứng sẽ gắn với mốc thu đang chọn.</span>
                            ) : null}
                            <Checklist
                              checked={paymentEvidenceDraft.customerVisible}
                              label="Khách hàng được xem"
                              onChange={(checked) => setPaymentEvidenceDraft((current) => ({ ...current, customerVisible: checked }))}
                            />
                            <button className="pipeline-command-button primary" disabled={financeLoading || !canAddEvidence} onClick={addPaymentEvidence} type="button">
                              <ShopifyIcon name="cash" size={15} />
                              <span>Đính kèm bằng chứng</span>
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="opportunity-section-head">
                        <span className="opportunity-card-eyebrow">
                          <ShopifyIcon name="cash" size={14} />
                          Lịch thanh toán
                        </span>
                        <span>{paymentSchedules.length} lịch</span>
                      </div>
                      {paymentSchedules.length ? (
                        paymentSchedules.map((schedule) => {
                          const totalAmt = (schedule.paidAmount ?? 0) + (schedule.outstandingAmount ?? 0);
                          const paidPercent = totalAmt > 0 ? Math.round(((schedule.paidAmount ?? 0) / totalAmt) * 100) : 0;
                          return (
                            <article className="opportunity-finance-card" key={schedule.id}>
                              <div className="opportunity-finance-card-head">
                                <div>
                                  <strong>{formatFinanceLabel(schedule.title)}</strong>
                                  <span>
                                    Còn phải thu: <strong style={{ color: "var(--text)" }}>{formatOptionalVnd(schedule.outstandingAmount)}</strong> • Đã thu: {formatOptionalVnd(schedule.paidAmount)}
                                  </span>
                                </div>
                                <span className={schedule.overdueAmount ? "opportunity-status-pill warning" : "opportunity-status-pill done"}>
                                  {formatPaymentStatus(schedule.status)}
                                </span>
                              </div>
                              
                              <div className="opportunity-progress-block">
                                <div>
                                  <span>Tiến độ thu</span>
                                  <span>{paidPercent}%</span>
                                </div>
                                <div className="opportunity-progress-track">
                                  <span style={{ width: `${paidPercent}%` }} />
                                </div>
                              </div>

                              {schedule.milestones?.length && (
                                <div className="opportunity-milestone-list">
                                  <span>Milestone</span>
                                  {schedule.milestones.map((m) => (
                                    <div key={m.id}>
                                      <span>• {formatFinanceLabel(m.label)} {m.dueAt ? `(hạn: ${new Date(m.dueAt).toLocaleDateString("vi-VN")})` : ""}</span>
                                      <span className={m.paymentStatus === "unpaid" ? "opportunity-status-pill" : "opportunity-status-pill done"}>{formatPaymentStatus(m.paymentStatus)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </article>
                          );
                        })
                      ) : (
                        <div className="opportunity-empty-state">Chưa liên kết lịch thanh toán.</div>
                      )}
                    </div>
                    
                    <div className="opportunity-finance-section">
                      <div className="opportunity-section-head">
                        <span className="opportunity-card-eyebrow">
                          <ShopifyIcon name="alert" size={14} />
                          Tuổi nợ phải thu
                        </span>
                        <span>{arAging.length} khoản</span>
                      </div>
                      {arAging.length ? (
                        arAging.map((item) => (
                          <article
                            className="opportunity-receivable-card"
                            key={`${item.milestoneId}-${item.invoiceId ?? item.code}`}
                          >
                            <div>
                              <div className="opportunity-receivable-icon" aria-hidden="true">
                                <ShopifyIcon name="alert" size={18} />
                              </div>
                              <div>
                                <strong>{formatFinanceLabel(item.label)}</strong>
                                <span>
                                  Còn phải thu: <strong style={{ color: "var(--text)" }}>{formatOptionalVnd(item.outstandingAmount)}</strong> • Trễ: <span style={{ color: "var(--danger)", fontWeight: 700 }}>{formatNumber(item.daysOverdue)} ngày</span>
                                </span>
                              </div>
                            </div>
                            <span className="opportunity-status-pill danger">Quá hạn</span>
                          </article>
                        ))
                      ) : (
                        <div className="opportunity-empty-state">Không có khoản phải thu quá hạn.</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            
          </div>
        </div>

      </div>
      <ConfirmActionDialog dialog={confirmDialog} loading={loading || financeLoading} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}

type ConfirmDialogState = {
  confirmLabel: string;
  description: string;
  onConfirm: (reason?: string) => void | Promise<void>;
  reason?: {
    label: string;
    options: SelectOption[];
    required?: boolean;
  };
  title: string;
  tone?: "danger";
};

function ConfirmActionDialog({
  dialog,
  loading,
  onClose
}: {
  dialog: ConfirmDialogState | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [selectedReason, setSelectedReason] = useState("");

  useEffect(() => {
    setSelectedReason("");
  }, [dialog?.title]);

  if (!dialog) return null;

  const reasonMissing = Boolean(dialog.reason?.required && !selectedReason);

  return (
    <ModalLayer closeOnEscape={!loading} onClose={onClose}>
    <div className="opportunity-confirm-backdrop" role="presentation">
      <div aria-label={dialog.title} aria-modal="true" className="opportunity-confirm-dialog" role="dialog" tabIndex={-1}>
        <div className="opportunity-confirm-header">
          <strong>{dialog.title}</strong>
          <button aria-label="Đóng xác nhận" disabled={loading} onClick={onClose} type="button">
            <ShopifyIcon name="x" size={16} />
          </button>
        </div>
        <div className="opportunity-confirm-modal">
          <p>{dialog.description}</p>
          {dialog.reason ? (
            <CustomDropdown
              label={dialog.reason.label}
              onChange={setSelectedReason}
              options={dialog.reason.options}
              value={selectedReason}
            />
          ) : null}
          {reasonMissing ? <span className="opportunity-confirm-required">Chọn lý do trước khi xác nhận.</span> : null}
          <div className="pipeline-modal-actions">
            <button className="pipeline-command-button" disabled={loading} onClick={onClose} type="button">
              Hủy
            </button>
            <button
              className={dialog.tone === "danger" ? "pipeline-command-button destructive strong" : "pipeline-command-button primary"}
              disabled={loading || reasonMissing}
              onClick={async () => {
                await dialog.onConfirm(selectedReason || undefined);
                onClose();
              }}
              type="button"
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalLayer>
  );
}

function DetailField({ label, value, isAlert = false }: { label: string; value: string; isAlert?: boolean }) {
  return (
    <div className="opportunity-detail-field">
      <span>{label}</span>
      <strong className={isAlert ? "critical" : undefined}>{value}</strong>
    </div>
  );
}

function TabHeader({
  active,
  onClick,
  label,
  icon
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button 
      aria-selected={active}
      className="opportunity-tab-button"
      onClick={onClick}
      role="tab"
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function formatOptionalVnd(value?: number) {
  return value === undefined || Number.isNaN(value) ? "Bị giới hạn" : <MoneyAmount value={value} />;
}

function formatDisplayDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function Checklist({
  checked,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="opportunity-checkbox" data-disabled={disabled}>
      <input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span aria-hidden="true">{checked ? <ShopifyIcon name="check" size={13} /> : null}</span>
      <strong>{label}</strong>
    </label>
  );
}

function getInitials(name?: string) {
  if (!name) return "SYS";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getActivityIcon(type: string) {
  switch (type) {
    case "follow_up":
      return <ShopifyIcon name="clock" size={16} />;
    case "meeting":
      return <ShopifyIcon name="users" size={16} />;
    case "proposal":
      return <ShopifyIcon name="list" size={16} />;
    case "handoff":
      return <ShopifyIcon name="handoff" size={16} />;
    case "risk_review":
      return <ShopifyIcon name="alert" size={16} />;
    default:
      return <ShopifyIcon name="plus" size={16} />;
  }
}

function InlineMetricShell({
  children,
  label,
  wide = false
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "opportunity-detail-field inline-edit wide" : "opportunity-detail-field inline-edit"}>
      <span>{label}</span>
      {children}
    </div>
  );
}

type SelectOption = { label: string; value: string; [key: string]: unknown };

function CustomDropdown({
  disabled = false,
  label,
  value,
  options,
  onChange,
  renderOption,
  visuallyHiddenLabel = false
}: {
  disabled?: boolean;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  renderOption?: (opt: SelectOption) => ReactNode;
  visuallyHiddenLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listboxId = toStableControlId("opportunity-select", label);
  const selectedOpt = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;

    function closeOnOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="opportunity-custom-field" data-open={open} ref={wrapperRef}>
      <span className={visuallyHiddenLabel ? "sr-only" : "opportunity-field-label"}>{label}</span>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selectedOpt?.label ?? "Chưa chọn"}`}
        className="opportunity-select-trigger"
        disabled={disabled}
        data-open={open}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        type="button"
      >
        <span>
          {selectedOpt ? (renderOption ? renderOption(selectedOpt) : selectedOpt.label) : "Chưa chọn"}
        </span>
        <ShopifyIcon
          name="chevron-down"
          size={14}
          className={open ? "opportunity-dropdown-icon open" : "opportunity-dropdown-icon"}
        />
      </button>

      {open && !disabled && (
        <div className="opportunity-select-menu" id={listboxId} role="listbox">
          {options.map((opt) => (
            <button
              aria-selected={opt.value === value}
              className="opportunity-select-option"
              data-selected={opt.value === value}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{renderOption ? renderOption(opt) : opt.label}</span>
              {opt.value === value ? <ShopifyIcon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineTextField({
  disabled = false,
  label,
  onChange,
  placeholder,
  value,
  visuallyHiddenLabel = false
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
  visuallyHiddenLabel?: boolean;
}) {
  return (
    <label className="opportunity-custom-field">
      <span className={visuallyHiddenLabel ? "sr-only" : "opportunity-field-label"}>{label}</span>
      <input className="pipeline-input" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </label>
  );
}

function PipelineNumberField({
  disabled = false,
  label,
  max,
  min,
  onChange,
  value,
  visuallyHiddenLabel = false
}: {
  disabled?: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: string) => void;
  value: string;
  visuallyHiddenLabel?: boolean;
}) {
  return (
    <label className="opportunity-custom-field">
      <span className={visuallyHiddenLabel ? "sr-only" : "opportunity-field-label"}>{label}</span>
      <input
        className="pipeline-input"
        disabled={disabled}
        inputMode="decimal"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

function PipelineTextArea({
  disabled = false,
  label,
  onChange,
  placeholder,
  value
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="opportunity-custom-field">
      <span className="opportunity-field-label">{label}</span>
      <textarea className="pipeline-input pipeline-textarea" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </label>
  );
}

function PipelineDateField({
  disabled = false,
  label,
  onChange,
  value,
  visuallyHiddenLabel = false
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
  visuallyHiddenLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = parseInputDate(value);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? new Date());
  const calendarId = toStableControlId("opportunity-calendar", label);
  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);

  useEffect(() => {
    if (selectedDate) {
      setVisibleMonth(selectedDate);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="opportunity-custom-field" data-open={open} ref={wrapperRef}>
      <span className={visuallyHiddenLabel ? "sr-only" : "opportunity-field-label"}>{label}</span>
      <button
        aria-controls={calendarId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${value ? formatDisplayDate(value) : "Chưa chọn"}`}
        className="opportunity-date-trigger"
        data-empty={!value}
        data-open={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        type="button"
      >
        <span>
          <ShopifyIcon name="calendar" size={14} />
          {value ? formatDisplayDate(value) : "Chọn ngày"}
        </span>
        <ShopifyIcon className="opportunity-dropdown-icon" name="chevron-down" size={14} />
      </button>

      {open && !disabled ? (
        <div className="opportunity-calendar-popover" id={calendarId} role="dialog">
          <div className="opportunity-calendar-header">
            <button aria-label="Tháng trước" onClick={() => setVisibleMonth((current) => addMonths(current, -1))} type="button">
              <ShopifyIcon name="chevron-left" size={14} />
            </button>
            <strong>{formatMonthTitle(visibleMonth)}</strong>
            <button aria-label="Tháng sau" onClick={() => setVisibleMonth((current) => addMonths(current, 1))} type="button">
              <ShopifyIcon name="chevron-right" size={14} />
            </button>
          </div>
          <div className="opportunity-calendar-weekdays" aria-hidden="true">
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="opportunity-calendar-grid">
            {days.map((date) => {
              const isMuted = date.getMonth() !== visibleMonth.getMonth();
              const isSelected = Boolean(selectedDate && sameDate(date, selectedDate));
              return (
                <button
                  aria-label={`Chọn ${formatDisplayDate(toInputDate(date))}`}
                  className="opportunity-calendar-day"
                  data-muted={isMuted}
                  data-selected={isSelected}
                  key={toInputDate(date)}
                  onClick={() => {
                    onChange(toInputDate(date));
                    setOpen(false);
                  }}
                  type="button"
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getOpportunityOwner(selected: NonNullable<OpportunityWorkbench["state"]["selected"]>) {
  if (selected.ownerDisplayName) {
    return selected.ownerDisplayName;
  }

  const latestNamedHistory = [...(selected.stageHistory ?? [])]
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
    .find((item) => item.changedByUserDisplayName);

  return latestNamedHistory?.changedByUserDisplayName ?? "Sales Owner";
}

function toStableControlId(prefix: string, label: string) {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${prefix}-${slug || "field"}`;
}

function getOwnerOptions(
  salesOwners: OpportunityWorkbench["state"]["salesOwners"],
  opportunities: OpportunityWorkbench["state"]["opportunities"],
  selected: NonNullable<OpportunityWorkbench["state"]["selected"]>
) {
  const options = new Map<string, string>();
  const addOwner = (ownerUserId?: string, ownerDisplayName?: string) => {
    if (!ownerUserId || !ownerDisplayName) {
      return;
    }

    options.set(ownerUserId, ownerDisplayName);
  };

  salesOwners.forEach((owner) => addOwner(owner.id, owner.displayName));
  opportunities.forEach((opportunity) => addOwner(opportunity.ownerUserId, opportunity.ownerDisplayName));
  addOwner(selected.ownerUserId, selected.ownerDisplayName);

  return Array.from(options, ([value, label]) => ({ value, label }));
}

function getSourceOptions(
  leads: OpportunityWorkbench["state"]["leads"],
  selected: NonNullable<OpportunityWorkbench["state"]["selected"]>
) {
  const options = new Map<string, string>();
  options.set("direct", "Tạo trực tiếp");

  leads
    .filter((lead) => lead.accountId === selected.accountId && lead.status !== "disqualified")
    .forEach((lead) => {
      const label = lead.contactName
        ? `Tạo từ lead: ${lead.contactName}`
        : `Tạo từ lead: ${lead.companyName}`;
      options.set(lead.id, label);
    });

  if (selected.leadId && !options.has(selected.leadId)) {
    options.set(selected.leadId, "Tạo từ lead hiện tại");
  }

  return Array.from(options, ([value, label]) => ({ value, label }));
}

function getOpportunityTimeline(selected: NonNullable<OpportunityWorkbench["state"]["selected"]>) {
  const owner = getOpportunityOwner(selected);
  const historyItems = (selected.stageHistory ?? [])
    .slice()
    .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime())
    .map((item) => ({
      date: formatDisplayDate(item.changedAt),
      description: `${item.fromStage ? formatStageLabel(item.fromStage) : "Lead mới"} chuyển sang ${formatStageLabel(item.toStage)}${item.reason ? `, ${formatTimelineReason(item.reason)}` : ""}.`,
      id: item.id,
      owner: item.changedByUserDisplayName ?? owner,
      title: "Đổi giai đoạn"
    }));

  const currentStageAlreadyShown = historyItems.some((item) => item.description.includes(formatStageLabel(selected.stage)));
  const currentItem = {
    date: formatDisplayDate(selected.stageEnteredAt),
    description: `Đang ở ${formatStageLabel(selected.stage)} trong ${formatNumber(selected.stageAgeDays)} ngày.`,
    id: `${selected.id}-current-stage`,
    owner,
    title: "Giai đoạn hiện tại"
  };

  return currentStageAlreadyShown ? historyItems : [...historyItems, currentItem];
}

function getStageProgress(selected: NonNullable<OpportunityWorkbench["state"]["selected"]>) {
  const currentStage = selected.stage.toLowerCase();
  const stageDates = new Map<string, Date>();
  const stageCompletionDates = new Map<string, Date>();
  const sortedHistory = (selected.stageHistory ?? [])
    .slice()
    .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());

  sortedHistory.forEach((item) => {
    const date = parseDateSafe(item.changedAt);
    if (date) {
      const toStage = item.toStage.toLowerCase();
      const fromStage = item.fromStage?.toLowerCase();
      stageDates.set(toStage, date);
      if (fromStage && VISIBLE_PIPELINE_STAGES.includes(fromStage)) {
        stageCompletionDates.set(fromStage, date);
      }
      if (toStage === "won" || toStage === "lost") {
        stageCompletionDates.set(toStage, date);
      }
    }
  });

  const selectedStageDate = parseDateSafe(selected.stageEnteredAt);
  if (selectedStageDate) {
    stageDates.set(currentStage, selectedStageDate);
  }

  const visibleCurrentIndex = VISIBLE_PIPELINE_STAGES.indexOf(currentStage);
  const latestVisibleHistoryIndex = sortedHistory.reduce((latest, item) => {
    const index = VISIBLE_PIPELINE_STAGES.indexOf(item.toStage.toLowerCase());
    return index === -1 ? latest : Math.max(latest, index);
  }, 0);
  const currentIndex = visibleCurrentIndex === -1 ? latestVisibleHistoryIndex : visibleCurrentIndex;
  const activePercent = currentIndex <= 0 ? 0 : (currentIndex / (VISIBLE_PIPELINE_STAGES.length - 1)) * 100;
  const activeLinePercent = currentIndex <= 0 ? 0 : (currentIndex / (VISIBLE_PIPELINE_STAGES.length - 1)) * (100 - 100 / VISIBLE_PIPELINE_STAGES.length);

  const steps = VISIBLE_PIPELINE_STAGES.map((stage, index) => {
    const isCurrent = index === currentIndex && visibleCurrentIndex !== -1;
    const isPast = index < currentIndex || currentStage === "won";
    const state = isCurrent ? "current" : isPast ? "past" : "future";
    const date = stageDates.get(stage);
    const completedDate = stageCompletionDates.get(stage);
    const fallbackCompletedDate = isPast ? findNearestKnownStageDate(stage, stageDates, stageCompletionDates) : undefined;
    const dateLabel = getStageDateLabel({
      completedDate,
      currentStage,
      date,
      fallbackCompletedDate,
      isCurrent,
      isPast,
      selected,
      stage
    });
    const ariaState = isCurrent ? "giai đoạn hiện tại" : isPast ? "đã hoàn tất" : "chưa tới";

    return {
      ariaState,
      dateLabel,
      label: formatStageLabel(stage),
      stage,
      state
    };
  });

  const durations = VISIBLE_PIPELINE_STAGES.slice(0, -1).map((stage, index) => {
    const nextStage = VISIBLE_PIPELINE_STAGES[index + 1];
    const startDate = stageDates.get(stage);
    const nextDate = stageDates.get(nextStage);
    const isCurrentSegment = index === currentIndex && currentStage !== "won" && currentStage !== "lost";
    const label = startDate && nextDate
      ? formatDurationLabel(daysBetween(startDate, nextDate))
      : startDate && isCurrentSegment
      ? formatDurationLabel(selected.stageAgeDays)
      : "";

    return {
      key: `${stage}-${nextStage}`,
      label
    };
  });

  return { activeLinePercent, activePercent, durations, steps };
}

function getStageDateLabel({
  completedDate,
  currentStage,
  date,
  fallbackCompletedDate,
  isCurrent,
  isPast,
  selected,
  stage
}: {
  completedDate?: Date;
  currentStage: string;
  date?: Date;
  fallbackCompletedDate?: Date;
  isCurrent: boolean;
  isPast: boolean;
  selected: NonNullable<OpportunityWorkbench["state"]["selected"]>;
  stage: string;
}) {
  if (stage === "won" && currentStage === "won") {
    const closedDate = parseDateSafe(selected.closedAt ?? selected.stageEnteredAt);
    return closedDate ? `Xong ${formatDisplayDate(toInputDate(closedDate))}` : "";
  }

  if (isCurrent) {
    return date ? `Từ ${formatDisplayDate(toInputDate(date))}` : "";
  }

  if (isPast) {
    if (completedDate) return `Xong ${formatDisplayDate(toInputDate(completedDate))}`;
    if (fallbackCompletedDate) return `Xong trước ${formatDisplayDate(toInputDate(fallbackCompletedDate))}`;
  }

  return date ? `Xong ${formatDisplayDate(toInputDate(date))}` : "";
}

function findNearestKnownStageDate(stage: string, stageDates: Map<string, Date>, stageCompletionDates: Map<string, Date>) {
  const stageIndex = VISIBLE_PIPELINE_STAGES.indexOf(stage);
  if (stageIndex === -1) return undefined;

  for (let index = stageIndex + 1; index < VISIBLE_PIPELINE_STAGES.length; index += 1) {
    const nextStage = VISIBLE_PIPELINE_STAGES[index];
    const date = stageDates.get(nextStage) ?? stageCompletionDates.get(nextStage);
    if (date) return date;
  }

  return undefined;
}

function parseDateSafe(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function daysBetween(startDate: Date, endDate: Date) {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function formatDurationLabel(days: number) {
  return days <= 0 ? "Trong ngày" : `${formatNumber(days)} ngày`;
}

function formatActivityType(type: string) {
  const labels: Record<string, string> = {
    follow_up: "Chăm sóc tiếp",
    handoff: "Bàn giao",
    meeting: "Cuộc họp",
    proposal: "Báo giá/SOW",
    proposal_sent: "Đã gửi báo giá",
    risk_review: "Rà soát rủi ro"
  };

  return labels[type] ?? formatForecastCategory(type);
}

function formatTimelineReason(reason: string) {
  const labels: Record<string, string> = {
    close_won_bd_confirmed: "BD xác nhận thắng deal",
    close_won_handoff_validated: "đã đủ điều kiện bàn giao",
    policy_scoped_stage_update: "cập nhật từ form cơ hội"
  };

  if (reason.startsWith("close_won:")) {
    return `BD xác nhận thắng deal: ${formatTaxonomyLabel(reason.replace("close_won:", ""))}`;
  }

  if (reason.startsWith("close_lost:")) {
    return `BD xác nhận thua deal: ${formatTaxonomyLabel(reason.replace("close_lost:", ""))}`;
  }

  return labels[reason] ?? formatTaxonomyLabel(reason);
}

function formatActivitySubject(subject: string) {
  const labels: Record<string, string> = {
    "Confirm delivery owner": "Xác nhận người phụ trách triển khai",
    "Confirm delivery kickoff evidence": "Xác nhận bằng chứng kickoff triển khai",
    "Proposal package sent to customer": "Đã gửi bộ báo giá cho khách hàng"
  };

  return labels[subject] ?? subject;
}

function formatActivityNote(note: string) {
  const labels: Record<string, string> = {
    "Sales to delivery packet needs final SOW link.": "Gói bàn giao cần bổ sung liên kết SOW cuối cùng.",
    "smoke send from Codex": "Đã ghi nhận thử gửi từ hệ thống."
  };

  return labels[note] ?? note;
}

function formatActivityStatus(status: string) {
  const labels: Record<string, string> = {
    completed: "Đã xong",
    open: "Đang mở",
    pending: "Đang chờ",
    planned: "Đã lên lịch"
  };

  return labels[status] ?? formatForecastCategory(status);
}

function formatPaymentStatus(status: string) {
  const labels: Record<string, string> = {
    approved: "Đã duyệt",
    active: "Đang hiệu lực",
    cancelled: "Đã hủy",
    draft: "Nháp",
    overdue: "Quá hạn",
    paid: "Đã thu",
    partially_paid: "Thu một phần",
    pending: "Đang chờ",
    unpaid: "Chưa thu"
  };

  return labels[status] ?? formatForecastCategory(status);
}

function formatEvidenceType(type: string) {
  const labels: Record<string, string> = {
    acceptance_evidence: "Biên bản nghiệm thu",
    bank_transfer: "Chuyển khoản",
    customer_confirmation: "Khách hàng xác nhận",
    exception_approval: "Duyệt ngoại lệ",
    invoice_file: "Hóa đơn",
    other: "Khác",
    payment_receipt: "Biên nhận thanh toán"
  };

  return labels[type] ?? formatForecastCategory(type);
}

function formatFinanceLabel(label: string) {
  const labels: Record<string, string> = {
    "Alpha CRM/ERP phase 1 payment schedule": "Lịch thu Alpha CRM/ERP phase 1",
    "Go-live acceptance payment": "Thanh toán nghiệm thu go-live",
    "Kickoff payment": "Thanh toán kickoff"
  };

  return labels[label] ?? label;
}

function parseInputDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toInputDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function sameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatMonthTitle(date: Date) {
  return date.toLocaleDateString("vi-VN", {
    month: "long",
    year: "numeric"
  });
}

function buildCalendarDays(monthDate: Date) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
