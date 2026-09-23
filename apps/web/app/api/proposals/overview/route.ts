import type {
  OpportunitySummary,
  ProposalPackageDetail,
  ProposalPackageSummary,
  ResourceListResponse
} from "@b2b-crm/contracts";
import { buildCrmApiEndpoint, resolveProtectedCrmBffSession } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

type ProposalsOverviewResponse = {
  opportunities: ResourceListResponse<OpportunitySummary>;
  packages: ResourceListResponse<ProposalPackageSummary>;
  selected: ProposalPackageDetail | null;
};

export async function GET(request: Request) {
  const incomingUrl = new URL(request.url);
  const principal = incomingUrl.searchParams.get("principal") ?? "founder";
  const session = await resolveProtectedCrmBffSession();
  if (!session.ok) {
    return session.response;
  }
  const { sessionToken } = session;

  const [packageResponse, opportunityResponse] = await Promise.all([
    fetchCrmApi<ResourceListResponse<ProposalPackageSummary>>("/proposal-packages", { principal, sessionToken }),
    fetchCrmApi<ResourceListResponse<OpportunitySummary>>("/opportunities", { principal, sessionToken })
  ]);

  const packages = packageResponse ?? emptyResourceList<ProposalPackageSummary>(principal);
  const opportunities = opportunityResponse ?? emptyResourceList<OpportunitySummary>(principal);
  const firstPackageId = packages.data[0]?.id;
  const selected = firstPackageId
    ? (await fetchCrmApi<ProposalPackageDetail>(`/proposal-packages/${encodeURIComponent(firstPackageId)}`, {
        principal,
        sessionToken
      })) ?? null
    : null;

  const payload: ProposalsOverviewResponse = {
    opportunities,
    packages,
    selected
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
