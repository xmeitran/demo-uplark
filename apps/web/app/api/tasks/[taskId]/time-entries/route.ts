import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/${encodeURIComponent(taskId)}/time-entries`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
