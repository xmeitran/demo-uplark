import type { OpportunitySummary } from "@b2b-crm/contracts";
import { toIso, toMoneyNumber } from "../../shared/http/request-context";

const STALE_AFTER_DAYS = 14;

export function mapOpportunitySummary(opportunity: any, now = new Date()): OpportunitySummary {
  const stageEnteredAt = toIso(opportunity.stageEnteredAt) ?? now.toISOString();
  const stageAgeDays = Math.max(0, Math.floor((now.getTime() - new Date(stageEnteredAt).getTime()) / 86_400_000));
  const amount = toMoneyNumber(opportunity.amount) ?? 0;
  const probability = Number(opportunity.probability ?? 0);
  const stale = !opportunity.closedAt && stageAgeDays >= STALE_AFTER_DAYS;

  return {
    id: opportunity.id,
    accountId: opportunity.accountId,
    leadId: opportunity.leadId ?? undefined,
    ownerUserId: opportunity.ownerUserId ?? undefined,
    ownerDisplayName: opportunity.owner?.displayName ?? undefined,
    accountName: opportunity.account?.name ?? "",
    title: opportunity.title,
    stage: opportunity.stage,
    amount,
    probability,
    forecastCategory: opportunity.forecastCategory ?? "pipeline",
    weightedForecast: amount * (probability / 100),
    stageEnteredAt,
    stageAgeDays,
    stale,
    staleReason: stale ? `Không cập nhật giai đoạn trong ${stageAgeDays} ngày` : undefined,
    nextActivityAt: toIso(opportunity.nextActivityAt),
    closedAt: toIso(opportunity.closedAt),
    closeReason: opportunity.closeReason ?? undefined,
    handoffConfirmedAt: toIso(opportunity.handoffConfirmedAt)
  };
}
