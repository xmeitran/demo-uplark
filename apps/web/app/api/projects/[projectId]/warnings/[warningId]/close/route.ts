import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; warningId: string }> }) {
  const { projectId, warningId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/warnings/${encodeURIComponent(warningId)}/close`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
