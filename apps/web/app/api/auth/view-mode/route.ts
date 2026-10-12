import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** 7.7: an Admin switches between admin view and user view; the API stores the choice and records the switch. */
export async function PATCH(request: Request) {
  return proxyCrmBffJson({ request, path: "/auth/me/view-mode", method: "PATCH", principalFallback: "founder", body: await readJsonBody(request) });
}
