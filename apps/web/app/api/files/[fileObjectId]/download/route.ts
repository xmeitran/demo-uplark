import { buildCrmApiEndpoint } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileObjectId: string }> }
) {
  const { fileObjectId } = await params;
  const incomingUrl = new URL(request.url);
  const token = incomingUrl.searchParams.get("token");
  const targetUrl = new URL(buildCrmApiEndpoint(`/files/${encodeURIComponent(fileObjectId)}/download`));
  if (token) {
    targetUrl.searchParams.set("token", token);
  }

  const upstream = await fetch(targetUrl, {
    method: "GET",
    cache: "no-store"
  });
  const headers = new Headers();
  for (const key of ["cache-control", "content-disposition", "content-length", "content-type"]) {
    const value = upstream.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}
