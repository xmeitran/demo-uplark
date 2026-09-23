import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyCrmBffJson({
    request,
    path: "/proposal-packages/approval-callback",
    method: "POST",
    body: await readJsonBody(request)
  });
}
