import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/opportunities/${encodeURIComponent(opportunityId)}/handoff-kickoff`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
