import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> }
) {
  const { projectId, milestoneId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/gate`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}
