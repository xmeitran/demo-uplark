import { proxyCrmBffJson } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  return proxyCrmBffJson({ request, path: `/pnl-periods/${encodeURIComponent(periodId)}/lock`, method: "POST", principalFallback: "founder" });
}
