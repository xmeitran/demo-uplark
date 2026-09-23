import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return proxyCrmBffJson({ request, path: `/accounts/${encodeURIComponent(accountId)}/contacts`, principalFallback: "founder" });
}

export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/accounts/${encodeURIComponent(accountId)}/contacts`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
