"use client";

import type {
  AddPaymentEvidenceInput,
  AddPaymentMilestoneInput,
  CloseOpportunityInput,
  CreateOpportunityActivityInput,
  HandoffKickoffInput,
  HandoffKickoffResponse,
  OpportunityActivitySummary,
  OpportunitySummary,
  PaymentScheduleDetail,
  PaymentScheduleSummary,
  ResourceListResponse,
  SalesOwnerSummary,
  UpdateOpportunityInput,
  ArAgingSummaryResponse
} from "@b2b-crm/contracts";
import { SALES_WON_REASONS } from "@b2b-crm/contracts";
import { useEffect, useMemo, useState } from "react";
import type { OpportunityActivitiesResponse } from "../../lib/api";
import { getPipelineStats, parseVndInput, toDraft } from "./utils";
import type {
  ActivityDraft,
  CloseDraft,
  DraftOpportunity,
  FinanceMilestoneDraft,
  HandoffDraft,
  PaymentEvidenceDraft
} from "./types";

export function useOpportunityWorkbench({
  initialLeads,
  initialOpportunities,
  salesOwners,
  principal
}: {
  initialLeads: ResourceListResponse<import("@b2b-crm/contracts").LeadSummary>;
  initialOpportunities: ResourceListResponse<OpportunitySummary>;
  salesOwners: ResourceListResponse<SalesOwnerSummary>;
  principal: string;
}) {
  const [opportunities, setOpportunities] = useState(initialOpportunities.data);
  const [leads] = useState(initialLeads.data);
  const [salesOwnerOptions] = useState(salesOwners.data);
  const [selected, setSelected] = useState<OpportunitySummary | null>(initialOpportunities.data[0] ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activities, setActivities] = useState<OpportunityActivitySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Chọn một cơ hội để xem chi tiết.");
  const [draft, setDraft] = useState<DraftOpportunity>(() => toDraft(initialOpportunities.data[0]));
  const [isEditing, setIsEditing] = useState(false);
  const [closeDraft, setCloseDraft] = useState<CloseDraft>({
    outcome: "won",
    wonReason: "",
    lostReason: "",
    commercialScope: false,
    signedSow: false,
    kickoffOwner: false,
    billingReady: false
  });
  const [activityDraft, setActivityDraft] = useState<ActivityDraft>({
    type: "follow_up",
    subject: "",
    note: "",
    dueAt: "",
    delayReason: ""
  });
  const [handoffModalOpen, setHandoffModalOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [paymentSchedules, setPaymentSchedules] = useState<PaymentScheduleDetail[]>([]);
  const [arAging, setArAging] = useState<ArAgingSummaryResponse["data"]>([]);
  const [financeMilestoneDraft, setFinanceMilestoneDraft] = useState<FinanceMilestoneDraft>({
    scheduleId: "",
    label: "",
    amount: "",
    dueAt: "",
    customerVisible: true
  });
  const [paymentEvidenceDraft, setPaymentEvidenceDraft] = useState<PaymentEvidenceDraft>({
    milestoneId: "",
    invoiceId: "",
    evidenceType: "bank_transfer",
    title: "",
    externalUrl: "",
    customerVisible: false
  });
  const [handoffDraft, setHandoffDraft] = useState<HandoffDraft>({
    projectCode: "",
    projectName: "",
    kickoffOwnerUserId: "",
    kickoffAt: "",
    deploymentStatus: "kickoff",
    note: "",
    commercialScope: true,
    signedSow: true,
    kickoffOwner: true,
    billingReady: true,
    deliveryOwner: false,
    kickoffScheduled: false,
    createStageTaskTemplate: false
  });
  const pipelineStats = useMemo(() => getPipelineStats(opportunities), [opportunities]);

  useEffect(() => {
    function handleOpportunityCreated(event: Event) {
      const created = (event as CustomEvent<OpportunitySummary>).detail;
      if (!created?.id) {
        return;
      }

      setOpportunities((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelected(created);
      setDraft(toDraft(created));
      setCloseDraft(closeDraftForOpportunity(created));
      setIsEditing(false);
      setMessage(`Đã tạo cơ hội ${created.title}.`);
    }

    window.addEventListener("lcrm:opportunity-created", handleOpportunityCreated);
    return () => window.removeEventListener("lcrm:opportunity-created", handleOpportunityCreated);
  }, []);

  function openDetail(record: OpportunitySummary) {
    setSelected(record);
    setDraft(toDraft(record));
    setCloseDraft(closeDraftForOpportunity(record, closeDraft));
    setIsEditing(false);
    setDetailOpen(true);
    setMessage(`Đang xem ${record.title}.`);
  }

  async function openActivities(record: OpportunitySummary) {
    setSelected(record);
    setCloseDraft(closeDraftForOpportunity(record, closeDraft));
    setActivityOpen(true);
    await loadActivities(record.id);
  }

  async function openFinance(record: OpportunitySummary) {
    setSelected(record);
    setCloseDraft(closeDraftForOpportunity(record, closeDraft));
    setFinanceOpen(true);
    await loadFinance(record);
  }

  async function loadFinance(record: OpportunitySummary) {
    setFinanceLoading(true);
    try {
      const [scheduleResponse, arAgingResponse] = await Promise.all([
        fetch(`/api/payments/schedules?principal=${encodeURIComponent(principal)}`),
        fetch(`/api/payments/ar-aging?principal=${encodeURIComponent(principal)}`)
      ]);

      if (!scheduleResponse.ok || !arAgingResponse.ok) {
        setPaymentSchedules([]);
        setArAging([]);
        setMessage("Chưa thể mở dữ liệu tài chính cho cơ hội này.");
        setFinanceLoading(false);
        return;
      }

      const scheduleBody = (await scheduleResponse.json()) as ResourceListResponse<PaymentScheduleSummary>;
      const arAgingBody = (await arAgingResponse.json()) as ArAgingSummaryResponse;
      const matchingSchedules = scheduleBody.data.filter(
        (schedule) => schedule.opportunityId === record.id || (!schedule.opportunityId && schedule.accountId === record.accountId)
      );
      const scheduleDetails = await Promise.all(
        matchingSchedules.slice(0, 4).map(async (schedule) => {
          const response = await fetch(
            `/api/payments/schedules/${encodeURIComponent(schedule.id)}?principal=${encodeURIComponent(principal)}`
          );
          if (!response.ok) {
            return null;
          }
          return (await response.json()) as PaymentScheduleDetail;
        })
      );

      const visibleDetails = scheduleDetails.filter((schedule): schedule is PaymentScheduleDetail => Boolean(schedule));
      const accountAging = arAgingBody.data.filter((item) => item.accountId === record.accountId);
      setPaymentSchedules(visibleDetails);
      setArAging(accountAging);
      const firstSchedule = visibleDetails[0];
      const firstMilestone = firstSchedule?.milestones?.[0];
      setFinanceMilestoneDraft((current) => ({
        ...current,
        scheduleId: current.scheduleId || firstSchedule?.id || ""
      }));
      setPaymentEvidenceDraft((current) => ({
        ...current,
        milestoneId: current.milestoneId || firstMilestone?.id || "",
        invoiceId: current.invoiceId || firstMilestone?.invoices?.[0]?.id || ""
      }));
      setMessage(`Đã tải tín hiệu tài chính cho ${record.accountName}.`);
    } catch {
      setPaymentSchedules([]);
      setArAging([]);
      setMessage("Chưa có dữ liệu tài chính.");
    }
    setFinanceLoading(false);
  }

  async function loadActivities(opportunityId: string) {
    setLoading(true);
    const response = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/activities?principal=${encodeURIComponent(principal)}`);
    if (!response.ok) {
      setActivities([]);
      setMessage("Chưa thể mở danh sách hoạt động cho cơ hội này.");
      setLoading(false);
      return;
    }

    const body = (await response.json()) as OpportunityActivitiesResponse;
    setActivities(body.data);
    setMessage(`Đã tải ${body.data.length} hoạt động.`);
    setLoading(false);
  }

  function cancelEditing() {
    if (!selected) {
      return;
    }

    setDraft(toDraft(selected));
    setIsEditing(false);
    setMessage("Đã hủy thay đổi đang sửa.");
  }

  async function confirmSave() {
    await saveOpportunity();
  }

  async function saveOpportunity() {
    if (!selected) {
      return;
    }

    setLoading(true);
    const input: UpdateOpportunityInput = {
      title: draft.title,
      ownerUserId: draft.ownerUserId || undefined,
      stage: draft.stage,
      leadId: draft.leadId ? draft.leadId : null,
      stageEnteredAt: draft.stageEnteredAt || undefined,
      amount: parseVndInput(draft.amount),
      probability: draft.probability ? Number(draft.probability) : undefined,
      nextActivitySubject: draft.nextActivitySubject || undefined,
      nextActivityAt: draft.nextActivityAt || undefined
    };
    const response = await fetch(`/api/opportunities/${encodeURIComponent(selected.id)}?principal=${encodeURIComponent(principal)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      setMessage("Chưa lưu được thay đổi cơ hội.");
      setLoading(false);
      return;
    }

    const updated = (await response.json()) as OpportunitySummary;
    setOpportunities((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelected(updated);
    setDraft(toDraft(updated));
    setCloseDraft(closeDraftForOpportunity(updated, closeDraft));
    setIsEditing(false);
    setMessage(`Đã cập nhật ${updated.title}.`);
    setLoading(false);
  }

  async function createActivity() {
    if (!selected) {
      return;
    }

    setLoading(true);
    const input: CreateOpportunityActivityInput = {
      type: activityDraft.type,
      subject: activityDraft.subject,
      note: activityDraft.note || undefined,
      dueAt: activityDraft.dueAt || undefined,
      delayReason: activityDraft.delayReason
        ? (activityDraft.delayReason as CreateOpportunityActivityInput["delayReason"])
        : undefined
    };
    const response = await fetch(`/api/opportunities/${encodeURIComponent(selected.id)}/activities?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      setMessage("Chưa tạo được hoạt động.");
      setLoading(false);
      return;
    }

    const created = (await response.json()) as OpportunityActivitySummary;
    setActivities((current) => [created, ...current]);
    setActivityDraft({ type: "follow_up", subject: "", note: "", dueAt: "", delayReason: "" });
    setMessage(`Đã tạo hoạt động: ${created.subject}.`);
    setLoading(false);
  }

  async function closeOpportunity(outcome?: "won" | "lost", reason?: string) {
    if (!selected) {
      return;
    }

    setLoading(true);
    const closeOutcome = outcome ?? closeDraft.outcome;
    const input: CloseOpportunityInput =
      closeOutcome === "lost"
        ? { outcome: "lost", lostReason: reason as CloseOpportunityInput["lostReason"] }
        : {
            outcome: "won",
            wonReason: reason as CloseOpportunityInput["wonReason"],
            handoffChecklist: {
              commercialScope: closeDraft.commercialScope,
              signedSow: closeDraft.signedSow,
              kickoffOwner: closeDraft.kickoffOwner,
              billingReady: closeDraft.billingReady
            }
          };

    const response = await fetch(`/api/opportunities/${encodeURIComponent(selected.id)}/close?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();

    if (!response.ok) {
      setMessage(body.message ?? "Chưa thể chốt cơ hội.");
      setLoading(false);
      return;
    }

    const closed = body as OpportunitySummary;
    setOpportunities((current) => current.map((item) => (item.id === closed.id ? closed : item)));
    setSelected(closed);
    setDraft(toDraft(closed));
    setCloseDraft(closeDraftForOpportunity(closed, closeDraft));
    setIsEditing(false);
    setMessage(closeOutcome === "won" ? `Đã xác nhận thắng deal ${closed.title}.` : `Đã xác nhận thua deal ${closed.title}.`);
    setLoading(false);
  }

  async function addPaymentMilestone() {
    const scheduleId = financeMilestoneDraft.scheduleId || paymentSchedules[0]?.id;
    if (!scheduleId) {
      setMessage("Chưa có lịch thu để cập nhật.");
      return;
    }

    if (!financeMilestoneDraft.label.trim()) {
      setMessage("Nhập tên mốc thu trước khi thêm.");
      return;
    }

    setFinanceLoading(true);
    const input: AddPaymentMilestoneInput = {
      label: financeMilestoneDraft.label,
      amount: parseVndInput(financeMilestoneDraft.amount),
      dueAt: financeMilestoneDraft.dueAt || undefined,
      triggerType: "manual",
      customerVisible: financeMilestoneDraft.customerVisible
    };
    const response = await fetch(
      `/api/payments/schedules/${encodeURIComponent(scheduleId)}/milestones?principal=${encodeURIComponent(principal)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
    const body = await response.json();

    if (!response.ok) {
      setMessage(body.message ?? "Chưa cập nhật được lịch thu.");
      setFinanceLoading(false);
      return;
    }

    const updated = body as PaymentScheduleDetail;
    setPaymentSchedules((current) => current.map((schedule) => (schedule.id === updated.id ? updated : schedule)));
    setFinanceMilestoneDraft((current) => ({ ...current, label: "", amount: "", dueAt: "" }));
    setMessage(`Đã thêm mốc thu cho ${formatFinanceScheduleMessage(updated.title)}.`);
    setFinanceLoading(false);
  }

  async function addPaymentEvidence() {
    const milestoneId = paymentEvidenceDraft.milestoneId;
    if (!milestoneId) {
      setMessage("Chọn mốc thu trước khi đính kèm bằng chứng.");
      return;
    }

    if (!paymentEvidenceDraft.externalUrl.trim()) {
      setMessage("Nhập link chứng từ thanh toán trước khi lưu.");
      return;
    }

    setFinanceLoading(true);
    const input: AddPaymentEvidenceInput = {
      evidenceType: paymentEvidenceDraft.evidenceType as AddPaymentEvidenceInput["evidenceType"],
      title: paymentEvidenceDraft.title.trim() || "Bằng chứng thanh toán",
      externalUrl: paymentEvidenceDraft.externalUrl,
      storageProvider: "external_link",
      customerVisible: paymentEvidenceDraft.customerVisible
    };
    const response = await fetch(
      `/api/payments/milestones/${encodeURIComponent(milestoneId)}/evidence?principal=${encodeURIComponent(principal)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
    const body = await response.json();

    if (!response.ok) {
      setMessage(body.message ?? "Chưa đính kèm được bằng chứng thanh toán.");
      setFinanceLoading(false);
      return;
    }

    if (selected) {
      await loadFinance(selected);
    }
    setPaymentEvidenceDraft((current) => ({ ...current, title: "", externalUrl: "" }));
    setMessage("Đã đính kèm bằng chứng thanh toán.");
    setFinanceLoading(false);
  }

  async function createHandoffKickoff() {
    if (!selected) {
      return;
    }

    setLoading(true);
    const input: HandoffKickoffInput = {
      projectCode: handoffDraft.projectCode || undefined,
      projectName: handoffDraft.projectName || undefined,
      kickoffOwnerUserId: handoffDraft.kickoffOwnerUserId || undefined,
      kickoffAt: handoffDraft.kickoffAt || undefined,
      deploymentStatus: handoffDraft.deploymentStatus as HandoffKickoffInput["deploymentStatus"],
      note: handoffDraft.note || undefined,
      createStageTaskTemplate: handoffDraft.createStageTaskTemplate,
      checklist: {
        commercialScope: handoffDraft.commercialScope,
        signedSow: handoffDraft.signedSow,
        kickoffOwner: handoffDraft.kickoffOwner,
        billingReady: handoffDraft.billingReady,
        deliveryOwner: handoffDraft.deliveryOwner,
        kickoffScheduled: handoffDraft.kickoffScheduled
      }
    };
    const response = await fetch(`/api/opportunities/${encodeURIComponent(selected.id)}/handoff-kickoff?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();

    if (!response.ok) {
      setMessage(body.message ?? "Chưa thể tạo dự án kickoff.");
      setLoading(false);
      return;
    }

    const kickoff = body as HandoffKickoffResponse;
    setOpportunities((current) => current.map((item) => (item.id === kickoff.opportunity.id ? kickoff.opportunity : item)));
    setSelected(kickoff.opportunity);
    setMessage(
      `Đã tạo dự án kickoff cho ${selected.title}. Stage: ${kickoff.stages?.length ?? 0}, task mẫu: ${kickoff.taskTemplates?.length ?? 0}.`
    );
    setHandoffModalOpen(false);
    setLoading(false);
  }

  return {
    state: {
      activities,
      activityDraft,
      activityOpen,
      closeDraft,
      detailOpen,
      draft,
      financeMilestoneDraft,
      financeLoading,
      financeOpen,
      handoffDraft,
      handoffModalOpen,
      isEditing,
      loading,
      leads,
      message,
      opportunities,
      arAging,
      paymentSchedules,
      paymentEvidenceDraft,
      pipelineStats,
      salesOwners: salesOwnerOptions,
      selected
    },
    actions: {
      addPaymentEvidence,
      addPaymentMilestone,
      cancelEditing,
      closeOpportunity,
      confirmSave,
      createActivity,
      createHandoffKickoff,
      openActivities,
      openDetail,
      openFinance,
      setActivityDraft,
      setActivityOpen,
      setCloseDraft,
      setDetailOpen,
      setDraft,
      setFinanceMilestoneDraft,
      setFinanceOpen,
      setHandoffDraft,
      setHandoffModalOpen,
      setIsEditing,
      setPaymentEvidenceDraft
    }
  };
}

export type OpportunityWorkbench = ReturnType<typeof useOpportunityWorkbench>;

function formatFinanceScheduleMessage(title: string) {
  return title.replace("Alpha CRM/ERP phase 1 payment schedule", "Lịch thu Alpha CRM/ERP phase 1");
}

function closeDraftForOpportunity(opportunity: OpportunitySummary, current?: CloseDraft): CloseDraft {
  const outcome: CloseDraft["outcome"] = opportunity.stage === "lost" ? "lost" : "won";
  const handoffConfirmed = Boolean(opportunity.handoffConfirmedAt);

  return {
    outcome,
    wonReason: opportunity.stage === "won" ? opportunity.closeReason ?? current?.wonReason ?? "" : current?.wonReason ?? "",
    lostReason: opportunity.stage === "lost" ? opportunity.closeReason ?? current?.lostReason ?? "" : current?.lostReason ?? "",
    commercialScope: handoffConfirmed ? true : current?.commercialScope ?? false,
    signedSow: handoffConfirmed ? true : current?.signedSow ?? false,
    kickoffOwner: handoffConfirmed ? true : current?.kickoffOwner ?? false,
    billingReady: handoffConfirmed ? true : current?.billingReady ?? false
  };
}
