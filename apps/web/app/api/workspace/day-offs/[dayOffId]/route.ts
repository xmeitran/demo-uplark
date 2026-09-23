import { proxyCrmBffJson, readJsonBody } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ dayOffId: string }> }) {
  const { dayOffId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/workspace/day-offs/${encodeURIComponent(dayOffId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}
