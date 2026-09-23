import type {
  AccountsResponse,
  DashboardSummaryResponse,
  LeadSummary,
  OpportunitySummary,
  ProcessMetricsResponse,
  ResourceListResponse,
  ProjectSummary,
  SalesOwnerSummary,
  SalesTargetsResponse,
  ProjectTaskSummary
} from "@b2b-crm/contracts";
import { createHash } from "crypto";
import { ShopifyAppShell, ShopifyBanner, ShopifyPage, type ShopifyActiveItem } from "../shopify-ui";
import {
  resolveWorkspaceSessionToken,
  shouldFailClosedOnProtectedFallback,
  shouldRequirePublicSession
} from "../../lib/crm-public-session-policy";
import {
  getAccountsWithAuth,
  getAuthMeWithAuth,
  getDashboardSummaryWithAuth,
  getLeadsWithAuth,
  getOpportunitiesWithAuth,
  getProcessMetricsWithAuth,
  getProjectsWithAuth,
  getSalesOwnersWithAuth,
  getSalesTargetsWithAuth,
  getTasksWithAuth
} from "../../lib/api";

export type SearchParams = Promise<{ principal?: string; session?: string }> | undefined;

// Must match the token minted by /api/auth/demo/session/route.ts for local dev
const LOCAL_DEV_SESSION_TOKEN = "local-founder-dev-session";

export type WorkspaceData = {
  accounts: AccountsResponse;
  dashboard: DashboardSummaryResponse | null;
  leads: ResourceListResponse<LeadSummary>;
  opportunities: ResourceListResponse<OpportunitySummary>;
  salesOwners: ResourceListResponse<SalesOwnerSummary>;
  salesTargets: SalesTargetsResponse;
  projects: ResourceListResponse<ProjectSummary>;
  tasks: ResourceListResponse<ProjectTaskSummary>;
  processMetrics: ProcessMetricsResponse;
  principal: string;
  shellPrincipal: string;
  shellPrincipalAvatarUrl?: string;
  sessionRequired: boolean;
  sessionRequiredMessage?: string;
  usingFallbackData: boolean;
};

type WorkspaceDataCacheEntry = {
  expiresAt: number;
  value: Promise<WorkspaceData> | WorkspaceData;
};

type WorkspaceDataResourceKey =
  | "accounts"
  | "dashboard"
  | "leads"
  | "opportunities"
  | "processMetrics"
  | "projects"
  | "salesOwners"
  | "salesTargets"
  | "tasks";

export type WorkspaceDataIncludes = Partial<Record<WorkspaceDataResourceKey, boolean>>;

const workspaceDataResourceKeys: WorkspaceDataResourceKey[] = [
  "accounts",
  "dashboard",
  "leads",
  "opportunities",
  "processMetrics",
  "projects",
  "salesOwners",
  "salesTargets",
  "tasks"
];
const WORKSPACE_DATA_CACHE_MAX_ENTRIES = 24;
const workspaceDataCache = new Map<string, WorkspaceDataCacheEntry>();

export async function resolveWorkspaceData(searchParams: SearchParams, includes?: WorkspaceDataIncludes): Promise<WorkspaceData> {
  const params = await searchParams;
  const principal = params?.principal ?? "founder";
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const rawSessionToken = resolveWorkspaceSessionToken({
    cookieSessionToken: cookieStore.get("lcrm_session")?.value,
    querySessionToken: params?.session
  });

  // Local dev bypass: synthetic token must not be forwarded to the production API
  // (it would cause 401 on every API call and trigger a session-required fallback).
  // Strip it here so the workspace loads as principal=founder with no auth token.
  const isLocalDevBypass = process.env.NODE_ENV !== "production" && rawSessionToken === LOCAL_DEV_SESSION_TOKEN;
  const sessionToken = isLocalDevBypass ? undefined : rawSessionToken;

  if (shouldRequirePublicSession({ sessionToken })) {
    return sessionRequiredWorkspaceData(principal);
  }

  const cacheKey = buildWorkspaceDataCacheKey({ includes, principal, sessionToken: rawSessionToken });
  const cached = readWorkspaceDataCache(cacheKey);
  if (cached) {
    return cached;
  }

  const pendingWorkspaceData = loadWorkspaceData({ includes, principal, sessionToken, isLocalDevBypass });
  writeWorkspaceDataCache(cacheKey, pendingWorkspaceData);

  const workspaceData = await pendingWorkspaceData;
  if (workspaceData.sessionRequired || workspaceData.usingFallbackData) {
    workspaceDataCache.delete(cacheKey);
  } else {
    writeWorkspaceDataCache(cacheKey, workspaceData);
  }

  return workspaceData;
}

async function loadWorkspaceData({
  includes,
  principal,
  sessionToken,
  isLocalDevBypass = false
}: {
  includes?: WorkspaceDataIncludes;
  principal: string;
  sessionToken?: string;
  isLocalDevBypass?: boolean;
}): Promise<WorkspaceData> {

  const [currentPrincipal, accounts, dashboard, opportunities, leads, salesOwners, salesTargets, processMetrics, projects, tasks] = await Promise.all([
    sessionToken ? getAuthMeWithAuth({ sessionToken }) : Promise.resolve(null),
    shouldLoadWorkspaceResource(includes, "accounts")
      ? getAccountsWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyAccountsResponse(principal)),
    shouldLoadWorkspaceResource(includes, "dashboard")
      ? getDashboardSummaryWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyDashboardResponse(principal)),
    shouldLoadWorkspaceResource(includes, "opportunities")
      ? getOpportunitiesWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyResourceList<OpportunitySummary>(principal)),
    shouldLoadWorkspaceResource(includes, "leads")
      ? getLeadsWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyResourceList<LeadSummary>(principal)),
    shouldLoadWorkspaceResource(includes, "salesOwners")
      ? getSalesOwnersWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyResourceList<SalesOwnerSummary>(principal)),
    shouldLoadWorkspaceResource(includes, "salesTargets")
      ? getSalesTargetsWithAuth({ principal, sessionToken })
      : Promise.resolve(emptySalesTargetsResponse(principal)),
    shouldLoadWorkspaceResource(includes, "processMetrics")
      ? getProcessMetricsWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyProcessMetricsResponse(principal)),
    shouldLoadWorkspaceResource(includes, "projects")
      ? getProjectsWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyResourceList<ProjectSummary>(principal)),
    shouldLoadWorkspaceResource(includes, "tasks")
      ? getTasksWithAuth({ principal, sessionToken })
      : Promise.resolve(emptyResourceList<ProjectTaskSummary>(principal))
  ]);

  const usingFallbackData =
    (shouldLoadWorkspaceResource(includes, "accounts") && accounts.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "dashboard") && dashboard?.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "opportunities") && opportunities.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "leads") && leads.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "salesOwners") && salesOwners.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "salesTargets") && salesTargets.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "projects") && projects.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "tasks") && tasks.meta.rowScope === "static_fallback") ||
    (shouldLoadWorkspaceResource(includes, "processMetrics") && processMetrics.meta.rowScope === "static_fallback");

  if (usingFallbackData && shouldFailClosedOnProtectedFallback({})) {
    return sessionRequiredWorkspaceData(
      principal,
      sessionToken
        ? "Phiên đăng nhập chưa được xác thực hoặc API đang từ chối quyền truy cập. Hãy đăng nhập lại bằng Lark để mở dữ liệu theo quyền."
        : undefined
    );
  }

  return {
    accounts,
    dashboard,
    leads,
    opportunities,
    salesOwners,
    salesTargets,
    projects,
    tasks,
    processMetrics,
    principal,
    shellPrincipal: isLocalDevBypass
      ? "Nguyễn Hùng Việt Kha"
      : (currentPrincipal?.displayName ?? (sessionToken ? accounts.meta.principal : principal)),
    shellPrincipalAvatarUrl: currentPrincipal?.avatarUrl,
    sessionRequired: false,
    usingFallbackData
  };
}

function buildWorkspaceDataCacheKey({
  includes,
  principal,
  sessionToken
}: {
  includes?: WorkspaceDataIncludes;
  principal: string;
  sessionToken?: string;
}) {
  const sessionScope = sessionToken
    ? createHash("sha256").update(sessionToken).digest("hex").slice(0, 16)
    : "anonymous-principal";

  return [
    "workspace-data",
    process.env.CRM_API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    process.env.NODE_ENV ?? "development",
    principal,
    getWorkspaceDataScopeSignature(includes),
    sessionScope
  ].join(":");
}

function shouldLoadWorkspaceResource(includes: WorkspaceDataIncludes | undefined, key: WorkspaceDataResourceKey) {
  return includes ? includes[key] === true : true;
}

function getWorkspaceDataScopeSignature(includes: WorkspaceDataIncludes | undefined) {
  if (!includes) {
    return "all";
  }

  const scope = workspaceDataResourceKeys.filter((key) => includes[key] === true).join(",");
  return scope || "none";
}

function emptyMeta(principal: string) {
  return {
    principal,
    rowScope: "not_requested",
    hiddenFields: [] as string[]
  };
}

function emptyResourceList<T>(principal: string): ResourceListResponse<T> {
  return {
    data: [],
    meta: emptyMeta(principal)
  };
}

function emptyAccountsResponse(principal: string): AccountsResponse {
  return emptyResourceList(principal);
}

function emptyDashboardResponse(principal: string): DashboardSummaryResponse {
  return {
    data: { accounts: 0, artifacts: 0, opportunities: 0, projects: 0, tickets: 0 },
    drillDown: [],
    meta: { principal, rowScope: "not_requested", policy: "not_requested" }
  };
}

function emptySalesTargetsResponse(principal: string): SalesTargetsResponse {
  return {
    data: [],
    meta: { ...emptyMeta(principal), generatedAt: new Date(0).toISOString(), source: "config" }
  };
}

function emptyProcessMetricsResponse(principal: string): ProcessMetricsResponse {
  return {
    data: [],
    meta: { ...emptyMeta(principal), generatedAt: new Date(0).toISOString(), source: "postgresql" }
  };
}

function readWorkspaceDataCache(key: string) {
  const cached = workspaceDataCache.get(key);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    workspaceDataCache.delete(key);
    return undefined;
  }

  return cached.value;
}

function writeWorkspaceDataCache(key: string, value: Promise<WorkspaceData> | WorkspaceData) {
  const ttlMs = getWorkspaceDataCacheTtlMs();
  if (ttlMs <= 0) {
    workspaceDataCache.delete(key);
    return;
  }

  pruneWorkspaceDataCache();
  workspaceDataCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value
  });
}

function pruneWorkspaceDataCache() {
  const now = Date.now();
  for (const [key, entry] of workspaceDataCache.entries()) {
    if (entry.expiresAt <= now) {
      workspaceDataCache.delete(key);
    }
  }

  while (workspaceDataCache.size >= WORKSPACE_DATA_CACHE_MAX_ENTRIES) {
    const oldestKey = workspaceDataCache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    workspaceDataCache.delete(oldestKey);
  }
}

function getWorkspaceDataCacheTtlMs() {
  const rawTtl = process.env.CRM_WORKSPACE_DATA_CACHE_TTL_MS ?? "12000";
  const ttlMs = Number.parseInt(rawTtl, 10);
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    return 5000;
  }

  return Math.min(ttlMs, 30000);
}

export function CrmPageShell({
  active,
  children,
  data,
  description,
  title
}: {
  active: ShopifyActiveItem;
  children: React.ReactNode;
  data: WorkspaceData;
  description?: string;
  title: string;
}) {
  return (
    <ShopifyAppShell active={active} principal={data.shellPrincipal} principalAvatarUrl={data.shellPrincipalAvatarUrl}>
      <ShopifyPage heading={title}>
        {description ? (
          <p style={{
            fontSize: "13.5px",
            color: "var(--text-muted)",
            marginTop: "-8px",
            marginBottom: "16px",
            fontFamily: "var(--font-sans)",
            fontWeight: 400,
            lineHeight: "1.5"
          }}>
            {description}
          </p>
        ) : null}
        {data.sessionRequired ? (
          <SessionRequiredGate message={data.sessionRequiredMessage} returnTo={returnToForActiveItem(active)} />
        ) : (
          <>
            {data.usingFallbackData ? <ApiFallbackNotice /> : null}
            {children}
          </>
        )}
      </ShopifyPage>
    </ShopifyAppShell>
  );
}

function ApiFallbackNotice() {
  return (
    <ShopifyBanner heading="Đang dùng dữ liệu dự phòng" tone="warning">
      <s-paragraph>Chưa lấy được dữ liệu mới nhất cho màn hình này, nên hệ thống đang hiển thị bản mẫu an toàn để bạn tiếp tục xem cấu trúc vận hành.</s-paragraph>
    </ShopifyBanner>
  );
}

function SessionRequiredGate({ message, returnTo }: { message?: string; returnTo: string }) {
  const loginHref = `/login?returnTo=${encodeURIComponent(returnTo)}&auth_error=session_required`;

  return (
    <ShopifyBanner heading="Cần đăng nhập Lark" tone="warning">
      <s-paragraph>
        {message ?? "CRM production không hiển thị dữ liệu demo khi chưa có phiên đăng nhập. Hãy đăng nhập bằng Lark để mở đúng dữ liệu theo quyền."}
      </s-paragraph>
      <p style={{ margin: "12px 0 0" }}>
        <a href={loginHref}>Đăng nhập bằng Lark</a>
      </p>
    </ShopifyBanner>
  );
}

function sessionRequiredWorkspaceData(principal: string, message?: string): WorkspaceData {
  const meta = {
    principal: "Chưa đăng nhập",
    rowScope: "auth_required",
    hiddenFields: ["session_required"]
  };
  const generatedAt = new Date(0).toISOString();

  return {
    accounts: { data: [], meta },
    dashboard: {
      data: { accounts: 0, opportunities: 0, projects: 0, tickets: 0, artifacts: 0 },
      drillDown: [],
      meta: { principal: meta.principal, rowScope: meta.rowScope, policy: "session_required" }
    },
    leads: { data: [], meta },
    opportunities: { data: [], meta },
    salesOwners: { data: [], meta },
    salesTargets: {
      data: [],
      meta: { principal: meta.principal, rowScope: meta.rowScope, generatedAt, source: "config" }
    },
    projects: { data: [], meta },
    tasks: { data: [], meta },
    processMetrics: {
      data: [],
      meta: { principal: meta.principal, rowScope: meta.rowScope, generatedAt, source: "postgresql" }
    },
    principal,
    shellPrincipal: meta.principal,
    shellPrincipalAvatarUrl: undefined,
    sessionRequired: true,
    sessionRequiredMessage: message,
    usingFallbackData: false
  };
}

function returnToForActiveItem(active: ShopifyActiveItem) {
  const routes: Record<ShopifyActiveItem, string> = {
    accounts: "/accounts",
    dashboard: "/",
    data: "/data",
    delivery: "/delivery",
    finance: "/finance",
    management: "/management",
    pipeline: "/pipeline",
    policy: "/policy",
    portal: "/portal",
    proposals: "/proposals",
    "project-controls": "/project-controls",
    "resource-mgmt": "/resource-mgmt",
    support: "/support",
    tasks: "/tasks"
  };

  return routes[active];
}
