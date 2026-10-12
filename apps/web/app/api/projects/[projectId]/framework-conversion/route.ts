import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/framework-conversion` });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/framework-conversion`, method: "POST", body: await readJsonBody(request) });
}
