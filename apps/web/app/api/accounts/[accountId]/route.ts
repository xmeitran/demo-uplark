import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    accountId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { accountId } = await context.params;
  return proxyCrmBffJson({ request, path: `/accounts/${accountId}`, principalFallback: "founder" });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { accountId } = await context.params;
  return proxyCrmBffJson({
    request,
    path: `/accounts/${accountId}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { accountId } = await context.params;
  return proxyCrmBffJson({
    request,
    path: `/accounts/${accountId}`,
    method: "DELETE"
  });
}
