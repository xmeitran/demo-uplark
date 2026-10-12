import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** P&L spec 12/10 point 5: correct the Layer 2 chosen when the hour was logged. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/time-entries/${encodeURIComponent(entryId)}/layer2`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}
