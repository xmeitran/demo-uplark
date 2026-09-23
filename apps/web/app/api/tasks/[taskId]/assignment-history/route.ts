import { proxyCrmBffJson } from "../../../../../src/lib/crm-bff-proxy";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return proxyCrmBffJson({ request, path: `/tasks/${encodeURIComponent(taskId)}/assignment-history` });
}
