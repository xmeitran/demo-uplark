import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/opportunities/${encodeURIComponent(opportunityId)}/activities`,
    principalFallback: "founder"
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/opportunities/${encodeURIComponent(opportunityId)}/activities`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
