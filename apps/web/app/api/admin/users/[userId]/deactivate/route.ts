import { proxyCrmBffJson } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/auth/admin/users/${encodeURIComponent(userId)}/deactivate`,
    method: "POST"
  });
}
