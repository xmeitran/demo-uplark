import { proxyCrmBffJson } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ taskId: string; attachmentId: string }> }
) {
  const { taskId, attachmentId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
    method: "DELETE"
  });
}
