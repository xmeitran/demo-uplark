import { proxyCrmBffJson } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/auth/admin/invitations/${encodeURIComponent(invitationId)}/resend`,
    method: "POST"
  });
}
