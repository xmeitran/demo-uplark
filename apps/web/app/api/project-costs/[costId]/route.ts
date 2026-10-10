import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ costId: string }> }) {
  const { costId } = await params;
  return proxyCrmBffJson({ request, path: `/project-costs/${encodeURIComponent(costId)}`, method: "PATCH", principalFallback: "founder", body: await readJsonBody(request) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ costId: string }> }) {
  const { costId } = await params;
  return proxyCrmBffJson({ request, path: `/project-costs/${encodeURIComponent(costId)}`, method: "DELETE", principalFallback: "founder" });
}
