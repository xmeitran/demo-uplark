import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; gateId: string }> }) {
  const { projectId, gateId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/gates/${encodeURIComponent(gateId)}/actions`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
