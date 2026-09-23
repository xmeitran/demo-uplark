import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; activityId: string }> }) {
  const { projectId, activityId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/activity/${encodeURIComponent(activityId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string; activityId: string }> }) {
  const { projectId, activityId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/activity/${encodeURIComponent(activityId)}`,
    method: "DELETE"
  });
}
