import { proxyCrmBffJson } from "../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** D-34: monthly staff cost of one person (?userId=…). Cost permission group only; the API enforces it. */
export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/staff-costs", principalFallback: "founder" });
}
