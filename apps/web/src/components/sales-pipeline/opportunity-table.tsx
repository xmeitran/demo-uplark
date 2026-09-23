"use client";
import { MoneyAmount } from "@/components/money-amount";

import type { OpportunitySummary } from "@b2b-crm/contracts";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ShopifyDataTable, ShopifyIcon, type ShopifyIconName } from "../shopify-ui";
import type { OpportunityWorkbench } from "./use-opportunity-workbench";
import { formatForecastCategory, formatStageLabel, formatStaleReason, stageTone } from "./utils";

const pageSize = 10;

export function OpportunityTable({
  workbench,
  stageFilter,
  recordsOverride
}: {
  workbench: OpportunityWorkbench;
  stageFilter?: string | null;
  recordsOverride?: OpportunitySummary[];
}) {
  const { opportunities } = workbench.state;
  const { openActivities, openDetail, openFinance } = workbench.actions;
  const [page, setPage] = useState(1);
  const [isCompactOpportunityList, setIsCompactOpportunityList] = useState(false);

  // Filter opportunities by stage if filter is provided
  const filteredOpportunities = useMemo(() => {
    const source = recordsOverride ?? opportunities;
    if (!stageFilter) return source;
    return source.filter(
      (record) => record.stage.toLowerCase() === stageFilter.toLowerCase()
    );
  }, [opportunities, recordsOverride, stageFilter]);

  // Reset page to 1 when stage filter changes
  useEffect(() => {
    setPage(1);
  }, [recordsOverride, stageFilter]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsCompactOpportunityList(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const pageCount = Math.max(1, Math.ceil(filteredOpportunities.length / pageSize));
  const rows = useMemo(
    () => filteredOpportunities.slice((page - 1) * pageSize, page * pageSize),
    [filteredOpportunities, page]
  );

  return (
    <div className="shopify-table-wrap">
      {rows.length ? (
        <>
          {!isCompactOpportunityList ? <div className="shopify-desktop-table sales-opportunity-table-shell">
            <ShopifyDataTable
              ariaLabel="Danh sách cơ hội bán hàng"
              columns={[
                { key: "opportunity", header: "Cơ hội", width: "30%" },
                { key: "stage", header: "Giai đoạn", width: "11%" },
                { key: "health", header: "Sức khỏe", width: "12%" },
                { key: "forecast", header: "Dự báo", width: "16%" },
                { key: "value", header: "Giá trị", width: "16%" },
                { key: "actions", header: "Thao tác", width: "15%" }
              ]}
              minWidth={1120}
              rows={rows.map((record) => ({
                key: record.id,
                cells: renderOpportunityCells({
                  onActivities: () => openActivities(record),
                  onDetail: () => openDetail(record),
                  onFinance: () => openFinance(record),
                  record
                })
              }))}
            />
          </div> : null}

          {isCompactOpportunityList ? <div className="shopify-mobile-opportunity-list">
            {rows.map((record) => (
              <OpportunityCard key={record.id} onActivities={() => openActivities(record)} onDetail={() => openDetail(record)} onFinance={() => openFinance(record)} record={record} />
            ))}
            <div className="shopify-card-pagination" style={{ marginTop: "12px", gap: "10px" }}>
              <s-button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Trước
              </s-button>
              <s-button disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                Sau
              </s-button>
            </div>
          </div> : null}
        </>
      ) : (
        <div className="shopify-empty-state">
          <strong>Chưa có cơ hội</strong>
          <span>Tạo cơ hội từ lead đủ điều kiện hoặc khách hàng đang chăm sóc.</span>
        </div>
      )}
      <div className="shopify-pagination-note" style={{ marginTop: "12px", color: "var(--text-subtle)", fontSize: "13px" }}>
        Trang {page}/{pageCount} · {filteredOpportunities.length} cơ hội
      </div>
    </div>
  );
}

function OpportunityCard({
  onActivities,
  onDetail,
  onFinance,
  record
}: {
  onActivities: () => void;
  onDetail: () => void;
  onFinance: () => void;
  record: OpportunitySummary;
}) {
  return (
    <article className="shopify-opportunity-card premium-card" style={{ padding: "16px", marginBottom: "12px" }}>
      <button aria-label={`Mở chi tiết ${record.title} của ${record.accountName}`} className="shopify-link-button" onClick={onDetail} type="button">
        <strong style={{ fontSize: "14px", color: "var(--text)" }}>{record.title}</strong>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{record.accountName}</span>
      </button>
      
      {record.stale && record.staleReason && (
        <div style={{
          fontSize: "11px",
          color: "var(--danger)",
          marginTop: "8px",
          fontWeight: "650",
          background: "rgba(216, 44, 13, 0.05)",
          padding: "6px 10px",
          borderRadius: "6px",
          borderLeft: "3px solid var(--danger)",
          width: "100%"
        }}>
          Cần xử lý: {formatStaleReason(record.staleReason)}
        </div>
      )}

      <div className="shopify-mobile-card-grid" style={{ marginTop: "12px", borderTop: "1px solid #ebebeb", paddingTop: "12px" }}>
        <span>Giai đoạn</span>
        <s-badge tone={stageTone(record.stage)}>{formatStageLabel(record.stage)}</s-badge>
        <span>Sức khỏe</span>
        <span style={{ fontWeight: "600", color: record.stale ? "var(--warning)" : "var(--success)" }}>
          {record.stale ? "Cần chăm sóc" : "Ổn"} · {record.probability}%
        </span>
        <span>Việc tiếp theo</span>
        <span style={{ fontSize: "12px" }}>
          {record.nextActivityAt ? new Date(record.nextActivityAt).toLocaleDateString("vi-VN") : "Chưa có"}
        </span>
        <span>Dự báo</span>
        <span style={{ fontWeight: "750", color: "var(--text)" }}>
          {record.weightedForecast === undefined ? "Ẩn theo quyền" : <MoneyAmount value={record.weightedForecast} />}
        </span>
      </div>
      <OpportunityRowActions onActivities={onActivities} onDetail={onDetail} onFinance={onFinance} record={record} />
    </article>
  );
}

function renderOpportunityCells({
  onActivities,
  onDetail,
  onFinance,
  record
}: {
  onActivities: () => void;
  onDetail: () => void;
  onFinance: () => void;
  record: OpportunitySummary;
}) {
  return [
    (
      <div className="sales-opportunity-title-cell">
        <button aria-label={`Mở chi tiết ${record.title} của ${record.accountName}`} className="shopify-link-button" onClick={onDetail} type="button">
          <span className="sales-opportunity-title-icon">
            <ShopifyIcon name="briefcase" size={14} />
          </span>
          <div>
            <strong>{record.title}</strong>
            <span>{record.accountName}</span>
          </div>
        </button>
        {record.stale && record.staleReason && (
          <div className="sales-opportunity-stale">
            Cần xử lý: {formatStaleReason(record.staleReason)}
          </div>
        )}
      </div>
    ),
    (
      <span className="sales-opportunity-stage">
        <s-badge tone={stageTone(record.stage)}>{formatStageLabel(record.stage)}</s-badge>
      </span>
    ),
    (
      <div className={record.stale ? "sales-opportunity-health is-stale" : "sales-opportunity-health"}>
        <span>
          <s-badge tone={record.stale ? "warning" : "success"}>{record.stale ? "Cần chăm sóc" : "Ổn"}</s-badge>
          <b>{record.probability}%</b>
        </span>
        <i style={{ "--probability": `${record.probability}%` } as CSSProperties} />
      </div>
    ),
    (
      <div className="sales-opportunity-forecast">
        <strong>{formatForecastCategory(record.forecastCategory)}</strong>
        <span>
          {record.nextActivityAt ? new Date(record.nextActivityAt).toLocaleDateString("vi-VN") : "Chưa có việc tiếp theo"}
        </span>
      </div>
    ),
    record.amount === undefined ? (
      <span className="sales-opportunity-muted">Ẩn theo quyền</span>
    ) : (
      <div className="sales-opportunity-value">
        <strong><MoneyAmount value={record.amount} /></strong>
        <span>
          {record.weightedForecast === undefined ? "Dự báo ẩn" : <>Có trọng số: <MoneyAmount value={record.weightedForecast} /></>}
        </span>
      </div>
    ),
    <OpportunityRowActions onActivities={onActivities} onDetail={onDetail} onFinance={onFinance} record={record} />
  ];
}

function OpportunityRowActions({
  onActivities,
  onDetail,
  onFinance,
  record
}: {
  onActivities: () => void;
  onDetail: () => void;
  onFinance: () => void;
  record: OpportunitySummary;
}) {
  return (
    <div aria-label={`Thao tác cho ${record.title}`} className="pipeline-row-actions">
      <OpportunityRowAction icon="search" label="Chi tiết" onClick={onDetail} primary recordTitle={record.title} />
      <OpportunityRowAction icon="clock" label="Hoạt động" onClick={onActivities} recordTitle={record.title} secondary />
      <OpportunityRowAction icon="cash" label="Tài chính" onClick={onFinance} recordTitle={record.title} secondary />
    </div>
  );
}

function OpportunityRowAction({
  icon,
  label,
  onClick,
  primary = false,
  secondary = false,
  recordTitle
}: {
  icon: ShopifyIconName;
  label: string;
  onClick: () => void;
  primary?: boolean;
  secondary?: boolean;
  recordTitle: string;
}) {
  return (
    <button
      aria-label={`${label} ${recordTitle}`}
      className={["pipeline-row-action", primary ? "primary" : "", secondary ? "secondary" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      type="button"
    >
      <ShopifyIcon name={icon} size={14} />
      <span>{secondary ? "" : label}</span>
    </button>
  );
}
