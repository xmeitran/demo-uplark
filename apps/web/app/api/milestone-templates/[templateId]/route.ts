import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  return proxyCrmBffJson({ request, path: `/milestone-templates/${encodeURIComponent(templateId)}`, method: "PATCH", body: await readJsonBody(request), principalFallback: "founder" });
}
