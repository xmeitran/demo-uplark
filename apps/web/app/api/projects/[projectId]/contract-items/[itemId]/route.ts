import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; itemId: string }> };
const itemPath = async ({ params }: Params) => {
  const { projectId, itemId } = await params;
  return `/projects/${encodeURIComponent(projectId)}/contract-items/${encodeURIComponent(itemId)}`;
};

export async function PATCH(request: Request, context: Params) {
  return proxyCrmBffJson({ request, path: await itemPath(context), method: "PATCH", body: await readJsonBody(request) });
}

export async function DELETE(request: Request, context: Params) {
  return proxyCrmBffJson({ request, path: await itemPath(context), method: "DELETE" });
}
