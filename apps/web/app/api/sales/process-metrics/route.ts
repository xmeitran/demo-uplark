import { proxyCrmBffJson } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/sales/process-metrics", principalFallback: "founder" });
}
