import { proxyCrmBffJson, readJsonBody } from "../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/projects", principalFallback: "founder" });
}

export async function POST(request: Request) {
  return proxyCrmBffJson({ request, path: "/projects", method: "POST", body: await readJsonBody(request) });
}
