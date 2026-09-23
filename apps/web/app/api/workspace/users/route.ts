import { proxyCrmBffJson } from "@/lib/crm-bff-proxy";
export const dynamic = "force-dynamic";
/** Minimal authenticated member directory for assignment pickers. */
export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/auth/workspace/users", principalFallback: "founder" });
}
