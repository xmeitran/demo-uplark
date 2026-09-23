import { proxyCrmBffJson } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/alerts", method: "GET", principalFallback: "founder" });
}
