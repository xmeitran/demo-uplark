import { proxyCrmBffJson, readJsonBody } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/reminders", method: "GET", principalFallback: "founder" });
}

export async function PATCH(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/reminders", method: "PATCH", principalFallback: "founder", body: await readJsonBody(request) });
}
