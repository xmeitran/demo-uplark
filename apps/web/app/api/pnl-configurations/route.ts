import { proxyCrmBffJson, readJsonBody } from "../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/pnl-configurations", principalFallback: "founder" });
}

export async function PATCH(request: Request) {
  return proxyCrmBffJson({ request, path: "/pnl-configurations", method: "PATCH", principalFallback: "founder", body: await readJsonBody(request) });
}
