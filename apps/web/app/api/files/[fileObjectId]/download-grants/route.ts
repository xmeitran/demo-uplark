import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileObjectId: string }> }
) {
  const { fileObjectId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/files/${encodeURIComponent(fileObjectId)}/download-grants`,
    method: "POST",
    body: await readJsonBody(request)
  });
}
