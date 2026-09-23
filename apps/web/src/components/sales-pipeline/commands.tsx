"use client";

import type {
  AccountsResponse,
  CreateLeadInput,
  CreateLeadResponse,
  CreateOpportunityInput,
  DisqualifyLeadInput,
  LeadDuplicateCandidate,
  LeadSummary,
  OpportunitySummary,
  ResourceListResponse
} from "@b2b-crm/contracts";
import { DEPLOYMENT_KICKOFF_STATUSES, SALES_LOST_REASONS } from "@b2b-crm/contracts";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ShopifyModal } from "../shopify-modal";
import { ShopifyIcon } from "../shopify-ui";
import { stageOptions } from "./constants";
import type { DisqualifyDraft, LeadDraft, OpportunityCreateDraft } from "./types";
import { formatStageLabel, formatTaxonomyLabel, formatVndInput, parseVndInput } from "./utils";

export function SalesIntakePanel({
  accounts,
  initialLeads,
  principal
}: {
  accounts: AccountsResponse;
  initialLeads: ResourceListResponse<LeadSummary>;
  principal: string;
}) {
  const firstAccount = accounts.data[0];
  const [leads, setLeads] = useState(initialLeads.data);
  const [leadDraft, setLeadDraft] = useState<LeadDraft>(() => ({
    accountId: firstAccount?.id ?? "",
    companyName: firstAccount?.name ?? "",
    contactName: "",
    contactEmail: "",
    source: "manual",
    painPoint: "",
    serviceFit: "",
    timeline: "",
    budgetRange: "",
    authority: "",
    qualificationSummary: "",
    nextActivityAt: "",
    allowDuplicate: false
  }));
  const [opportunityDraft, setOpportunityDraft] = useState<OpportunityCreateDraft>(() => ({
    leadId: "",
    accountId: firstAccount?.id ?? "",
    title: "",
    amount: "",
    stage: "qualified",
    nextActivitySubject: "",
    nextActivityAt: ""
  }));
  const [disqualifyDraft, setDisqualifyDraft] = useState<DisqualifyDraft>(() => ({
    leadId: initialLeads.data.find((lead) => lead.status !== "opportunity_created")?.id ?? "",
    reason: SALES_LOST_REASONS[0].code,
    note: ""
  }));
  const [duplicateCandidates, setDuplicateCandidates] = useState<LeadDuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(`${initialLeads.data.length} lead trong phạm vi hiện tại.`);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [opportunityModalOpen, setOpportunityModalOpen] = useState(false);
  const [disqualifyModalOpen, setDisqualifyModalOpen] = useState(false);
  const leadOptions: PipelineSelectOption[] = [
    { value: "", label: "Tạo trực tiếp từ khách hàng", description: "Dùng khi cơ hội chưa đi qua lead intake." },
    ...leads.map((lead) => ({
      value: lead.id,
      label: `${lead.companyName} / ${lead.contactName}`,
      description: lead.status === "opportunity_created" ? "Đã có cơ hội liên kết" : "Có thể chuyển thành cơ hội"
    }))
  ];
  const accountOptions: PipelineSelectOption[] = accounts.data.map((account) => ({
    value: account.id,
    label: account.name,
    description: "Khách hàng trong phạm vi vận hành"
  }));
  const disqualifiableLeadOptions: PipelineSelectOption[] = [
    { value: "", label: "Chọn lead", description: "Chỉ hiện lead chưa chuyển thành cơ hội." },
    ...leads
      .filter((lead) => lead.status !== "opportunity_created" && lead.status !== "disqualified")
      .map((lead) => ({
        value: lead.id,
        label: `${lead.companyName} / ${lead.contactName}`,
        description: "Lead có thể loại khỏi pipeline"
      }))
  ];
  const lostReasonOptions: PipelineSelectOption[] = SALES_LOST_REASONS.map((reason) => ({
    value: reason.code,
    label: formatTaxonomyLabel(reason.code),
    description: "Lý do loại lead"
  }));
  const opportunityStageOptions: PipelineSelectOption[] = stageOptions
    .filter((stage) => !["won", "lost"].includes(stage))
    .map((stage) => ({
      value: stage,
      label: formatStageLabel(stage),
      description: getStageHelper(stage)
    }));

  useEffect(() => {
    function openLeadModal() {
      setLeadModalOpen(true);
    }

    function openOpportunityModal() {
      setOpportunityModalOpen(true);
    }

    function openDisqualifyModal() {
      setDisqualifyModalOpen(true);
    }

    window.addEventListener("lcrm:open-capture-lead", openLeadModal);
    window.addEventListener("lcrm:open-create-opportunity", openOpportunityModal);
    window.addEventListener("lcrm:open-disqualify-lead", openDisqualifyModal);
    return () => {
      window.removeEventListener("lcrm:open-capture-lead", openLeadModal);
      window.removeEventListener("lcrm:open-create-opportunity", openOpportunityModal);
      window.removeEventListener("lcrm:open-disqualify-lead", openDisqualifyModal);
    };
  }, []);

  async function createLead() {
    setLoading(true);
    setDuplicateCandidates([]);
    const input: CreateLeadInput = {
      ...leadDraft,
      contactEmail: leadDraft.contactEmail || undefined,
      painPoint: leadDraft.painPoint || undefined,
      serviceFit: leadDraft.serviceFit || undefined,
      timeline: leadDraft.timeline || undefined,
      budgetRange: leadDraft.budgetRange || undefined,
      authority: leadDraft.authority || undefined,
      qualificationSummary: leadDraft.qualificationSummary || undefined,
      nextActivityAt: leadDraft.nextActivityAt || undefined
    };

    const response = await fetch(`/api/sales/leads?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();

    if (response.status === 409) {
      setDuplicateCandidates(body.duplicateCandidates ?? []);
      setMessage("Cần rà soát trùng lặp trước khi ghi nhận lead này.");
      setLoading(false);
      return;
    }

    if (!response.ok) {
      setMessage(body.message ?? "Tạo lead thất bại.");
      setLoading(false);
      return;
    }

    const created = body as CreateLeadResponse;
    setLeads((current) => [created.data, ...current]);
    setOpportunityDraft((current) => ({
      ...current,
      leadId: created.data.id,
      accountId: created.data.accountId,
      title: current.title || `Cơ hội ${created.data.companyName}`
    }));
    setMessage(`Đã tạo lead cho ${created.data.contactName || created.data.companyName}.`);
    setLeadModalOpen(false);
    setLoading(false);
  }

  async function disqualifyLead() {
    if (!disqualifyDraft.leadId) {
      setMessage("Chọn lead trước khi loại.");
      return;
    }

    setLoading(true);
    const input: DisqualifyLeadInput = {
      reason: disqualifyDraft.reason as DisqualifyLeadInput["reason"],
      note: disqualifyDraft.note || undefined
    };
    const response = await fetch(
      `/api/sales/leads/${encodeURIComponent(disqualifyDraft.leadId)}/disqualify?principal=${encodeURIComponent(principal)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
    const body = await response.json();

    if (!response.ok) {
      setMessage(body.message ?? "Loại lead thất bại.");
      setLoading(false);
      return;
    }

    const updated = body as LeadSummary;
    setLeads((current) => current.map((lead) => (lead.id === updated.id ? updated : lead)));
    setMessage(`Đã loại ${updated.contactName}: ${formatTaxonomyLabel(updated.duplicateReason?.replace("disqualified:", "") ?? disqualifyDraft.reason)}.`);
    setDisqualifyModalOpen(false);
    setDisqualifyDraft((current) => ({ ...current, leadId: "", note: "" }));
    setLoading(false);
  }

  async function createOpportunity() {
    setLoading(true);
    const input: CreateOpportunityInput = {
      accountId: opportunityDraft.accountId,
      leadId: opportunityDraft.leadId || undefined,
      title: opportunityDraft.title,
      amount: parseVndInput(opportunityDraft.amount),
      stage: opportunityDraft.stage,
      nextActivitySubject: opportunityDraft.nextActivitySubject || undefined,
      nextActivityAt: opportunityDraft.nextActivityAt || undefined
    };

    const response = await fetch(`/api/opportunities?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();

    if (!response.ok) {
      setMessage(body.message ?? "Tạo cơ hội thất bại.");
      setLoading(false);
      return;
    }

    setMessage(`Đã tạo cơ hội: ${body.title}.`);
    setOpportunityDraft((current) => ({
      ...current,
      leadId: "",
      title: "",
      amount: "",
      nextActivitySubject: "",
      nextActivityAt: ""
    }));
    window.dispatchEvent(new CustomEvent<OpportunitySummary>("lcrm:opportunity-created", { detail: body as OpportunitySummary }));
    setOpportunityModalOpen(false);
    setLoading(false);
  }

  return (
    <>
      <div className="shopify-visually-hidden" aria-live="polite">
        {message}
      </div>

      <ShopifyModal onClose={() => setLeadModalOpen(false)} open={leadModalOpen} title="Tạo lead">
        <div className="pipeline-create-modal">
          <div className="pipeline-modal-intro">
            <span className="pipeline-modal-icon" aria-hidden="true">
              <ShopifyIcon name="users" size={18} />
            </span>
            <div>
              <strong>Thông tin lead</strong>
              <span>Tạo lead mới từ khách hàng, người liên hệ và tín hiệu nhu cầu ban đầu.</span>
            </div>
          </div>

          <PipelineSelect
            label="Khách hàng"
            onChange={(value) => {
              const account = accounts.data.find((item) => item.id === value);
              setLeadDraft((current) => ({ ...current, accountId: value, companyName: account?.name ?? current.companyName }));
              setOpportunityDraft((current) => ({ ...current, accountId: value }));
            }}
            options={accountOptions}
            value={leadDraft.accountId}
          />

          <div className="pipeline-form-grid">
            <PipelineField label="Người liên hệ">
              <input
                className="pipeline-input"
                onChange={(event) => setLeadDraft((current) => ({ ...current, contactName: event.target.value }))}
                placeholder="Nhập tên người liên hệ"
                value={leadDraft.contactName}
              />
            </PipelineField>
            <PipelineField label="Email">
              <input
                className="pipeline-input"
                onChange={(event) => setLeadDraft((current) => ({ ...current, contactEmail: event.target.value }))}
                placeholder="name@company.com"
                type="email"
                value={leadDraft.contactEmail}
              />
            </PipelineField>
          </div>

          <PipelineField label="Nỗi đau / nhu cầu">
            <textarea
              className="pipeline-input pipeline-textarea"
              onChange={(event) => setLeadDraft((current) => ({ ...current, painPoint: event.target.value }))}
              placeholder="Ví dụ: đang quản lý pipeline thủ công, thiếu báo cáo bàn giao..."
              value={leadDraft.painPoint}
            />
          </PipelineField>

          <div className="pipeline-form-grid">
            <PipelineField label="Mức phù hợp">
              <input
                className="pipeline-input"
                onChange={(event) => setLeadDraft((current) => ({ ...current, serviceFit: event.target.value }))}
                placeholder="CRM/ERP implementation"
                value={leadDraft.serviceFit}
              />
            </PipelineField>
            <PipelineField label="Ngân sách">
              <div className="pipeline-input-shell">
                <input
                  className="pipeline-input"
                  inputMode="numeric"
                  onChange={(event) => setLeadDraft((current) => ({ ...current, budgetRange: formatVndInput(event.target.value) }))}
                  placeholder="240.000.000"
                  value={leadDraft.budgetRange}
                />
                <span>đ</span>
              </div>
            </PipelineField>
          </div>

          <div className="pipeline-form-grid">
            <PipelineField label="Thời điểm">
              <input
                className="pipeline-input"
                onChange={(event) => setLeadDraft((current) => ({ ...current, timeline: event.target.value }))}
                placeholder="Trong quý này"
                value={leadDraft.timeline}
              />
            </PipelineField>
            <PipelineField label="Người quyết định">
              <input
                className="pipeline-input"
                onChange={(event) => setLeadDraft((current) => ({ ...current, authority: event.target.value }))}
                placeholder="Founder / Ops lead"
                value={leadDraft.authority}
              />
            </PipelineField>
          </div>

          <PipelineCheckbox
            checked={leadDraft.allowDuplicate}
            label="Đã rà soát trùng lặp"
            onChange={(checked) => setLeadDraft((current) => ({ ...current, allowDuplicate: checked }))}
          />

          {duplicateCandidates.length > 0 ? (
            <s-banner heading="Có bản ghi có thể trùng" tone="warning">
              {duplicateCandidates.map((candidate) => (
                <s-paragraph key={`${candidate.type}-${candidate.id}`}>
                  {candidate.type}: {candidate.label}
                </s-paragraph>
            ))}
          </s-banner>
          ) : null}
          <div className="pipeline-modal-actions">
            <button className="pipeline-command-button" onClick={() => setLeadModalOpen(false)} type="button">
              Hủy
            </button>
            <button className="pipeline-command-button primary" disabled={loading} onClick={createLead} type="button">
              <ShopifyIcon name="users" size={15} />
              <span>Tạo lead</span>
            </button>
          </div>
        </div>
      </ShopifyModal>

      <ShopifyModal onClose={() => setDisqualifyModalOpen(false)} open={disqualifyModalOpen} title="Loại lead">
        <div className="pipeline-create-modal">
          <div className="pipeline-modal-intro warning">
            <span className="pipeline-modal-icon" aria-hidden="true">
              <ShopifyIcon name="x" size={18} />
            </span>
            <div>
              <strong>Loại lead khỏi pipeline</strong>
              <span>Chỉ loại lead khi đã có lý do rõ ràng để đội bán hàng không tiếp tục theo đuổi.</span>
            </div>
          </div>

          <PipelineSelect
            helper="Chọn lead chưa chuyển thành cơ hội."
            label="Lead"
            onChange={(value) => setDisqualifyDraft((current) => ({ ...current, leadId: value }))}
            options={disqualifiableLeadOptions}
            value={disqualifyDraft.leadId}
          />
          <PipelineSelect
            helper="Lý do giúp báo cáo win/lost sạch hơn."
            label="Lý do"
            onChange={(value) => setDisqualifyDraft((current) => ({ ...current, reason: value }))}
            options={lostReasonOptions}
            value={disqualifyDraft.reason}
          />
          <PipelineField label="Ghi chú" helper="Thêm ngữ cảnh ngắn để người sau hiểu quyết định.">
            <textarea
              className="pipeline-input pipeline-textarea"
              onChange={(event) => setDisqualifyDraft((current) => ({ ...current, note: event.target.value }))}
              placeholder="Ví dụ: chưa có ngân sách trong quý này"
              value={disqualifyDraft.note}
            />
          </PipelineField>
          <div className="pipeline-modal-actions">
            <button className="pipeline-command-button" onClick={() => setDisqualifyModalOpen(false)} type="button">
              Hủy
            </button>
            <button className="pipeline-command-button destructive strong" disabled={loading} onClick={disqualifyLead} type="button">
              <ShopifyIcon name="x" size={15} />
              <span>Loại lead</span>
            </button>
          </div>
        </div>
      </ShopifyModal>

      <ShopifyModal onClose={() => setOpportunityModalOpen(false)} open={opportunityModalOpen} title="Tạo cơ hội">
        <div className="pipeline-create-modal">
          <div className="pipeline-modal-intro">
            <span className="pipeline-modal-icon" aria-hidden="true">
              <ShopifyIcon name="briefcase" size={18} />
            </span>
            <div>
              <strong>Thông tin cơ hội</strong>
              <span>Chọn nguồn, khách hàng và giai đoạn khởi tạo để đội bán hàng theo dõi đúng pipeline.</span>
            </div>
          </div>

          <PipelineSelect
            helper="Có thể tạo trực tiếp nếu cơ hội không đến từ lead."
            label="Lead"
            onChange={(value) => {
              const lead = leads.find((item) => item.id === value);
              setOpportunityDraft((current) => ({
                ...current,
                leadId: value,
                accountId: lead?.accountId ?? current.accountId,
                title: current.title || (lead ? `Cơ hội ${lead.companyName}` : "")
              }));
            }}
            options={leadOptions}
            value={opportunityDraft.leadId}
          />

          <PipelineSelect
            helper="Đổi khách hàng sẽ bỏ liên kết lead đang chọn."
            label="Khách hàng"
            onChange={(value) => setOpportunityDraft((current) => ({ ...current, accountId: value, leadId: "" }))}
            options={accountOptions}
            value={opportunityDraft.accountId}
          />

          <PipelineField label="Tên cơ hội" helper="Dùng tên dễ scan, ví dụ: CRM/ERP phase 2.">
            <input
              className="pipeline-input"
              onChange={(event) => setOpportunityDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Nhập tên cơ hội"
              value={opportunityDraft.title}
            />
          </PipelineField>

          <div className="pipeline-form-grid">
            <PipelineField label="Giá trị dự kiến" helper="Nhập số tiền đ; hệ thống tự thêm dấu chấm để dễ đọc.">
              <div className="pipeline-input-shell">
                <input
                  className="pipeline-input"
                  inputMode="numeric"
                  onChange={(event) => setOpportunityDraft((current) => ({ ...current, amount: formatVndInput(event.target.value) }))}
                  placeholder="180.000.000"
                  type="text"
                  value={opportunityDraft.amount}
                />
                <span>đ</span>
              </div>
            </PipelineField>
            <PipelineSelect
              helper="Giai đoạn khởi tạo trong pipeline."
              label="Giai đoạn"
              preferredSide="up"
              onChange={(value) => setOpportunityDraft((current) => ({ ...current, stage: value }))}
              options={opportunityStageOptions}
              value={opportunityDraft.stage}
            />
          </div>

          <PipelineField label="Việc tiếp theo" helper="Gợi ý: Hẹn workshop, gửi báo giá hoặc xác nhận người quyết định.">
            <input
              className="pipeline-input"
              onChange={(event) => setOpportunityDraft((current) => ({ ...current, nextActivitySubject: event.target.value }))}
              placeholder="Nhập việc tiếp theo"
              value={opportunityDraft.nextActivitySubject}
            />
          </PipelineField>

          <div className="pipeline-modal-actions">
            <button className="pipeline-command-button" onClick={() => setOpportunityModalOpen(false)} type="button">
              Hủy
            </button>
            <button className="pipeline-command-button primary" disabled={loading} onClick={createOpportunity} type="button">
              <ShopifyIcon name="briefcase" size={15} />
              <span>Tạo cơ hội</span>
            </button>
          </div>
        </div>
      </ShopifyModal>
    </>
  );
}

type PipelineSelectOption = {
  description?: string;
  label: string;
  value: string;
};

function PipelineField({
  children,
  helper,
  label
}: {
  children: ReactNode;
  helper?: string;
  label: string;
}) {
  return (
    <label className="pipeline-field">
      <span className="pipeline-field-label">{label}</span>
      {children}
      {helper ? <span className="pipeline-field-helper">{helper}</span> : null}
    </label>
  );
}

function PipelineSelect({
  helper,
  label,
  onChange,
  options,
  preferredSide = "auto",
  value
}: {
  helper?: string;
  label: string;
  onChange: (value: string) => void;
  options: PipelineSelectOption[];
  preferredSide?: "auto" | "down" | "up";
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuSide, setMenuSide] = useState<"down" | "up">("down");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (preferredSide === "up" || preferredSide === "down") {
      setMenuSide(preferredSide);
    } else if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setMenuSide(spaceBelow < 260 && spaceAbove > spaceBelow ? "up" : "down");
    }

    function closeOnOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [open, preferredSide]);

  return (
    <div className="pipeline-field" ref={wrapperRef}>
      <span className="pipeline-field-label">{label}</span>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selected?.label ?? "Chưa chọn"}`}
        className="pipeline-select-trigger"
        data-open={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        type="button"
      >
        <span>
          <strong>{selected?.label ?? "Chưa chọn"}</strong>
          {selected?.description ? <small>{selected.description}</small> : null}
        </span>
        <ShopifyIcon className="pipeline-select-chevron" name="chevron-down" size={15} />
      </button>
      {helper ? <span className="pipeline-field-helper">{helper}</span> : null}

      {open ? (
        <div className="pipeline-select-menu" data-side={menuSide} id={listboxId} role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className="pipeline-select-option"
              data-selected={option.value === value}
              key={option.value || "empty"}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {option.value === value ? <ShopifyIcon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PipelineCheckbox({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="pipeline-checkbox">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span aria-hidden="true">
        {checked ? <ShopifyIcon name="check" size={13} /> : null}
      </span>
      <strong>{label}</strong>
    </label>
  );
}

function getStageHelper(stage: string) {
  const helpers: Record<string, string> = {
    contracting: "Đang hoàn tất hợp đồng",
    demo: "Đang chứng minh giải pháp",
    discovery: "Đang hiểu nhu cầu",
    lead: "Lead mới ghi nhận",
    negotiation: "Đang đàm phán điều khoản",
    proposal: "Đang gửi báo giá/SOW",
    qualified: "Đã đủ điều kiện bán hàng",
    solution: "Đang thiết kế phương án"
  };

  return helpers[stage] ?? "Giai đoạn pipeline";
}

export function BdDeploymentStatusPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <s-button onClick={() => setOpen(true)}>Review BD & deployment map</s-button>
      <ShopifyModal onClose={() => setOpen(false)} open={open} size="large" title="BD & Deployment status map">
        <div className="shopify-two-column">
          <div className="shopify-stage-list">
            {stageOptions.map((stage, index) => (
              <div className="shopify-stage-row" key={stage}>
                <span>Bước {index + 1} · {formatStageLabel(stage)}</span>
                <strong>BD</strong>
              </div>
            ))}
          </div>
          <div className="shopify-stage-list">
            {DEPLOYMENT_KICKOFF_STATUSES.map((status) => (
              <div className="shopify-stage-row" key={status.code}>
                <span>{status.label}</span>
                <strong>Deploy</strong>
              </div>
            ))}
          </div>
        </div>
      </ShopifyModal>
    </>
  );
}
