import { proxyCrmBffJson, readJsonBody } from "../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments: string[] }> };

async function proxy(request: Request, context: Context, method: "GET" | "POST" | "PATCH") {
  const { segments } = await context.params;
  const path = `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
  return proxyCrmBffJson({
    request,
    path,
    method,
    body: method === "GET" ? undefined : await readJsonBody(request),
    principalFallback: "founder"
  });
}

export async function GET(request: Request, context: Context) { return proxy(request, context, "GET"); }
export async function POST(request: Request, context: Context) { return proxy(request, context, "POST"); }
export async function PATCH(request: Request, context: Context) { return proxy(request, context, "PATCH"); }
