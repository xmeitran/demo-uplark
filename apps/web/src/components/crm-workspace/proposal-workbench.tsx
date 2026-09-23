"use client";
import { MoneyAmount } from "@/components/money-amount";



import { useEffect, useMemo, useState } from "react";
import {
  PROPOSAL_DOCUMENT_TYPES,
  PROPOSAL_PACKAGE_TYPES,
  type AddProposalDocumentInput,
  type DealApprovalRequestSummary,
  type OpportunitySummary,
  type ProposalDocumentTypeCode,
  type ProposalPackageDetail,
  type ProposalPackageSummary,
  type ProposalPackageTypeCode,
  type ResourceListResponse
} from "@b2b-crm/contracts";
import { ShopifyAppShell, ShopifyIcon, ShopifyPage, type BadgeTone } from "../shopify-ui";
import { loadRouteDataJson } from "../../lib/route-data-cache";
import { businessFunctionConfigs, type BusinessFunctionConfig } from "./business-function-config";
import { ModalLayer } from "../modal-layer";

const proposalRequiredDocuments: Record<ProposalPackageTypeCode, ProposalDocumentTypeCode[]> = {
  quick_setup_discovery: ["proposal", "quotation"],
  standard_implementation: ["proposal", "sow", "quotation", "payment_schedule"],
  complex_multi_phase: ["proposal", "sow", "quotation", "payment_schedule", "risk_register"],
  monthly_retainer_support: ["proposal", "sow", "quotation", "payment_schedule"],
  change_request: ["sow", "quotation"],
  license_subscription_pass_through: ["quotation", "vendor_quote"]
};

const proposalStatusTone: Record<ProposalPackageSummary["status"], BadgeTone> = {
  draft: "info",
  internal_review: "warning",
  revision_required: "critical",
  internally_approved: "success",
  sent_to_customer: "success",
  customer_revision_requested: "warning",
  customer_accepted: "success",
  superseded: "neutral",
  withdrawn: "neutral",
  expired: "critical"
};

type ProposalComposerDraft = {
  opportunityId: string;
  packageType: ProposalPackageTypeCode;
  title: string;
  proposedAmount: string;
  discountPercent: string;
  paymentTermSummary: string;
  scopeRiskLevel: "low" | "medium" | "high" | "critical";
};

type ProposalDocumentDraft = {
  documentType: ProposalDocumentTypeCode;
  title: string;
  externalUrl: string;
  customerVisible: boolean;
};

type ProposalsOverviewPayload = {
  opportunities: ResourceListResponse<OpportunitySummary>;
  packages: ResourceListResponse<ProposalPackageSummary>;
  selected: ProposalPackageDetail | null;
};

const proposalDocumentLabel = (documentType: ProposalDocumentTypeCode) =>
  PROPOSAL_DOCUMENT_TYPES.find((item) => item.code === documentType)?.label ?? documentType;

const proposalPackageLabel = (packageType: ProposalPackageTypeCode) =>
  PROPOSAL_PACKAGE_TYPES.find((item) => item.code === packageType)?.label ?? packageType;

function ProposalWorkbench({ config }: Readonly<{ config: BusinessFunctionConfig }>) {
  const principal = "founder";
  const [packages, setPackages] = useState<ProposalPackageSummary[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selected, setSelected] = useState<ProposalPackageDetail | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [documentComposerOpen, setDocumentComposerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [composerDraft, setComposerDraft] = useState<ProposalComposerDraft>({
    opportunityId: "",
    packageType: "standard_implementation",
    title: "",
    proposedAmount: "",
    discountPercent: "0",
    paymentTermSummary: "50% kickoff / 50% acceptance",
    scopeRiskLevel: "low"
  });
  const [documentDraft, setDocumentDraft] = useState<ProposalDocumentDraft>({
    documentType: "proposal",
    title: "",
    externalUrl: "",
    customerVisible: true
  });

  function syncDocumentDraftFromDetail(detail: ProposalPackageDetail) {
    const nextMissing = detail.gateCheck.missingDocuments[0];
    setDocumentDraft((current) => ({
      ...current,
      documentType: nextMissing ?? current.documentType,
      title: current.title || `${detail.title} ${proposalDocumentLabel(nextMissing ?? current.documentType)}`,
      externalUrl: current.externalUrl
    }));
  }

  useEffect(() => {
    let ignore = false;

    async function loadInitialState() {
      setIsLoading(true);
      const overview = await loadRouteDataJson<ProposalsOverviewPayload>(
        `/api/proposals/overview?principal=${encodeURIComponent(principal)}`
      ).catch(() => null);
      const packagePayload = overview?.packages ?? { data: [] };
      const opportunityPayload = overview?.opportunities ?? { data: [] };

      if (ignore) {
        return;
      }

      setPackages(packagePayload.data);
      setOpportunities(opportunityPayload.data);
      setSelectedId((current) => current || packagePayload.data[0]?.id || "");
      setSelected(overview?.selected ?? null);
      if (overview?.selected) {
        syncDocumentDraftFromDetail(overview.selected);
      }
      setComposerDraft((current) => ({
        ...current,
        opportunityId: current.opportunityId || opportunityPayload.data[0]?.id || ""
      }));
      setIsLoading(false);
    }

    void loadInitialState();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!selectedId) {
      setSelected(null);
      return;
    }
    if (selected?.id === selectedId) {
      return;
    }

    async function loadDetail() {
      const response = await fetch(`/api/proposal-packages/${encodeURIComponent(selectedId)}?principal=${encodeURIComponent(principal)}`, {
        cache: "no-store"
      });
      if (!response.ok || ignore) {
        return;
      }

      const detail = (await response.json()) as ProposalPackageDetail;
      setSelected(detail);
      syncDocumentDraftFromDetail(detail);
    }

    void loadDetail();
    return () => {
      ignore = true;
    };
  }, [selected?.id, selectedId]);

  const metrics = useMemo(() => {
    const totalValue = packages.reduce((sum, item) => sum + (item.proposedAmount ?? 0), 0);
    const readyCount = packages.filter((item) => ["internally_approved", "sent_to_customer", "customer_accepted"].includes(item.status)).length;
    const approvalHold = packages.filter((item) => item.status === "internal_review").length;

    return [
      { label: "Gói đang mở", value: String(packages.length), detail: "Hàng đợi đề xuất live" },
      { label: "Sẵn sàng gửi", value: String(readyCount), detail: "Trạng thái phê duyệt đã sạch" },
      { label: "Giá trị đề xuất", value: <MoneyAmount value={totalValue} />, detail: "Tổng proposal value đang mở" },
      { label: "Chờ phê duyệt", value: String(approvalHold), detail: "Đang chờ quyết định nội bộ" }
    ];
  }, [packages]);

  const selectedRequirements = selected ? proposalRequiredDocuments[selected.packageType] : [];
  const missingDocumentCount = selected?.gateCheck.missingDocuments.length ?? 0;
  const completedRequirementCount = selectedRequirements.filter((documentType) =>
    selected?.documents.some((document) => document.documentType === documentType)
  ).length;
  const pendingRequests = selected?.approvalRequests.filter((request) => request.status === "submitted") ?? [];
  const sentReady = Boolean(selected?.gateCheck.proposalSentReady);
  const alreadySent = selected ? ["sent_to_customer", "customer_accepted"].includes(selected.status) : false;
  const sendLockedReason = selected
    ? selected.gateCheck.failures.filter((failure) => failure !== "customer_acceptance_required_for_contracting").join(", ") || "Ready"
    : "Select a package";

  async function refreshSelected(nextSelectedId = selectedId) {
    const response = await fetch(`/api/proposal-packages?principal=${encodeURIComponent(principal)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as ResourceListResponse<ProposalPackageSummary>;
      setPackages(payload.data);
    }

    if (nextSelectedId) {
      const detailResponse = await fetch(`/api/proposal-packages/${encodeURIComponent(nextSelectedId)}?principal=${encodeURIComponent(principal)}`, {
        cache: "no-store"
      });
      if (detailResponse.ok) {
        setSelected((await detailResponse.json()) as ProposalPackageDetail);
      }
    }
  }

  async function createPackage() {
    if (!composerDraft.opportunityId) {
      setNotice("Chọn một cơ hội trước khi tạo gói đề xuất.");
      return;
    }

    setIsBusy(true);
    const response = await fetch(`/api/proposal-packages?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opportunityId: composerDraft.opportunityId,
        packageType: composerDraft.packageType,
        title: composerDraft.title || undefined,
        proposedAmount: Number(composerDraft.proposedAmount || 0),
        discountPercent: Number(composerDraft.discountPercent || 0),
        paymentTermSummary: composerDraft.paymentTermSummary,
        scopeRiskLevel: composerDraft.scopeRiskLevel
      })
    });
    const payload = await response.json();
    setIsBusy(false);

    if (!response.ok) {
      setNotice(payload.message || "Chưa tạo được gói đề xuất.");
      return;
    }

    setComposerOpen(false);
    setSelectedId(payload.id);
    setNotice("Đã tạo gói đề xuất. Bổ sung tài liệu bắt buộc để mở bước review.");
    await refreshSelected(payload.id);
  }

  async function attachDocument() {
    if (!selected) {
      return;
    }
    if (!documentDraft.externalUrl.trim()) {
      setNotice("Gắn link tài liệu trước khi lưu checklist.");
      return;
    }

    setIsBusy(true);
    const body: AddProposalDocumentInput = {
      documentType: documentDraft.documentType,
      title: documentDraft.title || `${selected.title} ${proposalDocumentLabel(documentDraft.documentType)}`,
      externalUrl: documentDraft.externalUrl,
      customerVisible: documentDraft.customerVisible
    };
    const response = await fetch(`/api/proposal-packages/${encodeURIComponent(selected.id)}/documents?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    setIsBusy(false);

    if (!response.ok) {
      setNotice(payload.message || "Chưa gắn được tài liệu.");
      return;
    }

    setSelected(payload);
    setDocumentDraft({
      documentType: payload.gateCheck.missingDocuments[0] ?? documentDraft.documentType,
      title: "",
      externalUrl: "",
      customerVisible: true
    });
    setNotice("Checklist đã được cập nhật.");
    await refreshSelected(payload.id);
  }

  async function submitReview() {
    if (!selected) {
      return;
    }

    setIsBusy(true);
    const response = await fetch(`/api/proposal-packages/${encodeURIComponent(selected.id)}/submit-review?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Proposal package ready for commercial review." })
    });
    const payload = await response.json();
    setIsBusy(false);

    if (!response.ok) {
      setNotice(payload.message || "Chưa gửi review được vì còn điều kiện bị khóa.");
      return;
    }

    setSelected(payload);
    setNotice("Đã gửi yêu cầu phê duyệt.");
    await refreshSelected(payload.id);
  }

  async function syncApproval(request: DealApprovalRequestSummary, status: "APPROVED" | "REJECTED") {
    if (!request.larkApprovalInstanceCode) {
      setNotice("Yêu cầu phê duyệt thiếu mã đồng bộ nội bộ.");
      return;
    }

    setIsBusy(true);
    const response = await fetch(`/api/proposal-packages/approval-callback?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        larkApprovalInstanceCode: request.larkApprovalInstanceCode,
        status,
        comment: status === "APPROVED" ? "Approved from proposal workbench callback sync." : "Revision requested from callback sync."
      })
    });
    const payload = await response.json();
    setIsBusy(false);

    if (!response.ok) {
      setNotice(payload.message || "Chưa đồng bộ được callback phê duyệt.");
      return;
    }

    setNotice(status === "APPROVED" ? "Đã đồng bộ trạng thái phê duyệt." : "Đã đồng bộ trạng thái cần chỉnh sửa.");
    await refreshSelected(request.proposalPackageId);
  }

  async function sendToCustomer() {
    if (!selected || !sentReady) {
      return;
    }

    setIsBusy(true);
    const response = await fetch(`/api/proposal-packages/${encodeURIComponent(selected.id)}/send-to-customer?principal=${encodeURIComponent(principal)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Sent from Proposal workbench after approval gate cleared." })
    });
    const payload = await response.json();
    setIsBusy(false);

    if (!response.ok) {
      setNotice(payload.message || "Cổng gửi khách hàng vẫn đang khóa.");
      return;
    }

    setSelected(payload);
    setNotice("Đã hoàn tất cổng gửi khách hàng.");
    await refreshSelected(payload.id);
  }

  return (
    <ShopifyAppShell active={config.active} principal="founder">
      <ShopifyPage heading={config.title}>
        <div className="proposal-workbench">
          <section className="proposal-hero" aria-labelledby="proposal-workbench-overview">
            <div className="proposal-hero-copy">
              <span className="proposal-kicker">{config.operatingFunction}</span>
              <h2 id="proposal-workbench-overview">Hàng đợi đề xuất</h2>
              <p>Tạo gói, hoàn tất phê duyệt rồi gửi bản phù hợp cho khách hàng.</p>
              <div className="proposal-state-row" aria-label="Trạng thái sẵn sàng của đề xuất">
                <s-badge tone="success">Dữ liệu sẵn sàng</s-badge>
                <s-badge tone={pendingRequests.length ? "warning" : "info"}>
                  {pendingRequests.length ? `${pendingRequests.length} lượt chờ duyệt` : "Đã sạch phê duyệt"}
                </s-badge>
              </div>
            </div>
            <div className="proposal-action-cluster" aria-label="Proposal actions">
              <button className="proposal-primary-action" type="button" onClick={() => setComposerOpen(true)}>
                <ShopifyIcon name="plus" size={15} />
                Tạo gói đề xuất
              </button>
              <button className="proposal-secondary-action" type="button" onClick={() => selected && refreshSelected(selected.id)} disabled={isBusy}>
                <ShopifyIcon name="handoff" size={15} />
                Làm mới trạng thái
              </button>
              <span>{notice || "Theo dõi gói đề xuất, checklist và trạng thái sẵn sàng gửi."}</span>
            </div>
          </section>

          <div className="proposal-metric-strip" aria-label="Proposal metrics">
            {metrics.map((metric) => (
              <article className="proposal-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </div>

          <div className="proposal-main-grid">
            <section className="proposal-panel proposal-queue-panel" aria-labelledby="proposal-queue-heading">
              <div className="proposal-panel-header">
                <div>
                  <span className="proposal-kicker">Hàng đợi đề xuất</span>
                  <h3 id="proposal-queue-heading">Gói đề xuất</h3>
                </div>
                <s-badge tone="info">{packages.length} đang mở</s-badge>
              </div>

              <div className="proposal-package-list">
                {isLoading && <p className="proposal-empty-state">Đang tải hàng đợi đề xuất...</p>}
                {!isLoading && packages.length === 0 && <p className="proposal-empty-state">Chưa có gói đề xuất nào. Tạo gói đầu tiên từ một cơ hội đang mở.</p>}
                {packages.map((proposal) => (
                  <button
                    className="proposal-package-card"
                    data-selected={proposal.id === selectedId}
                    data-tone={proposalStatusTone[proposal.status]}
                    key={proposal.id}
                    onClick={() => setSelectedId(proposal.id)}
                    type="button"
                  >
                    <div className="proposal-package-head">
                      <div>
                        <strong>{proposal.title}</strong>
                        <span>{proposal.accountName}</span>
                      </div>
                      <s-badge tone={proposalStatusTone[proposal.status]}>{humanize(proposal.status)}</s-badge>
                    </div>
                    <div className="proposal-package-meta" aria-label={`${proposal.title} proposal metadata`}>
                      <span>
                        <ShopifyIcon name="cash" size={14} />
                        <MoneyAmount value={proposal.proposedAmount ?? 0} />
                      </span>
                      <span>
                        <ShopifyIcon name="briefcase" size={14} />
                        v{proposal.version}
                      </span>
                      <span>
                        <ShopifyIcon name="calendar" size={14} />
                        {formatShortDate(proposal.updatedAt)}
                      </span>
                    </div>
                    <div className="proposal-progress-row">
                      <span>{proposalPackageLabel(proposal.packageType)}</span>
                      <span>Rủi ro {humanize(proposal.scopeRiskLevel).toLowerCase()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <aside className="proposal-panel proposal-deal-panel" aria-labelledby="proposal-deal-heading">
              <div className="proposal-panel-header">
                <div>
                  <span className="proposal-kicker">Bàn đề xuất</span>
                  <h3 id="proposal-deal-heading">Sẵn sàng gửi</h3>
                </div>
                <ShopifyIcon name="briefcase" size={18} />
              </div>

              <div className="proposal-readiness-flow">
                {[
                  {
                    label: "Gói",
                    state: selected ? "Đang mở" : "Chọn gói",
                    tone: selected ? "success" : "neutral"
                  },
                  {
                    label: "Tài liệu",
                    state: selected ? `${completedRequirementCount}/${selectedRequirements.length}` : "0/0",
                    tone: selected?.gateCheck.missingDocuments.length ? "warning" : "success"
                  },
                  {
                    label: "Phê duyệt",
                    state: pendingRequests.length ? `${pendingRequests.length} chờ` : selected?.approvalRequests.length ? "Đã sạch" : "Chưa gửi",
                    tone: pendingRequests.length ? "warning" : selected?.approvalRequests.length ? "success" : "info"
                  },
                  {
                    label: "Cổng gửi",
                    state: sentReady ? "Đã mở" : "Đang khóa",
                    tone: sentReady ? "success" : "warning"
                  }
                ].map((step) => (
                  <div className="proposal-flow-step" data-tone={step.tone} key={step.label}>
                    <span>{step.label}</span>
                    <strong>{step.state}</strong>
                  </div>
                ))}
              </div>

              <div className="proposal-next-action">
                <span>Cổng gửi khách hàng</span>
                <strong>{alreadySent ? "Gói này đã gửi cho khách hàng." : sentReady ? "Phê duyệt đã sạch, có thể gửi khách hàng." : sendLockedReason}</strong>
                <p>{selected ? `${selected.title} · ${humanize(selected.status)}` : "Chọn một gói đề xuất để kiểm tra mức sẵn sàng."}</p>
                <button className="proposal-primary-action" disabled={!sentReady || alreadySent || isBusy} onClick={sendToCustomer} type="button">
                  <ShopifyIcon name="handoff" size={15} />
                  {alreadySent ? "Đã gửi khách hàng" : "Gửi khách hàng"}
                </button>
              </div>
            </aside>
          </div>

          {selected && (
            <div className="proposal-main-grid">
              <section className="proposal-panel" aria-labelledby="proposal-documents-heading">
                <div className="proposal-panel-header">
                  <div>
                    <span className="proposal-kicker">Checklist gói đề xuất</span>
                    <h3 id="proposal-documents-heading">Tài liệu bắt buộc</h3>
                  </div>
                  <s-badge tone={selected.gateCheck.missingDocuments.length ? "warning" : "success"}>
                    {completedRequirementCount}/{selectedRequirements.length} sẵn sàng
                  </s-badge>
                </div>

                <div className="proposal-document-pills">
                  {selectedRequirements.map((documentType) => {
                    const document = selected.documents.find((item) => item.documentType === documentType);
                    return (
                      <div className="proposal-document-pill" data-ready={Boolean(document)} key={documentType}>
                        <span>{document ? "Sẵn sàng" : "Thiếu"}</span>
                        <strong>{proposalDocumentLabel(documentType)}</strong>
                      </div>
                    );
                  })}
                </div>

                <div className="proposal-inline-actions">
                  <span>{missingDocumentCount ? `Còn thiếu ${missingDocumentCount} tài liệu bắt buộc` : "Đã đủ tài liệu bắt buộc"}</span>
                  <button
                    className="proposal-link-action"
                    onClick={() => setDocumentComposerOpen((current) => !current)}
                    type="button"
                  >
                    {documentComposerOpen ? "Ẩn form" : missingDocumentCount ? "Gắn tài liệu thiếu" : "Thêm phiên bản"}
                  </button>
                </div>

                {(documentComposerOpen || missingDocumentCount > 0) && (
                  <div className="proposal-document-composer">
                  <div className="proposal-chip-row" aria-label="Document type">
                    {(selected.gateCheck.missingDocuments.length ? selected.gateCheck.missingDocuments : selectedRequirements).map((documentType) => (
                      <button
                        className="proposal-chip"
                        data-selected={documentDraft.documentType === documentType}
                        key={documentType}
                        onClick={() => setDocumentDraft((current) => ({ ...current, documentType }))}
                        type="button"
                      >
                        {proposalDocumentLabel(documentType)}
                      </button>
                    ))}
                  </div>
                  <div className="proposal-form-grid">
                    <label>
                    <span>Tên tài liệu</span>
                      <input
                        onChange={(event) => setDocumentDraft((current) => ({ ...current, title: event.target.value }))}
                        placeholder="VD: SOW triển khai v1"
                        value={documentDraft.title}
                      />
                    </label>
                    <label>
                    <span>Liên kết tài liệu</span>
                      <input
                        onChange={(event) => setDocumentDraft((current) => ({ ...current, externalUrl: event.target.value }))}
                        placeholder="https://..."
                        value={documentDraft.externalUrl}
                      />
                    </label>
                  </div>
                  <button className="proposal-secondary-action" disabled={isBusy} onClick={attachDocument} type="button">
                    <ShopifyIcon name="plus" size={15} />
                    Gắn tài liệu
                  </button>
                  </div>
                )}
              </section>

              <aside className="proposal-panel" aria-labelledby="proposal-approval-heading">
                <div className="proposal-panel-header">
                  <div>
                    <span className="proposal-kicker">Luồng phê duyệt</span>
                    <h3 id="proposal-approval-heading">Yêu cầu phê duyệt</h3>
                  </div>
                  <button
                    className="proposal-secondary-action"
                    disabled={selected.gateCheck.missingDocuments.length > 0 || selected.approvalRequests.length > 0 || isBusy}
                    onClick={submitReview}
                    type="button"
                  >
                    {selected.approvalRequests.length > 0 ? "Đã gửi review" : "Gửi review"}
                  </button>
                </div>

                <div className="proposal-approval-list">
                  {selected.approvalRequests.length === 0 && (
                    <p className="proposal-empty-state">Gửi review sau khi đã gắn đủ tài liệu bắt buộc.</p>
                  )}
                  {selected.approvalRequests.map((request) => (
                    <article className="proposal-approval-card" key={request.id}>
                      <div>
                        <strong>{humanize(request.requestType)}</strong>
                        <span>{formatApprovalRole(request.requiredRoleCode)} · mức {humanize(request.severity).toLowerCase()}</span>
                      </div>
                      <s-badge tone={request.status === "approved" ? "success" : request.status === "submitted" ? "warning" : "critical"}>
                        {humanize(request.status)}
                      </s-badge>
                      {request.status === "submitted" && <p>{request.reason}</p>}
                      {request.larkApprovalInstanceCode && (
                        <details className="proposal-mini-disclosure">
                          <summary>Mã đồng bộ nội bộ</summary>
                          <code>Đã ẩn khỏi giao diện vận hành</code>
                        </details>
                      )}
                      {request.status === "submitted" && (
                        <div className="proposal-card-actions">
                          <button className="proposal-secondary-action" disabled={isBusy} onClick={() => syncApproval(request, "APPROVED")} type="button">
                            Đồng bộ đã duyệt
                          </button>
                          <button className="proposal-link-action" disabled={isBusy} onClick={() => syncApproval(request, "REJECTED")} type="button">
                            Yêu cầu sửa
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </aside>
            </div>
          )}

          {composerOpen && (
            <ModalLayer onClose={() => setComposerOpen(false)}>
            <div className="proposal-modal-backdrop" role="presentation">
              <div aria-labelledby="proposal-composer-heading" aria-modal="true" className="proposal-composer-modal" role="dialog" tabIndex={-1}>
                <div className="proposal-panel-header">
                  <div>
                    <span className="proposal-kicker">Tạo gói đề xuất</span>
                    <h3 id="proposal-composer-heading">Tạo gói đề xuất</h3>
                  </div>
                  <button className="proposal-icon-button" onClick={() => setComposerOpen(false)} type="button">
                    <ShopifyIcon name="x" size={18} />
                  </button>
                </div>

                <div className="proposal-chip-grid" aria-label="Opportunity selector">
                  {opportunities.slice(0, 6).map((opportunity) => (
                    <button
                      className="proposal-choice-card"
                      data-selected={composerDraft.opportunityId === opportunity.id}
                      key={opportunity.id}
                      onClick={() => setComposerDraft((current) => ({ ...current, opportunityId: opportunity.id }))}
                      type="button"
                    >
                      <strong>{opportunity.title}</strong>
                      <span>{opportunity.accountName} · {humanize(opportunity.stage)}</span>
                    </button>
                  ))}
                </div>

                <div className="proposal-chip-row" aria-label="Package type selector">
                  {PROPOSAL_PACKAGE_TYPES.map((packageType) => (
                    <button
                      className="proposal-chip"
                      data-selected={composerDraft.packageType === packageType.code}
                      key={packageType.code}
                      onClick={() => setComposerDraft((current) => ({ ...current, packageType: packageType.code }))}
                      type="button"
                    >
                      {packageType.label}
                    </button>
                  ))}
                </div>

                <div className="proposal-form-grid">
                  <label>
                    <span>Tên gói</span>
                    <input
                      onChange={(event) => setComposerDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder="VD: CRM/ERP phase 2"
                      value={composerDraft.title}
                    />
                  </label>
                  <label>
                    <span>Giá trị (đ)</span>
                    <input
                      inputMode="numeric"
                      onChange={(event) => setComposerDraft((current) => ({ ...current, proposedAmount: event.target.value }))}
                      placeholder="350000000"
                      value={composerDraft.proposedAmount}
                    />
                  </label>
                  <label>
                    <span>Chiết khấu %</span>
                    <input
                      inputMode="decimal"
                      onChange={(event) => setComposerDraft((current) => ({ ...current, discountPercent: event.target.value }))}
                      placeholder="0"
                      value={composerDraft.discountPercent}
                    />
                  </label>
                  <label>
                    <span>Điều khoản thanh toán</span>
                    <input
                      onChange={(event) => setComposerDraft((current) => ({ ...current, paymentTermSummary: event.target.value }))}
                      placeholder="50% kickoff / 50% acceptance"
                      value={composerDraft.paymentTermSummary}
                    />
                  </label>
                </div>

                <div className="proposal-chip-row" aria-label="Chọn mức rủi ro phạm vi">
                  {(["low", "medium", "high", "critical"] as const).map((scopeRiskLevel) => (
                    <button
                      className="proposal-chip"
                      data-selected={composerDraft.scopeRiskLevel === scopeRiskLevel}
                      key={scopeRiskLevel}
                      onClick={() => setComposerDraft((current) => ({ ...current, scopeRiskLevel }))}
                      type="button"
                    >
                      {humanize(scopeRiskLevel)}
                    </button>
                  ))}
                </div>

                <div className="proposal-modal-actions">
                  <button className="proposal-secondary-action" onClick={() => setComposerOpen(false)} type="button">
                    Hủy
                  </button>
                  <button className="proposal-primary-action" disabled={isBusy} onClick={createPackage} type="button">
                    Tạo gói
                  </button>
                </div>
              </div>
            </div>
            </ModalLayer>
          )}
        </div>
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

function humanize(value: string) {
  const labels: Record<string, string> = {
    approved: "Đã duyệt",
    critical: "Rất cao",
    customer_accepted: "Khách đã chấp nhận",
    discount_approval: "Duyệt chiết khấu",
    high: "Cao",
    internal_review: "Đang review nội bộ",
    internally_approved: "Đã duyệt nội bộ",
    low: "Thấp",
    medium: "Vừa",
    payment_term_approval: "Duyệt điều khoản thanh toán",
    proposal: "Đề xuất",
    rejected: "Từ chối",
    sent_to_customer: "Đã gửi khách hàng",
    submitted: "Đã gửi"
  };
  if (labels[value]) return labels[value];

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatApprovalRole(value: string) {
  const labels: Record<string, string> = {
    DELIVERY_LEAD: "Delivery Lead",
    FINANCE_ADMIN: "Tài chính",
    FOUNDER_GM: "Founder/GM",
    SALES_OWNER: "Sales Owner"
  };
  return labels[value] ?? "Người duyệt";
}


function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

export function ProposalBusinessFunctionPage() {
  return <ProposalWorkbench config={businessFunctionConfigs.proposals} />;
}
