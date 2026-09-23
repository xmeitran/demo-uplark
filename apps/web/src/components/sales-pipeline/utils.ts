import { formatVnd as sharedFormatVnd, formatCompactVnd as sharedFormatCompactVnd } from "@/lib/currency";
import { DEPLOYMENT_KICKOFF_STATUSES, SALES_DELAY_REASONS, SALES_LOST_REASONS, SALES_WON_REASONS } from "@b2b-crm/contracts";
import type { OpportunitySummary } from "@b2b-crm/contracts";
import type { DraftOpportunity } from "./types";

export function toDraft(opportunity?: OpportunitySummary): DraftOpportunity {
  const terminalProbability = opportunity?.stage === "won" ? "100" : opportunity?.stage === "lost" ? "0" : undefined;

  return {
    title: opportunity?.title ?? "",
    leadId: opportunity?.leadId ?? "",
    ownerUserId: opportunity?.ownerUserId ?? "",
    stageEnteredAt: toDateInputValue(opportunity?.stageEnteredAt),
    stage: opportunity?.stage ?? "proposal",
    amount: opportunity?.amount === undefined ? "" : formatVndInput(opportunity.amount.toString()),
    probability: terminalProbability ?? opportunity?.probability?.toString() ?? "0",
    nextActivitySubject: "",
    nextActivityAt: toDateInputValue(opportunity?.nextActivityAt)
  };
}

export function toDateInputValue(value?: string) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

export function getPipelineStats(opportunities: OpportunitySummary[]) {
  const open = opportunities.filter((item) => item.stage !== "won" && item.stage !== "lost");
  const staleCount = opportunities.filter((item) => item.stale).length;
  const nextActionCount = opportunities.filter((item) => item.nextActivityAt).length;
  const weighted = opportunities.reduce((sum, item) => sum + (item.weightedForecast ?? 0), 0);
  const avgProbability = opportunities.length
    ? Math.round(opportunities.reduce((sum, item) => sum + item.probability, 0) / opportunities.length)
    : 0;
  const healthScore = Math.max(0, Math.min(100, Math.round(avgProbability - staleCount * 8 + nextActionCount * 3)));

  return {
    avgProbability,
    healthScore,
    nextActionCount,
    openCount: open.length,
    staleCount,
    totalCount: opportunities.length,
    weighted
  };
}

export function stageTone(stage: string) {
  if (stage === "won") {
    return "success";
  }
  if (stage === "lost") {
    return "critical";
  }
  if (stage === "proposal" || stage === "negotiation") {
    return "warning";
  }
  return "info";
}

export function formatStageLabel(stage: string) {
  const labels: Record<string, string> = {
    lead: "Lead mới",
    qualified: "Đã đủ điều kiện",
    discovery: "Khám phá nhu cầu",
    solution: "Thiết kế giải pháp",
    demo: "Demo",
    proposal: "Báo giá/SOW",
    negotiation: "Đàm phán",
    contracting: "Hợp đồng",
    won: "Thắng",
    lost: "Thua"
  };

  return labels[stage.toLowerCase()] ?? formatForecastCategory(stage);
}

export function formatForecastCategory(category: string) {
  const labels: Record<string, string> = {
    best_case: "Kịch bản tốt",
    commit: "Cam kết",
    closed_won: "Đã thắng",
    omitted: "Loại khỏi dự báo",
    pipeline: "Đang theo dõi"
  };

  if (labels[category]) return labels[category];

  return category
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatTaxonomyLabel(code: string) {
  const legacyLabels: Record<string, string> = {
    close_won_bd_confirmed: "BD xác nhận thắng deal",
    closed_won_bd_confirmed: "BD xác nhận thắng deal",
    close_won_handoff_validated: "Đã đủ điều kiện bàn giao",
    closed_won_handoff_ready: "Đã sẵn sàng bàn giao",
    closed_won_handoff_validated: "Đã đủ điều kiện bàn giao"
  };
  if (legacyLabels[code]) return legacyLabels[code];

  const option = [...SALES_WON_REASONS, ...SALES_LOST_REASONS, ...SALES_DELAY_REASONS, ...DEPLOYMENT_KICKOFF_STATUSES].find((item) => item.code === code);
  return option?.label ?? formatForecastCategory(code);
}

export function formatStaleReason(reason?: string) {
  if (reason === "missing_future_activity") {
    return "Chưa có hoạt động tiếp theo";
  }
  if (reason === "stage_age_over_threshold") {
    return "Đứng ở giai đoạn quá lâu";
  }

  return "Cần Sales rà soát";
}

export function formatVnd(value: number) {
  return sharedFormatVnd(value);
}

export function normalizeVndDigits(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function formatVndInput(value: string) {
  const digits = normalizeVndDigits(value);
  if (!digits) {
    return "";
  }

  return new Intl.NumberFormat("vi-VN").format(Number(digits));
}

export function parseVndInput(value: string) {
  const digits = normalizeVndDigits(value);
  return digits ? Number(digits) : undefined;
}

export function formatCompactVnd(value: number) {
  return sharedFormatCompactVnd(value);
}

export function formatNumber(value: number) {
  const hasDecimal = value % 1 !== 0;
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: hasDecimal ? 1 : 0,
    maximumFractionDigits: 2
  }).format(value);
}
