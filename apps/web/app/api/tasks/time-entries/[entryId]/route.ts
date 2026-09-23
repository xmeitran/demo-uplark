import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/time-entries/${encodeURIComponent(entryId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/time-entries/${encodeURIComponent(entryId)}`,
    method: "DELETE"
  });
}
