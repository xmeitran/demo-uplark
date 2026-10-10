import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/project-costs/planned/${encodeURIComponent(projectId)}`, method: "PUT", principalFallback: "founder", body: await readJsonBody(request) });
}
