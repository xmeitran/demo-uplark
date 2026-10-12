import { proxyCrmBffJson } from "@/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** V-02: state of the project's two Lark groups. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/lark-groups` });
}

/** V-02 "Tạo lại nhóm" (Admin or the project's PM). */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/lark-groups/recreate`, method: "POST" });
}
