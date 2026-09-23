import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ milestoneId: string }> }) {
  const { milestoneId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/payments/milestones/${encodeURIComponent(milestoneId)}/evidence`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
