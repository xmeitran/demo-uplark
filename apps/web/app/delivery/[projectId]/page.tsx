import { DeliveryBusinessFunctionPage } from "../../../src/components/crm-workspace/delivery-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DeliveryProjectDetailPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const resolvedParams = await params;
  return <DeliveryBusinessFunctionPage projectId={resolvedParams.projectId} />;
}
