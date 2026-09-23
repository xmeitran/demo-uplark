import { proxyCrmBffJson, readJsonBody } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyCrmBffJson({ request, path: "/workspace/day-offs", method: "GET", principalFallback: "founder" });
}

export async function POST(request: Request) {
  return proxyCrmBffJson({
    request,
    path: "/workspace/day-offs",
    method: "POST",
    principalFallback: "founder",
    body: await readJsonBody(request)
  });
}
