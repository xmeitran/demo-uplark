import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/sales/leads/${encodeURIComponent(leadId)}/disqualify`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
