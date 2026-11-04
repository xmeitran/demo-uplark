import { proxyCrmBffJson } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return proxyCrmBffJson({ request, path: `/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, method: "DELETE" });
}
