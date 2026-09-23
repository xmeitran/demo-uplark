import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalRequestId: string; proposalPackageId: string }> }
) {
  const { approvalRequestId, proposalPackageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/proposal-packages/${encodeURIComponent(proposalPackageId)}/approval-requests/${encodeURIComponent(approvalRequestId)}/decision`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
