import { proxyCrmBffJson, readJsonBody } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return proxyCrmBffJson({ request, path: `/admin/alert-triggers/${encodeURIComponent(code)}`, method: "PATCH", principalFallback: "founder", body: await readJsonBody(request) });
}
