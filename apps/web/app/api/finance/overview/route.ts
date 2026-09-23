import type {
  ArAgingSummaryResponse,
  PaymentScheduleDetail,
  PaymentScheduleSummary,
  ResourceListResponse
} from "@b2b-crm/contracts";
import { buildCrmApiEndpoint, resolveProtectedCrmBffSession } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

type FinanceOverviewResponse = {
  arAging: ArAgingSummaryResponse;
  details: PaymentScheduleDetail[];
  schedules: ResourceListResponse<PaymentScheduleSummary>;
};

export async function GET(request: Request) {
  const incomingUrl = new URL(request.url);
  const principal = incomingUrl.searchParams.get("principal") ?? "founder";
  const session = await resolveProtectedCrmBffSession();
  if (!session.ok) {
    return session.response;
  }
  const { sessionToken } = session;

  const [scheduleResponse, arAgingResponse] = await Promise.all([
    fetchCrmApi<ResourceListResponse<PaymentScheduleSummary>>("/payments/schedules", { principal, sessionToken }),
    fetchCrmApi<ArAgingSummaryResponse>("/payments/ar-aging", { principal, sessionToken })
  ]);

  const schedules = scheduleResponse ?? emptyResourceList<PaymentScheduleSummary>(principal);
  const details = (
    await Promise.all(
      schedules.data.map((schedule) =>
        fetchCrmApi<PaymentScheduleDetail>(`/payments/schedules/${encodeURIComponent(schedule.id)}`, {
          principal,
          sessionToken
        })
      )
    )
  ).filter((schedule): schedule is PaymentScheduleDetail => Boolean(schedule));

  const payload: FinanceOverviewResponse = {
    arAging: arAgingResponse ?? emptyArAging(principal),
    details,
    schedules
  };

  return Response.json(payload, {
    headers: {
      "cache-control": "private, max-age=10"
    }
  });
}

async function fetchCrmApi<T>(
  path: string,
  { principal, sessionToken }: { principal: string; sessionToken?: string }
) {
  const url = new URL(buildCrmApiEndpoint(path));
  if (!sessionToken) {
    url.searchParams.set("principal", principal);
  }

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: sessionToken ? { authorization: `Bearer ${sessionToken}` } : undefined
  });

  if (!response.ok) {
    return undefined;
  }

  return (await response.json()) as T;
}

function emptyResourceList<T>(principal: string): ResourceListResponse<T> {
  return {
    data: [],
    meta: {
      hiddenFields: ["api_unavailable"],
      principal,
      rowScope: "empty_fallback"
    }
  };
}

function emptyArAging(principal: string): ArAgingSummaryResponse {
  return {
    data: [],
    meta: {
      generatedAt: new Date(0).toISOString(),
      principal,
      rowScope: "empty_fallback",
      source: "postgresql"
    }
  };
}
