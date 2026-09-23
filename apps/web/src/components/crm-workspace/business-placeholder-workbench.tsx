"use client";

import { ShopifyAppShell, ShopifyDataTable, ShopifyIcon, ShopifyPage, ShopifySection } from "../shopify-ui";
import { businessFunctionConfigs, type BusinessFunctionKey } from "./business-function-config";

type PlaceholderBusinessFunctionKey = Exclude<BusinessFunctionKey, "delivery" | "proposals">;

export function BusinessPlaceholderWorkbench({ area }: Readonly<{ area: PlaceholderBusinessFunctionKey }>) {
  const config = businessFunctionConfigs[area];

  return (
    <ShopifyAppShell active={config.active} principal="founder">
      <ShopifyPage heading={config.title}>
        <div className="business-workbench">
          <section className="business-hero" aria-labelledby={`${area}-overview`}>
            <div className="business-hero-main">
              <span className="business-icon-badge">
                <ShopifyIcon name={config.icon} size={18} />
              </span>
              <div>
                <p className="business-kicker">{config.operatingFunction}</p>
                <h2 id={`${area}-overview`}>{config.featureCoverage}</h2>
                <p>{config.description}</p>
              </div>
            </div>
            <div className="business-action-panel">
              <s-button disabled>{config.action.label}</s-button>
              <span>{config.action.reason}</span>
            </div>
          </section>

          <div className="business-metric-grid">
            {config.metrics.map((metric) => (
              <article className="business-metric-card" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </div>

          <ShopifySection heading="Điểm kiểm tra sẵn sàng">
            <div className="business-readiness-grid">
              {config.readiness.map((item) => (
                <article className="business-readiness-card" key={item.label}>
                  <s-badge tone={item.tone}>{item.value}</s-badge>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                </article>
              ))}
            </div>
          </ShopifySection>

          <ShopifySection heading="Phạm vi quy trình">
            <ShopifyDataTable
              ariaLabel={`${config.title} workflow coverage`}
              columns={[
                { header: "Quy trình", key: "workflow", mobilePriority: "title", width: "22%" },
                { header: "Phụ trách", key: "owner", mobilePriority: "metadata", width: "18%" },
                { header: "Sẵn sàng", key: "readiness", mobilePriority: "metadata", width: "15%" },
                { header: "Bằng chứng", key: "evidence", mobilePriority: "detail", width: "25%" },
                { header: "Bước tiếp theo", key: "nextStep", mobilePriority: "detail", width: "20%" }
              ]}
              minWidth={980}
              rows={config.workflows.map((workflow) => ({
                cells: [
                  <div className="shopify-data-table-title" key={`${workflow.name}-title`}>
                    <span>{workflow.name}</span>
                    <span>{config.operatingFunction}</span>
                  </div>,
                  workflow.owner,
                  <s-badge key={`${workflow.name}-badge`} tone={workflow.tone}>{workflow.readiness}</s-badge>,
                  workflow.evidence,
                  workflow.nextStep
                ],
                key: workflow.name,
                mobileMeta: <s-badge tone={workflow.tone}>{workflow.readiness}</s-badge>,
                mobileSubtitle: workflow.owner,
                mobileTitle: workflow.name
              }))}
            />
          </ShopifySection>
        </div>
      </ShopifyPage>
    </ShopifyAppShell>
  );
}
