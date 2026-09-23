import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/opportunities/${encodeURIComponent(opportunityId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}
