"use client";
import { MoneyAmount } from "@/components/money-amount";



import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  ArAgingSummaryItem,
  ArAgingSummaryResponse,
  InvoicePaymentStatus,
  InvoiceSummary,
  PaymentEvidenceSummary,
  PaymentMilestoneSummary,
  PaymentScheduleDetail,
  PaymentScheduleStatus,
  PaymentScheduleSummary,
  ResourceListResponse
} from "@b2b-crm/contracts";
import {
  ShopifyAppShell,
  ShopifyBanner,
  ShopifyDataTable,
  ShopifyIcon,
  ShopifyPage,
  type BadgeTone
} from "../shopify-ui";
import { loadRouteDataJson } from "../../lib/route-data-cache";

const principal = "founder";

type FinanceLoadState = "error" | "loading" | "ready";

type FinanceOverviewPayload = {
  arAging: ArAgingSummaryResponse;
  details: PaymentScheduleDetail[];
  schedules: ResourceListResponse<PaymentScheduleSummary>;
};

export function FinanceFunctionPage() {
  const [state, setState] = useState<FinanceLoadState>("loading");
  const [error, setError] = useState("");
  const [schedules, setSchedules] = useState<PaymentScheduleSummary[]>([]);
  const [details, setDetails] = useState<PaymentScheduleDetail[]>([]);
  const [arItems, setArItems] = useState<ArAgingSummaryItem[]>([]);
  const [meta, setMeta] = useState("Đang tải nguồn dữ liệu tài chính...");

  useEffect(() => {
    let cancelled = false;

    async function loadFinance() {
      setState("loading");
      setError("");
      try {
        const overview = await loadRouteDataJson<FinanceOverviewPayload>(
          `/api/finance/overview?principal=${encodeURIComponent(principal)}`
        );

        if (cancelled) return;
        setSchedules(overview.schedules.data);
        setDetails(overview.details);
        setArItems(overview.arAging.data);
        setMeta("Dữ liệu tài chính đã được đồng bộ");
        setState("ready");
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Không tải được dữ liệu tài chính.");
        setState("error");
      }
    }

    loadFinance();
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(() => buildFinanceMetrics(schedules, details, arItems), [schedules, details, arItems]);

  return (
    <ShopifyAppShell active="finance" principal={principal}>
      <ShopifyPage heading="Tài chính & Công nợ">
        <FinanceHero
          actionReason="Tạo hóa đơn, ghi nhận thanh toán và xử lý công nợ sẽ bật sau khi form xác nhận và quyền thao tác hoàn tất."
          meta={state === "ready" ? meta : "Đang chuẩn bị dữ liệu tài chính"}
        />

        {state === "error" ? (
          <div className="finance-banner-slot">
            <ShopifyBanner heading="Chưa đọc được dữ liệu Finance" tone="warning">
              <s-paragraph>{error}</s-paragraph>
            </ShopifyBanner>
          </div>
        ) : null}

        <section className="finance-metric-grid" aria-label="Tổng quan tài chính">
          <FinanceMetric label="Tổng lịch thu" value=<MoneyAmount value={(metrics.totalAmount) ?? 0} /> detail={`${schedules.length} lịch thanh toán`} tone="neutral" />
          <FinanceMetric label="Đã thu" value=<MoneyAmount value={(metrics.paidAmount) ?? 0} /> detail={`${metrics.paidPercent}% tổng giá trị`} tone="success" />
          <FinanceMetric label="Còn phải thu" value=<MoneyAmount value={(metrics.outstandingAmount) ?? 0} /> detail={`${metrics.openInvoiceCount} hóa đơn/mốc mở`} tone="info" />
          <FinanceMetric label="Cần theo dõi" value=<MoneyAmount value={(metrics.arOutstandingAmount) ?? 0} /> detail={`${arItems.length} khoản công nợ đang mở`} tone={arItems.length ? "warning" : "success"} />
        </section>

        <div className="finance-main-grid">
          <section className="finance-panel primary">
            <div className="finance-panel-head">
              <div>
                <span className="finance-eyebrow">Cash queue</span>
                <h2>Lịch thanh toán</h2>
              </div>
              <s-badge tone={state === "ready" ? "success" : state === "loading" ? "info" : "warning"}>
                {state === "ready" ? "Dữ liệu thật" : state === "loading" ? "Đang tải" : "Cần kiểm tra"}
              </s-badge>
            </div>

            <PaymentScheduleTable schedules={schedules} details={details} loading={state === "loading"} />
          </section>

          <aside className="finance-panel">
            <div className="finance-panel-head">
              <div>
                <span className="finance-eyebrow">Exception</span>
                <h2>Công nợ cần theo dõi</h2>
              </div>
              <s-badge tone={arItems.length ? "warning" : "success"}>{arItems.length ? `${arItems.length} việc` : "Sạch"}</s-badge>
            </div>

            <ArQueue arItems={arItems} details={details} loading={state === "loading"} />
          </aside>
        </div>
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

export function FinanceScheduleDetailPage({ paymentScheduleId }: { paymentScheduleId: string }) {
  const [state, setState] = useState<FinanceLoadState>("loading");
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<PaymentScheduleDetail | null>(null);
  const [arItems, setArItems] = useState<ArAgingSummaryItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      setState("loading");
      setError("");
      try {
        const [scheduleResponse, arResponse] = await Promise.all([
          fetch(`/api/payments/schedules/${encodeURIComponent(paymentScheduleId)}?principal=${encodeURIComponent(principal)}`, { cache: "no-store" }),
          fetch(`/api/payments/ar-aging?principal=${encodeURIComponent(principal)}`, { cache: "no-store" })
        ]);

        if (!scheduleResponse.ok) throw new Error(`Chưa tải được chi tiết lịch thanh toán (${scheduleResponse.status})`);
        if (!arResponse.ok) throw new Error(`Chưa tải được danh sách công nợ (${arResponse.status})`);

        const nextSchedule = (await scheduleResponse.json()) as PaymentScheduleDetail;
        const arPayload = (await arResponse.json()) as ArAgingSummaryResponse;
        if (cancelled) return;
        setSchedule(nextSchedule);
        setArItems(arPayload.data.filter((item) => nextSchedule.milestones.some((milestone) => milestone.id === item.milestoneId)));
        setState("ready");
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Không tải được chi tiết finance.");
        setState("error");
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [paymentScheduleId]);

  const invoices = useMemo(() => schedule ? flattenInvoices(schedule) : [], [schedule]);
  const evidence = useMemo(() => schedule ? flattenEvidence(schedule) : [], [schedule]);
  const metrics = useMemo(() => schedule ? buildFinanceMetrics([schedule], [schedule], arItems) : null, [schedule, arItems]);

  return (
    <ShopifyAppShell active="finance" principal={principal}>
      <ShopifyPage heading="Chi tiết tài chính">
        <Link className="finance-back-link" href="/finance">
          <ShopifyIcon name="arrow-left" size={15} />
          Quay lại Tài chính
        </Link>

        {state === "error" ? (
          <ShopifyBanner heading="Không mở được chi tiết Finance" tone="warning">
            <s-paragraph>{error}</s-paragraph>
          </ShopifyBanner>
        ) : null}

        {!schedule ? (
          <section className="finance-panel">
            <span className="finance-eyebrow">Đang tải</span>
            <h2>Đang chuẩn bị chi tiết lịch thanh toán...</h2>
          </section>
        ) : (
          <>
            <section className="finance-detail-hero">
              <div>
                <span className="finance-eyebrow">Lịch thanh toán</span>
                <h2>{schedule.title}</h2>
                <p>{schedule.accountName} · {schedule.projectName ?? "Chưa gắn dự án"}</p>
              </div>
              <div className="finance-detail-actions">
                <s-button disabled>Ghi nhận thanh toán</s-button>
                <span>Khóa tạm thời: cần form xác nhận số tiền, chứng từ và quyền thao tác trước khi bật ghi nhận.</span>
              </div>
            </section>

            {metrics ? (
              <section className="finance-metric-grid detail" aria-label="Tổng quan lịch thanh toán">
                <FinanceMetric label="Tổng giá trị" value=<MoneyAmount value={(metrics.totalAmount) ?? 0} /> detail={schedule.accountName} tone="neutral" />
                <FinanceMetric label="Đã thu" value=<MoneyAmount value={(metrics.paidAmount) ?? 0} /> detail={`${metrics.paidPercent}% đã thu`} tone="success" />
                <FinanceMetric label="Còn phải thu" value=<MoneyAmount value={(metrics.outstandingAmount) ?? 0} /> detail={`${invoices.length} hóa đơn`} tone="info" />
                <FinanceMetric label="Công nợ đang mở" value={`${arItems.length}`} detail={arItems[0] ? `Trễ ${arItems[0].daysOverdue} ngày` : "Không có khoản quá hạn"} tone={arItems.length ? "warning" : "success"} />
              </section>
            ) : null}

            <div className="finance-detail-grid">
              <section className="finance-panel primary">
                <div className="finance-panel-head">
                  <div>
                    <span className="finance-eyebrow">Mốc thu tiền</span>
                    <h2>Tiến độ thu tiền</h2>
                  </div>
                  <s-badge tone={paymentScheduleTone(schedule.status)}>{formatPaymentScheduleStatus(schedule.status)}</s-badge>
                </div>
                <PaymentMilestoneTimeline milestones={schedule.milestones} />
              </section>

              <aside className="finance-panel">
                <div className="finance-panel-head">
                  <div>
                    <span className="finance-eyebrow">Liên kết</span>
                    <h2>Liên kết thương mại</h2>
                  </div>
                </div>
                <FinanceContextList schedule={schedule} />
              </aside>
            </div>

            <section className="finance-panel">
              <div className="finance-panel-head">
                <div>
                    <span className="finance-eyebrow">Sổ hóa đơn</span>
                    <h2>Hóa đơn & thanh toán</h2>
                </div>
              </div>
              <InvoiceTable invoices={invoices} />
            </section>

            <div className="finance-main-grid">
              <section className="finance-panel">
                <div className="finance-panel-head">
                  <div>
                    <span className="finance-eyebrow">Công nợ</span>
                    <h2>Nhắc công nợ</h2>
                  </div>
                </div>
                <ArQueue arItems={arItems} details={schedule ? [schedule] : []} loading={state === "loading"} compact />
              </section>

              <section className="finance-panel">
                <div className="finance-panel-head">
                  <div>
                    <span className="finance-eyebrow">Chứng từ</span>
                    <h2>Chứng từ</h2>
                  </div>
                </div>
                <EvidenceList evidence={evidence} />
              </section>
            </div>
          </>
        )}
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

function FinanceHero({ actionReason, meta }: { actionReason: string; meta: string }) {
  return (
    <section className="finance-hero">
      <div>
        <span className="finance-eyebrow">Thanh toán, hóa đơn & công nợ</span>
        <h2>Bảng thu tiền cho đội tài chính</h2>
        <p>Theo dõi lịch thu, hóa đơn, tiền đã thu, khoản còn phải thu và các ngoại lệ công nợ trong một màn hình gọn.</p>
        <div className="finance-source-row">
          <s-badge tone="success">Dữ liệu sẵn sàng</s-badge>
          <span>{meta}</span>
        </div>
      </div>
      <div className="finance-action-card">
        <s-button disabled>Thêm lịch thanh toán</s-button>
        <strong>Thao tác đang khóa</strong>
        <span>{actionReason}</span>
      </div>
    </section>
  );
}

function FinanceMetric({ detail, label, tone, value }: { detail: string; label: string; tone: BadgeTone; value: React.ReactNode }) {
  return (
    <article className={`finance-metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PaymentScheduleTable({
  details,
  loading,
  schedules
}: {
  details: PaymentScheduleDetail[];
  loading: boolean;
  schedules: PaymentScheduleSummary[];
}) {
  if (loading) {
    return <EmptyFinanceState title="Đang tải lịch thanh toán..." detail="Đang chuẩn bị lịch thu và danh sách công nợ." />;
  }

  if (!schedules.length) {
    return <EmptyFinanceState title="Chưa có lịch thanh toán" detail="Khi cơ hội có hợp đồng hoặc lịch thu, đội tài chính sẽ thấy hàng đợi tại đây." />;
  }

  return (
    <ShopifyDataTable
      ariaLabel="Lịch thanh toán tài chính"
      columns={[
        { key: "schedule", header: "Lịch thanh toán", mobilePriority: "title", width: "32%" },
        { key: "status", header: "Trạng thái", mobileLabel: "Trạng thái", width: "13%" },
        { key: "progress", header: "Tiến độ thu", mobileLabel: "Tiến độ", width: "18%" },
        { key: "amount", header: "Giá trị", mobileLabel: "Giá trị", width: "17%" },
        { key: "risk", header: "Rủi ro", mobileLabel: "Rủi ro", width: "12%" },
        { key: "action", header: "Thao tác", mobilePriority: "hidden", width: "8%" }
      ]}
      minWidth={980}
      rows={schedules.map((schedule) => {
        const detail = details.find((item) => item.id === schedule.id);
        const paidPercent = calculatePercent(schedule.paidAmount, schedule.totalAmount);
        const openMilestones = detail?.milestones.filter((milestone) => milestone.paymentStatus !== "paid").length ?? 0;
        const riskTone: BadgeTone = schedule.overdueAmount && schedule.overdueAmount > 0 ? "warning" : openMilestones > 0 ? "info" : "success";
        const action = <Link className="finance-link-button" href={`/finance/${schedule.id}`}>Mở chi tiết</Link>;

        return {
          key: schedule.id,
          cells: [
            (
              <div className="shopify-data-table-title">
                <span>{schedule.title}</span>
                  <span>{schedule.accountName}</span>
              </div>
            ),
            <s-badge tone={paymentScheduleTone(schedule.status)}>{formatPaymentScheduleStatus(schedule.status)}</s-badge>,
            <FinanceProgress paid={schedule.paidAmount ?? 0} total={schedule.totalAmount ?? 0} />,
            (
              <div className="finance-money-stack">
                <strong><MoneyAmount value={(schedule.totalAmount) ?? 0} /></strong>
                <span>Còn <MoneyAmount value={(schedule.outstandingAmount) ?? 0} /></span>
              </div>
            ),
            <s-badge tone={riskTone}>{schedule.overdueAmount && schedule.overdueAmount > 0 ? "Quá hạn" : openMilestones ? `${openMilestones} mốc mở` : "Đã sạch"}</s-badge>,
            action
          ],
          mobileActions: action,
          mobileMeta: <s-badge tone={paymentScheduleTone(schedule.status)}>{formatPaymentScheduleStatus(schedule.status)}</s-badge>,
          mobileSubtitle: <>{schedule.accountName} · còn <MoneyAmount value={schedule.outstandingAmount ?? 0} /></>,
          mobileTitle: schedule.title
        };
      })}
    />
  );
}

function PaymentMilestoneTimeline({ milestones }: { milestones: PaymentMilestoneSummary[] }) {
  if (!milestones.length) {
    return <EmptyFinanceState title="Chưa có mốc thu tiền" detail="Lịch thanh toán này chưa có mốc thu tiền." />;
  }

  return (
    <div className="finance-milestone-list">
      {milestones.map((milestone) => (
        <article className="finance-milestone-card" key={milestone.id}>
          <div className="finance-milestone-index">{milestone.sequence}</div>
          <div className="finance-milestone-body">
            <div className="finance-milestone-head">
              <div>
                <strong>{milestone.label}</strong>
                <span>{formatTriggerType(milestone.triggerType)} · hạn {formatDate(milestone.dueAt)}</span>
              </div>
              <div className="finance-status-group">
                <s-badge tone={milestoneTone(milestone.paymentStatus)}>{formatPaymentStatus(milestone.paymentStatus)}</s-badge>
                <s-badge tone={invoiceTone(milestone.invoiceStatus)}>{formatInvoiceStatus(milestone.invoiceStatus)}</s-badge>
              </div>
            </div>
            <FinanceProgress paid={sumInvoicePaid(milestone.invoices)} total={milestone.amount ?? 0} />
            <div className="finance-milestone-meta">
              <span><MoneyAmount value={(milestone.amount) ?? 0} /> · {milestone.percentage ?? 0}%</span>
              <span>Phụ trách: {formatFinanceText(milestone.financeOwnerDisplayName ?? "Chưa gán")}</span>
              <span>{milestone.customerVisible ? "Khách hàng được xem" : "Nội bộ"}</span>
            </div>
            {milestone.customerNote ? <p>{formatFinanceText(milestone.customerNote)}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function InvoiceTable({ invoices }: { invoices: InvoiceSummary[] }) {
  if (!invoices.length) {
    return <EmptyFinanceState title="Chưa có hóa đơn" detail="Hóa đơn sẽ xuất hiện sau khi mốc thu tiền được duyệt sẵn sàng xuất hóa đơn." />;
  }

  return (
    <ShopifyDataTable
      ariaLabel="Danh sách hóa đơn tài chính"
      columns={[
        { key: "invoice", header: "Hóa đơn", mobilePriority: "title", width: "30%" },
        { key: "status", header: "Trạng thái", mobileLabel: "Trạng thái", width: "16%" },
        { key: "amount", header: "Số tiền", mobileLabel: "Số tiền", width: "20%" },
        { key: "due", header: "Hạn thanh toán", mobileLabel: "Hạn", width: "17%" },
        { key: "visibility", header: "Hiển thị", mobileLabel: "Hiển thị", width: "17%" }
      ]}
      minWidth={820}
      rows={invoices.map((invoice) => ({
        key: invoice.id,
        cells: [
          (
            <div className="shopify-data-table-title">
              <span>{invoice.externalInvoiceNo ? "Hóa đơn đã phát hành" : "Hóa đơn đang chuẩn bị"}</span>
              <span>{invoice.externalInvoiceNo ? "Đã có số hóa đơn ngoài" : "Chưa có số hóa đơn ngoài"}</span>
            </div>
          ),
          (
            <div className="finance-status-group">
              <s-badge tone={invoiceTone(invoice.status)}>{formatInvoiceStatus(invoice.status)}</s-badge>
              <s-badge tone={milestoneTone(invoice.paymentStatus)}>{formatPaymentStatus(invoice.paymentStatus)}</s-badge>
            </div>
          ),
          (
            <div className="finance-money-stack">
              <strong><MoneyAmount value={(invoice.amount) ?? 0} /></strong>
              <span>Đã thu <MoneyAmount value={(invoice.paidAmount) ?? 0} /></span>
            </div>
          ),
          formatDate(invoice.dueAt),
          invoice.customerVisible ? "Khách hàng được xem" : "Nội bộ"
        ],
        mobileMeta: <s-badge tone={milestoneTone(invoice.paymentStatus)}>{formatPaymentStatus(invoice.paymentStatus)}</s-badge>,
        mobileSubtitle: <>Hạn {formatDate(invoice.dueAt)} · đã thu <MoneyAmount value={invoice.paidAmount ?? 0} /></>,
        mobileTitle: invoice.externalInvoiceNo ? "Hóa đơn đã phát hành" : "Hóa đơn đang chuẩn bị"
      }))}
    />
  );
}

function ArQueue({
  arItems,
  compact = false,
  details,
  loading
}: {
  arItems: ArAgingSummaryItem[];
  compact?: boolean;
  details: PaymentScheduleDetail[];
  loading: boolean;
}) {
  if (loading) {
    return <EmptyFinanceState title="Đang tải công nợ..." detail="Đang kiểm tra hóa đơn quá hạn và hành động tiếp theo." />;
  }

  if (!arItems.length) {
    return <EmptyFinanceState title="Không có công nợ quá hạn" detail="Các hóa đơn trong phạm vi hiện tại chưa cần nhắc tiếp." />;
  }

  return (
    <div className={compact ? "finance-ar-list compact" : "finance-ar-list"}>
      {arItems.map((item) => {
        const scheduleId = details.find((detail) => detail.milestones.some((milestone) => milestone.id === item.milestoneId))?.id;
        return (
          <article className="finance-ar-card" key={`${item.milestoneId}-${item.invoiceId ?? item.code}`}>
            <div>
              <span className="finance-eyebrow">Quá hạn {item.daysOverdue} ngày</span>
              <strong>{item.label}</strong>
              <p>{item.accountName} · {item.label}</p>
            </div>
            <div className="finance-ar-meta">
              <strong><MoneyAmount value={(item.outstandingAmount) ?? 0} /></strong>
              <span>Hành động tiếp theo: {formatDate(item.nextActionAt)}</span>
              <s-badge tone={milestoneTone(item.paymentStatus)}>{formatPaymentStatus(item.paymentStatus)}</s-badge>
            </div>
            {scheduleId ? <Link className="finance-link-button subtle" href={`/finance/${scheduleId}`}>Xem lịch thu</Link> : null}
          </article>
        );
      })}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: PaymentEvidenceSummary[] }) {
  if (!evidence.length) {
    return <EmptyFinanceState title="Chưa có chứng từ" detail="Tệp hóa đơn, biên nhận thanh toán hoặc bằng chứng nghiệm thu sẽ hiển thị tại đây." />;
  }

  return (
    <div className="finance-evidence-list">
      {evidence.map((item) => (
        <article className="finance-evidence-card" key={item.id}>
          <div>
            <strong>{formatEvidenceTitle(item.title)}</strong>
            <span>{formatEvidenceType(item.evidenceType)} · Kho chứng từ</span>
          </div>
          <s-badge tone={item.customerVisible ? "success" : "neutral"}>{item.customerVisible ? "Khách hàng được xem" : "Nội bộ"}</s-badge>
        </article>
      ))}
    </div>
  );
}

function FinanceContextList({ schedule }: { schedule: PaymentScheduleDetail }) {
  const items = [
    ["Khách hàng", schedule.accountName],
    ["Hợp đồng", schedule.contractCode ? "Đã gắn hợp đồng" : "Chưa gắn"],
    ["Cơ hội", schedule.opportunityTitle ?? "Chưa gắn"],
    ["Dự án", schedule.projectName ?? "Chưa gắn"],
    ["Gói đề xuất", schedule.proposalPackageTitle ?? "Chưa gắn"],
    ["Hiển thị với khách hàng", schedule.customerVisible ? "Khách hàng được xem" : "Nội bộ"],
    ["Nhóm được xem", formatAllowedRoles(schedule.allowedRoles)]
  ];

  return (
    <dl className="finance-context-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FinanceProgress({ paid, total }: { paid: number; total: number }) {
  const percent = calculatePercent(paid, total);
  return (
    <div className="finance-progress" aria-label={`Đã thu ${percent}%`}>
      <div>
        <span>Đã thu</span>
        <strong>{percent}%</strong>
      </div>
      <div className="finance-progress-track">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function EmptyFinanceState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="finance-empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function buildFinanceMetrics(
  schedules: PaymentScheduleSummary[],
  details: PaymentScheduleDetail[],
  arItems: ArAgingSummaryItem[]
) {
  const totalAmount = schedules.reduce((sum, item) => sum + (item.totalAmount ?? 0), 0);
  const paidAmount = schedules.reduce((sum, item) => sum + (item.paidAmount ?? 0), 0);
  const outstandingAmount = schedules.reduce((sum, item) => sum + (item.outstandingAmount ?? 0), 0);
  const arOutstandingAmount = arItems.reduce((sum, item) => sum + (item.outstandingAmount ?? 0), 0);
  const openInvoiceCount = details
    .flatMap((detail) => detail.milestones)
    .filter((milestone) => milestone.paymentStatus !== "paid").length;

  return {
    arOutstandingAmount,
    openInvoiceCount,
    outstandingAmount,
    paidAmount,
    paidPercent: calculatePercent(paidAmount, totalAmount),
    totalAmount
  };
}

function flattenInvoices(schedule: PaymentScheduleDetail) {
  return schedule.milestones.flatMap((milestone) => milestone.invoices ?? []);
}

function flattenEvidence(schedule: PaymentScheduleDetail) {
  return schedule.milestones.flatMap((milestone) => milestone.evidence ?? []);
}

function sumInvoicePaid(invoices?: InvoiceSummary[]) {
  return (invoices ?? []).reduce((sum, invoice) => sum + (invoice.paidAmount ?? 0), 0);
}

function calculatePercent(value?: number, total?: number) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((value ?? 0) / total) * 100)));
}


function formatDate(value?: string) {
  if (!value) return "Chưa có";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function paymentScheduleTone(status: PaymentScheduleStatus): BadgeTone {
  if (status === "active") return "success";
  if (status === "cancelled") return "critical";
  if (status === "superseded") return "info";
  return "neutral";
}

function milestoneTone(status: InvoicePaymentStatus): BadgeTone {
  if (status === "paid") return "success";
  if (status === "overdue" || status === "disputed") return "warning";
  if (status === "partially_paid") return "info";
  if (status === "written_off") return "critical";
  return "neutral";
}

function invoiceTone(status: string): BadgeTone {
  if (status === "sent" || status === "issued") return "info";
  if (status === "voided" || status === "cancelled") return "critical";
  return "neutral";
}

function formatPaymentScheduleStatus(status: PaymentScheduleStatus) {
  const labels: Record<string, string> = {
    active: "Đang hiệu lực",
    cancelled: "Đã hủy",
    draft: "Nháp",
    superseded: "Đã thay thế"
  };
  return labels[status] ?? humanize(status);
}

function formatPaymentStatus(status: InvoicePaymentStatus) {
  const labels: Record<string, string> = {
    disputed: "Đang tranh chấp",
    overdue: "Quá hạn",
    paid: "Đã thu đủ",
    partially_paid: "Đã thu một phần",
    unpaid: "Chưa thu",
    written_off: "Xóa nợ"
  };
  return labels[status] ?? humanize(status);
}

function formatInvoiceStatus(status: string) {
  const labels: Record<string, string> = {
    cancelled: "Đã hủy",
    draft: "Nháp",
    issued: "Đã phát hành",
    sent: "Đã gửi",
    voided: "Vô hiệu"
  };
  return labels[status] ?? humanize(status);
}

function formatTriggerType(type: string) {
  const labels: Record<string, string> = {
    acceptance: "Nghiệm thu",
    calendar_date: "Ngày cố định",
    contract_signing: "Ký hợp đồng",
    custom: "Tùy chỉnh",
    delivery_stage: "Stage dự án",
    fixed_date: "Ngày cố định",
    go_live: "Go-live",
    kickoff: "Kickoff",
    manual: "Thủ công",
    monthly_retainer: "Retainer tháng",
    other: "Khác",
    project_stage: "Stage dự án",
    signed_contract: "Hợp đồng đã ký"
  };
  return labels[type] ?? humanize(type);
}

function formatEvidenceType(type: string) {
  const labels: Record<string, string> = {
    acceptance_evidence: "Bằng chứng nghiệm thu",
    bank_transfer: "Chuyển khoản",
    customer_confirmation: "Xác nhận khách hàng",
    exception_approval: "Duyệt ngoại lệ",
    invoice_file: "Tệp hóa đơn",
    other: "Khác",
    payment_receipt: "Biên nhận thanh toán"
  };
  return labels[type] ?? humanize(type);
}

function formatEvidenceTitle(title: string) {
  return formatFinanceText(title).replace(/\bPDF\b/g, "tài liệu");
}

function formatFinanceText(text: string) {
  return text
    .replace(/\binvoice\b/gi, "hóa đơn")
    .replace(/\bFinance Admin\b/g, "Tài chính");
}

function formatAllowedRoles(roles: string[]) {
  if (!roles.length) return "Theo phân quyền hiện tại";
  const labels: Record<string, string> = {
    CLIENT_FINANCE: "Tài chính khách hàng",
    CLIENT_PORTAL_ADMIN: "Quản trị khách hàng",
    CLIENT_SPONSOR: "Sponsor khách hàng",
    FINANCE_ADMIN: "Tài chính",
    FOUNDER_GM: "Founder/GM",
    SALES_OWNER: "Sales Owner"
  };
  return roles.map((role) => labels[role] ?? "Nhóm được cấp quyền").join(", ");
}

function humanize(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
