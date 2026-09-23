import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> }
) {
  const { accountId, contactId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contactId)}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> }
) {
  const { accountId, contactId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contactId)}`,
    method: "DELETE"
  });
}
