import { proxyCrmBffJson, readJsonBody } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** "Gia hạn stage" (TD-04 / TD-05, D-21). Body { newDueAt, reason, changeRequestId? }; returns the gate list. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; stageId: string }> }) {
  const { projectId, stageId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/extensions`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
