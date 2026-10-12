import { proxyCrmBffJson } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** D-09: personal leave synced from Lark Approval (read-only list). */
export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/personal-leave" });
}

/** "Đồng bộ ngay". */
export async function POST(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/personal-leave/sync", method: "POST" });
}
