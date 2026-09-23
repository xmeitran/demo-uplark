import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ blockId: string }> }
) {
  const { blockId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/planning-blocks/${encodeURIComponent(blockId)}/transitions`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
