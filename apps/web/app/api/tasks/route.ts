import { proxyCrmBffJson, readJsonBody } from "../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/tasks", principalFallback: "founder" });
}

export async function POST(request: Request) {
  return proxyCrmBffJson({ request, path: "/tasks", method: "POST", body: await readJsonBody(request) });
}
