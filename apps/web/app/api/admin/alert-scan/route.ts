import { proxyCrmBffJson } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/alert-scan", method: "POST", principalFallback: "founder" });
}
