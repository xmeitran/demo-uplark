import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; riskId: string }> }) {
  const { projectId, riskId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/risks/${encodeURIComponent(riskId)}/transition`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
