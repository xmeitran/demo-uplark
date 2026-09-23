import { proxyCrmBffJson } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ proposalPackageId: string }> }) {
  const { proposalPackageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/proposal-packages/${encodeURIComponent(proposalPackageId)}`,
    principalFallback: "founder"
  });
}
