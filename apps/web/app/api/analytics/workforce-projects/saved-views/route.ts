import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/analytics/workforce-projects/saved-views", principalFallback: "founder" });
}

export async function POST(request: Request) {
  return proxyCrmBffJson({
    request,
    path: "/analytics/workforce-projects/saved-views",
    method: "POST",
    body: await readJsonBody(request),
    principalFallback: "founder",
    requireSessionForWrites: false
  });
}
