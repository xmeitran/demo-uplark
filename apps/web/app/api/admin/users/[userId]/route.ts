import { proxyCrmBffJson, requireCrmSessionForBffWrite } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireCrmSessionForBffWrite();
  if (!gate.ok) return gate.response;

  const { userId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/auth/admin/users/${encodeURIComponent(userId)}`
  });
}
