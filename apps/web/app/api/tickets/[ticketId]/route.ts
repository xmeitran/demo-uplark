import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    ticketId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { ticketId } = await context.params;
  return proxyCrmBffJson({ request, path: `/tickets/${ticketId}`, principalFallback: "founder" });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { ticketId } = await context.params;
  return proxyCrmBffJson({
    request,
    path: `/tickets/${ticketId}`,
    method: "PATCH",
    body: await readJsonBody(request)
  });
}
