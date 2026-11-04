import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return proxyCrmBffJson({ request, path: `/admin/business-roles/${encodeURIComponent(code)}`, method: "PATCH", body: await readJsonBody(request), principalFallback: "founder" });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return proxyCrmBffJson({ request, path: `/admin/business-roles/${encodeURIComponent(code)}`, method: "DELETE", principalFallback: "founder" });
}
