import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyCrmBffJson({ request, path: "/admin/reminders/send", method: "POST", principalFallback: "founder", body: await readJsonBody(request) });
}
