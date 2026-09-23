import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ paymentScheduleId: string }> }) {
  const { paymentScheduleId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/payments/schedules/${encodeURIComponent(paymentScheduleId)}/milestones`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
