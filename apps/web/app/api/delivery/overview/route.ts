import type {
  CapacitySummaryResponse,
  ProjectStageSummary,
  ProjectSummary,
  ProjectTaskSummary,
  ResourceListResponse
} from "@b2b-crm/contracts";
import { buildCrmApiEndpoint, resolveProtectedCrmBffSession } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

type DeliveryOverviewResponse = {
  capacity: CapacitySummaryResponse;
  projects: ResourceListResponse<ProjectSummary>;
  stagesByProjectId: Record<string, ProjectStageSummary[]>;
  tasks: ResourceListResponse<ProjectTaskSummary>;
};

export async function GET(request: Request) {
  const incomingUrl = new URL(request.url);
  const principal = incomingUrl.searchParams.get("principal") ?? "founder";
  const session = await resolveProtectedCrmBffSession();
  if (!session.ok) {
    return session.response;
  }
  const { sessionToken } = session;

  const [taskResponse, projectResponse, capacityResponse] = await Promise.all([
    fetchDeliveryApi<ResourceListResponse<ProjectTaskSummary>>("/tasks", { principal, sessionToken }),
    fetchDeliveryApi<ResourceListResponse<ProjectSummary>>("/projects", { principal, sessionToken }),
    fetchDeliveryApi<CapacitySummaryResponse>("/capacity/summary", { principal, sessionToken })
  ]);

  const tasks = taskResponse ?? emptyResourceList<ProjectTaskSummary>(principal);
  const projects = projectResponse ?? emptyResourceList<ProjectSummary>(principal);
  const stageEntries = await Promise.all(
    projects.data.map(async (project) => {
      const stagePayload = await fetchDeliveryApi<ResourceListResponse<ProjectStageSummary>>(
        `/projects/${encodeURIComponent(project.id)}/stages`,
        { principal, sessionToken }
      );
      return [project.id, stagePayload?.data ?? []] as const;
    })
  );

  const payload: DeliveryOverviewResponse = {
    capacity: capacityResponse ?? emptyCapacitySummary(principal),
    projects,
    stagesByProjectId: Object.fromEntries(stageEntries),
    tasks
  };

  return Response.json(payload, {
    headers: {
      "cache-control": "private, max-age=10"
    }
  });
}

function emptyCapacitySummary(principal: string): CapacitySummaryResponse {
  const now = new Date().toISOString();
  return {
    data: [],
    meta: {
      generatedAt: now,
      periodEnd: now,
      periodStart: now,
      principal,
      rowScope: "empty_fallback",
      source: "api_unavailable"
    }
  };
}

async function fetchDeliveryApi<T>(
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
