import { proxyCrmBffJson } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ blockId: string }> }
) {
  const { blockId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/planning-blocks/${encodeURIComponent(blockId)}`,
    method: "DELETE"
  });
}
