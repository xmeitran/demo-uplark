import { proxyCrmBffJson } from "../../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> }
) {
  const { projectId, milestoneId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/evaluate`,
    method: "POST"
  });
}
