import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyCrmBffJson({ request, path: `/organizations/${encodeURIComponent(id)}/members`, method: "GET" });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyCrmBffJson({ request, path: `/organizations/${encodeURIComponent(id)}/members`, method: "PUT", body: await readJsonBody(request) });
}
