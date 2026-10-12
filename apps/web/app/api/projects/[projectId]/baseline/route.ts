import { proxyCrmBffJson, readJsonBody } from "../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** Baselines B0 / B1 of the project: current versions, history and diffs (D-20, D-21). */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/baseline` });
}

/** Admin: lock the baseline, or write a new version after changes. Body { reason }. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return proxyCrmBffJson({ request, path: `/projects/${encodeURIComponent(projectId)}/baseline`, method: "POST", body: await readJsonBody(request) });
}
