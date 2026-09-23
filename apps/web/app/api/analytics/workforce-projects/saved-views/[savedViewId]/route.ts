import { proxyCrmBffJson, readJsonBody } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

function savedViewPath(savedViewId: string) {
  return `/analytics/workforce-projects/saved-views/${encodeURIComponent(savedViewId)}`;
}

export async function PATCH(request: Request, context: { params: Promise<{ savedViewId: string }> }) {
  const { savedViewId } = await context.params;
  return proxyCrmBffJson({
    request,
    path: savedViewPath(savedViewId),
    method: "PATCH",
    body: await readJsonBody(request),
    principalFallback: "founder",
    requireSessionForWrites: false
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ savedViewId: string }> }) {
  const { savedViewId } = await context.params;
  return proxyCrmBffJson({
    request,
    path: savedViewPath(savedViewId),
    method: "DELETE",
    principalFallback: "founder",
    requireSessionForWrites: false
  });
}
