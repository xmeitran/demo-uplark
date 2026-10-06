import { proxyCrmBffJson } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/auth/admin/users/${encodeURIComponent(userId)}?includeSuspended=true`,
    principalFallback: "founder"
  });
}
