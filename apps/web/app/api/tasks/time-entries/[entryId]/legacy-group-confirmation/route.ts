import { proxyCrmBffJson } from "../../../../../../src/lib/crm-bff-proxy";

export const dynamic = "force-dynamic";

/** Section 9.2: the PM confirms an old "Họp"/"Khác" hour stays in its customer project. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await params;
  return proxyCrmBffJson({
    request,
    path: `/tasks/time-entries/${encodeURIComponent(entryId)}/legacy-group-confirmation`,
    method: "POST"
  });
}
