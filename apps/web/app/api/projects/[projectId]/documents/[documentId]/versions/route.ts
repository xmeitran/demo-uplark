import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> }
) {
  const { projectId, documentId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
