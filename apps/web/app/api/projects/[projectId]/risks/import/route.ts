import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** 9.4: import the old CR Log (Admin only). Body { rows: [{ "<file header>": value }] }. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/risks/import`, method: "POST", body: await readJsonBody(request) });
}
