import { ArrowDown } from "lucide-react";
import { MoneyAmount } from "@/components/money-amount";
import { formatCompactVnd as sharedFormatCompactVnd } from "@/lib/currency";
import type { AccountsResponse, DashboardSummaryResponse, OpportunitySummary, ProcessMetricsResponse, ResourceListResponse } from "@b2b-crm/contracts";
import { PolarisFallbackText, ShopifyDataTable, ShopifySection, ShopifyStatusItem } from "../shopify-ui";

const stageOrder = ["lead", "qualified", "discovery", "solution", "demo", "proposal", "negotiation", "contracting", "won", "lost"] as const;

export function SalesHealthStrip({
  accounts,
  opportunities
}: {
  accounts: AccountsResponse;
  opportunities: ResourceListResponse<OpportunitySummary>;
}) {
  const openDeals = opportunities.data.filter((item) => item.stage !== "won" && item.stage !== "lost");
  const staleCount = opportunities.data.filter((item) => item.stale).length;
  
  const isPipelineRestricted = opportunities.data.length > 0 && opportunities.data.some(item => item.amount === undefined);
  const isWeightedRestricted = opportunities.data.length > 0 && opportunities.data.some(item => item.weightedForecast === undefined);
  const isAnnualRestricted = accounts.data.length > 0 && accounts.data.some(item => item.annualValue === undefined);

  const visiblePipeline = opportunities.data.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const weighted = opportunities.data.reduce((sum, item) => sum + (item.weightedForecast ?? 0), 0);
  const annualValue = accounts.data.reduce((sum, account) => sum + (account.annualValue ?? 0), 0);

  return (
    <div className="kpi-metric-grid">
      {/* Card 1: Opportunity value */}
      <div className="kpi-metric-card" style={{ "--kpi-border": "#008060" } as React.CSSProperties}>
        <span className="kpi-label">Cơ hội đang mở</span>
        <div className="kpi-value">
          {isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={visiblePipeline} />}
        </div>
        <div className="kpi-detail">
          <span className="kpi-badge" style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}>
            {openDeals.length} cơ hội đang mở
          </span>
        </div>
      </div>

      {/* Card 2: Forecast */}
      <div className="kpi-metric-card" style={{ "--kpi-border": "#47c1bf" } as React.CSSProperties}>
        <span className="kpi-label">Dự báo có trọng số</span>
        <div className="kpi-value">
          {isWeightedRestricted ? "Đang ẩn" : <MoneyAmount value={weighted} />}
        </div>
        <div className="kpi-detail">
          <span className="kpi-badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            Đã điều chỉnh theo xác suất
          </span>
        </div>
      </div>

      {/* Card 3: Annual ACV */}
      <div className="kpi-metric-card" style={{ "--kpi-border": "#5c6ac4" } as React.CSSProperties}>
        <span className="kpi-label">Giá trị năm</span>
        <div className="kpi-value">
          {isAnnualRestricted ? "Đang ẩn" : <MoneyAmount value={annualValue} />}
        </div>
        <div className="kpi-detail">
          <span className="kpi-badge" style={{ background: "#f0f1f9", color: "#4f5bab" }}>
            Tổng nền khách hàng
          </span>
        </div>
      </div>

      {/* Card 4: Stale Opportunities */}
      <div className="kpi-metric-card" style={{ "--kpi-border": staleCount ? "var(--danger)" : "var(--success)" } as React.CSSProperties}>
        <span className="kpi-label">Cơ hội cần rà soát</span>
        <div className="kpi-value" style={{ color: staleCount ? "var(--danger)" : "var(--success)" }}>
          {staleCount}
        </div>
        <div className="kpi-detail">
          {staleCount ? (
            <span className="kpi-badge" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              Cần rà soát
            </span>
          ) : (
            <span className="kpi-badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
              Đang ổn
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PipelineOverview({
  opportunities
}: {
  opportunities: ResourceListResponse<OpportunitySummary>;
}) {
  const isPipelineRestricted = opportunities.data.length > 0 && opportunities.data.some(item => item.amount === undefined);
  const visibleAmount = opportunities.data.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const weighted = opportunities.data.reduce((sum, item) => sum + (item.weightedForecast ?? 0), 0);
  const staleCount = opportunities.data.filter((item) => item.stale).length;
  const wonCount = opportunities.data.filter((item) => item.stage === "won").length;

  const totalDeals = opportunities.data.length;
  const winRate = totalDeals ? Math.round((wonCount / totalDeals) * 100) : 0;
  const staleRate = totalDeals ? Math.round((staleCount / totalDeals) * 100) : 0;

  return (
    <ShopifySection heading="Tình hình cơ hội">
      <div className="kpi-metric-grid" style={{ marginBottom: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
        <div className="kpi-metric-card" style={{ padding: "12px 14px", "--kpi-border": "var(--border)" } as React.CSSProperties}>
          <span className="kpi-label" style={{ fontSize: "10px" }}>Tổng giá trị cơ hội</span>
          <div className="kpi-value" style={{ fontSize: "18px" }}>
            {isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={visibleAmount} />}
          </div>
        </div>
        <div className="kpi-metric-card" style={{ padding: "12px 14px", "--kpi-border": "#47c1bf" } as React.CSSProperties}>
          <span className="kpi-label" style={{ fontSize: "10px" }}>Dự báo có trọng số</span>
          <div className="kpi-value" style={{ fontSize: "18px" }}>
            {isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={weighted} />}
          </div>
        </div>
        <div className="kpi-metric-card" style={{ padding: "12px 14px", "--kpi-border": "var(--success)" } as React.CSSProperties}>
          <span className="kpi-label" style={{ fontSize: "10px" }}>Tỷ lệ thắng</span>
          <div className="kpi-value" style={{ fontSize: "18px", color: "var(--success)" }}>
            {winRate}%
          </div>
          <span className="kpi-detail" style={{ fontSize: "9px", marginTop: "2px" }}>{wonCount} thắng / {totalDeals} tổng</span>
        </div>
        <div className="kpi-metric-card" style={{ padding: "12px 14px", "--kpi-border": staleCount ? "var(--warning)" : "var(--success)" } as React.CSSProperties}>
          <span className="kpi-label" style={{ fontSize: "10px" }}>Tỷ lệ cần rà soát</span>
          <div className="kpi-value" style={{ fontSize: "18px", color: staleCount ? "var(--warning)" : "var(--success)" }}>
            {staleRate}%
          </div>
          <span className="kpi-detail" style={{ fontSize: "9px", marginTop: "2px" }}>{staleCount} cơ hội cần rà soát</span>
        </div>
      </div>

      <div style={{ marginTop: "16px" }}>
        <span className="eyebrow" style={{ fontSize: "10px", color: "var(--text-muted)", display: "block", marginBottom: "8px" }}>
          Phân bổ giai đoạn cơ hội
        </span>
        <div className="pipeline-stage-flow">
          {stageOrder.map((stage) => {
            const stageItems = opportunities.data.filter((item) => item.stage === stage);
            const count = stageItems.length;
            const amount = stageItems.reduce((sum, item) => sum + (item.amount ?? 0), 0);
            
            let cardClass = "pipeline-stage-card";
            if (stage === "won") cardClass += " won";
            else if (stage === "lost") cardClass += " lost";
            else if (count > 0) cardClass += " active";

            return (
              <div className={cardClass} key={stage} title={`${stage}: ${count} cơ hội`}>
                <span className="pipeline-stage-name">{stage}</span>
                <span className="pipeline-stage-count">{count}</span>
                {count > 0 && !isPipelineRestricted && amount > 0 && (
                  <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "500", marginTop: "2px" }}>
                    <MoneyAmount value={amount} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ShopifySection>
  );
}

export function ProcessMetricsPanel({ metrics }: { metrics: ProcessMetricsResponse }) {
  const isValueRestricted = metrics.data.length > 0 && metrics.data.some(item => item.value === undefined);

  const getStageColor = (level: string) => {
    switch (level) {
      case "L0": return "#47c1bf"; // Teal
      case "L1": return "#008060"; // Green
      case "L2": return "#00a47c"; // Mint
      case "L3": return "#5c6ac4"; // Indigo
      case "L4": return "#8979db"; // Purple
      case "L5": return "#aa6ad6"; // Purple-pink
      case "L6": return "#108043"; // Forest green
      case "L7": return "#0b6635"; // Dark forest
      case "L8": return "#074c26"; // Deep dark green
      default: return "var(--accent)";
    }
  };

  return (
    <ShopifySection heading="L0-L8 Process Funnel">
      <div className="funnel-container">
        {metrics.data.map((item, index) => {
          const widthPct = 100 - (index * 5.5);
          const backgroundColor = getStageColor(item.level);

          return (
            <div className="funnel-stage-wrapper" key={item.level}>
              {index > 0 && (
                <div className="funnel-arrow-connector">
                  <div className="funnel-arrow-pct">
                    <ArrowDown aria-hidden="true" className="inline h-3 w-3 align-middle" /> {item.conversionFromPrevious ?? 0}% conversion
                  </div>
                </div>
              )}

              <div 
                className="funnel-stage"
                style={{ 
                  width: `${widthPct}%`,
                  backgroundColor,
                  opacity: 0.95
                }}
              >
                <div className="funnel-stage-info">
                  <span className="funnel-level-badge">{item.level}</span>
                  <span className="funnel-label">{item.label}</span>
                  {item.staleCount > 0 && (
                    <span 
                      style={{ 
                        background: "var(--danger)", 
                        color: "white", 
                        padding: "1px 6px", 
                        borderRadius: "10px", 
                        fontSize: "9px",
                        fontWeight: "bold",
                        marginLeft: "6px"
                      }}
                      title={`${item.staleCount} stale deals`}
                    >
                      ! {item.staleCount} stale
                    </span>
                  )}
                </div>

                <div className="funnel-stage-meta">
                  <span className="funnel-stage-count">{item.count} deals</span>
                  {!isValueRestricted && item.value !== undefined && (
                    <span className="funnel-stage-val"><MoneyAmount value={item.value} /></span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: "12px" }}>
        <PolarisFallbackText>Source: {metrics.meta.source}</PolarisFallbackText>
      </div>
    </ShopifySection>
  );
}

export function SalesActionPanel({
  opportunities
}: {
  opportunities: ResourceListResponse<OpportunitySummary>;
}) {
  const stale = opportunities.data.filter((item) => item.stale);
  const aged = [...opportunities.data].sort((a, b) => b.stageAgeDays - a.stageAgeDays).slice(0, 3);
  const actionItems = stale.length ? stale.slice(0, 3) : aged;

  return (
    <ShopifySection heading="Needs attention">
      {actionItems.length ? (
        <div className="shopify-resource-list" style={{ display: "grid", gap: "10px" }}>
          {actionItems.map((item) => (
            <article key={item.id} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              padding: "12px",
              borderRadius: "8px",
              border: `1px solid ${item.stale ? "var(--warning)" : "var(--border)"}`,
              background: item.stale ? "var(--warning-soft)" : "var(--panel)"
            }}>
              <div style={{ flex: 1, paddingRight: "10px" }}>
                <strong style={{ display: "block", fontSize: "13px", color: "var(--text)" }}>{item.title}</strong>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginTop: "2px" }}>
                  {item.accountName} · Age in stage: {item.stageAgeDays} days
                </span>
                {item.stale && item.staleReason && (
                  <span style={{ 
                    fontSize: "11px", 
                    color: "var(--danger)", 
                    display: "block", 
                    marginTop: "6px",
                    fontWeight: "600",
                    background: "rgba(216, 44, 13, 0.05)",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    borderLeft: "2px solid var(--danger)"
                  }}>
                    Risk: {item.staleReason}
                  </span>
                )}
              </div>
              <s-badge tone={item.stale ? "warning" : "neutral"}>
                {item.stale ? "stale" : `${item.stageAgeDays}d`}
              </s-badge>
            </article>
          ))}
        </div>
      ) : (
        <PolarisFallbackText>Chưa có cơ hội nào cần rà soát trong phạm vi đang xem.</PolarisFallbackText>
      )}
    </ShopifySection>
  );
}

export function FinancePanel({
  accounts,
  opportunities
}: {
  accounts: AccountsResponse;
  opportunities: ResourceListResponse<OpportunitySummary>;
}) {
  const isPipelineRestricted = opportunities.data.length > 0 && opportunities.data.some(item => item.amount === undefined);
  const isWeightedRestricted = opportunities.data.length > 0 && opportunities.data.some(item => item.weightedForecast === undefined);
  const isAnnualRestricted = accounts.data.length > 0 && accounts.data.some(item => item.annualValue === undefined);

  const annualValue = accounts.data.reduce((sum, account) => sum + (account.annualValue ?? 0), 0);
  const visiblePipeline = opportunities.data.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const weighted = opportunities.data.reduce((sum, item) => sum + (item.weightedForecast ?? 0), 0);

  return (
    <ShopifySection heading="Tín hiệu tài chính">
      <div className="shopify-status-grid compact stack-sm" style={{ gap: "10px" }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--panel)"
        }}>
          <div>
            <strong style={{ display: "block", fontSize: "13px", color: "var(--text)" }}>Giá trị năm</strong>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Tổng nhóm khách hàng</span>
          </div>
          <strong style={{ fontSize: "16px", color: "var(--text)" }}>
            {isAnnualRestricted ? "Đang ẩn" : <MoneyAmount value={annualValue} />}
          </strong>
        </div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--panel)"
        }}>
          <div>
            <strong style={{ display: "block", fontSize: "13px", color: "var(--text)" }}>Cơ hội đang mở</strong>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Giá trị cơ hội đang theo dõi</span>
          </div>
          <strong style={{ fontSize: "16px", color: "var(--text)" }}>
            {isPipelineRestricted ? "Đang ẩn" : <MoneyAmount value={visiblePipeline} />}
          </strong>
        </div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          borderRadius: "8px",
          border: "1px solid var(--success-soft-strong)",
          background: "var(--success-soft)"
        }}>
          <div>
            <strong style={{ display: "block", fontSize: "13px", color: "var(--success)" }}>Dự báo có trọng số</strong>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Điều chỉnh theo khả năng thắng</span>
          </div>
          <strong style={{ fontSize: "16px", color: "var(--success)" }}>
            {isWeightedRestricted ? "Đang ẩn" : <MoneyAmount value={weighted} />}
          </strong>
        </div>
      </div>
    </ShopifySection>
  );
}

export function AccountTable({ accounts }: { accounts: AccountsResponse }) {
  return (
    <ShopifySection heading="Danh sách khách hàng">
      {accounts.data.length ? (
        <ShopifyDataTable
          ariaLabel="Danh sách khách hàng"
          columns={[
            { key: "account", header: "Khách hàng", width: "30%" },
            { key: "stage", header: "Giai đoạn", width: "18%" },
            { key: "owner", header: "Đội phụ trách", width: "18%" },
            { key: "health", header: "Sức khỏe", width: "16%" },
            { key: "value", header: "Giá trị năm", width: "18%" }
          ]}
          rows={accounts.data.map((account) => ({
            key: account.id,
            cells: [
              (
                <div className="shopify-data-table-title">
                  <span>{account.name}</span>
                  <span>{account.ownerTeam}</span>
                </div>
              ),
              account.stage,
              account.ownerTeam,
              (
                <s-badge tone={account.health === "green" ? "success" : account.health === "amber" ? "warning" : "critical"}>
                  {account.health}
                </s-badge>
              ),
              account.annualValue ? <MoneyAmount value={account.annualValue} /> : "Đang ẩn"
            ]
          }))}
        />
      ) : (
        <PolarisFallbackText>Chưa có khách hàng nào trong phạm vi đang xem.</PolarisFallbackText>
      )}
    </ShopifySection>
  );
}

export function PolicyPanel({ accounts }: { accounts: AccountsResponse }) {
  return (
    <ShopifySection heading="Phạm vi dữ liệu">
      <div className="shopify-resource-list">
        <article>
          <div>
            <strong>{formatViewerLabel(accounts.meta.principal)}</strong>
            <span>Người đang xem</span>
          </div>
          <s-badge tone="info">Đang áp dụng</s-badge>
        </article>
        <article>
          <div>
            <strong>{formatDataScope(accounts.meta.rowScope)}</strong>
            <span>Phạm vi khách hàng</span>
          </div>
          <s-badge tone={accounts.meta.rowScope === "static_fallback" ? "warning" : "success"}>
            {accounts.meta.rowScope === "static_fallback" ? "Dự phòng" : "Đã kiểm soát"}
          </s-badge>
        </article>
        <article>
          <div>
            <strong>{accounts.meta.hiddenFields.length ? `${accounts.meta.hiddenFields.length} mục` : "Không có"}</strong>
            <span>Dữ liệu đang ẩn</span>
          </div>
        </article>
      </div>
    </ShopifySection>
  );
}

export function DashboardPanel({
  dashboard,
  title
}: {
  dashboard: DashboardSummaryResponse | null;
  title: string;
}) {
  return (
    <ShopifySection heading={title}>
      {dashboard ? (
        <div className="shopify-status-grid compact">
          <ShopifyStatusItem label="Accounts" value={dashboard.data.accounts.toString()} />
          <ShopifyStatusItem label="Opportunities" value={dashboard.data.opportunities.toString()} />
          <ShopifyStatusItem label="Projects" value={dashboard.data.projects.toString()} />
          <ShopifyStatusItem label="Tickets" value={dashboard.data.tickets.toString()} />
        </div>
      ) : (
        <PolarisFallbackText>Chưa có số liệu tổng hợp trong phạm vi đang xem.</PolarisFallbackText>
      )}
    </ShopifySection>
  );
}

export function SourceOfTruthPanel() {
  return (
    <ShopifySection heading="Nguồn dữ liệu vận hành">
      <div 
        style={{ 
          background: "rgba(255, 255, 255, 0.6)", 
          backdropFilter: "blur(4px)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "14px",
          marginTop: "8px",
          display: "flex",
          gap: "12px",
          alignItems: "flex-start",
          transition: "all 0.2s ease"
        }}
        className="premium-widget-hover"
      >
        <div style={{
          background: "rgba(92, 106, 196, 0.1)",
          borderRadius: "8px",
          padding: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#5c6ac4"
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5V19A9 3 0 0 0 21 19V5"></path>
            <path d="M3 12A9 3 0 0 0 21 12"></path>
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <strong style={{ fontSize: "12px", color: "var(--text)" }}>Kết nối dữ liệu</strong>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
            Dữ liệu vận hành được đọc từ nguồn chính. Khi chưa lấy được dữ liệu mới, màn hình sẽ báo rõ và chỉ hiển thị bản mẫu an toàn.
          </span>
        </div>
      </div>
    </ShopifySection>
  );
}

export function IntegrationPanel() {
  return (
    <ShopifySection heading="Trạng thái tích hợp Lark">
      <div className="shopify-resource-list" style={{ display: "grid", gap: "12px", marginTop: "8px" }}>
        <article 
          style={{ 
            background: "rgba(255, 255, 255, 0.6)", 
            backdropFilter: "blur(4px)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            transition: "all 0.2s ease",
            margin: 0
          }}
          className="premium-widget-hover"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ 
                display: "inline-block", 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                background: "#008060", 
                boxShadow: "0 0 6px #008060",
                animation: "pulse-active 2s infinite ease-in-out"
              }}></span>
              <strong style={{ fontSize: "12px", color: "var(--text)" }}>Nhận sự kiện Lark</strong>
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>Hệ thống đã chuẩn bị lớp nhận sự kiện để đồng bộ các thay đổi quan trọng.</span>
          </div>
          <s-badge tone="success">Sẵn sàng</s-badge>
        </article>
        
        <article 
          style={{ 
            background: "rgba(255, 255, 255, 0.6)", 
            backdropFilter: "blur(4px)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            transition: "all 0.2s ease",
            margin: 0
          }}
          className="premium-widget-hover"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ 
                display: "inline-block", 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                background: "#008060", 
                boxShadow: "0 0 6px #008060",
                animation: "pulse-active 2s infinite ease-in-out"
              }}></span>
              <strong style={{ fontSize: "12px", color: "var(--text)" }}>Phân quyền dữ liệu</strong>
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>Người dùng chỉ nhìn thấy dữ liệu phù hợp với vai trò và phạm vi khách hàng của mình.</span>
          </div>
          <s-badge tone="success">Đang bật</s-badge>
        </article>
      </div>
    </ShopifySection>
  );
}

export function formatCompactVnd(value: number) {
  return sharedFormatCompactVnd(value);
}

function formatViewerLabel(value: string) {
  const labels: Record<string, string> = {
    founder: "Founder / GM",
    "finance-admin": "Tài chính",
    sales: "Sales Owner",
    customer: "Khách hàng"
  };
  return labels[value] ?? "Người dùng hiện tại";
}

function formatDataScope(value: string) {
  const labels: Record<string, string> = {
    "finance_role_after_project_row_scope": "Theo quyền tài chính",
    "founder_global": "Toàn hệ thống",
    "global": "Toàn hệ thống",
    "own_accounts": "Khách hàng được phân công",
    "project_member": "Dự án được phân công",
    "static_fallback": "Dữ liệu dự phòng"
  };
  return labels[value] ?? "Theo quyền truy cập";
}
