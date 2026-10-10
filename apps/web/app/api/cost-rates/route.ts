import { proxyCrmBffJson, readJsonBody } from "../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/cost-rates", principalFallback: "founder" });
}

export async function PUT(request: Request) {
  return proxyCrmBffJson({ request, path: "/cost-rates", method: "PUT", principalFallback: "founder", body: await readJsonBody(request) });
}
