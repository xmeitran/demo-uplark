import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildCrmApiEndpoint } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("lcrm_session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ message: "Admin session is required" }, { status: 401 });
  }

  const response = await fetch(buildCrmApiEndpoint(`/auth/admin/invitations/${encodeURIComponent(invitationId)}/approve`), {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`
    },
    cache: "no-store"
  });
  const body = await response.json();

  return NextResponse.json(body, { status: response.status });
}
