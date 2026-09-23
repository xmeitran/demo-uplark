import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}`,
    principalFallback: "founder"
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}`,
    method: "DELETE"
  });
}
