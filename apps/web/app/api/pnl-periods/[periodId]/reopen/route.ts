import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  return proxyCrmBffJson({ request, path: `/pnl-periods/${encodeURIComponent(periodId)}/reopen`, method: "POST", principalFallback: "founder", body: await readJsonBody(request) });
}
