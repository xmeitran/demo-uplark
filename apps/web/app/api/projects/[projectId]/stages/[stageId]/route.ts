import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; stageId: string }> }
) {
  const { projectId, stageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string; stageId: string }> }
) {
  const { projectId, stageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}`,
    method: "DELETE"
  });
}
