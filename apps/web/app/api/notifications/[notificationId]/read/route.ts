import { proxyCrmBffJson } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const { notificationId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/notifications/${encodeURIComponent(notificationId)}/read`,
    method: "PATCH",
    principalFallback: "founder"
  });
}
