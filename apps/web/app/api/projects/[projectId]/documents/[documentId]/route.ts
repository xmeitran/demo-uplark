import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const { projectId, documentId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const { projectId, documentId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
    method: "DELETE"
  });
}
