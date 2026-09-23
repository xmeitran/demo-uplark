import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/${encodeURIComponent(taskId)}`,
    principalFallback: "founder"
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/${encodeURIComponent(taskId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/${encodeURIComponent(taskId)}`,
    method: "DELETE"
  });
}
