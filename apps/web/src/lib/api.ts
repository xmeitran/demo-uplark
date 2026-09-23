import type {
  AccountsResponse,
  DashboardSummaryResponse,
  LeadSummary,
  OpportunityActivitySummary,
  OpportunitySummary,
  PrincipalContext,
  ProcessMetricsResponse,
  ProjectSummary,
  ResourceListResponse,
  SalesOwnerSummary,
  SalesTargetsResponse,
  ProjectTaskSummary
} from "@b2b-crm/contracts";
import { getCrmApiBaseUrl } from "./crm-bff-proxy";

const staticFallbackPrincipal = "API unavailable";

function emptyStaticFallback<T>(hiddenFields: string[] = ["api_unavailable"]): ResourceListResponse<T> {
  return {
    data: [],
    meta: {
      principal: staticFallbackPrincipal,
      rowScope: "static_fallback",
      hiddenFields
    }
  };
}

const fallback: AccountsResponse = {
  data: [],
  meta: {
    principal: staticFallbackPrincipal,
    rowScope: "static_fallback",
    hiddenFields: ["api_unavailable"]
  }
};

const dashboardFallback: DashboardSummaryResponse = {
  data: {
    accounts: 0,
    opportunities: 0,
    projects: 0,
    tickets: 0,
    artifacts: 0
  },
  drillDown: [],
  meta: {
    principal: staticFallbackPrincipal,
    rowScope: "static_fallback",
    policy: "static_fallback"
  }
};

const opportunityFallback = emptyStaticFallback<OpportunitySummary>();
const salesOwnerFallback = emptyStaticFallback<SalesOwnerSummary>([]);
const leadFallback = emptyStaticFallback<LeadSummary>();

const processMetricsFallback: ProcessMetricsResponse = {
  data: [],
  meta: {
    principal: staticFallbackPrincipal,
    rowScope: "static_fallback",
    generatedAt: new Date().toISOString(),
    source: "postgresql"
  }
};

const salesTargetsFallback: SalesTargetsResponse = {
  data: [],
  meta: {
    principal: staticFallbackPrincipal,
    rowScope: "static_fallback",
    generatedAt: new Date().toISOString(),
    source: "config"
  }
};

const projectFallback = emptyStaticFallback<ProjectSummary>();

export async function getAuthMeWithAuth({
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  sessionToken?: string;
  baseUrl?: string;
}): Promise<PrincipalContext | null> {
  if (!sessionToken) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/auth/me`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${sessionToken}`
      }
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PrincipalContext;
  } catch {
    return null;
  }
}

export async function getAccounts(principal: string): Promise<AccountsResponse> {
  const baseUrl = getCrmApiBaseUrl();
  return getAccountsWithAuth({ baseUrl, principal });
}

export async function getAccountsWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<AccountsResponse> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/accounts?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as AccountsResponse;
  } catch {
    return fallback;
  }
}

export async function getDashboardSummaryWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<DashboardSummaryResponse | null> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/dashboard/summary?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return dashboardFallback;
    }

    return (await response.json()) as DashboardSummaryResponse;
  } catch {
    return dashboardFallback;
  }
}

export async function getOpportunitiesWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<ResourceListResponse<OpportunitySummary>> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/opportunities?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return opportunityFallback;
    }

    return (await response.json()) as ResourceListResponse<OpportunitySummary>;
  } catch {
    return opportunityFallback;
  }
}

export async function getLeadsWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<ResourceListResponse<LeadSummary>> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/sales/leads?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return leadFallback;
    }

    return (await response.json()) as ResourceListResponse<LeadSummary>;
  } catch {
    return leadFallback;
  }
}

export async function getSalesOwnersWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<ResourceListResponse<SalesOwnerSummary>> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/sales/owners?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return salesOwnerFallback;
    }

    return (await response.json()) as ResourceListResponse<SalesOwnerSummary>;
  } catch {
    return salesOwnerFallback;
  }
}

export async function getProcessMetricsWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<ProcessMetricsResponse> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/sales/process-metrics?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return processMetricsFallback;
    }

    return (await response.json()) as ProcessMetricsResponse;
  } catch {
    return processMetricsFallback;
  }
}

export async function getSalesTargetsWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<SalesTargetsResponse> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/sales/targets?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return salesTargetsFallback;
    }

    return (await response.json()) as SalesTargetsResponse;
  } catch {
    return salesTargetsFallback;
  }
}

export async function getProjectsWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<ResourceListResponse<ProjectSummary>> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/projects?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return projectFallback;
    }

    return (await response.json()) as ResourceListResponse<ProjectSummary>;
  } catch {
    return projectFallback;
  }
}

export type OpportunityActivitiesResponse = ResourceListResponse<OpportunityActivitySummary>;

const taskFallback = emptyStaticFallback<ProjectTaskSummary>();

export async function getTasksWithAuth({
  principal,
  sessionToken,
  baseUrl = getCrmApiBaseUrl()
}: {
  principal: string;
  sessionToken?: string;
  baseUrl?: string;
}): Promise<ResourceListResponse<ProjectTaskSummary>> {
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${baseUrl}/tasks?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return taskFallback;
    }

    return (await response.json()) as ResourceListResponse<ProjectTaskSummary>;
  } catch {
    return taskFallback;
  }
}
