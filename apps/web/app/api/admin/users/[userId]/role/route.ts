import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/auth/admin/users/${encodeURIComponent(userId)}/role`,
    method: "PATCH",
    principalFallback: "founder",
    body: await readJsonBody(request)
  });
}
