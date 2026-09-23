import { proxyCrmBffJson } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // The staging sandbox resolves the founder principal by role. There is no
  // synthetic `finance-admin` user in the seeded workspace, so using that
  // fallback makes the P&L tab return 401 even though the rest of the CRM is
  // available. Authenticated production requests still use their bearer
  // session; this only affects the explicitly opted-in fallback path.
  return proxyCrmBffJson({ request, path: "/project-controls/pl-summary", principalFallback: "founder" });
}
