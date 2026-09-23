"use client";
import { MoneyAmount } from "@/components/money-amount";

import { useState } from "react";
import type { AccountsResponse, LeadSummary, OpportunitySummary, ResourceListResponse, SalesOwnerSummary } from "@b2b-crm/contracts";
import { SalesIntakePanel } from "./commands";
import { stageOptions } from "./constants";
import { OpportunityDrawers, OpportunityDetailPage } from "./opportunity-drawers";
import { OpportunityTable } from "./opportunity-table";
import { useOpportunityWorkbench } from "./use-opportunity-workbench";
import { formatVnd, formatNumber, formatStageLabel } from "./utils";
import { ShopifyIcon, type ShopifyIconName } from "../shopify-ui";

export function SalesPipelineCrud({
  accounts,
  initialLeads,
  initialOpportunities,
  salesOwners,
  principal
}: {
  accounts: AccountsResponse;
  initialLeads: ResourceListResponse<LeadSummary>;
  initialOpportunities: ResourceListResponse<OpportunitySummary>;
  salesOwners: ResourceListResponse<SalesOwnerSummary>;
  principal: string;
}) {
  const workbench = useOpportunityWorkbench({ initialLeads, initialOpportunities, salesOwners, principal });
  const { message, opportunities, pipelineStats } = workbench.state;
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  const isPipelineRestricted = opportunities.length > 0 && opportunities.some(item => item.amount === undefined);
  const visiblePipeline = opportunities.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const wonCount = opportunities.filter((item) => item.stage === "won").length;
  
  const winRate = opportunities.length ? (wonCount / opportunities.length) * 100 : 0;
  const staleRate = opportunities.length ? (pipelineStats.staleCount / opportunities.length) * 100 : 0;

  const { detailOpen, activityOpen, financeOpen, selected } = workbench.state;
  const isDetailActive = (detailOpen || activityOpen || financeOpen) && selected !== null;

  if (isDetailActive) {
    return (
      <s-section heading="Chi tiết cơ hội">
        <OpportunityDetailPage 
          workbench={workbench} 
          onBack={() => {
            workbench.actions.setDetailOpen(false);
            workbench.actions.setActivityOpen(false);
            workbench.actions.setFinanceOpen(false);
          }}
        />
        <OpportunityDrawers workbench={workbench} />
      </s-section>
    );
  }

  return (
    <s-section heading="Quản lý pipeline">
      {/* Top Actions Toolbar */}
      <div className="shopify-index-toolbar pipeline-action-model">
        <div>
          <strong className="pipeline-action-title">Tạo lead mới</strong>
          <span className="pipeline-action-copy">
            Nhập khách hàng, người liên hệ và tín hiệu nhu cầu để đội bán hàng tiếp tục chăm sóc.
          </span>
        </div>
        <div className="pipeline-global-actions" aria-label="Hành động pipeline">
          <PipelineActionButton icon="users" label="Tạo lead" onClick={() => openPipelineCommand("lcrm:open-capture-lead")} primary />
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="kpi-metric-grid" style={{ marginBottom: "24px" }}>
        <div className="kpi-metric-card" style={{ "--kpi-border": "#008060" } as React.CSSProperties}>
          <span className="kpi-label">Giá trị cơ hội đang mở</span>
          <div className="kpi-value">
            {isPipelineRestricted ? "Bị giới hạn" : <MoneyAmount value={visiblePipeline} />}
          </div>
          <div className="kpi-detail">
            <span className="kpi-badge" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}>
              {pipelineStats.openCount} cơ hội mở
            </span>
          </div>
        </div>

        <div className="kpi-metric-card" style={{ "--kpi-border": "#47c1bf" } as React.CSSProperties}>
          <span className="kpi-label">Dự báo có trọng số</span>
          <div className="kpi-value">
            {isPipelineRestricted ? "Bị giới hạn" : <MoneyAmount value={pipelineStats.weighted} />}
          </div>
          <div className="kpi-detail">
            <span className="kpi-badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
              Theo xác suất thắng
            </span>
          </div>
        </div>

        <div className="kpi-metric-card" style={{ "--kpi-border": "var(--success)" } as React.CSSProperties}>
          <span className="kpi-label">Tỷ lệ thắng</span>
          <div className="kpi-value" style={{ color: "var(--success)" }}>
            {formatNumber(winRate)}%
          </div>
          <div className="kpi-detail">
            <span className="kpi-badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
              {wonCount} thắng / {opportunities.length} tổng
            </span>
          </div>
        </div>

        <div className="kpi-metric-card" style={{ "--kpi-border": pipelineStats.staleCount ? "var(--warning)" : "var(--success)" } as React.CSSProperties}>
          <span className="kpi-label">Cần chăm sóc</span>
          <div className="kpi-value" style={{ color: pipelineStats.staleCount ? "var(--warning)" : "var(--success)" }}>
            {pipelineStats.staleCount}
          </div>
          <div className="kpi-detail">
            <span className="kpi-badge" style={{ 
              background: pipelineStats.staleCount ? "var(--warning-soft)" : "var(--success-soft)", 
              color: pipelineStats.staleCount ? "var(--warning)" : "var(--success)" 
            }}>
              {formatNumber(staleRate)}% cần xử lý
            </span>
          </div>
        </div>
      </div>

      {/* Stage Flow (Chevron flow) */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <span className="eyebrow" style={{ fontSize: "10px", fontWeight: "700", textTransform: "none", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
            Phân bổ theo giai đoạn
          </span>
          {selectedStage && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-subtle)", fontWeight: "500" }}>
                Đang lọc: <strong style={{ color: "#008c65" }}>{formatStageLabel(selectedStage)}</strong>
              </span>
              <button 
                onClick={() => setSelectedStage(null)}
                style={{ 
                  background: "rgba(92, 106, 196, 0.1)", 
                  border: "none", 
                  color: "#5c6ac4", 
                  padding: "2px 8px", 
                  borderRadius: "12px", 
                  fontSize: "10px", 
                  fontWeight: 700, 
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "3px"
                }}
              >
                <span>Xóa bộ lọc</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}
        </div>
        <StageDistribution 
          opportunities={opportunities} 
          isPipelineRestricted={isPipelineRestricted} 
          selectedStage={selectedStage}
          onSelectStage={setSelectedStage}
        />
      </div>

      <SalesIntakePanel accounts={accounts} initialLeads={initialLeads} principal={principal} />

      <div className="shopify-index-note" aria-live="polite">
        {message}
      </div>

      <OpportunityTable workbench={workbench} stageFilter={selectedStage} />
      <OpportunityDrawers workbench={workbench} />
    </s-section>
  );
}

function PipelineActionButton({
  destructive = false,
  disabled = false,
  icon,
  label,
  onClick,
  primary = false,
  reason
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: ShopifyIconName;
  label: string;
  onClick: () => void;
  primary?: boolean;
  reason?: string;
}) {
  return (
    <button
      aria-label={reason ? `${label}. ${reason}` : label}
      className={[
        "pipeline-command-button",
        primary ? "primary" : "",
        destructive ? "destructive" : ""
      ].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={reason}
      type="button"
    >
      <ShopifyIcon name={icon} size={15} />
      <span>{label}</span>
    </button>
  );
}

function getStageIcon(stage: string, color: string = "currentColor") {
  switch (stage.toLowerCase()) {
    case "lead":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "qualified":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <polyline points="17 11 19 13 23 9" />
        </svg>
      );
    case "discovery":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      );
    case "solution":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "demo":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <polygon points="10 8 16 10 10 12" fill="none" stroke={color} strokeWidth="2.5" />
        </svg>
      );
    case "proposal":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "negotiation":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="16" y1="8" x2="8" y2="16" />
          <circle cx="8.5" cy="8.5" r="1.5" fill={color} />
          <circle cx="15.5" cy="15.5" r="1.5" fill={color} />
        </svg>
      );
    case "contracting":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case "won":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" />
          <path d="M12 2a4 4 0 0 1 4 4v7H8V6a4 4 0 0 1 4-4z" />
        </svg>
      );
    case "lost":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    default:
      return null;
  }
}

function StageDistribution({ 
  opportunities, 
  isPipelineRestricted,
  selectedStage,
  onSelectStage
}: { 
  opportunities: OpportunitySummary[];
  isPipelineRestricted: boolean;
  selectedStage: string | null;
  onSelectStage: (stage: string | null) => void;
}) {
  return (
    <div className="pipeline-stage-flow" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px" }}>
      {stageOptions.map((stage) => {
        const stageItems = opportunities.filter((item) => item.stage === stage);
        const count = stageItems.length;
        const amount = stageItems.reduce((sum, item) => sum + (item.amount ?? 0), 0);
        const isSelected = selectedStage === stage;
        const hasDeals = count > 0;
        
        let accentColor = "#8c9196";
        let softBg = "rgba(140, 145, 150, 0.04)";
        let activeBg = "linear-gradient(135deg, rgba(140, 145, 150, 0.12), rgba(109, 113, 117, 0.22))";
        
        switch (stage.toLowerCase()) {
          case "qualified":
            accentColor = "#5c6ac4";
            softBg = "rgba(92, 106, 196, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(92, 106, 196, 0.12), rgba(92, 106, 196, 0.22))";
            break;
          case "discovery":
            accentColor = "#3f81e5";
            softBg = "rgba(63, 129, 229, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(63, 129, 229, 0.12), rgba(63, 129, 229, 0.22))";
            break;
          case "solution":
            accentColor = "#249abf";
            softBg = "rgba(36, 154, 191, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(36, 154, 191, 0.12), rgba(36, 154, 191, 0.22))";
            break;
          case "demo":
            accentColor = "#7388ec";
            softBg = "rgba(115, 136, 236, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(115, 136, 236, 0.12), rgba(115, 136, 236, 0.22))";
            break;
          case "proposal":
            accentColor = "#ffd573";
            softBg = "rgba(255, 213, 115, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(255, 213, 115, 0.12), rgba(230, 175, 60, 0.22))";
            break;
          case "negotiation":
            accentColor = "#ff9f3b";
            softBg = "rgba(255, 159, 59, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(255, 159, 59, 0.12), rgba(224, 127, 27, 0.22))";
            break;
          case "contracting":
            accentColor = "#e07f1b";
            softBg = "rgba(224, 127, 27, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(224, 127, 27, 0.12), rgba(216, 44, 13, 0.22))";
            break;
          case "won":
            accentColor = "#10a37f";
            softBg = "rgba(16, 163, 127, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(16, 163, 127, 0.12), rgba(0, 128, 96, 0.22))";
            break;
          case "lost":
            accentColor = "#d82c0d";
            softBg = "rgba(216, 44, 13, 0.04)";
            activeBg = "linear-gradient(135deg, rgba(216, 44, 13, 0.12), rgba(216, 44, 13, 0.22))";
            break;
        }

        const borderStyle = isSelected
          ? `2.5px solid ${accentColor}`
          : hasDeals
          ? `1px solid ${accentColor}`
          : "1px solid var(--border)";

        const bgStyle = isSelected
          ? activeBg
          : hasDeals
          ? softBg
          : "var(--panel-muted)";

        const shadowStyle = isSelected
          ? `0 6px 16px rgba(0, 0, 0, 0.05), inset 0 0 0 1px ${accentColor}`
          : hasDeals
          ? "0 2px 8px rgba(0, 0, 0, 0.02)"
          : "none";

        return (
          <button
            aria-label={`${formatStageLabel(stage)}: ${count} cơ hội${count > 0 && !isPipelineRestricted && amount > 0 ? `, ${formatVnd(amount)}` : ""}. ${isSelected ? "Bỏ lọc giai đoạn này" : "Lọc theo giai đoạn này"}`}
            aria-pressed={isSelected}
            onClick={() => onSelectStage(isSelected ? null : stage)}
            className={`pipeline-stage-card premium-widget-hover ${isSelected ? "active" : ""} ${hasDeals ? "has-deals" : ""}`} 
            key={stage} 
            title={`${formatStageLabel(stage)}: ${count} cơ hội`}
            type="button"
            style={{ 
              borderRadius: "10px", 
              padding: "14px 10px",
              background: bgStyle,
              border: borderStyle,
              boxShadow: shadowStyle,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              opacity: hasDeals ? 1 : 0.45,
              minHeight: "100px",
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              position: "relative"
            }}
          >
            {/* Top row: Icon & Status Dot */}
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", marginBottom: "4px", padding: "0 4px" }}>
              <div style={{ opacity: hasDeals ? 0.9 : 0.4, display: "flex", alignItems: "center" }}>
                {getStageIcon(stage, hasDeals ? accentColor : "var(--text-muted)")}
              </div>
              {hasDeals && (
                <span style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  background: accentColor,
                  boxShadow: `0 0 6px ${accentColor}`,
                  display: "inline-block"
                }} />
              )}
            </div>

            {/* Middle: Stage Name */}
            <span 
              className="pipeline-stage-name" 
              style={{ 
                fontSize: "10px", 
                fontWeight: 700,
                textTransform: "none",
                letterSpacing: "0.05em",
                color: isSelected ? "var(--text)" : "var(--text-muted)",
                marginTop: "8px",
                marginBottom: "4px"
              }}
            >
              {formatStageLabel(stage)}
            </span>

            {/* Bottom: Count & Money */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "auto" }}>
              <span 
                className="pipeline-stage-count" 
                style={{ 
                  fontSize: "18px", 
                  fontWeight: 800,
                  color: isSelected ? "var(--text)" : hasDeals ? "var(--text)" : "var(--text-subtle)",
                  fontFamily: "var(--font-sans)"
                }}
              >
                {count}
              </span>
              {count > 0 && !isPipelineRestricted && amount > 0 && (
                <span style={{ 
                  fontSize: "9.5px", 
                  color: isSelected ? "var(--text-muted)" : "var(--text-subtle)", 
                  fontWeight: 600, 
                  marginTop: "2px",
                  fontFamily: "var(--font-sans)"
                }}>
                  <MoneyAmount value={amount} />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function openPipelineCommand(eventName: "lcrm:open-capture-lead" | "lcrm:open-create-opportunity" | "lcrm:open-disqualify-lead") {
  window.dispatchEvent(new Event(eventName));
}
