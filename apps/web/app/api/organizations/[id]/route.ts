import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyCrmBffJson({ request, path: `/organizations/${encodeURIComponent(id)}`, method: "PATCH", body: await readJsonBody(request) });
}
