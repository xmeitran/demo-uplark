import { proxyCrmBffJson, readJsonBody } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return proxyCrmBffJson({ request, path: `/admin/parameters/${encodeURIComponent(key)}`, method: "PATCH", principalFallback: "founder", body: await readJsonBody(request) });
}
