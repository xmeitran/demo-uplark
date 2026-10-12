import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** Section 9.2 worklist: Layer 1 and side of the P&L closing point of a stage the legacy conversion could not map. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; stageId: string }> }
) {
  const { projectId, stageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/classification`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}
