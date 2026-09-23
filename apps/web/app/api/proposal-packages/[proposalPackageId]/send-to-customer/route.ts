import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ proposalPackageId: string }> }) {
  const { proposalPackageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/proposal-packages/${encodeURIComponent(proposalPackageId)}/send-to-customer`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
