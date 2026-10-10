import { proxyCrmBffJson, readJsonBody } from "../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/pnl-periods", method: "GET", principalFallback: "founder" });
}

export async function POST(request: Request) {
  return proxyCrmBffJson({ request, path: "/pnl-periods", method: "POST", principalFallback: "founder", body: await readJsonBody(request) });
}

/** Removes a project's entered revenue for a month (?projectId=…&periodKey=YYYY-MM). */
export async function DELETE(request: Request) {
  return proxyCrmBffJson({ request, path: "/pnl-periods", method: "DELETE", principalFallback: "founder" });
}
