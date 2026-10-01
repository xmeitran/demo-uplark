import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyCrmBffJson({
    request,
    path: "/projects/plan-preview",
    method: "POST",
    body: await readJsonBody(request),
    principalFallback: "founder"
  });
}
